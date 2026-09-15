/**
 * DQR P2 evidence run — exercises the question-registry governance API
 * handlers directly against drms_test and prints a step-by-step transcript.
 *
 * Run:  npx tsx scripts/dqr-p2-api-evidence.ts
 * Log:  _bmad-output/implementation-artifacts/dqr-p2-api-evidence.log
 *
 * Sequence (spec): ADMIN creates section+question (201) → Tier A label edit
 * (200, structure unchanged / content+1) → questionKey rename (400
 * question_key_immutable) → GAP severity PATCH as COORDINATOR (200) →
 * ADMIN-only label PUT as COORDINATOR (403).
 *
 * Env bootstrap mirrors tests/setup-api.ts: .env.test is parsed manually
 * (no dotenv dependency) and the script REFUSES to run unless DATABASE_URL
 * targets drms_test. Route handlers are dynamic-imported only after the env
 * is set so every PrismaClient binds to the test database.
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
  const { getRegistryVersions } = await import('../src/lib/questions/registry-versions')
  const { seedQuestions } = await import('../prisma/seed-questions')
  const { POST: createSectionRoute } = await import('../src/app/api/v1/admin/sections/route')
  const { POST: createQuestionRoute } = await import('../src/app/api/v1/admin/questions/route')
  const { PUT: updateQuestionRoute } = await import('../src/app/api/v1/admin/questions/[id]/route')
  const { PATCH: patchSeverityRoute } = await import('../src/app/api/v1/admin/questions/[id]/severity/route')

  const db = new PrismaClient()

  try {
    const runId = Date.now().toString(36)
    console.log(`DQR P2 API evidence run ${runId}`)
    console.log(`DATABASE_URL: ${databaseUrl.replace(/:[^:@/]+@/, ':***@')}`)

    // Ensure the registry exists (idempotent, mirrors the test factories).
    if ((await db.question.count()) === 0) {
      await seedQuestions(db)
      console.log('Seeded question registry (was empty).')
    }

    // Users: ADMIN + COORDINATOR with real role rows (withAuth re-loads roles).
    async function userWithRoles(roleNames: string[]): Promise<{ token: string; id: string }> {
      const roles: { id: string }[] = []
      for (const name of roleNames) {
        roles.push(await db.role.upsert({ where: { name }, update: {}, create: { name, description: `${name} (evidence)` } }))
      }
      const user = await db.user.create({
        data: {
          email: `p2-evidence-${roleNames[0].toLowerCase()}-${runId}@dms.test`,
          username: `p2-evidence-${roleNames[0].toLowerCase()}-${runId}`,
          passwordHash: await bcrypt.hash('EvidencePass123!', 10),
          name: `P2 Evidence ${roleNames.join('/')} ${runId}`,
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

    const admin = await userWithRoles(['ADMIN'])
    const coordinator = await userWithRoles(['COORDINATOR'])
    log('setup', { adminId: admin.id, coordinatorId: coordinator.id })

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

    // ---- 1. ADMIN creates a section → 201 ------------------------------------
    const sectionKey = `evidence-ctx-${runId}`
    const sectionResponse = await createSectionRoute(
      request('POST', '/api/v1/admin/sections', {
        assessmentType: 'WASH',
        sectionKey,
        title: 'Evidence context section',
        category: 'CONTEXT',
        reason: 'P2 evidence run',
      }, admin.token)
    )
    const sectionBody = await sectionResponse.json()
    log('1. POST /api/v1/admin/sections (ADMIN)', {
      status: sectionResponse.status,
      sectionKey: sectionBody?.data?.sectionKey,
      structureVersionAfter: (await getRegistryVersions(db, 'WASH')).structureVersion,
    })
    check('1', sectionResponse.status === 201, `expected 201, got ${sectionResponse.status}`)
    const sectionId: string = sectionBody.data.id

    // ---- 2. ADMIN creates a question → 201 -----------------------------------
    const questionKey = `evidenceNotes${runId}`
    const versionsBeforeCreate = await getRegistryVersions(db, 'WASH')
    const questionResponse = await createQuestionRoute(
      request('POST', '/api/v1/admin/questions', {
        assessmentType: 'WASH',
        questionKey,
        sectionId,
        questionType: 'TEXT_LONG',
        label: 'Evidence notes',
        category: 'CONTEXT',
        reason: 'P2 evidence run',
      }, admin.token)
    )
    const questionBody = await questionResponse.json()
    const versionsAfterCreate = await getRegistryVersions(db, 'WASH')
    log('2. POST /api/v1/admin/questions (ADMIN)', {
      status: questionResponse.status,
      questionKey: questionBody?.data?.questionKey,
      structureVersion: `${versionsBeforeCreate.structureVersion} → ${versionsAfterCreate.structureVersion}`,
    })
    check('2', questionResponse.status === 201, `expected 201, got ${questionResponse.status}`)
    check('2', versionsAfterCreate.structureVersion === versionsBeforeCreate.structureVersion + 1, 'structureVersion must bump +1 on create')
    const questionId: string = questionBody.data.id

    // ---- 3. Tier A label edit → 200, structure unchanged, content+1 ----------
    const versionsBeforeEdit = await getRegistryVersions(db, 'WASH')
    const labelResponse = await updateQuestionRoute(
      request('PUT', `/api/v1/admin/questions/${questionId}`, {
        label: 'Evidence notes (edited)',
        reason: 'P2 evidence: Tier A edit',
      }, admin.token),
      { params: { id: questionId } }
    )
    const versionsAfterEdit = await getRegistryVersions(db, 'WASH')
    log('3. PUT /api/v1/admin/questions/[id] label edit (ADMIN)', {
      status: labelResponse.status,
      structureVersion: `${versionsBeforeEdit.structureVersion} → ${versionsAfterEdit.structureVersion} (must be unchanged)`,
      contentVersion: `${versionsBeforeEdit.contentVersion} → ${versionsAfterEdit.contentVersion} (must be +1)`,
    })
    check('3', labelResponse.status === 200, `expected 200, got ${labelResponse.status}`)
    check('3', versionsAfterEdit.structureVersion === versionsBeforeEdit.structureVersion, 'Tier A edit must NOT bump structureVersion')
    check('3', versionsAfterEdit.contentVersion === versionsBeforeEdit.contentVersion + 1, 'Tier A edit must bump contentVersion')

    // ---- 4. questionKey rename → 400 question_key_immutable ------------------
    const renameResponse = await updateQuestionRoute(
      request('PUT', `/api/v1/admin/questions/${questionId}`, {
        questionKey: `renamed${runId}`,
        reason: 'P2 evidence: rename attempt',
      }, admin.token),
      { params: { id: questionId } }
    )
    const renameBody = await renameResponse.json()
    log('4. PUT /api/v1/admin/questions/[id] key rename (ADMIN)', {
      status: renameResponse.status,
      error: renameBody?.error,
      details: renameBody?.details,
    })
    check('4', renameResponse.status === 400, `expected 400, got ${renameResponse.status}`)
    check('4', renameBody?.error === 'question_key_immutable', `expected error question_key_immutable, got ${renameBody?.error}`)

    // ---- 5. GAP severity PATCH as COORDINATOR → 200, content-only bump -------
    const gapQuestion = await db.question.findFirst({
      where: { assessmentType: 'WASH', category: 'GAP', isActive: true },
      orderBy: { order: 'asc' },
    })
    if (!gapQuestion) throw new Error('No active WASH GAP question found — registry not seeded?')
    const newSeverity = gapQuestion.severity === 'HIGH' ? 'CRITICAL' : 'HIGH'
    const versionsBeforeSeverity = await getRegistryVersions(db, 'WASH')
    const severityResponse = await patchSeverityRoute(
      request('PATCH', `/api/v1/admin/questions/${gapQuestion.id}/severity`, {
        severity: newSeverity,
        reason: 'P2 evidence: coordinator severity tuning',
      }, coordinator.token),
      { params: { id: gapQuestion.id } }
    )
    const versionsAfterSeverity = await getRegistryVersions(db, 'WASH')
    const severityBody = await severityResponse.json()
    log('5. PATCH /api/v1/admin/questions/[id]/severity (COORDINATOR)', {
      status: severityResponse.status,
      questionKey: gapQuestion.questionKey,
      severity: `${gapQuestion.severity} → ${severityBody?.data?.question?.severity} (affectedCount: ${severityBody?.data?.affectedCount})`,
      structureVersion: `${versionsBeforeSeverity.structureVersion} → ${versionsAfterSeverity.structureVersion} (must be unchanged)`,
      contentVersion: `${versionsBeforeSeverity.contentVersion} → ${versionsAfterSeverity.contentVersion} (must be +1)`,
    })
    check('5', severityResponse.status === 200, `expected 200, got ${severityResponse.status}`)
    check('5', severityBody?.data?.question?.severity === newSeverity, 'severity must persist')
    check('5', versionsAfterSeverity.structureVersion === versionsBeforeSeverity.structureVersion, 'severity edit must NOT bump structureVersion')
    check('5', versionsAfterSeverity.contentVersion === versionsBeforeSeverity.contentVersion + 1, 'severity edit must bump contentVersion')

    // ---- 6. ADMIN-only label PUT as COORDINATOR → 403 ------------------------
    const forbiddenResponse = await updateQuestionRoute(
      request('PUT', `/api/v1/admin/questions/${questionId}`, {
        label: 'Coordinator cannot do this',
        reason: 'P2 evidence: role gate',
      }, coordinator.token),
      { params: { id: questionId } }
    )
    log('6. PUT /api/v1/admin/questions/[id] (COORDINATOR)', {
      status: forbiddenResponse.status,
    })
    check('6', forbiddenResponse.status === 403, `expected 403, got ${forbiddenResponse.status}`)

    console.log(`\n${failures === 0 ? 'ALL EVIDENCE CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
  } finally {
    await db.$disconnect()
  }

  if (failures > 0) process.exit(1)
}

main().catch((error) => {
  console.error('Evidence run crashed:', error)
  process.exit(1)
})
