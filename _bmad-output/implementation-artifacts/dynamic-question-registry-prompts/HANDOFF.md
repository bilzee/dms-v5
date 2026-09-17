# DQR — Handoff (post P9: hardening + holistic gate close)

Status: **Feature-complete and green locally.** The dynamic question registry
replaces the hardcoded assessment forms end-to-end; every gate passes on the
workstation (PostgreSQL test instance on `localhost:5435`, database
`drms_test`). This note records what shipped, what an operator must do to
deploy, and what remains risky or open.

## Shipped (P1 → P9, one-line each)

- **P1–P2** Registry tables + governance API: `question_sections`/`questions`,
  `QuestionAuditLog`, per-type `structureVersion`/`contentVersion` counters,
  Tier A/B edit rules, freeze rule, invariants, reorder, export.
- **P3–P4** Registry-driven forms: one `DynamicAssessmentForm` for all six
  types; per-submission structure-only `questionSnapshot` + versions frozen
  onto `RapidAssessment`.
- **P5** Offline sync: key-addressed answers, never-reject drift contract
  (unknown keys ride along as warnings), client version handshake
  (`structureVersion` + `questionKeys`) re-stamped server-side; **draft
  auto-migration** across registry edits with staleness banner +
  unmapped-answer disclosure; drafts consumed on submit.
- **P6** Severity inheritance (D-4): assessment priority, notifications, and
  action signals derive from the registry severity of the top gap.
- **P7–P8** Dashboards/reports render gap summaries from stored snapshots
  (ranked rows, overflow chip, aggregated `Severities as of registry v…`
  stamp); situation summaries registry-driven.
- **D-4** Severity inheritance: assessment priority, notifications, and
  action signals derive from the registry severity of the top gap.
- **P9 (this slice)** ACTIVE-incident submission guard on the **online**
  create/update paths (404 unknown incident / 409 non-ACTIVE, no row written
  on failure; on update the check fires when the payload re-points the
  incident). Offline sync stays never-reject by ruling — an incident resolved
  mid-flight never discards a completed field assessment. Plus:
  production-safe seed split (`--with-sample-data` opt-in); baseline E2E
  grows an ADMIN user, a seeded registry world, and a bottom-up proof spec;
  docs closed out (api-contracts §4.25, schema data dictionary, deploy
  runbook, question-authoring guide); registry freeze export archived at
  `_bmad-output/implementation-artifacts/dqr-p9-registry-export.json`
  (schemaVersion 1, 6 types, 55 questions, all v1/v1).

## The nine commits

| # | Commit | Scope |
|---|--------|-------|
| P1 | `b8ccfd2` | Registry schema, seed catalog, answers data layer |
| P2 | `465c279` | Registry service, admin API, governance (Tiers/freeze/invariants/audit) |
| P3 | `357e5b1` | Gap engine + derivation from registry severities |
| P4 | `b8cb07f` | Dynamic assessment form replaces the six hardcoded forms |
| P5 | `b044892` | Never-reject offline sync + draft auto-migration |
| P6 | `83dced6` | Severity inheritance for notifications and signals (D-4) |
| P7 | `7bd9df5` | Registry-driven situation dashboard summaries |
| P8 | `112a9a0` | Admin question editor + coordinator severity page |
| P9 | this commit | Hardening, docs, and holistic gate close |

## Deploying (manual steps — nothing here is automated)

Follow the runbook in `docs/development-guide.md` → "Fresh Production Deploy
Runbook (DQR P9)". Short version:

1. `npx prisma db push` (or `prisma migrate deploy` in a managed pipeline)
   against the production database.
2. `npx prisma db seed` — production-safe baseline: permissions, roles, admin +
   coordinator accounts, reference entities, the question registry. **Do not
   pass `--with-sample-data` in production** (that flag adds demo incidents,
   assessments, donors, and test users).
3. Verify the registry: `GET /api/v1/questions?assessmentType=HEALTH` (six
   types, `structureVersion`/`contentVersion` = 1/1 on a fresh seed) or the
   badges on `/admin/settings/questions`.
4. Rotate the seeded admin credentials (`admin@dms.gov.ng / admin123!`)
   immediately and create real operator accounts.
5. Create a first ACTIVE incident before assessors go to the field — since
   P9, **online** submissions against unknown or non-ACTIVE incidents are
   rejected (404/409) on purpose; offline sync keeps accepting completed
   field work regardless (never-reject ruling).
6. Run `npm run build:validated` before cutting traffic.

### Bil's 10-minute smoke tour (local, after `npx prisma db seed -- --with-sample-data`)

