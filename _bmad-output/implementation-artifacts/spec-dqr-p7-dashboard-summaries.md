---
title: 'DQR P7 — Registry-Driven Situation Dashboard Summaries'
type: 'feature'
created: '2026-09-16'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 83dced67f1d705a365b70d8545ad9c2ea471ea79
context:
  - '{project-root}/docs/plans/dynamic-question-registry-plan.md'
  - '{project-root}/_bmad-output/implementation-artifacts/dynamic-question-registry-prompts/prompt-7-dashboard-summaries.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The Situation Dashboard's assessment-category summary renders ~24 hardcoded gap fields (`AssessmentCategorySummary.tsx` `fieldDefinitions` :109–193 + fallback severity lists :248–272; situation route per-type `*GapIndicators` arrays + `invertedFields` :1221 + `calculateFieldLevelGaps` :1198–1276) — the last of the plan's four hardcoded question copies (§1 #4). With an unbounded registry the card cannot enumerate every question.

**Approach:** Rank, don't enumerate (plan §2.7). The situation API embeds per-type question metadata (labels/meanings/order from the live registry — one staleness window) and computes a server-ranked top-N gap summary per category from stored `gapAnalysis` rows (severity × spread); the card renders ranked rows with a "+N more · X SEV" expandable overflow chip, collapses zero-gap categories, stamps "Severities as of registry v{contentVersion}", and the hardcoded taxonomy is deleted.

## Boundaries & Constraints

**Always:**
- Summary derives from **stored gapAnalysis** per latest verified/auto-verified assessment: key is gapped ⟺ key ∈ `gapAnalysis.gapFields`; row severity = MAX over reporting entities of stored `fieldSeverityMap[key]` (p3 recompute-on-edit keeps these fresh).
- Labels/meanings/order come from the live registry embedded in the payload (`QuestionRegistryService.getQuestionSet(type)`, 30 s cache). Ladder for keys absent from the live set: stored `gapAnalysis.rows` `gapLabel`/`label` fallback → key itself, `meaning: null`, `order: +∞` (never silently dropped).
- Ranking (normative §2.1/§2.7): severity DESC → spread DESC (entities reporting the gap) → registry order ASC → key ASC. Individual-entity cards: spread is constant 1, degrading to severity × order.
- `gapRowsPerCategory`: `SystemSetting` section `DASHBOARD`, key `gapRowsPerCategory`, JSON number; default 5, hard ceiling 7 (clamp 1..7 per §2.7).
- Overflow chip copy: `+{hidden} more · {count} {highestHiddenSeverity}` (§2.7 format), expandable ("Show fewer" toggle); hidden rows carry every overflow row, not just the hint.
- Zero-gap suppression: categories (aggregated) and entity cards (individual) with zero confirmed gaps render a collapsed variant (title + green "No Gaps" badge, no row list) — never empty rows nor a standing list.
- POPULATION stays special-cased: totals-only aggregate, never gap rows (zero GAP questions; card never mounts for it) — current behavior preserved.
- Stamp on each aggregated summary card: `Severities as of registry v{contentVersion} · {computedAt}` — contentVersion of that type from the payload embed.
- Gates: lint 0 new vs baseline; type-check clean; unit + api failure sets identical plus new suites; e2e baseline green; evidence `dqr-p7-dashboard.png`; commit `feat(questions): registry-driven situation dashboard summaries`.

**Never:**
- No admin editor UI, no settings admin surface for `gapRowsPerCategory` (p8 owns the UI; this prompt reads the setting only).
- No changes to the embed transport beyond what the summary consumes; no map (`7.4`), `getGapAnalysisSummary` rollup, notification, or gap-field-management changes.
- No Prisma schema changes; no re-derivation of assessments in the dashboard path (stored cache is authoritative; "Recalculate All" stays dead).
- No deletion of `fieldUnits` (presentation-only unit strings, not part of the gap taxonomy) and no touching `tests/legacy-backup/`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Aggregated ranking | HEALTH: keyA CRITICAL×2 entities, keyB CRITICAL×5, keyC HIGH×5 | Order: keyB, keyA (spread tiebreak), keyC | N/A |
| Overflow at limit | 8 distinct gapped keys, limit 5 | 5 rows + chip `+3 more · {n} {SEV}` (highest severity among hidden, count at that severity) | N/A |
| Setting clamp | Stored value 0 / 99 / missing / non-number | resolveGapRowLimit → 5 default; 99 → 7 ceiling; 0/invalid → 5 | Never throws |
| Zero-gap category | All entities report no gaps for SHELTER | Collapsed variant, `hasGaps:false`, `rows:[]`, overallSeverity LOW | N/A |
| Registry-deleted key | Gapped key absent from live registry set | Row kept: label from stored `gapAnalysis.rows` gapLabel→label→key, meaning null, order +∞ | Never silently LOW/dropped |
| Stamp | contentVersion 3, computedAt T | Every aggregated card shows `Severities as of registry v3 · {T}` | N/A |
| POPULATION | Population aggregate | Totals only, no gap summary, no card mount | N/A |
| No assessments | Type with zero latest assessments | Aggregate null (card renders "Assessment Missing" as today) | N/A |

