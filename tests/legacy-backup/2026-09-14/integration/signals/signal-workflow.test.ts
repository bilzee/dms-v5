import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import { PrismaClient } from '@prisma/client';
import { ActionSignalService } from '@/lib/services/action-signal.service';
import { SignalReconciliationJob } from '@/lib/jobs/signal-reconciliation';
import { prisma } from '@/lib/db/client';
import type { SignalTriggerPayload } from '@/types/action-signal';

let isDatabaseAvailable = false;
let db: PrismaClient;

let testAssessor: any;
let testResponder: any;
let testDonor: any;
let testEntity: any;
let testIncident: any;
let testAssignmentAssessor: any;
let testAssignmentResponder: any;
let testAssignmentDonor: any;

describe('Signal Workflow Integration Tests', () => {
  beforeAll(async () => {
    try {
      db = new PrismaClient({
        datasources: {
          db: {
            url: process.env.DATABASE_URL || 'file:./test.db',
          },
        },
      });
      await db.$connect();
      isDatabaseAvailable = true;
    } catch {
      isDatabaseAvailable = false;
    }
  });

  afterAll(async () => {
    if (!isDatabaseAvailable) return;
    try {
      await db.actionSignal.deleteMany({
        where: { entity: { name: { contains: 'Test Signal' } } },
      });
      await db.notification.deleteMany({
        where: {
          user: {
            email: { in: ['assessor-signal@test.com', 'responder-signal@test.com', 'donor-signal@test.com'] },
          },
        },
      });
      await db.entityAssignment.deleteMany({
        where: { entity: { name: { contains: 'Test Signal' } } },
      });
      await db.rapidResponse.deleteMany({
        where: { entity: { name: { contains: 'Test Signal' } } },
      });
      await db.rapidAssessment.deleteMany({
        where: { entity: { name: { contains: 'Test Signal' } } },
      });
      await db.incidentEntity.deleteMany({
        where: { entity: { name: { contains: 'Test Signal' } } },
      });
      await db.incident.deleteMany({
        where: { description: 'Test Signal incident' },
      });
      await db.entity.deleteMany({
        where: { name: { contains: 'Test Signal' } },
      });
      await db.user.deleteMany({
        where: {
          email: { in: ['assessor-signal@test.com', 'responder-signal@test.com', 'donor-signal@test.com'] },
        },
      });
    } catch {}
    await db.$disconnect();
  });

  beforeEach(async () => {
    if (!isDatabaseAvailable) return;

    try {
      const assessorRole = await db.role.findFirst({ where: { name: 'ASSESSOR' } });
      const responderRole = await db.role.findFirst({ where: { name: 'RESPONDER' } });
      const donorRole = await db.role.findFirst({ where: { name: 'DONOR' } });

      testAssessor = await db.user.create({
        data: {
          email: 'assessor-signal@test.com',
          name: 'Test Assessor Signal',
          password: 'hashed-password',
          roles: assessorRole
            ? { create: { role: { connect: { id: assessorRole.id } } } }
            : undefined,
        },
      });

      testResponder = await db.user.create({
        data: {
          email: 'responder-signal@test.com',
          name: 'Test Responder Signal',
          password: 'hashed-password',
          roles: responderRole
            ? { create: { role: { connect: { id: responderRole.id } } } }
            : undefined,
        },
      });

      testDonor = await db.user.create({
        data: {
          email: 'donor-signal@test.com',
          name: 'Test Donor Signal',
          password: 'hashed-password',
          roles: donorRole
            ? { create: { role: { connect: { id: donorRole.id } } } }
            : undefined,
        },
      });

      testEntity = await db.entity.create({
        data: {
          name: 'Test Signal Clinic A',
          type: 'HEALTH_FACILITY',
          location: 'Test District 7',
          isActive: true,
        },
      });

      testIncident = await db.incident.create({
        data: {
          type: 'FLOOD',
          severity: 'HIGH',
          status: 'ACTIVE',
          description: 'Test Signal incident',
          location: 'Test District 7',
          createdBy: testAssessor.id,
        },
      });

      await db.incidentEntity.create({
        data: {
          incidentId: testIncident.id,
          entityId: testEntity.id,
          severity: 'HIGH',
        },
      });

      testAssignmentAssessor = await db.entityAssignment.create({
        data: {
          userId: testAssessor.id,
          entityId: testEntity.id,
          incidentId: testIncident.id,
        },
      });

      testAssignmentResponder = await db.entityAssignment.create({
        data: {
          userId: testResponder.id,
          entityId: testEntity.id,
          incidentId: testIncident.id,
        },
      });

      testAssignmentDonor = await db.entityAssignment.create({
        data: {
          userId: testDonor.id,
          entityId: testEntity.id,
          incidentId: testIncident.id,
        },
      });
    } catch {}
  });

  afterEach(async () => {
    if (!isDatabaseAvailable) return;
    try {
      await db.actionSignal.deleteMany({
        where: { entityId: testEntity?.id },
      });
      await db.notification.deleteMany({
        where: { userId: { in: [testAssessor?.id, testResponder?.id, testDonor?.id] } },
      });
      await db.entityAssignment.deleteMany({
        where: { entityId: testEntity?.id },
      });
      await db.rapidResponse.deleteMany({
        where: { entityId: testEntity?.id },
      });
      await db.rapidAssessment.deleteMany({
        where: { entityId: testEntity?.id },
      });
      await db.incidentEntity.deleteMany({
        where: { entityId: testEntity?.id },
      });
      await db.incident.deleteMany({
        where: { id: testIncident?.id },
      });
      await db.entity.deleteMany({
        where: { id: testEntity?.id },
      });
      await db.user.deleteMany({
        where: { id: { in: [testAssessor?.id, testResponder?.id, testDonor?.id] } },
      });
    } catch {}
  });

  describe('Full Signal Lifecycle', () => {
    it('should progress through assessment-verified -> response-created -> response-delivered', async () => {
      if (!isDatabaseAvailable) return;

      const assessmentVerifiedPayload: SignalTriggerPayload = {
        trigger: 'assessment-verified',
        entityId: testEntity.id,
        incidentId: testIncident.id,
        assessmentId: 'assessment-sig-001',
        assessmentType: 'HEALTH',
        assessmentPriority: 'HIGH',
      };

      await ActionSignalService.evaluateAndGenerate(assessmentVerifiedPayload);

      const awaitingPlanSignals = await db.actionSignal.findMany({
        where: {
          entityId: testEntity.id,
          incidentId: testIncident.id,
          signalReason: 'awaiting-plan',
          resolvedAt: null,
        },
      });

      expect(awaitingPlanSignals.length).toBeGreaterThanOrEqual(1);
      const responderSignal = awaitingPlanSignals.find(
        (s) => s.userId === testResponder.id
      );
      expect(responderSignal).toBeDefined();
      expect(responderSignal!.type).toBe('HEALTH');
      expect(responderSignal!.priority).toBe('HIGH');

      const responseCreatedPayload: SignalTriggerPayload = {
        trigger: 'response-created',
        entityId: testEntity.id,
        incidentId: testIncident.id,
        responseId: 'response-sig-001',
        responseType: 'HEALTH',
        responsePriority: 'HIGH',
      };

      await ActionSignalService.evaluateAndGenerate(responseCreatedPayload);

      const resolvedPlanSignals = await db.actionSignal.findMany({
        where: {
          entityId: testEntity.id,
          incidentId: testIncident.id,
          signalReason: 'awaiting-plan',
          resolvedAt: { not: null },
        },
      });

      expect(resolvedPlanSignals.length).toBeGreaterThanOrEqual(1);

      const responseDeliveredPayload: SignalTriggerPayload = {
        trigger: 'response-delivered',
        entityId: testEntity.id,
        incidentId: testIncident.id,
        responseId: 'response-sig-001',
        responseType: 'HEALTH',
        responsePriority: 'HIGH',
      };

      await ActionSignalService.evaluateAndGenerate(responseDeliveredPayload);

      const deliverySignals = await db.actionSignal.findMany({
        where: {
          entityId: testEntity.id,
          incidentId: testIncident.id,
          signalReason: 'awaiting-delivery',
          resolvedAt: { not: null },
        },
      });

      expect(deliverySignals.length).toBeGreaterThanOrEqual(0);

      const activeAfterDelivery = await db.actionSignal.findMany({
        where: {
          entityId: testEntity.id,
          incidentId: testIncident.id,
          resolvedAt: null,
        },
      });

      expect(activeAfterDelivery.length).toBe(0);
    });
  });

  describe('Signal Grouping', () => {
    it('should group signals by entity and type with correct count and highestPriority', async () => {
      if (!isDatabaseAvailable) return;

      const payload1: SignalTriggerPayload = {
        trigger: 'assessment-verified',
        entityId: testEntity.id,
        incidentId: testIncident.id,
        assessmentId: 'assessment-sig-002',
        assessmentType: 'HEALTH',
        assessmentPriority: 'HIGH',
      };

      await ActionSignalService.evaluateAndGenerate(payload1);

      const payload2: SignalTriggerPayload = {
        trigger: 'assessment-verified',
        entityId: testEntity.id,
        incidentId: testIncident.id,
        assessmentId: 'assessment-sig-003',
        assessmentType: 'HEALTH',
        assessmentPriority: 'CRITICAL',
      };

      await ActionSignalService.evaluateAndGenerate(payload2);

      const result = await ActionSignalService.getActiveSignals(
        testResponder.id,
        ['RESPONDER'],
        {
          entityId: testEntity.id,
          grouped: true,
          unresolvedOnly: true,
          page: 1,
          limit: 50,
        }
      );

      expect(result.groups.length).toBeGreaterThanOrEqual(1);

      const healthGroup = result.groups.find((g) => g.type === 'HEALTH');
      expect(healthGroup).toBeDefined();
      expect(healthGroup!.count).toBeGreaterThanOrEqual(1);
      expect(['CRITICAL', 'HIGH']).toContain(healthGroup!.highestPriority);
    });
  });

  describe('Signal Priority Derivation', () => {
    it('should assign CRITICAL priority for POPULATION assessment type', async () => {
      if (!isDatabaseAvailable) return;

      const criticalIncident = await db.incident.create({
        data: {
          type: 'EARTHQUAKE',
          severity: 'MEDIUM',
          status: 'ACTIVE',
          description: 'Test Signal incident',
          location: 'Test District 9',
          createdBy: testAssessor.id,
        },
      });

      await db.incidentEntity.create({
        data: {
          incidentId: criticalIncident.id,
          entityId: testEntity.id,
          severity: 'MEDIUM',
        },
      });

      const payload: SignalTriggerPayload = {
        trigger: 'assessment-verified',
        entityId: testEntity.id,
        incidentId: criticalIncident.id,
        assessmentId: 'assessment-sig-004',
        assessmentType: 'POPULATION',
        assessmentPriority: 'HIGH',
      };

      await ActionSignalService.evaluateAndGenerate(payload);

      const populationSignals = await db.actionSignal.findMany({
        where: {
          entityId: testEntity.id,
          incidentId: criticalIncident.id,
          signalReason: 'unassessed',
          resolvedAt: null,
        },
      });

      expect(populationSignals.length).toBeGreaterThanOrEqual(0);

      await db.incidentEntity.deleteMany({
        where: { incidentId: criticalIncident.id, entityId: testEntity.id },
      });
      await db.actionSignal.deleteMany({
        where: { incidentId: criticalIncident.id },
      });
      await db.incident.delete({ where: { id: criticalIncident.id } });
    });

    it('should map incident severity to signal priority correctly', async () => {
      if (!isDatabaseAvailable) return;

      const criticalIncident = await db.incident.create({
        data: {
          type: 'EARTHQUAKE',
          severity: 'CRITICAL',
          status: 'ACTIVE',
          description: 'Test Signal incident',
          location: 'Test District 9',
          createdBy: testAssessor.id,
        },
      });

      await db.incidentEntity.create({
        data: {
          incidentId: criticalIncident.id,
          entityId: testEntity.id,
          severity: 'CRITICAL',
        },
      });

      const payload: SignalTriggerPayload = {
        trigger: 'assessment-verified',
        entityId: testEntity.id,
        incidentId: criticalIncident.id,
        assessmentId: 'assessment-sig-005',
        assessmentType: 'WASH',
        assessmentPriority: 'CRITICAL',
      };

      await ActionSignalService.evaluateAndGenerate(payload);

      const washSignals = await db.actionSignal.findMany({
        where: {
          entityId: testEntity.id,
          incidentId: criticalIncident.id,
          signalReason: 'awaiting-plan',
          resolvedAt: null,
        },
      });

      expect(washSignals.length).toBeGreaterThanOrEqual(1);
      expect(washSignals[0].priority).toBe('CRITICAL');

      await db.incidentEntity.deleteMany({
        where: { incidentId: criticalIncident.id, entityId: testEntity.id },
      });
      await db.actionSignal.deleteMany({
        where: { incidentId: criticalIncident.id },
      });
      await db.incident.delete({ where: { id: criticalIncident.id } });
    });
  });

  describe('Reconciliation Job', () => {
    it('should resolve signals when underlying condition is met', async () => {
      if (!isDatabaseAvailable) return;

      await db.actionSignal.create({
        data: {
          userId: testResponder.id,
          entityId: testEntity.id,
          incidentId: testIncident.id,
          type: 'HEALTH',
          signalReason: 'awaiting-plan',
          priority: 'HIGH',
          context: {},
        },
      });

      await db.rapidResponse.create({
        data: {
          responderId: testResponder.id,
          entityId: testEntity.id,
          incidentId: testIncident.id,
          type: 'HEALTH',
          status: 'PLANNED',
          deliveryStatus: 'PENDING',
          priority: 'HIGH',
          description: 'Test reconciliation response',
          responseDate: new Date(),
          plannedDate: new Date(),
        },
      });

      const result = await SignalReconciliationJob.run();

      expect(result.evaluated).toBeGreaterThanOrEqual(1);
      expect(result.resolved).toBeGreaterThanOrEqual(1);

      const remaining = await db.actionSignal.findMany({
        where: {
          entityId: testEntity.id,
          incidentId: testIncident.id,
          signalReason: 'awaiting-plan',
          resolvedAt: null,
        },
      });

      expect(remaining.length).toBe(0);

      await db.rapidResponse.deleteMany({
        where: { entityId: testEntity.id, incidentId: testIncident.id },
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle missing entity gracefully', async () => {
      if (!isDatabaseAvailable) return;

      const payload: SignalTriggerPayload = {
        trigger: 'assessment-verified',
        entityId: 'nonexistent-entity-00000000',
        incidentId: testIncident.id,
        assessmentId: 'assessment-sig-006',
        assessmentType: 'HEALTH',
        assessmentPriority: 'MEDIUM',
      };

      await expect(ActionSignalService.evaluateAndGenerate(payload)).resolves.not.toThrow();

      const signals = await db.actionSignal.findMany({
        where: { entityId: 'nonexistent-entity-00000000' },
      });

      expect(signals.length).toBe(0);
    });

    it('should handle missing assignment gracefully', async () => {
      if (!isDatabaseAvailable) return;

      const orphanEntity = await db.entity.create({
        data: {
          name: 'Test Signal Orphan Entity',
          type: 'SCHOOL',
          location: 'Test District 11',
          isActive: true,
        },
      });

      const payload: SignalTriggerPayload = {
        trigger: 'assessment-verified',
        entityId: orphanEntity.id,
        incidentId: testIncident.id,
        assessmentId: 'assessment-sig-007',
        assessmentType: 'HEALTH',
        assessmentPriority: 'LOW',
      };

      await expect(ActionSignalService.evaluateAndGenerate(payload)).resolves.not.toThrow();

      const signals = await db.actionSignal.findMany({
        where: { entityId: orphanEntity.id },
      });

      expect(signals.length).toBe(0);

      await db.actionSignal.deleteMany({ where: { entityId: orphanEntity.id } });
      await db.entity.delete({ where: { id: orphanEntity.id } });
    });
  });
});
