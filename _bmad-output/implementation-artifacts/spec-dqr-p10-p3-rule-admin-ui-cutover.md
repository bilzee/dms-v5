---
title: 'DQR P10-3 — Cross-Field Rule Admin Authoring UI + Legacy Cutover'
type: 'feature'
created: '2026-09-18'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '11aa0776c4142ff8b623a05dc5c4ef9b4c5173a5'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/spec-dqr-p10-deferred-work-consolidation.md'
  - '{project-root}/_bmad-output/implementation-artifacts/dqr-p10-prompts/prompt-3-phase3b-rule-admin-ui-cutover.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The 15 cross-field rules seeded in P10-2 (commits `11837f8`/`11aa077`) are DB data governed by `/admin/rules*`, but admins have no UI to author them, and the live `DynamicAssessmentForm` still validates against the hardcoded island `src/lib/questions/cross-field-rules.ts` — so edits to rule rows never reach the form.

**Approach:** Part A adds a "Cross-field rules" panel + rule editor dialog to the P8 registry editor (`/admin/settings/questions`), reusing its type switcher, reason governance, version badges and audit timeline; Part B runs the golden parity gate, then deletes the legacy module, re-exports `evaluateCrossFieldRules`/`crossFieldSuperRefine`/`hasCrossFieldViolations` from `rule-engine.ts` (same signatures, seed-data-backed), and rewires the form to evaluate rules from the `/questions` payload. Two commits: A `feat(questions): admin cross-field rule editor`, B `refactor(questions): migrate forms to registry rules, delete legacy module`.

## Boundaries & Constraints

**Always:**
- Full gate chain before each commit (plan §8): `npm run lint && npm run type-check && npm run test:unit && npm run db:push:test && npm run test:api && npm run test:baseline:e2e && npm run build` (build optional before Commit A, mandatory before Commit B).
- Golden parity green and captured to `_bmad-output/implementation-artifacts/dqr-p10-3-parity-final.log` BEFORE deleting `cross-field-rules.ts`; on mismatch fix engine/seed, never delete.
- Same signatures for the three re-exported functions; types `CrossFieldViolation`/`CrossFieldKind`/`CrossFieldAssessmentType` re-homed into `rule-engine.ts`; `rule-engine.ts` stays client-safe (no prisma/server imports — seed constant moves to a pure module).
- Rule mutations through the UI always carry `reason`; client dialog validation imports the shared zod AST schemas from `rule-engine.ts` (no duplicate schema).
- Evidence artifacts prefixed `dqr-p10-3-`; ledger entry "Replace the hardcoded client-side cross-field rules module…" (From Spec Decision 2026-09-15, DQR P4) marked RESOLVED with parity log + deletion commit + payload-driven form.
- E2E spec file named to sort AFTER `registry-bottom-up.spec.ts` (its version-stamp pins are order-sensitive).

**Never:**
- No rule-engine semantic changes beyond parity demands; no new rules beyond the seeded 15; no offline/sync changes (prompt 4).
- No schema migrations; no changes to `/admin/rules` POST/DELETE semantics, `ruleKey` immutability, or the never-reject `/sync/batch` ruling.
- Do not touch `registry-type-tab-*` testids (pinned by `registry-bottom-up.spec.ts`) or the quarantined `tests/e2e/*` corpus.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Rules panel, ruled type | POPULATION selected | 11 seeded rules: name, kind badge, message preview, referenceKeys chips, active state, order | N/A |
| Rules panel, HEALTH/SECURITY | no rules | Empty state "no rules — by design" | N/A |
| Create rule via dialog | valid AST + reason | POST 201, list refreshes, structureVersion badge bumps | `rule_key_duplicate` (409), `registry_invalid` (400, inline list), zod grammar inline errors |
| Edit seeded rule | message change + reason | PUT 200, message preview + dry-run update | `rule_key_immutable` (400) |
| Toggle active | deactivate/reactivate + reason | DELETE (204) / PUT `isActive` (200); row state flips | reason required |
| Dry-run preview | latest assessment of type (GET `/rapid-assessments?type=X&limit=1`, `createdAt desc`) | interpolated message + violation yes/no; no assessment → empty-values preview with hint | fetch failure → "preview unavailable" |
| Deactivate question guard | question referenced by active rule(s) | deactivate dialog lists referencing rules (`impact.referencingRules`) | server 409 lists rules |
| Post-cutover form | violating answers on `/rapid-assessments/new` | payload-rules evaluation: destructive alert, submit disabled, messages = DB rule messages | N/A |
| Legacy module gone | any import of `cross-field-rules` | zero references (search-verified); parity log archived pre-deletion | N/A |

