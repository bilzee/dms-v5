---
title: 'DQR P10-5 — Phase 6: CI database separation, Tier A catalog polish, holistic close'
type: 'chore'
created: '2026-09-19'
status: 'ready-for-dev'
route: 'dispatch'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The e2e baseline suite and the Jest API suite share `drms_test`, so `test:api` and `test:baseline:e2e` cannot run concurrently (each truncates/reseeds under the other); the seeded catalog carries 8 label-register wording defects that a deliberate Tier A pass through the governed admin path should fix; and the deferred-work ledger plus HANDOFF.md need the final P10 close (evidence, gate tables, deferrals).

**Approach:** Give e2e a dedicated database (`drms_e2e` on the same localhost:5435 instance) selected via `E2E_DATABASE_URL` with a rollback-safe fallback to `drms_test`; exercise 8 Tier A label edits through the governed admin API (contentVersion bumps + audit rows), then fold the identical wording into `QUESTION_CATALOG` so re-seed reproduces it; sweep the ledger (mark RESOLVED entries closed with evidence), extend HANDOFF.md with the P10 section, run all gates including a concurrent api+e2e run and a round-trip re-seed, and land two commits (A: chore, B: docs).

## Boundaries & Constraints

**Always:**
- Offline `/sync/batch` never rejects (P1 invariant, untouched).
- Option `value` strings are frozen byte-identical — stored-answer compatibility; only labels normalize.
- Zero behavioral effect from catalog polish: api/unit/e2e suites green before and after; derivation matrix unchanged.
- Every governed edit carries a `reason` and produces a contentVersion bump + `QuestionAuditLog` row.
- Catalog polish lands in `QUESTION_CATALOG` in the same PR as the governed edits (plan §9 Phase 6b mitigation).
- Evidence artifacts prefixed `dqr-p10-5-` under `_bmad-output/implementation-artifacts/`.
- Rollback-safe: with `E2E_DATABASE_URL` absent, e2e behaves exactly as today (drms_test, sequential scripts still work).

**Never:**
- No severity changes (severity-spread widening is an honest deferral — it would break the zero-behavioral gate and `seed-partition` derivation matrix).
- No structural (Tier B) changes: no question add/remove, no section moves, no option value edits.
- No code changes beyond this scope; real gaps go to HANDOFF deferrals, not stealth fixes.
- The 8 post-plan ledger entries (2026-09-18/19 P10-1..P10-4 review groups) are NOT falsely closed — they stay open as documented deferrals routed to future passes.
- No second postgres instance/service is introduced (same instance, second database).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Concurrent gates | `E2E_DATABASE_URL=...drms_e2e` set; api suite on drms_test; both launched simultaneously | Both suites green; no cross-truncation | N/A |
| Env var absent (rollback) | No `E2E_DATABASE_URL` | e2e targets drms_test; existing sequential scripts unchanged | N/A |
| Guard — wrong DB | DATABASE_URL lacking `drms_test`/`drms_e2e` in e2e global-setup | Loud throw before any DB write | Fail fast with clear message |
| Round-trip | Fresh `db:push:e2e` + seed into drms_e2e | Polished labels present; contentVersion=1 on fresh seed (folded catalog = new baseline) | N/A |
| Governed edit on frozen question | PUT to a question frozen by an in-flight assessment | 409 from existing governance | N/A |

</frozen-after-approval>

## Code Map

- `playwright.baseline.config.ts` -- webServer env: `DATABASE_URL: process.env.E2E_DATABASE_URL ?? <drms_test default>`
- `tests/e2e-baseline/global-setup.ts` -- env guard must accept `drms_e2e` in addition to `drms_test`
- `package.json` -- add `db:push:e2e` (cross-env DATABASE_URL=...drms_e2e prisma db push --skip-generate)
- `src/lib/questions/registry-validation.ts` -- `QUESTION_CATALOG`: fold the 8 polished label strings
- `prisma/seed-questions.ts` -- reconciliation reference (no edit; drift-diff drives the round-trip proof)
- `_bmad-output/implementation-artifacts/deferred-work.md` -- ledger sweep (RESOLVED markers + evidence lines)
- `_bmad-output/implementation-artifacts/dynamic-question-registry-prompts/HANDOFF.md` -- append P10 section
- `docs/development-guide.md` -- §6 Testing: document e2e DB separation + concurrency recipe
- `docs/operation-manual-ui.html` -- untracked orphan (ledger P10-1): delete
- `src/lib/validation/questions.ts` -- pre-existing uncommitted local diff, carries into Commit A as-is

