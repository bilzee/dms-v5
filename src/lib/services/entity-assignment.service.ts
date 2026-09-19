import { prisma } from '@/lib/db/client';

/** Targets of an assessment re-point (P10-4 4d). Either is optional. */
export interface AssignmentTargets {
  entityId?: string;
  incidentId?: string;
}

/**
 * P10-4 (4d) — shared re-point authorizer for assessment updates, used by BOTH
 * the online PUT path and the offline sync update branch. COORDINATOR/ADMIN
 * pass; any other user must hold an EntityAssignment row covering the target
 * entity. `Incident` has no entity relation in the schema, so `incidentId`
 * only triggers the check — the gate keys off `entityId` (callers pass the
 * effective target entity). Throws Error('Not authorized to …'); the online
 * route maps messages containing 'authorized' to 403, the offline branch
 * converts the throw into a per-entry conflict (never-reject).
 */
export async function assertAssignmentForTargets(
  userId: string,
  targets: AssignmentTargets
): Promise<void> {
  const { entityId, incidentId } = targets;
  if (!entityId && !incidentId) return;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { roles: { select: { role: { select: { name: true } } } } }
  });
  const roleNames = user?.roles.map((r) => r.role.name) ?? [];
  if (roleNames.includes('COORDINATOR') || roleNames.includes('ADMIN')) return;

  if (entityId) {
    const assignment = await prisma.entityAssignment.findFirst({
      where: { userId, entityId }
    });
    if (!assignment) {
      throw new Error(`Not authorized to update assessments for entity ${entityId}`);
    }
  }
}

export interface EntityAssignmentService {
  /**
   * Check if a user is assigned to a specific entity
   */
  isUserAssigned(userId: string, entityId: string): Promise<boolean>;

  /**
   * Get all entities assigned to a user
   */
  getUserAssignedEntities(userId: string): Promise<EntityAssignmentSummary[]>;

  /**
   * Get all users assigned to an entity
   */
  getEntityAssignedUsers(entityId: string): Promise<UserAssignmentSummary[]>;

  /**
   * Validate if user can create assessment for entity
   */
  canCreateAssessment(userId: string, entityId: string): Promise<boolean>;

  /**
   * Filter entities based on user assignments
   */
  filterEntitiesByAssignment(userId: string, entities: Entity[]): Promise<Entity[]>;
}

export interface EntityAssignmentSummary {
  id: string;
  name: string;
  type: string;
  location: string | null;
  assignedAt: Date;
  assignedBy: string;
}

export interface UserAssignmentSummary {
  id: string;
  email: string;
  name: string;
  roles: string[];
  assignedAt: Date;
  assignedBy: string;
}