</frozen-after-approval>

## Code Map

- `src/components/settings/question-registry/QuestionRegistryEditor.tsx` (~1015 L) — host page component; controlled type Tabs L466-474 (no TabsContent); version badges L408-417; deactivate flow L315-372 + AlertDialog L908-1011 (impact box — insert referencing-rules list); `useAdminQuestionSet` L143.
- `src/components/settings/question-registry/QuestionEditDialog.tsx` (~984 L) — dialog patterns to clone: RHF + inline rules, reason field, error-code branches (`registry_invalid` details list L327-354), cache invalidation L361-362, embedded `QuestionAuditTimeline`.
- `src/hooks/useAdminQuestionSet.ts` — admin payload hook (queryKey `['admin-question-set', type, includeInactive]`); extend to expose `rules` from the same `/questions` response (verify endpoint at implementation).
- `src/app/api/v1/questions/route.ts:32-37` — response `{sections, structureVersion, contentVersion, rules}`; `rules` = full `CrossFieldRule` rows (active only; `includeInactive=1` → all, ADMIN).
- `src/app/api/v1/admin/rules/route.ts`, `[id]/route.ts`, `[id]/audit/route.ts` — POST/PUT/DELETE/audit contracts (p10-2, shipped).
- `src/lib/validation/questions.ts:126-151` — `CreateRuleSchema`/`UpdateRuleSchema`; **no `isActive` in Update today** → add optional boolean (plan §4.4 lists `active` under PUT) + service handling + audit + api test.
- `src/lib/services/question-registry.service.ts` — `getRules` L313, `createRule` L961, `updateRule` L1030, `deactivateRule` L1166, `validateRuleState` L903, `bumpVersions` L391, `writeAudit` L422, deactivation guard L842.
- `src/lib/questions/rule-engine.ts` (233 L) — client-safe; exports `COMPARE_OPS`, `CompareSchema`, `BoolGateSchema`, `WhenSchema`, `RuleAstSchema`, `RegistryRuleRecord` L81, `num` L97, `interpolateMessage` L159, `evaluateRules` L185, `evaluateRefinements` L225. Gains: re-homed types + `payloadSuperRefine(rules)` + seed-backed shims.
- `prisma/seed-rules.ts` — `CROSS_FIELD_RULE_SEED` L67 (15 rows; imports `PrismaClient` L23 → NOT client-safe; move the constant + `CrossFieldRuleSeed` type to `src/lib/questions/rule-seed-data.ts`, re-import here; keep `EXPECTED_RULE_COUNT`, ids, upsert logic in place).
- `src/lib/questions/cross-field-rules.ts` — DELETE target; import sites to repoint: `DynamicAssessmentForm.tsx:35`, `rapid-assessment.service.ts:26` (type-only), `tests/unit/{cross-field-rules,rule-engine,validation-schemas}.test.ts`.
- `src/hooks/useQuestionSet.ts` — `QuestionSetResponse` L92 (no `rules`), `normalizeQuestionSet` L139, hook L177 → pass rules through; `DynamicAssessmentForm.tsx` schema L417-420, live eval L523-526, submit-disable L732-733, violation alerts L1336-1354.
- Tests: `tests/unit/rule-engine.test.ts` (parity harness L379-521, `seedRowsFor` L29), `tests/unit/components/QuestionEditDialog.test.tsx` (mock preamble + `renderDialog` to clone), `tests/e2e-baseline/registry-bottom-up.spec.ts` + `helpers.ts` (`loginViaUi`, `loginToken`), `tests/api/cross-field-rules.test.ts` (30 pins — extend for `isActive` PUT).
- Ledger: `_bmad-output/implementation-artifacts/deferred-work.md` L68-70 (P4 decision entry).

## Tasks & Acceptance

