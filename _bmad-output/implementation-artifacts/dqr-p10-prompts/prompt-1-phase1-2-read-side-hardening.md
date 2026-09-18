# DQR P10 — Prompt 1 of 5: Snapshot-Hydrated Read Side + Registry Hardening (Phases 1–2)

Activate `@.claude/skills/bmad-build/SKILL.md` and treat this document as the intent. Do not skip workflow steps. Read `_bmad-output/implementation-artifacts/spec-dqr-p10-deferred-work-consolidation.md` §1–§3 and §8 fully first (the plan is the authority where this prompt is silent) and verify every cited claim by reading the code (line numbers drift).

## Program context (applies to all 5 prompts)

Branch: **`dynamic-question-registry`**. Working dir: repo root. Evidence artifacts → `_bmad-output/implementation-artifacts/` with a `dqr-p10-<N>-` prefix; commit at the end of each prompt. Authority chain: the P10 plan first; `_bmad-output/implementation-artifacts/dynamic-question-registry-prompts/HANDOFF.md` for P1–P9 state.

Full gate chain (every prompt, plan §8): `npm run lint && npm run type-check && npm run test:unit && npm run db:push:test && npm run test:api && npm run test:baseline:e2e && npm run build`.

Binding rulings carried from P1–P9: offline `/sync/batch` **never rejects** a completed assessment (new enforcement lands as per-entry conflict/flag, never a batch 4xx/5xx); severity is a derivation rule; per-question freeze; dual version counters; snapshots structure-only; **baseline parity is the bar, not zero**.

## Sequence context

Prompt 1 of 5 — the opener; no P10 predecessors. Prerequisite state (confirm via git log + spot-check before starting): DQR P1–P9 shipped on this branch (`b8ccfd2`…`3bc753b`), all gates green. If missing, stop and reconcile before proceeding.

**Why this prompt exists:** Phase 1 is the only user-visible correctness bug — Situation Dashboard CONTEXT values render "N/A" for admin-authored post-seed keys (`fromAnswers` iterates the static `QUESTION_CATALOG`; ledger OPEN, browser-confirmed 2026-09-17). Phase 2 is low-risk hardening of P3 residue. Both stabilize the read side before the Phase 3 schema migration.

## Scope

### 1. Hydration helper (plan §2)

- New pure helper `hydrateFromSnapshot(structure, answers)` in `src/lib/questions/answers.ts`: emit typed values for **every** key in the snapshot's sections (NUMBER → number, BOOLEAN → boolean, MULTI_SELECT → `coerceArray`, SINGLE_CHOICE/TEXT* → string); keys in neither snapshot nor catalog fall back to raw answer values, labeled `source: 'unmapped'` (mirrors gap-engine drift semantics).
- `fromAnswers(type, answers)` becomes a thin wrapper over `hydrateFromSnapshot(activeRegistryStructure, answers)` — identical output for catalog keys (parity), post-seed keys now included.

### 2. Situation route + drift rendering (plan §2)

- `getLatestHealthAssessment` and the other per-type latest readers in `src/app/api/v1/dashboard/situation/route.ts` hydrate from the assessment row's stored `questionSnapshot` (registry ladder for labels), not the live catalog — historical rows render their answered values even after drift. `formatContextValue` unchanged.
- Assessment edit/view pages: snapshot keys missing from the live registry view render read-only from the snapshot; no live validation on unmappable keys.

### 3. Per-entry cache TTL (plan §3 2a)

`gap-analysis.service.ts` (~L74-77, 151-156): replace the global `registryViewCacheTimestamp` with `Map<AssessmentType, { view, expiresAt }>`; entries expire independently. Unit: type A's stale entry expires while type B's fresh survives.

### 4. `recomputeAssessmentsForKey` tx scaling (plan §3 2b)

`question-registry.service.ts` (~L879-925): candidate scan **outside** the interactive transaction (plain `prisma` read; recompute idempotent), re-verify affectedness inside the tx (`questionSnapshot: { not: undefined }` + key-containment post-filter), rewrite in committed chunks of 200 with the existing per-row derive. Document the idempotency argument in a service comment. Api test unchanged (behavior-identical).

### 5. Seed derivation assertions (plan §3 2d)

Extend `tests/api/seed-partition.test.ts`: after the `--with-sample-data` run, assert the seeded demo assessments' stored `gapAnalysis.severity`/`priority` match the expected derivation matrix (≥1 CRITICAL, ≥1 HIGH, ≥1 MEDIUM per the seed's fixtures) — an argument swap in `prisma/seed.ts` derivation wiring must fail.

### 6. Tests + ledger

Unit: parity fixtures for all 6 question types + post-seed `p9t*` keys hydrate. Api: HEALTH latest payload contains `p9tPatientsPerDay` value, not N/A. Component + e2e: legacy assessment drift renders read-only. Ledger `_bmad-output/implementation-artifacts/deferred-work.md`: mark the P4 `fromAnswers` entry + the P3 cache/tx-scaling/seed-derivation entries **RESOLVED** with evidence (keep bullet format). The P3 docs entry stays open — it closes with the §4.25 docs pass in prompt 2 (single docs pass, plan §3 2c).

## Out of scope

No snapshot format change, no version bumps — read-side only (plan §2 Non-goals). Cross-field rules (prompts 2–3); offline/signal fixes (prompt 4); CI/catalog/handoff (prompt 5).

## Verification gates

1. Full gate chain green (Phase 2 items behavior-identical: api/e2e suites unchanged).
2. New unit/api/component/e2e suites green; evidence → `dqr-p10-1-context-evidence.log` (hydrated api payload snippet) and `dqr-p10-1-hardening.log` (cache-TTL + seed-derivation runs).
3. Ledger entries RESOLVED per Scope 6.
4. Commit: `feat(questions): snapshot-hydrated read side and registry hardening`.
