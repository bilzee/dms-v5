# Implementation Plan: Dynamic Assessment Question Registry

**Status:** v2 — amended after multi-agent panel review; decisions D-1…D-4 incorporated; approved for build
**Date:** 2026-09-12
**Predecessor analysis:** Severity verification + question-system research; panel review (architect, engineer, UX, PM, BA, tech-writer rounds)
**Deployment context:** App is NOT live in production. No backward compatibility with the hardcoded/static question format is required. Existing dev/staging data may be reset.

**v2 changelog:**
- Governance redesigned: per-question freeze predicate replaces global "zero ACTIVE incidents" gate; add-question anytime; reorder/section ops set-level gated (was §2.2/2.6).
- Recompute reframed as derivation rule; `gapAnalysis` is a cache; "Recalculate All" deleted (was §2.3, Q-1).
- Offline sync can never reject a completed assessment; drafts auto-migrate with change receipt (was §4).
- Versioning split into `structureVersion` / `contentVersion` (was single `questionSetVersion`).
- Build order fixed: type-table drop moved to P1; guard ships with P2 routes; engine+tests are P3 entry criteria (was §6).
- Roles decided (D-1): ADMIN owns all question editing; COORDINATOR edits severity only.
- Full admin editor in scope now (D-2/D-3); field-validation gating rejected.
- NEW: notification & signal severity inheritance (D-4) — bottom-up passthrough, P4.
- Audit log (question change log) added as prerequisite for any registry editing.
- Dashboard: "embed" decided; ranking severity × spread; chip hints; zero-gap-type suppression (was §2.7).
- Form UX: per-question interaction gating; gap-first ordering demoted to seed convention pending verification (was §2.4).
- Contract-grade requirements: exact catalog (no tildes), data dictionary appendix, layout contract as standalone artifact, unmeasurable ACs bound (was §3/§8).

---

## 0. Goals & Non-Goals

### Goals
1. **Single source of truth for questions** — all 55 assessment questions (24 gap, 31 context) move from code into a database registry, seeded for fresh production deployments.
2. **Admin-editable questions (D-1/D-2)** — the **ADMIN role owns all question editing**: text, type, options, gap/context classification, inverted logic, gap phrases/meanings, recommendations, order, sections, active state. **COORDINATOR edits severity only**, via the existing severity configuration page rewired to the new registry. Full editor ships now (no field-validation gate).
3. **Formalized form design language** — one dynamic form renderer places questions by their properties (sections, widget by type, live gap indicators), transcribing today's scaffold faithfully.
4. **Generic gap/severity engine** — one evaluation path for all types (including POPULATION), preserving the verified bottom-up pipeline.
5. **Governed change windows** — per-question locks driven by actual in-flight usage, not global incident counts (§2.6).
6. **Dashboard scaling** — registry-driven Situation Dashboard with severity × spread top-N collapse and drill-down.
7. **Notification & signal severity inheritance (D-4)** — notification/signal priority = severity of the triggering object (assessment/response/commitment/incident), completing the bottom-up chain. Routing policy remains out of scope.

### Non-Goals
- Notification **routing policy** (who gets notified, thresholds, channels, muting) — deferred with explicit trigger: after the first real usage cycle.
- Donor gap-analysis taxonomy alignment onto the registry (follow-up).
- Tri-state ("not assessed") booleans.
- Multi-language question text (registry architecture keeps the door open; text + translation must eventually change as a pair).
- Preliminary assessments (casualty-threshold severity fallback stays as-is).

---

## 1. Current-State Inventory (what this plan replaces)

The question registry currently exists in **four duplicated hardcoded copies**:

| # | Copy | Location | Contents |
|---|---|---|---|
| 1 | Form Zod schemas + JSX | `src/components/forms/assessment/{Health,Population,Food,WASH,Shelter,Security}AssessmentForm.tsx` | Labels, helper text, types, options, mandatory-ness, gap/context card grouping, live gap badges, per-form `gapFields` arrays |
| 2 | Server validation | `src/lib/validation/rapid-assessment.ts` (lines 22–110) | Same fields as Zod schemas, per type |
| 3 | Gap rules | `src/lib/services/gap-analysis.service.ts` (lines 57–200) | Which booleans are gaps, inverted flags, per-type `analyze*Gaps`, hardcoded recommendation generators |
| 4 | Dashboard definitions | `src/components/dashboards/situation/components/AssessmentCategorySummary.tsx` (lines 110–194) + aggregation lists in `src/app/api/v1/dashboard/situation/route.ts` (~1485–1604) | Labels, gap/context split, inverted flags, hardcoded severity fallbacks |

