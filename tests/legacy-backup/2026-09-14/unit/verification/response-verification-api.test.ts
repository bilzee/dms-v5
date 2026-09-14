import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { db } from '@/lib/db/client';

// Import the response verification API handlers
import { POST as verifyResponse } from '@/app/api/v1/responses/[id]/verify/route';
import { POST as rejectResponse } from '@/app/api/v1/responses/[id]/reject/route';
import { GET as getResponseVerificationQueue } from '@/app/api/v1/verification/queue/responses/route';
import { GET as getResponseVerificationMetrics } from '@/app/api/v1/verification/metrics/responses/route';
import { POST as updateResponseAutoApproval } from '@/app/api/v1/verification/auto-approval/responses/route';

// Mock dependencies
jest.mock('next-auth');
jest.mock('@/lib/db/client');
jest.mock('@/lib/auth/config', () => ({
  authConfig: {}
}));

const mockGetServerSession = getServerSession as jest.MockedFunction<typeof getServerSession>;
const mockDb = db as any;

// Mock session data
const mockCoordinatorSession = {
  user: { id: 'coordinator-1' }
};

const mockCoordinatorUser = {
  id: 'coordinator-1',
  roles: [
    {
      role: { name: 'COORDINATOR' }
    }
  ]
};

const mockResponse = {
  id: 'response-1',
  responseType: 'HEALTH',
  responseDate: new Date(),
  verificationStatus: 'SUBMITTED',
  priority: 'HIGH',
  responseData: { 
    medicalSupplies: {
      bandages: 100,
      antiseptic: 50
    }
  },
  entity: {
    id: 'entity-1',
    name: 'Test Health Center',
    type: 'HEALTH_FACILITY',
    location: 'Test Location'
  },
  donor: {
    id: 'donor-1',
    name: 'Test Donor',
    contactEmail: 'donor@test.com'
  },
  assessor: {
    id: 'assessor-1',
    name: 'John Assessor',
    email: 'assessor@test.com'
  },
  createdAt: new Date(),
  updatedAt: new Date()
};

