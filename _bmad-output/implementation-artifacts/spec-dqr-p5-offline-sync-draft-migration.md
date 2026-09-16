---
title: 'DQR P5 — Never-Reject Offline Sync and Draft Auto-Migration'
type: 'feature'
created: '2026-09-16'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: b8cb07f049ec0fe408687da21ce90136f0f7fe57
context:
  - '{project-root}/docs/plans/dynamic-question-registry-plan.md'
  - '{project-root}/_bmad-output/implementation-artifacts/dynamic-question-registry-prompts/prompt-5-offline-sync-drafts.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `SyncProcessingService.processAssessment` (src/lib/services/sync-processing.service.ts:60-134) bypasses the registry data layer entirely — offline-created/updated assessments drop `answers`, never record `structureVersion`, never freeze a snapshot or derive gaps, and trust client `priority` (ruling 7's data-loss bug). Drafts have no migration/restore: legacy typed drafts and stale-version drafts would load wrong or lose answers.

**Approach:** Sync ingestion accepts every completed assessment: lenient answers ingest (unknown keys verbatim, no required enforcement, type normalization), freeze the CURRENT snapshot, derive via the p3 engine (intersection + new `source:'unknown'` rows), record the client `structureVersion`, return per-item warnings. Drafts: pure migration module + restore-on-mount with one-time receipt, staleness banner, and a collapsed unmapped block.

## Boundaries & Constraints

