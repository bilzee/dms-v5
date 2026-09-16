import { GET as listIncidents, POST as createIncidentRoute } from '@/app/api/v1/incidents/route'
import { POST as createRapidAssessment } from '@/app/api/v1/rapid-assessments/route'
import { GET as listUsers, POST as createUserRoute } from '@/app/api/v1/users/route'
import { POST as assignEntity } from '@/app/api/v1/entity-assignments/route'
import { POST as createCommitment } from '@/app/api/v1/commitments/route'
import { GET as verificationQueue } from '@/app/api/v1/verification/queue/assessments/route'
import { POST as verifyAssessmentRoute } from '@/app/api/v1/assessments/[id]/verify/route'
import { PATCH as patchSeverity } from '@/app/api/v1/admin/questions/[id]/severity/route'
import { GET as getScoringConfig, PUT as updateScoringConfig } from '@/app/api/v1/scoring-config/route'
import { GET as listDonors } from '@/app/api/v1/donors/route'
import {
  makeRequest,
  tokenFor,
  withParams,
  type AuthedUser,
} from '../helpers/api'
import {
  createUser,
  createEntity,
  createIncident,
  createDonor,
  grantPermission,
  ensureRoles,
  ensureQuestionRegistry,
  type RoleName,
} from '../factories'
import { testDb, truncateTestDb } from '../helpers/test-db'

/**
 * P0 — Authorization matrix. Locks down the role/permission gate of every
 * representative route so a regression in access control fails loudly.
 */

const VALID_INCIDENT_BODY = {
  data: {
    type: 'FLOOD',
    description: 'Authz matrix probe incident',
    location: 'Test Location',
    status: 'ACTIVE',
  },
}

