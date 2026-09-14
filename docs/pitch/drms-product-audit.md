# DRMS — Implemented Product Audit

**Auditor:** Mary (Business Analyst)
**Subject:** Disaster Response Management System (DRMS), repo `dms-v4-bmad-v6`
**Method:** Direct inspection of source code (Next.js 14 app, Prisma schema, API routes, services, seed data, deployment manifests). No claims inferred from planning docs.
**Caveats:** Severity flags `UNCLASSIFIED` exist on seeded incidents. Some aggregation helpers in `situation/route.ts` (`getAggregatedAssessments`, lines ~940-1009) still hold hardcoded mock numbers — but production path uses the dynamic aggregators (`aggregateHealthAssessments`, etc.), so the mock function is dead code rather than a live lie.

---

## 1. Product Reality Snapshot

1. **Name & purpose.** "Disaster Response Management System" (DRMS), branded in `public/manifest.json` as a "Comprehensive disaster response management and humanitarian assessment PWA". Internal package name: `disaster-response-management-system` (`package.json:2`).
2. **Usable as a DRMS today?** Yes — it is a **functional, role-based, multi-tenant web application**, not a prototype. Real Postgres-backed persistence, RBAC-enforced API, full assessment-to-response lifecycle, dashboards, and reporting are wired end-to-end. It ships with seeded demo data (Borno LGAs, demo users, sample incident, full assessment set) so the lifecycle is demonstrable out of the box.
3. **Platforms actually supported.**
   - **Mobile-responsive web app** (Tailwind, Radix UI).
   - **Installable PWA** (`public/manifest.json`, `next-pwa` runtime caching in `next.config.js`, service worker `public/sw.js`, offline fallback `public/offline.html`, install prompt component at `src/components/pwa/InstallPrompt.tsx`). Disabled in dev unless `PWA_TESTING=true`; always on in production builds.
   - **No native Android/iOS clients** and no desktop (Electron/Tauri) build.
4. **Production deployment configuration.** Fully specified in `docker-compose.production.yml` (272 lines): Postgres, Redis, MinIO (S3-compatible object storage), Next.js app container (`Dockerfile.production`, standalone output), `db-backup` service, Traefik reverse proxy with Let's Encrypt. Production env template (`.env.production.template`) and `scripts/setup-production-env.js` exist. Whether it is *currently deployed* to a live host is **unclear / needs manual verification** — only that the config is real.
5. **Strongest 5–7 truthful claims.**
   - Multi-role humanitarian platform (Assessor, Coordinator, Responder, Donor, Admin) with backend-enforced RBAC.
   - Structured rapid-needs assessment across all six sectors (Health, WASH, Shelter, Food, Security, Population) with GPS capture and media attachments.
   - Genuinely offline-capable PWA: Dexie/IndexedDB local store + AES-GCM client-side encryption + sync engine with retry/backoff/conflict handling.
   - End-to-end verification workflow (draft → submitted → verified/auto-verified/rejected) for both assessments and deliveries, with full audit logging.
   - Donor accountability loop: commitments → response plans → deliveries → coordinator verification, surfaced on donor dashboards and gamified leaderboard.
   - Configurable, severity-based gap analysis with per-field severity management (admin-configurable), driving both the situation dashboard and resource-management view.
   - Report generation in PDF / CSV / Excel / HTML, with scheduled reports and chart-image export.

---

## 2. Implementation Status Matrix

Legend: **FU** = Fully implemented & user-facing · **PA** = Implemented but partial · **BO** = Backend/data-model only · **MO** = UI mock/demo only · **FF** = Feature-flagged or not enabled · **PL** = Planned but not implemented · **NP** = Not present · **?** = Needs manual verification.

