import { test, expect, type Page } from '@playwright/test'
import { resolve } from 'path'
import { BASELINE_PASSWORD, BASELINE_USERS } from './baseline-users'
import { loginViaUi } from './helpers'

/**
 * DQR P10-3 — admin-authored cross-field rules reach the live assessment form.
 *
 * Two causal chains through the REAL admin editor and the REAL registry-driven
 * form (payload-driven since the P10-3 cutover — the form evaluates the
 * `/questions` payload rules, so admin changes land with the next fetch):
 *
 *  (a) CREATE: ADMIN authors a POPULATION refinement `populationUnder5 > 5000`
 *      via RuleEditDialog → ASSESSOR's new POPULATION form shows the authored
 *      message as a destructive cross-field alert and the submit button flips
 *      enabled → disabled the moment the violating value is typed.
 *  (b) EDIT: ADMIN edits the SEEDED `population-under5-vs-total` violation
 *      message → the panel preview shows it and the assessor form renders the
 *      NEW message (the aggregate advisory firing on the same key at the next
 *      index is asserted separately, proving both orders survive).
 *
 * Collision notes (the baseline suite is fullyParallel across files):
 * - The authored cap fires only above 5000; assessment-drift submits POPULATION
 *   with required numbers = 100 and totalPopulation = 5000 — never above it.
 * - Values are chosen so exactly ONE authored/refinement alert exists per
 *   scenario (alert testids carry the violation INDEX suffix: `-1`, `-2`, …).
 * - Only POPULATION rules are touched; registry-bottom-up's HEALTH version
 *   pins are unaffected. File name sorts AFTER registry-bottom-up.spec.ts.
 */

const AUTHORED_KEY = 'e2e-under5-hard-cap'
const AUTHORED_MESSAGE =
  'E2E authored: Children Under 5 cannot exceed 5000 in this emergency context'
const EDITED_MESSAGE =
  'E2E edited: Under-5 counts must always stay within the Total Population'
const SCREENSHOT_PATH = resolve(
  process.cwd(),
  '_bmad-output/implementation-artifacts/dqr-p10-3-rule-editor.png'
)

/** Admin → question registry → POPULATION → Rules view. */
async function openPopulationRulesView(page: Page): Promise<void> {
  await loginViaUi(page, BASELINE_USERS.admin.email, BASELINE_PASSWORD)
  await page.goto('/admin/settings/questions')
  await page.getByTestId('registry-type-tab-POPULATION').click()
  await page.getByTestId('registry-view-tab-rules').click()
  await expect(page.getByTestId('rules-panel')).toBeVisible()
}

/**
 * Meta chrome of the new-assessment form: the seeded ACTIVE FLOOD incident +
 * the assessor's assigned fixture entity. Until both are picked the submit
 * button is disabled for an unrelated reason — selecting them first makes the
 * later enabled/disabled flips provably caused by the cross-field rules.
 */
async function selectIncidentAndEntity(page: Page): Promise<void> {
  // FormControl names the trigger after its "Incident *" label (the hidden
  // native select Radix also renders carries no accessible name).
  await page.getByRole('combobox', { name: 'Incident' }).click()
  await page.getByRole('option', { name: /FLOOD/ }).click()
  await page.getByTestId('entity-select').click()
  // Entity name as seeded by global-setup for E2E_FIXTURES.entityId.
  await page.getByRole('option', { name: /P9 Registry Fixture Entity/ }).click()
}

test.describe.configure({ mode: 'serial' })

