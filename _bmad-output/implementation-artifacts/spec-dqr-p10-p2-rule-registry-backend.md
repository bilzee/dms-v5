---
title: 'DQR P10 Prompt 2 — Cross-Field Rule Registry Backend: Schema, Seed, Engine, Governance API (Phase 3, part 1)'
type: 'feature'
created: '2026-09-18'
status: 'done'
route: 'dispatch'
baseline_commit: '5d6f4964d13a74bcd2284fbf7c7423e642959272'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/spec-dqr-p10-deferred-work-consolidation.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The 15 cross-field rules (12 refinement predicates + 3 live aggregates) are hardcoded in `src/lib/questions/cross-field-rules.ts` — a client island outside the registry (P4 ledger decision) — and the server never evaluates them (documented "Q2=B" parity loss: rule-violating assessments are accepted by `POST/PUT /rapid-assessments` and `/submit`).

**Approach:** Add a `CrossFieldRule` registry model (plan §4.1 verbatim) seeded with the 15 legacy rules in both partitions (§4.3 parity map), a pure rule engine with a shared zod AST schema (`src/lib/questions/rule-engine.ts`, §4.2), governed rule CRUD + invariants in `QuestionRegistryService` with `structureVersion` bumps and a question-deactivation guard, admin rule API endpoints, `rules` in the `/questions` payload, server-side REFINEMENT enforcement on assessment create/update/submit (400 `details[]` per violation), offline `/sync/batch` replay exempt (violations stored as informational `gapAnalysis.crossFieldViolations` flags, never blocking), and the §4.25 docs pass incl. the severity PATCH response shape. The legacy module stays alive, still powering the live form, until prompt 3's parity gate.

## Boundaries & Constraints

**Always:**
- Offline `/sync/batch` never rejects a completed assessment; every rule-related enforcement lands as per-entry conflict/flag, never a batch 4xx/5xx (binding ruling, plan §8).
- Exact parity with `evaluateCrossFieldRules` for all 15 rules: same violation arrays (`key`/`message`/`kind`), same evaluation order (POPULATION: 8 refinements then 3 aggregates), same `num()` coercion (number-and-not-NaN else 0), same boundary semantics (equality passes `>` rules; `availableFoodDurationDays: 7` passes), same aggregate `totalPopulation > 0` when-gate.
- Rule mutations bump the type's `structureVersion` (never `contentVersion`); audit rows reuse `QuestionAuditLog` with `entityType: 'RULE'`; `reason` required on every rule mutation; `ruleKey` immutable (400 `rule_key_immutable`).
- Rules are NOT per-question freeze-gated; but a question cannot be deactivated while an active rule references its key (400 `registry_invalid` listing the rules); `/admin/questions/{id}/impact` lists referencing active rules.
- Baseline parity is the bar, not zero: existing api/e2e suites stay green (new 400s only fire on inputs the legacy client already blocks).
- Full gate chain green before commit: `npm run lint && npm run type-check && npm run test:unit && npm run db:push:test && npm run test:api && npm run test:baseline:e2e && npm run build`.

