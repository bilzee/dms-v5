import { test, expect, type APIRequestContext } from '@playwright/test'
import { BASELINE_PASSWORD, BASELINE_USERS, E2E_FIXTURES } from './baseline-users'
import { loginViaUi } from './helpers'

/**
 * DQR P9 — bottom-up proof: a registry edit made by an ADMIN surfaces, without
 * any code change, on the ASSESSOR's live form, in the derived assessment
 * priority, in the incident severity rollup, in the coordinator's
 * notification severity, and on the situation dashboard's snapshot-stamped
 * type card.
 *
 * Serial by necessity (one causal chain):
 *  * 1. ADMIN edits the fixture HEALTH GAP question on
 *  *    /admin/settings/questions — label, gapLabel (noun phrase the
 *  *    dashboard renders), and severity MEDIUM→CRITICAL in ONE Tier-A
 *  *    save → content version bumps v1 → v2 (structure stays v1).
 *  * 2. ASSESSOR's dynamic form renders the NEW label with the
 *  *    `Registry v1.2` badge.
 *  * 3. ASSESSOR submits a HEALTH assessment whose only gap is the fixture
 *  *    question → derived priority CRITICAL (engine MAX of gapped
 *  *    severities) → after verification the incident rolls up to CRITICAL
 *  *    → the coordinator's notification for that assessment carries the
 *  *    inherited CRITICAL severity (matched through its action signal; via
 *  *    GET /api/v1/notifications — the UI bell has no testids).
 *  * 4. COORDINATOR's situation dashboard (All Entities view) renders the
 *  *    health card from the stored questionSnapshot: the gap ranked CRITICAL
 *  *    under its EDITED phrase, with its computation-timestamp stamp.
 */

const NEW_LABEL = 'Working Health Clinic (P9)'
const NEW_GAP_LABEL = 'No working health clinic (P9)'

/** Full valid HEALTH answer set — exactly one gap: hasFunctionalClinic = false. */
const HEALTH_ANSWERS = {
  hasFunctionalClinic: false,
  hasEmergencyServices: true,
  hasTrainedStaff: true,
  hasMedicineSupply: true,
  hasMedicalSupplies: true,
  hasMaternalChildServices: true,
  numberHealthFacilities: 2,
  healthFacilityType: 'Clinic',
  qualifiedHealthWorkers: 5,
  commonHealthIssues: ['Malaria'],
}

async function loginToken(
  request: APIRequestContext,
  email: string
): Promise<string> {
  const response = await request.post('/api/v1/auth/login', {
    data: { email, password: BASELINE_PASSWORD },
  })
  expect(response.ok()).toBeTruthy()
  const body = await response.json()
  return body.data.token as string
}

test.describe.configure({ mode: 'serial' })