Plus: severity-only DB registry `GapFieldSeverity` (`prisma/schema.prisma:527–547`, seed `prisma/seed.ts:915–970`, service `src/lib/services/gap-field-severity.service.ts`, coordinator UI `src/components/settings/GapFieldTable.tsx`).

Answers are stored in **six typed tables** (`HealthAssessment` … `SecurityAssessment`, `prisma/schema.prisma:296–391`), one column per question — the reason question changes currently require migrations.

### Question counts (to be confirmed EXACT during P1 extraction — no tildes in the build)
| Type | Total | Gap | Context | Inverted gap fields |
|---|---|---|---|---|
| HEALTH | 11 | 6 | 5 | — |
| POPULATION | 13 | 0 | 13 | — |
| FOOD | 8 | 3 | 5 | — |
| WASH | 8 | 5 | 3 | `hasOpenDefecationConcerns` |
| SHELTER | 8 | 4 | 4 | `areOvercrowded` |
| SECURITY | 7 | 6 | 1 | `gbvCasesReported` |
| **Total** | **55** | **24** | **31** | |

---

## 2. Target Architecture

### 2.1 Prisma schema changes

New enums: `QuestionType { BOOLEAN NUMBER SINGLE_CHOICE MULTI_SELECT TEXT_LONG }`, `QuestionCategory { GAP CONTEXT }`, `QuestionSectionCategory { GAP CONTEXT }`.

```prisma
model QuestionSection {
  id             String   @id @default(cuid())
  assessmentType AssessmentType
  key            String
  title          String
  description    String?
  category       QuestionSectionCategory
  order          Int
  isActive       Boolean  @default(true)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  questions      Question[]

  @@unique([assessmentType, key])
  @@map("question_sections")
}

model Question {
  id             String        @id @default(cuid())
  assessmentType AssessmentType
  key            String                    // stable slug, immutable
  sectionId      String
  section        QuestionSection @relation(fields: [sectionId], references: [id])
  label          String                    // question text shown to assessor
  helperText     String?
  questionType   QuestionType
  options        Json?                     // QuestionOption[] — typed, see below
  category       QuestionCategory
  inverted       Boolean       @default(false)
  severity       Priority      @default(MEDIUM)
  required       Boolean       @default(false)  // CONTEXT only; GAP forced true
  gapLabel       String?       // noun phrase: "No functional clinic"
  gapMeaning     String?       // declarative sentence: what the gap means
  recommendation String?       // imperative: "Deploy mobile clinic team"
  noGapLabel     String?
  numberMin      Int?
  numberMax      Int?
  placeholder    String?
  order          Int
  isActive       Boolean       @default(true)
  version        Int           @default(1)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  createdBy      String?
  updatedBy      String?

  @@unique([assessmentType, key])
  @@map("questions")
}

model QuestionAuditLog {
  id         String   @id @default(cuid())
  actorId    String
  action     String   // CREATE | UPDATE_TEXT | UPDATE_SEVERITY | DEACTIVATE | ... | REORDER
  entityType String   // QUESTION | SECTION
  entityId   String
  before     Json?
  after      Json?
  reason     String?  // free-text why — required for structural actions
  createdAt  DateTime @default(now())
  @@map("question_audit_logs")
}
```

**Typed options contract** (shared Zod schema in `src/lib/validation/question-options.ts`, consumed by seed, admin editor, `TagPillSelect`, and the runtime assessment builder):
```ts
const QuestionOption = z.object({ value: z.string(), label: z.string(), description: z.string().optional() })
```

**Ordering comparator (normative):** gap lists, dashboard top-N, and form rendering order by `severity DESC, order ASC` (or plain `order ASC` outside gap contexts). Reorder is a single transaction producing unique contiguous `order` values.

