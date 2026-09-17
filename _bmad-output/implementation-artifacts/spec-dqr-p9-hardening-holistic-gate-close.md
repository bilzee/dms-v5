---
title: 'DQR P9 — Hardening, Docs, and Holistic Gate Close'
type: 'feature'
created: '2026-09-17'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '112a9a0'
context:
  - '{project-root}/docs/plans/dynamic-question-registry-plan.md'
  - '{project-root}/_bmad-output/implementation-artifacts/dynamic-question-registry-prompts/prompt-9-hardening-holistic-gate.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The Dynamic Question Registry program (prompts 1–8, commits `b8ccfd2`..`112a9a0`) ships the registry, dynamic form, gap engine, never-reject sync, severity inheritance, dashboard, and admin editor — but the close-out work is missing: no server-side guard rejects assessment submissions against non-ACTIVE incidents; the registry's API routes and seed workflow are undocumented; there is no end-to-end proof that a question edit flows bottom-up to notifications; and no handoff record exists.

**Approach:** Add the ACTIVE-incident submission guard with API tests; extend the baseline e2e suite (registry-seeding global-setup, updated assessment journey, one bottom-up proof spec: ADMIN edit → form label → derived severity → incident rollup → dashboard ranking → notification priority); document API contracts, schema/data dictionary, question authoring guide, and seed commands; add the `--with-sample-data` seed flag and fresh-deploy runbook; archive the registry export; write HANDOFF.md with the plan §0 goals→evidence table; run full parity gates and commit.

## Boundaries & Constraints

**Always:**
- Bil's binding decisions, esp. (7) offline sync **never rejects a completed assessment** — the ACTIVE-incident guard applies to online create/update only (`RapidAssessmentService.create`/`update`); the offline path (`createOfflineAssessment`) stays never-reject.
- Baseline parity is the bar: lint 0 new vs `dqr-p1-baseline-lint.log`; type-check/unit/api failure sets identical to p1 baseline plus this program's new suites; `npm run build` green.
- Existing e2e behavioral assertions kept; fixture changes landed honestly.
- Evidence artifacts → `_bmad-output/implementation-artifacts/` with `dqr-p9-` prefix; single commit `feat(questions): hardening, docs, and holistic gate close`.

**Never:**
- No new features beyond plan scope; surfaced gaps go to HANDOFF deferrals.
- No "Recalculate All"; no backward compatibility shims; no new migrations.
- Don't touch quarantined legacy suites (`tests/e2e`, `tests/legacy-backup`).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Online create, ACTIVE incident | `POST /api/v1/rapid-assessments` with valid incidentId, incident.status=ACTIVE | 201 as today; guard passes | N/A |
| Online create, incident missing | incidentId references no Incident | 404 `Incident not found` (ApiError) | Route error mapper |
| Online create, incident not ACTIVE | incident.status=CONTAINED or RESOLVED | 409 `Incident <id> is not active` | Route error mapper |
| Online update, incident switch to inactive | `PUT /api/v1/rapid-assessments/[id]` changing incidentId to non-ACTIVE incident | 409 as above | Route error mapper |
| Offline sync create, any incident state | `POST /api/v1/sync/batch` assessment create | unchanged never-reject behavior | per-change 207 result as today |
| Seed default | `prisma db seed` | permissions, roles, admin+coordinator users, entities, question catalog; no sample incidents/assessments/donors | idempotent |
| Seed with flag | `prisma db seed -- --with-sample-data` (or `SEED_WITH_SAMPLE_DATA=1`) | default + sample incidents, assessments, donors, demo/e2e users | idempotent |

</frozen-after-approval>

## Code Map