1. Login `admin@dms.gov.ng / admin123!` → `/admin/settings/questions` →
   HEALTH tab → search "Functional Clinic" → edit its label, enter a
   reason, save → the badge bumps `content v2` (structure stays v1).
2. Login `assessor@test.com / test-password` → `/rapid-assessments/new?type=HEALTH`
   → the form shows the NEW label → answer it into the gap state → the Z5
   risk row appears → submit.
3. Login `coordinator@dms.gov.ng / coordinator123!` → the notification bell
   shows the assessment notification at CRITICAL (registry severity of the
   failed question, inherited via D-4).
4. `/coordinator/situation-dashboard` → select the sample flood incident →
   the health card ranks the gap CRITICAL with the edited phrasing, stamped
   `Severities as of registry v…` from the stored snapshot.
5. Freeze check (optional): try a Tier B edit (e.g. question type) on a
   question with in-flight assessments → the editor shows the frozen banner
   and the API answers 409 `question_frozen`.

## Durable-state notes for an existing environment

- The guard is service-level. Pre-existing rows pointing at RESOLVED/CLOSED
  incidents are untouched (they are history); only new submissions and
  answers-carrying updates are gated.
- Registry version counters live in `system_settings`
  (`section = 'question-registry'`); they are monotonic per type and are
  created by the seed.
- **Deploy step 1 already gives the SQL-layer guarantee**: the Prisma
  relation `RapidAssessment.incident → Incident.id` (schema.prisma) creates
  the foreign key on `incidentId`, so a dangling id fails at the database as
  it always has. The ACTIVE half of the rule cannot be expressed as a
  constraint and is exactly what the service guard covers; nothing extra to
  add post-deploy.

## Verification (what "green" means here)

Run in this order; all were run locally after P9:

```bash
npm run lint && npm run type-check
npm run test:unit
npm run db:push:test          # drms_test schema in sync
npm run test:api              # incl. tests/api/submission-guard.test.ts
                              # and tests/api/seed-partition.test.ts
npm run test:baseline:e2e     # incl. registry-bottom-up.spec.ts
npm run build
```

## Gate results (P1–P9)

| Prompt | Gates run | Evidence artifact(s) |
|--------|-----------|----------------------|
| P1 | baseline lint/tsc/unit captured; schema validate, seed idempotency | `dqr-p1-baseline-{lint,tsc,unit}.log`, `dqr-p1-*.log` |
| P2 | lint/tsc/unit/api + `db:push:test`; admin API parity | `dqr-p2-api(-evidence).log`, `dqr-p2-review2-*.log` |
| P3 | full baseline; gap recompute sweep | `dqr-p3-baseline.log`, `dqr-p3-recompute-evidence.log` |
| P4 | full baseline; form render per type (visual) | `dqr-p4-api-evidence.log`, `dqr-p4-form-{health,population}.png` |
| P5 | full baseline; sync ingestion evidence | `dqr-p5-baseline.log`, `dqr-p5-sync-evidence.log`, `dqr-p5-review.diff` |
| P6 | severity-source guard + baseline | `dqr-p6-severity-sources.log` |
| P7 | full baseline + dashboard visual | `dqr-p7-gates.log`, `dqr-p7-dashboard.png` |
| P8 | unit/api/e2e/build green at `112a9a0`; editor/severity visuals | `dqr-p8-{editor,frozen-banner,severity}.png`, spec-dqr-p8 acceptance |
| P9 | lint/tsc/unit/api/e2e/build, all green (see Verification above) | this commit; `dqr-p9-registry-export.json` |

## Rulings → code map

| Binding ruling | Where it lives |
|----------------|-----------------|
| D-1/D-2 ADMIN owns question editing; COORDINATOR edits severity only | `src/app/api/v1/admin/questions/**` (ADMIN), `.../[id]/severity` (ADMIN\|COORDINATOR), `QuestionRegistryEditor.tsx`, `GapSeverityTable.tsx` |
| D-3 snapshot-first registry | `src/lib/questions/question-snapshot.ts` (`buildQuestionSnapshot`), `RapidAssessment.questionSnapshot` |
| D-4 severity inheritance (notification/signal priority = severity of the triggering object) | `src/lib/severity-inheritance.ts:18,43`, `action-signal.service.ts` notification fan-out, `tests/unit/severity-source-guard.test.ts` |
| Derivation rule: assessment priority = MAX severity of fired gaps | `src/lib/questions/gap-engine.ts:150` (`analyzeGaps`), wired in `rapid-assessment.service.ts` create/update/offline paths |
| Per-question freeze driven by in-flight usage (not incident counts) | `question-registry.service.ts:362–371` (409 `question_frozen` + affectedCount) |
| Offline sync never rejects a completed assessment | `sync-processing.service.ts` + `offline-answers` ingestion; pinned by `tests/api/offline-sync.test.ts` and `submission-guard.test.ts` rows 7/9/10 |
| Dual version counters (Tier A content / Tier B structure) | `src/lib/questions/registry-versions.ts`, `SystemSetting` rows, `QuestionAuditLog` |
| P9 ACTIVE-incident guard, online-only | `rapid-assessment.service.ts` `assertActiveIncident` (create; update when re-pointing), `tests/api/submission-guard.test.ts` rows 1–6 |

