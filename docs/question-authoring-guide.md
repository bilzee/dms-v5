# Question Authoring Guide

Everything an ADMIN or COORDINATOR needs to change what assessors are asked —
without a code change. The question registry (tables `question_sections` +
`questions`) is the single source of the assessment form for all six
assessment types, of gap severities, and of the snapshots assessments freeze
at submission.

- Admin editor: `/admin/settings/questions`
- Coordinator severity pinning: `/coordinator/settings/gap-field-management`
- API contracts: `docs/api-contracts.md` §4.25; data dictionary:
  `docs/schema-reference.md` ("Dynamic Question Registry — Data Dictionary")

## The model in one paragraph

An assessment type (HEALTH, POPULATION, FOOD, WASH, SHELTER, SECURITY) owns
**sections**; sections own **questions**. Sections and questions each carry a
`GAP` or `CONTEXT` category that must match each other. GAP questions are
BOOLEAN, required, and carry `gapLabel`/`gapMeaning`/`recommendation` plus a
`severity` (CRITICAL | HIGH | MEDIUM); a "gap fires" when the answer is
`false` (or `true` if `inverted`). CONTEXT questions add descriptive detail
(numbers, choices, free text). At submission the service freezes a
structure-only **question snapshot** onto the assessment row stamped with the
type's `structureVersion`/`contentVersion`.

## Naming rules (enforced)

| Thing | Convention | Examples | Renamable |
|---|---|---|---|
| Section key | kebab-case | `health-gaps`, `wash-details` | No (immutable) |
| Question key | camelCase | `hasFunctionalClinic`, `numberHealthFacilities` | No — 400 `question_key_immutable` |
| Row id | `{TYPE}:{key}` (seeded catalog) | `HEALTH:hasFunctionalClinic` | — |

Keys are the stable identity used in `answers` maps, drafts, offline sync,
and stored snapshots — that is why they can never be renamed. Change the
**label** when you want different wording; the key stays.

## The Tier matrix — what a change costs

| Tier | Changes | Version bumped | Who can do it when |
|---|---|---|---|
| **A (content)** | `label`, `helperText`, `gapLabel`, `gapMeaning`, `recommendation`, `severity`, option **label** edits and option **appends** | `contentVersion` | ADMIN, anytime |
| **B (structure)** | `questionType`, `category`, `inverted`, `required`, section move, `numberMin`/`numberMax`, option-value **removal**, create/deactivate/reorder of sections or questions | `structureVersion` | ADMIN, but freeze-gated |

**Freeze rule (409 `question_frozen`):** structural changes to a question are
refused while any **non-DRAFT** assessment's frozen snapshot still references
the old structure. Wait for those assessments to be verified/rejected (or
accept the 409 as "not yet"), then retry. Content edits are never frozen.

**Structural invariants (400 `registry_invalid`):** GAP ⇒ BOOLEAN + required +
gap metadata; question category must match its section; each non-POPULATION
type must keep at least one active GAP question; option values must be
non-empty and unique; number bounds must satisfy min ≤ max.

## Recipes

### Change wording an assessor sees (Tier A)

1. `/admin/settings/questions` → pick the type tab → search for the question.
2. Edit (pencil) → change **Question Text** (`label`) and optionally the
   helper text / GAP phrasing / recommendation.
3. Enter a **reason** (audited) → Save.
4. The type's content version badge bumps (e.g. `content v1` → `content v2`).
   Assessors opening the form immediately see the new wording; in-flight
   offline clients see it after their next registry pull and are **never
   rejected** — their next submission simply snapshots the newer content.

### Pin or change a gap severity (Tier A)

Coordinator severity page (`/coordinator/settings/gap-field-management`) —
bulk-select GAP rows, choose CRITICAL/HIGH/MEDIUM, confirm. Or per question
in the admin editor's severity field, or `PATCH /api/v1/admin/questions/{id}/severity`.
Severity changes affect **newly submitted** assessments: priority, gap
analysis, notifications, and action signals all inherit the registry severity
of the failed question (top gap wins). Stored assessments keep the snapshot
they were filed under.

### Add a question (Tier B)

1. `/admin/settings/questions` → type tab → **Add Question** inside a section
   (or **Add Section** first: kebab-case key, GAP or CONTEXT category).
2. Choose a camelCase key that does not exist yet in that type, the question
   type, and matching category.
3. GAP questions: leave **inverted** off unless the gap fires on `true`;
   write `gapLabel`/`gapMeaning`/`recommendation`; pick a severity.
4. Reason → Save. `structureVersion` bumps.

New required questions are the one case that can make a **draft** stale:
in-flight drafts auto-migrate (answers kept, new fields blank, a staleness
banner lists the additions) and submissions still succeed — but expect
assessors to revisit drafts to fill the new fields.

### Deactivate a question (Tier B, freeze-gated)

