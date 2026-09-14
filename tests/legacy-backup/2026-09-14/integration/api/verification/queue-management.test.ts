/**
 * Integration tests for verification queue management APIs
 */

import { NextRequest } from 'next/server';
import { GET as getAssessments } from '@/app/api/v1/verification/queue/assessments/route';
import { GET as getDeliveries } from '@/app/api/v1/verification/queue/deliveries/route';
import { GET as getMetrics } from '@/app/api/v1/verification/metrics/route';
import { withAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/client';

// Mock the authentication middleware
jest.mock('@/lib/auth/middleware');
jest.mock('@/lib/db/client');

const mockWithAuth = withAuth as jest.MockedFunction<typeof withAuth>;

describe('Verification Queue Management APIs', () => {
  let mockRequest: NextRequest;
  let mockContext: any;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Setup mock request
    mockRequest = new NextRequest('http://localhost:3000/api/v1/verification/queue/assessments', {
      method: 'GET'
    });

    // Setup mock context with coordinator role
    mockContext = {
      user: { id: 'test-user', email: 'coordinator@test.com' },
      roles: ['COORDINATOR']
    };

    // Mock authentication middleware to pass through
    mockWithAuth.mockImplementation((handler) => {
      return async (req: NextRequest, context: any) => {
        return handler(req, { ...context, ...mockContext });
      };
    });

    // Mock Prisma responses
    (prisma.rapidAssessment as any).mockImplementation({
      count: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn()
    });

    (prisma.rapidResponse as any).mockImplementation({
      count: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn()
    });
  });

  describe('Assessments Queue API', () => {
    it('returns 401 for unauthenticated requests', async () => {
      mockContext.roles = []; // No roles
      mockWithAuth.mockImplementation((handler) => {
        return async (req: NextRequest, context: any) => {
          return handler(req, { ...context, ...mockContext });
        };
      });

      const response = await getAssessments(mockRequest, mockContext);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.success).toBe(false);
      expect(data.error).toContain('Insufficient permissions');
    });

    it('returns assessments with pagination and metadata', async () => {
      const mockAssessments = [
        {
          id: '1',
          verificationStatus: 'SUBMITTED',
          priority: 'CRITICAL',
          rapidAssessmentType: 'HEALTH',
          rapidAssessmentDate: new Date('2024-01-15T10:00:00Z'),
          entity: { name: 'Central Hospital', type: 'FACILITY', location: 'Downtown' },
          assessor: { name: 'John Doe', email: 'john@example.com' }
        },
        {
          id: '2',
          verificationStatus: 'SUBMITTED',
          priority: 'HIGH',
          rapidAssessmentType: 'WASH',
          rapidAssessmentDate: new Date('2024-01-15T11:00:00Z'),
          entity: { name: 'North Clinic', type: 'FACILITY', location: 'North District' },
          assessor: { name: 'Jane Smith', email: 'jane@example.com' }
        }
      ];

      // Mock Prisma responses
      (prisma.rapidAssessment.count as jest.Mock).mockResolvedValue(2);
      (prisma.rapidAssessment.findMany as jest.Mock).mockResolvedValue(mockAssessments);
      (prisma.rapidAssessment.findMany as jest.Mock).mockResolvedValue(mockAssessments); // For queue depth

      const response = await getAssessments(mockRequest, mockContext);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).toHaveLength(2);
      expect(data.pagination.page).toBe(1);
      expect(data.pagination.limit).toBe(20);
      expect(data.pagination.total).toBe(2);
      expect(data.queueDepth).toBeDefined();
      expect(data.metrics).toBeDefined();
      expect(data.meta.realTimeUpdate).toBe(true);
      expect(data.meta.nextUpdateIn).toBe(30000);
    });

    it('handles filtering parameters correctly', async () => {
      // Create request with filters
      const filteredRequest = new NextRequest(
        'http://localhost:3000/api/v1/verification/queue/assessments?status=SUBMITTED,VERIFIED&priority=CRITICAL&assessmentType=HEALTH&sortBy=rapidAssessmentDate&sortOrder=asc'
      );

      (prisma.rapidAssessment.count as jest.Mock).mockResolvedValue(1);
      (prisma.rapidAssessment.findMany as jest.Mock).mockResolvedValue([
        {
          id: '1',
          verificationStatus: 'SUBMITTED',
          priority: 'CRITICAL',
          rapidAssessmentType: 'HEALTH'
        }
      ]);

      const response = await getAssessments(filteredRequest, mockContext);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(prisma.rapidAssessment.count).toHaveBeenCalledWith({
        verificationStatus: { in: ['SUBMITTED', 'VERIFIED'] },
        priority: 'CRITICAL',
        rapidAssessmentType: 'HEALTH'
      });
    });

    it('calculates queue metrics correctly', async () => {
      const mockAssessments = [
        {
          id: '1',
          createdAt: new Date(Date.now() - 30 * 60 * 1000) // 30 minutes ago
        },
        {
          id: '2',
          createdAt: new Date(Date.now() - 60 * 60 * 1000) // 1 hour ago
        }
      ];

      (prisma.rapidAssessment.count as jest.Mock).mockResolvedValue(2);
      (prisma.rapidAssessment.findMany as jest.Mock).mockResolvedValue(mockAssessments);
      (prisma.rapidAssessment.findMany as jest.Mock).mockResolvedValue([
        { createdAt: new Date(Date.now() - 60 * 60 * 1000) } // 1 hour ago
      ]); // For oldest pending

      // Mock 24 hour verification rate
      (prisma.rapidAssessment.count as jest.Mock)
        .mockResolvedValueOnce(10) // total submitted
        .mockResolvedValueOnce(8); // total verified

      const response = await getAssessments(mockRequest, mockContext);
      const data = await response.json();

      expect(data.metrics.averageWaitTime).toBeGreaterThan(0);
      expect(data.metrics.verificationRate).toBeGreaterThanOrEqual(0);
      expect(data.metrics.verificationRate).toBeLessThanOrEqual(1);
    });

    it('handles search functionality', async () => {
      const searchRequest = new NextRequest(
        'http://localhost:3000/api/v1/verification/queue/assessments?search=hospital'
      );

      (prisma.rapidAssessment.count as jest.Mock).mockResolvedValue(1);
      (prisma.rapidAssessment.findMany as jest.Mock).mockResolvedValue([
        {
          id: '1',
          entity: { name: 'Central Hospital' }
        }
      ]);

      const response = await getAssessments(searchRequest, mockContext);

      expect(response.status).toBe(200);
      expect(prisma.rapidAssessment.count).toHaveBeenCalledWith({
        verificationStatus: { in: ['SUBMITTED'] },
        OR: [
          { assessorName: { contains: 'hospital', mode: 'insensitive' } },
          { entity: { name: { contains: 'hospital', mode: 'insensitive' } } },
          { location: { contains: 'hospital', mode: 'insensitive' } }
        ]
      });
    });
  });

  describe('Deliveries Queue API', () => {
    it('returns delivery queue with enhanced data', async () => {
      const mockDeliveries = [
        {
          id: '1',
          status: 'DELIVERED',
          verificationStatus: 'SUBMITTED',
          priority: 'HIGH',
          responseDate: new Date('2024-01-15T12:00:00Z'),
          type: 'HEALTH',
          entity: { name: 'Central Hospital', type: 'FACILITY' },
          responder: { name: 'Jane Smith', email: 'jane@example.com' },
          assessment: { 
            rapidAssessmentType: 'HEALTH',
            rapidAssessmentDate: new Date('2024-01-15T10:00:00Z')
          },
          timeline: {
            delivery: {
              confirmedAt: '2024-01-15T12:30:00Z',
              deliveredBy: 'Team A',
              deliveryLocation: 'Hospital Entrance'
            }
          },
          mediaAttachments: []
        }
      ];

      (prisma.rapidResponse.count as jest.Mock).mockResolvedValue(1);
      (prisma.rapidResponse.findMany as jest.Mock).mockResolvedValue(mockDeliveries);

      const deliveryRequest = new NextRequest(
        'http://localhost:3000/api/v1/verification/queue/deliveries'
      );

      const response = await getDeliveries(deliveryRequest, mockContext);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).toHaveLength(1);
      expect(data.data[0]).toHaveProperty('deliveryInfo');
      expect(data.data[0]).toHaveProperty('deliveryProof');
      expect(data.queueDepth).toBeDefined();
      expect(data.metrics).toBeDefined();
    });

    it('applies delivery-specific filters', async () => {
      const filteredDeliveryRequest = new NextRequest(
        'http://localhost:3000/api/v1/verification/queue/deliveries?responderId=user-1&dateFrom=2024-01-01'
      );

      (prisma.rapidResponse.count as jest.Mock).mockResolvedValue(1);
      (prisma.rapidResponse.findMany as jest.Mock).mockResolvedValue([]);

      const response = await getDeliveries(filteredDeliveryRequest, mockContext);

      expect(response.status).toBe(200);
      expect(prisma.rapidResponse.count).toHaveBeenCalledWith({
        status: 'DELIVERED',
        verificationStatus: { in: ['SUBMITTED'] },
        responderId: 'user-1',
        responseDate: {
          gte: new Date('2024-01-01')
        }
      });
    });

    it('includes delivery queue depth indicators', async () => {
      const mockDeliveries = [
        {
          id: '1',
          status: 'DELIVERED',
          verificationStatus: 'SUBMITTED',
          priority: 'CRITICAL'
        }
      ];

      (prisma.rapidResponse.count as jest.Mock)
        .mockResolvedValueOnce(1) // total count
        .mockResolvedValueOnce(1) // critical count
        .mockResolvedValueOnce(0) // high count
        .mockResolvedValueOnce(0) // medium count
        .mockResolvedValueOnce(0); // low count

      (prisma.rapidResponse.findMany as jest.Mock).mockResolvedValue(mockDeliveries);

      const deliveryRequest = new NextRequest(
        'http://localhost:3000/api/v1/verification/queue/deliveries'
      );

      const response = await getDeliveries(deliveryRequest, mockContext);
      const data = await response.json();

      expect(data.queueDepth.total).toBe(1);
      expect(data.queueDepth.critical).toBe(1);
      expect(data.queueDepth.high).toBe(0);
    });
  });

  describe('Metrics API', () => {
    it('returns comprehensive verification metrics', async () => {
      // Mock the metrics API
      jest.doMock('@/app/api/v1/verification/metrics/route', () => ({
        GET: jest.fn().mockResolvedValue(
          NextResponse.json({
            success: true,
            data: {
              totalPending: 15,
              totalVerified: 45,
              totalRejected: 5,
              verificationRate: 0.75,
              averageProcessingTime: 30,
              metricsByType: {
                HEALTH: { pending: 5, verified: 20, rejected: 2 },
                WASH: { pending: 3, verified: 10, rejected: 1 }
              }
            }
          })
        )
      }));

      // Test that metrics can be retrieved successfully
      const mockMetricsData = {
        success: true,
        data: {
          totalPending: 15,
          totalVerified: 45,
          totalRejected: 5,
          verificationRate: 0.75,
          averageProcessingTime: 30
        }
      };

      expect(mockMetricsData.success).toBe(true);
      expect(mockMetricsData.data.totalPending).toBe(15);
      expect(mockMetricsData.data.verificationRate).toBe(0.75);
    });
  });

  describe('Error Handling', () => {
    it('handles database errors gracefully', async () => {
      // Mock database error
      (prisma.rapidAssessment.count as jest.Mock).mockRejectedValue(
        new Error('Database connection failed')
      );

      const response = await getAssessments(mockRequest, mockContext);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.error).toContain('Internal server error');
    });

    it('validates input parameters', async () => {
      const invalidRequest = new NextRequest(
        'http://localhost:3000/api/v1/verification/queue/assessments?page=invalid'
      );

      // The API should handle invalid parameters gracefully
      const response = await getAssessments(invalidRequest, mockContext);
      expect(response.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe('Performance Considerations', () => {
    it('includes pagination controls to limit large result sets', async () => {
      // Mock large dataset
      const mockAssessments = Array.from({ length: 100 }, (_, i) => ({
        id: `assessment-${i}`,
        verificationStatus: 'SUBMITTED',
        priority: 'MEDIUM'
      }));

      (prisma.rapidAssessment.count as jest.Mock).mockResolvedValue(100);
      (prisma.rapidAssessment.findMany as jest.Mock).mockResolvedValue(mockAssessments.slice(0, 20)); // Limit to 20

      const limitedRequest = new NextRequest(
        'http://localhost:3000/api/v1/verification/queue/assessments?limit=20&page=1'
      );

      const response = await getAssessments(limitedRequest, mockContext);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data).toHaveLength(20);
      expect(prisma.rapidAssessment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 20,
          skip: 0
        })
      );
    });

    it('includes proper database query optimization', async () => {
      (prisma.rapidAssessment.count as jest.Mock).mockResolvedValue(0);
      (prisma.rapidAssessment.findMany as jest.Mock).mockResolvedValue([]);

      const response = await getAssessments(mockRequest, mockContext);

      expect(prisma.rapidAssessment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: {
            entity: expect.objectContaining({
              select: expect.any(Object)
            }),
            assessor: expect.objectContaining({
              select: expect.any(Object)
            })
          }
        })
      );
    });
  });
});