# DQR P10 — Prompt 3 of 5: Cross-Field Rule Registry — Admin Authoring UI + Legacy Cutover (Phase 3, part 2)

Activate `@.claude/skills/bmad-build/SKILL.md` and treat this document as the intent. Do not skip workflow steps. Read `_bmad-output/implementation-artifacts/spec-dqr-p10-deferred-work-consolidation.md` §4.5, §4.3 (migration-safety paragraph), §8 and §9 fully first (the plan is the authority where this prompt is silent) and verify every cited claim by reading the code (line numbers drift).

## Program context (applies to all 5 prompts)

Branch: **`dynamic-question-registry`** Working dir: repo root. Evidence artifacts → `_bmad-output/implementation-artifacts/` with a `dqr-p10-<N>-` prefix; commit at the end of each prompt. Authority chain: the P10 plan first; `_bmad-output/implementation-artifacts/dynamic-question-registry-prompts/HANDOFF.md` for P1–P9 state.

Full gate chain (every prompt, plan §8): `npm run lint && npm run type-check && npm run test:unit && npm run db:push:test && npm run test:api && npm run test:baseline:e2e && npm run build`.

Binding rulings carried from P1–P9: offline `/sync/batch` **never rejects** a completed assessment; severity is a derivation rule; per-question freeze; dual version counters; snapshots structure-only; **baseline parity is the bar, not zero**.

## Sequence context

Prompt 3 of 5 — closes the program's centerpiece. Completed so far (confirm commits + spot-check before starting): **p10-1** snapshot read side + hardening; **p10-2** rule registry backend — `CrossFieldRule` schema + 15 seeded rows, `rule-engine.ts` (`evaluateRules`, shared zod AST), golden parity harness, `/admin/rules*` CRUD, `/questions` payload `rules`, server-side REFINEMENT enforcement + sync-batch exemption, docs §4.25. If any of this is missing, stop and reconcile — the cutover must not run ahead of its safety net.

**Why this prompt exists:** the seeded 15 rules must become editable data through the governed UI (plan §4.5 parity authoring flow), and the golden parity test is the only license to delete the hardcoded island (plan §9 risk table).

## Scope — Part A: admin authoring UI (plan §4.5)

### 1. Rules panel in the registry editor

`src/app/(auth)/admin/settings/questions/page.tsx` (P8 editor) gains a **"Cross-field rules" tab/panel per assessment type**, reusing the page's type switcher, version badges, reason-governance and audit-timeline components. Rule list: name, kind badge (REFINEMENT/AGGREGATE), message preview, referenced question keys as chips, active toggle, order controls. Empty-state hint for HEALTH/SECURITY ("no rules — by design").

### 2. Rule editor dialog

Extends the existing `QuestionEditDialog` patterns:

- *When* row (optional): question dropdown filtered to the type's BOOLEAN questions + is/is-not toggle.
- *Violation condition* row: left operand = question dropdown (NUMBER questions) or "Sum of…" multi-select; comparator (`> ≥ < ≤ = ≠`); right operand = question dropdown or literal number input.
- *Message* textarea with `{{value:key}}`/`{{sum:…}}` token inserter and live preview dry-run against the type's latest assessment's current answers.
- `reason` field (required) + version badge showing the pending `structureVersion` bump.
- Client-side validation imports the shared zod schema from `src/lib/questions/rule-engine.ts` (no duplicate schema).

### 3. Deactivation guard UX

The editor's deactivate confirmation lists active rules referencing the question (data from `/admin/questions/{id}/impact`).

### 4. Tests + evidence (Part A)

E2E: (a) create a rule via the UI → it violates on the dynamic form → submit blocked; (b) edit a seeded rule → the form's message changes. Component tests for dialog validation. Visual → `dqr-p10-3-rule-editor.png`. **Commit A: `feat(questions): admin cross-field rule editor`.**

## Scope — Part B: legacy cutover (plan §4.3)

### 5. Re-verify the golden parity gate

Run/extend the harness from p10-2: per-type fixtures (violating, boundary, clean) through BOTH legacy `evaluateCrossFieldRules` and registry-seeded `evaluateRules` must produce identical violation arrays. Any mismatch: fix engine/seed, do **not** delete. Capture → `dqr-p10-3-parity-final.log`.

### 6. Delete + re-export + rewire

Delete `src/lib/questions/cross-field-rules.ts`. Re-export `evaluateCrossFieldRules` / `crossFieldSuperRefine` / `hasCrossFieldViolations` from `rule-engine.ts` with the **same signatures**. Rewire `DynamicAssessmentForm.tsx` to consume rules from the `/questions` payload instead of the static module — behavior identical by parity.

### 7. Ledger

Mark the P4 ledger entry ("Replace the hardcoded client-side cross-field rules module…", From Spec Decision 2026-09-15) **RESOLVED** with evidence: parity log + deletion commit + payload-driven form.

## Out of scope

Rule-engine semantic changes beyond parity demands; new rules beyond the seeded 15; offline/signal fixes (prompt 4).

## Verification gates

1. Part A e2e green; seeded 15 rules visible + editable for POPULATION/FOOD/WASH/SHELTER; evidence png archived.
2. Part B: golden parity green **before** deletion (ordered log); full gate chain green **after**; `cross-field-rules.ts` absent, zero import references (verify by search); p10-2 enforcement e2e still green.
3. Ledger entry RESOLVED.
4. **Commit B: `refactor(questions): migrate forms to registry rules, delete legacy module`** (Part A committed first per above).
