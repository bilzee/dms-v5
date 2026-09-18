import { GET as getQuestionSetRoute } from '@/app/api/v1/questions/route'
import { POST as createQuestionRoute } from '@/app/api/v1/admin/questions/route'
import { DELETE as deactivateQuestionRoute } from '@/app/api/v1/admin/questions/[id]/route'
import { GET as impactRoute } from '@/app/api/v1/admin/questions/[id]/impact/route'
import { PATCH as patchSeverityRoute } from '@/app/api/v1/admin/questions/[id]/severity/route'
import { POST as createRuleRoute } from '@/app/api/v1/admin/rules/route'
import { PUT as updateRuleRoute, DELETE as deactivateRuleRoute } from '@/app/api/v1/admin/rules/[id]/route'
import { GET as ruleAuditRoute } from '@/app/api/v1/admin/rules/[id]/audit/route'
import { SyncProcessingService } from '@/lib/services/sync-processing.service'
import { POST as createAssessmentRoute } from '@/app/api/v1/rapid-assessments/route'
import { PUT as updateAssessmentRoute } from '@/app/api/v1/rapid-assessments/[id]/route'
import { POST as submitAssessmentRoute } from '@/app/api/v1/rapid-assessments/[id]/submit/route'
import { POST as syncBatchRoute } from '@/app/api/v1/sync/batch/route'
import { makeRequest, tokenFor, withParams, jsonOf, type AuthedUser } from '../helpers/api'
import {
  createUser,
  createEntity,
  createIncident,
  createEntityAssignment,
  createRapidAssessment,
  ensureRoles,
  ensureQuestionRegistry,
} from '../factories'
import { testDb, truncateTestDb } from '../helpers/test-db'
import { getRegistryVersions } from '../../src/lib/questions/registry-versions'

/**
 * P10-2 — Cross-field rule registry API.
 *
 * Locks the I/O matrix of the rule governance surface and its assessment-side
 * effects:
 * - CRUD lifecycle on /api/v1/admin/rules (ADMIN gate, reason governance,
 *   ruleKey immutability/duplicates, structure-only version bumps, RULE audit
 *   trail, transactional rollback of rejected writes);
 * - the `rules` extension of GET /api/v1/questions (evaluation order, active
 *   filtering, ADMIN-only includeInactive);
 * - server-side REFINEMENT enforcement on the online create/update/submit
 *   paths (400 + violation details) while AGGREGATE rules stay client-side;
 * - the offline replay exemption: /api/v1/sync/batch NEVER rejects the same
 *   payload and stores the violations as gapAnalysis.crossFieldViolations;
 * - the question-deactivation guard (active rule references ⇒ 400
 *   registry_invalid listing the rules) + the impact preview's
 *   referencingRules, and the severity PATCH's affectedIncidentIds surface.
 */

function versionsOf(assessmentType: string) {
  return getRegistryVersions(testDb, assessmentType as 'HEALTH')
}

async function activeQuestionKeys(assessmentType: string, count: number): Promise<string[]> {
  const rows = await testDb.question.findMany({
    where: { assessmentType, isActive: true },
    orderBy: { order: 'asc' },
    select: { questionKey: true },
  })
  if (rows.length < count) {
    throw new Error(`Need ${count} active ${assessmentType} questions, found ${rows.length}`)
  }
  return rows.slice(0, count).map((row) => row.questionKey)
}

/**
 * Answers that satisfy every ACTIVE required question of a type (defaults by
 * questionType), so enforcement probes differ ONLY in the rule-relevant
 * overrides — a 400 can then only come from the cross-field layer.
 */
async function satisfyingAnswers(assessmentType: string): Promise<Record<string, unknown>> {
  const rows = await testDb.question.findMany({
    where: { assessmentType, isActive: true, required: true },
    select: { questionKey: true, questionType: true, options: true },
  })
  const answers: Record<string, unknown> = {}
  for (const row of rows) {
    const options = Array.isArray(row.options)
      ? (row.options as Array<{ value: string }>)
      : []
    switch (row.questionType) {
      case 'BOOLEAN':
        answers[row.questionKey] = true
        break
      case 'NUMBER':
        answers[row.questionKey] = 0
        break
      case 'SINGLE_CHOICE':
        answers[row.questionKey] = options[0]?.value ?? 'unknown'
        break
      case 'MULTI_SELECT':
        answers[row.questionKey] = options[0]?.value ? [options[0].value] : []
        break
      default:
        answers[row.questionKey] = 'n/a'
    }
  }
  return answers
}

/** Satisfies every required FOOD question and no seeded FOOD rule. */
const FOOD_CLEAN_ANSWERS = {
  isFoodSufficient: true,
  hasRegularMealAccess: true,
  hasInfantNutrition: true,
  availableFoodDurationDays: 14,
  additionalFoodRequiredPersons: 0,
  additionalFoodRequiredHouseholds: 0,
}

/** Same payload with BOTH seeded FOOD refinements violated (gate open, compare true). */
const FOOD_VIOLATING_ANSWERS = {
  ...FOOD_CLEAN_ANSWERS,
  availableFoodDurationDays: 2, // sufficient but < 7 days
  additionalFoodRequiredPersons: 25, // sufficient but extra persons required
}

/** FOOD answers that fire the isFoodSufficient GAP (severity re-derivation). */
const FOOD_GAP_ANSWERS = {
  isFoodSufficient: false,
  hasRegularMealAccess: true,
  hasInfantNutrition: true,
  availableFoodDurationDays: 3,
  additionalFoodRequiredPersons: 0,
  additionalFoodRequiredHouseholds: 0,
}

