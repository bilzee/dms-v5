import { POST as syncBatch } from '@/app/api/v1/sync/batch/route'
import { makeRequest, tokenFor, type AuthedUser } from '../helpers/api'
import {
  createUser,
  createEntity,
  createIncident,
  createEntityAssignment,
  ensureQuestionRegistry,
} from '../factories'
import { testDb, truncateTestDb } from '../helpers/test-db'

/**
 * P10-4 — offline sync hardening (4a/4b/4c/4d) through the real batch route:
 *
 * - 4a: unparseable MULTI_SELECT replays persist VERBATIM and are flagged in
 *   the stored gapAnalysis (`answerNormalizationFlags`); parseable replays
 *   normalize with NO flag key (additive — written only when non-empty)
 * - 4b: a create without incidentId is a per-entry CONFLICT + SyncConflict
 *   row (never a batch 4xx); no assessment row is written; a sibling valid
 *   create in the same batch still succeeds
 * - 4c: the producer-shaped update change (entityUuid = assessment ROW id,
 *   entityId in the payload) flows through the ROUTE into the update branch
 *   (assessment updates are exempt from the entity-uuid gate — the consumer
 *   owns their authorization)
 * - 4d: an offline update re-pointing entityId to an unassigned target is a
 *   per-entry CONFLICT (Re-point rejected) + SyncConflict row; row untouched
 */

