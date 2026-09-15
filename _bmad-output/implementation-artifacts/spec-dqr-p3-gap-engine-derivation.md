---
title: 'DQR P3 — Generic Gap Engine and Severity Derivation Rule'
type: 'feature'
created: '2026-09-15'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 465c279958df0f189adb343d7234fdc3192607b3
context:
  - '{project-root}/docs/plans/dynamic-question-registry-plan.md'
  - '{project-root}/_bmad-output/implementation-artifacts/dynamic-question-registry-prompts/prompt-3-gap-engine-derivation.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Prompt 1 left a mechanical port of the old inline gap computation (`src/lib/questions/gap-derivation.ts`) that reads `answers[key]` with legacy falsy-means-gap semantics, resolves severity only from active registry rows, and is duplicated by the service wrapper. Severity is not yet a derivation rule: editing a severity does not re-derive stored assessments, and obsolete bulk-recalculate endpoints still exist.

**Approach:** Implement the plan §2.3 derivation rule as a new pure engine `analyzeGaps(snapshotStructure, answers, registryRows)` in `src/lib/questions/gap-engine.ts`; wire the assessment service create/update/submit paths through it (`gapAnalysis`/`priority` become caches); make the P2 severity PATCH route re-derive every affected assessment in the same transaction and return the affected count; delete the structurally obsolete recalculate/update-priorities endpoints and their dead service methods.

## Boundaries & Constraints

**Always:**
- Gap on a GAP question = `inverted ? answers[key] === true : answers[key] === false`; a missing (`undefined`/`null`) answer is NEVER a gap — the row is emitted with `unanswered: true` instead.
- Severity resolution ladder per key: live registry row (matched by key, regardless of `isActive`) → snapshot severity (snapshots today carry none) → `source: 'unmapped'` with severity MEDIUM — never silently LOW (plan §2.3).
- Assessment severity = MAX over gapped rows (CRITICAL > HIGH > MEDIUM > LOW), LOW when none; POPULATION has zero GAP questions ⇒ LOW via the same rule, no special-casing.
- Stored `gapAnalysis` keeps existing keys (`hasGap`, `gapFields`, `severity`, `recommendations`, `fieldSeverityMap`) and adds `rows` + `unanswered`; a second derivation pass with unchanged inputs is byte-identical.
- Severity-edit recompute runs inside the `setSeverity` transaction: assessments of that type whose `questionSnapshot` contains the key AND whose incident is ACTIVE; snapshots and stored versions are untouched; only `gapAnalysis` + `priority` update.
- Registry rows without a matching snapshot key are ignored; snapshot keys with no live row fall to the ladder (intersection semantics).

**Never:** no schema/migration changes; no dynamic form/gating UX (p4); no offline-sync changes (p5); no notification changes (p6); no dashboard changes (p7); no editor UI/confirm-on-edit dialog (p8); no docs/e2e updates (p9); incident-severity rollup service logic stays untouched.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Non-inverted answered true | `hasFunctionalClinic: true` | No gap; row not in `gapFields` | N/A |
| Non-inverted answered false | `hasFunctionalClinic: false` | Gap; severity from ladder; source `registry` | N/A |
| Inverted answered true | `hasOpenDefecationConcerns`/`areOvercrowded`/`gbvCasesReported` = true | Gap | N/A |
| Inverted answered false | same keys = false | No gap | N/A |
| Missing answer | key absent / `undefined` / `null` | No gap; row `unanswered: true`; not in `gapFields` | N/A |
| Empty answers | `{}` | `hasGap:false`, severity LOW, all GAP rows unanswered | N/A |
| Deactivated live row | key inactive in registry | Still resolves; source `registry` | N/A |
| Unmapped key | no live row, snapshot has no severity | source `unmapped`; gapped row contributes MEDIUM floor; flagged | N/A |
| Intersection | registry rows absent from snapshot | Ignored — no phantom rows | N/A |
| MAX ordering | gapped rows at MEDIUM+HIGH+CRITICAL | severity CRITICAL; gaps ordered severity DESC, order ASC | N/A |
| POPULATION | snapshot with only CONTEXT questions | LOW, `hasGap:false` | N/A |
| Severity edit, ACTIVE incident | PATCH severity on key in snapshot | In-tx re-derive of matches; response `affectedCount`; contentVersion bump + audit as P2 | N/A |
| Severity edit, non-ACTIVE incidents only | matches exist but incidents RESOLVED/CONTAINED/no incident | Assessments untouched; `affectedCount` 0 | N/A |
| No-op severity edit | same severity value | P2 identity behavior preserved; no recompute, count 0 | N/A |
| Deleted endpoints | POST `/admin/severity/recalculate`, `/rapid-assessments/update-priorities` | 404 | N/A |

