import { test, expect } from '@playwright/test'
import { BASELINE_PASSWORD, BASELINE_USERS, ROLE_LANDINGS } from './baseline-users'
import { loginViaUi } from './helpers'

/**
 * Golden journey — authentication.
 * Pins the login contract end-to-end: form render, API error surface,
 * and the role → dashboard redirect map (LoginForm.roleRedirectMap).
 */

test.describe('golden journey — login', () => {
  test('login screen renders the credential form', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByTestId('email')).toBeVisible()
    await expect(page.getByTestId('password')).toBeVisible()
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible()
  })

  test('wrong password → inline API error, stays on /login', async ({ page }) => {
    await page.goto('/login')
    await page.getByTestId('email').fill(BASELINE_USERS.coordinator.email)
    await page.getByTestId('password').fill('definitely-the-wrong-password')
    await page.getByRole('button', { name: /sign in/i }).click()
    await expect(page.getByText('Invalid email or password')).toBeVisible()
    await expect(page).toHaveURL(/\/login/)
  })

  test('unknown email → same opaque error (no user enumeration)', async ({ page }) => {
    await page.goto('/login')
    await page.getByTestId('email').fill('ghost.nowhere@baseline.test')
    await page.getByTestId('password').fill('whatever-password')
    await page.getByRole('button', { name: /sign in/i }).click()
    await expect(page.getByText('Invalid email or password')).toBeVisible()
  })

  for (const landing of ROLE_LANDINGS) {
    const user =
      BASELINE_USERS[landing.role as keyof typeof BASELINE_USERS]

    test(`login as ${landing.role} → ${landing.path}`, async ({ page }) => {
      await loginViaUi(page, user.email, BASELINE_PASSWORD)
      await expect(page).toHaveURL(new RegExp(`${landing.path.replace('/', '\\/')}$`))
      await expect(
        page.getByRole('heading', { level: 1, name: landing.heading })
      ).toBeVisible()
    })
  }
})
