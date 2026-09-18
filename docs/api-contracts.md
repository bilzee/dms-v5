# API Contracts -- Disaster Response Management System

**Version:** 1.0.0
**Base URL (versioned):** `/api/v1`
**Non-versioned endpoints:** `/api/health`, `/api/entities/available-for-assessment`

---

## 1. Overview

This document describes the REST API for the Disaster Response Management System (DMS). The API is built with Next.js App Router route handlers and provides endpoints for managing disaster incidents, assessments, donor commitments, verification workflows, dashboards, reporting, and data synchronization.

All versioned endpoints are prefixed with `/api/v1`. Two endpoints (health check and available-for-assessment entities) are non-versioned and sit directly under `/api/`.

---

## 2. Authentication

Most endpoints are protected by the `withAuth` middleware, which validates a JWT token supplied in the `Authorization` header.

```
Authorization: Bearer <token>
```

### Token Acquisition

A JWT token is obtained via `POST /api/v1/auth/login` by supplying valid credentials (email and password). The response includes the token and user data.

### Token Refresh

Tokens can be refreshed via `POST /api/v1/auth/refresh`. The current valid token must be supplied in the `Authorization` header.

### Role-Based Access Control

Many endpoints enforce role-based access control. The following roles are recognized:

- **ADMIN** -- Full system access
- **COORDINATOR** -- Operational management, assignment, and verification
- **ASSESSOR** -- Assessment creation and submission
- **RESPONDER** -- Response delivery and verification
- **DONOR** -- Donor portal and commitment management

Permissions such as `MANAGE_USERS`, `ASSIGN_ROLES`, and others are checked on specific endpoints as documented below.

### Unauthenticated Endpoints

- `GET /api/health` -- No authentication required
- `POST /api/v1/auth/login` -- No authentication required (credentials in request body)

---

## 3. Response Format

All API responses follow a consistent structure. Successful responses return a `data` field along with a `meta` object containing request metadata. Error responses return an `error` field.

### Success Response

```json
{
  "data": { ... },
  "meta": {
    "timestamp": "2025-05-18T12:00:00.000Z",
    "version": "1.0.0",
    "requestId": "uuid-v4-string"
  }
}
```

Some endpoints also include a `success: true` boolean at the top level.

### Error Response

```json
{
  "error": "Descriptive error message",
  "meta": {
    "timestamp": "2025-05-18T12:00:00.000Z",
    "version": "1.0.0",
    "requestId": "uuid-v4-string"
  }
}
```

Validation errors additionally include a `details` array with field-level error information.

### Paginated Responses

List endpoints return a `pagination` object within the response:

```json
{
  "data": [ ... ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 100,
    "pages": 5
  },
  "meta": { ... }
}
```

### Common HTTP Status Codes

| Code | Meaning |
|------|---------|
| 200 | Success |
| 201 | Resource created successfully |
| 400 | Bad request / Validation error |
| 401 | Unauthorized (missing or invalid token) |
| 403 | Forbidden (insufficient role or permission) |
| 404 | Resource not found |
| 409 | Conflict (duplicate resource) |
| 500 | Internal server error |

---

## 4. API Endpoints

The following sections document all endpoints organized by resource group. Unless noted otherwise, all paths are relative to `/api/v1`.

---

### 4.1 Health

System health check endpoint. Located at the non-versioned path.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Returns system health status including uptime and environment. No authentication required. |

---

### 4.2 Auth

