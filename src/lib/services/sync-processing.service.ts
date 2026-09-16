import { prisma } from '@/lib/db/client'
import { SyncStatus } from '@prisma/client'
import { RapidAssessmentService } from '@/lib/services/rapid-assessment.service'
import type { CreateRapidAssessmentInput } from '@/lib/validation/rapid-assessment'
import type { OfflineSyncWarning } from '@/lib/questions/offline-answers'

interface SyncChange {
  type: 'assessment' | 'response' | 'entity'
  action: 'create' | 'update' | 'delete'
  data: Record<string, unknown>
  offlineId?: string
  versionNumber: number
  entityUuid: string
}

interface SyncResult {
  offlineId?: string
  serverId: string
  status: 'success' | 'conflict' | 'failed'
  message?: string
  conflictData?: unknown
  /** P5: per-item offline registry-drift warnings (assessments only). */
  warnings?: OfflineSyncWarning[]
}

export class SyncProcessingService {
  static async processBatch(changes: SyncChange[], userId: string): Promise<SyncResult[]> {
    const results: SyncResult[] = []

    for (const change of changes) {
      try {
        const result = await SyncProcessingService.processChange(change, userId)
        results.push(result)
      } catch (error) {
        results.push({
          offlineId: change.offlineId,
          serverId: '',
          status: 'failed',
          message: error instanceof Error ? error.message : 'Unknown error'
        })
      }
    }

    return results
  }

  private static async processChange(change: SyncChange, userId: string): Promise<SyncResult> {
    switch (change.type) {
      case 'assessment':
        return SyncProcessingService.processAssessment(change, userId)
      case 'response':
        return SyncProcessingService.processResponse(change, userId)
      case 'entity':
        return SyncProcessingService.processEntity(change, userId)
      default:
        return {
          offlineId: change.offlineId,
          serverId: '',
          status: 'failed',
          message: `Unknown change type: ${change.type}`
        }
    }
  }

