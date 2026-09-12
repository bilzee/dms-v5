# Dynamic Question Registry — Prompt 1 of 9: Registry Schema, Seed, Data Layer

Activate `@.claude/skills/bmad-quick-dev/SKILL.md` and treat this document as the intent. Do not skip workflow steps. Read `docs/plans/dynamic-question-registry-plan.md` fully first (v2 — Bil's rulings folded; it is the authority where this prompt is silent) and verify every cited claim by reading the code (line numbers drift; locate uncertain paths by search).

## Program context (applies to all 9 prompts)

Branch: **`dynamic-question-registry`** (create from `master`). Working dir: repo root. Evidence artifacts → `_bmad-output/implementation-artifacts/` with a `dqr-p<N>-` prefix; commit at the end of each prompt.

Decided by Bil (binding): (1) **no backward compatibility** — the app is not live; drop legacy structures in the prompt that replaces them; (2) **D-1** ADMIN edits all question fields, COORDINATOR edits severity only; (3) **D-2/D-3** editable now, no field-validation phase first; (4) **D-4** notification/signal severity inherits from the triggering object; system-health notifications keep fixed severity (plan Appendix C); (5) severity is a **derivation rule** — `analyzeGaps(snapshot, liveRegistry)` at write time and on severity edit; stored `gapAnalysis`/priority are caches; no "Recalculate All"; (6) **per-question freeze**: structural edits to a key are blocked (409 + affected count) only if that key appears in the `questionSnapshot` of an assessment under an ACTIVE incident of that type; adding questions and content edits are always allowed; (7) offline sync **never rejects a completed assessment**; (8) `structureVersion`/`contentVersion` bump atomically in-transaction; snapshots are structure-only, re-snapshotted on every successful submission; (9) **baseline parity is the bar, not zero** — this repo has known pre-existing failures; diff failure sets, never chase zero.

## Sequence context

Prompt 1 of 9. Nothing precedes it. This prompt establishes the program baseline logs.

## Scope

### 1. Baseline first — before any change

Capture `npm run lint`, `npm run type-check`, `npm run test:unit` outputs to `dqr-p1-baseline-lint.log`, `dqr-p1-baseline-tsc.log`, `dqr-p1-baseline-unit.log`.

### 2. Schema — `prisma/schema.prisma` + one migration

Per plan §2.1: create `QuestionSection`, `Question`, `QuestionAuditLog`; extend `RapidAssessment` with `answers Json`, `questionSnapshot Json`, `structureVersion Int`, `contentVersion Int`; add registry version counters storage as specified in §2.1/§2.6; add the `QuestionType`/`QuestionCategory`/`QuestionSectionCategory` enums. **DROP the six per-type assessment data tables and `GapFieldSeverity`** (no back-compat — ruling 1). Migration name: `question_registry`. Fix every reference the compiler reveals (compiler-driven sweep — no grep-and-hope).

### 3. Seed — `prisma/seed-questions.ts`

Exact catalog from plan §3 and its worked-example table: 55 questions (24 gap / 31 context) across all assessment types, including the three **inverted** questions, sections, and severities. **Exact strings, no tildes** — approximations ship. Wire into `prisma/seed.ts`, replacing the `GapFieldSeverity` block (~lines 900–979). Create `src/lib/questions/registry-validation.ts` exporting `validateRegistry()`: unique `(assessmentType, key)`; every gap question carries `gapLabel`/`gapMeaning`/`recommendation` and `required: true`; severity ∈ Priority enum; options conform to the typed-option schema (§2.1); ordering contiguous. Seed aborts on violation, is idempotent on re-run (upsert keyed `(assessmentType, key)`), and initializes version counters to 1/1.

### 4. Data layer — assessment service

Rewrite the rapid-assessment service's create/update/get (locate via search) to persist `answers` JSON and build a **structure-only** `questionSnapshot` (key, label, type, options, category, inverted, required, order, section — NOT severity). Temporary module `src/lib/questions/legacy-convert.ts`: map each legacy typed form payload (`healthData` etc.) to `answers` so the six hardcoded forms keep submitting unchanged. Mechanically port the existing inline gap computation to read `answers[key]` with severity from registry rows — no engine abstraction yet (prompt 3's job). Incident-severity rollup is untouched (it reads assessment priority).

### 5. Delete orphans of the dropped table

`src/lib/services/gap-field-severity.service.ts`, the gap-field-severities API routes, the GapFieldTable UI component, and the coordinator gap-field severity page. Acknowledged window: severity editing returns as API in prompt 2 and as UI in prompt 8; acceptable mid-program on a not-live app.

### 6. Unit tests (jest, `tests/unit/`)

Converter parity fixtures per assessment type (typed fixture → expected answers JSON); `validateRegistry()` negatives; snapshot projection is structure-only (severity absent).

## Out of scope

Dynamic form (p4), generic gap engine/derivation/recompute (p3), admin API and governance (p2), offline/drafts (p5), notifications (p6), dashboard (p7), editor UI (p8), docs/e2e/holistic gate (p9).

## Verification gates

1. Baseline logs captured **before** any change; after: lint 0 new problems; type-check and unit failure sets byte-identical to baseline (diff the FAIL lists; add only suites this prompt created).
2. `npm run validate:schema` green; `npx prisma migrate dev` applies clean; seed runs green **twice** (idempotency) with `validateRegistry()` enforced.
3. Unit suites above green.
4. Manual/scripted: submit the legacy HEALTH form → row carries answers JSON + snapshot + derived priority and gapAnalysis.
5. Commit: `feat(questions): registry schema, seed catalog, and answers data layer`.
