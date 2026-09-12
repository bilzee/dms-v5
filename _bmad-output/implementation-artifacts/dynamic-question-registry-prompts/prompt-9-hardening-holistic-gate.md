# Dynamic Question Registry — Prompt 9 of 9: Hardening, Docs, and Holistic Gate Close

Activate `@.claude/skills/bmad-quick-dev/SKILL.md` and treat this document as the intent. Do not skip workflow steps. Read `docs/plans/dynamic-question-registry-plan.md` fully first (v2 §0 Goals, §7 runbook, Appendices A–C are this prompt's authority) and verify every cited claim by reading the code (line numbers drift).

## Program context (applies to all 9 prompts)

Branch: **`dynamic-question-registry`**. Working dir: repo root. Evidence artifacts → `_bmad-output/implementation-artifacts/` with a `dqr-p<N>-` prefix; commit at the end of each prompt.

Decided by Bil (binding): (1) **no backward compatibility** — the app is not live; (2) **D-1** ADMIN edits all question fields, COORDINATOR edits severity only; (3) **D-2/D-3** editable now; (4) **D-4** severity inheritance implemented (p6); (5) severity is a **derivation rule**; stored results are caches; no "Recalculate All"; (6) **per-question freeze** (409 + affected count); adds/content edits always allowed; (7) offline sync **never rejects a completed assessment**; (8) versions atomic; snapshots structure-only; (9) **baseline parity is the bar, not zero**.

## Sequence context

Prompt 9 of 9 — the close. Completed so far (confirm commits + spot-check before starting): **p1** schema/seed/data layer; **p2** registry service + API + governance; **p3** gap engine + derivation; **p4** dynamic form; **p5** never-reject sync + drafts; **p6** severity inheritance (D-4); **p7** registry-driven dashboard; **p8** admin editor + coordinator severity page. If any of this is missing, stop and reconcile before proceeding.

## Scope

### 1. Submission guard

Assessment submissions accepted only for ACTIVE incidents of the matching assessment type (plan §4 route contract). Verify current behavior first; add the guard + tests only if missing.

### 2. E2E

Update existing assessment e2e for the dynamic form (kebab testids should have kept selectors stable — land any fixture updates honestly, keeping behavioral assertions). Add one **end-to-end bottom-up proof spec**: ADMIN edits a question's label + severity via the editor (p8) → the form (p4) shows the new label → a submission with that gap derives the new severity → incident severity rolls up → dashboard (p7) ranks it → the notification (p6) carries it. That single spec is the holistic verdict on the program.

### 3. Docs

Update: API contracts for all new routes; schema reference with the **data dictionary** (Appendix B: label = question, gapLabel = noun phrase, gapMeaning = declarative, recommendation = imperative); the **question authoring guide** for the post-launch ADMIN editor (D-1/D-3 make this person real); a dev-guide entry for the seed commands.

### 4. Runbook (plan §7)

`prisma/seed-questions.ts` defaults to questions-only; add the `--with-sample-data` opt-in flag for demo environments. Document the fresh-production-deploy sequence (baseline export below is step one).

### 5. Export baseline

Archive `GET /api/admin/questions/export` output as `_bmad-output/implementation-artifacts/dqr-p9-registry-export.json` — the launch-time registry record.

### 6. HANDOFF — the holistic view

Write `_bmad-output/implementation-artifacts/dynamic-question-registry-prompts/HANDOFF.md` (model: `example-support-prompts/HANDOFF.md`): the nine commits; state of the world (migration, seeds, routes, pages); a gate-results table for all 9 prompts; a **ruling→code map** (D-1..D-4, derivation rule, per-question freeze, never-reject sync, dual versions — each pointing at its enforcing file); Bil's 10-minute manual smoke tour; deferrals (routing policy per §0 Non-Goal, canned-question taxonomy extras). Then re-read plan v2 §0 Goals line by line and record file:line evidence that each goal is met — or list it as an honest deferral.

## Out of scope

Anything new beyond the plan. If a gap in the plan surfaces now, record it in HANDOFF deferrals rather than expanding scope.

## Verification gates

1. Full-suite parity vs the p1 baseline: lint 0 new; type-check/unit/smoke failure sets identical plus this program's new suites; `npm run build` green.
2. New bottom-up e2e spec green.
3. `dqr-p9-registry-export.json` archived; HANDOFF.md complete with the §0 goals→evidence table.
4. Commit: `feat(questions): hardening, docs, and holistic gate close`.
