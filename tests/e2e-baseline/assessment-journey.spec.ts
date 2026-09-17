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
  test('assessor reaches the rapid assessment workspace and the registry-driven form', async ({ page }) => {
    await loginViaUi(page, BASELINE_USERS.assessor.email, BASELINE_PASSWORD)
    await expect(page).toHaveURL(/\/assessor\/dashboard$/)

    await page.goto('/assessor/rapid-assessments')
    await expect(
      page.getByRole('heading', { level: 1, name: 'Rapid Assessments', exact: true })
    ).toBeVisible()
    // Page-level CTA (data-testid contract). With the seeded ACTIVE incident
    // the CTA lights up once a type is chosen — the sidebar also has "Create
    // New Assessment" nav links, so role-name locators are ambiguous here.
    const typeSelect = page.getByTestId('assessment-type-select')
    await expect(typeSelect).toBeVisible()
    await expect(page.getByTestId('new-assessment-button')).toBeDisabled()
    await typeSelect.selectOption('HEALTH')
    await expect(page.getByTestId('new-assessment-button')).toBeEnabled()

    await page.goto('/rapid-assessments/new?type=HEALTH')
    await expect(
      page.getByRole('heading', { level: 1, name: 'New Rapid Assessment' })
    ).toBeVisible()
    // Registry-driven form: the dynamic form + its live version badge render
    // from the seeded question catalog (55 active questions).
    await expect(page.getByTestId('health-assessment-form')).toBeVisible()
    await expect(page.getByTestId('registry-version-badge')).toBeVisible()
    await expect(page.getByTestId('registry-version-badge')).toHaveText(/Registry v\d+\.\d+/)
  })

  test('unauthenticated access to the assessment form redirects to login', async ({ page }) => {
    await page.goto('/rapid-assessments/new')
    await expect(page).toHaveURL(/\/login/)
  })
})
