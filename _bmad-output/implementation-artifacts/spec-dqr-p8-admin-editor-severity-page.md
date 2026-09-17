---
title: 'DQR P8: Admin Question Editor and Coordinator Severity Page'
type: 'feature'
created: '2026-09-17'
status: 'done'
route: 'dispatch'
baseline_commit: '7bd9df5aa6094f0619fcaff8d54efccdd1530214'
review_loop_iteration: 0
context:
  - '{project-root}/docs/plans/dynamic-question-registry-plan.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** P1 deleted the coordinator gap-field severity page and p2 shipped registry admin APIs with no UI — the program currently has no post-launch editing surface (D-1/D-2/D-3 put a person in this editor).

**Approach:** Ship the ADMIN question editor (list + edit dialog with in-context previews, tier/freeze surfacing, section management, audit timeline, export) and rebuild the coordinator severity page on the registry (severity-only writes via the existing PATCH route), plus two small read endpoints they need (severity impact preview, question audit timeline). Backed entirely by existing p2 APIs — no service changes.

## Boundaries & Constraints

**Always:** follow repo conventions — `RoleBasedRoute` page guards (`requiredRole="ADMIN"` for editor; COORDINATOR+ADMIN for severity page), shadcn `Dialog`/`AlertDialog` (no sheet/drawer exists), `apiGet/apiPost/apiPut/apiPatch` from `src/lib/api.ts`, sonner toasts, `StatusBadge`/`getBadgeClasses('severity', …)` chips. Editor reads `GET /api/v1/questions?assessmentType=X&includeInactive=1`; coordinator page reads it without the flag and renders GAP questions only. Keys are never mutated; duplicate = create-with-new-key. Every structural submit sends `reason` (service enforces). After any successful mutation invalidate both `['question-set', type]` (p4 form cache) and the admin cache so label edits surface on next form fetch. Severity options for GAP: CRITICAL/HIGH/MEDIUM (schema forbids LOW).

**Never:** no "Recalculate All", no server/service/governance changes, no migrations, no e2e-suite additions, no docs/runbook (p9). Never render deactivate/delete as silent actions.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Admin edits label | PUT succeeds | Row updates; `['question-set', type]` invalidated; toast | `registry_invalid` → list `details.errors` inline |
| Structural edit frozen | 409 `question_frozen` `{questionKey, affectedCount}` | Banner in dialog: "used by N assessments under active incidents" + mandatory reason field + Retry-with-reason + Create-with-new-key (prefilled, reason carried) | Retry still 409 → banner explains incident must close; content edits remain available |
| Duplicate key on create | 409 `question_key_duplicate` | Inline key error; dialog stays open; key is editable only here | N/A |
| Severity change (admin or coordinator) | Confirm dialog | AlertDialog quotes impact count from new `GET …/[id]/impact`; on confirm PATCH runs; toast quotes server `affectedCount` | `severity_not_editable`/400 → toast error |
| Coordinator opens non-severity surface | PUT/POST/DELETE `/api/v1/admin/questions*` | 403 (p2 guard) — asserted in tests | N/A |

</frozen-after-approval>

## Code Map

