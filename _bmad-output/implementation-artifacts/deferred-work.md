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
