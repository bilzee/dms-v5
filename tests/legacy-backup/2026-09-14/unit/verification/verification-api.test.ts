import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { db } from '@/lib/db/client';

// Import the API handlers
import { GET as getVerificationQueue } from '@/app/api/v1/verification/queue/assessments/route';
import { POST as verifyAssessment } from '@/app/api/v1/assessments/[id]/verify/route';
import { POST as rejectAssessment } from '@/app/api/v1/assessments/[id]/reject/route';
import { GET as getMetrics } from '@/app/api/v1/verification/metrics/route';

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

const mockAssessment = {
  id: 'assessment-1',
  rapidAssessmentType: 'HEALTH',
  rapidAssessmentDate: new Date(),
  verificationStatus: 'SUBMITTED',
  priority: 'HIGH',
  entity: {
    id: 'entity-1',
    name: 'Test Health Center',
    type: 'HEALTH_FACILITY',
    location: 'Test Location'
  },
  assessor: {
    id: 'assessor-1',
    name: 'John Assessor',
    email: 'assessor@test.com'
  },
  createdAt: new Date(),
  updatedAt: new Date()
};

describe('Verification API Endpoints', () => {
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

  describe('GET /api/v1/verification/queue/assessments', () => {
    it('should return verification queue for coordinator', async () => {
      // Setup mocks
      mockDb.rapidAssessment = {
        count: jest.fn().mockResolvedValue(5),
        findMany: jest.fn().mockResolvedValue([mockAssessment])
      };

      const request = new NextRequest('http://localhost/api/v1/verification/queue/assessments?status=SUBMITTED');
      const response = await getVerificationQueue(request);
      
      expect(response.status).toBe(200);
      
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data).toHaveLength(1);
      expect(data.pagination).toBeDefined();
      expect(data.pagination.total).toBe(5);
    });

    it('should require coordinator role', async () => {
      // Mock non-coordinator user
      mockDb.user.findUnique.mockResolvedValue({
        id: 'user-1',
        roles: [{ role: { name: 'ASSESSOR' } }]
      });

      const request = new NextRequest('http://localhost/api/v1/verification/queue/assessments');
      const response = await getVerificationQueue(request);
      
      expect(response.status).toBe(403);
      
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Coordinator role required');
    });

    it('should require authentication', async () => {
      mockGetServerSession.mockResolvedValue(null);

      const request = new NextRequest('http://localhost/api/v1/verification/queue/assessments');
      const response = await getVerificationQueue(request);
      
      expect(response.status).toBe(401);
      
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe('Unauthorized');
    });

    it('should filter by status parameter', async () => {
      mockDb.rapidAssessment = {
        count: jest.fn().mockResolvedValue(3),
        findMany: jest.fn().mockResolvedValue([mockAssessment])
      };

      const request = new NextRequest('http://localhost/api/v1/verification/queue/assessments?status=VERIFIED');
      await getVerificationQueue(request);
      
      expect(mockDb.rapidAssessment.count).toHaveBeenCalledWith({
        where: { verificationStatus: 'VERIFIED' }
      });
      
      expect(mockDb.rapidAssessment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { verificationStatus: 'VERIFIED' }
        })
      );
    });

    it('should support pagination', async () => {
      mockDb.rapidAssessment = {
        count: jest.fn().mockResolvedValue(25),
        findMany: jest.fn().mockResolvedValue([mockAssessment])
      };

      const request = new NextRequest('http://localhost/api/v1/verification/queue/assessments?page=2&limit=5');
      const response = await getVerificationQueue(request);
      
      const data = await response.json();
      expect(data.pagination.page).toBe(2);
      expect(data.pagination.limit).toBe(5);
      expect(data.pagination.totalPages).toBe(5);
      
      expect(mockDb.rapidAssessment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 5, // (page - 1) * limit
          take: 5
        })
      );
    });
  });

  describe('POST /api/v1/assessments/[id]/verify', () => {
    it('should verify assessment successfully', async () => {
      // Setup transaction mock
      const mockUpdatedAssessment = {
        ...mockAssessment,
        verificationStatus: 'VERIFIED',
        verifiedAt: new Date(),
        verifiedBy: 'coordinator-1'
      };

      mockDb.$transaction = jest.fn().mockImplementation(async (callback) => {
        return await callback({
          rapidAssessment: {
            findUnique: jest.fn().mockResolvedValue(mockAssessment),
            update: jest.fn().mockResolvedValue(mockUpdatedAssessment)
          },
          auditLog: {
            create: jest.fn().mockResolvedValue({})
          }
        });
      });

      const request = new NextRequest('http://localhost/api/v1/assessments/assessment-1/verify', {
        method: 'POST',
        body: JSON.stringify({ notes: 'Approved - looks good' })
      });

      const response = await verifyAssessment(request, { params: { id: 'assessment-1' } });
      
      expect(response.status).toBe(200);
      
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data.verificationStatus).toBe('VERIFIED');
      expect(data.message).toContain('verified successfully');
    });

    it('should reject verification of non-submitted assessment', async () => {
      const alreadyVerifiedAssessment = {
        ...mockAssessment,
        verificationStatus: 'VERIFIED'
      };

      mockDb.$transaction = jest.fn().mockImplementation(async (callback) => {
        return await callback({
          rapidAssessment: {
            findUnique: jest.fn().mockResolvedValue(alreadyVerifiedAssessment)
          }
        });
      });

      const request = new NextRequest('http://localhost/api/v1/assessments/assessment-1/verify', {
        method: 'POST',
        body: JSON.stringify({ notes: 'Trying to verify again' })
      });

      const response = await verifyAssessment(request, { params: { id: 'assessment-1' } });
      
      expect(response.status).toBe(400);
      
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Cannot verify assessment with status: VERIFIED');
    });

    it('should handle non-existent assessment', async () => {
      mockDb.$transaction = jest.fn().mockImplementation(async (callback) => {
        return await callback({
          rapidAssessment: {
            findUnique: jest.fn().mockResolvedValue(null)
          }
        });
      });

      const request = new NextRequest('http://localhost/api/v1/assessments/nonexistent/verify', {
        method: 'POST',
        body: JSON.stringify({ notes: 'Test' })
      });

      const response = await verifyAssessment(request, { params: { id: 'nonexistent' } });
      
      expect(response.status).toBe(400);
      
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe('Assessment not found');
    });
  });

  describe('POST /api/v1/assessments/[id]/reject', () => {
    it('should reject assessment successfully', async () => {
      const mockRejectedAssessment = {
        ...mockAssessment,
        verificationStatus: 'REJECTED',
        rejectionReason: 'INCOMPLETE_DATA',
        rejectionFeedback: 'Missing required health data fields',
        verifiedAt: new Date(),
        verifiedBy: 'coordinator-1'
      };

      mockDb.$transaction = jest.fn().mockImplementation(async (callback) => {
        return await callback({
          rapidAssessment: {
            findUnique: jest.fn().mockResolvedValue(mockAssessment),
            update: jest.fn().mockResolvedValue(mockRejectedAssessment)
          },
          auditLog: {
            create: jest.fn().mockResolvedValue({})
          }
        });
      });

      const request = new NextRequest('http://localhost/api/v1/assessments/assessment-1/reject', {
        method: 'POST',
        body: JSON.stringify({
          reason: 'INCOMPLETE_DATA',
          feedback: 'Missing required health data fields'
        })
      });

      const response = await rejectAssessment(request, { params: { id: 'assessment-1' } });
      
      expect(response.status).toBe(200);
      
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data.verificationStatus).toBe('REJECTED');
      expect(data.data.rejectionReason).toBe('INCOMPLETE_DATA');
      expect(data.message).toContain('rejected successfully');
    });

    it('should require feedback for rejection', async () => {
      const request = new NextRequest('http://localhost/api/v1/assessments/assessment-1/reject', {
        method: 'POST',
        body: JSON.stringify({
          reason: 'INCOMPLETE_DATA',
          feedback: '' // Empty feedback should fail validation
        })
      });

      const response = await rejectAssessment(request, { params: { id: 'assessment-1' } });
      
      expect(response.status).toBe(400);
      
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe('Validation failed');
    });

    it('should validate rejection reason enum', async () => {
      const request = new NextRequest('http://localhost/api/v1/assessments/assessment-1/reject', {
        method: 'POST',
        body: JSON.stringify({
          reason: 'INVALID_REASON',
          feedback: 'Some feedback'
        })
      });

      const response = await rejectAssessment(request, { params: { id: 'assessment-1' } });
      
      expect(response.status).toBe(400);
      
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe('Validation failed');
    });
  });

  describe('GET /api/v1/verification/metrics', () => {
    it('should return verification metrics', async () => {
      // Mock database queries for metrics
      mockDb.rapidAssessment = {
        count: jest.fn()
          .mockResolvedValueOnce(10) // totalPending
          .mockResolvedValueOnce(25) // totalVerified
          .mockResolvedValueOnce(5)  // totalRejected
          .mockResolvedValueOnce(15), // totalAutoVerified
        groupBy: jest.fn().mockResolvedValue([
          { rapidAssessmentType: 'HEALTH', _count: 5 },
          { rapidAssessmentType: 'WASH', _count: 3 },
          { rapidAssessmentType: 'FOOD', _count: 2 }
        ]),
        findMany: jest.fn().mockResolvedValue([
          {
            createdAt: new Date('2025-01-01T10:00:00Z'),
            verifiedAt: new Date('2025-01-01T10:30:00Z')
          },
          {
            createdAt: new Date('2025-01-01T11:00:00Z'),
            verifiedAt: new Date('2025-01-01T11:15:00Z')
          }
        ])
      };

      const request = new NextRequest('http://localhost/api/v1/verification/metrics');
      const response = await getMetrics(request);
      
      expect(response.status).toBe(200);
      
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data).toMatchObject({
        totalPending: 10,
        totalVerified: 25,
        totalRejected: 5,
        totalAutoVerified: 15,
        pendingByType: {
          'HEALTH': 5,
          'WASH': 3,
          'FOOD': 2
        }
      });
      
      // Verify calculated metrics
      expect(data.data.verificationRate).toBeCloseTo(0.889); // (25 + 15) / (25 + 5 + 15)
      expect(data.data.rejectionRate).toBeCloseTo(0.111); // 5 / (25 + 5 + 15)
      expect(data.data.averageProcessingTime).toBeGreaterThan(0);
    });

    it('should calculate correct average processing time', async () => {
      const now = new Date();
      const thirtyMinutesAgo = new Date(now.getTime() - 30 * 60 * 1000);
      const fifteenMinutesAgo = new Date(now.getTime() - 15 * 60 * 1000);

      mockDb.rapidAssessment = {
        count: jest.fn().mockResolvedValue(0),
        groupBy: jest.fn().mockResolvedValue([]),
        findMany: jest.fn().mockResolvedValue([
          {
            createdAt: thirtyMinutesAgo,
            verifiedAt: now
          },
          {
            createdAt: fifteenMinutesAgo,
            verifiedAt: now
          }
        ])
      };

      const request = new NextRequest('http://localhost/api/v1/verification/metrics');
      const response = await getMetrics(request);
      
      const data = await response.json();
      
      // Average should be (1800 + 900) / 2 = 1350 seconds (22.5 minutes)
      expect(data.data.averageProcessingTime).toBeCloseTo(1350, 0);
    });

    it('should handle zero verification times gracefully', async () => {
      mockDb.rapidAssessment = {
        count: jest.fn().mockResolvedValue(0),
        groupBy: jest.fn().mockResolvedValue([]),
        findMany: jest.fn().mockResolvedValue([]) // No verification times
      };

      const request = new NextRequest('http://localhost/api/v1/verification/metrics');
      const response = await getMetrics(request);
      
      const data = await response.json();
      expect(data.data.averageProcessingTime).toBe(0);
      expect(data.data.verificationRate).toBe(0);
      expect(data.data.rejectionRate).toBe(0);
    });
  });
});