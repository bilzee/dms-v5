import { test, expect } from '@playwright/test'
import { BASELINE_PASSWORD, BASELINE_USERS } from './baseline-users'
import { loginViaUi } from './helpers'

/**
 * Golden journey — assessor assessment workflow (thin: navigation + render).
 * Deep create/verify/deliver logic is covered by tests/api/** against real
 * route handlers; here we pin that the primary assessor surface is reachable
 * and renders for an authenticated field assessor.
 */

test.describe('golden journey — assessor assessments', () => {
  test('assessor reaches the rapid assessment workspace and the new-assessment form', async ({ page }) => {
    await loginViaUi(page, BASELINE_USERS.assessor.email, BASELINE_PASSWORD)
    await expect(page).toHaveURL(/\/assessor\/dashboard$/)

    await page.goto('/assessor/rapid-assessments')
    await expect(
      page.getByRole('heading', { level: 1, name: 'Rapid Assessments', exact: true })
    ).toBeVisible()
    // Page-level CTA (data-testid contract). With no incidents seeded it
    // renders disabled — the sidebar also has "Create New Assessment"
    // nav links, so role-name locators are ambiguous here.
    await expect(page.getByTestId('new-assessment-button')).toBeVisible()

    await page.goto('/rapid-assessments/new')
    await expect(
      page.getByRole('heading', { level: 1, name: 'New Rapid Assessment' })
    ).toBeVisible()
  })

  test('unauthenticated access to the assessment form redirects to login', async ({ page }) => {
    await page.goto('/rapid-assessments/new')
    await expect(page).toHaveURL(/\/login/)
  })
})