</frozen-after-approval>

## Code Map

- `src/lib/questions/gap-derivation.ts` — legacy port to DELETE; superseded by the engine (check `prisma/seed.ts:751` call site).
- `src/lib/services/gap-analysis.service.ts` — wrapper with 30s gap-question cache; `analyzeGaps(type, answers)` used by rapid-assessment service + situation dashboard fallback; keep wrapper + legacy analyzer names, re-serve from engine.
- `src/lib/questions/legacy-convert.ts:63-96` — `QuestionSnapshot` shape (`sections[].questions[]`, `key`/`category`/`inverted`/`gapLabel`/`recommendation`/`order`; NO severity by design).
- `src/lib/services/rapid-assessment.service.ts` — create (L130), update (L412), submit→`triggerGapAnalysis` (L541) call `analyzeGaps`; `updateAllHistoricalAssessmentPriorities` (L591) to DELETE; answers==null rows are skipped.
- `src/lib/services/question-registry.service.ts` — `setSeverity` (L790): tx + validate + content bump + audit; `countFrozenSnapshots` (L369) is the ACTIVE-incident matcher pattern to reuse.
- `src/app/api/v1/admin/questions/[id]/severity/route.ts` — PATCH route to extend with affected count.
- `src/app/api/v1/admin/severity/recalculate/route.ts`, `src/app/api/v1/rapid-assessments/update-priorities/route.ts` — routes to DELETE.
- `src/lib/services/incident-severity.service.ts:135` — `recalculateAll` becomes dead; DELETE method, keep `recalculateIncidentSeverity`.
- `tests/unit/gap-analysis.test.ts` — existing suite (mocks `prisma.question.findMany`); rework to new semantics.
- `tests/api/authz-matrix.test.ts:230-243`, `tests/api/severity-and-sync.test.ts` — exercise deleted route; rewrite to call `recalculateIncidentSeverity` directly, drop endpoint-shape test.
- `tests/api/question-registry.test.ts:1306-1319` — severity-bump cache-invalidation proof; keep passing.
- `scripts/dqr-p2-api-evidence.ts` — evidence-script precedent (tsx, direct route handlers, drms_test DB at :5435).
- Inverted keys verified in `src/lib/questions/registry-validation.ts:499-511,622-634,729-741`.

## Tasks & Acceptance

**Execution:**
- [x] `src/lib/questions/gap-engine.ts` — NEW pure engine `analyzeGaps(snapshotStructure, answers, registryRows)` per Boundaries; output rows `{key,label,gapLabel,severity,source,recommendation,unanswered}`; delete `gap-derivation.ts` and rewire its callers.
- [x] `src/lib/services/gap-analysis.service.ts` — wrapper loads snapshot (registry) + all registry rows (regardless of `isActive`) and calls the engine; keep exported names (`analyzeGaps`, `derivePriorityFromGaps`, per-type analyzers, `getGapFieldSeverity`, `clearGapQuestionCache`) compiling.
- [x] `src/lib/services/rapid-assessment.service.ts` — create/update/`triggerGapAnalysis` derive via engine from the stored/fresh snapshot; delete `updateAllHistoricalAssessmentPriorities`.
- [x] `src/lib/services/question-registry.service.ts` + `src/app/api/v1/admin/questions/[id]/severity/route.ts` — `setSeverity` recomputes affected assessments in-tx (reuse `countFrozenSnapshots` matcher, add `questionSnapshot contains key`), returns `{question, affectedCount}`; route surfaces it; propagate affected incidents via existing `recalculateIncidentSeverity` best-effort after commit.
- [x] DELETE `src/app/api/v1/admin/severity/recalculate/route.ts`, `src/app/api/v1/rapid-assessments/update-priorities/route.ts`, `incidentSeverityService.recalculateAll`; compiler-driven caller sweep.
- [x] `prisma/seed.ts` — sample-assessment gapAnalysis derived via the new engine.
- [x] `tests/unit/gap-engine.test.ts` — NEW truth-table suite covering the full I/O matrix.
- [x] `tests/unit/gap-analysis.test.ts`, `tests/api/authz-matrix.test.ts`, `tests/api/severity-and-sync.test.ts` — rework for new semantics and deleted routes.
- [x] `scripts/dqr-p3-recompute-evidence.ts` — scripted proof → `_bmad-output/implementation-artifacts/dqr-p3-recompute-evidence.log`.

