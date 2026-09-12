# Dynamic Question Registry — Prompt 5 of 9: Never-Reject Offline Sync and Draft Migration

Activate `@.claude/skills/bmad-quick-dev/SKILL.md` and treat this document as the intent. Do not skip workflow steps. Read `docs/plans/dynamic-question-registry-plan.md` fully first (v2 is the authority where this prompt is silent) and verify every cited claim by reading the code (line numbers drift; locate the offline queue/sync and draft storage code by search before citing it).

## Program context (applies to all 9 prompts)

Branch: **`dynamic-question-registry`**. Working dir: repo root. Evidence artifacts → `_bmad-output/implementation-artifacts/` with a `dqr-p<N>-` prefix; commit at the end of each prompt.

Decided by Bil (binding): (1) **no backward compatibility** — the app is not live; (2) **D-1** ADMIN edits all question fields, COORDINATOR edits severity only; (3) **D-2/D-3** editable now; (4) **D-4** notification/signal severity inherits from the triggering object; system-health notifications keep fixed severity (plan Appendix C); (5) severity is a **derivation rule**; stored results are caches; no "Recalculate All"; (6) **per-question freeze** (409 + affected count); adds/content edits always allowed; (7) offline sync **never rejects a completed assessment** — unknown keys persist verbatim, gaps computed on intersection; (8) `structureVersion`/`contentVersion` atomic; snapshots structure-only; (9) **baseline parity is the bar, not zero**.

## Sequence context

Prompt 5 of 9. Completed so far (confirm commits + spot-check before starting): **p1** schema/seed/data layer (`answers` JSON + snapshots); **p2** registry service + admin API + tier gates; **p3** gap engine with resolution ladder + recompute-on-edit (engine already supports intersection semantics); **p4** `DynamicAssessmentForm` live, six legacy forms + `legacy-convert.ts` deleted. If any of this is missing, stop and reconcile before proceeding.

**Why this prompt exists:** field assessors work offline (PWA, Dexie queue). HQ edits questions between syncs. Ruling 7 exists because the panel found v1 could silently discard a completed assessment in exactly that collision — the one genuine data-loss bug of the program.

## Scope

### 1. Sync path — never reject

Locate the offline queue → server sync processing. Submissions carry `answers` + the client's `structureVersion`. On sync: (a) **always accept** a completed assessment; (b) unknown keys (not in the current registry) persist verbatim inside `answers`, and `gapAnalysis` marks them `source: 'unknown'` (engine intersection, p3); (c) record the client `structureVersion` on the assessment row; (d) response is `accepted` with a warnings array (added/removed/unknown keys vs the live registry) — the client surfaces it, it never unwinds the submission.

### 2. Draft auto-migration

Drafts saved by the legacy forms (typed shape, pre-p1) or by an older registry version auto-migrate on first load into the answers shape: map by question key; show a **plain-language receipt once** — copy per plan §5 (e.g. "Your draft was updated to the new question set — N answers carried over"); answers that cannot be mapped are shown in a collapsed "unmapped answers" block and kept in storage — **never silently dropped**.

### 3. Staleness banner (never blocks)

When a draft's `structureVersion` < current, the form shows the staleness banner per plan §5: "the questions have changed since this draft was started", with a plain list of added/removed keys. Submission stays allowed (ruling 7).

### 4. Tests

Jest unit/integration: sync accepts unknown keys (answers intact, `source: 'unknown'` rows); older-`structureVersion` handshake recorded; draft migration receipt counts (N carried, M unmapped); intersection gap output via the p3 engine; staleness banner logic.

## Out of scope

Notification severity (p6), dashboard (p7), admin editor UI (p8), e2e/docs/holistic gate (p9). No changes to the queue transport/retry mechanics themselves.

## Verification gates

1. Parity vs baseline: lint 0 new; type-check/unit failure sets identical plus new suites.
2. New sync/draft suites green.
3. Scripted evidence → `dqr-p5-sync-evidence.log`: queue a submission built against a stale question set (simulate by exporting the registry, editing a question, then syncing) → accepted, gaps derived from the intersection, warnings present, nothing discarded.
4. Commit: `feat(questions): never-reject offline sync and draft auto-migration`.
