---
title: 'DQR P4 — Dynamic Assessment Form Replaces Hardcoded Forms'
type: 'feature'
created: '2026-09-15'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 357e5b11ecf1a970de82bc0c4e730b286491b9b5
context:
  - '{project-root}/docs/plans/dynamic-question-registry-plan.md'
  - '{project-root}/_bmad-output/implementation-artifacts/dynamic-question-registry-prompts/prompt-4-dynamic-form.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The question registry (p1–p3) is complete server-side, but assessors still use six hardcoded per-type form components submitting legacy typed payloads (`healthData`/…); the form is the product and it is not registry-driven.

**Approach:** Build one `DynamicAssessmentForm` + `useQuestionSet(type)` hook implementing plan §2.4's Layout Contract zones Z1–Z7; migrate the submission path (routes + service + validation) to answers-based payloads validated by `buildAssessmentSchema`; rewire the assessment new/edit pages; then delete the six forms, their inline schemas/options, the typed Zod schemas, and `legacy-convert.ts` (compiler-driven sweep, zero dead code).

## Boundaries & Constraints

**Always:**
- Zones in fixed order: Z1 `SectionProgress` + `StickyFormHeader` → Z2 Incident/Entity selectors → Z3 GAP sections (tinted `bg-sky-50/50 dark:bg-sky-950/20`) → Z4 CONTEXT sections → Z5 auto Risk Assessment card → Z6 GPS/Photos/Additional Details → Z7 draft + submit. Sections render sorted **GAP-category first, then `order` ASC** (decided Q1=A): HEALTH is intentionally regrouped so all GAP sections render in Z3 before CONTEXT sections in Z4; within each bucket, seed `order` rules.
- Cross-field rules (decided Q2=B): port the exact legacy refinement predicates into a client-side per-key rules module `src/lib/questions/cross-field-rules.ts` — POPULATION 7 sum-exceeds-total checks (from `PopulationAssessmentForm.tsx:24-107`; destructive alert + submit-disable preserved), FOOD 2, WASH 1, SHELTER 1 (from `src/lib/validation/rapid-assessment.ts:63-99`). Rules run as live form alerts and submit-time validation (zod superRefine over the built schema); the server enforces registry schema only (accepted parity loss, noted). Extract predicates BEFORE deleting the legacy files.
- `data-testid = kebabCase(questionKey)` on every widget — must reproduce today's hand-written ids exactly (`hasFunctionalClinic` → `has-functional-clinic`); root testid `${assessmentType.toLowerCase()}-assessment-form`; submit/save buttons keep `submit-assessment-button` / `save-draft-button`.
- Widget matrix: BOOLEAN+GAP → bordered checkbox item + live `StatusBadge`, 2-col grid; BOOLEAN+CONTEXT → same, no badge; NUMBER → `Input` 2-col; SINGLE_CHOICE → `Select` full width; MULTI_SELECT → `TagPillSelect` full width; TEXT_LONG → `Textarea min-h-[100px]` full width. `placeholder` rendered only if a question carries one (registry has no such column today).
- Per-question gating: untouched question = no badge and NEVER a gap; touched GAP question shows StatusBadge (GAP/NO_GAP, inverted-aware). Sticky header counts confirmed gaps only; Z5 renders only when some GAP question is touched AND confirmed gaps > 0. Z5 is a client-side preview computed with the pure `analyzeGaps` engine (fetched set + live values); server derivation remains the truth.
- POPULATION (types with zero GAP questions): no gap badge/chip, no Z3/Z5; header receives `hasInteracted=false`. Client sends no `priority` — server derives (p3).
- Answers payload contract: create/edit submit `{ type, rapidAssessmentDate, assessorName, location?, coordinates?, mediaAttachments?, entityId, incidentId, answers }`; `answers` = `{[questionKey]: boolean|number|string|string[]}` validated against the CURRENT registry snapshot via `buildAssessmentSchema` on client and server (unknown keys stripped; required enforced); `priority` removed from create/update input schemas.
- Every successful create/update freezes a fresh snapshot + versions and re-derives gaps/priority (existing p1–p3 service behavior, rewired input only). `assessorName` auto-attribution via `getCurrentUserName()` preserved; edit page stays REJECTED-only, locks incident/entity, resubmits with `verificationStatus: 'SUBMITTED'`.
- Draft autosave: 30 s interval while dirty + manual Save Draft + "Draft saved successfully" flash + draft count, storing the raw answers map in the existing `useRapidAssessmentDrafts` localStorage hook; no restore-on-mount (parity; migration is p5).
- Create submits through `assessmentOfflineService.createAssessment` (offline queue preserved); edit through `apiPut`.
- Read-side normalizer survives relocation byte-identical: `fromAnswers` + answer/snapshot types + `buildQuestionSnapshot` move to pure modules (`src/lib/questions/answers.ts`, `src/lib/questions/question-snapshot.ts`); only the write-path bridge `toAnswers` is deleted with its tests. All 12+ read-side importers (dashboard situation, donors routes, incident/export services, detail page, SignalDetailPanel) get mechanical import updates with no behavior change.

