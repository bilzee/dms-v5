import { describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import { setupTestDatabase, cleanupTestDatabase, createTestUser } from '@/tests/helpers/database'
import { prisma } from '@/lib/db'
import { deliveryMediaService } from '@/lib/services/delivery-media.service'
import { ResponseService } from '@/lib/services/response.service'

describe('Delivery Confirmation Integration Tests', () => {
  let testUser: any
  let testResponse: any
  let testAssessment: any
  let testEntity: any

  beforeEach(async () => {
    await setupTestDatabase()
    
    // Create test data
    testUser = await createTestUser('RESPONDER')
    
    testEntity = await prisma.entity.create({
      data: {
        name: 'Test Shelter',
        type: 'SHELTER',
        location: 'Test Location'
      }
    })

    testAssessment = await prisma.assessment.create({
      data: {
        assessorId: testUser.id,
        entityId: testEntity.id,
        assessmentType: 'SHELTER',
        data: {
          requirements: ['Blankets', 'Water'],
          priority: 'HIGH'
        }
      }
    })

    testResponse = await prisma.response.create({
      data: {
        responderId: testUser.id,
        assessmentId: testAssessment.id,
        entityId: testEntity.id,
        status: 'PLANNED',
        data: {
          plannedItems: [
            { id: 'item-1', itemName: 'Blanket', quantity: 10, unit: 'pieces' },
            { id: 'item-2', itemName: 'Water', quantity: 20, unit: 'liters' }
          ]
        }
      }
    })
  })

  afterEach(async () => {
    await cleanupTestDatabase()
  })

  describe('POST /api/v1/responses/[id]/deliver', () => {
    it('should confirm delivery with valid data', async () => {
      const deliveryData = {
        deliveredItems: [
          { id: 'item-1', itemName: 'Blanket', quantity: 10, unit: 'pieces', condition: 'GOOD' },
          { id: 'item-2', itemName: 'Water', quantity: 20, unit: 'liters', condition: 'GOOD' }
        ],
        deliveryLocation: {
          latitude: 40.7128,
          longitude: -74.0060,
          accuracy: 10
        },
        deliveryNotes: 'Successfully delivered all items'
      }

      const response = await fetch(`/api/v1/responses/${testResponse.id}/deliver`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${testUser.sessionToken}`
        },
        body: JSON.stringify(deliveryData)
      })

      expect(response.ok).toBe(true)
      const result = await response.json()
      
      expect(result.success).toBe(true)
      expect(result.data.status).toBe('DELIVERED')
      expect(result.data.verificationStatus).toBe('SUBMITTED')

      // Verify database state
      const updatedResponse = await prisma.response.findUnique({
        where: { id: testResponse.id }
      })

      expect(updatedResponse?.status).toBe('DELIVERED')
    })

    it('should store delivery metadata correctly', async () => {
      const deliveryData = {
        deliveredItems: [
          { id: 'item-1', itemName: 'Blanket', quantity: 10, unit: 'pieces' }
        ],
        deliveryLocation: {
          latitude: 40.7128,
          longitude: -74.0060,
          accuracy: 10
        },
        deliveryNotes: 'Test delivery with GPS'
      }

      const response = await fetch(`/api/v1/responses/${testResponse.id}/deliver`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${testUser.sessionToken}`
        },
        body: JSON.stringify(deliveryData)
      })

      const result = await response.json()
      
      expect(result.data.timeline).toBeDefined()
      expect(result.data.timeline.delivery).toBeDefined()
      expect(result.data.timeline.delivery.confirmedAt).toBeDefined()
      expect(result.data.timeline.delivery.deliveredBy).toBe(testUser.id)
      expect(result.data.timeline.delivery.deliveryLocation).toEqual(deliveryData.deliveryLocation)
    })

    it('should handle media attachments', async () => {
      // First, upload some media
      const testFile = new File(['test'], 'delivery-photo.jpg', { type: 'image/jpeg' })
      const mediaResult = await deliveryMediaService.uploadDeliveryMedia(
        testFile,
        {
          capturedFor: 'delivery_proof',
          deliveryId: testResponse.id,
          gps: {
            latitude: 40.7128,
            longitude: -74.0060,
            accuracy: 10,
            timestamp: new Date()
          }
        },
        testResponse.id
      )

      const deliveryData = {
        deliveredItems: [
          { id: 'item-1', itemName: 'Blanket', quantity: 10, unit: 'pieces' }
        ],
        deliveryLocation: {
          latitude: 40.7128,
          longitude: -74.0060,
          accuracy: 10
        },
        mediaAttachmentIds: [mediaResult.mediaId]
      }

      const response = await fetch(`/api/v1/responses/${testResponse.id}/deliver`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${testUser.sessionToken}`
        },
        body: JSON.stringify(deliveryData)
      })

      expect(response.ok).toBe(true)
      const result = await response.json()
      
      expect(result.data.timeline.delivery.mediaAttachmentIds).toContain(mediaResult.mediaId)
    })

    it('should reject invalid GPS coordinates', async () => {
      const deliveryData = {
        deliveredItems: [
          { id: 'item-1', itemName: 'Blanket', quantity: 10, unit: 'pieces' }
        ],
        deliveryLocation: {
          latitude: 91, // Invalid latitude
          longitude: -74.0060,
          accuracy: 10
        }
      }

      const response = await fetch(`/api/v1/responses/${testResponse.id}/deliver`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${testUser.sessionToken}`
        },
        body: JSON.stringify(deliveryData)
      })

      expect(response.ok).toBe(false)
      const result = await response.json()
      
      expect(result.error).toContain('Latitude must be between')
    })

    it('should require delivered items', async () => {
      const deliveryData = {
        deliveredItems: [],
        deliveryLocation: {
          latitude: 40.7128,
          longitude: -74.0060,
          accuracy: 10
        }
      }

      const response = await fetch(`/api/v1/responses/${testResponse.id}/deliver`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${testUser.sessionToken}`
        },
        body: JSON.stringify(deliveryData)
      })

      expect(response.ok).toBe(false)
      const result = await response.json()
      
      expect(result.error).toContain('At least one delivered item is required')
    })

    it('should prevent duplicate delivery confirmations', async () => {
      const deliveryData = {
        deliveredItems: [
          { id: 'item-1', itemName: 'Blanket', quantity: 10, unit: 'pieces' }
        ],
        deliveryLocation: {
          latitude: 40.7128,
          longitude: -74.0060,
          accuracy: 10
        }
      }

      // First delivery confirmation
      const firstResponse = await fetch(`/api/v1/responses/${testResponse.id}/deliver`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${testUser.sessionToken}`
        },
        body: JSON.stringify(deliveryData)
      })

      expect(firstResponse.ok).toBe(true)

      // Second delivery confirmation should fail
      const secondResponse = await fetch(`/api/v1/responses/${testResponse.id}/deliver`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${testUser.sessionToken}`
        },
        body: JSON.stringify(deliveryData)
      })

      expect(secondResponse.ok).toBe(false)
      const result = await secondResponse.json()
      expect(result.error).toContain('already been delivered')
    })

    it('should enforce role-based access control', async () => {
      // Create a user with wrong role
      const coordinatorUser = await createTestUser('COORDINATOR')
      
      const deliveryData = {
        deliveredItems: [
          { id: 'item-1', itemName: 'Blanket', quantity: 10, unit: 'pieces' }
        ],
        deliveryLocation: {
          latitude: 40.7128,
          longitude: -74.0060,
          accuracy: 10
        }
      }

      const response = await fetch(`/api/v1/responses/${testResponse.id}/deliver`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${coordinatorUser.sessionToken}`
        },
        body: JSON.stringify(deliveryData)
      })

      expect(response.ok).toBe(false)
      const result = await response.json()
      expect(result.error).toContain('RESCUER_ROLE_REQUIRED')
    })
  })

  describe('ResponseService.confirmDelivery', () => {
    it('should integrate with database transactions', async () => {
      const deliveryData = {
        deliveredItems: [
          { id: 'item-1', itemName: 'Blanket', quantity: 10, unit: 'pieces' }
        ],
        deliveryLocation: {
          latitude: 40.7128,
          longitude: -74.0060,
          accuracy: 10
        }
      }

      // Mock a database error during transaction
      const originalUpdate = prisma.response.update
      prisma.response.update = jest.fn().mockRejectedValueOnce(new Error('Database error'))

      await expect(
        ResponseService.confirmDelivery(testResponse.id, deliveryData, testUser.id)
      ).rejects.toThrow('Database error')

      // Restore original method
      prisma.response.update = originalUpdate

      // Verify response status wasn't changed
      const unchangedResponse = await prisma.response.findUnique({
        where: { id: testResponse.id }
      })
      expect(unchangedResponse?.status).toBe('PLANNED')
    })

    it('should create audit trail entries', async () => {
      const deliveryData = {
        deliveredItems: [
          { id: 'item-1', itemName: 'Blanket', quantity: 10, unit: 'pieces' }
        ],
        deliveryLocation: {
          latitude: 40.7128,
          longitude: -74.0060,
          accuracy: 10
        }
      }

      await ResponseService.confirmDelivery(testResponse.id, deliveryData, testUser.id)

      // Verify audit log was created
      const auditLog = await prisma.auditLog.findFirst({
        where: {
          entityType: 'RESPONSE',
          entityId: testResponse.id,
          action: 'STATUS_CHANGE'
        }
      })

      expect(auditLog).toBeDefined()
      expect(auditLog?.oldValue).toBe('PLANNED')
      expect(auditLog?.newValue).toBe('DELIVERED')
      expect(auditLog?.userId).toBe(testUser.id)
    })
  })
})