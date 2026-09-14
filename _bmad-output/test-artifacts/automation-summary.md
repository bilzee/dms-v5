---
stepsCompleted: ['step-01-preflight-and-context', 'step-02-identify-targets']
lastStep: 'step-02-identify-targets'
lastSaved: '2026-09-14'
detected_stack: 'fullstack'
execution_mode: 'standalone'
inputDocuments:
  - 'package.json'
  - 'playwright.config.ts'
  - 'jest.config.js'
  - 'tests/README.md'
  - '_bmad/tea/config.yaml'
  - '.claude/skills/bmad-testarch-automate/resources/knowledge/test-levels-framework.md'
  - '.claude/skills/bmad-testarch-automate/resources/knowledge/test-priorities-matrix.md'
  - '.claude/skills/bmad-testarch-automate/resources/knowledge/test-quality.md'
  - '.claude/skills/bmad-testarch-automate/resources/knowledge/data-factories.md'
  - '.claude/skills/bmad-testarch-automate/resources/knowledge/network-first.md'
  - '.claude/skills/bmad-testarch-automate/resources/knowledge/fixture-architecture.md'
---

# Test Automation Expansion — dms-v4-bmad-v6 (Disaster Response Management System)

## Step 1: Preflight & Context

### Stack Detection
- **Detected stack:** `fullstack` — Next.js 14 (App Router) frontend + Next.js API routes (`src/app/api/v1/*`, ~37 route groups) + Prisma/SQLite backend
- **Test frameworks verified:**
  - Playwright 1.55 (`playwright.config.ts`, `playwright-smoke.config.ts`) — E2E, 5 browser projects, webServer auto-start `npm run dev` on :3000
  - Jest 29 + Testing Library (`jest.config.js`) — unit + integration
- **Package manager:** pnpm 9.15.4

### Execution Mode
- **Standalone** — no BMad story/PRD/test-design artifacts present; codebase-driven baseline generation.

### Library Integration Gates
- `tea_use_playwright_utils: true` but `@playwright-utils` package NOT installed → mandate does not bind; traditional Playwright patterns in effect (documented deviation, no install performed).
- `tea_use_pactjs_utils: true` but no microservices layout (single Next.js app + Prisma; no `@pact-foundation/pact`) → contract testing not relevant; Pact fragments skipped per relevance gate.
- `tea_browser_automation: auto` → MCP chrome-devtools tools available for interactive verification when needed.

### Existing Test Landscape
- Prior cleanup (2025-11-06) removed 25 failing legacy files → 3 passing unit files at that time.
- Current tree has grown: `tests/unit/` (auth, api, signals, delivery, gamification, verification, hooks, stores, components), `tests/integration/` (api, auth, commitments, delivery, donor, signals, verification, gamification), `tests/e2e/` (auth, donor, coordinator, delivery, assessments, response-planning, role-switching, pwa, sync, living-tests), `tests/smoke/` (critical-paths, story-5.1).
- **User context:** app is manually verified and working; existing tests are NOT trusted as regression baseline. Goal = comprehensive, trustworthy baseline regression suite before major version-upgrade work.

### App Domain Surface (target inventory input)
- Auth: login/register, role switching (FIELD_OFFICER / DONOR_COORDINATOR / etc.), JWT
- Core workflows: incidents, preliminary & rapid assessments, action signals, commitments, delivery & delivery-media, responses, response verification, gap analysis/severity
- Entities: donors, coordinator, entities, entity-assignments, relationships
- Ops: dashboard, reports, exports (exceljs/pdfkit), leaderboard/gamification, notifications/push, sync, storage (S3 presign), manifest
- Admin: roles, permissions, scoring-config, severity-thresholds, gap-field-severities, map-config, branding

### Knowledge Fragments Loaded (core)
test-levels-framework, test-priorities-matrix, test-quality (DoD), data-factories, network-first, fixture-architecture

## Step 2: Targets, Levels & Coverage Plan

### Environment Facts
- DB: PostgreSQL 15 (docker-compose, localhost:5435/drms_dev) + Redis 7 + MinIO (S3). `prisma/dev.db` is a leftover.
- Auth: JWT Bearer (`POST /api/v1/auth/login` → `{token, user, roles}`); `withAuth` re-reads roles/permissions from DB per request.

