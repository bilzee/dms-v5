import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { 
  calculateDonorMetrics, 
  calculateAchievementBadges, 
  BADGE_THRESHOLDS 
} from '@/lib/services/gamification.service';
import type { BadgeType } from '@/types/gamification';

// Mock the database client
jest.mock('@/lib/db/client', () => ({
  db: {
    donor: {
      findUnique: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn()
    },
    donorCommitment: {
      count: jest.fn()
    }
  }
}));

describe('Gamification Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('calculateDonorMetrics', () => {
    const mockTimeframe = {
      start: new Date('2024-01-01'),
      end: new Date('2024-12-31')
    };

    it('should calculate correct metrics for a donor with commitments', async () => {
      // Mock database response
      const mockDonor = {
        id: 'test-donor-1',
        name: 'Test Organization',
        createdAt: new Date('2024-01-01'),
        commitments: [
          {
            id: 'c1',
            status: 'COMPLETE',
            totalCommittedQuantity: 100,
            deliveredQuantity: 90,
            verifiedDeliveredQuantity: 85,
            totalValueEstimated: 5000,
            commitmentDate: new Date('2024-06-01'),
            lastUpdated: new Date('2024-06-15')
          },
          {
            id: 'c2', 
            status: 'PLANNED',
            totalCommittedQuantity: 50,
            deliveredQuantity: 0,
            verifiedDeliveredQuantity: 0,
            totalValueEstimated: 2500,
            commitmentDate: new Date('2024-07-01'),
            lastUpdated: new Date('2024-07-01')
          }
        ],
        responses: [
          {
            id: 'r1',
            verificationStatus: 'VERIFIED',
            createdAt: new Date('2024-06-20')
          },
          {
            id: 'r2',
            verificationStatus: 'SUBMITTED',
            createdAt: new Date('2024-07-10')
          }
        ]
      };

      const { db } = require('@/lib/db/client');
      db.donor.findUnique.mockResolvedValue(mockDonor);

      const result = await calculateDonorMetrics('test-donor-1', mockTimeframe);

      // Verify calculated metrics
      expect(result).toMatchObject({
        donorId: 'test-donor-1',
        totalCommitments: 2,
        completedCommitments: 1,
        totalCommittedItems: 150,
        totalDeliveredItems: 90,
        totalVerifiedItems: 85,
        totalCommitmentValue: 7500
      });

      // Verify delivery rate calculations
      expect(result.selfReportedDeliveryRate).toBe(60); // 90/150 * 100
      expect(result.verifiedDeliveryRate).toBe(56.67); // 85/150 * 100

      // Verify response metrics
      expect(result.responseVerificationRate).toBe(50); // 1/2 * 100
    });

    it('should handle donor with no commitments', async () => {
      const mockDonor = {
        id: 'test-donor-2',
        name: 'New Organization',
        createdAt: new Date('2024-01-01'),
        commitments: [],
        responses: []
      };

      const { db } = require('@/lib/db/client');
      db.donor.findUnique.mockResolvedValue(mockDonor);

      const result = await calculateDonorMetrics('test-donor-2', mockTimeframe);

      expect(result).toMatchObject({
        donorId: 'test-donor-2',
        totalCommitments: 0,
        completedCommitments: 0,
        totalCommittedItems: 0,
        selfReportedDeliveryRate: 0,
        verifiedDeliveryRate: 0,
        responseVerificationRate: 0,
        overallScore: 0
      });
    });

    it('should throw error for non-existent donor', async () => {
      const { db } = require('@/lib/db/client');
      db.donor.findUnique.mockResolvedValue(null);

      await expect(calculateDonorMetrics('non-existent', mockTimeframe))
        .rejects.toThrow('Donor not found: non-existent');
    });

    it('should calculate overall score correctly', async () => {
      const mockDonor = {
        id: 'test-donor-3',
        name: 'High Performer',
        createdAt: new Date('2024-01-01'),
        commitments: [
          {
            id: 'c1',
            status: 'COMPLETE',
            totalCommittedQuantity: 100,
            deliveredQuantity: 98,
            verifiedDeliveredQuantity: 95,
            totalValueEstimated: 20000, // High value
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
        ]
      };

      const { db } = require('@/lib/db/client');
      db.donor.findUnique.mockResolvedValue(mockDonor);

      const result = await calculateDonorMetrics('test-donor-3', mockTimeframe);

      // With 95% delivery rate, high value, and consistency
      expect(result.verifiedDeliveryRate).toBe(95);
      expect(result.totalCommitmentValue).toBe(20000);
      expect(result.overallScore).toBeGreaterThan(80); // Should be high scoring
    });
  });

  describe('calculateAchievementBadges', () => {
    it('should award gold delivery badge for 95%+ delivery rate', () => {
      const metrics = {
        verifiedDeliveryRate: 96,
        completedCommitments: 10,
        avgResponseTimeHours: 12,
        monthsActive: 6
      };

      const badges = calculateAchievementBadges(metrics);

      expect(badges).toContain('Reliable Delivery Gold');
      expect(badges).toContain('High Volume Bronze');
      expect(badges).toContain('Quick Response Silver');
      expect(badges).toContain('Consistency Silver');
    });

    it('should award no badges for low performance', () => {
      const metrics = {
        verifiedDeliveryRate: 50,
        completedCommitments: 5,
        avgResponseTimeHours: 48,
        monthsActive: 2
      };

      const badges = calculateAchievementBadges(metrics);

      expect(badges).toHaveLength(0);
    });

    it('should award all bronze badges for minimum thresholds', () => {
      const metrics = {
        verifiedDeliveryRate: 71,
        completedCommitments: 12,
        avgResponseTimeHours: 22,
        monthsActive: 4
      };

      const badges = calculateAchievementBadges(metrics);

      expect(badges).toContain('Reliable Delivery Bronze');
      expect(badges).toContain('High Volume Bronze');
      expect(badges).toContain('Quick Response Bronze');
      expect(badges).toContain('Consistency Bronze');
    });

    it('should handle edge case of exact threshold values', () => {
      const metrics = {
        verifiedDeliveryRate: 70, // Exactly bronze threshold
        completedCommitments: 10, // Exactly bronze threshold
        avgResponseTimeHours: 24, // Exactly bronze threshold
        monthsActive: 3 // Exactly bronze threshold
      };

      const badges = calculateAchievementBadges(metrics);

      expect(badges).toContain('Reliable Delivery Bronze');
      expect(badges).toContain('High Volume Bronze');
      expect(badges).toContain('Quick Response Bronze');
      expect(badges).toContain('Consistency Bronze');
    });

    it('should not duplicate badges', () => {
      const metrics = {
        verifiedDeliveryRate: 99,
        completedCommitments: 100,
        avgResponseTimeHours: 4,
        monthsActive: 24
      };

      const badges = calculateAchievementBadges(metrics);

      // Should contain each badge only once
      const uniqueBadges = [...new Set(badges)];
      expect(badges).toEqual(uniqueBadges);
      
      // Should contain gold level badges
      expect(badges).toContain('Reliable Delivery Gold');
      expect(badges).toContain('High Volume Gold');
      expect(badges).toContain('Quick Response Gold');
      expect(badges).toContain('Consistency Gold');
    });
  });

  describe('Badge Thresholds', () => {
    it('should have correct threshold values', () => {
      expect(BADGE_THRESHOLDS.DELIVERY_RATE.BRONZE).toBe(70);
      expect(BADGE_THRESHOLDS.DELIVERY_RATE.SILVER).toBe(85);
      expect(BADGE_THRESHOLDS.DELIVERY_RATE.GOLD).toBe(95);

      expect(BADGE_THRESHOLDS.VOLUME.BRONZE).toBe(10);
      expect(BADGE_THRESHOLDS.VOLUME.SILVER).toBe(25);
      expect(BADGE_THRESHOLDS.VOLUME.GOLD).toBe(50);

      expect(BADGE_THRESHOLDS.RESPONSE_TIME.BRONZE).toBe(24);
      expect(BADGE_THRESHOLDS.RESPONSE_TIME.SILVER).toBe(12);
      expect(BADGE_THRESHOLDS.RESPONSE_TIME.GOLD).toBe(6);

      expect(BADGE_THRESHOLDS.CONSISTENCY.BRONZE).toBe(3);
      expect(BADGE_THRESHOLDS.CONSISTENCY.SILVER).toBe(6);
      expect(BADGE_THRESHOLDS.CONSISTENCY.GOLD).toBe(12);
    });
  });
});