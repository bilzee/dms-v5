# Deferred Work — Brand Customization

## From Review (2026-06-08)

### SVG XSS risk via upload endpoint
- **Severity**: medium
- **File**: `src/app/api/v1/system/branding/upload/route.ts`
- **Detail**: SVG files with embedded JavaScript are accepted. While `<img src>` sandboxing mitigates execution, the SVG is stored on the server and accessible via direct URL. Consider removing SVG from `ALLOWED_TYPES` or adding CSP headers to the storage download endpoint.

### Orphaned uploaded files on save failure
- **Severity**: medium
- **File**: `src/app/(auth)/admin/settings/branding/page.tsx`
- **Detail**: If icon upload succeeds but "Save" fails, the uploaded file remains in storage with no reference. Each re-upload also creates a new file without deleting the old one. Consider adding cleanup logic when replacing icons.

### No magic-byte file validation on upload
- **Severity**: low
- **File**: `src/app/api/v1/system/branding/upload/route.ts`
- **Detail**: File type validation relies solely on `file.type` from FormData, which is client-controlled. Server should validate magic bytes / file signatures.

### generateMetadata DB query on every request (no server cache)
- **Severity**: low
- **File**: `src/app/layout.tsx`
- **Detail**: `generateMetadata()` calls `prisma.systemSetting.findMany()` on every request. Consider adding in-memory caching with TTL (e.g., Next.js `unstable_cache`).

### Duplicate branding defaults across 3 files
- **Severity**: low
- **Files**: `src/app/layout.tsx`, `src/hooks/useBranding.ts`, `src/app/api/v1/system/settings/route.ts`
- **Detail**: Default values for appName, appDescription are duplicated. Extract to a shared `src/lib/constants/branding.ts`.

### Empty catch blocks should log errors
- **Severity**: low
- **Files**: `src/app/layout.tsx:26`, `src/app/api/v1/manifest/route.ts`
- **Detail**: Catch blocks silently swallow errors. Should at minimum `console.error` for production debuggability.

## From Review (2026-09-15)

- source_spec: `_bmad-output/implementation-artifacts/spec-dqr-p2-registry-service-api-governance.md`
  summary: `LOGISTICS` passed as an assessment type at `src/lib/services/action-signal.service.ts:289` throws `PrismaClientValidationError` because `LOGISTICS` is a `ResponseType`, not a Prisma `AssessmentType`.
  evidence: Pre-existing failure path present in the prompt-1 baseline, outside the P2 diff (confirmed in `dqr-p1-*` review logs); the query with an enum-invalid `assessmentType` value throws at Prisma query validation. Settling/fixing belongs to the action-signal owner: guard the type before the query or map `LOGISTICS` to a valid assessment-type context.
  status: RESOLVED (verified 2026-09-17) — `LOGISTICS` no longer appears anywhere in `action-signal.service.ts`; signal creation now guards the type (`payload.assessmentType || 'HEALTH'` / `|| ''` at src/lib/services/action-signal.service.ts:99,117,137), so the enum-invalid Prisma query path is gone.

## From Review (2026-09-15, DQR P3)

- source_spec: `_bmad-output/implementation-artifacts/spec-dqr-p3-gap-engine-derivation.md`
  summary: `recomputeAssessmentsForKey` reads and rewrites every matching assessment inside the severity-edit interactive transaction — lock duration and memory grow with history.
  evidence: Real scaling debt once live (routine severity PATCH over thousands of ACTIVE-incident assessments could hold locks long enough to time out); negligible at current pre-live scale. Chunk the findMany/update loop or push key-containment filtering into the query when load warrants it.
  status: RESOLVED (2026-09-18, P10-1) — the candidate scan now runs OUTSIDE the severity-edit interactive transaction (`scanRecomputeCandidates` on plain `prisma`: cursor-paginated `id: { lt: cursor }`, 200-row `RECOMPUTE_PAGE_SIZE` pages, key-containment post-filter), and inside the transaction only the pre-scanned ids are re-verified (`questionSnapshot: { not: Prisma.DbNull }`, incident-still-ACTIVE re-check, key-containment) and rewritten with the existing per-row derive in 200-row chunks; a rare identity-edit race falls back to an in-tx scan, and the whole recompute is idempotent (severity row updates first; derive is pure per row; a retry converges — see `src/lib/services/question-registry.service.ts` `recomputeAssessmentsForKey`).

