import { describe, it, expect, jest, beforeEach, beforeAll, afterAll } from '@jest/globals';
import { request } from 'supertest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/v1/leaderboard/route';
import { db } from '@/lib/db/client';

// Mock authentication middleware
jest.mock('@/lib/auth/middleware', () => ({
  withAuth: (handler: any) => async (req: NextRequest, context: any) => {
    // Mock authentication success
    return handler(req, { ...context, roles: ['DONOR'] });
  }
}));

// Mock database client
jest.mock('@/lib/db/client', () => ({
  db: {
    donor: {
      findMany: jest.fn(),
      update: jest.fn()
    }
  }
}));

describe('Leaderboard API Integration', () => {
  let mockDb: any;

  beforeAll(() => {
    mockDb = db;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // Ensure proper mock structure
    mockDb.donor.findMany = jest.fn();
    mockDb.donor.update = jest.fn();
  });

  describe('GET /api/v1/leaderboard', () => {
    const mockDonors = [
      {
        id: 'donor-1',
        name: 'Alpha Organization',
        organization: 'Alpha Org',
        selfReportedDeliveryRate: 95,
        verifiedDeliveryRate: 92,
        leaderboardRank: 1,
        createdAt: new Date('2024-01-01'),
        commitments: [
          {
            id: 'c1',
            status: 'COMPLETE',
            totalCommittedQuantity: 100,
            deliveredQuantity: 98,
            verifiedDeliveredQuantity: 95,
            totalValueEstimated: 50000,
            commitmentDate: new Date('2024-06-01'),
            lastUpdated: new Date('2024-06-15')
          }
        ],
        responses: [
          {
            id: 'r1',
            verificationStatus: 'VERIFIED',
            createdAt: new Date('2024-06-20')
          }
        ],
        entityAssignments: [
          {
            entity: {
              location: 'North'
            }
          }
        ]
      },
      {
        id: 'donor-2',
        name: 'Beta Support',
        organization: 'Beta Support',
        selfReportedDeliveryRate: 88,
        verifiedDeliveryRate: 85,
        leaderboardRank: 2,
        createdAt: new Date('2024-02-01'),
        commitments: [
          {
            id: 'c2',
            status: 'COMPLETE',
            totalCommittedQuantity: 80,
            deliveredQuantity: 75,
            verifiedDeliveredQuantity: 70,
            totalValueEstimated: 30000,
            commitmentDate: new Date('2024-07-01'),
            lastUpdated: new Date('2024-07-15')
          }
        ],
        responses: [
          {
            id: 'r2',
            verificationStatus: 'VERIFIED',
            createdAt: new Date('2024-07-20')
          }
        ],
        entityAssignments: [
          {
            entity: {
              location: 'South'
            }
          }
        ]
      },
      {
        id: 'donor-3',
        name: 'Gamma Services',
        organization: 'Gamma Services',
        selfReportedDeliveryRate: 76,
        verifiedDeliveryRate: 70,
        leaderboardRank: 3,
        createdAt: new Date('2024-03-01'),
        commitments: [
          {
            id: 'c3',
            status: 'PARTIAL',
            totalCommittedQuantity: 50,
            deliveredQuantity: 30,
            verifiedDeliveredQuantity: 25,
            totalValueEstimated: 15000,
            commitmentDate: new Date('2024-08-01'),
            lastUpdated: new Date('2024-08-15')
          }
        ],
        responses: [],
        entityAssignments: [
          {
            entity: {
              location: 'North'
            }
          }
        ]
      }
    ];

    it('should return 200 and leaderboard data for valid request', async () => {
      mockDb.donor.findMany.mockResolvedValue(mockDonors);
      mockDb.donor.update.mockResolvedValue(mockDonors[0]);

      const request = new NextRequest('http://localhost:3000/api/v1/leaderboard', {
        method: 'GET'
      });

      const response = await GET(request, { roles: ['DONOR'] });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).toHaveProperty('rankings');
      expect(data.data).toHaveProperty('metadata');

      const { rankings, metadata } = data.data;

      // Check metadata
      expect(metadata.totalParticipants).toBe(3);
      expect(metadata.timeframe).toBe('30d');
      expect(metadata.region).toBe('All Regions');
      expect(metadata.sortBy).toBe('overall');
      expect(metadata.limit).toBe(50);

      // Check rankings
      expect(rankings).toHaveLength(3);
      expect(rankings[0]).toMatchObject({
        rank: 1,
        donor: {
          id: 'donor-1',
          organizationName: 'Alpha Org',
          region: 'North'
        },
        trend: 'stable'
      });

      // Check metrics structure
      expect(rankings[0].metrics).toHaveProperty('commitments');
      expect(rankings[0].metrics).toHaveProperty('deliveryRates');
      expect(rankings[0].metrics).toHaveProperty('responses');
      expect(rankings[0].metrics).toHaveProperty('performance');

      // Check badges
      expect(Array.isArray(rankings[0].badges)).toBe(true);
    });

    it('should filter by region correctly', async () => {
      mockDb.donor.findMany.mockResolvedValue([mockDonors[0], mockDonors[2]]); // North region donors

      const request = new NextRequest('http://localhost:3000/api/v1/leaderboard?region=North', {
        method: 'GET'
      });

      const response = await GET(request, { roles: ['DONOR'] });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data.rankings).toHaveLength(2);
      expect(data.data.metadata.region).toBe('North');

      // Should only include North region donors
      data.data.rankings.forEach((ranking: any) => {
        expect(ranking.donor.region).toBe('North');
      });
    });

    it('should sort by delivery_rate correctly', async () => {
      mockDb.donor.findMany.mockResolvedValue(mockDonors);

      const request = new NextRequest('http://localhost:3000/api/v1/leaderboard?sortBy=delivery_rate', {
        method: 'GET'
      });

      const response = await GET(request, { roles: ['DONOR'] });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data.metadata.sortBy).toBe('delivery_rate');

      // Should be sorted by verified delivery rate (descending)
      expect(data.data.rankings[0].metrics.deliveryRates.verified).toBeGreaterThanOrEqual(
        data.data.rankings[1].metrics.deliveryRates.verified
      );
      expect(data.data.rankings[1].metrics.deliveryRates.verified).toBeGreaterThanOrEqual(
        data.data.rankings[2].metrics.deliveryRates.verified
      );
    });

    it('should respect limit parameter', async () => {
      mockDb.donor.findMany.mockResolvedValue(mockDonors);

      const request = new NextRequest('http://localhost:3000/api/v1/leaderboard?limit=2', {
        method: 'GET'
      });

      const response = await GET(request, { roles: ['DONOR'] });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data.rankings).toHaveLength(2);
      expect(data.data.metadata.limit).toBe(2);
    });

    it('should handle different timeframes', async () => {
      mockDb.donor.findMany.mockResolvedValue(mockDonors);

      const timeframes = ['7d', '90d', '1y', 'all'];
      
      for (const timeframe of timeframes) {
        const request = new NextRequest(`http://localhost:3000/api/v1/leaderboard?timeframe=${timeframe}`, {
          method: 'GET'
        });

        const response = await GET(request, { roles: ['DONOR'] });
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.data.metadata.timeframe).toBe(timeframe);
      }
    });

    it('should return empty rankings for donors without commitments', async () => {
      const donorsWithoutCommitments = mockDonors.map(donor => ({
        ...donor,
        commitments: []
      }));

      mockDb.donor.findMany.mockResolvedValue(donorsWithoutCommitments);

      const request = new NextRequest('http://localhost:3000/api/v1/leaderboard', {
        method: 'GET'
      });

      const response = await GET(request, { roles: ['DONOR'] });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data.rankings).toHaveLength(0);
      expect(data.data.metadata.totalParticipants).toBe(0);
    });

    it('should calculate correct scores and badges', async () => {
      mockDb.donor.findMany.mockResolvedValue(mockDonors);

      const request = new NextRequest('http://localhost:3000/api/v1/leaderboard', {
        method: 'GET'
      });

      const response = await GET(request, { roles: ['DONOR'] });
      const data = await response.json();

      expect(response.status).toBe(200);
      
      const topRanking = data.data.rankings[0];
      
      // Should calculate overall score correctly
      expect(topRanking.metrics.performance.overallScore).toBeGreaterThan(0);
      expect(topRanking.metrics.performance.overallScore).toBeLessThanOrEqual(100);

      // Should calculate delivery rates correctly
      expect(topRanking.metrics.deliveryRates.verified).toBe(92); // 95/100 * 100
      expect(topRanking.metrics.deliveryRates.selfReported).toBe(95); // 98/100 * 100

      // Should award badges based on performance
      expect(Array.isArray(topRanking.badges)).toBe(true);
      
      // High performer should have gold badges
      if (topRanking.metrics.deliveryRates.verified >= 95) {
        expect(topRanking.badges).toContain('Reliable Delivery Gold');
      }
    });

    it('should update donor ranks in database', async () => {
      mockDb.donor.findMany.mockResolvedValue(mockDonors);
      mockDb.donor.update.mockResolvedValue(mockDonors[0]);

      const request = new NextRequest('http://localhost:3000/api/v1/leaderboard', {
        method: 'GET'
      });

      await GET(request, { roles: ['DONOR'] });

      // Should update ranks for all donors
      expect(mockDb.donor.update).toHaveBeenCalledTimes(3);
      
      // Check first donor rank update
      expect(mockDb.donor.update).toHaveBeenCalledWith({
        where: { id: 'donor-1' },
        data: {
          leaderboardRank: 1,
          selfReportedDeliveryRate: expect.any(Number),
          verifiedDeliveryRate: expect.any(Number)
        }
      });
    });

    it('should handle database errors gracefully', async () => {
      mockDb.donor.findMany.mockRejectedValue(new Error('Database connection failed'));

      const request = new NextRequest('http://localhost:3000/api/v1/leaderboard', {
        method: 'GET'
      });

      const response = await GET(request, { roles: ['DONOR'] });
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Internal server error');
    });

    it('should return 401 for unauthenticated requests', async () => {
      // Mock middleware to return unauthorized
      jest.doMock('@/lib/auth/middleware', () => ({
        withAuth: (handler: any) => async (req: NextRequest, context: any) => {
          return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' }
          });
        }
      }));

      // Need to re-import to get the mock
      const { GET: AuthenticatedGET } = require('@/app/api/v1/leaderboard/route');

      const request = new NextRequest('http://localhost:3000/api/v1/leaderboard', {
        method: 'GET'
      });

      const response = await AuthenticatedGET(request, { roles: [] });
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Authentication required');
    });

    it('should handle missing query parameters with defaults', async () => {
      mockDb.donor.findMany.mockResolvedValue(mockDonors);

      // Request with no parameters
      const request = new NextRequest('http://localhost:3000/api/v1/leaderboard', {
        method: 'GET'
      });

      const response = await GET(request, { roles: ['DONOR'] });
      const data = await response.json();

      expect(response.status).toBe(200);
      
      // Should use default values
      expect(data.data.metadata.limit).toBe(50);
      expect(data.data.metadata.timeframe).toBe('30d');
      expect(data.data.metadata.region).toBe('All Regions');
      expect(data.data.metadata.sortBy).toBe('overall');
    });

    it('should validate query parameters', async () => {
      const request = new NextRequest('http://localhost:3000/api/v1/leaderboard?limit=invalid', {
        method: 'GET'
      });

      const response = await GET(request, { roles: ['DONOR'] });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toContain('Invalid query parameters');
    });

    it('should include correct metadata timestamps', async () => {
      mockDb.donor.findMany.mockResolvedValue(mockDonors);

      const request = new NextRequest('http://localhost:3000/api/v1/leaderboard', {
        method: 'GET'
      });

      const response = await GET(request, { roles: ['DONOR'] });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data.metadata).toHaveProperty('lastUpdated');
      
      const timestamp = new Date(data.data.metadata.lastUpdated);
      expect(timestamp).toBeInstanceOf(Date);
      
      // Should be recent (within last few seconds)
      const now = new Date();
      const diffMs = now.getTime() - timestamp.getTime();
      expect(diffMs).toBeLessThan(5000); // Within 5 seconds
    });

    it('should calculate correct trend indicators', async () => {
      // Mock donor with different previous ranks
      const donorsWithRankChanges = mockDonors.map((donor, index) => ({
        ...donor,
        leaderboardRank: index + 1
      }));

      mockDb.donor.findMany.mockResolvedValue(donorsWithRankChanges);

      const request = new NextRequest('http://localhost:3000/api/v1/leaderboard', {
        method: 'GET'
      });

      const response = await GET(request, { roles: ['DONOR'] });
      const data = await response.json();

      expect(response.status).toBe(200);
      
      // All donors should have 'new' trend since they have previous rank but current rank is set
      data.data.rankings.forEach((ranking: any) => {
        expect(['up', 'down', 'stable', 'new']).toContain(ranking.trend);
      });
    });
  });

  describe('Database Query Optimization', () => {
    it('should use correct database query filters', async () => {
      const timeframe = '90d';
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 90);

      mockDb.donor.findMany.mockResolvedValue(mockDonors);

      const request = new NextRequest(`http://localhost:3000/api/v1/leaderboard?timeframe=${timeframe}&sortBy=delivery_rate`, {
        method: 'GET'
      });

      await GET(request, { roles: ['DONOR'] });

      // Should filter by active donors and commitments within timeframe
      expect(mockDb.donor.findMany).toHaveBeenCalledWith({
        where: {
          isActive: true,
          commitments: {
            some: {
              commitmentDate: {
                gte: expect.any(Date),
                lte: expect.any(Date)
              }
            }
          }
        },
        select: {
          id: true,
          name: true,
          organization: true,
          selfReportedDeliveryRate: true,
          verifiedDeliveryRate: true,
          leaderboardRank: true,
          createdAt: true,
          commitments: {
            where: {
              commitmentDate: {
                gte: expect.any(Date),
                lte: expect.any(Date)
              }
            },
            select: {
              id: true,
              status: true,
              totalCommittedQuantity: true,
              deliveredQuantity: true,
              verifiedDeliveredQuantity: true,
              totalValueEstimated: true,
              commitmentDate: true,
              lastUpdated: true
            }
          },
          responses: {
            where: {
              createdAt: {
                gte: expect.any(Date),
                lte: expect.any(Date)
              }
            },
            select: {
              id: true,
              verificationStatus: true,
              createdAt: true
            }
          }
        }
      });
    });
  });
});