**RapidAssessment changes:**
- **Add** `answers Json?` — `{ [questionKey]: boolean | number | string | string[] }` (real JSON arrays).
- **Add** `questionSnapshot Json?` — resolved question definitions at submit time (structure only; see §2.3).
- **Add** `structureVersion Int?` and `contentVersion Int?` — the registry versions the submission was validated against.
- **Remove** relations to the six type tables; **drop** `HealthAssessment`, `PopulationAssessment`, `FoodAssessment`, `WashAssessment`, `ShelterAssessment`, `SecurityAssessment` **in the P1 migration** (the regenerated Prisma client makes `tsc` fail on every stale `prisma.healthAssessment` reference — the compiler performs the consumer sweep for us; app is not live, dev DBs reset).
- **Drop** `GapFieldSeverity` (subsumed by `Question`).
- **Remove** client-settable `priority` (server always derives — §2.5).

**Registry versioning:** two `SystemSetting` counters per type — `QUESTION_REGISTRY/structureVersion/{TYPE}` (bumped on structural mutations) and `QUESTION_REGISTRY/contentVersion/{TYPE}` (bumped on severity/text edits). Both incremented **atomically inside the mutation transaction** (`increment`, never read-modify-write). Offline clients warn only on `structureVersion` mismatch; `contentVersion` changes apply silently at next sync.

### 2.2 Field contract, edit tiers, and roles (D-1)

Edit tier is assigned by one axis: **does the edit reinterpret stored answers?** Correctness of stored data is guaranteed by snapshots regardless; tiers govern *in-flight consistency*.

| Edit | Tier | Gate | Role |
|---|---|---|---|
| Severity value | A | Anytime; in-transaction recompute of affected assessments + `contentVersion` bump; confirmation shows affected count | COORDINATOR (severity page) or ADMIN |
| Text fields (label, helperText, gap phrases, recommendation, placeholder) | A | Anytime; `contentVersion` bump | ADMIN |
| Add new question; **append** a select option | A | Anytime; prospective (appears on next fetch; old snapshots unaffected) | ADMIN |
| Reorder; section reassignment | B | Set-level: no ACTIVE incident of that type holds any submitted assessment | ADMIN |
| Deactivate; questionType change; **remove/change** an option; `inverted`; `required`; GAP↔CONTEXT; section create/delete | B | Per-question: blocked only if key ∈ `questionSnapshot` of any assessment under an ACTIVE incident of that type | ADMIN |
| Key rename / semantic replacement | C | Never in place — deactivate old (Tier B mechanics) + create new (Tier A). Overlap period is intentional (MAX severity gives transition coverage mid-outbreak) | ADMIN |

Hard rules enforced by a single `validateRegistry()` run on every mutation and in seed (not scattered UI checks): `category=GAP ⇒ required=true`; GAP questions must be BOOLEAN; `inverted` only on GAP; GAP sections contain only GAP questions, CONTEXT only CONTEXT; ≥1 active GAP question per non-POPULATION type. **Every mutation writes a `QuestionAuditLog` row** (reason mandatory for structural actions) — humanitarian accountability (CHS/donor audit) requires reproducible instruments.

### 2.3 Snapshot & derivation rule (Q-1 resolved)

**Snapshot per assessment, structure only**, re-written on **every successful submission** (create/update/verify): `{ id, key, label, helperText, questionType, options, category, inverted, required, gapLabel, gapMeaning, recommendation, sectionTitle, sectionCategory, order, severity }` per question, plus `{ assessmentType, structureVersion, contentVersion }`.

**Severity is a derivation, never an independent stored truth:**

> assessment gap severity ≡ `analyzeGaps(snapshotStructure, liveRegistryRows(snapshotKeys))`

- `gapAnalysis` JSON on the assessment is a **cache**, recomputed **in the same transaction** as any severity edit (batch-with-progress if the affected set is large; pre-launch volumes → synchronous).
- **"Recalculate All" button is deleted** — under a derivation rule it is an admission of ambiguity, not a feature.
- Resolution ladder per key: live registry row (regardless of `isActive` — deactivation is prospective by construction) → snapshot severity (only if row hard-deleted) → "partially unmapped" flag (never silently LOW).
- Dashboards and rollups carry a single stamp: "severities as of `{contentVersion date}`" — reports remain trustworthy after a rewrite.
- Severity edits affecting keys present in ACTIVE incidents' snapshots show a pre-confirm: "This will recompute N assessments."