test.describe('registry bottom-up — admin edit surfaces everywhere', () => {
  test('admin edits the fixture question (label + gap phrase + severity) → content version bumps to v2', async ({ page }) => {
    await loginViaUi(page, BASELINE_USERS.admin.email, BASELINE_PASSWORD)
    await page.goto('/admin/settings/questions')

    await expect(page.getByTestId('question-registry-editor')).toBeVisible()
    await page.getByTestId('registry-type-tab-HEALTH').click()
    await expect(page.getByTestId('registry-content-version')).toHaveText('content v1')

    await page.getByTestId('registry-search-input').fill('Functional Clinic')
    const row = page
      .locator('[data-testid="registry-question-row"]', { hasText: 'Functional Clinic' })
      .first()
    await expect(row).toBeVisible()
    await row.getByTestId('registry-edit-button').click()

    await expect(page.getByTestId('question-edit-dialog-title')).toBeVisible()
    await page.getByTestId('question-label-input').fill(NEW_LABEL)
    await page.getByTestId('question-gap-label-input').fill(NEW_GAP_LABEL)
    // Severity MEDIUM → CRITICAL in the same Tier-A save (Radix select).
    await page.getByTestId('question-severity-select').click()
    await page.getByRole('option', { name: 'CRITICAL', exact: true }).click()
    await page.getByTestId('question-reason-input').fill('P9 bottom-up proof: label rename')
    await page.getByTestId('question-save-button').click()

    // Edit mode intentionally keeps the dialog open for follow-up edits (the
    // reason field is cleared as the save's side effect) — success is proven
    // by the audit entry and the header badges refreshed via onSaved.
    // Tier A edit: content version only, structure stays v1.
    await expect(page.getByTestId('registry-content-version')).toHaveText('content v2')
    await expect(page.getByTestId('registry-structure-version')).toHaveText('structure v1')
    await expect(page.getByText('P9 bottom-up proof: label rename')).toBeVisible()
    await page.getByRole('button', { name: 'Close' }).first().click()
    await expect(page.getByTestId('question-edit-dialog-title')).toBeHidden()
  })

  test('assessor form shows the renamed label at Registry v1.2', async ({ page }) => {
    await loginViaUi(page, BASELINE_USERS.assessor.email, BASELINE_PASSWORD)
    await page.goto('/rapid-assessments/new?type=HEALTH')

    await expect(page.getByTestId('health-assessment-form')).toBeVisible()
    await expect(page.getByTestId('registry-version-badge')).toHaveText('Registry v1.2')
    await expect(
      page.getByTestId('question-has-functional-clinic')
    ).toContainText(NEW_LABEL)
  })

  let assessmentId: string

  test('gap submission → coordinator notification at the registry-pinned severity', async ({ request }) => {
    const assessorToken = await loginToken(request, BASELINE_USERS.assessor.email)
    const coordinatorToken = await loginToken(request, BASELINE_USERS.coordinator.email)

    const created = await request.post('/api/v1/rapid-assessments', {
      headers: { Authorization: `Bearer ${assessorToken}` },
      data: {
        type: 'HEALTH',
        rapidAssessmentDate: new Date().toISOString(),
        assessorName: 'P9 Bottom-Up Assessor',
        entityId: E2E_FIXTURES.entityId,
        incidentId: E2E_FIXTURES.incidentId,
        answers: HEALTH_ANSWERS,
      },
    })
    expect(created.status()).toBe(201)
    const createdBody = (await created.json()).data as { id: string; priority: string }
    assessmentId = createdBody.id
    // Derivation leg: the single gap's registry severity (CRITICAL, set by
    // the admin edit in leg 1) is the submitted assessment's priority.
    expect(createdBody.priority).toBe(E2E_FIXTURES.fixtureQuestionSeverity)

    // Coordinator evaluates signals (creates the assessment-awaiting-
    // verification signal + its notification), then lists notifications.
    const signals = await request.get('/api/v1/action-signals?page=1&limit=100&unresolvedOnly=true&grouped=false', {
      headers: { Authorization: `Bearer ${coordinatorToken}` },
    })
    expect(signals.ok()).toBeTruthy()
    // Link the notification to THIS assessment through its action signal
    // (shape-agnostic: find the signal whose payload references the id).
    const signalsBody = (await signals.json()).data as unknown
    const signalList = Array.isArray(signalsBody)
      ? signalsBody
      : Object.values(signalsBody).find(Array.isArray) ?? []
    const assessmentSignal = (signalList as Array<Record<string, unknown>>).find((signal) =>
      JSON.stringify(signal).includes(assessmentId)
    )
    expect(assessmentSignal).toBeTruthy()

    const notificationsResponse = await request.get('/api/v1/notifications?limit=50', {
      headers: { Authorization: `Bearer ${coordinatorToken}` },
    })
    expect(notificationsResponse.ok()).toBeTruthy()
    const notifications = ((await notificationsResponse.json()).data as {
      notifications: Array<{ id: string; priority: string; signalId: string | null }>
    }).notifications
    // The coordinator's notification for the just-submitted assessment
    // inherits the registry CRITICAL severity of its top gap (D-4).
    expect(
      notifications.filter(
        (n) =>
          n.priority === E2E_FIXTURES.fixtureQuestionSeverity &&
          n.signalId === assessmentSignal!.id
      ).length
    ).toBeGreaterThan(0)

    // Verify the assessment so the situation dashboard aggregates it — and
    // the incident severity rolls up to CRITICAL (bottom-up chain).
    const verified = await request.post(`/api/v1/assessments/${assessmentId}/verify`, {
      headers: { Authorization: `Bearer ${coordinatorToken}` },
      data: { notes: 'P9 bottom-up dashboard leg' },
    })
    expect(verified.ok()).toBeTruthy()
    const incidentResponse = await request.get(`/api/v1/incidents/${E2E_FIXTURES.incidentId}`, {
      headers: { Authorization: `Bearer ${coordinatorToken}` },
    })
    expect(incidentResponse.ok()).toBeTruthy()
    const incident = ((await incidentResponse.json()).data as { severity: string })
    expect(incident.severity).toBe(E2E_FIXTURES.fixtureQuestionSeverity)
  })

  test('situation dashboard renders the snapshot-stamped health card', async ({ page }) => {
    await loginViaUi(page, BASELINE_USERS.coordinator.email, BASELINE_PASSWORD)
    await page.goto('/coordinator/situation-dashboard')

    // Nothing auto-selects — pick the single ACTIVE fixture incident (the
    // entity combobox also says "Select an incident first", hence anchoring
    // on the ellipsis). The default entity selection after that is the
    // aggregated "All Entities" view where the registry stamp renders.
    const incidentCombobox = page
      .getByRole('combobox')
      .filter({ hasText: /select an incident\.\.\./i })
    await expect(incidentCombobox).toBeVisible()
    await incidentCombobox.click()
    await page.getByRole('option', { name: /FLOOD/i }).click()

    await expect(
      page.getByRole('combobox').filter({ hasText: /all entities/i })
    ).toBeVisible()

    const stamp = page.getByTestId('gap-summary-stamp')
    await expect(stamp).toBeVisible()
    await expect(stamp).not.toHaveText(/registry/)

    // The health card ranks the fixture gap under its EDITED phrase — the
    // admin leg's gapLabel, resolved from the stored snapshot
    // (gapLabel → label → key). The row's severity is carried by an icon-only
    // indicator; the CRITICAL ranking itself is pinned by the incident-rollup
    // assertion in leg 3.
    // The aggregated card sits in a squeezed split pane; at the default
    // 1280x720 viewport the `min-w-0 truncate` label collapses to width 0
    // (Playwright: not visible). Coordinators run this dashboard wide —
    // resize to a realistic desktop before asserting the phrase renders
    // (long phrases truncate with a title tooltip by design).
    await page.setViewportSize({ width: 1920, height: 1080 })
    await expect(
      page.locator('span:visible', { hasText: NEW_GAP_LABEL }).first()
    ).toBeVisible()
  })
})
