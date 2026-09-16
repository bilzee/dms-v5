/**
 * DQR P5 evidence run — proves the offline-sync never-reject ingestion
 * contract through the real batch route + processing service:
 *
 *   1. POST /api/v1/sync/batch with a drifted offline payload (stale
 *      structureVersion, answered retired key, unknown key, MULTI_SELECT
 *      JSON-string replay): ACCEPTED — never 422/207 — every non-null answer
 *      persists VERBATIM (nothing discarded), warnings classify added /
 *      removed / unknown, the row records the CLIENT's structureVersion
 *      handshake, gaps derive from the INTERSECTION only (hasEmergencyServices
 *      false is the one real gap; the retired + unknown keys render as
 *      source-'unknown' informational rows, never scored), and the
 *      MULTI_SELECT string normalizes to an array.
 *   2. Replay of the same create: "Assessment already synced" success —
 *      idempotent, never a conflict, no duplicate row.
 *   3. SyncProcessingService.processBatch update (answers-carrying):
 *      delegates to the never-reject ingestion path — answers replaced,
 *      warnings recomputed, client version re-stamped.
 *   4. Zero online behavior change: the ONLINE /rapid-assessments POST
 *      strips the P5 payload fields (zod) and derives exactly as before.
 *
 * Run:  npx tsx scripts/dqr-p5-sync-evidence.ts
 * Log:  _bmad-output/implementation-artifacts/dqr-p5-sync-evidence.log
 *
 * Env bootstrap mirrors scripts/dqr-p4-form-evidence.ts: .env.test is parsed
 * manually and the script REFUSES to run unless DATABASE_URL targets
 * drms_test. Route handlers and services are dynamic-imported only after the
 * env is set so every PrismaClient binds to the test database.
 */

import { readFileSync } from 'fs'
import { resolve } from 'path'

function loadEnvTestFile(): void {
  const envPath = resolve(__dirname, '..', '.env.test')
  let raw: string
  try {
    raw = readFileSync(envPath, 'utf-8')
  } catch {
    return
  }
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"?([^"\r\n]*)"?\s*$/)
    if (match && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2]
    }
  }
}

loadEnvTestFile()

const databaseUrl = process.env.DATABASE_URL || ''
if (!databaseUrl.includes('drms_test')) {
  console.error(
    `REFUSING to run: DATABASE_URL must target drms_test (got: "${databaseUrl}").`
  )
  process.exit(1)
}

let failures = 0

function log(step: string, detail: Record<string, unknown>): void {
  console.log(`\n[${step}]`)
  for (const [key, value] of Object.entries(detail)) {
    console.log(`  ${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`)
  }
}

function check(step: string, condition: boolean, message: string): void {
  if (!condition) {
    failures += 1
    console.error(`  FAIL: ${message}`)
  }
}

