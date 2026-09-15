---
title: 'DQR P2 — Registry service, admin API, tiered governance'
type: 'feature'
created: '2026-09-15'
status: 'done'
route: 'dispatch'
baseline_commit: 'b8ccfd27c6c332f6c70c51adb11f258dcc1ca597'
review_loop_iteration: 0
context:
  - '{project-root}/docs/plans/dynamic-question-registry-plan.md'
  - '{project-root}/_bmad-output/implementation-artifacts/dynamic-question-registry-prompts/prompt-2-registry-service-api-governance.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Prompt 1 shipped registry tables + seeded catalog, but there is no service layer, no read/edit API, no governance: version counters only move at seed time, `QuestionAuditLog` is only written by the seed, and admin/coordinator editing (D-1) has no backend.

**Approach:** Add `question-registry.service.ts` (cached reads, atomic in-transaction version bumps, audit writer, tier/freeze gates, DB-state registry validation), a `buildAssessmentSchema` Zod builder, `/api/v1/questions` (read) + `/api/v1/admin/questions|sections` mutation routes with in-transaction Tier A/B gates per the plan §2.2/§2.6, and jest integration tests proving the gates. Refactor prompt 1's inline snapshot builder in `rapid-assessment.service.ts` to consume `getSnapshot()` as the single snapshot source.

## Boundaries & Constraints

**Always:**
- Tier gates execute inside the write transaction; freeze = key ∈ `questionSnapshot` of a non-DRAFT `RapidAssessment` of that type under an `ACTIVE` incident → `409 { error: 'question_frozen', details: { affectedCount } }`.
- `structureVersion`/`contentVersion` bump atomically inside the mutation transaction (never after); snapshots stay structure-only (no severity).
- Every mutation writes a `QuestionAuditLog` row; `reason` required for Tier B/structural actions (400 if missing).
- `questionKey` is immutable (rename = deactivate + create); questions are deactivated, never deleted.
- Registry invariants enforced on every question mutation by reusing `validateRegistry()` on a projection of active DB rows (empty sections excluded) → `400 { error: 'registry_invalid' }`.
- Baseline parity vs prompt-1 logs is the bar (lint 0 new; identical pre-existing failure sets).

**Never:**
- No admin editor UI, coordinator page rewiring, form/dynamic renderer, offline work, gap engine/recompute (p3+ scope).
- No "Recalculate All"; no severity recompute of assessments on severity edit (P4).
- No new auth mechanism — reuse `withAuth` + `context.roles.includes(...)`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Read question set | GET `/api/v1/questions?assessmentType=HEALTH` (any authenticated) | 200 `{ sections (active, ordered), structureVersion, contentVersion }` | unknown type → 404 |
| Read incl. inactive | `?includeInactive=1` as ADMIN | 200 all rows | non-ADMIN → 403 |
| Create question / section | ADMIN POST valid payload | 201; structure bump; audit CREATE | invalid registry state → 400 |
| Tier A edit (label/helperText/gap phrases/recommendation/option copy+append/severity via PUT) | ADMIN PUT | 200; content bump only; structureVersion unchanged | — |
| Tier B edit (questionType, category, inverted, required, sectionId move, numberMin/Max, option value remove/change, deactivate, reorder) | key frozen | 409 `question_frozen` + affectedCount | same edit after incident RESOLVED → 200 |
| Key change attempt | PUT with different `questionKey` | 400 `question_key_immutable` | — |
| Severity PATCH | COORDINATOR or ADMIN, GAP question, value ∈ {CRITICAL,HIGH,MEDIUM} | 200; content bump only; audit UPDATE_SEVERITY | CONTEXT question or LOW/UNCLASSIFIED → 400 |
| COORDINATOR non-severity mutation | any admin questions/sections route | 403 | anonymous → 401 |
| Reorder | ADMIN `/reorder` sections or questions-in-section | 200; contiguous unique orders; structure bump; audit REORDER | any moved key frozen → 409 |
| Deactivate last active GAP (non-POPULATION) | ADMIN DELETE | 400 `registry_invalid` | — |
| Export | ADMIN GET `/export` | 200 JSON (schemaVersion, versions, all sections+questions) | non-ADMIN → 403 |
| Section delete | ADMIN DELETE non-empty section | 400 `section_not_empty` | empty → 204, structure bump |

