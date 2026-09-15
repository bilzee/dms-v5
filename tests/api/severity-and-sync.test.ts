import { GET as syncPull } from '@/app/api/v1/sync/pull/route'
import { POST as syncBatch } from '@/app/api/v1/sync/batch/route'
import { incidentSeverityService } from '@/lib/services/incident-severity.service'
import { RapidAssessmentService } from '@/lib/services/rapid-assessment.service'
import { existsSync } from 'fs'
import { join } from 'path'
import { makeRequest, tokenFor, type AuthedUser } from '../helpers/api'
import {
  createUser,
  createEntity,
  createIncident,
  createRapidAssessment,
  createPreliminaryAssessment,
  createEntityAssignment,
} from '../factories'
import { testDb, truncateTestDb } from '../helpers/test-db'

/**
 * P0 — Bottom-up incident severity derivation + sync surface.
 *
 * Severity rule (incident-severity.service):
 *   max over latest VERIFIED|AUTO_VERIFIED rapid assessment per (entity, type);
 *   UNCLASSIFIED priorities are ignored; fallback = preliminary thresholds
 *   (within a tier the minimums are OR-ed: CRITICAL lives≥101|injured≥501|
 *   displaced≥5001, HIGH ≥11|≥51|≥501, MEDIUM ≥1|≥1|≥1); else UNCLASSIFIED.
 *
 * P3: the bulk `POST /admin/severity/recalculate` endpoint is deleted —
 * severity flows bottom-up from the registry, so the tests drive
 * `incidentSeverityService.recalculateIncidentSeverity(incidentId)` directly
 * (exactly what the assessment/registry mutation paths call today).
 */

