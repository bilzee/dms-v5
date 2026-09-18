# DQR P10 — Deferred-Work Consolidation (Phased Implementation Plan)

**Date:** 2026-09-17
**Status:** Planned
**Source ledger:** `_bmad-output/implementation-artifacts/deferred-work.md` (statuses verified 2026-09-17)

---

## 1. Goal

Close the 7 remaining deferred items from the DQR program in six dependency-ordered
phases, each independently gate-able (lint → type-check → unit → api → e2e → build)
and each updating the deferral ledger on completion. The centerpiece is **Phase 3**:
a registry-backed cross-field rule engine with an **admin authoring UI integrated
into the question registry editor**, migrating the 15 hardcoded rule definitions
(12 refinement predicates + 3 live aggregates) out of
`src/lib/questions/cross-field-rules.ts` into seeded, editable registry data.

### Deferred items → phase map

| # | Deferred item (ledger group) | Phase |
|---|------------------------------|-------|
| 1 | CONTEXT values render "N/A" for post-seed keys — catalog-bound `fromAnswers` read side (P4) | 1 |
| 2 | P3 residue: severity-PATCH response-shape docs; seed derivation assertions; `recomputeAssessmentsForKey` tx scaling; global cache timestamp | 2 |
| 3a | Cross-field rules hardcoded client island → registry rule language + admin UI + migration (P4 decision) | 3 |
| 3b | Multi-select offline replay arrives as JSON strings (P4) | 4 |
| 3c | `test:api` / e2e share `drms_test` (P4) | 6 |
| 4 | P5 trio: `incidentId \|\| entityUuid` fallback; update producer keyed by entityId; no entity-assignment re-validation on update | 4 |
| 5 | `commitment.service.ts:212` donorId (org id) vs recipient user id conflation (P6) | 5 |
| 6 | `IndividualEntityGapInfoPopup.tsx:22-183` hardcoded gap explanations (P7) | 5 |
| 7 | Catalog label/option-value polish (P9) | 6 |

**Phase ordering rationale:** Phase 1 is the only user-visible correctness bug
(browser-confirmed "N/A") and unblocks Phase 5's popup rewiring (shared
snapshot-hydration helper). Phase 2 is low-risk hardening with no schema changes.
Phase 3 is the only schema migration + largest surface — it lands on a stabilized
read side. Phase 4 hardens offline sync (touches the never-reject path, needs the
rule engine from Phase 3 to know replay is exempt). Phase 5 is two small
consumer-side fixes. Phase 6 bundles CI mechanics with deliberate Tier A content
churn that must be last (re-seed reconciliation wipes content edits).

---

## 2. Phase 1 — Snapshot-Hydrated Read Side (Item 1: CONTEXT "N/A")

**Problem.** `fromAnswers` (`src/lib/questions/answers.ts:65-96`) iterates the
static `QUESTION_CATALOG`, so answers keyed by admin-authored post-seed questions
are dropped before hydration. The situation dashboard spreads that filtered
payload (`src/app/api/v1/dashboard/situation/route.ts:974-991`), rendering "N/A"
for new CONTEXT values; the assessment edit page has the same catalog-bound
hydration for drifted keys.

