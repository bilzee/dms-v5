import { prisma } from '@/lib/db/client';
import { Prisma, AssessmentType, ResponseType } from '@prisma/client';
import type {
  SignalReason,
  SignalPriority,
  SignalTriggerPayload,
  ActionSignalItem,
  SignalGroup,
  SignalContext,
  SignalTargetRole,
} from '@/types/action-signal';
import { SIGNAL_REASON_ROLES, NOTIFICATION_TEMPLATES } from '@/types/action-signal';
import type { SignalQueryInput } from '@/lib/validation/action-signal';
import { SYSTEM_HEALTH_SEVERITY, resolveSeverityPriority } from '@/lib/severity-inheritance';

type PrismaTransaction = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

type SignalEventPayload = {
  signalId: string;
  signalReason: SignalReason;
  entityName: string;
  priority: SignalPriority;
  entityId: string;
  incidentId: string | null;
};

type SignalEventType = 'SIGNAL_CREATED' | 'SIGNAL_RESOLVED' | 'SIGNAL_UPDATED';

type SignalListener = (event: SignalEventType, payload: SignalEventPayload) => void;

const signalListeners = new Set<SignalListener>();

export function onSignalEvent(listener: SignalListener): () => void {
  signalListeners.add(listener);
  return () => { signalListeners.delete(listener); };
}

function emitSignalEvent(type: SignalEventType, payload: SignalEventPayload): void {
  for (const listener of signalListeners) {
    try { listener(type, payload); } catch {}
  }
}

export class ActionSignalService {

  static async evaluateAndGenerate(
    payload: SignalTriggerPayload,
    tx?: PrismaTransaction
  ): Promise<void> {
    const dbClient = tx || prisma;

    try {
      switch (payload.trigger) {
        case 'assessment-created':
        case 'assessment-submitted':
        case 'assessment-verified':
          await this.handleAssessmentTrigger(payload, dbClient);
          break;
        case 'assessment-rejected':
          break;
        case 'response-created':
          await this.handleResponseTrigger(payload, dbClient);
          break;
        case 'response-delivered':
        case 'response-verified':
        case 'response-rejected':
          await this.handleResponseTrigger(payload, dbClient);
          break;
        case 'commitment-created':
        case 'commitment-updated':
          await this.handleCommitmentTrigger(payload, dbClient);
          break;
      }
    } catch (error) {
      console.error('[ActionSignalService] evaluateAndGenerate error:', error);
    }
  }

  private static async handleAssessmentTrigger(
    payload: SignalTriggerPayload,
    tx: PrismaTransaction | typeof prisma
  ): Promise<void> {
    if (!payload.entityId || !payload.incidentId) return;

    const assignments = await this.getAssignmentsForEntity(payload.entityId, tx);
    const entity = await tx.entity.findUnique({
      where: { id: payload.entityId },
      select: { id: true, name: true },
    });
    if (!entity) return;

    if (payload.trigger === 'assessment-verified' || payload.trigger === 'assessment-created' || payload.trigger === 'assessment-submitted') {
      const assessors = assignments.filter(a => a.role === 'ASSESSOR');
      for (const assessor of assessors) {
        await this.resolveSignals(
          assessor.userId,
          payload.entityId,
          payload.incidentId,
          payload.assessmentType || '',
          ['overdue'],
          tx
        );
      }
    }

    if (payload.trigger === 'assessment-verified') {
      await this.resolveSignalsForReason('awaiting-plan', payload, tx);
      await this.resolveSignalsForReason('assessment-needs-response', payload, tx);

      const responders = assignments.filter(a => a.role === 'RESPONDER');
      for (const responder of responders) {
        await this.upsertSignal(
          {
            userId: responder.userId,
            entityId: payload.entityId,
            incidentId: payload.incidentId,
            type: payload.assessmentType || 'HEALTH',
            signalReason: 'awaiting-plan',
            priority: resolveSeverityPriority(payload.assessmentPriority),
            context: {
              entityName: entity.name,
              assessmentType: payload.assessmentType,
              assessmentId: payload.assessmentId,
            },
          },
          tx
        );
      }

      const donors = assignments.filter(a => a.role === 'DONOR');
      for (const donor of donors) {
        await this.upsertSignal(
          {
            userId: donor.userId,
            entityId: payload.entityId,
            incidentId: payload.incidentId,
            type: payload.assessmentType || 'HEALTH',
            signalReason: 'assessment-needs-response',
            priority: resolveSeverityPriority(payload.assessmentPriority),
            context: {
              entityName: entity.name,
              assessmentType: payload.assessmentType,
              assessmentId: payload.assessmentId,
            },
          },
          tx
        );
      }
    }

  }

