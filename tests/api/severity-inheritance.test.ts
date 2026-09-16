import { POST as createRapidAssessmentRoute } from '@/app/api/v1/rapid-assessments/route'
import { POST as verifyAssessmentRoute } from '@/app/api/v1/assessments/[id]/verify/route'
import { ActionSignalService } from '@/lib/services/action-signal.service'
import { SyncProcessingService } from '@/lib/services/sync-processing.service'
import { SYSTEM_HEALTH_SEVERITY } from '@/lib/severity-inheritance'
import { makeRequest, tokenFor, type AuthedUser } from '../helpers/api'
import {
  createUser,
  createEntity,
  createIncident,
  createRapidAssessment,
  createDonor,
  createDonorCommitment,
  createEntityAssignment,
  ensureQuestionRegistry,
} from '../factories'
import { testDb, truncateTestDb } from '../helpers/test-db'

/**
 * DQR P6 (D-4) — notification & signal severity inheritance, pinned
 * end-to-end against drms_test for every row of the spec's I/O matrix:
 *
 *  1. verified assessment fan-out → signal rows AND notification rows all
 *     store the assessment's derived priority (real create + verify routes)
 *  2. unplanned commitment under CRITICAL incident → awaiting-plan-for-
 *     commitment CRITICAL (was hardcoded HIGH)
 *  3. PARTIAL commitment under LOW incident → partially-fulfilled LOW
 *     (donor + responder rows)
 *  4. entity missing a responder under MEDIUM ACTIVE incident holding a
 *     submitted assessment → entity-needs-responder MEDIUM (incident.severity)
 *  5. population cadence breach → overdue CRITICAL via SYSTEM_HEALTH_SEVERITY
 *  6. verification queue: >48h old → verification-overdue CRITICAL via
 *     allowlist; ≤48h → assessment-awaiting-verification = assessment.priority
 *  7. offline response create carrying client priority CRITICAL linked to a
 *     LOW-priority assessment → created row LOW; offline update keeps it LOW
 *  8. commitment path under UNCLASSIFIED incident → MEDIUM via resolver
 *  9. defensive: trigger payload without priority fields → MEDIUM via resolver
 */

const SIGNAL_QUERY = {
  page: 1,
  limit: 100,
  unresolvedOnly: true,
  grouped: false,
} as const

/** Answers that produce exactly ONE gap: hasFunctionalClinic = false. */
const HEALTH_ONE_GAP_ANSWERS = {
  hasFunctionalClinic: false, // the single (pinned-HIGH) gap
  hasEmergencyServices: true,
  hasTrainedStaff: true,
  hasMedicineSupply: true,
  hasMedicalSupplies: true,
  hasMaternalChildServices: true,
  numberHealthFacilities: 2,
  healthFacilityType: 'Clinic',
  qualifiedHealthWorkers: 5,
  commonHealthIssues: ['Malaria'],
}