**Never:** no Prisma schema/migrations; no offline never-reject sync semantics, draft migration, staleness banners, or change receipts (p5); no notification/signal changes (p6); no dashboard rendering changes (p7); no admin editor UI (p8); no docs/api-contract updates (p9); no e2e corpus rewrite beyond keeping baseline suites green (p9 owns `tests/e2e/`); no new registry columns.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| HEALTH happy path submit | all GAP booleans answered true, required context filled | POST 201; `answers` stored; snapshot+versions frozen; derived priority LOW (no gaps) | N/A |
| Confirmed gap preview | `hasFunctionalClinic=false` touched | StatusBadge GAP on question; header count 1; Z5 card lists gapLabel/severity/recommendation from engine rows | N/A |
| Untouched GAP question | never interacted | No badge; not counted; not a gap anywhere | N/A |
| POPULATION submit | numbers filled | No gap UI anywhere; server derives LOW | N/A |
| Server rejects unknown key | answers contains key not in registry | Stripped by schema before storage | 422 only if required key missing/invalid |
| Missing required answer | GAP boolean absent | Client blocks submit (zod), server 422 with field errors | Inline form errors |
| Edit REJECTED assessment | stored answers hydrate form; entity/incident locked | PUT resubmits answers + `verificationStatus: SUBMITTED`; new snapshot frozen | N/A |
| Edit non-REJECTED | GET [id] verificationStatus ≠ REJECTED | Page shows error, no form | N/A |
| Question set fetch | GET /api/questions?assessmentType=HEALTH | Sections+questions normalized to snapshot-style naming (`key`/`type`, options parsed) | Loading state; error surfaces |
| Cross-field violation | POPULATION segments sum > total; FOOD sufficient but additional persons > 0 | Destructive inline alert on the field + submit disabled (client-side rules module) | Direct API calls bypass rules (server accepts) — accepted |
| Legacy payload posted | `healthData: {...}` after migration | 422 — typed-payload schemas deleted | N/A |

</frozen-after-approval>

## Code Map

