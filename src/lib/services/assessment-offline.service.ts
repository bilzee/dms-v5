import { offlineDB } from '@/lib/db/offline'
import { apiPost } from '@/lib/api'
import { syncEngine } from '@/lib/sync/engine'

export class AssessmentOfflineService {
  async createAssessment(assessmentData: any, assessorId: string): Promise<any> {
    try {
      const result = await apiPost('/api/v1/rapid-assessments', assessmentData)

      if (result.success) {
        await offlineDB.addAssessment({
          uuid: result.data.id,
          assessorId,
          entityId: assessmentData.entityId,
          assessmentType: assessmentData.type,
          data: { ...assessmentData, ...result.data, syncStatus: 'synced' },
          gpsLocation: assessmentData.coordinates
            ? `${assessmentData.coordinates.lat},${assessmentData.coordinates.lng}`
            : undefined,
          timestamp: new Date(),
          lastModified: new Date(),
          syncStatus: 'synced'
        })

        return result.data
      }

      throw new Error(result.error || 'Failed to submit assessment')
    } catch (error) {
      const assessmentId = crypto.randomUUID()
      const offlineData = {
        ...assessmentData,
        id: assessmentId,
        assessorId,
        syncStatus: 'pending' as const,
        isOfflineCreated: true,
        createdAt: new Date().toISOString(),
        lastModified: new Date().toISOString()
      }

      await offlineDB.addAssessment({
        uuid: assessmentId,
        assessorId,
        entityId: assessmentData.entityId,
        assessmentType: assessmentData.type,
        data: offlineData,
        gpsLocation: assessmentData.coordinates
          ? `${assessmentData.coordinates.lat},${assessmentData.coordinates.lng}`
          : undefined,
        timestamp: new Date(),
        lastModified: new Date(),
        syncStatus: 'pending'
      })

      try {
        await syncEngine.addToQueue(
          'assessment',
          'create',
          assessmentData.entityId,
          { ...offlineData, version: 1 },
          5
        )
      } catch (queueError) {
        console.error('Failed to add to sync queue:', queueError)
      }

      return offlineData
    }
  }

  async updateAssessment(id: string, assessmentData: any): Promise<any> {
    try {
      const result = await apiPost(`/api/v1/rapid-assessments/${id}`, {
        ...assessmentData,
        _method: 'PATCH'
      })

      if (result.success) {
        await offlineDB.updateAssessment(id, {
          data: { ...assessmentData, ...result.data, syncStatus: 'synced' },
          syncStatus: 'synced'
        })
        return result.data
      }
      throw new Error(result.error || 'Failed to update assessment')
    } catch (error) {
      const offlineUpdate = {
        ...assessmentData,
        id,
        updatedAt: new Date().toISOString(),
        syncStatus: 'pending' as const
      }

      await offlineDB.updateAssessment(id, {
        data: offlineUpdate,
        syncStatus: 'pending'
      })

      try {
        const existing = await offlineDB.getAssessment(id)
        // P10-4 (4c) — the update producer enqueues the ASSESSMENT ROW id in
        // the entityUuid slot: the consumer's update branch resolves the row
        // by that id (`where: { id: change.entityUuid }`). Enqueuing the
        // entityId made the update branch unreachable; entityId stays in the
        // payload for the re-point authorizer.
        const entityId = assessmentData.entityId || existing?.decryptedData?.entityId

        await syncEngine.addToQueue(
          'assessment',
          'update',
          id,
          {
            ...offlineUpdate,
            ...(entityId ? { entityId } : {}),
            version: (existing?.decryptedData?.version || 1) + 1
          },
          5
        )
      } catch (queueError) {
        console.error('Failed to add to sync queue:', queueError)
      }

      return offlineUpdate
    }
  }

  static async getAssessmentById(id: string): Promise<any> {
    try {
      const { apiGet } = await import('@/lib/api')
      const response = await apiGet(`/api/v1/rapid-assessments/${id}`)

      if (response.success && response.data) {
        await offlineDB.updateAssessment(id, {
          data: { ...response.data, syncStatus: 'synced' },
          syncStatus: 'synced'
        })
        return response.data
      }
      throw new Error('Assessment not found')
    } catch (error) {
      const offline = await offlineDB.getAssessment(id)
      if (offline?.decryptedData) {
        return offline.decryptedData
      }
      throw error
    }
  }
}

export const assessmentOfflineService = new AssessmentOfflineService()