describe('P10-4 offline sync hardening (4a/4b/4c/4d)', () => {
  let assessor: AuthedUser
  let entityId: string
  let unassignedEntityId: string
  let incidentId: string
  let stableKey: string
  let multiSelectKey: string

  beforeAll(async () => {
    await truncateTestDb()
    await ensureQuestionRegistry()
    assessor = (await createUser({ roles: ['ASSESSOR'] })) as AuthedUser
    const entity = await createEntity()
    const unassignedEntity = await createEntity()
    const incident = await createIncident({ createdBy: assessor.id })
    entityId = entity.id
    unassignedEntityId = unassignedEntity.id
    incidentId = incident.id
    // Assessor is assigned ONLY to `entityId` — re-points to
    // `unassignedEntityId` must be denied by the 4d authorizer.
    await createEntityAssignment({ userId: assessor.id, entityId, assignedBy: assessor.id })

    const washQuestions = await testDb.question.findMany({
      where: { assessmentType: 'WASH', isActive: true },
      select: { questionKey: true, questionType: true },
      orderBy: [{ order: 'asc' }],
    })
    stableKey = washQuestions[0].questionKey
    multiSelectKey =
      washQuestions.find((q) => q.questionType === 'MULTI_SELECT')?.questionKey ?? ''
    if (!multiSelectKey) {
      throw new Error('seed registry must expose an active WASH MULTI_SELECT question')
    }
  })

  afterAll(async () => {
    await truncateTestDb()
    await testDb.$disconnect()
  })

  function createData(offlineId: string, answers: Record<string, unknown>) {
    return {
      type: 'WASH',
      rapidAssessmentDate: new Date().toISOString(),
      assessorName: 'Field Officer',
      entityId,
      incidentId,
      location: 'Offline location',
      structureVersion: 1,
      answers,
      id: offlineId,
    }
  }

  async function postBatch(changes: unknown[], user: AuthedUser = assessor) {
    return syncBatch(
      makeRequest('POST', '/api/v1/sync/batch', {
        body: { changes },
        token: tokenFor(user),
      })
    )
  }

  test('4a: unparseable MULTI_SELECT replay stored verbatim + flagged; parseable replay normalizes unflagged', async () => {
    const flaggedId = `p104-flag-${Date.now()}`
    const raw = 'not json {'
    const response = await postBatch([
      {
        type: 'assessment',
        action: 'create',
        data: createData(flaggedId, { [stableKey]: true, [multiSelectKey]: raw }),
        versionNumber: 1,
        entityUuid: entityId,
        offlineId: flaggedId,
      },
    ])
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data.results[0].status).toBe('success')

    const flagged = await testDb.rapidAssessment.findUniqueOrThrow({ where: { id: flaggedId } })
    // Never-reject: the unparseable string persists verbatim.
    expect((flagged.answers as Record<string, unknown>)[multiSelectKey]).toBe(raw)
    const gap = flagged.gapAnalysis as {
      answerNormalizationFlags?: Array<{ key: string; message: string }>
    }
    expect(gap.answerNormalizationFlags).toEqual([
      { key: multiSelectKey, message: expect.stringContaining(multiSelectKey) },
    ])

    // The parseable replay normalizes and writes NO flag key (additive).
    const cleanId = `p104-clean-${Date.now()}`
    await postBatch([
      {
        type: 'assessment',
        action: 'create',
        data: createData(cleanId, { [stableKey]: true, [multiSelectKey]: '["Borehole"]' }),
        versionNumber: 1,
        entityUuid: entityId,
        offlineId: cleanId,
      },
    ])
    const clean = await testDb.rapidAssessment.findUniqueOrThrow({ where: { id: cleanId } })
    expect((clean.answers as Record<string, unknown>)[multiSelectKey]).toEqual(['Borehole'])
    expect(
      (clean.gapAnalysis as Record<string, unknown>).answerNormalizationFlags
    ).toBeUndefined()
  })

  test('4b: missing incidentId create → per-entry conflict + SyncConflict row, no row written; sibling create succeeds (never-reject)', async () => {
    const rejectedId = `p104-noincident-${Date.now()}`
    const validId = `p104-valid-${Date.now()}`
    const withoutIncident = createData(rejectedId, {
      [stableKey]: true,
    }) as Record<string, unknown>
    delete withoutIncident.incidentId
    expect('incidentId' in withoutIncident).toBe(false)

    const response = await postBatch([
      {
        type: 'assessment',
        action: 'create',
        data: withoutIncident,
        versionNumber: 1,
        entityUuid: entityId,
        offlineId: rejectedId,
      },
      {
        type: 'assessment',
        action: 'create',
        data: createData(validId, { [stableKey]: true }),
        versionNumber: 1,
        entityUuid: entityId,
        offlineId: validId,
      },
    ])
    // Never-reject: the batch stays 200/207 — the enforcement is per-entry.
    expect([200, 207]).toContain(response.status)
    const body = await response.json()
    expect(body.data.summary).toEqual({ totalProcessed: 2, successful: 1, conflicts: 1, failed: 0 })

    const rejected = body.data.results.find((r: { offlineId: string }) => r.offlineId === rejectedId)
    expect(rejected).toMatchObject({
      status: 'conflict',
      serverId: '',
    })
    expect(rejected.message).toMatch(/incidentId/i)

    // No assessment row was written for the rejected entry.
    expect(await testDb.rapidAssessment.count({ where: { id: rejectedId } })).toBe(0)
    // The per-entry conflict is recorded as a SyncConflict row for review.
    const conflictRow = await testDb.syncConflict.findFirstOrThrow({
      where: { entityType: 'assessment', entityId: rejectedId },
    })
    expect(conflictRow.winningVersion).toMatchObject({ rejected: 'missing-incidentId' })

    const valid = body.data.results.find((r: { offlineId: string }) => r.offlineId === validId)
    expect(valid).toMatchObject({ status: 'success', serverId: validId })
  })

  test('4c: producer-shaped update (entityUuid = row id) reaches the update branch through the route', async () => {
    const rowId = `p104-4c-${Date.now()}`
    await postBatch([
      {
        type: 'assessment',
        action: 'create',
        data: createData(rowId, { [stableKey]: 'first answer' }),
        versionNumber: 1,
        entityUuid: entityId,
        offlineId: rowId,
      },
    ])

    // Exactly what the offline producer enqueues since 4c: the ROW id in the
    // entityUuid slot, the entityId riding in the payload.
    const response = await postBatch([
      {
        type: 'assessment',
        action: 'update',
        data: {
          type: 'WASH',
          assessorName: 'Field Officer',
          entityId,
          incidentId,
          structureVersion: 2,
          answers: { [stableKey]: 'row-id update' },
        },
        versionNumber: 2,
        entityUuid: rowId,
        offlineId: rowId,
      },
    ])
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data.results[0]).toMatchObject({
      status: 'success',
      serverId: rowId,
      message: 'Assessment updated from offline sync',
    })

    const stored = await testDb.rapidAssessment.findUniqueOrThrow({ where: { id: rowId } })
    expect(stored.answers).toEqual({ [stableKey]: 'row-id update' })
    expect(stored.structureVersion).toBe(2)
    expect(stored.versionNumber).toBe(2)
    expect(stored.syncStatus).toBe('SYNCED')
  })

  test('4d: offline re-point to an unassigned entity → per-entry conflict, row untouched, SyncConflict recorded', async () => {
    const rowId = `p104-4d-${Date.now()}`
    await postBatch([
      {
        type: 'assessment',
        action: 'create',
        data: createData(rowId, { [stableKey]: 'original' }),
        versionNumber: 1,
        entityUuid: entityId,
        offlineId: rowId,
      },
    ])

    const response = await postBatch([
      {
        type: 'assessment',
        action: 'update',
        data: {
          type: 'WASH',
          entityId: unassignedEntityId,
          incidentId,
          structureVersion: 2,
          answers: { [stableKey]: 'hijack attempt' },
        },
        versionNumber: 2,
        entityUuid: rowId,
        offlineId: rowId,
      },
    ])
    // Never-reject: denial is a per-entry conflict, never a batch 4xx.
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data.results[0]).toMatchObject({ status: 'conflict', serverId: rowId })
    expect(body.data.results[0].message).toMatch(/Re-point rejected/i)

    // The row is untouched: original entity, original answers, version 1.
    const stored = await testDb.rapidAssessment.findUniqueOrThrow({ where: { id: rowId } })
    expect(stored.entityId).toBe(entityId)
    expect(stored.answers).toEqual({ [stableKey]: 'original' })
    expect(stored.versionNumber).toBe(1)

    const conflictRow = await testDb.syncConflict.findFirstOrThrow({
      where: { entityType: 'assessment', entityId: rowId },
    })
    expect(conflictRow.resolutionMethod).toBe('LAST_WRITE_WINS')
  })
})