</frozen-after-approval>

## Code Map

- `prisma/schema.prisma:479` — `QuestionAuditLog` lacks `reason`/entity columns; `questionId` FK blocks section audit → reshape per plan §2.1 (drop FK, add `entityType`/`entityId`/`reason`; keep `changes`/`previous` as after/before). Remove `Question.auditLogs` back-relation.
- `prisma/seed-questions.ts:200-280` — existing audit writer (`questionId`/`changes`/`previous`); update to new columns.
- `src/lib/questions/registry-validation.ts:1037` — `validateRegistry()` + `AssessmentTypeCatalog` shape; reuse for DB-state validation via projection (sorted, order=index+1, active rows only, empty sections dropped).
- `src/lib/questions/registry-versions.ts:39` — `getRegistryVersions`; version setting keys (`QUESTION_REGISTRY`/`structure|contentVersion/{TYPE}`).
- `src/lib/questions/legacy-convert.ts:210` — `buildQuestionSnapshot(questions, versions)`; snapshot shape `sections[].questions[].key`.
- `src/lib/services/rapid-assessment.service.ts:46-69,142-147,428-436` — private `getRegistryQuestions` + two inline snapshot builds → replace with registry-service `getSnapshot()`.
- `src/lib/services/gap-analysis.service.ts:57` — module-Map 30s TTL + `clearGapQuestionCache()` pattern to copy; admin seed route calls it after re-seed (`src/app/api/v1/admin/seed/route.ts:139`) — also clear registry cache there.
- `src/lib/auth/middleware.ts:21` — `withAuth` → `AuthContext { user, userId, roles, ... }`; `src/lib/api/response.ts` — `successResponse/createdResponse/errorResponse/handleApiError` (ZodError→400, P2025→404).
- `src/app/api/v1/incidents/route.ts` — canonical route style (zod parse + service + response helpers).
- `tests/api/authz-matrix.test.ts`, `tests/helpers/api.ts` (`makeRequest`/`tokenFor`/`withParams`), `tests/factories/index.ts` (`ensureQuestionRegistry`, `createRapidAssessment` — extend with `withSnapshot` for freeze fixtures), `tests/helpers/test-db.ts` (`truncateTestDb`).
- Baseline logs: `_bmad-output/implementation-artifacts/dqr-p1-{lint,tsc,unit}.log` + `dqr-p1-review-*.log`.

## Tasks & Acceptance