describe('DQR P6 — notification & signal severity inheritance', () => {
  let coordinator: AuthedUser
  let assessor: AuthedUser
  let responder: AuthedUser
  let donorUser: AuthedUser

  beforeAll(async () => {
    await truncateTestDb()
    await ensureQuestionRegistry()
    coordinator = (await createUser({ roles: ['COORDINATOR'] })) as AuthedUser
    assessor = (await createUser({ roles: ['ASSESSOR'] })) as AuthedUser
    responder = (await createUser({ roles: ['RESPONDER'] })) as AuthedUser
    donorUser = (await createUser({ roles: ['DONOR'] })) as AuthedUser
  })

  afterAll(async () => {
    await truncateTestDb()
    await testDb.$disconnect()
  })

  test('matrix 1 — verified HIGH assessment fans out HIGH signals AND HIGH notification rows', async () => {
    // Pin the registry so the single gap derives HIGH: every HEALTH question
    // LOW except hasFunctionalClinic HIGH.
    await testDb.question.updateMany({
      where: { assessmentType: 'HEALTH' },
      data: { severity: 'LOW' },
    })
    await testDb.question.updateMany({
      where: { assessmentType: 'HEALTH', questionKey: 'hasFunctionalClinic' },
      data: { severity: 'HIGH' },
    })

    const entity = await createEntity()
    const incident = await createIncident({ createdBy: coordinator.id, severity: 'MEDIUM' })
    await createEntityAssignment({ userId: assessor.id, entityId: entity.id, assignedBy: coordinator.id })
    await createEntityAssignment({ userId: responder.id, entityId: entity.id, assignedBy: coordinator.id })
    await createEntityAssignment({ userId: donorUser.id, entityId: entity.id, assignedBy: coordinator.id })

    const created = await createRapidAssessmentRoute(
      makeRequest('POST', '/api/v1/rapid-assessments', {
        body: {
          type: 'HEALTH',
          rapidAssessmentDate: new Date().toISOString(),
          assessorName: 'P6 Inheritance Assessor',
          entityId: entity.id,
          incidentId: incident.id,
          answers: HEALTH_ONE_GAP_ANSWERS,
        },
        token: tokenFor(assessor),
      })
    )
    expect(created.status).toBe(201)
    const assessmentId = (await created.json()).data.id as string

    // Derivation sanity: one HIGH gap → assessment priority HIGH.
    const storedAssessment = await testDb.rapidAssessment.findUniqueOrThrow({
      where: { id: assessmentId },
    })
    expect(storedAssessment.priority).toBe('HIGH')

    const verified = await verifyAssessmentRoute(
      makeRequest('POST', `/api/v1/assessments/${assessmentId}/verify`, {
        body: { notes: 'P6 severity inheritance probe' },
        token: tokenFor(coordinator),
      })
    )
    expect(verified.status).toBe(200)

    const awaitingPlan = await testDb.actionSignal.findFirst({
      where: {
        userId: responder.id,
        entityId: entity.id,
        incidentId: incident.id,
        signalReason: 'awaiting-plan',
      },
    })
    expect(awaitingPlan).not.toBeNull()
    expect(awaitingPlan!.priority).toBe('HIGH')

    const needsResponse = await testDb.actionSignal.findFirst({
      where: {
        userId: donorUser.id,
        entityId: entity.id,
        incidentId: incident.id,
        signalReason: 'assessment-needs-response',
      },
    })
    expect(needsResponse).not.toBeNull()
    expect(needsResponse!.priority).toBe('HIGH')

    // The in-app notification rows store the SIGNAL's own priority (D-4).
    const awaitingPlanNotification = await testDb.notification.findFirst({
      where: { signalId: awaitingPlan!.id },
    })
    expect(awaitingPlanNotification).not.toBeNull()
    expect(awaitingPlanNotification!.priority).toBe('HIGH')

    const needsResponseNotification = await testDb.notification.findFirst({
      where: { signalId: needsResponse!.id },
    })
    expect(needsResponseNotification).not.toBeNull()
    expect(needsResponseNotification!.priority).toBe('HIGH')
  })

  test('matrix 2 — unplanned commitment under CRITICAL incident → awaiting-plan-for-commitment CRITICAL', async () => {
    const entity = await createEntity()
    const incident = await createIncident({ createdBy: coordinator.id, severity: 'CRITICAL' })
    await createEntityAssignment({ userId: responder.id, entityId: entity.id, assignedBy: coordinator.id })
    const donor = await createDonor()
    const commitment = await createDonorCommitment({
      donorId: donor.id,
      entityId: entity.id,
      incidentId: incident.id,
      status: 'PLANNED', // no planCommitments → unplanned
    })

    await ActionSignalService.evaluateAndGenerate({
      trigger: 'commitment-created',
      entityId: entity.id,
      incidentId: incident.id,
      commitmentId: commitment.id,
    })

    const signal = await testDb.actionSignal.findFirst({
      where: {
        userId: responder.id,
        entityId: entity.id,
        incidentId: incident.id,
        signalReason: 'awaiting-plan-for-commitment',
      },
    })
    expect(signal).not.toBeNull()
    expect(signal!.priority).toBe('CRITICAL')
  })

  test('matrix 3 — PARTIAL commitment under LOW incident → partially-fulfilled LOW (donor + responder rows)', async () => {
    const entity = await createEntity()
    const incident = await createIncident({ createdBy: coordinator.id, severity: 'LOW' })
    await createEntityAssignment({ userId: responder.id, entityId: entity.id, assignedBy: coordinator.id })
    const donor = await createDonor()
    const commitment = await createDonorCommitment({
      donorId: donor.id,
      entityId: entity.id,
      incidentId: incident.id,
      status: 'PARTIAL',
    })

    // Mirrors the real API dispatch (donors/[id]/commitments route): the
    // signal engine consumes payload.donorId as the recipient USER id.
    await ActionSignalService.evaluateAndGenerate({
      trigger: 'commitment-updated',
      entityId: entity.id,
      incidentId: incident.id,
      commitmentId: commitment.id,
      donorId: donorUser.id,
    })

    const donorSignal = await testDb.actionSignal.findFirst({
      where: {
        userId: donorUser.id,
        entityId: entity.id,
        incidentId: incident.id,
        signalReason: 'partially-fulfilled',
      },
    })
    expect(donorSignal).not.toBeNull()
    expect(donorSignal!.priority).toBe('LOW')

    const responderSignal = await testDb.actionSignal.findFirst({
      where: {
        userId: responder.id,
        entityId: entity.id,
        incidentId: incident.id,
        signalReason: 'partially-fulfilled',
      },
    })
    expect(responderSignal).not.toBeNull()
    expect(responderSignal!.priority).toBe('LOW')
  })

  test('matrix 4 — entity missing a responder under HIGH ACTIVE incident → entity-needs-responder HIGH (incident.severity, not the MEDIUM floor)', async () => {
    const entity = await createEntity()
    const incident = await createIncident({ createdBy: coordinator.id, severity: 'HIGH' })
    // Only an ASSESSOR is assigned — no RESPONDER (and no DONOR) on purpose.
    await createEntityAssignment({ userId: assessor.id, entityId: entity.id, assignedBy: coordinator.id })
    await createRapidAssessment({
      assessorId: assessor.id,
      entityId: entity.id,
      incidentId: incident.id,
      verificationStatus: 'SUBMITTED',
    })

    await ActionSignalService.getActiveSignals(coordinator.id, ['COORDINATOR'], { ...SIGNAL_QUERY })

    const signal = await testDb.actionSignal.findFirst({
      where: {
        userId: coordinator.id,
        entityId: entity.id,
        incidentId: incident.id,
        signalReason: 'entity-needs-responder',
      },
    })
    expect(signal).not.toBeNull()
    expect(signal!.priority).toBe('HIGH')
  })

  test('matrix 5 — population cadence breach → overdue CRITICAL via SYSTEM_HEALTH_SEVERITY', async () => {
    expect(SYSTEM_HEALTH_SEVERITY.POPULATION_CADENCE).toBe('CRITICAL')

    const entity = await createEntity()
    const incident = await createIncident({ createdBy: coordinator.id })
    await createEntityAssignment({ userId: assessor.id, entityId: entity.id, assignedBy: coordinator.id })
    await testDb.entity.update({
      where: { id: entity.id },
      data: { metadata: { populationAssessmentCadenceHours: 24 } as never },
    })
    // No POPULATION assessment exists → baseline = incident creation; make the
    // incident older than the 24h cadence so the deadline has passed.
    await testDb.incident.update({
      where: { id: incident.id },
      data: { createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000) },
    })

    const createdCount = await ActionSignalService.evaluatePopulationCadence()
    expect(createdCount).toBeGreaterThanOrEqual(1)

    const signal = await testDb.actionSignal.findFirst({
      where: {
        userId: assessor.id,
        entityId: entity.id,
        incidentId: incident.id,
        type: 'POPULATION',
        signalReason: 'overdue',
      },
    })
    expect(signal).not.toBeNull()
    expect(signal!.priority).toBe('CRITICAL')
  })

  test('matrix 6 — verification queue: >48h → CRITICAL via allowlist; ≤48h → assessment.priority', async () => {
    expect(SYSTEM_HEALTH_SEVERITY.VERIFICATION_OVERDUE).toBe('CRITICAL')

    const entityOld = await createEntity()
    const entityFresh = await createEntity()
    const incident = await createIncident({ createdBy: coordinator.id })

    const staleAssessment = await createRapidAssessment({
      assessorId: assessor.id,
      entityId: entityOld.id,
      incidentId: incident.id,
      priority: 'LOW',
      verificationStatus: 'SUBMITTED',
    })
    // Backdate the submission beyond the 48h verification window.
    await testDb.rapidAssessment.update({
      where: { id: staleAssessment.id },
      data: { createdAt: new Date(Date.now() - 72 * 60 * 60 * 1000) },
    })

    const freshAssessment = await createRapidAssessment({
      assessorId: assessor.id,
      entityId: entityFresh.id,
      incidentId: incident.id,
      priority: 'HIGH',
      verificationStatus: 'SUBMITTED',
    })
    expect(freshAssessment.createdAt.getTime()).toBeGreaterThan(
      Date.now() - 48 * 60 * 60 * 1000
    )

    await ActionSignalService.getActiveSignals(coordinator.id, ['COORDINATOR'], { ...SIGNAL_QUERY })

    const overdue = await testDb.actionSignal.findFirst({
      where: {
        userId: coordinator.id,
        entityId: entityOld.id,
        incidentId: incident.id,
        signalReason: 'verification-overdue',
      },
    })
    expect(overdue).not.toBeNull()
    expect(overdue!.priority).toBe('CRITICAL')

    const awaiting = await testDb.actionSignal.findFirst({
      where: {
        userId: coordinator.id,
        entityId: entityFresh.id,
        incidentId: incident.id,
        signalReason: 'assessment-awaiting-verification',
      },
    })
    expect(awaiting).not.toBeNull()
    expect(awaiting!.priority).toBe('HIGH')
  })

  test('matrix 7 — offline response create ignores client CRITICAL, derives linked assessment LOW; update keeps it', async () => {
    const entity = await createEntity()
    const incident = await createIncident({ createdBy: coordinator.id })
    await createEntityAssignment({ userId: responder.id, entityId: entity.id, assignedBy: coordinator.id })
    const assessment = await createRapidAssessment({
      assessorId: assessor.id,
      entityId: entity.id,
      incidentId: incident.id,
      priority: 'LOW',
      verificationStatus: 'VERIFIED',
    })

    const offlineId = `p6-offline-response-${Date.now()}`
    const createResults = await SyncProcessingService.processBatch(
      [
        {
          type: 'response',
          action: 'create',
          data: {
            assessmentId: assessment.id,
            type: 'HEALTH',
            priority: 'CRITICAL', // client injection attempt — must be ignored
            deliveryStatus: 'PLANNED',
            description: 'P6 offline response (client says CRITICAL)',
            items: [{ name: 'Test Kits', quantity: 10, unit: 'boxes' }],
          },
          versionNumber: 1,
          entityUuid: entity.id,
          offlineId,
        },
      ],
      responder.id
    )
    expect(createResults[0].status).toBe('success')

    const createdRow = await testDb.rapidResponse.findUniqueOrThrow({
      where: { offlineId },
    })
    expect(createdRow.priority).toBe('LOW')

    // Offline update: client again claims CRITICAL — the row keeps its own.
    const updateResults = await SyncProcessingService.processBatch(
      [
        {
          type: 'response',
          action: 'update',
          data: {
            priority: 'CRITICAL',
            description: 'P6 offline response update (client says CRITICAL)',
          },
          versionNumber: 2,
          entityUuid: entity.id,
          offlineId,
        },
      ],
      responder.id
    )
    expect(updateResults[0].status).toBe('success')

    const updatedRow = await testDb.rapidResponse.findUniqueOrThrow({
      where: { offlineId },
    })
    expect(updatedRow.priority).toBe('LOW')
  })

  test('matrix 8 — commitment under UNCLASSIFIED incident → MEDIUM via resolver', async () => {
    const entity = await createEntity()
    const incident = await createIncident({ createdBy: coordinator.id, severity: 'UNCLASSIFIED' })
    await createEntityAssignment({ userId: responder.id, entityId: entity.id, assignedBy: coordinator.id })
    const donor = await createDonor()
    const commitment = await createDonorCommitment({
      donorId: donor.id,
      entityId: entity.id,
      incidentId: incident.id,
      status: 'PLANNED',
    })

    await ActionSignalService.evaluateAndGenerate({
      trigger: 'commitment-created',
      entityId: entity.id,
      incidentId: incident.id,
      commitmentId: commitment.id,
    })

    const signal = await testDb.actionSignal.findFirst({
      where: {
        userId: responder.id,
        entityId: entity.id,
        incidentId: incident.id,
        signalReason: 'awaiting-plan-for-commitment',
      },
    })
    expect(signal).not.toBeNull()
    expect(signal!.priority).toBe('MEDIUM')
  })

  test('matrix 9 — defensive: trigger payload without priority fields → MEDIUM via resolver', async () => {
    const entity = await createEntity()
    const incident = await createIncident({ createdBy: coordinator.id, severity: 'CRITICAL' })
    await createEntityAssignment({ userId: responder.id, entityId: entity.id, assignedBy: coordinator.id })
    const assessment = await createRapidAssessment({
      assessorId: assessor.id,
      entityId: entity.id,
      incidentId: incident.id,
      verificationStatus: 'VERIFIED',
    })

    // No assessmentPriority on the payload (defensive row): the resolver's
    // MEDIUM floor applies — never the incident's CRITICAL, never a cast.
    await ActionSignalService.evaluateAndGenerate({
      trigger: 'assessment-verified',
      entityId: entity.id,
      incidentId: incident.id,
      assessmentId: assessment.id,
      assessmentType: assessment.rapidAssessmentType,
    })

    const signal = await testDb.actionSignal.findFirst({
      where: {
        userId: responder.id,
        entityId: entity.id,
        incidentId: incident.id,
        signalReason: 'awaiting-plan',
      },
    })
    expect(signal).not.toBeNull()
    expect(signal!.priority).toBe('MEDIUM')
  })

  test('review — escalation refreshes notification rows: signal re-derived CRITICAL updates its existing notification', async () => {
    const entity = await createEntity()
    const incident = await createIncident({ createdBy: coordinator.id, severity: 'MEDIUM' })
    await createEntityAssignment({ userId: responder.id, entityId: entity.id, assignedBy: coordinator.id })

    const payloadBase = {
      trigger: 'assessment-verified' as const,
      entityId: entity.id,
      incidentId: incident.id,
      assessmentType: 'HEALTH',
    }

    await ActionSignalService.evaluateAndGenerate({ ...payloadBase, assessmentPriority: 'MEDIUM' })
    const signal = await testDb.actionSignal.findFirst({
      where: {
        userId: responder.id,
        entityId: entity.id,
        incidentId: incident.id,
        signalReason: 'awaiting-plan',
      },
    })
    expect(signal).not.toBeNull()
    const notification = await testDb.notification.findFirstOrThrow({ where: { signalId: signal!.id } })
    expect(notification.priority).toBe('MEDIUM')

    // Re-derivation escalates the same unresolved signal — its notification row must follow.
    await ActionSignalService.evaluateAndGenerate({ ...payloadBase, assessmentPriority: 'CRITICAL' })
    const escalated = await testDb.actionSignal.findUniqueOrThrow({ where: { id: signal!.id } })
    expect(escalated.priority).toBe('CRITICAL')
    const refreshed = await testDb.notification.findFirstOrThrow({ where: { signalId: signal!.id } })
    expect(refreshed.priority).toBe('CRITICAL')
  })

  test('review — offline response create WITHOUT assessmentId derives the entity latest assessment priority (fallback path)', async () => {
    const entity = await createEntity()
    const incident = await createIncident({ createdBy: coordinator.id })
    await createEntityAssignment({ userId: responder.id, entityId: entity.id, assignedBy: coordinator.id })
    await createRapidAssessment({
      assessorId: assessor.id,
      entityId: entity.id,
      incidentId: incident.id,
      priority: 'CRITICAL',
      verificationStatus: 'VERIFIED',
    })

    const offlineId = `p6-fallback-response-${Date.now()}`
    const results = await SyncProcessingService.processBatch(
      [
        {
          type: 'response',
          action: 'create',
          data: {
            // No assessmentId — the entity-fallback resolution must find the
            // CRITICAL assessment and derive from it, not the MEDIUM floor.
            type: 'HEALTH',
            priority: 'LOW', // client injection attempt — must be ignored
            deliveryStatus: 'PLANNED',
            description: 'P6 fallback-path offline response',
            items: [{ name: 'Blankets', quantity: 20, unit: 'pieces' }],
          },
          versionNumber: 1,
          entityUuid: entity.id,
          offlineId,
        },
      ],
      responder.id
    )
    expect(results[0].status).toBe('success')

    const createdRow = await testDb.rapidResponse.findUniqueOrThrow({
      where: { offlineId },
    })
    expect(createdRow.priority).toBe('CRITICAL')
    expect(createdRow.assessmentId).not.toBe('')
  })
})
