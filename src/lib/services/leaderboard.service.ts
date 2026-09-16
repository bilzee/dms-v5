import { db } from '@/lib/db/client';
import { notificationService } from './notification.service';
import { SYSTEM_HEALTH_SEVERITY } from '@/lib/severity-inheritance';
import { 
  calculateDonorMetrics,
  calculateAchievementBadges,
  calculateLeaderboardRankings,
  updateDonorRankings
} from './gamification.service';
import { 
  BadgeType, 
  Achievement,
  BADGE_THRESHOLDS,
  RANKING_WEIGHTS
} from '@/lib/validation/gamification';

export interface RankingCalculation {
  donorId: string;
  rank: number;
  previousRank?: number;
  overallScore: number;
  regionalRank?: number;
  trend: 'up' | 'down' | 'stable';
}

export interface GamificationRule {
  id: string;
  name: string;
  description: string;
  type: 'badge_earning' | 'ranking_update' | 'notification_trigger';
  condition: (metrics: any) => boolean;
  action: (donorId: string, metrics: any) => Promise<void>;
  priority: number;
  isActive: boolean;
}

export interface NotificationConfig {
  type: 'achievement_unlocked' | 'ranking_change' | 'milestone_reached';
  recipient: 'donor' | 'coordinator' | 'admin';
  message: string;
  channels: ('in_app' | 'email' | 'sms')[];
  data?: any;
}

class LeaderboardService {
  private rules: GamificationRule[] = [];
  private cache: Map<string, any> = new Map();
  private cacheTimeout: number = 15 * 60 * 1000; // 15 minutes

  constructor() {
    this.initializeRules();
  }