### Key Audit Findings (existing suite — 101 files, ~1,300 tests, NOT trustworthy as baseline)
1. Tautological: `tests/setup.ts` mocks `@/stores/auth.store` with a hand-copied implementation; auth-store tests assert the copy.
2. Silent green: 5 integration files degrade to local fixtures when DB unreachable (`isDatabaseAvailable=false`).
3. ~150 hardcoded `waitForTimeout` across 20 files; 5 unexplained `test.skip` in response-verification E2E.
4. Broken drift: `tests/helpers/database.ts` imports nonexistent `@/lib/db`, uses removed schema fields; 2 delivery unit files excluded from Jest run; `tests/components/**` + `schema-validation.test.ts` in no testMatch; smoke config targets port 3001 with pnpm while root uses 3000/npm; dead `tests/package.json` (vitest, never configured); coverage thresholds 0%.
5. No E2E auth fixture (every spec re-logs in via UI with hardcoded seed creds); no per-run unique data; cleanup deletes `LIKE '%@test.com'` (cross-suite hazard).
6. Massive duplication (~100 tests on verification queue across 5 files; auto-approval 4 files).

### Coverage Gaps (zero tests)
- API: users/*, roles/*, permissions, entity-assignments/*, admin/* (incl. severity/recalculate), scoring-config, severity-thresholds, gap-field-severities, sync/* API, notifications/*, push/*, storage/*, system/*, jobs/*, responses/* (most), assessments/verified, coordinator/analytics.
- Services (untested): incident-severity, gap-analysis, scoring-config, gap-field-severity, entity-assignment (authz matrix!), response.service (lifecycle/auto-approval), commitment.service (quantity math), sync-processing, rapid-assessment.service, leaderboard, delivery-media.service.
- E2E: admin section, responder planning flows, donor performance/reports, settings pages.

### Security findings to characterize (not silently fix) in regression tests
- `POST /api/v1/users` — no role/permission check (any authed user can create users).
- `GET /api/v1/storage/download?key=` — unauthenticated.
- `/api/v1/system/backup/external` — unauthenticated.
- `GET /api/v1/donors` — public.

### Test Level Strategy
- **Unit (Jest)**: pure business logic — incident-severity calc, gap-analysis, scoring/weights, commitment quantity math, sync conflict resolution, action-signal rules, delivery-media/GPS validation, auth service token logic, zod schemas.
- **API integration (Jest + real test DB `drms_test`)**: route handlers through NextRequest with real Prisma — auth+authz matrix per role, incident pipeline, assessment verify cascade, commitment→response→deliver→verify lifecycle, transactions, sync batch/conflicts, admin config endpoints.
- **E2E (Playwright, thin)**: golden journeys only — per-role login/redirect, incident→assessment→signal→commitment→delivery→verification, donor registration→login, role switching, offline capture+sync. Auth via API login + storageState; unique per-run data via factories.

### Priority Assignments
- **P0**: auth (login/refresh/logout/me, authz matrix), incident CRUD + from-assessment, preliminary/rapid assessments + verify cascade, severity pipeline (scoring-config, gap-field-severities, thresholds, recalculate), action signals, commitments + responses + delivery + verification lifecycle, from-commitment transaction, sync batch/conflicts, entity-assignment access matrix, security-characterization tests, health smoke.
- **P1**: users/roles/permissions admin, entities CRUD + relationships, dashboards/aggregates (situation, resource-management/gap-analysis), exports/reports, notifications, auto-approval config, leaderboard/gamification, offline queue unit, role-switching UI E2E.
- **P2**: branding, map-config, manifest, push subscribe/test, analytics charts, PWA polish, help.

### Phased Delivery Plan
- **Phase 0 — Repair the foundation**: fix jest testMatch/config; align smoke config; dedicated `TEST_DATABASE_URL` (drms_test) + truncate helper; Prisma data factories (unique data); Playwright API-login + storageState fixtures per role; purge/quarantine dead + tautological files; remove silent mock fallbacks; documented skips only.
- **Phase 1 — P0 API baseline** (highest regression value per effort): auth+authz matrix, incident pipeline, assessment cascade, commitment→delivery→verification lifecycle, severity pipeline, signals, sync, security characterizations.
- **Phase 2 — P0/P1 unit layer**: severity/gap/scoring/commitment/sync-conflict/action-signal pure logic.
- **Phase 3 — Thin E2E golden journeys** (Playwright, chromium-first): role dashboards, golden path, donor registration, role switching, offline sync.
- **Phase 4 — P1 remainder + burn-in**: dashboards, exports, notifications, admin pages; repeated runs to certify stability; baseline report.

## Phase 0 Report — Foundation (COMPLETE, 2026-09-14)

### Root-cause discovery: Windows + next/jest transform bug
`next/jest` FORCE-prepends `/node_modules/` to `transformIgnorePatterns` and only appends custom entries (node_modules/next/dist/build/jest/jest.js:191-204). Consequences:
- The repo's ESM allowlist (uuid etc.) never worked.
- On Windows, `/node_modules/` matched backslash paths, so `uuid@13` (ESM-only) was never transformed → EVERY suite importing route handlers (via lib/api/response.ts → uuid) failed with `Unexpected token 'export'`.
- Fix: overwrite `transformIgnorePatterns` after config resolution in both `jest.config.js` and `jest.api.config.js` (separator-agnostic allowlist pattern).
- Re-testing all quarantined suites with the fix: the only ones that pass are the 5 meaningless ones (silent-fallback/tautological suites that assert their own fixtures). All genuine suites still fail from mock-vs-schema drift. Quarantine stands.

### Delivered
1. **drms_test database** (docker postgres :5435) + schema pushed; `npm run db:push:test`.
2. **`.env.test`** rewritten (was stale SQLite + next-auth); loaded by `tests/setup-api.ts` with a hard guard: refuses to run unless DATABASE_URL contains `drms_test`.
3. **`jest.api.config.js`** — API suite: node env, no jsdom/global-mock setup, runInBand (shared physical DB), `npm run test:api`.
4. **`tests/helpers/test-db.ts`** — shared PrismaClient + `truncateTestDb()` (TRUNCATE ... CASCADE all tables).
5. **`tests/factories/index.ts`** — unique-data factories: users (any role mix, bcrypt), entities, incidents, preliminary/rapid assessments (with sector payloads), donors, commitments, responses, entity assignments, action signals.
6. **`tests/api/foundation.test.ts`** — acceptance test (GREEN): env guard, linked domain graph, real login route (bcrypt+JWT+Prisma), truncation.
7. **`tests/e2e/fixtures/auth.ts`** — API login + cookie/localStorage/zustand-persist installation (matches token-utils.ts + auth.store.ts persistence exactly); role-credential resolution with env overrides.
8. **playwright-smoke.config.ts** aligned (port 3000, npm — was 3001/pnpm, pointing at nothing).
9. **Quarantine `tests/legacy-backup/2026-09-14/`** — 100 files total (audit batch + all 40 runtime-failing suites). Root cause documented per category in its README. Remaining suites are green by construction.

### State after Phase 0
- `npx jest` → 1 suite / 17 tests, green (offline-signal-cache).
- `npm run test:api` → 1 suite / 4 tests, green (foundation, against real drms_test).

## Phase 1 Report — P0 API Baseline (COMPLETE, 2026-09-14)

**Result: 8 suites / 96 tests, all green** (`npm run test:api`, real drms_test PostgreSQL, runInBand, route handlers invoked in-process with real JWTs).

### Suites
| Suite | Tests | Locks down |
|---|---|---|
| `foundation.test.ts` | 4 | env guard, domain graph, real login, truncation |
| `auth-routes.test.ts` | 10 | login happy/401/400 + withAuth gate (missing/garbage/deleted-user tokens) |
| `authz-matrix.test.ts` | 17 | role/permission gates across 11 representative routes (5 roles + anonymous) |
| `incidents.test.ts` | 17 | CRUD pipeline: create+persist, preliminary-assessment linking, filters/pagination, PUT/DELETE role gates, soft-delete=RESOLVED, from-assessment |
| `assessment-verify-cascade.test.ts` | 7 | entity-assignment gate, auto-approve, verification queue, verify cascade (status+audit+queue exclusion), illegal re-verify |
| `response-lifecycle.test.ts` | 14 | commitment→plan import (availability checks, 403/404), deliver (PLANNED→DELIVERED, commitment progress PARTIAL), verify (+audit), duplicate gates |
| `severity-and-sync.test.ts` | 14 | bottom-up severity (max-across-verified, latest-per-entity-type, SUBMITTED ignored, preliminary thresholds incl. OR-semantics, verified-outranks-preliminary, recalculate report), sync surface (501 pull stub, batch 403/400) |
| `security-characterization.test.ts` | 12 | assessment ownership RBAC matrix, mutation rights, password policy, passwordHash non-leak, login brute-force behavior |

### Characterized defects (pinned as tests — fixes will intentionally flip these)
1. **Login deactivated/locked accounts → 500** (should be 401/403): plain `Error` escapes `handleApiError`'s pattern map. `auth-routes.test.ts`.
2. **Assessment verify: not-found → 400** (route intercepts `Error` before `handleApiError` would return 404). `assessment-verify-cascade.test.ts`.
3. **Double delivery-confirm → 500, not 409**: route matches "confirmed as delivered" but service throws "have delivery confirmed" (message drift). `response-lifecycle.test.ts`.
4. **Assessor self-verify via PUT**: `UpdateRapidAssessmentSchema` accepts `verificationStatus`, so the owning assessor flips SUBMITTED→VERIFIED with no coordinator and no verifiedBy/verifiedAt. `security-characterization.test.ts`.
5. **Assessment DELETE deadlock**: route demands COORDINATOR/ADMIN, service demands assessor-ownership → nobody but a coordinator-role assessor can delete; both single-role paths 403. `security-characterization.test.ts`.
6. **No login lockout**: 5 wrong passwords never lock the account (no failedAttempt tracking). `security-characterization.test.ts`.
7. **Severity threshold OR-semantics** documented (injured 600 → CRITICAL via the 501 tier minimum) — may be intended, pinned to force a decision. `severity-and-sync.test.ts`.
8. **Sync pull = 501 stub** (not yet implemented). `severity-and-sync.test.ts`.

### Verified-good behaviors worth knowing survived
- All 11 matrix routes gate correctly; anonymous → 401 everywhere tested.
- `passwordHash` stripped on every user read path (list + create).
- Delivery confirmation by an *unassigned* responder is correctly rejected (403) with no state change.
- Commitment progress math (PLANNED→PARTIAL, item-level deliveredQuantity) is exact.
- Severity derivation matches the dashboard rule (latest verified per entity+type, UNCLASSIFIED skipped).

### Conventions established (for Phase 2+)
- Route handlers imported directly + invoked with `makeRequest`/`withParams`/`tokenFor` (`tests/helpers/api.ts`); dynamic-route handlers that parse the URL themselves (assessments/[id]/verify, responses/[id]/verify) require the real id in the URL path.
- Every suite truncates before+after; factories guarantee uniqueness (timestamp+counter+random).
- `createRapidAssessment` now accepts `rapidAssessmentDate` override (needed for latest-per-type ordering).

---

## Phase 2 Report — Unit + Service Layer

**Status: COMPLETE — all suites green**

### New suites

| Suite | Env | Tests | Covers |
|---|---|---|---|
| `tests/unit/gap-analysis.test.ts` | jsdom (mocked severity config seam) | 15 | 5 sector analyzers: gap-field detection, inverted flags (`hasOpenDefecationConcerns`, `areOvercrowded`, `gbvCasesReported`), recommendation mapping, severity passthrough, single-consultation contract |
| `tests/unit/scoring-config.test.ts` | jsdom (pure fn) | 18 | `validateScoringConfig` weight-sum rule, every numeric range, boundary acceptance, defensive default copy |
| `tests/unit/validation-schemas.test.ts` | jsdom (pure zod) | 20 | FOOD/WASH/SHELTER cross-field refinements, `CreateRapidAssessmentSchema` discriminated union, `CreateIncidentSchema` (status default, coord range), `ConfirmDeliverySchema` |
| `tests/services/gap-field-severity.test.ts` | node (real drms_test) | 10 | DB-driven severity mapping: max-wins, LOW-empty, MEDIUM-unknown-field, inactive exclusion, per-type isolation, `updateFieldSeverity` cache invalidation, bulk transaction |
| `tests/services/scoring-config.test.ts` | node (real drms_test) | 6 | defaults w/ no rows, full round-trip, upsert-not-duplicate, validate-before-persist, garbage-value fallback, string coercion |
| `tests/services/auth-token.test.ts` | node | 8 | JWT round-trip, iat/exp contract, 24h window, tampered/garbage rejection, bcrypt salt+verify |

### Totals

- **Unit (root config): 4 suites / 70 tests** (3 new = 53, pre-existing signals = 17)
- **API+services (`jest.api.config.js`): 11 suites / 120 tests** (Phase 1's 96 + 24 new)
- Consecutive green runs of both configs verified.

### Conventions / gotchas pinned

- `tests/setup.ts` globally mocks `@prisma/client` with ONLY `PrismaClient` — no enums. Unit suites that transitively import `AssessmentType`/`Priority` as values must re-register the module mock with the enums (test-file registration overrides setup-file).
- `GapFieldSeverity.updatedBy` is FK-constrained to `User` — severity-update paths in tests need a real user id.
- `validateScoringConfig` messages use human labels ("delivery weight"), not camelCase keys — match on labels.
- JWT `iat` has 1-second granularity: two tokens for the same payload minted in the same second are identical (pinned, not a defect).
- `updateFieldSeverity`/`bulkUpdateSeverities` clear the 30s severity cache themselves; tests verify read-through without manual `clearCache()`.

---

## Phase 3 Report — E2E Golden Journeys (Playwright)

**Status: COMPLETE — 9/9 green**

### Architecture (isolation-first)

- New config `playwright.baseline.config.ts` + new dir `tests/e2e-baseline/` — fully separate from the quarantined legacy corpus (`tests/e2e`, `tests/smoke`).
- **Own server, own DB**: webServer boots `next dev -p 3100` with `DATABASE_URL` forced to drms_test and a fixed `JWT_SECRET` (`reuseExistingServer: false` — a developer's :3000 server is never accidentally reused against the dev DB).
- `global-setup.ts` loads `.env.test`, hard-guards the drms_test URL, truncates, seeds 5 roles + 4 golden-journey users (one per role, `Baseline#Pass1`). Raw Prisma + bcrypt only (Playwright globalSetup does not resolve tsconfig `@/` aliases).
- Chromium only; generous timeouts for on-demand dev compilation.

### Journeys

| Spec | Tests | Pins |
|---|---|---|
| `login.spec.ts` | 7 | login form renders; wrong password → inline "Invalid email or password" + stays on /login; unknown email → same opaque error (no enumeration); role→dashboard redirect map for all 4 roles (URL + `<h1>`) |
| `assessment-journey.spec.ts` | 2 | assessor reaches rapid-assessments workspace + CTA + new-assessment form; unauthenticated /rapid-assessments/new redirects to /login |

### E2E gotchas pinned

- The "New Assessment" surface has 3 role-name matches (sidebar link, sidebar button, page CTA) — the page CTA is pinned via `data-testid="new-assessment-button"` (renders disabled when no incidents exist).
- `LoginForm` redirects via a 100ms `setTimeout` after login resolves — `waitForURL`/`toHaveURL` with generous timeouts absorbs it.

---

## FINAL BASELINE — Regression Suite Status

**All three layers green in consecutive full runs (burn-in verified):**

| Layer | Command | Result |
|---|---|---|
| Unit (jsdom) | `npm run test:unit` | 4 suites / **70 tests** |
| API + services (real drms_test) | `npm run test:api` | 11 suites / **120 tests** |
| E2E golden journeys | `npm run test:baseline:e2e` | 2 specs / **9 tests** |
| Everything | `npm run test:baseline:all` | **199 tests** |

### Regression contract

- **Characterized defects stay pinned** (8 from Phase 1): a fix will intentionally flip these tests — update the test + remove the "known defect" comment in the same change.
- **Schema/route/service contracts are load-bearing**: zod refinements, response envelopes, severity thresholds, redirect map, and severity-config cache semantics are all executable specs now.
- **DB discipline**: every jest API/services suite truncates drms_test before+after; E2E global-setup truncates once per run. Never point these at drms_dev (env guards refuse to run).

### Recommended cadence

- Pre-merge: `npm run test:baseline:all` (fast enough for local; E2E ~1 min after first compile).
- The legacy corpus (`tests/e2e/**`, `tests/smoke/**`, `tests/legacy-backup/**`) remains quarantined and is NOT part of the baseline.
