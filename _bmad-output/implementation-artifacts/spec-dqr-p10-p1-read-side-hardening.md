---
title: 'DQR P10 Prompt 1 — Snapshot-Hydrated Read Side + Registry Hardening (Phases 1–2)'
type: 'bugfix'
created: '2026-09-18'
status: 'done'
route: 'dispatch'
baseline_commit: '3bc753bc9bc006bea11cb4468695aafd92d15f0d'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/spec-dqr-p10-deferred-work-consolidation.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The Situation Dashboard renders "N/A" for CONTEXT values keyed by admin-authored post-seed questions because `fromAnswers` (`src/lib/questions/answers.ts:65-96`) iterates the static `QUESTION_CATALOG` and drops every non-catalog key before hydration; the assessment edit/view pages drop drifted keys the same way. Separately, three P3 hardening items remain open: a global registry-view cache timestamp, a fully in-transaction `recomputeAssessmentsForKey`, and no seed-derivation assertions.

**Approach:** Add a pure `hydrateFromSnapshot(structure, answers)` helper that emits typed values for every key in a snapshot's sections (raw-value fallback for keys in neither, labeled `unmapped`), rewire `fromAnswers` as a thin catalog-structure wrapper, hydrate the situation route's per-type latest readers and the edit/view pages from each row's stored `questionSnapshot`, render snapshot-only keys read-only, then land the three hardening fixes (per-entry cache TTL, candidate-scan-outside-tx with in-tx re-verification and chunked rewrites, seed derivation assertions).

## Boundaries & Constraints

**Always:**
- Offline `/sync/batch` never rejects a completed assessment; no batch 4xx/5xx (binding P1–P9 ruling — unaffected here, but no read-side change may constrain it).
- Snapshots are structure-only; no snapshot format change, no `structureVersion`/`contentVersion` bumps — read-side only (plan §2 Non-goals).
- Catalog-key parity: `fromAnswers` output is byte-identical for the 55 catalog keys.
- Baseline parity is the bar, not zero: Phase 2 items are behavior-identical (api/e2e suites unchanged).
- Full gate chain green before commit: `npm run lint && npm run type-check && npm run test:unit && npm run db:push:test && npm run test:api && npm run test:baseline:e2e && npm run build`.

**Never:**
- No cross-field rule engine work (Phase 3, prompt 2–3), no offline/signal fixes (prompt 4), no CI/catalog/docs-pass (prompt 5; the P3 docs ledger entry stays open until the §4.25 pass).
- No changes to `AssessmentCategorySummary.formatContextValue` — it starts receiving values instead of `undefined`.
- No live validation on unmappable keys; no submit-path changes for drifted keys (online PUT already full-replaces against the current snapshot).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Snapshot hydration | Answers with post-seed key `p9tPatientsPerDay` present in row's `questionSnapshot` | Situation HEALTH latest payload carries the typed value; card renders it, not "N/A" | N/A |
| Catalog parity | Answers map over the 55 catalog keys | `fromAnswers` output identical pre/post change | N/A |
| Unmapped drift | Answer key in neither snapshot nor catalog | Raw stored value emitted, listed in `unmappedKeys` | Never throws |
| Null snapshot | Pre-data-layer row with `questionSnapshot: null` | Fall back to `fromAnswers` catalog hydration | N/A |
| Edit page drift | Rejected assessment whose snapshot has keys absent from live registry | Drifted questions render read-only from snapshot (label + value); no validation errors | N/A |
| Cache TTL | Type A entry older than 30 s, type B fresher | A re-queries; B served from cache | N/A |
| Severity PATCH recompute | Thousands of ACTIVE-incident assessments | Candidate scan outside tx; in-tx re-verify + chunked (200) rewrites; same `affectedCount` | Idempotent derive; PATCH retry corrects races |
| Seed derivation | `--with-sample-data` run | ≥1 CRITICAL, ≥1 HIGH, ≥1 MEDIUM among stored demo `gapAnalysis.severity`; each row's `priority === gapAnalysis.severity` | Argument swap in seed wiring fails the suite |

</frozen-after-approval>

## Code Map