</frozen-after-approval>

## Code Map

- `src/lib/questions/gap-summary.ts` — NEW pure module: `GapSeverity` reuse from `gap-engine.ts`; `CategoryGapRow {key,label,meaning,severity,spread,total,order}`, `CategoryGapSummary {rows,totalGapRows,hiddenCount,hiddenSeverityHint,hasGaps,overallSeverity,stamp}`, `GAP_ROWS_PER_CATEGORY_DEFAULT=5`, `GAP_ROWS_PER_CATEGORY_CEILING=7`, `resolveGapRowLimit(value)`, `rankGapRows`, `buildCategoryGapSummary({assessments, metadata, limit, contentVersion, computedAt})`. No I/O, no clock (computedAt injected).
- `src/lib/services/dashboard-config.service.ts` — NEW settings reader (pattern: `map-config.service.ts`): section `DASHBOARD`, key `gapRowsPerCategory`, `getGapRowsPerCategory()` → clamped via `resolveGapRowLimit`; 30 s TTL cache.
- `src/app/api/v1/dashboard/situation/route.ts` — DELETE `calculateFieldLevelGaps` :1198–1276, `getFieldSeverityFromDatabase` :1282–1290, per-type `*GapIndicators` arrays + `invertedFields`; replace six `aggregate*Assessments` with one generic `aggregateTypeGaps(entityAssessments, type, metadata, limit)` deriving from stored gapAnalysis (keep per-type `entitiesWithGaps/WithoutGaps`; drop dead totals like `totalHealthFacilities`); keep top-level `gapSummary` + `population` aggregate unchanged; payload gains `questionMetadata: { [type]: { questions: SummaryQuestionMeta[], structureVersion, contentVersion } }` (5 gap types, embedded once); GET handler :2261–2281 wires setting + metadata.
- `src/components/dashboards/situation/components/AssessmentCategorySummary.tsx` — DELETE `fieldDefinitions` :109–193, `getFieldSeverity` fallback lists :236–273, typed-data imports :11–18; new props `gapSummary?: CategoryGapSummary`, `questions?: SummaryQuestionMeta[]`; aggregated mode renders ranked rows (`gapLabel ?? label` + meaning + GapIndicator + "N of M" spread chip) + overflow chip + collapsed variant + stamp; individual mode renders gapped stored rows joined with metadata (severity × order ranked, same limit/chip), context box from CONTEXT metadata + assessment values; `fieldUnits` stays.
- `src/components/dashboards/situation/EntityAssessmentPanel.tsx` — pass `gapSummary`/`questions` per category from `aggregatedAssessments` / `questionMetadata`; shrink `AggregatedAssessments` interface (drop `fieldGapAnalysis`/totals).
- `src/components/dashboards/situation/executive/CompactAssessmentTile.tsx` — `fieldGapAnalysis.overallSeverity` (:129–130) → `gapSummary.overallSeverity`.
- `tests/unit/gap-summary.test.ts` — NEW pure suite (pattern: `tests/unit/gap-engine.test.ts`).
- Evidence: dev DB (`npm run db:seed`), set `DASHBOARD/gapRowsPerCategory`=2 + one severity bump via admin API for visible ranking/chip, screenshot `/coordinator/situation-dashboard` All-Entities view → `_bmad-output/implementation-artifacts/dqr-p7-dashboard.png`; reset setting to 5 after capture.

## Tasks & Acceptance

**Execution:**
- [x] `src/lib/questions/gap-summary.ts` — NEW pure ranking/summary module.
- [x] `src/lib/services/dashboard-config.service.ts` — NEW DASHBOARD settings reader.
- [x] `src/app/api/v1/dashboard/situation/route.ts` — registry-driven aggregation + `questionMetadata` embed; hardcoded taxonomy deleted.
- [x] `src/components/dashboards/situation/components/AssessmentCategorySummary.tsx` — ranked rows, chip, collapse, stamp; `fieldDefinitions` deleted.
- [x] `src/components/dashboards/situation/EntityAssessmentPanel.tsx` + `executive/CompactAssessmentTile.tsx` — rewire consumers.
- [x] `tests/unit/gap-summary.test.ts` — ranking order, chip math at ceiling, zero-gap suppression, stamp fields, setting respected.
- [x] Gates + evidence `dqr-p7-dashboard.png` + commit `feat(questions): registry-driven situation dashboard summaries`.

