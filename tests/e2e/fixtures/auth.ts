import { test as base, expect } from '@playwright/test'
import type { Page, APIRequestContext } from '@playwright/test'

/**
 * Authentication fixtures for E2E tests.
 *
 * Replaces the old pattern of re-logging in through the UI in every spec with
 * hardcoded seed credentials. A test calls:
 *
 *   const page = await authedPage('COORDINATOR')
 *
 * which performs ONE API login, then installs the token the same way the real
 * app does (src/lib/auth/token-utils.ts):
 *   - cookie `auth_token`  → for src/middleware.ts (page route protection)
 *   - localStorage `auth_token` + `token` → for client API calls
 *   - localStorage `auth-storage` → the persisted zustand auth store
 *     (name + partialize must match src/stores/auth.store.ts)
 *
 * Credentials default to seeded users but can come from env or be supplied
 * explicitly (e.g. for users created by the test via the API).
 */

export type RoleName = 'ADMIN' | 'COORDINATOR' | 'RESPONDER' | 'ASSESSOR' | 'DONOR'

export interface TestCredentials {
  email: string
  password: string
}

export const ROLE_PRIORITY: RoleName[] = ['ADMIN', 'COORDINATOR', 'RESPONDER', 'ASSESSOR', 'DONOR']

const SEEDED_CREDENTIALS: Record<RoleName, TestCredentials> = {
  ADMIN: { email: 'admin@dms.gov.ng', password: 'admin123!' },
  COORDINATOR: { email: 'coordinator@test.com', password: 'password123' },
  RESPONDER: { email: 'responder@test.com', password: 'password123' },
  ASSESSOR: { email: 'assessor@test.com', password: 'password123' },
  DONOR: { email: 'donor@test.com', password: 'password123' },
}

export function credentialsForRole(role: RoleName): TestCredentials {
  const envVar = `E2E_${role}_CREDENTIALS`
  const fromEnv = process.env[envVar]
  if (fromEnv && fromEnv.includes(':')) {
    const [email, password] = fromEnv.split(':')
    return { email, password }
  }
  return SEEDED_CREDENTIALS[role]
}

export interface AuthSession {
  token: string
  user: Record<string, unknown> & { roles?: Array<{ role: { name: string } }> }
}

/** Login through the real API. Throws with status/body when login fails. */
export async function loginViaApi(
  request: APIRequestContext,
  credentials: TestCredentials
): Promise<AuthSession> {
  const response = await request.post('/api/v1/auth/login', {
    data: { email: credentials.email, password: credentials.password },
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok() || body?.success !== true) {
    throw new Error(
      `API login failed for ${credentials.email}: ${response.status()} ${JSON.stringify(body)}`
    )
  }
  const data = body.data ?? {}
  if (!data.token || !data.user) {
    throw new Error(`API login response missing token/user: ${JSON.stringify(body)}`)
  }
  return { token: data.token, user: data.user }
}

/**
 * Install an authenticated session into a page: cookie (middleware) +
 * localStorage token keys + persisted zustand auth store.
 * Must be called BEFORE the first navigation to the app.
 */
export async function installAuthSession(page: Page, session: AuthSession): Promise<void> {
  // Must match the baseURL used by the Playwright project (default http://localhost:3000)
  const origin = process.env.E2E_BASE_ORIGIN || 'http://localhost:3000'

  await page.context().addCookies([
    {
      name: 'auth_token',
      value: session.token,
      url: origin,
    },
  ])

  const userRoles: string[] = (session.user.roles ?? []).map((ur) => ur.role.name)
  const currentRole =
    [...userRoles].sort((a, b) => ROLE_PRIORITY.indexOf(a as RoleName) - ROLE_PRIORITY.indexOf(b as RoleName))[0] ??
    userRoles[0] ??
    null

  const persistedAuthStorage = JSON.stringify({
    state: {
      user: session.user,
      token: session.token,
      isAuthenticated: true,
      permissions: [],
      roles: userRoles,
      currentRole,
      availableRoles: userRoles,
      roleSessionState: {},
    },
    version: 0,
  })

  await page.addInitScript(
    ({ token, storage }) => {
      localStorage.setItem('auth_token', token)
      localStorage.setItem('token', token)
      localStorage.setItem('auth-storage', storage)
    },
    { token: session.token, storage: persistedAuthStorage }
  )
}

/**
 * Prepare an existing page with an authenticated session for the given role.
 * Call before the first page.goto().
 *
 * Usage:
 *   test('coordinator dashboard', async ({ page, request }) => {
 *     await authenticate(page, request, 'COORDINATOR')
 *     await page.goto('/coordinator/dashboard')
 */
export async function authenticate(
  page: Page,
  request: APIRequestContext,
  role: RoleName | TestCredentials
): Promise<AuthSession> {
  const credentials = typeof role === 'string' ? credentialsForRole(role) : role
  const session = await loginViaApi(request, credentials)
  await installAuthSession(page, session)
  return session
}

export { base, expect }
