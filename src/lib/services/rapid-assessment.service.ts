import { prisma } from '@/lib/db/client'
import { RapidAssessment, AssessmentType, Prisma } from '@prisma/client'
import {
  CreateRapidAssessmentInput,
  UpdateRapidAssessmentInput,
  QueryRapidAssessmentInput,
  AssessmentTypeName,
} from '@/lib/validation/rapid-assessment'
import { buildAssessmentSchema } from '@/lib/validation/dynamic-assessment'
import {
  ingestOfflineAnswers,
  toOfflineSyncWarnings,
  type OfflineSyncWarning,
} from '@/lib/questions/offline-answers'
import {
  analyzeGaps,
  analyzeGapsFromSnapshot,
  derivePriorityFromGaps,
  GapAnalysis
} from '@/lib/services/gap-analysis.service'
import type { GapEngineSnapshotStructure } from '@/lib/questions/gap-engine'
import type { QuestionSnapshot } from '@/lib/questions/question-snapshot'
import { ApiError } from '@/types/api'
import { QuestionRegistryService } from '@/lib/services/question-registry.service'
import { evaluateRefinements, type CrossFieldViolation } from '@/lib/questions/rule-engine'

/**
 * Rapid Assessment Service — Dynamic Question Registry edition (P4).
 *
 * Answers live in `RapidAssessment.answers` keyed by registry questionKey and
 * arrive from the client as the canonical `{ [questionKey]: value }` map (the
 * typed `healthData`/`washData`/... payloads were deleted with the six
 * hardcoded forms). On every create/update the service:
 *
 *   1. fetches the CURRENT registry snapshot for the type,
 *   2. validates `answers` against it via `buildAssessmentSchema` — unknown
 *      keys are stripped, required questions enforced, violations 422 with
 *      per-field errors — and enforces the type's ACTIVE cross-field
 *      REFINEMENT rules server-side (400 with the violation array as
 *      `details`; aggregates stay client-live-only — P10-2),
 *   3. freezes that snapshot onto the row and derives `gapAnalysis` +
 *      `priority` through the gap engine (priority is never client input).
 */

// Returned assessments carry answers/snapshot directly on the row.
export type RapidAssessmentWithData = RapidAssessment

/** Total question count across snapshot sections (empty-registry guard). */
function snapshotQuestionCount(snapshot: { sections: Array<{ questions: unknown[] }> }): number {
  return snapshot.sections.reduce((count, section) => count + section.questions.length, 0)
}

/** Adapts a frozen QuestionSnapshot to the validation builder's question-set shape. */
function snapshotAsQuestionSet(snapshot: QuestionSnapshot) {
  return {
    sections: snapshot.sections.map((section) => ({
      questions: section.questions.map((question) => ({
        key: question.key,
        questionType: question.type,
        required: question.required,
        options: question.options,
        numberMin: question.numberMin,
        numberMax: question.numberMax,
      })),
    })),
  }
}

/**
 * Validates an answers payload against the given frozen snapshot and returns
 * the canonical (unknown-keys-stripped) answers map. Throws ApiError 422 with
 * zod-flattened field errors on any violation.
 */
function validateAnswersAgainstSnapshot(
  snapshot: QuestionSnapshot,
  answers: Record<string, unknown>
): Record<string, unknown> {
  const parsed = buildAssessmentSchema(snapshotAsQuestionSet(snapshot)).safeParse(answers ?? {})
  if (!parsed.success) {
    const flattened = parsed.error.flatten()
    throw new ApiError(
      'Answers failed registry validation',
      422,
      {
        fieldErrors: flattened.fieldErrors,
        formErrors: flattened.formErrors,
      }
    )
  }
  return parsed.data as Record<string, unknown>
}

/**
 * Loads the type's ACTIVE cross-field rules (per-type 30s cache) and
 * evaluates the REFINEMENT subset against the given answers (P10-2). The
 * evaluator never throws; AGGREGATE rules are never returned (they stay
 * client-live-only, legacy parity).
 */
async function evaluateActiveRefinements(
  assessmentType: string,
  answers: Record<string, unknown>
): Promise<CrossFieldViolation[]> {
  const rules = await QuestionRegistryService.getRules(assessmentType)
  return evaluateRefinements(
    rules.map((rule) => ({
      ruleKey: rule.ruleKey,
      kind: rule.kind,
      message: rule.message,
      when: rule.when ?? undefined,
      expression: rule.expression,
      referenceKeys: rule.referenceKeys,
      order: rule.order,
    })),
    answers
  )
}