Idempotency AC: a second derivation pass with unchanged inputs is byte-identical.

### 2.4 Formalized Assessment Form Layout Contract

Standalone reference doc `docs/design/assessment-form-layout-contract.md`, created at P2 start (frontend, backend, and admin editor all cite it — no paraphrase drift). Contract:

**Zones (fixed order):** Z1 `SectionProgress` + `StickyFormHeader` → Z2 Incident + Entity selectors → Z3 GAP sections (tinted `bg-sky-50/50 dark:bg-sky-950/20`) → Z4 CONTEXT sections → Z5 auto Risk Assessment card → Z6 GPS / Photos / Additional Details → Z7 Draft + Submit.

**Gap-first ordering is a SEED CONVENTION, not a renderer invariant.** P1 extraction verifies each type's current card ordering; if any current form interleaves context before gaps (context can prime judgment), the seed preserves that type's real order and the renderer follows `section.order` + `order` — it does not force Z3-before-Z4.

**Widget matrix:** BOOLEAN+GAP → bordered checkbox + live `StatusBadge`, 2-col grid; BOOLEAN+CONTEXT → same, no badge; NUMBER → `Input`, 2-col; SINGLE_CHOICE → `Select`, full width; MULTI_SELECT → `TagPillSelect`, full width; TEXT_LONG → `Textarea min-h-[100px]`, full width.

**Interaction gating (panic-UI fix):** binary booleans make "never touched" and "answered No (= gap)" identical in storage — so the UI must distinguish them. Badge state is **per-question**: untouched = neutral/amber, touched-and-gapped = red. The sticky header counts **confirmed gaps only** (questions actually answered into a gap), never latent ones. Z5 appears only when confirmed gaps exist.

**Zero-gap types (POPULATION):** Z3, Z5, and the gap-count chip are **suppressed entirely** — never a standing "0 gaps."

**Drafts:** autosave (30 s) stores the raw answers map keyed by stable question keys/IDs. On reopen after a structural change: auto-migrate (surviving questions keep answers; deactivated questions preserved-and-marked), then one dismissible plain-language **receipt**: "Form updated: 3 questions added, 1 removed. Your answers are saved." Never a diff UI; never discard an assessor's work.