Authentication and user profile management.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/auth/login` | Authenticates a user with email and password. Returns JWT token and user data. No authentication required. |
| POST | `/auth/logout` | Logs out the current user. Client-side token invalidation. |
| GET | `/auth/me` | Returns the currently authenticated user with roles and permissions. |
| POST | `/auth/refresh` | Refreshes the current JWT token. |
| GET | `/auth/profile` | Returns the authenticated user's full profile. |
| PUT | `/auth/profile` | Updates the authenticated user's profile (name, email, phone, organization, password). |

---

### 4.3 Users

User management endpoints. Most require `MANAGE_USERS` permission.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/users` | Lists all users with pagination and search. Requires `MANAGE_USERS` permission. |
| POST | `/users` | Creates a new user. Requires `MANAGE_USERS` permission. |
| GET | `/users/{userId}` | Retrieves a single user by ID. Requires `MANAGE_USERS` permission. |
| PUT | `/users/{userId}` | Updates a user's details, roles, and status. Requires `MANAGE_USERS` permission. |
| GET | `/users/{userId}/roles` | Retrieves the roles assigned to a user. Requires `MANAGE_USERS` permission. |
| PUT | `/users/{userId}/roles` | Assigns roles to a user. Requires `ASSIGN_ROLES` permission. |
| GET | `/users/assignable` | Lists users available for entity assignment (ASSESSOR, RESPONDER, DONOR roles). Requires COORDINATOR or ADMIN role. |
| GET | `/users/me/donor` | Returns the donor record associated with the currently authenticated user. Requires DONOR role. |

---

### 4.4 Roles

System role management.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/roles` | Lists all roles with associated permissions. Requires `MANAGE_USERS` or `ASSIGN_ROLES` permission. |

---

### 4.5 Permissions

System permission listing.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/permissions` | Lists all permissions grouped by category. Requires `MANAGE_USERS` or `ASSIGN_ROLES` permission. |

---

### 4.6 Entities

Entity (affected community, facility, or organization) management and related data.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/entities` | Lists all active entities with pagination. Requires COORDINATOR or ADMIN role. |
| GET | `/entities/assigned` | Lists entities assigned to the current user. |
| GET | `/entities/commitments` | Lists donor commitments for entities with filtering. Requires COORDINATOR role. |
| POST | `/entities/commitments` | Creates a new donor commitment for an entity. Requires COORDINATOR role. |
| GET | `/entities/public` | Returns publicly available entity information. |
| GET | `/entities/{id}/assessments/latest` | Returns the most recent assessment for a specific entity. |
| GET | `/entities/{id}/auto-approval` | Returns the auto-approval configuration for an entity. Requires COORDINATOR role. |
| PUT | `/entities/{id}/auto-approval` | Updates the auto-approval configuration for an entity. Requires COORDINATOR role. |
| GET | `/entities/{id}/donors` | Returns donors associated with a specific entity. |
| GET | `/entities/{id}/donor-recommendations` | Returns recommended donors for a specific entity. |
| GET | `/entities/{id}/incidents` | Returns incidents associated with a specific entity. |

---

### 4.7 Entity Assignments

Manages the assignment of users to entities for assessment and response activities.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/entity-assignments` | Creates a new entity assignment. Requires COORDINATOR role. |
| GET | `/entity-assignments` | Lists all entity assignments with pagination. |
| DELETE | `/entity-assignments/{id}` | Removes an entity assignment. Requires COORDINATOR role. |
| GET | `/entity-assignments/{id}` | Retrieves details of a specific assignment. |
| POST | `/entity-assignments/bulk` | Creates multiple assignments in bulk. Requires COORDINATOR role. |
| GET | `/entity-assignments/collaboration` | Returns collaboration data across entity assignments. |
| GET | `/entity-assignments/entity/{entityId}` | Returns all assignments for a specific entity. |
| GET | `/entity-assignments/suggestions` | Returns optimal assignment suggestions for an entity. Requires COORDINATOR role. |
| POST | `/entity-assignments/suggestions` | Checks assignment conflicts for a set of user-entity pairs. Requires COORDINATOR role. |
| GET | `/entity-assignments/user/{userId}` | Returns all assignments for a specific user. |

---

### 4.8 Incidents

