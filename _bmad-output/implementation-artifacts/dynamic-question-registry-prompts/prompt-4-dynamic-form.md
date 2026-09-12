# Dynamic Question Registry — Prompt 4 of 9: Dynamic Assessment Form

Activate `@.claude/skills/bmad-quick-dev/SKILL.md` and treat this document as the intent. Do not skip workflow steps. Read `docs/plans/dynamic-question-registry-plan.md` fully first (v2 is the authority where this prompt is silent; §2.4 Layout Contract is this prompt's blueprint) and verify every cited claim by reading the code (line numbers drift).

## Program context (applies to all 9 prompts)

Branch: **`dynamic-question-registry`**. Working dir: repo root. Evidence artifacts → `_bmad-output/implementation-artifacts/` with a `dqr-p<N>-` prefix; commit at the end of each prompt.

Decided by Bil (binding): (1) **no backward compatibility** — the app is not live; drop legacy structures in the prompt that replaces them; (2) **D-1** ADMIN edits all question fields, COORDINATOR edits severity only; (3) **D-2/D-3** editable now; (4) **D-4** notification/signal severity inherits from the triggering object; system-health notifications keep fixed severity (plan Appendix C); (5) severity is a **derivation rule**; stored `gapAnalysis`/priority are caches; no "Recalculate All"; (6) **per-question freeze** (409 + affected count); adds/content edits always allowed; (7) offline sync **never rejects a completed assessment**; (8) `structureVersion`/`contentVersion` atomic; snapshots structure-only; (9) **baseline parity is the bar, not zero**.

## Sequence context

Prompt 4 of 9. Completed so far (confirm commits + spot-check before starting): **p1** schema/seed/data layer — `answers` JSON + structure-only snapshots; legacy forms still submitting via `legacy-convert.ts`. **p2** registry service + admin API + tier gates. **p3** generic gap engine — `analyzeGaps` with resolution ladder; recompute-on-severity-edit; recalculate endpoints deleted. If any of this is missing, stop and reconcile before proceeding.

**Why this prompt exists:** the form is the product. Plan §2.4 formalizes the existing design language (studied in `HealthAssessmentForm.tsx` and siblings) as the 7-zone Layout Contract so dynamic questions are placed by their properties, not hardcoded position.

## Scope

### 1. `useQuestionSet(assessmentType)` hook

Fetch `GET /api/questions?assessmentType=` (p2) with client caching; expose `{ sections, questions, structureVersion, isLoading }`.

### 2. `src/components/forms/assessment/DynamicAssessmentForm.tsx` — the only form

Implement zones **Z1–Z7 exactly** per plan §2.4: Z1 section progress + sticky form header (confirmed-gap count, severity badge); Z2 incident/entity selectors; Z3 GAP sections — tinted `bg-sky-50/50 dark:bg-sky-950/20`, bordered checkbox items with live StatusBadge, gap-first (runtime sorts category then order — seed convention, overridable); Z4 CONTEXT sections; Z5 auto Risk Assessment card rendering engine output as a client-side preview (server derivation remains the truth); Z6 GPS/photos/Additional Details; Z7 30s draft autosave + submit. Widget matrix per `questionType` (BOOLEAN toggle, SELECT, MULTI_SELECT, NUMBER with min/max, TEXT/TEXTAREA with placeholder). `data-testid = kebabCase(key)` — preserves the Playwright selector convention. **Per-question gating**: untouched = neutral (never a gap); header counts confirmed gaps only. **POPULATION**: zero-gap suppression + client-supplied priority, matching current behavior (verify in the existing form before deleting it). Human-assessor check preserved. Validation via `buildAssessmentSchema` (p2).

### 3. Rewire routes

Point the assessment new/edit pages (locate via the six forms' consumers) at `DynamicAssessmentForm`; edit mode hydrates from stored `answers` + snapshot.

### 4. Delete the legacy layer (ruling 1)

The six hardcoded form components, their option constants and typed Zod schemas, and `src/lib/questions/legacy-convert.ts` from p1. Compiler-driven sweep — zero dead code remains.

## Out of scope

Offline queue behavior and draft migration (p5), notification severity (p6), dashboard (p7), admin editor UI (p8), e2e spec updates beyond keeping existing suites green (p9).

## Verification gates

1. Parity vs baseline: lint 0 new; type-check/unit failure sets identical plus new suites.
2. Existing assessment smoke/e2e flows green — kebab-case testids keep selectors stable; update spec fixtures only where question copy changed, honestly, keeping all behavioral assertions.
3. Unit tests: widget rendering per questionType; gating (untouched = neutral); gap-first ordering; POPULATION suppression.
4. Manual evidence → `dqr-p4-form-health.png`, `dqr-p4-form-population.png`: gap tint, section ordering, Risk Assessment card, draft autosave indicator.
5. Commit: `feat(questions): dynamic assessment form replaces hardcoded forms`.