## Tasks & Acceptance

**Execution:**
- [ ] `playwright.baseline.config.ts` + `tests/e2e-baseline/global-setup.ts` -- e2e DB selection via `E2E_DATABASE_URL`, guard widened to `drms_test|drms_e2e` -- Part A separation
- [ ] `package.json` -- add `db:push:e2e` -- one-command drms_e2e provisioning
- [ ] `docs/development-guide.md` -- document the separation, concurrent-run recipe, rollback note -- README-equivalent test docs
- [ ] Governed Tier A exercise (drms_test, dev server :3101): login admin, 8 PUTs with reasons → `dqr-p10-5-catalog-polish.log` -- exercise the production path, not a seed edit
- [ ] `src/lib/questions/registry-validation.ts` -- fold the 8 labels into `QUESTION_CATALOG` -- re-seed reproduces polish (plan §9)
- [ ] `deferred-work.md` -- mark P4 test-DB + P9 catalog entries RESOLVED; annotate the 8 post-plan entries as open deferrals → `dqr-p10-5-ledger-sweep.log`
- [ ] Delete `docs/operation-manual-ui.html`; commit `src/lib/validation/questions.ts` as-is -- ledger P10-1 hygiene
- [ ] `HANDOFF.md` -- append "P10 — Deferred-Work Consolidation": prompts→commits table, state delta, gate results, rulings→code additions, deploy notes delta, deferrals remaining -- Part C close
- [ ] Run full gate chain + concurrent api+e2e (`dqr-p10-5-concurrent-gates.log`) + round-trip verify (`dqr-p10-5-roundtrip.log`) -- all four prompt gates

**Acceptance Criteria:**
- Given `E2E_DATABASE_URL` targeting drms_e2e, when api and baseline-e2e run concurrently, then both are green in one transcript.
- Given the folded catalog, when a fresh drms_e2e is pushed and seeded, then the 8 polished labels are present.
- Given the ledger after sweep, when scanning DQR entries 2026-09-15→2026-09-17, then all carry RESOLVED with evidence; post-plan entries remain honestly open.
- Given all gates green, when committing, then Commit A = `chore(test): e2e database separation and catalog polish`, Commit B = `docs(questions): DQR P10 handoff and holistic close`.

The 8-edit polish set (labels only; Appendix A noun-phrase register):
| Question / Option | From | To |
|---|---|---|
| FOOD:isFoodSufficient | Food Sufficient | Sufficient Food |
| FOOD:hasInfantNutrition | Infant Nutrition Available | Available Infant Nutrition |
| WASH:isWaterSufficient | Water Sufficient | Sufficient Water |
| WASH:areLatrinesSufficient | Latrines Sufficient | Sufficient Latrines |
| WASH:hasHandwashingFacilities | Handwashing Facilities Available | Available Handwashing Facilities |
| SHELTER:areSheltersSufficient | Shelters Sufficient | Sufficient Shelters |
| SECURITY:vulnerableGroupsHaveAccess | Vulnerable Groups Have Access | Vulnerable Groups Access |
| WASH:waterSource option label (value frozen) | River/Stream | River / Stream |

## Implementation Notes

User's standing instruction "Accept the spec that will be created" resolves all Open Questions at planning time:
1. Normalization contract = option VALUES frozen, labels normalized (stored-answer safety).
2. E2E DB = second database `drms_e2e` on the existing localhost:5435 instance (no second service).
3. Ledger reconciliation = close the prompt's sweep set (09-15→09-17 + P10-1 orphan/prompt-mix); 8 post-plan entries stay open as documented deferrals (out-of-scope clause).
4. Severity-spread widening excluded (zero-behavioral gate wins); recorded as an honest deferral in HANDOFF.

## Spec Change Log

## Review Triage Log

## Verification

**Commands:**
- `npm run lint && npm run type-check && npm run test:unit && npm run db:push:test && npm run test:api && npm run test:baseline:e2e && npm run build` -- expected: all green
- Concurrent: api suite and `E2E_DATABASE_URL=...drms_e2e npm run test:baseline:e2e` launched together -- expected: both green in `dqr-p10-5-concurrent-gates.log`
- `npm run db:push:e2e` + fresh seed into drms_e2e -- expected: polished labels present, `dqr-p10-5-roundtrip.log`
