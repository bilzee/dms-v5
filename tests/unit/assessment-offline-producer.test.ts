import { AssessmentOfflineService } from '@/lib/services/assessment-offline.service'
import { apiPost } from '@/lib/api'
import { offlineDB } from '@/lib/db/offline'
import { syncEngine } from '@/lib/sync/engine'

/**
 * Unit — the offline UPDATE producer (P10-4 4c + review G2). The consumer
 * contract is pinned by tests/api/sync-hardening.test.ts; this pins the
 * producer side that feeds it: the ASSESSMENT ROW id rides in the entityUuid
 * slot, entityId stays in the payload for the re-point authorizer, and the
 * queued version derives from the stored row (versionNumber first) so
 * consecutive offline edits advance it instead of stalling at 2.
 */

jest.mock('@/lib/api', () => ({ apiPost: jest.fn() }))
jest.mock('@/lib/db/offline', () => ({
  offlineDB: {
    updateAssessment: jest.fn(),
    getAssessment: jest.fn(),
  },
}))
jest.mock('@/lib/sync/engine', () => ({ syncEngine: { addToQueue: jest.fn() } }))

const mockedApiPost = apiPost as jest.Mock
const mockedGetAssessment = offlineDB.getAssessment as jest.Mock
const mockedUpdateAssessment = offlineDB.updateAssessment as jest.Mock
const mockedAddToQueue = syncEngine.addToQueue as jest.Mock

describe('unit — AssessmentOfflineService.updateAssessment producer (4c/G2)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    // Force the offline branch: the online-first attempt always fails.
    mockedApiPost.mockRejectedValue(new Error('offline'))
    mockedUpdateAssessment.mockResolvedValue(undefined)
  })

  test('enqueues the ROW id in the entityUuid slot; entityId + advanced version ride in the payload', async () => {
    mockedGetAssessment.mockResolvedValue({
      decryptedData: { entityId: 'entity-1', versionNumber: 3 },
    })

    const service = new AssessmentOfflineService()
    await service.updateAssessment('row-42', { someField: 'edited' })

    expect(mockedApiPost).toHaveBeenCalled()
    expect(mockedAddToQueue).toHaveBeenCalledTimes(1)

    const [type, action, entityUuidSlot, payload, priority] = mockedAddToQueue.mock.calls[0]
    expect(type).toBe('assessment')
    expect(action).toBe('update')
    // 4c: the slot carries the assessment ROW id — the consumer resolves the
    // row by it; the pre-4c entityId here made the update branch unreachable.
    expect(entityUuidSlot).toBe('row-42')
    // entityId stays in the payload for the re-point authorizer.
    expect(payload.entityId).toBe('entity-1')
    // G2: version derives from the stored versionNumber (3) → 4.
    expect(payload.version).toBe(4)
    expect(priority).toBe(5)
  })

  test('API-shaped rows hydrate from versionNumber even without a legacy version field', async () => {
    mockedGetAssessment.mockResolvedValue({
      decryptedData: { entityId: 'entity-1', version: 7 },
    })

    const service = new AssessmentOfflineService()
    await service.updateAssessment('row-43', {})

    // Legacy queue-shaped records still hydrate from `version`.
    expect(mockedAddToQueue.mock.calls[0][3].version).toBe(8)
  })

  test('locally-created rows with no version field fall back to 1 + 1', async () => {
    mockedGetAssessment.mockResolvedValue({ decryptedData: { entityId: 'entity-1' } })

    const service = new AssessmentOfflineService()
    await service.updateAssessment('row-44', {})

    expect(mockedAddToQueue.mock.calls[0][3].version).toBe(2)
  })
})