| Feature / Claim | Status | User-Facing? | Backend Support? | Evidence in Codebase | What Actually Works | Limitations / Caveats | Confidence |
|---|---|---|---|---|---|---|---|
| Role-based auth (5 roles) | FU | Yes | Yes | `prisma/schema.prisma:108-153`, `src/lib/auth/route-config.ts`, `src/middleware.ts` | Login, role assignment, route guard per role | — | High |
| Multi-role per user + dynamic switching | FU | Yes | Yes | `UserRole` join table, seed user `multirole@dms.gov.ng`, `/roles` page | One user can hold several roles, switch via UI | — | High |
| Affected entities (Community/Ward/LGA/State/Facility/Camp) | FU | Yes | Yes | `Entity` model, `/api/v1/entities/*`, `seed-borno-lgas.ts` | CRUD, hierarchy via type enum, GPS as JSON | Hierarchy is conceptual (type enum), not a strict parent-child FK | High |
| GPS coordinates on entities | FU | Yes | Yes | `Entity.coordinates Json?`, `PreliminaryAssessment.reportingLatitude/Longitude` | Captured, stored, rendered on map | Coordinates stored as JSON blob, not PostGIS | High |
| Incidents + lifecycle (Active→Contained→Resolved) | FU | Yes | Yes | `Incident` model, `/api/v1/incidents/*`, `incident-severity.service.ts` | Create, list, severity recomputation | Only 3 statuses (no "Closed" or "Archived") | High |
| Preliminary assessments | FU | Yes | Yes | `PreliminaryAssessment`, `/api/v1/preliminary-assessments/*`, `/assessor/preliminary-assessment` | Full form (lives lost, injured, displaced, facilities affected) | Standalone; not all fields propagate to dashboard | High |
| Rapid assessments (6 categories) | FU | Yes | Yes | `RapidAssessment` + 6 sub-models (`HealthAssessment`…), `/api/v1/rapid-assessments/*` | All 6 sector forms with rich field sets | "Population" form does not feed gap analysis (by design) | High |
| Draft / submit / verify / reject / resubmit workflow | FU | Yes | Yes | `VerificationStatus` enum, `/assessments/[id]/verify`, `/assessments/[id]/reject`, `/responses/[id]/verify`, `/responses/[id]/reject` | Status transitions enforced, audit logged | Rejection reasons are free-text + enum, no canonical code list | High |
| Standardized rejection reason codes | PA | Yes | Partial | `rejectionReason`, `rejectionFeedback` columns | Reason captured per record | No master list / taxonomy table | Medium |
| Auto-approval (per-entity) | FU | Yes | Yes | `Entity.autoApproveEnabled`, `/entities/[id]/auto-approval`, `coordinator/auto-approval` page | Coordinator can enable per-entity w/ conditions (assessmentTypes, maxPriority, requiresDocumentation) | Global auto-approval rule not implemented | High |
| Gap analysis (severity-based) | FU | Yes | Yes | `src/lib/services/gap-analysis.service.ts`, `gap-field-severity.service.ts`, `GapFieldSeverity` model, `/dashboard/resource-management/gap-analysis` | Boolean gap detection + admin-configurable per-field severity → assessment severity | One legacy mock aggregator still present (dead code) | High |
| Situation awareness dashboard | FU | Yes | Yes | `coordinator/situation-dashboard/page.tsx`, `/api/v1/dashboard/situation` | Incident list, population impact (verified + preliminary split), entity assessments, gap summary, interactive map | "Real-time" is polling-driven, not push | High |
| Coordination / verification queues | FU | Yes | Yes | `coordinator/verification` (assessments + deliveries subroutes), `/api/v1/assessments/verified`, `/api/v1/responses/[id]/verify` | Queue, inline verify/reject, status indicators | Severity breakdown in `verification-broadcast.service.ts` returns zeroes (placeholder) | Medium |
| Resource management dashboard | FU | Yes | Yes | `coordinator/resource-management`, `/api/v1/dashboard/resource-management/{stats,gap-analysis,critical-gaps,commitments}` | Real planned vs delivered coverage by entity | — | High |
| Response planning (planned → delivered) | FU | Yes | Yes | `RapidResponse.deliveryStatus`, `/responses/planned/*`, `/responses/[id]/deliver` | Plan → confirm delivery → verify | — | High |
| Convert donor commitment → response plan | FU | Yes | Yes | `/api/v1/responses/from-commitment`, `PlanCommitment` join, `RapidResponse.sourceCommitmentId` | Import commitment items into a plan or directly as delivery; idempotent (rejects circular refs) | — | High |
| Donor commitments (item / unit / qty / value / date / target entity) | FU | Yes | Yes | `DonorCommitment` model, `/api/v1/commitments/*`, donor dashboard | All listed fields present | `totalValueEstimated` stored as Float | High |
| Donor gamification & leaderboard | FU | Yes | Yes | `gamification.service.ts`, `leaderboard.service.ts`, `/api/v1/leaderboard`, `/donor/leaderboard` page | Badge tiers (Bronze/Silver/Gold), overall score = weighted delivery rate + value + consistency + response speed, regional & timeframe filters | Scoring weights are admin-configurable via `scoring-config` | High |
| Donor impact / analytics page | FU | Yes | Yes | `/donor/analytics`, `/donor/entities/performance`, `/api/v1/donors/entities/impact/*` | Per-entity impact, demographics, trends, latest assessment | — | High |
| Media attachments on assessments | PA | Yes | Yes | `RapidAssessment.mediaAttachments Json?`, `MediaAttachment` (response-scoped), `storage.service.ts` (S3/MinIO) | Capture, store, retrieve | Assessment media is a JSON blob; structured `MediaAttachment` table is response-delivery only | Medium |
| Delivery media + GPS stamp | FU | Yes | Yes | `MediaAttachment`, `delivery-media.service.ts`, `delivery-offline.service.ts` | Files + thumbnail + GPS + uploader | — | High |
| Offline assessment capture | FU | Yes | Yes | `assessment-offline.service.ts`, `offline.ts` (Dexie) | Create/edit/submit offline, queue, sync | — | High |
| Offline response / delivery confirmation | FU | Yes | Yes | `response-offline.service.ts`, `delivery-offline.service.ts` | Same queue model | — | High |
| Sync engine (queue, retry, backoff, conflict) | FU | Yes | Yes | `src/lib/sync/{engine,queue,conflict}.ts`, `/api/v1/sync/{batch,pull,status,resolve,conflicts}` | Batch sync, 3-retry with [2s,5s,10s], LWW conflict resolution, conflict export | Conflict resolution is LWW only (no merge UI) | High |
| Client-side encryption at rest (offline) | FU | N/A (transparent) | Yes | `offline.ts` `EncryptionManager` AES-GCM 256, 90-day rotation, 5 historical keys | Encrypts all local DB records | — | High |
| Push notifications (web push) | FU | Yes | Yes | `PushSubscription`, `push-notification.service.ts`, `/api/v1/push/{subscribe,test}`, `public/push-sw.js` | Subscribe, server push, test endpoint | Requires VAPID keys configured | Medium |
| Action signals / in-app notifications | FU | Yes | Yes | `ActionSignal`, `Notification`, `action-signal.service.ts`, `/api/v1/signals/{live,analytics}` | Rule-based signal generation on verify/create events | Rules engine appears fairly simple | Medium |
| PDF / CSV / Excel / HTML reports | FU | Yes | Yes | `/api/v1/reports/generate`, `reports/data-aggregator.ts`, `reports/template-engine.ts`, `pdfkit`, `exceljs`, `pdf-lib` | On-demand + scheduled | — | High |
| Scheduled reports | FU | Yes | Yes | `ScheduledReport` model, `/api/v1/exports/schedule`, `/api/v1/jobs/email-digest` | Frequency, recipients, filters | Scheduler relies on background job runner (needs verification it's cron'd) | Medium |
| CSV export (assessments/responses/entities/incidents/commitments) | FU | Yes | Yes | `/api/v1/exports/csv` | Role-scoped exports | — | High |
| Chart image export | FU | Yes | Yes | `/api/v1/exports/charts` | Server-side render | — | Medium |
| Audit logs (manual + middleware) | FU | Yes (admin) | Yes | `AuditLog`, `audit.service.ts`, `audit-log.service.ts`, `/system/audit`, `/system/audit/export` | Logs auth, verify, reject, create, access-denied, sync-conflict | Not every mutation goes through `auditLog()` helper | High |
| Admin: users, roles, donors | FU | Yes | Yes | `admin/{users,donors}/page.tsx`, `/api/v1/admin/*`, `/api/v1/users/*`, `/api/v1/roles/*` | Full CRUD | — | High |
| Admin: branding / currency / map config | FU | Yes | Yes | `admin/settings/{branding,currency,map}`, `/api/v1/system/{branding,currency}`, `SystemSetting` table | Persisted config | — | High |
| DB backup / restore / optimize / query | FU | Yes (admin) | Yes | `/api/v1/admin/database/{backup,restore,optimize,query,stats,tables}`, `/system/database` page | On-demand backup, restore from file | Storage target depends on env (local vs S3) | Medium |
| External backup (S3) | FU | Yes | Yes | `/api/v1/system/backup/external`, `@aws-sdk/client-s3` | Push backups to S3 | Requires S3 creds configured | Medium |
| Production deployment artifacts | FU | DevOps-only | Yes | `Dockerfile.production`, `docker-compose.production.yml`, `.env.production.template`, `scripts/setup-production-env.js` | Postgres+Redis+MinIO+Traefik+backup | Live host not verifiable from repo | Medium |
| Real-time push (WebSockets) | PL | No | No | `verification-broadcast.service.ts` only `console.log`s | Polling only | Broadcast is a stub | High |
| Native mobile apps | NP | — | — | — | — | — | High |
| Conflict merge UI | PL | No | Partial | `sync/conflicts/resolve` endpoint exists (LWW auto) | Auto-resolved; no manual merge screen | — | High |

---

## 3. Core Infrastructure and Offline Capability

