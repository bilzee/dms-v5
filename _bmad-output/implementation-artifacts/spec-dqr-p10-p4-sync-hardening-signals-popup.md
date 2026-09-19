---
title: 'DQR P10-4 — Offline Sync Hardening, Commitment Donor Signal, Registry Gap Popup'
type: 'bugfix'
created: '2026-09-19'
status: 'in-progress'
route: 'dispatch'
baseline_commit: '047d67ca64fd609bc05ebf2d791b6f067c7cb450'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/spec-dqr-p10-deferred-work-consolidation.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Plan §5 (Phase 4) + §6 (Phase 5) deferred defects: offline replay can store unflagged unparseable MULTI_SELECT strings, a missing `incidentId` silently writes an entity id into the incident column, the offline update producer enqueues the wrong id (update branch unreachable), re-pointed entityId/incidentId bypass assignment checks online and offline, `CommitmentService.createCommitment` passes a Donor org id where the signal engine expects a recipient USER id (donor branch FK-fails and kills later responder rows), and `IndividualEntityGapInfoPopup.tsx:22-183` is a hardcoded field/explanation map that drifts from the registry.

**Approach:** Land the six fixes from the P10 plan §5/§6: shared/exported multi-select normalization with a stored gapAnalysis flag; per-entry conflict (never batch 4xx) for missing incidentId; producer enqueues the assessment row id; a shared `assertAssignmentForTargets` authorizer on both update paths (403 online / per-entry conflict offline); donor→linked-user resolution at signal dispatch (skip+log when unlinked); popup fields rendered from the registry `questionMetadata` projection.

## Boundaries & Constraints

**Always:** `/sync/batch` never rejects a completed assessment — every new enforcement is a per-entry conflict/flag, batch stays 200/207; unparseable multi-select strings persist verbatim; gapAnalysis additions are additive keys written only when non-empty (mirror the P10-2 `crossFieldViolations` pattern); existing update ownership semantics (assessor-own) unchanged; full gate chain green before commit.

**Never:** no Prisma schema changes; no queue transport/retry changes; no signal-engine changes beyond the donor branch payload; no CI/e2e DB separation (prompt 5); no catalog polish; popup presentation config (title/icon/colors) stays static — only the field/explanation list becomes registry-driven.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| 4a parseable replay | answers `{k: '["Malaria"]'}`, k is MULTI_SELECT | stored `answers.k === ["Malaria"]` | N/A |
| 4a unparseable replay | answers `{k: 'garbage{'}`, k is MULTI_SELECT | stored verbatim `'garbage{'` + `gapAnalysis.answerNormalizationFlags` names k | N/A |
| 4b missing incidentId | offline create change, `data.incidentId` absent | per-entry `status:'conflict'` + SyncConflict row; no assessment row; batch 200/207 | never-reject preserved |
| 4c offline update | producer `updateAssessment(id, …)` offline → queue → batch | consumer resolves row by `entityUuid` = row id; row updated; `status:'success'` | N/A |
| 4d online re-point denied | assessor PUT with new entityId they have no assignment/role for | 403 via existing 'authorized' message mapping | N/A |
| 4d offline re-point denied | update change re-pointing entityId/incidentId, syncing user unassigned to target | per-entry `status:'conflict'` + SyncConflict row; row untouched | never-reject preserved |
| 5a linked donor | donor.contactEmail = user.email | dispatch carries that user id; donor-branch signal row generated for the linked user | N/A |
| 5a unlinked donor | no user matches donor (email/org/name/username) | donor branch skipped with a log; responder rows unaffected | N/A |
| 5b popup | registry adds a GAP question (e.g. `p10tX`) | popup renders it (name=label, description=gapMeaning) without code changes | no `questions` prop → neutral fallback text, never stale hardcoded copy |

</frozen-after-approval>

## Code Map