describe('P10-2 cross-field rule registry', () => {
  let admin: AuthedUser
  let coordinator: AuthedUser
  let assessor: AuthedUser

  beforeAll(async () => {
    await truncateTestDb()
    await ensureRoles()
    await ensureQuestionRegistry() // 55 questions + 15 seeded rules
    admin = (await createUser({ roles: ['ADMIN'] })) as AuthedUser
    coordinator = (await createUser({ roles: ['COORDINATOR'] })) as AuthedUser
    assessor = (await createUser({ roles: ['ASSESSOR'] })) as AuthedUser
  })

  afterAll(async () => {
    await truncateTestDb()
    await testDb.$disconnect()
  })

  // --------------------------------------------- rule CRUD (SECURITY, 0 seeded rules) ---

  describe('rule CRUD governance — /api/v1/admin/rules', () => {
    let ruleId: string
    let ruleKey: string
    let keyA: string
    let keyB: string

    beforeAll(async () => {
      ;[keyA, keyB] = await activeQuestionKeys('SECURITY', 2)
      ruleKey = `p102-rule-${Date.now().toString(36)}`
    })

    const validCreate = (overrides: Record<string, unknown> = {}) => ({
      assessmentType: 'SECURITY',
      ruleKey,
      kind: 'REFINEMENT',
      name: 'P10-2 test rule',
      message: 'A must not exceed B',
      expression: {
        op: '>',
        left: { type: 'question', key: keyA },
        right: { type: 'question', key: keyB },
      },
      referenceKeys: [keyA, keyB],
      reason: 'P10-2 api coverage',
      ...overrides,
    })

    test('COORDINATOR → 403 on POST, PUT and DELETE', async () => {
      const post = await createRuleRoute(
        makeRequest('POST', '/api/v1/admin/rules', {
          body: validCreate(),
          token: tokenFor(coordinator),
        })
      )
      expect(post.status).toBe(403)

      const put = await updateRuleRoute(
        makeRequest('PUT', '/api/v1/admin/rules/whatever', {
          body: { message: 'x', reason: 'role gate' },
          token: tokenFor(coordinator),
        }),
        withParams({ id: 'whatever' })
      )
      expect(put.status).toBe(403)

      const del = await deactivateRuleRoute(
        makeRequest('DELETE', '/api/v1/admin/rules/whatever', {
          body: { reason: 'role gate' },
          token: tokenFor(coordinator),
        }),
        withParams({ id: 'whatever' })
      )
      expect(del.status).toBe(403)
    })

    test('missing reason → 400 reason_required, fully rolled back', async () => {
      const before = await versionsOf('SECURITY')
      // ReasonSchema is optional at the transport layer — undefined reaches
      // the service, whose writeAudit guard rejects it (400 reason_required).
      const response = await createRuleRoute(
        makeRequest('POST', '/api/v1/admin/rules', {
          body: { ...validCreate(), reason: undefined },
          token: tokenFor(admin),
        })
      )
      expect(response.status).toBe(400)
      const body = await jsonOf(response)
      expect(body.error).toBe('reason_required')

      // Atomicity: no rule row, no version movement, no audit.
      expect(await testDb.crossFieldRule.count({ where: { ruleKey } })).toBe(0)
      expect(await versionsOf('SECURITY')).toEqual(before)
    })

    test('malformed AST → 400 at the transport grammar; nothing stored', async () => {
      const before = await versionsOf('SECURITY')
      const response = await createRuleRoute(
        makeRequest('POST', '/api/v1/admin/rules', {
          body: validCreate({
            expression: { op: '><', left: { type: 'question', key: keyA }, right: { type: 'question', key: keyB } },
          }),
          token: tokenFor(admin),
        })
      )
      expect(response.status).toBe(400)
      expect(await testDb.crossFieldRule.count({ where: { ruleKey } })).toBe(0)
      expect(await versionsOf('SECURITY')).toEqual(before)
    })

    test('referenceKeys not active questions of the type → 400 registry_invalid', async () => {
      const response = await createRuleRoute(
        makeRequest('POST', '/api/v1/admin/rules', {
          body: validCreate({ referenceKeys: [keyA, 'noSuchQuestionKey'] }),
          token: tokenFor(admin),
        })
      )
      expect(response.status).toBe(400)
      const body = await jsonOf(response)
      expect(body.error).toBe('registry_invalid')
      expect(body.details.errors.join('\n')).toContain('noSuchQuestionKey')
      expect(await testDb.crossFieldRule.count({ where: { ruleKey } })).toBe(0)
    })

    test('ADMIN creates a rule → 200, structure bump only, CREATE audit with reason+actor', async () => {
      const before = await versionsOf('SECURITY')
      // Prime the per-type rule cache so the post-create read proves the
      // mutation hook cleared it (a stale cache would hide the rule for 30s).
      const primed = await getQuestionSetRoute(
        makeRequest('GET', '/api/v1/questions', {
          query: { assessmentType: 'SECURITY' },
          token: tokenFor(admin),
        })
      )
      expect(
        (await jsonOf(primed)).data.rules.map((rule: { ruleKey: string }) => rule.ruleKey)
      ).not.toContain(ruleKey)

      const response = await createRuleRoute(
        makeRequest('POST', '/api/v1/admin/rules', {
          body: validCreate(),
          token: tokenFor(admin),
        })
      )
      expect(response.status).toBe(200)
      const body = await jsonOf(response)
      ruleId = body.data.id
      expect(body.data.ruleKey).toBe(ruleKey)
      expect(body.data.isActive).toBe(true)
      expect(body.data.order).toBeGreaterThan(0)

      // Rules are always structural: structure+1, content unchanged.
      const after = await versionsOf('SECURITY')
      expect(after.structureVersion).toBe(before.structureVersion + 1)
      expect(after.contentVersion).toBe(before.contentVersion)

      const audit = await testDb.questionAuditLog.findFirst({
        where: { entityType: 'RULE', entityId: ruleId, action: 'CREATE' },
      })
      expect(audit?.reason).toBe('P10-2 api coverage')
      expect(audit?.actorId).toBe(admin.id)

      // Fresh read AFTER the mutation: the cache-invalidation hook ran.
      const reread = await getQuestionSetRoute(
        makeRequest('GET', '/api/v1/questions', {
          query: { assessmentType: 'SECURITY' },
          token: tokenFor(admin),
        })
      )
      expect(
        (await jsonOf(reread)).data.rules.map((rule: { ruleKey: string }) => rule.ruleKey)
      ).toContain(ruleKey)
    })

    test('same ruleKey in a different type → 200 (uniqueness is per (type, ruleKey))', async () => {
      const [hKeyA, hKeyB] = await activeQuestionKeys('HEALTH', 2)
      const created = await createRuleRoute(
        makeRequest('POST', '/api/v1/admin/rules', {
          body: {
            assessmentType: 'HEALTH',
            ruleKey, // identical to the SECURITY rule above
            kind: 'REFINEMENT',
            name: 'Cross-type twin',
            message: 'A must not exceed B',
            expression: {
              op: '>',
              left: { type: 'question', key: hKeyA },
              right: { type: 'question', key: hKeyB },
            },
            referenceKeys: [hKeyA, hKeyB],
            reason: 'P10-2 cross-type uniqueness probe',
          },
          token: tokenFor(admin),
        })
      )
      expect(created.status).toBe(200)
      const twin = await jsonOf(created)
      expect(twin.data.id).not.toBe(ruleId)

      const cleanup = await deactivateRuleRoute(
        makeRequest('DELETE', `/api/v1/admin/rules/${twin.data.id}`, {
          body: { reason: 'cross-type probe cleanup' },
          token: tokenFor(admin),
        }),
        withParams({ id: twin.data.id })
      )
      expect(cleanup.status).toBe(204)
    })

    test('duplicate ruleKey (same type) → 409 rule_key_duplicate', async () => {
      const before = await versionsOf('SECURITY')
      const response = await createRuleRoute(
        makeRequest('POST', '/api/v1/admin/rules', {
          body: validCreate(),
          token: tokenFor(admin),
        })
      )
      expect(response.status).toBe(409)
      const body = await jsonOf(response)
      expect(body.error).toBe('rule_key_duplicate')
      expect(await versionsOf('SECURITY')).toEqual(before)
    })

    test('ruleKey rename → 400 rule_key_immutable, nothing changed', async () => {
      const before = await versionsOf('SECURITY')
      const response = await updateRuleRoute(
        makeRequest('PUT', `/api/v1/admin/rules/${ruleId}`, {
          body: { ruleKey: 'renamed-rule', reason: 'rename attempt' },
          token: tokenFor(admin),
        }),
        withParams({ id: ruleId })
      )
      expect(response.status).toBe(400)
      const body = await jsonOf(response)
      expect(body.error).toBe('rule_key_immutable')
      expect(await versionsOf('SECURITY')).toEqual(before)
      expect(
        (await testDb.crossFieldRule.findUnique({ where: { id: ruleId } }))?.ruleKey
      ).toBe(ruleKey)
    })

    test('message edit → 200, structure bump only, UPDATE audit diff', async () => {
      const before = await versionsOf('SECURITY')
      const newMessage = 'A must NEVER exceed B'
      const response = await updateRuleRoute(
        makeRequest('PUT', `/api/v1/admin/rules/${ruleId}`, {
          body: { message: newMessage, reason: 'clarify message' },
          token: tokenFor(admin),
        }),
        withParams({ id: ruleId })
      )
      expect(response.status).toBe(200)
      const after = await versionsOf('SECURITY')
      expect(after.structureVersion).toBe(before.structureVersion + 1)
      expect(after.contentVersion).toBe(before.contentVersion)

      const audit = await testDb.questionAuditLog.findFirst({
        where: { entityType: 'RULE', entityId: ruleId, action: 'UPDATE' },
        orderBy: { actedAt: 'desc' },
      })
      expect(audit).not.toBeNull()
      expect((audit?.changes as { message?: { from?: string; to?: string } })?.message?.to).toBe(
        newMessage
      )
    })

    test('PUT when:null clears the gate (SQL NULL), bumps structure, audits the clear', async () => {
      const stamp = Date.now().toString(36)
      const gateRuleKey = `gate-rule-${stamp}`
      const created = await createRuleRoute(
        makeRequest('POST', '/api/v1/admin/rules', {
          body: validCreate({
            ruleKey: gateRuleKey,
            name: 'Gated rule',
            when: { questionKey: keyA, is: true },
          }),
          token: tokenFor(admin),
        })
      )
      expect(created.status).toBe(200)
      const gatedId = (await jsonOf(created)).data.id
      expect((await testDb.crossFieldRule.findUnique({ where: { id: gatedId } }))?.when).toEqual({
        questionKey: keyA,
        is: true,
      })

      const before = await versionsOf('SECURITY')
      const cleared = await updateRuleRoute(
        makeRequest('PUT', `/api/v1/admin/rules/${gatedId}`, {
          body: { when: null, reason: 'clear the gate' },
          token: tokenFor(admin),
        }),
        withParams({ id: gatedId })
      )
      expect(cleared.status).toBe(200)

      // The stored gate is SQL NULL — not the stale BoolGate (the silent
      // no-op flagged in review), and not a JSON null sentinel.
      const stored = await testDb.crossFieldRule.findUniqueOrThrow({ where: { id: gatedId } })
      expect(stored.when).toBeNull()

      const after = await versionsOf('SECURITY')
      expect(after.structureVersion).toBe(before.structureVersion + 1)
      const audit = await testDb.questionAuditLog.findFirst({
        where: { entityType: 'RULE', entityId: gatedId, action: 'UPDATE' },
        orderBy: { actedAt: 'desc' },
      })
      expect((audit?.changes as { when?: { to?: unknown } })?.when?.to).toBeNull()

      const cleanup = await deactivateRuleRoute(
        makeRequest('DELETE', `/api/v1/admin/rules/${gatedId}`, {
          body: { reason: 'gate probe cleanup' },
          token: tokenFor(admin),
        }),
        withParams({ id: gatedId })
      )
      expect(cleanup.status).toBe(204)
    })

    test('no-op PUT → 200, no version change, no new audit', async () => {
      const before = await versionsOf('SECURITY')
      const auditBefore = await testDb.questionAuditLog.count({ where: { entityId: ruleId } })
      const response = await updateRuleRoute(
        makeRequest('PUT', `/api/v1/admin/rules/${ruleId}`, {
          body: { name: 'P10-2 test rule', reason: 'no-op probe' },
          token: tokenFor(admin),
        }),
        withParams({ id: ruleId })
      )
      expect(response.status).toBe(200)
      expect(await versionsOf('SECURITY')).toEqual(before)
      expect(await testDb.questionAuditLog.count({ where: { entityId: ruleId } })).toBe(auditBefore)
    })

    test('PUT with reordered JSON keys (same AST) → semantic no-op, no phantom bump', async () => {
      const before = await versionsOf('SECURITY')
      const auditBefore = await testDb.questionAuditLog.count({ where: { entityId: ruleId } })
      const response = await updateRuleRoute(
        makeRequest('PUT', `/api/v1/admin/rules/${ruleId}`, {
          body: {
            // Semantically identical to the stored expression, keys reordered —
            // canonical comparison must see through key-order-only differences.
            expression: {
              left: { key: keyA, type: 'question' },
              op: '>',
              right: { key: keyB, type: 'question' },
            },
            reason: 'reordered keys probe',
          },
          token: tokenFor(admin),
        }),
        withParams({ id: ruleId })
      )
      expect(response.status).toBe(200)
      expect(await versionsOf('SECURITY')).toEqual(before)
      expect(await testDb.questionAuditLog.count({ where: { entityId: ruleId } })).toBe(auditBefore)
    })

    test('PUT with invalid merged referenceKeys → 400 registry_invalid (re-validated)', async () => {
      const before = await versionsOf('SECURITY')
      const response = await updateRuleRoute(
        makeRequest('PUT', `/api/v1/admin/rules/${ruleId}`, {
          body: { referenceKeys: [keyA, 'noSuchKeyOnPut'], reason: 're-validation probe' },
          token: tokenFor(admin),
        }),
        withParams({ id: ruleId })
      )
      expect(response.status).toBe(400)
      const body = await jsonOf(response)
      expect(body.error).toBe('registry_invalid')
      expect(body.details.errors.join('\n')).toContain('noSuchKeyOnPut')
      expect(await versionsOf('SECURITY')).toEqual(before)
      expect(
        (await testDb.crossFieldRule.findUnique({ where: { id: ruleId } }))?.referenceKeys
      ).toEqual([keyA, keyB])
    })

    test('unknown ids → 404 rule_not_found (PUT and DELETE)', async () => {
      const put = await updateRuleRoute(
        makeRequest('PUT', '/api/v1/admin/rules/does-not-exist', {
          body: { message: 'Nope', reason: 'probe' },
          token: tokenFor(admin),
        }),
        withParams({ id: 'does-not-exist' })
      )
      expect(put.status).toBe(404)
      expect((await jsonOf(put)).error).toBe('rule_not_found')

      const del = await deactivateRuleRoute(
        makeRequest('DELETE', '/api/v1/admin/rules/does-not-exist', {
          body: { reason: 'probe' },
          token: tokenFor(admin),
        }),
        withParams({ id: 'does-not-exist' })
      )
      expect(del.status).toBe(404)
      expect((await jsonOf(del)).error).toBe('rule_not_found')
    })

    test('DELETE without reason → 400 reason_required, rule stays active', async () => {
      const response = await deactivateRuleRoute(
        makeRequest('DELETE', `/api/v1/admin/rules/${ruleId}`, {
          token: tokenFor(admin),
        }),
        withParams({ id: ruleId })
      )
      expect(response.status).toBe(400)
      expect((await jsonOf(response)).error).toBe('reason_required')
      expect((await testDb.crossFieldRule.findUnique({ where: { id: ruleId } }))?.isActive).toBe(
        true
      )
    })

    test('DELETE with reason → 204, DEACTIVATE audit, structure bump', async () => {
      const before = await versionsOf('SECURITY')
      const response = await deactivateRuleRoute(
        makeRequest('DELETE', `/api/v1/admin/rules/${ruleId}`, {
          body: { reason: 'retire the test rule' },
          token: tokenFor(admin),
        }),
        withParams({ id: ruleId })
      )
      expect(response.status).toBe(204)
      expect((await testDb.crossFieldRule.findUnique({ where: { id: ruleId } }))?.isActive).toBe(
        false
      )
      const after = await versionsOf('SECURITY')
      expect(after.structureVersion).toBe(before.structureVersion + 1)
      expect(after.contentVersion).toBe(before.contentVersion)

      const audit = await testDb.questionAuditLog.findFirst({
        where: { entityType: 'RULE', entityId: ruleId, action: 'DEACTIVATE' },
      })
      expect(audit?.reason).toBe('retire the test rule')
      expect(audit?.actorId).toBe(admin.id)

      // A fresh /questions read no longer lists the deactivated rule
      // (cache-invalidation hook, not a 30s TTL expiry).
      const afterRead = await getQuestionSetRoute(
        makeRequest('GET', '/api/v1/questions', {
          query: { assessmentType: 'SECURITY' },
          token: tokenFor(admin),
        })
      )
      expect(
        (await jsonOf(afterRead)).data.rules.map((rule: { ruleKey: string }) => rule.ruleKey)
      ).not.toContain(ruleKey)
    })

    test('PUT isActive:true reactivates a deactivated rule → 200, bump, UPDATE audit with isActive diff', async () => {
      const before = await versionsOf('SECURITY')
      const response = await updateRuleRoute(
        makeRequest('PUT', `/api/v1/admin/rules/${ruleId}`, {
          body: { isActive: true, reason: 'reactivate the test rule' },
          token: tokenFor(admin),
        }),
        withParams({ id: ruleId })
      )
      expect(response.status).toBe(200)
      const body = await jsonOf(response)
      expect(body.data.isActive).toBe(true)
      expect(
        (await testDb.crossFieldRule.findUnique({ where: { id: ruleId } }))?.isActive
      ).toBe(true)

      // Every rule mutation is structural — even a pure lifecycle flip.
      const after = await versionsOf('SECURITY')
      expect(after.structureVersion).toBe(before.structureVersion + 1)
      expect(after.contentVersion).toBe(before.contentVersion)

      const audit = await testDb.questionAuditLog.findFirst({
        where: { entityType: 'RULE', entityId: ruleId, action: 'UPDATE' },
        orderBy: { actedAt: 'desc' },
      })
      expect(audit?.reason).toBe('reactivate the test rule')
      expect((audit?.changes as { isActive?: { from?: boolean; to?: boolean } })?.isActive).toEqual({
        from: false,
        to: true,
      })

      // The reactivated rule is visible again on a fresh plain read.
      const reread = await getQuestionSetRoute(
        makeRequest('GET', '/api/v1/questions', {
          query: { assessmentType: 'SECURITY' },
          token: tokenFor(admin),
        })
      )
      expect(
        (await jsonOf(reread)).data.rules.map((rule: { ruleKey: string }) => rule.ruleKey)
      ).toContain(ruleKey)

      // Leave the fixture deactivated for the includeInactive probe below.
      const reDeactivated = await deactivateRuleRoute(
        makeRequest('DELETE', `/api/v1/admin/rules/${ruleId}`, {
          body: { reason: 'restore deactivated fixture state' },
          token: tokenFor(admin),
        }),
        withParams({ id: ruleId })
      )
      expect(reDeactivated.status).toBe(204)
    })
  })

  // --------------------------------------------- rule audit timeline route ---

  describe('GET /api/v1/admin/rules/[id]/audit', () => {
    test("ADMIN timeline newest-first with actor; COORDINATOR 403; unknown id → empty", async () => {
      const [keyA, keyB] = await activeQuestionKeys('SECURITY', 2)
      const stamp = Date.now().toString(36)
      const created = await createRuleRoute(
        makeRequest('POST', '/api/v1/admin/rules', {
          body: {
            assessmentType: 'SECURITY',
            ruleKey: `audit-rule-${stamp}`,
            kind: 'REFINEMENT',
            name: 'Audit probe',
            message: 'A must not exceed B',
            expression: {
              op: '>',
              left: { type: 'question', key: keyA },
              right: { type: 'question', key: keyB },
            },
            referenceKeys: [keyA, keyB],
            reason: 'audit route probe',
          },
          token: tokenFor(admin),
        })
      )
      expect(created.status).toBe(200)
      const auditRuleId = (await jsonOf(created)).data.id

      const edited = await updateRuleRoute(
        makeRequest('PUT', `/api/v1/admin/rules/${auditRuleId}`, {
          body: { message: 'A must NEVER exceed B', reason: 'audit route probe edit' },
          token: tokenFor(admin),
        }),
        withParams({ id: auditRuleId })
      )
      expect(edited.status).toBe(200)

      const timeline = await ruleAuditRoute(
        makeRequest('GET', `/api/v1/admin/rules/${auditRuleId}/audit`, {
          token: tokenFor(admin),
        }),
        withParams({ id: auditRuleId })
      )
      expect(timeline.status).toBe(200)
      const body = await jsonOf(timeline)
      expect(body.data.entries).toHaveLength(2)
      expect(body.data.entries[0].action).toBe('UPDATE') // newest first
      expect(body.data.entries[1].action).toBe('CREATE')
      expect(
        body.data.entries.every((entry: { entityType: string }) => entry.entityType === 'RULE')
      ).toBe(true)
      expect(body.data.entries[1].reason).toBe('audit route probe')
      expect(body.data.entries[1].actor).toMatchObject({ email: admin.email })

      const denied = await ruleAuditRoute(
        makeRequest('GET', `/api/v1/admin/rules/${auditRuleId}/audit`, {
          token: tokenFor(coordinator),
        }),
        withParams({ id: auditRuleId })
      )
      expect(denied.status).toBe(403)

      const unknown = await ruleAuditRoute(
        makeRequest('GET', '/api/v1/admin/rules/no-such-rule/audit', {
          token: tokenFor(admin),
        }),
        withParams({ id: 'no-such-rule' })
      )
      expect(unknown.status).toBe(200)
      expect((await jsonOf(unknown)).data.entries).toEqual([])

      const cleanup = await deactivateRuleRoute(
        makeRequest('DELETE', `/api/v1/admin/rules/${auditRuleId}`, {
          body: { reason: 'audit probe cleanup' },
          token: tokenFor(admin),
        }),
        withParams({ id: auditRuleId })
      )
      expect(cleanup.status).toBe(204)
    })
  })

  // ------------------------------------------------------- /questions rules ---

  describe('GET /api/v1/questions — rules extension', () => {
    test('returns the seeded FOOD rules in evaluation order (any authenticated role)', async () => {
      const response = await getQuestionSetRoute(
        makeRequest('GET', '/api/v1/questions', {
          query: { assessmentType: 'FOOD' },
          token: tokenFor(assessor),
        })
      )
      expect(response.status).toBe(200)
      const body = await jsonOf(response)
      expect(body.data.rules.map((rule: { ruleKey: string }) => rule.ruleKey)).toEqual([
        'food-sufficient-but-additional-required',
        'food-sufficient-but-short-duration',
      ])
      expect(body.data.rules.every((rule: { isActive: boolean }) => rule.isActive)).toBe(true)
      const first = body.data.rules[0]
      expect(first.kind).toBe('REFINEMENT')
      expect(first.when).toEqual({ questionKey: 'isFoodSufficient', is: true })
      expect(first.referenceKeys[0]).toBe('additionalFoodRequiredPersons')
    })

    test('includeInactive=1 — ADMIN sees deactivated rules; default hides them; ASSESSOR 403', async () => {
      // The CRUD lifecycle above deactivated the SECURITY test rule.
      const inactive = await testDb.crossFieldRule.findFirst({
        where: { assessmentType: 'SECURITY', isActive: false },
      })
      expect(inactive).not.toBeNull()

      const all = await getQuestionSetRoute(
        makeRequest('GET', '/api/v1/questions', {
          query: { assessmentType: 'SECURITY', includeInactive: 1 },
          token: tokenFor(admin),
        })
      )
      expect(all.status).toBe(200)
      const allBody = await jsonOf(all)
      const keys = allBody.data.rules.map((rule: { ruleKey: string }) => rule.ruleKey)
      expect(keys).toContain(inactive!.ruleKey)

      const activeOnly = await getQuestionSetRoute(
        makeRequest('GET', '/api/v1/questions', {
          query: { assessmentType: 'SECURITY' },
          token: tokenFor(admin),
        })
      )
      expect(activeOnly.status).toBe(200)
      const activeBody = await jsonOf(activeOnly)
      const activeKeys = activeBody.data.rules.map((rule: { ruleKey: string }) => rule.ruleKey)
      expect(activeKeys).not.toContain(inactive!.ruleKey)

      const denied = await getQuestionSetRoute(
        makeRequest('GET', '/api/v1/questions', {
          query: { assessmentType: 'SECURITY', includeInactive: 1 },
          token: tokenFor(assessor),
        })
      )
      expect(denied.status).toBe(403)
    })
  })

  // --------------------------------------------------- online enforcement ---

  describe('online enforcement — active REFINEMENT rules reject violating payloads', () => {
    let entity: { id: string }
    let incident: { id: string }

    beforeAll(async () => {
      entity = await createEntity()
      incident = await createIncident({ createdBy: coordinator.id }) // ACTIVE
      await createEntityAssignment({
        userId: assessor.id,
        entityId: entity.id,
        assignedBy: admin.id,
      })
    })

    const foodBody = (answers: Record<string, unknown>) => ({
      type: 'FOOD',
      rapidAssessmentDate: new Date().toISOString(),
      assessorName: 'P10-2 Assessor',
      entityId: entity.id,
      incidentId: incident.id,
      answers,
    })

    test('POST /rapid-assessments with violating FOOD answers → 400 + violation details, nothing stored', async () => {
      const beforeCount = await testDb.rapidAssessment.count({
        where: { entityId: entity.id, rapidAssessmentType: 'FOOD' },
      })
      const response = await createAssessmentRoute(
        makeRequest('POST', '/api/v1/rapid-assessments', {
          body: foodBody(FOOD_VIOLATING_ANSWERS),
          token: tokenFor(assessor),
        })
      )
      expect(response.status).toBe(400)
      const body = await jsonOf(response)
      expect(body.error).toBe('Cross-field validation failed')
      expect(body.details).toHaveLength(2)
      expect(
        body.details.map((violation: { key: string }) => violation.key).sort()
      ).toEqual(['additionalFoodRequiredPersons', 'availableFoodDurationDays'])
      expect(
        body.details.every((violation: { kind: string }) => violation.kind === 'refinement')
      ).toBe(true)
      expect(
        await testDb.rapidAssessment.count({
          where: { entityId: entity.id, rapidAssessmentType: 'FOOD' },
        })
      ).toBe(beforeCount)
    })

    test('POST with clean FOOD answers → 201 (enforcement does not over-reject)', async () => {
      const response = await createAssessmentRoute(
        makeRequest('POST', '/api/v1/rapid-assessments', {
          body: foodBody(FOOD_CLEAN_ANSWERS),
          token: tokenFor(assessor),
        })
      )
      expect(response.status).toBe(201)
    })

    test('POPULATION aggregate-only violation → 201 (AGGREGATE rules stay client-side)', async () => {
      // Vulnerable groups sum 180 > 100 fires ONLY the AGGREGATE
      // population-vulnerable-sum-exceeds-total; every REFINEMENT stays
      // satisfied (each key ≤ total, gender sum == total, casualties 0).
      const answers = {
        ...(await satisfyingAnswers('POPULATION')),
        totalPopulation: 100,
        populationMale: 50,
        populationFemale: 50,
        populationUnder5: 30,
        pregnantWomen: 30,
        lactatingMothers: 30,
        personWithDisability: 30,
        elderlyPersons: 30,
        separatedChildren: 30,
        numberLivesLost: 0,
        numberInjured: 0,
      }
      const response = await createAssessmentRoute(
        makeRequest('POST', '/api/v1/rapid-assessments', {
          body: {
            type: 'POPULATION',
            rapidAssessmentDate: new Date().toISOString(),
            assessorName: 'P10-2 Assessor',
            entityId: entity.id,
            incidentId: incident.id,
            answers,
          },
          token: tokenFor(assessor),
        })
      )
      expect(response.status).toBe(201)
    })

    test('PUT /rapid-assessments/[id] with violating answers → 400, stored answers unchanged', async () => {
      const row = await createRapidAssessment({
        assessorId: assessor.id,
        entityId: entity.id,
        incidentId: incident.id,
        assessmentType: 'FOOD',
        verificationStatus: 'DRAFT',
        withSnapshot: true,
        answers: FOOD_CLEAN_ANSWERS,
      })

      const response = await updateAssessmentRoute(
        makeRequest('PUT', `/api/v1/rapid-assessments/${row.id}`, {
          body: { type: 'FOOD', answers: FOOD_VIOLATING_ANSWERS },
          token: tokenFor(assessor),
        }),
        withParams({ id: row.id })
      )
      expect(response.status).toBe(400)
      const body = await jsonOf(response)
      expect(body.error).toBe('Cross-field validation failed')
      expect(body.details).toHaveLength(2)

      const after = await testDb.rapidAssessment.findUniqueOrThrow({ where: { id: row.id } })
      expect(after.answers).toEqual(FOOD_CLEAN_ANSWERS)
    })

    test('submit of a DRAFT whose STORED answers violate → 400; clean DRAFT submits → 200', async () => {
      const violatingDraft = await createRapidAssessment({
        assessorId: assessor.id,
        entityId: entity.id,
        incidentId: incident.id,
        assessmentType: 'FOOD',
        verificationStatus: 'DRAFT',
        withSnapshot: true,
        answers: FOOD_VIOLATING_ANSWERS,
      })
      const blocked = await submitAssessmentRoute(
        makeRequest('POST', `/api/v1/rapid-assessments/${violatingDraft.id}/submit`, {
          token: tokenFor(assessor),
        }),
        withParams({ id: violatingDraft.id })
      )
      expect(blocked.status).toBe(400)
      const blockedBody = await jsonOf(blocked)
      expect(blockedBody.error).toBe('Cross-field validation failed')
      expect(blockedBody.details).toHaveLength(2)
      expect(
        (await testDb.rapidAssessment.findUniqueOrThrow({ where: { id: violatingDraft.id } }))
          .verificationStatus
      ).toBe('DRAFT')

      const cleanDraft = await createRapidAssessment({
        assessorId: assessor.id,
        entityId: entity.id,
        incidentId: incident.id,
        assessmentType: 'FOOD',
        verificationStatus: 'DRAFT',
        withSnapshot: true,
        answers: FOOD_CLEAN_ANSWERS,
      })
      const submitted = await submitAssessmentRoute(
        makeRequest('POST', `/api/v1/rapid-assessments/${cleanDraft.id}/submit`, {
          token: tokenFor(assessor),
        }),
        withParams({ id: cleanDraft.id })
      )
      expect(submitted.status).toBe(200)
      expect(
        (await testDb.rapidAssessment.findUniqueOrThrow({ where: { id: cleanDraft.id } }))
          .verificationStatus
      ).toBe('SUBMITTED')
    })
  })

  // ------------------------------------------------- offline replay exemption ---

  describe('offline replay exemption — POST /api/v1/sync/batch never rejects', () => {
    test('the same violating FOOD payload syncs as success + gapAnalysis.crossFieldViolations flag', async () => {
      const entity = await createEntity()
      const incident = await createIncident({ createdBy: coordinator.id })
      await createEntityAssignment({
        userId: assessor.id,
        entityId: entity.id,
        assignedBy: admin.id,
      })
      const offlineId = `offline-${Date.now().toString(36)}`

      const response = await syncBatchRoute(
        makeRequest('POST', '/api/v1/sync/batch', {
          body: {
            changes: [
              {
                type: 'assessment',
                action: 'create',
                data: {
                  type: 'FOOD',
                  rapidAssessmentDate: new Date().toISOString(),
                  assessorName: 'Offline Assessor',
                  entityId: entity.id,
                  incidentId: incident.id,
                  answers: FOOD_VIOLATING_ANSWERS,
                },
                offlineId,
                versionNumber: 1,
                entityUuid: entity.id,
              },
            ],
          },
          token: tokenFor(assessor),
        })
      )
      expect(response.status).toBe(200)
      const body = await jsonOf(response)
      expect(body.data.summary).toEqual({
        totalProcessed: 1,
        successful: 1,
        conflicts: 0,
        failed: 0,
      })
      expect(body.data.results[0].status).toBe('success')
      expect(body.data.results[0].serverId).toBe(offlineId)

      const row = await testDb.rapidAssessment.findUniqueOrThrow({ where: { id: offlineId } })
      expect(row.answers).toEqual(FOOD_VIOLATING_ANSWERS)
      const stored = row.gapAnalysis as {
        crossFieldViolations?: Array<{ key: string; kind: string; message: string }>
      } | null
      expect(stored?.crossFieldViolations).toHaveLength(2)
      expect(stored!.crossFieldViolations!.map((violation) => violation.key).sort()).toEqual([
        'additionalFoodRequiredPersons',
        'availableFoodDurationDays',
      ])
      expect(
        stored!.crossFieldViolations!.every((violation) => violation.kind === 'refinement')
      ).toBe(true)
    })

    test('clean offline payload stores NO crossFieldViolations key (additive-only)', async () => {
      const entity = await createEntity()
      const incident = await createIncident({ createdBy: coordinator.id })
      await createEntityAssignment({
        userId: assessor.id,
        entityId: entity.id,
        assignedBy: admin.id,
      })
      const offlineId = `offline-clean-${Date.now().toString(36)}`

      const response = await syncBatchRoute(
        makeRequest('POST', '/api/v1/sync/batch', {
          body: {
            changes: [
              {
                type: 'assessment',
                action: 'create',
                data: {
                  type: 'FOOD',
                  rapidAssessmentDate: new Date().toISOString(),
                  assessorName: 'Offline Assessor',
                  entityId: entity.id,
                  incidentId: incident.id,
                  answers: FOOD_CLEAN_ANSWERS,
                },
                offlineId,
                versionNumber: 1,
                entityUuid: entity.id,
              },
            ],
          },
          token: tokenFor(assessor),
        })
      )
      expect(response.status).toBe(200)
      const row = await testDb.rapidAssessment.findUniqueOrThrow({ where: { id: offlineId } })
      expect(
        (row.gapAnalysis as { crossFieldViolations?: unknown } | null)?.crossFieldViolations
      ).toBeUndefined()
    })

    test('offline UPDATE replay of a violating payload re-flags without rejecting', async () => {
      const entity = await createEntity()
      const incident = await createIncident({ createdBy: coordinator.id })
      await createEntityAssignment({
        userId: assessor.id,
        entityId: entity.id,
        assignedBy: admin.id,
      })
      const offlineId = `offline-upd-${Date.now().toString(36)}`

      const createResponse = await syncBatchRoute(
        makeRequest('POST', '/api/v1/sync/batch', {
          body: {
            changes: [
              {
                type: 'assessment',
                action: 'create',
                data: {
                  type: 'FOOD',
                  rapidAssessmentDate: new Date().toISOString(),
                  assessorName: 'Offline Assessor',
                  entityId: entity.id,
                  incidentId: incident.id,
                  answers: FOOD_CLEAN_ANSWERS,
                },
                offlineId,
                versionNumber: 1,
                entityUuid: entity.id,
              },
            ],
          },
          token: tokenFor(assessor),
        })
      )
      expect(createResponse.status).toBe(200)
      const clean = await testDb.rapidAssessment.findUniqueOrThrow({ where: { id: offlineId } })
      expect(
        (clean.gapAnalysis as { crossFieldViolations?: unknown } | null)?.crossFieldViolations
      ).toBeUndefined()

      // Offline UPDATE with answers delegates to the never-reject ingestion
      // path — violations flag the stored row, never reject the batch entry.
      const results = await SyncProcessingService.processBatch(
        [
          {
            type: 'assessment',
            action: 'update',
            data: {
              type: 'FOOD',
              assessorName: 'Offline Assessor',
              entityId: entity.id,
              incidentId: incident.id,
              answers: FOOD_VIOLATING_ANSWERS,
            },
            versionNumber: 2,
            entityUuid: offlineId,
            offlineId,
          },
        ],
        assessor.id
      )
      expect(results[0]).toMatchObject({ serverId: offlineId, status: 'success' })

      const updated = await testDb.rapidAssessment.findUniqueOrThrow({ where: { id: offlineId } })
      expect(updated.answers).toEqual(FOOD_VIOLATING_ANSWERS)
      const stored = updated.gapAnalysis as {
        crossFieldViolations?: Array<{ key: string; kind: string }>
      } | null
      expect(stored?.crossFieldViolations).toHaveLength(2)
      expect(stored!.crossFieldViolations!.map((violation) => violation.key).sort()).toEqual([
        'additionalFoodRequiredPersons',
        'availableFoodDurationDays',
      ])
      expect(
        stored!.crossFieldViolations!.every((violation) => violation.kind === 'refinement')
      ).toBe(true)
    })
  })

  // ------------------------------- deactivation guard + impact + severity surface ---

  describe('question-deactivation guard, impact preview, severity surface', () => {
    test('active rule referencing a question blocks deactivation; deactivating the rule lifts it', async () => {
      const section = await testDb.questionSection.findFirst({
        where: { assessmentType: 'SECURITY', category: 'CONTEXT' },
      })
      expect(section).not.toBeNull()
      const stamp = Date.now().toString(36)
      const questionKey = `guardProbe${stamp}`
      const ruleKey = `guard-rule-${stamp}`

      const created = await createQuestionRoute(
        makeRequest('POST', '/api/v1/admin/questions', {
          body: {
            assessmentType: 'SECURITY',
            questionKey,
            sectionId: section!.id,
            questionType: 'TEXT_LONG',
            label: 'Guard probe',
            category: 'CONTEXT',
            reason: 'P10-2 guard fixture',
          },
          token: tokenFor(admin),
        })
      )
      expect(created.status).toBe(201)
      const questionId = (await jsonOf(created)).data.id

      const ruleCreated = await createRuleRoute(
        makeRequest('POST', '/api/v1/admin/rules', {
          body: {
            assessmentType: 'SECURITY',
            ruleKey,
            kind: 'REFINEMENT',
            name: 'Guard rule',
            message: 'Guard probe must stay',
            expression: {
              op: '>',
              left: { type: 'question', key: questionKey },
              right: { type: 'literal', value: 0 },
            },
            referenceKeys: [questionKey],
            reason: 'P10-2 guard fixture',
          },
          token: tokenFor(admin),
        })
      )
      expect(ruleCreated.status).toBe(200)
      const ruleId = (await jsonOf(ruleCreated)).data.id

      // Impact preview quotes the referencing rule (read side of the guard).
      const impact = await impactRoute(
        makeRequest('GET', `/api/v1/admin/questions/${questionId}/impact`, {
          token: tokenFor(coordinator),
        }),
        withParams({ id: questionId })
      )
      expect(impact.status).toBe(200)
      const impactBody = await jsonOf(impact)
      expect(impactBody.data.referencingRules.map((rule: { ruleKey: string }) => rule.ruleKey)).toContain(ruleKey)

      // Guarded deactivation → 400 registry_invalid listing exactly the rule.
      const blocked = await deactivateQuestionRoute(
        makeRequest('DELETE', `/api/v1/admin/questions/${questionId}`, {
          body: { reason: 'must be blocked by the rule guard' },
          token: tokenFor(admin),
        }),
        withParams({ id: questionId })
      )
      expect(blocked.status).toBe(400)
      const blockedBody = await jsonOf(blocked)
      expect(blockedBody.error).toBe('registry_invalid')
      expect(blockedBody.details.errors.map((error: { ruleKey: string }) => error.ruleKey)).toEqual([
        ruleKey,
      ])
      expect(
        (await testDb.question.findUnique({ where: { id: questionId } }))?.isActive
      ).toBe(true)

      // Deactivating the rule lifts the guard…
      const ruleDelete = await deactivateRuleRoute(
        makeRequest('DELETE', `/api/v1/admin/rules/${ruleId}`, {
          body: { reason: 'lift the guard' },
          token: tokenFor(admin),
        }),
        withParams({ id: ruleId })
      )
      expect(ruleDelete.status).toBe(204)

      // …and the impact preview no longer lists it.
      const impactAfter = await impactRoute(
        makeRequest('GET', `/api/v1/admin/questions/${questionId}/impact`, {
          token: tokenFor(admin),
        }),
        withParams({ id: questionId })
      )
      expect(impactAfter.status).toBe(200)
      expect(
        (await jsonOf(impactAfter)).data.referencingRules.map(
          (rule: { ruleKey: string }) => rule.ruleKey
        )
      ).not.toContain(ruleKey)

      const freed = await deactivateQuestionRoute(
        makeRequest('DELETE', `/api/v1/admin/questions/${questionId}`, {
          body: { reason: 'guard lifted, retire the probe' },
          token: tokenFor(admin),
        }),
        withParams({ id: questionId })
      )
      expect(freed.status).toBe(204)
      expect(
        (await testDb.question.findUnique({ where: { id: questionId } }))?.isActive
      ).toBe(false)
    })

    test('impact lists the seeded FOOD rules referencing isFoodSufficient; ASSESSOR → 403', async () => {
      const question = await testDb.question.findFirstOrThrow({
        where: { assessmentType: 'FOOD', questionKey: 'isFoodSufficient' },
      })
      const response = await impactRoute(
        makeRequest('GET', `/api/v1/admin/questions/${question.id}/impact`, {
          token: tokenFor(coordinator),
        }),
        withParams({ id: question.id })
      )
      expect(response.status).toBe(200)
      const body = await jsonOf(response)
      expect(
        body.data.referencingRules.map((rule: { ruleKey: string }) => rule.ruleKey).sort()
      ).toEqual(['food-sufficient-but-additional-required', 'food-sufficient-but-short-duration'])

      const denied = await impactRoute(
        makeRequest('GET', `/api/v1/admin/questions/${question.id}/impact`, {
          token: tokenFor(assessor),
        }),
        withParams({ id: question.id })
      )
      expect(denied.status).toBe(403)
    })

    test('severity PATCH surfaces affectedIncidentIds of the re-derived population', async () => {
      const question = await testDb.question.findFirstOrThrow({
        where: { assessmentType: 'FOOD', questionKey: 'isFoodSufficient' },
      })
      // Deterministic starting severity (earlier suites may have edited it).
      await testDb.question.update({ where: { id: question.id }, data: { severity: 'MEDIUM' } })

      const entity = await createEntity()
      const activeIncident = await createIncident({ createdBy: coordinator.id, status: 'ACTIVE' })
      const resolvedIncident = await createIncident({ createdBy: coordinator.id, status: 'RESOLVED' })
      const affected = await createRapidAssessment({
        assessorId: assessor.id,
        entityId: entity.id,
        incidentId: activeIncident.id,
        assessmentType: 'FOOD',
        verificationStatus: 'VERIFIED',
        priority: 'MEDIUM',
        withSnapshot: true,
        answers: FOOD_GAP_ANSWERS,
      })
      const control = await createRapidAssessment({
        assessorId: assessor.id,
        entityId: entity.id,
        incidentId: resolvedIncident.id,
        assessmentType: 'FOOD',
        verificationStatus: 'VERIFIED',
        priority: 'MEDIUM',
        withSnapshot: true,
        answers: FOOD_GAP_ANSWERS,
      })

      const response = await patchSeverityRoute(
        makeRequest('PATCH', `/api/v1/admin/questions/${question.id}/severity`, {
          body: { severity: 'CRITICAL', reason: 'affectedIncidentIds probe' },
          token: tokenFor(admin),
        }),
        withParams({ id: question.id })
      )
      expect(response.status).toBe(200)
      const body = await jsonOf(response)
      expect(Array.isArray(body.data.affectedIncidentIds)).toBe(true)
      expect(body.data.affectedIncidentIds).toContain(activeIncident.id)
      expect(body.data.affectedIncidentIds).not.toContain(resolvedIncident.id)

      const row = await testDb.rapidAssessment.findUniqueOrThrow({ where: { id: affected.id } })
      expect(row.priority).toBe('CRITICAL')
      const controlRow = await testDb.rapidAssessment.findUniqueOrThrow({
        where: { id: control.id },
      })
      expect(controlRow.priority).toBe('MEDIUM')
    })
  })
})
