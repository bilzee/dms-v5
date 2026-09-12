# Dynamic Question Registry — Prompt 3 of 9: Generic Gap Engine and Severity Derivation

Activate `@.claude/skills/bmad-quick-dev/SKILL.md` and treat this document as the intent. Do not skip workflow steps. Read `docs/plans/dynamic-question-registry-plan.md` fully first (v2 is the authority where this prompt is silent) and verify every cited claim by reading the code (line numbers drift; locate uncertain paths by search).

## Program context (applies to all 9 prompts)

Branch: **`dynamic-question-registry`**. Working dir: repo root. Evidence artifacts → `_bmad-output/implementation-artifacts/` with a `dqr-p<N>-` prefix; commit at the end of each prompt.

Decided by Bil (binding): (1) **no backward compatibility** — the app is not live; (2) **D-1** ADMIN edits all question fields, COORDINATOR edits severity only; (3) **D-2/D-3** editable now; (4) **D-4** notification/signal severity inherits from the triggering object; system-health notifications keep fixed severity (plan Appendix C); (5) severity is a **derivation rule** — `analyzeGaps(snapshot, liveRegistry)` at write time and on severity edit; stored `gapAnalysis`/priority are caches; no "Recalculate All"; (6) **per-question freeze** with 409 + affected count, adds/content edits always allowed; (7) offline sync **never rejects a completed assessment**; (8) `structureVersion`/`contentVersion` bump atomically in-transaction; snapshots are structure-only; (9) **baseline parity is the bar, not zero**.

## Sequence context

Prompt 3 of 9. Completed so far (confirm commits + spot-check before starting): **p1** registry schema/seed/data layer (`feat(questions): registry schema, seed catalog, and answers data layer`); **p2** registry service (cache, atomic dual counters, single snapshot source), admin API incl. severity route, tier gates + audit (`feat(questions): registry service, admin API, and tiered governance`). If any of this is missing, stop and reconcile before proceeding.

**Why this prompt exists:** prompt 1 left a mechanical port of the old inline gap computation reading `answers[key]`. This prompt replaces it with the plan §2.3 derivation rule — the heart of the bottom-up severity system.

## Scope

### 1. Engine — `src/lib/questions/gap-engine.ts` (pure, no I/O)

`analyzeGaps(snapshotStructure, answers, registryRows)`: a gap on a required gap question = `inverted ? answers[key] === true : answers[key] === false`; missing answer → no gap, row marked `unanswered: true` (per-question gating lands with the form in p4). Severity **resolution ladder** per plan §2.3: live registry row for that key (regardless of `isActive` — a deactivated key still resolves) → snapshot severity → `source: 'unmapped'`. Output rows: key, label, `gapLabel`, severity, `source`, `recommendation`. Assessment severity = MAX over gapped rows, LOW when none. POPULATION stays client-priority (suppression is p7's concern). Support intersection semantics: registry rows missing a snapshot key are ignored; snapshot keys with no live row fall to the ladder.

### 2. Wire-in

Assessment service create/update/submit call the engine; `gapAnalysis` and `priority` stored as caches (plan §2.3). Incident-severity rollup untouched — it already reads assessment priority.

### 3. Recompute-on-severity-edit

The p2 severity PATCH route re-derives, **in the same transaction**, every assessment whose `questionSnapshot` contains the key AND whose incident is ACTIVE of that assessment type; the response returns the affected count (confirm-on-edit UX arrives p8). Content-version bump + audit row as in p2.

### 4. Delete obsolete endpoints

Search for and delete any recalculate/update-priorities style endpoints over assessments (the plan deleted `/admin/severity/recalculate` and gap-field equivalents; the derivation rule makes them structurally obsolete). Compiler-driven sweep of their callers.

### 5. Unit tests (jest) — truth tables

Normal gap/no-gap per questionType; the three inverted questions (`hasOpenDefecationConcerns`, `areOvercrowded`, `gbvCasesReported` — verify names in seed); unmapped key path (deactivated + absent from registry → ladder fallback); empty answers; MAX ordering CRITICAL > HIGH > MEDIUM > LOW; intersection semantics (unknown keys ignored, live-row-wins).

## Out of scope

Dynamic form/gating UX (p4), offline intersection consumers (p5 — engine support only, no sync changes), notifications (p6), dashboard (p7), editor UI (p8), docs/e2e (p9).

## Verification gates

1. Parity vs baseline: lint 0 new; type-check/unit failure sets identical plus new suites.
2. Engine truth-table suite green.
3. Scripted proof → `dqr-p3-recompute-evidence.log`: edit one question's severity via the API → assessments under ACTIVE incidents of that type re-derived (priority + gapAnalysis updated; snapshots untouched); assessments under non-ACTIVE incidents untouched; response reports the affected count.
4. Deleted endpoints return 404.
5. Commit: `feat(questions): generic gap engine and severity derivation rule`.