**Never:**
- No admin authoring UI, no legacy-module deletion/cutover (prompt 3); no offline/signal fixes (prompt 4); no CI/catalog work (prompt 5).
- No snapshot format change; `structureVersion`/`contentVersion` stamps on existing rows untouched (only the type counters bump on rule mutations).
- No AGGREGATE server-side rejection — aggregates stay client-live-only; enforcement evaluates REFINEMENT rules only.
- No change to the legacy module's behavior; `cross-field-rules.ts` remains the live form's rule source through this prompt.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Seed parity | Fresh seed (either partition) | 15 `CrossFieldRule` rows: POPULATION 8 REFINEMENT + 3 AGGREGATE, FOOD 2, WASH 1, SHELTER 1; deterministic ids `{TYPE}:{ruleKey}`; count unchanged by `--with-sample-data` | N/A |
| Engine operator matrix | Each op `> >= < <= == !=`, sums, literals | Compare semantics over `num()`-coerced values; order deterministic (sort `order`, tie-break `ruleKey`) | N/A |
| Coercion parity | `undefined`/`null`/`NaN`/`'5'` values | Coerce to 0 (legacy `num()`); no string parsing | Never throws |
| Message tokens | `{{value:key}}`, `{{sum:k1,k2}}` in AGGREGATE messages | Interpolated with `num()`-coerced values; verbatim legacy strings reproduced | Unknown token renders literally |
| Aggregate when-gate | POPULATION values, `totalPopulation <= 0` | All 3 AGGREGATE rules skipped (legacy `total <= 0` early return) | N/A |
| Rule create governance | Non-ADMIN, or missing `reason` | 403; 400 `reason_required` | ApiError convention |
| Rule create validation | `referenceKeys` ∄ active questions of the type, or AST fails zod | 400 `registry_invalid` with error list | N/A |
| Rule update | Attempt to change `ruleKey` | 400 `rule_key_immutable`; name/message/kind/when/expression/order/isActive editable; bumps `structureVersion` | N/A |
| Rule delete | DELETE with `reason` | Soft-deactivate (`isActive: false`), audit row, `structureVersion` bump; last active REFINEMENT of a type MAY be deactivated | N/A |
| Server enforcement | Online create/PUT/submit whose answers violate an active REFINEMENT rule | 400, `details` = violation array `{key, message, kind}` | `handleApiError` passthrough |
| Offline replay exemption | `/sync/batch` replay of a violating assessment | Row stored (never-reject); stored `gapAnalysis` gains `crossFieldViolations` (REFINEMENT violations) when non-empty; no batch 4xx/5xx | Per-entry conflict machinery untouched |
| Question deactivation guard | Deactivate question whose key is in an active rule's `referenceKeys` | 400 `registry_invalid` listing the referencing rules; impact endpoint lists them | N/A |
| `/questions` payload | `GET /questions?assessmentType=…` | Response gains `rules` (active, ordered by `order`); `includeInactive=1` (ADMIN) returns all rules | 403 for non-ADMIN `includeInactive` (existing) |

</frozen-after-approval>

## Code Map

- `prisma/schema.prisma` — add `CrossFieldRule` (plan §4.1 verbatim: `@@unique([assessmentType, ruleKey])`, `@@index([assessmentType, isActive])`, `@@map("cross_field_rules")`); `AssessmentType` enum :599; `QuestionAuditLog` :483 (`entityType` plain String — `'RULE'` is a TS-union value); version counters live in `SystemSetting` section `QUESTION_REGISTRY` (`src/lib/questions/registry-versions.ts:14-27`).
- `prisma/seed-questions.ts` — pattern for baseline seeding (validate → per-type tx → deterministic ids `{TYPE}:{key}` → create-or-drift-update + audit; `initializeVersionCounters` create-only); shared by `prisma/seed.ts:617` and `prisma/seed-essential.ts`. New `prisma/seed-rules.ts` mirrors it; NO version bumps in seed (re-seed is reconciliation, not governed mutation).
- `src/lib/questions/cross-field-rules.ts` — legacy parity source: `num()` :40-43, 8 POPULATION refinements :54-95 (order = array order), `VULNERABLE_KEYS` :97-104, 3 aggregates with `total <= 0` early return :111-147, FOOD/WASH/SHELTER :149-176, `evaluateCrossFieldRules` :182-204, `CrossFieldViolation` :25-36. NOT deleted this prompt.
- `src/lib/questions/rule-engine.ts` (new) — shared zod AST schema (`Operand`: question/sum/literal; `Compare` ops; `BoolGate`; `RuleAst`), `evaluateRules(rules, values): CrossFieldViolation[]`, token interpolation; violation `key` = `referenceKeys[0]`; DB kinds `REFINEMENT`/`AGGREGATE` map to legacy lowercase `kind`.
- `src/lib/services/question-registry.service.ts` — static-class + `Tx = Prisma.TransactionClient`; `writeAudit` :347 (`AuditEntityType` :76 += `'RULE'`); `bumpVersions` :316; `invalidateRegistryCaches` :177 (add rule-cache clear); `deactivateQuestion` :751 (guard slots ~:761); error style `ApiError('registry_invalid', 400, {errors})` :408; `getQuestionSet` :225 + 30s cache :167.
- `src/lib/validation/questions.ts` — `ReasonSchema` :26; add `CreateRuleSchema`/`UpdateRuleSchema` (routes strip `reason` like `[id]/route.ts:26-27`).
- `src/app/api/v1/questions/route.ts` — `successResponse({ sections, structureVersion, contentVersion })` :28-32; add `rules`.
- `src/app/api/v1/admin/` — mirror `questions/` route set: new `rules/route.ts` (POST), `rules/[id]/route.ts` (PUT/DELETE), `rules/[id]/audit/route.ts` (GET, `entityType: 'RULE'`, cf. `[id]/audit/route.ts:24-29`); `[id]/impact/route.ts:49-111` add `referencingRules`; `[id]/severity/route.ts:28` currently drops `affectedIncidentIds` (service returns it at :837) — return it so the documented shape is true.
- `src/lib/services/rapid-assessment.service.ts` — enforcement hooks: online `create` (post-`validateAnswersAgainstSnapshot` :71-88, call site :175) and `update` (:683); `submit` path; offline `createOfflineAssessment` :246-357 (persist :301-328, gapAnalysis :326) and `updateOfflineAssessment` :405-453 — informational flag only. ApiError style: `new ApiError('Cross-field validation failed', 400, violations)`.
- `tests/factories/index.ts:180-185` — `ensureQuestionRegistry` also seeds rules (fresh test DBs get the 15 rows).
- `tests/api/seed-partition.test.ts:79-81,94-95` — add `crossFieldRule.count() === 15` both partitions.
- `tests/unit/cross-field-rules.test.ts` — legacy suite (stays green); new `tests/unit/rule-engine.test.ts` = operator/gate/sum/coercion/token/order matrix + golden parity harness (fixtures per type: violating, boundary, clean through BOTH legacy `evaluateCrossFieldRules` and engine-over-`CROSS_FIELD_RULE_SEED`, assert deep-equal arrays).
- `docs/api-contracts.md` §4.25 :513-553 — rule endpoints + shapes, `/questions` `rules` extension, enforcement semantics + sync exemption, severity PATCH `{ data: { question, affectedCount, affectedIncidentIds } }`.
- `_bmad-output/implementation-artifacts/deferred-work.md` — P3 docs entry → RESOLVED with evidence.