**Execution:**
- [x] `src/lib/validation/questions.ts` + `src/lib/services/question-registry.service.ts` + `tests/api/cross-field-rules.test.ts` -- add optional `isActive` to `UpdateRuleSchema`, handle in `updateRule` (flip + structure bump + audit), pin with api test -- completes plan §4.4 PUT surface so the list toggle is bidirectional.
- [x] `src/hooks/useAdminQuestionSet.ts` -- expose normalized `rules` (active+inactive) from the existing admin payload -- rules panel data source.
- [x] `src/components/settings/question-registry/CrossFieldRulesPanel.tsx` (new) + `QuestionRegistryEditor.tsx` -- inner Questions/Rules view tabs (new testids `registry-view-tab-questions`/`-rules`, keep type tabs intact), rule table (name, kind badge, message preview, referenceKeys chips, active toggle, order controls, edit), empty-state hint for HEALTH/SECURITY, add-rule button -- plan §4.5 list.
- [x] `src/components/settings/question-registry/RuleEditDialog.tsx` (new) -- When row (BOOLEAN questions + is/is-not), violation condition (NUMBER question or "Sum of…" multi-select / comparator / question or literal), message textarea + `{{value:key}}`/`{{sum:…}}` token inserter + dry-run preview against latest assessment answers, derived referenceKeys chips, `ruleKey` (create only), required `reason`, pending `structureVersion` bump badge, rule audit timeline in edit mode, shared-zod validation, error branches per matrix -- plan §4.5 dialog.
- [x] `QuestionRegistryEditor.tsx` deactivate AlertDialog -- render `impact.referencingRules` (ruleKey + name + kind) with "deactivate or edit the rule first" guidance -- deactivation guard UX.
- [x] `tests/unit/components/RuleEditDialog.test.tsx` (new) -- dialog validation (reason required, kebab ruleKey, AST grammar via shared zod, sum ≥1 key), token inserter, dry-run interpolation, server error branches.
- [x] `tests/e2e-baseline/rules-admin-authoring.spec.ts` (new) -- (a) create rule via UI → violates on `/rapid-assessments/new?type=…` → submit blocked; (b) edit seeded POPULATION rule message → form shows new message; screenshot rule editor → `_bmad-output/implementation-artifacts/dqr-p10-3-rule-editor.png`; plus gates → **Commit A**.
- [x] Parity capture -- run `npx jest tests/unit/rule-engine.test.ts tests/unit/cross-field-rules.test.ts` → `dqr-p10-3-parity-final.log` (ordered, before any deletion).
- [x] `src/lib/questions/rule-seed-data.ts` (new) + `prisma/seed-rules.ts` re-import + `src/lib/questions/rule-engine.ts` -- move seed constant; add types + `payloadSuperRefine(rules)` + shims `evaluateCrossFieldRules(type,values)` / `crossFieldSuperRefine(type)` / `hasCrossFieldViolations(type,values)` over seed data.
- [x] Delete `src/lib/questions/cross-field-rules.ts`; repoint `rapid-assessment.service.ts` type import and the three test files; `useQuestionSet.ts` + `DynamicAssessmentForm.tsx` -- payload rules for live eval + superRefine; zero `cross-field-rules` references (search-verified).
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- P4 entry RESOLVED with evidence (parity log, Commit B hash, payload form).
- [x] Full gate chain green → **Commit B** `refactor(questions): migrate forms to registry rules, delete legacy module`.

**Acceptance Criteria:**
- Given the admin editor on POPULATION, when opening the rules view, then 11 seeded rules render editable; HEALTH/SECURITY show the by-design empty state.
- Given a rule created via the dialog referencing live NUMBER questions, when the assessor form violates it, then the destructive alert shows the authored message and submit is disabled.
- Given the golden parity log is green, when `cross-field-rules.ts` is deleted and the form rewired, then all gates pass and violating-form behavior is byte-identical to pre-cutover (same messages, same order).
- Given a question referenced by an active rule, when an admin opens deactivate confirmation, then the referencing rules are listed before the reason step.

## Implementation Notes

## Spec Change Log

## Review Triage Log

Layers run 2026-09-18: blind-hunter + edge-case-hunter + verification-gap (verification-gap reported zero findings). Verdicts verified against the working tree, not reviewer reports.

