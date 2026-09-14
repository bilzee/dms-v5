import { prisma } from '@/lib/db'

export async function setupTestDatabase() {
  // Clean up any existing test data
  await cleanupTestDatabase()
}

export async function cleanupTestDatabase() {
  // Clean up in the correct order due to foreign key constraints
  await prisma.auditLog.deleteMany()
  await prisma.mediaAttachment.deleteMany()
  await prisma.response.deleteMany()
  await prisma.assessment.deleteMany()
  await prisma.entity.deleteMany()
  await prisma.user.deleteMany({
    where: {
      email: {
        contains: '@test.com'
      }
    }
  })
}

export async function createTestUser(role: string = 'RESPONDER') {
  return await prisma.user.create({
    data: {
      email: `${role.toLowerCase()}-test-${Date.now()}@test.com`,
      name: `Test ${role}`,
      role: role as any,
      isActive: true,
      sessionToken: `test-session-${Date.now()}`,
      sessionExpires: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours from now
    }
  })
}

export async function createTestEntity(data: Partial<any> = {}) {
  return await prisma.entity.create({
    data: {
      name: 'Test Entity',
      type: 'SHELTER',
      location: 'Test Location',
      ...data
    }
  })
}

export async function createTestAssessment(assessorId: string, entityId: string, data: Partial<any> = {}) {
  return await prisma.assessment.create({
    data: {
      assessorId,
      entityId,
      assessmentType: 'SHELTER',
      data: {
        requirements: ['Blankets', 'Water'],
        priority: 'HIGH',
        ...data
      }
    }
  })
}

export async function createTestResponse(responderId: string, assessmentId: string, entityId: string, data: Partial<any> = {}) {
  return await prisma.response.create({
    data: {
      responderId,
      assessmentId,
      entityId,
      status: 'PLANNED',
      data: {
        plannedItems: [
          { id: 'item-1', itemName: 'Blanket', quantity: 10, unit: 'pieces' },
          { id: 'item-2', itemName: 'Water', quantity: 20, unit: 'liters' }
        ],
        ...data
      }
    }
  })
}

export async function createTestMediaAttachment(data: Partial<any> = {}) {
  return await prisma.mediaAttachment.create({
    data: {
      filename: 'test-photo.jpg',
      originalName: 'test-photo.jpg',
      mimeType: 'image/jpeg',
      fileSize: 1024 * 1024, // 1MB
      path: '/uploads/test-photo.jpg',
      url: 'https://example.com/test-photo.jpg',
      uploadedBy: 'test-user-id',
      capturedFor: 'delivery_proof',
      metadata: {
        gps: {
          latitude: 40.7128,
          longitude: -74.0060,
          accuracy: 10,
          timestamp: new Date()
        },
        ...data
      }
    }
  })
}

export async function createDeliveryConfirmationTestData() {
  // Create a complete test scenario for delivery confirmation
  const responder = await createTestUser('RESPONDER')
  const coordinator = await createTestUser('COORDINATOR')
  
  const entity = await createTestEntity({
    name: 'Test Shelter',
    type: 'SHELTER',
    location: 'Test Location'
  })
  
  const assessment = await createTestAssessment(responder.id, entity.id, {
    requirements: ['Emergency supplies'],
    priority: 'HIGH'
  })
  
  const response = await createTestResponse(responder.id, assessment.id, entity.id, {
    plannedItems: [
      { id: 'item-1', itemName: 'Blanket', quantity: 10, unit: 'pieces' },
      { id: 'item-2', itemName: 'Water', quantity: 20, unit: 'liters' }
    ]
  })
  
  const mediaAttachment = await createTestMediaAttachment({
    capturedFor: 'delivery_proof',
    deliveryId: response.id
  })
  
  return {
    responder,
    coordinator,
    entity,
    assessment,
    response,
    mediaAttachment
  }
}