- `src/components/forms/assessment/{Health,Population,Food,WASH,Shelter,Security}AssessmentForm.tsx` + `index.ts` — DELETE; design language to transcribe (Health L331-645: tint, checkbox item, StatusBadge gating, Risk card; Population L297-306: gap suppression; Security L258: inverted badge).
- `src/components/shared/{StatusBadge,StickyFormHeader,SectionProgress,TagPillSelect,IncidentSelector,EntitySelector,GPSCapture,MediaField,FormActionBar}.tsx`, `src/hooks/useRapidAssessmentDrafts.ts`, `src/utils/assessment-utils.ts` — generic building blocks to reuse unchanged.
- `src/app/api/v1/questions/route.ts` + `src/lib/services/question-registry.service.ts:165-273` — GET returns raw Prisma rows (`questionKey`/`questionType`/`sectionKey`, `severity`, options Json) + `structureVersion`/`contentVersion`, ordered by order; 30 s cache.
- `src/lib/validation/dynamic-assessment.ts` — `buildAssessmentSchema`/`QuestionOptionSchema` (currently unwired; first production consumer).
- `src/lib/questions/gap-engine.ts` — PURE engine; client-importable for Z5 preview; registry row input `{questionKey, severity}` matches GET response.
- `src/lib/questions/legacy-convert.ts` — split: `buildQuestionSnapshot`+snapshot types+`RegistryQuestionRow` → NEW `src/lib/questions/question-snapshot.ts`; `AnswerValue`/`RapidAssessmentAnswers`/`RapidAssessmentType`/`questionKeysForType`/`fromAnswers` → NEW `src/lib/questions/answers.ts`; DELETE `toAnswers` + file.
- `src/lib/validation/rapid-assessment.ts` — DELETE per-type schemas + Create/Update unions; keep base (minus `priority`) + `QueryRapidAssessmentSchema`; add `answers: z.record(z.unknown())` create/update inputs.
- `src/lib/services/rapid-assessment.service.ts` — create L95-184 / update ~L412 / `findTypedPayload` L224: replace typed-payload extraction + `toAnswers` with server-side `buildAssessmentSchema(snapshot)` validation of `answers`; delete typed helpers L51-92.
- `src/app/api/v1/rapid-assessments/route.ts`, `[id]/route.ts`, `user/[userId]/route.ts` — rewire to answers-based schemas.
- Read-side importers of `fromAnswers` (mechanical path updates only): `dashboard/situation/route.ts` (6 sites), 6 donors routes, `entities/[id]/assessments/latest`, `incident.service.ts:328,336`, `assessment-export.service.ts:31`, `SignalDetailPanel.tsx:254`, `registry-versions.ts:12`, assessor `[id]/page.tsx` + `[id]/edit/page.tsx`.
- Form consumers to rewire: `(auth)/assessor/rapid-assessments/new/page.tsx` (submit handler L138-185, priority default L150 dies), `[id]/edit/page.tsx` (hydration L91-110 via `fromAnswers` dies → raw answers), `rapid-assessments/new/page.tsx` (secondary route, baseline e2e hits it).
- `src/types/rapid-assessment.ts` — delete `*FormProps`/`BaseAssessmentFormProps`; keep read-shape interfaces still cast by situation/donors routes.
- Tests: `tests/unit/legacy-convert.test.ts` (split/move), `question-snapshot.test.ts` (import path), `validation-schemas.test.ts` (rewrite to answers schemas), `tests/factories/index.ts:16,242,256` (direct answers fixtures), API suites `assessment-verify-cascade.test.ts`, `authz-matrix.test.ts:101`, `foundation.test.ts:119-121` (answers payloads). Baseline e2e pins only `new-assessment-button`, `/rapid-assessments/new` heading. RTL pattern: `tests/templates/unit-component.template.test.tsx`.
- Evidence precedent: `scripts/dqr-p2-api-evidence.ts`, `scripts/dqr-p3-recompute-evidence.ts` (tsx + route handlers + drms_test).

## Tasks & Acceptance

