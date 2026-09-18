# DQR P10 — Prompt 5 of 5: E2E DB Separation + Catalog Polish + Ledger Close + Holistic Handoff (Phase 6 + close)

Activate `@.claude/skills/bmad-build/SKILL.md` and treat this document as the intent. Do not skip workflow steps. Read `_bmad-output/implementation-artifacts/spec-dqr-p10-deferred-work-consolidation.md` §7, §1, §8 and §9 fully first, then read `_bmad-output/implementation-artifacts/dynamic-question-registry-prompts/HANDOFF.md` fully — it is the document this prompt extends. The plan is the authority where this prompt is silent; verify every cited claim by reading the code (line numbers drift).

## Program context (applies to all 5 prompts)

Branch: **`dynamic-question-registry`**. Working dir: repo root. Evidence artifacts → `_bmad-output/implementation-artifacts/` with a `dqr-p10-<N>-` prefix; commit at the end of each prompt. Authority chain: the P10 plan first; HANDOFF.md for P1–P9 state.

Full gate chain (every prompt, plan §8): `npm run lint && npm run type-check && npm run test:unit && npm run db:push:test && npm run test:api && npm run test:baseline:e2e && npm run build`.

Binding rulings carried from P1–P9: offline `/sync/batch` **never rejects** a completed assessment; severity is a derivation rule; per-question freeze; dual version counters; snapshots structure-only; **baseline parity is the bar, not zero**.

## Sequence context

Prompt 5 of 5 — deliberately last: catalog polish is Tier A content churn that reverts on re-seed, so it must follow every content-stable phase. All four implementation prompts must be complete (confirm commits + spot-check before starting): **p10-1** snapshot read side + hardening; **p10-2** rule registry backend; **p10-3** rule admin UI + legacy cutover; **p10-4** sync hardening + donor signal + registry gap popup. If missing, stop and reconcile before proceeding.

**Why this prompt exists:** `test:api` and e2e share `drms_test` (concurrency truncates rows under each other); the catalog's label/option-value registers need a deliberate Tier A polish; and the program's single holistic record (HANDOFF.md) must reflect the end-state — rules as data, hardened sync, separated CI.

## Scope — Part A: CI separation (plan §7 6a)

### 1. E2E database separation — P4

Give e2e its own database (`drms_e2e`, port-5436 or a second DB on the same instance): `playwright.baseline.config.ts` web-server env + `tests/helpers` e2e seed target the dedicated DB; `test:api` keeps `drms_test`. Verify `pnpm test:api` and `pnpm test:baseline:e2e` run **concurrently** — transcript → `dqr-p10-5-concurrent-gates.log`. Document in the README test section. Rollback-safe: scripts remain sequential if the env var is absent.

## Scope — Part B: catalog polish (plan §7 6b)

### 2. Deliberate Tier A authoring pass — P9

Through the **P8 admin editor UI** (not a seed edit): normalize label registers and option `value`/`label` pairs (`'River/Stream'`, `'Water trucks'`…) per `docs/question-authoring-guide.md` Appendix A; each edit bumps `contentVersion` via the governed UI with reasons — exercising the full governance path production-like. **Same PR**: fold the new wording into `QUESTION_CATALOG` (`src/lib/questions/registry-validation.ts`) so re-seed reconciliation restores the normalized text instead of reverting it. Zero behavioral effect — Tier A only; verify by unchanged api/e2e suites.

### 3. Final ledger sweep (plan §7)

Mark RESOLVED: the P4 test-DB entry and the P9 catalog entry. Sweep `_bmad-output/implementation-artifacts/deferred-work.md`: every DQR entry (2026-09-15 → 2026-09-17 groups) closed with evidence; only the 2026-06-08 Brand Customization group remains. Record → `dqr-p10-5-ledger-sweep.log`.

## Scope — Part C: holistic close

### 4. Extend HANDOFF.md

Append a **"P10 — Deferred-Work Consolidation"** section to `_bmad-output/implementation-artifacts/dynamic-question-registry-prompts/HANDOFF.md` (keep P1–P9 intact):

- **The five prompts → commits** table with one-line scope each.
- **State of the world (delta)**: `CrossFieldRule` table + seeded 15 rules; rules in `/questions` payload; admin rule editor tab; legacy `cross-field-rules.ts` deleted; snapshot-hydrated read side; sync hardening (replay normalization, incidentId strictness, producer row-id, authorizer); commitment donor fix; registry-driven gap popup; e2e on `drms_e2e`; polished catalog folded into `QUESTION_CATALOG`.
- **Gate results table**: one row per P10 prompt with evidence artifacts.
- **Ruling→code map additions**: never-reject exemptions (rule replay flags, per-entry conflicts), rule governance (ADMIN + reason + audit + `structureVersion` bump), deactivation guard, snapshot hydration.
- **Deploy notes delta**: migration + seed order for `cross_field_rules` (15 rows, both partitions); catalog re-seed restores polished wording.
- **Deferrals remaining**: confirm only the 2026-06-08 Brand group survives.

### 5. Goals → evidence + risk review

Re-read plan §1 (Goal + deferred-items map) line by line; record `file:line` (or test/log) evidence that each of the 7 deferred items is closed — or list it as an honest deferral. Re-read plan §9: for each risk row, state whether the mitigation landed and where its evidence lives.

## Out of scope

Any code change beyond fixes the holistic review exposes as gate-blocking; if a real gap surfaces, record it in HANDOFF deferrals rather than expanding scope.

## Verification gates

1. Full gate chain green, PLUS the concurrent api+e2e run green.
2. Catalog round-trip: fresh re-seed (`npx prisma db seed`) reproduces the polished wording.
3. Ledger: zero open DQR entries; HANDOFF.md P10 section complete (commits, delta, gates, rulings, deploy, deferrals, goals→evidence).
4. **Commit A: `chore(test): e2e database separation and catalog polish`**; **Commit B: `docs(questions): DQR P10 handoff and holistic close`**.
