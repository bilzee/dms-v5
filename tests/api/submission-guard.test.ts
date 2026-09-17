import { POST as createAssessmentRoute } from '@/app/api/v1/rapid-assessments/route'
import { PUT as updateAssessmentRoute } from '@/app/api/v1/rapid-assessments/[id]/route'
import { POST as syncBatchRoute } from '@/app/api/v1/sync/batch/route'
import { SyncProcessingService } from '@/lib/services/sync-processing.service'
import { makeRequest, tokenFor, withParams, type AuthedUser } from '../helpers/api'
import {
  createUser,
  createEntity,
  createIncident,
  createRapidAssessment,
  createEntityAssignment,
  ensureQuestionRegistry,
} from '../factories'
import { testDb, truncateTestDb } from '../helpers/test-db'

/**
 * P9 hardening — ACTIVE-incident submission guard, pinned through the REAL
 * route handlers (and the real sync ingestion path) against drms_test:
 *
 *  1. POST /api/v1/rapid-assessments with an unknown incidentId → 404
 *     `Incident not found`, no row written
 *  2. POST with a non-ACTIVE (RESOLVED) incidentId → 409 `Incident {id} is
 *     not active`, no row written (CONTAINED pinned identically in 2b)
 *  2b. POST with a CONTAINED incidentId → 409 (every non-ACTIVE status)
 *  3. POST under an ACTIVE incident → 201 (guard is transparent)
 *  4. PUT /api/v1/rapid-assessments/{id} with an unknown incidentId → 404,
 *     row untouched
 *  5. PUT with a RESOLVED incidentId → 409, row untouched
 *  6. PUT omitting incidentId (stored incident ACTIVE) → 200
 *  6b. PUT re-sending the SAME stored incidentId after that incident becomes
 *     RESOLVED → 200 — the real edit UI always echoes the stored incidentId
 *     (DynamicAssessmentForm locks the selector); the guard is a re-pointing
 *     rule, so an answer edit after mid-flight resolution must still land
 *  7. Offline batch create carrying a RESOLVED incidentId → item SUCCESS
 *     (never-reject ruling: offline sync never rejects a completed
 *     assessment — an incident resolved mid-flight must not discard field
 *     work), row persisted under the resolved incident
 *  8. Offline batch create under an ACTIVE incident → item success
 *  9. Offline answers-carrying update after the stored incident becomes
 *     RESOLVED → item SUCCESS (never-reject), row updated
 * 10. Offline answers-carrying update omitting incidentId (stored ACTIVE) →
 *     item success
 *
 * The never-reject offline contract (Bil's prompt-9 decision 7 + plan §4
 * `/sync` row) is unconditional: the ACTIVE guard is an ONLINE create/update
 * rule only. Offline incident-state never rejects; a dangling incidentId
 * still fails at the FK as it always has.
 */