Edit menu → Deactivate. The editor first fetches an impact preview
(assessments referencing the question); deactivating the last active GAP of a
non-POPULATION type is refused. Deactivated rows disappear from forms and the
assessor question manifest but stay in stored snapshots and answers
(dashboards keep rendering history through the snapshot).

### Reorder sections or questions (Tier B)

The up/down controls stage a reorder; confirm with a reason. Order changes
are presentation-only but still bump `structureVersion` because they change
the snapshot shape.

### Audit and export

- Every mutation lands in `QuestionAuditLog` (actor, action, after-diff,
  before-image, reason) — visible in the editor's per-question **Audit**
  timeline.
- **Export** downloads the full registry (sections + questions + versions) as
  JSON — archive it before risky structural sessions.

## Admin edits vs the seed catalog (reconciliation policy)

`prisma/seed.ts` (via `npx prisma db seed`) is a **bootstrap** for empty
 databases, not a synchronization tool:

- The seed is idempotent in the sense of *converging the registry to the
  seeded catalog*. On a database where ADMINs edited questions at runtime,
  re-running the seed **overwrites those edits** back to the seeded values
  (bumping `contentVersion` and writing audit rows for every reverted
  question).
- Therefore, on any environment with runtime registry edits, the **export
  JSON is the source of truth**, not the seed. Take an export
  (`/admin/settings/questions` → Export) before re-seeding anything, and
  re-apply your edits afterward if the seed ran.
- Fresh environments (production deploys, CI, the E2E global-setup) start
  from the seed and are expected to be at `structureVersion`/`contentVersion`
  `1/1` per type; that is the only situation in which the seed and the truth
  coincide.
- To refresh *only* the registry on a pristine database, use
  `prisma/seed-questions.ts` directly (the E2E baseline suite's global setup
  does exactly this).

## The offline drift contract (what admins promise field assessors)

1. **Content edits never reject.** Labels, helpers, phrasing, severity, and
   option copies/appends only bump `contentVersion`; an offline client with
   older content submits fine (warnings at most).
2. **Structural edits never reject either** — they bump `structureVersion`
   and the client's stale answers are mapped by key: known keys validate,
   unknown keys ride along as warnings, retired keys keep their stored values.
3. **Drafts auto-migrate** across both tiers (see above).
4. What *does* fail an offline item: unknown assessment type, unassigned
   entity, an empty registry for the type, or a dangling incidentId (FK).
   Incident **state** never fails an offline item: the P9 ACTIVE-incident
   guard (404/409) applies to online submissions only — an incident resolved
   while the assessor was offline does not discard their completed work.

## Checklist before a structural change

- [ ] Exported the registry (`Export` button)?
- [ ] Checked the freeze state (does the editor show frozen banners)?
- [ ] Picked a camelCase key that reads like an answer (`hasX`, `numberY`)?
- [ ] GAP questions: severity + `gapLabel`/`gapMeaning` + `recommendation` set?
- [ ] Reason written for the audit log?
- [ ] Told field teams their drafts will list the new/changed fields?

## Appendix A — the five text registers

Each GAP question carries five independently-authored text fields. They are
rendered in different places, at different sizes, for different audiences —
author each one for its surface, and keep them consistent with each other:

| Field | Where it renders | Audience | Register |
|---|---|---|---|
| `label` | Assessor form (question text) | Field assessor | Short noun phrase or direct question, sentence case ("Functional Clinic", "Is there a functional health clinic?") |
| `helperText` | Assessor form (under the question) | Field assessor | Clarification only — definitions, edge cases, what counts ("At least one functional healthcare facility exists") |
| `gapLabel` | Dashboard/report gap row | Coordinator/donor | Noun phrase of the *gap state*, not the question ("No functional clinic") |
| `gapMeaning` | Dashboard gap row (sub-line) | Coordinator | Operational consequence in one sentence ("No functional healthcare facility exists in the assessed area") |
| `recommendation` | Gap analysis / verification views | Coordinator/responder | Action imperative ("Deploy mobile clinics or establish temporary health facilities") |

Rules of thumb: `gapLabel` should read naturally after "Gap: " and must not
repeat the question; `label` and `gapLabel` should differ (they render on
opposite sides of the submission); keep `gapMeaning` under ~120 characters
because the dashboard sub-line truncates.

### Worked example — `HEALTH:hasFunctionalClinic` (seeded values)

| Field | Seeded value |
|---|---|
| `label` | Functional Clinic |
| `helperText` | At least one functional healthcare facility exists |
| `gapLabel` | No functional clinic |
| `gapMeaning` | No functional healthcare facility exists in the assessed area |
| `recommendation` | Deploy mobile clinics or establish temporary health facilities |
| `severity` | MEDIUM (seeded; edit to pin) |

Rendered: the assessor sees the `label` (with `helperText` beneath); when
answered `false` the gap engine fires, the dashboard row shows **"No
functional clinic"** with the `gapMeaning` sub-line and a MEDIUM indicator,
and the gap analysis lists the `recommendation`.
