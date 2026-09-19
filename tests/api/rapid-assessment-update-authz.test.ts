import { PUT as updateAssessment } from '@/app/api/v1/rapid-assessments/[id]/route'
import { makeRequest, tokenFor, withParams, type AuthedUser } from '../helpers/api'
import {
  createUser,
  createEntity,
  createIncident,
  createEntityAssignment,
  createRapidAssessment,
  ensureQuestionRegistry,
} from '../factories'
import { testDb, truncateTestDb } from '../helpers/test-db'

/**
 * P10-4 (4d) — online re-point authorization on PUT /rapid-assessments/:id.
 *
 * Re-pointing a stored assessment at a different entityId is a privileged
 * edit: the caller needs COORDINATOR/ADMIN or an EntityAssignment covering
 * the TARGET entity. Same-entity answer edits are NOT re-gated (unchanged
 * ownership semantics: assessor-own).
 */

async function buildValidHealthAnswers(): Promise<Record<string, unknown>> {
  const questions = await testDb.question.findMany({
    where: { assessmentType: 'HEALTH', isActive: true },
    select: { questionKey: true, questionType: true, options: true },
  })
  const answers: Record<string, unknown> = {}
  for (const question of questions) {
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
        answers[question.questionKey] = 'authz test'
        break
    }
  }
  return answers
}

describe('P10-4 online assessment re-point authorization (4d)', () => {
  let assessor: AuthedUser
  let coordinator: AuthedUser
  let entityAId: string
  let entityBId: string
  let incidentId: string
  let answers: Record<string, unknown>

  beforeAll(async () => {
    await truncateTestDb()
    await ensureQuestionRegistry()
    assessor = (await createUser({ roles: ['ASSESSOR'] })) as AuthedUser
    coordinator = (await createUser({ roles: ['COORDINATOR'] })) as AuthedUser
    const entityA = await createEntity()
    const entityB = await createEntity()
    const incident = await createIncident({ createdBy: coordinator.id })
    entityAId = entityA.id
    entityBId = entityB.id
    incidentId = incident.id
    // The assessor starts assigned ONLY to entity A.
    await createEntityAssignment({ userId: assessor.id, entityId: entityAId, assignedBy: coordinator.id })
    answers = await buildValidHealthAnswers()
  })

  afterAll(async () => {
    await truncateTestDb()
    await testDb.$disconnect()
  })

  function put(id: string, body: Record<string, unknown>, user: AuthedUser) {
    return updateAssessment(
      makeRequest('PUT', `/api/v1/rapid-assessments/${id}`, { body, token: tokenFor(user) }),
      withParams({ id })
    )
  }

  test('assessor without an assignment for the TARGET entity gets 403; row untouched', async () => {
    const row = await createRapidAssessment({
      assessorId: assessor.id,
      entityId: entityAId,
      incidentId,
      assessmentType: 'HEALTH',
    })
    const response = await put(row.id, { type: 'HEALTH', answers, entityId: entityBId }, assessor)
    expect(response.status).toBe(403)
    const body = await response.json()
    expect(body.error).toMatch(/not authorized/i)

    const stored = await testDb.rapidAssessment.findUniqueOrThrow({ where: { id: row.id } })
    expect(stored.entityId).toBe(entityAId)
  })

  test('assessor WITH an assignment for the target entity re-points successfully (200)', async () => {
    await createEntityAssignment({ userId: assessor.id, entityId: entityBId, assignedBy: coordinator.id })
    const row = await createRapidAssessment({
      assessorId: assessor.id,
      entityId: entityAId,
      incidentId,
      assessmentType: 'HEALTH',
    })
    const response = await put(row.id, { type: 'HEALTH', answers, entityId: entityBId }, assessor)
    expect(response.status).toBe(200)
    const stored = await testDb.rapidAssessment.findUniqueOrThrow({ where: { id: row.id } })
    expect(stored.entityId).toBe(entityBId)
  })

  test('COORDINATOR bypasses the assignment requirement (no assignment, still 200)', async () => {
    // The coordinator holds no EntityAssignment rows at all but owns the row.
    const row = await createRapidAssessment({
      assessorId: coordinator.id,
      entityId: entityAId,
      incidentId,
      assessmentType: 'HEALTH',
    })
    const response = await put(row.id, { type: 'HEALTH', answers, entityId: entityBId }, coordinator)
    expect(response.status).toBe(200)
    const stored = await testDb.rapidAssessment.findUniqueOrThrow({ where: { id: row.id } })
    expect(stored.entityId).toBe(entityBId)
  })

  test('same-entity answer edit by the owner is not re-gated (200, no re-point)', async () => {
    const row = await createRapidAssessment({
      assessorId: assessor.id,
      entityId: entityAId,
      incidentId,
      assessmentType: 'HEALTH',
    })
    const response = await put(
      row.id,
      { type: 'HEALTH', answers, entityId: entityAId },
      assessor
    )
    expect(response.status).toBe(200)
  })
})