- `src/lib/services/rapid-assessment.service.ts` — `create()` L137–222 (incidentId written verbatim L181, no check), `update()` L611–694 (incidentId spread unvalidated), `createOfflineAssessment()` L238–344 (leave untouched). Entity-existence pattern L147–154 reusable for incident check. Use `ApiError` (see existing 422 usage) for 404/409.
- `src/app/api/v1/rapid-assessments/route.ts` — POST L45–69; `[id]/route.ts` PUT; error mapping via existing handler.
- `tests/api/` — add `submission-guard.test.ts` (patterns: `assessment-edit.test.ts`, `severity-and-sync.test.ts`; api jest config uses real `drms_test`).
- `tests/e2e-baseline/global-setup.ts` — truncates all tables, seeds roles+5 users; must add: `seedQuestions(prisma)` (from `prisma/seed-questions.ts`), 1 entity, 1 ACTIVE incident, assessor→entity assignment, ADMIN user (missing from `baseline-users.ts`).
- `tests/e2e-baseline/baseline-users.ts` — add ADMIN entry (password `Baseline#Pass1`).
- `tests/e2e-baseline/assessment-journey.spec.ts` — existing thin journey; comment L21–23 notes CTA disabled without incidents — becomes enabled after global-setup seeds an incident; update assertion honestly.
- `tests/e2e-baseline/registry-bottom-up.spec.ts` — NEW spec. Selector inventory: editor `src/components/settings/question-registry/QuestionRegistryEditor.tsx` (`registry-type-tab-HEALTH`, rows + `registry-edit-button`), `QuestionEditDialog.tsx` (`question-label-input`, `question-severity-select`, `question-save-button`, `question-frozen-banner`); form `src/components/forms/assessment/DynamicAssessmentForm.tsx` (per-question testid `kebabCase(key)`, `risk-row-{kebab}`, `submit-assessment-button`); dashboard `src/app/(auth)/coordinator/situation-dashboard/page.tsx` + `AssessmentCategorySummary.tsx` (`gap-summary-stamp`; severity text-based asserts). Notification leg via API `GET /api/v1/notifications` (UI bell has no testids — HANDOFF deferral).
- `prisma/seed.ts` (968 lines) — full seed: permissions/roles L15–182, entities L188–212, users L216–403, incidents L546–584, registry L586–593, sample assessments L612–774, donors L776–885, e2e users L889–943. Add `--with-sample-data` gate (argv + `SEED_WITH_SAMPLE_DATA` env). `prisma/seed-questions.ts` is already questions-only (document; no change).
- `docs/api-contracts.md` — §4.25 Gap Field Severities documents deleted routes; registry routes absent. Replace with Question Registry group; verify actual verbs (`PATCH` severity, not plan's PUT).
- `docs/schema-reference.md` — registry models already listed; add Appendix-B data-dictionary section (label/gapLabel/gapMeaning/recommendation/helperText registers).
- `docs/development-guide.md` — §5/§6 command tables lack `prisma db seed`, seed flags, `test:api`, `test:baseline:*`, `db:push:test`; §10 add fresh-production deploy runbook (plan §7).
- `docs/question-authoring-guide.md` — NEW (plan P8 + §7 step 5): D-1/D-3 owner guide; Appendix B rendered-context examples; admin editor vs seed reconciliation policy.
- `src/app/api/v1/admin/questions/export/route.ts` → `QuestionRegistryService.exportRegistry()` (service L280–303) — archive output as `dqr-p9-registry-export.json`.
- `_bmad-output/implementation-artifacts/dqr-p1-baseline-*.log` — parity baselines (lint/tsc/unit).
- `example-support-prompts/HANDOFF.md` — cited model; verify existence, else follow prompt-9 §6 structure list.

## Tasks & Acceptance

**Execution:**
- [x] `src/lib/services/rapid-assessment.service.ts` — add incident existence + ACTIVE guard to `create()` and `update()` (update: when incidentId present in payload) — closes plan P7 server-side guard.
- [x] `tests/api/submission-guard.test.ts` — new: ACTIVE pass-through, missing incident 404, non-ACTIVE 409 (create + update), offline path unchanged — proves the guard.
- [x] `tests/e2e-baseline/baseline-users.ts` + `global-setup.ts` — add ADMIN user; seed question registry, one entity, one ACTIVE incident, assessor assignment — enables dynamic-form e2e.
- [x] `tests/e2e-baseline/assessment-journey.spec.ts` — land fixture-driven assertion updates (CTA now enabled), keep behavioral asserts — prompt §2 "update existing assessment e2e".
- [x] `tests/e2e-baseline/registry-bottom-up.spec.ts` — new bottom-up proof: ADMIN edits `hasFunctionalClinic` label→visible rename + severity→CRITICAL; assessor form shows new label; submission with that gap derives CRITICAL; incident severity CRITICAL; dashboard ranks gap with new label; notification carries CRITICAL — holistic program verdict.
- [x] `prisma/seed.ts` — `--with-sample-data` opt-in flag (argv + env) gating sample incidents/assessments/donors/demo+e2e users; default = operational minimum — plan §7 step 2 / Q-6.
- [x] `docs/api-contracts.md` — replace deleted §4.25 with Question Registry routes (`/questions`, `/admin/questions` CRUD/reorder/export/severity(PATCH)/impact/audit, `/admin/sections`); refresh stale counts.
- [x] `docs/schema-reference.md` — add question field data dictionary (Appendix B registers + rendered-context guidance).
- [x] `docs/development-guide.md` — seed commands entry (default vs `--with-sample-data`, dev/staging reset flow) + fresh-production-deploy runbook (export baseline as record).
- [x] `docs/question-authoring-guide.md` — new authoring guide for the D-1 ADMIN (Appendix B examples, editor workflow, freeze rules, seed reconciliation).
- [x] `_bmad-output/implementation-artifacts/dqr-p9-registry-export.json` — archive `exportRegistry()` output against a freshly-seeded registry.
- [x] `_bmad-output/implementation-artifacts/dynamic-question-registry-prompts/HANDOFF.md` — nine commits, state of the world, gate-results table (9 prompts), ruling→code map (D-1..D-4, derivation rule, per-question freeze, never-reject sync, dual versions), Bil's 10-minute smoke tour, deferrals, plan §0 goals→file:line evidence table.

**Acceptance Criteria:**
- Given an incident with status CONTAINED, when an ASSESSOR posts a rapid assessment to it online, then the API responds 409 and no row is created.
- Given the baseline e2e suite, when `npm run test:baseline:e2e` runs, then all existing specs plus `registry-bottom-up.spec.ts` pass.
- Given a fresh `prisma db seed` without flags, then no sample incidents/assessments/donors exist but the 55-question registry is seeded; with `--with-sample-data` they do.
- Given the gates, then lint has 0 new findings vs p1 baseline, type-check/unit/api failure sets are baseline-identical plus new suites, `npm run build` green, new e2e green, export + HANDOFF archived.
- Commit `feat(questions): hardening, docs, and holistic gate close` lands with evidence artifacts.

## Implementation Notes

Planning-time decisions (from binding rulings, recorded for the implementer):
- Guard scope: online create/update only. Offline `createOfflineAssessment` must not gain an ACTIVE rejection — decision (7) + plan §4 `/sync` row ("never rejects a completed assessment"). `sync-processing.service.ts:119` incidentId→entityUuid fallback quirk recorded in HANDOFF deferrals, not fixed here (out of scope).
- "Matching assessment type" in prompt §1: Incident carries no assessment-type linkage (`type` is free-text FLOOD/DROUGHT); type correctness is already enforced via registry snapshot validation. Guard = exists + ACTIVE. Documented in HANDOFF.
- Notification-leg assertion via API (UI bell lacks testids) — noted as deferral.
- `example-support-prompts/HANDOFF.md` may not exist in-repo; if absent, follow prompt-9 §6's enumerated structure and note it.

Post-implementation corrections (diff review vs frozen matrix):
- The initial implementation wired `assertActiveIncident` into `createOfflineAssessment`/`updateOfflineAssessment` and made the online `update()` guard unconditional. Both were corrected to match the frozen block: offline paths carry NO incident-state guard (never-reject ruling, matrix row 5); online `update()` guards only when the payload re-points `incidentId` (task text). Tests 7/9 rewritten to pin acceptance under RESOLVED incidents offline; docs (api-contracts §4.25 guard note, schema-reference `incidentId` row, question-authoring-guide drift-contract item 4) updated to match.
- Doc fact fixes vs code: `questionType` enum is `BOOLEAN|NUMBER|SINGLE_CHOICE|MULTI_SELECT|TEXT_LONG` (no TEXT/DATE); version counters live at `SystemSetting` section `QUESTION_REGISTRY`, keys `structureVersion/{TYPE}`/`contentVersion/{TYPE}` (`src/lib/questions/registry-versions.ts`).

Step-04 review patches (see Review Triage Log rows 1–12):
- `update()` guard refined to compare-vs-stored `incidentId` (echoing the stored id never 409s); `create()` now validates entity assignment before the incident guard (no existence oracle). Pinned by `submission-guard.test.ts` rows 2b (CONTAINED 409), 6b (same-echo 200 after RESOLVED), re-point 409/404.
- `registry-bottom-up.spec.ts` strengthened: severity edit performed through the real admin editor dialog (global-setup no longer pre-pins it), derived-priority + signal-linked notification + incident-rollup asserted via API, dashboard leg asserts the edited `gapLabel` text and the `v2` stamp.
- New `tests/api/seed-partition.test.ts` pins the seed partition contract (both seed forms run as child processes against drms_test; `SEED_WITH_SAMPLE_DATA` pinned off for the default leg).
- Doc corrections: `npx prisma db seed` command forms (9 locations), HANDOFF FK/P5-P6 fixes, authoring-guide Appendix A + reconciliation policy, api-contracts summary stats made internally consistent (phantom `update-priorities` rows removed per the P3 defer; 192 = group sum; method distribution replaced with codebase-verified 257 handlers / 180 route files), schema-reference options/severity rows.

## Spec Change Log

## Review Triage Log

- Diff review vs frozen matrix caught two violations in the initial implementation (offline guard wiring; unconditional online-update guard) — fixed before gates; see Implementation Notes.
- Lint parity vs `dqr-p1-baseline-lint.log`: 30 findings vs baseline 37; the 7 delta are warnings inside the six hardcoded form components deleted in P4. Two findings moved lines only (`Navigation.tsx` 545→552, `gap-analysis.service.ts` 300→259 — same rules, files legitimately edited this program). **0 genuinely new findings.**

Step-04 three-layer review (blind-hunter / edge-case-hunter / verification-gap against `dqr-p9-diff.patch`, 166 KB; findings independently verified against source before routing):

| # | Finding (layer) | Verdict | Route / fix |
|---|---|---|---|
| 1 | Update guard fired on `incidentId !== undefined` (presence), not re-pointing — the edit UI echoes the stored incidentId, so editing after incident resolution would falsely 409 (BH+EC+VG) | Confirmed, HIGH | **patch**: guard now compares vs stored `existingAssessment.incidentId`; regression rows added (same-echo after RESOLVED → 200; re-point → 409/404) |
| 2 | create() checked incident (404) before entity-assignment auth (403) — existence oracle for unassigned assessors (EC) | Confirmed | **patch**: `validateEntityAssignment` now precedes `assertActiveIncident`; pinned by existing 403-then-success rows |
| 3 | CONTAINED never exercised by the guard tests (VG) | Confirmed | **patch**: `containedIncidentId` fixture + CONTAINED-409 row |
| 4 | Offline-update test left incident RESOLVED on failure (no try/finally) (EC) | Confirmed | **patch**: wrapped, restores ACTIVE in finally |
| 5 | Bottom-up e2e overclaimed: CRITICAL severity pre-pinned by fixture surgery in global-setup (bypassing governance), no incident-rollup assertion, no dashboard gap-phrase assertion, notification linkage loose (VG) | Confirmed | **patch**: global-setup un-pins; admin editor leg performs label+gapLabel+severity edit through the real dialog (Radix select); leg 3 asserts derived priority CRITICAL, signal-linked notification priority, and incident severity rollup via `GET /incidents/{id}`; leg 4 asserts the edited `NEW_GAP_LABEL` text and the `v2` stamp |
| 6 | `npm run seed` does not exist (no `scripts.seed`; correct command is `npx prisma db seed`) — 9 doc locations: development-guide ×5, HANDOFF ×2, QA workflow docs ×2 (BH) | Confirmed | **patch**: all 9 corrected; QA docs now use `npx prisma db seed -- --with-sample-data` (demo users are flag-only since P9) |
| 7 | HANDOFF advised a post-deploy `ALTER TABLE ... ADD CONSTRAINT` for the incident FK, but the FK already exists via the Prisma relation (schema.prisma:278) (BH) | Confirmed | **patch**: note rewritten — step 1 (`prisma db push`) already creates it |
| 8 | HANDOFF Shipped bullets contradicted the nine-commits table (P5/P6 scope) (BH) | Confirmed | **patch**: bullets aligned (P5 = never-reject sync + draft auto-migration; P6 = D-4 severity inheritance) |
| 9 | Authoring guide missing the rendered-context examples appendix and the admin-edits-vs-seed reconciliation policy that development-guide cross-references (VG+BH) | Confirmed | **patch**: Appendix A (five text registers + verified `hasFunctionalClinic` worked example) and the reconciliation section added |
| 10 | api-contracts summary stats internally impossible: group rows sum 194 vs Total 199; method table totals 192 pairs < 199 paths (BH) | Confirmed | **patch**: phantom `update-priorities` rows removed (P3-deferred fold-in), Total corrected to 192 = group sum; method distribution replaced with codebase-verified counts (GET 138/POST 68/PUT 25/PATCH 7/DELETE 19 = 257 handlers across 180 route files) + provenance note; ACTIVE-guard cross-ref added to the rapid-assessments route rows |
| 11 | schema-reference: `options` row omitted the `description?` field; severity row silent on CONTEXT questions carrying the unused default LOW (BH) | Confirmed | **patch**: both rows corrected |
| 12 | Seed partition verified only manually on a scratch DB — no automated pin (VG) | Confirmed | **patch**: new `tests/api/seed-partition.test.ts` runs both seed forms as child processes against drms_test and pins the partition counts |
| 13 | Seeded catalog wording/option-value inconsistencies (`Functional Clinic` noun label; `'River/Stream'` values) (BH) | Confirmed, pre-existing P1 catalog | **defer** → `deferred-work.md` "From Review (2026-09-17, DQR P9)" |
| 14 | TOCTOU: incident can resolve between guard check and write (EC) | Rejected | ms window, human-driven path; FK still guarantees existence; a serializable transaction/DB constraint for state is disproportionate — revisit only if auto-resolvers appear |
| 15 | `HEALTH_ANSWERS` constant duplicated across e2e files (BH) | Rejected | single-file constant; extraction churns testids for no behavioral gain |
| 16 | Cosmetic: export timestamps in the frozen export JSON, CTA-click niceties (BH) | Rejected | pre-existing shapes frozen at P9 gate; zero runtime effect |
| 17 | Post-patch re-verification exposed leg-4 flake: the aggregated card's `min-w-0 truncate` gap label collapses to **width 0** in the default 1280×720 viewport (squeezed split pane) — Playwright rightly refuses `toBeVisible`; initial "hidden duplicates" theory disproven by DOM probe (exactly one span, no hidden ancestors) (VG) | Confirmed | **patch**: leg 4 resizes to 1920×1080 — the dashboard's realistic operating width — before asserting visibility (long phrases truncate with a `title` tooltip by design); same-echo guard row's draft-`versionNumber` misassertion also retargeted (counter moves on submit only) |

## Design Notes

Bottom-up spec chain (single HEALTH question, `hasFunctionalClinic`, edited to CRITICAL before any assessment exists → Tier-A edit, no freeze):
```
ADMIN editor: label 'Functional Clinic'→'Functional Health Clinic (Verified)', severity MEDIUM→CRITICAL, save
  → assessor form shows the new label (testid `has-functional-clinic`)
  → answer into gap state → Z5 `risk-row-has-functional-clinic` appears
  → submit → derived priority CRITICAL (engine MAX of gapped severities)
  → incident severity recalcs CRITICAL (incident-severity service on create)
  → coordinator situation dashboard shows the gap ranked CRITICAL with edited label
  → GET /api/v1/notifications (coordinator) contains assessment notification priority CRITICAL
```
Seed partition: default keeps permissions, roles+grants, admin+coordinator accounts, entities, question catalog + version settings; flag adds sample incidents, sample assessments, donors+commitments, multirole/responder/assessor demo users, e2e users.

## Verification

**Commands:**
- `npm run lint` — 0 new findings vs `dqr-p1-baseline-lint.log`
- `npm run type-check` — failure set identical to `dqr-p1-baseline-tsc.log` (i.e., clean)
- `npm run test:unit` / `npm run db:push:test && npm run test:api` — failure sets identical to p1 baselines + new suites green
- `npm run test:baseline:e2e` — all specs green incl. new bottom-up spec
- `npm run build` — green
- `npx tsx prisma/seed.ts` then spot-check DB (default vs `--with-sample-data`) — partition correct

**Manual checks (if no CLI):**
- `dqr-p9-registry-export.json` contains schemaVersion/types for all 6 assessment types, 55 questions total.
- HANDOFF.md contains the nine commits, gate table, ruling→code map, §0 goals→evidence rows, smoke tour, deferrals.

**Results (2026-09-17, workstation, post-review final run `GATES4_EXIT=0`):** lint 0 new (see Review Triage Log); type-check clean; unit 20 suites/368 tests; api 19 suites/214 tests (incl. `submission-guard.test.ts` 13 rows and `seed-partition.test.ts` 2 rows); baseline e2e 13/13 (incl. 4 `registry-bottom-up` legs, 1.3m); `next build` compiled, 174/174 static pages. Two post-patch verification iterations were needed and fixed in-tree: (a) the guard test's same-echo row wrongly asserted a `versionNumber` bump on a draft update (that counter moves on submit only — assertion retargeted to stored incidentId + persisted answers); (b) the bottom-up leg-4 label assert failed because the aggregated card's `min-w-0 truncate` gap label collapses to width 0 in the default 1280×720 viewport (Playwright: not visible) — the leg now resizes to 1920×1080, the dashboard's realistic operating width, before asserting visibility (long phrases truncate with a title tooltip by design). Seed partition verified on scratch DB `drms_p9check` (dropped after): default → incidents 0, assessments 0, donors 0, users 2, questions 55, registry settings 12; `--with-sample-data` → incidents 2, assessments 5, donors 4/commitments 4, users 7.
