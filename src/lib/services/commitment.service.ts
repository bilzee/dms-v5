import { prisma } from '@/lib/db/client';

export interface CommitmentItem {
  name: string;
  unit: string;
  quantity: number;
  deliveredQuantity: number;
  estimatedValue?: number;
}

export interface CreateCommitmentData {
  donorId: string;
  entityId: string;
  incidentId: string;
  items: CommitmentItem[];
  totalCommittedQuantity: number;
  notes?: string;
}

export interface CommitmentUsageData {
  commitmentId: string;
  items: CommitmentItem[];
  totalQuantity: number;
}

export class CommitmentService {
  /**
   * Get available commitments for a responder based on entity assignments
   */
  async getAvailableCommitmentsForResponder(
    userId: string,
    filters?: {
      entityId?: string;
      incidentId?: string;
      status?: string;
    }
  ) {
    // Get assigned entities for the responder
    const assignedEntities = await prisma.entityAssignment.findMany({
      where: {
        userId,
        user: {
          roles: {
            some: {
              role: {
                name: 'RESPONDER'
              }
            }
          }
        }
      },
      select: {
        entityId: true
      }
    });

    if (assignedEntities.length === 0) {
      return [];
    }

    const assignedEntityIds = assignedEntities.map(e => e.entityId);

    // Build where clause
    const whereClause: any = {
      status: filters?.status || 'PLANNED',
      entityId: { in: assignedEntityIds },
      donor: { isActive: true },
      entity: { isActive: true },
      totalCommittedQuantity: {
        gt: prisma.donorCommitment.fields.deliveredQuantity
      }
    };

    if (filters?.entityId) {
      whereClause.entityId = filters.entityId;
    }

    if (filters?.incidentId) {
      whereClause.incidentId = filters.incidentId;
    }

    return await prisma.donorCommitment.findMany({
      where: whereClause,
      include: {
        donor: {
          select: {
            id: true,
            name: true,
            type: true,
            organization: true,
            contactEmail: true,
            contactPhone: true
          }
        },
        entity: {
          select: {
            id: true,
            name: true,
            type: true,
            location: true
          }
        },
        incident: {
          select: {
            id: true,
            type: true,
            subType: true,
            severity: true,
            status: true,
            description: true,
            location: true
          }
        }
      },
      orderBy: {
        commitmentDate: 'desc'
      }
    });
  }

  /**
   * Process commitment usage and update quantities
   */
  async processCommitmentUsage(usageData: CommitmentUsageData, userId: string) {
    const commitment = await prisma.donorCommitment.findUnique({
      where: { id: usageData.commitmentId },
      include: { donor: true, entity: true, incident: true }
    });

    if (!commitment) {
      throw new Error('Commitment not found');
    }

    if (commitment.status !== 'PLANNED' && commitment.status !== 'PARTIAL') {
      throw new Error('Commitment is not available for use');
    }

    // Calculate quantities
    const totalRequestedQuantity = usageData.items.reduce((sum, item) => sum + item.quantity, 0);
    const availableQuantity = commitment.totalCommittedQuantity - commitment.deliveredQuantity;

    if (totalRequestedQuantity > availableQuantity) {
      throw new Error(`Requested quantity (${totalRequestedQuantity}) exceeds available (${availableQuantity})`);
    }

    // Update commitment
    const newDeliveredQuantity = commitment.deliveredQuantity + totalRequestedQuantity;
    const newVerifiedDeliveredQuantity = commitment.verifiedDeliveredQuantity + totalRequestedQuantity;
    
    let newStatus: any = commitment.status;
    if (newDeliveredQuantity >= commitment.totalCommittedQuantity) {
      newStatus = 'COMPLETE';
    } else if (newDeliveredQuantity > 0) {
      newStatus = 'PARTIAL';
    }

    return await prisma.donorCommitment.update({
      where: { id: usageData.commitmentId },
      data: {
        deliveredQuantity: newDeliveredQuantity,
        verifiedDeliveredQuantity: newVerifiedDeliveredQuantity,
        status: newStatus,
        lastUpdated: new Date()
      },
      include: {
        donor: true,
        entity: true,
        incident: true
      }
    });
  }