- `src/app/(auth)/admin/settings/questions/…` siblings (`map`, `notifications`) — page conventions; `(auth)/admin` tree + pass-through layout (no server guard; `RoleBasedRoute` is the real guard, used e.g. in `admin/dashboard/page.tsx`).
- `src/components/shared/RoleBasedRoute.tsx` — props `requiredRole | requiredRoles`, `fallbackPath`.
- `src/app/api/v1/admin/questions/**`, `src/app/api/v1/admin/sections/**` — p2 mutation routes; `PATCH [id]/severity` is ADMIN+COORDINATOR and returns `{question, affectedCount}`; `GET export` returns JSON envelope (client must save blob); `GET /api/v1/questions` returns full Prisma rows (`sections[].questions[]` incl. `id`, `key`, `isActive`, `severity`, `options`).
- `src/lib/services/question-registry.service.ts` — `getQuestionSet`, `countFrozenSnapshots(tx, type, keys)` (public; pass `db` as tx), `clearQuestionRegistryCache`. Audit rows live in `QuestionAuditLog` (`entityType/entityId/action/changes/previous/reason/actorId/actedAt`, relation `actor → User`, schema.prisma:483).
- `src/lib/validation/questions.ts` — `CreateQuestionSchema`/`UpdateQuestionSchema`/`SeverityPatchSchema`/`CreateSectionSchema`/`UpdateSectionSchema`/`ReorderSchema` + char limits (label 1–500, helperText ≤1000, reason ≤2000).
- `src/components/forms/assessment/DynamicAssessmentForm.tsx` — preview fidelity source: GAP section tint `bg-sky-50/50 dark:bg-sky-950/20`; BOOLEAN item `flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4 bg-background`; badge `<StatusBadge domain="assessment" status={gapStatus} label="Gap"/"No Gap">`; Z5 row `flex items-start gap-3 rounded-lg bg-red-50 p-3 dark:bg-red-900/10` with title `{gapLabel} Gap` + severity `Badge` (CRITICAL/HIGH→destructive, MEDIUM→secondary, else outline); `kebabCase` helper at line 150.
- Deleted-page UX to replicate: `git show b8ccfd2^:src/components/settings/GapFieldTable.tsx` (staged `pendingChanges`, bulk select+apply, Save All, per-row save) and `git show b8ccfd2^:src/app/(auth)/coordinator/settings/gap-field-management/page.tsx` (per-type Tabs, header, severity explainer card — drop the "Recalculate All" card).
- `src/components/layouts/Navigation.tsx` — `roleSpecificItems.ADMIN` (~L335) and coordinator "Configuration" group (~L177); `src/lib/auth/route-config.ts` `ROLE_ACCESSIBLE_PATHS.COORDINATOR` (add new path; ADMIN already passes `/^\/coordinator\//`); `src/components/shared/Breadcrumbs.tsx` settings-map (~L181).
- Tests: `tests/api/question-registry.test.ts` (factories `ensureQuestionRegistry`, `createUser`, `createIncident`, `createRapidAssessment`; helpers `tokenFor`, `makeRequest`, `withParams`, `jsonOf` in `tests/helpers/api.ts`); unit tests `tests/unit/components/DynamicAssessmentForm.test.tsx` (mock pattern).

## Tasks & Acceptance

**Execution:**
- [x] `src/app/api/v1/admin/questions/[id]/audit/route.ts` -- NEW `GET` (ADMIN): load question, return `{question:{id,key,assessmentType}, entries}` = `questionAuditLog.findMany({where:{entityType:'QUESTION',entityId:id}, orderBy:{actedAt:'desc'}, take:50, include:{actor:{select:{email,name}}}})` -- audit viewer data source.
- [x] `src/app/api/v1/admin/questions/[id]/impact/route.ts` -- NEW `GET` (ADMIN or COORDINATOR): return `{affectedCount: await QuestionRegistryService.countFrozenSnapshots(db, q.assessmentType, [q.key])}` -- pre-confirm count for severity edits.
- [x] `src/hooks/useAdminQuestionSet.ts` -- NEW React Query hook: `apiGet('/api/v1/questions?assessmentType='+type+'&includeInactive=1')`, key `['admin-question-set', type]` -- editor read surface.
- [x] `src/components/settings/question-registry/QuestionEditDialog.tsx` -- NEW: create/edit Dialog with every `Question` field + char limits + `reason` (required for structural); questionType-switching widget preview (all five widget renderings per Code Map classes); mid-form preview (section tint + StatusBadge) and Z5-context preview (gapLabel title, gapMeaning + recommendation detail, severity Badge); frozen banner per I/O matrix; duplicate-key inline error; on success invalidates `['admin-question-set', type]` + `['question-set', type]` -- the editor itself.
- [x] `src/components/settings/question-registry/QuestionRegistryEditor.tsx` -- NEW: per-type Tabs, search + questionType filter, section-grouped table (order, label, key read-only, GAP/CONTEXT chip, severity chip, inverted, active state), actions edit/duplicate/deactivate(reason AlertDialog)/audit; up/down reorder with reason prompt (POST `/reorder`); section create/retitle/reorder via `/api/v1/admin/sections*`; >12 active GAP soft-cap warn banner; Export button (blob download of `/export` JSON) -- admin list surface.
- [x] `src/components/settings/question-registry/QuestionAuditTimeline.tsx` -- NEW Dialog: timeline rows (action, actor, actedAt, reason, before/after diff of `previous`→`changes` keys) fed by the audit route -- accountability view.
- [x] `src/app/(auth)/admin/settings/questions/page.tsx` -- NEW page: `RoleBasedRoute requiredRole="ADMIN"` + `QuestionRegistryEditor` -- route surface.
- [x] `src/components/settings/question-registry/GapSeverityTable.tsx` -- NEW: replicate deleted GapFieldTable UX on the registry — rows = active GAP questions (read via `GET /api/v1/questions`), columns [checkbox | label(+key) | gapLabel | current severity | new severity Select | row-save]; staged `pendingChanges`, bulk select+apply, pending banner with Cancel/Save All; severity change opens AlertDialog quoting impact count then `apiPatch('/api/v1/admin/questions/'+id+'/severity', {severity, reason})`; every other field read-only, no structural controls -- coordinator severity page body.
- [x] `src/app/(auth)/coordinator/settings/gap-field-management/page.tsx` -- NEW page (same route as deleted): `RoleBasedRoute requiredRoles={['COORDINATOR','ADMIN']}`; header + severity explainer card + per-type Tabs (HEALTH/FOOD/WASH/SHELTER/SECURITY; suppress types with zero GAP questions) mounting `GapSeverityTable` -- closes the p1 deletion window.
- [x] `src/components/layouts/Navigation.tsx`, `src/lib/auth/route-config.ts`, `src/components/shared/Breadcrumbs.tsx` -- register admin "Question Registry" nav item under admin settings, coordinator "Gap Severity" under Configuration, accessible-path + breadcrumb entries -- discoverability/guard wiring.
- [x] `tests/api/question-registry-admin-ui.test.ts` -- NEW: impact count 0 and >0 (ACTIVE incident + snapshot fixture), audit returns entries with actor/reason, ASSESSOR 403 on both routes, COORDINATOR 403 on audit + on PUT field edit (regression) -- API gates for the new surfaces.
- [x] `tests/unit/components/QuestionEditDialog.test.tsx`, `tests/unit/components/GapSeverityTable.test.tsx` -- NEW: frozen 409 renders banner with count + reason field; duplicate 409 keeps dialog with key error; success invalidates `['question-set', type]`; Z5 preview shows gapLabel/gapMeaning; severity table renders GAP-only rows, confirm dialog quotes impact, Save All PATCHes each pending row -- component coverage per prompt §4.