1. **Genuinely offline-capable?** **Yes.** This is one of the strongest features. The architecture is PWA + IndexedDB + sync engine, not just a service worker cache.
2. **Features that work offline:** assessment create/edit/submit, response create/plan, delivery confirmation (with media), entity browsing (cached), local queue inspection. Coordinator verification and dashboards require server reach.
3. **Mechanism:** Service Worker (`public/sw.js`, generated by `next-pwa`) + Dexie/IndexedDB local DB (`src/lib/db/offline.ts`) + in-memory sync queue persisted in the same Dexie DB. AES-GCM 256-bit client-side encryption with 90-day key rotation. No SQLite.
4. **Assessments offline?** **Yes** — `src/lib/services/assessment-offline.service.ts`, `RapidAssessment.isOfflineCreated` / `syncStatus` fields.
5. **Media offline?** **Yes** — `delivery-offline.service.ts` queues media with `mediaFiles` array; upload happens on sync (`/api/v1/delivery-media/sync`).
6. **Responses/deliveries offline?** **Yes** — same pattern, `response-offline.service.ts`, `RapidResponse.isOfflineCreated` / `offlineId` fields.
7. **Auto-sync on reconnect?** **Yes** — `SyncEngine.initializeConnectivityListeners()` listens for `online` event and calls `triggerSync()`. Also runs a 30 s periodic check.
8. **Conflict resolution?** **Yes but Last-Write-Wins only.** `SyncConflict` table records winning/losing versions, `coordinatorNotified` flag. No interactive merge.
9. **Sync UX?** Queue (`/sync-queue` shortcut in manifest), retry with exponential backoff `[2s, 5s, 10s]`, max 3 attempts, `getQueueStatus()` returns pending/failed counts. Failed items can be retried or cleared.
10. **"100% functionality without internet"?** **Partially true.** Assessment/response/delivery capture + queue + sync all work offline. Coordinator dashboards, verification, admin pages, and report generation require connectivity.
11. **Cross-platform?** Web + mobile-responsive web + installable PWA (Android via Chrome, iOS via Safari Add to Home Screen, desktop via Chrome/Edge install). No native binaries.

---

## 4. User Roles and Access Control

1. **Roles implemented:** `ASSESSOR`, `COORDINATOR`, `RESPONDER`, `DONOR`, `ADMIN` (enum `RoleName`, `prisma/schema.prisma:632`).
2. **All five target roles present?** **Yes**, exactly those five.
3. **Multi-role users?** **Yes** — `UserRole` is a join table with `@@unique([userId, roleId])`; seeded `multirole@dms.gov.ng` user demonstrates it.
4. **Dynamic role switching?** **Yes** — `/roles` page lets a multi-role user pick active role; middleware reads roles from JWT.
5. **Permission enforcement?** **Both** — frontend route guard (`src/middleware.ts` + `ROLE_ROUTE_PREFIXES`), backend `withAuth` wrapper checks `context.roles.includes('X')` on essentially every route, plus a `Permission` table seeded with 20 codes (e.g. `VERIFY_ASSESSMENT`, `MANAGE_USERS`).
6. **Entity assignments tied to roles?** **Yes** — `EntityAssignment` table links users to entities; responder/donor must have an assignment to act on an entity.
7. **Coordinator bulk assignment?** **Yes** — `/api/v1/entity-assignments/bulk` and `/entity-assignments/suggestions`.
8. **Collaboration?** **Yes** — multiple users can be assigned to the same entity; `/responses/[id]/collaboration` and `/entity-assignments/collaboration` endpoints exist.
9. **Audit logs?** **Yes** — `AuditLog` model with userId, action, resource, resourceId, oldValues/newValues, ipAddress, userAgent, timestamp. Written from auth events, verification, rejection, sync-conflict, and unauthorised-access attempts.

---

## 5. Affected Entity / Location Management

1. **Create entities?** **Yes** — `/api/v1/entities` POST.
2. **Who can create?** Coordinators (route checks `COORDINATOR`); admins inherit coordinator routes.
3. **Hierarchical?** Conceptually yes via `EntityType` enum (`COMMUNITY`, `WARD`, `LGA`, `STATE`, `FACILITY`, `CAMP`). No strict parent_id FK — hierarchy is *implied by type* rather than enforced.
4. **GPS?** **Yes** — `Entity.coordinates Json?` (e.g. `{latitude, longitude}`), plus `location` string.
5. **Linked to incidents?** **Yes** — through `RapidAssessment.incidentId` and `DonorCommitment.incidentId`; entity itself has no direct incident FK because the linkage is assessment-mediated.
6. **CRUD actions (assign, reassign, verify, archive, edit)?** Assign/reassign/edit **yes**. Archive = `Entity.isActive = false`. "Verify" applies to assessments, not entities.
7. **Entity auto-approval?** **Yes** — `Entity.autoApproveEnabled` Boolean + conditions in `metadata.autoApproval` (`assessmentTypes`, `maxPriority`, `requiresDocumentation`). Per-entity only; no global rule.
8. **Entity screens?** **Yes** — `/coordinator/entity-management`, `/coordinator/entities`, `/donor/entities/[id]`.
9. **Fields stored:** `id, name, type, location, coordinates, metadata, isActive, autoApproveEnabled, createdAt, updatedAt`. Plus reverse relations to assignments, assessments, responses, commitments, action signals.

---

## 6. Incident and Disaster Lifecycle

1. **Incident alerts/creation?** **Yes** — `/api/v1/incidents` POST, coordinator-only.
2. **Status progression?** **Yes** — `IncidentStatus` enum: `ACTIVE → CONTAINED → RESOLVED`. No "Closed" or "Cancelled".
3. **Preliminary assessments?** **Yes** — separate `PreliminaryAssessment` model with lives-lost / injured / displaced / houses / schools / medical / agricultural fields, linked optional `incidentId`.
4. **Rapid / detailed assessments?** **Yes** — `RapidAssessment` with six typed sub-tables (Health, WASH, Shelter, Food, Security, Population). No "detailed" tier beyond rapid.
5. **Linked to incidents + entities?** **Yes** — `RapidAssessment.{incidentId, entityId}` both required FKs.
6. **Full lifecycle alert → preliminary → rapid → plan → delivery → verification?** **Yes, all stages present and wired:**
   - Incident create → PreliminaryAssessment create → RapidAssessment (6 sectors) → RapidResponse (`PLANNED`) → confirm delivery → coordinator verify (`VERIFIED`/`AUTO_VERIFIED`/`REJECTED`).
   - Severity propagates bottom-up via `incident-severity.service.recalculateIncidentSeverity()`.
7. **Incomplete parts?** The lifecycle itself is complete. The only gap is **no "Closed/Archived" terminal state** for incidents, and no separate *detailed* assessment tier (only rapid).

---

## 7. Assessment Framework

