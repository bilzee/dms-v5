import { GET as getAssessment, PUT as updateAssessment, DELETE as deleteAssessment } from '@/app/api/v1/rapid-assessments/[id]/route'
import { GET as listUsers, POST as createUserRoute } from '@/app/api/v1/users/route'
import { POST as loginRoute } from '@/app/api/v1/auth/login/route'
import { makeRequest, tokenFor, withParams, type AuthedUser } from '../helpers/api'
import {
  createUser,
  createEntity,
  createIncident,
  createRapidAssessment,
  createEntityAssignment,
  grantPermission,
  ensureRoles,
  ensureQuestionRegistry,
  DEFAULT_TEST_PASSWORD,
} from '../factories'
import { testDb, truncateTestDb } from '../helpers/test-db'

/**
 * P0 — Security characterization. These tests pin CURRENT behavior at
 * trust-boundary surfaces so the upcoming version-upgrade changes them loudly.
 * "Characterized defect" markers are known warts, not endorsements.
 */

// A schema-valid HEALTH update envelope: P4's UpdateRapidAssessmentSchema
// requires `type` + the full replacement `answers` map, so every PUT below
// carries one (only the caller differs).
const VALID_HEALTH_UPDATE_BODY = {
  type: 'HEALTH',
  answers: {
    hasFunctionalClinic: true,
    hasEmergencyServices: true,
    numberHealthFacilities: 1,
    healthFacilityType: 'Clinic',
    qualifiedHealthWorkers: 2,
    hasTrainedStaff: true,
    hasMedicineSupply: true,
    hasMedicalSupplies: true,
    hasMaternalChildServices: true,
    commonHealthIssues: ['Malaria'],
  },
}