/**
 * Server-side REFINEMENT enforcement for the ONLINE paths (create/update/
 * submit): a violating payload is rejected with 400 and the violation array
 * (`{key, message, kind}` per entry) as `details`. Offline `/sync/batch` is
 * exempt by ruling (plan §8 never-reject) and stores the same violations as
 * informational `gapAnalysis.crossFieldViolations` flags instead.
 */
async function assertNoRefinementViolations(
  assessmentType: string,
  answers: Record<string, unknown>
): Promise<void> {
  const violations = await evaluateActiveRefinements(assessmentType, answers)
  if (violations.length > 0) {
    throw new ApiError('Cross-field validation failed', 400, violations)
  }
}

/** Offline-sync payloads additionally declare the client's registry view. */
export type CreateOfflineRapidAssessmentInput = CreateRapidAssessmentInput & {
  questionKeys?: readonly string[] | null
  /** Client-generated row id (Dexie uuid) for idempotent batch replay. */
  offlineId?: string | null
}

export type UpdateOfflineRapidAssessmentInput = UpdateRapidAssessmentInput & {
  questionKeys?: readonly string[] | null
}

/** Offline create/update outcome: the row plus its drift warnings. */
export interface OfflineAssessmentSyncResult {
  assessment: RapidAssessmentWithData
  warnings: OfflineSyncWarning[]
}

/**
 * Never-reject re-validation of INGESTED offline answers against the fresh
 * snapshot (P5): `added` questions are treated as unanswered/optional — a
 * missing required question is drift, not an error — and any residual
 * value-level findings are logged, never thrown. Offline field data wins;
 * the INGESTED map (retained unknown keys included) is what gets stored.
 */
function relaxedValidateOfflineAnswers(
  snapshot: QuestionSnapshot,
  answers: Record<string, unknown>,
  addedKeys: readonly string[]
): void {
  const questionSet = snapshotAsQuestionSet(snapshot)
  const relaxed = {
    sections: questionSet.sections.map((section) => ({
      questions: section.questions.map((question) =>
        addedKeys.includes(question.key) ? { ...question, required: false } : question
      ),
    })),
  }
  const parsed = buildAssessmentSchema(relaxed).safeParse(answers)
  if (!parsed.success) {
    console.warn(
      '[RapidAssessmentService] offline answers retained despite validation findings:',
      JSON.stringify(parsed.error.flatten().fieldErrors)
    )
  }
}