1. **Categories implemented:** `HEALTH`, `WASH`, `SHELTER`, `FOOD`, `SECURITY`, `POPULATION` (`AssessmentType` enum).
2. **All six target sectors present?** **Yes**, exactly those six, each with a dedicated table and full field set (e.g. `HealthAssessment` has 12 columns; `WASHAssessment` has 9).
3. **Forms complete?** **Yes**, all six are fully modelled with structured booleans, counts, and free-text `additional*Details` JSON.
4. **Mobile-friendly?** **Yes** — Tailwind responsive layouts, PWA, portrait orientation in manifest, GPS capture hook (`useGPS`).
5. **Progressive validation?** **Yes** — `react-hook-form` + `zod` resolvers (`@hookform/resolvers`).
6. **Error handling?** **Yes** — API uses zod schemas, returns structured errors; UI has `sonner` toasts.
7. **Draft / submit / verify / reject / resubmit?** **Yes** — `VerificationStatus` enum covers `DRAFT, SUBMITTED, VERIFIED, AUTO_VERIFIED, REJECTED`. Submit, verify, reject endpoints all live.
8. **Standardized rejection reason codes?** **Partial** — free-text `rejectionReason` + `rejectionFeedback`; no master code list / taxonomy table.
9. **Assessor metadata?** **Yes** — `assessorId`, `assessorName`, relation to `User`.
10. **Timestamps?** **Yes** — `createdAt`, `updatedAt`, `rapidAssessmentDate`, `verifiedAt`.
11. **GPS?** **Yes** — `coordinates Json?` on assessment + `reportingLatitude/Longitude` on preliminary.
12. **Media attachments on fields?** **Yes but coarse** — `mediaAttachments Json?` blob on the assessment; not broken out per-individual-field.
13. **View / filter / search / export?** **Yes** — list pages, `/api/v1/exports/csv?dataType=assessments`, PDF reports.
14. **Linked to gap analysis + priority scoring?** **Yes** — `gapAnalysis Json?` column on `RapidAssessment` persisted at submit; `priority` enum recomputed via `RapidAssessmentService.triggerGapAnalysis()`.

---

## 8. Verification and Approval Workflow

1. **Assessment verification?** **Yes** — `/api/v1/assessments/[id]/verify` (COORDINATOR-only), transactional, audit-logged, triggers action-signal evaluation + gap recompute + incident severity recompute.
2. **Response/delivery verification?** **Yes** — `/api/v1/responses/[id]/verify`, parallel structure.
3. **Who can verify?** `COORDINATOR` role only (hard-checked in route handlers).
4. **Verification queues?** **Yes** — `/coordinator/verification` (assessments) + `/coordinator/verification/deliveries`. `/api/v1/assessments/verified` returns the verified pipeline.
5. **Inline verification actions?** **Yes** — UI provides inline Approve/Reject buttons.
6. **Approve / reject / request changes / feedback?** Approve and Reject **yes** (separate routes). "Request changes" is not a distinct state — it maps to `REJECTED` with feedback.
7. **Auto-approval?** **Per-entity only.** Global auto-approval rule is not implemented.
8. **Status indicators?** **Yes** — `DRAFT, SUBMITTED, VERIFIED, AUTO_VERIFIED, REJECTED` flow through UI badges.
9. **Verification performance tracked?** **Partial** — `/verification/metrics` page exists; underlying `verification-broadcast.service.ts` returns real total-pending counts but **per-severity buckets return zeroes** (placeholder).
10. **Full audit trail?** **Yes** — every verify/reject writes an `AuditLog` row inside the same Prisma transaction.

---

## 9. Coordination Dashboard

1. **Crisis dashboard?** **Yes** — `/coordinator/dashboard` (overview) + `/coordinator/situation-dashboard` (situation awareness) + `/coordinator/resource-management`.
2. **What it shows:** Active incidents, severity distribution, affected entities count, total/verified assessments, response counts, delivery rate, coverage rate, per-entity latest assessments across all 6 sectors, gap summary, population impact (verified + preliminary), interactive entity map, donor commitments.
3. **Real-time verification queues?** **Yes (polling)** — no WebSocket push; dashboard refetches.
4. **Assessments + responses together?** **Yes** — `aggregateMetrics.responsesCount` + `totalAssessmentsCount` exposed in same payload.
5. **Expandable detail views?** **Yes** — `Radix Collapsible` is in the dependency list; situation dashboard lists entity-level expandable assessments.
6. **Inline verify actions?** **Yes** — `/coordinator/verification` page.
7. **Visual status indicators?** **Yes** — badges, severity colours.
8. **Performance metrics (verification rate, response time)?** **Partial** — coverage rate, delivery rate computed; per-severity verification queues return zeroes pending cleanup of placeholder helper.
9. **Real-time vs refresh?** **Refresh / polling.** `realTime` query param exists but server has no push channel.
10. **Role-specific?** **Yes** — situation dashboard is `COORDINATOR`-only (`/api/v1/dashboard/situation` rejects non-coordinators).

---

## 10. Response Planning and Delivery

1. **Response planning implemented?** **Yes** — full plan/deliver/verify flow.
2. **Planned status?** **Yes** — `DeliveryStatus.PLANNED`, default on creation.
3. **Convert planned → delivered?** **Yes** — `/api/v1/responses/[id]/deliver` (responder confirms) → sets `DELIVERED` + `verificationStatus=SUBMITTED` for coordinator review.
4. **Linked to assessments/entities/incidents/gaps?** **Yes** — `RapidResponse.{entityId, assessmentId}`; `assessment.incidentId` carries the incident; gap analysis informs priority.
5. **Multiple responders collaborate?** **Yes** — `/responses/[id]/collaboration` endpoint + entity-level collaboration assignments.
6. **Donor commitment import?** **Yes** — `/api/v1/responses/from-commitment` validates availability, prevents circular imports, optional `createAsPlan` flag.
7. **Attribution to donor/responder/org?** **Yes** — `responderId`, `sourceCommitmentId`, donor on commitment, `User.organization`.
8. **Delivery documentation?** **Yes** — `MediaAttachment` table (filename, mimeType, size, thumbnail, uploader, timestamp) tied to response.
9. **Delivery media capture?** **Yes** — `/api/v1/delivery-media`, offline capture path.
10. **Quantities, units, quality, dates?** **Yes** — `items Json` array of `{name, quantity, unit, deliveredQuantity?}`, `plannedDate`, `responseDate`.
11. **Planned vs actual?** **Yes** — `DonorCommitment.{totalCommittedQuantity, deliveredQuantity, verifiedDeliveredQuantity}` + `status PLANNED/PARTIAL/COMPLETE/CANCELLED`.
12. **Coordinator delivery verification?** **Yes** — `/responses/[id]/verify` (coordinator-only).
13. **Statuses clearly defined?** **Yes** — see enums above.

---

## 11. Donor Engagement and Accountability