Incident (disaster event) lifecycle management.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/incidents` | Lists incidents with query filters and pagination. |
| POST | `/incidents` | Creates a new incident. Requires ASSESSOR, COORDINATOR, or ADMIN role. |
| GET | `/incidents/{id}` | Retrieves an incident by ID with population impact data. |
| PUT | `/incidents/{id}` | Updates an incident. Requires COORDINATOR or ADMIN role. |
| DELETE | `/incidents/{id}` | Soft-deletes an incident. Requires COORDINATOR or ADMIN role. |
| GET | `/incidents/{id}/entities` | Returns entities affected by a specific incident. |
| GET | `/incidents/{id}/assessment-summary` | Returns assessment summary data for a specific incident. |
| POST | `/incidents/from-assessment` | Creates an incident derived from assessment data. Requires ASSESSOR, COORDINATOR, or ADMIN role. |
| GET | `/incidents/types` | Returns available incident types. |

---

### 4.9 Preliminary Assessments

Initial needs assessment management.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/preliminary-assessments` | Lists preliminary assessments. |
| POST | `/preliminary-assessments` | Creates a new preliminary assessment. |
| GET | `/preliminary-assessments/{id}` | Retrieves a preliminary assessment by ID. |
| PUT | `/preliminary-assessments/{id}` | Updates a preliminary assessment. |
| DELETE | `/preliminary-assessments/{id}` | Deletes a preliminary assessment. |
| GET | `/preliminary-assessments/user/{userId}` | Returns preliminary assessments created by a specific user. |

---

### 4.10 Rapid Assessments

Detailed rapid assessment management with submission and priority workflows.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/rapid-assessments` | Creates a new rapid assessment draft. P9 ACTIVE-incident guard applies (see §4.25). |
| GET | `/rapid-assessments` | Lists rapid assessments. |
| GET | `/rapid-assessments/{id}` | Retrieves a rapid assessment by ID. |
| PUT | `/rapid-assessments/{id}` | Updates a rapid assessment. The P9 ACTIVE-incident guard fires when the payload re-points the assessment at a different incident (see §4.25). |
| DELETE | `/rapid-assessments/{id}` | Deletes a rapid assessment. |
| POST | `/rapid-assessments/{id}/submit` | Submits a rapid assessment for verification. |
| GET | `/rapid-assessments/latest` | Returns the most recent rapid assessments. |
| GET | `/rapid-assessments/user/{userId}` | Returns rapid assessments created by a specific user. |

---

### 4.11 Assessments (Verification)

Assessment verification and rejection workflows.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/assessments/verified` | Lists all verified assessments. |
| POST | `/assessments/{id}/verify` | Verifies an assessment, marking it as approved. |
| POST | `/assessments/{id}/reject` | Rejects an assessment with a reason. |

---

### 4.12 Relationships

Entity-incident relationship mapping and analysis.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/relationships` | Lists entity-incident relationships. |
| GET | `/relationships/statistics` | Returns aggregate statistics about relationships. |
| GET | `/relationships/timeline` | Returns a timeline of relationship events. |

---

### 4.13 Responses

Response delivery lifecycle management including planning, delivery, verification, and collaboration.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/responses/{id}` | Retrieves a response by ID. |
| PUT | `/responses/{id}` | Updates a response. |
| POST | `/responses/{id}/deliver` | Marks a response as delivered. |
| POST | `/responses/{id}/verify` | Verifies a delivered response. |
| POST | `/responses/{id}/reject` | Rejects a response. |
| GET | `/responses/{id}/collaboration` | Returns collaboration data for a response. |
| POST | `/responses/{id}/collaboration` | Adds a collaboration entry to a response. |
| GET | `/responses/assigned` | Returns responses assigned to the current user. |
| POST | `/responses/delivered` | Returns a list of delivered responses (query filter). |
| GET | `/responses/conflicts/{assessmentId}` | Returns response conflicts for a given assessment. |
| POST | `/responses/from-commitment` | Creates a response derived from a donor commitment. |
| GET | `/responses/planned` | Lists planned responses. |
| POST | `/responses/planned` | Creates a planned response. |
| GET | `/responses/planned/assigned` | Lists planned responses assigned to the current user. |

---

### 4.14 Verification