## Tasks & Acceptance

**Execution:**
- [x] `prisma/schema.prisma` — add `CrossFieldRule` per plan §4.1 verbatim; regenerate client — Scope 1.
- [x] `prisma/seed-rules.ts` — `CROSS_FIELD_RULE_SEED` (15 rows, §4.3 parity map verbatim: expressions, exact messages incl. `{{value:…}}`/`{{sum:…}}` tokens, orders 1..n per type with POPULATION refinements 1-8 then aggregates 9-11) + `seedCrossFieldRules(db)` (create-or-drift-update + RULE audit, deterministic ids, no version bumps); wire into `prisma/seed.ts` (~:617) and `prisma/seed-essential.ts` — Scope 2.
- [x] `src/lib/questions/rule-engine.ts` — zod AST schemas (exported for admin UI in prompt 3), `evaluateRules` pure evaluator, token interpolation, `CrossFieldViolation`-compatible types — Scope 3.
- [x] `src/lib/services/question-registry.service.ts` — `AuditEntityType` += `'RULE'`; `createRule`/`updateRule`/`deactivateRule` (validation: referenceKeys ⊆ active question keys of the type, non-empty; `when`/`expression` against shared zod; `ruleKey` kebab-case immutable; audit; `structureVersion` bump; `invalidateRegistryCaches`); `getRules(type, {includeInactive})` + per-type 30s rule cache + clear hook; `deactivateQuestion` guard — Scope 4.
- [x] API: `admin/rules` POST/PUT/DELETE + `[id]/audit` GET; `questions/route.ts` adds `rules`; `impact/route.ts` adds `referencingRules`; `severity/route.ts` returns `affectedIncidentIds`; `src/lib/validation/questions.ts` schemas — Scope 5.
- [x] `rapid-assessment.service.ts` — REFINEMENT enforcement (online create/PUT/submit → 400 `details[]` violations) + offline replay informational `gapAnalysis.crossFieldViolations` — Scope 6.
- [x] `tests/unit/rule-engine.test.ts` — operator matrix, gates (BoolGate true/false, Compare-when incl. `total > 0`), sums, coercion, tokens, order + golden parity harness; `tests/api/cross-field-rules.test.ts` — CRUD lifecycle (403s, reason, immutability, audit, version bump, validation 400s), enforcement 400s, replay exemption, deactivation guard + impact listing, `/questions` rules; `tests/factories/index.ts` + `tests/api/seed-partition.test.ts` — Scope 7.
- [x] `docs/api-contracts.md` §4.25 + `deferred-work.md` P3 docs entry RESOLVED — Scope 8.
- [x] Evidence `dqr-p10-2-parity-matrix.log` + `dqr-p10-2-rules-api.log`; full gate chain; commit `feat(questions): cross-field rule registry backend — schema, engine, governance API` — Scope 9.