**Execution:**
- [x] `prisma/schema.prisma` + new migration `question_audit_governance` -- reshape QuestionAuditLog (entityType/entityId/reason, drop questionId FK); update `Question` model back-relation; `npx prisma generate` -- enables reason-required + section audit.
- [x] `prisma/seed-questions.ts` -- write audit rows to new columns -- keeps seed green on reshaped model.
- [x] `src/lib/services/question-registry.service.ts` -- NEW: cached (30s TTL Map, invalidation on mutation + exported `clearQuestionRegistryCache()`) `getQuestionSet(type, {includeInactive})`, `getSnapshot(type)` (wraps buildQuestionSnapshot — single source); `bumpVersions(tx, {structure?, content?})` via atomic `UPDATE ... SET value = to_jsonb((value #>> '{}')::int + 1)`; `writeAudit(tx, {entityType, entityId, action, before, after, actorId, reason})` (reason required for structural actions); `assertKeyEditable(tx, type, key)` freeze predicate → throws `ApiError(409,'question_frozen',{affectedCount})` counting non-DRAFT assessments of type under ACTIVE incident whose snapshot contains the key (fetch + JS filter, pre-launch volumes); `validateRegistryState(tx, type)` projection → `validateRegistry()`; mutation methods (createQuestion, updateQuestion w/ tier diff, deactivateQuestion, createSection, updateSection, deleteEmptySection, reorder, setSeverity, exportRegistry) each: transaction → gate → write → validate state → bump → audit → invalidate cache.
- [x] `src/lib/validation/dynamic-assessment.ts` -- NEW: `buildAssessmentSchema(questionSet)` → z.object per widget matrix: BOOLEAN→boolean; SINGLE_CHOICE→enum(option values); MULTI_SELECT→array(enum) ⊆ options; NUMBER→number with min (numberMin) / max (numberMax) bounds; TEXT_LONG→string with length bounds (1..2000); required questions non-optional, others optional. Plus shared `QuestionOptionSchema`.
- [x] `src/lib/validation/questions.ts` -- NEW: zod schemas for create/update question, section create/update, severity PATCH (`z.enum(['CRITICAL','HIGH','MEDIUM'])`), reorder payloads (section ids list OR sectionId+question ids list), strict `questionKey` rejection on update.
- [x] `src/app/api/v1/questions/route.ts` -- NEW GET (any authenticated; `?includeInactive=1` ADMIN-only; 404 unknown type).
- [x] `src/app/api/v1/admin/questions/route.ts` + `[id]/route.ts` (PUT update, DELETE deactivate) + `[id]/severity/route.ts` (PATCH; ADMIN **or** COORDINATOR — D-1) + `reorder/route.ts` + `export/route.ts` -- NEW, all `withAuth` + `context.roles.includes('ADMIN')` (except severity), zod-validated, `handleApiError`, `ApiError(409, 'question_frozen', { affectedCount })` / `ApiError(400, 'registry_invalid', { errors })` mapped in handlers.
- [x] `src/app/api/v1/admin/sections/route.ts` + `[id]/route.ts` -- NEW section CRUD (POST create; PUT title/description/category; DELETE empty-only).
- [x] `src/lib/services/rapid-assessment.service.ts` -- replace `getRegistryQuestions` + inline snapshot builds in `create`/`update` with `QuestionRegistryService.getSnapshot()`; delete the private helper.
- [x] `src/app/api/v1/admin/seed/route.ts` -- clear registry cache after re-seed (one line, mirrors `clearGapQuestionCache()`).
- [x] `tests/factories/index.ts` -- `createRapidAssessment({ withSnapshot })` stamps questionSnapshot+versions from the live registry (via service or direct build) — freeze fixtures.
- [x] `tests/unit/validation-dynamic-assessment.test.ts` -- NEW: builder matrix incl. bounds, enum rejection, required enforcement.
- [x] `tests/api/question-registry.test.ts` (+ `question-registry-governance.test.ts` if cleaner) -- NEW per I/O matrix: CRUD happy paths; freeze 409 with affectedCount (ACTIVE incident + snapshot fixture; RESOLVED incident → success); Tier A edit leaves structureVersion unchanged (atomicity proof) while contentVersion +1; audit rows written for every mutation, structural reason-missing → 400; COORDINATOR severity PATCH 200 / label 403; unknown assessmentType 404; last-GAP deactivate 400; reorder + export happy paths.
- [x] `scripts/dqr-p2-api-evidence.ts` -- NEW: scripted direct-handler sequence (create section+question → label edit content-only → key-rename attempt → severity PATCH as COORDINATOR → label as COORDINATOR 403) against test DB; run and tee to `_bmad-output/implementation-artifacts/dqr-p2-api-evidence.log`.

**Acceptance Criteria:**
- Given an ACTIVE incident with a snapshot-bearing HEALTH assessment, when any Tier B mutation targets its key, then 409 `question_frozen` with `affectedCount ≥ 1` and no row/version/audit change.
- Given a Tier A label edit, when re-read via `/api/v1/questions`, then `structureVersion` unchanged and `contentVersion` incremented by exactly 1.
- Given a COORDINATOR token, when PATCHing severity, then 200; when PATCHing any other field or hitting any admin route, then 403.
- Given `npm run lint`, `npm run type-check`, `npm run test:unit`, `npm run validate:schema`, then failure sets identical to prompt-1 baselines (0 new); `npm run db:push:test && npm run test:api` green including new suites.

