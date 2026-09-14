import { GET as meRoute } from '@/app/api/v1/auth/me/route'
import { POST as loginRoute } from '@/app/api/v1/auth/login/route'
import { makeRequest, tokenFor, type AuthedUser } from '../helpers/api'
import { createUser, DEFAULT_TEST_PASSWORD } from '../factories'
import { testDb, truncateTestDb } from '../helpers/test-db'

/**
 * P0 — Authentication routes against real drms_test:
 * login (happy path + failure modes) and the withAuth gate via /auth/me.
 */

describe('P0 /api/v1/auth — login + withAuth gate', () => {
  beforeAll(async () => {
    await truncateTestDb()
  })

  afterAll(async () => {
    await truncateTestDb()
    await testDb.$disconnect()
  })

  describe('POST /api/v1/auth/login', () => {
    test('authenticates a valid user and returns token + user with roles', async () => {
      const user = await createUser({ roles: ['COORDINATOR'] })
      const response = await loginRoute(
        makeRequest('POST', '/api/v1/auth/login', {
          body: { email: user.email, password: DEFAULT_TEST_PASSWORD },
        })
      )
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.success).toBe(true)
      expect(typeof body.data.token).toBe('string')
      expect(body.data.user.id).toBe(user.id)
      expect(body.data.user.passwordHash).toBeUndefined()
      expect(body.data.user.roles.map((ur: any) => ur.role.name)).toContain('COORDINATOR')
    })

    test('rejects wrong password with 401', async () => {
      const user = await createUser({ roles: ['ASSESSOR'] })
      const response = await loginRoute(
        makeRequest('POST', '/api/v1/auth/login', {
          body: { email: user.email, password: 'definitely-wrong' },
        })
      )
      expect(response.status).toBe(401)
    })

    test('rejects unknown email with 401', async () => {
      const response = await loginRoute(
        makeRequest('POST', '/api/v1/auth/login', {
          body: { email: 'ghost@dms.test', password: 'whatever-123' },
        })
      )
      expect(response.status).toBe(401)
    })

    // Characterized defect: plain Error('Account is deactivated') escapes
    // handleApiError's pattern map → 500. Baseline pins current behavior so a
    // fix to 401/403 shows up as a deliberate change, not a silent one.
    test('rejects deactivated account (currently 500 — known defect)', async () => {
      const user = await createUser({ roles: ['ASSESSOR'], isActive: false })
      const response = await loginRoute(
        makeRequest('POST', '/api/v1/auth/login', {
          body: { email: user.email, password: DEFAULT_TEST_PASSWORD },
        })
      )
      expect(response.status).toBe(500)
    })

    // Characterized defect: same pattern as deactivated — 500 instead of 401.
    test('rejects locked account (currently 500 — known defect)', async () => {
      const user = await createUser({ roles: ['ASSESSOR'], isLocked: true })
      const response = await loginRoute(
        makeRequest('POST', '/api/v1/auth/login', {
          body: { email: user.email, password: DEFAULT_TEST_PASSWORD },
        })
      )
      expect(response.status).toBe(500)
    })

    test('rejects malformed body with 400', async () => {
      const response = await loginRoute(
        makeRequest('POST', '/api/v1/auth/login', { body: { email: 'not-an-email' } })
      )
      expect(response.status).toBe(400)
    })
  })

  describe('withAuth gate (via GET /api/v1/auth/me)', () => {
    let user: AuthedUser

    beforeAll(async () => {
      user = (await createUser({ roles: ['COORDINATOR', 'DONOR'] })) as AuthedUser
    })

    test('returns the session user for a valid token', async () => {
      const response = await meRoute(makeRequest('GET', '/api/v1/auth/me', { token: tokenFor(user) }))
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.success).toBe(true)
      const returned = body.data?.user ?? body.data
      expect(returned.id).toBe(user.id)
    })

    test('401 when Authorization header is missing', async () => {
      const response = await meRoute(makeRequest('GET', '/api/v1/auth/me'))
      expect(response.status).toBe(401)
    })

    test('401 for a garbage token', async () => {
      const response = await meRoute(
        makeRequest('GET', '/api/v1/auth/me', { token: 'not-a-jwt' })
      )
      expect(response.status).toBe(401)
    })

    test('401 for a token whose user no longer exists', async () => {
      const ghost = (await createUser({ roles: ['ASSESSOR'] })) as AuthedUser
      const token = tokenFor(ghost)
      await testDb.user.delete({ where: { id: ghost.id } })
      const response = await meRoute(makeRequest('GET', '/api/v1/auth/me', { token }))
      expect(response.status).toBe(401)
    })
  })
})