  /**
   * P10-4 (5a) — resolves the USER linked to a donor org. The Donor model has
   * NO userId FK; the app's only donor→user linkage is the `users/me/donor`
   * heuristic (contactEmail → organization → name → username), reused here in
   * reverse. Returns null when no user matches (donor branch is skipped).
   */
  // P10-4 review (G3b) — this picks a PUSH recipient, so a heuristic match
  // must be unambiguous: email matches case-insensitively, and the free-text
  // organization/name/username fallbacks resolve only when EXACTLY ONE user
  // matches (an ambiguous match skips the donor branch instead of notifying
  // an arbitrary user).
  private async resolveDonorLinkedUserId(donor: {
    id: string;
    contactEmail?: string | null;
    organization?: string | null;
    name?: string | null;
  }): Promise<string | null> {
    if (donor.contactEmail) {
      const byEmail = await prisma.user.findFirst({
        where: { email: { equals: donor.contactEmail, mode: 'insensitive' } },
        select: { id: true }
      });
      if (byEmail) return byEmail.id;
    }
    if (donor.organization) {
      const byOrganization = await prisma.user.findMany({
        where: { organization: { equals: donor.organization, mode: 'insensitive' } },
        select: { id: true }
      });
      if (byOrganization.length === 1) return byOrganization[0].id;
    }
    if (donor.name) {
      const byName = await prisma.user.findMany({
        where: { name: { equals: donor.name, mode: 'insensitive' } },
        select: { id: true }
      });
      if (byName.length === 1) return byName[0].id;
      const byUsername = await prisma.user.findMany({
        where: { username: donor.name },
        select: { id: true }
      });
      if (byUsername.length === 1) return byUsername[0].id;
    }
    return null;
  }

  /**
   * Create a new commitment
   */
  async createCommitment(data: CreateCommitmentData, userId: string) {
    // Validate donor and entity exist
    const [donor, entity, incident] = await Promise.all([
      prisma.donor.findUnique({ where: { id: data.donorId, isActive: true } }),
      prisma.entity.findUnique({ where: { id: data.entityId, isActive: true } }),
      prisma.incident.findUnique({ where: { id: data.incidentId } })
    ]);

    if (!donor) throw new Error('Donor not found or inactive');
    if (!entity) throw new Error('Entity not found or inactive');
    if (!incident) throw new Error('Incident not found');

    const commitment = await prisma.donorCommitment.create({
      data: {
        donorId: data.donorId,
        entityId: data.entityId,
        incidentId: data.incidentId,
        items: data.items as any,
        totalCommittedQuantity: data.totalCommittedQuantity,
        notes: data.notes,
        status: 'PLANNED'
      },
      include: {
        donor: true,
        entity: true,
        incident: true
      }
    });

    // P10-4 (5a) — the signal engine's donor branch expects a recipient USER
    // id; `data.donorId` is a Donor ORG id whose FK failure killed the later
    // responder rows. Resolve the linked user (users/me/donor heuristic in
    // reverse) or skip the donor branch with a log when unlinked. Review
    // (G3a): the resolution lives INSIDE the isolation guard — a lookup
    // failure must degrade to a skipped donor branch, never reject the
    // request after the commitment row has already been persisted.
    let donorUserId: string | null = null;
    try {
      donorUserId = await this.resolveDonorLinkedUserId(donor);
      if (!donorUserId) {
        console.warn(
          `[CommitmentService] donor ${data.donorId} has no linked user — skipping donor-branch signal for commitment ${commitment.id}`
        );
      }
      const { ActionSignalService } = await import('@/lib/services/action-signal.service');
      await ActionSignalService.evaluateAndGenerate({
        trigger: 'commitment-created',
        entityId: data.entityId,
        incidentId: data.incidentId,
        commitmentId: commitment.id,
        ...(donorUserId ? { donorId: donorUserId } : {}),
      });
    } catch (e) {
      console.error('[CommitmentService] signal hook error:', e);
    }

    return commitment;
  }

  /**
   * Get commitment statistics
   */
  async getCommitmentStats(filters?: {
    donorId?: string;
    entityId?: string;
    incidentId?: string;
  }) {
    const whereClause: any = {};

    if (filters?.donorId) whereClause.donorId = filters.donorId;
    if (filters?.entityId) whereClause.entityId = filters.entityId;
    if (filters?.incidentId) whereClause.incidentId = filters.incidentId;

    const [total, planned, partial, complete] = await Promise.all([
      prisma.donorCommitment.count({ where: whereClause }),
      prisma.donorCommitment.count({ where: { ...whereClause, status: 'PLANNED' } }),
      prisma.donorCommitment.count({ where: { ...whereClause, status: 'PARTIAL' } }),
      prisma.donorCommitment.count({ where: { ...whereClause, status: 'COMPLETE' } })
    ]);

    const quantityStats = await prisma.donorCommitment.aggregate({
      where: whereClause,
      _sum: {
        totalCommittedQuantity: true,
        deliveredQuantity: true,
        verifiedDeliveredQuantity: true
      }
    });

    const totalCommitted = quantityStats._sum.totalCommittedQuantity || 0;
    const totalDelivered = quantityStats._sum.deliveredQuantity || 0;

    return {
      totalCommitments: total,
      statusBreakdown: { planned, partial, complete },
      quantities: {
        totalCommitted,
        totalDelivered,
        totalVerified: quantityStats._sum.verifiedDeliveredQuantity || 0,
        utilizationRate: totalCommitted > 0 
          ? (totalDelivered / totalCommitted) * 100 
          : 0
      }
    };
  }
}