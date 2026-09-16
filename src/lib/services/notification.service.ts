import { prisma } from '@/lib/db/client';
import type { NotificationQueryInput } from '@/lib/validation/notification';
import type { NotificationItem } from '@/types/notification';
import type { SignalPriority } from '@/types/action-signal';

interface LegacyNotificationPayload {
  recipientId: string;
  type: 'achievement_unlocked' | 'ranking_change' | 'milestone_reached';
  title: string;
  message: string;
  /**
   * D-4: callers must state the notification's priority explicitly (no
   * silently applied default) — gamification writers pass
   * SYSTEM_HEALTH_SEVERITY.ACCOUNT_NOTICE.
   */
  priority: SignalPriority;
  data?: Record<string, unknown>;
}

interface LegacyInAppNotification {
  id: string;
  recipientId: string;
  type: string;
  title: string;
  message: string;
  data?: Record<string, unknown>;
  read: boolean;
  createdAt: Date;
}

class NotificationService {

  async send(payload: LegacyNotificationPayload): Promise<LegacyInAppNotification> {
    const notification = await prisma.notification.create({
      data: {
        userId: payload.recipientId,
        signalId: `legacy-${payload.type}-${Date.now()}`,
        title: payload.title,
        body: payload.message,
        priority: payload.priority,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });

    return {
      id: notification.id,
      recipientId: notification.userId,
      type: payload.type,
      title: notification.title,
      message: notification.body,
      data: payload.data,
      read: false,
      createdAt: notification.createdAt,
    };
  }

  async getForRecipient(
    recipientId: string,
    options?: { unreadOnly?: boolean; limit?: number }
  ): Promise<LegacyInAppNotification[]> {
    const notifications = await this.listNotifications(recipientId, {
      unreadOnly: options?.unreadOnly ?? false,
      includeExpired: false,
      page: 1,
      limit: options?.limit || 50,
    });

    return notifications.map(n => ({
      id: n.id,
      recipientId: n.userId,
      type: 'achievement_unlocked',
      title: n.title,
      message: n.body,
      read: n.readAt !== null,
      createdAt: n.createdAt,
    }));
  }

  async markRead(notificationId: string, recipientId: string): Promise<boolean> {
    try {
      await prisma.notification.update({
        where: { id: notificationId, userId: recipientId },
        data: { readAt: new Date() },
      });
      return true;
    } catch {
      return false;
    }
  }

  async markAllRead(recipientId: string): Promise<number> {
    const result = await prisma.notification.updateMany({
      where: { userId: recipientId, readAt: null },
      data: { readAt: new Date() },
    });
    return result.count;
  }

  async getUnreadCount(recipientId: string): Promise<number> {
    return prisma.notification.count({
      where: {
        userId: recipientId,
        readAt: null,
        dismissedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
  }

  async listNotifications(
    userId: string,
    query: NotificationQueryInput
  ): Promise<NotificationItem[]> {
    const where: Record<string, unknown> = {
      userId,
      dismissedAt: null,
    };

    if (query.unreadOnly) {
      where.readAt = null;
    }

    if (!query.includeExpired) {
      where.expiresAt = { gt: new Date() };
    }

    const notifications = await prisma.notification.findMany({
      where,
      include: {
        signal: {
          select: {
            id: true,
            entityId: true,
            incidentId: true,
            type: true,
            signalReason: true,
            priority: true,
            entity: {
              select: { id: true, name: true },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });

    return notifications.map(n => ({
      id: n.id,
      userId: n.userId,
      signalId: n.signalId,
      title: n.title,
      body: n.body,
      priority: n.priority,
      readAt: n.readAt,
      dismissedAt: n.dismissedAt,
      createdAt: n.createdAt,
      expiresAt: n.expiresAt,
      signal: n.signal
        ? {
            id: n.signal.id,
            entityId: n.signal.entityId,
            incidentId: n.signal.incidentId,
            type: n.signal.type,
            signalReason: n.signal.signalReason,
            priority: n.signal.priority,
            entity: n.signal.entity,
          }
        : null,
    }));
  }

  async markNotificationRead(notificationId: string, userId: string): Promise<boolean> {
    try {
      await prisma.notification.update({
        where: { id: notificationId, userId },
        data: { readAt: new Date() },
      });
      return true;
    } catch {
      return false;
    }
  }

  async dismissNotification(notificationId: string, userId: string): Promise<boolean> {
    try {
      await prisma.notification.update({
        where: { id: notificationId, userId },
        data: { dismissedAt: new Date() },
      });
      return true;
    } catch {
      return false;
    }
  }
}

export const notificationService = new NotificationService();