**Acceptance Criteria:**
- Given an assessment under an ACTIVE incident whose snapshot contains key K, when K's severity is PATCHed, then that assessment's `priority` and `gapAnalysis` update in the same transaction, its snapshot stays byte-identical, and the response reports `affectedCount ≥ 1`.
- Given an assessment whose snapshot contains K but whose incident is not ACTIVE, when K's severity is PATCHed, then that assessment is untouched.
- Given the deleted endpoints, when POSTed, then 404.
- Given baseline lint/type-check/unit failure sets, when the full suite runs, then zero new failures beyond baseline and the new suites are green.

## Implementation Notes

- 2026-09-15 (impl subagent, verified by orchestrator against the staged diff): engine implemented with `normalizeGapSeverity` guarding the ladder (unknown severity strings floor at MEDIUM — never silently LOW); wrapper exposes new `analyzeGapsFromSnapshot(type, snapshot, answers)` used by create/update/`triggerGapAnalysis`; `setSeverity` identity edits short-circuit (no bump, no audit, no recompute); incident propagation is best-effort post-commit and never fails the PATCH.
- Files touched (17): new `src/lib/questions/gap-engine.ts`, `tests/unit/gap-engine.test.ts`, `scripts/dqr-p3-recompute-evidence.ts`; deleted `src/lib/questions/gap-derivation.ts` + the two routes; modified wrapper, assessment/registry/incident-severity services, severity route, `prisma/seed.ts`, 4 test files, `scripts/dqr-p2-api-evidence.ts` (response-shape only).
- Known leftover (p9 docs pass): `docs/api-contracts.md` still lists `POST/GET /rapid-assessments/update-priorities`.
- Verification: lint exit 0 (36 pre-existing warnings, none new); `tsc --noEmit` clean; unit 214/214; API 157/157; evidence ALL CHECKS PASSED; full `npm run test:baseline:all` exit 0 incl. baseline e2e 9/9 → `_bmad-output/implementation-artifacts/dqr-p3-baseline.log`.
- 2026-09-15 (review round 1 patches, applied by orchestrator — implementer subagent not continuable): A) new fixture-based integration test in tests/api/question-registry.test.ts locking the recompute contract (matcher-mirrored expected count, snapshot/version-stamp byte-stability, RESOLVED + snapshot-without-key controls, incident propagation, identity-edit no-op; fixtures cleaned up so downstream freeze-rule tests stay green); B) `getGapFieldSeverity` routes through `normalizeGapSeverity` + two new unit tests (actual severity via inactive row; UNCLASSIFIED→MEDIUM); C) propagation loop uses a static `incidentSeverityService` import and logs failures; D) severity-and-sync deletion assertions cast to `Record<string, unknown>` and cover both deleted methods; E) evidence script: crash-safe finally cleanup via fixture-id tracking, `affectedCount >= 2` (per-fixture assertions still pin the contract), `__dirname`-resolved route paths. Post-patch verification: tsc clean, lint exit 0 (no new warnings), unit 216/216, API 158/158, evidence ALL CHECKS PASSED (log regenerated). Four findings deferred → deferred-work.md.

## Spec Change Log

## Review Triage Log