export class RapidAssessmentService {
  static async create(
    input: CreateRapidAssessmentInput,
    createdBy: string
  ): Promise<RapidAssessmentWithData> {
    const { type, entityId, answers } = input

    // Verify user is assigned to this entity — authorization precedes the
    // incident-state check below so an unassigned caller learns nothing about
    // incident existence or lifecycle (404/409 oracle).
    await this.validateEntityAssignment(createdBy, entityId)

    // P9 hardening — ACTIVE-incident submission guard. An assessment may
    // only be filed under an incident that exists and is still ACTIVE:
    // unknown (or omitted) ids are 404, CONTAINED/RESOLVED incidents are
    // 409. Checked before any write so a guard failure leaves no row.
    await this.assertActiveIncident(input.incidentId)

    // Check if entity has auto-approval enabled
    const entity = await prisma.entity.findUnique({
      where: { id: entityId },
      select: { autoApproveEnabled: true }
    })

    if (!entity) {
      throw new Error('Entity not found')
    }

    // Determine verification status based on entity's auto-approval setting
    const verificationStatus = entity.autoApproveEnabled ? 'AUTO_VERIFIED' : 'SUBMITTED'

    // Freeze the per-assessment snapshot from the registry service (single source)
    const questionSnapshot = await QuestionRegistryService.getSnapshot(type)
    if (snapshotQuestionCount(questionSnapshot) === 0) {
      throw new Error(`No active registry questions found for assessment type ${type}`)
    }

    // Validate the client's answers against the snapshot being frozen:
    // unknown keys stripped, required questions enforced.
    const validatedAnswers = validateAnswersAgainstSnapshot(questionSnapshot, answers ?? {})

    // P10-2 — server-side cross-field enforcement: the validated answers must
    // satisfy the type's active REFINEMENT rules (aggregates stay client-side).
    await assertNoRefinementViolations(type, validatedAnswers)

    // Derive gap analysis + priority through the engine, against the snapshot
    // this assessment just froze (priority replaces client input)
    const gapAnalysis = await analyzeGapsFromSnapshot(type, questionSnapshot, validatedAnswers)
    const priority = derivePriorityFromGaps(type, gapAnalysis)

    const rapidAssessment = await prisma.rapidAssessment.create({
      data: {
        rapidAssessmentType: type,
        rapidAssessmentDate: input.rapidAssessmentDate,
        assessorId: createdBy,
        assessorName: input.assessorName,
        entityId: input.entityId,
        incidentId: input.incidentId,
        location: input.location,
        coordinates: input.coordinates as unknown as Prisma.InputJsonValue | undefined,
        priority,
        mediaAttachments: input.mediaAttachments || [],
        versionNumber: 1,
        isOfflineCreated: false,
        syncStatus: 'SYNCED',
        verificationStatus,
        verifiedAt: entity.autoApproveEnabled ? new Date() : null,
        answers: validatedAnswers as unknown as Prisma.InputJsonValue,
        structureVersion: questionSnapshot.structureVersion,
        contentVersion: questionSnapshot.contentVersion,
        questionSnapshot: questionSnapshot as unknown as Prisma.InputJsonValue,
        gapAnalysis: gapAnalysis as unknown as Prisma.InputJsonValue,
      }
    })

    // Recalculate incident severity bottom-up
    if (input.incidentId) {
      try {
        const { incidentSeverityService } = await import('@/lib/services/incident-severity.service');
        await incidentSeverityService.recalculateIncidentSeverity(input.incidentId)
      } catch {}
    }

    try {
      const { ActionSignalService } = await import('@/lib/services/action-signal.service');
      await ActionSignalService.evaluateAndGenerate({
        trigger: entity.autoApproveEnabled ? 'assessment-verified' : 'assessment-created',
        entityId: input.entityId,
        incidentId: input.incidentId,
        assessmentId: rapidAssessment.id,
        assessmentType: type,
        assessmentPriority: rapidAssessment.priority,
      });
    } catch (e) {
      console.error('[RapidAssessmentService] signal hook error:', e);
    }

    return rapidAssessment
  }