/** Full valid HEALTH answer set (one gap: hasFunctionalClinic = false). */
const HEALTH_ANSWERS = {
  hasFunctionalClinic: false,
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

function createPayload(overrides: Record<string, unknown> = {}) {
  return {
    type: 'HEALTH',
    rapidAssessmentDate: new Date().toISOString(),
    assessorName: 'P9 Guard Assessor',
    answers: HEALTH_ANSWERS,
    ...overrides,
  }
}

describe('P9 hardening — incident existence + ACTIVE submission guard', () => {
  let assessor: AuthedUser
  let entityId: string
  let activeIncidentId: string
  let resolvedIncidentId: string
  let containedIncidentId: string

  beforeAll(async () => {
    await truncateTestDb()
    await ensureQuestionRegistry()
    assessor = (await createUser({ roles: ['ASSESSOR'] })) as AuthedUser
    const entity = await createEntity()
    entityId = entity.id
    const activeIncident = await createIncident({ createdBy: assessor.id })
    const resolvedIncident = await createIncident({ createdBy: assessor.id, status: 'RESOLVED' })
    const containedIncident = await createIncident({ createdBy: assessor.id, status: 'CONTAINED' })
    activeIncidentId = activeIncident.id
    resolvedIncidentId = resolvedIncident.id
    containedIncidentId = containedIncident.id
    await createEntityAssignment({ userId: assessor.id, entityId, assignedBy: assessor.id })
  })

  afterAll(async () => {
    await truncateTestDb()
    await testDb.$disconnect()
  })

  test('online create with an unknown incidentId → 404, no row written', async () => {
    const before = await testDb.rapidAssessment.count()
    const response = await createAssessmentRoute(
      makeRequest('POST', '/api/v1/rapid-assessments', {
        body: createPayload({ entityId, incidentId: 'no-such-incident' }),
        token: tokenFor(assessor),
      })
    )
    expect(response.status).toBe(404)
    const body = (await response.json()) as { success?: boolean; error?: string }
    expect(body.success).toBe(false)
    expect(body.error).toBe('Incident not found')
    expect(await testDb.rapidAssessment.count()).toBe(before)
  })

  test('online create under a RESOLVED incident → 409, no row written', async () => {
    const before = await testDb.rapidAssessment.count()
    const response = await createAssessmentRoute(
      makeRequest('POST', '/api/v1/rapid-assessments', {
        body: createPayload({ entityId, incidentId: resolvedIncidentId }),
        token: tokenFor(assessor),
      })
    )
    expect(response.status).toBe(409)
    const body = (await response.json()) as { success?: boolean; error?: string }
    expect(body.success).toBe(false)
    expect(body.error).toBe(`Incident ${resolvedIncidentId} is not active`)
    expect(await testDb.rapidAssessment.count()).toBe(before)
  })

  test('online create under a CONTAINED incident → 409 (every non-ACTIVE status), no row written', async () => {
    const before = await testDb.rapidAssessment.count()
    const response = await createAssessmentRoute(
      makeRequest('POST', '/api/v1/rapid-assessments', {
        body: createPayload({ entityId, incidentId: containedIncidentId }),
        token: tokenFor(assessor),
      })
    )
    expect(response.status).toBe(409)
    const body = (await response.json()) as { success?: boolean; error?: string }
    expect(body.success).toBe(false)
    expect(body.error).toBe(`Incident ${containedIncidentId} is not active`)
    expect(await testDb.rapidAssessment.count()).toBe(before)
  })

  test('online create under an ACTIVE incident → 201 (guard is transparent)', async () => {
    const response = await createAssessmentRoute(
      makeRequest('POST', '/api/v1/rapid-assessments', {
        body: createPayload({ entityId, incidentId: activeIncidentId }),
        token: tokenFor(assessor),
      })
    )
    expect(response.status).toBe(201)
    const body = (await response.json()) as { data: { incidentId: string } }
    expect(body.data.incidentId).toBe(activeIncidentId)
  })

  let editableId: string

  test('fixture — own SUBMITTED assessment under the ACTIVE incident for the PUT rows', async () => {
    const row = await createRapidAssessment({
      assessorId: assessor.id,
      entityId,
      incidentId: activeIncidentId,
      answers: HEALTH_ANSWERS,
    })
    editableId = row.id
  })

  test('online update with an unknown incidentId → 404, row untouched', async () => {
    const before = await testDb.rapidAssessment.findUniqueOrThrow({ where: { id: editableId } })
    const response = await updateAssessmentRoute(
      makeRequest('PUT', `/api/v1/rapid-assessments/${editableId}`, {
        body: createPayload({ entityId, incidentId: 'no-such-incident' }),
        token: tokenFor(assessor),
      }),
      withParams({ id: editableId })
    )
    expect(response.status).toBe(404)
    const body = (await response.json()) as { error?: string }
    expect(body.error).toBe('Incident not found')
    const after = await testDb.rapidAssessment.findUniqueOrThrow({ where: { id: editableId } })
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime())
  })

  test('online update pointing at a RESOLVED incident → 409, row untouched', async () => {
    const before = await testDb.rapidAssessment.findUniqueOrThrow({ where: { id: editableId } })
    const response = await updateAssessmentRoute(
      makeRequest('PUT', `/api/v1/rapid-assessments/${editableId}`, {
        body: createPayload({ entityId, incidentId: resolvedIncidentId }),
        token: tokenFor(assessor),
      }),
      withParams({ id: editableId })
    )
    expect(response.status).toBe(409)
    const body = (await response.json()) as { success?: boolean; error?: string }
    expect(body.success).toBe(false)
    expect(body.error).toBe(`Incident ${resolvedIncidentId} is not active`)
    const after = await testDb.rapidAssessment.findUniqueOrThrow({ where: { id: editableId } })
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime())
  })

  test('online update omitting incidentId (stored incident ACTIVE) → 200', async () => {
    const { incidentId: _omitted, ...payload } = createPayload({ entityId })
    const response = await updateAssessmentRoute(
      makeRequest('PUT', `/api/v1/rapid-assessments/${editableId}`, {
        body: payload,
        token: tokenFor(assessor),
      }),
      withParams({ id: editableId })
    )
    expect(response.status).toBe(200)
    const body = (await response.json()) as { data: { incidentId: string } }
    expect(body.data.incidentId).toBe(activeIncidentId)
  })

  test('online update re-sending the SAME stored incidentId after that incident resolves → 200', async () => {
    // The real edit page PUTs the full form payload with the (locked)
    // stored incidentId — after mid-flight resolution that edit must land.
    await testDb.incident.update({
      where: { id: activeIncidentId },
      data: { status: 'RESOLVED' },
    })
    try {
      const response = await updateAssessmentRoute(
        makeRequest('PUT', `/api/v1/rapid-assessments/${editableId}`, {
          body: createPayload({
            entityId,
            incidentId: activeIncidentId,
            answers: { ...HEALTH_ANSWERS, hasFunctionalClinic: true },
          }),
          token: tokenFor(assessor),
        }),
        withParams({ id: editableId })
      )
      expect(response.status).toBe(200)
      const body = (await response.json()) as { data: { incidentId: string } }
      expect(body.data.incidentId).toBe(activeIncidentId)
      // The stored row keeps its incident and the persisted answers changed —
      // the draft update landed despite the resolved incident. (Draft edits do
      // not bump versionNumber; that counter moves on submit.)
      const after = await testDb.rapidAssessment.findUniqueOrThrow({ where: { id: editableId } })
      expect(after.incidentId).toBe(activeIncidentId)
      expect(after.answers).toMatchObject({ hasFunctionalClinic: true })
    } finally {
      await testDb.incident.update({
        where: { id: activeIncidentId },
        data: { status: 'ACTIVE' },
      })
    }
  })

  test('offline batch create carrying a RESOLVED incidentId → item success (never-reject), row persisted', async () => {
    const offlineId = `p9-offline-create-resolved-${Date.now()}`
    const response = await syncBatchRoute(
      makeRequest('POST', '/api/v1/sync/batch', {
        body: {
          changes: [
            {
              type: 'assessment',
              action: 'create',
              data: {
                type: 'HEALTH',
                rapidAssessmentDate: new Date().toISOString(),
                assessorName: 'P9 Offline Assessor',
                entityId,
                incidentId: resolvedIncidentId,
                answers: HEALTH_ANSWERS,
              },
              versionNumber: 1,
              entityUuid: entityId,
              offlineId,
            },
          ],
        },
        token: tokenFor(assessor),
      })
    )
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      data: { results: Array<{ status: string; serverId?: string }> }
    }
    expect(body.data.results[0].status).toBe('success')
    // The completed field assessment survives even though the incident was
    // resolved while the assessor was offline (never-reject ruling).
    const stored = await testDb.rapidAssessment.findUniqueOrThrow({ where: { id: offlineId } })
    expect(stored.incidentId).toBe(resolvedIncidentId)
  })

  test('offline batch create under an ACTIVE incident → item success', async () => {
    const offlineId = `p9-offline-create-active-${Date.now()}`
    const response = await syncBatchRoute(
      makeRequest('POST', '/api/v1/sync/batch', {
        body: {
          changes: [
            {
              type: 'assessment',
              action: 'create',
              data: {
                type: 'HEALTH',
                rapidAssessmentDate: new Date().toISOString(),
                assessorName: 'P9 Offline Assessor',
                entityId,
                incidentId: activeIncidentId,
                answers: HEALTH_ANSWERS,
              },
              versionNumber: 1,
              entityUuid: entityId,
              offlineId,
            },
          ],
        },
        token: tokenFor(assessor),
      })
    )
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      data: { results: Array<{ status: string; serverId?: string }> }
    }
    expect(body.data.results[0].status).toBe('success')
    const stored = await testDb.rapidAssessment.findUniqueOrThrow({ where: { id: offlineId } })
    expect(stored.incidentId).toBe(activeIncidentId)
  })

  test('offline answers-carrying update after the stored incident becomes RESOLVED → item success (never-reject)', async () => {
    const row = await createRapidAssessment({
      assessorId: assessor.id,
      entityId,
      incidentId: activeIncidentId,
      answers: HEALTH_ANSWERS,
    })
    // The incident is resolved AFTER the assessment was filed but BEFORE the
    // offline update syncs back — the update must still land (never-reject).
    await testDb.incident.update({
      where: { id: activeIncidentId },
      data: { status: 'RESOLVED' },
    })
    try {
      const results = await SyncProcessingService.processBatch(
        [
          {
            type: 'assessment',
            action: 'update',
            data: {
              type: 'HEALTH',
              assessorName: 'P9 Offline Assessor',
              entityId,
              answers: { ...HEALTH_ANSWERS, hasFunctionalClinic: true },
            },
            versionNumber: 2,
            entityUuid: row.id,
            offlineId: `p9-offline-update-resolved-${Date.now()}`,
          },
        ],
        assessor.id
      )
      expect(results[0].status).toBe('success')
      const after = await testDb.rapidAssessment.findUniqueOrThrow({ where: { id: row.id } })
      expect(after.incidentId).toBe(activeIncidentId)
      expect(after.versionNumber).toBe(2)
    } finally {
      // Restore ACTIVE for the tests that follow, even on failure.
      await testDb.incident.update({
        where: { id: activeIncidentId },
        data: { status: 'ACTIVE' },
      })
    }
  })

  test('offline answers-carrying update omitting incidentId (stored ACTIVE) → item success', async () => {
    const row = await createRapidAssessment({
      assessorId: assessor.id,
      entityId,
      incidentId: activeIncidentId,
      answers: HEALTH_ANSWERS,
    })
    const results = await SyncProcessingService.processBatch(
      [
        {
          type: 'assessment',
          action: 'update',
          data: {
            type: 'HEALTH',
            assessorName: 'P9 Offline Assessor',
            entityId,
            answers: { ...HEALTH_ANSWERS, hasFunctionalClinic: true },
          },
          versionNumber: 2,
          entityUuid: row.id,
          offlineId: `p9-offline-update-active-${Date.now()}`,
        },
      ],
      assessor.id
    )
    expect(results[0].status).toBe('success')
    const after = await testDb.rapidAssessment.findUniqueOrThrow({ where: { id: row.id } })
    expect(after.incidentId).toBe(activeIncidentId)
    expect(after.versionNumber).toBe(2)
  })
})