describe('P0 authorization matrix', () => {
  beforeAll(async () => {
    await truncateTestDb()
    await ensureRoles()
  })

  afterAll(async () => {
    await truncateTestDb()
    await testDb.$disconnect()
  })

  describe('POST /api/v1/incidents — ASSESSOR | COORDINATOR | ADMIN only', () => {
    const allowed: RoleName[] = ['ASSESSOR', 'COORDINATOR', 'ADMIN']
    const denied: RoleName[] = ['RESPONDER', 'DONOR']

    for (const role of allowed) {
      test(`${role} → 201`, async () => {
        const user = (await createUser({ roles: [role] })) as AuthedUser
        const response = await createIncidentRoute(
          makeRequest('POST', '/api/v1/incidents', { body: VALID_INCIDENT_BODY, token: tokenFor(user) })
        )
        expect(response.status).toBe(201)
      })
    }

    for (const role of denied) {
      test(`${role} → 403`, async () => {
        const user = (await createUser({ roles: [role] })) as AuthedUser
        const response = await createIncidentRoute(
          makeRequest('POST', '/api/v1/incidents', { body: VALID_INCIDENT_BODY, token: tokenFor(user) })
        )
        expect(response.status).toBe(403)
      })
    }

    test('anonymous → 401', async () => {
      const response = await createIncidentRoute(
        makeRequest('POST', '/api/v1/incidents', { body: VALID_INCIDENT_BODY })
      )
      expect(response.status).toBe(401)
    })
  })

  describe('GET /api/v1/incidents — any authenticated user', () => {
    test('DONOR can list incidents', async () => {
      const donor = (await createUser({ roles: ['DONOR'] })) as AuthedUser
      const response = await listIncidents(
        makeRequest('GET', '/api/v1/incidents', { token: tokenFor(donor) })
      )
      expect(response.status).toBe(200)
    })
  })

  describe('POST /api/v1/rapid-assessments — ASSESSOR only', () => {
    test('RESPONDER → 403', async () => {
      const responder = (await createUser({ roles: ['RESPONDER'] })) as AuthedUser
      const response = await createRapidAssessment(
        makeRequest('POST', '/api/v1/rapid-assessments', {
          body: { type: 'SECURITY', answers: {} },
          token: tokenFor(responder),
        })
      )
      expect(response.status).toBe(403)
    })
  })

  describe('/api/v1/users — MANAGE_USERS permission', () => {
    test('plain COORDINATOR (no permission) → 403 on GET and POST', async () => {
      const coordinator = (await createUser({ roles: ['COORDINATOR'] })) as AuthedUser
      const token = tokenFor(coordinator)

      const getResponse = await listUsers(makeRequest('GET', '/api/v1/users', { token }))
      expect(getResponse.status).toBe(403)

      const roles = await ensureRoles()
      const postResponse = await createUserRoute(
        makeRequest('POST', '/api/v1/users', {
          body: {
            email: `authz-${Date.now()}@dms.test`,
            username: `authz-user-${Date.now()}`,
            password: 'LongEnough123!',
            name: 'Authz Probe',
            roleIds: [roles['ASSESSOR'].id],
          },
          token,
        })
      )
      expect(postResponse.status).toBe(403)
    })

    test('user WITH MANAGE_USERS → 200 on GET, 201 on POST', async () => {
      await grantPermission('COORDINATOR', 'MANAGE_USERS')
      const admin = (await createUser({ roles: ['COORDINATOR'] })) as AuthedUser

      const getResponse = await listUsers(makeRequest('GET', '/api/v1/users', { token: tokenFor(admin) }))
      expect(getResponse.status).toBe(200)

      const roles = await ensureRoles()
      const email = `authz-ok-${Date.now()}@dms.test`
      const postResponse = await createUserRoute(
        makeRequest('POST', '/api/v1/users', {
          body: {
            email,
            username: `authz-ok-${Date.now()}`,
            password: 'LongEnough123!',
            name: 'Created By Matrix',
            roleIds: [roles['ASSESSOR'].id],
          },
          token: tokenFor(admin),
        })
      )
      expect(postResponse.status).toBe(201)
      const body = await postResponse.json()
      expect(body.data.user.passwordHash).toBeUndefined()
    })
  })

  describe('POST /api/v1/entity-assignments — COORDINATOR only', () => {
    test('ASSESSOR → 403', async () => {
      const assessor = (await createUser({ roles: ['ASSESSOR'] })) as AuthedUser
      const target = (await createUser({ roles: ['ASSESSOR'] })) as AuthedUser
      const entity = await createEntity()

      const response = await assignEntity(
        makeRequest('POST', '/api/v1/entity-assignments', {
          body: { userId: target.id, entityId: entity.id, assignedBy: assessor.id },
          token: tokenFor(assessor),
        })
      )
      expect(response.status).toBe(403)
    })
  })

  describe('POST /api/v1/commitments — DONOR | COORDINATOR | ADMIN', () => {
    test('RESPONDER → 403; DONOR → 201', async () => {
      const responder = (await createUser({ roles: ['RESPONDER'] }) ) as AuthedUser
      const coordinator = (await createUser({ roles: ['COORDINATOR'] }) ) as AuthedUser
      const entity = await createEntity()
      const incident = await createIncident({ createdBy: coordinator.id })
      const donor = await createDonor()
      const body = {
        donorId: donor.id,
        entityId: entity.id,
        incidentId: incident.id,
        items: [{ name: 'Blankets', unit: 'pcs', quantity: 10 }],
      }

      const denied = await createCommitment(
        makeRequest('POST', '/api/v1/commitments', { body, token: tokenFor(responder) })
      )
      expect(denied.status).toBe(403)

      const donorUser = (await createUser({ roles: ['DONOR'] }) ) as AuthedUser
      const allowed = await createCommitment(
        makeRequest('POST', '/api/v1/commitments', { body, token: tokenFor(donorUser) })
      )
      expect(allowed.status).toBe(201)
    })
  })

  describe('verification + severity config routes', () => {
    test('GET verification queue: ASSESSOR → 403, COORDINATOR → 200', async () => {
      const assessor = (await createUser({ roles: ['ASSESSOR'] })) as AuthedUser
      const coordinator = (await createUser({ roles: ['COORDINATOR'] })) as AuthedUser

      const denied = await verificationQueue(
        makeRequest('GET', '/api/v1/verification/queue/assessments', { token: tokenFor(assessor) })
      )
      expect(denied.status).toBe(403)

      const allowed = await verificationQueue(
        makeRequest('GET', '/api/v1/verification/queue/assessments', { token: tokenFor(coordinator) })
      )
      expect(allowed.status).toBe(200)
    })

    test('POST assessments/verify: RESPONDER → 403', async () => {
      const responder = (await createUser({ roles: ['RESPONDER'] })) as AuthedUser
      const response = await verifyAssessmentRoute(
        makeRequest('POST', '/api/v1/assessments/some-id/verify', {
          body: {},
          token: tokenFor(responder),
        }),
        withParams({ id: 'some-id' })
      )
      expect(response.status).toBe(403)
    })

    // P3: the bulk POST admin/severity/recalculate surface is deleted (the
    // derivation rule made it structurally obsolete) — the severity matrix
    // is asserted on the live Tier A route it replaced.
    test('PATCH admin/questions/[id]/severity: DONOR → 403, COORDINATOR → 200', async () => {
      await ensureQuestionRegistry()
      const donor = (await createUser({ roles: ['DONOR'] })) as AuthedUser
      const coordinator = (await createUser({ roles: ['COORDINATOR'] })) as AuthedUser
      const question = await testDb.question.findFirst({
        where: { category: 'GAP' },
        orderBy: { id: 'asc' },
      })
      expect(question).not.toBeNull()
      const next = question!.severity === 'HIGH' ? 'CRITICAL' : 'HIGH'

      const denied = await patchSeverity(
        makeRequest('PATCH', `/api/v1/admin/questions/${question!.id}/severity`, {
          body: { severity: next, reason: 'authz matrix probe' },
          token: tokenFor(donor),
        }),
        withParams({ id: question!.id })
      )
      expect(denied.status).toBe(403)

      const allowed = await patchSeverity(
        makeRequest('PATCH', `/api/v1/admin/questions/${question!.id}/severity`, {
          body: { severity: next, reason: 'authz matrix probe' },
          token: tokenFor(coordinator),
        }),
        withParams({ id: question!.id })
      )
      expect(allowed.status).toBe(200)
    })

    test('scoring-config: DONOR → 403 on GET and PUT', async () => {
      const donor = (await createUser({ roles: ['DONOR'] })) as AuthedUser
      const token = tokenFor(donor)

      const getResponse = await getScoringConfig(
        makeRequest('GET', '/api/v1/scoring-config', { token })
      )
      expect(getResponse.status).toBe(403)

      const putResponse = await updateScoringConfig(
        makeRequest('PUT', '/api/v1/scoring-config', { body: {}, token })
      )
      expect(putResponse.status).toBe(403)
    })

    test('GET donors: DONOR role → 403 (admin/coordinator surface)', async () => {
      const donor = (await createUser({ roles: ['DONOR'] })) as AuthedUser
      const response = await listDonors(makeRequest('GET', '/api/v1/donors', { token: tokenFor(donor) }))
      expect(response.status).toBe(403)
    })
  })
})