**Acceptance Criteria:**
- Given 8 distinct gapped HEALTH keys at limit 5, when the All-Entities view renders, then 5 ranked rows show and the chip reads `+3 more · {n} {SEV}`; expanding reveals the remaining 3.
- Given every entity reports zero SHELTER gaps, when the aggregated grid renders, then SHELTER renders the collapsed variant with no row list.
- Given an ADMIN edits a gapLabel/severity (p2/p3 paths), when the situation payload is next fetched, then labels/severity/order reflect the live registry and the stamp's contentVersion is the bumped one.
- Given `grep -rn "fieldDefinitions|invertedFields|GapIndicators" src/`, when run after implementation, then zero matches remain in the situation dashboard path.

## Implementation Notes

- `QuestionTypeMetadata` is exported from `gap-summary.ts` (next to `SummaryQuestionMeta`) and imported by both the situation route and `EntityAssessmentPanel` — the route/client projection shape cannot drift (review BH7).
- `getQuestionMetadata()` wraps each per-type `getQuestionSet` in try/catch: on registry failure the type degrades to `{questions: [], structureVersion: 0, contentVersion: 0}` and the card falls back to stored `gapAnalysis.rows` gapLabel→label→key (never a 500) (review BH2/EC1).
- Review patch suites added beyond the planned `gap-summary.test.ts`: `tests/api/dashboard-situation.test.ts` (route aggregation over stored engine-shaped gapAnalysis), `tests/unit/components/AssessmentCategorySummary.test.tsx` (rendering contract), `tests/unit/components/dashboards/situation/CompactAssessmentTile.test.tsx` (severity source), `tests/services/dashboard-config.test.ts` (setting reader DB round-trip + TTL cache).
- Aggregated zero-gap cards render the collapsed green box but no header severity badge (the header badge block requires `gapAnalysis`, individual-mode only); the green collapsed variant itself is the aggregated zero-gap presentation — pinned as such in the component test.

## Spec Change Log

## Review Triage Log

3 layers (blind-hunter floor 10, delivered 15; edge-case-hunter 6; verification-gap 4 pre-verified). Every finding verified at its cited location.

