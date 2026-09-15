import { GET as getQuestionSetRoute } from '@/app/api/v1/questions/route'
import { POST as createQuestionRoute } from '@/app/api/v1/admin/questions/route'
import { PUT as updateQuestionRoute, DELETE as deactivateQuestionRoute } from '@/app/api/v1/admin/questions/[id]/route'
import { PATCH as patchSeverityRoute } from '@/app/api/v1/admin/questions/[id]/severity/route'
import { POST as reorderRoute } from '@/app/api/v1/admin/questions/reorder/route'
import { GET as exportRoute } from '@/app/api/v1/admin/questions/export/route'
import { POST as createSectionRoute } from '@/app/api/v1/admin/sections/route'
import { PUT as updateSectionRoute, DELETE as deleteSectionRoute } from '@/app/api/v1/admin/sections/[id]/route'
import { makeRequest, tokenFor, withParams, jsonOf, type AuthedUser } from '../helpers/api'
import {
  createUser,
  createEntity,
  createIncident,
  createRapidAssessment,
  ensureRoles,
  ensureQuestionRegistry,
} from '../factories'
import { testDb, truncateTestDb } from '../helpers/test-db'
import { getRegistryVersions } from '../../src/lib/questions/registry-versions'
import { analyzeGaps } from '../../src/lib/services/gap-analysis.service'

/**
 * P2 — Question registry governance API.
 *
 * Locks the I/O matrix of the admin registry surface: role gates, tiered
 * version bumps (Tier A → content, Tier B → structure), the freeze rule
 * (409 question_frozen on structural edits of keys present in snapshots of
 * non-DRAFT assessments under ACTIVE incidents), transactional atomicity
 * (failed structural actions leave rows/versions/audit untouched), key
 * immutability, registry_invalid rollback on deactivate-last-GAP, section
 * delete rules, reorder contiguity, and the audit trail.
 */

type AnyQuestion = {
  id: string
  questionKey: string
  label: string
  category: string
  severity: string
  required: boolean
  isActive: boolean
}

async function firstActiveQuestion(
  assessmentType: string,
  filter: Record<string, unknown> = {}
): Promise<AnyQuestion> {
  const question = await testDb.question.findFirst({
    where: { assessmentType, isActive: true, ...filter },
    orderBy: { order: 'asc' },
  })
  if (!question) throw new Error(`No active ${assessmentType} question matching ${JSON.stringify(filter)}`)
  return question as unknown as AnyQuestion
}

async function activeSections(assessmentType: string) {
  return testDb.questionSection.findMany({
    where: { assessmentType, isActive: true },
    orderBy: { order: 'asc' },
  })
}

function versionsOf(assessmentType: string) {
  return getRegistryVersions(testDb, assessmentType as 'HEALTH')
}