describe('Response Verification API Endpoints', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup default mocks
    mockGetServerSession.mockResolvedValue(mockCoordinatorSession);
    mockDb.user = {
      findUnique: jest.fn().mockResolvedValue(mockCoordinatorUser)
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/v1/verification/queue/responses', () => {
    it('should return response verification queue for coordinator', async () => {
      // Setup mocks
      mockDb.rapidResponse = {
        count: jest.fn().mockResolvedValue(8),
        findMany: jest.fn().mockResolvedValue([mockResponse])
      };

      const request = new NextRequest('http://localhost/api/v1/verification/queue/responses?status=SUBMITTED');
      const response = await getResponseVerificationQueue(request);
      
      expect(response.status).toBe(200);
      
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data).toHaveLength(1);
      expect(data.pagination).toBeDefined();
      expect(data.pagination.total).toBe(8);
    });

    it('should return accurate statistics for all verification statuses', async () => {
      // Setup mocks for statistics calculation
      mockDb.rapidResponse = {
        count: jest.fn()
          .mockResolvedValueOnce(5) // total for pagination
          .mockResolvedValueOnce(3) // submitted count
          .mockResolvedValueOnce(2) // verified count  
          .mockResolvedValueOnce(1) // auto-verified count
          .mockResolvedValueOnce(2), // rejected count
        findMany: jest.fn().mockResolvedValue([mockResponse])
      };

      const request = new NextRequest('http://localhost/api/v1/verification/queue/responses?status=SUBMITTED');
      const response = await getResponseVerificationQueue(request);
      
      expect(response.status).toBe(200);
      
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.statistics).toBeDefined();
      expect(data.statistics.submitted).toBe(3);
      expect(data.statistics.verified).toBe(3); // 2 + 1 (VERIFIED + AUTO_VERIFIED)
      expect(data.statistics.rejected).toBe(2);
      expect(data.statistics.total).toBe(8); // 3 + 2 + 1 + 2
    });

    it('should maintain statistics consistency regardless of status filter', async () => {
      // Setup mocks - statistics should be consistent regardless of filter
      const statisticsMocks = [3, 2, 1, 2]; // submitted, verified, auto-verified, rejected
      
      mockDb.rapidResponse = {
        count: jest.fn()
          .mockResolvedValueOnce(3) // filtered count (only submitted)
          .mockResolvedValueOnce(statisticsMocks[0]) // submitted count
          .mockResolvedValueOnce(statisticsMocks[1]) // verified count  
          .mockResolvedValueOnce(statisticsMocks[2]) // auto-verified count
          .mockResolvedValueOnce(statisticsMocks[3]), // rejected count
        findMany: jest.fn().mockResolvedValue([mockResponse])
      };

      // Test with SUBMITTED filter - statistics should still show all statuses
      const request = new NextRequest('http://localhost/api/v1/verification/queue/responses?status=SUBMITTED');
      const response = await getResponseVerificationQueue(request);
      
      const data = await response.json();
      expect(data.pagination.total).toBe(3); // Filtered count
      expect(data.statistics.submitted).toBe(3);
      expect(data.statistics.verified).toBe(3); // 2 + 1
      expect(data.statistics.rejected).toBe(2);
      expect(data.statistics.total).toBe(8); // Sum of all statuses
    });

    it('should require coordinator role', async () => {
      // Mock non-coordinator user
      mockDb.user.findUnique.mockResolvedValue({
        id: 'user-1',
        roles: [{ role: { name: 'RESPONDER' } }]
      });

      const request = new NextRequest('http://localhost/api/v1/verification/queue/responses');
      const response = await getResponseVerificationQueue(request);
      
      expect(response.status).toBe(403);
      
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Coordinator role required');
    });

    it('should filter by entity ID', async () => {
      mockDb.rapidResponse = {
        count: jest.fn().mockResolvedValue(3),
        findMany: jest.fn().mockResolvedValue([mockResponse])
      };

      const request = new NextRequest('http://localhost/api/v1/verification/queue/responses?entityId=entity-1');
      await getResponseVerificationQueue(request);
      
      expect(mockDb.rapidResponse.count).toHaveBeenCalledWith({
        where: { 
          verificationStatus: 'SUBMITTED',
          entityId: 'entity-1'
        }
      });
    });

    it('should support response type filtering', async () => {
      mockDb.rapidResponse = {
        count: jest.fn().mockResolvedValue(4),
        findMany: jest.fn().mockResolvedValue([mockResponse])
      };

      const request = new NextRequest('http://localhost/api/v1/verification/queue/responses?responseType=HEALTH');
      await getResponseVerificationQueue(request);
      
      expect(mockDb.rapidResponse.count).toHaveBeenCalledWith({
        where: { 
          verificationStatus: 'SUBMITTED',
          responseType: 'HEALTH'
        }
      });
    });

    it('should support pagination for large queues', async () => {
      mockDb.rapidResponse = {
        count: jest.fn().mockResolvedValue(45),
        findMany: jest.fn().mockResolvedValue([mockResponse])
      };

      const request = new NextRequest('http://localhost/api/v1/verification/queue/responses?page=3&limit=10');
      const response = await getResponseVerificationQueue(request);
      
      const data = await response.json();
      expect(data.pagination.page).toBe(3);
      expect(data.pagination.limit).toBe(10);
      expect(data.pagination.totalPages).toBe(5);
      
      expect(mockDb.rapidResponse.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 20, // (page - 1) * limit
          take: 10
        })
      );
    });
  });

  describe('POST /api/v1/responses/[id]/verify', () => {
    it('should verify response successfully', async () => {
      const mockUpdatedResponse = {
        ...mockResponse,
        verificationStatus: 'VERIFIED',
        verifiedAt: new Date(),
        verifiedBy: 'coordinator-1'
      };

      mockDb.$transaction = jest.fn().mockImplementation(async (callback) => {
        return await callback({
          rapidResponse: {
            findUnique: jest.fn().mockResolvedValue(mockResponse),
            update: jest.fn().mockResolvedValue(mockUpdatedResponse)
          },
          auditLog: {
            create: jest.fn().mockResolvedValue({})
          }
        });
      });

      const request = new NextRequest('http://localhost/api/v1/responses/response-1/verify', {
        method: 'POST',
        body: JSON.stringify({ notes: 'Medical supplies verified - appropriate quantities' })
      });

      const response = await verifyResponse(request, { params: { id: 'response-1' } });
      
      expect(response.status).toBe(200);
      
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data.verificationStatus).toBe('VERIFIED');
      expect(data.data.verifiedBy).toBe('coordinator-1');
      expect(data.message).toContain('verified successfully');
    });

    it('should reject verification of non-submitted response', async () => {
      const alreadyVerifiedResponse = {
        ...mockResponse,
        verificationStatus: 'VERIFIED'
      };

      mockDb.$transaction = jest.fn().mockImplementation(async (callback) => {
        return await callback({
          rapidResponse: {
            findUnique: jest.fn().mockResolvedValue(alreadyVerifiedResponse)
          }
        });
      });

      const request = new NextRequest('http://localhost/api/v1/responses/response-1/verify', {
        method: 'POST',
        body: JSON.stringify({ notes: 'Trying to verify again' })
      });

      const response = await verifyResponse(request, { params: { id: 'response-1' } });
      
      expect(response.status).toBe(400);
      
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Cannot verify response with status: VERIFIED');
    });

    it('should handle non-existent response', async () => {
      mockDb.$transaction = jest.fn().mockImplementation(async (callback) => {
        return await callback({
          rapidResponse: {
            findUnique: jest.fn().mockResolvedValue(null)
          }
        });
      });

      const request = new NextRequest('http://localhost/api/v1/responses/nonexistent/verify', {
        method: 'POST',
        body: JSON.stringify({ notes: 'Test' })
      });

      const response = await verifyResponse(request, { params: { id: 'nonexistent' } });
      
      expect(response.status).toBe(400);
      
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe('Response not found');
    });

    it('should validate notes are provided', async () => {
      const request = new NextRequest('http://localhost/api/v1/responses/response-1/verify', {
        method: 'POST',
        body: JSON.stringify({}) // Missing notes
      });

      const response = await verifyResponse(request, { params: { id: 'response-1' } });
      
      expect(response.status).toBe(400);
      
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Notes are required');
    });
  });

  describe('POST /api/v1/responses/[id]/reject', () => {
    it('should reject response successfully', async () => {
      const mockRejectedResponse = {
        ...mockResponse,
        verificationStatus: 'REJECTED',
        rejectionReason: 'INADEQUATE_SUPPLIES',
        rejectionFeedback: 'Medical supplies below required standards',
        verifiedAt: new Date(),
        verifiedBy: 'coordinator-1'
      };

      mockDb.$transaction = jest.fn().mockImplementation(async (callback) => {
        return await callback({
          rapidResponse: {
            findUnique: jest.fn().mockResolvedValue(mockResponse),
            update: jest.fn().mockResolvedValue(mockRejectedResponse)
          },
          auditLog: {
            create: jest.fn().mockResolvedValue({})
          }
        });
      });

      const request = new NextRequest('http://localhost/api/v1/responses/response-1/reject', {
        method: 'POST',
        body: JSON.stringify({
          rejectionReason: 'INADEQUATE_SUPPLIES',
          notes: 'Medical supplies below required standards'
        })
      });

      const response = await rejectResponse(request, { params: { id: 'response-1' } });
      
      expect(response.status).toBe(200);
      
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data.verificationStatus).toBe('REJECTED');
      expect(data.data.rejectionReason).toBe('INADEQUATE_SUPPLIES');
      expect(data.message).toContain('rejected successfully');
    });

    it('should require rejection reason', async () => {
      const request = new NextRequest('http://localhost/api/v1/responses/response-1/reject', {
        method: 'POST',
        body: JSON.stringify({
          notes: 'Some feedback'
          // Missing rejectionReason
        })
      });

      const response = await rejectResponse(request, { params: { id: 'response-1' } });
      
      expect(response.status).toBe(400);
      
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe('Validation failed');
    });

    it('should validate rejection reason enum', async () => {
      const request = new NextRequest('http://localhost/api/v1/responses/response-1/reject', {
        method: 'POST',
        body: JSON.stringify({
          rejectionReason: 'INVALID_REASON',
          notes: 'Some feedback'
        })
      });

      const response = await rejectResponse(request, { params: { id: 'response-1' } });
      
      expect(response.status).toBe(400);
      
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe('Validation failed');
    });
  });

  describe('GET /api/v1/verification/metrics/responses', () => {
    it('should return response verification metrics', async () => {
      mockDb.rapidResponse = {
        count: jest.fn()
          .mockResolvedValueOnce(12) // totalPending
          .mockResolvedValueOnce(28) // totalVerified
          .mockResolvedValueOnce(6)  // totalRejected
          .mockResolvedValueOnce(18), // totalAutoVerified
        groupBy: jest.fn().mockResolvedValue([
          { responseType: 'HEALTH', _count: 8 },
          { responseType: 'WASH', _count: 4 },
          { responseType: 'SHELTER', _count: 3 },
          { responseType: 'FOOD', _count: 2 }
        ]),
        findMany: jest.fn().mockResolvedValue([
          {
            createdAt: new Date('2025-01-01T10:00:00Z'),
            verifiedAt: new Date('2025-01-01T10:45:00Z')
          },
          {
            createdAt: new Date('2025-01-01T11:00:00Z'),
            verifiedAt: new Date('2025-01-01T11:20:00Z')
          }
        ])
      };

      const request = new NextRequest('http://localhost/api/v1/verification/metrics/responses');
      const response = await getResponseVerificationMetrics(request);
      
      expect(response.status).toBe(200);
      
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data).toMatchObject({
        totalPending: 12,
        totalVerified: 28,
        totalRejected: 6,
        totalAutoVerified: 18,
        pendingByType: {
          'HEALTH': 8,
          'WASH': 4,
          'SHELTER': 3,
          'FOOD': 2
        }
      });
      
      // Verify calculated metrics
      expect(data.data.verificationRate).toBeCloseTo(0.811); // (28 + 18) / (28 + 6 + 18)
      expect(data.data.rejectionRate).toBeCloseTo(0.189); // 6 / (28 + 6 + 18)
      expect(data.data.averageProcessingTime).toBeGreaterThan(0);
    });

    it('should support date range filtering', async () => {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      
      mockDb.rapidResponse = {
        count: jest.fn().mockResolvedValue(0),
        groupBy: jest.fn().mockResolvedValue([]),
        findMany: jest.fn().mockResolvedValue([])
      };

      const request = new NextRequest('http://localhost/api/v1/verification/metrics/responses?dateRange=7d');
      await getResponseVerificationMetrics(request);
      
      expect(mockDb.rapidResponse.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            createdAt: expect.objectContaining({
              gte: expect.any(Date)
            })
          })
        })
      );
    });
  });

  describe('POST /api/v1/verification/auto-approval/responses', () => {
    it('should update auto-approval settings for responses', async () => {
      mockDb.user.update = jest.fn().mockResolvedValue({});

      const request = new NextRequest('http://localhost/api/v1/verification/auto-approval/responses', {
        method: 'POST',
        body: JSON.stringify({
          entityIds: ['entity-1', 'entity-2'],
          enabled: true,
          scope: 'responses',
          conditions: {
            responseTypes: ['HEALTH', 'WASH'],
            minDonorRating: 4.0
          }
        })
      });

      const response = await updateResponseAutoApproval(request);
      
      expect(response.status).toBe(200);
      
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.message).toContain('Auto-approval settings updated');
    });

    it('should store auto-approval config in correct metadata field path', async () => {
      // This test prevents regression of the metadata.autoApproval vs autoApprovalConfig bug
      const mockUpdate = jest.fn().mockResolvedValue({});
      mockDb.entity = {
        updateMany: mockUpdate
      };

      const request = new NextRequest('http://localhost/api/v1/verification/auto-approval/responses', {
        method: 'POST',
        body: JSON.stringify({
          entityIds: ['entity-1'],
          enabled: true,
          scope: 'responses',
          conditions: {
            responseTypes: ['HEALTH'],
            requiresDocumentation: false
          }
        })
      });

      await updateResponseAutoApproval(request);
      
      // Verify the metadata structure uses the correct field path
      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: { in: ['entity-1'] } },
        data: {
          autoApproveEnabled: true,
          metadata: expect.objectContaining({
            autoApproval: expect.objectContaining({
              scope: 'responses',
              responseTypes: ['HEALTH'],
              requiresDocumentation: false
            })
          })
        }
      });
    });

    it('should validate scope parameter', async () => {
      const request = new NextRequest('http://localhost/api/v1/verification/auto-approval/responses', {
        method: 'POST',
        body: JSON.stringify({
          entityIds: ['entity-1'],
          enabled: true,
          scope: 'invalid_scope' // Invalid scope
        })
      });

      const response = await updateResponseAutoApproval(request);
      
      expect(response.status).toBe(400);
      
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe('Validation failed');
    });

    it('should validate response types', async () => {
      const request = new NextRequest('http://localhost/api/v1/verification/auto-approval/responses', {
        method: 'POST',
        body: JSON.stringify({
          entityIds: ['entity-1'],
          enabled: true,
          scope: 'responses',
          conditions: {
            responseTypes: ['INVALID_TYPE'] // Invalid response type
          }
        })
      });

      const response = await updateResponseAutoApproval(request);
      
      expect(response.status).toBe(400);
      
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe('Validation failed');
    });
  });

  describe('Authentication and Authorization', () => {
    it('should require authentication for all endpoints', async () => {
      mockGetServerSession.mockResolvedValue(null);

      const endpoints = [
        { handler: getResponseVerificationQueue, url: 'http://localhost/api/v1/verification/queue/responses' },
        { handler: getResponseVerificationMetrics, url: 'http://localhost/api/v1/verification/metrics/responses' },
        { handler: updateResponseAutoApproval, url: 'http://localhost/api/v1/verification/auto-approval/responses' }
      ];

      for (const endpoint of endpoints) {
        const request = new NextRequest(endpoint.url);
        const response = await endpoint.handler(request);
        
        expect(response.status).toBe(401);
        
        const data = await response.json();
        expect(data.success).toBe(false);
        expect(data.error).toBe('Unauthorized');
      }
    });

    it('should require coordinator role for verification actions', async () => {
      // Mock responder user
      mockDb.user.findUnique.mockResolvedValue({
        id: 'responder-1',
        roles: [{ role: { name: 'RESPONDER' } }]
      });

      const verificationRequest = new NextRequest('http://localhost/api/v1/responses/response-1/verify', {
        method: 'POST',
        body: JSON.stringify({ notes: 'Test verification' })
      });

      const verificationResponse = await verifyResponse(verificationRequest, { params: { id: 'response-1' } });
      expect(verificationResponse.status).toBe(403);

      const rejectionRequest = new NextRequest('http://localhost/api/v1/responses/response-1/reject', {
        method: 'POST',
        body: JSON.stringify({
          rejectionReason: 'INADEQUATE_SUPPLIES',
          notes: 'Test rejection'
        })
      });

      const rejectionResponse = await rejectResponse(rejectionRequest, { params: { id: 'response-1' } });
      expect(rejectionResponse.status).toBe(403);
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle database transaction failures gracefully', async () => {
      mockDb.$transaction = jest.fn().mockRejectedValue(new Error('Database connection failed'));

      const request = new NextRequest('http://localhost/api/v1/responses/response-1/verify', {
        method: 'POST',
        body: JSON.stringify({ notes: 'Test verification' })
      });

      const response = await verifyResponse(request, { params: { id: 'response-1' } });
      
      expect(response.status).toBe(500);
      
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe('Internal server error');
    });

    it('should handle malformed JSON requests', async () => {
      const request = new NextRequest('http://localhost/api/v1/responses/response-1/verify', {
        method: 'POST',
        body: 'invalid json'
      });

      const response = await verifyResponse(request, { params: { id: 'response-1' } });
      
      expect(response.status).toBe(400);
      
      const data = await response.json();
      expect(data.success).toBe(false);
    });

    it('should handle extremely long notes gracefully', async () => {
      const longNotes = 'a'.repeat(10001); // Beyond reasonable limit

      const request = new NextRequest('http://localhost/api/v1/responses/response-1/verify', {
        method: 'POST',
        body: JSON.stringify({ notes: longNotes })
      });

      const response = await verifyResponse(request, { params: { id: 'response-1' } });
      
      expect(response.status).toBe(400);
      
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Notes must be less');
    });
  });
});