| # | Layer | Finding (short) | Verdict | Rationale / Evidence |
|---|-------|-----------------|---------|----------------------|
| BH1 | blind | IndividualEntityGapInfoPopup still hardcodes per-category gap fields | medium → **defer** | Verified (popup lines 22-183). Static educational copy — not the summary computation path prompt §1 targets ("in that path" = summary computation + embed flow). Registry-driven help content belongs to p8/p9 content alignment. → deferred-work.md |
| BH2 | blind | getQuestionMetadata has no error handling; registry failure 500s dashboard | **medium → patch** | Verified (route.ts:1996-1999). Inconsistent with getGapRowsPerCategory's documented "never throws". Trivial degrade-to-fallback-labels guard. |
| BH3 | blind | entitiesWithGaps (hasGap) vs card hasGaps (gapFields) divergent reads | **false** | gap-engine.ts:248-257: `gapFields` = distinct gapped row keys and `hasGap: gapped.length > 0` — engine output cannot diverge. |
| BH4 | blind | spread denominator includes null-gapAnalysis assessments | **false** | gap-summary.ts:235 documented semantics: `total` = latest assessments reporting (chip "N of M" = N of M assessed). Prompt §2 defines spread only. |
| BH5 | blind | individualSummaries computed unconditionally (waste in aggregated view) | **low → reject** | Verified (panel 151-159). Pure memoized compute over ≤100 entities; no I/O; guard adds complexity for no observable gain. |
| BH6 | blind | individualSummaries[index] positional consumption fragile | **false** | Panel 403-413 maps the SAME entityAssessments array the memo (151-159) is keyed on — indices provably aligned. VG layer independently verified safe. |
| BH7 | blind | QuestionTypeMetadata/AggregatedTypeGaps hand-duplicated route vs panel | **low → patch (partial)** | Verified. Client cannot import from a route module; extract `QuestionTypeMetadata` to gap-summary.ts (next to SummaryQuestionMeta) and import both sides — kills the flagged drift class trivially. |
| BH8 | blind | CompactAssessmentTile reads gapSummary.overallSeverity "against untyped counts object" | **false** | gap-summary.ts:79 — `overallSeverity: GapSeverity` exists on CategoryGapSummary; tile read (CompactAssessmentTile.tsx:129-131) is correct. |
| BH9 | blind | dead 'population' union member + dead fieldUnits entries | **low → reject** | Pre-existing surface; no runtime effect; population special-case display is preserved elsewhere per prompt §3. |
| BH10 | blind | dashboard-config.service untested; clearDashboardConfigCache "used by tests" dead | **medium → patch** | Valid verification gap; see VG4 (same root). |
| BH11 | blind | route still emits dead `indicators: []` | **false** | VG layer deliberate non-finding: not observable (kept for the `gaps[]` payload shape consumers). |
| BH12 | blind | overflow chip button suppresses focus ring, no aria-controls | **medium → patch** | Verified (AssessmentCategorySummary.tsx:236-245): `focus:outline-none` with no focus-visible replacement on an interactive control. |
| BH13 | blind | expanded state never reset when gapSummary changes → stale "Show fewer" | **false** | visibleRows (160-164) and chip label (242-244) both derive from the same `expanded` state — no divergent render possible; when hiddenCount=0 collapsed≡expanded. |
| BH14 | blind | full-layout branch re-implements context rows inline | **low → reject** | Cosmetic duplication only; no runtime defect; renderContextBox variant unification adds churn. |
| BH15 | blind | route.ts missing trailing newline + missing semicolon on import | **low → patch** | Verified (route.ts:11 no semicolon; EOF newline). Hygiene; lint-clean but inconsistent with repo convention. |
| EC1 | edge | getQuestionSet rejects → dashboard 500s | **medium → patch** | Same root as BH2 (one patch). |
| EC2 | edge | legacy NULL gapAnalysis rows counted as gap-free | **false** | Binding decision 1: no backward compatibility, app not live. All write paths store the engine result. |
| EC3 | edge | null-analysis assessments in N-of-M denominator | **false** | Duplicate of BH4. |
| EC4 | edge | duplicate key within stored gapFields → spread > entity count | **false** | Engine emits sorted distinct keys (gap-engine.ts:248-257). |
| EC5 | edge | hasGap:true + missing severity → green badge with gaps | **false** | Engine derives severity as max over gapped rows — always present when hasGap. |
| EC6 | edge | removal of read-time re-derivation breaks pre-migration null rows | **false** | Frozen Never: "no re-derivation… stored cache is authoritative" + binding decision 1. |
| VG1 | vg | route aggregation wiring (1989-2059) untested at any boundary | valid gap → **patch** | Regression demo accepted. → tests/api/dashboard-situation.test.ts seeding engine-shaped stored gapAnalysis. |
| VG2 | vg | AssessmentCategorySummary + panel rendering contract untested | valid gap → **patch (scoped)** | → jsdom component test for AssessmentCategorySummary (ranked rows, chip copy+expand, collapsed zero-gap, stamp); panel join is covered transitively by unit (buildIndividualGapSummary) + the new route test. |
| VG3 | vg | CompactAssessmentTile severity-source swap untested; silent LOW | valid gap → **patch** | Bug claim refuted (overallSeverity exists, BH8) but the contract is untested → jsdom test pinning CRITICAL pass-through. |
| VG4 | vg | getGapRowsPerCategory service (DB read/cache/fallback) untested | valid gap → **patch** | → tests/services/dashboard-config.test.ts per scoring-config pattern (seeded 3, invalid → 5, cache invalidation). Same root as BH10. |

**Routing summary:** patch groups — G1 resilience (BH2/EC1), G2 a11y+hygiene+type-drift (BH12, BH15, BH7), G3 verification (VG1, VG2, VG3, VG4/BH10). Defer — BH1. No intent_gap / bad_spec: every rejected finding is refuted at code level or by binding decisions, not by spec ambiguity.

## Design Notes

Chip hint semantics (from §2.7 example "+3 more · 2 HIGH"): highest severity among hidden rows + how many hidden rows sit at that severity. Spread display "N of M" reuses the existing aggregated count chip. Stamp renders on aggregated cards only (individual cards have no server-computed summary; prompt §4 says "summary card").

## Verification

**Commands:**
- `npm run lint` — expected: 0 new warnings vs p6 baseline
- `npm run type-check` — expected: clean
- `npm run test:unit` — expected: all green incl. new `gap-summary.test.ts`
- `npm run test:api` — expected: failure set identical to baseline
- `npm run test:baseline:e2e` — expected: 9/9 green

**Manual checks (if no CLI):**
- Screenshot evidence per Code Map: ranked rows, chip at ceiling, collapsed zero-gap category, stamp visible → `dqr-p7-dashboard.png`