**Offline staleness:** `structureVersion` mismatch → one slim banner **above** Z1 (Z1's alarm budget belongs to the gap count) linking to the same receipt. `contentVersion` mismatch → silent, applied on sync. Warnings appear only when they require action.

**Edge cases in the contract:** long-label line handling in 2-col checkbox grids; MULTI_SELECT with 10+ described options gets max-height + internal scroll (mobile especially); single-question sections; `SectionProgress` collapse behavior on phones. Client runtime Zod built from the registry via shared `src/lib/validation/dynamic-assessment.ts`. `data-testid = kebabCase(key)` — existing Playwright selectors unchanged.

### 2.5 Generic gap engine & unified severity pipeline

`analyzeGaps({ assessmentType, answers, questions })` → `{ hasGap, gapFields` (ordered severity desc, order asc)`, severity = MAX(gapped severities) else LOW, fieldSeverityMap, recommendations }`. Gap condition: `inverted ? value===true : value===false`. POPULATION flows through (0 gap questions ⇒ LOW, derived server-side). `triggerGapAnalysis` persists answers + snapshot + versions + cached gapAnalysis and derives `priority` for **every** type on create/update/submit/verify; `priority` removed from create/update input schemas (closes API injection). Offline response-plan priority injection (`sync-processing.service.ts:197`) derives from assessment/incident instead.

### 2.6 Governance enforcement

- Server guard in **every** mutation route, executed **inside the write transaction** (no check-then-act race with incident activation): `assertQuestionEditable(key|setType)` implementing the §2.2 gates. Integration test: ACTIVE-incident scenario ⇒ 409 on **every** enumerated mutation route.
- No DRAFT incident status needed (superseded by scoped freeze). No pending-changes queue (deactivate+create is the lever).
- Offline interplay: the guard makes cached-form structural drift rare; when it occurs anyway, §4's accept-and-intersect rule handles it without data loss.

### 2.7 Dashboard strategy

- Situation API **embeds** question metadata in its payload (decided; no client-side second cache — one staleness window).
- Ranking: top-N by **severity × spread** (severity desc, then number of entities affected), not severity alone; chip carries a hint ("+3 more · 2 HIGH").
- `SystemSetting DASHBOARD/gapRowsPerCategory` default 5, with the documented ceiling (~7 before the no-scroll-at-1920×1080 promise breaks) shown beside the setting.
- Soft-cap warning in admin UI at >12 active GAP questions per type (warn only — never block disaster tooling).
- Registry-driven rendering replaces `fieldDefinitions` and hardcoded fallback severity lists.

### 2.8 Notification & signal severity inheritance (D-4, NEW)

Notification and action-signal priority = severity of the triggering object — the bottom-up chain completed:

| Trigger | Inherited priority |
|---|---|
| Assessment events (submitted/verified/gap found) | `assessment.priority` |
| Response events (planned/delivered/verified) | `response.priority` |
| Commitment events (created/updated) | `incident.severity` (replaces hardcoded `'HIGH'`) |
| Entity/incident-level events | `incident.severity` |

Implementation: replace the hardcoded `'MEDIUM'` at every `createNotification` call site (`action-signal.service.ts:1262`, `notification.service.ts:33`) and the hardcoded situational signal values (`action-signal.service.ts:407` etc.) with source-object passthrough.

**Boundary — system-health notifications** have no question-derived severity and retain fixed values, documented in the appendix list: verification-overdue (CRITICAL), population-cadence (CRITICAL), sync errors. Routing policy (who/when/channel) remains a Non-Goal with trigger "first real usage cycle."

---

## 3. Seed: backup of the current hardcoded questions

`prisma/seed-questions.ts` exports the exact catalog — **P1 must produce the exact appendix table of all questions and sections (id, key, label, gapLabel, section, category, tier-relevant flags); no tildes; review must never require opening a TS file.** Domain owner (the D-1 admin) eyeballs all 55 post-seed.

Extraction sources (authoritative per aspect): form JSX → labels/helper/options/section presentation; server validation → types/required-ness; `gap-analysis.service.ts` → gap classification + inverted flags (authoritative where copies disagree — fixes the `areOvercrowded` form omission); existing seed → severity MEDIUM for all 24; `generate*Recommendations` → per-question `recommendation`. Extraction also **records each type's actual gap/context card ordering** (feeds §2.4 convention).

Seeding: idempotent `upsert` on `(assessmentType, key)`; bumps both versions; `validateRegistry()` runs at seed end; GapFieldSeverity seed block deleted; sample assessments rewritten to `answers` JSON.

**Seed-vs-admin reconciliation policy** (documented in the seed file header AND admin guide): seed = bootstrap baseline for new environments; admin edits = runtime source of truth; **registry export** (JSON dump of Question/QuestionSection, versioned schema + documented restore-and-verify procedure) = reconciliation artifact. Procedure: export prod, diff vs seed, record deltas.

Worked example (HEALTH) — full fidelity target per question:

| key | section | type | category | label | helperText | gapLabel | gapMeaning |
|---|---|---|---|---|---|---|---|
| `hasFunctionalClinic` | facilities (GAP) | BOOLEAN | GAP | Functional Clinic | At least one functional healthcare facility exists | No functional clinic | No functional healthcare facility exists in the assessed area |
| `hasEmergencyServices` | facilities (GAP) | BOOLEAN | GAP | Emergency Services | Emergency medical services are available | No emergency services | Emergency medical services are not available |
| `hasTrainedStaff` | services (GAP) | BOOLEAN | GAP | Trained Staff | Sufficient trained medical staff available | Insufficient trained staff | Trained medical staff are insufficient or absent |
| `hasMedicineSupply` | services (GAP) | BOOLEAN | GAP | Medicine Supply | Essential medicines are available | Medicine shortage | Essential medicines are not available or insufficient |
| `hasMedicalSupplies` | services (GAP) | BOOLEAN | GAP | Medical Supplies | Medical equipment and supplies available | Medical supplies shortage | Medical equipment and supplies are not available |
| `hasMaternalChildServices` | services (GAP) | BOOLEAN | GAP | Maternal & Child Services | Maternal and child health services available | No maternal/child services | Maternal and child health services are unavailable |
| `numberHealthFacilities` | details (CONTEXT) | NUMBER | CONTEXT | Number of Health Facilities | Total number of healthcare facilities in the area | — | — |
| `qualifiedHealthWorkers` | details (CONTEXT) | NUMBER | CONTEXT | Qualified Health Workers | Number of qualified healthcare workers available | — | — |
| `healthFacilityType` | details (CONTEXT) | SINGLE_CHOICE, required | CONTEXT | Primary Facility Type | Main type of healthcare facility available | — | — |
| `commonHealthIssues` | issues (CONTEXT) | MULTI_SELECT | CONTEXT | Common Health Issues | Select the most common health issues observed | — | — |
| `additionalHealthDetails` | additional | TEXT_LONG | CONTEXT | Additional Details | — | — | — |

All severities seed MEDIUM; per-question `recommendation` strings extracted from `generateHealthRecommendations`. The other five types extracted identically in P1.

---

## 4. API Design

| Route | Method(s) | Auth | Purpose |
|---|---|---|---|
| `/questions` | GET | any authenticated | Active questions+sections per type; response carries `structureVersion` + `contentVersion`; assessor forms & offline cache; `?includeInactive=1` for admins |
| `/admin/questions` + `[id]` + `/reorder` | POST/PUT/DELETE | **ADMIN only** (D-1) | All structural + text mutations; tier gates per §2.2 enforced in-transaction; audit-logged; `reason` required for structural actions |
| `/admin/questions/[id]/severity` | PUT | COORDINATOR or ADMIN | Severity-only edit (backs the coordinator severity page); triggers in-transaction recompute + contentVersion bump |
| `/admin/questions/export` | GET | ADMIN | Registry JSON export (backup/reconciliation artifact) |
| `/rapid-assessments` | POST/PUT | ASSESSOR | `{ assessmentType, entityId, incidentId, answers }`; validated against current registry (strict; one retry-once on version conflict); `priority` rejected |
| `/rapid-assessments/[id]/verify` | POST | COORDINATOR | Re-derives severity, re-snapshots |
| `/sync` (offline) | POST | ASSESSOR | **Never rejects a completed assessment** (§2.4): payload carries client versions; server persists unknown keys verbatim in `answers`, computes gaps on the intersection, flags unmapped. Response informs client of drift → change receipt |
| `/admin/severity/recalculate` | POST | — | **Deleted** (derivation rule makes it unnecessary) |
| `/gap-field-severities*` | — | — | **Deleted** (subsumed) |

AC: "offline assessment created at structureVersion N syncs clean after registry advances to N+1."

---

## 5. Admin & Coordinator UI

**COORDINATOR — severity page (existing route `/coordinator/settings/gap-field-management`):** stays severity-only; rewired from `GapFieldSeverity` to the Question registry; same table/bulk-edit UX; no structural controls. (Rename/redirect optional.)

**ADMIN — question editor (new, under admin settings):** the editing surface for the named instrument owner (D-1). Design brief: episodic-but-high-stakes user (rarely opens it; must work on first touch) → single screen, plain language, WYSIWYG preview, one explicit publish moment with diff summary.
- Per-type tabs; section-grouped table (order, label, key read-only, type, category chip, severity, inverted, active); actions: edit / duplicate (**always a "create with new key" dialog — Tier-B-gated**, never a silent copy) / deactivate.
- Editor dialog: live preview renders each text field **in its real surface** — label inside the form widget, gapLabel/gapMeaning **inside the actual Z5 Risk Assessment card** (admins must see the sentence reads standalone); char limits (schema-level, not polish); the four-field data dictionary (Appendix B) beside the inputs.
- Tier-B locks shown with reason ("used by N assessments under active incidents"); soft-cap warning >12 GAP/type.
- Audit log view (actor/action/why/before-after) and registry export button.
- No "Recalculate All."

---

## 6. Implementation Phases (~14–19 days)

### P1 — Schema, drop, seed, contract-grade docs (M)
1. Migration: create `Question`, `QuestionSection`, `QuestionAuditLog`, new `RapidAssessment` columns; **DROP the six type tables + `GapFieldSeverity`**; fix every compile failure the regenerated client surfaces (donors/, verification queue, reports, situation API stubs as needed to compile).
2. `prisma/seed-questions.ts`: exact catalog + per-type ordering record + exact appendix table; sample data rewritten; idempotent; `validateRegistry()` at seed end.
3. Author contract-grade artifacts as inputs: data dictionary (Appendix B content), Layout Contract reference doc skeleton, snapshot/answers JSON schema.
**AC:** fresh DB seeds exact counts; re-seed idempotent; `tsc` clean with old tables gone.

### P2 — Registry service, APIs, guard (M)
1. `question-registry.service.ts`: cached getters, dual version counters (atomic), snapshot projection, `validateRegistry()`, audit-log writer.
2. `dynamic-assessment.ts` runtime Zod builder (shared client/server) + typed options schema.
3. Routes per §4; **tier gates inside write transactions**; integration tests: 409 on every mutation route under ACTIVE-incident fixtures; invariant negative cases (deactivate last GAP, GAP↔CONTEXT move attempt, inverted-on-CONTEXT rejection).
**AC:** guard and invariants proven before any UI exists.

### P3 — Engine first, then dynamic form + submission + offline (L)
1. **Entry criteria:** `analyzeGaps` + full test suite (inverted, no-gap⇒LOW, deleted-question ladder, unmapped flag, ordering, idempotency).
2. `DynamicAssessmentForm.tsx` per the Layout Contract (per-question gating, POPULATION suppression, edge cases); `useQuestionSet(type)` stale-while-revalidate + offline cache.
3. Submission path: answers + re-snapshot on every successful submission + derivation; POPULATION derived; priority input removed.
4. Offline: never-reject sync (accept, persist verbatim, intersect); draft auto-migration + receipt; staleness banner rules.
5. Delete the six form components + barrel; update types.
6. **Human check before deletion:** two assessors through each type; compare completion time/error rate vs old forms.
**AC:** all types submit/edit online+offline; offline-at-N syncs clean at N+1; draft survives structural change with receipt; existing Playwright selectors pass.

### P4 — Severity unification + notification inheritance (M)
1. Derivation-rule recompute in-transaction on severity edit (affected-count confirm); delete Recalculate All endpoints/UI; "severities as of" stamp on rollups.
2. **D-4:** notification/signal priority passthrough per §2.8; system-health notification list documented.
3. Offline response-priority injection fix.
**AC:** assessment→entity→incident→response→notification chain fully bottom-up; regression green.

### P5 — Dashboard (M)
Embed question metadata in situation payload; registry-driven `AssessmentCategorySummary` (gap phrases, inverted from data, fallback lists deleted); severity × spread top-N + hinted chip + zero-gap suppression; `gapRowsPerCategory` setting with ceiling note.
**AC:** screenshot-diff parity vs current dashboard at current question volumes (Playwright screenshot fixture — "pixel-comparable" retired as unmeasurable); 13th gap question does not grow the collapsed card.

### P6 — Admin editor + coordinator severity page (M)
Per §5. Includes coordinator page rewiring, audit view, export endpoint.

### P7 — Governance hardening + cleanup (S)
Server-side ACTIVE-incident guard on assessment create/update (currently client-only via `IncidentSelector`); dead-code deletion (`updateSignalPriorities`/`derivePriorityFromIncident`, stale `useIncidents.ts:13` types); final grep sweep (small — P1's drop did the heavy lifting).

### P8 — Tests, docs, runbook (M)
Playwright: dynamic-form specs (selectors preserved) + admin label edit reflects on next form render + tier-B blocked under active incident + never-reject offline sync + collapse behavior + notification severity passthrough. Docs: API contracts, schema reference, development guide (add-a-question as admin vs seed), production runbook, admin authoring guide (rendered-context examples per Appendix B). Seed: **sample data is opt-in flag; questions-only is the prod default** (Q-6 inverted).

---

## 7. Fresh-Production Deployment Runbook

1. Deploy P1-lineage migration (creates registry tables; drops typed tables + gap_field_severities).
2. `prisma db seed` — **default seeds users/orgs/entities + question catalog, no sample assessments**; sample data only via `--with-sample-data`.
3. Set `DASHBOARD/gapRowsPerCategory = 5`.
4. Smoke: one assessment per type → derived severity → incident severity → notification priority → dashboard rendering (incl. POPULATION suppression).
5. Post-deploy: registry export saved as baseline; admin authoring guide handed to the D-1 owner.

Dev/staging: `prisma migrate reset && prisma db seed`. No backfill script (Q-7: reset; there is no production data to preserve).

---

## 8. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Runtime forms regress UX vs hand-tuned forms | Layout Contract transcription + screenshot fixtures + two-assessor human check before deleting old forms |
| e2e breakage | testids derived from keys match current values |
| Offline drift | Scoped freeze makes it rare; never-reject sync makes it harmless |
| Historical assessments unrenderable after deletion | Structure snapshot per assessment |
| Severity rewrite erodes report trust | Derivation rule + "as of" stamp + audit log + affected-count confirmation |
| Registry drift between seed and runtime edits | Reconciliation policy + export/diff procedure (§3) |
| Admin authors malformed gap phrases | Z5-context preview, char limits, data dictionary, domain-owner review of seed catalog |
| Dashboard crowding | severity × spread top-N, hinted chip, ceiling-documented setting |
| Losing the catalog | seed in git + registry export baseline post-deploy |

---

## 9. Decision Log (all resolved)

| ID | Decision |
|---|---|
| D-1 | ADMIN owns all question editing (structure + text); COORDINATOR severity-only via existing page |
| D-2 | Full editor ships now — no field-validation gate; named owner exists; mid-incident dev work is the failure mode to avoid |
| D-3 | Editable wording is the language-fix mechanism (multi-language remains a non-goal) |
| D-4 | Notification/signal severity inherits from source object now (P4); routing policy deferred with explicit trigger; system-health notifications keep fixed values (documented) |
| Q-1 | Severity = derivation rule; gapAnalysis is cache; Recalculate All deleted |
| Q-2 | Binary booleans; UI treats untouched as neutral (per-question gating) |
| Q-3 | Subsumed by D-1 |
| Q-4 | Dropped — superseded by per-question scoped freeze |
| Q-5 | Warn-only at >12 active GAP/type; never block |
| Q-6 | Sample data opt-in; questions-only default |
| Q-7 | Reset; no backfill script |
| Q-8 | Subsumed by D-4 |

---

## Appendix A — Verified severity pipeline (with D-4 completion)

```
Question.severity (DB, admin/coordinator-tunable)
  └─ answer + inverted flag → gap fields → assessment.severity = MAX(gapped), LOW if none   [derived, cached]
       └─ RapidAssessment.priority (derived, no client input)
            ├─ Entity severity (read-time MAX of latest assessments)         [situation/route.ts]
            ├─ Incident.severity = MAX(latest verified per (entity,type))    [incident-severity.service.ts]
            │     └─ fallback: preliminary casualty thresholds (unchanged)
            ├─ Response plan priority (auto-copied, UI-locked) → deliveries/signals
            ├─ Action signals (source-object passthrough)
            └─ Notifications (source-object passthrough — D-4, NEW)
```

Exceptions closed by this plan: POPULATION client priority; API priority injection (assessments + offline response sync); hardcoded notification MEDIUM; hardcoded situational signal values. Exceptions retained by design: preliminary casualty thresholds; fulfillment-based resource criticality; system-health notification values (Appendix C list).

## Appendix B — Question field data dictionary

| Field | Register | Example | Audience | Surfaces in |
|---|---|---|---|---|
| `label` | Question ("Is the clinic functional?") | Assessor, in the field | Form widget |
| `gapLabel` | Noun phrase | "No functional clinic" | Coordinator reading a list | Gap lists, dashboard rows, Z5 title |
| `gapMeaning` | Declarative sentence | "No functional healthcare facility exists in the assessed area" | Coordinator | Z5 detail, drill-down context |
| `recommendation` | Imperative | "Deploy mobile clinic team" | Coordinator | Gap detail, reports |
| `helperText` | Clarifying fragment | "At least one functional healthcare facility exists" | Assessor | Form description |

## Appendix C — System-health notifications (fixed severity, no inheritance)

Verification overdue (CRITICAL) · Population-cadence reminder (CRITICAL) · Sync/offline errors (fixed) · Account/system notices (fixed). All situational notifications inherit per §2.8.