**Execution:**
- [x] `src/hooks/useQuestionSet.ts` — NEW: React Query `useQuery(['question-set', type])` via `apiGet('/api/v1/questions?assessmentType=')`; normalize rows to snapshot-style defs (`key`/`type`, options as `QuestionOption[]`); expose `{ sections, questions, structureVersion, contentVersion, isLoading, error }`.
- [x] `src/components/forms/assessment/DynamicAssessmentForm.tsx` — NEW: Z1–Z7 renderer per Boundaries; react-hook-form + zodResolver(base + `buildAssessmentSchema`); kebabCase testid helper; inverted-aware StatusBadge; engine-driven Z5; draft autosave (30 s) + manual save + flash; GPS/Media/Additional Details from shared components; submit payload per contract; props: `assessmentType, entityId?, incidentId?, initialAnswers?, lockIncidentEntity?, readonlyFields, isReassessment?, previousAssessmentDate?, onSubmit, onCancel`.
- [x] `src/lib/validation/rapid-assessment.ts` + `src/lib/services/rapid-assessment.service.ts` + the three rapid-assessments routes — answers-based create/update (validate answers against fresh snapshot server-side, strip unknown, freeze snapshot, derive via existing engine); `priority` input removed; delete typed payload helpers + `findTypedPayload` if unreferenced.
- [x] `src/lib/questions/{answers,question-snapshot}.ts` — NEW split of `legacy-convert.ts`; DELETE `legacy-convert.ts` + `toAnswers`; mechanical import sweep of all Code-Map importers.
- [x] Rewire `(auth)/assessor/rapid-assessments/new/page.tsx`, `[id]/edit/page.tsx`, `rapid-assessments/new/page.tsx` — DynamicAssessmentForm; edit hydrates from stored `answers` (REJECTED-only guard, locked selectors, resubmit flow); delete per-type switches, `assessmentTypes` payload nesting, and client `priority` default.
- [x] DELETE the six form components + `index.ts` barrel + inline schemas/options; delete per-type Zod schemas and `*FormProps` types; compiler-driven sweep to zero dead code.
- [x] `src/lib/questions/cross-field-rules.ts` — NEW: per-type predicate module (POPULATION 7, FOOD 2, WASH 1, SHELTER 1) extracted from the legacy files before deletion; wired into the form as live destructive alerts + submit-time superRefine.
- [x] Tests: NEW `tests/unit/dynamic-assessment-form.test.tsx` (widget per questionType incl. inverted badge, untouched=neutral gating, GAP-first category ordering, POPULATION suppression, cross-field alert, testid parity spot-checks); NEW `tests/unit/cross-field-rules.test.ts`; NEW/updated `tests/unit/answers.test.ts` + `question-snapshot.test.ts` imports; rewrite `validation-schemas.test.ts`; update factories + API suites to answers payloads; delete `toAnswers` tests.
- [x] Evidence: `scripts/dqr-p4-form-evidence.ts` (route-handler level: create+edit+POPULATION+unknown-key-strip+legacy-422 → `dqr-p4-api-evidence.log`); screenshots `dqr-p4-form-health.png`, `dqr-p4-form-population.png` (gap tint, section ordering, Risk card, autosave indicator).
- [ ] Commit: `feat(questions): dynamic assessment form replaces hardcoded forms`.

**Acceptance Criteria:**
- Given the seeded registry, when HEALTH and POPULATION assessments are created through the new form payload, then both persist with frozen snapshots, derived gapAnalysis/priority, and POPULATION derives LOW with no gap UI.
- Given an assessment with `hasFunctionalClinic=false`, when the question is touched, then the question shows a GAP badge, the sticky header counts 1 confirmed gap, and Z5 renders the engine preview; untouched questions never contribute.
- Given any legacy typed payload (`healthData` etc.), when POSTed, then the API rejects it (422) — the legacy layer is gone.
- Given the baseline suites, when `npm run test:baseline:all` runs, then all green with zero new lint/type failures plus the new suites passing.

## Implementation Notes

