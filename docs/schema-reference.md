# Prisma Schema Reference

_Auto-generated on 2026-09-15T14:56:05.832Z_

## ReportTemplate

**Fields:**
- `id`
- `name`
- `description`
- `type`
- `layout`
- `createdById`
- `isPublic`
- `createdAt`
- `updatedAt`
- `configurations`
- `createdBy`

## ReportConfiguration

**Fields:**
- `id`
- `templateId`
- `name`
- `filters`
- `aggregations`
- `visualizations`
- `schedule`
- `createdBy`
- `createdAt`
- `creator`
- `template`
- `executions`

## ReportExecution

**Fields:**
- `id`
- `configurationId`
- `status`
- `format`
- `filePath`
- `generatedAt`
- `error`
- `createdAt`
- `configuration`

## ScheduledReport

**Fields:**
- `id`
- `userId`
- `reportType`
- `schedule`
- `recipients`
- `filters`
- `defaultDateRange`
- `options`
- `isActive`
- `lastRunAt`
- `nextRunAt`
- `createdAt`
- `updatedAt`
- `user`

## User

**Fields:**
- `id`
- `email`
- `username`
- `passwordHash`
- `name`
- `phone`
- `organization`
- `isActive`
- `isLocked`
- `lastLogin`
- `createdAt`
- `updatedAt`
- `auditLogs`
- `entityAssignments`
- `questionAuditLogs`
- `assessments`
- `responses`
- `reportConfigurations`
- `reportTemplates`
- `scheduledReports`
- `roles`
- `actionSignals`
- `notifications`
- `pushSubscriptions`

## Role

**Fields:**
- `id`
- `name`
- `description`
- `createdAt`
- `permissions`
- `userRoles`

## UserRole

**Fields:**
- `id`
- `userId`
- `roleId`
- `assignedAt`
- `assignedBy`
- `role`
- `user`

## Permission

**Fields:**
- `id`
- `name`
- `code`
- `category`
- `description`
- `createdAt`
- `roles`

## RolePermission

**Fields:**
- `id`
- `roleId`
- `permissionId`
- `permission`
- `role`

## Entity

**Fields:**
- `id`
- `name`
- `type`
- `location`
- `coordinates`
- `metadata`
- `isActive`
- `autoApproveEnabled`
- `createdAt`
- `updatedAt`
- `commitments`
- `assignments`
- `rapidAssessments`
- `responses`
- `preliminaryAssessments`
- `actionSignals`

## EntityAssignment

**Fields:**
- `id`
- `userId`
- `entityId`
- `assignedAt`
- `assignedBy`
- `entity`
- `user`

## Incident

**Fields:**
- `id`
- `name`
- `type`
- `subType`
- `severity`
- `status`
- `description`
- `location`
- `coordinates`
- `createdBy`
- `createdAt`
- `updatedAt`
- `commitments`
- `preliminaryAssessments`
- `rapidAssessments`
- `actionSignals`

## PreliminaryAssessment

**Fields:**
- `id`
- `reportingDate`
- `reportingLatitude`
- `reportingLongitude`
- `reportingLGA`
- `reportingWard`
- `numberLivesLost`
- `numberInjured`
- `numberDisplaced`
- `numberHousesAffected`
- `numberSchoolsAffected`
- `schoolsAffected`
- `numberMedicalFacilitiesAffected`
- `medicalFacilitiesAffected`
- `estimatedAgriculturalLandsAffected`
- `reportingAgent`
- `additionalDetails`
- `incidentId`
- `createdAt`
- `updatedAt`
- `incident`
- `affectedEntities`

## PreliminaryAssessmentEntity

**Fields:**
- `id`
- `preliminaryAssessmentId`
- `entityId`
- `createdAt`
- `preliminaryAssessment`
- `entity`

## RapidAssessment

**Fields:**
- `id`
- `rapidAssessmentType`
- `rapidAssessmentDate`
- `assessorId`
- `entityId`
- `assessorName`
- `location`
- `coordinates`
- `priority`
- `versionNumber`
- `isOfflineCreated`
- `syncStatus`
- `verificationStatus`
- `verifiedAt`
- `verifiedBy`
- `rejectionReason`
- `rejectionFeedback`
- `mediaAttachments`
- `createdAt`
- `updatedAt`
- `gapAnalysis`
- `incidentId`
- `answers`
- `structureVersion`
- `contentVersion`
- `questionSnapshot`
- `assessor`
- `entity`
- `incident`
- `responses`