- source_spec: `_bmad-output/implementation-artifacts/spec-dqr-p3-gap-engine-derivation.md`
  summary: `docs/api-contracts.md:271-272` still lists the deleted `POST/GET /rapid-assessments/update-priorities` endpoints, and the severity PATCH response-shape change (`data.severity` → `data.question.severity` + `affectedCount`) is undocumented.
  evidence: Verified stale against the P3 diff; prompt-3's out-of-scope defers docs to p9 — fold into the p9 documentation pass.
  status: PARTIALLY RESOLVED (verified 2026-09-17) — the stale `update-priorities` rows are gone from `docs/api-contracts.md` §4.10 and the severity endpoint is now documented (§4.25, `PATCH /admin/questions/{id}/severity`); still open: the response shape (`data.question.severity` + `affectedCount`) remains undocumented.
  update: RESOLVED (2026-09-18, P10-2) — `docs/api-contracts.md` §4.25 now documents the full severity PATCH response `{ data: { question, affectedCount, affectedIncidentIds } }` (the incident ids of the re-derived ACTIVE-incident population, surfaced by the P10-2 route fix), alongside the new cross-field rule endpoints (`/admin/rules` POST/PUT/DELETE + `/admin/rules/{id}/audit`), the `/questions` `rules` extension, the REFINEMENT enforcement semantics with the offline `/sync/batch` exemption, and the refreshed endpoint/handler distribution tables.

- source_spec: `_bmad-output/implementation-artifacts/spec-dqr-p3-gap-engine-derivation.md`
  summary: `gap-analysis.service.ts` uses one global cache timestamp for all assessment types, so per-type entries can outlive their 30 s TTL while other types keep refreshing the clock.
  evidence: Carried-over p1/p2 mechanism (`gapQuestionCache` had the identical single clock), now caching the full engine derivation input; fix is per-entry timestamps. Only matters if a write path ever misses `invalidateRegistryCaches`.
  status: RESOLVED (2026-09-18, P10-1) — the registry-view cache is now `Map<AssessmentType, { view, expiresAt }>` with a per-entry 30 s TTL and lazy pruning of expired entries; loading one type never refreshes another type's clock (pinned by the per-entry TTL unit test in `tests/unit/gap-analysis.test.ts`).

- source_spec: `_bmad-output/implementation-artifacts/spec-dqr-p3-gap-engine-derivation.md`
  summary: Seed derivation rewiring (`prisma/seed.ts` → gap engine) has no automated verification.
  evidence: No test executes the seed's `main()`; a future argument swap would seed all-LOW demo data with every suite green. Engine, snapshot builder, and the mirrored service create-path are each pinned, so residual risk is dev/demo-data only; a seed-derivation assertion harness would close it.
  status: PARTIALLY RESOLVED (verified 2026-09-17) — `tests/api/seed-partition.test.ts` now executes the seed's `main()` (both the default and `--with-sample-data` forms, as real child processes against drms_test); still open: it asserts row partitioning, not severity derivation, so a derivation argument swap on the demo assessments would still pass green.
  update: RESOLVED (2026-09-18, P10-1) — the `--with-sample-data` leg now also asserts, for every seeded `rapidAssessment` row, that the stored `gapAnalysis` equals `analyzeGaps(row.questionSnapshot, row.answers, registryRows)` and that `priority === derivation.severity`, PLUS pins the exact demo derivation matrix (HEALTH/WASH/FOOD/SECURITY=MEDIUM, SHELTER=LOW), so a derivation argument swap fails the api suite. Plan note: the plan's "≥1 CRITICAL, ≥1 HIGH" spread is unachievable against the seeded catalog (every GAP question in `QUESTION_CATALOG` is severity MEDIUM); widening the spread is Tier A catalog authoring deferred to the P10-5 polish pass.

