# Dynamic Question Registry — Prompt 7 of 9: Registry-Driven Situation Dashboard Summaries

Activate `@.claude/skills/bmad-quick-dev/SKILL.md` and treat this document as the intent. Do not skip workflow steps. Read `docs/plans/dynamic-question-registry-plan.md` fully first (v2 §2.7 is this prompt's authority) and verify every cited claim by reading the code (line numbers drift; locate the Situation Dashboard's summary computation and embed flow by search).

## Program context (applies to all 9 prompts)

Branch: **`dynamic-question-registry`**. Working dir: repo root. Evidence artifacts → `_bmad-output/implementation-artifacts/` with a `dqr-p<N>-` prefix; commit at the end of each prompt.

Decided by Bil (binding): (1) **no backward compatibility** — the app is not live; (2) **D-1** ADMIN edits all question fields, COORDINATOR edits severity only; (3) **D-2/D-3** editable now; (4) **D-4** notification/signal severity inherits from the triggering object; system-health notifications keep fixed severity (plan Appendix C); (5) severity is a **derivation rule**; stored results are caches; no "Recalculate All"; (6) **per-question freeze** (409 + affected count); adds/content edits always allowed; (7) offline sync **never rejects a completed assessment**; (8) `structureVersion`/`contentVersion` atomic; snapshots structure-only; (9) **baseline parity is the bar, not zero**.

## Sequence context

Prompt 7 of 9. Completed so far (confirm commits + spot-check before starting): **p1** schema/seed/data layer; **p2** registry service + admin API + tier gates; **p3** gap engine + recompute-on-edit; **p4** dynamic form; **p5** never-reject sync + draft migration; **p6** notification/signal severity inheritance (D-4). If any of this is missing, stop and reconcile before proceeding.

**Why this prompt exists:** the dashboard was built against ~24 hardcoded gap fields. With an unbounded registry it cannot render one row per question — plan §2.7 answers the real-estate question the program was born from: rank, don't enumerate.

## Scope

### 1. Registry-driven summaries

The dashboard's assessment-category summary (locate the current computation, including whatever the embed flow consumes) derives entirely from stored `gapAnalysis` rows: labels from `gapLabel`, meanings from `gapMeaning`, severity from the derived row. **Delete the hardcoded donor gap taxonomy** in that path (compiler-driven; it was one of the four hardcoded copies the plan inventories in §1).

### 2. Top-N ranking — severity × spread

Per plan §2.7: rank gap rows by severity (CRITICAL > HIGH > MEDIUM > LOW) then by spread (number of affected entities/assessments reporting that gap key). Default N from a `gapRowsPerCategory` user setting with a hard ceiling per §2.7. Overflow renders the hinted chip — exact copy per plan §5 ("+N more"), expandable.

### 3. Zero-gap suppression and POPULATION

Categories/entities with no confirmed gaps collapse instead of rendering empty rows. POPULATION keeps its special-cased display (client-priority, no gap rows) per §2.7 — verify current behavior and preserve it.

### 4. "Severities as of" stamp

The summary card stamps provenance: current registry `contentVersion` + computation timestamp, per §2.7 — an honest indicator of which question-set severity the view reflects (recompute-on-edit from p3 keeps this fresh).

### 5. Tests

Jest unit: ranking order (severity then spread); overflow chip math at the ceiling; zero-gap suppression; stamp fields; `gapRowsPerCategory` setting respected.

## Out of scope

Admin editor UI (p8), submission guard/e2e/docs/holistic gate (p9). No changes to the embed transport itself beyond what the summary computation feeds it.

## Verification gates

1. Parity vs baseline: lint 0 new; type-check/unit failure sets identical plus new suites.
2. New summary suites green.
3. Manual evidence → `dqr-p7-dashboard.png` against dev data: ranked rows, chip at ceiling, collapsed zero-gap categories, stamp visible.
4. Commit: `feat(questions): registry-driven situation dashboard summaries`.