- Implemented on branch `dynamic-question-registry` (single prompt commit; verification fixes folded in before commit).
- Step-03 matrix audit found the legacy-payload rejection returned 400 (repo ZodError convention) where the frozen matrix pinned 422 — fixed the code, not the tests: explicit route-level guards in POST `/api/v1/rapid-assessments` and PUT `/api/v1/assessments/[id]` via `findLegacySectorPayloadKey` (fires only when `answers` is absent, so junk keys alongside a valid payload still strip). Evidence script check 2 and a new verify-cascade API test updated to match the matrix.
- `SectionViolations` renders duplicate-key violations (refinement + aggregate both attach to e.g. `populationMale`) with a `-N` testid suffix so index 0 keeps the plain kebab testid (Playwright strict-mode safe).
- Form suite location: `tests/unit/components/DynamicAssessmentForm.test.tsx` (25 tests) — overrides the global `react-hook-form` and `ui/input` stubs from `tests/setup.ts` with the real/event-faithful implementations; includes the POPULATION context-only suppression describe and the SINGLE_CHOICE describe. API edit flow pinned in `tests/api/assessment-edit.test.ts` (step-04).
- Live screenshots taken against `npm run dev` (:3008) as `assessor@test.com` against the seeded dev DB: HEALTH shows GAP-first sections, GAP/NO_GAP badges on touched questions, header gap count, Risk Assessment card (MEDIUM + recommendation); POPULATION shows all-CONTEXT sections with zero gap chrome while demographics render from the registry.

## Spec Change Log

## Review Triage Log

Step-04 (loop 1, 2026-09-15). Three layers (blind-hunter, edge-case, verification-gap) over the 447 kB diff vs baseline `357e5b1`. Every finding verified at its cited location before ruling. No intent_gap, no bad_spec → no loopback; patches applied in-build and re-verified.

| # | Finding (layer) | Verdict | Disposition |
|---|---|---|---|
| M1 / BH-8enforce | Server rejected cross-field-invalid answers on direct API calls (matrix L52 pins "server accepts") | medium | **patch** — service `validateAnswersAgainstSnapshot` now compiles `buildAssessmentSchema` alone (no `crossFieldSuperRefine`); cross-field stays client-side only (Q2=B + deferred-work entry); form keeps its own superRefine; transport `compileAnswersSchema` deleted |
| VN | Service update bumped `versionNumber` (p1–p3 parity: update never touched it) | medium | **patch** — `versionNumber: { increment: 1 }` removed; evidence check 4 flipped to "preserves versionNumber" |
| M2 | Late-arriving `initialAnswers` (reassessment prefill resolves post-mount) never hydrated | medium | **patch** — effect resets defaults + touched-keys when the prop changes and the form is pristine |
| BH-10 / date | `new Date(dateOnly).toISOString()` UTC-drifts the submitted timestamp | low | **patch** — `toDateIsoTimestamp` pins local midnight (legacy display parity) |
| L2 | Submit enabled with no entity/incident selected | low | **patch** — `submitDisabled` includes `!selectedEntity \|\| !selectedIncident` |
| L3 | Save Draft enabled while pristine | low | **patch** — `disabled={isSubmitting \|\| !dirty}` + unit pin |
| L1 / BH-5 | Widget testids: TagPillSelect ignored its testid; legacy `additional-details` id not reproducible | low | **patch** — TagPillSelect accepts/forwards `data-testid`; `LEGACY_TESTID_OVERRIDES` preserves `additionalHealthDetails` → `additional-details`; unit pins |
| L4 | NUMBER schema lacked legacy `.int()` | low | **patch** — `z.number().int()` in `buildQuestionFieldSchema` + float-rejection pin |
| L5 | Sections with zero active questions still rendered | low | **patch** — loader filters `section.questions.length > 0` |
| L6 | Dead export `getAssessmentLocationData` (zero callers post-sweep) | low | **patch** — deleted from `src/utils/assessment-utils.ts` |
| BH-3 | PUT legacy-payload guard returned a bare json envelope while POST used `errorResponse` | low | **patch** — PUT guard now `errorResponse(..., 422)`; API test pins the envelope |
| VG-1 | PUT REJECTED→resubmit flow had no jest coverage (evidence script only) | gap | **patch** — new `tests/api/assessment-edit.test.ts` (replace/strip/re-freeze/priority/versionNumber/stamps/422/403) |
| VG-2 / BH-13 | Form suite fixture had no SINGLE_CHOICE question (Select branch untested) | gap | **patch** — `primaryWaterSource` added to WASH fixture + 3 tests (renders, blocks submit, payload); event-faithful select mock |
| BH-1 / M3 / EC-M3 | Untouched GAP booleans submit as `false` and derive gaps | low | **reject** — frozen matrix mandates 422 for an absent GAP boolean, so `false` is the only legal wire value; legacy forms submitted identical false-defaults; fix would edit the frozen spec |
| BH-2 | Edit page discards the original assessment date | false | **reject** — legacy edit hydration was typed-payload-only (no date/GPS/media); the dynamic form defaults today exactly like the legacy forms did |
| BH-7 | Edits validate against the CURRENT registry, not the row's snapshot | medium | **reject** — frozen boundary L31/L32 mandates CURRENT-registry validation ("rewired input only") |
| BH-9 | (misread contract re answers transport) | false | **reject** — refuted at cited lines; shape-only transport + service-boundary compile is the documented design |
| BH-11cb | `onCancel` callback-half claim | low | **reject** — frozen props list is fixed; only the optional-cancel parity matters and is covered |
| BH-12 | Per-type chrome (TYPE_CHROME) retained despite "one form" | low | **reject** — migration intent removes the hardcoded question forms, not type chrome; spec pins icon/title/submit label per type |
| EC-L7 | Legacy guard bypassed by sending `answers: {}` alongside typed junk | low | **reject** — documented by-design: guard fires only when `answers` is absent; `{}` then 422s in registry validation |
| EC-L8 | Registry content drift mid-form (versions move between GET and submit) | low | **reject** — pre-live niche; snapshot re-freeze + version stamps already surface drift server-side |
| BH-6 | Stale offline queues may replay multi-selects as JSON strings | medium | **defer** — p5 offline replay owns serialization normalization (deferred-work) |
| BH-14 | `fromAnswers` read side is catalog-bound → renamed keys render blanks on old rows | low | **defer** — p7/p9 read-side snapshot rendering (deferred-work) |
| VG-O1 | jest API suites and Playwright baseline share `drms_test` (concurrent runs collide) | low | **defer** — CI pipeline setup must serialize/isolate (deferred-work) |
| counts | Prior P4 deferred entry said "11 predicates (POPULATION 7)" | low | **patch** — corrected to 12 (POPULATION 8) in deferred-work.md |