  /**
   * Initialize gamification rules engine
   */
  private initializeRules(): void {
    // Badge earning rules
    this.rules.push(
      {
        id: 'delivery_rate_bronze',
        name: 'Bronze Delivery Badge',
        description: 'Award Bronze Reliable Delivery badge at 70% verified delivery rate',
        type: 'badge_earning',
        condition: (metrics) => metrics.verifiedDeliveryRate >= BADGE_THRESHOLDS.DELIVERY_RATE.BRONZE,
        action: async (donorId, metrics) => {
          await this.awardBadge(donorId, 'Reliable Delivery Bronze', metrics);
        },
        priority: 1,
        isActive: true
      },
      {
        id: 'delivery_rate_silver',
        name: 'Silver Delivery Badge',
        description: 'Award Silver Reliable Delivery badge at 85% verified delivery rate',
        type: 'badge_earning',
        condition: (metrics) => metrics.verifiedDeliveryRate >= BADGE_THRESHOLDS.DELIVERY_RATE.SILVER,
        action: async (donorId, metrics) => {
          await this.awardBadge(donorId, 'Reliable Delivery Silver', metrics);
        },
        priority: 2,
        isActive: true
      },
      {
        id: 'delivery_rate_gold',
        name: 'Gold Delivery Badge',
        description: 'Award Gold Reliable Delivery badge at 95% verified delivery rate',
        type: 'badge_earning',
        condition: (metrics) => metrics.verifiedDeliveryRate >= BADGE_THRESHOLDS.DELIVERY_RATE.GOLD,
        action: async (donorId, metrics) => {
          await this.awardBadge(donorId, 'Reliable Delivery Gold', metrics);
        },
        priority: 3,
        isActive: true
      },
      {
        id: 'volume_bronze',
        name: 'Bronze Volume Badge',
        description: 'Award Bronze High Volume badge at 10+ completed commitments',
        type: 'badge_earning',
        condition: (metrics) => metrics.completedCommitments >= BADGE_THRESHOLDS.VOLUME.BRONZE,
        action: async (donorId, metrics) => {
          await this.awardBadge(donorId, 'High Volume Bronze', metrics);
        },
        priority: 4,
        isActive: true
      },
      {
        id: 'volume_silver',
        name: 'Silver Volume Badge',
        description: 'Award Silver High Volume badge at 25+ completed commitments',
        type: 'badge_earning',
        condition: (metrics) => metrics.completedCommitments >= BADGE_THRESHOLDS.VOLUME.SILVER,
        action: async (donorId, metrics) => {
          await this.awardBadge(donorId, 'High Volume Silver', metrics);
        },
        priority: 5,
        isActive: true
      },
      {
        id: 'volume_gold',
        name: 'Gold Volume Badge',
        description: 'Award Gold High Volume badge at 50+ completed commitments',
        type: 'badge_earning',
        condition: (metrics) => metrics.completedCommitments >= BADGE_THRESHOLDS.VOLUME.GOLD,
        action: async (donorId, metrics) => {
          await this.awardBadge(donorId, 'High Volume Gold', metrics);
        },
        priority: 6,
        isActive: true
      },
      {
        id: 'response_speed_bronze',
        name: 'Bronze Speed Badge',
        description: 'Award Bronze Quick Response badge for <24h average response time',
        type: 'badge_earning',
        condition: (metrics) => metrics.avgResponseTimeHours <= BADGE_THRESHOLDS.RESPONSE_TIME.BRONZE,
        action: async (donorId, metrics) => {
          await this.awardBadge(donorId, 'Quick Response Bronze', metrics);
        },
        priority: 7,
        isActive: true
      },
      {
        id: 'response_speed_silver',
        name: 'Silver Speed Badge',
        description: 'Award Silver Quick Response badge for <12h average response time',
        type: 'badge_earning',
        condition: (metrics) => metrics.avgResponseTimeHours <= BADGE_THRESHOLDS.RESPONSE_TIME.SILVER,
        action: async (donorId, metrics) => {
          await this.awardBadge(donorId, 'Quick Response Silver', metrics);
        },
        priority: 8,
        isActive: true
      },
      {
        id: 'response_speed_gold',
        name: 'Gold Speed Badge',
        description: 'Award Gold Quick Response badge for <6h average response time',
        type: 'badge_earning',
        condition: (metrics) => metrics.avgResponseTimeHours <= BADGE_THRESHOLDS.RESPONSE_TIME.GOLD,
        action: async (donorId, metrics) => {
          await this.awardBadge(donorId, 'Quick Response Gold', metrics);
        },
        priority: 9,
        isActive: true
      }
    );

    // Ranking update rules
    this.rules.push(
      {
        id: 'update_leaderboard_rankings',
        name: 'Update Leaderboard Rankings',
        description: 'Recalculate and update leaderboard rankings',
        type: 'ranking_update',
        condition: () => true, // Always run for all donors
        action: async (donorId, metrics) => {
          await this.updateRankings(donorId, metrics);
        },
        priority: 100,
        isActive: true
      }
    );

    // Notification rules
    this.rules.push(
      {
        id: 'ranking_change_notification',
        name: 'Ranking Change Notification',
        description: 'Notify donor of significant ranking changes',
        type: 'notification_trigger',
        condition: (metrics) => Math.abs(metrics.rankChange || 0) >= 5,
        action: async (donorId, metrics) => {
          await this.sendRankingChangeNotification(donorId, metrics);
        },
        priority: 50,
        isActive: true
      }
    );
  }

  /**
   * Process gamification rules for a donor
   */
  async processDonorGamification(
    donorId: string, 
    timeframe: { start: Date; end: Date },
    forceRefresh = false
  ): Promise<{
    newBadges: BadgeType[];
    rankingUpdate: RankingCalculation;
    notifications: NotificationConfig[];
  }> {
    const cacheKey = `donor-gamification-${donorId}-${timeframe.start.getTime()}`;
    
    // Check cache first
    if (!forceRefresh && this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      if (Date.now() - cached.timestamp < this.cacheTimeout) {
        return cached.data;
      }
    }

    try {
      // Calculate current metrics
      const metrics = await calculateDonorMetrics(donorId, timeframe);
      
      const newBadges: BadgeType[] = [];
      const notifications: NotificationConfig[] = [];
      let rankingUpdate: RankingCalculation | null = null;

      // Process active rules
      for (const rule of this.rules.sort((a, b) => a.priority - b.priority)) {
        if (!rule.isActive) continue;

        try {
          if (rule.condition(metrics)) {
            await rule.action(donorId, metrics);

            // Collect results for response
            if (rule.type === 'badge_earning' && rule.name.includes('Badge')) {
              const badgeName = rule.name.replace('Badge', '').trim();
              if (rule.name.includes('Bronze')) newBadges.push(`${badgeName} Bronze` as BadgeType);
              if (rule.name.includes('Silver')) newBadges.push(`${badgeName} Silver` as BadgeType);
              if (rule.name.includes('Gold')) newBadges.push(`${badgeName} Gold` as BadgeType);
            }

            if (rule.type === 'ranking_update') {
              rankingUpdate = await this.calculateRankingUpdate(donorId, metrics);
            }

            // Generate notifications
            if (rule.type === 'notification_trigger') {
              const notification = await this.generateNotification(rule.id, donorId, metrics);
              if (notification) notifications.push(notification);
            }
          }
        } catch (error) {
          console.error(`Error processing rule ${rule.id} for donor ${donorId}:`, error);
        }
      }

      const result = {
        newBadges: [...new Set(newBadges)], // Remove duplicates
        rankingUpdate: rankingUpdate!,
        notifications
      };

      // Cache result
      this.cache.set(cacheKey, {
        data: result,
        timestamp: Date.now()
      });

      return result;

    } catch (error) {
      console.error(`Error processing gamification for donor ${donorId}:`, error);
      throw error;
    }
  }