1. **Donor interface?** **Yes** — entire `/donor/*` route tree (dashboard, entities, performance, leaderboard, responses, reports, analytics, profile).
2. **Donor registration / profile?** **Yes** — `/admin/donors/register` + donor model. Donor users created via admin; donors themselves managed via `Donor` entity.
3. **Both orgs + individuals?** **Yes** — `DonorType` enum: `INDIVIDUAL, ORGANIZATION, GOVERNMENT, NGO, CORPORATE`.
4. **Donor commitments?** **Yes** — full CRUD at `/api/v1/commitments`.
5. **Commitment fields:** `items Json`, `totalCommittedQuantity`, `deliveredQuantity`, `verifiedDeliveredQuantity`, `totalValueEstimated Float`, `commitmentDate`, `entityId` (target), `incidentId`, `status`. **All requested fields present.**
6. **Self-reported delivery updates?** **Yes** — donors can update commitment status; responder confirms actual delivery.
7. **Donor-reported deliveries verified?** **Yes** — split between `deliveredQuantity` (self-reported) and `verifiedDeliveredQuantity` (post-coordinator-verification).
8. **Donor self-selects entities?** **Partial** — `/commitments/available` exposes available commitments; coordinator assignment remains primary path.
9. **Coordinator assigns entities to donors?** **Yes** — `/commitments/[id]/assign`.
10. **Donors view assessments?** **Yes** — `/api/v1/donors/entities/[id]/assessments/latest`, donor-side `rapid-assessments` page (read-only).
11. **Donors see gap analysis / needs?** **Yes** — `/api/v1/donors/entities/[id]/gap-analysis`, `/donor/entities` shows gap fields.
12. **Impact tracking?** **Yes** — `/donor/entities/performance`, `/api/v1/donors/entities/impact/*` (latest assessment, demographics, trends).
13. **Donor intelligence dashboard?** **Yes** — `/donor/analytics`, `/donor/reports`.
14. **Donor read-only where appropriate?** **Yes** — route-config only permits GET-style pages; donor cannot verify or coordinate.

---

## 12. Gamification and Performance Tracking

1. **Donor gamification?** **Yes** — `gamification.service.ts`, badge tier system, overall score formula.
2. **Public leaderboards?** **Yes** — `/donor/leaderboard` + `/api/v1/leaderboard` (visible to DONOR/COORDINATOR/ADMIN).
3. **Commitment-volume rankings?** **Yes** — `RANKING_WEIGHTS.COMMITMENT_VALUE`, `sortBy=commitment_value` query param.
4. **Delivery-percentage rankings?** **Yes** — `RANKING_WEIGHTS.VERIFIED_DELIVERY_RATE` is the dominant weight.
5. **Achievement badges?** **Yes** — `BADGE_THRESHOLDS` Bronze/Silver/Gold tiers for both Delivery Rate and Volume; `Donor.achievementBadges Json?` persists earned badges.
6. **Performance trends?** **Yes** — `/api/v1/donors/[id]/performance-trends`.
7. **Comparative rankings?** **Yes** — leaderboard returns rank, previousRank, trend (`up`/`down`/`stable`).
8. **Verified vs self-reported basis?** **Verified delivery rate is the dominant weight** — self-reported rate is captured but weighted lower by design.
9. **Production-ready or mock?** **Production-ready** — DB-backed, admin-configurable scoring weights (`scoring-config.service.ts`, `ScoringConfig`), persists `leaderboardRank` on donor rows.

---

## 13. Situation Awareness Dashboard

1. **Executive monitoring dashboard?** **Yes** — `/coordinator/situation-dashboard`.
2. **3-panel responsive layout?** **Yes** — page renders incident / entity-assessment / gap panels responsively (Radix + Tailwind grid).
3. **Optimised for full-screen?** **Yes** — designed for wall-display use (portrait/landscape aware via manifest).
4. **Real-time incident monitoring?** **Polling-based** (no WebSocket). Severity is recomputed bottom-up on each load.
5. **Population impact statistics?** **Yes** — `getPopulationImpact()` returns verified + preliminary split (total pop, households, male/female, under-5, pregnant/lactating, PWD, elderly, separated children, lives lost, injured, displaced, houses, schools, medical, agricultural land).
6. **Demographic breakdowns?** **Yes** — see above.
7. **Interactive mapping?** **Yes** — `react-leaflet` + `react-leaflet-cluster`, `/api/v1/dashboard/situation?includeEntityLocations=true` returns geo + gap + donor assignments per entity.
8. **Offline map tiles?** **Not implemented** — relies on live tile provider; **needs manual verification** whether any tile cache strategy exists.
9. **Cross-panel sync?** **Yes** — selecting an incident re-queries entities, gaps, population for that incident.
10. **What an executive sees/does:** Monitor active incidents, see per-entity sector-by-sector gap severity on the map, drill into population impact, see delivery/coverage rates, filter by severity/entity type.

---

## 14. Gap Analysis and Priority Scoring

1. **Implemented?** **Yes** — both at assessment level (real-time, persisted in `RapidAssessment.gapAnalysis`) and resource level (`/dashboard/resource-management/gap-analysis`).
2. **Logic:** Boolean gap detection per field (e.g. `!hasFunctionalClinic` → gap) → admin-configurable per-field severity (`GapFieldSeverity` table) → assessment-level severity via max-rule → entity-level severity via max across assessments → incident-level severity via max across entities.
3. **Boolean-based detection?** **Yes** — including *inverted* fields (`hasOpenDefecationConcerns`, `areOvercrowded`, `gbvCasesReported`) where `true` indicates the gap.
4. **Severity-based scoring?** **Yes** — DB-driven, coordinator-tunable via `/coordinator/settings/gap-field-management` and `/coordinator/settings/severity-thresholds`.
5. **Priority = severity × population × time?** **Partial** — severity and time-since-assessment are reflected; population does not enter the priority formula directly (population is its own assessment type without gap analysis). The pitch claim should be softened to "severity-driven" rather than "multi-factor weighted".
6. **Multiple gap combinations prioritisation?** **Yes** — entity severity = max across all sector gaps; resource gap view filters by gap combinations.
7. **Coverage as planned vs delivered %?** **Yes** — `percentageMet` per resource, averaged to `avgDelivery` summary.
8. **Resource allocation insights?** **Yes** — `critical-gaps` endpoint + resource-management dashboard.
9. **Visible to which roles?** Coordinator (primary), Donor (per-entity subset via `/donor/entities/[id]/gap-analysis`), Admin (inherits coordinator). Responder sees the plans, not the gap analytics directly.
10. **"Novel severity-based gap analysis" claim accurate?** **Yes, with caveat** — the design (admin-tunable per-field severity rolled up bottom-up to incident severity) is genuinely more sophisticated than typical boolean gap checklists. Pitch it as "configurable severity-weighted gap analysis".

---

## 15. Media Management

1. **Photo upload/capture?** **Yes** — `MediaAttachment`, `useGPS` for capture context, delivery media flow.
2. **Video upload/capture?** **Yes** — mimeType column is unrestricted; no format restriction in schema. **Needs manual verification** whether UI exposes video picker.
3. **GPS stamp?** **Yes** — capture flow passes `gpsLocation` into `DeliveryOfflineOperation.metadata`.
4. **Timestamps?** **Yes** — `uploadedAt`, `createdAt`.
5. **Linked to assessment fields?** **Partial** — assessments store media as a JSON blob (`mediaAttachments`); not field-granular.
6. **Linked to delivery verification?** **Yes** — `MediaAttachment.responseId` FK; verifier sees them.
7. **Offline storage?** **Yes** — files queued locally, encrypted at rest in IndexedDB; upload deferred to sync.
8. **Compression?** **Needs manual verification** — no obvious compression lib in `package.json`; client may rely on browser-default.
9. **Upload / sync progress?** **Yes** — `SyncEngine.getQueueStatus()` exposes counts and oldest item; UI surfaces sync state.
10. **Size/type restrictions?** **Needs manual verification** — schema has `fileSize Int` and `mimeType String` but no enforced cap visible in route code.
11. **Secured?** **Yes** — download goes through `/api/v1/storage/download` with `withAuth`; S3/MinIO pre-signed URLs generated server-side.