- `src/lib/questions/answers.ts` — add `hydrateFromSnapshot` + typed `HydratedAnswers`; `fromAnswers` becomes wrapper over a memoized catalog structure (catalog questions are `{questionKey, questionType}` → map once to `{key, type}`).
- `src/lib/questions/question-snapshot.ts` — `QuestionSnapshot`/`RapidAssessmentSection` shapes (`{key, type}` questions); reuse for the structure param (accept loosely typed like `GapEngineSnapshotStructure`).
- `src/app/api/v1/dashboard/situation/route.ts` — `findLatestTypedAssessment` (L931-972, add `questionSnapshot` to select + interface), per-type readers L974-1082, POPULATION aggregation reader L500-523.
- `src/app/(auth)/assessor/rapid-assessments/[id]/edit/page.tsx` — passes `initialAnswers` (L150); add snapshot-driven drift prop from `assessment.questionSnapshot`.
- `src/app/(auth)/assessor/rapid-assessments/[id]/page.tsx` — view page hydrates via `fromAnswers` (L128-146) into typed cards; add read-only drift section from snapshot.
- `src/components/forms/assessment/DynamicAssessmentForm.tsx` — `buildDefaultValues` L174-198 drops non-live keys; precedent for read-only block: `draft-unmapped-block` L769-790.
- `src/lib/services/gap-analysis.service.ts` — global cache L74-77, L151-156 → per-entry `Map<AssessmentType, {view, expiresAt}>`.
- `src/lib/services/question-registry.service.ts` — `recomputeAssessmentsForKey` L879-925 (in-tx scan/rewrite); caller `setSeverity` L843-847.
- `prisma/seed.ts` — derivation wiring L785-790 (snapshot/answers/registryRows args).
- `tests/api/seed-partition.test.ts` — extend `--with-sample-data` test with derivation assertions.
- `tests/unit/answers.test.ts` — parity + post-seed fixtures home; `tests/unit/gap-analysis.test.ts` — cache TTL unit; `tests/api/dashboard-situation.test.ts` — situation payload assertions; `tests/unit/components/DynamicAssessmentForm.test.tsx` — drift rendering; `tests/e2e-baseline/` — drift e2e.

## Tasks & Acceptance

