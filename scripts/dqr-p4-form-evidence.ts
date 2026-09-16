/**
 * DQR P4 evidence run — proves the dynamic form's answers-based API contract
 * at the route-handler level (the exact POST/PUT the DynamicAssessmentForm
 * submits through):
 *
 *   1. Create: a HEALTH answers payload persists with the answers map stored
 *      verbatim (registry-keyed), a fresh snapshot + version stamps frozen,
 *      and gapAnalysis/priority server-derived (client priority ignored).
 *   2. Legacy payloads are rejected with 422: `healthData` without `answers`
 *      trips the explicit stale-client guard (route-level, before zod — the
 *      typed-payload layer is gone).
 *   3. Unknown keys in `answers` are stripped before storage (create + edit).
 *   4. Edit: the REJECTED-resubmit PUT replaces answers, re-freezes the
 *      snapshot, preserves versionNumber (p1–p3 parity), re-derives
 *      priority, and clears the
 *      rejection stamps when verificationStatus: SUBMITTED.
 *   5. POPULATION (zero GAP questions) derives LOW with hasGap=false — the
 *      server-side half of "no gap UI anywhere".
 *   6. Server-side registry validation: answers missing a required question
 *      (or with an invalid enum value) → 422 with per-field errors.
 *
 * Run:  npx tsx scripts/dqr-p4-form-evidence.ts
 * Log:  _bmad-output/implementation-artifacts/dqr-p4-api-evidence.log
 *
 * Env bootstrap mirrors scripts/dqr-p3-recompute-evidence.ts: .env.test is
 * parsed manually and the script REFUSES to run unless DATABASE_URL targets
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

/** Deterministic key order — stored jsonb re-orders keys, so comparisons
 * against in-memory objects must be canonical (mirrors the P3 script). */
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
  const { POST: postAssessmentRoute } = await import('../src/app/api/v1/rapid-assessments/route')
  const { PUT: putAssessmentRoute } = await import('../src/app/api/v1/rapid-assessments/[id]/route')

  const db = new PrismaClient()
  const fixtureIds = {
    assessments: [] as string[],
    incidents: [] as string[],
    entities: [] as string[],
    users: [] as string[],
  }

  try {
    const runId = Date.now().toString(36)
    console.log(`DQR P4 form evidence run ${runId}`)
    console.log(`DATABASE_URL: ${databaseUrl.replace(/:[^:@/]+@/, ':***@')}`)

    if ((await db.question.count()) === 0) {
      await seedQuestions(db)
      console.log('Seeded question registry (was empty).')
    }

    // Deterministic derivation: pin the single HEALTH GAP key this run
    // derives from back to its seed severity.
    await db.question.updateMany({
      where: { assessmentType: 'HEALTH', questionKey: 'hasEmergencyServices' },
      data: { severity: 'MEDIUM' },
    })

    const role = await db.role.upsert({
      where: { name: 'ASSESSOR' },
      update: {},
      create: { name: 'ASSESSOR', description: 'ASSESSOR (p4 evidence)' },
    })
    const assessor = await db.user.create({
      data: {
        email: `p4-evidence-assessor-${runId}@dms.test`,
        username: `p4-evidence-assessor-${runId}`,
        passwordHash: await bcrypt.hash('EvidencePass123!', 10),
        name: `P4 Evidence Assessor ${runId}`,
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
        name: `P4 Evidence Entity ${runId}`,
        type: 'COMMUNITY',
        location: 'P4 Evidence Location',
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
        name: `P4 Evidence Incident ${runId}`,
        type: 'FLOOD',
        description: 'P4 evidence incident',
        location: 'P4 Evidence Location',
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

    const basePayload = {
      rapidAssessmentDate: new Date().toISOString(),
      assessorName: 'P4 Evidence Assessor',
      location: 'P4 Evidence Location',
      entityId: entity.id,
      incidentId: incident.id,
    }

    const healthAnswers = {
      hasFunctionalClinic: true,
      hasEmergencyServices: false, // GAP key under test (pinned MEDIUM)
      numberHealthFacilities: 2,
      healthFacilityType: 'Clinic',
      qualifiedHealthWorkers: 5,
      hasTrainedStaff: true,
      hasMedicineSupply: true,
      hasMedicalSupplies: true,
      hasMaternalChildServices: true,
      commonHealthIssues: ['Malaria'],
    }

    const versions = await getRegistryVersions(db, 'HEALTH')

    // ---- 1. Create: HEALTH answers payload -------------------------------
    const createResponse = await postAssessmentRoute(
      request('POST', '/api/v1/rapid-assessments', {
        ...basePayload,
        type: 'HEALTH',
        answers: healthAnswers,
        priority: 'CRITICAL', // client priority input must be ignored
      }),
      {} as never
    )
    const createBody = await createResponse.json()
    const createdId = createBody?.data?.id as string | undefined
    if (createdId) fixtureIds.assessments.push(createdId)
    const createdRow = createdId
      ? await db.rapidAssessment.findUniqueOrThrow({ where: { id: createdId } })
      : null
    log('1. POST /api/v1/rapid-assessments (HEALTH answers payload)', {
      status: createResponse.status,
      row: createdRow && {
        verificationStatus: createdRow.verificationStatus,
        priority: createdRow.priority,
        versionNumber: createdRow.versionNumber,
        structureVersion: createdRow.structureVersion,
        contentVersion: createdRow.contentVersion,
        gapHasGap: (createdRow.gapAnalysis as { hasGap?: boolean })?.hasGap,
        gapFieldSeverity: (createdRow.gapAnalysis as { fieldSeverityMap?: Record<string, string> })?.fieldSeverityMap?.hasEmergencyServices,
        snapshotHasKey: JSON.stringify(createdRow.questionSnapshot).includes('hasFunctionalClinic'),
        answersHasFunctionalClinic: (createdRow.answers as Record<string, unknown>)?.hasFunctionalClinic,
      },
    })
    check('1', createResponse.status === 201, `expected 201, got ${createResponse.status}`)
    check('1', !!createdRow, 'assessment row must be persisted')
    if (createdRow) {
      check('1', createdRow.verificationStatus === 'SUBMITTED', 'auto-approval off → verificationStatus SUBMITTED')
      check('1', createdRow.priority === 'MEDIUM', `priority must derive MEDIUM from the single pinned MEDIUM gap (got ${createdRow.priority}; client CRITICAL must be ignored)`)
      check('1', createdRow.versionNumber === 1, 'fresh assessment starts at versionNumber 1')
      check('1', createdRow.structureVersion === versions.structureVersion && createdRow.contentVersion === versions.contentVersion, 'snapshot version stamps must match the live registry')
      check('1', JSON.stringify(createdRow.questionSnapshot).includes('hasFunctionalClinic'), 'a fresh registry snapshot must be frozen onto the row')
      check('1', (createdRow.gapAnalysis as { hasGap?: boolean })?.hasGap === true, 'gapAnalysis.hasGap must be true (hasEmergencyServices=false)')
      check('1', (createdRow.answers as Record<string, unknown>)?.commonHealthIssues?.[0] === 'Malaria', 'answers map must be stored registry-keyed')
    }

    // ---- 2. Legacy typed payload rejected ---------------------------------
    const legacyResponse = await postAssessmentRoute(
      request('POST', '/api/v1/rapid-assessments', {
        ...basePayload,
        type: 'HEALTH',
        healthData: { hasFunctionalClinic: true }, // typed transport — deleted layer
      }),
      {} as never
    )
    const legacyBody = await legacyResponse.json()
    log('2. POST legacy typed payload (healthData, no answers)', {
      status: legacyResponse.status,
      error: legacyBody?.error,
    })
    check('2', legacyResponse.status === 422, `legacy payload must be rejected with 422 (got ${legacyResponse.status})`)
    check('2', typeof legacyBody?.error === 'string' && legacyBody.error.includes('Legacy typed payloads are no longer accepted'), `error must name the removed legacy transport (got "${legacyBody?.error}")`)
    check('2', legacyBody?.data === undefined, 'no row may be created for a legacy payload')

    // Legacy junk alongside a VALID answers payload is stripped, not honored:
    const stripResponse = await postAssessmentRoute(
      request('POST', '/api/v1/rapid-assessments', {
        ...basePayload,
        type: 'HEALTH',
        answers: healthAnswers,
        healthData: { legacy: true },
        priority: 'CRITICAL',
      }),
      {} as never
    )
    const stripBody = await stripResponse.json()
    if (stripBody?.data?.id) fixtureIds.assessments.push(stripBody.data.id)
    const stripRow = stripBody?.data?.id
      ? await db.rapidAssessment.findUniqueOrThrow({ where: { id: stripBody.data.id } })
      : null
    log('2b. POST valid answers + legacy junk (healthData/priority stripped)', {
      status: stripResponse.status,
      row: stripRow && {
        priority: stripRow.priority,
        answersMatch: canonical(stripRow.answers) === canonical(healthAnswers),
      },
    })
    check('2b', stripResponse.status === 201, `expected 201, got ${stripResponse.status}`)
    check('2b', !!stripRow && stripRow.priority === 'MEDIUM', 'client priority must be stripped — server derives MEDIUM')
    check('2b', !!stripRow && !('healthData' in (stripRow.answers as Record<string, unknown>)), 'healthData junk must never reach storage')

    // ---- 3. Unknown answers key stripped on create -------------------------
    const unknownKeyResponse = await postAssessmentRoute(
      request('POST', '/api/v1/rapid-assessments', {
        ...basePayload,
        type: 'HEALTH',
        answers: { ...healthAnswers, mysteryLegacyKey: 'strip-me' },
      }),
      {} as never
    )
    const unknownKeyBody = await unknownKeyResponse.json()
    if (unknownKeyBody?.data?.id) fixtureIds.assessments.push(unknownKeyBody.data.id)
    const unknownKeyRow = unknownKeyBody?.data?.id
      ? await db.rapidAssessment.findUniqueOrThrow({ where: { id: unknownKeyBody.data.id } })
      : null
    log('3. POST answers with unknown key (mysteryLegacyKey)', {
      status: unknownKeyResponse.status,
      storedHasUnknownKey: unknownKeyRow && 'mysteryLegacyKey' in (unknownKeyRow.answers as Record<string, unknown>),
    })
    check('3', unknownKeyResponse.status === 201, `unknown keys must NOT 422 a valid payload (got ${unknownKeyResponse.status})`)
    check('3', !!unknownKeyRow && !('mysteryLegacyKey' in (unknownKeyRow.answers as Record<string, unknown>)), 'unknown key must be stripped before storage')

    // ---- 4. Edit: REJECTED → resubmit ------------------------------------
    if (!createdRow) throw new Error('step 1 failed — cannot run edit flow')
    await db.rapidAssessment.update({
      where: { id: createdRow.id },
      data: {
        verificationStatus: 'REJECTED',
        rejectionReason: 'P4 evidence rejection',
        rejectionFeedback: 'Please correct and resubmit',
      },
    })
    const resubmittedAnswers = { ...healthAnswers, hasEmergencyServices: true } // gap resolved
    const editResponse = await putAssessmentRoute(
      request('PUT', `/api/v1/rapid-assessments/${createdRow.id}`, {
        type: 'HEALTH',
        rapidAssessmentDate: new Date().toISOString(),
        assessorName: 'P4 Evidence Assessor',
        answers: { ...resubmittedAnswers, anotherMysteryKey: 42 },
        verificationStatus: 'SUBMITTED',
      }),
      { params: { id: createdRow.id } } as never
    )
    const editBody = await editResponse.json()
    const editedRow = await db.rapidAssessment.findUniqueOrThrow({ where: { id: createdRow.id } })
    log('4. PUT [id] REJECTED → resubmit (SUBMITTED)', {
      status: editResponse.status,
      row: {
        verificationStatus: 'REJECTED → ' + editedRow.verificationStatus,
        rejectionReason: editedRow.rejectionReason,
        rejectionFeedback: editedRow.rejectionFeedback,
        priority: `${createdRow.priority} → ${editedRow.priority}`,
        versionNumber: `${createdRow.versionNumber} → ${editedRow.versionNumber}`,
        answersHasEmergencyServices: (editedRow.answers as Record<string, unknown>)?.hasEmergencyServices,
        answersHasMysteryKey: 'anotherMysteryKey' in (editedRow.answers as Record<string, unknown>),
        snapshotRefrozen: editedRow.structureVersion === versions.structureVersion && editedRow.contentVersion === versions.contentVersion,
      },
    })
    check('4', editResponse.status === 200, `expected 200, got ${editResponse.status}`)
    check('4', editedRow.verificationStatus === 'SUBMITTED', 'resubmit must move REJECTED → SUBMITTED')
    check('4', editedRow.rejectionReason === null && editedRow.rejectionFeedback === null, 'resubmit must clear the rejection stamps')
    check('4', editedRow.priority === 'LOW', `priority must re-derive LOW once the only gap is resolved (got ${editedRow.priority})`)
    check('4', editedRow.versionNumber === createdRow.versionNumber, 'edit preserves versionNumber (p1–p3 service parity — update never touched it)')
    check('4', (editedRow.gapAnalysis as { hasGap?: boolean })?.hasGap === false, 'gapAnalysis must re-derive with no gaps')
    check('4', (editedRow.answers as Record<string, unknown>)?.hasEmergencyServices === true, 'answers are a full replace (hasEmergencyServices=true now stored)')
    check('4', !('anotherMysteryKey' in (editedRow.answers as Record<string, unknown>)), 'unknown keys stripped on edit too')

    // ---- 5. POPULATION: no GAP questions → LOW ----------------------------
    const populationAnswers = {
      totalHouseholds: 60,
      totalPopulation: 300,
      populationMale: 150,
      populationFemale: 145,
      populationUnder5: 40,
      pregnantWomen: 6,
      lactatingMothers: 5,
      personWithDisability: 2,
      elderlyPersons: 10,
      separatedChildren: 1,
      numberLivesLost: 0,
      numberInjured: 3,
    }
    const populationResponse = await postAssessmentRoute(
      request('POST', '/api/v1/rapid-assessments', {
        ...basePayload,
        type: 'POPULATION',
        answers: populationAnswers,
      }),
      {} as never
    )
    const populationBody = await populationResponse.json()
    if (populationBody?.data?.id) fixtureIds.assessments.push(populationBody.data.id)
    const populationRow = populationBody?.data?.id
      ? await db.rapidAssessment.findUniqueOrThrow({ where: { id: populationBody.data.id } })
      : null
    log('5. POST POPULATION (context-only type)', {
      status: populationResponse.status,
      row: populationRow && {
        priority: populationRow.priority,
        gapHasGap: (populationRow.gapAnalysis as { hasGap?: boolean })?.hasGap,
        gapFieldCount: Object.keys((populationRow.gapAnalysis as { fieldSeverityMap?: Record<string, string> })?.fieldSeverityMap ?? {}).length,
        totalPopulationStored: (populationRow.answers as Record<string, unknown>)?.totalPopulation,
      },
    })
    check('5', populationResponse.status === 201, `expected 201, got ${populationResponse.status}`)
    check('5', !!populationRow && populationRow.priority === 'LOW', 'POPULATION with no GAP questions must derive LOW')
    check('5', !!populationRow && (populationRow.gapAnalysis as { hasGap?: boolean })?.hasGap === false, 'POPULATION gapAnalysis.hasGap must be false')

    // ---- 6. Registry validation at the service boundary → 422 -------------
    const missingRequired = await postAssessmentRoute(
      request('POST', '/api/v1/rapid-assessments', {
        ...basePayload,
        type: 'HEALTH',
        answers: { ...healthAnswers, hasFunctionalClinic: undefined }, // required key absent
      }),
      {} as never
    )
    const missingRequiredBody = await missingRequired.json()
    const invalidEnum = await postAssessmentRoute(
      request('POST', '/api/v1/rapid-assessments', {
        ...basePayload,
        type: 'HEALTH',
        answers: { ...healthAnswers, healthFacilityType: 'None' }, // not a registry option
      }),
      {} as never
    )
    const invalidEnumBody = await invalidEnum.json()
    log('6. POST invalid answers (required missing / bad enum)', {
      missingRequired: { status: missingRequired.status, error: missingRequiredBody?.error, fieldErrors: missingRequiredBody?.details?.fieldErrors },
      invalidEnum: { status: invalidEnum.status, error: invalidEnumBody?.error, fieldErrors: invalidEnumBody?.details?.fieldErrors },
    })
    check('6', missingRequired.status === 422, `missing required answer must 422 (got ${missingRequired.status})`)
    check('6', missingRequiredBody?.error === 'Answers failed registry validation', 'service must surface the registry-validation ApiError')
    check('6', Array.isArray(missingRequiredBody?.details?.fieldErrors?.hasFunctionalClinic), '422 details must carry per-field errors')
    check('6', invalidEnum.status === 422, `invalid enum value must 422 (got ${invalidEnum.status})`)
    check('6', Array.isArray(invalidEnumBody?.details?.fieldErrors?.healthFacilityType), 'enum violation must flag healthFacilityType')

    console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
    process.exitCode = failures === 0 ? 0 : 1
  } finally {
    // Crash-safe best-effort cleanup (API suites truncate drms_test anyway).
    await db.actionSignal.deleteMany({ where: { entityId: { in: fixtureIds.entities } } }).catch(() => {})
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
