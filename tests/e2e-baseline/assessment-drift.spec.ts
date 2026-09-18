import { test, expect, type APIRequestContext } from '@playwright/test'
import { BASELINE_PASSWORD, BASELINE_USERS, E2E_FIXTURES } from './baseline-users'
import { loginViaUi } from './helpers'

/**
 * DQR P10-1 — read-side drift: an assessment answered against a registry that
 * later churned keeps rendering its snapshot-only answers instead of dropping
 * them to "N/A"/vanishing, and a later edit still succeeds.
 *
 * Serial by necessity (one causal chain):
 *  * 1. ADMIN creates a post-seed CONTEXT POPULATION question
 *  *    (`p9tRegistrationDesk`) via the governance API.
 *  * 2. COORDINATOR creates a dedicated ACTIVE incident (the shared fixture
 *  *    incident must stay untouched for the other specs).
 *  * 3. ASSESSOR submits a POPULATION assessment answering the new key → the
 *  *    row's questionSnapshot freezes it.
 *  * 4. COORDINATOR resolves the incident → the freeze gate stops protecting
 *  *    the key → ADMIN deactivates the question (registry churn).
 *  * 5. COORDINATOR reactivates the incident (new response phase) and
 *  *    REJECTS the assessment so it is editable (edit gate: REJECTED only).
 *  * 6. ASSESSOR's view page shows the drifted answer in the read-only
 *  *    "Additional Registry Answers" card.
 *  * 7. ASSESSOR's edit page shows the read-only drift block and the resubmit
 *  *    goes through — drift never blocks submission.
 */

const DRIFT_KEY = 'p9tRegistrationDesk'
const DRIFT_LABEL = 'Registration Desk (P10)'
const DRIFT_VALUE = 'Staffed 24/7 by volunteers'

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