## From Spec Decision (2026-09-15, DQR P4)

- source_spec: `_bmad-output/implementation-artifacts/spec-dqr-p4-dynamic-assessment-form.md`
  summary: Replace the hardcoded client-side cross-field rules module (`src/lib/questions/cross-field-rules.ts`, decided Q2=B) with an assessment-wide cross-validation layer backed by the question registry.
  evidence: The registry cannot express cross-field rules today (plan §2.1/§3 extraction omitted them), so the 12 legacy predicates (POPULATION 8 sum-exceeds-total, FOOD 2, WASH 1, SHELTER 1) survive as a per-key client-side island; server-side enforcement is an accepted parity loss until a registry rule language exists.

## From Review (2026-09-15, DQR P4)

- source_spec: `_bmad-output/implementation-artifacts/spec-dqr-p4-dynamic-assessment-form.md`
  summary: Multi-select answers replayed from stale offline queues can arrive as JSON strings (`"[\"Malaria\"]"`) instead of arrays; only the live form guarantees array shape (`coerceArray`).
  evidence: The offline sync path (p5) owns replay serialization; `src/lib/questions/answers.ts` coerces at the form boundary but nothing at the transport/service boundary does. Fix belongs to the p5 offline queue replay work (normalize or reject string-encoded arrays there).

- source_spec: `_bmad-output/implementation-artifacts/spec-dqr-p4-dynamic-assessment-form.md`
  summary: The edit page's `fromAnswers(...)` read side is catalog-bound (`src/lib/questions/answers.ts` typed defaults), so reading an assessment whose answers reference renamed/removed registry keys renders blanks even though the snapshot on the row still has the old definitions.
  evidence: Read-side hydration uses the live `useQuestionSet` view, not the row's frozen `questionSnapshot`; correctness of the snapshot for derivation is unaffected (p3 pins). Fix belongs with the p7/p9 read-side work that renders from the stored snapshot when keys drift.
  status: OPEN (browser-confirmed 2026-09-17) — Situation Dashboard CONTEXT values render "N/A" for admin-authored post-seed keys: `fromAnswers` (`src/lib/questions/answers.ts:65-96`) only emits static `QUESTION_CATALOG` keys, and the situation route (`route.ts:974-991`) spreads that filtered payload into `latestAssessments`. GAP rows are unaffected (they flow from the stored `gapAnalysis`). Fix: hydrate read-side values from the stored snapshot when keys drift.
  update: RESOLVED (2026-09-18, P10-1) — new pure `hydrateFromSnapshot(structure, answers)` in `src/lib/questions/answers.ts` (typed values for every snapshot key, raw passthrough + `unmappedKeys` for drift; `fromAnswers` is now a byte-identical catalog wrapper over it); all six per-type situation readers plus the POPULATION aggregation hydrate from the row's frozen `questionSnapshot` with `fromAnswers` fallback for snapshot-less rows (post-seed keys render instead of "N/A", pinned by api tests); the edit form renders snapshot-only answered keys in a read-only drift block (`snapshot-drift-block`, new optional `snapshot` prop) and the view page gets a generic read-only "Additional Registry Answers" card (pinned by unit + component tests and `tests/e2e-baseline/assessment-drift.spec.ts`).

- source_spec: `_bmad-output/implementation-artifacts/spec-dqr-p4-dynamic-assessment-form.md`
  summary: `test:api` (jest, drms_test@5435) and `test:baseline:e2e` (Playwright, port 3100) share the `drms_test` database; running them concurrently truncates rows under each other.
  evidence: Both suites truncate/assert against `drms_test` by design (separate npm scripts, sequential in local runs); no CI pipeline exists yet. Fix belongs to CI pipeline setup: serialize the suites (or give e2e its own DB) when the pipeline is added.


## From Review (2026-09-16, DQR P5)

