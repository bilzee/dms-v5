import { prisma } from '@/lib/db/client'
import { RapidAssessment, AssessmentType, Prisma, Priority } from '@prisma/client'
import {
  CreateRapidAssessmentInput,
  UpdateRapidAssessmentInput,
  QueryRapidAssessmentInput,
  HealthAssessmentInput,
  PopulationAssessmentInput,
  FoodAssessmentInput,
  WASHAssessmentInput,
  ShelterAssessmentInput,
  SecurityAssessmentInput
} from '@/lib/validation/rapid-assessment'
import {
  analyzeGaps,
  derivePriorityFromGaps,
  GapAnalysis
} from '@/lib/services/gap-analysis.service'
import {
  toAnswers,
  fromAnswers,
  RapidAssessmentType,
  RapidAssessmentAnswers
} from '@/lib/questions/legacy-convert'
import { QuestionRegistryService } from '@/lib/services/question-registry.service'

/**
 * Rapid Assessment Service — Dynamic Question Registry edition.
 *
 * Legacy typed child tables are gone; answers live in `RapidAssessment.answers`
 * (keyed by registry questionKey), with an immutable `questionSnapshot` copied
 * from the live registry at answer time. `gapAnalysis` and `priority` are
 * server-derived from the registry's GAP questions (priority replaces any
 * client-supplied value; POPULATION assessments derive LOW).
 *
 * The legacy API payload shapes (healthData/washData/...) remain accepted:
 * `toAnswers()` converts the validated typed payload to the answers map and
 * `fromAnswers()` rebuilds it for edit-form hydration.
 */

// Returned assessments now carry answers/snapshot directly on the row.
export type RapidAssessmentWithData = RapidAssessment

/** Total question count across snapshot sections (empty-registry guard). */
function snapshotQuestionCount(snapshot: { sections: Array<{ questions: unknown[] }> }): number {
  return snapshot.sections.reduce((count, section) => count + section.questions.length, 0)
}

/** Extracts the legacy typed payload from a create input by assessment type. */
function typedPayloadFromCreateInput(input: CreateRapidAssessmentInput): Record<string, unknown> {
  switch (input.type) {
    case 'HEALTH':
      return (input as CreateRapidAssessmentInput & { healthData: HealthAssessmentInput }).healthData
    case 'POPULATION':
      return (input as CreateRapidAssessmentInput & { populationData: PopulationAssessmentInput }).populationData
    case 'FOOD':
      return (input as CreateRapidAssessmentInput & { foodData: FoodAssessmentInput }).foodData
    case 'WASH':
      return (input as CreateRapidAssessmentInput & { washData: WASHAssessmentInput }).washData
    case 'SHELTER':
      return (input as CreateRapidAssessmentInput & { shelterData: ShelterAssessmentInput }).shelterData
    case 'SECURITY':
      return (input as CreateRapidAssessmentInput & { securityData: SecurityAssessmentInput }).securityData
    default:
      throw new Error('Unsupported assessment type')
  }
}

/** Extracts the (partial) legacy typed payload from an update input, if present. */
function typedPayloadFromUpdateInput(
  type: AssessmentType,
  input: UpdateRapidAssessmentInput
): Record<string, unknown> | null {
  switch (type) {
    case 'HEALTH':
      return (input.healthData as HealthAssessmentInput | undefined) ?? null
    case 'POPULATION':
      return (input.populationData as PopulationAssessmentInput | undefined) ?? null
    case 'FOOD':
      return (input.foodData as FoodAssessmentInput | undefined) ?? null
    case 'WASH':
      return (input.washData as WASHAssessmentInput | undefined) ?? null
    case 'SHELTER':
      return (input.shelterData as ShelterAssessmentInput | undefined) ?? null
    case 'SECURITY':
      return (input.securityData as SecurityAssessmentInput | undefined) ?? null
    default:
      return null
  }
}