  private static async handleResponseTrigger(
    payload: SignalTriggerPayload,
    tx: PrismaTransaction | typeof prisma
  ): Promise<void> {
    if (!payload.entityId) return;

    const entity = await tx.entity.findUnique({
      where: { id: payload.entityId },
      select: { id: true, name: true },
    });
    if (!entity) return;

    if (payload.trigger === 'response-created') {
      await this.resolveSignalsForReason('awaiting-plan', payload, tx);

      if (payload.incidentId) {
        const assignments = await this.getAssignmentsForEntity(payload.entityId, tx);
        const assessors = assignments.filter(a => a.role === 'ASSESSOR');
        for (const assessor of assessors) {
          await this.resolveSignals(
            assessor.userId,
            payload.entityId,
            payload.incidentId!,
            payload.responseType || '',
            ['awaiting-plan'],
            tx
          );
        }

        const response = payload.responseId
          ? await tx.rapidResponse.findUnique({
              where: { id: payload.responseId },
              select: { deliveryStatus: true, items: true, priority: true },
            })
          : null;

        const isPlan = response?.deliveryStatus === 'PLANNED' || !response?.deliveryStatus;

        if (isPlan) {
          const responders = assignments.filter(a => a.role === 'RESPONDER');
          const priority = resolveSeverityPriority(payload.responsePriority || response?.priority);
          for (const responder of responders) {
            await this.upsertSignal(
              {
                userId: responder.userId,
                entityId: payload.entityId,
                incidentId: payload.incidentId!,
                type: payload.responseType || 'HEALTH',
                signalReason: 'awaiting-delivery',
                priority,
                context: {
                  entityName: entity.name,
                  responseType: payload.responseType,
                  responseId: payload.responseId,
                },
              },
              tx
            );
          }

          if (response?.items) {
            await this.checkPartialCoverage(
              payload.entityId,
              payload.incidentId!,
              payload.responseId!,
              payload.responseType || 'HEALTH',
              entity.name,
              assignments,
              tx
            );
          }
        }

        const donors = assignments.filter(a => a.role === 'DONOR');
        const planPriority = resolveSeverityPriority(payload.responsePriority || response?.priority);
        for (const donor of donors) {
          await this.upsertSignal(
            {
              userId: donor.userId,
              entityId: payload.entityId,
              incidentId: payload.incidentId!,
              type: payload.responseType || 'HEALTH',
              signalReason: 'plan-needs-commitment',
              priority: planPriority,
              context: {
                entityName: entity.name,
                responseType: payload.responseType,
                responseId: payload.responseId,
              },
            },
            tx
          );
        }
      }
    }

    if (payload.trigger === 'response-delivered' || payload.trigger === 'response-verified') {
      if (payload.incidentId) {
        const assignments = await this.getAssignmentsForEntity(payload.entityId, tx);
        const responders = assignments.filter(a => a.role === 'RESPONDER');
        const donors = assignments.filter(a => a.role === 'DONOR');

        for (const responder of responders) {
          await this.resolveSignals(
            responder.userId,
            payload.entityId,
            payload.incidentId!,
            payload.responseType || '',
            ['awaiting-delivery'],
            tx
          );
        }

        for (const donor of donors) {
          await this.resolveSignals(
            donor.userId,
            payload.entityId,
            payload.incidentId!,
            payload.responseType || '',
            ['partially-covered', 'plan-needs-commitment'],
            tx
          );
        }
      }

      if (payload.trigger === 'response-verified' && payload.responseType && payload.responseId) {
        const verifiedResponse = await tx.rapidResponse.findUnique({
          where: { id: payload.responseId },
          select: { updatedAt: true, verificationStatus: true, deliveryStatus: true, priority: true },
        });

        if (verifiedResponse?.deliveryStatus !== 'DELIVERED') {
          return;
        }

        const verifiedAt = verifiedResponse?.updatedAt || new Date();

        const hasReassessment = await tx.rapidAssessment.findFirst({
          where: {
            entityId: payload.entityId,
            incidentId: payload.incidentId || undefined,
            rapidAssessmentType: payload.responseType as AssessmentType,
            verificationStatus: { in: ['SUBMITTED', 'VERIFIED', 'AUTO_VERIFIED'] },
            createdAt: { gte: verifiedAt },
          },
        });

        if (!hasReassessment && payload.incidentId) {
          const assignments = await this.getAssignmentsForEntity(payload.entityId, tx);
          const assessors = assignments.filter(a => a.role === 'ASSESSOR');
          const priority = resolveSeverityPriority(payload.responsePriority || verifiedResponse?.priority);

          for (const assessor of assessors) {
            await this.upsertSignal(
              {
                userId: assessor.userId,
                entityId: payload.entityId,
                incidentId: payload.incidentId,
                type: payload.responseType,
                signalReason: 'reassessment-needed',
                priority,
                context: {
                  entityName: entity.name,
                  assessmentType: payload.responseType,
                  responseId: payload.responseId,
                },
              },
              tx
            );
          }
        }
      }
    }
  }