- source_spec: `_bmad-output/implementation-artifacts/spec-dqr-p5-offline-sync-draft-migration.md`
  summary: Offline create falls back to `incidentId: (data.incidentId as string) || change.entityUuid`, so a payload without an incident id silently stores an ENTITY id in the incident column.
  evidence: Verbatim baseline line in `sync-processing.service.ts` predating the P5 diff (BH11/E3 at review); pre-P5 offline creates already wrote it, so tightening is a behavior change to the sync owner. Fix: drop the fallback or validate the id shape as an incident.

- source_spec: `_bmad-output/implementation-artifacts/spec-dqr-p5-offline-sync-draft-migration.md`
  summary: The offline update producer (`assessment-offline.service.ts`) enqueues changes keyed by `entityId`, but the sync update branch resolves rows by row-id `entityUuid` — no current producer can reach the update path.
  evidence: Pre-existing legacy wiring (O-3b at review): the queue stores `entityId` while `processOfflineChange` updates `findUnique({ where: { id: change.entityUuid } })`. Latent until a producer sends update changes; fix by enqueueing the assessment row id.

- source_spec: `_bmad-output/implementation-artifacts/spec-dqr-p5-offline-sync-draft-migration.md`
  summary: Offline update accepts `data.entityId`/`data.incidentId` without re-validating the syncing user's entity assignment (only assessment ownership is checked).
  evidence: BH12 at review: mirrors the ONLINE update path, which also accepts re-pointed entity/incident ids without assignment checks — accepted parity, not a P5 regression. Fix belongs to a cross-cutting sync-authorization pass covering both paths.

## From Review (2026-09-16, DQR P6)