  /**
   * Process gamification for all donors (scheduled task)
   */
  async processAllDonorsGamification(timeframe: { start: Date; end: Date }): Promise<{
    processed: number;
    errors: Array<{ donorId: string; error: string }>;
    totalBadgesAwarded: number;
    rankingsUpdated: boolean;
  }> {
    try {
      // Get all active donors
      const donors = await db.donor.findMany({
        where: { isActive: true },
        select: { id: true }
      });

      let processed = 0;
      const errors: Array<{ donorId: string; error: string }> = [];
      let totalBadgesAwarded = 0;

      // Process in batches to avoid overwhelming the system
      const batchSize = 10;
      for (let i = 0; i < donors.length; i += batchSize) {
        const batch = donors.slice(i, i + batchSize);
        
        await Promise.allSettled(
          batch.map(async (donor) => {
            try {
              const result = await this.processDonorGamification(donor.id, timeframe);
              processed++;
              totalBadgesAwarded += result.newBadges.length;
            } catch (error) {
              errors.push({
                donorId: donor.id,
                error: error instanceof Error ? error.message : 'Unknown error'
              });
            }
          })
        );
      }

      // Global ranking update after processing all donors
      await this.updateGlobalRankings(timeframe);

      return {
        processed,
        errors,
        totalBadgesAwarded,
        rankingsUpdated: true
      };

    } catch (error) {
      console.error('Error processing all donors gamification:', error);
      throw error;
    }
  }

  /**
   * Award a badge to a donor
   */
  private async awardBadge(
    donorId: string, 
    badgeType: BadgeType, 
    metrics: any
  ): Promise<void> {
    const donor = await db.donor.findUnique({
      where: { id: donorId },
      select: { achievementBadges: true }
    });

    const existingBadges: string[] = Array.isArray(donor?.achievementBadges) 
      ? donor.achievementBadges as string[] 
      : [];

    if (existingBadges.includes(badgeType)) return;

    const updatedBadges = [...new Set([...existingBadges, badgeType])];

    await db.donor.update({
      where: { id: donorId },
      data: { achievementBadges: updatedBadges }
    });

    await this.sendAchievementNotification(donorId, badgeType, metrics);
  }

  /**
   * Update rankings for a donor
   */
  private async updateRankings(donorId: string, metrics: any): Promise<void> {
    const currentDonor = await db.donor.findUnique({
      where: { id: donorId },
      select: { leaderboardRank: true }
    });

    await db.donor.update({
      where: { id: donorId },
      data: {
        verifiedDeliveryRate: metrics.verifiedDeliveryRate,
        selfReportedDeliveryRate: metrics.selfReportedDeliveryRate
      }
    });
  }