  private static async handleCommitmentTrigger(
    payload: SignalTriggerPayload,
    tx: PrismaTransaction | typeof prisma
  ): Promise<void> {
    if (!payload.entityId || !payload.commitmentId) return;

    const entity = await tx.entity.findUnique({
      where: { id: payload.entityId },
      select: { id: true, name: true },
    });
    if (!entity) return;

    const commitment = await tx.donorCommitment.findUnique({
      where: { id: payload.commitmentId },
      select: {
        id: true,
        incidentId: true,
        donorId: true,
        status: true,
        donor: { select: { id: true, name: true } },
        planCommitments: { select: { planId: true } },
        incident: { select: { severity: true } },
      },
    });
    if (!commitment) return;

    if (commitment.planCommitments.length > 0 && commitment.incidentId) {
      if (payload.donorId) {
        const planIds = commitment.planCommitments.map(pc => pc.planId);
        const linkedResponses = await tx.rapidResponse.findMany({
          where: { id: { in: planIds } },
          select: { id: true, type: true },
        });

        const responseTypes = linkedResponses.map(r => r.type);
        if (responseTypes.length === 0 && payload.responseType) {
          responseTypes.push(payload.responseType as ResponseType);
        }

        for (const responseType of responseTypes) {
          await this.resolveSignals(
            payload.donorId,
            payload.entityId,
            commitment.incidentId,
            responseType,
            ['plan-needs-commitment'],
            tx
          );
        }

        if (responseTypes.length === 0) {
          await tx.actionSignal.updateMany({
            where: {
              userId: payload.donorId,
              entityId: payload.entityId,
              incidentId: commitment.incidentId,
              signalReason: 'plan-needs-commitment',
              resolvedAt: null,
            },
            data: { resolvedAt: new Date() },
          });
        }
      }

      const assignments = await this.getAssignmentsForEntity(payload.entityId, tx);
      const responders = assignments.filter(a => a.role === 'RESPONDER');
      for (const responder of responders) {
        await this.resolveSignals(
          responder.userId,
          payload.entityId,
          commitment.incidentId,
          'COMMITMENT',
          ['awaiting-plan-for-commitment'],
          tx
        );
      }

    }

    if (commitment.planCommitments.length === 0 && commitment.incidentId) {
      const assignments = await this.getAssignmentsForEntity(payload.entityId, tx);
      const priority = resolveSeverityPriority(commitment.incident?.severity);

      const responders = assignments.filter(a => a.role === 'RESPONDER');
      for (const responder of responders) {
        await this.upsertSignal(
          {
            userId: responder.userId,
            entityId: payload.entityId,
            incidentId: commitment.incidentId,
            type: 'COMMITMENT',
            signalReason: 'awaiting-plan-for-commitment',
            priority,
            context: {
              entityName: entity.name,
              commitmentId: commitment.id,
              donorName: commitment.donor.name,
            },
          },
          tx
        );
      }
    }

    if (commitment.status === 'PARTIAL' && commitment.incidentId) {
      const assignments = await this.getAssignmentsForEntity(payload.entityId, tx);
      const priority = resolveSeverityPriority(commitment.incident?.severity);

      if (payload.donorId) {
        await this.upsertSignal(
          {
            userId: payload.donorId,
            entityId: payload.entityId,
            incidentId: commitment.incidentId,
            type: 'COMMITMENT',
            signalReason: 'partially-fulfilled',
            priority,
            context: {
              entityName: entity.name,
              commitmentId: commitment.id,
            },
          },
          tx
        );
      }

      const responders = assignments.filter(a => a.role === 'RESPONDER');
      for (const responder of responders) {
        await this.upsertSignal(
          {
            userId: responder.userId,
            entityId: payload.entityId,
            incidentId: commitment.incidentId,
            type: 'COMMITMENT',
            signalReason: 'partially-fulfilled',
            priority,
            context: {
              entityName: entity.name,
              commitmentId: commitment.id,
            },
          },
          tx
        );
      }
    } else if (commitment.status === 'COMPLETE' && commitment.incidentId) {
      if (payload.donorId) {
        await this.resolveSignals(
          payload.donorId,
          payload.entityId,
          commitment.incidentId,
          'COMMITMENT',
          ['partially-fulfilled'],
          tx
        );
      }
      const assignments = await this.getAssignmentsForEntity(payload.entityId, tx);
      const responders = assignments.filter(a => a.role === 'RESPONDER');
      for (const responder of responders) {
        await this.resolveSignals(
          responder.userId,
          payload.entityId,
          commitment.incidentId,
          'COMMITMENT',
          ['partially-fulfilled'],
          tx
        );
      }
    }
  }

  private static async checkPartialCoverage(
    entityId: string,
    incidentId: string,
    responseId: string,
    responseType: string,
    entityName: string,
    assignments: { userId: string; role: string }[],
    tx: PrismaTransaction | typeof prisma
  ): Promise<void> {
    const plan = await tx.rapidResponse.findUnique({
      where: { id: responseId },
      select: { items: true, priority: true },
    });
    if (!plan?.items || !Array.isArray(plan.items)) return;

    const linkedCommitments = await tx.planCommitment.findMany({
      where: { planId: responseId },
      select: { commitmentId: true },
    });

    const planItems = plan.items as Array<{ name: string; quantity: number; unit: string }>;
    const committedByItem = new Map<string, number>();
    for (const pi of planItems) {
      committedByItem.set(pi.name, 0);
    }

    let hasAnyCoverage = false;
    let hasAnyGap = false;

    for (const pc of linkedCommitments) {
      const commitment = await tx.donorCommitment.findUnique({
        where: { id: pc.commitmentId },
        select: { items: true },
      });
      if (!commitment?.items || !Array.isArray(commitment.items)) continue;

      const cItems = commitment.items as Array<{ name: string; quantity: number }>;
      for (const ci of cItems) {
        const current = committedByItem.get(ci.name) || 0;
        committedByItem.set(ci.name, current + (ci.quantity || 0));
      }
    }

    const itemBreakdown: Array<{ itemName: string; plannedQuantity: number; committedQuantity: number; coveragePercent: number }> = [];
    for (const pi of planItems) {
      const committed = committedByItem.get(pi.name) || 0;
      const pct = pi.quantity > 0 ? Math.round((committed / pi.quantity) * 100) : 0;
      itemBreakdown.push({
        itemName: pi.name,
        plannedQuantity: pi.quantity,
        committedQuantity: committed,
        coveragePercent: Math.min(pct, 100),
      });
      if (committed > 0) hasAnyCoverage = true;
      if (committed < pi.quantity) hasAnyGap = true;
    }

    const donors = assignments.filter(a => a.role === 'DONOR');
    const priority = resolveSeverityPriority(plan.priority);

    if (hasAnyGap && hasAnyCoverage) {
      const avgCoverage = itemBreakdown.reduce((s, i) => s + i.coveragePercent, 0) / itemBreakdown.length;
      for (const donor of donors) {
        await this.upsertSignal(
          {
            userId: donor.userId,
            entityId,
            incidentId,
            type: responseType,
            signalReason: 'partially-covered',
            priority,
            context: {
              entityName,
              responseType,
              responseId,
              coveragePercent: Math.round(avgCoverage),
              itemBreakdown,
            },
          },
          tx
        );
      }
    } else if (!hasAnyGap && hasAnyCoverage) {
      for (const donor of donors) {
        await this.resolveSignals(
          donor.userId,
          entityId,
          incidentId,
          responseType,
          ['partially-covered'],
          tx
        );
      }
    }
  }