**Always:**
- Never-reject: registry drift (added/removed/unknown keys, missing answers) NEVER fails a sync create/update. Required questions are not re-enforced (the offline form validated at capture); client `priority` is ignored — always derived.
- Row stamps: `structureVersion` = client's `data.structureVersion` (fallback: current), `contentVersion` = current; freeze CURRENT `questionSnapshot`; derive `gapAnalysis` + `priority` via `analyzeGapsFromSnapshot` + `derivePriorityFromGaps`. Historical snapshots cannot be reconstructed — intersection semantics absorb drift.
- Engine extension (pure, idempotent): `analyzeGaps` emits one extra row per answer key (value ≠ null/undefined) absent from the snapshot structure: `{ key, label: key, gapLabel: null, severity: registryRow ?? MEDIUM, source: 'unknown', recommendation: null, unanswered: false }`. Unknown rows NEVER enter `gapFields`/`severity`/`fieldSeverityMap`/`recommendations`/`unanswered`.
- Warnings per assessment sync result: `{ added, removed, unknown }` — added = active registry keys absent from answers; removed = answered keys whose registry row is inactive; unknown = answered keys with no registry row. Response stays `success`; client surfaces (console.warn + persists onto the Dexie assessment record) and NEVER unwinds.
- Replay idempotency: create whose row id already exists → `success` "already synced" (no conflict row), mirroring response handling.
- Synced completed assessments mirror online status semantics: AUTO_VERIFIED (+`verifiedAt`) when entity auto-approves, else SUBMITTED (never DRAFT); incident-severity recompute + action-signal hook mirror `RapidAssessmentService.create`. Update keeps existing LWW version-conflict machinery untouched.
- Draft migration (`src/lib/questions/draft-migration.ts`, pure): map by question key against the current set; carried keys → `answers`; unmapped keys kept in `data.unmappedAnswers` (never dropped); meta fields preserved; `structureVersion` stamped (absent/legacy → treated as 1); `questionKeys` recorded (legacy fallback: `questionKeysForType`).
- Form restores the most recent draft for its type once on mount (answers + meta + entity/incident); one-time dismissable receipt per draft id (localStorage flag, ZoomAdjustmentHint pattern): "Your draft was updated to the new question set — N answers carried over" (+ ", M unmapped" when >0).
- Staleness banner renders ABOVE Z1 (never inside the header's alarm budget) when draft `structureVersion` < current: "The questions have changed since this draft was started" + plain added/removed key lists (draft `questionKeys` vs current). Never blocks submission. Collapsed "unmapped answers" block while unmapped entries exist.
- Submit payload + new draft saves carry `structureVersion`; `draftSnapshot()` also records `questionKeys`. Online routes strip both (zod) — zero online behavior change.
- Type normalization on ingest: MULTI_SELECT string values JSON-parsed to arrays (p4 deferred BH-6); other shapes kept verbatim when not safely coercible.

**Never:** no changes to queue transport/retry/backoff or LWW conflict resolution; no Prisma schema/migrations or new registry columns; no changes to `processResponse`/`processEntity`; online `/rapid-assessments` strict strip/422 semantics unchanged; no notification severity (p6), dashboard (p7), admin editor (p8), e2e corpus/docs (p9).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Stale offline create | answers with 1 unknown key, 1 now-inactive key, registry gained 1 question; client `structureVersion` 1, current 2 | Row created; `answers` verbatim (all 3 keys); `gapAnalysis` has `source:'unknown'` row for the unknown key; severity from intersection only; row `structureVersion`=1; warnings `{added:[new],removed:[inactive],unknown:[gone]}`; status `success` | Never 422 on drift |
| Offline create replay | same `offlineId` POSTed twice | Second → `success` "already synced", no duplicate row, no conflict row | N/A |
| Offline update with answers | update carrying full answers map | Lenient re-ingest, re-freeze current snapshot, re-derive; `structureVersion` = client's | Version conflict → existing LWW path unchanged |
| JSON-string multi-select | `commonHealthIssues: "[\"Malaria\"]"` | Normalized to `["Malaria"]` on ingest | Unparseable → kept verbatim |
| Legacy typed draft load | draft `data` = flat legacy fields | Migrated: known keys → `answers`; receipt "N answers carried over" once; unmapped collapsed + kept in storage | Unknown type → no restore |
| Older-registry draft | draft `structureVersion` 1 < current 2 | Staleness banner + added/removed lists; submission stays enabled | N/A |
| Fresh draft | draft version == current | Restore silently; no banner, no receipt | N/A |
| Empty/garbage sync answers | `answers` missing or `{}` | Row created with `{}` answers; engine derives LOW (unanswered); no fabricated gaps | N/A |

</frozen-after-approval>

## Code Map

- `src/lib/services/sync-processing.service.ts` — REPLACE `processAssessment` create/update branches with registry-aware ingestion (new `RapidAssessmentService.createFromOfflineSync`/`updateFromOfflineSync` delegates); keep delete + conflict machinery.
- `src/lib/services/rapid-assessment.service.ts` — add offline-sync create/update entry points reusing snapshot freeze/derivation; never call `validateAnswersAgainstSnapshot` there.
- `src/lib/questions/offline-answers.ts` — NEW pure module: `ingestOfflineAnswers(snapshot, rawAnswers)` → `{ answers, unknown }` (normalization + verbatim passthrough); `buildSyncWarnings(registryRows, answers)`.
- `src/lib/questions/gap-engine.ts` — add `'unknown'` to `GapRowSource` + unknown-row emission (intersection intact). `src/lib/services/gap-analysis.service.ts` — widen `GapAnalysisRow.source` union.
- `src/app/api/v1/sync/batch/route.ts` — `SyncResult` gains optional `warnings`; pass-through only.
- `src/lib/sync/engine.ts` — client `SyncResult` (L13) gains `warnings`; `handleSuccessfulSync` (L301) surfaces + persists.
- `src/lib/questions/draft-migration.ts` — NEW pure module: `migrateDraftData(questions, data)` → `{ data, carried, unmapped }`.
- `src/hooks/useRapidAssessmentDrafts.ts` — unchanged shape; drafts remain localStorage `rapid-assessment-drafts`.
- `src/components/forms/assessment/DynamicAssessmentForm.tsx` — restore-on-mount, receipt, banner (above Z1, L544), unmapped block, `draftSnapshot()` + `AssessmentFormSubmitPayload` gain `structureVersion`/`questionKeys`.
- `src/app/(auth)/assessor/rapid-assessments/new/page.tsx` — payload passthrough (no structural edit expected).
- Tests: `tests/unit/gap-engine.test.ts` (extend), NEW `tests/unit/draft-migration.test.ts` + `tests/unit/offline-answers.test.ts`, `tests/unit/components/DynamicAssessmentForm.test.tsx` (banner/receipt/restore), NEW `tests/api/offline-sync.test.ts` (route-level, `tests/helpers/api.ts` + factories + `ensureQuestionRegistry`).
- Evidence precedent: `scripts/dqr-p4-form-evidence.ts` pattern (tsx, route handlers, drms_test).

## Tasks & Acceptance

**Execution:**
- [x] `src/lib/questions/gap-engine.ts` + `src/lib/services/gap-analysis.service.ts` — unknown-key rows with `source:'unknown'`; intersection surfaces byte-identical.
- [x] `src/lib/questions/offline-answers.ts` — NEW ingest + warnings module.
- [x] `src/lib/services/rapid-assessment.service.ts` + `src/lib/services/sync-processing.service.ts` + `src/app/api/v1/sync/batch/route.ts` — never-reject create/update with row stamps, derived priority, status mirroring, replay idempotency, warnings.
- [x] `src/lib/sync/engine.ts` — surface + persist warnings on success.
- [x] `src/lib/questions/draft-migration.ts` — NEW migration module.
- [x] `src/components/forms/assessment/DynamicAssessmentForm.tsx` (+ new page payload) — restore-on-mount, receipt, staleness banner, unmapped block, version-carrying saves.
- [x] Tests: engine unknown-row unit pins; `draft-migration` + `offline-answers` unit suites; form banner/receipt/restore component tests; `tests/api/offline-sync.test.ts` (stale create, replay, update, warnings, verbatim answers).
- [x] Evidence: `scripts/dqr-p5-sync-evidence.ts` → `_bmad-output/implementation-artifacts/dqr-p5-sync-evidence.log` (stale-set submission → accepted, intersection gaps, warnings, nothing discarded).
- [ ] Commit: `feat(questions): never-reject offline sync and draft auto-migration`.

**Acceptance Criteria:**
- Given a queued submission built against structureVersion N while the registry is at N+1 (question added, one deactivated, one key foreign), when the batch syncs, then the assessment is accepted with answers verbatim, `structureVersion`=N recorded, gaps derived on the intersection, an `unknown`-source row present, and warnings returned — nothing discarded.
- Given a legacy typed draft and an older-registry draft, when the form loads, then each restores with N answers carried over, a one-time receipt, unmapped answers visible-but-collapsed and retained in storage.
- Given a stale draft, when the current structureVersion is higher, then the staleness banner lists added/removed keys and submission remains enabled.
- Given the baseline suites, when `npm run test:baseline:all` runs, then all green with zero new lint/type failures plus the new suites.

## Implementation Notes

**Implementation shape (deviations from Code Map names, semantics per frozen block):**
- Service entry points are `createOfflineAssessment`/`updateOfflineAssessment` (spec Code Map sketched `createFromOfflineSync`/`updateFromOfflineSync`); they never call `validateAnswersAgainstSnapshot` — ingestion goes through `ingestOfflineAnswers`, and a `relaxedValidateOfflineAnswers` pass logs diagnostics without throwing (added keys optional; value findings never reject).
- `ingestOfflineAnswers(type, rawAnswers, snapshot, registryRows)` also returns `warnings { added, removed, unknown }` directly (Code Map sketched `buildSyncWarnings(registryRows, answers)`); `toOfflineSyncWarnings` shapes them into response records. Warnings are response-scoped only — no persisted column (spec "Never" upheld: zero Prisma schema changes).
- Draft module exports `restoreOfflineDraft(type, engineStructure, draft)` + `applyDraftMigration(draft, …)` (Code Map sketched `migrateDraftData(questions, data)`); unmapped answers live at `data.unmappedAnswers: { key, value }[]` and are never deleted from storage.
- `analyzeGapsFromSnapshot(type, snapshot, answers)` — the P4 3-arg signature is unchanged; unknown rows are SELF-DERIVED by the engine from answered keys absent in the snapshot structure (no extra engine parameter), preserving recompute idempotency (`triggerGapAnalysis` re-derives byte-identical rows from stored answers + frozen snapshot).
- Batch route contract unchanged apart from per-result `warnings` (original summary/results shape, 207-only-when-all-failed); create replay resolves the row by `offlineId || entityUuid` → success "Assessment already synced".

**I/O & Edge-Case Matrix → test coverage (audit):**
- Stale offline create → `tests/api/offline-sync.test.ts` "drifted offline create…" (verbatim removed/unknown answers, client `structureVersion: 1`, added-count arithmetic, unknown rows never scored, MULTI_SELECT `'["Borehole"]'` → array).
- Offline create replay → "create replay is idempotent…" (no duplicate row, warnings undefined).
- Offline update with answers → "answers-carrying updates delegate…" (full replace, client version re-stamped, warnings recomputed); LWW conflict machinery untouched. Update delegation is exercised at `SyncProcessingService.processBatch` level because the route's entity-assignment gate keys on entity uuids while the update branch resolves rows by `change.entityUuid` (row ids).
- JSON-string multi-select → api drifted create + `tests/unit/offline-answers.test.ts` "MULTI_SELECT JSON-string replays normalize to arrays; garbage stays verbatim" (`'not json'` kept verbatim).
- Legacy typed draft load → form "legacy flat drafts…" (2 carried, 1 unmapped, receipt) + `tests/unit/draft-migration.test.ts` (META_KEYS excluded, unmapped kept). Unknown type → no restore is enforced by the unchanged `useRapidAssessmentDrafts(assessmentType)` type filter (hook spec'd unchanged).
- Older-registry draft → form restore/stale-banner/dismissal tests (banner copy, Added/Removed lists, submit stays enabled, dismissal persisted per draft id).
- Fresh draft (version == current) → form "fresh draft… restores silently" (flash + hydration, no banner/receipt/unmapped block).
- Empty/garbage sync answers → api "empty answers never reject…" (`{}` stored, LOW derivation, no fabricated gaps, warnings all `added`) + unit degenerate-input tests in both new suites.

**Gate results (2026-09-16, post-review re-run):** `npm run lint` 30 warnings — strict subset of the 37-warning baseline (missing ones live in P4-deleted legacy forms), 0 new; `npm run type-check` clean; `npm run test:unit` 312/312 (14 suites, incl. 34/34 DynamicAssessmentForm); `npm run test:api` 175/175 (13 suites, incl. 11/11 offline-sync); `npm run test:baseline:e2e` 9/9; evidence run ALL CHECKS PASSED (drifted create + replay + service update + online zero-change; `_bmad-output/implementation-artifacts/dqr-p5-sync-evidence.log`).

## Spec Change Log

## Review Triage Log

Step-04 (loop 1, 2026-09-16). Three layers (blind-hunter "BH", edge-case "E", verification-gap "V"/"O") over the diff vs baseline `b8cb07f` (124 kB at review; rewritten to 136 kB post-patch). Every finding was verified at its cited location before ruling. No intent_gap, no bad_spec → no loopback; patches applied in-build and re-verified (all gates re-run green, table below).

| # | Finding (layer) | Verdict | Disposition |
|---|---|---|---|
| E12 / E14 / E13 / O-2 | Re-migrating an already-migrated draft DESTROYED its stored `unmappedAnswers` — the second `restoreOfflineDraft` pass rebuilt the unmapped list from `data.answers` only, so a reload-before-submit (everyday flow) silently dropped every previously kept answer — violates "never deleted" (binding) | high | **patch** — `restoreOfflineDraft` seeds prior unmapped entries from `data.unmappedAnswers` and the snapshot reconciliation only APPENDS newly-absent keys; unit "re-migrating an already-migrated draft keeps the stored unmapped answers" pins preserve + append semantics |
| BH3 / E4 | Create replay resolved ANY existing row id to an idempotent "already synced" success — the row id is client-controlled, so a syncing user could be told their change synced when it actually matched a foreign row (their own submission silently dropped) | medium | **patch** — ownership guard in the create branch (`existing.assessorId !== userId` → failed "Not authorized to sync this assessment"); API test "replay guard refuses foreign rows" pins failed result + original row untouched |
| BH1 / E11 | `questionKeys` was excluded from the update input only by a type-level cast — at runtime it rode into the Prisma `update` payload (unknown-argument error on any answers-carrying update that declares a client view) | medium | **patch** — runtime destructure in `updateOfflineAssessment`; API update test now sends `questionKeys` on the update payload and stays green |
| O-1 | Drafts were never consumed after submit — every later form mount re-restored already-submitted answers into a blank form | medium | **patch** — form deletes the type's drafts after a successful `onSubmit`; unit "submitting consumes the type's drafts" pins `deleteDraft('draft-legacy')` |
| BH7 | `normalizeMultiSelect` filtered non-string entries IN PLACE — a `'[1, 2]'` replay normalized to `[]`, silently discarding captured data (worse than keeping the string) | medium | **patch** — only a clean string-array normalizes; unparseable / non-array / non-string-entry values stay verbatim; unit pins `'[1, 2]'`, `'not json'`, `'"just a string"'` |
| E6 | Create branch spread `data` into the service without guarding the `answers` shape (a string/array answers value would reach ingestion and the engine) | low | **patch** — plain-object guard (`typeof === 'object' && !Array.isArray`) before ingestion |
| BH10 | Drafts storage key duplicated as a local constant in the hook and the migration module — drift would orphan every stored draft | low | **patch** — hook imports the single `DRAFTS_STORAGE_KEY` from `@/lib/questions/draft-migration` |
| BH17a | Evidence step 3 asserted a constant against itself (tautology — could never fail) | low | **patch** — real assertions: clientGapB retained verbatim, clientGapA dropped, removed key retained on replace |
| V1 | Replay ownership had no test coverage | gap | **patch** — covered by the BH3 test above |
| V2 | Drafts-consumption and unmapped-only-restore had no form coverage | gap | **patch** — two new DynamicAssessmentForm tests ("submitting consumes the type's drafts", "unmapped-only drafts still restore and surface their kept answers") |
| BH5 | "No producer sends the P5 payload fields through offline sync" | false | **reject** — `assessment-offline.service.ts` enqueues `{ ...assessmentData, version: 1 }`: the dynamic form's `questionKeys`/`structureVersion` ride along verbatim |
| BH8 | Falsy answers (`false`/`0`/`''`) treated as unanswered | false | **reject** — ingestion presence check is strict `!== undefined && !== null`; unit pins `false`/`0` retention |
| E9 | Removed/unknown keys should be stripped from derivation inputs | false | **reject** — contract: removed/unknown answers persist VERBATIM and self-derive source-'unknown' rows (never scored); stripping would edit frozen ruling 7 |
| BH2 / O-3a | `questionKeys` unused server-side beyond create persistence | low | **reject** — spec-settled: the client declaration is persisted on create (handshake audit) and drift is classified from answers vs registry; no further server-side consumption is pinned |
| BH4 | Create replay should re-emit drift warnings | low | **reject** — frozen matrix row pins replay as a warning-free idempotent success ("already synced", `warnings` undefined) |
| BH6 | Sync warnings are write-only (no UI surfacing) | low | **reject** — spec pins response-scoped records + `console.warn` diagnostics in the service; surfacing UI is p6 scope |
| BH9 | Stale-banner dismissal should be per-form-instance, not per-draft | low | **reject** — advisory; the localStorage key is pinned per draft id in the frozen UX block |
| BH13 | Two-write atomicity (warnings + row) | low | **reject** — moot after rework: warnings are response-scoped only, zero schema writes |
| BH14 / E5 | P2002 race on concurrent identical offlineIds | low | **reject** — undemonstrated on the pinned single-field-worker queue transport; the replay path makes the losing writer an idempotent success anyway |
| BH15 | Receipt/banner copy adjustments | low | **reject** — copy pinned verbatim in the frozen spec block |
| BH16 | Unmapped answers never submitted with the assessment | low | **reject** — spec-settled: unmapped answers are KEPT in draft storage forever and never hydrated into the answers map ("kept with the draft and never deleted") |
| BH17b / E1 | Evidence script pins severity via `updateMany` (fixture mutation) | low | **reject** — drms_test is truncated/reseeded by the suites; deterministic fixture pinning is intentional |
| E8 | `__proto__`-keyed answers could pollute prototypes | maybe-false | **reject** — bracket assignment on a fresh per-call object literal cannot touch `Object.prototype`; worst case sets that one local object's prototype (primitive values silently ignored); `JSON.parse` produces own-properties |
| E10 | 30 s registry cache means warnings can lag the freshest registry | low | **reject** — pre-existing baseline cache window; snapshot and warnings derive from the SAME cached read (mutually consistent) |
| E2 / E7 | Minor edge-case notes on the service/evidence path, verified at the cited lines as contract-consistent (behavior already pinned by adjacent tests) | low | **reject** — no standalone change required; folded into the grouped verdicts above |
| BH11 / E3 | Offline create falls back `incidentId: data.incidentId || change.entityUuid` (an entity id can land in the incident column) | low | **defer** — verbatim baseline line predating P5; changing create-field semantics belongs to the sync owner (deferred-work) |
| O-3b | The offline update producer enqueues with `entityId` while the update branch resolves rows by row-id `entityUuid` — the wired path is unreachable by current producers | low | **defer** — pre-existing legacy wiring, latent until a producer sends update changes (deferred-work) |
| BH12 | Offline update accepts `entityId`/`incidentId` without re-validating entity assignment | low | **defer** — mirrors the online update path's accepted parity; tightening belongs to a cross-cutting sync authorization pass (deferred-work) |

Post-patch re-verification (2026-09-16): lint 30 warnings (subset parity), `type-check` clean, `test:unit` 312/312 (14 suites), `db:push:test` in-sync + `test:api` 175/175 (13 suites), `test:baseline:e2e` 9/9, evidence script ALL CHECKS PASSED; `dqr-p5-review.diff` rewritten against the patched tree (136 kB).

## Design Notes

- Warnings "added" is a proxy (active keys absent from answers — optional skipped answers over-warn); "removed"/"unknown" are exact. Over-warning is safe; under-reporting is not.
- Snapshot freeze uses the CURRENT registry; the row's `structureVersion` column records the CLIENT handshake. The two may differ by design — the snapshot JSON carries its own versions.
- Status mirroring decision: current sync code writes `verificationStatus:'DRAFT'`, stranding completed work outside the verification queue — contradicts "completed assessment" (ruling 7). Mirroring the online path fixes it.
- Unknown-row severity uses the ladder registry row when one exists (deactivated keys keep their severity for display) else MEDIUM — never LOW.

## Verification

**Commands:**
- `npm run lint` — expected: 0 new warnings/errors vs baseline.
- `npm run type-check` — expected: clean.
- `npm run test:unit` — expected: green incl. new suites.
- `npm run db:push:test && npm run test:api` — expected: green (drms_test @ :5435).
- `npm run test:baseline:e2e` — expected: 9/9.
- `npx tsx scripts/dqr-p5-sync-evidence.ts > _bmad-output/implementation-artifacts/dqr-p5-sync-evidence.log` — expected: ALL CHECKS PASSED.