test.describe('rules admin authoring — authored rules reach the live form', () => {
  test('(a) admin creates a rule via the editor and it blocks the assessor form', async ({ page }) => {
    await openPopulationRulesView(page)

    // 11 seeded POPULATION rules (8 refinements + 3 aggregates).
    await expect(page.getByTestId('rules-count')).toHaveText('11 rules')

    await page.getByTestId('rules-new-button').click()
    await expect(page.getByTestId('rule-dialog-title')).toHaveText('Create rule')

    await page.getByTestId('rule-dialog-key-input').fill(AUTHORED_KEY)
    await page.getByTestId('rule-dialog-name-input').fill('Under-5 hard cap (E2E)')
    await page.getByTestId('rule-dialog-message-input').fill(AUTHORED_MESSAGE)

    // Violation condition: populationUnder5 > 5000 (left defaults to a
    // question operand — pick the exact key; right defaults to literal 0).
    await page.getByTestId('rule-dialog-left-operand-question').click()
    await page.getByRole('option', { name: /populationUnder5/ }).click()
    await page.getByTestId('rule-dialog-right-operand-literal').fill('5000')

    // Derived referenceKeys chip confirms the report target.
    await expect(page.getByTestId('rule-dialog-reference-keys')).toContainText(
      'populationUnder5'
    )

    await page.getByTestId('rule-dialog-reason-input').fill(
      'E2E P10-3: author the under-5 hard cap through the real editor'
    )

    // Spec artifact: the filled rule editor dialog.
    await page.getByRole('dialog').screenshot({ path: SCREENSHOT_PATH })

    await page.getByTestId('rule-dialog-save-button').click()
    await expect(page.getByTestId('rule-dialog-title')).toBeHidden()

    const authoredRow = page.locator('[data-testid="rules-table-row"]', {
      hasText: AUTHORED_KEY,
    })
    await expect(authoredRow).toBeVisible()
    await expect(authoredRow.getByTestId('rules-rule-message')).toContainText(
      'E2E authored'
    )
    await expect(page.getByTestId('rules-count')).toHaveText('12 rules')

    // ---- assessor leg: the authored rule now gates the live form ------------
    await loginViaUi(page, BASELINE_USERS.assessor.email, BASELINE_PASSWORD)
    await page.goto('/rapid-assessments/new?type=POPULATION')
    await expect(page.getByTestId('population-assessment-form')).toBeVisible()

    await selectIncidentAndEntity(page)
    await expect(page.getByTestId('submit-assessment-button')).toBeEnabled()

    // Below the cap: total 6000, under-5 unset (coerces to 0) — nothing fires.
    await page.getByTestId('total-population').fill('6000')
    await expect(page.getByTestId('submit-assessment-button')).toBeEnabled()

    // Above the cap: 5001 > 5000 — the authored refinement fires, alone (every
    // seeded POPULATION rule needs a component > total, and 5001 < 6000).
    // (kebabCase stops at lower→UPPER boundaries — the trailing 5 gets no
    // hyphen: populationUnder5 → population-under5.)
    await page.getByTestId('population-under5').fill('5001')
    const alert = page.getByTestId('cross-field-alert-population-under5')
    await expect(alert).toBeVisible()
    await expect(alert).toContainText(AUTHORED_MESSAGE)
    await expect(page.getByTestId('submit-assessment-button')).toBeDisabled()
  })

  test('(b) editing the seeded rule message reaches the assessor form verbatim', async ({ page }) => {
    await openPopulationRulesView(page)

    await page.getByTestId('rules-search-input').fill('population-under5-vs-total')
    const seededRow = page.locator('[data-testid="rules-table-row"]', {
      hasText: 'population-under5-vs-total',
    })
    await expect(seededRow).toHaveCount(1)
    await seededRow.getByTestId('rules-edit-button').click()

    await expect(page.getByTestId('rule-dialog-title')).toContainText(
      'population-under5-vs-total'
    )
    await page.getByTestId('rule-dialog-message-input').fill(EDITED_MESSAGE)
    await page.getByTestId('rule-dialog-reason-input').fill(
      'E2E P10-3: clarify the under-5 vs total wording'
    )
    await page.getByTestId('rule-dialog-save-button').click()
    await expect(page.getByTestId('rule-dialog-title')).toBeHidden()

    // Panel preview (row re-resolves after the refetch).
    await expect(seededRow.getByTestId('rules-rule-message')).toContainText(
      'E2E edited'
    )

    // ---- assessor leg: 501 > 500 fires the seeded refinement (order 2) and,
    // on the same key, the vulnerable-sum aggregate advisory (order 10) — the
    // refinement sorts first, so the un-suffixed alert is the edited message.
    await loginViaUi(page, BASELINE_USERS.assessor.email, BASELINE_PASSWORD)
    await page.goto('/rapid-assessments/new?type=POPULATION')
    await expect(page.getByTestId('population-assessment-form')).toBeVisible()

    await selectIncidentAndEntity(page)
    await page.getByTestId('total-population').fill('500')
    await page.getByTestId('population-under5').fill('501')

    const refinementAlert = page.getByTestId('cross-field-alert-population-under5')
    await expect(refinementAlert).toBeVisible()
    await expect(refinementAlert).toContainText(EDITED_MESSAGE)
    await expect(
      page.getByTestId('cross-field-alert-population-under5-1')
    ).toBeVisible()
    await expect(page.getByTestId('submit-assessment-button')).toBeDisabled()
  })
})