- BH-1 parity harness post-cutover is near-tautological (shim = engine-over-seed) — low: the concrete semantic pins (exact messages/keys/order, num() coercion) live in tests/unit/cross-field-rules.test.ts, so drift coverage exists; fix would duplicate those pins — reject.
- BH-2 parity log lacks provenance header — low: git commit timestamps + the ledger citation date the artifact; editing an archived run output post-hoc is worse — reject.
- BH-3 fetchAdminRules issues a second GET to the same /questions URL fetchAdminQuestionSet already fetched (double traffic, transient version skew) — medium: verified src/hooks/useAdminQuestionSet.ts:137-175 (two fetchers, identical query strings; fetchAdminQuestionSet drops payload.rules) — patch (P1: parse rules from the single existing payload).
- BH-4 / EC-4 isLoading ignores rulesQuery, so rules arriving after questions flash the "No rules — by design" empty state — low-medium: same root cause as BH-3 (two independent queries); the sequential refetch at L248-251 guarantees the interleaving — patch (P1).
- BH-5 / EC-1 reorder swap is two sequential PUTs with no atomicity; failure after PUT #1 durably leaves duplicate order values, and vanished-neighbor guards are silent no-ops — medium: verified CrossFieldRulesPanel.tsx confirmRuleMove (catch only toasts; no compensation) — patch (P2: best-effort compensating PUT + feedback on no-op).
- EC-2 "Boolean question gate" falls back to ALL questions when the type has none, so on POPULATION (0 BOOLEAN, verified registry-validation.ts POPULATION section: 12 NUMBER + 1 TEXT_LONG) the picker offers NUMBER keys whose whenHolds (`=== true`) can never fire — silently dead rules; server validateRuleState checks only grammar + referenceKeys (verified service L903-940), so nothing rejects it — medium — patch (P3: no fallback + BOOLEAN gate validation).
- BH-7 sum-operand keys are stripped from derived referenceKeys when unknown but stay inside the expression AST, and the server does not validate operand keys (verified validateRuleState) — the payload is internally inconsistent and saves with dangling keys that num() coerces to 0 — medium — patch (P3: dialog validates all condition/gate keys against the type's questions).
- BH-8 / EC-5 create-mode default left operand uses unfiltered questions[0] while OperandEditor offers NUMBER-filtered operandQuestions — low: mismatch possible on types whose first question is not NUMBER — patch (P3 member: default from the filtered list).
- BH-9 CrossFieldRulesPanel not keyed by assessmentType (stale search/filter across type switches) — low: matches the editor's existing cross-type state pattern (questions search persists identically); held rule mutations no-op safely (index lookup miss returns) — reject.
- BH-10 describeOperand/describeWhen duplicated between panel and dialog — low: real drift risk between the two renderings of the same AST — patch (P4: extract to rule-engine.ts).
- BH-11 committed spec shows in-progress/unchecked while ledger says RESOLVED — fix is editing this build's spec (workflow already updated status/tasks) — reject per rules.
- BH-12 spec matrix says "server 409" but service throws registry_invalid 400 (verified) — fix is editing the frozen matrix; the shipped UI text correctly says registry_invalid — reject per rules.
- BH-13 e2e leaves persistent mutations (authored 5000-cap rule ACTIVE; seeded message rewritten) in the shared baseline DB with no cleanup — maybe-false: no current spec collides (gates green; assessment-drift stays under 5000 and does not assert the seeded text), but any future POPULATION spec above 5000 or asserting the seeded message breaks — defer (severity if true: medium; settle by auditing baseline specs' POPULATION assertions when adding new ones).
- BH-14 missing coverage (PUT isActive:false, panel units, guard-alert render) — low: no demonstrated defect; isActive:false shares the service flip path pinned by the isActive:true test; verification-gap rules screen out coverage-of-new-code — reject.
- BH-15 assessor side silently skips drifted rule rows (safeParse skip, no signal) while admin side surfaces rulesError — low: documented intentional degradation contract (useQuestionSet comments + spec Design Notes); telemetry would add new surface — reject.
- BH-16 indentation inside the new questions-view fragment — low: cosmetic, lint/format gate green — reject.
- BH-6 apiGet(...).then without .catch risks unhandled rejection / eternal 'loading' — false: apiGet catches internally and returns {success:false} (src/lib/api.ts:51-56); both call sites handle the failure result — reject on refutation.
- EC-3 seed reconciliation (drift branch) overwrites content and force-writes isActive:true, reverting governed deactivations/edits on any re-seed against a non-truncated DB (verified prisma/seed-rules.ts drift branch) — medium but pre-existing P10-2 seeder mechanism; the cutover's ownership inversion raises the stakes — defer (needs an ownership-aware seeding policy, e.g. skip rows the admin deactivated).

Grouped routes: P1 (BH-3+BH-4/EC-4, medium) patch; P2 (BH-5/EC-1, medium) patch; P3 (EC-2+BH-7+BH-8/EC-5, medium) patch; P4 (BH-10, low) patch; D1 (BH-13) defer; D2 (EC-3) defer. No intent_gap, no bad_spec — no loopback. review_loop_iteration stays 0.

Patches applied 2026-09-18 (post-triage, working tree on top of Commit B):
- P1: `useAdminQuestionSet` now parses rules out of the single `/questions` payload (rules passthrough on `AdminQuestionSetView`, `normalizeRule` isolated in a try/catch memo → `rulesError` never breaks questions; `fetchAdminRules` + the second query + the dead `admin-rule-set` invalidation deleted; `isLoading`/`refetch` cover rules implicitly).
- P2: `CrossFieldRulesPanel.confirmRuleMove` — vanished-neighbor guards now toast + close; the swap's second-PUT failure gets a best-effort compensating PUT; `refetch()` moved to `finally`.
- P3: `RuleEditDialog` — gate picker is BOOLEAN-only (no fallback); `buildAst` rejects condition/gate operand keys not in the type's active questions and bool gates not on BOOLEAN questions; create-mode default left operand is the first NUMBER question.
- P4: `describeOperand`/`describeWhen` extracted to `rule-engine.ts`; panel + dialog consume the shared helpers.
- Tests: 2 new `RuleEditDialog.test.tsx` cases (unknown sum key; BOOLEAN-gate requirement incl. advanced-JSON path) — 18/18 green; lint + type-check clean; full gate chain re-run → ALL_GATES_GREEN (unit 461/461, api 251/251, e2e 20 passed, build), log archived at `_bmad-output/implementation-artifacts/dqr-p10-3-gates-postreview.log`.
- Defers: D1 appended as a new P10-3 ledger entry; D2 recorded as a RE-CONFIRMED update on the existing P10-2 seed-policy entry (same mechanism — no duplicate).

## Design Notes

- Shim backing: after deletion, `evaluateCrossFieldRules(type, values)` = `evaluateRules(seedRuleRecordsFor(type), values)` over the moved pure seed constant — parity is exactly what the golden test proved, and the shims stay sync/pure. `crossFieldSuperRefine(type)` = refinement-only closure (legacy path/message semantics); the FORM must NOT use the shim (it would validate seed data, not edited rules) — it uses a new `payloadSuperRefine(rules)` over the `/questions` payload; the shim delegates to the same helper so both share emission semantics.
- Post-deletion, `rule-engine.test.ts` parity matrix compares `evaluateRules(seedRows…)` with the shim (guards the shim≡seed wiring); `cross-field-rules.test.ts` keeps pinning legacy semantics via the shims (import path change only). The e2e name `rules-admin-authoring.spec.ts` sorts after `registry-bottom-up.spec.ts` ('g' < 'u'), keeping that spec's version-stamp pins safe; global-setup re-seeds per run.
- Dry-run source: `GET /api/v1/rapid-assessments?type=X&limit=1&page=1` (`findAll` orders `createdAt desc`, rows carry `answers`); ADMIN may query without `userId`.

## Verification

**Commands:**
- `npm run lint && npm run type-check` -- expected: clean.
- `npx jest tests/unit/rule-engine.test.ts tests/unit/cross-field-rules.test.ts tests/unit/validation-schemas.test.ts tests/unit/components/RuleEditDialog.test.tsx` -- expected: green (parity log captured first).
- `npm run test:unit && npm run db:push:test && npm run test:api` -- expected: green (incl. extended `cross-field-rules.test.ts`).
- `npm run test:baseline:e2e` -- expected: green incl. `rules-admin-authoring.spec.ts`.
- `npm run build` -- expected: success (client-safe rule-engine confirmed).
- `rg -l "cross-field-rules" src tests prisma` -- expected: only comments/docs, zero module imports.

**Manual checks (if no CLI):**
- `_bmad-output/implementation-artifacts/dqr-p10-3-rule-editor.png` exists (editor dialog visual); `dqr-p10-3-parity-final.log` ordered and green; ledger entry RESOLVED.
