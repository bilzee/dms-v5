import { GET, POST, PUT } from '@/app/api/v1/verification/auto-approval/route';
import { GET as getLive, POST as postLive } from '@/app/api/v1/verification/live/route';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db/client';

// Mock authentication middleware
jest.mock('@/lib/auth/middleware', () => ({
  withAuth: (handler: any) => (req: NextRequest, context: any) => {
    const mockContext = {
      roles: ['COORDINATOR'],
      user: { id: 'test-coordinator-1', name: 'Test Coordinator' },
      userId: 'test-coordinator-1'
    };
    return handler(req, mockContext);
  }
}));

// Mock Prisma client
jest.mock('@/lib/db/client', () => ({
  prisma: {
    entity: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

describe('Enhanced Auto-Approval API Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/v1/verification/auto-approval', () => {
    it('should return filtered auto-approval configurations', async () => {
      const mockEntities = [
        {
          id: 'entity-1',
          name: 'Test Hospital',
          type: 'FACILITY',
          location: 'Downtown',
          autoApproveEnabled: true,
          metadata: {
            autoApproval: {
              scope: 'both',
              assessmentTypes: ['HEALTH'],
              responseTypes: ['HEALTH'],
              maxPriority: 'MEDIUM',
              requiresDocumentation: false,
            }
          },
          updatedAt: new Date('2024-01-01'),
          _count: {
            rapidAssessments: 10,
            responses: 5,
          }
        },
        {
          id: 'entity-2',
          name: 'Community Center',
          type: 'ORGANIZATION',
          location: 'Uptown',
          autoApproveEnabled: false,
          metadata: {},
          updatedAt: new Date('2024-01-01'),
          _count: {
            rapidAssessments: 0,
            responses: 0,
          }
        }
      ];

      (prisma.entity.findMany as jest.Mock).mockResolvedValue(mockEntities);

      const request = new NextRequest('http://localhost:3000/api/v1/verification/auto-approval?entityType=FACILITY');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).toHaveLength(2);
      expect(data.summary.totalEntities).toBe(2);
      expect(data.summary.enabledCount).toBe(1);
      expect(data.summary.disabledCount).toBe(1);

      // Verify entity data structure
      const firstEntity = data.data[0];
      expect(firstEntity).toMatchObject({
        entityId: 'entity-1',
        entityName: 'Test Hospital',
        entityType: 'FACILITY',
        entityLocation: 'Downtown',
        enabled: true,
        scope: 'both',
        conditions: {
          assessmentTypes: ['HEALTH'],
          responseTypes: ['HEALTH'],
          maxPriority: 'MEDIUM',
          requiresDocumentation: false,
        },
        stats: {
          autoVerifiedAssessments: 10,
          autoVerifiedResponses: 5,
          totalAutoVerified: 15,
        }
      });
    });

    it('should handle entity type filtering', async () => {
      (prisma.entity.findMany as jest.Mock).mockResolvedValue([]);

      const request = new NextRequest('http://localhost:3000/api/v1/verification/auto-approval?entityType=FACILITY');
      await GET(request);

      expect(prisma.entity.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          isActive: true,
          type: 'FACILITY'
        }),
        select: expect.any(Object),
        orderBy: expect.any(Array)
      });
    });

    it('should handle enabledOnly filtering', async () => {
      (prisma.entity.findMany as jest.Mock).mockResolvedValue([]);

      const request = new NextRequest('http://localhost:3000/api/v1/verification/auto-approval?enabledOnly=true');
      await GET(request);

      expect(prisma.entity.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          isActive: true,
          autoApproveEnabled: true
        }),
        select: expect.any(Object),
        orderBy: expect.any(Array)
      });
    });

    it('should return 403 for non-coordinator users', async () => {
      // Mock non-coordinator context
      const originalMock = require('@/lib/auth/middleware').withAuth;
      require('@/lib/auth/middleware').withAuth = (handler: any) => (req: NextRequest) => {
        const mockContext = {
          roles: ['ASSESSOR'],
          user: { id: 'test-assessor-1' },
          userId: 'test-assessor-1'
        };
        return handler(req, mockContext);
      };

      const request = new NextRequest('http://localhost:3000/api/v1/verification/auto-approval');
      const response = await GET(request);

      expect(response.status).toBe(403);

      // Restore original mock
      require('@/lib/auth/middleware').withAuth = originalMock;
    });
  });

  describe('PUT /api/v1/verification/auto-approval (Bulk Update)', () => {
    it('should successfully update multiple entities', async () => {
      const mockEntities = [
        {
          id: 'entity-1',
          name: 'Test Hospital',
          autoApproveEnabled: false,
          metadata: {}
        },
        {
          id: 'entity-2',
          name: 'Community Center',
          autoApproveEnabled: false,
          metadata: {}
        }
      ];

      const mockUpdatedEntities = mockEntities.map(entity => ({
        ...entity,
        autoApproveEnabled: true,
        metadata: {
          autoApproval: {
            scope: 'both',
            assessmentTypes: ['HEALTH'],
            responseTypes: ['HEALTH'],
            maxPriority: 'HIGH',
            requiresDocumentation: true,
            lastModifiedBy: 'test-coordinator-1',
            lastModifiedAt: expect.any(String)
          }
        },
        updatedAt: new Date()
      }));

      (prisma.$transaction as jest.Mock).mockImplementation(async (callback) => {
        const mockTx = {
          entity: {
            findMany: jest.fn().mockResolvedValue(mockEntities),
            update: jest.fn()
          },
          auditLog: {
            create: jest.fn()
          }
        };

        // Mock entity updates
        mockTx.entity.update
          .mockResolvedValueOnce(mockUpdatedEntities[0])
          .mockResolvedValueOnce(mockUpdatedEntities[1]);

        return await callback(mockTx);
      });

      const requestBody = {
        entityIds: ['entity-1', 'entity-2'],
        enabled: true,
        scope: 'both',
        conditions: {
          assessmentTypes: ['HEALTH'],
          responseTypes: ['HEALTH'],
          maxPriority: 'HIGH',
          requiresDocumentation: true,
        }
      };

      const request = new NextRequest('http://localhost:3000/api/v1/verification/auto-approval', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      const response = await PUT(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).toHaveLength(2);
      expect(data.message).toContain('Auto-approval configuration updated for 2 entities');

      // Verify transaction was called
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('should validate request body schema', async () => {
      const invalidRequestBody = {
        entityIds: [], // Empty array should cause validation error
        enabled: 'invalid', // Should be boolean
        scope: 'invalid-scope'
      };

      const request = new NextRequest('http://localhost:3000/api/v1/verification/auto-approval', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(invalidRequestBody),
      });

      const response = await PUT(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe('At least one entity ID is required');
    });

    it('should create audit log entries for each updated entity', async () => {
      const mockEntities = [
        {
          id: 'entity-1',
          name: 'Test Hospital',
          autoApproveEnabled: false,
          metadata: {}
        }
      ];

      (prisma.$transaction as jest.Mock).mockImplementation(async (callback) => {
        const mockTx = {
          entity: {
            findMany: jest.fn().mockResolvedValue(mockEntities),
            update: jest.fn().mockResolvedValue({
              ...mockEntities[0],
              autoApproveEnabled: true,
              metadata: { autoApproval: {} },
              updatedAt: new Date()
            })
          },
          auditLog: {
            create: jest.fn()
          }
        };

        return await callback(mockTx);
      });

      const requestBody = {
        entityIds: ['entity-1'],
        enabled: true,
        scope: 'assessments',
        conditions: {
          maxPriority: 'MEDIUM',
          requiresDocumentation: false,
        }
      };

      const request = new NextRequest('http://localhost:3000/api/v1/verification/auto-approval', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      await PUT(request);

      // Verify audit log creation was called
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('should handle database transaction failures', async () => {
      (prisma.$transaction as jest.Mock).mockRejectedValue(new Error('Database error'));

      const requestBody = {
        entityIds: ['entity-1'],
        enabled: true,
        scope: 'assessments'
      };

      const request = new NextRequest('http://localhost:3000/api/v1/verification/auto-approval', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      const response = await PUT(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Database error');
    });
  });

  describe('GET /api/v1/verification/live (Real-time Endpoint)', () => {
    it('should return connection options for polling', async () => {
      const request = new NextRequest('http://localhost:3000/api/v1/verification/live');
      const response = await getLive(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.message).toBe('Enhanced real-time verification updates endpoint');
      expect(data.options).toMatchObject({
        serverSentEvents: {
          enabled: true,
          endpoint: expect.stringContaining('/api/v1/verification/live?sse=true')
        },
        polling: {
          enabled: true,
          interval: 30000,
          endpoints: expect.objectContaining({
            assessmentQueue: '/api/v1/verification/queue/assessments',
            deliveryQueue: '/api/v1/verification/queue/deliveries',
            autoApproval: '/api/v1/verification/auto-approval'
          })
        },
        websocket: {
          enabled: false
        }
      });
    });

    it('should establish SSE connection when requested', async () => {
      const request = new NextRequest('http://localhost:3000/api/v1/verification/live?sse=true&channels=configuration_changes');
      const response = await getLive(request);

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('text/event-stream');
      expect(response.headers.get('Cache-Control')).toBe('no-cache');
      expect(response.headers.get('Connection')).toBe('keep-alive');
    });

    it('should handle subscription messages via POST', async () => {
      const requestBody = {
        type: 'SUBSCRIBE',
        channels: ['configuration_changes', 'verification_updates']
      };

      const request = new NextRequest('http://localhost:3000/api/v1/verification/live', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      const response = await postLive(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.message).toBe('Subscription successful');
      expect(data.channels).toEqual(['configuration_changes', 'verification_updates']);
    });

    it('should handle broadcast messages via POST', async () => {
      const requestBody = {
        type: 'BROADCAST',
        event: 'CONFIGURATION_CHANGED',
        data: {
          entityId: 'entity-1',
          entityName: 'Test Hospital',
          changes: [
            { field: 'enabled', oldValue: false, newValue: true }
          ]
        },
        channels: ['configuration_changes']
      };

      const request = new NextRequest('http://localhost:3000/api/v1/verification/live', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      const response = await postLive(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.message).toBe('Event broadcasted successfully');
      expect(data.event).toBe('CONFIGURATION_CHANGED');
    });

    it('should reject unknown message types', async () => {
      const requestBody = {
        type: 'UNKNOWN_TYPE',
        data: {}
      };

      const request = new NextRequest('http://localhost:3000/api/v1/verification/live', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      const response = await postLive(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toContain('Unknown message type');
    });
  });

  describe('Error Handling', () => {
    it('should handle malformed JSON in request body', async () => {
      const request = new NextRequest('http://localhost:3000/api/v1/verification/auto-approval', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: 'invalid json',
      });

      const response = await PUT(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Internal server error');
    });

    it('should handle database connection errors', async () => {
      (prisma.entity.findMany as jest.Mock).mockRejectedValue(new Error('Database connection failed'));

      const request = new NextRequest('http://localhost:3000/api/v1/verification/auto-approval');
      const response = await GET(request);

      expect(response.status).toBe(500);
    });
  });

  describe('Performance Tests', () => {
    it('should handle large bulk updates efficiently', async () => {
      const largeEntityList = Array.from({ length: 100 }, (_, i) => ({
        id: `entity-${i}`,
        name: `Entity ${i}`,
        autoApproveEnabled: false,
        metadata: {}
      }));

      (prisma.$transaction as jest.Mock).mockImplementation(async (callback) => {
        const mockTx = {
          entity: {
            findMany: jest.fn().mockResolvedValue(largeEntityList),
            update: jest.fn().mockImplementation((params) => 
              Promise.resolve({
                ...largeEntityList.find(e => e.id === params.where.id),
                autoApproveEnabled: true,
                updatedAt: new Date()
              })
            )
          },
          auditLog: {
            create: jest.fn()
          }
        };

        return await callback(mockTx);
      });

      const requestBody = {
        entityIds: largeEntityList.map(e => e.id),
        enabled: true,
        scope: 'both'
      };

      const request = new NextRequest('http://localhost:3000/api/v1/verification/auto-approval', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      const startTime = Date.now();
      const response = await PUT(request);
      const endTime = Date.now();

      expect(response.status).toBe(200);
      expect(endTime - startTime).toBeLessThan(5000); // Should complete within 5 seconds
    });
  });
});