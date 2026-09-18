# DQR P10 — Prompt 4 of 5: Offline Sync Hardening + Commitment Signal + Registry Gap Popup (Phases 4–5)

Activate `@.claude/skills/bmad-build/SKILL.md` and treat this document as the intent. Do not skip workflow steps. Read `_bmad-output/implementation-artifacts/spec-dqr-p10-deferred-work-consolidation.md` §5, §6 and §8 fully first (the plan is the authority where this prompt is silent) and verify every cited claim by reading the code (line numbers drift).

## Program context (applies to all 5 prompts)

Branch: **`dynamic-question-registry`**. Working dir: repo root. Evidence artifacts → `_bmad-output/implementation-artifacts/` with a `dqr-p10-<N>-` prefix; commit at the end of each prompt. Authority chain: the P10 plan first; `_bmad-output/implementation-artifacts/dynamic-question-registry-prompts/HANDOFF.md` for P1–P9 state.

Full gate chain (every prompt, plan §8): `npm run lint && npm run type-check && npm run test:unit && npm run db:push:test && npm run test:api && npm run test:baseline:e2e && npm run build`.

Binding rulings carried from P1–P9: offline `/sync/batch` **never rejects** a completed assessment — every enforcement in this prompt lands as a per-entry conflict/flag, never a batch 4xx/5xx; severity is a derivation rule; per-question freeze; dual version counters; snapshots structure-only; **baseline parity is the bar, not zero**.

## Sequence context

Prompt 4 of 5 — the post-registry fix sweep. Completed so far (confirm commits + spot-check before starting): **p10-1** snapshot read side + hardening (`hydrateFromSnapshot` reused below); **p10-2/3** cross-field rule registry complete (backend + admin UI; legacy module deleted, form payload-driven; rule replay exemption in `/sync/batch` is live — build on it, don't regress it). If missing, stop and reconcile before proceeding.

**Why this prompt exists:** Phase 4 — replayed multi-selects can arrive as JSON strings, a missing `incidentId` silently stores an entity id in the incident column, the offline update branch is unreachable from its producer, and re-pointed ids bypass assignment checks. Phase 5 — a donor-branch signal FK-fails silently killing later rows (P6), and the gap popup is a hardcoded drift island (P7).

## Scope — Part A: offline sync hardening (plan §5)

### 1. Replay normalization — P4 multi-select strings (4a)

At the transport boundary in `sync-processing.service.ts` (per-queued-change ingest): run answers through shared `normalizeAnswerValues(questionTypes)` that `JSON.parse`s string-encoded arrays for MULTI_SELECT keys (using the snapshot's question types; same `coerceArray` semantics as the live form). Unparseable strings persist verbatim (never-reject) and are flagged in the stored `gapAnalysis` drift report. Unit: `"[\"Malaria\"]"` → `["Malaria"]`; garbage → verbatim + flag.

### 2. `incidentId` fallback — P5 (4b)

`sync-processing.service.ts` (~L118-119): drop `|| change.entityUuid`. If `data.incidentId` is absent, reject that change as a **per-entry sync conflict** (existing conflict machinery; batch never throws); write no row.

### 3. Update producer row-id — P5 (4c)

`assessment-offline.service.ts` update path (~L99-109): enqueue the **assessment row id** in the slot the consumer resolves via `findUnique({ where: { id: change.entityUuid } })`; keep entityId in the payload for reference. Add a sync api test driving the update branch end-to-end (currently unreachable — hence untested).

### 4. Sync authorization pass — P5 (4d)

Shared authorizer `assertAssignmentForTargets(userId, { entityId?, incidentId? })` on BOTH the online `PUT /rapid-assessments/{id}` and the offline update branch: if the payload re-points entityId/incidentId, the syncing user must hold a COORDINATOR/ADMIN role or an active entity assignment covering the new entity; otherwise 403 (online) / per-entry conflict (offline). Api tests for both paths.

## Scope — Part B: signal + popup fixes (plan §6)

### 5. Commitment donorId — P6 (5a)

`src/lib/services/commitment.service.ts` (~L212): resolve the donor's linked user id before dispatch — `prisma.donor.findUnique({ where: { id: data.donorId } }).userId` (donor→user relation already exists for `users/me/donor`). Skip the donor branch (with a log) when no linked user, so subsequent responder rows in the same evaluator run survive. Api test: commitment creation via the service path generates the donor-branch signal.

### 6. Gap popup from registry — P7 (5b)

`IndividualEntityGapInfoPopup.tsx` (~L22-183): delete the hardcoded field/explanation map; render from the registry `questionMetadata` projection (`gapLabel`/`gapMeaning` per GAP question, already exposed by the P7 summaries' live-registry projection). When the popup serves a stored assessment, reuse **p10-1's snapshot hydration** instead of the live registry. Unit: adding a GAP question via the registry makes it appear in the popup without code changes. Visual parity vs `dqr-p7-dashboard.png`; evidence → `dqr-p10-4-gap-popup.png`.

### 7. Ledger

Mark RESOLVED with evidence: P4 multi-select replay; the three P5 entries (incidentId fallback, producer keyed-by-entityId, missing re-validation); P6 commitment `donorId`; P7 gap popup.

## Out of scope

CI/e2e DB separation, catalog polish, HANDOFF (prompt 5); queue transport/retry mechanics; signal-engine changes beyond the donor branch.

## Verification gates

1. Full gate chain green.
2. New unit + api suites green; evidence → `dqr-p10-4-sync-hardening.log` (normalization transcript, conflict entries, update-branch run, 403/conflict authorizer paths) + popup png.
3. Never-reject pinned: batch responses stay 200 with per-entry conflicts.
4. Ledger: six entries RESOLVED.
5. Commit: `fix(sync): offline hardening, donor-branch signals, and registry gap popup`.
