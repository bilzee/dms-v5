# Dynamic Question Registry — Prompt 2 of 9: Registry Service, Admin API, Governance

Activate `@.claude/skills/bmad-quick-dev/SKILL.md` and treat this document as the intent. Do not skip workflow steps. Read `docs/plans/dynamic-question-registry-plan.md` fully first (v2 is the authority where this prompt is silent) and verify every cited claim by reading the code (line numbers drift; locate uncertain paths by search).

## Program context (applies to all 9 prompts)

Branch: **`dynamic-question-registry`**. Working dir: repo root. Evidence artifacts → `_bmad-output/implementation-artifacts/` with a `dqr-p<N>-` prefix; commit at the end of each prompt.

Decided by Bil (binding): (1) **no backward compatibility** — the app is not live; drop legacy structures in the prompt that replaces them; (2) **D-1** ADMIN edits all question fields, COORDINATOR edits severity only; (3) **D-2/D-3** editable now, no field-validation phase first; (4) **D-4** notification/signal severity inherits from the triggering object; system-health notifications keep fixed severity (plan Appendix C); (5) severity is a **derivation rule** — stored `gapAnalysis`/priority are caches; no "Recalculate All"; (6) **per-question freeze**: structural edits to a key are blocked (409 + affected count) only if that key appears in the `questionSnapshot` of an assessment under an ACTIVE incident of that type; adding questions and content edits are always allowed; (7) offline sync **never rejects a completed assessment**; (8) `structureVersion`/`contentVersion` bump atomically in-transaction; snapshots are structure-only; (9) **baseline parity is the bar, not zero** — diff failure sets against the prompt-1 baseline logs, never chase zero.

## Sequence context

Prompt 2 of 9. Completed in prompt 1 (confirm commit `feat(questions): registry schema, seed catalog, and answers data layer` + spot-check): registry tables live and seeded with `validateRegistry()` enforced; `RapidAssessment` on `answers` JSON + structure-only snapshots; legacy typed forms still submitting via `legacy-convert.ts`; `GapFieldSeverity`, its service/API/UI deleted. If any of this is missing, stop and reconcile before proceeding.

## Scope

### 1. Registry service — `src/lib/services/question-registry.service.ts`

Follow existing service conventions in that directory. Cached reads (30s TTL, invalidation on mutation): `getQuestionSet(assessmentType)` (active rows + sections, ordered) and `getSnapshot(assessmentType)` (structure projection — now the **single** snapshot source; refactor prompt 1's inline builder to consume it). `bumpVersions(tx, {structure?, content?})` — atomic, inside the mutation transaction, never after. Audit writer: every mutation writes a `QuestionAuditLog` row (actor, action, before/after JSON; `reason` **required** for structural actions).

### 2. Runtime validation builder

`buildAssessmentSchema(questionSet)` → Zod schema per the plan §2.4 widget matrix: BOOLEAN toggle; SELECT enum of option values; MULTI_SELECT array ⊆ options; NUMBER with min/max; TEXT/TEXTAREA with length bounds; `required` from the question (all gap questions required — `validateRegistry` enforces).

### 3. API routes (plan §4; follow existing route-guard patterns — search for the repo's admin/role guard helper before writing new)

- `GET /api/questions?assessmentType=` — any authenticated user (forms consume it).
- ADMIN-only: section CRUD; question create/update/**deactivate** (never delete); `/reorder` (sections and within-section); `/export` (full-registry JSON download).
- `PATCH /api/admin/questions/[id]/severity` — **ADMIN or COORDINATOR** (D-1). Tier A: always allowed; bumps `contentVersion` only.

### 4. Tier gates, in-transaction (plan §2.2/§2.6)

Tier A (labels, helper text, severity, options copy): always allowed, content bump only. Tier B (key, section move, questionType, category, inverted, required, reorder, deactivate): reject `409 question_frozen` with the count of affected ACTIVE-incident assessments when the key ∈ `questionSnapshot` of an assessment under an ACTIVE incident of that type; otherwise allow with structure bump. Key rename is **deactivate + create** — keys are never mutated. New questions and section titles: always allowed.

### 5. Integration tests (jest)

CRUD happy paths; freeze 409 carries the affected count; a Tier A edit does not bump `structureVersion` (atomicity proof); audit rows written for every mutation with reason enforced on structural; COORDINATOR gets 403 on any non-severity question mutation; unknown assessmentType → 404.

## Out of scope

Gap engine/derivation/recompute (p3), dynamic form (p4), offline/drafts (p5), notifications (p6), dashboard (p7), editor UI — this prompt ships routes only, no admin pages (p8), docs/e2e (p9).

## Verification gates

1. Parity vs prompt-1 baseline: lint 0 new; type-check/unit failure sets identical plus the new suites.
2. Integration suite above green.
3. Scripted API evidence (curl/supertest log → `dqr-p2-api-evidence.log`): create → edit label (content bump only) → attempt key rename path (404/409 semantics) → severity PATCH as COORDINATOR succeeds, label PATCH as COORDINATOR 403s.
4. Commit: `feat(questions): registry service, admin API, and tiered governance`.