## Implementation Notes

- Implemented in the `feat(questions): registry service, admin API, and tiered governance` commit (29 files incl. artifacts) on top of baseline `b8ccfd2`; all 13 execution tasks and 4 acceptance criteria verified against the diff and gate logs.
- Bugs found and fixed during implementation (all covered by regression tests):
  1. `bumpVersions` raw SQL originally used snake_case `updated_at`; `system_settings` keeps Prisma-mapped camelCase `"updatedAt"` in its DDL — every mutation 500'd (P2010/42703) until quoted.
  2. `reorderSections` scope check missed the completeness clause (a subset of section IDs returned 200 instead of 400 `reorder_scope_mismatch`).
  3. Moved-key detection iterated DB current order, so a "reverse back" reorder was not detected as a move and skipped the freeze gate; fixed in both reorder paths by computing moved = requested position ≠ current order.
  4. Evidence script `{ POST as x }` destructuring alias is invalid TS syntax (fixed to `{ POST: x }`).
- Deviation: unit test file named `tests/unit/validation-dynamic-assessment.test.ts` (matches the source module name) instead of the spec's `dynamic-assessment.test.ts`.
- `validateRegistryState` projects active DB rows into the catalog shape (empty sections dropped, order = array index + 1) before reusing `validateRegistry()` — no rule duplication, per plan.
- Freeze checking fetches candidate snapshots (non-DRAFT, ACTIVE incident, type) then matches keys in JS (`snapshotHasAnyKey`) — acceptable at pre-launch volumes, recorded as a P3+ optimization candidate.
- Migration backfills `entity_id` from `question_id` before dropping the column (all pre-P2 audit rows were question-scoped seed writes).
- Reorder parks inactive rows after the contiguous active 1..n block to keep orders unique; reorder audits use entityType `SECTION` with `entityId` = section id for both paths (section reorders write one row per listed section; identity reorders write nothing).
- The 30s TTL cache is module-level; invalidation (`clearQuestionRegistryCache`) only affects the current server instance — fine pre-launch, noted for multi-instance deployments.
- Review round 1 patches (see Review Triage Log): options arrays are always serialized on update (no `undefined` no-op); `number_bounds_invalid` (create + merged update), `order_conflict` (explicit-order collisions; use `/reorder`), `question_key_duplicate`/`section_key_duplicate` (409 pre-checks), `question_not_found`/`section_not_found` machine codes; every mutation clears the gap-analysis metadata cache alongside the question-set cache; content/structure bumps are now precisely tracked per dimension in both update methods; `ReorderSchema` branches are `.strict()`; order reads carry `{ id }` tiebreakers.

## Spec Change Log

## Review Triage Log

Review round 1 (`review_loop_iteration: 0`), layers: blind-hunter, edge-case-hunter, verification-gap (all launched simultaneously against `dqr-p2-review-diff.patch`). Every finding verified against the diff/source before verdict.

**Patched (applied by orchestrator — the step-03 subagent is not continuable in this environment):**

