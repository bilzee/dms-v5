/**
 * DQR P3 evidence run — proves the severity-edit recompute contract:
 *
 *   Given an assessment under an ACTIVE incident whose frozen snapshot
 *   contains key K, when K's severity is PATCHed, then that assessment's
 *   `priority` and `gapAnalysis` update in the same transaction (snapshot and
 *   version stamps untouched), affectedCount is returned, the incident is
 *   re-derived after commit, a no-op severity PATCH recomputes nothing, and
 *   the deleted bulk-recalculate surfaces are gone (404 through the router).
 *
 * Run:  npx tsx scripts/dqr-p3-recompute-evidence.ts
 * Log:  _bmad-output/implementation-artifacts/dqr-p3-recompute-evidence.log
 *
 * Env bootstrap mirrors tests/setup-api.ts: .env.test is parsed manually
 * (no dotenv dependency) and the script REFUSES to run unless DATABASE_URL
 * targets drms_test. Route handlers and services are dynamic-imported only
 * after the env is set so every PrismaClient binds to the test database.
 */

import { readFileSync, existsSync } from 'fs'
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

/** Deterministic key order — stored jsonb re-orders keys, so byte comparisons
 * between derived and DB-round-tripped objects must be canonical. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`
  }
  return value === undefined ? 'null' : JSON.stringify(value)
}

async function main(): Promise<void> {
  // Imports after env bootstrap (PrismaClient binds to DATABASE_URL at import).
  const { PrismaClient } = await import('@prisma/client')
  const bcrypt = (await import('bcryptjs')).default
  const { NextRequest } = await import('next/server')
  const { AuthService } = await import('../src/lib/auth/service')
  const { getRegistryVersions } = await import('../src/lib/questions/registry-versions')
  const { seedQuestions } = await import('../prisma/seed-questions')
  const { buildQuestionSnapshot } = await import('../src/lib/questions/question-snapshot')
  const { analyzeGaps: engineAnalyzeGaps } = await import('../src/lib/questions/gap-engine')
  const { analyzeGapsFromSnapshot } = await import('../src/lib/services/gap-analysis.service')
  const { RapidAssessmentService } = await import('../src/lib/services/rapid-assessment.service')
  const { incidentSeverityService } = await import('../src/lib/services/incident-severity.service')
  const { PATCH: patchSeverityRoute } = await import('../src/app/api/v1/admin/questions/[id]/severity/route')

  const db = new PrismaClient()
  // Crash-safe fixture tracking: ids are pushed as they are created and the
  // finally-block cleanup always runs, so a mid-run crash cannot orphan rows.
  const fixtureIds = {
    assessments: [] as string[],
    incidents: [] as string[],
    entities: [] as string[],
    users: [] as string[],
  }

  try {
    const runId = Date.now().toString(36)
    console.log(`DQR P3 recompute evidence run ${runId}`)
    console.log(`DATABASE_URL: ${databaseUrl.replace(/:[^:@/]+@/, ':***@')}`)

    // Ensure the registry exists (idempotent, mirrors the test factories).
    if ((await db.question.count()) === 0) {
      await seedQuestions(db)
      console.log('Seeded question registry (was empty).')
    }

    async function userWithRoles(roleNames: string[]): Promise<{ token: string; id: string }> {
      const roles: { id: string }[] = []
      for (const name of roleNames) {
        roles.push(await db.role.upsert({ where: { name }, update: {}, create: { name, description: `${name} (evidence)` } }))
      }
      const user = await db.user.create({
        data: {
          email: `p3-evidence-${roleNames[0].toLowerCase()}-${runId}@dms.test`,
          username: `p3-evidence-${roleNames[0].toLowerCase()}-${runId}`,
          passwordHash: await bcrypt.hash('EvidencePass123!', 10),
          name: `P3 Evidence ${roleNames.join('/')} ${runId}`,
          isActive: true,
          isLocked: false,
          roles: { create: roles.map((role) => ({ roleId: role.id, assignedBy: 'evidence-script' })) },
        },
        include: { roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } },
      })
      const token = AuthService.generateToken({
        userId: user.id,
        email: user.email,
        roles: user.roles.map((ur) => ur.role.name),
        permissions: Array.from(new Set(user.roles.flatMap((ur) => ur.role.permissions.map((p) => p.permission.code)))),
      })
      return { token, id: user.id }
    }

    const coordinator = await userWithRoles(['COORDINATOR'])
    const assessor = await userWithRoles(['ASSESSOR'])
    fixtureIds.users.push(coordinator.id, assessor.id)

    function request(method: string, path: string, body: unknown, token: string): NextRequest {
      return new NextRequest(new URL(path, 'http://localhost:3000').toString(), {
        method,
        body: body === undefined ? undefined : JSON.stringify(body),
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      }) as NextRequest
    }

    // Fixtures: snapshot stamped from the live registry exactly as the service
    // path freezes it; answers are the canonical registry-keyed map.
    const healthAnswers: Record<string, unknown> = {
      hasFunctionalClinic: true,
      hasEmergencyServices: false, // GAP key under test (seeded MEDIUM)
      numberHealthFacilities: 2,
      healthFacilityType: 'Primary Health Center',
      qualifiedHealthWorkers: 5,
      hasTrainedStaff: true,
      hasMedicineSupply: false, // second, unrelated MEDIUM gap
      hasMedicalSupplies: true,
      hasMaternalChildServices: true,
    }

    async function healthSnapshotRows() {
      return db.question.findMany({
        where: { assessmentType: 'HEALTH', isActive: true },
        orderBy: [{ section: { order: 'asc' } }, { order: 'asc' }],
        include: {
          section: {
            select: { sectionKey: true, title: true, description: true, category: true, order: true },
          },
        },
      })
    }

    const gapQuestion = await db.question.findFirst({
      where: { assessmentType: 'HEALTH', questionKey: 'hasEmergencyServices', category: 'GAP' },
    })
    if (!gapQuestion) throw new Error('HEALTH GAP question hasEmergencyServices missing — registry not seeded?')

    // Baseline hygiene: drms_test may carry severities/version counters from
    // earlier suite runs — pin the two HEALTH GAP keys this run derives from
    // back to MEDIUM so every expectation below is deterministic.
    await db.question.updateMany({
      where: { assessmentType: 'HEALTH', questionKey: { in: ['hasEmergencyServices', 'hasMedicineSupply'] } },
      data: { severity: 'MEDIUM' },
    })

    const entity = await db.entity.create({
      data: {
        name: `P3 Evidence Entity ${runId}`,
        type: 'COMMUNITY',
        location: 'P3 Evidence Location',
        coordinates: { latitude: 11.8, longitude: 13.1 },
        autoApproveEnabled: false,
      },
    })
    fixtureIds.entities.push(entity.id)
    const activeIncident = await db.incident.create({
      data: {
        name: `P3 Evidence Active Incident ${runId}`,
        type: 'FLOOD',
        description: 'P3 evidence active incident',
        location: 'P3 Evidence Location',
        severity: 'UNCLASSIFIED',
        status: 'ACTIVE',
        createdBy: coordinator.id,
      },
    })
    fixtureIds.incidents.push(activeIncident.id)
    const resolvedIncident = await db.incident.create({
      data: {
        name: `P3 Evidence Resolved Incident ${runId}`,
        type: 'FLOOD',
        description: 'P3 evidence resolved incident',
        location: 'P3 Evidence Location',
        severity: 'UNCLASSIFIED',
        status: 'RESOLVED',
        createdBy: coordinator.id,
      },
    })

    fixtureIds.incidents.push(resolvedIncident.id)

    const versions = await getRegistryVersions(db, 'HEALTH')
    const registryRows = (await db.question.findMany({
      where: { assessmentType: 'HEALTH' },
      select: { questionKey: true, severity: true },
    })) as Array<{ questionKey: string; severity: string }>
    const fullSnapshot = buildQuestionSnapshot(await healthSnapshotRows(), versions)
    // Snapshot WITHOUT the key under test (frozen before the question existed).
    const snapshotWithoutKey = buildQuestionSnapshot(
      (await healthSnapshotRows()).filter((q) => q.questionKey !== 'hasEmergencyServices'),
      versions
    )

    async function createAssessment(opts: {
      incidentId: string
      snapshot: unknown
      structureVersion: number
      contentVersion: number
      verificationStatus?: string
      daysAgo?: number
    }) {
      const initialGap = engineAnalyzeGaps(opts.snapshot, healthAnswers, registryRows)
      const row = await db.rapidAssessment.create({
        data: {
          rapidAssessmentType: 'HEALTH',
          rapidAssessmentDate: opts.daysAgo ? new Date(Date.now() - opts.daysAgo * 24 * 3600 * 1000) : new Date(),
          assessorId: assessor.id,
          assessorName: 'P3 Evidence Assessor',
          entityId: entity.id,
          incidentId: opts.incidentId,
          priority: initialGap.severity as never,
          verificationStatus: opts.verificationStatus ?? 'VERIFIED',
          answers: healthAnswers as never,
          structureVersion: opts.structureVersion,
          contentVersion: opts.contentVersion,
          questionSnapshot: opts.snapshot as never,
          // Initial derivation exactly as the service would store it.
          gapAnalysis: initialGap as never,
        },
      })
      fixtureIds.assessments.push(row.id)
      return row
    }

    // Affected: ACTIVE incident + snapshot contains K.
    const affected = await createAssessment({
      incidentId: activeIncident.id,
      snapshot: fullSnapshot,
      structureVersion: versions.structureVersion,
      contentVersion: versions.contentVersion,
    })
    // Also affected per the literal matcher rule: a DRAFT with a frozen
    // snapshot under the same ACTIVE incident (offline DRAFTs have no
    // snapshot and are naturally excluded — p5 territory).
    const affectedDraft = await createAssessment({
      incidentId: activeIncident.id,
      snapshot: fullSnapshot,
      structureVersion: versions.structureVersion,
      contentVersion: versions.contentVersion,
      verificationStatus: 'DRAFT',
    })
    // Control A: RESOLVED incident + snapshot contains K → NOT affected.
    const controlResolved = await createAssessment({
      incidentId: resolvedIncident.id,
      snapshot: fullSnapshot,
      structureVersion: versions.structureVersion,
      contentVersion: versions.contentVersion,
    })
    // Control B: ACTIVE incident + snapshot WITHOUT K → NOT affected. Older
    // date so it never outranks the affected row per (entity, type).
    const controlNoKey = await createAssessment({
      incidentId: activeIncident.id,
      snapshot: snapshotWithoutKey,
      structureVersion: versions.structureVersion,
      contentVersion: versions.contentVersion,
      daysAgo: 1,
    })

    const before = await db.rapidAssessment.findUniqueOrThrow({ where: { id: affected.id } })
    log('setup', {
      coordinatorId: coordinator.id,
      gapQuestion: `${gapQuestion.questionKey} (baseline severity reset to MEDIUM; was ${gapQuestion.severity})`,
      affectedAssessmentId: affected.id,
      affectedDraftAssessmentId: affectedDraft.id,
      before: {
        priority: before.priority,
        gapSeverity: (before.gapAnalysis as { severity?: string })?.severity,
        snapshotHasKey: JSON.stringify(before.questionSnapshot).includes('hasEmergencyServices'),
      },
    })
    check('setup', before.priority === 'MEDIUM', 'initial derived priority must be MEDIUM')
    check('setup', (before.gapAnalysis as { severity?: string })?.severity === 'MEDIUM', 'initial gap severity must be MEDIUM')

    // ---- 1. PATCH severity → CRITICAL (same-tx recompute) --------------------
    const versionsBefore = await getRegistryVersions(db, 'HEALTH')
    const response = await patchSeverityRoute(
      request('PATCH', `/api/v1/admin/questions/${gapQuestion.id}/severity`, {
        severity: 'CRITICAL',
        reason: 'P3 evidence: severity is a derivation rule',
      }, coordinator.token),
      { params: { id: gapQuestion.id } }
    )
    const body = await response.json()
    const after = await db.rapidAssessment.findUniqueOrThrow({ where: { id: affected.id } })
    const draftAfter = await db.rapidAssessment.findUniqueOrThrow({ where: { id: affectedDraft.id } })
    const versionsAfter = await getRegistryVersions(db, 'HEALTH')
    log('1. PATCH /api/v1/admin/questions/[id]/severity → CRITICAL', {
      status: response.status,
      affectedCount: body?.data?.affectedCount,
      affectedRow: {
        priority: `${before.priority} → ${after.priority}`,
        gapSeverity: `${(before.gapAnalysis as { severity?: string })?.severity} → ${(after.gapAnalysis as { severity?: string })?.severity}`,
        fieldSeverity: (after.gapAnalysis as { fieldSeverityMap?: Record<string, string> })?.fieldSeverityMap?.hasEmergencyServices,
        rowSource: ((after.gapAnalysis as { rows?: Array<{ key: string; source: string }> })?.rows ?? []).find((r) => r.key === 'hasEmergencyServices')?.source,
        structureVersion: `${before.structureVersion} → ${after.structureVersion} (must be unchanged)`,
        contentVersion: `${before.contentVersion} → ${after.contentVersion} (must be unchanged)`,
        snapshotIdentical: JSON.stringify(after.questionSnapshot) === JSON.stringify(before.questionSnapshot),
      },
      draftRowWithSnapshot: {
        priority: draftAfter.priority,
        gapSeverity: (draftAfter.gapAnalysis as { severity?: string })?.severity,
      },
      registryContentVersion: `${versionsBefore.contentVersion} → ${versionsAfter.contentVersion} (must be +1)`,
    })
    check('1', response.status === 200, `expected 200, got ${response.status}`)
    check('1', body?.data?.question?.severity === 'CRITICAL', 'route must surface the updated question')
    check('1', body?.data?.affectedCount >= 2, `affectedCount must cover the VERIFIED + DRAFT-with-snapshot fixtures (>= 2; got ${body?.data?.affectedCount}; foreign rows from a crashed earlier run would also legitimately match)`)
    check('1', after.priority === 'CRITICAL', 'assessment priority must re-derive to CRITICAL')
    check('1', draftAfter.priority === 'CRITICAL', 'DRAFT-with-snapshot assessment must re-derive too (literal matcher rule)')
    check('1', (after.gapAnalysis as { severity?: string })?.severity === 'CRITICAL', 'gapAnalysis.severity must re-derive to CRITICAL')
    check('1', (after.gapAnalysis as { fieldSeverityMap?: Record<string, string> })?.fieldSeverityMap?.hasEmergencyServices === 'CRITICAL', 'fieldSeverityMap[K] must be CRITICAL')
    check('1', ((after.gapAnalysis as { rows?: Array<{ key: string; source: string }> })?.rows ?? []).some((r) => r.key === 'hasEmergencyServices' && r.source === 'registry'), 'rows must carry the registry ladder source')
    check('1', after.structureVersion === before.structureVersion && after.contentVersion === before.contentVersion, 'assessment version stamps must be untouched')
    check('1', JSON.stringify(after.questionSnapshot) === JSON.stringify(before.questionSnapshot), 'frozen snapshot must be untouched')
    check('1', versionsAfter.structureVersion === versionsBefore.structureVersion, 'severity edit must NOT bump registry structureVersion')
    check('1', versionsAfter.contentVersion === versionsBefore.contentVersion + 1, 'severity edit must bump registry contentVersion')

    // Controls: untouched by the recompute.
    const controlResolvedAfter = await db.rapidAssessment.findUniqueOrThrow({ where: { id: controlResolved.id } })
    const controlNoKeyAfter = await db.rapidAssessment.findUniqueOrThrow({ where: { id: controlNoKey.id } })
    log('2. controls (RESOLVED incident / snapshot without K)', {
      resolvedIncidentRow: { priority: controlResolvedAfter.priority, gapSeverity: (controlResolvedAfter.gapAnalysis as { severity?: string })?.severity },
      snapshotWithoutKeyRow: { priority: controlNoKeyAfter.priority, gapSeverity: (controlNoKeyAfter.gapAnalysis as { severity?: string })?.severity },
    })
    check('2', controlResolvedAfter.priority === 'MEDIUM' && (controlResolvedAfter.gapAnalysis as { severity?: string })?.severity === 'MEDIUM', 'RESOLVED-incident assessment must NOT be recomputed')
    check('2', controlNoKeyAfter.priority === 'MEDIUM' && (controlNoKeyAfter.gapAnalysis as { severity?: string })?.severity === 'MEDIUM', 'assessment whose snapshot lacks K must NOT be recomputed')

    // ---- 3. Incident severity propagated (best-effort after commit) ----------
    const incidentAfter = await db.incident.findUniqueOrThrow({ where: { id: activeIncident.id } })
    log('3. incident propagation', { incidentSeverity: incidentAfter.severity })
    check('3', incidentAfter.severity === 'CRITICAL', 'affected incident must re-derive to CRITICAL')

    // ---- 4. Re-derivation is deterministic (pure engine) --------------------
    const rederived = await analyzeGapsFromSnapshot(
      'HEALTH',
      after.questionSnapshot as never,
      after.answers as Record<string, unknown>
    )
    // The pure engine, run twice on identical inputs, must be byte-identical;
    // the stored JSON comparison must be canonical (jsonb re-orders keys).
    const rowsNow = (await db.question.findMany({
      where: { assessmentType: 'HEALTH' },
      select: { questionKey: true, severity: true },
    })) as Array<{ questionKey: string; severity: string }>
    const engineFirst = engineAnalyzeGaps(after.questionSnapshot, after.answers as Record<string, unknown>, rowsNow)
    const engineSecond = engineAnalyzeGaps(after.questionSnapshot, after.answers as Record<string, unknown>, rowsNow)
    log('4. idempotent re-derivation', {
      engineTwiceByteIdentical: JSON.stringify(engineSecond) === JSON.stringify(engineFirst),
      storedMatchesReDerivation: canonical(rederived) === canonical(after.gapAnalysis),
      severity: rederived.severity,
    })
    check('4', JSON.stringify(engineSecond) === JSON.stringify(engineFirst), 'the pure engine must be byte-identical across passes')
    check('4', canonical(rederived) === canonical(after.gapAnalysis), 'a second derivation pass with unchanged inputs must match the stored analysis')

    // ---- 5. No-op severity PATCH (identity) → no bump, no recompute ---------
    const noopVersionsBefore = await getRegistryVersions(db, 'HEALTH')
    const noopResponse = await patchSeverityRoute(
      request('PATCH', `/api/v1/admin/questions/${gapQuestion.id}/severity`, {
        severity: 'CRITICAL', // same value — identity edit
        reason: 'P3 evidence: no-op severity edit',
      }, coordinator.token),
      { params: { id: gapQuestion.id } }
    )
    const noopBody = await noopResponse.json()
    const noopVersionsAfter = await getRegistryVersions(db, 'HEALTH')
    log('5. no-op severity PATCH (same value)', {
      status: noopResponse.status,
      affectedCount: noopBody?.data?.affectedCount,
      registryContentVersion: `${noopVersionsBefore.contentVersion} → ${noopVersionsAfter.contentVersion} (must be unchanged)`,
    })
    check('5', noopResponse.status === 200, `expected 200, got ${noopResponse.status}`)
    check('5', noopBody?.data?.affectedCount === 0, 'identity edit must recompute nothing')
    check('5', noopVersionsAfter.contentVersion === noopVersionsBefore.contentVersion, 'identity edit must not bump contentVersion')

    // ---- 6. Deleted bulk-recalculate surfaces → 404 through the router ------
    // A missing App Router file IS the router-level 404: if either handler
    // file existed again, the endpoint would be live.
    const recalculateRouteExists = existsSync(
      resolve(__dirname, '..', 'src/app/api/v1/admin/severity/recalculate/route.ts')
    )
    const updatePrioritiesRouteExists = existsSync(
      resolve(__dirname, '..', 'src/app/api/v1/rapid-assessments/update-priorities/route.ts')
    )
    log('6. deleted endpoints + dead service methods', {
      'POST /api/v1/admin/severity/recalculate': recalculateRouteExists ? 'STILL PRESENT (bug)' : '404 (route file gone)',
      'POST /api/v1/rapid-assessments/update-priorities': updatePrioritiesRouteExists ? 'STILL PRESENT (bug)' : '404 (route file gone)',
      incidentSeverityServiceRecalculateAll: typeof (incidentSeverityService as unknown as Record<string, unknown>).recalculateAll,
      updateAllHistoricalAssessmentPriorities: typeof (RapidAssessmentService as unknown as Record<string, unknown>).updateAllHistoricalAssessmentPriorities,
    })
    check('6', !recalculateRouteExists, 'admin/severity/recalculate route must be deleted')
    check('6', !updatePrioritiesRouteExists, 'rapid-assessments/update-priorities route must be deleted')
    check('6', (incidentSeverityService as unknown as Record<string, unknown>).recalculateAll === undefined, 'recalculateAll must be deleted')
    check('6', (RapidAssessmentService as unknown as Record<string, unknown>).updateAllHistoricalAssessmentPriorities === undefined, 'updateAllHistoricalAssessmentPriorities must be deleted')

    console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
    process.exitCode = failures === 0 ? 0 : 1
  } finally {
    // Cleanup (crash-safe): remove this run's rows whether it completed or
    // crashed midway (suites truncate anyway; keeps drms_test tidy).
    await db.rapidAssessment.deleteMany({ where: { id: { in: fixtureIds.assessments } } }).catch(() => {})
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