describe('P0 security characterization', () => {
  beforeAll(async () => {
    await truncateTestDb()
    await ensureRoles()
    // The P4 update path validates answers against the live registry snapshot
    // (truncateTestDb wipes it) — re-seed so owner PUTs can reach the service.
    await ensureQuestionRegistry()
  })

  afterAll(async () => {
    await truncateTestDb()
    await testDb.$disconnect()
  })

  describe('GET /api/v1/rapid-assessments/[id] — ownership + RBAC', () => {
    let owner: AuthedUser
    let assessmentId: string

    beforeAll(async () => {
      owner = (await createUser({ roles: ['ASSESSOR'] })) as AuthedUser
      const coordinator = (await createUser({ roles: ['COORDINATOR'] })) as AuthedUser
      const entity = await createEntity()
      const incident = await createIncident({ createdBy: coordinator.id })
      const assessment = await createRapidAssessment({
        assessorId: owner.id,
        entityId: entity.id,
        incidentId: incident.id,
      })
      assessmentId = assessment.id
    })

    test('owner ASSESSOR → 200', async () => {
      const response = await getAssessment(
        makeRequest('GET', `/api/v1/rapid-assessments/${assessmentId}`, { token: tokenFor(owner) }),
        withParams({ id: assessmentId })
      )
      expect(response.status).toBe(200)
    })

    test('COORDINATOR (any) → 200', async () => {
      const coordinator = (await createUser({ roles: ['COORDINATOR'] })) as AuthedUser
      const response = await getAssessment(
        makeRequest('GET', `/api/v1/rapid-assessments/${assessmentId}`, { token: tokenFor(coordinator) }),
        withParams({ id: assessmentId })
      )
      expect(response.status).toBe(200)
    })

    test('other ASSESSOR (not owner) → 403', async () => {
      const stranger = (await createUser({ roles: ['ASSESSOR'] })) as AuthedUser
      const response = await getAssessment(
        makeRequest('GET', `/api/v1/rapid-assessments/${assessmentId}`, { token: tokenFor(stranger) }),
        withParams({ id: assessmentId })
      )
      expect(response.status).toBe(403)
    })

    test('RESPONDER / DONOR → 403', async () => {
      for (const role of ['RESPONDER', 'DONOR'] as const) {
        const user = (await createUser({ roles: [role] })) as AuthedUser
        const response = await getAssessment(
          makeRequest('GET', `/api/v1/rapid-assessments/${assessmentId}`, { token: tokenFor(user) }),
          withParams({ id: assessmentId })
        )
        expect(response.status).toBe(403)
      }
    })

    test('unknown id → 404', async () => {
      const response = await getAssessment(
        makeRequest('GET', '/api/v1/rapid-assessments/ghost', { token: tokenFor(owner) }),
        withParams({ id: 'ghost' })
      )
      expect(response.status).toBe(404)
    })
  })

  describe('PUT /api/v1/rapid-assessments/[id] — mutation rights', () => {
    let owner: AuthedUser
    let assessmentId: string

    beforeAll(async () => {
      owner = (await createUser({ roles: ['ASSESSOR'] })) as AuthedUser
      const coordinator = (await createUser({ roles: ['COORDINATOR'] })) as AuthedUser
      const entity = await createEntity()
      const incident = await createIncident({ createdBy: coordinator.id })
      const assessment = await createRapidAssessment({
        assessorId: owner.id,
        entityId: entity.id,
        incidentId: incident.id,
      })
      assessmentId = assessment.id
    })

    test('other ASSESSOR → 403', async () => {
      const stranger = (await createUser({ roles: ['ASSESSOR'] })) as AuthedUser
      const response = await updateAssessment(
        makeRequest('PUT', `/api/v1/rapid-assessments/${assessmentId}`, {
          body: { ...VALID_HEALTH_UPDATE_BODY, location: 'Tampered' },
          token: tokenFor(stranger),
        }),
        withParams({ id: assessmentId })
      )
      // Ownership is checked in the service before answers validation, so a
      // schema-valid body from a non-owner still lands on 403.
      expect(response.status).toBe(403)
    })

    test('owner can self-verify via verificationStatus (characterized defect)', async () => {
      // UpdateRapidAssessmentSchema accepts verificationStatus, so the owning
      // assessor can flip SUBMITTED → VERIFIED without a coordinator and
      // without verifiedBy/verifiedAt being set. Pinned deliberately.
      const response = await updateAssessment(
        makeRequest('PUT', `/api/v1/rapid-assessments/${assessmentId}`, {
          body: { ...VALID_HEALTH_UPDATE_BODY, verificationStatus: 'VERIFIED' },
          token: tokenFor(owner),
        }),
        withParams({ id: assessmentId })
      )
      expect(response.status).toBe(200)

      const stored = await testDb.rapidAssessment.findUnique({ where: { id: assessmentId } })
      expect(stored!.verificationStatus).toBe('VERIFIED')
      expect(stored!.verifiedBy).toBeNull()
    })
  })

  describe('DELETE /api/v1/rapid-assessments/[id] — gate deadlock (characterized defect)', () => {
    test('COORDINATOR non-owner → 403: route demands COORDINATOR+, service demands assessor', async () => {
      const assessor = (await createUser({ roles: ['ASSESSOR'] })) as AuthedUser
      const coordinator = (await createUser({ roles: ['COORDINATOR'] })) as AuthedUser
      const entity = await createEntity()
      const incident = await createIncident({ createdBy: coordinator.id })
      const assessment = await createRapidAssessment({
        assessorId: assessor.id,
        entityId: entity.id,
        incidentId: incident.id,
      })

      const response = await deleteAssessment(
        makeRequest('DELETE', `/api/v1/rapid-assessments/${assessment.id}`, {
          token: tokenFor(coordinator),
        }),
        withParams({ id: assessment.id })
      )
      // Only a user who is BOTH coordinator-role AND the assessor can delete.
      expect(response.status).toBe(403)
      const stored = await testDb.rapidAssessment.findUnique({ where: { id: assessment.id } })
      expect(stored).not.toBeNull()
    })

    test('ASSESSOR owner → 403 (role gate rejects before ownership check)', async () => {
      const assessor = (await createUser({ roles: ['ASSESSOR'] })) as AuthedUser
      const coordinator = (await createUser({ roles: ['COORDINATOR'] })) as AuthedUser
      const entity = await createEntity()
      const incident = await createIncident({ createdBy: coordinator.id })
      const assessment = await createRapidAssessment({
        assessorId: assessor.id,
        entityId: entity.id,
        incidentId: incident.id,
      })

      const response = await deleteAssessment(
        makeRequest('DELETE', `/api/v1/rapid-assessments/${assessment.id}`, {
          token: tokenFor(assessor),
        }),
        withParams({ id: assessment.id })
      )
      expect(response.status).toBe(403)
    })
  })

  describe('POST /api/v1/users — input hardening', () => {
    let admin: AuthedUser

    beforeAll(async () => {
      await grantPermission('COORDINATOR', 'MANAGE_USERS')
      admin = (await createUser({ roles: ['COORDINATOR'] })) as AuthedUser
    })

    test('rejects short passwords with 400', async () => {
      const roles = await ensureRoles()
      const response = await createUserRoute(
        makeRequest('POST', '/api/v1/users', {
          body: {
            email: `weak-${Date.now()}@dms.test`,
            username: `weak-${Date.now()}`,
            password: 'short',
            name: 'Weak Password',
            roleIds: [roles['ASSESSOR'].id],
          },
          token: tokenFor(admin),
        })
      )
      expect(response.status).toBe(400)
    })

    test('list never exposes passwordHash', async () => {
      await createUser({ roles: ['ASSESSOR'] })
      const response = await listUsers(
        makeRequest('GET', '/api/v1/users', { token: tokenFor(admin) })
      )
      expect(response.status).toBe(200)
      const body = await response.json()
      const items = body.data.items ?? body.data
      for (const user of items) {
        expect(user.passwordHash).toBeUndefined()
      }
    })
  })

  describe('POST /api/v1/auth/login — brute-force behavior (characterized)', () => {
    test('no lockout: 5 failed attempts then correct password still succeeds', async () => {
      const user = await createUser({ roles: ['ASSESSOR'] })
      for (let i = 0; i < 5; i++) {
        const failed = await loginRoute(
          makeRequest('POST', '/api/v1/auth/login', {
            body: { email: user.email, password: 'wrong-password' },
          })
        )
        expect(failed.status).toBe(401)
      }
      const success = await loginRoute(
        makeRequest('POST', '/api/v1/auth/login', {
          body: { email: user.email, password: DEFAULT_TEST_PASSWORD },
        })
      )
      // AuthService tracks no failedAttempt counter — wrong passwords never lock.
      expect(success.status).toBe(200)
    })
  })
})