export interface Entity {
  id: string;
  name: string;
  type: string;
  location: string | null;
  coordinates?: any;
  metadata?: any;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export class EntityAssignmentServiceImpl implements EntityAssignmentService {
  /**
   * Check if a user is assigned to a specific entity
   */
  async isUserAssigned(userId: string, entityId: string): Promise<boolean> {
    try {
      const assignment = await prisma.entityAssignment.findFirst({
        where: {
          userId,
          entityId,
          user: {
            roles: {
              some: {
                role: {
                  name: {
                    in: ['ASSESSOR', 'RESPONDER']
                  }
                }
              }
            }
          }
        }
      });

      return !!assignment;
    } catch (error) {
      console.error('Error checking user assignment:', error);
      return false;
    }
  }

  /**
   * Get all entities assigned to a user with assessor or responder role
   */
  async getUserAssignedEntities(userId: string): Promise<EntityAssignmentSummary[]> {
    try {
      const assignments = await prisma.entityAssignment.findMany({
        where: {
          userId,
          user: {
            roles: {
              some: {
                role: {
                  name: {
                    in: ['ASSESSOR', 'RESPONDER']
                  }
                }
              }
            }
          },
          entity: {
            isActive: true
          }
        },
        include: {
          entity: true
        },
        orderBy: {
          assignedAt: 'desc'
        }
      });

      return assignments.map(assignment => ({
        id: assignment.entity.id,
        name: assignment.entity.name,
        type: assignment.entity.type,
        location: assignment.entity.location,
        assignedAt: assignment.assignedAt,
        assignedBy: assignment.assignedBy
      }));
    } catch (error) {
      console.error('Error getting user assigned entities:', error);
      return [];
    }
  }

  /**
   * Get all users assigned to an entity
   */
  async getEntityAssignedUsers(entityId: string): Promise<UserAssignmentSummary[]> {
    try {
      const assignments = await prisma.entityAssignment.findMany({
        where: {
          entityId,
          user: {
            isActive: true
          }
        },
        include: {
          user: {
            include: {
              roles: {
                include: {
                  role: true
                }
              }
            }
          }
        },
        orderBy: {
          assignedAt: 'desc'
        }
      });

      return assignments.map(assignment => ({
        id: assignment.user.id,
        email: assignment.user.email,
        name: assignment.user.name,
        roles: assignment.user.roles.map(r => r.role.name),
        assignedAt: assignment.assignedAt,
        assignedBy: assignment.assignedBy
      }));
    } catch (error) {
      console.error('Error getting entity assigned users:', error);
      return [];
    }
  }

  /**
   * Validate if user can create assessment for entity
   * User must be assigned to entity and have assessor role (NOT responder)
   */
  async canCreateAssessment(userId: string, entityId: string): Promise<boolean> {
    try {
      // Check if user has assessor role only
      const userWithRole = await prisma.user.findFirst({
        where: {
          id: userId,
          isActive: true,
          roles: {
            some: {
              role: {
                name: 'ASSESSOR'
              }
            }
          }
        }
      });

      if (!userWithRole) {
        return false;
      }

      // Check if user is assigned to the entity
      const assignment = await prisma.entityAssignment.findFirst({
        where: {
          userId,
          entityId
        }
      });

      return !!assignment;
    } catch (error) {
      console.error('Error checking assessment permission:', error);
      return false;
    }
  }

  /**
   * Validate if user can create response for entity
   * User must be assigned to entity and have responder role
   */
  async canCreateResponse(userId: string, entityId: string): Promise<boolean> {
    try {
      // Check if user has responder role only
      const userWithRole = await prisma.user.findFirst({
        where: {
          id: userId,
          isActive: true,
          roles: {
            some: {
              role: {
                name: 'RESPONDER'
              }
            }
          }
        }
      });

      if (!userWithRole) {
        return false;
      }

      // Check if user is assigned to the entity
      const assignment = await prisma.entityAssignment.findFirst({
        where: {
          userId,
          entityId
        }
      });

      return !!assignment;
    } catch (error) {
      console.error('Error checking response permission:', error);
      return false;
    }
  }

  /**
   * Filter entities based on user assignments
   * Return only entities that the user is assigned to
   */
  async filterEntitiesByAssignment(userId: string, entities: Entity[]): Promise<Entity[]> {
    try {
      // Get user's assigned entity IDs
      const assignedEntities = await this.getUserAssignedEntities(userId);
      const assignedEntityIds = assignedEntities.map(e => e.id);

      // Filter entities to only include assigned ones
      return entities.filter(entity => assignedEntityIds.includes(entity.id));
    } catch (error) {
      console.error('Error filtering entities by assignment:', error);
      return [];
    }
  }

  /**
   * Get entities available for assessment by user
   * This combines entity filtering with assignment validation
   */
  async getAvailableEntitiesForAssessment(userId: string): Promise<Entity[]> {
    try {
      // Get all active entities
      const allEntities = await prisma.entity.findMany({
        where: {
          isActive: true
        },
        orderBy: [
          { type: 'asc' },
          { name: 'asc' }
        ]
      });

      // Filter by user assignments
      const assignedEntities = await this.filterEntitiesByAssignment(userId, allEntities);

      return assignedEntities.map(entity => ({
        id: entity.id,
        name: entity.name,
        type: entity.type,
        location: entity.location,
        coordinates: entity.coordinates,
        metadata: entity.metadata,
        isActive: entity.isActive,
        createdAt: entity.createdAt,
        updatedAt: entity.updatedAt
      }));
    } catch (error) {
      console.error('Error getting available entities for assessment:', error);
      return [];
    }
  }

  /**
   * Check if user can access a specific assessment
   * User can access if they are assigned to the assessment's entity
   */
  async canAccessAssessment(userId: string, assessmentId: string): Promise<boolean> {
    try {
      // Get the assessment and its entity
      const assessment = await prisma.rapidAssessment.findUnique({
        where: { id: assessmentId },
        include: {
          entity: true
        }
      });

      if (!assessment) {
        return false;
      }

      // Check if user is assigned to the assessment's entity
      return await this.isUserAssigned(userId, assessment.entity.id);
    } catch (error) {
      console.error('Error checking assessment access:', error);
      return false;
    }
  }

  /**
   * Get assessment statistics for a user's assigned entities
   */
  async getUserAssessmentStats(userId: string): Promise<{
    totalEntities: number;
    entitiesWithAssessments: number;
    totalAssessments: number;
    assessmentsByType: Record<string, number>;
  }> {
    try {
      const assignedEntities = await this.getUserAssignedEntities(userId);
      const entityIds = assignedEntities.map(e => e.id);

      // Get assessments for user's assigned entities
      const assessments = await prisma.rapidAssessment.findMany({
        where: {
          entityId: {
            in: entityIds
          }
        }
      });

      // Group assessments by type
      const assessmentsByType: Record<string, number> = {};
      assessments.forEach(assessment => {
        const type = assessment.rapidAssessmentType;
        assessmentsByType[type] = (assessmentsByType[type] || 0) + 1;
      });

      // Count unique entities with assessments
      const entitiesWithAssessments = new Set(assessments.map(a => a.entityId)).size;

      return {
        totalEntities: assignedEntities.length,
        entitiesWithAssessments,
        totalAssessments: assessments.length,
        assessmentsByType
      };
    } catch (error) {
      console.error('Error getting user assessment stats:', error);
      return {
        totalEntities: 0,
        entitiesWithAssessments: 0,
        totalAssessments: 0,
        assessmentsByType: {}
      };
    }
  }

  /**
   * Get entities assigned to a user (for responders and assessors)
   * Similar to getUserAssignedEntities but for responder or assessor role
   */
  async getAssignedEntities(userId: string): Promise<Entity[]> {
    try {
      const assignments = await prisma.entityAssignment.findMany({
        where: {
          userId,
          user: {
            isActive: true,
            roles: {
              some: {
                role: {
                  name: {
                    in: ['RESPONDER', 'ASSESSOR']
                  }
                }
              }
            }
          }
        },
        include: {
          entity: true
        },
        orderBy: {
          assignedAt: 'desc'
        }
      });

      return assignments.map(assignment => ({
        id: assignment.entity.id,
        name: assignment.entity.name,
        type: assignment.entity.type,
        location: assignment.entity.location,
        coordinates: assignment.entity.coordinates,
        metadata: assignment.entity.metadata,
        isActive: assignment.entity.isActive,
        createdAt: assignment.entity.createdAt,
        updatedAt: assignment.entity.updatedAt
      }));
    } catch (error) {
      console.error('Error getting assigned entities:', error);
      return [];
    }
  }

  /**
   * Get verified assessments for an entity
   * Returns assessments that can be used for response planning
   */
  async getVerifiedAssessments(entityId?: string, limit?: number): Promise<any[]> {
    try {
      const where: any = {
          verificationStatus: {
            in: ['VERIFIED', 'AUTO_VERIFIED']
          }
        };
      if (entityId) {
        where.entityId = entityId;
      }
      const assessments = await prisma.rapidAssessment.findMany({
        where,
        select: {
          id: true,
          rapidAssessmentType: true,
          rapidAssessmentDate: true,
          verificationStatus: true,
          verifiedAt: true,
          verifiedBy: true,
          priority: true,
          entity: {
            select: {
              id: true,
              name: true,
              type: true
            }
          },
          assessor: {
            select: {
              name: true,
              email: true
            }
          }
        },
        orderBy: [
          { verificationStatus: 'desc' },
          { rapidAssessmentDate: 'desc' }
        ],
        ...(limit ? { take: limit } : {})
      });

      return assessments;
    } catch (error) {
      console.error('Error getting verified assessments:', error);
      return [];
    }
  }
}

// Export singleton instance
export const entityAssignmentService = new EntityAssignmentServiceImpl();