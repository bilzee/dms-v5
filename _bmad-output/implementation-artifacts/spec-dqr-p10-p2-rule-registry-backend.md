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
- Review round 1 patches (applied by the orchestrator per the triage routing above): `updateRule` `when: null` now writes `Prisma.DbNull` so the gate is genuinely cleared (was a silent no-op while audit + version bump claimed otherwise); rule drift compares (`when`/`expression`/`referenceKeys`) use `canonicalJson` — key-order-only differences no longer cause phantom UPDATE + structureVersion bump; `evaluateRules` tie-break is code-unit compare (`<`/`>`) instead of ICU-dependent `localeCompare`; `POST /admin/seed` now seeds the 15 rules (`seedCrossFieldRules` + `clearCrossFieldRuleCache` + log/summary lines); docs §4.25 PUT row drops the unreachable 409 and documents `when: null` clearing. New pins in `tests/api/cross-field-rules.test.ts` (24 → 30 tests): when-null clear (stored NULL + bump + audit `when.to === null`), reordered-keys no-op PUT, PUT merged re-validation 400 `registry_invalid`, cross-type same-ruleKey 200, `GET /admin/rules/{id}/audit` (ADMIN newest-first timeline with actor, COORDINATOR 403, unknown id → `[]`), cache read-after-mutation assertions on create/delete, and the offline UPDATE replay `crossFieldViolations` flag. Findings 10–12 filed in the ledger under "From Review (2026-09-18, DQR P10-2)". Post-patch gate rerun (run 4): ALL_GATES_GREEN — lint 0 new warnings, type-check clean, unit 21 suites/442 tests, db:push:test green, api 21 suites/250 tests (was 244; the +6 new pins), baseline e2e 18 passed, build compiled successfully.

## Spec Change Log

## Review Triage Log

Review of commit 11837f8 (diff vs baseline 5d6f496) by blind-hunter, edge-case-hunter, and verification-gap layers; verdicts verified against the code unless noted "pre-verified" (verification-gap findings trusted as filed).