  /**
   * Calculate ranking update
   */
  private async calculateRankingUpdate(donorId: string, metrics: any): Promise<RankingCalculation> {
    const currentDonor = await db.donor.findUnique({
      where: { id: donorId },
      select: { leaderboardRank: true }
    });

    const previousRank = currentDonor?.leaderboardRank;
    const currentRank = previousRank ?? 0;

    let trend: 'up' | 'down' | 'stable' = 'stable';
    if (previousRank && currentRank < previousRank) trend = 'up';
    else if (previousRank && currentRank > previousRank) trend = 'down';

    return {
      donorId,
      rank: currentRank,
      previousRank: previousRank || undefined,
      overallScore: metrics.overallScore,
      trend
    };
  }

  /**
   * Update global rankings
   */
  private async updateGlobalRankings(timeframe: { start: Date; end: Date }): Promise<void> {
    const rankings = await calculateLeaderboardRankings(timeframe);
    await updateDonorRankings(rankings.map(r => ({ donorId: r.donorId, rank: r.rank, score: r.score })));
  }

  /**
   * Send achievement notification
   */
  private async sendAchievementNotification(
    donorId: string,
    badgeType: BadgeType,
    metrics: any
  ): Promise<void> {
    await notificationService.send({
      recipientId: donorId,
      type: 'achievement_unlocked',
      title: 'New Achievement Unlocked!',
      message: `You earned the "${badgeType}" badge. Keep up the great work!`,
      priority: SYSTEM_HEALTH_SEVERITY.ACCOUNT_NOTICE,
      data: { badgeType, metrics }
    });
  }

  /**
   * Send ranking change notification
   */
  private async sendRankingChangeNotification(donorId: string, metrics: any): Promise<void> {
    const direction = metrics.rankChange > 0 ? 'improved' : 'changed';
    await notificationService.send({
      recipientId: donorId,
      type: 'ranking_change',
      title: 'Leaderboard Ranking Updated',
      message: `Your ranking has ${direction}! You're now rank #${metrics.currentRank || metrics.overallScore}.`,
      priority: SYSTEM_HEALTH_SEVERITY.ACCOUNT_NOTICE,
      data: { rankChange: metrics.rankChange, currentRank: metrics.currentRank }
    });
  }

  /**
   * Generate notification configuration
   */
  private async generateNotification(
    ruleId: string,
    donorId: string,
    metrics: any
  ): Promise<NotificationConfig | null> {
    switch (ruleId) {
      case 'ranking_change_notification':
        return {
          type: 'ranking_change',
          recipient: 'donor',
          message: `Your ranking has ${metrics.rankChange > 0 ? 'improved' : 'changed'}! You're now rank #${metrics.currentRank}.`,
          channels: ['in_app'],
          data: { donorId, rankChange: metrics.rankChange, currentRank: metrics.currentRank }
        };
      default:
        return null;
    }
  }

  /**
   * Clear cache for a donor
   */
  clearCache(donorId: string): void {
    const keysToDelete = Array.from(this.cache.keys()).filter(key => key.includes(donorId));
    keysToDelete.forEach(key => this.cache.delete(key));
  }

  /**
   * Clear all cache
   */
  clearAllCache(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    size: number;
    oldestEntry: Date | null;
    newestEntry: Date | null;
  } {
    if (this.cache.size === 0) {
      return { size: 0, oldestEntry: null, newestEntry: null };
    }

    const entries = Array.from(this.cache.values());
    const timestamps = entries.map(entry => new Date(entry.timestamp));
    
    return {
      size: this.cache.size,
      oldestEntry: new Date(Math.min(...timestamps.map(t => t.getTime()))),
      newestEntry: new Date(Math.max(...timestamps.map(t => t.getTime())))
    };
  }

  /**
   * Add custom rule
   */
  addRule(rule: GamificationRule): void {
    this.rules.push(rule);
    this.rules.sort((a, b) => a.priority - b.priority);
  }

  /**
   * Remove rule
   */
  removeRule(ruleId: string): void {
    this.rules = this.rules.filter(rule => rule.id !== ruleId);
  }

  /**
   * Toggle rule
   */
  toggleRule(ruleId: string, isActive: boolean): void {
    const rule = this.rules.find(r => r.id === ruleId);
    if (rule) {
      rule.isActive = isActive;
    }
  }

  /**
   * Get all rules
   */
  getRules(): GamificationRule[] {
    return [...this.rules];
  }
}

// Export singleton instance
export const leaderboardService = new LeaderboardService();