| Finding | Verdict | Evidence / Resolution |
|---|---|---|
| BH: `PUT options: []` is a silent no-op — `data.options = undefined` skips the write while audit + version bumps claim a change (`question-registry.service.ts:568`) | medium → **patch** | Prisma treats `undefined` as "leave column unchanged", so clearing an option list was impossible and row/audit disagreed. Patched to always serialize the provided array; `options: []` on a choice question now flows into `validateRegistryState` → 400 `registry_invalid`. Regression test added. |
| BH: `numberMin > numberMax` accepted on create and update (no cross-field check; zod checks ints only) | medium → **patch** | Added `assertNumberBounds` in the service (create checks payload; update checks the merged effective values so payload-only `numberMin` against stored `numberMax` is caught) → 400 `number_bounds_invalid`. Tests for both paths. |
| BH/ECH: explicit `order` on create/update produces duplicate order values (no DB unique constraint → nondeterministic reads) | medium → **patch** | Added `assertOrderAvailable` pre-check (scope = section for questions, type for sections, self-excluded on update) → 409 `order_conflict` with a hint to use `/reorder`; added `{ id }` tiebreakers to every `orderBy: order` read so equal orders can never flip the projection. Tests for create + update paths. |
| VG (pre-verified): registry mutations never clear the gap-analysis question cache (`gap-analysis.service.ts` module cache, 30s TTL) → `analyzeGaps` serves stale severity/inverted/recommendation after a severity PATCH | medium → **patch** | Verified as filed. Every registry mutation now calls `clearGapQuestionCache()` alongside `clearQuestionRegistryCache()` (import is acyclic: gap-analysis.service reads Prisma directly). Regression test: prime cache → PATCH severity CRITICAL → `analyzeGaps` returns CRITICAL immediately. |
| BH: bump-policy asymmetry — `updateQuestion` always bumps `contentVersion` (`content: true`, line 664) even for pure Tier B edits, while `updateSection` uses `content: !structural`; plan wording keys each counter to its own change class | medium → **patch** | Both update methods now track `content`/`structural` touched flags precisely; pure Tier B edit bumps structure only, pure Tier A content only, mixed edits bump both. Existing Tier A/Tier B tests still pass unchanged. |
| BH: section-reorder `REORDER` audit row uses `entityId = assessmentType` (`question-registry.service.ts:1084`) — violates the audit contract that `entityId` reference the audited entity | low → **patch** | Section reorder now writes one `REORDER` row per listed section with `entityId = section.id` and per-section `{from, to}` orders. Spec Implementation Notes line updated to match. |
| ECH: `ReorderSchema` union first-match + zod key stripping silently reinterprets a mixed payload (`sectionIds` + `sectionId`/`questionIds`) as a section reorder | low → **patch** | Both union members are now `.strict()`; a mixed payload matches neither branch → 400. Test added. |
| ECH: no-op reorder (identity sequence) still bumps `structureVersion` and writes an audit row | low → **patch** | Both reorder paths track whether any order actually changed and return early (`{ reordered: n }`) without validate/bump/audit when nothing moved. Test added. |
| ECH: error taxonomy — string error codes (`'Question not found'`, `'Section not found'`) and duplicate-key creates surface as raw P2002 500s | low → **patch** | Machine codes `question_not_found`/`section_not_found` (404) everywhere; create paths pre-check duplicates → 409 `question_key_duplicate`/`section_key_duplicate`. Tests added. |
| VG: test-coverage holes — option append vs removal tier split, `includeInactive` row content, section category/order PUT tiers, GET ordering guarantees, read-after-write cache invalidation | low → **patch** | New `review round 1` describe in `tests/api/question-registry.test.ts` covers each: append → content-only bump, value removal → structure bump, `includeInactive=1` returns inactive rows / default GET none, empty-section category PUT → structure-only bump, section/question orders strictly ascending, GET after severity PATCH shows the new severity (cache invalidation). |

**Deferred:**

| Finding | Verdict | Evidence |
|---|---|---|
| BH: `LOGISTICS` reaches `PrismaClientValidationError` at `action-signal.service.ts:289` ( AssessmentType enum has no LOGISTICS) | medium → **defer** | Pre-existing (present in prompt-1 baseline logs, outside P2 diff); LOGISTICS is a valid `ResponseType` but not an `AssessmentType`. Appended to `deferred-work.md` for the action-signal owner. |

**Rejected as false:**

