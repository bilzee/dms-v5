/**
 * Seeded golden-journey users for the Playwright baseline suite.
 * Pure constants — importable from both global-setup and specs.
 * Created by tests/e2e-baseline/global-setup.ts against drms_test.
 */
export const BASELINE_PASSWORD = 'Baseline#Pass1'

export const BASELINE_USERS = {
  coordinator: {
    email: 'e2e.coordinator@baseline.test',
    name: 'E2E Coordinator',
  },
  assessor: {
    email: 'e2e.assessor@baseline.test',
    name: 'E2E Assessor',
  },
  responder: {
    email: 'e2e.responder@baseline.test',
    name: 'E2E Responder',
  },
  donor: {
    email: 'e2e.donor@baseline.test',
    name: 'E2E Donor',
  },
} as const

/** Role → post-login landing route + dashboard <h1> (see LoginForm + dashboard pages). */
export const ROLE_LANDINGS = [
  { role: 'coordinator', path: '/coordinator/dashboard', heading: 'Coordinator Dashboard' },
  { role: 'assessor', path: '/assessor/dashboard', heading: 'Assessor Dashboard' },
  { role: 'responder', path: '/responder/dashboard', heading: 'Response Dashboard' },
  { role: 'donor', path: '/donor/dashboard', heading: 'Donor Dashboard' },
] as const