  /**
   * Creates an assessment from an OFFLINE submission (P5) — the never-reject
   * mirror of `create`. The CURRENT live snapshot is frozen exactly like the
   * online path; answers are then INGESTED instead of strictly validated:
   * every non-null answer persists verbatim (MULTI_SELECT JSON-string
   * replays normalized), and drift is reported as warnings —
   *   added (unanswered new questions) / removed (now-inactive keys) /
   *   unknown (keys with no registry row).
   *
   * The row records the CLIENT's `structureVersion` (the handshake the
   * answers were captured against; falls back to the frozen snapshot's).
   * Registry drift NEVER rejects the submission; only shape-level failures
   * (unknown type, unassigned entity, empty registry) throw.
   */
  static async createOfflineAssessment(
    input: CreateOfflineRapidAssessmentInput,
    createdBy: string,
    clientStructureVersion?: number | null
  ): Promise<OfflineAssessmentSyncResult> {
    const { type, entityId, answers, offlineId } = input

    // No ACTIVE-incident guard here, by ruling: offline sync never rejects a
    // completed assessment (plan §4 /sync; prompt-9 decision 7). An incident
    // resolved while the assessor was offline must not discard field work;
    // a dangling incidentId still fails at the FK as it always has.

    // Verify user is assigned to this entity (same gate as the online path).
    await this.validateEntityAssignment(createdBy, entityId)

    const entity = await prisma.entity.findUnique({
      where: { id: entityId },
      select: { autoApproveEnabled: true }
    })

    if (!entity) {
      throw new Error('Entity not found')
    }

    const verificationStatus = entity.autoApproveEnabled ? 'AUTO_VERIFIED' : 'SUBMITTED'

    // Freeze the per-assessment snapshot from the registry service (single
    // source) — identical to `create`, so the drift report is computed against
    // the registry this row actually froze.
    const questionSnapshot = await QuestionRegistryService.getSnapshot(type)
    if (snapshotQuestionCount(questionSnapshot) === 0) {
      throw new Error(`No active registry questions found for assessment type ${type}`)
    }

    // Ingest the offline answers against the frozen snapshot + ALL live
    // registry rows (active + inactive) for drift classification.
    const registryRows = await prisma.question.findMany({
      where: { assessmentType: type },
      select: { questionKey: true, isActive: true },
    })
    const { answers: ingestedAnswers, warnings } = ingestOfflineAnswers(
      type,
      answers ?? {},
      questionSnapshot,
      registryRows
    )

    // Diagnostics-only re-validation (added questions optional; never throws).
    relaxedValidateOfflineAnswers(questionSnapshot, ingestedAnswers, warnings.added)

    // P10-2 — offline replay exemption (never-reject, plan §8): what the
    // online path would reject with 400 is stored as an informational flag.
    // REFINEMENT-only, additive key, written ONLY when non-empty so existing
    // gapAnalysis shapes stay untouched.
    const crossFieldViolations = await evaluateActiveRefinements(type, ingestedAnswers)

    // Derive gap analysis + priority against the frozen snapshot; answered
    // keys outside the snapshot self-derive as source-'unknown' rows.
    const gapAnalysis = await analyzeGapsFromSnapshot(type, questionSnapshot, ingestedAnswers)
    const priority = derivePriorityFromGaps(type, gapAnalysis)
    const storedGapAnalysis =
      crossFieldViolations.length > 0 ? { ...gapAnalysis, crossFieldViolations } : gapAnalysis

    const rapidAssessment = await prisma.rapidAssessment.create({
      data: {
        // Idempotent batch replay: honor the client's row id when supplied.
        ...(offlineId ? { id: offlineId } : {}),
        rapidAssessmentType: type,
        rapidAssessmentDate: input.rapidAssessmentDate,
        assessorId: createdBy,
        assessorName: input.assessorName,
        entityId: input.entityId,
        incidentId: input.incidentId,
        location: input.location,
        coordinates: input.coordinates as unknown as Prisma.InputJsonValue | undefined,
        priority,
        mediaAttachments: input.mediaAttachments || [],
        versionNumber: 1,
        isOfflineCreated: true,
        syncStatus: 'SYNCED',
        verificationStatus,
        verifiedAt: entity.autoApproveEnabled ? new Date() : null,
        answers: ingestedAnswers as unknown as Prisma.InputJsonValue,
        // Client handshake: the structure the answers were captured against
        // (spec: row records the client's version; snapshot JSON carries its own).
        structureVersion: clientStructureVersion ?? questionSnapshot.structureVersion,
        contentVersion: questionSnapshot.contentVersion,
        questionSnapshot: questionSnapshot as unknown as Prisma.InputJsonValue,
        gapAnalysis: storedGapAnalysis as unknown as Prisma.InputJsonValue,
      },
    })

    // Response-scoped drift records (never persisted to a column — the
    // client surfaces them and gapAnalysis rows carry source-'unknown').
    const warningRecords = toOfflineSyncWarnings(rapidAssessment.id, type, warnings)

    // Recalculate incident severity bottom-up
    if (input.incidentId) {
      try {
        const { incidentSeverityService } = await import('@/lib/services/incident-severity.service');
        await incidentSeverityService.recalculateIncidentSeverity(input.incidentId)
      } catch {}
    }

    try {
      const { ActionSignalService } = await import('@/lib/services/action-signal.service');
      await ActionSignalService.evaluateAndGenerate({
        trigger: entity.autoApproveEnabled ? 'assessment-verified' : 'assessment-created',
        entityId: input.entityId,
        incidentId: input.incidentId,
        assessmentId: rapidAssessment.id,
        assessmentType: type,
        assessmentPriority: rapidAssessment.priority,
      });
    } catch (e) {
      console.error('[RapidAssessmentService] signal hook error:', e);
    }

    return { assessment: rapidAssessment, warnings: warningRecords }
  }