test.describe('assessment drift — snapshot-only answers render read-only', () => {
  let questionId: string
  let incidentId: string
  let assessmentId: string

  test('admin authors a post-seed CONTEXT question and the world is staged', async ({ request }) => {
    const adminToken = await loginToken(request, BASELINE_USERS.admin.email)
    const coordinatorToken = await loginToken(request, BASELINE_USERS.coordinator.email)

    // A CONTEXT POPULATION section to host the question (category must match).
    const questionSet = await request.get(
      '/api/v1/questions?assessmentType=POPULATION&includeInactive=1',
      { headers: { Authorization: `Bearer ${adminToken}` } }
    )
    expect(questionSet.ok()).toBeTruthy()
    const sections = ((await questionSet.json()).data as {
      sections: Array<{ id: string; category: string }>
    }).sections
    const contextSection = sections.find((section) => section.category === 'CONTEXT')
    expect(contextSection).toBeTruthy()

    const created = await request.post('/api/v1/admin/questions', {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        assessmentType: 'POPULATION',
        questionKey: DRIFT_KEY,
        sectionId: contextSection!.id,
        questionType: 'TEXT_LONG',
        label: DRIFT_LABEL,
        category: 'CONTEXT',
        reason: 'P10-1 drift fixture: post-seed question',
      },
    })
    expect(created.status()).toBe(201)
    questionId = ((await created.json()).data as { id: string }).id

    // Dedicated incident (a NON-FLOOD type: registry-bottom-up pins its
    // combobox selector on /FLOOD/i, so this spec must not add a second
    // FLOOD option) — the shared fixture incident stays untouched.
    const incident = await request.post('/api/v1/incidents', {
      headers: { Authorization: `Bearer ${coordinatorToken}` },
      data: {
        data: {
          type: 'DISPLACEMENT',
          description: 'P10-1 drift fixture incident',
          location: 'Maiduguri',
          status: 'ACTIVE',
        },
      },
    })
    expect(incident.status()).toBe(201)
    incidentId = ((await incident.json()).data as { id: string }).id
  })

  test('assessor submission freezes the post-seed key into the row snapshot', async ({ request }) => {
    const assessorToken = await loginToken(request, BASELINE_USERS.assessor.email)

    // Answer every REQUIRED live question (the submission zod-validates the
    // answers against the snapshot being frozen), then the drift key. NOTE:
    // the wire shape is the raw registry row (`questionKey`/`questionType`),
    // not the client-normalized `key`/`type`.
    const questionSet = await request.get('/api/v1/questions?assessmentType=POPULATION', {
      headers: { Authorization: `Bearer ${assessorToken}` },
    })
    expect(questionSet.ok()).toBeTruthy()
    const liveSections = ((await questionSet.json()).data as {
      sections: Array<{
        questions: Array<{
          questionKey: string
          questionType: string
          required?: boolean
          options?: Array<{ value: string }>
        }>
      }>
    }).sections
    const answers: Record<string, unknown> = {}
    for (const section of liveSections) {
      for (const question of section.questions) {
        if (question.required !== true) continue
        switch (question.questionType) {
          case 'BOOLEAN':
            answers[question.questionKey] = true
            break
          case 'NUMBER':
            answers[question.questionKey] = 100
            break
          case 'SINGLE_CHOICE':
            answers[question.questionKey] = question.options?.[0]?.value ?? 'N/A'
            break
          case 'MULTI_SELECT':
            answers[question.questionKey] = question.options?.[0]?.value
              ? [question.options[0].value]
              : []
            break
          default:
            answers[question.questionKey] = 'Baseline population context'
            break
        }
      }
    }
    answers.totalPopulation = 5000
    answers[DRIFT_KEY] = DRIFT_VALUE

    const created = await request.post('/api/v1/rapid-assessments', {
      headers: { Authorization: `Bearer ${assessorToken}` },
      data: {
        type: 'POPULATION',
        rapidAssessmentDate: new Date().toISOString(),
        assessorName: 'P10 Drift Assessor',
        entityId: E2E_FIXTURES.entityId,
        incidentId,
        answers,
      },
    })
    expect(created.status()).toBe(201)
    assessmentId = ((await created.json()).data as { id: string }).id

    // The frozen snapshot contains the post-seed key.
    const fetched = await request.get(`/api/v1/rapid-assessments/${assessmentId}`, {
      headers: { Authorization: `Bearer ${assessorToken}` },
    })
    expect(fetched.ok()).toBeTruthy()
    const snapshot = ((await fetched.json()).data as { questionSnapshot: unknown })
      .questionSnapshot
    expect(JSON.stringify(snapshot)).toContain(DRIFT_KEY)
  })

  test('registry churn: incident resolves, the question deactivates, the incident reactivates, the row is rejected', async ({ request }) => {
    const adminToken = await loginToken(request, BASELINE_USERS.admin.email)
    const coordinatorToken = await loginToken(request, BASELINE_USERS.coordinator.email)

    // While ACTIVE the freeze gate would 409; resolve first.
    const resolved = await request.put(`/api/v1/incidents/${incidentId}`, {
      headers: { Authorization: `Bearer ${coordinatorToken}` },
      data: { status: 'RESOLVED' },
    })
    expect(resolved.ok()).toBeTruthy()

    const deactivated = await request.delete(`/api/v1/admin/questions/${questionId}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { reason: 'P10-1 drift fixture: question retired' },
    })
    expect(deactivated.ok()).toBeTruthy()

    // Back to ACTIVE so the historical row is editable, then reject it — the
    // edit page only admits REJECTED assessments ("rejected assessment edited
    // after registry churn" is exactly the P10-1 drift scenario).
    const reactivated = await request.put(`/api/v1/incidents/${incidentId}`, {
      headers: { Authorization: `Bearer ${coordinatorToken}` },
      data: { status: 'ACTIVE' },
    })
    expect(reactivated.ok()).toBeTruthy()

    const rejected = await request.post(`/api/v1/assessments/${assessmentId}/reject`, {
      headers: { Authorization: `Bearer ${coordinatorToken}` },
      data: {
        reason: 'QUALITY_ISSUES',
        feedback: 'P10-1 drift fixture: reject so the row is editable',
      },
    })
    expect(rejected.ok()).toBeTruthy()

    // The live assessor-facing registry no longer offers the key.
    const live = await request.get('/api/v1/questions?assessmentType=POPULATION', {
      headers: { Authorization: `Bearer ${adminToken}` },
    })
    expect(live.ok()).toBeTruthy()
    expect(JSON.stringify(await live.json())).not.toContain(DRIFT_KEY)
  })

  test('view page renders the drifted answer in the read-only registry card', async ({ page }) => {
    await loginViaUi(page, BASELINE_USERS.assessor.email, BASELINE_PASSWORD)
    await page.goto(`/assessor/rapid-assessments/${assessmentId}`)

    const drift = page.getByTestId(`snapshot-drift-${DRIFT_KEY}`)
    await expect(drift).toBeVisible()
    await expect(drift).toContainText(DRIFT_LABEL)
    await expect(drift).toContainText(DRIFT_VALUE)
  })

  test('edit page shows the read-only drift block and resubmission succeeds', async ({ page }) => {
    await loginViaUi(page, BASELINE_USERS.assessor.email, BASELINE_PASSWORD)
    await page.goto(`/assessor/rapid-assessments/${assessmentId}/edit`)

    await expect(page.getByTestId('population-assessment-form')).toBeVisible()

    const block = page.getByTestId('snapshot-drift-block')
    await expect(block).toBeVisible()
    await expect(block).toContainText(`Answers from questions no longer in the current set (1)`)
    await expect(page.getByTestId(`snapshot-drift-p9t-registration-desk`)).toContainText(
      DRIFT_VALUE
    )

    // Drift never blocks: the resubmit goes through (the drifted key is not
    // part of the live form, so it migrates out of the answers map).
    await page.getByTestId('submit-assessment-button').click()
    await page.waitForURL('**/assessor/rapid-assessments', { timeout: 15_000 })
  })
})
