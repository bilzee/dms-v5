import { NextRequest } from 'next/server'
import { POST as loginRoute } from '@/app/api/v1/auth/login/route'
import {
  ensureRoles,
  createUser,
  createEntity,
  createIncident,
  createPreliminaryAssessment,
  createRapidAssessment,
  createDonor,
  createDonorCommitment,
  createRapidResponse,
  createEntityAssignment,
  DEFAULT_TEST_PASSWORD,
} from '../factories'
import { testDb, truncateTestDb } from '../helpers/test-db'

/**
 * Phase 0 acceptance test: proves the API-suite foundation works end to end.
 * - Environment guard (setup-api.ts) guarantees drms_test
 * - Factories produce unique, interlinked domain data
 * - Truncate cleans state between runs
 * - The REAL login route handler authenticates a factory user (bcrypt + JWT + Prisma)
 */

function makeLoginRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('API suite foundation', () => {
  beforeAll(async () => {
    await ensureRoles()
  })

  afterAll(async () => {
    await truncateTestDb()
    await testDb.$disconnect()
  })

  test('DATABASE_URL guard targets drms_test', () => {
    expect(process.env.DATABASE_URL).toContain('drms_test')
  })

  test('factories create a linked domain graph with unique data', async () => {
    const coordinator = await createUser({ roles: ['COORDINATOR'] })
    const assessor = await createUser({ roles: ['ASSESSOR'] })
    const responder = await createUser({ roles: ['RESPONDER'] })

    const entity = await createEntity()
    const incident = await createIncident({ createdBy: coordinator.id })

    const preliminary = await createPreliminaryAssessment({
      reportingAgent: assessor.name,
      incidentId: incident.id,
      entityIds: [entity.id],
      numberDisplaced: 500,
    })

    const assessment = await createRapidAssessment({
      assessorId: assessor.id,
      entityId: entity.id,
      incidentId: incident.id,
      assessmentType: 'POPULATION',
      verificationStatus: 'SUBMITTED',
      answers: {
        totalHouseholds: 100,
        totalPopulation: 500,
        populationMale: 250,
        populationFemale: 250,
        populationUnder5: 80,
        pregnantWomen: 25,
        lactatingMothers: 30,
        personWithDisability: 10,
        elderlyPersons: 40,
        separatedChildren: 5,
        numberLivesLost: 2,
        numberInjured: 12,
      },
    })

    const donor = await createDonor()
    const commitment = await createDonorCommitment({
      donorId: donor.id,
      entityId: entity.id,
      incidentId: incident.id,
      items: [{ name: 'Water purification tablets', quantity: 1000, unit: 'boxes' }],
    })
    expect(commitment.totalCommittedQuantity).toBe(1000)

    const response = await createRapidResponse({
      responderId: responder.id,
      entityId: entity.id,
      assessmentId: assessment.id,
    })

    await createEntityAssignment({
      userId: assessor.id,
      entityId: entity.id,
      assignedBy: coordinator.id,
    })

    // Verify the graph persisted with correct links
    const persisted = await testDb.rapidAssessment.findUnique({
      where: { id: assessment.id },
      include: {
        entity: true,
        incident: true,
        responses: true,
      },
    })
    expect(persisted?.entityId).toBe(entity.id)
    expect(persisted?.incidentId).toBe(incident.id)
    // Typed payloads now persist in the canonical answers map (question registry)
    expect(persisted?.answers).toMatchObject({ totalPopulation: 500, totalHouseholds: 100 })
    expect(persisted?.answers).toMatchObject({ numberLivesLost: 2, numberInjured: 12 })
    expect(persisted?.responses.map((r) => r.id)).toContain(response.id)

    const preliminaryPersisted = await testDb.preliminaryAssessment.findUnique({
      where: { id: preliminary.id },
      include: { affectedEntities: true },
    })
    expect(preliminaryPersisted?.affectedEntities.map((ae) => ae.entityId)).toEqual([entity.id])

    // Uniqueness: a second factory pass must not collide
    const entity2 = await createEntity()
    expect(entity2.id).not.toBe(entity.id)
    expect(entity2.name).not.toBe(entity.name)
  })

  test('real login route authenticates a factory user and rejects bad credentials', async () => {
    const user = await createUser({ roles: ['COORDINATOR', 'ASSESSOR'] })

    const okResponse = await loginRoute(
      makeLoginRequest({ email: user.email, password: DEFAULT_TEST_PASSWORD })
    )
    expect(okResponse.status).toBe(200)
    const okBody = await okResponse.json()
    expect(okBody.success).toBe(true)
    expect(okBody.data.token).toBeTruthy()
    expect(okBody.data.user.id).toBe(user.id)
    const roleNames = okBody.data.user.roles.map((ur: { role: { name: string } }) => ur.role.name)
    expect(roleNames).toEqual(expect.arrayContaining(['COORDINATOR', 'ASSESSOR']))

    const badResponse = await loginRoute(
      makeLoginRequest({ email: user.email, password: 'wrong-password' })
    )
    expect(badResponse.status).toBe(401)

    const invalidBodyResponse = await loginRoute(makeLoginRequest({ email: 'not-an-email' }))
    expect(invalidBodyResponse.status).toBe(400)
  })

  test('truncation clears all factory data', async () => {
    await truncateTestDb()
    const userCount = await testDb.user.count()
    const entityCount = await testDb.entity.count()
    const incidentCount = await testDb.incident.count()
    expect(userCount).toBe(0)
    expect(entityCount).toBe(0)
    expect(incidentCount).toBe(0)
  })
})