  private static async processAssessment(change: SyncChange, userId: string): Promise<SyncResult> {
    const data = change.data

    if (change.action === 'create') {
      // Idempotent replay (ruling 7): the queue may re-send a create whose
      // server write already landed (e.g. the response was lost offline).
      // The row id the offline path creates with — never a conflict.
      const rowId = change.offlineId || change.entityUuid
      const existing = await prisma.rapidAssessment.findUnique({
        where: { id: rowId },
        select: { id: true, assessorId: true }
      })

      if (existing) {
        // The row id is client-controlled — never echo a foreign row as an
        // idempotent success (that would silently drop the syncing user's
        // own submission).
        if (existing.assessorId !== userId) {
          return {
            offlineId: change.offlineId,
            serverId: '',
            status: 'failed',
            message: 'Not authorized to sync this assessment'
          }
        }
        return {
          offlineId: change.offlineId,
          serverId: existing.id,
          status: 'success',
          message: 'Assessment already synced'
        }
      }

      // P5: delegate to the offline ingestion path for full registry
      // processing — CURRENT-snapshot freeze, drift reconciliation with
      // warnings (never-reject), gap analysis + derived priority. Shape-level
      // failures (unknown type, unassigned entity, empty registry) throw and
      // surface as failed results through processBatch's catch.
      const { assessment, warnings } = await RapidAssessmentService.createOfflineAssessment(
        {
          type: (data.type || 'HEALTH') as CreateRapidAssessmentInput['type'],
          rapidAssessmentDate: data.rapidAssessmentDate
            ? new Date(data.rapidAssessmentDate as string)
            : new Date(),
          assessorName: (data.assessorName as string) || 'Unknown',
          ...(data.location ? { location: data.location as string } : {}),
          ...(data.coordinates
            ? { coordinates: data.coordinates as CreateRapidAssessmentInput['coordinates'] }
            : {}),
          ...(data.mediaAttachments
            ? { mediaAttachments: data.mediaAttachments as string[] }
            : {}),
          entityId: (data.entityId as string) || change.entityUuid,
          incidentId: (data.incidentId as string) || change.entityUuid,
          answers:
            data.answers && typeof data.answers === 'object' && !Array.isArray(data.answers)
              ? (data.answers as Record<string, unknown>)
              : {},
          questionKeys: Array.isArray(data.questionKeys) ? (data.questionKeys as string[]) : null,
          offlineId: change.offlineId || change.entityUuid,
        },
        userId,
        typeof data.structureVersion === 'number' ? data.structureVersion : null
      )

      return {
        offlineId: change.offlineId,
        serverId: assessment.id,
        status: 'success',
        message: 'Assessment created from offline sync',
        ...(warnings.length > 0 ? { warnings } : {})
      }
    }

    if (change.action === 'update') {
      const existing = await prisma.rapidAssessment.findUnique({
        where: { id: change.entityUuid }
      })

      if (!existing) {
        return SyncProcessingService.processAssessment(
          { ...change, action: 'create' },
          userId
        )
      }

      if (existing.versionNumber > change.versionNumber) {
        return SyncProcessingService.handleConflict(change, existing)
      }

      // P5: answers-carrying updates go through the never-reject ingestion
      // path (lenient re-ingest, CURRENT-snapshot re-freeze, re-derived
      // priority + gapAnalysis, client structureVersion recorded).
      if (data.answers && typeof data.answers === 'object' && !Array.isArray(data.answers)) {
        const { assessment, warnings } = await RapidAssessmentService.updateOfflineAssessment(
          change.entityUuid,
          {
            type: (data.type || existing.rapidAssessmentType) as CreateRapidAssessmentInput['type'],
            rapidAssessmentDate: data.rapidAssessmentDate
              ? new Date(data.rapidAssessmentDate as string)
              : undefined,
            assessorName: (data.assessorName as string) || undefined,
            location: (data.location as string) || undefined,
            coordinates: data.coordinates as CreateRapidAssessmentInput['coordinates'],
            mediaAttachments: data.mediaAttachments as string[],
            entityId: (data.entityId as string) || undefined,
            incidentId: (data.incidentId as string) || undefined,
            answers: data.answers as Record<string, unknown>,
          },
          userId,
          typeof data.structureVersion === 'number' ? data.structureVersion : null
        )

        await prisma.rapidAssessment.update({
          where: { id: change.entityUuid },
          data: { versionNumber: change.versionNumber, syncStatus: 'SYNCED' as SyncStatus }
        })

        return {
          offlineId: change.offlineId,
          serverId: assessment.id,
          status: 'success',
          message: 'Assessment updated from offline sync',
          ...(warnings.length > 0 ? { warnings } : {})
        }
      }

      const updated = await prisma.rapidAssessment.update({
        where: { id: change.entityUuid },
        data: {
          location: (data.location as string) || existing.location,
          coordinates: data.coordinates as any || existing.coordinates,
          priority: (data.priority as any) || existing.priority,
          mediaAttachments: (data.mediaAttachments as any) || existing.mediaAttachments,
          versionNumber: change.versionNumber,
          syncStatus: 'SYNCED' as SyncStatus
        }
      })

      return {
        offlineId: change.offlineId,
        serverId: updated.id,
        status: 'success',
        message: 'Assessment updated from offline sync'
      }
    }

    if (change.action === 'delete') {
      try {
        await prisma.rapidAssessment.delete({
          where: { id: change.entityUuid }
        })
      } catch {
        // Already deleted - treat as success
      }

      return {
        offlineId: change.offlineId,
        serverId: change.entityUuid,
        status: 'success',
        message: 'Assessment deleted'
      }
    }

    return {
      offlineId: change.offlineId,
      serverId: '',
      status: 'failed',
      message: `Unknown action: ${change.action}`
    }
  }