  static async evaluatePopulationCadence(
    tx?: PrismaTransaction | typeof prisma
  ): Promise<number> {
    const dbClient = tx || prisma;
    let created = 0;

    const entities = await dbClient.entity.findMany({
      where: {
        isActive: true,
        metadata: { path: ['populationAssessmentCadenceHours'], not: Prisma.DbNull },
      },
      select: {
        id: true,
        name: true,
        metadata: true,
        createdAt: true,
      },
    });

    const activeIncidents = await dbClient.incident.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, createdAt: true },
    });

    for (const entity of entities) {
      const metadata = entity.metadata as Record<string, unknown> | null;
      const cadenceHours = metadata?.populationAssessmentCadenceHours;
      if (!cadenceHours || typeof cadenceHours !== 'number' || cadenceHours <= 0) continue;

      for (const incident of activeIncidents) {
        const lastAssessment = await dbClient.rapidAssessment.findFirst({
          where: {
            entityId: entity.id,
            incidentId: incident.id,
            rapidAssessmentType: 'POPULATION',
            verificationStatus: { in: ['SUBMITTED', 'VERIFIED', 'AUTO_VERIFIED'] },
          },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true },
        });

        const baseline = lastAssessment?.createdAt || incident.createdAt;
        const deadline = new Date(baseline.getTime() + cadenceHours * 60 * 60 * 1000);

        if (new Date() > deadline) {
          const assignments = await this.getAssignmentsForEntity(entity.id, dbClient);

          const assessors = assignments.filter(a => a.role === 'ASSESSOR');
          for (const assessor of assessors) {
            const existing = await dbClient.actionSignal.findFirst({
              where: {
                userId: assessor.userId,
                entityId: entity.id,
                incidentId: incident.id,
                type: 'POPULATION',
                signalReason: 'overdue',
                resolvedAt: null,
              },
            });

            if (!existing) {
              await this.upsertSignal(
                {
                  userId: assessor.userId,
                  entityId: entity.id,
                  incidentId: incident.id,
                  type: 'POPULATION',
                  signalReason: 'overdue',
                  priority: SYSTEM_HEALTH_SEVERITY.POPULATION_CADENCE,
                  context: {
                    entityName: entity.name,
                    assessmentType: 'POPULATION',
                    deadline: deadline.toISOString(),
                    lastAssessmentDate: lastAssessment?.createdAt?.toISOString(),
                  },
                },
                dbClient
              );
              created++;
            }
          }
        }
      }
    }

    return created;
  }

  private static async evaluateCoordinatorSignals(): Promise<void> {
    const coordinators = await prisma.user.findMany({
      where: { roles: { some: { role: { name: 'COORDINATOR' } } } },
      select: { id: true },
    });
    if (coordinators.length === 0) return;

    const submittedAssessments = await prisma.rapidAssessment.findMany({
      where: { verificationStatus: 'SUBMITTED' },
      select: {
        id: true, entityId: true, incidentId: true, rapidAssessmentType: true,
        priority: true, createdAt: true,
        entity: { select: { id: true, name: true, type: true, location: true, coordinates: true } },
      },
    });

    const submittedResponses = await prisma.rapidResponse.findMany({
      where: { verificationStatus: 'SUBMITTED' },
      select: {
        id: true, entityId: true, type: true, priority: true, createdAt: true,
        deliveryStatus: true,
        assessment: { select: { incidentId: true } },
        entity: { select: { id: true, name: true, type: true, location: true, coordinates: true } },
      },
    });

    for (const coordinator of coordinators) {
      for (const a of submittedAssessments) {
        if (!a.incidentId) continue;
        const hoursSinceSubmit = (Date.now() - a.createdAt.getTime()) / (1000 * 60 * 60);
        const reason: SignalReason = hoursSinceSubmit > 48 ? 'verification-overdue' : 'assessment-awaiting-verification';
        const priority: SignalPriority = reason === 'verification-overdue'
          ? SYSTEM_HEALTH_SEVERITY.VERIFICATION_OVERDUE
          : resolveSeverityPriority(a.priority);

        await this.upsertSignal({
          userId: coordinator.id,
          entityId: a.entityId,
          incidentId: a.incidentId,
          type: a.rapidAssessmentType,
          signalReason: reason,
          priority,
          context: {
            entityName: a.entity.name,
            assessmentType: a.rapidAssessmentType,
            assessmentId: a.id,
          },
        }, prisma);
      }

      for (const r of submittedResponses) {
        const incidentId = r.assessment?.incidentId;
        if (!incidentId) continue;
        const hoursSinceSubmit = (Date.now() - r.createdAt.getTime()) / (1000 * 60 * 60);
        const reason: SignalReason = hoursSinceSubmit > 48 ? 'verification-overdue' : 'delivery-awaiting-verification';
        const priority: SignalPriority = reason === 'verification-overdue'
          ? SYSTEM_HEALTH_SEVERITY.VERIFICATION_OVERDUE
          : resolveSeverityPriority(r.priority);

        await this.upsertSignal({
          userId: coordinator.id,
          entityId: r.entityId,
          incidentId,
          type: r.type,
          signalReason: reason,
          priority,
          context: {
            entityName: r.entity.name,
            responseType: r.type,
            responseId: r.id,
          },
        }, prisma);
      }
    }

    const activeIncidents = await prisma.incident.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, name: true, severity: true },
    });
    const activeIncidentIds = new Set(activeIncidents.map(i => i.id));

    const entities = await prisma.entity.findMany({
      where: { isActive: true },
      include: {
        assignments: {
          include: {
            user: {
              include: {
                roles: { include: { role: { select: { name: true } } } },
              },
            },
          },
        },
      },
    });

    for (const entity of entities) {
      const assignedRoles = new Set<string>();
      for (const assignment of entity.assignments) {
        for (const userRole of assignment.user.roles) {
          assignedRoles.add(userRole.role.name);
        }
      }

      for (const incident of activeIncidents) {
        const hasAssessment = await prisma.rapidAssessment.findFirst({
          where: {
            entityId: entity.id,
            incidentId: incident.id,
            verificationStatus: { in: ['SUBMITTED', 'VERIFIED', 'AUTO_VERIFIED'] },
          },
        });
        if (!hasAssessment) continue;

        const missingRoles: Array<{ reason: SignalReason; role: string }> = [];
        if (!assignedRoles.has('RESPONDER')) missingRoles.push({ reason: 'entity-needs-responder', role: 'RESPONDER' });
        if (!assignedRoles.has('DONOR')) missingRoles.push({ reason: 'entity-needs-donor', role: 'DONOR' });

        for (const { reason } of missingRoles) {
          for (const coordinator of coordinators) {
            await this.upsertSignal({
              userId: coordinator.id,
              entityId: entity.id,
              incidentId: incident.id,
              type: 'ASSIGNMENT',
              signalReason: reason,
              priority: resolveSeverityPriority(incident.severity),
              context: {
                entityName: entity.name,
              },
            }, prisma);
          }
        }
      }
    }

    const coordinatorIds = coordinators.map(c => c.id);
    const knownReasons: SignalReason[] = ['assessment-awaiting-verification', 'delivery-awaiting-verification', 'verification-overdue', 'entity-needs-responder', 'entity-needs-donor'];
    const activeCoordinatorSignals = await prisma.actionSignal.findMany({
      where: {
        userId: { in: coordinatorIds },
        signalReason: { in: knownReasons },
        resolvedAt: null,
      },
      select: { id: true, signalReason: true, type: true, context: true, entityId: true, incidentId: true },
    });

    const submittedAssessmentIds = new Set(submittedAssessments.map(a => a.id));
    const submittedResponseIds = new Set(submittedResponses.map(r => r.id));

    const entityNeedsReasons: Set<string> = new Set(['entity-needs-responder', 'entity-needs-donor']);
    const entitiesMissingRolesByIncident: Map<string, Map<string, Set<string>>> = new Map();
    for (const entity of entities) {
      const assignedRoles = new Set<string>();
      for (const assignment of entity.assignments) {
        for (const userRole of assignment.user.roles) {
          assignedRoles.add(userRole.role.name);
        }
      }
      for (const incident of activeIncidents) {
        const hasAssessment = await prisma.rapidAssessment.findFirst({
          where: {
            entityId: entity.id,
            incidentId: incident.id,
            verificationStatus: { in: ['SUBMITTED', 'VERIFIED', 'AUTO_VERIFIED'] },
          },
        });
        if (!hasAssessment) continue;
        const missing = new Set<string>();
        if (!assignedRoles.has('RESPONDER')) missing.add('entity-needs-responder');
        if (!assignedRoles.has('DONOR')) missing.add('entity-needs-donor');
        if (missing.size > 0) {
          const key = `${entity.id}:${incident.id}`;
          entitiesMissingRolesByIncident.set(key, new Map([['missing', missing]]));
        }
      }
    }

    for (const signal of activeCoordinatorSignals) {
      if (entityNeedsReasons.has(signal.signalReason)) {
        const key = `${signal.entityId}:${signal.incidentId}`;
        const entry = signal.incidentId ? entitiesMissingRolesByIncident.get(key) : undefined;
        const stillMissing = entry?.get('missing');
        if (!stillMissing || !stillMissing.has(signal.signalReason)) {
          await prisma.actionSignal.update({
            where: { id: signal.id },
            data: { resolvedAt: new Date() },
          });
        }
        continue;
      }

      const ctx = signal.context as Record<string, unknown>;
      const isAssessment = signal.signalReason === 'assessment-awaiting-verification' || signal.signalReason === 'verification-overdue';
      const sourceId = isAssessment ? ctx?.assessmentId : ctx?.responseId;
      const stillExists = isAssessment
        ? submittedAssessmentIds.has(sourceId as string)
        : submittedResponseIds.has(sourceId as string);

      if (!stillExists) {
        await prisma.actionSignal.update({
          where: { id: signal.id },
          data: { resolvedAt: new Date() },
        });
      }
    }
  }

  static async getActiveSignals(
    userId: string,
    roles: string[],
    query: SignalQueryInput
  ): Promise<{
    signals: ActionSignalItem[];
    groups: SignalGroup[];
    totalCount: number;
    unresolvedCount: number;
    criticalCount: number;
  }> {
    await this.evaluatePopulationCadence().catch(() => {});

    const activeRole = query.activeRole || roles[0] || 'COORDINATOR';
    if (activeRole === 'COORDINATOR' || activeRole === 'ADMIN') {
      await this.evaluateCoordinatorSignals().catch(() => {});
    }

    const entityFilter = query.entityId ? { entityId: query.entityId } : {};
    const isGlobalRole = activeRole === 'COORDINATOR' || activeRole === 'ADMIN';

    let assignedEntityIds: string[] | null = null;
    if (!isGlobalRole) {
      const assignments = await prisma.entityAssignment.findMany({
        where: { userId },
        select: { entityId: true },
      });
      assignedEntityIds = assignments.map(a => a.entityId);
    }

    const coordinatorReasons: SignalReason[] = [
      'assessment-awaiting-verification',
      'delivery-awaiting-verification',
      'verification-overdue',
      'entity-needs-responder',
      'entity-needs-donor',
    ];

    let allowedReasons = activeRole === 'COORDINATOR' || activeRole === 'ADMIN'
      ? coordinatorReasons
      : Object.entries(SIGNAL_REASON_ROLES)
          .filter(([, reasonRoles]) => reasonRoles.includes(activeRole as SignalTargetRole))
          .map(([reason]) => reason as SignalReason);

    const { isSignalEnabled } = await import('./action-signal-config.service');
    const roleKey = activeRole === 'ADMIN' ? 'COORDINATOR' : activeRole;
    const enabledReasons: SignalReason[] = [];
    for (const reason of allowedReasons) {
      const enabled = await isSignalEnabled(roleKey, reason);
      if (enabled) enabledReasons.push(reason);
    }
    allowedReasons = enabledReasons;

    const activeIncidentIds = (await prisma.incident.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true },
    })).map(i => i.id);

    const where: Prisma.ActionSignalWhereInput = {
      resolvedAt: query.unresolvedOnly ? null : undefined,
      ...entityFilter,
      incidentId: query.incidentId || { in: activeIncidentIds.length > 0 ? activeIncidentIds : ['__none__'] },
      priority: query.priority || undefined,
      signalReason: query.signalReason || (allowedReasons ? { in: allowedReasons } : undefined),
      type: query.type || undefined,
      userId,
      ...(assignedEntityIds ? { entityId: { in: assignedEntityIds } } : {}),
    };

    const [signals, totalCount, unresolvedCount, criticalCount] = await Promise.all([
      prisma.actionSignal.findMany({
        where,
        include: {
          entity: {
            select: { id: true, name: true, type: true, location: true, coordinates: true },
          },
          incident: {
            select: { id: true, name: true, severity: true },
          },
        },
        orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      prisma.actionSignal.count({ where }),
      prisma.actionSignal.count({
        where: { ...where, resolvedAt: null },
      }),
      prisma.actionSignal.count({
        where: { ...where, resolvedAt: null, priority: 'CRITICAL' },
      }),
    ]);

    const mappedSignals: ActionSignalItem[] = signals.map(s => ({
      id: s.id,
      userId: s.userId,
      entityId: s.entityId,
      incidentId: s.incidentId,
      type: s.type,
      signalReason: s.signalReason as SignalReason,
      priority: s.priority as SignalPriority,
      context: s.context as SignalContext,
      createdAt: s.createdAt,
      resolvedAt: s.resolvedAt,
      entity: s.entity,
      incident: s.incident,
    }));

    let finalSignals = mappedSignals;
    let finalTotal = totalCount;
    let finalUnresolved = unresolvedCount;
    let finalCritical = criticalCount;

    if (activeRole === 'COORDINATOR') {
      finalSignals = mappedSignals;
      finalTotal = mappedSignals.length;
      finalUnresolved = mappedSignals.filter(s => !s.resolvedAt).length;
      finalCritical = mappedSignals.filter(s => !s.resolvedAt && s.priority === 'CRITICAL').length;
    }

    let groups: SignalGroup[] = [];
    if (query.grouped) {
      groups = this.groupSignals(finalSignals);
    }

    return {
      signals: finalSignals,
      groups,
      totalCount: finalTotal,
      unresolvedCount: finalUnresolved,
      criticalCount: finalCritical,
    };
  }

  static groupSignals(signals: ActionSignalItem[]): SignalGroup[] {
    const groupMap = new Map<string, SignalGroup>();

    for (const signal of signals) {
      const key = `${signal.entityId}:${signal.type}`;
      const existing = groupMap.get(key);
      if (existing) {
        existing.signals.push(signal);
        existing.count++;
        if (this.priorityRank(signal.priority) > this.priorityRank(existing.highestPriority)) {
          existing.highestPriority = signal.priority;
        }
      } else {
        groupMap.set(key, {
          entityId: signal.entityId,
          entityName: signal.entity.name,
          entityType: signal.entity.type,
          entityLocation: signal.entity.location,
          entityCoordinates: signal.entity.coordinates,
          type: signal.type,
          signals: [signal],
          count: 1,
          highestPriority: signal.priority,
        });
      }
    }

    return Array.from(groupMap.values()).sort(
      (a, b) => this.priorityRank(b.highestPriority) - this.priorityRank(a.highestPriority)
    );
  }

  private static priorityRank(p: SignalPriority): number {
    switch (p) {
      case 'CRITICAL': return 4;
      case 'HIGH': return 3;
      case 'MEDIUM': return 2;
      case 'LOW': return 1;
      default: return 0;
    }
  }

  private static async upsertSignal(
    data: {
      userId: string;
      entityId: string;
      incidentId: string | null;
      type: string;
      signalReason: SignalReason;
      priority: SignalPriority;
      context: SignalContext;
    },
    tx: PrismaTransaction | typeof prisma
  ): Promise<void> {
    const { isSignalEnabled } = await import('./action-signal-config.service');
    const user = await tx.user.findUnique({
      where: { id: data.userId },
      include: { roles: { include: { role: { select: { name: true } } } } },
    });
    const userRoles = user?.roles.map(ur => ur.role.name) || [];
    const primaryRole = userRoles.find(r => ['ASSESSOR', 'RESPONDER', 'DONOR', 'COORDINATOR'].includes(r));
    if (primaryRole) {
      const enabled = await isSignalEnabled(primaryRole, data.signalReason);
      if (!enabled) return;
    }

    const existing = await tx.actionSignal.findFirst({
      where: {
        userId: data.userId,
        entityId: data.entityId,
        incidentId: data.incidentId,
        type: data.type,
        signalReason: data.signalReason,
      },
    });

    if (existing) {
      const priorityChanged = existing.priority !== data.priority;
      const contextChanged = JSON.stringify(existing.context) !== JSON.stringify(data.context);
      if (priorityChanged || contextChanged) {
        await tx.actionSignal.update({
          where: { id: existing.id },
          data: {
            priority: data.priority,
            context: data.context as any,
            resolvedAt: null,
          },
        });
        if (priorityChanged) {
          await tx.notification.updateMany({
            where: { signalId: existing.id },
            data: { priority: data.priority },
          });
        }
        emitSignalEvent('SIGNAL_UPDATED', {
          signalId: existing.id,
          signalReason: data.signalReason,
          entityName: data.context.entityName || '',
          priority: data.priority,
          entityId: data.entityId,
          incidentId: data.incidentId,
        });
      }
      return;
    }

    const signal = await tx.actionSignal.create({
      data: {
        userId: data.userId,
        entityId: data.entityId,
        incidentId: data.incidentId,
        type: data.type,
        signalReason: data.signalReason,
        priority: data.priority,
        context: data.context as any,
      },
    });

    emitSignalEvent('SIGNAL_CREATED', {
      signalId: signal.id,
      signalReason: data.signalReason,
      entityName: data.context.entityName || '',
      priority: data.priority,
      entityId: data.entityId,
      incidentId: data.incidentId,
    });

    const { getNotificationConfig, shouldSendPush, shouldSendInApp, shouldSendEmail } = await import('./notification-config.service');
    const notifConfig = await getNotificationConfig();

    if (shouldSendInApp(data.priority, notifConfig)) {
      await this.createNotification(signal.id, data.userId, data.signalReason, data.context, data.priority, notifConfig.notificationTTLHours, tx);
    }

    if (shouldSendPush(data.priority, notifConfig)) {
      this.sendPushNotification(data.userId, data.signalReason, data.context).catch(() => {});
    }

    if (shouldSendEmail(data.priority, notifConfig)) {
      this.sendEmailNotification(data.userId, data.signalReason, data.context, notifConfig, data.priority).catch(() => {});
    }
  }

  private static async sendPushNotification(
    userId: string,
    reason: SignalReason,
    context: SignalContext
  ): Promise<void> {
    try {
      const { PushNotificationService } = await import('@/lib/services/push-notification.service');
      const template = NOTIFICATION_TEMPLATES[reason];
      if (!template) return;

      const body = template.body
        .replace('{entityName}', context.entityName || '')
        .replace('{assessmentType}', context.assessmentType || '')
        .replace('{responseType}', context.responseType || '')
        .replace('{donorName}', context.donorName || '')
        .replace('{coveragePercent}', String(context.coveragePercent || 0));

      await PushNotificationService.sendToUser(userId, {
        title: template.title,
        body,
        data: { signalReason: reason, entityId: context.entityName },
      });
    } catch {}
  }

  private static async sendEmailNotification(
    userId: string,
    reason: SignalReason,
    context: SignalContext,
    config: import('./notification-config.service').NotificationConfig,
    priority: SignalPriority
  ): Promise<void> {
    try {
      const userOverride = await prisma.systemSetting.findUnique({
        where: { section_key: { section: 'notification-user', key: `${userId}:emailEnabled` } },
      });
      if (userOverride && userOverride.value === false) return;

      if (config.emailDigestEnabled && priority !== 'CRITICAL') return;

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { email: true, name: true },
      });
      if (!user?.email) return;

      const template = NOTIFICATION_TEMPLATES[reason];
      if (!template) return;

      const body = template.body
        .replace('{entityName}', context.entityName || '')
        .replace('{assessmentType}', context.assessmentType || '')
        .replace('{responseType}', context.responseType || '')
        .replace('{donorName}', context.donorName || '')
        .replace('{coveragePercent}', String(context.coveragePercent || 0));

      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
      const { generateUnsubscribeToken } = await import('@/lib/email/unsubscribe-token');
      const unsubscribeToken = generateUnsubscribeToken(userId);
      const unsubscribeUrl = `${baseUrl}/api/v1/notifications/unsubscribe?userId=${userId}&token=${unsubscribeToken}`;

      const { renderSignalEmail } = await import('@/lib/email/templates/signal-notification');
      const { html, text } = renderSignalEmail({
        title: template.title,
        body,
        entityName: context.entityName || '',
        priority,
        signalReason: reason,
        dashboardUrl: `${baseUrl}/dashboard`,
        unsubscribeUrl,
      });

      const { emailService } = await import('@/lib/email/email.service');
      await emailService.send({
        to: user.email,
        subject: `[DRMS] ${template.title}`,
        html,
        text,
      });
    } catch {}
  }

  private static async createNotification(
    signalId: string,
    userId: string,
    reason: SignalReason,
    context: SignalContext,
    priority: SignalPriority,
    ttlHours: number,
    tx: PrismaTransaction | typeof prisma
  ): Promise<void> {
    const template = NOTIFICATION_TEMPLATES[reason];
    if (!template) return;

    const body = template.body
      .replace('{entityName}', context.entityName || '')
      .replace('{assessmentType}', context.assessmentType || '')
      .replace('{responseType}', context.responseType || '')
      .replace('{donorName}', context.donorName || '')
      .replace('{coveragePercent}', String(context.coveragePercent || 0));

    await tx.notification.create({
      data: {
        userId,
        signalId,
        title: template.title,
        body,
        priority,
        expiresAt: new Date(Date.now() + ttlHours * 60 * 60 * 1000),
      },
    });
  }

  private static async resolveSignals(
    userId: string,
    entityId: string,
    incidentId: string,
    type: string,
    reasons: SignalReason[],
    tx: PrismaTransaction | typeof prisma
  ): Promise<void> {
    const toResolve = await tx.actionSignal.findMany({
      where: {
        userId,
        entityId,
        incidentId,
        type,
        signalReason: { in: reasons },
        resolvedAt: null,
      },
      select: { id: true, signalReason: true, priority: true },
    });

    if (toResolve.length > 0) {
      await tx.actionSignal.updateMany({
        where: {
          id: { in: toResolve.map(s => s.id) },
        },
        data: { resolvedAt: new Date() },
      });

      const entity = await tx.entity.findUnique({
        where: { id: entityId },
        select: { name: true },
      });

      for (const s of toResolve) {
        emitSignalEvent('SIGNAL_RESOLVED', {
          signalId: s.id,
          signalReason: s.signalReason as SignalReason,
          entityName: entity?.name || '',
          priority: s.priority as SignalPriority,
          entityId,
          incidentId,
        });
      }
    }
  }

  private static async resolveSignalsForReason(
    reason: SignalReason,
    payload: SignalTriggerPayload,
    tx: PrismaTransaction | typeof prisma
  ): Promise<void> {
    if (!payload.entityId) return;

    await tx.actionSignal.updateMany({
      where: {
        entityId: payload.entityId,
        incidentId: payload.incidentId || undefined,
        type: payload.assessmentType || payload.responseType || '',
        signalReason: reason,
        resolvedAt: null,
      },
      data: { resolvedAt: new Date() },
    });
  }

  private static async getAssignmentsForEntity(
    entityId: string,
    tx: PrismaTransaction | typeof prisma
  ): Promise<{ userId: string; role: string }[]> {
    const assignments = await tx.entityAssignment.findMany({
      where: { entityId },
      select: {
        userId: true,
        user: {
          select: {
            roles: {
              select: {
                role: {
                  select: { name: true },
                },
              },
            },
          },
        },
      },
    });

    const result: { userId: string; role: string }[] = [];
    for (const assignment of assignments) {
      for (const userRole of assignment.user.roles) {
        result.push({ userId: assignment.userId, role: userRole.role.name });
      }
    }
    return result;
  }

  private static async derivePriorityFromIncident(
    incidentId: string,
    assessmentType: string,
    tx: PrismaTransaction | typeof prisma
  ): Promise<SignalPriority> {
    if (assessmentType === 'POPULATION') return 'CRITICAL';

    const incident = await tx.incident.findUnique({
      where: { id: incidentId },
      select: { severity: true },
    });

    return resolveSeverityPriority(incident?.severity);
  }

  static async updateSignalPriorities(
    sourceType: 'assessment' | 'response',
    sourceId: string,
    newPriority: SignalPriority
  ): Promise<void> {
    if (!['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].includes(newPriority)) return;

    if (sourceType === 'assessment') {
      const assessment = await prisma.rapidAssessment.findUnique({
        where: { id: sourceId },
        select: { entityId: true, incidentId: true, rapidAssessmentType: true },
      });
      if (!assessment) return;

      const reasons: SignalReason[] = ['awaiting-plan', 'assessment-needs-response', 'reassessment-needed'];
      await prisma.actionSignal.updateMany({
        where: {
          entityId: assessment.entityId,
          incidentId: assessment.incidentId,
          type: assessment.rapidAssessmentType,
          signalReason: { in: reasons },
          resolvedAt: null,
        },
        data: { priority: newPriority },
      });
    } else if (sourceType === 'response') {
      const response = await prisma.rapidResponse.findUnique({
        where: { id: sourceId },
        select: { entityId: true, type: true, assessment: { select: { incidentId: true } } },
      });
      if (!response) return;

      const incidentId = response.assessment?.incidentId;
      if (!incidentId) return;

      const reasons: SignalReason[] = ['awaiting-delivery', 'plan-needs-commitment', 'partially-covered', 'partially-fulfilled'];
      await prisma.actionSignal.updateMany({
        where: {
          entityId: response.entityId,
          incidentId,
          type: response.type,
          signalReason: { in: reasons },
          resolvedAt: null,
        },
        data: { priority: newPriority },
      });
    }
  }
}
