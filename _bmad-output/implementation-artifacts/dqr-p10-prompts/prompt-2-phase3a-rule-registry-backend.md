# DQR P10 — Prompt 2 of 5: Cross-Field Rule Registry — Backend: Schema, Seed, Engine, Governance API (Phase 3, part 1)

Activate `@.claude/skills/bmad-build/SKILL.md` and treat this document as the intent. Do not skip workflow steps. Read `_bmad-output/implementation-artifacts/spec-dqr-p10-deferred-work-consolidation.md` §4.1–§4.4 and §8 fully first (the plan is the authority where this prompt is silent; §4.1 schema and §4.3 parity map are verbatim-binding) and verify every cited claim by reading the code (line numbers drift).

## Program context (applies to all 5 prompts)

Branch: **`dynamic-question-registry`**. Working dir: repo root. Evidence artifacts → `_bmad-output/implementation-artifacts/` with a `dqr-p10-<N>-` prefix; commit at the end of each prompt. Authority chain: the P10 plan first; `_bmad-output/implementation-artifacts/dynamic-question-registry-prompts/HANDOFF.md` for P1–P9 state.

Full gate chain (every prompt, plan §8): `npm run lint && npm run type-check && npm run test:unit && npm run db:push:test && npm run test:api && npm run test:baseline:e2e && npm run build`.

Binding rulings carried from P1–P9: offline `/sync/batch` **never rejects** a completed assessment (exemptions land as per-entry conflict/flag, never a batch 4xx/5xx); severity is a derivation rule; per-question freeze; dual version counters; snapshots structure-only; **baseline parity is the bar, not zero**.

## Sequence context

Prompt 2 of 5 — the plan's centerpiece begins. Completed so far (confirm commit + spot-check before starting): **p10-1** snapshot-hydrated read side (`hydrateFromSnapshot`, stored-snapshot situation hydration, read-only drift rendering) + registry hardening (per-type cache TTL, tx scaling, seed-derivation assertions). If missing, stop and reconcile before proceeding.

**Why this prompt exists:** the 15 cross-field rules (12 refinement predicates + 3 live aggregates) are hardcoded in `src/lib/questions/cross-field-rules.ts` — a client island outside the registry (P4 ledger decision). This prompt ships the full backend: data model, seeded parity, evaluation engine, governed CRUD, and server-side enforcement. The legacy module stays alive until prompt 3's parity gate.

## Scope

### 1. Schema + migration (plan §4.1 verbatim)

`prisma/schema.prisma`: add `CrossFieldRule` exactly as specified (id, assessmentType, ruleKey immutable kebab-case, kind `'REFINEMENT'|'AGGREGATE'`, name, message with `{{...}}` tokens, when?, expression, referenceKeys Json, isActive, order, timestamps; `@@unique([assessmentType, ruleKey])`, `@@index([assessmentType, isActive])`, `@@map("cross_field_rules")`). Audit reuses `QuestionAuditLog` with `entityType: 'RULE'`. Version semantics: rule mutations bump the type's `structureVersion`; `contentVersion` untouched. Rules are **not** per-question freeze-gated.

### 2. Seed rows (plan §4.3 parity map)

15 rows in `prisma/seed.ts`, **both partitions** (registry baseline like the 55 questions; `--with-sample-data` branch untouched): POPULATION 8 refinements + 3 aggregates, FOOD 2, WASH 1, SHELTER 1 — expressions exactly per the parity map. Partition test updated: `crossFieldRule.count() === 15` default, unchanged by `--with-sample-data`.

### 3. Rule engine (plan §4.2)

New `src/lib/questions/rule-engine.ts`: JSON AST (Operand `question|sum|literal`; Compare `> >= < <= == !=`; BoolGate `{questionKey, is}`; Rule `{when?, violationWhen}`); pure evaluator `evaluateRules(rules, values)` → `CrossFieldViolation[]` (same interface as today: `key`, `message`, `kind`; deterministic order = rule `order`); non-number coercion via the same `num()` semantics as the legacy module (0 default) so parity is exact; message tokens `{{value:key}}` / `{{sum:k1,k2}}`; shared zod AST schema (the admin UI in prompt 3 imports it — no duplicate schema). Unit matrix: every operator, gates, sums, coercion, tokens, order.

### 4. Golden parity harness (precondition for prompt 3)

Fixtures per assessment type — violating, boundary, clean — through BOTH legacy `evaluateCrossFieldRules` and registry-seeded `evaluateRules`; assert identical violation arrays. Legacy module NOT deleted in this prompt.

### 5. Service CRUD + invariants (plan §4.4)

`QuestionRegistryService`: rule create/update/deactivate — reference-keys validated against the type's active questions; expression validated against the shared zod schema; `ruleKey` immutable (400 `rule_key_immutable`); audit rows (`entityType: 'RULE'`); mutations bump `structureVersion`; rule cache invalidation hooks `invalidateRegistryCaches`; **deactivation guard**: a question cannot be deactivated while an active rule references its key (400 `registry_invalid` listing the rules) in the existing invariant block; `/admin/questions/{id}/impact` lists referencing rules. Deactivating the last active REFINEMENT of a type is allowed (validation optional by design).

### 6. API surface + enforcement (plan §4.4)

- `GET /api/v1/questions?assessmentType=…` gains `rules: RegistryRule[]` (active, ordered); `includeInactive=1` returns all.
- `POST /api/v1/admin/rules` (ADMIN, `reason` required); `PUT /api/v1/admin/rules/{id}` (bumps `structureVersion`); `DELETE /api/v1/admin/rules/{id}` (soft-deactivate, `reason`); `GET /api/v1/admin/rules/{id}/audit`.
- `POST /rapid-assessments` and `/submit` evaluate active REFINEMENT rules server-side → 400 with `details[]` per violation. AGGREGATE rules stay client-live-only. **Offline `POST /sync/batch` replay is exempt** (never-reject): violations on replayed rows become informational flags on the stored `gapAnalysis`, never blocking.

### 7. Docs + tests + ledger

- `docs/api-contracts.md` §4.25: rule endpoints + shapes, `/questions` extension, enforcement semantics, sync exemption; fold in the severity PATCH response shape `{ data: { question, affectedCount, affectedIncidentIds } }` (completes plan §3 2c) → ledger P3 docs entry RESOLVED.
- Api tests: CRUD lifecycle (governance 403s, reason requirement, immutability, audit, version bump); enforcement 400s; replay exemption; deactivation guard + impact listing.

## Out of scope

Admin authoring UI and legacy cutover (prompt 3); offline/signal fixes (prompt 4).

## Verification gates

1. Full gate chain green; partition test asserts 15 rules both partitions.
2. Rule-engine unit matrix + golden parity harness + rule-api suites green; evidence → `dqr-p10-2-parity-matrix.log` and `dqr-p10-2-rules-api.log`.
3. `cross-field-rules.ts` still present, still powering the live form; docs entry closed.
4. Commit: `feat(questions): cross-field rule registry backend — schema, engine, governance API`.