**Acceptance Criteria:**
- Given an admin edits a question label, when the save succeeds, then the p4 dynamic form reflects it on next fetch (cache invalidated), and an audit row with reason exists.
- Given a question whose key is in an ACTIVE incident snapshot, when a structural edit is submitted, then the dialog shows the frozen banner with the affected count and the reason field, and never mutates the key.
- Given a coordinator on the severity page, when changing a severity and confirming, then the dialog quoted the pre-count and the PATCH's server count appears in the toast; the coordinator receives 403 on every non-severity registry surface.
- Given a type has >12 active GAP questions, then the editor list shows the soft-cap warning (never blocks).

## Design Notes

- `gapMeaning` is not rendered by today's Z5 card (it feeds the engine); the editor's Z5-context preview shows it as detail so authors see the standalone sentence — intentional, per plan §5 (Appendix B audiences).
- Severity pre-confirm needs a pre-commit count → that is why `impact` exists; the PATCH response count is the authoritative post-count for the toast.
- Frozen banner "Create with new key" = duplicate flow prefilled + reason carried (Tier C: deactivate-old waits for incident close; create-new is Tier A).

## Verification

**Commands:**
- `npm run lint` -- 0 new issues vs baseline
- `npm run type-check` -- clean
- `npm run test:unit` -- all green incl. new component suites
- `npm run db:push:test && npm run test:api` -- all green incl. new route suite
- `npm run test:baseline:e2e` -- green (unchanged selectors)

**Manual checks (if no CLI):**
- Screenshots via dev server: `_bmad-output/implementation-artifacts/dqr-p8-editor.png`, `dqr-p8-severity.png`, `dqr-p8-frozen-banner.png`.

## Implementation Notes

- Delivered as planned; no service/schema/migration changes (p2 APIs only).
- Impact route widened to COORDINATOR per matrix row 4 (severity pre-confirm); audit stays ADMIN-only and PUT stays 403 for COORDINATOR (regression-tested).
- Accepted deviations: (a) an assessment type with zero GAP questions renders an empty-state alert on the severity page instead of a fully suppressed tab (equivalent guard, simpler); (b) severity PATCH sends `{severity}` only — `reason` is optional per `SeverityPatchSchema`.
- Bug found & fixed during unit-test pass: `QuestionEditDialog.buildDefaultValues` routed `duplicate` through the edit branch, dropping the `${key}New` prefill.
- Gates (all green): `npm run lint` (0 new issues — 1 pre-existing warning in untouched `src/utils/export/gapAnalysisCsv.ts`), `npm run type-check`, `npm run test:unit` (20 suites / 368 tests), `npm run db:push:test` + `npm run test:api` (17 suites / 199 tests), `npm run test:baseline:e2e` (9 passed).
- Evidence screenshots (dev server, seeded dev DB — frozen banner triggered by the VERIFIED HEALTH snapshot under ACTIVE incident `incident-flood-001`): `dqr-p8-editor.png`, `dqr-p8-frozen-banner.png`, `dqr-p8-severity.png`.

## Spec Change Log

## Review Triage Log
