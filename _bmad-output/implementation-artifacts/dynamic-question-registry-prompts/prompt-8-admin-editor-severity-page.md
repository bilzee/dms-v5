# Dynamic Question Registry — Prompt 8 of 9: Admin Question Editor and Coordinator Severity Page

Activate `@.claude/skills/bmad-quick-dev/SKILL.md` and treat this document as the intent. Do not skip workflow steps. Read `docs/plans/dynamic-question-registry-plan.md` fully first (v2 §2.2 tiers, §5 UI are this prompt's authority) and verify every cited claim by reading the code (line numbers drift; follow the repo's existing admin-page + role-guard patterns before writing new).

## Program context (applies to all 9 prompts)

Branch: **`dynamic-question-registry`**. Working dir: repo root. Evidence artifacts → `_bmad-output/implementation-artifacts/` with a `dqr-p<N>-` prefix; commit at the end of each prompt.

Decided by Bil (binding): (1) **no backward compatibility** — the app is not live; (2) **D-1** ADMIN edits all question fields, COORDINATOR edits severity only; (3) **D-2/D-3** editable now, so the editor is the primary post-launch tool; (4) **D-4** severity inheritance (done in p6); (5) severity is a **derivation rule**; stored results are caches; no "Recalculate All"; (6) **per-question freeze** (409 + affected count); adds/content edits always allowed; key rename = deactivate + create; (7) offline sync never rejects; (8) versions atomic; snapshots structure-only; (9) **baseline parity is the bar, not zero**.

## Sequence context

Prompt 8 of 9. Completed so far (confirm commits + spot-check before starting): **p1** schema/seed/data layer; **p2** registry service + admin API + tier gates (routes exist, no UI yet); **p3** gap engine + recompute-on-edit with affected counts; **p4** dynamic form; **p5** never-reject sync; **p6** severity inheritance; **p7** registry-driven dashboard. If any of this is missing, stop and reconcile before proceeding.

**Why this prompt exists:** D-1/D-2/D-3 put a person in this editor after launch. Prompt 1 deleted the old gap-field severity page; this prompt closes that window by rebuilding the coordinator severity UX on the registry and shipping the ADMIN editor — the last user-facing surface of the program.

## Scope

### 1. ADMIN editor pages

Follow existing admin-section page + guard conventions. **List**: questions grouped by section, category badges (GAP/CONTEXT), severity chips, active state, type filter, search. **Edit drawer**: every `Question` field with the char limits from plan §5; questionType-switching widget preview; a **Z5-context preview** rendering the question as it appears mid-form (section tint, StatusBadge) so the editor sees what field assessors see. Duplicate-key submit triggers the explicit **create-with-new-key** flow (never mutates a key). Deactivate (never delete). Section management: create, retitle, reorder. **Audit viewer**: per-question `QuestionAuditLog` timeline with before/after diff, actor, reason. **Export** button → p2's `/export`.

### 2. Tier enforcement surfaced, not just enforced

A structural edit hitting p2's 409 renders the frozen banner: affected ACTIVE-incident count + mandatory reason field (submitted with the retry or the deactivate+create path). Severity edits show a **confirm dialog quoting p3's affected count** before the recompute commits.

### 3. Coordinator severity page (closes the p1 deletion window)

Rebuild the deleted page's UX on the registry: same list/filter-by-assessment-type experience coordinators had, severity dropdown only, writes via `PATCH /api/admin/questions/[id]/severity`; route guard COORDINATOR + ADMIN (D-1). Every other field is read-only here.

### 4. Tests

Smoke/jest per repo conventions: edit a label → the dynamic form (p4) reflects it on next fetch; freeze path renders the banner with count; coordinator cannot open the field editor; severity confirm dialog flows through to p3's recompute.

## Out of scope

Submission guard, e2e suite updates, docs, runbook, holistic review (all p9).

## Verification gates

1. Parity vs baseline: lint 0 new; type-check/unit failure sets identical plus new suites.
2. Smoke suites green; role-guard evidence (coordinator 403 on non-severity surfaces).
3. Manual evidence → `dqr-p8-editor.png`, `dqr-p8-severity.png`, `dqr-p8-frozen-banner.png`.
4. Commit: `feat(questions): admin question editor and coordinator severity page`.