export class RapidAssessmentService {
  static async create(
    input: CreateRapidAssessmentInput,
    createdBy: string
  ): Promise<RapidAssessmentWithData> {
    const { type, entityId } = input

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

    // Convert the validated legacy typed payload into the canonical answers map
    const typedPayload = typedPayloadFromCreateInput(input)
    const answers = toAnswers(type as RapidAssessmentType, typedPayload)

    // Freeze the per-assessment snapshot from the registry service (single source)
    const questionSnapshot = await QuestionRegistryService.getSnapshot(type)
    if (snapshotQuestionCount(questionSnapshot) === 0) {
      throw new Error(`No active registry questions found for assessment type ${type}`)
    }
    const versions = {
      structureVersion: questionSnapshot.structureVersion,
      contentVersion: questionSnapshot.contentVersion,
    }

    // Derive gap analysis + priority from the registry (priority replaces client input)
    const gapAnalysis = await analyzeGaps(type, answers)
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
        answers: answers as unknown as Prisma.InputJsonValue,
        structureVersion: versions.structureVersion,
        contentVersion: versions.contentVersion,
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

  /**
   * Rebuilds the legacy typed payload shape (arrays as arrays) from the stored
   * answers map — the edit-form hydration bridge.
   */
  static async findTypedPayload(id: string): Promise<{ type: AssessmentType; payload: Record<string, unknown> } | null> {
    const assessment = await prisma.rapidAssessment.findUnique({
      where: { id },
      select: { rapidAssessmentType: true, answers: true }
    })
    if (!assessment) return null
    return {
      type: assessment.rapidAssessmentType,
      payload: fromAnswers(
        assessment.rapidAssessmentType as RapidAssessmentType,
        (assessment.answers ?? {}) as RapidAssessmentAnswers
      ),
    }
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
        answers: true,
        questionSnapshot: true,
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

    const { type, healthData, populationData, foodData, washData, shelterData, securityData, ...baseData } = input

    const assessmentType = existingAssessment.rapidAssessmentType

    // Merge the (partial) typed payload into the stored answers map and
    // re-derive snapshot + gap analysis + priority when answers changed.
    const typedPayload = typedPayloadFromUpdateInput(assessmentType, input)
    let answersUpdate: Prisma.InputJsonValue | undefined
    let versionsUpdate: { structureVersion: number; contentVersion: number } | undefined
    let questionSnapshotUpdate: Prisma.InputJsonValue | undefined
    let priorityUpdate: Priority | undefined
    let gapAnalysisUpdate: Prisma.InputJsonValue | undefined

    if (typedPayload) {
      const mergedAnswers: RapidAssessmentAnswers = {
        ...((existingAssessment.answers ?? {}) as RapidAssessmentAnswers),
        ...toAnswers(assessmentType as RapidAssessmentType, typedPayload),
      }
      const snapshot = await QuestionRegistryService.getSnapshot(assessmentType)
      if (snapshotQuestionCount(snapshot) === 0) {
        throw new Error(`No active registry questions found for assessment type ${assessmentType}`)
      }
      const gapAnalysis = await analyzeGaps(assessmentType, mergedAnswers)
      answersUpdate = mergedAnswers as unknown as Prisma.InputJsonValue
      versionsUpdate = {
        structureVersion: snapshot.structureVersion,
        contentVersion: snapshot.contentVersion,
      }
      questionSnapshotUpdate = snapshot as unknown as Prisma.InputJsonValue
      priorityUpdate = derivePriorityFromGaps(assessmentType, gapAnalysis)
      gapAnalysisUpdate = gapAnalysis as unknown as Prisma.InputJsonValue
    }

    const { verificationStatus, priority, ...safeBaseData } = baseData as Record<string, unknown> & {
      verificationStatus?: string
      priority?: Priority
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
        ...(answersUpdate !== undefined ? { answers: answersUpdate } : {}),
        ...(versionsUpdate !== undefined
          ? { structureVersion: versionsUpdate.structureVersion, contentVersion: versionsUpdate.contentVersion }
          : {}),
        ...(questionSnapshotUpdate !== undefined ? { questionSnapshot: questionSnapshotUpdate } : {}),
        ...(priorityUpdate !== undefined ? { priority: priorityUpdate } : {}),
        ...(gapAnalysisUpdate !== undefined ? { gapAnalysis: gapAnalysisUpdate } : {}),
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
        select: { rapidAssessmentType: true, answers: true, incidentId: true }
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

      const gapAnalysis = await analyzeGaps(
        assessment.rapidAssessmentType,
        (assessment.answers ?? {}) as Record<string, unknown>
      )
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
   * Updates all historical assessments to have correct priorities based on gap analysis severity
   */
  static async updateAllHistoricalAssessmentPriorities(): Promise<{ updated: number; failed: number; total: number }> {
    try {
      console.log('Starting historical assessment priority update...')

      const allAssessments = await prisma.rapidAssessment.findMany({
        select: { id: true, rapidAssessmentType: true, answers: true }
      })

      console.log(`Found ${allAssessments.length} assessments to process`)

      let updatedCount = 0
      let failedCount = 0

      for (const assessment of allAssessments) {
        try {
          if (assessment.answers == null) {
            // Rows predating the answers data layer have no answers to analyze.
            continue
          }
          const gapAnalysis = await analyzeGaps(
            assessment.rapidAssessmentType,
            (assessment.answers ?? {}) as Record<string, unknown>
          )
          const priority = derivePriorityFromGaps(assessment.rapidAssessmentType, gapAnalysis)

          await prisma.rapidAssessment.update({
            where: { id: assessment.id },
            data: {
              gapAnalysis: gapAnalysis as unknown as Prisma.InputJsonValue,
              priority
            }
          })
          console.log(`Updated assessment ${assessment.id} (${assessment.rapidAssessmentType}) - Priority: ${priority}`)
          updatedCount++
        } catch (error) {
          console.error(`Failed to update assessment ${assessment.id}:`, error)
          failedCount++
        }
      }

      console.log(`Historical assessment priority update completed. Updated: ${updatedCount}, Failed: ${failedCount}, Total: ${allAssessments.length}`)

      return {
        updated: updatedCount,
        failed: failedCount,
        total: allAssessments.length
      }
    } catch (error) {
      console.error('Error updating historical assessment priorities:', error)
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
