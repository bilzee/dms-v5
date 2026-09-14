import { POST as createRapidAssessment } from '@/app/api/v1/rapid-assessments/route'
import { GET as verificationQueue } from '@/app/api/v1/verification/queue/assessments/route'
import { POST as verifyAssessmentRoute } from '@/app/api/v1/assessments/[id]/verify/route'
import { makeRequest, tokenFor, type AuthedUser } from '../helpers/api'
import {
  createUser,
  createEntity,
  createIncident,
  createEntityAssignment,
} from '../factories'
import { testDb, truncateTestDb } from '../helpers/test-db'

/**
 * P0 — Assessment verification cascade:
 * create (assignment gate + auto-approve) → verification queue → verify
 * (status flip + audit log + queue exclusion) → illegal re-verify.
 */

const DIRE_HEALTH_DATA = {
  hasFunctionalClinic: false,
  hasEmergencyServices: false,
  numberHealthFacilities: 0,
  healthFacilityType: 'None',
  qualifiedHealthWorkers: 0,
  hasTrainedStaff: false,
  hasMedicineSupply: false,
  hasMedicalSupplies: false,
  hasMaternalChildServices: false,
  commonHealthIssues: ['Cholera', 'Malaria'],
}

function healthBody(entityId: string, incidentId: string) {
  return {
    type: 'HEALTH',
    rapidAssessmentDate: new Date().toISOString(),
    assessorName: 'Cascade Probe Assessor',
    entityId,
    incidentId,
    healthData: DIRE_HEALTH_DATA,
  }
}

describe('P0 assessment create → queue → verify cascade', () => {
  let assessor: AuthedUser
  let coordinator: AuthedUser
  let entity: { id: string }
  let incidentId: string

  beforeAll(async () => {
    await truncateTestDb()
    assessor = (await createUser({ roles: ['ASSESSOR'] })) as AuthedUser
    coordinator = (await createUser({ roles: ['COORDINATOR'] })) as AuthedUser
    entity = await createEntity()
    incidentId = (await createIncident({ createdBy: coordinator.id })).id
    await createEntityAssignment({
      userId: assessor.id,
      entityId: entity.id,
      assignedBy: coordinator.id,
    })
  })

  afterAll(async () => {
    await truncateTestDb()
    await testDb.$disconnect()
  })

  test('ASSESSOR assigned to entity creates assessment → SUBMITTED + gap analysis computed', async () => {
    const response = await createRapidAssessment(
      makeRequest('POST', '/api/v1/rapid-assessments', {
        body: healthBody(entity.id, incidentId),
        token: tokenFor(assessor),
      })
    )
    expect(response.status).toBe(201)
    const body = await response.json()
    expect(body.data.id).toBeDefined()

    const stored = await testDb.rapidAssessment.findUnique({
      where: { id: body.data.id },
      include: { healthAssessment: true },
    })
    expect(stored).not.toBeNull()
    expect(stored!.verificationStatus).toBe('SUBMITTED')
    expect(stored!.verifiedAt).toBeNull()
    expect(stored!.healthAssessment).not.toBeNull()
    expect(stored!.healthAssessment!.commonHealthIssues).toContain('Cholera')

    // Gap analysis runs on create and derives priority from its severity
    expect(stored!.gapAnalysis).not.toBeNull()
    const gap = stored!.gapAnalysis as { severity?: string }
    expect(gap.severity).toBeDefined()
    expect(stored!.priority).toBe(gap.severity)
  })

  test('ASSESSOR NOT assigned to the entity → 403', async () => {
    const outsider = (await createUser({ roles: ['ASSESSOR'] })) as AuthedUser
    const response = await createRapidAssessment(
      makeRequest('POST', '/api/v1/rapid-assessments', {
        body: healthBody(entity.id, incidentId),
        token: tokenFor(outsider),
      })
    )
    expect(response.status).toBe(403)
  })

  test('auto-approve entity → AUTO_VERIFIED with verifiedAt on create', async () => {
    const autoEntity = await createEntity({ autoApproveEnabled: true })
    await createEntityAssignment({
      userId: assessor.id,
      entityId: autoEntity.id,
      assignedBy: coordinator.id,
    })
    const response = await createRapidAssessment(
      makeRequest('POST', '/api/v1/rapid-assessments', {
        body: healthBody(autoEntity.id, incidentId),
        token: tokenFor(assessor),
      })
    )
    expect(response.status).toBe(201)
    const stored = await testDb.rapidAssessment.findUnique({ where: { id: (await response.json()).data.id } })
    expect(stored!.verificationStatus).toBe('AUTO_VERIFIED')
    expect(stored!.verifiedAt).not.toBeNull()
  })

  test('verification queue lists the SUBMITTED assessment with queue depth', async () => {
    const submitted = await testDb.rapidAssessment.findFirst({
      where: { verificationStatus: 'SUBMITTED' },
    })
    expect(submitted).not.toBeNull()

    const response = await verificationQueue(
      makeRequest('GET', '/api/v1/verification/queue/assessments', { token: tokenFor(coordinator) })
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.success).toBe(true)
    expect(body.data.map((a: { id: string }) => a.id)).toContain(submitted!.id)
    expect(body.queueDepth.total).toBeGreaterThanOrEqual(1)
  })

  test('COORDINATOR verify → VERIFIED + audit log + removed from queue', async () => {
    const target = await testDb.rapidAssessment.findFirst({
      where: { verificationStatus: 'SUBMITTED' },
    })
    expect(target).not.toBeNull()

    const response = await verifyAssessmentRoute(
      makeRequest('POST', `/api/v1/assessments/${target!.id}/verify`, {
        body: { notes: 'Verified by cascade probe' },
        token: tokenFor(coordinator),
      })
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.success).toBe(true)
    expect(body.data.verificationStatus).toBe('VERIFIED')

    const stored = await testDb.rapidAssessment.findUnique({ where: { id: target!.id } })
    expect(stored!.verificationStatus).toBe('VERIFIED')
    expect(stored!.verifiedBy).toBe(coordinator.id)
    expect(stored!.verifiedAt).not.toBeNull()

    const audit = await testDb.auditLog.findFirst({
      where: { action: 'ASSESSMENT_VERIFIED', resourceId: target!.id },
    })
    expect(audit).not.toBeNull()
    expect(audit!.userId).toBe(coordinator.id)

    const queueResponse = await verificationQueue(
      makeRequest('GET', '/api/v1/verification/queue/assessments', { token: tokenFor(coordinator) })
    )
    const queueBody = await queueResponse.json()
    expect(queueBody.data.map((a: { id: string }) => a.id)).not.toContain(target!.id)
  })

  test('re-verifying a VERIFIED assessment → 400 (characterized)', async () => {
    const verified = await testDb.rapidAssessment.findFirst({
      where: { verificationStatus: 'VERIFIED' },
    })
    expect(verified).not.toBeNull()

    const response = await verifyAssessmentRoute(
      makeRequest('POST', `/api/v1/assessments/${verified!.id}/verify`, {
        body: {},
        token: tokenFor(coordinator),
      })
    )
    // Route maps every domain Error (incl. "Cannot verify… status: VERIFIED") to 400
    expect(response.status).toBe(400)
  })

  test('verifying an unknown id → 400 (characterized, not 404)', async () => {
    const response = await verifyAssessmentRoute(
      makeRequest('POST', '/api/v1/assessments/ghost-id/verify', {
        body: {},
        token: tokenFor(coordinator),
      })
    )
    expect(response.status).toBe(400)
  })
})