Verification queue management, auto-approval configuration, audit trails, and live verification.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/verification/queue/assessments` | Returns assessments awaiting verification. |
| GET | `/verification/queue/responses` | Returns responses awaiting verification. |
| GET | `/verification/queue/deliveries` | Returns deliveries awaiting verification. |
| POST | `/verification/queue/deliveries/{id}/verify` | Verifies a delivery from the verification queue. |
| GET | `/verification/auto-approval` | Returns the global auto-approval configuration. |
| PUT | `/verification/auto-approval` | Updates the global auto-approval configuration. |
| POST | `/verification/auto-approval/responses` | Configures auto-approval for responses. |
| GET | `/verification/auto-approval/responses` | Returns auto-approval configuration for responses. |
| GET | `/verification/audit` | Returns the verification audit trail. |
| GET | `/verification/live` | Returns live verification status data. |
| POST | `/verification/live` | Submits a live verification entry. |
| GET | `/verification/metrics` | Returns verification metrics and statistics. |
| GET | `/verification/metrics/responses` | Returns verification metrics specific to responses. |

---

### 4.15 Commitments

Donor commitment management including assignment, notification, and availability.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/commitments` | Lists all commitments with filtering. |
| GET | `/commitments/{id}` | Retrieves a commitment by ID with related donor, entity, and incident data. |
| PATCH | `/commitments/{id}` | Partially updates a commitment (status, quantities). |
| DELETE | `/commitments/{id}` | Deletes a commitment. |
| POST | `/commitments/{id}/assign` | Assigns a commitment to a responder or entity. |
| GET | `/commitments/{id}/assign` | Retrieves the assignment status of a commitment. |
| POST | `/commitments/{id}/notify` | Sends a notification related to a commitment. |
| GET | `/commitments/available` | Lists commitments available for assignment. |

---

### 4.16 Donors

Donor management, performance tracking, entity-level donor insights, and reporting.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/donors` | Registers a new donor. |
| GET | `/donors` | Lists all donors with filtering and pagination. |
| GET | `/donors/{id}` | Retrieves a donor by ID. |
| PUT | `/donors/{id}` | Updates a donor record. |
| GET | `/donors/{id}/performance-trends` | Returns performance trend data for a specific donor. |
| GET | `/donors/{id}/commitments` | Lists commitments for a specific donor. |
| POST | `/donors/{id}/commitments` | Creates a commitment for a specific donor. |
| GET | `/donors/profile` | Returns the donor profile for the authenticated user. |
| PATCH | `/donors/profile` | Partially updates the authenticated donor's profile. |
| GET | `/donors/management` | Lists donors for administrative management. |
| POST | `/donors/management` | Performs donor management actions (status changes, merges). |
| GET | `/donors/metrics` | Returns aggregate donor metrics and statistics. |
| GET | `/donors/entities` | Lists entities associated with the authenticated donor. |
| GET | `/donors/entities/{id}/assessments` | Returns assessments for a donor-associated entity. |
| GET | `/donors/entities/{id}/assessments/latest` | Returns the latest assessment for a donor-associated entity. |
| GET | `/donors/entities/{id}/assessments/trends` | Returns assessment trend data for a donor-associated entity. |
| GET | `/donors/entities/{id}/demographics` | Returns demographic data for a donor-associated entity. |
| GET | `/donors/entities/{id}/gap-analysis` | Returns gap analysis data for a donor-associated entity. |
| POST | `/donors/entities/{id}/reports/export` | Exports a report for a donor-associated entity. |
| GET | `/donors/entities/impact/assessments/latest` | Returns latest impact assessments across all donor entities. |
| GET | `/donors/entities/impact/demographics` | Returns demographic impact data across all donor entities. |

---

### 4.17 Leaderboard

Donor performance leaderboard and scoring criteria.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/leaderboard` | Returns the current donor performance leaderboard. |
| GET | `/leaderboard/criteria` | Returns the scoring criteria used for the leaderboard. |
| PATCH | `/leaderboard/criteria` | Updates the scoring criteria for the leaderboard. |

---

### 4.18 Auto-Assignment

