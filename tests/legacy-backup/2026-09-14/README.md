# Legacy Test Quarantine — 2026-09-14

Quarantined during the Phase 0 test-foundation rebuild (TEA automate workflow)
because the suite could not be trusted as a regression baseline.

## Why these files were quarantined

### Dead / could not run
- `helpers/database.ts` — imports nonexistent `@/lib/db`; uses removed schema fields (`user.role`, `sessionToken`, `assessment`, `response`)
- `setup-ui-mocks.tsx` — imported by nothing
- `schema-validation.test.ts` — matched by no runner's testMatch
- `package.json` — declared a Vitest toolchain that was never installed/configured
- `unit/delivery-offline.service.test.ts`, `unit/delivery-media-validator.test.ts` — silently excluded from the Jest run via testPathIgnorePatterns
- `unit/integration/donor-simple.test.ts` — tests an inline mock component defined inside the test itself
- `components/**` — never matched by any testMatch
- `e2e/living-tests/**` — hardcoded `localhost:3006`; verified behavior via console.log

### Tautological (asserted against mocks of the code under test)
- `unit/auth/role-switching.test.ts`, `unit/stores/auth-store.test.ts` — `tests/setup.ts` globally mocks `@/stores/auth.store` with a hand-reimplemented copy; these tests asserted the copy, not the store

### Untrustworthy integration behavior (replaced by `tests/api/**` suite)
- Silent green: fell back to local fixture objects when the DB was unreachable (`donors-commitments`, `entity-insights/*`, `commitment-integration`, `signal-workflow`)
- Ran against the live dev DB (`drms_dev`) with no isolation, some asserting exact global row counts (`incidents`, `assessment-relationships`, `verification-workflow`, `response-verification-workflow`, `resource-management/entities-commitments`)
- Mocked the service under test entirely and asserted the mock's return values (`auth/endpoints`)
- Stale auth model (mocked `next-auth`, which the app no longer uses) (`verification/*`, `auth/*`)
- Mislabeled component tests duplicating unit coverage (`api/reports.test.ts`, `api/verification/*`)

## Where the coverage went
The P0 regression coverage these files pretended to provide is being rebuilt for real in
`tests/api/` (Jest + real `drms_test` PostgreSQL, run via `npm run test:api`) — see
`_bmad-output/test-artifacts/automation-summary.md`.
