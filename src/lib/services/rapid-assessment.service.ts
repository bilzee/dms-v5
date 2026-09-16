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
  analyzeGaps,
  analyzeGapsFromSnapshot,
  derivePriorityFromGaps,
  GapAnalysis
} from '@/lib/services/gap-analysis.service'
import type { GapEngineSnapshotStructure } from '@/lib/questions/gap-engine'
import type { QuestionSnapshot } from '@/lib/questions/question-snapshot'
import { ApiError } from '@/types/api'
import { QuestionRegistryService } from '@/lib/services/question-registry.service'

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
 *      per-field errors (cross-field rules are client-side only, Q2=B),
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

export class RapidAssessmentService {
  static async create(
    input: CreateRapidAssessmentInput,
    createdBy: string
  ): Promise<RapidAssessmentWithData> {
    const { type, entityId, answers } = input

    // Verify user is assigned to this entity
    await this.validateEntityAssignment(createdBy, entityId)

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
      }
    })
    if (!existingAssessment) {
      throw new Error('Assessment not found')
    }

    if (existingAssessment.assessorId !== updatedBy) {
      throw new Error('Not authorized to update this assessment')
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
      select: { assessorId: true, entityId: true, incidentId: true, rapidAssessmentType: true, priority: true }
    })
    if (!assessment) {
      throw new Error('Assessment not found')
    }

    if (assessment.assessorId !== submittedBy) {
      throw new Error('Not authorized to submit this assessment')
    }

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
