import type { Page } from '@playwright/test'

/**
 * Shared UI helpers for the E2E baseline suite.
 * Selectors are pinned to LoginForm contracts (data-testid email/password,
 * "Sign in" submit) — see src/components/auth/LoginForm.tsx.
 */
export async function loginViaUi(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login')
  await page.getByTestId('email').fill(email)
  await page.getByTestId('password').fill(password)
  await page.getByRole('button', { name: /sign in/i }).click()
}