## Design Notes

- API naming mismatch is resolved once, in `useQuestionSet`: `questionKey`→`key`, `questionType`→`type`, `sectionKey`→`key`; the normalized shape feeds `buildAssessmentSchema`, the pure engine, and the renderer. Edit mode reuses the same live-registry rendering; stored `answers` only hydrate values (snapshot stays server-side truth for historical rendering).
- Z5 preview calls `analyzeGaps(normalizedSections, values, questions.map(q => ({questionKey: q.key, severity: q.severity})))` — severity from the same GET response, so preview matches server derivation for the same versions.
- Option pills under MULTI_SELECT do NOT reproduce legacy per-option testids (`health-issue-diarrhea`) — those exist only in the non-baseline `tests/e2e` corpus (p9).
- "Human-assessor check" is satisfied by preserving `assessorName` auto-attribution (`getCurrentUserName()`) and the auth-role gates around the pages; no checkbox exists in any legacy form (verified).

## Verification

**Commands:**
- `npm run lint` — expected: 0 new warnings/errors vs baseline (36 pre-existing).
- `npm run type-check` — expected: clean (proves the deletion sweep).
- `npm run test:unit` — expected: green incl. new suites.
- `npm run db:push:test && npm run test:api` — expected: green (drms_test @ :5435).
- `npm run test:baseline:e2e` — expected: 9/9.
- `npx tsx scripts/dqr-p4-form-evidence.ts > _bmad-output/implementation-artifacts/dqr-p4-api-evidence.log` — expected: ALL CHECKS PASSED.

**Manual checks (if no CLI):**
- Screenshots show gap tint, section ordering, Risk Assessment card, draft autosave indicator for both types.