  /**
   * Updates an assessment from an OFFLINE submission (P5) — the never-reject
   * mirror of `update`. Ownership + type-change + transition validations are
   * identical to the online path; answers go through the same ingestion as
   * `createOfflineAssessment` (full replace, drift warned, never rejected).
   */
  static async updateOfflineAssessment(
    id: string,
    input: UpdateOfflineRapidAssessmentInput,
    updatedByAssessor: string,
    clientStructureVersion?: number | null
  ): Promise<OfflineAssessmentSyncResult> {
    const existingAssessment = await prisma.rapidAssessment.findUnique({
      where: { id },
      select: {
        id: true,
        assessorId: true,
        rapidAssessmentType: true,
      }
    })
    if (!existingAssessment) {
      throw new Error('Assessment not found')
    }

    if (existingAssessment.assessorId !== updatedByAssessor) {
      throw new Error('Not authorized to update this assessment')
    }

    // No ACTIVE-incident guard on the offline update path, by ruling: offline
    // sync never rejects a completed assessment — an incident resolved after
    // the assessment was filed must not block its offline resubmission.

    // `questionKeys` is a client-view declaration — destructured OUT so it can
    // never leak into the Prisma update payload (unknown-argument runtime error).
    const { type, answers, questionKeys: _clientQuestionKeys, ...baseData } = input

    const assessmentType = existingAssessment.rapidAssessmentType as AssessmentTypeName
    if (type !== assessmentType) {
      throw new ApiError(
        `Assessment type cannot change on update (stored ${assessmentType}, payload ${type})`,
        422
      )
    }

    // Answers are a full replace through offline ingestion: freeze the
    // CURRENT snapshot, reconcile drift, re-derive gap analysis + priority.
    const snapshot = await QuestionRegistryService.getSnapshot(assessmentType)
    if (snapshotQuestionCount(snapshot) === 0) {
      throw new Error(`No active registry questions found for assessment type ${assessmentType}`)
    }
    const registryRows = await prisma.question.findMany({
      where: { assessmentType: assessmentType },
      select: { questionKey: true, isActive: true },
    })
    const { answers: ingestedAnswers, warnings } = ingestOfflineAnswers(
      assessmentType,
      answers ?? {},
      snapshot,
      registryRows
    )
    relaxedValidateOfflineAnswers(snapshot, ingestedAnswers, warnings.added)

    // P10-2 — offline replay exemption (never-reject, plan §8): REFINEMENT
    // violations are stored as an informational gapAnalysis flag, never a 4xx.
    const crossFieldViolations = await evaluateActiveRefinements(assessmentType, ingestedAnswers)
    const gapAnalysis = await analyzeGapsFromSnapshot(assessmentType, snapshot, ingestedAnswers)
    const priority = derivePriorityFromGaps(assessmentType, gapAnalysis)
    const storedGapAnalysis =
      crossFieldViolations.length > 0 ? { ...gapAnalysis, crossFieldViolations } : gapAnalysis

    const { verificationStatus, ...safeBaseData } = baseData as Omit<UpdateOfflineRapidAssessmentInput, 'type' | 'answers' | 'questionKeys'> & {
      verificationStatus?: UpdateOfflineRapidAssessmentInput['verificationStatus']
    }
    const statusUpdate: Record<string, unknown> = {}
    if (verificationStatus !== undefined) {
      statusUpdate.verificationStatus = verificationStatus
      if (verificationStatus === 'SUBMITTED') {
        statusUpdate.rejectionReason = null
        statusUpdate.rejectionFeedback = null
        statusUpdate.verifiedAt = null
        statusUpdate.verifiedBy = null
      }
    }

    const warningRecords = toOfflineSyncWarnings(id, assessmentType, warnings)
    const updatedAssessment = await prisma.rapidAssessment.update({
      where: { id },
      data: {
        ...(safeBaseData as Record<string, never>),
        ...statusUpdate,
        answers: ingestedAnswers as unknown as Prisma.InputJsonValue,
        // Client handshake (spec): record the version the answers were
        // captured against; the frozen snapshot JSON carries its own.
        structureVersion: clientStructureVersion ?? snapshot.structureVersion,
        contentVersion: snapshot.contentVersion,
        questionSnapshot: snapshot as unknown as Prisma.InputJsonValue,
        priority,
        gapAnalysis: storedGapAnalysis as unknown as Prisma.InputJsonValue,
        updatedAt: new Date()
      }
    })

    // Recalculate incident severity bottom-up
    if (updatedAssessment.incidentId) {
      try {
        const { incidentSeverityService } = await import('@/lib/services/incident-severity.service');
        await incidentSeverityService.recalculateIncidentSeverity(updatedAssessment.incidentId)
      } catch {}
    }

    return { assessment: updatedAssessment, warnings: warningRecords }
  }

  static async findById(id: string): Promise<RapidAssessmentWithData | null> {
    const assessment = await prisma.rapidAssessment.findUnique({
      where: { id },
      include: {
        assessor: {
          select: {
            id: true,
            name: true,
            email: true
          }
        },
        entity: {
          select: {
            id: true,
            name: true,
            type: true,
            location: true
          }
        },
        incident: {
          select: {
            id: true,
            type: true,
            subType: true,
            createdAt: true,
            severity: true
          }
        }
      }
    })

    return assessment
  }