## RapidResponse

**Fields:**
- `id`
- `responderId`
- `entityId`
- `assessmentId`
- `type`
- `priority`
- `deliveryStatus`
- `description`
- `resources`
- `timeline`
- `versionNumber`
- `isOfflineCreated`
- `verificationStatus`
- `verifiedAt`
- `verifiedBy`
- `createdAt`
- `updatedAt`
- `items`
- `offlineId`
- `plannedDate`
- `rejectionFeedback`
- `rejectionReason`
- `responseDate`
- `syncStatus`
- `mediaAttachments`
- `assessment`
- `entity`
- `responder`
- `conflicts`
- `planCommitments`
- `sourceCommitmentId`
- `sourceCommitment`

## Donor

**Fields:**
- `id`
- `name`
- `type`
- `contactEmail`
- `contactPhone`
- `organization`
- `isActive`
- `createdAt`
- `updatedAt`
- `leaderboardRank`
- `selfReportedDeliveryRate`
- `verifiedDeliveryRate`
- `achievementBadges`
- `commitments`

## DonorCommitment

**Fields:**
- `id`
- `donorId`
- `entityId`
- `incidentId`
- `type`
- `sourcePlanId`
- `status`
- `items`
- `totalCommittedQuantity`
- `deliveredQuantity`
- `verifiedDeliveredQuantity`
- `commitmentDate`
- `lastUpdated`
- `notes`
- `totalValueEstimated`
- `donor`
- `entity`
- `incident`
- `planCommitments`
- `sourcePlan`

## MediaAttachment

**Fields:**
- `id`
- `responseId`
- `filename`
- `originalName`
- `mimeType`
- `fileSize`
- `filePath`
- `thumbnailPath`
- `uploadedAt`
- `uploadedBy`
- `response`

## SyncConflict

**Fields:**
- `id`
- `entityType`
- `entityId`
- `conflictDate`
- `resolutionMethod`
- `winningVersion`
- `losingVersion`
- `resolvedAt`
- `coordinatorNotified`
- `coordinatorNotifiedAt`
- `responseId`
- `response`

## AuditLog

**Fields:**
- `id`
- `userId`
- `action`
- `resource`
- `resourceId`
- `oldValues`
- `newValues`
- `timestamp`
- `ipAddress`
- `userAgent`
- `user`

## QuestionSection

**Fields:**
- `id`
- `assessmentType`
- `sectionKey`
- `title`
- `description`
- `category`
- `order`
- `isActive`
- `version`
- `createdAt`
- `updatedAt`
- `questions`

## Question

**Fields:**
- `id`
- `questionKey`
- `assessmentType`
- `sectionId`
- `questionType`
- `label`
- `helperText`
- `required`
- `options`
- `category`
- `inverted`
- `gapLabel`
- `gapMeaning`
- `recommendation`
- `severity`
- `numberMin`
- `numberMax`
- `order`
- `isActive`
- `version`
- `createdAt`
- `updatedAt`
- `section`

## QuestionAuditLog

**Fields:**
- `id`
- `entityType`
- `entityId`
- `action`
- `changes`
- `previous`
- `reason`
- `actorId`
- `actedAt`
- `actor`

## SystemSetting

**Fields:**
- `id`
- `section`
- `key`
- `value`
- `updatedAt`
- `updatedBy`

## ActionSignal

**Fields:**
- `id`
- `userId`
- `entityId`
- `incidentId`
- `type`
- `signalReason`
- `priority`
- `context`
- `createdAt`
- `resolvedAt`
- `user`
- `entity`
- `incident`
- `notifications`

## Notification

**Fields:**
- `id`
- `userId`
- `signalId`
- `title`
- `body`
- `priority`
- `readAt`
- `dismissedAt`
- `createdAt`
- `expiresAt`
- `user`
- `signal`

## PushSubscription

