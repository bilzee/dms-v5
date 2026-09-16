import { POST as createRapidAssessment } from '@/app/api/v1/rapid-assessments/route'
import { PUT as updateAssessment } from '@/app/api/v1/rapid-assessments/[id]/route'
import { makeRequest, tokenFor, withParams, type AuthedUser } from '../helpers/api'
import {
  createUser,
  createEntity,
  createIncident,
  createEntityAssignment,
  ensureQuestionRegistry,
} from '../factories'
import { testDb, truncateTestDb } from '../helpers/test-db'

/**
 * P4 — REJECTED → resubmit edit flow at the exact PUT surface the
 * DynamicAssessmentForm submits through (VG-1). Ports the evidence script's
 * route-handler checks into a jest suite:
 *
 * - full-answer replace with unknown keys stripped
 * - snapshot re-freeze + priority re-derivation from the live registry
 * - rejection stamps cleared when verificationStatus: SUBMITTED rides along
 * - versionNumber preserved (p1–p3 service parity — update never touches it)
 * - registry validation 422s with per-field errors on the update path too
 * - legacy typed payloads (healthData, no answers) rejected with the shared
 *   errorResponse envelope
 */

const HEALTH_ANSWERS = {
  hasFunctionalClinic: true,
  hasEmergencyServices: false, // the single pinned GAP key under test
  numberHealthFacilities: 2,
  healthFacilityType: 'Clinic',
  qualifiedHealthWorkers: 5,
  hasTrainedStaff: true,
  hasMedicineSupply: true,
  hasMedicalSupplies: true,
  hasMaternalChildServices: true,
  commonHealthIssues: ['Malaria'],
}

function healthBody(entityId: string, incidentId: string) {
  return {
    type: 'HEALTH',
    rapidAssessmentDate: new Date().toISOString(),
    assessorName: 'Edit Probe Assessor',
    entityId,
    incidentId,
    answers: HEALTH_ANSWERS,
  }
}

