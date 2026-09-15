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