**Design.**
- New pure helper `hydrateFromSnapshot(structure, answers)` in
  `src/lib/questions/answers.ts`: emits typed values for **every** key present in
  the snapshot's sections (NUMBER → number, BOOLEAN → boolean, MULTI_SELECT →
  `coerceArray`, SINGLE_CHOICE/TEXT* → string), falling back to raw answer values
  for keys found in neither (labeled `source: 'unmapped'`, mirroring the gap
  engine's drift semantics).
- `fromAnswers(type, answers)` kept as a thin wrapper:
  `hydrateFromSnapshot(activeRegistryStructure, answers)` — same output for
  catalog keys (parity), new keys now included.
- Situation route `getLatestHealthAssessment` (and the other per-type latest
  readers) hydrates from the **stored `questionSnapshot`** of the assessment row
  (registry ladder for labels), not the live catalog — historical rows render the
  values they were answered with even after registry drift.
- Assessment edit/view pages: when a stored row's snapshot contains keys missing
  from the live registry view, render those questions read-only from the snapshot
  (no live validation on unmappable keys).
- `AssessmentCategorySummary.formatContextValue` unchanged — it starts receiving
  values instead of `undefined`.

**Tasks.**
1. Implement `hydrateFromSnapshot` + rewire `fromAnswers` (unit: parity fixtures
   for all 6 types + post-seed `p9t*` keys now hydrate).
2. Situation route per-type latest readers switch to stored-snapshot hydration
   (api test: HEALTH latest payload contains `p9tPatientsPerDay` value, not N/A).
3. Edit page drift rendering (component test; e2e: open legacy assessment, drifted
   keys render read-only).
4. Ledger: mark the P4 `fromAnswers` entry RESOLVED with test evidence.

**Non-goals.** No snapshot format change, no version bumps — read-side only.

---

## 3. Phase 2 — Registry Hardening (Item 2: P3 Residue)

**2a. Per-entry cache TTL** (`gap-analysis.service.ts:74-77,151-156`): replace the
single global `registryViewCacheTimestamp` with `Map<AssessmentType, {view, expiresAt}>`;
entries expire independently. Unit test: type A's stale entry expires while type B's
fresh entry survives.

**2b. `recomputeAssessmentsForKey` scaling** (`question-registry.service.ts:879-925`):
move the candidate scan **outside** the interactive transaction (plain `prisma`
read is fine — the severity row is updated first inside the tx; recompute is
idempotent), then re-verify affectedness inside the tx with
`questionSnapshot: { not: undefined }` + key-containment post-filter, and rewrite
in committed chunks of 200 with the existing per-row derive. Acceptable because
severity PATCH recompute is idempotent (deriveGaps is pure); worst case re-derives
a row with the pre-edit severity ladder, corrected by the same PATCH retry —
document this in the service comment. Api test unchanged (behavior-identical).

**2c. Docs:** `docs/api-contracts.md` §4.25 — document the severity PATCH response
shape `{ data: { question, affectedCount, affectedIncidentIds } }` and the rule
endpoints added in Phase 3 (single docs pass after both phases' API surface is final).

**2d. Seed derivation assertions:** extend `tests/api/seed-partition.test.ts` —
after the `--with-sample-data` run, assert the seeded demo assessments' stored
`gapAnalysis.severity`/`priority` values match the expected derivation matrix
(at least one CRITICAL, one HIGH, one MEDIUM per the seed's answer fixtures), so an
argument swap in `prisma/seed.ts` derivation wiring fails the suite.

**Ledger:** P3 entries (docs, seed-test, tx-scaling, cache) → RESOLVED.

---

## 4. Phase 3 — Cross-Field Rule Registry + Admin UI + Legacy Migration (Item 3a)

### 4.1 Schema (`prisma/schema.prisma`)

```prisma
model CrossFieldRule {
  id             String         @id @default(uuid())
  assessmentType AssessmentType @map("assessment_type")
  ruleKey        String         @map("rule_key")   // kebab-case, immutable
  kind           String                            // 'REFINEMENT' | 'AGGREGATE'
  name           String
  message        String                            // '{{...}}' interpolation tokens
  when           Json?                             // optional boolean gate AST
  expression     Json                              // violation-when AST
  referenceKeys  Json                              // string[] of questionKeys (invariant targets)
  isActive       Boolean        @default(true) @map("is_active")
  order          Int
  createdAt      DateTime       @default(now()) @map("created_at")
  updatedAt      DateTime       @updatedAt @map("updated_at")

  @@unique([assessmentType, ruleKey])
  @@index([assessmentType, isActive])
  @@map("cross_field_rules")
}
```

Audit: reuse `QuestionAuditLog` with `entityType: 'RULE'`. Version stamps: rule
mutations bump the type's `structureVersion` (validation semantics changed);
`contentVersion` untouched. Rules are **not** per-question freeze-gated (they do
not alter answer shape), but a question cannot be deactivated while an active
rule references its key (400 `registry_invalid` listing the rules — enforced in
the existing deactivation invariant block; `/admin/questions/{id}/impact` lists
referencing rules).

### 4.2 Rule expression language (JSON AST — covers all 15 legacy rules exactly)

```
Operand  := { type: 'question', key: string }
          | { type: 'sum', keys: string[] }
          | { type: 'literal', value: number }
Compare  := { op: '>' | '>=' | '<' | '<=' | '==' | '!=', left: Operand, right: Operand }
BoolGate := { questionKey: string, is: true | false }
Rule     := { when?: BoolGate, violationWhen: Compare }
```

Message tokens: `{{value:key}}` → numeric value, `{{sum:k1,k2}}` → summed value.
Evaluator is a pure function `evaluateRules(rules, values)` in
`src/lib/questions/rule-engine.ts` returning `CrossFieldViolation[]` (same
interface as today — `key`, `message`, `kind`); deterministic order = rule `order`.
Non-number values coerce via the same `num()` semantics as the legacy module
(0 default) so parity is exact.

### 4.3 Legacy rule parity map (seed migration)

| Legacy (cross-field-rules.ts) | New rule |
|---|---|
| POPULATION 8 refinements (L54-95) | 8 REFINEMENT rules: 2× `sum[a,b] > totalPopulation` (gender, casualties), 6× `value[x] > totalPopulation` |
| POPULATION 3 aggregates (L111-147) | 3 AGGREGATE rules with interpolated messages (gender sum, vulnerable-groups sum over 6 keys, casualty sum) |
| FOOD 2 (L150-161) | `when isFoodSufficient=true ∧ additionalFoodRequiredPersons > 0`; `when isFoodSufficient=true ∧ availableFoodDurationDays < 7` |
| WASH 1 (L164-168) | `when areLatrinesSufficient=true ∧ functionalLatrinesAvailable == 0` |
| SHELTER 1 (L171-175) | `when areSheltersSufficient=true ∧ numberSheltersRequired > 0` |

15 rows seeded in `prisma/seed.ts` (both partitions — rules are registry baseline
like the 55 questions; sample-data branch untouched). Migration safety: before
deleting the hardcoded module, add a golden parity test — fixture answer sets per
type (violating, boundary, clean) through BOTH `evaluateCrossFieldRules` (old)
and `evaluateRules` (new) must produce identical violation arrays; only then
delete `cross-field-rules.ts` and re-export `evaluateCrossFieldRules` /
`crossFieldSuperRefine` / `hasCrossFieldViolations` from the rule engine (same
signatures — `DynamicAssessmentForm.tsx` needs only an import-path change to
consume rules from the `/questions` payload instead of the static module).

### 4.4 API surface (governance: ADMIN + `reason` + audit, mirroring §4.25 style)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/questions?assessmentType=…` | Response gains `rules: RegistryRule[]` (active, ordered). `includeInactive=1` returns all rules. |
| POST | `/admin/rules` | Create rule (ADMIN; `reason` required; keys validated against active questions of the type; expression validated against the AST schema). |
| PUT | `/admin/rules/{id}` | Edit (name/message/kind/when/expression/order/active). Bumps `structureVersion`. `ruleKey` immutable (400 `rule_key_immutable`). |
| DELETE | `/admin/rules/{id}` | Soft-deactivate (`reason` required). Deactivating the last active REFINEMENT of a type is allowed (validation is optional by design). |
| GET | `/admin/rules/{id}/audit` | Rule audit timeline. |

Server-side enforcement (closes the P4 "accepted parity loss"): `POST/PUT
/rapid-assessments` and `/submit` evaluate active REFINEMENT rules server-side →
400 with `details[]` keyed per violation. AGGREGATE rules stay client-live-only
(legacy parity: destructive alert + submit disabled). **Offline `POST /sync/batch`
replay is exempt** from rule rejection (never-reject ruling, mirroring the P9
ACTIVE-incident exemption); violations on replayed rows are recorded as
informational flags on the stored `gapAnalysis`, never blocking.

### 4.5 Admin authoring UI — integrated into the question registry editor

Location: `src/app/(auth)/admin/settings/questions/page.tsx` (P8 editor) gains a
**"Cross-field rules" tab/panel per assessment type**, reusing the page's type
switcher, version badges, reason-governance and audit-timeline components.

- **Rule list**: table of the type's rules — name, kind badge
  (REFINEMENT/AGGREGATE), message preview, referenced question keys as chips,
  active toggle, order controls. Empty-state hint for HEALTH/SECURITY ("no rules —
  by design").
- **Rule editor dialog** (extends the existing QuestionEditDialog patterns):
  - *When* row (optional): question dropdown filtered to the type's BOOLEAN
    questions + is/is-not toggle.
  - *Violation condition* row: left operand = question dropdown (NUMBER questions)
    or "Sum of…" multi-select; comparator dropdown (`> ≥ < ≤ = ≠`); right operand =
    question dropdown or literal number input.
  - *Message* textarea with `{{value:key}}`/`{{sum:…}}` token inserter and live
    preview against the current answers of the type's latest assessment (dry-run).
  - `reason` field (required, governance) + freeze/version badge showing the
    pending `structureVersion` bump.
  - Client-side validation mirrors server AST validation (same zod schema shared
    from `src/lib/questions/rule-engine.ts`).
- **Question deactivation guard UX**: the deactivate confirmation in the editor
  lists active rules referencing the question (data from `/admin/questions/{id}/impact`).
- **Parity authoring flow**: the seeded 15 rules are immediately editable here —
  the "restored" legacy behavior is now data managed through this UI, not code.

**Tasks.**
1. Schema + migration + seed rows (both partitions; partition test updated:
   `crossFieldRule.count() === 15` default, unchanged by `--with-sample-data`).
2. `rule-engine.ts` (evaluator + zod AST schema + token interpolation) — unit
   matrix: every operator, gates, sums, coercion, message tokens.
3. `QuestionRegistryService` rule CRUD + invariants (reference-key validation,
   deactivation guard, audit, version bump) + rule cache invalidation hooking the
   existing `invalidateRegistryCaches`.
4. API routes (`/admin/rules*`), `/questions` payload extension, rapid-assessment
   server-side enforcement + sync-batch exemption (documented in api-contracts §4.25).
5. Admin UI (rules panel + editor dialog + impact list) with e2e: create rule via
   UI → violates on form → submit blocked; edit seeded rule → message changes.
6. Golden parity test → delete `cross-field-rules.ts` → rewire
   `DynamicAssessmentForm.tsx` to payload rules → full gates.
7. Ledger: P4 cross-field decision entry → RESOLVED.

---

## 5. Phase 4 — Offline Sync Hardening (Items 3b + 4)

**4a. Replay normalization (P4 multi-select strings).** At the transport boundary
`sync-processing.service.ts` (ingest of each queued change): run answers through a
shared `normalizeAnswerValues(questionTypes)` that `JSON.parse`s string-encoded
arrays for MULTI_SELECT keys (using the snapshot's question types) — same
`coerceArray` semantics as the live form. Unparseable strings persist verbatim
(never-reject) and are flagged in the stored gapAnalysis `unanswered`/drift
report. Unit: `"[\"Malaria\"]"` → `["Malaria"]`; garbage string → verbatim + flag.

**4b. `incidentId` fallback (P5).** `sync-processing.service.ts:118-119`: drop
`|| change.entityUuid`; if `data.incidentId` is absent, reject that change
entry as a per-entry sync conflict (existing conflict machinery — the batch
still never throws), do not write the row.

**4c. Update producer row-id (P5).** `assessment-offline.service.ts` update path
(L99-109): enqueue the **assessment row id** (`id`) in the slot the consumer
resolves by `findUnique({ where: { id: change.entityUuid } })`; keep entityId in
the payload for reference. Add a sync api test driving the update branch
end-to-end (currently unreachable — hence untested).

**4d. Sync authorization pass (P5).** Shared authorizer
`assertAssignmentForTargets(userId, { entityId?, incidentId? })` applied to BOTH
the online `PUT /rapid-assessments/{id}` and the offline update branch: if the
payload re-points entityId/incidentId, the syncing user must hold a
COORDINATOR/ADMIN role or an active entity assignment covering the new entity;
otherwise 403 (online) / per-entry conflict (offline). Api tests for both paths.

**Ledger:** P4 replay + all three P5 entries → RESOLVED.

---

## 6. Phase 5 — Signal + Gap-Popup Fixes (Items 5 + 6)

**5a. Commitment donorId (P6).** `commitment.service.ts:212`: resolve the donor's
linked user id before dispatch — `prisma.donor.findUnique({ where: { id:
data.donorId } }).userId` (donor → user relation already exists for
`users/me/donor`); skip the donor branch (log) when no linked user, so the
subsequent responder rows in the same evaluator run are no longer killed. Api
test: commitment creation via the service path generates the donor-branch signal.

**5b. Gap popup from registry (P7).** `IndividualEntityGapInfoPopup.tsx:22-183`:
delete the hardcoded field/explanation map; render from the registry
`questionMetadata` projection (`gapLabel`/`gapMeaning` per GAP question, already
exposed by the P7 summaries' live-registry projection — reuse the Phase 1
snapshot hydration when the popup serves a stored assessment). Visual parity check
against `dqr-p7-dashboard.png`; unit test: adding a GAP question via the registry
makes it appear in the popup without code changes.

**Ledger:** P6 + P7 entries → RESOLVED.

---

## 7. Phase 6 — CI Separation + Catalog Polish (Items 3c + 7)

**6a. Test DB separation (P4).** Give e2e its own database (`drms_e2e`, port-5436
or same instance second DB): `playwright.baseline.config.ts` web server env +
`tests/helpers` e2e seed target a dedicated DB; `test:api` keeps `drms_test`.
Verify `pnpm test:api` and `pnpm test:baseline:e2e` can run concurrently (CI
parallelism) — document in README test section. Rollback-safe: scripts remain
sequential if env var absent.

**6b. Catalog polish (P9).** Deliberate Tier A authoring pass **through the P8
admin editor UI** (not a seed edit): normalize the label registers (question
phrasing) and option `value`/`label` pairs (`'River/Stream'`, `'Water trucks'`)
per `docs/question-authoring-guide.md` Appendix A; each edit bumps
`contentVersion` via the governed UI with reasons, exercising the full governance
path in production-like fashion. After the pass, fold the new wording into
`QUESTION_CATALOG` (`registry-validation.ts`) so re-seed reconciliation restores
the normalized text instead of reverting it. Zero behavioral effect — no engine
snapshots touched (Tier A only), verified by unchanged api/e2e suites.

**Ledger:** P4 test-DB + P9 catalog entries → RESOLVED. Final ledger sweep: all
DQR entries closed; `deferred-work.md` retains only the 2026-06-08 Brand
Customization group.

---

## 8. Cross-Phase Invariants

- Every phase runs the full gate chain before merge:
  `npm run lint && npm run type-check && npm run test:unit && npm run db:push:test && npm run test:api && npm run test:baseline:e2e && npm run build`.
- Phases 1–2, 4–6 are behavior-preserving except where a deferral explicitly
  names the behavior change (4b/4d rejections, Phase 3 server-side enforcement).
- Never-reject ruling is absolute on `/sync/batch`: every Phase 3/4 enforcement
  lands as per-entry conflict/flag, never a batch 4xx/5xx.
- Snapshot/version contract unchanged for existing rows: only additive payload
  fields (`rules`, hydration keys); `structureVersion` bumps only where specified.
- Ledger updated per phase (status + evidence), keeping the bullet-triple format.

## 9. Risks

| Risk | Mitigation |
|------|------------|
| Rule AST too narrow for future rules | AST is additive JSON; extend operands (ratio, count-of-selected) without schema migration |
| Parity drift during migration to rule engine | Golden test old-vs-new before deleting the legacy module; run both in CI for the Phase 3 branch duration |
| Snapshot hydration changes dashboard JSON shape | Additive keys only; api suite pins existing keys |
| 4b rejects previously-accepted offline creates | Per-entry conflict preserves data for manual resolution; release note |
| Phase 6b content churn reverts on re-seed | Fold final wording into QUESTION_CATALOG in the same PR |