## Plan §0 goals → evidence

| Goal (plan §0) | Evidence |
|----------------|----------|
| 1. Single source of truth for all 55 questions | `prisma/schema.prisma` (`Question`/`QuestionSection`/`QuestionAuditLog`), `prisma/seed-questions.ts`, `dqr-p9-registry-export.json` |
| 2. Admin-editable questions; COORDINATOR severity-only | `QuestionRegistryEditor.tsx`, `GapSeverityTable.tsx`, `docs/api-contracts.md` §4.25 |
| 3. One formalized dynamic form for all six types | `src/components/forms/assessment/DynamicAssessmentForm.tsx` (single renderer; per-question testids) |
| 4. Generic gap/severity engine incl. POPULATION | `src/lib/questions/gap-engine.ts:150`, derivation wired on every write path |
| 5. Governed change windows (per-question freeze) | `question-registry.service.ts:362–371` (409 `question_frozen`) |
| 6. Registry-driven dashboard with top-N collapse | `src/lib/questions/gap-summary.ts:242`, situation route summaries, `gap-summary-stamp` |
| 7. Notification/signal severity inheritance (D-4) | `src/lib/severity-inheritance.ts`, `severity-source-guard.test.ts`, bottom-up E2E leg 3 |

## Risks / known trade-offs

- **Offline explicit incident switch.** The offline paths never re-validate
  incident state (by ruling), so an offline payload that explicitly carries
  `incidentId` pointing at a non-ACTIVE incident is accepted as-is. The API
  tests pin the realistic mid-flight-resolution case; if explicit offline
  incident switching matters, it needs its own product decision.
- **Offline update route shape.** `POST /api/v1/sync/batch` checks the
  syncing user's entity assignment against `change.entityUuid`, which for
  updates is the assessment id — so real-world offline updates of existing
  rows cannot pass that route-level check (existing behavior; the API tests
  exercise updates through `SyncProcessingService.processBatch` directly).
  If offline updates matter in the field, the route guard needs a carve-out
  (check the target row's entity instead). Not a regression — pre-P5 shape.
- **Stamp semantics.** The aggregated dashboard stamp prints the snapshot's
  `contentVersion` only (`Severities as of registry v{contentVersion}`), not
  the full structure.content pair. If operators expect "v1.2"-style stamps
  on the dashboard, that label needs a product decision.
- **The bottom-up E2E leg pins `Registry v1.2` / `registry v2`** — these are
  deterministic only because global-setup re-truncates and re-seeds the
  registry fresh each run. Any test that edits registry content before that
  spec in the same run would shift versions (suite ordering currently keeps
  them independent).
- **`assessor@test.com` demo user** is only created with `--with-sample-data`
  now; any environment that relied on the default seed providing it (older
  staging boxes) needs a re-seed with the flag or explicit user creation.

## Follow-ups (nice-to-have, not blocking)

- SQL-level FK for `rapid_assessments.incidentId` (see above) plus a one-off
  cleanup query for historical dangling references, if any exist.
- Split the sample-data E2E users out of `prisma/seed.ts` into the Playwright
  global-setup entirely (today both exist: seed `--with-sample-data` users
  for local demos, baseline-suite users for E2E).
- Consider an import counterpart for `GET /api/v1/admin/questions/export`
  (restore/migrate registries between environments).
- The `gap-field-management` coordinator page and the admin editor both edit
  severity; the editor is the richer surface. Consolidate or cross-link.

## Pointers

- Spec: `_bmad-output/implementation-artifacts/spec-dqr-p9-hardening-holistic-gate-close.md`
- Plan: `docs/plans/dynamic-question-registry-plan.md`
- Authoring how-to: `docs/question-authoring-guide.md`
- API contracts: `docs/api-contracts.md` §4.25 (Question Registry)
- Data dictionary: `docs/schema-reference.md` → "Dynamic Question Registry —
  Data Dictionary"
- Guard tests: `tests/api/submission-guard.test.ts`; bottom-up proof:
  `tests/e2e-baseline/registry-bottom-up.spec.ts`
- Freeze export: `dqr-p9-registry-export.json` (sibling of this file's parent)