**Acceptance Criteria:**
- Given fixture answer sets per type (violating, boundary, clean), when run through legacy `evaluateCrossFieldRules` and engine-over-seeded-rules, then the violation arrays are deep-equal (order included).
- Given a fresh seed (either partition), when counted, then `crossFieldRule.count() === 15` and existing counts (55 questions, 27 sections, 12 settings) are unchanged.
- Given an online create/update/submit payload violating an active REFINEMENT rule, when sent, then the response is 400 with `details[]` containing `{key, message, kind}` per violation.
- Given an offline `/sync/batch` replay of the same violating payload, when processed, then the row persists with `gapAnalysis.crossFieldViolations` recorded and the batch returns 200/207 (never 4xx/5xx).
- Given an active rule referencing question K, when K is deactivated, then 400 `registry_invalid` lists the rule; when the rule is deactivated first, then K deactivates normally.
- Given any rule mutation (create/update/deactivate), when committed, then a `QuestionAuditLog` row (`entityType: 'RULE'`, `reason` set) exists and the type's `structureVersion` incremented (contentVersion unchanged).
- Given the full gate chain, when run end-to-end, then all seven commands exit green; `cross-field-rules.ts` still present and powering the live form.

## Implementation Notes

- Delivered per scope: `CrossFieldRule` model (`@@unique([assessmentType, ruleKey])`, `@@index([assessmentType, isActive])`, `@@map("cross_field_rules")`); `prisma/seed-rules.ts` (`CROSS_FIELD_RULE_SEED` 15 rows + `seedCrossFieldRules`, deterministic ids `{TYPE}:{ruleKey}`, create-or-drift-update + RULE audit, no version bumps) wired into both seed partitions; `src/lib/questions/rule-engine.ts` (zod `Operand`/`Compare`/`BoolGate`/`RuleAst` + `evaluateRules` + `{{value:}}`/`{{sum:}}` interpolation); `question-registry.service.ts` (`createRule`/`updateRule`/`deactivateRule` + `getRules` with per-type 30s cache cleared in `invalidateRegistryCaches` + `deactivateQuestion` referencing-rule guard); `admin/rules` POST + `[id]` PUT/DELETE + `[id]/audit` GET; `/questions` gains `rules`; `[id]/impact` gains `referencingRules`; `[id]/severity` now returns `affectedIncidentIds`; online REFINEMENT enforcement (create/update/submit → 400 `details[]` violation arrays) + offline informational `gapAnalysis.crossFieldViolations` (written only when non-empty).
- Golden parity harness (`tests/unit/rule-engine.test.ts` 18 tests): per-type violating/boundary/clean fixtures run through BOTH legacy `evaluateCrossFieldRules` and engine-over-`CROSS_FIELD_RULE_SEED`, asserting deep-equal violation arrays incl. order; legacy `tests/unit/cross-field-rules.test.ts` untouched and green. API suite `tests/api/cross-field-rules.test.ts` = 24 tests (CRUD lifecycle, 403/401 gates, `reason_required`, `rule_key_immutable`, audit rows, structureVersion-only bumps, registry_invalid validation, enforcement 400s, offline replay exemption, deactivation guard + impact listing, `/questions` rules); `tests/api/seed-partition.test.ts` pins `crossFieldRule.count() === 15` in both partitions.
- Governance/API semantics as built: POST/PUT return the rule via `successResponse`; DELETE soft-deactivates and returns 204; `reason_required` is enforced service-side in `writeAudit` (zod leaves `reason` optional so seeds may omit it); malformed `when`/`expression` ASTs fail the shared zod schemas at the service boundary (route-level zod 'Validation failed' for body shape).
- Baseline-suite expectation update (this story's only pre-existing-test edit): `tests/api/question-registry-admin-ui.test.ts` "count 0" impact test — the strict 5-key `toEqual` predates the `referencingRules` dimension and the seeded FOOD rules reference `isFoodSufficient`, so the payload is non-empty. Rewritten to pin the exact 6-key payload key set + per-field zero counts + `Array.isArray(referencingRules)`; rule content stays pinned by `tests/api/cross-field-rules.test.ts`. Note: nested `expect.any()` asymmetric matchers mis-match under `jest.api.config.js` (jest 29 + next/jest node env) — top-level asymmetric matchers keep working — hence the literal key-set assertion.
- Gate history: run 1 failed at test:api (the stale strict `toEqual` above); run 2 failed at test:api again (the `expect.any(Array)` rewrite tripped the matcher quirk); run 3 ALL_GATES_GREEN — lint (0 new warnings vs baseline; pre-existing only), type-check clean, unit 21 suites/442 tests, db:push:test green, api 21 suites/244 tests, baseline e2e 18 passed, build compiled successfully (175/175 static pages).
- Evidence logs: `_bmad-output/implementation-artifacts/dqr-p10-2-parity-matrix.log` (unit parity run, 96/96 across the two rule suites) and `dqr-p10-2-rules-api.log` (spec Verification command api run, 26/26). `src/lib/questions/cross-field-rules.ts` still present and powering the live form (deleted only in prompt 3's parity gate).
- Ledger: `deferred-work.md` P3 docs entry RESOLVED with evidence; the P4 cross-field entry stays OPEN for prompt 3 (UI + legacy cutover) by design.

## Spec Change Log

## Review Triage Log

(Not run — this spec was executed via the dispatch route without the triage pass; verification is the full gate chain + evidence logs above.)

## Design Notes

- **`when` AST extension (recorded decision):** plan §4.2's grammar (`when?: BoolGate`) cannot express the legacy aggregates' `totalPopulation > 0` gate (a numeric compare), yet §4.2's heading binds "covers all 15 legacy rules exactly" and §4.3 binds parity. `when` therefore accepts `BoolGate | Compare`; semantics: the rule is evaluated only when `when` holds (BoolGate: `values[questionKey] === is`, strict; Compare: numeric compare true). Additive JSON — no schema impact, prompt 3's UI needs one extra when-shape.
- **Violation attachment key** = `referenceKeys[0]` (primary referenced question) — matches the legacy "flag the first field" behavior for all 15 rules; remaining `referenceKeys` are the invariant targets for the deactivation guard.
- **Kind mapping:** DB stores `'REFINEMENT'`/`'AGGREGATE'` (plan §4.1); engine emits legacy lowercase `kind` in violations so `CrossFieldViolation` and the prompt-3 re-exports stay interface-identical.
- **Enforcement endpoints:** plan §4.4 reads "POST/PUT /rapid-assessments and /submit" — prompt 2 names POST + /submit; PUT is included (plan is authority where the prompt is silent; the edit path must not bypass enforcement). `/submit` evaluates the stored answers (submit carries no payload).
- **Offline flags:** REFINEMENT-only (mirrors exactly what would have been rejected online); stored under additive `gapAnalysis.crossFieldViolations` key, written only when non-empty so existing rows/shape stay untouched.
- **Rules cache:** per-type 30s `Map` mirroring `registryViewCache`, cleared inside `invalidateRegistryCaches` after every rule/question mutation commit.

## Verification

**Commands:**
- `npx jest tests/unit/rule-engine.test.ts tests/unit/cross-field-rules.test.ts` — expected: green (matrix + golden parity).
- `npm run db:push:test && npx jest --config jest.api.config.js tests/api/cross-field-rules.test.ts tests/api/seed-partition.test.ts` — expected: green (CRUD/enforcement/exemption/guard; 15-both-partitions).
- `npm run lint && npm run type-check && npm run test:unit && npm run db:push:test && npm run test:api && npm run test:baseline:e2e && npm run build` — expected: all green.

**Manual checks (if no CLI):**
- Evidence logs `_bmad-output/implementation-artifacts/dqr-p10-2-parity-matrix.log` and `dqr-p10-2-rules-api.log` captured; `src/lib/questions/cross-field-rules.ts` still present; ledger P3 docs entry RESOLVED.