describe('P2 question registry governance', () => {
  let admin: AuthedUser
  let coordinator: AuthedUser
  let assessor: AuthedUser

  beforeAll(async () => {
    await truncateTestDb()
    await ensureRoles()
    await ensureQuestionRegistry()
    admin = (await createUser({ roles: ['ADMIN'] })) as AuthedUser
    coordinator = (await createUser({ roles: ['COORDINATOR'] })) as AuthedUser
    assessor = (await createUser({ roles: ['ASSESSOR'] })) as AuthedUser
  })

  afterAll(async () => {
    await truncateTestDb()
    await testDb.$disconnect()
  })

  // ---------------------------------------------------------------- reads ---

  describe('GET /api/v1/questions', () => {
    test('any authenticated user → 200 with sections + versions', async () => {
      const response = await getQuestionSetRoute(
        makeRequest('GET', '/api/v1/questions', {
          query: { assessmentType: 'HEALTH' },
          token: tokenFor(assessor),
        })
      )
      expect(response.status).toBe(200)
      const body = await jsonOf(response)
      expect(body.success).toBe(true)
      expect(body.data.sections.length).toBeGreaterThan(0)
      expect(typeof body.data.structureVersion).toBe('number')
      expect(typeof body.data.contentVersion).toBe('number')
    })

    test('missing assessmentType → 400', async () => {
      const response = await getQuestionSetRoute(
        makeRequest('GET', '/api/v1/questions', { token: tokenFor(assessor) })
      )
      expect(response.status).toBe(400)
    })

    test('unknown assessmentType → 404', async () => {
      const response = await getQuestionSetRoute(
        makeRequest('GET', '/api/v1/questions', {
          query: { assessmentType: 'LOGISTICS' },
          token: tokenFor(assessor),
        })
      )
      expect(response.status).toBe(404)
    })

    test('anonymous → 401', async () => {
      const response = await getQuestionSetRoute(
        makeRequest('GET', '/api/v1/questions', { query: { assessmentType: 'HEALTH' } })
      )
      expect(response.status).toBe(401)
    })

    test('includeInactive=1 — ADMIN 200, ASSESSOR 403', async () => {
      const ok = await getQuestionSetRoute(
        makeRequest('GET', '/api/v1/questions', {
          query: { assessmentType: 'HEALTH', includeInactive: 1 },
          token: tokenFor(admin),
        })
      )
      expect(ok.status).toBe(200)

      const denied = await getQuestionSetRoute(
        makeRequest('GET', '/api/v1/questions', {
          query: { assessmentType: 'HEALTH', includeInactive: 1 },
          token: tokenFor(assessor),
        })
      )
      expect(denied.status).toBe(403)
    })
  })

  // ------------------------------------------------- create section+question -

  describe('POST /api/v1/admin/sections + /api/v1/admin/questions', () => {
    let sectionId: string
    const sectionKey = `gov-ctx-${Date.now().toString(36)}`

    test('COORDINATOR → 403 on both routes', async () => {
      const sectionResponse = await createSectionRoute(
        makeRequest('POST', '/api/v1/admin/sections', {
          body: {
            assessmentType: 'SECURITY',
            sectionKey: `denied-${Date.now().toString(36)}`,
            title: 'Denied',
            category: 'CONTEXT',
            reason: 'should not happen',
          },
          token: tokenFor(coordinator),
        })
      )
      expect(sectionResponse.status).toBe(403)

      const questionResponse = await createQuestionRoute(
        makeRequest('POST', '/api/v1/admin/questions', {
          body: {
            assessmentType: 'SECURITY',
            questionKey: 'deniedQuestion',
            sectionId: 'any',
            questionType: 'BOOLEAN',
            label: 'Denied',
            category: 'CONTEXT',
            reason: 'should not happen',
          },
          token: tokenFor(coordinator),
        })
      )
      expect(questionResponse.status).toBe(403)
    })

    test('structural create without reason → 400 reason_required', async () => {
      const response = await createSectionRoute(
        makeRequest('POST', '/api/v1/admin/sections', {
          body: {
            assessmentType: 'SECURITY',
            sectionKey: `noreason-${Date.now().toString(36)}`,
            title: 'No reason',
            category: 'CONTEXT',
          },
          token: tokenFor(admin),
        })
      )
      expect(response.status).toBe(400)
      const body = await jsonOf(response)
      expect(body.error).toBe('reason_required')
    })

    test('ADMIN creates a section → 201 + structure bump + audit', async () => {
      const before = await versionsOf('SECURITY')
      const response = await createSectionRoute(
        makeRequest('POST', '/api/v1/admin/sections', {
          body: {
            assessmentType: 'SECURITY',
            sectionKey,
            title: 'Governance context',
            description: 'Created by the P2 governance suite',
            category: 'CONTEXT',
            reason: 'P2 test coverage',
          },
          token: tokenFor(admin),
        })
      )
      expect(response.status).toBe(201)
      const body = await jsonOf(response)
      sectionId = body.data.id
      expect(body.data.sectionKey).toBe(sectionKey)

      const after = await versionsOf('SECURITY')
      expect(after.structureVersion).toBe(before.structureVersion + 1)

      const audit = await testDb.questionAuditLog.findFirst({
        where: { entityType: 'SECTION', entityId: sectionId, action: 'SECTION_CREATE' },
      })
      expect(audit?.reason).toBe('P2 test coverage')
      expect(audit?.actorId).toBe(admin.id)
    })

    test('ADMIN creates a valid CONTEXT question → 201 + structure bump + audit', async () => {
      const before = await versionsOf('SECURITY')
      const beforeCount = await testDb.question.count({ where: { assessmentType: 'SECURITY' } })

      const response = await createQuestionRoute(
        makeRequest('POST', '/api/v1/admin/questions', {
          body: {
            assessmentType: 'SECURITY',
            questionKey: `govNotes${Date.now().toString(36)}`,
            sectionId,
            questionType: 'TEXT_LONG',
            label: 'Governance notes',
            category: 'CONTEXT',
            reason: 'P2 test coverage',
          },
          token: tokenFor(admin),
        })
      )
      expect(response.status).toBe(201)
      const body = await jsonOf(response)
      expect(body.data.isActive).toBe(true)

      const after = await versionsOf('SECURITY')
      expect(after.structureVersion).toBe(before.structureVersion + 1)
      expect(await testDb.question.count({ where: { assessmentType: 'SECURITY' } })).toBe(beforeCount + 1)

      const audit = await testDb.questionAuditLog.findFirst({
        where: { entityType: 'QUESTION', entityId: body.data.id, action: 'CREATE' },
      })
      expect(audit?.reason).toBe('P2 test coverage')
    })

    test('invalid question (category ≠ section category) → 400 registry_invalid, fully rolled back', async () => {
      const before = await versionsOf('SECURITY')
      const beforeCount = await testDb.question.count({ where: { assessmentType: 'SECURITY' } })
      const badKey = `govBadGap${Date.now().toString(36)}`

      const response = await createQuestionRoute(
        makeRequest('POST', '/api/v1/admin/questions', {
          body: {
            assessmentType: 'SECURITY',
            questionKey: badKey,
            sectionId,
            questionType: 'BOOLEAN',
            label: 'Bad GAP in a CONTEXT section',
            category: 'GAP',
            required: true,
            severity: 'HIGH',
            gapLabel: 'Gap',
            gapMeaning: 'Meaning',
            recommendation: 'Do something',
            reason: 'negative coverage',
          },
          token: tokenFor(admin),
        })
      )
      expect(response.status).toBe(400)
      const body = await jsonOf(response)
      expect(body.error).toBe('registry_invalid')
      expect(Array.isArray(body.details.errors)).toBe(true)
      expect(body.details.errors.join('\n')).toContain('does not match section')

      // Atomicity: no row, no version change, no audit row for the rejected key.
      expect(await testDb.question.count({ where: { assessmentType: 'SECURITY' } })).toBe(beforeCount)
      expect(await testDb.question.count({ where: { questionKey: badKey } })).toBe(0)
      expect(await versionsOf('SECURITY')).toEqual(before)
      const createdAudit = await testDb.questionAuditLog.findFirst({
        where: { action: 'CREATE', changes: { path: ['questionKey'], equals: badKey } },
      })
      expect(createdAudit).toBeNull()
    })
  })

  // -------------------------------------------------- tier governance (WASH) --

  describe('PUT /api/v1/admin/questions/[id] — tiered bumps (unfrozen)', () => {
    test('questionKey rename → 400 question_key_immutable, nothing changed', async () => {
      const question = await firstActiveQuestion('WASH')
      const before = await versionsOf('WASH')
      const response = await updateQuestionRoute(
        makeRequest('PUT', `/api/v1/admin/questions/${question.id}`, {
          body: { questionKey: 'renamedKey', reason: 'rename attempt' },
          token: tokenFor(admin),
        }),
        withParams({ id: question.id })
      )
      expect(response.status).toBe(400)
      const body = await jsonOf(response)
      expect(body.error).toBe('question_key_immutable')
      expect(await versionsOf('WASH')).toEqual(before)
      expect((await testDb.question.findUnique({ where: { id: question.id } }))?.questionKey).toBe(question.questionKey)
    })

    test('Tier A label edit → 200, content+1, structure unchanged, UPDATE audit', async () => {
      const question = await firstActiveQuestion('WASH')
      const before = await versionsOf('WASH')
      const newLabel = `${question.label} (edited)`

      const response = await updateQuestionRoute(
        makeRequest('PUT', `/api/v1/admin/questions/${question.id}`, {
          body: { label: newLabel, reason: 'clarify wording' },
          token: tokenFor(admin),
        }),
        withParams({ id: question.id })
      )
      expect(response.status).toBe(200)
      const body = await jsonOf(response)
      expect(body.data.label).toBe(newLabel)

      const after = await versionsOf('WASH')
      expect(after.structureVersion).toBe(before.structureVersion)
      expect(after.contentVersion).toBe(before.contentVersion + 1)

      const audit = await testDb.questionAuditLog.findFirst({
        where: { entityType: 'QUESTION', entityId: question.id, action: 'UPDATE' },
        orderBy: { actedAt: 'desc' },
      })
      expect(audit).not.toBeNull()
      expect((audit?.changes as { label?: { to?: string } })?.label?.to).toBe(newLabel)
    })

    test('Tier B required flip → 200, structure+1', async () => {
      const question = await firstActiveQuestion('WASH', { category: 'CONTEXT' })
      const before = await versionsOf('WASH')
      const targetRequired = !question.required

      const response = await updateQuestionRoute(
        makeRequest('PUT', `/api/v1/admin/questions/${question.id}`, {
          body: { required: targetRequired, reason: 'structural test' },
          token: tokenFor(admin),
        }),
        withParams({ id: question.id })
      )
      expect(response.status).toBe(200)
      const after = await versionsOf('WASH')
      expect(after.structureVersion).toBe(before.structureVersion + 1)
    })

    test('no-op edit → 200, no version change, no new audit', async () => {
      const question = await firstActiveQuestion('WASH')
      const before = await versionsOf('WASH')
      const auditBefore = await testDb.questionAuditLog.count({ where: { entityId: question.id } })

      const response = await updateQuestionRoute(
        makeRequest('PUT', `/api/v1/admin/questions/${question.id}`, {
          body: { label: question.label, reason: 'no-op' },
          token: tokenFor(admin),
        }),
        withParams({ id: question.id })
      )
      expect(response.status).toBe(200)
      expect(await versionsOf('WASH')).toEqual(before)
      expect(await testDb.questionAuditLog.count({ where: { entityId: question.id } })).toBe(auditBefore)
    })
  })

  // -------------------------------------------------------- freeze rule ------

  describe('freeze rule — structural edits of frozen keys', () => {
    describe('non-DRAFT assessment under ACTIVE incident → 409 + atomic', () => {
      let frozenQuestion: AnyQuestion

      beforeAll(async () => {
        const entity = await createEntity()
        const incident = await createIncident({ createdBy: coordinator.id }) // status ACTIVE by default
        await createRapidAssessment({
          assessorId: assessor.id,
          entityId: entity.id,
          incidentId: incident.id,
          assessmentType: 'HEALTH',
          verificationStatus: 'SUBMITTED',
          withSnapshot: true,
        })
        frozenQuestion = await firstActiveQuestion('HEALTH', { category: 'CONTEXT' })
      })

      test('Tier B edit → 409 question_frozen with affectedCount; nothing changed', async () => {
        const before = await versionsOf('HEALTH')
        const auditBefore = await testDb.questionAuditLog.count({ where: { entityId: frozenQuestion.id } })
        const targetRequired = !frozenQuestion.required

        const response = await updateQuestionRoute(
          makeRequest('PUT', `/api/v1/admin/questions/${frozenQuestion.id}`, {
            body: { required: targetRequired, reason: 'attempt on frozen key' },
            token: tokenFor(admin),
          }),
          withParams({ id: frozenQuestion.id })
        )
        expect(response.status).toBe(409)
        const body = await jsonOf(response)
        expect(body.error).toBe('question_frozen')
        expect(body.details.affectedCount).toBeGreaterThanOrEqual(1)
        expect(body.details.questionKey).toBe(frozenQuestion.questionKey)

        // Atomicity: row, versions, and audit untouched.
        const row = await testDb.question.findUnique({ where: { id: frozenQuestion.id } })
        expect(row?.required).toBe(frozenQuestion.required)
        expect(await versionsOf('HEALTH')).toEqual(before)
        expect(await testDb.questionAuditLog.count({ where: { entityId: frozenQuestion.id } })).toBe(auditBefore)
      })

      test('DELETE (deactivate) frozen question → 409', async () => {
        const before = await versionsOf('HEALTH')
        const response = await deactivateQuestionRoute(
          makeRequest('DELETE', `/api/v1/admin/questions/${frozenQuestion.id}`, {
            body: { reason: 'attempt on frozen key' },
            token: tokenFor(admin),
          }),
          withParams({ id: frozenQuestion.id })
        )
        expect(response.status).toBe(409)
        expect(await versionsOf('HEALTH')).toEqual(before)
        expect((await testDb.question.findUnique({ where: { id: frozenQuestion.id } }))?.isActive).toBe(true)
      })

      test('Tier A label edit on the same frozen key → 200 (content edits always allowed)', async () => {
        const before = await versionsOf('HEALTH')
        const newLabel = `${frozenQuestion.label} v2`
        const response = await updateQuestionRoute(
          makeRequest('PUT', `/api/v1/admin/questions/${frozenQuestion.id}`, {
            body: { label: newLabel, reason: 'content edit on frozen key' },
            token: tokenFor(admin),
          }),
          withParams({ id: frozenQuestion.id })
        )
        expect(response.status).toBe(200)
        const after = await versionsOf('HEALTH')
        expect(after.structureVersion).toBe(before.structureVersion)
        expect(after.contentVersion).toBe(before.contentVersion + 1)
      })
    })

    test('DRAFT assessments never freeze → Tier B edit 200 (SHELTER)', async () => {
      const entity = await createEntity()
      const incident = await createIncident({ createdBy: coordinator.id })
      await createRapidAssessment({
        assessorId: assessor.id,
        entityId: entity.id,
        incidentId: incident.id,
        assessmentType: 'SHELTER',
        verificationStatus: 'DRAFT',
        withSnapshot: true,
      })

      const question = await firstActiveQuestion('SHELTER', { category: 'CONTEXT' })
      const before = await versionsOf('SHELTER')
      const response = await updateQuestionRoute(
        makeRequest('PUT', `/api/v1/admin/questions/${question.id}`, {
          body: { required: !question.required, reason: 'draft assessments do not freeze' },
          token: tokenFor(admin),
        }),
        withParams({ id: question.id })
      )
      expect(response.status).toBe(200)
      const after = await versionsOf('SHELTER')
      expect(after.structureVersion).toBe(before.structureVersion + 1)
    })

    test('RESOLVED incidents do not freeze → Tier B edit 200 (SECURITY)', async () => {
      const entity = await createEntity()
      const incident = await createIncident({ createdBy: coordinator.id, status: 'RESOLVED' })
      await createRapidAssessment({
        assessorId: assessor.id,
        entityId: entity.id,
        incidentId: incident.id,
        assessmentType: 'SECURITY',
        verificationStatus: 'SUBMITTED',
        withSnapshot: true,
      })

      const question = await firstActiveQuestion('SECURITY', { category: 'CONTEXT' })
      const before = await versionsOf('SECURITY')
      const response = await updateQuestionRoute(
        makeRequest('PUT', `/api/v1/admin/questions/${question.id}`, {
          body: { required: !question.required, reason: 'resolved incidents do not freeze' },
          token: tokenFor(admin),
        }),
        withParams({ id: question.id })
      )
      expect(response.status).toBe(200)
      const after = await versionsOf('SECURITY')
      expect(after.structureVersion).toBe(before.structureVersion + 1)
    })
  })

  // ---------------------------------------------------------- severity -------

  describe('PATCH /api/v1/admin/questions/[id]/severity — ADMIN or COORDINATOR, GAP only', () => {
    test('COORDINATOR sets GAP severity → 200, content bump only, UPDATE_SEVERITY audit, affectedCount surfaced', async () => {
      const question = await firstActiveQuestion('FOOD', { category: 'GAP' })
      const newSeverity = question.severity === 'HIGH' ? 'CRITICAL' : 'HIGH'
      const before = await versionsOf('FOOD')

      const response = await patchSeverityRoute(
        makeRequest('PATCH', `/api/v1/admin/questions/${question.id}/severity`, {
          body: { severity: newSeverity, reason: 'coordinator severity tuning' },
          token: tokenFor(coordinator),
        }),
        withParams({ id: question.id })
      )
      expect(response.status).toBe(200)
      const body = await jsonOf(response)
      expect(body.data.question.severity).toBe(newSeverity)
      expect(typeof body.data.affectedCount).toBe('number')

      const after = await versionsOf('FOOD')
      expect(after.structureVersion).toBe(before.structureVersion)
      expect(after.contentVersion).toBe(before.contentVersion + 1)

      const audit = await testDb.questionAuditLog.findFirst({
        where: { entityType: 'QUESTION', entityId: question.id, action: 'UPDATE_SEVERITY' },
        orderBy: { actedAt: 'desc' },
      })
      expect(audit).not.toBeNull()
      expect((audit?.changes as { severity?: string })?.severity).toBe(newSeverity)
    })

    test('severity edit re-derives affected ACTIVE-incident assessments in-transaction (P3 derivation rule)', async () => {
      const question = await firstActiveQuestion('FOOD', { questionKey: 'isFoodSufficient' })
      // Deterministic starting point (earlier tests in this file may have edited it).
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
        sectors: { food: { isFoodSufficient: false, hasRegularMealAccess: true, hasInfantNutrition: true } },
      })
      const controlResolved = await createRapidAssessment({
        assessorId: assessor.id,
        entityId: entity.id,
        incidentId: resolvedIncident.id,
        assessmentType: 'FOOD',
        verificationStatus: 'VERIFIED',
        priority: 'MEDIUM',
        withSnapshot: true,
        sectors: { food: { isFoodSufficient: false, hasRegularMealAccess: true, hasInfantNutrition: true } },
      })
      const controlOtherType = await createRapidAssessment({
        assessorId: assessor.id,
        entityId: entity.id,
        incidentId: activeIncident.id,
        assessmentType: 'WASH',
        verificationStatus: 'VERIFIED',
        withSnapshot: true,
        sectors: { wash: { hasOpenDefecationConcerns: false } },
      })

      const before = await testDb.rapidAssessment.findUniqueOrThrow({ where: { id: affected.id } })
      // Mirror the recompute matcher (FOOD, ACTIVE incident, snapshot contains
      // the key, answers present) so the expected count is deterministic.
      const candidates = await testDb.rapidAssessment.findMany({
        where: { rapidAssessmentType: 'FOOD', incident: { status: 'ACTIVE' } },
        select: { questionSnapshot: true, answers: true },
      })
      const expectedAffected = candidates.filter(
        (row) => row.answers !== null && JSON.stringify(row.questionSnapshot).includes('"key":"isFoodSufficient"')
      ).length
      expect(expectedAffected).toBeGreaterThanOrEqual(1)

      const beforeVersions = await versionsOf('FOOD')
      const response = await patchSeverityRoute(
        makeRequest('PATCH', `/api/v1/admin/questions/${question.id}/severity`, {
          body: { severity: 'CRITICAL', reason: 'derivation-rule proof' },
          token: tokenFor(coordinator),
        }),
        withParams({ id: question.id })
      )
      expect(response.status).toBe(200)
      const body = await jsonOf(response)
      expect(body.data.affectedCount).toBe(expectedAffected)

      const after = await testDb.rapidAssessment.findUniqueOrThrow({ where: { id: affected.id } })
      expect(after.priority).toBe('CRITICAL')
      expect((after.gapAnalysis as { severity?: string } | null)?.severity).toBe('CRITICAL')
      expect(
        (after.gapAnalysis as { fieldSeverityMap?: Record<string, string> } | null)?.fieldSeverityMap
          ?.isFoodSufficient
      ).toBe('CRITICAL')
      // Snapshots and the assessment's version stamps are untouched.
      expect(after.structureVersion).toBe(before.structureVersion)
      expect(after.contentVersion).toBe(before.contentVersion)
      expect(JSON.stringify(after.questionSnapshot)).toBe(JSON.stringify(before.questionSnapshot))
      const afterVersions = await versionsOf('FOOD')
      expect(afterVersions.contentVersion).toBe(beforeVersions.contentVersion + 1)
      expect(afterVersions.structureVersion).toBe(beforeVersions.structureVersion)

      // Controls: non-ACTIVE incident and snapshot-without-key stay untouched.
      const resolvedRow = await testDb.rapidAssessment.findUniqueOrThrow({
        where: { id: controlResolved.id },
      })
      expect(resolvedRow.priority).toBe('MEDIUM')
      expect(resolvedRow.gapAnalysis).toBeNull()
      const otherTypeRow = await testDb.rapidAssessment.findUniqueOrThrow({
        where: { id: controlOtherType.id },
      })
      expect(otherTypeRow.gapAnalysis).toBeNull()

      // Incident severity propagates bottom-up from the re-derived priority.
      const incidentAfter = await testDb.incident.findUniqueOrThrow({
        where: { id: activeIncident.id },
      })
      expect(incidentAfter.severity).toBe('CRITICAL')

      // Identity edit: no recompute, no content bump.
      const noop = await patchSeverityRoute(
        makeRequest('PATCH', `/api/v1/admin/questions/${question.id}/severity`, {
          body: { severity: 'CRITICAL', reason: 'identity edit' },
          token: tokenFor(coordinator),
        }),
        withParams({ id: question.id })
      )
      expect(noop.status).toBe(200)
      const noopBody = await jsonOf(noop)
      expect(noopBody.data.affectedCount).toBe(0)
      expect((await versionsOf('FOOD')).contentVersion).toBe(afterVersions.contentVersion)

      // Cleanup: downstream freeze-rule tests in this file must not see these
      // ACTIVE-incident snapshots (structural edits would 409 question_frozen).
      await testDb.rapidAssessment.deleteMany({
        where: { id: { in: [affected.id, controlResolved.id, controlOtherType.id] } },
      })
      await testDb.incident.deleteMany({
        where: { id: { in: [activeIncident.id, resolvedIncident.id] } },
      })
      await testDb.entity.deleteMany({ where: { id: entity.id } })
    })

    test('CONTEXT question → 400 severity_not_editable', async () => {
      const question = await firstActiveQuestion('FOOD', { category: 'CONTEXT' })
      const response = await patchSeverityRoute(
        makeRequest('PATCH', `/api/v1/admin/questions/${question.id}/severity`, {
          body: { severity: 'HIGH', reason: 'invalid target' },
          token: tokenFor(admin),
        }),
        withParams({ id: question.id })
      )
      expect(response.status).toBe(400)
      const body = await jsonOf(response)
      expect(body.error).toBe('severity_not_editable')
    })

    test('LOW is not a valid GAP severity on the wire → 400 validation', async () => {
      const question = await firstActiveQuestion('FOOD', { category: 'GAP' })
      const response = await patchSeverityRoute(
        makeRequest('PATCH', `/api/v1/admin/questions/${question.id}/severity`, {
          body: { severity: 'LOW', reason: 'invalid value' },
          token: tokenFor(admin),
        }),
        withParams({ id: question.id })
      )
      expect(response.status).toBe(400)
    })

    test('ASSESSOR → 403', async () => {
      const question = await firstActiveQuestion('FOOD', { category: 'GAP' })
      const response = await patchSeverityRoute(
        makeRequest('PATCH', `/api/v1/admin/questions/${question.id}/severity`, {
          body: { severity: 'HIGH', reason: 'role gate' },
          token: tokenFor(assessor),
        }),
        withParams({ id: question.id })
      )
      expect(response.status).toBe(403)
    })

    test('COORDINATOR cannot use the ADMIN-only PUT → 403', async () => {
      const question = await firstActiveQuestion('FOOD', { category: 'GAP' })
      const response = await updateQuestionRoute(
        makeRequest('PUT', `/api/v1/admin/questions/${question.id}`, {
          body: { label: `${question.label} x`, reason: 'role gate' },
          token: tokenFor(coordinator),
        }),
        withParams({ id: question.id })
      )
      expect(response.status).toBe(403)
    })
  })

  // ------------------------------------------------------------ reorder ------

  describe('POST /api/v1/admin/questions/reorder (POPULATION)', () => {
    test('partial sectionIds → 400 reorder_scope_mismatch', async () => {
      const sections = await activeSections('POPULATION')
      const response = await reorderRoute(
        makeRequest('POST', '/api/v1/admin/questions/reorder', {
          body: { sectionIds: [sections[0].id], reason: 'scope probe' },
          token: tokenFor(admin),
        })
      )
      expect(response.status).toBe(400)
      const body = await jsonOf(response)
      expect(body.error).toBe('reorder_scope_mismatch')
    })

    test('full section list reversed → 200, contiguous 1..n, structure bump', async () => {
      const sections = await activeSections('POPULATION')
      const before = await versionsOf('POPULATION')
      const reversed = [...sections].reverse().map((s) => s.id)

      const response = await reorderRoute(
        makeRequest('POST', '/api/v1/admin/questions/reorder', {
          body: { sectionIds: reversed, reason: 'P2 reorder coverage' },
          token: tokenFor(admin),
        })
      )
      expect(response.status).toBe(200)
      const body = await jsonOf(response)
      expect(body.data.reordered).toBe(reversed.length)

      const after = await versionsOf('POPULATION')
      expect(after.structureVersion).toBe(before.structureVersion + 1)

      const rows = await testDb.questionSection.findMany({
        where: { id: { in: reversed } },
        orderBy: { order: 'asc' },
      })
      expect(rows.map((r) => r.order)).toEqual(reversed.map((_, index) => index + 1))
      expect(rows.map((r) => r.id)).toEqual(reversed)

      const audit = await testDb.questionAuditLog.findFirst({
        where: { action: 'REORDER', entityType: 'SECTION' },
        orderBy: { actedAt: 'desc' },
      })
      expect(audit?.reason).toBe('P2 reorder coverage')
    })

    test('question reorder — subset → 400; full list reversed → 200 contiguous', async () => {
      const sections = await activeSections('POPULATION')
      let section = sections[0]
      let questions = await testDb.question.findMany({
        where: { sectionId: section.id, isActive: true },
        orderBy: { order: 'asc' },
      })
      for (const candidate of sections) {
        if (questions.length > 1) break
        section = candidate
        questions = await testDb.question.findMany({
          where: { sectionId: candidate.id, isActive: true },
          orderBy: { order: 'asc' },
        })
      }
      expect(questions.length).toBeGreaterThan(1)

      const subset = await reorderRoute(
        makeRequest('POST', '/api/v1/admin/questions/reorder', {
          body: { sectionId: section.id, questionIds: [questions[0].id], reason: 'subset probe' },
          token: tokenFor(admin),
        })
      )
      expect(subset.status).toBe(400)

      const before = await versionsOf('POPULATION')
      const reversed = [...questions].reverse().map((q) => q.id)
      const response = await reorderRoute(
        makeRequest('POST', '/api/v1/admin/questions/reorder', {
          body: { sectionId: section.id, questionIds: reversed, reason: 'P2 question reorder' },
          token: tokenFor(admin),
        })
      )
      expect(response.status).toBe(200)
      const after = await versionsOf('POPULATION')
      expect(after.structureVersion).toBe(before.structureVersion + 1)

      const rows = await testDb.question.findMany({
        where: { sectionId: section.id, isActive: true },
        orderBy: { order: 'asc' },
      })
      expect(rows.map((r) => r.id)).toEqual(reversed)
      expect(rows.map((r) => r.order)).toEqual(reversed.map((_, index) => index + 1))
    })

    test('moved section whose keys are frozen → 409, orders untouched', async () => {
      const entity = await createEntity()
      const incident = await createIncident({ createdBy: coordinator.id })
      await createRapidAssessment({
        assessorId: assessor.id,
        entityId: entity.id,
        incidentId: incident.id,
        assessmentType: 'POPULATION',
        verificationStatus: 'SUBMITTED',
        withSnapshot: true,
      })

      const sections = await activeSections('POPULATION')
      const before = await versionsOf('POPULATION')
      const beforeOrders = new Map(sections.map((s) => [s.id, s.order]))
      const reversed = [...sections].reverse().map((s) => s.id)

      const response = await reorderRoute(
        makeRequest('POST', '/api/v1/admin/questions/reorder', {
          body: { sectionIds: reversed, reason: 'frozen reorder attempt' },
          token: tokenFor(admin),
        })
      )
      expect(response.status).toBe(409)
      const body = await jsonOf(response)
      expect(body.error).toBe('question_frozen')
      expect(body.details.affectedCount).toBeGreaterThanOrEqual(1)

      expect(await versionsOf('POPULATION')).toEqual(before)
      const rows = await testDb.questionSection.findMany({ where: { id: { in: reversed } } })
      for (const row of rows) {
        expect(row.order).toBe(beforeOrders.get(row.id))
      }
    })
  })

  // ------------------------------------------- deactivate + registry_invalid --

  describe('DELETE /api/v1/admin/questions/[id] (FOOD)', () => {
    test('deactivating one of several GAP questions → 204 + structure bump', async () => {
      const gapQuestions = await testDb.question.findMany({
        where: { assessmentType: 'FOOD', category: 'GAP', isActive: true },
      })
      expect(gapQuestions.length).toBeGreaterThanOrEqual(2)

      const before = await versionsOf('FOOD')
      const response = await deactivateQuestionRoute(
        makeRequest('DELETE', `/api/v1/admin/questions/${gapQuestions[0].id}`, {
          body: { reason: 'retire redundant gap question' },
          token: tokenFor(admin),
        }),
        withParams({ id: gapQuestions[0].id })
      )
      expect(response.status).toBe(204)
      expect((await testDb.question.findUnique({ where: { id: gapQuestions[0].id } }))?.isActive).toBe(false)
      const after = await versionsOf('FOOD')
      expect(after.structureVersion).toBe(before.structureVersion + 1)
    })

    test('deactivating without reason → 400 reason_required', async () => {
      const question = await firstActiveQuestion('FOOD', { category: 'CONTEXT' })
      const response = await deactivateQuestionRoute(
        makeRequest('DELETE', `/api/v1/admin/questions/${question.id}`, {
          token: tokenFor(admin),
        }),
        withParams({ id: question.id })
      )
      expect(response.status).toBe(400)
      const body = await jsonOf(response)
      expect(body.error).toBe('reason_required')
      expect((await testDb.question.findUnique({ where: { id: question.id } }))?.isActive).toBe(true)
    })

    test('deactivating the LAST active GAP → 400 registry_invalid, rolled back', async () => {
      const remainingGaps = await testDb.question.findMany({
        where: { assessmentType: 'FOOD', category: 'GAP', isActive: true },
      })
      expect(remainingGaps.length).toBeGreaterThanOrEqual(2)
      const last = remainingGaps[0]

      // Directly park all but the last GAP as inactive (outside the API —
      // fixture setup), so `last` is the final active GAP of FOOD.
      await testDb.question.updateMany({
        where: { id: { in: remainingGaps.slice(1).map((q) => q.id) } },
        data: { isActive: false },
      })

      const before = await versionsOf('FOOD')
      const response = await deactivateQuestionRoute(
        makeRequest('DELETE', `/api/v1/admin/questions/${last.id}`, {
          body: { reason: 'attempt to remove the last GAP' },
          token: tokenFor(admin),
        }),
        withParams({ id: last.id })
      )
      expect(response.status).toBe(400)
      const body = await jsonOf(response)
      expect(body.error).toBe('registry_invalid')
      expect(body.details.errors.join('\n')).toContain('at least one active GAP')

      // Rollback: the last GAP is still active and versions did not move.
      expect((await testDb.question.findUnique({ where: { id: last.id } }))?.isActive).toBe(true)
      expect(await versionsOf('FOOD')).toEqual(before)
    })
  })

  // ------------------------------------------------------ section lifecycle --

  describe('section update/delete rules', () => {
    test('DELETE non-empty section → 400 section_not_empty', async () => {
      const section = await testDb.questionSection.findFirst({
        where: { assessmentType: 'SECURITY', questions: { some: {} } },
      })
      expect(section).not.toBeNull()

      const response = await deleteSectionRoute(
        makeRequest('DELETE', `/api/v1/admin/sections/${section!.id}`, {
          body: { reason: 'must be rejected' },
          token: tokenFor(admin),
        }),
        withParams({ id: section!.id })
      )
      expect(response.status).toBe(400)
      const body = await jsonOf(response)
      expect(body.error).toBe('section_not_empty')
      expect(await testDb.questionSection.findUnique({ where: { id: section!.id } })).not.toBeNull()
    })

    test('empty section — title PUT content-only; DELETE → 204 + audit', async () => {
      const sectionKey = `gov-empty-${Date.now().toString(36)}`
      const created = await createSectionRoute(
        makeRequest('POST', '/api/v1/admin/sections', {
          body: {
            assessmentType: 'POPULATION',
            sectionKey,
            title: 'Disposable section',
            category: 'CONTEXT',
            reason: 'empty-section lifecycle fixture',
          },
          token: tokenFor(admin),
        })
      )
      expect(created.status).toBe(201)
      const { id } = await jsonOf(created).then((b) => b.data)

      const before = await versionsOf('POPULATION')
      const titlePut = await updateSectionRoute(
        makeRequest('PUT', `/api/v1/admin/sections/${id}`, {
          body: { title: 'Disposable section v2', reason: 'tier A section edit' },
          token: tokenFor(admin),
        }),
        withParams({ id })
      )
      expect(titlePut.status).toBe(200)
      let after = await versionsOf('POPULATION')
      expect(after.structureVersion).toBe(before.structureVersion)
      expect(after.contentVersion).toBe(before.contentVersion + 1)

      const del = await deleteSectionRoute(
        makeRequest('DELETE', `/api/v1/admin/sections/${id}`, {
          body: { reason: 'cleanup disposable section' },
          token: tokenFor(admin),
        }),
        withParams({ id })
      )
      expect(del.status).toBe(204)
      expect(await testDb.questionSection.findUnique({ where: { id } })).toBeNull()
      after = await versionsOf('POPULATION')
      expect(after.structureVersion).toBe(before.structureVersion + 1) // the DELETE (create bump pre-dates `before`)

      const audit = await testDb.questionAuditLog.findFirst({
        where: { entityType: 'SECTION', entityId: id, action: 'SECTION_DELETE' },
      })
      expect(audit?.reason).toBe('cleanup disposable section')
    })
  })

  // ------------------------------------------------------------- export ------

  describe('GET /api/v1/admin/questions/export', () => {
    test('ADMIN → 200 full-registry document', async () => {
      const response = await exportRoute(
        makeRequest('GET', '/api/v1/admin/questions/export', { token: tokenFor(admin) })
      )
      expect(response.status).toBe(200)
      const body = await jsonOf(response)
      expect(body.data.schemaVersion).toBe(1)
      expect(body.data.types).toHaveLength(6)
      const wash = body.data.types.find((t: { assessmentType: string }) => t.assessmentType === 'WASH')
      expect(wash.sections.length).toBeGreaterThan(0)
      expect(typeof wash.structureVersion).toBe('number')
    })

    test('COORDINATOR → 403; anonymous → 401', async () => {
      const denied = await exportRoute(
        makeRequest('GET', '/api/v1/admin/questions/export', { token: tokenFor(coordinator) })
      )
      expect(denied.status).toBe(403)

      const anon = await exportRoute(makeRequest('GET', '/api/v1/admin/questions/export'))
      expect(anon.status).toBe(401)
    })
  })

  // --------------------------------------------- review round 1 — patches ----

  describe('review round 1 — regression coverage for triaged patches', () => {
    type Option = { value: string; label: string; description?: string }

    test('PUT options: [] → 400 registry_invalid (no silent no-op), versions unchanged', async () => {
      const row = await testDb.question.findFirst({ where: { assessmentType: 'WASH', questionKey: 'waterSource' } })
      expect(row).not.toBeNull()
      const before = await versionsOf('WASH')

      const response = await updateQuestionRoute(
        makeRequest('PUT', `/api/v1/admin/questions/${row!.id}`, {
          body: { options: [], reason: 'attempt to clear options' },
          token: tokenFor(admin),
        }),
        withParams({ id: row!.id })
      )
      expect(response.status).toBe(400)
      const body = await jsonOf(response)
      expect(body.error).toBe('registry_invalid')
      expect(await versionsOf('WASH')).toEqual(before)
    })

    test('option append → content-only bump; option value removal → structure bump', async () => {
      const row = await testDb.question.findFirst({ where: { assessmentType: 'WASH', questionKey: 'waterSource' } })
      const original = row!.options as Option[]

      // Append (Tier A): content+1, structure unchanged.
      let before = await versionsOf('WASH')
      let response = await updateQuestionRoute(
        makeRequest('PUT', `/api/v1/admin/questions/${row!.id}`, {
          body: { options: [...original, { value: 'Well', label: 'Well' }], reason: 'append option' },
          token: tokenFor(admin),
        }),
        withParams({ id: row!.id })
      )
      expect(response.status).toBe(200)
      let after = await versionsOf('WASH')
      expect(after.structureVersion).toBe(before.structureVersion)
      expect(after.contentVersion).toBe(before.contentVersion + 1)

      // Remove an existing value (Tier B): structure+1 (and content+1 — the copy changed too).
      before = after
      response = await updateQuestionRoute(
        makeRequest('PUT', `/api/v1/admin/questions/${row!.id}`, {
          body: { options: original.filter((o) => o.value !== 'Other'), reason: 'remove option value' },
          token: tokenFor(admin),
        }),
        withParams({ id: row!.id })
      )
      expect(response.status).toBe(200)
      after = await versionsOf('WASH')
      expect(after.structureVersion).toBe(before.structureVersion + 1)
      expect(after.contentVersion).toBe(before.contentVersion + 1)

      // Restore (append back, Tier A).
      before = after
      response = await updateQuestionRoute(
        makeRequest('PUT', `/api/v1/admin/questions/${row!.id}`, {
          body: { options: original, reason: 'restore options' },
          token: tokenFor(admin),
        }),
        withParams({ id: row!.id })
      )
      expect(response.status).toBe(200)
      after = await versionsOf('WASH')
      expect(after.structureVersion).toBe(before.structureVersion)
      expect(after.contentVersion).toBe(before.contentVersion + 1)
    })

    test('numberMin > numberMax → 400 number_bounds_invalid on create and on merged update', async () => {
      const section = await testDb.questionSection.findFirst({
        where: { assessmentType: 'SECURITY', category: 'CONTEXT' },
      })
      expect(section).not.toBeNull()
      const stamp = Date.now().toString(36)

      const bad = await createQuestionRoute(
        makeRequest('POST', '/api/v1/admin/questions', {
          body: {
            assessmentType: 'SECURITY',
            questionKey: `boundsBad${stamp}`,
            sectionId: section!.id,
            questionType: 'NUMBER',
            label: 'Bounds probe',
            required: true,
            category: 'CONTEXT',
            numberMin: 10,
            numberMax: 5,
            reason: 'bounds negative test',
          },
          token: tokenFor(admin),
        })
      )
      expect(bad.status).toBe(400)
      expect((await jsonOf(bad)).error).toBe('number_bounds_invalid')

      const ok = await createQuestionRoute(
        makeRequest('POST', '/api/v1/admin/questions', {
          body: {
            assessmentType: 'SECURITY',
            questionKey: `boundsOk${stamp}`,
            sectionId: section!.id,
            questionType: 'NUMBER',
            label: 'Bounds fixture',
            required: true,
            category: 'CONTEXT',
            numberMin: 0,
            numberMax: 5,
            reason: 'bounds fixture',
          },
          token: tokenFor(admin),
        })
      )
      expect(ok.status).toBe(201)
      const created = await jsonOf(ok).then((b) => b.data)

      // Payload sets only numberMin; the stored numberMax (5) makes 10 > 5.
      const conflict = await updateQuestionRoute(
        makeRequest('PUT', `/api/v1/admin/questions/${created.id}`, {
          body: { numberMin: 10, reason: 'merged bounds check' },
          token: tokenFor(admin),
        }),
        withParams({ id: created.id })
      )
      expect(conflict.status).toBe(400)
      expect((await jsonOf(conflict)).error).toBe('number_bounds_invalid')
    })

    test('explicit order colliding with an existing row → 409 order_conflict (create + update + section)', async () => {
      const section = await testDb.questionSection.findFirst({
        where: { assessmentType: 'SECURITY', category: 'CONTEXT' },
      })
      const stamp = Date.now().toString(36)

      const createClash = await createQuestionRoute(
        makeRequest('POST', '/api/v1/admin/questions', {
          body: {
            assessmentType: 'SECURITY',
            questionKey: `orderClash${stamp}`,
            sectionId: section!.id,
            questionType: 'TEXT_LONG',
            label: 'Order clash',
            category: 'CONTEXT',
            order: 1, // the section's first question already occupies order 1
            reason: 'order conflict probe',
          },
          token: tokenFor(admin),
        })
      )
      expect(createClash.status).toBe(409)
      expect((await jsonOf(createClash)).error).toBe('order_conflict')

      const existing = await testDb.question.findFirst({
        where: { sectionId: section!.id },
        orderBy: { order: 'asc' },
      })
      const other = await testDb.question.findFirst({
        where: { sectionId: section!.id, id: { not: existing!.id } },
        orderBy: { order: 'asc' },
      })
      if (other) {
        const updateClash = await updateQuestionRoute(
          makeRequest('PUT', `/api/v1/admin/questions/${existing!.id}`, {
            body: { order: other.order, reason: 'order conflict on update' },
            token: tokenFor(admin),
          }),
          withParams({ id: existing!.id })
        )
        expect(updateClash.status).toBe(409)
        expect((await jsonOf(updateClash)).error).toBe('order_conflict')
      }

      const sectionClash = await createSectionRoute(
        makeRequest('POST', '/api/v1/admin/sections', {
          body: {
            assessmentType: 'SECURITY',
            sectionKey: `order-clash-${stamp}`,
            title: 'Order clash',
            category: 'CONTEXT',
            order: 1, // first SECURITY section occupies order 1
            reason: 'section order conflict probe',
          },
          token: tokenFor(admin),
        })
      )
      expect(sectionClash.status).toBe(409)
      expect((await jsonOf(sectionClash)).error).toBe('order_conflict')
    })

    test('duplicate keys → 409 question_key_duplicate / section_key_duplicate', async () => {
      const washSection = await testDb.questionSection.findFirst({
        where: { assessmentType: 'WASH', sectionKey: 'water-sources' },
      })

      const dupQuestion = await createQuestionRoute(
        makeRequest('POST', '/api/v1/admin/questions', {
          body: {
            assessmentType: 'WASH',
            questionKey: 'waterSource', // seeded key
            sectionId: washSection!.id,
            questionType: 'MULTI_SELECT',
            label: 'Duplicate',
            category: 'CONTEXT',
            options: [{ value: 'A', label: 'A' }],
            reason: 'duplicate key probe',
          },
          token: tokenFor(admin),
        })
      )
      expect(dupQuestion.status).toBe(409)
      expect((await jsonOf(dupQuestion)).error).toBe('question_key_duplicate')

      const dupSection = await createSectionRoute(
        makeRequest('POST', '/api/v1/admin/sections', {
          body: {
            assessmentType: 'WASH',
            sectionKey: 'water-access', // seeded key
            title: 'Duplicate',
            category: 'GAP',
            reason: 'duplicate section key probe',
          },
          token: tokenFor(admin),
        })
      )
      expect(dupSection.status).toBe(409)
      expect((await jsonOf(dupSection)).error).toBe('section_key_duplicate')
    })

    test('unknown ids → 404 question_not_found / section_not_found machine codes', async () => {
      const question = await updateQuestionRoute(
        makeRequest('PUT', '/api/v1/admin/questions/does-not-exist', {
          body: { label: 'Nope', reason: 'probe' },
          token: tokenFor(admin),
        }),
        withParams({ id: 'does-not-exist' })
      )
      expect(question.status).toBe(404)
      expect((await jsonOf(question)).error).toBe('question_not_found')

      const section = await updateSectionRoute(
        makeRequest('PUT', '/api/v1/admin/sections/does-not-exist', {
          body: { title: 'Nope', reason: 'probe' },
          token: tokenFor(admin),
        }),
        withParams({ id: 'does-not-exist' })
      )
      expect(section.status).toBe(404)
      expect((await jsonOf(section)).error).toBe('section_not_found')
    })

    test('mixed reorder payload → 400 (strict union)', async () => {
      const sections = await activeSections('POPULATION')
      const response = await reorderRoute(
        makeRequest('POST', '/api/v1/admin/questions/reorder', {
          body: {
            sectionIds: sections.map((s) => s.id),
            sectionId: sections[0].id,
            questionIds: ['whatever'],
            reason: 'ambiguous payload probe',
          },
          token: tokenFor(admin),
        })
      )
      expect(response.status).toBe(400)
    })

    test('identity reorder is a no-op — no bump, no audit', async () => {
      const sections = await activeSections('POPULATION')
      const before = await versionsOf('POPULATION')
      const auditBefore = await testDb.questionAuditLog.count({
        where: { action: 'REORDER', entityType: 'SECTION' },
      })

      const response = await reorderRoute(
        makeRequest('POST', '/api/v1/admin/questions/reorder', {
          body: { sectionIds: sections.map((s) => s.id), reason: 'identity reorder probe' },
          token: tokenFor(admin),
        })
      )
      expect(response.status).toBe(200)
      const body = await jsonOf(response)
      expect(body.data.reordered).toBe(sections.length)

      expect(await versionsOf('POPULATION')).toEqual(before)
      expect(
        await testDb.questionAuditLog.count({ where: { action: 'REORDER', entityType: 'SECTION' } })
      ).toBe(auditBefore)
    })

    test('section reorder writes one REORDER audit row per section (SHELTER)', async () => {
      const sections = await activeSections('SHELTER')
      const reversed = [...sections].reverse().map((s) => s.id)

      const response = await reorderRoute(
        makeRequest('POST', '/api/v1/admin/questions/reorder', {
          body: { sectionIds: reversed, reason: 'per-section audit rows' },
          token: tokenFor(admin),
        })
      )
      expect(response.status).toBe(200)

      const auditRows = await testDb.questionAuditLog.findMany({
        where: { action: 'REORDER', entityType: 'SECTION', entityId: { in: reversed }, reason: 'per-section audit rows' },
      })
      expect(auditRows).toHaveLength(reversed.length)

      // Restore original order (also audited per section).
      const restore = await reorderRoute(
        makeRequest('POST', '/api/v1/admin/questions/reorder', {
          body: { sectionIds: sections.map((s) => s.id), reason: 'restore shelter order' },
          token: tokenFor(admin),
        })
      )
      expect(restore.status).toBe(200)
    })

    test('empty-section category PUT is structural-only (structure+1, content unchanged)', async () => {
      const stamp = Date.now().toString(36)
      const created = await createSectionRoute(
        makeRequest('POST', '/api/v1/admin/sections', {
          body: {
            assessmentType: 'SECURITY',
            sectionKey: `tier-probe-${stamp}`,
            title: 'Tier probe',
            category: 'CONTEXT',
            reason: 'section tier probe fixture',
          },
          token: tokenFor(admin),
        })
      )
      expect(created.status).toBe(201)
      const { id } = await jsonOf(created).then((b) => b.data)

      const before = await versionsOf('SECURITY')
      const response = await updateSectionRoute(
        makeRequest('PUT', `/api/v1/admin/sections/${id}`, {
          body: { category: 'GAP', reason: 'empty section category flip' },
          token: tokenFor(admin),
        }),
        withParams({ id })
      )
      expect(response.status).toBe(200)
      const after = await versionsOf('SECURITY')
      expect(after.structureVersion).toBe(before.structureVersion + 1)
      expect(after.contentVersion).toBe(before.contentVersion)

      const del = await deleteSectionRoute(
        makeRequest('DELETE', `/api/v1/admin/sections/${id}`, {
          body: { reason: 'cleanup tier probe' },
          token: tokenFor(admin),
        }),
        withParams({ id })
      )
      expect(del.status).toBe(204)
    })

    test('includeInactive=1 returns inactive rows; default GET only active (FOOD)', async () => {
      const all = await getQuestionSetRoute(
        makeRequest('GET', '/api/v1/questions', {
          query: { assessmentType: 'FOOD', includeInactive: 1 },
          token: tokenFor(admin),
        })
      )
      expect(all.status).toBe(200)
      const allBody = await jsonOf(all)
      const allQuestions = allBody.data.sections.flatMap((s: { questions: Array<{ isActive: boolean }> }) => s.questions)
      expect(allQuestions.some((q: { isActive: boolean }) => !q.isActive)).toBe(true)

      const active = await getQuestionSetRoute(
        makeRequest('GET', '/api/v1/questions', {
          query: { assessmentType: 'FOOD' },
          token: tokenFor(admin),
        })
      )
      expect(active.status).toBe(200)
      const activeBody = await jsonOf(active)
      const activeQuestions = activeBody.data.sections.flatMap((s: { questions: Array<{ isActive: boolean }> }) => s.questions)
      expect(activeQuestions.every((q: { isActive: boolean }) => q.isActive)).toBe(true)
    })

    test('GET returns sections and questions in strictly ascending order (HEALTH)', async () => {
      const response = await getQuestionSetRoute(
        makeRequest('GET', '/api/v1/questions', {
          query: { assessmentType: 'HEALTH' },
          token: tokenFor(admin),
        })
      )
      expect(response.status).toBe(200)
      const body = await jsonOf(response)
      const sectionOrders = body.data.sections.map((s: { order: number }) => s.order)
      expect(sectionOrders).toEqual(sectionOrders.map((o: number, i: number) => i + 1))
      for (const section of body.data.sections) {
        const orders = section.questions.map((q: { order: number }) => q.order)
        expect(orders).toEqual(orders.map((o: number, i: number) => i + 1))
      }
    })

    test('registry mutations invalidate the gap-analysis cache and the read cache (HEALTH)', async () => {
      const gapQuestion = await firstActiveQuestion('HEALTH', { category: 'GAP' })
      expect(gapQuestion.questionKey).toBe('hasFunctionalClinic')

      const noGaps = { hasFunctionalClinic: true, hasEmergencyServices: true, hasTrainedStaff: true, hasMedicineSupply: true, hasMedicalSupplies: true, hasMaternalChildServices: true }
      const withGap = { ...noGaps, hasFunctionalClinic: false }

      // Prime both caches with the seeded MEDIUM severity.
      const cached = await getQuestionSetRoute(
        makeRequest('GET', '/api/v1/questions', { query: { assessmentType: 'HEALTH' }, token: tokenFor(admin) })
      )
      expect(cached.status).toBe(200)
      const primed = await analyzeGaps('HEALTH', noGaps)
      expect(primed.severity).toBe('LOW')

      const patched = await patchSeverityRoute(
        makeRequest('PATCH', `/api/v1/admin/questions/${gapQuestion.id}/severity`, {
          body: { severity: 'CRITICAL', reason: 'gap cache invalidation probe' },
          token: tokenFor(admin),
        }),
        withParams({ id: gapQuestion.id })
      )
      expect(patched.status).toBe(200)

      // analyzeGaps must see CRITICAL immediately (gap cache invalidated).
      const reanalyzed = await analyzeGaps('HEALTH', withGap)
      expect(reanalyzed.hasGap).toBe(true)
      expect(reanalyzed.gapFields).toContain('hasFunctionalClinic')
      expect(reanalyzed.severity).toBe('CRITICAL')

      // GET must serve the fresh row (question-set cache invalidated).
      const reread = await getQuestionSetRoute(
        makeRequest('GET', '/api/v1/questions', { query: { assessmentType: 'HEALTH' }, token: tokenFor(admin) })
      )
      expect(reread.status).toBe(200)
      const rereadBody = await jsonOf(reread)
      const served = rereadBody.data.sections
        .flatMap((s: { questions: Array<{ questionKey: string; severity: string }> }) => s.questions)
        .find((q: { questionKey: string }) => q.questionKey === 'hasFunctionalClinic')
      expect(served?.severity).toBe('CRITICAL')

      // Restore the seeded severity for downstream suites.
      const restore = await patchSeverityRoute(
        makeRequest('PATCH', `/api/v1/admin/questions/${gapQuestion.id}/severity`, {
          body: { severity: 'MEDIUM', reason: 'restore seeded severity' },
          token: tokenFor(admin),
        }),
        withParams({ id: gapQuestion.id })
      )
      expect(restore.status).toBe(200)
    })
  })
})