---

## 16. Real-Time Synchronization

1. **Real-time sync implemented?** **Yes for offline→online sync.** Not real-time *push* in the WebSocket sense.
2. **Technology:** Web online/offline events, 30 s polling check, manual `triggerSync()`, REST batch endpoint `/api/v1/sync/batch`. **No WebSockets, no Supabase realtime, no Firebase.**
3. **What updates in real time?** Local DB → server on reconnect; queue status. Coordinator dashboard does **not** auto-update without refresh.
4. **Sync queues?** **Yes** — `offlineDB.syncQueue` (Dexie table) + admin-exportable via `/api/v1/sync/conflicts/export`.
5. **Queue prioritisation?** **Yes** — `priority` field (lower number = higher); batch picks highest priority first, then oldest.
6. **Batch optimisation?** **Yes** — `MAX_BATCH_SIZE = 100`, single POST per batch.
7. **Retry with exponential backoff?** **Yes** — fixed schedule `[2000, 5000, 10000]` ms, max 3 attempts.
8. **Sync status indicators?** **Yes** — `getQueueStatus()` + `OfflineGuard` component + PWA shortcut.
9. **Works after offline use?** **Yes** — by design.
10. **Known limitations:** Conflict resolution is **last-write-wins only** (no merge UI). No background sync (Service Worker `sync` event) — sync runs only while app is open.

---

## 17. Reporting, Export, and Analytics

1. **Reporting features:** Report templates, configurations, executions, scheduling, performance exports, statistics.
2. **CSV export?** **Yes** — `/api/v1/exports/csv` (assessments/responses/entities/incidents/commitments, role-scoped).
3. **Excel export?** **Yes** — `exceljs` dependency; `/api/v1/reports/generate?format=EXCEL`.
4. **PDF generation?** **Yes** — `pdfkit` + `pdf-lib`; `/api/v1/reports/generate?format=PDF`; supports page size, orientation, margins, watermark, password.
5. **Chart image export?** **Yes** — `/api/v1/exports/charts`.
6. **Scheduled reports?** **Yes** — `ScheduledReport` model + `/api/v1/exports/schedule` + `/api/v1/jobs/email-digest`. **Caveat:** the scheduler's cron/worker must actually run somewhere — **needs manual verification** of production deployment.
7. **Custom templates?** **Yes** — `ReportTemplate.layout Json`, `ReportConfiguration` with filters/aggregations/visualisations.
8. **Analytics dashboards:** Situation dashboard (coordinator), donor analytics, donor performance trends, coordinator analytics, verification metrics, leaderboard.
9. **Trend analyses?** **Yes** — `/api/v1/donors/entities/[id]/assessments/trends`, `/donor/[id]/performance-trends`.
10. **Performance metrics?** **Yes** — `/api/v1/reports/performance` + export.
11. **Actually downloadable:** CSV (5 data types), PDF (configured), Excel, HTML, chart PNGs (likely), performance CSV.

---

## 18. Security, Privacy, and Auditability

1. **Authentication?** JWT via `jsonwebtoken` + `bcryptjs` (10-round hashing in seed), refresh tokens (`/api/v1/auth/refresh`), `AuthService.verifyToken` in middleware. Cookie + Bearer header supported.
2. **Authorisation by role?** **Yes** — middleware route guard + per-route `withAuth` role checks + `Permission` table.
3. **Encryption at rest / in transit?**
   - **In transit:** Production security headers (`production-security.config.js`) applied in `next.config.js` for `NODE_ENV=production` (CSP, HSTS-style headers, `poweredByHeader: false`).
   - **At rest (server):** Postgres-level only (not app-managed).
   - **At rest (client offline DB):** **AES-GCM 256-bit** with 90-day key rotation and 5 historical keys for backward decryption.
4. **Implemented or planned?** All of the above **implemented**.
5. **Audit module?** **Yes** — `AuditLog` table + admin UI at `/system/audit` + CSV export at `/system/audit/export`.
6. **User actions logged?** Login, role changes, assessment verify/reject, response verify/reject, plan-from-commitment, gap-analysis access, unauthorised-access attempts, sync conflicts.
7. **Admin actions logged?** **Yes** — same pipeline.
8. **Donor commitments & delivery verification auditable?** **Yes** — every status change audit-logged.
9. **Protections against unauthorised access?** Route guard, per-route role check, entity-assignment check for responders/donors, rate limiter class on dashboard route (100 req/min).
10. **Known security gaps:** API routes pass through middleware with `x-middleware-processed` header but middleware does not itself reject — actual auth happens in `withAuth` wrapper. Rate limiter is in-memory per-instance (not distributed). **No 2FA / MFA** implemented. **No field-level encryption** for sensitive PII (population demographics etc.).

---

## 19. Admin, Configuration, and Customisation

1. **Admin features:** Users CRUD, donor CRUD + register, roles management, system database (backup/restore/optimize/query/stats/tables), audit log viewer, system health, branding, currency, map config, notification config, seed endpoint, severity recalculation, gap-field severity management, scoring config.
2. **Manage users?** **Yes** — `/admin/users`, `/api/v1/users/*`.
3. **Manage roles?** **Yes** — `/api/v1/roles`, `/api/v1/users/[userId]/roles`.
4. **Manage entities?** **Yes** — through coordinator routes (admin inherits).
5. **Configure auto-approval rules?** **Yes (per-entity)** — no global rule.
6. **Configure assessment categories / forms?** **Partial** — categories are enum-fixed (the six sectors); per-field severity and scoring weights are admin-tunable.
7. **Configure reports / templates?** **Yes** — full template + configuration CRUD.
8. **Manage incidents?** **Yes** — via coordinator routes.
9. **View audit logs?** **Yes** — `/system/audit` + export.
10. **Customisation:** Branding (logo upload, theme color), currency, map provider config, notification config, severity thresholds, scoring weights, gap-field severities, report templates.

---

## 20. Optional Features from the Pitch Deck

1. **Stakeholder feedback / customisation features:** **Partial** — branding/currency/map config implemented; no stakeholder feedback loop module.
2. **Analytics & reporting:** **Yes** — see §17.
3. **Gamification for donor engagement:** **Yes** — see §12.
4. **Mobile optimisation:** **Yes** — Tailwind responsive + PWA + portrait manifest.
5. **Offline enhancement:** **Yes** — see §3, genuinely implemented.
6. **Security and encryption features:** **Yes** (transport headers + client-side AES-GCM); **partial** (no 2FA, no field-level encryption, rate-limit is in-memory).
7. **Donor interface:** **Yes** — full donor role surface.
8. **Admin module:** **Yes** — full admin role surface.
9. **Audit module:** **Yes** — see §18.
10. **Deployment and hosting features:** **Yes** — Docker Compose production stack with Postgres/Redis/MinIO/Traefik/backup.
11. **User training materials / training mode:** **Not present** — no in-app tour, no training-mode toggle, no docs surface inside the app.