| Finding | Verdict | Evidence |
|---|---|---|
| BH: NUMBER domain contradiction — admin bounds are `z.number().int()` but `buildAssessmentFieldSchema` accepts floats | false | Intentional split: bounds are admin metadata; humanitarian counts may legitimately be fractional. No invariant is violated — bounds still apply to floats via `.min/.max`. |
| BH: `buildAssessmentFieldSchema` default branch degrades unknown types to TEXT_LONG rules | false | `questionType` is constrained by the Prisma enum on every write path plus `QuestionTypeSchema` on the wire; the default branch is unreachable defense, not a live path. |
| BH: PUT `severity: 'LOW'` on a GAP question passes route zod and would corrupt GAP severity | false | `validateRegistry` (`registry-validation.ts:1140`) requires GAP severity ∈ {CRITICAL, HIGH, MEDIUM} and runs in-transaction via `validateRegistryState` on every question mutation → 400 `registry_invalid`, full rollback. |
| BH: cached `QuestionSet` rows are mutable references — a caller could corrupt the cache | false | No consumer mutates the rows (routes serialize; `getSnapshot` spreads into new row objects before `buildQuestionSnapshot`); hypothetical only. |
| ECH: `updateSection` on a section holding only inactive questions bypasses the freeze gate (empty keys array) | false | Gate is plan-keyed on question **keys** in snapshots; deactivating those questions already passed the gate individually at deactivation time, and an empty section's metadata edit reinterprets no stored answer (snapshots are immutable copies). |
| ECH: section delete audit notes assume a section-deactivate path exists | false | P2 has no section soft-deactivate (only empty-section hard delete); the note's scenario is unreachable in this phase. |

**Rejected as low (not worth direct correction now):**

| Finding | Verdict | Evidence |
|---|---|---|
| ECH: TOCTOU window on the freeze gate under READ COMMITTED (concurrent assessment create + Tier B edit) | low | Milliseconds-wide window, pre-launch single-instance, and the failure mode is a frozen-key edit succeeding just as a snapshot lands; real fix (advisory locks / serializable) far exceeds direct correction. |
| ECH: `setSeverity` lacks an `isActive` guard (can edit a deactivated GAP question) | low | Harmless — deactivated questions never enter snapshots or gap analysis; admin-only surface. |
| BH: freeze exemption via RESOLVED→ACTIVE incident reopen on an all-deactivated section | low | `updateStatus` does allow reopen, but reaching that state requires every deactivation to have passed the gate; no stored answers are reinterpreted; plan keys the gate on question keys. |
| BH/VG: `countFrozenSnapshots` fetches every candidate snapshot then filters in JS | low | Documented in spec as a pre-launch-volume design with a P3+ optimization candidate (SQL containment query). |
| VG: per-process caches mean multi-instance deployments serve stale reads up to TTL | low | Single-instance pre-launch; already recorded in Implementation Notes for the deployment note. |

## Design Notes

- Tier classification of `numberMin`/`numberMax` and option-value changes: Tier B (they reinterpret stored answers) — prompt's Tier B list is not exhaustive; recorded here as the deciding rule: "does the edit reinterpret stored answers?" (plan §2.2 axis).
- Question create is ungated (new key can't be frozen) but bumps `structureVersion` (structural mutation per plan §2.1); section title/description edits are Tier A (content bump).
- Freeze predicate counts assessments where `verificationStatus != 'DRAFT'` and `incident.status = 'ACTIVE'` and snapshot `sections[].questions[].key` matches; resolved/contained incidents never freeze.
- Audit actions: `CREATE`/`UPDATE`/`UPDATE_SEVERITY`/`DEACTIVATE`/`REORDER`/`SECTION_CREATE`/`SECTION_UPDATE`/`SECTION_DELETE`; `before`/`after` = changed-fields diff `{field:{from,to}}` (same shape as seed's `diffQuestion`).
- Version bump SQL is a single atomic UPDATE per counter (no read-modify-write), executed with `tx.$executeRaw`.

## Verification

**Commands:**
- `npm run lint` -- 0 new issues vs `dqr-p1-lint.log` baseline
- `npm run type-check` -- failure set identical to `dqr-p1-tsc.log`
- `npm run test:unit && npm run validate:schema` -- green / identical failure sets vs prompt-1
- `npm run db:push:test && npm run test:api` -- all green incl. new `question-registry*` suites
- `npx tsx scripts/dqr-p2-api-evidence.ts > _bmad-output/implementation-artifacts/dqr-p2-api-evidence.log` -- scripted sequence shows create → content-only edit → key-rename rejection → coordinator severity OK / label 403
