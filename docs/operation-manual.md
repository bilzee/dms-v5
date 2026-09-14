# DRMS Operation & Usage Manual

Generated 2026-09-14 from implementation code (branch `dynamic-question-registry`, commit `5b7c20b`). Where this manual and the application disagree, the application wins — report the discrepancy.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Roles & Access](#2-roles--access)
3. [Getting Started](#3-getting-started)
4. [Coordinator Workflows](#4-coordinator-workflows)
5. [Assessor Workflows](#5-assessor-workflows)
6. [Responder Workflows](#6-responder-workflows)
7. [Donor Workflows](#7-donor-workflows)
8. [Administrator Workflows](#8-administrator-workflows)
9. [Cross-Cutting Features](#9-cross-cutting-features)
10. [Known Limitations](#10-known-limitations)
11. [Verifying the System](#11-verifying-the-system)

---

## 1. System Overview

The Disaster Response Management System (DRMS) tracks humanitarian response end-to-end: an **incident** occurs, **assessors** evaluate affected entities sector-by-sector, **coordinators** verify those assessments and plan responses, **responders** deliver, and **donors** commit resources — with delivery verified back by coordinators. Severities, gaps, and priorities are computed from verified assessment data, and **action signals** surface work that needs attention on every dashboard.

The core data pipeline:

```
Incident → Preliminary/Rapid Assessment → Verification → Gap Analysis / Severity
         → Action Signal → Response Plan → Delivery (GPS + media) → Verification → Commitment progress
```

The app is a Next.js web application with PWA/offline support for field use (assessors, responders).

## 2. Roles & Access

Five roles exist (`ADMIN`, `COORDINATOR`, `ASSESSOR`, `RESPONDER`, `DONOR`). A user may hold multiple roles.

| Role | Home dashboard | Primary responsibility |
|---|---|---|
| **ADMIN** | `/admin/dashboard` | Users, roles/permissions, system config, database, audit |
| **COORDINATOR** | `/coordinator/dashboard` | Incidents, assessment/delivery verification, response planning, situation awareness |
| **ASSESSOR** | `/assessor/dashboard` | Preliminary + rapid field assessments (online or offline) |
| **RESPONDER** | `/responder/dashboard` | Response planning and delivery confirmation |
| **DONOR** | `/donor/dashboard` | Resource commitments, delivery tracking, performance |

Access rules:

- Unauthenticated visits to any protected page redirect to `/login?callbackUrl=...`. Expired sessions redirect with `error=session_expired`; insufficient role with `error=access_denied`.
- Each role's page area is gated by role: `/admin/*` and `/system/*` (ADMIN), `/coordinator/*`, `/assessor/*`, `/responder/*`, `/donor/*`. All roles share `/dashboard`, `/profile`, `/help`.
- Within pages, some actions additionally check fine-grained permissions (e.g. `MANAGE_USERS`, `VERIFY_ASSESSMENT`, `CREATE_RESPONSE`) attached to roles by the ADMIN.
- Multi-role users get a **Role Switcher** dropdown in the header. Switching changes the active dashboard and UI without a new login — the session token keeps all roles. Default role on login follows priority ADMIN > COORDINATOR > RESPONDER > ASSESSOR > DONOR.

## 3. Getting Started

### 3.1 Accounts

- **Only donor organizations can self-register** (`/register`, two-step form: organization info → admin user account). Password minimum: 8 characters. Successful registration logs you in immediately and lands on `/donor/dashboard`.
- All other roles (assessor, responder, coordinator, admin) are created by an ADMIN under **Admin → Users**.

### 3.2 Sign in

1. Go to `/login`, enter email + password.
2. Wrong credentials show "Invalid email or password" (the message is deliberately identical for unknown email and wrong password).
3. On success you are redirected to your role's dashboard.

### 3.3 Install as an app (PWA — field users)

1. Open the site in Chrome/Edge on Android/desktop; after ~3 seconds an install card appears (dismissable).
2. On iOS: Share → Add to Home Screen (the install card shows these instructions).
3. The installed app opens standalone, caches static assets for offline use, and falls back to an offline page when the network is unavailable. Manifest shortcuts jump straight to *New Assessment* and *Sync Queue*.

## 4. Coordinator Workflows

Coordinator pages: dashboard, incidents, verification (assessments / deliveries / auto-approval), situation dashboard, analytics, reports, settings (scoring / severity thresholds / gap-field management), entities + assignments, entity-incident map, donors, resource management.

### 4.1 Manage incidents

1. **Coordinator → Incidents** → *Create Incident* (optionally attach an existing unlinked preliminary assessment at creation; assessments linked later appear on the incident).
2. Open an incident for detail: statistics, priority distribution, relationship map, assessment timeline.
3. Change status (e.g. resolve) from the table. Incident severity/priority is **recalculated automatically** whenever linked assessments are created, updated, or verified — no manual severity entry.

### 4.2 Verify rapid assessments

1. **Coordinator → Verification** (assessments tab) shows everything in `SUBMITTED` status with entity, assessor, and gap summary.
2. Review the detail, then **Approve** (optional notes) or **Reject** (reason + feedback required). Rejection unlocks editing for the assessor; approval triggers gap-analysis and incident-severity recalculation and removes the item from the queue.
3. Entities flagged for **auto-approval** (see 4.4) skip this queue: their assessments arrive already `AUTO_VERIFIED`.

### 4.3 Verify deliveries

1. **Coordinator → Verification → Deliveries** lists submitted delivery confirmations.
2. Open *Review*, check items/quantities/GPS/photos, then **Approve**, **Reject** (reason required), or **Request Info**. Approved deliveries update commitment progress (PLANNED → PARTIAL → COMPLETE); rejected ones return to the responder for correction.

### 4.4 Configure auto-approval

**Coordinator → Auto-Approval** (or per-entity from entity management): enable/disable automatic assessment approval per entity, individually or in bulk. Use for trusted, high-frequency reporting entities.

### 4.5 Plan responses from commitments

1. Open the donor-commitment import form: pick entity → incident → an **orphaned commitment** (commitments not yet linked to a response plan; already-linked ones are filtered out, circular imports are blocked).
2. Adjust item quantities, preview, then import — the system creates a response plan (availability is checked; over-commitment is rejected).
3. Assign users/donors to entities under **Entities** (entity-assignments) so responders see their work.

### 4.6 Situation awareness

**Coordinator → Situation Dashboard** offers incident overview, entity assessment coverage (entities with gaps, critical gaps), aggregate metrics, top donors, and a map; toggle between Coordinator and Executive modes; export the view. **Analytics** provides signal analytics with CSV export. **Resource Management** shows resource/donation status (some buttons there are decorative — see §10).

### 4.7 Tune severity scoring

**Coordinator → Settings**: edit scoring config (weights must sum to 100), severity thresholds, and per-field gap severities; *Recalculate* on the gap-field page re-derives all assessment priorities and incident severities from current config.

## 5. Assessor Workflows

Assessor pages: dashboard (stats + action queue + map), rapid assessments (list / new / detail / edit), preliminary assessments.

### 5.1 Create a preliminary assessment

1. **Assessor → Preliminary Assessment → New**: pick incident + entity, fill the short initial form.
2. Submit — the assessment is immediately `SUBMITTED` and feeds incident severity.

### 5.2 Create a rapid assessment (per sector)

1. **Assessor → Rapid Assessments → New Assessment** (or click an action signal on the dashboard, which pre-fills entity/incident/sector).
2. Choose one of six sectors: **POPULATION, HEALTH, FOOD, WASH, SHELTER, SECURITY**. If a previous assessment of that type exists, its values load for comparison.
3. Complete the sector form: incident/entity selectors, sector questions, GPS capture, optional media. Gap flags update live as you fill it.
4. Drafts auto-save every 30 seconds. Submit when done:
   - Entity with auto-approval → `AUTO_VERIFIED` (straight into analytics).
   - Otherwise → `SUBMITTED`, awaiting coordinator verification.
5. After submit the assessment is read-only. If the coordinator **rejects** it, an *Edit* link appears on your list; edit, address the stated reason/feedback, and resubmit. Entity and incident cannot be changed on resubmission.

### 5.3 Work offline

See §9.1 — assessments created offline are encrypted on-device and sync automatically when connectivity returns.

## 6. Responder Workflows

Responder pages: dashboard (assigned plans, stats, action queue + map), responses (assigned deliveries), response detail, deliver, edit, planning (list / new).

### 6.1 Plan a response

1. From a dashboard action signal (or **Responder → Planning → New**; signal links pre-fill entity/assessment/incident/commitment).
2. Fill items and quantities via the Response Planning form; the plan starts as `PLANNED`.

### 6.2 Confirm a delivery

1. **Responder → Responses**: your assigned deliveries, filterable by status.
2. Open *Deliver* on a `PLANNED` item: the confirmation form auto-captures GPS (editable), lists planned items with editable delivered quantities, and offers photo attachment.
3. Submit → status becomes `DELIVERED` + `SUBMITTED` for verification; it enters the coordinator's delivery-verification queue. Rejected deliveries reappear with an *Edit* action for correction and resubmission.

## 7. Donor Workflows

Donor pages: dashboard (action queue + commitments tab), responses (read-only), performance, analytics, reports, entities (+ per-entity insights), rapid assessments browse, leaderboard, profile.

### 7.1 Register (first-time donor organizations)

See §3.1 — registration is self-service and lands you directly on the donor dashboard.

### 7.2 Create a commitment

1. From a dashboard action signal (pre-fills entity/incident/response context) open the **Commitments** tab.
2. Select entity → incident → optionally a verified response plan; *Import unfulfilled items* pre-fills item name/unit/remaining quantity from that plan.
3. Enter items (name, unit, quantity, optional estimated value) and submit. New commitments start `PLANNED`.

### 7.3 Track fulfillment

- **Commitments tab / Responses page**: progress bars show delivered vs committed quantity; status moves `PLANNED → PARTIAL → COMPLETE` automatically as deliveries are verified. Only PLANNED/PARTIAL commitments can be updated.
- **Performance page**: delivery rate, total commitments/value, current rank, trend charts (fulfillment + verification rates), achievement badges (Gold/Silver/Bronze tiers for Reliable Delivery, High Volume, Quick Response, Consistency).
- **Leaderboard page**: ranking by weighted score (Delivery, Response Speed, Commitment Value, Consistency — weights explained on-page; recalculated every 15 minutes; ties share rank) plus export.
- **Reports page**: generate a report (CSV; PDF/Excel options — see §10) over a date range with optional charts/trends/gap-analysis content.

## 8. Administrator Workflows

Admin pages: dashboard (system-wide metrics), users, donors (+register/edit), settings (map / notifications / branding / currency), roles & permissions; under System: settings, audit log, health, database.

### 8.1 Users & roles

1. **Admin → Users**: create users (any role), filter, edit, deactivate.
2. **Roles page**: create/edit roles and toggle the permission matrix (20 seeded permissions, e.g. `CREATE_ASSESSMENT`, `VERIFY_ASSESSMENT`, `MANAGE_USERS`) per role.

### 8.2 System configuration

- **Settings → Map**: default center/zoom and map configuration.
- **Settings → Notifications**: per-user/per-event notification configuration (in-app, email, push channels).
- **Settings → Branding**: application name/logo (shown at login and in the header).
- **Settings → Currency**: display currency + symbol (system-wide; used everywhere amounts render).
- **System → Settings**: general system settings.
- **System → Health**: deep health check (database, S3 storage, Redis, backup status). `/api/health` is the lightweight public liveness probe.
- **System → Audit**: audit log of significant actions.
- **System → Database**: table statistics, backup create/restore/download, optimization.

## 9. Cross-Cutting Features

### 9.1 Offline & synchronization (field operations)

**What works offline:** creating rapid assessments, delivery confirmations, and entity records. Everything captured offline is AES-encrypted in the browser's local database; assessment forms are gated by an offline bootstrap (entities/incidents/reference data cached before you go offline, with a progress indicator). The header pill shows online/offline status.

**Sync behavior:** when connectivity returns (browser `online` event), queued changes flush automatically in batches of up to 100 — also retried every 30 seconds while online, or manually via the sync trigger (desktop notifications announce sync start/finish). Failed items retry 3 times (2s/5s/10s backoff) and are then flagged failed. **Conflicts resolve automatically — last-write-wins with the server copy**; conflict history is reviewable/exportable on the conflict log.

**What does not work offline:** pulling server-side changes onto the device (server pull-sync is not implemented — §10), dashboards/reports (need connectivity), file uploads.

### 9.2 Action signals (work queues)

Signals are **system-generated** work items, not user-created: overdue actions, awaiting-plan, awaiting-delivery, reassessment-needed, awaiting-plan-for-commitment, partially-covered, awaiting-verification, verification-overdue (>48h). Every role's dashboard shows its filtered queue plus a map; clicking a signal deep-links into the exact workflow action (e.g. a new-assessment form pre-filled, a delivery to confirm). Signals also drive notifications.

### 9.3 Notifications

In-app: the bell icon in the header with priority badges and unread counts. Channels (in-app / email / push) are configurable per user by admins. Browser push infrastructure exists (web-push/VAPID); enabling it end-to-end currently requires server-side key setup (§10).

### 9.4 Exports & reports

- **CSV exports** (`/api/v1/exports/csv`): role-scoped — assessors export their assessments; coordinators/responders add responses/entities/incidents; donors export commitments; admins export all.
- **Report builder** (Coordinator/Admin → Reports): reusable templates, generation in **PDF / CSV / HTML / Excel**, execution history and downloads.
- Donor self-service reports: see §7.3.

### 9.5 Media & attachments

Delivery evidence photos (JPEG/PNG/WebP images, MP4 video; ≤10MB per file enforced client-side) and branding/report artifacts. Files are stored via the storage service (S3-compatible with signed download URLs, local-disk fallback). Note: the in-form photo upload during delivery confirmation is not yet wired to real uploads (§10).

## 10. Known Limitations

User-visible gaps verified in code as of this manual's date:

1. **Server pull-sync is not implemented** — `/api/v1/sync/pull` and conflict *resolution* endpoints return 501. Offline devices push their changes but cannot refresh server data.
2. **Delivery photo upload is simulated** — the delivery form's photo widget animates an upload without sending files.
3. **Donor reports generate only CSV** (and JSON) — selecting PDF or Excel on the donor reports page falls back to a JSON download. Coordinator/Admin report builder does support real PDF/Excel.
4. **Resource Management page buttons** ("New Resource Request", "Management Settings") are decorative.
5. **Incident detail** relationship-map/timeline selectors are not interactive.
6. **No account lockout** — repeated failed logins do not lock the account (also: currently a locked/deactivated account produces a server error rather than a clean denial).
7. **Browser push enrolment is partial** — server can send pushes to registered subscriptions, but in-browser subscription wiring is limited.

## 11. Verifying the System

The regression baseline (`npm run test:baseline:all`, see `_bmad-output/test-artifacts/automation-summary.md`) locks down the workflows in this manual:

| Manual section | Baseline coverage |
|---|---|
| §3 Sign in / redirects / wrong credentials | `tests/e2e-baseline/login.spec.ts` (role→dashboard map, error messages) |
| §5 Rapid assessment surface | `tests/e2e-baseline/assessment-journey.spec.ts` |
| §4.2 Assessment verify cascade (approve/reject/auto-approve) | `tests/api/assessment-verify-cascade.test.ts` |
| §4.5 From-commitment planning; §6.2 deliver + verify | `tests/api/response-lifecycle.test.ts` |
| §4.7 Severity pipeline / gap fields | `tests/api/severity-and-sync.test.ts`, `tests/services/gap-field-severity.test.ts` |
| §2 Access gates per role | `tests/api/authz-matrix.test.ts` |
| §9.1 Sync push batch | `tests/api/severity-and-sync.test.ts` (batch auth/validation) |

If a behavior described here changes, update this manual and the pinned tests together.