Automated entity-to-user assignment configuration and triggering.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/auto-assignment/config` | Returns the current auto-assignment configuration. |
| PUT | `/auto-assignment/config` | Updates the auto-assignment configuration. |
| POST | `/auto-assignment/config` | Creates or resets the auto-assignment configuration. |
| POST | `/auto-assignment/trigger` | Manually triggers the auto-assignment process. |

---

### 4.19 Dashboard

Dashboard data endpoints for situation awareness and resource management.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/dashboard/situation` | Returns the situation awareness dashboard data. |
| GET | `/dashboard/resource-management/stats` | Returns resource management summary statistics. |
| GET | `/dashboard/resource-management/gap-analysis` | Returns resource gap analysis data. |
| GET | `/dashboard/resource-management/critical-gaps` | Returns critical resource gap data. |
| GET | `/dashboard/resource-management/commitments` | Returns commitment status data for the resource management dashboard. |

---

### 4.20 Coordinator

Coordinator-specific operational views.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/coordinator/dashboard/stats` | Returns aggregate statistics for the coordinator dashboard. |

---

### 4.21 Delivery Media

Media file management for response delivery documentation.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/delivery-media` | Lists delivery media records. |
| POST | `/delivery-media` | Uploads or registers a new delivery media record. |
| DELETE | `/delivery-media/{id}` | Deletes a delivery media record. |
| PUT | `/delivery-media/{id}` | Updates a delivery media record. |
| POST | `/delivery-media/sync` | Synchronizes delivery media records (offline sync). |

---

### 4.22 Exports

Data export capabilities including CSV, charts, reports, and scheduled exports.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/exports/csv` | Initiates a CSV data export. |
| GET | `/exports/csv` | Returns the status or result of a CSV export. |
| POST | `/exports/charts` | Generates chart data for export. |
| GET | `/exports/charts` | Returns the status or result of a chart export. |
| POST | `/exports/reports` | Initiates a report export. |
| GET | `/exports/reports` | Returns the status or result of a report export. |
| POST | `/exports/schedule` | Creates a scheduled export job. |
| GET | `/exports/schedule` | Lists scheduled export jobs. |
| PUT | `/exports/schedule` | Updates a scheduled export job. |
| DELETE | `/exports/schedule` | Deletes a scheduled export job. |

---

### 4.23 Reports

Report generation, templates, configurations, and execution management.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/reports/generate` | Generates a new report from parameters. |
| PUT | `/reports/generate` | Updates a report generation request. |
| POST | `/reports/configurations` | Creates a report configuration. |
| GET | `/reports/configurations` | Lists all report configurations. |
| GET | `/reports/templates` | Lists all report templates. |
| POST | `/reports/templates` | Creates a new report template. |
| GET | `/reports/templates/{id}` | Retrieves a report template by ID. |
| PATCH | `/reports/templates/{id}` | Partially updates a report template. |
| DELETE | `/reports/templates/{id}` | Deletes a report template. |
| GET | `/reports/download/{id}` | Downloads a generated report file. |
| GET | `/reports/executions/{id}` | Retrieves the status of a report execution. |
| POST | `/reports/executions/{id}` | Retries or re-runs a report execution. |
| DELETE | `/reports/executions/{id}` | Cancels or removes a report execution. |
| POST | `/reports/performance/export` | Exports performance report data. |

---

### 4.24 Sync