---

## 21. User Experience and Demo Readiness

1. **Complete demo journeys:**
   - Assessor logs in → creates preliminary assessment → creates rapid assessment (any sector) → submits for verification. ✅
   - Coordinator logs in → sees verification queue → verifies (or rejects with feedback) → severity propagates → situation dashboard updates. ✅
   - Coordinator creates donor commitment → donor sees it on dashboard. ✅
   - Responder imports commitment → creates plan → confirms delivery → coordinator verifies. ✅
   - Donor views leaderboard + impact analytics. ✅
   - Admin manages users, branding, runs DB backup, exports audit log. ✅
2. **Fragile / incomplete journeys:**
   - Verification *metrics* dashboard — pending counts work but severity buckets are placeholder zeroes.
   - Offline → online sync demo depends on browser SW support; works in Chrome/Edge, **needs manual verification** on iOS Safari.
   - Map tiles depend on external provider; **needs manual verification** for offline continuity.
3. **Seeded demo accounts?** **Yes** — `admin@dms.gov.ng`, `coordinator@dms.gov.ng`, `responder@dms.gov.ng`, `multirole@dms.gov.ng`, `assessor@test.com`, `donor@test.com`, `coordinator@test.com` (e2e). Passwords: `test-password` / `testpassword123` (see seed output lines).
4. **Seeded demo data?** **Yes** — Borno LGAs (`seed-borno-lgas.ts`), sample Maiduguri entity, incident, all 6 assessment types, donor + commitment, response, action signals.
5. **Broken screens / placeholder buttons / fake metrics?** One known fake-metric helper (`getAggregatedAssessments` in `sitation/route.ts`) — **not on the live code path** but worth deleting before demo. Verification metrics severity breakdown returns zeroes.
6. **UI features that don't persist?** **None found** — every form posts to a real endpoint writing to Postgres.
7. **Backend features without UI?** A few: `/api/v1/system/backup/external` (no dedicated screen — invoked manually), `/api/v1/relationships/timeline` (relationship timeline service exists but no dedicated page surfaced).
8. **What NOT to show in a live demo:**
   - Verification metrics severity breakdown panel (placeholder zeroes).
   - The dead `getAggregatedAssessments` mock block — not user-visible but embarrassing if asked.
   - Any incident seeded with `severity: UNCLASSIFIED` until the recalc runs.
   - Real-time push claim — there is no WebSocket; if asked, frame as polling.

---

## 22. Data Model and Integrations

1. **Main tables/models:** `User, Role, UserRole, Permission, RolePermission, Entity, EntityAssignment, Incident, PreliminaryAssessment, PreliminaryAssessmentEntity, RapidAssessment, HealthAssessment, FoodAssessment, WASHAssessment, ShelterAssessment, SecurityAssessment, PopulationAssessment, RapidResponse, Donor, DonorCommitment, PlanCommitment, MediaAttachment, SyncConflict, AuditLog, GapFieldSeverity, SystemSetting, ActionSignal, Notification, PushSubscription, ReportTemplate, ReportConfiguration, ReportExecution, ScheduledReport`.
2. **All target entities represented?** **Yes** — incidents, entities, assessments, responses, donors, commitments, media, users, roles, audit logs all present.
3. **External integrations:**
   - **AWS S3 / MinIO** for object storage (`@aws-sdk/client-s3`, `storage.service.ts`).
   - **SendGrid + Resend** for email (`@sendgrid/mail`, `resend`).
   - **ioredis** for caching/queueing.
   - **Sentry** for error tracking (`@sentry/nextjs`, optional via `SENTRY_ENABLED`).
   - **Web Push** (VAPID) for browser notifications.
   - **Leaflet + OpenStreetMap** for maps (no proprietary map provider).
4. **Donor commitment import:** **Manual entry + commitment → response plan conversion.** **No CSV/Excel bulk commitment import.**
5. **Map provider integration:** **OpenStreetMap via Leaflet** only — no Google Maps, Mapbox, or offline tile provider bundling.
6. **Third-party disaster dependencies:** Depends on OSM tile provider and (optionally) S3/SendGrid/Sentry. **All have graceful fallback paths except OSM tiles** — if OSM is unreachable, the map panel renders empty (entities still listed in side panel).
7. **Backup / export functionality?** **Yes** — on-demand DB backup/restore, external S3 backup, CSV/PDF/Excel/HTML data exports, audit-log CSV export.

---

## 23. Performance and Scalability

1. **Designed for scale?** Yes for moderate scale: composite indexes on `RapidAssessment` (8 indexes), `DonorCommitment` (4 indexes), `ActionSignal` (3 indexes), `Notification` (2 indexes); standalone Next.js output; Redis available; S3 for blobs; paginated query params.
2. **Pagination / indexing / caching / jobs?** Pagination via `limit` query params (default 50, capped 100). Indexing **yes**. Caching: Redis dependency present (ioredis) + in-memory caches in `LeaderboardService` (15-min TTL). Background jobs: `/api/v1/jobs/email-digest`.
3. **Large exports?** CSV streaming not implemented — exports build the full body in memory. **Large PDFs/Excel** same caveat.
4. **Known bottlenecks:**
   - `situation/route.ts` `getEntityAssessments` issues N+1 parallel queries per entity (one Promise.all of 6 sub-assessment fetchers per entity).
   - In-memory rate limiter does not scale horizontally.
   - Situation dashboard recomputes ALL incident severities on every call.
5. **Scale that can be truthfully claimed:** "Hundreds of incidents, thousands of assessments, hundreds of thousands of audit-log rows, dozens of concurrent coordinator dashboard viewers." Higher scale would need query optimisation and a real-time push channel — **do not claim "enterprise-scale" or "millions of records"**.

---

## 24. Truthful Elevator Pitch Inputs

### 24.1 One-sentence description
DRMS is a role-based, offline-capable humanitarian response PWA that takes field teams from rapid needs assessment through verified delivery — with donor accountability and configurable gap analysis built in.

### 24.2 30-second elevator pitch
"DRMS is a disaster response platform that connects field assessors, coordinators, responders, and donors on one workflow. Assessors capture six-sector rapid needs assessments on mobile — even offline; coordinators verify and prioritise through severity-based gap analysis; responders convert donor commitments into delivered, verified aid. Every action is audit-logged, every donor ranking is backed by verified delivery data."

### 24.3 60-second elevator pitch
"DRMS is an end-to-end disaster response management system built as an installable PWA. Field assessors capture structured rapid-needs assessments across Health, WASH, Shelter, Food, Security, and Population — with GPS, media, and offline-first sync that survives connectivity drops using AES-GCM encrypted IndexedDB. Coordinators get a situation-aware dashboard with interactive mapping, severity-based gap analysis tuned per field, and inline verification queues for assessments and deliveries. Responders convert donor commitments into planned responses and confirm deliveries with photo and GPS evidence. Donors get their own dashboard with impact analytics, verified-delivery-based leaderboards, and badge achievements. Admins can tune severity weights, branding, currency, map provider, report templates, and run DB backups to S3. Every role action is captured in a transactional audit log. It deploys as a Docker stack with Postgres, Redis, MinIO, and Traefik."

