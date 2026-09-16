import { POST as syncBatch } from '@/app/api/v1/sync/batch/route'
import { POST as onlineCreate } from '@/app/api/v1/rapid-assessments/route'
import { SyncProcessingService } from '@/lib/services/sync-processing.service'
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
 * P5 — offline sync is NEVER-REJECT for registry drift, exercised through
 * the real batch route + processing service:
 *
 * - drifted creates are ACCEPTED: every non-null answer persists VERBATIM
 *   (removed/unknown keys included), warnings classify the drift
 *   (added = unanswered active keys, removed = answered inactive keys,
 *   unknown = answered keys with no registry row), and the row records the
 *   CLIENT's structureVersion handshake
 * - unknown/removed answered keys self-derive source-'unknown' gap rows —
 *   never in gapFields/severity (intersection only)
 * - MULTI_SELECT JSON-string replays normalize to arrays (BH-6)
 * - create replays are idempotent ("already synced", never a conflict)
 * - answers-carrying updates delegate to the never-reject ingestion path
 * - shape-level failures still fail: unassigned entity (route 403 / service
 *   failed → 207), foreign ownership on update
 */

describe('P5 offline sync ingestion (never-reject)', () => {
  let assessor: AuthedUser
  let entityId: string
  let incidentId: string
  let stableKey: string
  let multiSelectKey: string | null
  let activeWashKeys: string[]

  const removedKey = 'legacyRemovedKey'

  beforeAll(async () => {
    await truncateTestDb()
    await ensureQuestionRegistry()
    assessor = (await createUser({ roles: ['ASSESSOR'] })) as AuthedUser
    const entity = await createEntity()
    const incident = await createIncident({ createdBy: assessor.id })
    entityId = entity.id
    incidentId = incident.id
    await createEntityAssignment({ userId: assessor.id, entityId, assignedBy: assessor.id })

    const washQuestions = await testDb.question.findMany({
      where: { assessmentType: 'WASH', isActive: true },
      select: { questionKey: true, questionType: true },
      orderBy: [{ order: 'asc' }],
    })
    activeWashKeys = washQuestions.map((q) => q.questionKey)
    stableKey = activeWashKeys[0]
    multiSelectKey =
      washQuestions.find((q) => q.questionType === 'MULTI_SELECT')?.questionKey ?? null

    // A retired question: registry row exists but is INACTIVE → answering it
    // classifies as `removed` (and, being absent from the active-only
    // snapshot, self-derives a source-'unknown' gap row).
    const washSection = await testDb.questionSection.findFirstOrThrow({
      where: { assessmentType: 'WASH' },
    })
    await testDb.question.create({
      data: {
        questionKey: removedKey,
        assessmentType: 'WASH',
        sectionId: washSection.id,
        questionType: 'BOOLEAN',
        label: 'Retired question',
        category: 'CONTEXT',
        order: 999,
        isActive: false,
      },
    })
  })

  afterAll(async () => {
    await truncateTestDb()
    await testDb.$disconnect()
  })

  function driftedAnswers() {
    return {
      [stableKey]: 'stable answer',
      [removedKey]: 'retained verbatim',
      clientOnlyMysteryKey: true,
      ...(multiSelectKey ? { [multiSelectKey]: '["Borehole"]' } : {}),
    }
  }

  function driftedData(offlineId: string) {
    return {
      type: 'WASH',
      rapidAssessmentDate: new Date().toISOString(),
      assessorName: 'Field Officer',
      entityId,
      incidentId,
      location: 'Offline location',
      questionKeys: [stableKey, removedKey],
      structureVersion: 1, // deliberately stale — recorded as the client handshake
      answers: driftedAnswers(),
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

  test('drifted offline create is accepted: verbatim answers, warnings, client version handshake', async () => {
    const offlineId = `offline-drift-${Date.now()}`
    const response = await postBatch([
      {
        type: 'assessment',
        action: 'create',
        data: driftedData(offlineId),
        versionNumber: 1,
        entityUuid: entityId,
        offlineId,
      },
    ])
    expect(response.status).toBe(200)
    const body = await response.json()

    // Original response contract + per-item warnings.
    expect(body.data.summary).toEqual({ totalProcessed: 1, successful: 1, conflicts: 0, failed: 0 })
    const result = body.data.results[0]
    expect(result).toMatchObject({
      offlineId,
      serverId: offlineId,
      status: 'success',
      message: 'Assessment created from offline sync',
    })

    const warningTypes = (w: { type: string }) => w.type
    const warnings = result.warnings as Array<{ type: string; key: string }>
    expect(warnings.map(warningTypes)).toContain('removed')
    expect(warnings.find((w) => w.key === removedKey)).toMatchObject({ type: 'removed' })
    expect(warnings.find((w) => w.key === 'clientOnlyMysteryKey')).toMatchObject({ type: 'unknown' })
    // added = active registry keys the ANSWERS lack (documented proxy) — every
    // active key except the stable (+ multi-select) ones answered above.
    const answeredActive = multiSelectKey ? 2 : 1
    const added = warnings.filter((w) => w.type === 'added')
    expect(added).toHaveLength(activeWashKeys.length - answeredActive)

    const stored = await testDb.rapidAssessment.findUniqueOrThrow({ where: { id: offlineId } })
    expect(stored).toMatchObject({
      isOfflineCreated: true,
      syncStatus: 'SYNCED',
      verificationStatus: 'SUBMITTED',
      structureVersion: 1, // the CLIENT's handshake, not the current registry's
    })
    // Never-reject: removed + unknown answers are KEPT verbatim.
    const storedAnswers = stored.answers as Record<string, unknown>
    expect(storedAnswers[stableKey]).toBe('stable answer')
    expect(storedAnswers[removedKey]).toBe('retained verbatim')
    expect(storedAnswers.clientOnlyMysteryKey).toBe(true)
    if (multiSelectKey) {
      // MULTI_SELECT JSON-string replay normalizes to an array.
      expect(storedAnswers[multiSelectKey]).toEqual(['Borehole'])
    }

    // Unknown drift renders as informational rows — never scored.
    const gap = stored.gapAnalysis as {
      gapFields: string[]
      severity: string
      rows?: Array<{ key: string; source: string; unanswered: boolean }>
    }
    expect(gap.gapFields).toEqual([])
    expect(gap.severity).toBe('LOW')
    const unknownRows = (gap.rows ?? []).filter((row) => row.source === 'unknown')
    expect(unknownRows.map((row) => row.key).sort()).toEqual(['clientOnlyMysteryKey', removedKey].sort())
    expect(unknownRows.every((row) => !row.unanswered)).toBe(true)
    // Added questions are never injected.
    expect(storedAnswers).not.toHaveProperty(added[0].key)
  })

  test('create replay is idempotent: "already synced" success, never a conflict', async () => {
    const offlineId = `offline-replay-${Date.now()}`
    const change = {
      type: 'assessment',
      action: 'create',
      data: driftedData(offlineId),
      versionNumber: 1,
      entityUuid: entityId,
      offlineId,
    }
    await postBatch([change])
    const replay = await postBatch([change])
    expect(replay.status).toBe(200)
    const body = await replay.json()
    expect(body.data.summary).toEqual({ totalProcessed: 1, successful: 1, conflicts: 0, failed: 0 })
    expect(body.data.results[0]).toMatchObject({
      serverId: offlineId,
      status: 'success',
      message: 'Assessment already synced',
    })
    expect(body.data.results[0].warnings).toBeUndefined()
    expect(await testDb.rapidAssessment.count({ where: { id: offlineId } })).toBe(1)
  })

  test('route still 403s for unassigned entity uuids (shape gate, not drift)', async () => {
    const foreignEntity = await createEntity()
    const response = await postBatch([
      {
        type: 'assessment',
        action: 'create',
        data: { ...driftedData(`offline-403-${Date.now()}`), entityId: foreignEntity.id },
        versionNumber: 1,
        entityUuid: foreignEntity.id,
        offlineId: `offline-403-${Date.now()}`,
      },
    ])
    expect(response.status).toBe(403)
  })

  test('shape-level service failures surface as failed results (207 when all fail)', async () => {
    const foreignEntity = await createEntity()
    const response = await postBatch([
      {
        type: 'assessment',
        action: 'create',
        // entityUuid passes the route gate; data.entityId is unassigned →
        // createOfflineAssessment throws → failed result.
        data: { ...driftedData(`offline-207-${Date.now()}`), entityId: foreignEntity.id },
        versionNumber: 1,
        entityUuid: entityId,
        offlineId: `offline-207-${Date.now()}`,
      },
    ])
    expect(response.status).toBe(207)
    const body = await response.json()
    expect(body.data.summary).toEqual({ totalProcessed: 1, successful: 0, conflicts: 0, failed: 1 })
    expect(body.data.results[0].status).toBe('failed')
  })

  test('answers-carrying updates delegate to ingestion: replace, re-warn, re-stamp version', async () => {
    const offlineId = `offline-update-${Date.now()}`
    const createChange = {
      type: 'assessment',
      action: 'create',
      data: driftedData(offlineId),
      versionNumber: 1,
      entityUuid: entityId,
      offlineId,
    }
    await postBatch([createChange])

    // Update through the processing service (the route's entity gate keys on
    // entity uuids; assessment updates resolve the row by change.entityUuid).
    const results = await SyncProcessingService.processBatch(
      [
        {
          type: 'assessment',
          action: 'update',
          data: {
            type: 'WASH',
            assessorName: 'Field Officer',
            entityId,
            incidentId,
            structureVersion: 2,
            // P5 client-view declaration rides update payloads too — it must
            // be stripped before the Prisma update (runtime leak would throw).
            questionKeys: [stableKey, 'freshMysteryKey'],
            answers: { [stableKey]: 'updated answer', freshMysteryKey: 7 },
          },
          versionNumber: 2,
          entityUuid: offlineId,
          offlineId,
        },
      ],
      assessor.id
    )
    expect(results[0]).toMatchObject({
      serverId: offlineId,
      status: 'success',
      message: 'Assessment updated from offline sync',
    })
    const warnings = results[0].warnings as Array<{ type: string; key: string }>
    expect(warnings.find((w) => w.key === 'freshMysteryKey')).toMatchObject({ type: 'unknown' })
    expect(warnings.filter((w) => w.type === 'removed')).toEqual([]) // retired key no longer answered

    const stored = await testDb.rapidAssessment.findUniqueOrThrow({ where: { id: offlineId } })
    expect(stored.answers).toEqual({ [stableKey]: 'updated answer', freshMysteryKey: 7 })
    expect(stored.structureVersion).toBe(2) // client handshake re-stamped
    expect(stored.versionNumber).toBe(2)
    expect(stored.syncStatus).toBe('SYNCED')
    const gap = stored.gapAnalysis as { rows?: Array<{ key: string; source: string }> }
    expect(gap.rows?.find((row) => row.key === 'freshMysteryKey')).toMatchObject({ source: 'unknown' })
  })

  test('foreign assessors cannot update through the offline path (ownership guard)', async () => {
    const offlineId = `offline-owner-${Date.now()}`
    await postBatch([
      {
        type: 'assessment',
        action: 'create',
        data: driftedData(offlineId),
        versionNumber: 1,
        entityUuid: entityId,
        offlineId,
      },
    ])
    const other = (await createUser({ roles: ['ASSESSOR'] })) as AuthedUser
    const results = await SyncProcessingService.processBatch(
      [
        {
          type: 'assessment',
          action: 'update',
          data: { type: 'WASH', answers: { [stableKey]: 'hijack' } },
          versionNumber: 2,
          entityUuid: offlineId,
          offlineId,
        },
      ],
      other.id
    )
    expect(results[0].status).toBe('failed')
    expect(results[0].message).toMatch(/not authorized/i)
  })

  test('replay guard refuses foreign rows: a client-controlled offlineId never echoes another assessor\'s row', async () => {
    const offlineId = `offline-replay-guard-${Date.now()}`
    await postBatch([
      {
        type: 'assessment',
        action: 'create',
        data: driftedData(offlineId),
        versionNumber: 1,
        entityUuid: entityId,
        offlineId,
      },
    ])
    const other = (await createUser({ roles: ['ASSESSOR'] })) as AuthedUser
    const results = await SyncProcessingService.processBatch(
      [
        {
          type: 'assessment',
          action: 'create',
          data: driftedData(offlineId), // same row id — replay path
          versionNumber: 1,
          entityUuid: entityId,
          offlineId,
        },
      ],
      other.id
    )
    expect(results[0].status).toBe('failed')
    expect(results[0].message).toMatch(/not authorized/i)
    // The original row is untouched.
    const stored = await testDb.rapidAssessment.findUniqueOrThrow({ where: { id: offlineId } })
    expect(stored.assessorId).toBe(assessor.id)
  })

  test('offline creates on auto-approve entities mirror the online path: AUTO_VERIFIED + verifiedAt', async () => {
    const autoEntity = await createEntity({ autoApproveEnabled: true })
    await createEntityAssignment({ userId: assessor.id, entityId: autoEntity.id, assignedBy: assessor.id })
    const offlineId = `offline-auto-${Date.now()}`
    const response = await postBatch([
      {
        type: 'assessment',
        action: 'create',
        data: { ...driftedData(offlineId), entityId: autoEntity.id },
        versionNumber: 1,
        entityUuid: autoEntity.id,
        offlineId,
      },
    ])
    expect(response.status).toBe(200)
    const stored = await testDb.rapidAssessment.findUniqueOrThrow({ where: { id: offlineId } })
    expect(stored.verificationStatus).toBe('AUTO_VERIFIED')
    expect(stored.verifiedAt).not.toBeNull()
  })

  test('online create tolerates the form\'s P5 payload fields (zod strips, derivation unchanged)', async () => {
    // Build a fully valid HEALTH answers map from the live registry so the
    // strict online path accepts it, then attach the offline-shaped fields.
    const healthQuestions = await testDb.question.findMany({
      where: { assessmentType: 'HEALTH', isActive: true },
      select: { questionKey: true, questionType: true, options: true },
    })
    const answers: Record<string, unknown> = {}
    for (const question of healthQuestions) {
      const options = (question.options ?? []) as Array<{ value: string }>
      switch (question.questionType) {
        case 'BOOLEAN':
          answers[question.questionKey] = true
          break
        case 'NUMBER':
          answers[question.questionKey] = 1
          break
        case 'SINGLE_CHOICE':
          if (options[0]) answers[question.questionKey] = options[0].value
          break
        case 'MULTI_SELECT':
          if (options[0]) answers[question.questionKey] = [options[0].value]
          break
        case 'TEXT_LONG':
        case 'TEXT':
          answers[question.questionKey] = 'online'
          break
      }
    }
    const body = (structureVersion: number | null) => ({
      type: 'HEALTH',
      rapidAssessmentDate: new Date().toISOString(),
      assessorName: 'Field Officer',
      entityId,
      incidentId,
      location: 'Online location',
      answers,
      questionKeys: Object.keys(answers),
      structureVersion,
    })

    for (const structureVersion of [null, 99] as const) {
      const response = await onlineCreate(
        makeRequest('POST', '/api/v1/rapid-assessments', { body: body(structureVersion), token: tokenFor(assessor) })
      )
      expect(response.status).toBe(201)
      const created = await response.json()
      const stored = await testDb.rapidAssessment.findUniqueOrThrow({
        where: { id: created.data.id },
      })
      expect(stored.isOfflineCreated).toBe(false)
      // The P5 fields never reach derivation: the row stamps the CURRENT
      // registry version from its frozen snapshot — never the client's 99.
      expect(stored.structureVersion).not.toBe(99)
      const snapshot = stored.questionSnapshot as { structureVersion: number }
      expect(stored.structureVersion).toBe(snapshot.structureVersion)
    }
  })

  test('empty answers never reject: row created with {}, LOW derivation, no fabricated gaps', async () => {
    const offlineId = `offline-empty-${Date.now()}`
    const response = await postBatch([
      {
        type: 'assessment',
        action: 'create',
        data: {
          type: 'WASH',
          rapidAssessmentDate: new Date().toISOString(),
          assessorName: 'Field Officer',
          entityId,
          incidentId,
          location: 'Offline location',
          structureVersion: 4,
          answers: {}, // nothing answered — required questions are NOT re-enforced
          id: offlineId,
        },
        versionNumber: 1,
        entityUuid: entityId,
        offlineId,
      },
    ])
    expect(response.status).toBe(200)
    const body = await response.json()
    const result = body.data.results[0]
    expect(result.status).toBe('success')
    // Every active key reports as added (unanswered); nothing else is flagged.
    const warnings = result.warnings as Array<{ type: string; key: string }>
    expect(warnings).toHaveLength(activeWashKeys.length)
    expect(warnings.every((warning) => warning.type === 'added')).toBe(true)

    const stored = await testDb.rapidAssessment.findUniqueOrThrow({ where: { id: offlineId } })
    expect(stored.answers).toEqual({})
    expect(stored.structureVersion).toBe(4) // client handshake recorded
    const gap = stored.gapAnalysis as {
      gapFields: string[]
      severity: string
      rows?: Array<{ source: string; unanswered: boolean }>
    }
    expect(gap.gapFields).toEqual([]) // unanswered ≠ gap
    expect(gap.severity).toBe('LOW')
    expect((gap.rows ?? []).every((row) => row.source !== 'unknown')).toBe(true)
  })

  test('a clean offline submission (no drift) carries no warnings', async () => {
    const offlineId = `offline-clean-${Date.now()}`
    const answers = activeWashKeys.reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = true
      return acc
    }, {})
    const response = await postBatch([
      {
        type: 'assessment',
        action: 'create',
        data: {
          type: 'WASH',
          rapidAssessmentDate: new Date().toISOString(),
          assessorName: 'Field Officer',
          entityId,
          incidentId,
          questionKeys: activeWashKeys,
          structureVersion: 5,
          answers,
          id: offlineId,
        },
        versionNumber: 1,
        entityUuid: entityId,
        offlineId,
      },
    ])
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data.results[0].status).toBe('success')
    expect(body.data.results[0].warnings).toBeUndefined()

    const stored = await testDb.rapidAssessment.findUniqueOrThrow({ where: { id: offlineId } })
    expect(stored.structureVersion).toBe(5)
    const gap = stored.gapAnalysis as { rows?: Array<{ source: string }> }
    expect((gap.rows ?? []).every((row) => row.source !== 'unknown')).toBe(true)
  })
})
