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

## From Review (2026-09-15, DQR P3)

- source_spec: `_bmad-output/implementation-artifacts/spec-dqr-p3-gap-engine-derivation.md`
  summary: `recomputeAssessmentsForKey` reads and rewrites every matching assessment inside the severity-edit interactive transaction — lock duration and memory grow with history.
  evidence: Real scaling debt once live (routine severity PATCH over thousands of ACTIVE-incident assessments could hold locks long enough to time out); negligible at current pre-live scale. Chunk the findMany/update loop or push key-containment filtering into the query when load warrants it.

- source_spec: `_bmad-output/implementation-artifacts/spec-dqr-p3-gap-engine-derivation.md`
  summary: `docs/api-contracts.md:271-272` still lists the deleted `POST/GET /rapid-assessments/update-priorities` endpoints, and the severity PATCH response-shape change (`data.severity` → `data.question.severity` + `affectedCount`) is undocumented.
  evidence: Verified stale against the P3 diff; prompt-3's out-of-scope defers docs to p9 — fold into the p9 documentation pass.

- source_spec: `_bmad-output/implementation-artifacts/spec-dqr-p3-gap-engine-derivation.md`
  summary: `gap-analysis.service.ts` uses one global cache timestamp for all assessment types, so per-type entries can outlive their 30 s TTL while other types keep refreshing the clock.
  evidence: Carried-over p1/p2 mechanism (`gapQuestionCache` had the identical single clock), now caching the full engine derivation input; fix is per-entry timestamps. Only matters if a write path ever misses `invalidateRegistryCaches`.

- source_spec: `_bmad-output/implementation-artifacts/spec-dqr-p3-gap-engine-derivation.md`
  summary: Seed derivation rewiring (`prisma/seed.ts` → gap engine) has no automated verification.
  evidence: No test executes the seed's `main()`; a future argument swap would seed all-LOW demo data with every suite green. Engine, snapshot builder, and the mirrored service create-path are each pinned, so residual risk is dev/demo-data only; a seed-derivation assertion harness would close it.

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