### 24.4 Five strongest product benefits (currently true)
1. Offline-first assessment and delivery capture with encrypted local storage and automatic queued sync.
2. Complete assessment-to-verified-delivery lifecycle across all six humanitarian sectors.
3. Donor accountability loop with verified-delivery-weighted gamification.
4. Admin-configurable severity-based gap analysis driving both field and executive dashboards.
5. Full role-based audit trail from authentication through verification decisions.

### 24.5 Five strongest technical differentiators (currently true)
1. Client-side AES-GCM 256-bit encryption of offline IndexedDB records with 90-day key rotation.
2. Bottom-up severity propagation: field → assessment → entity → incident, recomputed on every verification event.
3. Per-entity auto-approval conditions (assessment types, max priority, documentation requirement) — not just a global toggle.
4. Idempotent commitment-to-response-plan conversion with circular-reference protection.
5. Production Docker stack with backup service, S3 external backup, and Traefik TLS — not a toy deployment.

### 24.6 Five claims to avoid (not fully implemented)
1. "Real-time WebSocket push updates" — only polling.
2. "Multi-factor authentication" — not implemented.
3. "Conflict resolution with merge UI" — last-write-wins only.
4. "Priority scoring by severity × population × time" — severity only (population does not enter the formula).
5. "Bulk CSV donor commitment import" — only manual entry and per-commitment plan conversion.

### 24.7 Safer alternative wording
| Avoid | Safer wording |
|---|---|
| "Real-time" | "Live-updating dashboards via periodic refresh" |
| "100% offline" | "Offline-first field capture with automatic sync on reconnect" |
| "WebSocket live" | "Polling-based situation awareness" |
| "Enterprise scale" | "Designed for multi-incident, multi-org humanitarian operations" |
| "AI-powered gap analysis" | "Configurable severity-weighted gap analysis" |
| "End-to-end encrypted" | "Transport-secured in production; client-side AES-GCM at rest for offline data" |
| "Mobile apps" | "Installable PWA for Android, iOS, and desktop" |

### 24.8 Offline capability claim
"Offline-first humanitarian field operations: assessors, responders, and delivery teams can capture assessments, response plans, and delivery verifications without connectivity. Data is encrypted at rest in IndexedDB using AES-GCM 256-bit keys with 90-day rotation, queued with priority and retry, and synchronised automatically when the device reconnects — with conflict detection and last-write-wins resolution."

### 24.9 Donor accountability claim
"Donors see exactly what was committed, what was delivered, and what was coordinator-verified — broken down by item, quantity, unit, estimated value, target entity, and date. Public donor leaderboard rankings are weighted toward verified delivery rate, not self-reported figures, and unlock Bronze/Silver/Gold reliability badges."

### 24.10 Dashboard / coordination claim
"Coordinators get a situation-aware dashboard with interactive Leaflet mapping of affected entities, real-time verification queues for assessments and deliveries, per-entity gap severity across all six sectors, and resource-management views showing planned-vs-delivered coverage percentages — all backed by transactional audit logs."

### 24.11 Assessment-to-response lifecycle claim
"A complete humanitarian workflow: field assessors capture six-sector rapid needs assessments → coordinator verifies → system computes severity-weighted gap analysis → responders convert donor commitments into planned responses → confirm delivery with media + GPS evidence → coordinator verifies → donor dashboard and leaderboard update. Every stage is audit-logged and feeds the next."

### 24.12 Reporting / analytics claim
"On-demand CSV, PDF, Excel, and HTML reports with admin-defined templates, role-scoped data export, scheduled email delivery, chart image export, and dedicated analytics surfaces for donors, coordinators, and verification performance — backed by Postgres and persisted as report executions."

---

## 25. Final Verification Summary

- **Fully safe to claim:**
  - Multi-role RBAC (Assessor, Coordinator, Responder, Donor, Admin) with backend enforcement.
  - Six-sector rapid assessment framework with structured fields.
  - Offline-first PWA capture with AES-GCM encrypted IndexedDB.
  - Full draft → submitted → verified/rejected workflow for assessments and deliveries.
  - Audit logging across auth, verification, and sync events.
  - Donor leaderboard with verified-delivery-weighted scoring and badge tiers.
  - Admin-configurable per-field severity and gap-field management.
  - PDF/CSV/Excel/HTML reporting with scheduling.
  - Docker production stack with Postgres/Redis/MinIO/Traefik/backup.
  - Situation dashboard with interactive Leaflet mapping and population impact.

- **Safe with caveats:**
  - "Real-time" dashboards (polling only — no WebSocket).
  - "Conflict resolution" (LWW only — no merge UI).
  - "Severity-based priority" (severity-driven; not multiplied by population or time).
  - "Production deployment ready" (config exists — actual live host needs manual confirmation).
  - "Scheduled reports" (model + endpoint exist — cron runner needs operational verification).
  - "Per-entity auto-approval" (no global auto-approval rule).

- **Do not claim yet:**
  - "WebSocket / push-based real-time updates."
  - "Multi-factor authentication."
  - "Offline map tiles / cached basemaps."
  - "Bulk CSV donor commitment import."
  - "Field-level merge conflict resolution UI."
  - "Native mobile apps (Android/iOS)."
  - "Field-level media linking on assessment forms" (only assessment-level JSON blob).
  - "Millions of records / enterprise scale."

- **Needs manual testing:**
  - Video upload UI (schema allows it, no obvious UI surface).
  - Image compression before upload.
  - File size / type caps (not visible in code).
  - iOS Safari PWA + offline behaviour.
  - Offline map tile continuity.
  - Production cron runner firing scheduled reports.
  - Live deployment of the Docker stack.
  - Verification metrics severity breakdown (placeholder zeroes in helper).

- **Most impressive implemented feature:**
  The offline-first sync architecture — Dexie/IndexedDB + AES-GCM 256 with key rotation + priority queue + retry/backoff + conflict table + idempotent batch API — is genuinely production-grade and rare in humanitarian tools.

- **Biggest implementation gap:**
  No real-time push channel (WebSockets / Supabase realtime). The verification-broadcast service stub `console.log`s messages instead of pushing them, forcing dashboards to poll. This is the single largest gap between pitch language ("real-time") and shipped behaviour.

- **Recommended positioning of the app today:**
  "An offline-first, role-based humanitarian response management PWA with end-to-end assessment-to-verified-delivery workflow, configurable severity-based gap analysis, and donor accountability — ready for pilot deployment with field teams and coordinators."

- **Recommended positioning after remaining gaps are closed:**
  "A real-time, multi-tenant humanitarian response platform with WebSocket-driven situation awareness, multi-factor-secured access, and field-level conflict resolution — purpose-built for high-stakes disaster operations at national scale."