Offline data synchronization, conflict resolution, and batch processing.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/sync/pull` | Pulls latest data changes for offline synchronization. |
| GET | `/sync/status` | Returns the current synchronization status. |
| POST | `/sync/resolve` | Submits a conflict resolution. |
| GET | `/sync/resolve` | Returns pending conflict resolutions. |
| POST | `/sync/batch` | Submits a batch of offline changes for synchronization. |
| GET | `/sync/conflicts` | Lists synchronization conflicts. |
| GET | `/sync/conflicts/summary` | Returns a summary of synchronization conflicts. |
| GET | `/sync/conflicts/export` | Exports conflict data for analysis. |

---

### 4.25 Question Registry

The dynamic question registry — the single source of the assessment form, gap
severities, cross-field rules, and snapshot versioning. Severities live on
`Question.severity` (the legacy `GapFieldSeverity` table and its
`/gap-field-severities` routes were deleted in DQR P1); cross-field rules
live on `CrossFieldRule` rows (P10-2; the 15 legacy predicates seeded in both
partitions, deterministic ids `{TYPE}:{ruleKey}`).

Read surface (all authenticated roles):

| Method | Path | Description |
|--------|------|-------------|
| GET | `/questions?assessmentType={type}[&includeInactive=1]` | Returns the type's active sections with nested questions in presentation order, `structureVersion`/`contentVersion`, and `rules` — the type's cross-field rules ordered by `order` (tie-break `ruleKey`; the deterministic evaluation order). `includeInactive=1` requires ADMIN and additionally returns inactive questions and rules. |

Governance (ADMIN only; every mutation requires a `reason`, is validated against registry invariants, and is audit-logged):

| Method | Path | Description |
|--------|------|-------------|
| POST | `/admin/questions` | Creates a question (camelCase `questionKey`, category-matched, GAP ⇒ BOOLEAN + required + gap metadata). |
| PUT | `/admin/questions/{id}` | Tier A edits (label/helperText/gap phrasing/recommendation/severity copy) bump `contentVersion`; Tier B edits (type/category/inverted/required/section move/number bounds/option-value removal) bump `structureVersion` and are freeze-gated (409 `question_frozen`). `questionKey` renames are 400 `question_key_immutable`. |
| DELETE | `/admin/questions/{id}` | Soft-deactivates the question (freeze-gated; deactivating the last active GAP of a non-POPULATION type, or a question whose key an ACTIVE cross-field rule references, rolls back with 400 `registry_invalid` listing the rules). |
| PATCH | `/admin/questions/{id}/severity` | Pins a GAP severity (`CRITICAL|HIGH|MEDIUM`; Tier A — content bump). Response: `{ data: { question, affectedCount, affectedIncidentIds } }` — affected ACTIVE-incident assessments are re-derived in the same transaction and their incident ids surfaced. |
| GET | `/admin/questions/{id}/audit` | Returns the question's audit timeline. |
| GET | `/admin/questions/{id}/impact` | Returns deactivation impact: `snapshotCount`, `activeUnderIncidentCount`/`affectedCount`, `latestSnapshot`, and `referencingRules` — the ACTIVE cross-field rules whose `referenceKeys` contain the question key (the deactivation guard's block list). ADMIN or COORDINATOR. |
| POST | `/admin/questions/reorder` | Reorders sections or the questions within a section. |
| GET | `/admin/questions/export` | Exports the full registry (sections + questions + versions) as JSON. |
| POST | `/admin/sections` | Creates a section (kebab-case `sectionKey`). |
| PUT | `/admin/sections/{id}` | Updates a section's title/description/category/order. |
| DELETE | `/admin/sections/{id}` | Soft-deactivates a section (invariant-checked). |
| POST | `/admin/rules` | Creates a cross-field rule for a type (kebab-case `ruleKey`, `kind` `REFINEMENT|AGGREGATE`, `message` with optional `{{value:key}}`/`{{sum:k1,k2}}` tokens, optional `when` gate `BoolGate|Compare`, `expression` compare AST, `referenceKeys` ⊆ active question keys of the type). Every rule mutation bumps `structureVersion` only (never `contentVersion`) and is never per-question freeze-gated. |
| PUT | `/admin/rules/{id}` | Edits name/message/kind/when/expression/referenceKeys/order/isActive; re-validates the merged AST + references on semantic fields. `ruleKey` renames are 400 `rule_key_immutable`; duplicates 409 `rule_key_duplicate`; invalid AST/references 400 `registry_invalid`. |
| DELETE | `/admin/rules/{id}` | Soft-deactivates the rule (`isActive: false`) with a mandatory `reason`. Deactivating the last active REFINEMENT of a type is allowed (validation is optional by design) and lifts the question-deactivation guard for its keys. |
| GET | `/admin/rules/{id}/audit` | Returns the rule's audit timeline (`entityType: 'RULE'` rows). |

**Cross-field enforcement (P10-2):** `POST /rapid-assessments`,
`PUT /rapid-assessments/{id}`, and `POST /rapid-assessments/{id}/submit`
evaluate the type's ACTIVE `REFINEMENT` rules server-side; a violating
payload is rejected with 400 `Cross-field validation failed` and
`details[] = [{ key, message, kind }]` per violation (`key` = the rule's
primary `referenceKeys[0]`; `/submit` evaluates the row's stored answers).
`AGGREGATE` rules are never server-enforced (client-live warnings only). The
offline `POST /sync/batch` path is exempt (never-reject): the same replay
persists with the violations stored as an informational, REFINEMENT-only
`gapAnalysis.crossFieldViolations` array — an additive key written only when
non-empty — and the batch still returns 200/207.

**ACTIVE-incident submission guard (P9):** `POST /rapid-assessments` rejects
submissions whose target incident does not exist with `404 Incident not
found`, and whose target incident is no longer `ACTIVE` (CONTAINED/RESOLVED)
with `409 Incident {id} is not active`; `PUT /rapid-assessments/{id}` applies
the same check when the payload re-points the assessment at another incident.
No row is written in either failure mode. The offline `POST /sync/batch` path
is deliberately exempt from the ACTIVE rule — by ruling (plan §4 `/sync`,
never-reject) offline sync must not discard completed field assessments when
an incident is resolved mid-flight; a dangling incidentId still fails at the
database FK as it always has.

---

### 4.26 Severity Thresholds

Configuration of severity thresholds for assessment scoring.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/severity-thresholds` | Lists all severity threshold configurations. |
| POST | `/severity-thresholds` | Creates a new severity threshold configuration. |
| GET | `/severity-thresholds/{id}` | Retrieves a severity threshold configuration by ID. |
| PUT | `/severity-thresholds/{id}` | Updates a severity threshold configuration. |
| DELETE | `/severity-thresholds/{id}` | Deletes a severity threshold configuration. |