async function main(): Promise<void> {
  // Imports after env bootstrap (PrismaClient binds to DATABASE_URL at import).
  const { PrismaClient } = await import('@prisma/client')
  const bcrypt = (await import('bcryptjs')).default
  const { NextRequest } = await import('next/server')
  const { AuthService } = await import('../src/lib/auth/service')
  const { seedQuestions } = await import('../prisma/seed-questions')
  const { POST: batchRoute } = await import('../src/app/api/v1/sync/batch/route')
  const { POST: onlineCreateRoute } = await import('../src/app/api/v1/rapid-assessments/route')
  const { SyncProcessingService } = await import('../src/lib/services/sync-processing.service')

  const db = new PrismaClient()
  const fixtureIds = {
    assessments: [] as string[],
    incidents: [] as string[],
    entities: [] as string[],
    users: [] as string[],
    questions: [] as string[],
  }

  try {
    const runId = Date.now().toString(36)
    console.log(`DQR P5 offline-sync evidence run ${runId}`)
    console.log(`DATABASE_URL: ${databaseUrl.replace(/:[^:@/]+@/, ':***@')}`)

    if ((await db.question.count()) === 0) {
      await seedQuestions(db)
      console.log('Seeded question registry (was empty).')
    }

    // Deterministic derivation: pin the two HEALTH GAP keys this run scores.
    await db.question.updateMany({
      where: { assessmentType: 'HEALTH', questionKey: { in: ['hasFunctionalClinic', 'hasEmergencyServices'] } },
      data: { severity: 'MEDIUM' },
    })

    // A retired question: registry row exists but is INACTIVE → answering it
    // classifies as `removed` while the answer itself is RETAINED verbatim.
    const healthSection = await db.questionSection.findFirstOrThrow({
      where: { assessmentType: 'HEALTH' },
    })
    const retiredQuestion = await db.question.create({
      data: {
        questionKey: 'legacyHealthQuestion',
        assessmentType: 'HEALTH',
        sectionId: healthSection.id,
        questionType: 'BOOLEAN',
        label: 'Retired health question',
        category: 'CONTEXT',
        order: 999,
        isActive: false,
      },
    })
    fixtureIds.questions.push(retiredQuestion.id)

    const role = await db.role.upsert({
      where: { name: 'ASSESSOR' },
      update: {},
      create: { name: 'ASSESSOR', description: 'ASSESSOR (p5 evidence)' },
    })
    const assessor = await db.user.create({
      data: {
        email: `p5-evidence-assessor-${runId}@dms.test`,
        username: `p5-evidence-assessor-${runId}`,
        passwordHash: await bcrypt.hash('EvidencePass123!', 10),
        name: `P5 Evidence Assessor ${runId}`,
        isActive: true,
        isLocked: false,
        roles: { create: [{ roleId: role.id, assignedBy: 'evidence-script' }] },
      },
      include: {
        roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
      },
    })
    fixtureIds.users.push(assessor.id)
    const token = AuthService.generateToken({
      userId: assessor.id,
      email: assessor.email,
      roles: ['ASSESSOR'],
      permissions: [],
    })

    const entity = await db.entity.create({
      data: {
        name: `P5 Evidence Entity ${runId}`,
        type: 'COMMUNITY',
        location: 'P5 Evidence Location',
        coordinates: { latitude: 11.8, longitude: 13.1 },
        autoApproveEnabled: false,
      },
    })
    fixtureIds.entities.push(entity.id)
    await db.entityAssignment.create({
      data: { userId: assessor.id, entityId: entity.id, assignedBy: 'evidence-script' },
    })
    const incident = await db.incident.create({
      data: {
        name: `P5 Evidence Incident ${runId}`,
        type: 'FLOOD',
        description: 'P5 evidence incident',
        location: 'P5 Evidence Location',
        severity: 'UNCLASSIFIED',
        status: 'ACTIVE',
        createdBy: assessor.id,
      },
    })
    fixtureIds.incidents.push(incident.id)

    function request(method: string, path: string, body: unknown): NextRequest {
      return new NextRequest(new URL(path, 'http://localhost:3000').toString(), {
        method,
        body: body === undefined ? undefined : JSON.stringify(body),
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      }) as NextRequest
    }

    const activeHealthKeys = (
      await db.question.findMany({
        where: { assessmentType: 'HEALTH', isActive: true },
        select: { questionKey: true, questionType: true },
        orderBy: [{ order: 'asc' }],
      })
    )
    const multiSelectKey =
      activeHealthKeys.find((q) => q.questionType === 'MULTI_SELECT')?.questionKey ?? null
    const activeKeyNames = activeHealthKeys.map((q) => q.questionKey)

    // The client's declared view predates the registry edits above.
    const clientView = ['hasFunctionalClinic', 'hasEmergencyServices', 'legacyHealthQuestion']

    const driftedPayload = {
      type: 'HEALTH',
      rapidAssessmentDate: new Date().toISOString(),
      assessorName: 'P5 Evidence Assessor',
      location: 'P5 Evidence Location',
      entityId: entity.id,
      incidentId: incident.id,
      questionKeys: clientView,
      structureVersion: 1, // deliberately stale — recorded as the client handshake
      answers: {
        hasFunctionalClinic: true, // known GAP key, resolved
        hasEmergencyServices: false, // known GAP key → the one REAL gap
        legacyHealthQuestion: 'captured before the question was retired', // removed + retained
        clientGapA: true, // the server cannot map this key at all (unknown)
        ...(multiSelectKey ? { [multiSelectKey]: '["Malaria","Measles"]' } : {}), // BH-6 replay
      },
    }

    // ---- 1. Offline batch create with full drift (never-reject) -----------
    const offlineId = `offline-evidence-${runId}`
    const batchChange = {
      type: 'assessment',
      action: 'create',
      data: { ...driftedPayload, id: offlineId },
      versionNumber: 1,
      entityUuid: entity.id,
      offlineId,
    }
    const createResponse = await batchRoute(
      request('POST', '/api/v1/sync/batch', { changes: [batchChange] }),
      {} as never
    )
    const createBody = await createResponse.json()
    const createResult = createBody?.data?.results?.[0] as
      | {
          status?: string
          message?: string
          warnings?: Array<{ key: string; type: string }>
        }
      | undefined
    fixtureIds.assessments.push(offlineId)
    const createdRow = await db.rapidAssessment.findUniqueOrThrow({ where: { id: offlineId } })
    const createdGap = (createdRow.gapAnalysis ?? {}) as {
      hasGap?: boolean
      gapFields?: string[]
      severity?: string
      rows?: Array<{ key: string; severity: string; source: string; unanswered: boolean }>
    }
    const createdAnswers = (createdRow.answers ?? {}) as Record<string, unknown>
    const snapshotVersions = (createdRow.questionSnapshot ?? {}) as {
      structureVersion?: number
      contentVersion?: number
    }
    const createdWarnings = createResult?.warnings ?? []
    const warningTypes = [...new Set(createdWarnings.map((w) => w.type))]
    log('1. POST /api/v1/sync/batch (drifted offline create)', {
      status: createResponse.status,
      httpContract: {
        summary: createBody?.data?.summary,
        result: { status: createResult?.status, message: createResult?.message },
      },
      row: {
        id: createdRow.id,
        priority: createdRow.priority,
        structureVersion: createdRow.structureVersion,
        snapshotVersions,
        isOfflineCreated: createdRow.isOfflineCreated,
        syncStatus: createdRow.syncStatus,
        verificationStatus: createdRow.verificationStatus,
        gapFields: createdGap.gapFields,
        severity: createdGap.severity,
        unknownRows: createdGap.rows?.filter((row) => row.source === 'unknown'),
        answersRetainedRemovedKey: createdAnswers.legacyHealthQuestion,
        answersRetainedUnknownKey: createdAnswers.clientGapA,
        multiSelectNormalized: multiSelectKey ? createdAnswers[multiSelectKey] : '(none)',
      },
      warnings: {
        types: warningTypes,
        removed: createdWarnings.filter((w) => w.type === 'removed').map((w) => w.key),
        unknown: createdWarnings.filter((w) => w.type === 'unknown').map((w) => w.key),
        addedCount: createdWarnings.filter((w) => w.type === 'added').length,
      },
    })
    check('1', createResponse.status === 200, `registry drift must NEVER reject (expected 200, got ${createResponse.status})`)
    check('1', createResult?.status === 'success', `results[0] must be success (got ${createResult?.status})`)
    check('1', createdRow.isOfflineCreated === true && createdRow.syncStatus === 'SYNCED', 'offline-created rows carry isOfflineCreated + SYNCED')
    check('1', createdRow.structureVersion === 1, `row records the CLIENT handshake structureVersion 1 (got ${createdRow.structureVersion})`)
    check('1', JSON.stringify(createdGap.gapFields) === JSON.stringify(['hasEmergencyServices']), `intersection gap only — gapFields must be exactly ['hasEmergencyServices'] (got ${JSON.stringify(createdGap.gapFields)})`)
    check('1', createdGap.hasGap === true && createdGap.severity === 'MEDIUM', 'the real gap scores MEDIUM')
    const unknownKeys = (createdGap.rows ?? []).filter((row) => row.source === 'unknown').map((row) => row.key).sort()
    check('1', JSON.stringify(unknownKeys) === JSON.stringify(['clientGapA', 'legacyHealthQuestion']), `retired + unknown keys render as informational source-'unknown' rows (got ${JSON.stringify(unknownKeys)})`)
    check('1', createdAnswers.legacyHealthQuestion === 'captured before the question was retired', 'REMOVED key answer retained verbatim (nothing discarded)')
    check('1', createdAnswers.clientGapA === true, 'UNKNOWN key answer retained verbatim (nothing discarded)')
    check('1', createdWarnings.some((w) => w.key === 'legacyHealthQuestion' && w.type === 'removed'), 'removed warning reported')
    check('1', createdWarnings.some((w) => w.key === 'clientGapA' && w.type === 'unknown'), 'unknown warning reported')
    const answeredActive = ['hasFunctionalClinic', 'hasEmergencyServices', multiSelectKey].filter(Boolean)
    const expectedAdded = activeKeyNames.filter((key) => !answeredActive.includes(key)).length
    check(
      '1',
      createdWarnings.filter((w) => w.type === 'added').length === expectedAdded,
      `added warnings cover the unanswered active keys (expected ${expectedAdded}, got ${createdWarnings.filter((w) => w.type === 'added').length})`
    )
    if (multiSelectKey) {
      check('1', JSON.stringify(createdAnswers[multiSelectKey]) === JSON.stringify(['Malaria', 'Measles']), 'MULTI_SELECT JSON-string replay normalizes to an array')
    }

    // ---- 2. Replay of the same create: idempotent, never a conflict -------
    const replayResponse = await batchRoute(
      request('POST', '/api/v1/sync/batch', { changes: [batchChange] }),
      {} as never
    )
    const replayBody = await replayResponse.json()
    const replayResult = replayBody?.data?.results?.[0] as
      | { status?: string; message?: string; warnings?: unknown[] }
      | undefined
    log('2. POST /api/v1/sync/batch (create replay)', {
      status: replayResponse.status,
      summary: replayBody?.data?.summary,
      result: { status: replayResult?.status, message: replayResult?.message, warnings: replayResult?.warnings ?? '(none)' },
      rowCount: await db.rapidAssessment.count({ where: { id: offlineId } }),
    })
    check('2', replayResponse.status === 200, `replay must be 200 (got ${replayResponse.status})`)
    check('2', replayResult?.status === 'success' && replayResult?.message === 'Assessment already synced', `replay is an idempotent success (got ${replayResult?.status}/${replayResult?.message})`)
    check('2', replayResult?.warnings === undefined, 'replay reports no fresh warnings')
    check('2', (await db.rapidAssessment.count({ where: { id: offlineId } })) === 1, 'replay must not duplicate the row')

    // ---- 3. Answers-carrying update through the processing service -------
    const updateResults = await SyncProcessingService.processBatch(
      [
        {
          type: 'assessment',
          action: 'update',
          data: {
            type: 'HEALTH',
            assessorName: 'P5 Evidence Assessor',
            entityId: entity.id,
            incidentId: incident.id,
            structureVersion: 2,
            answers: {
              hasFunctionalClinic: true,
              hasEmergencyServices: false,
              legacyHealthQuestion: 'still here on update',
              clientGapB: 7, // NEW unknown key replaces clientGapA
            },
          },
          versionNumber: 2,
          entityUuid: offlineId,
          offlineId,
        },
      ],
      assessor.id
    )
    const updatedRow = await db.rapidAssessment.findUniqueOrThrow({ where: { id: offlineId } })
    const updatedGap = (updatedRow.gapAnalysis ?? {}) as {
      gapFields?: string[]
      rows?: Array<{ key: string; source: string }>
    }
    const updatedAnswers = (updatedRow.answers ?? {}) as Record<string, unknown>
    const updateWarnings = (updateResults[0].warnings ?? []) as Array<{ key: string; type: string }>
    log('3. SyncProcessingService.processBatch (answers-carrying update)', {
      result: updateResults[0],
      row: {
        structureVersion: updatedRow.structureVersion,
        versionNumber: updatedRow.versionNumber,
        syncStatus: updatedRow.syncStatus,
        priority: `${createdRow.priority} → ${updatedRow.priority}`,
        gapFields: updatedGap.gapFields,
        unknownRows: updatedGap.rows?.filter((row) => row.source === 'unknown').map((row) => row.key),
        answersRetainedClientGapB: updatedAnswers.clientGapB,
        answersRetainedRemovedKey: updatedAnswers.legacyHealthQuestion,
        answersDroppedClientGapA: updatedAnswers.clientGapA === undefined,
      },
      warnings: {
        removed: updateWarnings.filter((w) => w.type === 'removed').map((w) => w.key),
        unknown: updateWarnings.filter((w) => w.type === 'unknown').map((w) => w.key),
      },
    })
    check('3', updateResults[0].status === 'success', `update must succeed (got ${updateResults[0].status})`)
    check('3', updatedAnswers.clientGapA === undefined && updatedAnswers.clientGapB === 7 && updatedAnswers.legacyHealthQuestion === 'still here on update', 'update answers are a full INGESTED replace — drift retained verbatim')
    check('3', JSON.stringify(updatedGap.gapFields) === JSON.stringify(['hasEmergencyServices']), `update re-derives the same intersection gap (got ${JSON.stringify(updatedGap.gapFields)})`)
    check('3', updatedRow.structureVersion === 2 && updatedRow.versionNumber === 2, 'client version re-stamped + versionNumber advanced')
    check('3', updateWarnings.some((w) => w.key === 'clientGapB' && w.type === 'unknown') && updateWarnings.some((w) => w.key === 'legacyHealthQuestion' && w.type === 'removed'), 'update warnings recomputed for the new answers')

    // ---- 4. Zero online behavior change ------------------------------------
    const onlineAnswers = {
      hasFunctionalClinic: true,
      hasEmergencyServices: false, // single MEDIUM gap — identical derivation
      numberHealthFacilities: 2,
      healthFacilityType: 'Clinic',
      qualifiedHealthWorkers: 5,
      hasTrainedStaff: true,
      hasMedicineSupply: true,
      hasMedicalSupplies: true,
      hasMaternalChildServices: true,
      commonHealthIssues: ['Malaria'],
    }
    const onlineResponse = await onlineCreateRoute(
      request('POST', '/api/v1/rapid-assessments', {
        type: 'HEALTH',
        rapidAssessmentDate: new Date().toISOString(),
        assessorName: 'P5 Evidence Assessor',
        entityId: entity.id,
        incidentId: incident.id,
        answers: onlineAnswers,
        questionKeys: Object.keys(onlineAnswers), // P5 fields in an ONLINE payload
        structureVersion: 99,
      }),
      {} as never
    )
    const onlineBody = await onlineResponse.json()
    if (onlineBody?.data?.id) fixtureIds.assessments.push(onlineBody.data.id)
    const onlineRow = onlineBody?.data?.id
      ? await db.rapidAssessment.findUniqueOrThrow({ where: { id: onlineBody.data.id } })
      : null
    log('4. POST /api/v1/rapid-assessments (online, P5 fields present)', {
      status: onlineResponse.status,
      row: onlineRow && {
        priority: onlineRow.priority,
        isOfflineCreated: onlineRow.isOfflineCreated,
        structureVersion: onlineRow.structureVersion,
        gapFields: ((onlineRow.gapAnalysis ?? {}) as { gapFields?: string[] }).gapFields,
      },
    })
    check('4', onlineResponse.status === 201, `online create must be unaffected (expected 201, got ${onlineResponse.status})`)
    check('4', onlineRow?.isOfflineCreated === false, 'online rows never carry offline flags (zod strips the P5 fields)')
    check('4', JSON.stringify(((onlineRow?.gapAnalysis ?? {}) as { gapFields?: string[] }).gapFields) === JSON.stringify(['hasEmergencyServices']), 'online derivation unchanged (single known MEDIUM gap)')
    check('4', onlineRow?.priority === 'MEDIUM', 'online priority derivation unchanged')

    console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
    process.exitCode = failures === 0 ? 0 : 1
  } finally {
    // Crash-safe best-effort cleanup (API suites truncate drms_test anyway).
    await db.actionSignal.deleteMany({ where: { entityId: { in: fixtureIds.entities } } }).catch(() => {})
    await db.rapidAssessment.deleteMany({ where: { id: { in: fixtureIds.assessments } } }).catch(() => {})
    await db.question.deleteMany({ where: { id: { in: fixtureIds.questions } } }).catch(() => {})
    await db.incident.deleteMany({ where: { id: { in: fixtureIds.incidents } } }).catch(() => {})
    await db.entity.deleteMany({ where: { id: { in: fixtureIds.entities } } }).catch(() => {})
    await db.user.deleteMany({ where: { id: { in: fixtureIds.users } } }).catch(() => {})
    await db.$disconnect()
  }
}

main().catch((error) => {
  console.error('Evidence run crashed:', error)
  process.exit(1)
})