describe('P4 assessment edit (REJECTED → resubmit PUT)', () => {
  let assessor: AuthedUser
  let entity: { id: string }
  let incidentId: string
  let assessmentId: string

  beforeAll(async () => {
    await truncateTestDb()
    await ensureQuestionRegistry()
    // Deterministic derivation: the only HEALTH GAP answered false here derives
    // MEDIUM from its seed severity.
    await testDb.question.updateMany({
      where: { assessmentType: 'HEALTH', questionKey: 'hasEmergencyServices' },
      data: { severity: 'MEDIUM' },
    })
    assessor = (await createUser({ roles: ['ASSESSOR'] })) as AuthedUser
    const coordinator = (await createUser({ roles: ['COORDINATOR'] })) as AuthedUser
    entity = await createEntity()
    incidentId = (await createIncident({ createdBy: coordinator.id })).id
    await createEntityAssignment({
      userId: assessor.id,
      entityId: entity.id,
      assignedBy: coordinator.id,
    })

    const response = await createRapidAssessment(
      makeRequest('POST', '/api/v1/rapid-assessments', {
        body: healthBody(entity.id, incidentId),
        token: tokenFor(assessor),
      })
    )
    expect(response.status).toBe(201)
    assessmentId = ((await response.json()) as { data: { id: string } }).data.id
  })

  afterAll(async () => {
    await truncateTestDb()
    await testDb.$disconnect()
  })

  test('created row is SUBMITTED at versionNumber 1 with the gap-derived MEDIUM priority', async () => {
    const stored = await testDb.rapidAssessment.findUniqueOrThrow({ where: { id: assessmentId } })
    expect(stored.verificationStatus).toBe('SUBMITTED')
    expect(stored.versionNumber).toBe(1)
    expect(stored.priority).toBe('MEDIUM')
  })

  test('owner resubmit after rejection: full replace, stamps cleared, priority re-derived, versionNumber preserved', async () => {
    await testDb.rapidAssessment.update({
      where: { id: assessmentId },
      data: {
        verificationStatus: 'REJECTED',
        rejectionReason: 'Please fix',
        rejectionFeedback: 'Correct the emergency services answer',
      },
    })

    const resubmittedAnswers = { ...HEALTH_ANSWERS, hasEmergencyServices: true } // gap resolved
    const response = await updateAssessment(
      makeRequest('PUT', `/api/v1/rapid-assessments/${assessmentId}`, {
        body: {
          type: 'HEALTH',
          rapidAssessmentDate: new Date().toISOString(),
          assessorName: 'Edit Probe Assessor',
          answers: { ...resubmittedAnswers, mysteryKey: 'strip-me' },
          verificationStatus: 'SUBMITTED',
        },
        token: tokenFor(assessor),
      }),
      withParams({ id: assessmentId })
    )
    expect(response.status).toBe(200)

    const stored = await testDb.rapidAssessment.findUniqueOrThrow({ where: { id: assessmentId } })
    expect(stored.verificationStatus).toBe('SUBMITTED')
    expect(stored.rejectionReason).toBeNull()
    expect(stored.rejectionFeedback).toBeNull()
    expect(stored.versionNumber).toBe(1) // p1–p3 parity: updates never bump it
    expect(stored.priority).toBe('LOW') // only gap resolved → re-derived LOW
    expect((stored.gapAnalysis as { hasGap?: boolean }).hasGap).toBe(false)

    const answers = (stored.answers ?? {}) as Record<string, unknown>
    expect(answers.hasEmergencyServices).toBe(true) // full replace, not a merge
    expect('mysteryKey' in answers).toBe(false) // unknown keys stripped

    // Snapshot re-frozen onto the row (registry-keyed, structure-only).
    expect(JSON.stringify(stored.questionSnapshot)).toContain('hasEmergencyServices')
  })

  test('update with a missing required answer → 422 with per-field errors', async () => {
    const { hasFunctionalClinic: _omit, ...incomplete } = HEALTH_ANSWERS
    const response = await updateAssessment(
      makeRequest('PUT', `/api/v1/rapid-assessments/${assessmentId}`, {
        body: {
          type: 'HEALTH',
          rapidAssessmentDate: new Date().toISOString(),
          assessorName: 'Edit Probe Assessor',
          answers: { ...incomplete, hasEmergencyServices: true },
        },
        token: tokenFor(assessor),
      }),
      withParams({ id: assessmentId })
    )
    expect(response.status).toBe(422)
    const body = (await response.json()) as {
      error?: string
      details?: { fieldErrors?: Record<string, string[]> }
    }
    expect(body.error).toBe('Answers failed registry validation')
    expect(Array.isArray(body.details?.fieldErrors?.hasFunctionalClinic)).toBe(true)
  })

  test('legacy typed payload (healthData, no answers) → 422 via the shared errorResponse envelope', async () => {
    const response = await updateAssessment(
      makeRequest('PUT', `/api/v1/rapid-assessments/${assessmentId}`, {
        body: {
          type: 'HEALTH',
          rapidAssessmentDate: new Date().toISOString(),
          assessorName: 'Edit Probe Assessor',
          healthData: HEALTH_ANSWERS,
        },
        token: tokenFor(assessor),
      }),
      withParams({ id: assessmentId })
    )
    expect(response.status).toBe(422)
    const body = (await response.json()) as { success?: boolean; error?: string }
    expect(body.error).toContain('Legacy typed payloads are no longer accepted')
    expect(body.error).toContain('healthData')
  })

  test('non-owner ASSESSOR → 403 (ownership precedes answers validation)', async () => {
    const stranger = (await createUser({ roles: ['ASSESSOR'] })) as AuthedUser
    const response = await updateAssessment(
      makeRequest('PUT', `/api/v1/rapid-assessments/${assessmentId}`, {
        body: {
          type: 'HEALTH',
          answers: { ...HEALTH_ANSWERS, hasEmergencyServices: true },
        },
        token: tokenFor(stranger),
      }),
      withParams({ id: assessmentId })
    )
    expect(response.status).toBe(403)
  })
})