describe('P0 incident severity pipeline', () => {
  let coordinator: AuthedUser

  beforeAll(async () => {
    await truncateTestDb()
    coordinator = (await createUser({ roles: ['COORDINATOR'] })) as AuthedUser
  })

  afterAll(async () => {
    await truncateTestDb()
    await testDb.$disconnect()
  })

  test('bulk severity-recalculate surfaces are gone (404 through the router)', async () => {
    // A missing App Router file IS the router-level 404: if either handler
    // file existed again, the endpoint would be live.
    const recalculateRoute = join(
      process.cwd(), 'src/app/api/v1/admin/severity/recalculate/route.ts'
    )
    const updatePrioritiesRoute = join(
      process.cwd(), 'src/app/api/v1/rapid-assessments/update-priorities/route.ts'
    )
    expect(existsSync(recalculateRoute)).toBe(false)
    expect(existsSync(updatePrioritiesRoute)).toBe(false)
    // Casts: the members were deleted, so a typed access would not compile
    // once tests join the type-check boundary.
    expect((incidentSeverityService as unknown as Record<string, unknown>).recalculateAll).toBeUndefined()
    expect(
      (RapidAssessmentService as unknown as Record<string, unknown>)
        .updateAllHistoricalAssessmentPriorities
    ).toBeUndefined()
  })

  test('max across verified assessments wins (CRITICAL beats LOW)', async () => {
    const assessor = (await createUser({ roles: ['ASSESSOR'] })) as AuthedUser
    const entityA = await createEntity()
    const entityB = await createEntity()
    const incident = await createIncident({ createdBy: coordinator.id })

    await createRapidAssessment({
      assessorId: assessor.id,
      entityId: entityA.id,
      incidentId: incident.id,
      assessmentType: 'HEALTH',
      verificationStatus: 'VERIFIED',
      priority: 'LOW',
    })
    await createRapidAssessment({
      assessorId: assessor.id,
      entityId: entityB.id,
      incidentId: incident.id,
      assessmentType: 'WASH',
      verificationStatus: 'VERIFIED',
      priority: 'CRITICAL',
    })

    await incidentSeverityService.recalculateIncidentSeverity(incident.id)

    const stored = await testDb.incident.findUnique({ where: { id: incident.id } })
    expect(stored!.severity).toBe('CRITICAL')
  })

  test('latest assessment per (entity, type) supersedes older severity', async () => {
    const assessor = (await createUser({ roles: ['ASSESSOR'] })) as AuthedUser
    const entity = await createEntity()
    const incident = await createIncident({ createdBy: coordinator.id })
    const now = new Date()

    await createRapidAssessment({
      assessorId: assessor.id,
      entityId: entity.id,
      incidentId: incident.id,
      assessmentType: 'HEALTH',
      verificationStatus: 'VERIFIED',
      priority: 'CRITICAL',
      rapidAssessmentDate: new Date(now.getTime() - 10 * 24 * 3600 * 1000),
    })
    await createRapidAssessment({
      assessorId: assessor.id,
      entityId: entity.id,
      incidentId: incident.id,
      assessmentType: 'HEALTH',
      verificationStatus: 'VERIFIED',
      priority: 'MEDIUM',
      rapidAssessmentDate: now,
    })

    await incidentSeverityService.recalculateIncidentSeverity(incident.id)

    const stored = await testDb.incident.findUnique({ where: { id: incident.id } })
    expect(stored!.severity).toBe('MEDIUM')
  })

  test('SUBMITTED (unverified) assessments never drive severity', async () => {
    const assessor = (await createUser({ roles: ['ASSESSOR'] })) as AuthedUser
    const entity = await createEntity()
    const incident = await createIncident({ createdBy: coordinator.id })

    await createRapidAssessment({
      assessorId: assessor.id,
      entityId: entity.id,
      incidentId: incident.id,
      assessmentType: 'FOOD',
      verificationStatus: 'SUBMITTED',
      priority: 'CRITICAL',
    })

    await incidentSeverityService.recalculateIncidentSeverity(incident.id)

    const stored = await testDb.incident.findUnique({ where: { id: incident.id } })
    expect(stored!.severity).toBe('UNCLASSIFIED')
  })

  test.each([
    [150, 0, 0, 'CRITICAL'],
    [20, 0, 0, 'HIGH'],
    [0, 600, 0, 'CRITICAL'],
    [0, 1, 0, 'MEDIUM'],
    [0, 0, 1, 'MEDIUM'],
    [0, 0, 0, 'UNCLASSIFIED'],
  ])(
    'preliminary thresholds: lives=%i injured=%i displaced=%i → %s',
    async (lives, injured, displaced, expected) => {
      const assessor = (await createUser({ roles: ['ASSESSOR'] })) as AuthedUser
      const incident = await createIncident({ createdBy: coordinator.id })
      await createPreliminaryAssessment({
        reportingAgent: assessor.id,
        incidentId: incident.id,
        numberLivesLost: lives,
        numberInjured: injured,
        numberDisplaced: displaced,
      })

      await incidentSeverityService.recalculateIncidentSeverity(incident.id)

      const stored = await testDb.incident.findUnique({ where: { id: incident.id } })
      expect(stored!.severity).toBe(expected)
    }
  )

  test('verified assessments outrank preliminary thresholds', async () => {
    const assessor = (await createUser({ roles: ['ASSESSOR'] })) as AuthedUser
    const entity = await createEntity()
    const incident = await createIncident({ createdBy: coordinator.id })

    await createPreliminaryAssessment({
      reportingAgent: assessor.id,
      incidentId: incident.id,
      numberLivesLost: 150, // would be CRITICAL via thresholds
    })
    await createRapidAssessment({
      assessorId: assessor.id,
      entityId: entity.id,
      incidentId: incident.id,
      assessmentType: 'SHELTER',
      verificationStatus: 'VERIFIED',
      priority: 'LOW',
    })

    await incidentSeverityService.recalculateIncidentSeverity(incident.id)

    const stored = await testDb.incident.findUnique({ where: { id: incident.id } })
    expect(stored!.severity).toBe('LOW')
  })
})

describe('P0 sync surface', () => {
  let responder: AuthedUser

  beforeAll(async () => {
    await truncateTestDb()
    responder = (await createUser({ roles: ['RESPONDER'] })) as AuthedUser
  })

  afterAll(async () => {
    await truncateTestDb()
    await testDb.$disconnect()
  })

  test('GET /sync/pull → 501 stub (characterized)', async () => {
    const response = await syncPull(
      makeRequest('GET', '/api/v1/sync/pull', { token: tokenFor(responder) })
    )
    expect(response.status).toBe(501)
  })

  test('POST /sync/batch rejects entities not assigned to the user → 403', async () => {
    const response = await syncBatch(
      makeRequest('POST', '/api/v1/sync/batch', {
        body: {
          changes: [
            {
              type: 'entity',
              action: 'update',
              data: { name: 'hijacked' },
              versionNumber: 1,
              entityUuid: 'entity-not-assigned-to-anyone',
            },
          ],
        },
        token: tokenFor(responder),
      })
    )
    expect(response.status).toBe(403)
    const body = await response.json()
    expect(body.details.unauthorizedEntities).toContain('entity-not-assigned-to-anyone')
  })

  test('POST /sync/batch validates the request shape → 400', async () => {
    const response = await syncBatch(
      makeRequest('POST', '/api/v1/sync/batch', {
        body: { changes: [] },
        token: tokenFor(responder),
      })
    )
    expect(response.status).toBe(400)
  })
})
