---
title: 'DQR P6 — Notification and Signal Severity Inheritance (D-4)'
type: 'feature'
created: '2026-09-16'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: b04489215867babfb8b38abbcbd83f107256e447
context:
  - '{project-root}/docs/plans/dynamic-question-registry-plan.md'
  - '{project-root}/_bmad-output/implementation-artifacts/dynamic-question-registry-prompts/prompt-6-notification-inheritance.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Every notification row stores hardcoded `priority: 'MEDIUM'` (`action-signal.service.ts:1262`, `notification.service.ts:33`) regardless of the triggering object's severity; commitment-driven signals hardcode `'HIGH'` (:407, :432), `entity-needs-*` hardcode `'HIGH'` (:802); offline-sync response create trusts client `priority` else defaults `'MEDIUM'` (`sync-processing.service.ts:273`). The verified bottom-up severity chain (question → assessment → incident → response) breaks at its last hop.

**Approach:** Passthrough per plan §2.8 — each signal/notification inherits its triggering object's severity/priority field; system-health events (no question-derived severity) keep fixed values from ONE exported allowlist constant; offline response priority derives from the linked assessment/incident instead of client input.

## Boundaries & Constraints

**Always:**
- Signal priority sources: assessment events → `payload.assessmentPriority` (backed by `assessment.priority`); response/plan events → `payload.responsePriority ?? plan.priority`; commitment events (awaiting-plan-for-commitment, partially-fulfilled) → `incident.severity` via the commitment's incident (extend the existing `donorCommitment.findUnique` select); entity/incident-level events (entity-needs-responder/donor) → `incident.severity` (add `severity` to the activeIncidents select); absent/`UNCLASSIFIED`/invalid values → MEDIUM via one shared `resolveSeverityPriority` (type sanitation — never a replacement for an available source).
- In-app notification rows store the signal's own priority: `createNotification` gains an explicit priority parameter (no silently applied default) supplied by the `upsertSignal` caller.
- System-health boundary = one exported `SYSTEM_HEALTH_SEVERITY` allowlist: `VERIFICATION_OVERDUE: 'CRITICAL'`, `POPULATION_CADENCE: 'CRITICAL'`, `SYNC_ERROR: 'CRITICAL'` (reserved — no creation site exists yet), `ACCOUNT_NOTICE: 'MEDIUM'` (gamification/leaderboard notifications, Appendix C "account/system notices"). The 48h-overdue branches and population-cadence site read from this constant.
- Offline response create priority = linked assessment's `priority` → its incident's `severity` → resolver MEDIUM; client `data.priority` ignored (closes offline injection, mirrors p5's assessment ruling). Offline response update keeps `existing.priority` (client priority ignored).
- Gates: lint 0 new warnings vs baseline; type-check clean; unit + api suites green incl. new suites; e2e baseline 9/9.

**Never:**
- No routing-policy changes (who is notified, channels, thresholds — plan §0 Non-Goal): `shouldSendInApp/Push/Email` gates, TTL logic, templates, email-digest gate stay untouched.
- No Prisma schema changes (`Notification.priority` / `ActionSignal.priority` remain String).
- No changes to online response create/update semantics (authenticated client priority remains a legit input there), read filters (`criticalCount` :973), dashboards, or exports.
- Do not delete `derivePriorityFromIncident` / `updateSignalPriorities` (p7 dead-code sweep owns them); do not touch `tests/legacy-backup/`.
- No new endpoints, no UI.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Verified assessment fan-out | Verified assessment priority HIGH; RESPONDER + DONOR assigned | awaiting-plan & assessment-needs-response signals AND their notification rows all HIGH | evaluator try/catch unchanged |
| Unplanned commitment | Commitment, no linked plan, incident severity CRITICAL | awaiting-plan-for-commitment CRITICAL (was HIGH) | N/A |
| Partial commitment | Commitment status PARTIAL, incident severity LOW | partially-fulfilled LOW (donor + responder rows) | N/A |
| Missing responder | Entity with ≥1 submitted/verified assessment under ACTIVE incident severity MEDIUM, no RESPONDER assigned | entity-needs-responder MEDIUM (incident.severity; was HIGH) | N/A |
| Population cadence breach | Cadence metadata overdue | overdue signal CRITICAL via allowlist | N/A |
| Verification queue | SUBMITTED assessment >48h old / ≤48h old | verification-overdue CRITICAL via allowlist / assessment-awaiting-verification = assessment.priority | N/A |
| Offline response create | Client payload priority CRITICAL, linked assessment priority LOW | Created row priority LOW — client value ignored, never-reject unchanged | N/A |
| UNCLASSIFIED incident | Commitment path, incident severity UNCLASSIFIED | MEDIUM via resolver | N/A |
| Absent payload priority | Defensive: trigger payload without priority fields | MEDIUM via resolver | N/A |

</frozen-after-approval>

## Code Map

- `src/lib/severity-inheritance.ts` — NEW pure module: `SYSTEM_HEALTH_SEVERITY` allowlist const + `resolveSeverityPriority(value?: string | null): SignalPriority` (CRITICAL/HIGH/MEDIUM/LOW pass through; UNCLASSIFIED/null/undefined/invalid → MEDIUM).
- `src/lib/services/action-signal.service.ts` — rewire priority expressions at :118, :138, :192, :226, :302, :554 (source passthrough via resolver, literals die); :407, :432 (commitment → `incident.severity`; extend commitment select :339-349 with `incident: { select: { severity: true } }`); :660, :711, :733 (allowlist reads); :802 (entity-needs → `incident.severity`; add severity to activeIncidents select :751-754). `createNotification` :1238-1266 gains priority param; caller :1144 passes `data.priority`. Replace private `mapSeverityToPriority` (:1379-1387) with the shared resolver (`derivePriorityFromIncident` :1376 re-pointed; method itself stays for p7).
- `src/types/action-signal.ts` — remove `commitmentPriority` from `SignalTriggerPayload` (:117; zero dispatchers pass it — grep-verified; gap-analysis route's local `commitmentPriority` variable is unrelated).
- `src/lib/services/notification.service.ts` — legacy `send` payload gains required `priority: SignalPriority`; :33 literal removed. `src/lib/services/leaderboard.service.ts` :428, :442 pass `SYSTEM_HEALTH_SEVERITY.ACCOUNT_NOTICE`.
- `src/lib/services/sync-processing.service.ts` — `processResponse` create :273 derives priority from the linked assessment (fetch priority + incident severity whether `data.assessmentId` or entity-fallback resolves it); update :323 → `existing.priority`.
- `tests/unit/severity-source-guard.test.ts` — NEW grep-style guard (cheapest honest mechanism per prompt §4).
- `tests/api/severity-inheritance.test.ts` — NEW DB suite; reuse `tests/factories/index.ts` (`createRapidAssessment` takes `priority`; `createRapidResponse` does not — extend factory or set priority via direct testDb update), `tests/helpers/api.ts`, `ensureQuestionRegistry`.
- `scripts/dqr-p6-severity-evidence.ts` — NEW evidence scan (pattern: `scripts/dqr-p4-form-evidence.ts`, `dqr-p5-sync-evidence.ts`) → `_bmad-output/implementation-artifacts/dqr-p6-severity-sources.log`.

## Tasks & Acceptance

**Execution:**
- [x] `src/lib/severity-inheritance.ts` — NEW allowlist + resolver.
- [x] `src/lib/services/action-signal.service.ts` — all 12 priority sites rewired; `createNotification` explicit priority; commitment select + activeIncidents select extended.
- [x] `src/types/action-signal.ts` + `src/lib/services/notification.service.ts` + `src/lib/services/leaderboard.service.ts` — payload typing, explicit legacy priority.
- [x] `src/lib/services/sync-processing.service.ts` — offline response create derives from assessment/incident; update keeps existing.
- [x] `tests/unit/severity-source-guard.test.ts` — scans the writer files (action-signal, notification, leaderboard, sync-processing): every `priority:` string literal must sit inside the `SYSTEM_HEALTH_SEVERITY` block or the enumerated read-only exception list (criticalCount where-clause); fails on any new literal.
- [x] `tests/api/severity-inheritance.test.ts` — pins every I/O matrix row end-to-end (signal rows + notification rows + offline sync row).
- [x] `scripts/dqr-p6-severity-evidence.ts` → `dqr-p6-severity-sources.log` — every creation site listed with its severity source; zero hardcoded literals outside the allowlist.
- [x] Gates + commit `feat(questions): severity inheritance for notifications and signals (D-4)`.

**Acceptance Criteria:**
- Given a verified HIGH-priority assessment with assigned responder and donor, when the assessment-verified trigger fires, then awaiting-plan and assessment-needs-response signals and their notification rows all store HIGH.
- Given a commitment with no linked plan under a CRITICAL incident, when commitment-created fires, then awaiting-plan-for-commitment stores CRITICAL (PARTIAL → partially-fulfilled stores incident severity; no HIGH literal remains).
- Given an entity lacking a responder under an ACTIVE MEDIUM-severity incident holding a submitted assessment, when getActiveSignals runs for a coordinator, then entity-needs-responder stores MEDIUM.
- Given a cadence breach or >48h-old submission, when the scan runs, then the signal stores CRITICAL sourced from SYSTEM_HEALTH_SEVERITY.
- Given an offline response create carrying client priority CRITICAL linked to a LOW-priority assessment, when the batch syncs, then the created row stores LOW.
- Given the writer files, when the guard test scans them, then zero severity literals exist outside the allowlist block and the enumerated read-filter exception.
- Given the baseline suites, when all gates run, then green with 0 new lint warnings.

## Implementation Notes

- Implemented via dispatch subagent; verified against the full diff (src + tests + evidence script) by the orchestrator.
- Extra source beyond plan: `reassessment-needed` now falls back to `verifiedResponse?.priority` (field added to its select) before the resolver floor — the response row is the triggering object.
- Offline create derivation skips `UNCLASSIFIED` assessment priority and falls to the incident's severity; offline update keeps `existing.priority` verbatim.
- `mapSeverityToPriority` (private) was subsumed by the shared `resolveSeverityPriority`; `derivePriorityFromIncident` re-pointed but retained for p7 deletion.
- Gates re-run by orchestrator after implementation: lint 0 new (only pre-existing `src/utils/export/gapAnalysisCsv.ts:233` warning); type-check clean; unit 15 suites/316 tests; api 14 suites/184 tests (incl. 9 new matrix tests); e2e baseline 9/9; evidence scan ALL CHECKS PASSED (18 creation sites enumerated).
- Pre-existing bug found, NOT fixed (out of scope — flag for p7): `src/lib/services/commitment.service.ts:212` dispatches `donorId: data.donorId` (Donor organization id) where the signal engine consumes `payload.donorId` as a recipient user id — the donor branch of commitment signals FK-fails silently and kills subsequent responder rows in the same evaluator run. The real API surface (`donors/[id]/commitments/route.ts:326`) passes a user id correctly.
- Commit subject corrected to the mandated `feat(questions): severity inheritance for notifications and signals (D-4)` (subagent had used a `feat(dqr-p6)` subject).

### Review patches (pass 1 — applied by orchestrator)

- **Escalation refresh (finding 3):** `upsertSignal` update branch now rewrites the signal's notification rows (`notification.updateMany` keyed on `signalId`) whenever `priorityChanged` — an escalated re-derivation no longer leaves stale notification priorities. The new escalation test then exposed a pre-existing latent flaw: on re-verify, `resolveSignalsForReason` resolves the old row first, and `upsertSignal`'s existence lookup (filtered `resolvedAt: null`) could no longer see it, so the `create` hit the P2002 unique index `(user_id, entity_id, incident_id, type, signalReason)` and the evaluator's catch silently dropped the escalated signal entirely. Fix: the lookup no longer filters `resolvedAt: null` — the update branch (which already writes `resolvedAt: null`) now implements the documented upsert/reactivation contract; resolve-then-re-trigger reuses and escalates the same row instead of losing it.
- **Fallback semantics (finding 9):** `payload.responsePriority ?? response?.priority` → `||` at the three response-priority sites, restoring empty-string fallback to the stored row priority.
- **Guard strength (findings 1+4):** unit guard + evidence script sweeps broadened from `priority:` bindings to ANY quoted severity literal (bindings, assignments, ternaries, returns) with an enumerated 10-line read-only/dead-code exception list (criticalCount where-clause, finalCritical filter, 4 priorityRank case labels, email-digest gate, dead `derivePriorityFromIncident` POPULATION return, `updateSignalPriorities` validation, sync `!== 'UNCLASSIFIED'` check). Stale-exception verbatim check forces re-review when lines drift.
- **Writer discovery (finding 2):** both guard and script now walk `src/` asserting notification/actionSignal creation sites exist only in the two allowed writer files.
- **Script robustness (findings 7+8):** allowlist check enforces exact keys AND values; unbalanced-paren scan failures now record a FAIL instead of silently truncating.
- **Test discrimination (finding 6):** matrix 4 incident severity MEDIUM → HIGH (distinguishes `incident.severity` passthrough from the resolver's MEDIUM floor).
- **Fixture hygiene (finding 10):** matrices 2/8 no longer pass the Donor org id as `payload.donorId`.
- **New coverage (finding 5):** fallback-path test — offline response create WITHOUT `assessmentId` derives the entity's latest assessment priority (CRITICAL), client 'LOW' ignored. Escalation-refresh test added alongside.
- Gates re-run after patches: lint 0 new (pre-existing `gapAnalysisCsv.ts` warnings only); type-check clean; unit 15 suites/317 tests; api 14 suites/186 tests (11 in this suite); e2e baseline 9/9; evidence scan ALL CHECKS PASSED (18 sites, 10 enumerated read-only exceptions, writer discovery clean).

## Spec Change Log

## Review Triage Log

Review pass 1 (3 layers: blind-hunter, edge-case-hunter, verification-gap). Verdicts with evidence:

| # | Verdict | Finding | Evidence |
|---|---------|---------|----------|
| 1 | medium | Guard test sweeps only `priority:` bindings; assignment/ternary-form literals (incl. the exact pre-change ternary pattern) evade it; the strong assignment sweep lives only in the ungated manual script (blind B1+B2, edge E3, verif-gap V2 — pre-verified) | Regexes read; `const priority = reason === 'x' ? 'CRITICAL' : ...` matches neither |
| 2 | medium | WRITER_FILES is a closed list; no assertion that notification/signal creation sites exist only in the enumerated writer files (blind B5) | Only 2 `.create` sites exist repo-wide; nothing enforces the negative space |
| 3 | medium | Escalated existing signal's notification rows keep stale priority — upsertSignal update branch rewrites signal priority but not its notification rows (edge E2) | `upsertSignal` :1099-1106; reachable via re-verify after priority re-derivation; notification rows now carry meaningful priority (this story) |
| 4 | medium | Dead `derivePriorityFromIncident` still returns literal `'CRITICAL'` for POPULATION outside the allowlist — contradicts the "zero literals outside allowlist" gate claim; both sweeps miss `return`-form literals (edge E5, claim) | `action-signal.service.ts` `if (assessmentType === 'POPULATION') return 'CRITICAL';`; helper is dead (p7 deletes) but lives in a scanned writer file |
| 5 | medium | Offline response-create derivation unpinned on the entity-fallback path (no `assessmentId`); matrix 7 always passes explicit id (verif-gap V1 — pre-verified) | Repo search: no active test creates an offline response without `assessmentId`; comment claims both paths work |
| 6 | medium | Matrix 4 pins entity-needs-responder at incident MEDIUM — indistinguishable from the resolver's MEDIUM floor; a regression to `resolveSeverityPriority(null)` passes (blind B8) | Incident severity MEDIUM = floor value; only pin of the entity-needs family |
| 7 | low | Evidence script allowlist check uses `includes` per entry while its message says "exactly"; a 5th entry would pass the script (blind B3) | Unit guard's `toEqual` enforces exactness; script is supplementary evidence |
| 8 | low | `extractCallBlocks` silently truncates on unbalanced parens — subsequent creation sites vanish from the audit while it still prints PASSED (blind B4, edge E4) | `openIdx/closeIdx === -1` paths `break` without recording failure |
| 9 | low | `payload.responsePriority ?? response?.priority` lets empty string mask a stored priority (`''` → MEDIUM floor); old code used `\|\|` (edge E1+E6) | `'' ?? x` = `''`; unreachable today (enum-validated sources) but regressed fallback semantics |
| 10 | low | Matrices 2/8 pass Donor org id as `payload.donorId` — replicating the known id-conflation bug in fixtures; donor-recipient row untested (blind B9) | Harmless in the unplanned branch (donorId unused); misleading fixture hygiene |
| 11 | false | "Effective routing changed": LOW signals now create no in-app notification rows; CRITICAL fires push/email (blind B7) | Channel gates + config untouched; they always keyed on signal priority; row-absence for LOW signals pre-existed for inherited sites — the outcome IS the specified passthrough; pinning channel behavior is plan §0 Non-Goal |
| 12 | false | Spec-vs-code: frozen `payload.responsePriority ?? plan.priority` vs code `response?.priority` (blind B12) | The `RapidResponse` row IS the response plan; code preserved the pre-diff source expression verbatim |
| 13 | false | Spec Code Map stale: `createRapidResponse` already takes `priority` (blind B11) | factories:354 `priority?: string` belongs to `CreateActionSignalOptions`; `createRapidResponse` (factories:311) has no priority option — Code Map accurate; fix would also edit the spec |
| 14 | low (rejected) | No behavioral test for the gamification path (blind B6) | Runtime output identical (`'MEDIUM'` constant); required payload field is compile-enforced; frozen matrix deliberately scoped to the 9 rows |
| 15 | low (rejected) | Offline sync drops client priority without warning (blind B10) | Assessment warnings cover registry drift only — no priority-warning symmetry exists; divergence rare (UI auto-copies priority); fix adds new behavior beyond a direct correction |
| 16 | low (rejected) | `VALID_PRIORITIES` decoupled from the `SignalPriority` union (blind B13) | Requires a future union extension nothing plans; enhancement, not correction |
| 17 | low (rejected) | Matrix 1 registry mutation without restore (blind B14) | Every api suite truncates + reseeds in beforeAll/afterAll (lifecycle covers it); same pattern as existing question-registry suites |
| 18 | low (rejected) | Evidence log can go stale — no npm script/CI hook (blind B15) | p4/p5 sequence convention: evidence scripts manual, enforcement lives in the gated unit test |
| 19 | defer | `commitment.service.ts:212` dispatches Donor org id as `payload.donorId` (recipient user id) — donor-branch commitment signals FK-fail silently, killing responder rows in the same run (verif-gap Other, subagent risk 1) | Pre-existing, not caused by this story; p7 sweep |

Rejected on their refutations: #11, #12, #13. Low-rejection rule applied: #14-#18. Survivors grouped by root cause → patches: findings 1+4 (enforcement strength/exceptions), 2 (discovery), 3 (escalation refresh), 5 (fallback-path pin), 6 (discriminating fixture), 7+8 (script robustness), 9 (`??`→`||`), 10 (fixture hygiene). Defer: #19. No intent_gap, no bad_spec → no loopback.

## Design Notes

- `resolveSeverityPriority` is type sanitation, not severity invention: sources are checked first; the MEDIUM floor only applies to absent/UNCLASSIFIED/invalid input — mirroring p5's "never silently LOW" ladder.
- `entity-needs-*` inherit `incident.severity` per §2.8 row "Entity/incident-level events"; gamification notifications are Appendix C "account/system notices" → ACCOUNT_NOTICE. Both plan-settled, recorded here as decisions.
- `SYNC_ERROR` is reserved in the allowlist for boundary auditability — no sync-error notification writer exists today (only failed SyncResult rows + `SyncConflict.coordinatorNotified` flags).

## Verification

**Commands:**
- `npm run lint` — expected: 0 new warnings/errors vs baseline.
- `npm run type-check` — expected: clean.
- `npm run test:unit` — expected: green incl. new guard suite.
- `npm run db:push:test && npm run test:api` — expected: green incl. new inheritance suite (drms_test @ :5435).
- `npm run test:baseline:e2e` — expected: 9/9.
- `npx tsx scripts/dqr-p6-severity-evidence.ts > _bmad-output/implementation-artifacts/dqr-p6-severity-sources.log` — expected: ALL CHECKS PASSED.