  private static async processResponse(change: SyncChange, userId: string): Promise<SyncResult> {
    const data = change.data

    if (change.action === 'create') {
      const existing = await prisma.rapidResponse.findUnique({
        where: { offlineId: change.offlineId || change.entityUuid }
      }).catch(() => null)

      if (existing) {
        return {
          offlineId: change.offlineId,
          serverId: existing.id,
          status: 'success',
          message: 'Response already synced'
        }
      }

      let assessmentId = data.assessmentId as string
      if (!assessmentId) {
        const existingAssessment = await prisma.rapidAssessment.findFirst({
          where: { entityId: change.entityUuid },
          orderBy: { createdAt: 'desc' },
          select: { id: true }
        })
        assessmentId = existingAssessment?.id || ''
      }

      const validTypes = ['HEALTH', 'WASH', 'SHELTER', 'FOOD', 'SECURITY', 'POPULATION', 'LOGISTICS']
      const typeValue = validTypes.includes(data.type as string) ? data.type as string : 'HEALTH'

      const response = await prisma.rapidResponse.create({
        data: {
          responderId: userId,
          entityId: change.entityUuid,
          assessmentId,
          type: typeValue as any,
          priority: (data.priority as any) || 'MEDIUM',
          deliveryStatus: (data.deliveryStatus as any) || 'PLANNED',
          description: (data.description as string) || null,
          resources: data.resources as any || null,
          timeline: data.timeline as any || null,
          items: (data.items as any) || {},
          offlineId: change.offlineId || change.entityUuid,
          versionNumber: change.versionNumber,
          isOfflineCreated: true,
          syncStatus: 'SYNCED' as SyncStatus,
          plannedDate: data.plannedDate ? new Date(data.plannedDate as string) : new Date()
        }
      })

      return {
        offlineId: change.offlineId,
        serverId: response.id,
        status: 'success',
        message: 'Response created from offline sync'
      }
    }

    if (change.action === 'update') {
      const existing = await prisma.rapidResponse.findFirst({
        where: {
          OR: [
            { id: change.entityUuid },
            { offlineId: change.offlineId || change.entityUuid }
          ]
        }
      })

      if (!existing) {
        return SyncProcessingService.processResponse(
          { ...change, action: 'create' },
          userId
        )
      }

      if (existing.versionNumber > change.versionNumber) {
        return SyncProcessingService.handleConflict(change, existing)
      }

      const updated = await prisma.rapidResponse.update({
        where: { id: existing.id },
        data: {
          description: (data.description as string) || existing.description,
          resources: data.resources as any || existing.resources,
          timeline: data.timeline as any || existing.timeline,
          items: (data.items as any) || existing.items,
          priority: (data.priority as any) || existing.priority,
          deliveryStatus: (data.deliveryStatus as any) || existing.deliveryStatus,
          versionNumber: change.versionNumber,
          syncStatus: 'SYNCED' as SyncStatus
        }
      })

      return {
        offlineId: change.offlineId,
        serverId: updated.id,
        status: 'success',
        message: 'Response updated from offline sync'
      }
    }

    if (change.action === 'delete') {
      try {
        await prisma.rapidResponse.delete({
          where: { id: change.entityUuid }
        })
      } catch {
        // Already deleted
      }

      return {
        offlineId: change.offlineId,
        serverId: change.entityUuid,
        status: 'success',
        message: 'Response deleted'
      }
    }

    return {
      offlineId: change.offlineId,
      serverId: '',
      status: 'failed',
      message: `Unknown action: ${change.action}`
    }
  }

  private static async processEntity(change: SyncChange, _userId: string): Promise<SyncResult> {
    const data = change.data

    if (change.action === 'create' || change.action === 'update') {
      const existing = await prisma.entity.findUnique({
        where: { id: change.entityUuid }
      })

      if (existing && change.action === 'update') {
        if (existing.name && data.name) {
          await prisma.entity.update({
            where: { id: change.entityUuid },
            data: {
              name: (data.name as string) || existing.name,
              type: (data.type as any) || existing.type
            }
          })
        }

        return {
          offlineId: change.offlineId,
          serverId: existing.id,
          status: 'success',
          message: 'Entity updated'
        }
      }

      if (existing) {
        return {
          offlineId: change.offlineId,
          serverId: existing.id,
          status: 'success',
          message: 'Entity already exists'
        }
      }

      const entity = await prisma.entity.create({
        data: {
          id: change.entityUuid,
          name: (data.name as string) || 'Synced Entity',
          type: (data.type as any) || 'COMMUNITY',
          location: (data.location as string) || null,
          coordinates: data.coordinates as any || null,
        }
      })

      return {
        offlineId: change.offlineId,
        serverId: entity.id,
        status: 'success',
        message: 'Entity created from offline sync'
      }
    }

    return {
      offlineId: change.offlineId,
      serverId: change.entityUuid,
      status: 'success',
      message: 'Entity sync processed'
    }
  }

  private static async handleConflict(change: SyncChange, existing: any): Promise<SyncResult> {
    const conflict = await prisma.syncConflict.create({
      data: {
        entityType: change.type,
        entityId: change.entityUuid,
        resolutionMethod: 'LAST_WRITE_WINS',
        winningVersion: existing,
        losingVersion: change.data as any,
        coordinatorNotified: false
      }
    })

    return {
      offlineId: change.offlineId,
      serverId: existing.id,
      status: 'conflict',
      message: `Version conflict detected: server has v${existing.versionNumber}, offline has v${change.versionNumber}`,
      conflictData: existing
    }
  }
}
