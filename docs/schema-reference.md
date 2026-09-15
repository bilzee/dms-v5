# Prisma Schema Reference

_Auto-generated on 2026-09-15T12:18:41.077Z_

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
- `auditLogs`
- `createdAt`
- `updatedAt`
- `section`

## QuestionAuditLog

**Fields:**
- `id`
- `questionId`
- `action`
- `changes`
- `previous`
- `actorId`
- `actedAt`
- `question`
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