---

### 4.27 Entities (Non-Versioned)

Non-versioned entity endpoints.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/entities/available-for-assessment` | Returns entities available for assessment. Requires authentication. |

---

## 5. Summary Statistics

### Resource Group Distribution

| Resource Group | Endpoints |
|----------------|-----------|
| Health | 1 |
| Auth | 6 |
| Users | 8 |
| Roles | 1 |
| Permissions | 1 |
| Entities | 12 |
| Entity Assignments | 10 |
| Incidents | 9 |
| Preliminary Assessments | 6 |
| Rapid Assessments | 8 |
| Assessments (Verification) | 3 |
| Relationships | 3 |
| Responses | 15 |
| Verification | 13 |
| Commitments | 8 |
| Donors | 21 |
| Leaderboard | 3 |
| Auto-Assignment | 4 |
| Dashboard | 5 |
| Coordinator | 1 |
| Delivery Media | 5 |
| Exports | 10 |
| Reports | 13 |
| Sync | 8 |
| Question Registry | 16 |
| Severity Thresholds | 5 |
| Entities (Non-Versioned) | 1 |
| **Total** | **196** |

### HTTP Method Distribution

Verified against the codebase (counting exported handlers in
`src/app/api/**/route.ts` at DQR P10-2):

| Method | Count | Description |
|--------|-------|-------------|
| GET | 139 | Read and query operations |
| POST | 69 | Create and action operations |
| PUT | 26 | Full update operations |
| PATCH | 7 | Partial update operations |
| DELETE | 20 | Delete operations |
| **Total** | **261 method handlers across 183 route files** | |

Note: The resource-group table above counts endpoints this document
**contracts for** (a curated inventory); the method distribution counts every
implemented handler in `src/app/api` — the codebase carries additional
experimental/internal routes beyond the documented contract, so the two totals
differ by design.