| # | Finding (layer) | Verdict | Evidence / route |
|---|---|---|---|
| 1 | Recompute contract has no automated-suite verification (V1, BH1) | high | Pre-verified: suites assert only `typeof affectedCount === 'number'`; contract lives solely in the manual evidence script; deleting `recomputeAssessmentsForKey` keeps `test:baseline:all` green. → patch: fixture-based integration test in tests/api/question-registry.test.ts |
| 2 | `getGapFieldSeverity` raw-casts severity, bypassing normalization (BH2, E2, V2) | medium | Verified: `Question.severity` is full `Priority` (schema.prisma:462, default LOW); UNCLASSIFIED would leak to the dashboard lookup; only stub-satisfiable test exists. → patch: route through `normalizeGapSeverity` + non-MEDIUM/inactive-row test |
| 3 | Silent `catch {}` in post-commit incident propagation (BH3) | low | Verified real; best-effort is spec'd but zero diagnostics on failure. → patch: log incidentId + error |
| 4 | Dynamic import re-executed per loop iteration (BH4) | low | Verified; `incident-severity.service` imports only db/client — no cycle possible. → patch: static import |
| 5 | Concurrent severity PATCHes on different keys: lost-update window (BH5) | low — rejected | Read-Committed window is seconds; admin-only rare concurrency; self-heals on any later write/severity edit; fix needs locking machinery (complexity > direct correction) |
| 6 | Unbounded read/rewrite inside edit transaction (BH6, E3) | low — defer | Real scaling debt (lock duration grows with history); negligible at current (pre-live) scale |
| 7 | `affectedCount` counts rows whose derivation is unchanged (BH7) | low — rejected | Spec/I/O matrix define the count as matcher hits (snapshot contains key ∧ ACTIVE incident); write churn is negligible |
| 8 | Evidence-script cleanup not exception-safe (BH8, E7) | low | Verified: cleanup is last statement of try; mid-run crash orphans fixtures. → patch: move cleanup to finally |
| 9 | Hard-coded `affectedCount === 2` env-dependent (BH9, E5) | low | Verified: foreign matching rows break the strict equality. → patch: relax to `>= 2` (per-fixture assertions already pin the contract) |
| 10 | Registry severity left mutated after evidence run (BH10) | low — rejected | Start-of-run MEDIUM pin is deliberate self-healing; restoring would bump contentVersion again |
| 11 | Strict-boolean semantics silently breaks legacy junk answers (BH11) | false | Binding decision D-1 (no backward compat); GAP answers are canonical booleans enforced by validation at write; non-boolean junk unreachable |
| 12 | `docs/api-contracts.md` still lists deleted endpoints (BH12, E9, V4) | low — defer | Verified at docs/api-contracts.md:271-272; intent (prompt-3 out-of-scope) defers docs to p9 |
| 13 | Type-unsafe `.recalculateAll` access in test (BH13) | low | Verified: compiles only because tsconfig excludes tests; latent type-check failure. → patch: cast like the evidence script |
| 14 | `existsSync` deletion checks prove layout, not routing (BH14, V6) | low — rejected | A missing App Router file IS the router 404; valid proxy; V6 itself concluded "nothing needs action" |
| 15 | Single global cache timestamp outlives per-type TTL (BH15) | low — defer | Carried-over p1/p2 pattern (same single-clock mechanism), not introduced here |
| 16 | `gapMeaning` dead surface + inconsistent import aliases (BH16) | low — rejected | Cosmetic; loose typing is deliberate forward-compat for p4; aliases avoid name collisions per context |
| 17 | Duplicate section orders merge buckets in registry view (E1) | false | registry-validation.ts:1030 enforces contiguous 1..n section ordering per type — duplicate order values unreachable through validated mutations |
| 18 | Assessment created concurrently with PATCH keeps stale priority (E4) | low — rejected | Milliseconds-wide race, admin-edit + assessor-submit coincidence; self-heals on any later write or severity edit of that type |
| 19 | `DATABASE_URL.includes('drms_test')` can match other DB names (E6) | low — rejected | Contrived match; consistent with repo-wide precedent (tests/setup-api.ts, p2 evidence script) |
| 20 | Evidence-script `process.cwd()` path dependence (E8) | low | Verified: documented invocation is repo-root, but `__dirname`-resolve is a direct correction. → patch |
| 21 | Seed derivation rewired with no verification (V3) | low — defer (filed disposition) | Seed is dev/demo-data only; engine + create-path are pinned; a seed-execution harness is disproportionate |
| 22 | Deletion test asymmetric: no `updateAllHistoricalAssessmentPriorities` assertion (V5) | low | Verified. → patch: add sibling assertion |

Grouped survivors → **patch**: A = #1 (integration test); B = #2 (normalization + test); C = #3+#4 (propagation loop hardening); D = #13+#22 (deletion-assertion robustness); E = #8+#9+#20 (evidence-script crash-safety/determinism). **defer**: #6, #12, #15, #21. No intent_gap, no bad_spec → no loopback.

## Design Notes

- Snapshot rows carry no severity (P2 design), so the ladder's middle rung is dormant today; the engine still accepts optional `severity` on snapshot questions so a future snapshot format change needs no engine edit.
- Recompute matcher: `rapidAssessmentType = question.assessmentType`, `incident: { status: 'ACTIVE' }`, snapshot-contains-key via the existing `snapshotHasAnyKey` helper; DRAFT assessments with snapshots are included per the prompt's literal rule (offline DRAFTs lack snapshots and are naturally excluded — p5 territory).
- Stored `gapAnalysis.rows[].source` is the audit surface for the ladder; dashboards (p7) will consume it instead of re-deriving.
- `derivePriorityFromGaps` keeps its POPULATION→LOW contract trivially: engine returns LOW for zero GAP questions.

## Verification

**Commands:**
- `npm run lint` — expected: 0 new warnings/errors vs baseline.
- `npm run type-check` — expected: clean (compiler sweep proves dead-code deletion).
- `npm run test:unit` — expected: green incl. new `tests/unit/gap-engine.test.ts`.
- `npm run db:push:test && npm run test:api` — expected: green (requires drms_test Postgres at :5435).
- `npx tsx scripts/dqr-p3-recompute-evidence.ts > _bmad-output/implementation-artifacts/dqr-p3-recompute-evidence.log` — expected: ALL EVIDENCE CHECKS PASSED.

**Manual checks (if no CLI):**
- Deleted endpoints return 404 through the Next.js router (asserted in evidence script).