**Execution:**
- [x] `src/lib/questions/answers.ts` — add `hydrateFromSnapshot(structure, answers): HydratedAnswers` (`{ values, unmappedKeys }`); `fromAnswers(type, answers)` = wrapper returning `.values` — Scope 1.
- [x] `src/app/api/v1/dashboard/situation/route.ts` — select `questionSnapshot` in `findLatestTypedAssessment`; all seven per-type/POPULATION readers hydrate from the stored snapshot (fallback `fromAnswers` when snapshot null) — Scope 2.
- [x] Edit page + `DynamicAssessmentForm` + view page — render snapshot-only answered keys read-only (new optional snapshot prop; reuse `draft-unmapped-block` visual pattern; view page gets a generic read-only block) — Scope 2.
- [x] `src/lib/services/gap-analysis.service.ts` — per-entry cache TTL `Map<AssessmentType, {view, expiresAt}>`; `clearGapQuestionCache` resets the map — Scope 3.
- [x] `src/lib/services/question-registry.service.ts` — `recomputeAssessmentsForKey`: candidate scan via plain `prisma` (outside tx), in-tx re-verify (`questionSnapshot: { not: undefined }` + key-containment), chunked 200-row rewrites with per-row derive; document idempotency in a service comment — Scope 4.
- [x] `tests/api/seed-partition.test.ts` — derivation matrix assertions after `--with-sample-data` — Scope 5.
- [x] Tests: unit parity fixtures (6 types + `p9t*` keys), cache-TTL unit, api situation `p9tPatientsPerDay` payload, component drift rendering, e2e legacy drift read-only — Scope 6.
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` — mark P4 `fromAnswers` entry + P3 cache/tx-scaling/seed-derivation entries RESOLVED with evidence; P3 docs entry stays open — Scope 6.

**Acceptance Criteria:**
- Given a HEALTH assessment whose snapshot contains admin-authored `p9tPatientsPerDay=42`, when the situation dashboard API is called, then the HEALTH latest payload contains `p9tPatientsPerDay: 42` (not N/A).
- Given type A's registry-view cache entry is past TTL and type B's is fresh, when both are loaded, then only A re-queries (unit-verified).
- Given a severity PATCH, when recompute runs, then candidate rows are scanned outside the interactive transaction and rewritten in chunks of 200 with identical `affectedCount` (api suite unchanged).
- Given the seeded demo world, when the seed-partition suite runs, then derivation assertions hold and a swapped seed argument fails them.
- Given the full gate chain, when run end-to-end, then all seven commands exit green with evidence logs written.

## Implementation Notes

- **Seed matrix deviation (2026-09-18):** the frozen matrix row and plan §3 2d say "≥1 CRITICAL, ≥1 HIGH, ≥1 MEDIUM", but every GAP question in `QUESTION_CATALOG` carries severity `MEDIUM` (verified 2026-09-18 by querying a freshly seeded registry), so no fixture can derive CRITICAL/HIGH. The test pins the exact deterministic matrix instead (HEALTH/WASH/FOOD/SECURITY=MEDIUM, SHELTER=LOW) — which still catches the ledger's named failure mode (argument swap → all-LOW/scrambled demo priorities). Widening the severity spread is Tier A catalog authoring deferred to the P10-5 polish pass; flagged for human renegotiation.
- **Scope 4 structure (2026-09-18):** implemented plan-literal after review — candidate scan outside the interactive transaction (`scanRecomputeCandidates`, plain `prisma`, cursor-paginated 200), in-tx re-verification (`questionSnapshot: { not: Prisma.DbNull }` + incident-ACTIVE re-check + key-containment), existing per-row derive in 200-row chunks; identity-edit race falls back to an in-tx scan; idempotency documented in the service comment.
- `fromAnswers` keeps strict catalog parity and drops unmapped keys (post-seed keys surface through `hydrateFromSnapshot` on the snapshot-hydrating read paths, not through the catalog wrapper) — byte-identical output for the 55 catalog keys is pinned by unit tests.

## Spec Change Log

## Review Triage Log

Verdicts from three context-free layers (BH = blind hunter, EC = edge-case hunter, VG = verification-gap, pre-verified). Every row verified against the as-built tree unless marked pre-verified.

- [medium] BH1 edit-page drift copy promises persistence ("stay with the record") — verified real: submit sends only live form values (`DynamicAssessmentForm.tsx` `answers: data`), and the online PUT full-replaces stored answers (frozen boundary), so a resubmit destroys drift answers while the copy claims they stay → **patch** (copy correction only; the data loss itself is the frozen boundary).
- [low] BH2 view/edit drift collectors use different bases (catalog keys vs live registry) — real divergence, but both surfaces render the value (the story's bar); unifying bases is a view-page architecture refactor → reject.
- [low] BH3 near-duplicate `collectSnapshotDrift` in form + view page — intentional: different bases/outputs (see BH2); extraction is a refactor → reject.
- [low] BH4 drift testid conventions differ (camelCase view, kebab-case form) — per-surface testids pinned by their own suites; cosmetic → reject.
- [low] BH5 unmapped raw keys flow into the situation payload with no route test — raw passthrough is pinned at the unit layer (`tests/unit/answers.test.ts` unmapped fixtures) and documented in Design Notes; the route applies no transformation and the POPULATION fallback test pins the catalog path → reject.
- [low] BH6 unanswered post-seed snapshot keys render typed defaults (false/0) — exact parity with pre-P10 catalog-key semantics (`fromAnswers` always defaulted unanswered catalog keys); no fabricated defaults for unknown keys → reject.
- [low] BH7 nullable GAP-metadata widening undocumented — the fix is editing this spec; the ride-along is visible in the diff and the VG-F1 patch test pins the behavior → reject per spec-edit rule.
- [low] BH8 empty Spec Change Log despite the seed-matrix deviation — fix is editing this spec; deviations are recorded in Implementation Notes (this build's log of them) → reject per spec-edit rule.
- [low] BH9 `scanRecomputeCandidates` docstring says "constant memory" — inaccurate: the collected id list grows with matching candidates → **patch** (comment correction).
- [low] BH10 + EC1 rows becoming eligible between the outside scan and tx commit are missed this PATCH — real but millisecond-window on a rare admin op; frozen matrix accepts ("PATCH retry corrects races") and in-tx reconciliation would defeat the P10-1 scaling this story lands; service comment documents convergence → reject.
- [low] BH11 ledger `status:`/`update:` convention ambiguous — the file already carries both styles pre-story (collapsed `status: RESOLVED` at the D-1 entry vs `status: OPEN`+`update:` at the P4 entry); this run's entries follow the D-1 precedent → reject (no violation introduced; reformatting churns the artifact for zero clarity).
- [low] BH12/BH13/BH14 + EC7 `docs/operation-manual-ui.html` — third manual, zero inbound references (rg over `_bmad-output/` finds none), stale-at-birth content, dead scroll-spy code, TOC null-deref — pre-existing untracked planning artifact, not caused by this story → **defer** (and excluded from this commit).
- [low] BH15 prompt-5 mixes pnpm/npm commands — pre-existing planning input, not this story's diff → **defer**.
- [low] BH16 situation route selects full `questionSnapshot` JSON per latest row — frozen design (snapshot-hydrated read side); snapshots are structure-only (~KB) and only latest rows are read; SQL-level JSON projection is complexity for no demonstrated harm → reject.
- [low] BH17 drift e2e mutates the shared baseline world — suite green (18/18) under parallel interleave; no other baseline spec touches POPULATION/structureVersion/`p9t*`; the spec uses a dedicated non-FLOOD incident and is serial → reject.
- [false] EC2 structureless snapshot (`{}`/`{sections: []}`) bypasses catalog fallback, NaN-poisons aggregation — no program path produces it: every writer (service `getSnapshot`, factory, seed) builds sections via `buildQuestionSnapshot` from the active registry, registry invariants keep ≥1 active GAP per type, and pre-data-layer rows store `DbNull` which the route's null check routes to catalog; aggregation fields are seeded NUMBER keys present in every valid snapshot and `Number(x || 0)` guards the rest.
- [false] EC3 unmapped raw values cast unchecked (`as AnswerValue`) — answers are zod-validated on every write path (client+server `buildAssessmentSchema`); the gap engine has consumed the same raw map since P3 unchanged; no writer of non-`AnswerValue` shapes exists.
- [false] EC4 duplicate snapshot keys resolve last-wins — the registry enforces per-type key uniqueness (`question_key_duplicate` 409 + `validateRegistry`), and snapshots freeze from that registry, so duplicates cannot occur.
- [low] EC5 + EC6 empty-array drift values render blank instead of '—' (both formatters) — `[]` is a legitimate stored MULTI_SELECT answer and passes the collectors' non-empty filter; fix is a direct ternary in each formatter → **patch**.
- [medium] VG-F1 (pre-verified) create-route null GAP-metadata acceptance untested — `QuestionEditDialog.tsx` sends explicit `gapLabel/gapMeaning/recommendation: null` on CONTEXT create; the `.nullable()` widening is load-bearing and unpinned → **patch** (api test).
- [medium] VG-F2 (pre-verified) recompute pagination/chunking never exercised past one page; in-tx fallback scan never exercised → **patch** (api test: 206 candidates across pages + direct `recomputeAssessmentsForKey(tx, …, undefined)`).
- [low] VG-F3 (pre-verified) only the POPULATION reader asserted of the six changed situation readers → **patch** (sector-reader probe test for HEALTH/FOOD/WASH/SHELTER/SECURITY).
- [low] VG-F4 (pre-verified) nine sibling latest-assessment readers elsewhere in the route remain catalog-bound — pre-existing read paths untouched by this story → **defer**.

**Routing:** no intent_gap, no bad_spec → no loopback. Patches: BH1, BH9, EC5+EC6, VG-F1, VG-F2, VG-F3 (implementation subagent session is not continuable — stateless launch — so patches applied directly per step-04 fallback). Defers: BH12-14+EC7 (operation manual), BH15 (prompt-5 tooling), VG-F4 (sibling readers) → `deferred-work.md`.

## Design Notes

`hydrateFromSnapshot` accepts a loose structure (`sections[].questions[]` with `{key, type}`), so stored `QuestionSnapshot` JSON, live snapshot objects, and test fixtures all fit without adapters. The catalog wrapper maps `QUESTION_CATALOG`'s `{questionKey, questionType}` once per type (module-level memo). Unmapped raw passthrough mirrors the gap-engine's drift semantics (`source: 'unmapped'`) — typed defaults are never fabricated for unknown keys.

Idempotency argument for Scope 4 (documented in the service): severity PATCH updates the registry row first inside the tx; recompute derives pure from each row's frozen snapshot + live registry severities, so a retry converges. A concurrent PATCH interleaving at worst re-derives a row with a stale ladder, corrected by that PATCH's own recompute.

## Verification

**Commands:**
- `npm run lint && npm run type-check` — expected: clean.
- `npm run test:unit` — expected: green incl. new parity/TTL/component suites.
- `npm run db:push:test && npm run test:api` — expected: green incl. situation + seed-derivation assertions.
- `npm run test:baseline:e2e` — expected: green incl. drift spec.
- `npm run build` — expected: success.

**Manual checks (if no CLI):**
- Evidence artifacts `_bmad-output/implementation-artifacts/dqr-p10-1-context-evidence.log` (hydrated situation payload snippet) and `dqr-p10-1-hardening.log` (cache-TTL + seed-derivation runs) captured; ledger entries RESOLVED.