- source_spec: `_bmad-output/implementation-artifacts/spec-dqr-p6-notification-severity-inheritance.md`
  summary: `src/lib/services/commitment.service.ts:212` dispatches `donorId: data.donorId` (a Donor organization id) where the signal engine consumes `payload.donorId` as a recipient USER id — the donor branch of commitment signals FK-fails silently and kills subsequent responder rows in the same evaluator run.
  evidence: Pre-existing, outside the P6 diff (finding #19, defer route). The real API surface (`donors/[id]/commitments/route.ts:326`) passes a user id correctly; only the service-internal caller conflates ids. Fix belongs to the commitment/signal owner: pass the donor's linked user id (or resolve it) at dispatch.

## From Review (2026-09-16, DQR P7)

- source_spec: `_bmad-output/implementation-artifacts/spec-dqr-p7-dashboard-summaries.md`
  summary: `IndividualEntityGapInfoPopup.tsx:22-183` still carries a hardcoded static field/explanation list (labels + meanings per assessment type) that will drift from the registry's live `gapLabel`/`gapMeaning` values.
  evidence: BH1 at review. The popup is static educational help copy explaining what each gap field means — it is NOT on the P7 summary computation path (summaries derive labels/meanings from the live registry projection, pinned by the new unit/api suites). Rewiring the popup to render from `questionMetadata` belongs with the p9 documentation/read-side pass.

## From Review (2026-09-17, DQR P9)

- source_spec: `_bmad-output/implementation-artifacts/spec-dqr-p9-hardening-holistic-gate-close.md`
  summary: Catalog wording/option-value polish — seeded catalog rows with inconsistent label registers (noun phrase vs question, e.g. `Functional Clinic`) and choice options whose `value`/`label` pairs are not normalized (`'River/Stream'`, `'Water trucks'` vs Title Case labels).
  evidence: Blind-hunter findings at P9 review, traced to the pre-existing P1 catalog (`src/lib/questions/registry-validation.ts` QUESTION_CATALOG) — outside the P9 diff. Renaming labels is Tier A content churn (bumps every type's `contentVersion`, reverts on re-seed per the reconciliation policy in `docs/question-authoring-guide.md`) with zero behavioral effect; bundle with a deliberate catalog-authoring pass if wanted. The authoring guide's Appendix A now documents the target registers.


## From Review (2026-09-18, DQR P10-1)

- source_spec: `_bmad-output/implementation-artifacts/spec-dqr-p10-p1-read-side-hardening.md`
  summary: `docs/operation-manual-ui.html` — a third UI operation manual that is an unreferenced planning orphan: zero inbound references anywhere in `_bmad-output/` or `docs/`, content stale at birth (predates the P4 dynamic form), dead scroll-spy code, and a TOC null-deref.
  evidence: BH12/BH13/BH14 + EC7 at review — pre-existing untracked planning artifact (`git status` shows it staged alongside this story's tree but nothing caused by the P10-1 diff); excluded from this story's commit. Fix belongs to a docs owner: delete it or fold its still-true content into the p9 documentation pass (`docs/question-authoring-guide.md` / api-contracts).

- source_spec: `_bmad-output/implementation-artifacts/spec-dqr-p10-p1-read-side-hardening.md`
  summary: `_bmad-output/implementation-artifacts/dqr-p10-prompts/prompt-5-*.md` mixes pnpm and npm commands in its gate chain, so a verbatim run would install a second package-manager lockfile and diverge from the repo's npm-based gates.
  evidence: BH15 at review — pre-existing planning input, not this story's diff. Fix belongs to the P10-5 execution pass: normalize the prompt's commands to the npm scripts the earlier prompts use (`npm run lint && npm run type-check && ...`).

- source_spec: `_bmad-output/implementation-artifacts/spec-dqr-p10-p1-read-side-hardening.md`
  summary: Nine sibling latest-assessment readers elsewhere in the situation route remain catalog-bound (`fromAnswers`), so post-seed snapshot keys render "N/A" on those older read paths even though the seven P10-1 readers (six per-type + POPULATION aggregation) now hydrate from the stored snapshot.
  evidence: VG-F4 at review — pre-existing read paths untouched by this story's frozen scope (the spec's Code Map lists only `findLatestTypedAssessment` + the POPULATION reader). Fix belongs to a follow-up read-side pass: route those readers through `hydrateAnswersFromRow` exactly as the P10-1 readers do.


## From Review (2026-09-18, DQR P10-2)

- source_spec: `_bmad-output/implementation-artifacts/spec-dqr-p10-p2-rule-registry-backend.md`
  summary: Seed drift-update unconditionally writes `isActive: true` on rule rows (`prisma/seed-rules.ts` diff comparator), so a re-seed resurrects an admin-deactivated rule with no version bump or governed audit — the DB silently diverges from the admin's governance record.
  evidence: Finding 10 (ECH4/BH2) at review, verified real — but `prisma/seed-questions.ts:113` carries the identical comparator for the 55 questions, and plan §4.3 binds "registry baseline like the 55 questions"; the reconciliation-over-governance policy predates this story. Fix belongs to a deliberate seed-policy pass covering BOTH seeds (e.g. skip isActive reconciliation on existing rows, or record it as a governed REACTIVATE audit + structure bump), not a rules-only carve-out.

- source_spec: `_bmad-output/implementation-artifacts/spec-dqr-p10-p2-rule-registry-backend.md`
  summary: `GET /admin/questions/export` omits cross-field rules, so an export-based registry migration (export → import into a fresh deployment) silently loses admin-authored rules and re-seeding yields only the 15 baseline rows.
  evidence: Finding 11 (BH11) at review — the export route predates P10-2 and was outside this story's frozen scope; dedicated DB backups are unaffected. Fix belongs to a registry-portability pass: extend the export payload with `rules` (+ an import counterpart) and pin with a round-trip test.

- source_spec: `_bmad-output/implementation-artifacts/spec-dqr-p10-p2-rule-registry-backend.md`
  summary: `prisma/seed-essential.ts` rule wiring has no executable verification — only `prisma/seed.ts` (both partitions) is pinned by `tests/api/seed-partition.test.ts` child-process runs; a regression that drops `seedCrossFieldRules` from the essential partition would pass every suite.
  evidence: Finding 12 (VG-V4, pre-verified) at review — `seedCrossFieldRules` itself is pinned (15-row count + drift behavior via the seed.ts runs and `tests/unit/rule-engine.test.ts` seed completeness), so residual risk is the one call site in `seed-essential.ts` only; a third child-process seed run was judged to outweigh that residual risk. Revisit if the essential partition gains rule-dependent behavior.