- `src/lib/questions/offline-answers.ts` -- private `normalizeMultiSelect` (L90-103) + `ingestOfflineAnswers` (L110-149) already normalize MULTI_SELECT replays; export shared `normalizeAnswerValues(answers, questionTypes)` returning `{ answers, unparsedKeys }`; `ingestOfflineAnswers` refactors onto it.
- `src/lib/services/rapid-assessment.service.ts` -- `createOfflineAssessment` L295-414 + `updateOfflineAssessment` L422-527 store `storedGapAnalysis` (additive `crossFieldViolations` pattern at L355-356/483-484 — extend for normalization flags); online `update` L691-779 (select lacks `entityId`; incident re-point guard at L722-727 is the place to add the entity/incident re-point authorizer).
- `src/lib/services/sync-processing.service.ts` -- create branch `incidentId: (data.incidentId as string) || change.entityUuid` at L118-119 (drop incidentId fallback; keep entityId fallback); update branch L140-211 (both answers path L159-191 and raw path L193-203 need the re-point authorizer → conflict); `handleConflict` L445-464 is the SyncConflict machinery to reuse.
- `src/lib/services/assessment-offline.service.ts` -- `updateAssessment` L99-109 enqueues `entityId` in the `entityUuid` slot (`syncEngine.addToQueue(type, action, entityUuid, data, priority)` — engine signature at `src/lib/sync/engine.ts:529`); switch slot to row `id`, keep `entityId` in the payload.
- `src/lib/services/entity-assignment.service.ts` -- home for the shared authorizer; `EntityAssignment` rows are the assignment source (`prisma.entityAssignment.findFirst({userId, entityId})` pattern at rapid-assessment.service.ts:950-962); roles via `userRole` join (`Role.name`, roles 'COORDINATOR'/'ADMIN' bypass).
- `src/app/api/v1/rapid-assessments/[id]/route.ts` -- PUT L83-162 maps messages containing 'authorized' → 403 (L146-158); service-thrown Error is the 403 channel.
- `src/lib/services/commitment.service.ts` -- `createCommitment` L176-219, dispatch at L205-216 passes `donorId: data.donorId` (Donor org id). Donor model has NO userId FK; the only donor→user linkage is the `users/me/donor` heuristic (`src/app/api/v1/users/me/donor/route.ts:48-80`: contactEmail → organization → name → username) — reuse it in reverse.
- `src/lib/services/action-signal.service.ts` -- `handleCommitmentTrigger` L328-496 consumes `payload.donorId` as recipient USER id (upsertSignal L436-451 FK-fails on non-user ids; loops are sequential, no per-iteration catch → later responder rows die). Engine untouched except receiving a correct/absent donorId.
- `src/components/dashboards/situation/components/IndividualEntityGapInfoPopup.tsx` -- hardcoded `assessmentConfig.fields` L22-183; field grid render L400-411; only consumer `EntityAssessmentPanel.tsx` (render L474-477; has `questionMetadata` at L142 with per-type `.questions`).
- `src/lib/questions/gap-summary.ts` -- `SummaryQuestionMeta` L39-48 (`key,label,gapLabel,gapMeaning,category,questionType,order`) — the projection type the popup will consume (filter `category==='GAP'`).
- Tests: `tests/api/offline-sync.test.ts` (batch route pattern, `postBatch` helper), `tests/factories/index.ts` (`createUser/createDonor/createEntityAssignment/createEntity/createIncident`), `tests/helpers/api.ts` (`makeRequest`, `tokenFor`), `tests/unit/offline-answers.test.ts`, `tests/unit/components/AssessmentCategorySummary.test.tsx` (RTL pattern).

## Tasks & Acceptance

