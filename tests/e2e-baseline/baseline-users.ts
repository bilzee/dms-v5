/**
 * Seeded golden-journey users for the Playwright baseline suite.
 * Pure constants — importable from both global-setup and specs.
 * Created by tests/e2e-baseline/global-setup.ts against drms_test.
 */
export const BASELINE_PASSWORD = 'Baseline#Pass1'

export const BASELINE_USERS = {
  admin: {
    email: 'e2e.admin@baseline.test',
    name: 'E2E Admin',
  },
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

/**
 * Registry-driven fixture ids (seeded by global-setup against drms_test):
 * one entity, one ACTIVE incident, and the assessor→entity assignment that
 * submission authorization requires. Deterministic so specs and setup agree
 * without a handoff channel.
 */
export const E2E_FIXTURES = {
  entityId: 'e2e-entity-p9',
  incidentId: 'e2e-incident-p9',
  /** HEALTH GAP question pinned to CRITICAL for severity-inheritance legs. */
  fixtureQuestionId: 'HEALTH:hasFunctionalClinic',
  fixtureQuestionSeverity: 'CRITICAL',
} as const

/** Role → post-login landing route + dashboard <h1> (see LoginForm + dashboard pages). */
export const ROLE_LANDINGS = [
  { role: 'coordinator', path: '/coordinator/dashboard', heading: 'Coordinator Dashboard' },
  { role: 'assessor', path: '/assessor/dashboard', heading: 'Assessor Dashboard' },
  { role: 'responder', path: '/responder/dashboard', heading: 'Response Dashboard' },
  { role: 'donor', path: '/donor/dashboard', heading: 'Donor Dashboard' },
] as const