  static async findByUserId(
    userId: string,
    query: QueryRapidAssessmentInput
  ): Promise<{
    assessments: RapidAssessmentWithData[]
    total: number
    totalPages: number
  }> {
    const { page, limit, entityId, type, verificationStatus, priority, startDate, endDate } = query
    const skip = (page - 1) * limit

    const where: Prisma.RapidAssessmentWhereInput = { assessorId: userId }

    if (entityId) where.entityId = entityId
    if (type) where.rapidAssessmentType = type
    if (verificationStatus) where.verificationStatus = verificationStatus
    if (priority) where.priority = priority
    if (startDate || endDate) {
      where.rapidAssessmentDate = {}
      if (startDate) where.rapidAssessmentDate.gte = startDate
      if (endDate) where.rapidAssessmentDate.lte = endDate
    }

    // Get total count
    const total = await prisma.rapidAssessment.count({ where })

    // Get assessments with pagination
    const assessments = await prisma.rapidAssessment.findMany({
      where,
      include: {
        entity: {
          select: {
            id: true,
            name: true,
            type: true,
            location: true
          }
        },
        incident: {
          select: {
            id: true,
            type: true,
            subType: true,
            createdAt: true,
            severity: true
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit
    })

    return {
      assessments,
      total,
      totalPages: Math.ceil(total / limit)
    }
  }

  static async findAll(
    query: QueryRapidAssessmentInput
  ): Promise<{
    assessments: RapidAssessmentWithData[]
    total: number
    totalPages: number
  }> {
    const { page, limit, userId, entityId, incidentId, type, verificationStatus, priority, startDate, endDate } = query
    const skip = (page - 1) * limit

    const where: Prisma.RapidAssessmentWhereInput = {}

    if (userId) where.assessorId = userId
    if (entityId) where.entityId = entityId
    if (incidentId) where.incidentId = incidentId
    if (type) where.rapidAssessmentType = type
    if (verificationStatus) where.verificationStatus = verificationStatus
    if (priority) where.priority = priority
    if (startDate || endDate) {
      where.rapidAssessmentDate = {}
      if (startDate) where.rapidAssessmentDate.gte = startDate
      if (endDate) where.rapidAssessmentDate.lte = endDate
    }

    // Get total count
    const total = await prisma.rapidAssessment.count({ where })

    // Get assessments with pagination
    const assessments = await prisma.rapidAssessment.findMany({
      where,
      include: {
        assessor: {
          select: {
            id: true,
            name: true,
            email: true
          }
        },
        entity: {
          select: {
            id: true,
            name: true,
            type: true,
            location: true
          }
        },
        incident: {
          select: {
            id: true,
            type: true,
            subType: true,
            createdAt: true,
            severity: true
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit
    })

    return {
      assessments,
      total,
      totalPages: Math.ceil(total / limit)
    }
  }

  static async update(
    id: string,
    input: UpdateRapidAssessmentInput,
    updatedBy: string
  ): Promise<RapidAssessmentWithData> {
    // First check if assessment exists and user has permission
    const existingAssessment = await prisma.rapidAssessment.findUnique({
      where: { id },
      select: {
        id: true,
        assessorId: true,
        rapidAssessmentType: true,
        structureVersion: true,
        contentVersion: true,
        incidentId: true,
      }
    })
    if (!existingAssessment) {
      throw new Error('Assessment not found')
    }

    if (existingAssessment.assessorId !== updatedBy) {
      throw new Error('Not authorized to update this assessment')
    }

    // P9 hardening — only when the payload RE-POINTS the assessment at
    // another incident does the new target need the create-path guard
    // (exists → 404, ACTIVE → 409). Payloads that keep the stored incident
    // are not re-gated: the real edit UI always echoes the stored incidentId,
    // and a later answer edit must still land after the incident is resolved
    // (matching the frozen matrix row: 409 applies to *changing* incidentId).
    if (
      input.incidentId !== undefined &&
      input.incidentId !== existingAssessment.incidentId
    ) {
      await this.assertActiveIncident(input.incidentId)
    }

    const { type, answers, ...baseData } = input

    const assessmentType = existingAssessment.rapidAssessmentType as AssessmentTypeName
    if (type !== assessmentType) {
      throw new ApiError(
        `Assessment type cannot change on update (stored ${assessmentType}, payload ${type})`,
        422
      )
    }

    // Answers are a full replace: validate against the CURRENT registry
    // snapshot, re-freeze it onto the row, and re-derive gap analysis +
    // priority (bumping the version stamps to the current registry versions).
    const snapshot = await QuestionRegistryService.getSnapshot(assessmentType)
    if (snapshotQuestionCount(snapshot) === 0) {
      throw new Error(`No active registry questions found for assessment type ${assessmentType}`)
    }
    const validatedAnswers = validateAnswersAgainstSnapshot(snapshot, answers ?? {})
    // P10-2 — the edit path must not bypass cross-field enforcement.
    await assertNoRefinementViolations(assessmentType, validatedAnswers)
    const gapAnalysis = await analyzeGapsFromSnapshot(assessmentType, snapshot, validatedAnswers)
    const priority = derivePriorityFromGaps(assessmentType, gapAnalysis)

    const { verificationStatus, ...safeBaseData } = baseData as Omit<UpdateRapidAssessmentInput, 'type' | 'answers'> & {
      verificationStatus?: UpdateRapidAssessmentInput['verificationStatus']
    }
    const statusUpdate: Record<string, unknown> = {}
    if (verificationStatus !== undefined) {
      statusUpdate.verificationStatus = verificationStatus
      if (verificationStatus === 'SUBMITTED') {
        statusUpdate.rejectionReason = null
        statusUpdate.rejectionFeedback = null
        statusUpdate.verifiedAt = null
        statusUpdate.verifiedBy = null
      }
    }

    const updatedAssessment = await prisma.rapidAssessment.update({
      where: { id },
      data: {
        ...(safeBaseData as Record<string, never>),
        ...statusUpdate,
        answers: validatedAnswers as unknown as Prisma.InputJsonValue,
        structureVersion: snapshot.structureVersion,
        contentVersion: snapshot.contentVersion,
        questionSnapshot: snapshot as unknown as Prisma.InputJsonValue,
        priority,
        gapAnalysis: gapAnalysis as unknown as Prisma.InputJsonValue,
        updatedAt: new Date()
      }
    })

    // Recalculate incident severity bottom-up
    if (updatedAssessment.incidentId) {
      try {
        const { incidentSeverityService } = await import('@/lib/services/incident-severity.service');
        await incidentSeverityService.recalculateIncidentSeverity(updatedAssessment.incidentId)
      } catch {}
    }

    return updatedAssessment
  }

  static async delete(id: string, deletedBy: string): Promise<void> {
    // Check if assessment exists and user has permission
    const existingAssessment = await prisma.rapidAssessment.findUnique({
      where: { id },
      select: { assessorId: true, incidentId: true }
    })

    if (!existingAssessment) {
      throw new Error('Assessment not found')
    }

    if (existingAssessment.assessorId !== deletedBy) {
      throw new Error('Not authorized to delete this assessment')
    }

    const incidentId = existingAssessment.incidentId

    // Delete assessment
    await prisma.rapidAssessment.delete({
      where: { id }
    })

    // Recalculate incident severity bottom-up
    if (incidentId) {
      try {
        const { incidentSeverityService } = await import('@/lib/services/incident-severity.service');
        await incidentSeverityService.recalculateIncidentSeverity(incidentId)
      } catch {}
    }
  }

  static async submit(id: string, submittedBy: string): Promise<RapidAssessmentWithData> {
    const assessment = await prisma.rapidAssessment.findUnique({
      where: { id },
      select: { assessorId: true, entityId: true, incidentId: true, rapidAssessmentType: true, priority: true, answers: true }
    })
    if (!assessment) {
      throw new Error('Assessment not found')
    }

    if (assessment.assessorId !== submittedBy) {
      throw new Error('Not authorized to submit this assessment')
    }

    // P10-2 — submit carries no payload: enforce the type's active
    // REFINEMENT rules against the STORED answers (rows predating the
    // answers layer have none — a coerced-to-0 map can violate nothing).
    await assertNoRefinementViolations(
      assessment.rapidAssessmentType,
      (assessment.answers ?? {}) as Record<string, unknown>
    )

    const updatedAssessment = await prisma.rapidAssessment.update({
      where: { id },
      data: {
        verificationStatus: 'SUBMITTED',
        updatedAt: new Date()
      }
    })

    // Re-run gap analysis on submission
    await this.triggerGapAnalysis(id)

    try {
      const { ActionSignalService } = await import('@/lib/services/action-signal.service');
      await ActionSignalService.evaluateAndGenerate({
        trigger: 'assessment-submitted',
        entityId: updatedAssessment.entityId,
        incidentId: updatedAssessment.incidentId,
        assessmentId: id,
        assessmentType: updatedAssessment.rapidAssessmentType,
        assessmentPriority: updatedAssessment.priority,
      });
    } catch (e) {
      console.error('[RapidAssessmentService] signal hook error:', e);
    }

    return updatedAssessment
  }

  /**
   * Calculate and persist gap analysis (and the derived priority) for an
   * assessment from its stored answers.
   */
  static async triggerGapAnalysis(assessmentId: string): Promise<void> {
    try {
      const assessment = await prisma.rapidAssessment.findUnique({
        where: { id: assessmentId },
        select: { rapidAssessmentType: true, answers: true, questionSnapshot: true, incidentId: true }
      })
      if (!assessment) {
        console.warn(`Assessment ${assessmentId} not found for gap analysis`)
        return
      }

      // Rows predating the answers data layer have no answers to analyze;
      // deriving from an empty map would fabricate gaps — skip them.
      if (assessment.answers == null) {
        console.warn(`Assessment ${assessmentId} has no answers; skipping gap analysis`)
        return
      }

      // Derive against the snapshot the assessment was answered against when
      // one is frozen (the engine resolves severities from the live registry,
      // regardless of isActive); rows predating snapshots fall back to the
      // current registry snapshot.
      const storedSnapshot = assessment.questionSnapshot as unknown as
        | GapEngineSnapshotStructure
        | null
      const answers = (assessment.answers ?? {}) as Record<string, unknown>
      const gapAnalysis = storedSnapshot
        ? await analyzeGapsFromSnapshot(assessment.rapidAssessmentType, storedSnapshot, answers)
        : await analyzeGaps(assessment.rapidAssessmentType, answers)
      const priority = derivePriorityFromGaps(assessment.rapidAssessmentType, gapAnalysis)

      await prisma.rapidAssessment.update({
        where: { id: assessmentId },
        data: {
          gapAnalysis: gapAnalysis as unknown as Prisma.InputJsonValue,
          priority
        }
      })

      // Recalculate incident severity after gap analysis updates priority
      if (assessment.incidentId) {
        try {
          const { incidentSeverityService } = await import('@/lib/services/incident-severity.service');
          await incidentSeverityService.recalculateIncidentSeverity(assessment.incidentId)
        } catch {}
      }

      console.log(`Gap analysis calculated for assessment ${assessmentId} (${assessment.rapidAssessmentType})`)
    } catch (error) {
      console.error(`[RapidAssessmentService] triggerGapAnalysis failed for ${assessmentId}:`, error)
      throw error
    }
  }

  /**
   * P9 hardening — incident existence + ACTIVE guard shared by `create` and
   * `update`. Falsy ids and unknown ids throw 404 (`Incident not found`);
   * CONTAINED/RESOLVED incidents throw 409 (`Incident {id} is not active`).
   */
  private static async assertActiveIncident(incidentId: string | null | undefined): Promise<void> {
    const incident = incidentId
      ? await prisma.incident.findUnique({
          where: { id: incidentId },
          select: { id: true, status: true },
        })
      : null
    if (!incident) {
      throw new ApiError('Incident not found', 404)
    }
    if (incident.status !== 'ACTIVE') {
      throw new ApiError(`Incident ${incident.id} is not active`, 409)
    }
  }

  private static async validateEntityAssignment(userId: string, entityId: string): Promise<void> {
    // Check if user is assigned to this entity
    const assignment = await prisma.entityAssignment.findFirst({
      where: {
        userId,
        entityId
      }
    })

    if (!assignment) {
      throw new Error('User is not assigned to this entity')
    }
  }

  static async findLatestByIncidentEntityAndType(
    incidentId: string,
    entityId: string,
    type: AssessmentType
  ): Promise<RapidAssessmentWithData | null> {
    try {
      const assessment = await prisma.rapidAssessment.findFirst({
        where: {
          incidentId,
          entityId,
          rapidAssessmentType: type,
          verificationStatus: {
            not: 'DRAFT'
          }
        },
        orderBy: {
          rapidAssessmentDate: 'desc'
        }
      })

      return assessment
    } catch (error) {
      console.error('Error finding latest assessment:', error)
      throw new Error('Failed to find latest assessment')
    }
  }
}

export type { GapAnalysis }