| # | Finding (location) | Verdict | Evidence / reasoning | Route |
|---|---|---|---|---|
| 1 | `updateRule` `when: null` is a silent no-op — `data.when = (input.when ?? undefined)` leaves the Prisma column unchanged while the audit + structureVersion claim the gate was cleared (question-registry.service.ts, updateRule; BH1/ECH1/VG-O1) | high | Verified: `null ?? undefined` → `undefined` → Prisma omits the field; `touch('when', gate, null)` still fires → DB keeps enforcing the old gate while governance records say cleared. Seed path (`seed-rules.ts`) uses `Prisma.DbNull` correctly for the same case. | patch |
| 2 | `POST /api/v1/admin/seed` seeds questions but not rules — rule baseline absent on that partition, enforcement silently inert, rule cache not cleared (admin/seed/route.ts:139-141; ECH2/VG-V3, pre-verified) | medium | Verified: route calls `seedQuestions(prisma)` + clears only gap/question caches; `seedCrossFieldRules` wired at 2 of 3 registry entry points. | patch |
| 3 | Offline UPDATE replay `crossFieldViolations` flag untested — only `action: 'create'` is covered (rapid-assessment.service.ts updateOfflineAssessment; VG-V1, pre-verified) | low | Pre-verified: reverting the `storedGapAnalysis` merge in the update path passes every existing test. | patch |
| 4 | Rule-cache invalidation hook invisible to tests — no mutation→fresh-read sequence under assertion (question-registry.service.ts; VG-V2, pre-verified) | low | Pre-verified: deleting `clearCrossFieldRuleCache()` from `invalidateRegistryCaches` fails no test. | patch |
| 5 | `GET /admin/rules/{id}/audit` shipped with zero route-level tests (VG-V5, pre-verified) | low | Pre-verified: no test imports the route; audit assertions query the data layer directly. | patch |
| 6 | PUT merged re-validation + cross-type ruleKey uniqueness unpinned by tests (BH9) | low | Verified: test file has no PUT `registry_invalid` case and no same-ruleKey-two-types case; the code paths exist. | patch |
| 7 | `updateRule` drift compare uses raw `JSON.stringify` — key-order-only differences cause phantom UPDATE + version bump + audit row (question-registry.service.ts; ECH5/BH3) | low | Verified: order-sensitive compares on `when`/`expression`; `canonicalJson` (seed-questions.ts:64) exists for exactly this and is already imported by seed-rules. | patch |
| 8 | `localeCompare` tie-break is ICU-dependent — "deterministic order" contract varies across runtimes (rule-engine.ts evaluateRules sort; BH10) | low | Verified: tie-break uses `ruleKey.localeCompare`; seeded orders are distinct but admin-authored rules may tie. Direct fix to code-unit compare. | patch |
| 9 | Docs §4.25 PUT row documents `409 rule_key_duplicate` — unreachable on PUT (ruleKey immutable 400 fires first; docs/api-contracts.md:544; BH5) | low | Verified: `ruleKey`/`assessmentType` immutable ⇒ no duplicate condition can arise on PUT. | patch |
| 10 | Seed drift-update resurrects admin-deactivated rules with no version bump (seed-rules.ts isActive comparator; ECH4/BH2) | low | Verified real, but seed-questions.ts:113 carries the identical comparator — the behavior IS the binding plan §4.3 parity ("registry baseline like the 55 questions"); policy predates this story. | defer |
| 11 | `GET /admin/questions/export` omits rules — export-based registry migration loses admin-authored rules (BH11) | medium | Verified: export route untouched by this story (pre-existing endpoint); dedicated DB backup unaffected. Registry-portability gap belongs to the program level. | defer |
| 12 | `seed-essential.ts` rule wiring has no executable verification (VG-V4, pre-verified) | low | Pre-verified, filed disposition defer: identical function separately pinned via seed.ts; a third child-process seed run outweighs residual risk. | defer |
| 13 | `ApiError('Cross-field validation failed', …)` is a sentence, not a snake code (BH4) | low→rejected | Follows the rapid-assessment service's own pre-existing convention (`'Answers failed registry validation'`, 422); the string is documented and stable in §4.25. No everyday-use harm. | reject |
| 14 | `createRule` find-then-create race can surface raw P2002 as 500 (BH6) | low→rejected | Mirrors `createQuestion`'s unguarded duplicate-check convention; single-admin authoring surface makes the window negligible in everyday use. | reject |
| 15 | Submit enforcement strands legacy null-answers rows / offline violating DRAFTs when a gateless rule is true at 0 (ECH3/BH7) | low→rejected | Plan §4.4 mandates submit-time enforcement with no exemption; remediation exists (PUT clean answers → submit, or deactivate the rule); all 15 seeded rules are safe at coerced 0 (gated or `>` vs 0). | reject |
| 16 | Offline-exemption vs online-submit interaction undocumented/untested (BH8) | low→rejected | Both sides are documented per plan; the interaction follows mechanically and no doc claim is false; finding 15 covers the strand concern. | reject |
| 17 | Enforcement 400s now log `console.error` stack traces via pre-existing route catch blocks (BH12) | low→rejected | Pre-existing logging pattern; monitoring noise only, no user harm; fix would modify pre-existing handlers beyond a direct correction. | reject |
| 18 | No-op PUT / already-inactive DELETE succeed without `reason` (skip writeAudit) (BH13) | false | No state change ⇒ no governed mutation: `writeAudit`'s reason contract binds audited mutations only; nothing mutated, nothing to audit. | reject |
| 19 | Multi-instance 30s rule-cache staleness undocumented (BH14) | low→rejected | Mirrors the established `questionSetCache`/`registryViewCache` architecture (single-instance deployment); TTL documented in code. | reject |

Grouping: findings 1–9 → five patch entries (1: when-null fix; 2: seed route wiring; 3–6: test gaps [shared root: new surfaces shipped unpinned]; 7–8: non-canonical comparison determinism in new code; 9: docs line). Findings 10–12 → defer (three entries). No intent_gap, no bad_spec → no loopback; patches applied by the orchestrator (the implementation subagent is stateless and cannot be re-engaged).

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