**Fields:**
- `id`
- `userId`
- `endpoint`
- `p256dh`
- `auth`
- `browserInfo`
- `createdAt`
- `user`

## PlanCommitment

**Fields:**
- `id`
- `planId`
- `commitmentId`
- `createdAt`
- `plan`
- `commitment`

---

# Dynamic Question Registry — Data Dictionary

The registry (`QuestionSection` + `Question`, both catalogued above) is the
single source of the assessment form. This dictionary explains the semantics
each field carries and how the registry connects to assessment rows.

## QuestionSection

| Field | Meaning |
|-------|---------|
| `assessmentType` + `sectionKey` | Unique per type; keys are kebab-case (`health-gaps`). Immutable after creation. |
| `category` | `GAP` sections hold boolean gap questions; `CONTEXT` sections hold descriptive questions. A section's category must match its questions'. |
| `order` | Presentation order within the type (reorder bumps `structureVersion`). |
| `isActive` | Soft-delete flag; deactivating a section cascades validation. |

## Question

| Field | Meaning |
|-------|---------|
| `assessmentType` + `questionKey` | Unique per type; keys are camelCase (`hasFunctionalClinic`) and immutable (`question_key_immutable`). Seeded ids are `{TYPE}:{questionKey}`. |
| `questionType` | `BOOLEAN`, `NUMBER`, `SINGLE_CHOICE`, `MULTI_SELECT`, `TEXT_LONG`. GAP questions must be BOOLEAN. |
| `label` / `helperText` | Assessor-facing copy (Tier A — content bump only). |
| `category` | `GAP` or `CONTEXT`; must match the owning section. GAP ⇒ BOOLEAN + `required` + `gapLabel`/`gapMeaning`. |
| `inverted` | GAP polarity: when `true` the gap fires on `true` instead of `false`. Tier B. |
| `gapLabel` / `gapMeaning` | Phrasing of the gap row on dashboards/reports and what it means operationally. Tier A. |
| `recommendation` | Standing recommendation shown when the gap fires. Tier A. |
| `severity` | Registry severity of the gap (`CRITICAL|HIGH|MEDIUM` for GAP; `LOW`/`UNCLASSIFIED` are not valid GAP severities). Meaningless for CONTEXT questions — they carry the column default `LOW`, which is never read. Drives assessment priority, notifications, and signals (D-4 severity inheritance). Tier A. |
| `options` | Choice questions' `{ value, label, description? }[]` (`description` is optional helper copy rendered with the option). Editing labels/appending values is Tier A; REMOVING a value is Tier B (stored answers may still carry it). |
| `numberMin` / `numberMax` | NUMBER bounds (Tier B). |
| `order` | Presentation order within the section. |
| `isActive` | Soft-delete flag; the last active GAP of a non-POPULATION type cannot be deactivated (`registry_invalid`). |

## RapidAssessment registry columns

| Field | Meaning |
|-------|---------|
| `answers` | The submitted answers map keyed by `questionKey` (registry keys, never per-type payloads). |
| `questionSnapshot` | Structure-only snapshot of the questions frozen at submission — one snapshot shape for every type; drives form rebuilds, gap analysis, and dashboard summaries. |
| `structureVersion` / `contentVersion` | The registry versions the snapshot was frozen against (structure = Tier B count, content = Tier A count). |
| `gapAnalysis` | Derived gap report (gaps, severity, priority) computed from the snapshot + live registry severities at submission. |
| `incidentId` | Required; on **online** create (and on update when the payload re-points the incident) the incident must exist and be `ACTIVE` (404/409). The offline sync path is exempt from the ACTIVE rule by the never-reject ruling. |

## SystemSetting version counters

Per assessment type: `section = 'QUESTION_REGISTRY'`, keys
`structureVersion/{TYPE}` / `contentVersion/{TYPE}` (see
`src/lib/questions/registry-versions.ts`). Tier A edits bump
content; Tier B edits (and section/question lifecycle + reorders) bump
structure. Both are monotonic per type.

## QuestionAuditLog

Governance trail for every registry mutation: `entityType`
(`QUESTION`|`SECTION`), `action`, `changes` (after-diff), `previous`
(before-image), mandatory `reason` for structural actions, and the `actor`.