**Execution:**
- [x] `src/lib/questions/offline-answers.ts` -- export `normalizeAnswerValues(answers, questionTypes: ReadonlyMap<string,string>)` → `{ answers, unparsedKeys }`; refactor `ingestOfflineAnswers` onto it (4a).
- [x] `src/lib/services/rapid-assessment.service.ts` -- createOffline/updateOffline: store `answerNormalizationFlags` (key+message list) into gapAnalysis only when `unparsedKeys` non-empty (4a); online `update`: add `entityId` to the existing select; when payload re-points entityId/incidentId, run the shared authorizer before proceeding (4d).
- [x] `src/lib/services/entity-assignment.service.ts` -- add `assertAssignmentForTargets(userId, { entityId?, incidentId? })`: COORDINATOR/ADMIN pass; otherwise a provided entityId requires an EntityAssignment row; throws Error('Not authorized to …') (4d).
- [x] `src/lib/services/sync-processing.service.ts` -- create: absent `data.incidentId` → SyncConflict row + per-entry conflict, no row written (4b); update branch (both paths): re-point check via authorizer → per-entry conflict on denial (4d).
- [x] `src/lib/services/assessment-offline.service.ts` -- `updateAssessment` enqueues the assessment row id in the entityUuid slot; entityId stays in the payload (4c).
- [x] `src/app/api/v1/sync/batch/route.ts` -- exempt assessment-`update` changes from the batch entity-uuid gate: since 4c their entityUuid slot carries the assessment ROW id, not an entity uuid; authorization is enforced per-entry downstream (owner guard + re-point authorizer → conflict, never a batch 4xx). Discovered during test wiring — without this, producer-shaped updates 403 at the route and the update branch stays unreachable.
- [x] `src/lib/services/commitment.service.ts` -- add `resolveDonorLinkedUserId(donorId)` (email→org→name→username, mirroring users/me/donor); `createCommitment` passes the linked user id or omits donorId with a skip log (5a).
- [x] `src/components/dashboards/situation/components/IndividualEntityGapInfoPopup.tsx` + `EntityAssessmentPanel.tsx` -- delete hardcoded fields; popup gains `questions?: SummaryQuestionMeta[]`, renders GAP entries (name=label, description=gapMeaning→gapLabel fallback); panel passes `questionMetadata?.HEALTH?.questions`; empty/missing → neutral fallback line (5b).
- [x] `tests/unit/offline-answers.test.ts` -- extend: normalizeAnswerValues matrix (parseable/unparseable/non-multi passthrough) (4a).
- [x] `tests/unit/components/IndividualEntityGapInfoPopup.test.tsx` -- new: registry fixture incl. a new GAP question renders name+description; CONTEXT questions excluded; empty metadata fallback (5b).
- [x] `tests/api/sync-hardening.test.ts` -- new: 4a flag via real batch create; 4b conflict (no row, SyncConflict recorded, batch 200); 4c update branch end-to-end via producer-shaped change; 4d offline re-point conflict (4a/4b/4c/4d).
- [x] `tests/api/rapid-assessment-update-authz.test.ts` -- new: online PUT re-point → 403 (no assignment) / 200 (assignment or COORDINATOR) (4d).
- [x] `tests/api/commitment-donor-signal.test.ts` -- new: linked donor → donor-branch signal row for linked user + responder rows survive; unlinked donor → no crash (5a).
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- mark the six entries RESOLVED with evidence (P4 replay; P5 incidentId, producer row-id, re-validation; P6 donorId; P7 popup).
- [x] Evidence: `_bmad-output/implementation-artifacts/dqr-p10-4-sync-hardening.log` (api/unit transcripts incl. conflict entries + authorizer paths) + `dqr-p10-4-gap-popup.png`.

**Acceptance Criteria:**
- Given a batch containing a missing-incidentId create AND a valid create, when processed, then the batch response is 200 (or 207) with one per-entry conflict and one success — never a batch-level 4xx/5xx.
- Given an offline update change keyed by an existing assessment row id with answers, when synced by the owning assessor, then the row's answers/gapAnalysis/versionNumber update and the result is success.
- Given a donor whose contactEmail matches a user, when `createCommitment` runs, when the evaluator's donor branch executes (PARTIAL path), then an ActionSignal row exists for the linked user id.
- Given the registry projection for a type, when the popup opens, then every GAP question with label/gapMeaning renders in the field grid and no hardcoded field copy remains in the component.
- Given the full gate chain, when run, then lint/type-check/unit/db:push:test/api/baseline-e2e/build all pass.

## Implementation Notes

- Donor linkage: the plan's `donor.userId` FK does not exist; the `users/me/donor` heuristic is the app's only donor→user linkage — reused in reverse (documented in the service comment).
- Authorizer incident semantics: `Incident` has no entity relation in the schema; the entity gate keys off `entityId` (callers pass `input.entityId ?? existing.entityId`). `incidentId` is still a trigger for the re-point check.
- 4a "transport boundary": `processAssessment`'s per-change delegation into `createOfflineAssessment`/`updateOfflineAssessment` IS the ingest boundary; normalization is single-sourced in `normalizeAnswerValues` (idempotent) rather than duplicated in sync-processing.
- Popup: the popup's static educational sections (severity hierarchy, colors, process, benefits) are generic help copy, not per-field data — untouched. Visual parity target is layout parity with `dqr-p7-dashboard.png`.
- Route gate (4c wiring): `POST /api/v1/sync/batch` authorizes each change's `entityUuid` against the caller's assigned entities. Post-4c the producer enqueues the assessment ROW id in that slot, which would 403 every real update at the route. Assessment-`update` changes are therefore exempt from the uuid gate; the consumer owns their authorization (assessor-own guard → failed entry; re-point target authorizer → per-entry conflict). Create/delete/entity changes keep the original gate (P5's pinned 403 test uses a create).

## Spec Change Log

## Review Triage Log

## Verification

**Commands:**
- `npx jest --config jest.api.config.js tests/api/sync-hardening.test.ts tests/api/rapid-assessment-update-authz.test.ts tests/api/commitment-donor-signal.test.ts --collectCoverage=false` -- expected: all green
- `npx jest tests/unit/offline-answers.test.ts tests/unit/components/IndividualEntityGapInfoPopup.test.tsx --collectCoverage=false` -- expected: all green
- `npm run lint && npm run type-check && npm run test:unit && npm run db:push:test && npm run test:api && npm run test:baseline:e2e && npm run build` -- expected: full chain green
