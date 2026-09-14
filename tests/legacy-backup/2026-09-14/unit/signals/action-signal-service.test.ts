import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import type { SignalTriggerPayload } from '@/types/action-signal';

const mockPrisma = {
  actionSignal: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    count: jest.fn(),
  },
  entityAssignment: {
    findMany: jest.fn(),
  },
  entity: {
    findUnique: jest.fn(),
  },
  incident: {
    findUnique: jest.fn(),
  },
  notification: {
    create: jest.fn(),
  },
  rapidAssessment: {
    findFirst: jest.fn(),
  },
  donorCommitment: {
    findUnique: jest.fn(),
  },
  $transaction: jest.fn(),
};

jest.mock('@/lib/db/client', () => {
  return {
    __esModule: true,
    prisma: mockPrisma,
    db: mockPrisma,
    default: mockPrisma,
  };
});

const { ActionSignalService } = require('@/lib/services/action-signal.service');

function getDb() {
  return mockPrisma;
}

const ASSIGNEES_ALL_ROLES = [
  {
    userId: 'assessor-1',
    user: { roles: [{ role: { name: 'ASSESSOR' } }] },
  },
  {
    userId: 'responder-1',
    user: { roles: [{ role: { name: 'RESPONDER' } }] },
  },
  {
    userId: 'donor-1',
    user: { roles: [{ role: { name: 'DONOR' } }] },
  },
];

const BASE_ENTITY = { id: 'entity-1', name: 'Entity One' };
const BASE_INCIDENT = { id: 'incident-1', name: 'Incident One', severity: 'HIGH' };

function setupMocks() {
  const db = getDb();
  db.entityAssignment.findMany.mockResolvedValue(ASSIGNEES_ALL_ROLES);
  db.entity.findUnique.mockResolvedValue(BASE_ENTITY);
  db.incident.findUnique.mockResolvedValue(BASE_INCIDENT);
  db.rapidAssessment.findFirst.mockResolvedValue(null);
  db.actionSignal.findFirst.mockResolvedValue(null);
  db.actionSignal.create.mockResolvedValue({ id: 'signal-new' });
  db.actionSignal.update.mockResolvedValue({ id: 'signal-updated' });
  db.actionSignal.updateMany.mockResolvedValue({ count: 1 });
  db.actionSignal.findMany.mockResolvedValue([]);
  db.actionSignal.count.mockResolvedValue(0);
  db.notification.create.mockResolvedValue({ id: 'notif-1' });
  db.donorCommitment.findUnique.mockResolvedValue(null);
  db.$transaction.mockImplementation(async (callback: any) => await callback(db));
}

describe('ActionSignalService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupMocks();
  });

  describe('evaluateAndGenerate — Assessment Triggers', () => {
    describe('assessment-verified', () => {
      it('resolves unassessed signals for assessors', async () => {
        const db = getDb();
        const payload: SignalTriggerPayload = {
          trigger: 'assessment-verified',
          entityId: 'entity-1',
          incidentId: 'incident-1',
          assessmentId: 'assessment-1',
          assessmentType: 'HEALTH',
          assessmentPriority: 'HIGH',
        };

        await ActionSignalService.evaluateAndGenerate(payload);

        expect(db.actionSignal.updateMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              userId: 'assessor-1',
              entityId: 'entity-1',
              incidentId: 'incident-1',
              type: 'HEALTH',
              signalReason: { in: ['unassessed'] },
              resolvedAt: null,
            }),
          })
        );
      });

      it('creates awaiting-plan signals for responders', async () => {
        const db = getDb();
        const payload: SignalTriggerPayload = {
          trigger: 'assessment-verified',
          entityId: 'entity-1',
          incidentId: 'incident-1',
          assessmentId: 'assessment-1',
          assessmentType: 'HEALTH',
          assessmentPriority: 'HIGH',
        };

        await ActionSignalService.evaluateAndGenerate(payload);

        expect(db.actionSignal.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              userId: 'responder-1',
              entityId: 'entity-1',
              incidentId: 'incident-1',
              type: 'HEALTH',
              signalReason: 'awaiting-plan',
              priority: 'HIGH',
            }),
          })
        );
      });

      it('creates assessment-needs-response signals for donors', async () => {
        const db = getDb();
        const payload: SignalTriggerPayload = {
          trigger: 'assessment-verified',
          entityId: 'entity-1',
          incidentId: 'incident-1',
          assessmentId: 'assessment-1',
          assessmentType: 'HEALTH',
          assessmentPriority: 'MEDIUM',
        };

        await ActionSignalService.evaluateAndGenerate(payload);

        expect(db.actionSignal.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              userId: 'donor-1',
              entityId: 'entity-1',
              incidentId: 'incident-1',
              type: 'HEALTH',
              signalReason: 'assessment-needs-response',
              priority: 'MEDIUM',
            }),
          })
        );
      });

      it('resolves existing awaiting-plan signals for all users', async () => {
        const db = getDb();
        const payload: SignalTriggerPayload = {
          trigger: 'assessment-verified',
          entityId: 'entity-1',
          incidentId: 'incident-1',
          assessmentId: 'assessment-1',
          assessmentType: 'HEALTH',
        };

        await ActionSignalService.evaluateAndGenerate(payload);

        const awaitingPlanCalls = db.actionSignal.updateMany.mock.calls.filter(
          (call: any[]) =>
            call[0]?.where?.signalReason === 'awaiting-plan'
        );
        expect(awaitingPlanCalls.length).toBeGreaterThanOrEqual(1);
        expect(awaitingPlanCalls[0][0].where).toMatchObject({
          entityId: 'entity-1',
          signalReason: 'awaiting-plan',
          resolvedAt: null,
        });
      });

      it('creates notification for each new signal', async () => {
        const db = getDb();
        const payload: SignalTriggerPayload = {
          trigger: 'assessment-verified',
          entityId: 'entity-1',
          incidentId: 'incident-1',
          assessmentId: 'assessment-1',
          assessmentType: 'HEALTH',
        };

        await ActionSignalService.evaluateAndGenerate(payload);

        expect(db.notification.create).toHaveBeenCalled();
      });
    });

    describe('assessment-created', () => {
      it('resolves unassessed signals for assessors', async () => {
        const db = getDb();
        const payload: SignalTriggerPayload = {
          trigger: 'assessment-created',
          entityId: 'entity-1',
          incidentId: 'incident-1',
          assessmentId: 'assessment-2',
          assessmentType: 'HEALTH',
        };

        await ActionSignalService.evaluateAndGenerate(payload);

        expect(db.actionSignal.updateMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              userId: 'assessor-1',
              signalReason: { in: ['unassessed'] },
              resolvedAt: null,
            }),
          })
        );
      });

      it('does not create awaiting-plan signals on assessment-created', async () => {
        const db = getDb();
        const payload: SignalTriggerPayload = {
          trigger: 'assessment-created',
          entityId: 'entity-1',
          incidentId: 'incident-1',
          assessmentId: 'assessment-2',
          assessmentType: 'HEALTH',
        };

        await ActionSignalService.evaluateAndGenerate(payload);

        const createCalls = db.actionSignal.create.mock.calls;
        const awaitingPlanCreates = createCalls.filter(
          (call: any[]) => call[0]?.data?.signalReason === 'awaiting-plan'
        );
        expect(awaitingPlanCreates).toHaveLength(0);
      });
    });

    describe('upsert behavior', () => {
      it('updates existing signal instead of creating duplicate', async () => {
        const db = getDb();
        const existingSignal = { id: 'existing-signal-1' };
        db.actionSignal.findFirst.mockResolvedValue(existingSignal);

        const payload: SignalTriggerPayload = {
          trigger: 'assessment-verified',
          entityId: 'entity-1',
          incidentId: 'incident-1',
          assessmentId: 'assessment-1',
          assessmentType: 'HEALTH',
          assessmentPriority: 'CRITICAL',
        };

        await ActionSignalService.evaluateAndGenerate(payload);

        const responderUpserts = db.actionSignal.update.mock.calls.filter(
          (call: any[]) => call[0]?.where?.id === 'existing-signal-1'
        );
        expect(responderUpserts.length).toBeGreaterThanOrEqual(1);
        expect(responderUpserts[0][0].data.priority).toBe('CRITICAL');
      });

      it('creates new signal when no existing unresolved signal found', async () => {
        const db = getDb();
        db.actionSignal.findFirst.mockResolvedValue(null);

        const payload: SignalTriggerPayload = {
          trigger: 'assessment-verified',
          entityId: 'entity-1',
          incidentId: 'incident-1',
          assessmentId: 'assessment-1',
          assessmentType: 'HEALTH',
        };

        await ActionSignalService.evaluateAndGenerate(payload);

        expect(db.actionSignal.create).toHaveBeenCalled();
      });
    });

    describe('priority derivation', () => {
      it('uses CRITICAL priority for POPULATION assessment type', async () => {
        const db = getDb();
        db.rapidAssessment.findFirst.mockResolvedValue(null);
        db.incident.findUnique.mockResolvedValue({ severity: 'LOW' });

        const payload: SignalTriggerPayload = {
          trigger: 'assessment-verified',
          entityId: 'entity-1',
          incidentId: 'incident-1',
          assessmentId: 'assessment-1',
          assessmentType: 'HEALTH',
        };

        await ActionSignalService.evaluateAndGenerate(payload);

        const populationSignalCalls = db.actionSignal.create.mock.calls.filter(
          (call: any[]) => call[0]?.data?.type === 'POPULATION'
        );
        expect(populationSignalCalls.length).toBeGreaterThanOrEqual(1);
        expect(populationSignalCalls[0][0].data.priority).toBe('CRITICAL');
      });

      it('maps incident severity to signal priority', async () => {
        const db = getDb();
        db.incident.findUnique.mockResolvedValue({ severity: 'CRITICAL' });

        const payload: SignalTriggerPayload = {
          trigger: 'assessment-verified',
          entityId: 'entity-1',
          incidentId: 'incident-1',
          assessmentId: 'assessment-1',
          assessmentType: 'HEALTH',
          assessmentPriority: 'CRITICAL',
        };

        await ActionSignalService.evaluateAndGenerate(payload);

        const highPriorityCreates = db.actionSignal.create.mock.calls.filter(
          (call: any[]) => call[0]?.data?.priority === 'CRITICAL'
        );
        expect(highPriorityCreates.length).toBeGreaterThanOrEqual(1);
      });

      it('defaults to MEDIUM when no incident severity found', async () => {
        const db = getDb();
        db.incident.findUnique.mockResolvedValue(null);

        const payload: SignalTriggerPayload = {
          trigger: 'assessment-verified',
          entityId: 'entity-1',
          incidentId: 'incident-1',
          assessmentId: 'assessment-1',
          assessmentType: 'HEALTH',
        };

        await ActionSignalService.evaluateAndGenerate(payload);

        const unassessedCreates = db.actionSignal.create.mock.calls.filter(
          (call: any[]) => call[0]?.data?.signalReason === 'unassessed' && call[0]?.data?.type !== 'POPULATION'
        );

        for (const call of unassessedCreates) {
          expect(call[0].data.priority).toBe('MEDIUM');
        }
      });
    });

    it('returns early when entityId is missing', async () => {
      const db = getDb();
      const payload: SignalTriggerPayload = {
        trigger: 'assessment-verified',
        entityId: '',
        incidentId: 'incident-1',
      };

      await ActionSignalService.evaluateAndGenerate(payload);

      expect(db.entityAssignment.findMany).not.toHaveBeenCalled();
    });

    it('returns early when entity not found', async () => {
      const db = getDb();
      db.entity.findUnique.mockResolvedValue(null);

      const payload: SignalTriggerPayload = {
        trigger: 'assessment-verified',
        entityId: 'entity-1',
        incidentId: 'incident-1',
        assessmentType: 'HEALTH',
      };

      await ActionSignalService.evaluateAndGenerate(payload);

      expect(db.actionSignal.create).not.toHaveBeenCalled();
    });
  });

  describe('evaluateAndGenerate — Response Triggers', () => {
    describe('response-created', () => {
      it('resolves awaiting-plan signals globally for the entity', async () => {
        const db = getDb();
        const payload: SignalTriggerPayload = {
          trigger: 'response-created',
          entityId: 'entity-1',
          incidentId: 'incident-1',
          responseId: 'response-1',
          responseType: 'HEALTH',
        };

        await ActionSignalService.evaluateAndGenerate(payload);

        const globalResolveCalls = db.actionSignal.updateMany.mock.calls.filter(
          (call: any[]) =>
            call[0]?.where?.entityId === 'entity-1' &&
            call[0]?.where?.signalReason === 'awaiting-plan'
        );
        expect(globalResolveCalls.length).toBeGreaterThanOrEqual(1);
      });

      it('resolves awaiting-plan signals for assigned assessors', async () => {
        const db = getDb();
        const payload: SignalTriggerPayload = {
          trigger: 'response-created',
          entityId: 'entity-1',
          incidentId: 'incident-1',
          responseId: 'response-1',
          responseType: 'HEALTH',
        };

        await ActionSignalService.evaluateAndGenerate(payload);

        const assessorResolveCalls = db.actionSignal.updateMany.mock.calls.filter(
          (call: any[]) =>
            call[0]?.where?.userId === 'assessor-1'
        );
        expect(assessorResolveCalls.length).toBeGreaterThanOrEqual(1);
      });
    });

    describe('response-delivered', () => {
      it('resolves awaiting-delivery signals for responders', async () => {
        const db = getDb();
        const payload: SignalTriggerPayload = {
          trigger: 'response-delivered',
          entityId: 'entity-1',
          incidentId: 'incident-1',
          responseId: 'response-1',
          responseType: 'HEALTH',
        };

        await ActionSignalService.evaluateAndGenerate(payload);

        const resolveCalls = db.actionSignal.updateMany.mock.calls.filter(
          (call: any[]) =>
            call[0]?.where?.userId === 'responder-1' &&
            call[0]?.where?.signalReason?.in &&
            call[0]?.where?.signalReason?.in.includes('awaiting-delivery')
        );
        expect(resolveCalls.length).toBeGreaterThanOrEqual(1);
      });

      it('resolves partially-covered signals for responders', async () => {
        const db = getDb();
        const payload: SignalTriggerPayload = {
          trigger: 'response-delivered',
          entityId: 'entity-1',
          incidentId: 'incident-1',
          responseId: 'response-1',
          responseType: 'HEALTH',
        };

        await ActionSignalService.evaluateAndGenerate(payload);

        const resolveCalls = db.actionSignal.updateMany.mock.calls.filter(
          (call: any[]) =>
            call[0]?.where?.userId === 'responder-1' &&
            call[0]?.where?.signalReason?.in &&
            call[0]?.where?.signalReason?.in.includes('partially-covered')
        );
        expect(resolveCalls.length).toBeGreaterThanOrEqual(1);
      });
    });

    describe('response-verified', () => {
      it('creates reassessment-needed signal when no subsequent assessment exists', async () => {
        const db = getDb();
        db.rapidAssessment.findFirst.mockResolvedValue(null);

        const payload: SignalTriggerPayload = {
          trigger: 'response-verified',
          entityId: 'entity-1',
          incidentId: 'incident-1',
          responseId: 'response-1',
          responseType: 'HEALTH',
          responsePriority: 'HIGH',
        };

        await ActionSignalService.evaluateAndGenerate(payload);

        const reassessCalls = db.actionSignal.create.mock.calls.filter(
          (call: any[]) => call[0]?.data?.signalReason === 'reassessment-needed'
        );
        expect(reassessCalls.length).toBeGreaterThanOrEqual(1);
        expect(reassessCalls[0][0].data).toMatchObject({
          userId: 'assessor-1',
          entityId: 'entity-1',
          incidentId: 'incident-1',
          type: 'HEALTH',
          signalReason: 'reassessment-needed',
          priority: 'HIGH',
        });
      });

      it('skips reassessment-needed when subsequent assessment exists', async () => {
        const db = getDb();
        db.rapidAssessment.findFirst.mockResolvedValue({ id: 'subsequent-assessment' });

        const payload: SignalTriggerPayload = {
          trigger: 'response-verified',
          entityId: 'entity-1',
          incidentId: 'incident-1',
          responseId: 'response-1',
          responseType: 'HEALTH',
        };

        await ActionSignalService.evaluateAndGenerate(payload);

        const reassessCalls = db.actionSignal.create.mock.calls.filter(
          (call: any[]) => call[0]?.data?.signalReason === 'reassessment-needed'
        );
        expect(reassessCalls).toHaveLength(0);
      });

      it('defaults priority to MEDIUM when responsePriority is not set', async () => {
        const db = getDb();
        db.rapidAssessment.findFirst.mockResolvedValue(null);

        const payload: SignalTriggerPayload = {
          trigger: 'response-verified',
          entityId: 'entity-1',
          incidentId: 'incident-1',
          responseId: 'response-1',
          responseType: 'HEALTH',
        };

        await ActionSignalService.evaluateAndGenerate(payload);

        const reassessCalls = db.actionSignal.create.mock.calls.filter(
          (call: any[]) => call[0]?.data?.signalReason === 'reassessment-needed'
        );
        expect(reassessCalls[0][0].data.priority).toBe('MEDIUM');
      });

      it('resolves awaiting-delivery and partially-covered for responders on verification', async () => {
        const db = getDb();
        db.rapidAssessment.findFirst.mockResolvedValue({ id: 'existing-assessment' });

        const payload: SignalTriggerPayload = {
          trigger: 'response-verified',
          entityId: 'entity-1',
          incidentId: 'incident-1',
          responseId: 'response-1',
          responseType: 'HEALTH',
        };

        await ActionSignalService.evaluateAndGenerate(payload);

        const resolveCalls = db.actionSignal.updateMany.mock.calls.filter(
          (call: any[]) =>
            call[0]?.where?.userId === 'responder-1' &&
            call[0]?.where?.signalReason?.in
        );
        expect(resolveCalls.length).toBeGreaterThanOrEqual(1);
        const reasons = resolveCalls[0][0].where.signalReason.in;
        expect(reasons).toContain('awaiting-delivery');
        expect(reasons).toContain('partially-covered');
      });
    });

    it('returns early when entityId is missing', async () => {
      const db = getDb();
      const payload: SignalTriggerPayload = {
        trigger: 'response-created',
        entityId: '',
        incidentId: 'incident-1',
      };

      await ActionSignalService.evaluateAndGenerate(payload);

      expect(db.entity.findUnique).not.toHaveBeenCalled();
    });

    it('returns early when entity not found', async () => {
      const db = getDb();
      db.entity.findUnique.mockResolvedValue(null);

      const payload: SignalTriggerPayload = {
        trigger: 'response-created',
        entityId: 'entity-1',
        incidentId: 'incident-1',
        responseType: 'HEALTH',
      };

      await ActionSignalService.evaluateAndGenerate(payload);

      expect(db.actionSignal.create).not.toHaveBeenCalled();
    });
  });

  describe('evaluateAndGenerate — Commitment Triggers', () => {
    const mockCommitment = {
      id: 'commitment-1',
      incidentId: 'incident-1',
      donorId: 'donor-user-1',
      donor: { id: 'donor-user-1', name: 'Donor Org' },
      planCommitments: [],
    };

    beforeEach(() => {
      getDb().donorCommitment.findUnique.mockResolvedValue(mockCommitment);
    });

    it('creates awaiting-plan-for-commitment for responders', async () => {
      const db = getDb();
      const payload: SignalTriggerPayload = {
        trigger: 'commitment-created',
        entityId: 'entity-1',
        incidentId: 'incident-1',
        commitmentId: 'commitment-1',
        donorId: 'donor-user-1',
      };

      await ActionSignalService.evaluateAndGenerate(payload);

      const responderCalls = db.actionSignal.create.mock.calls.filter(
        (call: any[]) =>
          call[0]?.data?.userId === 'responder-1' &&
          call[0]?.data?.signalReason === 'awaiting-plan-for-commitment'
      );
      expect(responderCalls.length).toBe(1);
      expect(responderCalls[0][0].data).toMatchObject({
        entityId: 'entity-1',
        incidentId: 'incident-1',
        type: 'COMMITMENT',
        signalReason: 'awaiting-plan-for-commitment',
        priority: 'HIGH',
      });
    });

    it('creates commitment-awaiting-plan for the donor', async () => {
      const db = getDb();
      const payload: SignalTriggerPayload = {
        trigger: 'commitment-created',
        entityId: 'entity-1',
        incidentId: 'incident-1',
        commitmentId: 'commitment-1',
        donorId: 'donor-user-1',
      };

      await ActionSignalService.evaluateAndGenerate(payload);

      const donorCalls = db.actionSignal.create.mock.calls.filter(
        (call: any[]) =>
          call[0]?.data?.userId === 'donor-user-1' &&
          call[0]?.data?.signalReason === 'commitment-awaiting-plan'
      );
      expect(donorCalls.length).toBe(1);
      expect(donorCalls[0][0].data).toMatchObject({
        entityId: 'entity-1',
        incidentId: 'incident-1',
        type: 'COMMITMENT',
        signalReason: 'commitment-awaiting-plan',
      });
    });

    it('skips signal creation when commitment already has linked plan', async () => {
      const db = getDb();
      db.donorCommitment.findUnique.mockResolvedValue({
        ...mockCommitment,
        planCommitments: [{ planId: 'plan-1' }],
      });

      const payload: SignalTriggerPayload = {
        trigger: 'commitment-created',
        entityId: 'entity-1',
        incidentId: 'incident-1',
        commitmentId: 'commitment-1',
        donorId: 'donor-user-1',
      };

      await ActionSignalService.evaluateAndGenerate(payload);

      expect(db.actionSignal.create).not.toHaveBeenCalled();
    });

    it('returns early when commitmentId is missing', async () => {
      const db = getDb();
      const payload: SignalTriggerPayload = {
        trigger: 'commitment-created',
        entityId: 'entity-1',
        incidentId: 'incident-1',
      };

      await ActionSignalService.evaluateAndGenerate(payload);

      expect(db.donorCommitment.findUnique).not.toHaveBeenCalled();
    });

    it('returns early when commitment not found', async () => {
      const db = getDb();
      db.donorCommitment.findUnique.mockResolvedValue(null);

      const payload: SignalTriggerPayload = {
        trigger: 'commitment-created',
        entityId: 'entity-1',
        incidentId: 'incident-1',
        commitmentId: 'commitment-1',
      };

      await ActionSignalService.evaluateAndGenerate(payload);

      expect(db.actionSignal.create).not.toHaveBeenCalled();
    });

    it('uses severity-derived priority for commitment signals', async () => {
      const db = getDb();
      db.incident.findUnique.mockResolvedValue({ severity: 'CRITICAL' });

      const payload: SignalTriggerPayload = {
        trigger: 'commitment-created',
        entityId: 'entity-1',
        incidentId: 'incident-1',
        commitmentId: 'commitment-1',
        donorId: 'donor-user-1',
      };

      await ActionSignalService.evaluateAndGenerate(payload);

      const responderCalls = db.actionSignal.create.mock.calls.filter(
        (call: any[]) => call[0]?.data?.signalReason === 'awaiting-plan-for-commitment'
      );
      expect(responderCalls[0][0].data.priority).toBe('CRITICAL');
    });

    it('handles commitment-updated trigger identically', async () => {
      const db = getDb();
      const payload: SignalTriggerPayload = {
        trigger: 'commitment-updated',
        entityId: 'entity-1',
        incidentId: 'incident-1',
        commitmentId: 'commitment-1',
        donorId: 'donor-user-1',
      };

      await ActionSignalService.evaluateAndGenerate(payload);

      expect(db.actionSignal.create).toHaveBeenCalled();
      const responderCalls = db.actionSignal.create.mock.calls.filter(
        (call: any[]) => call[0]?.data?.signalReason === 'awaiting-plan-for-commitment'
      );
      expect(responderCalls.length).toBe(1);
    });
  });

  describe('getActiveSignals', () => {
    const mockSignals = [
      {
        id: 'sig-1',
        userId: 'user-1',
        entityId: 'entity-1',
        incidentId: 'incident-1',
        type: 'HEALTH',
        signalReason: 'awaiting-plan',
        priority: 'HIGH',
        context: { entityName: 'Entity One' },
        createdAt: new Date('2024-01-01'),
        resolvedAt: null,
        entity: { id: 'entity-1', name: 'Entity One', type: 'SCHOOL', location: 'City', coordinates: null },
        incident: { id: 'incident-1', name: 'Incident One', severity: 'HIGH' },
      },
      {
        id: 'sig-2',
        userId: 'user-1',
        entityId: 'entity-1',
        incidentId: 'incident-1',
        type: 'WASH',
        signalReason: 'unassessed',
        priority: 'MEDIUM',
        context: { entityName: 'Entity One' },
        createdAt: new Date('2024-01-02'),
        resolvedAt: null,
        entity: { id: 'entity-1', name: 'Entity One', type: 'SCHOOL', location: 'City', coordinates: null },
        incident: { id: 'incident-1', name: 'Incident One', severity: 'HIGH' },
      },
    ];

    beforeEach(() => {
      const db = getDb();
      db.actionSignal.findMany.mockResolvedValue(mockSignals);
      db.actionSignal.count.mockImplementation((args: any) => {
        if (args?.where?.priority === 'CRITICAL') return 1;
        if (args?.where?.resolvedAt === null) return 2;
        return 3;
      });
    });

    it('returns mapped signals with entity and incident data', async () => {
      const result = await ActionSignalService.getActiveSignals('user-1', ['ADMIN'], {
        page: 1,
        limit: 50,
        unresolvedOnly: true,
        grouped: false,
      });

      expect(result.signals).toHaveLength(2);
      expect(result.signals[0]).toMatchObject({
        id: 'sig-1',
        entityId: 'entity-1',
        type: 'HEALTH',
        signalReason: 'awaiting-plan',
        priority: 'HIGH',
        entity: { name: 'Entity One' },
        incident: { severity: 'HIGH' },
      });
    });

    it('filters by assigned entities for non-admin roles', async () => {
      const db = getDb();
      db.entityAssignment.findMany.mockResolvedValue([
        { entityId: 'entity-1' },
        { entityId: 'entity-2' },
      ]);

      await ActionSignalService.getActiveSignals('user-1', ['RESPONDER'], {
        page: 1,
        limit: 50,
        unresolvedOnly: true,
        grouped: false,
      });

      expect(db.entityAssignment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1' },
        })
      );

      const findManyCall = db.actionSignal.findMany.mock.calls[0][0];
      expect(findManyCall.where.entityId).toEqual({ in: ['entity-1', 'entity-2'] });
    });

    it('does not filter by assigned entities for admin roles', async () => {
      const db = getDb();

      await ActionSignalService.getActiveSignals('admin-1', ['ADMIN'], {
        page: 1,
        limit: 50,
        unresolvedOnly: true,
        grouped: false,
      });

      expect(db.entityAssignment.findMany).not.toHaveBeenCalled();
    });

    it('does not filter by assigned entities for coordinator roles', async () => {
      const db = getDb();

      await ActionSignalService.getActiveSignals('coord-1', ['COORDINATOR'], {
        page: 1,
        limit: 50,
        unresolvedOnly: true,
        grouped: false,
      });

      expect(db.entityAssignment.findMany).not.toHaveBeenCalled();
    });

    it('supports grouped mode returning SignalGroup[]', async () => {
      const result = await ActionSignalService.getActiveSignals('user-1', ['ADMIN'], {
        page: 1,
        limit: 50,
        unresolvedOnly: true,
        grouped: true,
      });

      expect(result.groups.length).toBeGreaterThan(0);
      expect(result.groups[0]).toMatchObject({
        entityId: 'entity-1',
        type: expect.any(String),
        signals: expect.any(Array),
        count: expect.any(Number),
        highestPriority: expect.any(String),
      });
    });

    it('returns correct counts for total, unresolved, and critical', async () => {
      const result = await ActionSignalService.getActiveSignals('user-1', ['ADMIN'], {
        page: 1,
        limit: 50,
        unresolvedOnly: true,
        grouped: false,
      });

      expect(result.totalCount).toBe(2);
      expect(result.unresolvedCount).toBe(2);
      expect(result.criticalCount).toBe(1);
    });

    it('applies pagination with skip and take', async () => {
      const db = getDb();

      await ActionSignalService.getActiveSignals('user-1', ['ADMIN'], {
        page: 2,
        limit: 10,
        unresolvedOnly: false,
        grouped: false,
      });

      const findManyCall = db.actionSignal.findMany.mock.calls[0][0];
      expect(findManyCall.skip).toBe(10);
      expect(findManyCall.take).toBe(10);
    });

    it('applies entityId filter when provided', async () => {
      const db = getDb();

      await ActionSignalService.getActiveSignals('user-1', ['ADMIN'], {
        page: 1,
        limit: 50,
        unresolvedOnly: true,
        grouped: false,
        entityId: 'entity-1',
      });

      const findManyCall = db.actionSignal.findMany.mock.calls[0][0];
      expect(findManyCall.where.entityId).toBe('entity-1');
    });

    it('applies signalReason filter when provided', async () => {
      const db = getDb();

      await ActionSignalService.getActiveSignals('user-1', ['ADMIN'], {
        page: 1,
        limit: 50,
        unresolvedOnly: true,
        grouped: false,
        signalReason: 'awaiting-plan',
      });

      const findManyCall = db.actionSignal.findMany.mock.calls[0][0];
      expect(findManyCall.where.signalReason).toBe('awaiting-plan');
    });
  });

  describe('groupSignals', () => {
    const makeSignal = (
      entityId: string,
      type: string,
      priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW',
      entityName = 'Test Entity'
    ) => ({
      id: `sig-${entityId}-${type}-${priority}`,
      userId: 'user-1',
      entityId,
      incidentId: 'incident-1',
      type,
      signalReason: 'unassessed' as const,
      priority,
      context: {},
      createdAt: new Date(),
      resolvedAt: null,
      entity: {
        id: entityId,
        name: entityName,
        type: 'SCHOOL',
        location: null,
        coordinates: null,
      },
      incident: {
        id: 'incident-1',
        name: 'Incident One',
        severity: 'HIGH',
      },
    });

    it('groups signals by entityId:type', () => {
      const signals = [
        makeSignal('entity-1', 'HEALTH', 'HIGH'),
        makeSignal('entity-1', 'HEALTH', 'MEDIUM'),
        makeSignal('entity-1', 'WASH', 'LOW'),
        makeSignal('entity-2', 'HEALTH', 'CRITICAL'),
      ];

      const groups = ActionSignalService.groupSignals(signals);

      expect(groups).toHaveLength(3);

      const healthEntity1 = groups.find(g => g.entityId === 'entity-1' && g.type === 'HEALTH');
      expect(healthEntity1).toBeDefined();
      expect(healthEntity1!.count).toBe(2);
      expect(healthEntity1!.signals).toHaveLength(2);

      const washEntity1 = groups.find(g => g.entityId === 'entity-1' && g.type === 'WASH');
      expect(washEntity1).toBeDefined();
      expect(washEntity1!.count).toBe(1);

      const healthEntity2 = groups.find(g => g.entityId === 'entity-2' && g.type === 'HEALTH');
      expect(healthEntity2).toBeDefined();
      expect(healthEntity2!.count).toBe(1);
    });

    it('computes highestPriority per group', () => {
      const signals = [
        makeSignal('entity-1', 'HEALTH', 'LOW'),
        makeSignal('entity-1', 'HEALTH', 'CRITICAL'),
        makeSignal('entity-1', 'HEALTH', 'MEDIUM'),
      ];

      const groups = ActionSignalService.groupSignals(signals);

      expect(groups).toHaveLength(1);
      expect(groups[0].highestPriority).toBe('CRITICAL');
    });

    it('sorts groups by priority rank descending', () => {
      const signals = [
        makeSignal('entity-a', 'HEALTH', 'LOW'),
        makeSignal('entity-b', 'HEALTH', 'CRITICAL'),
        makeSignal('entity-c', 'HEALTH', 'MEDIUM'),
      ];

      const groups = ActionSignalService.groupSignals(signals);

      expect(groups).toHaveLength(3);
      expect(groups[0].entityId).toBe('entity-b');
      expect(groups[0].highestPriority).toBe('CRITICAL');
      expect(groups[1].entityId).toBe('entity-c');
      expect(groups[1].highestPriority).toBe('MEDIUM');
      expect(groups[2].entityId).toBe('entity-a');
      expect(groups[2].highestPriority).toBe('LOW');
    });

    it('returns empty array for empty signals', () => {
      const groups = ActionSignalService.groupSignals([]);
      expect(groups).toEqual([]);
    });

    it('includes entity metadata in each group', () => {
      const signals = [
        makeSignal('entity-1', 'HEALTH', 'HIGH', 'My School'),
      ];

      const groups = ActionSignalService.groupSignals(signals);

      expect(groups[0].entityName).toBe('My School');
      expect(groups[0].entityType).toBe('SCHOOL');
      expect(groups[0].entityLocation).toBeNull();
      expect(groups[0].entityCoordinates).toBeNull();
    });
  });

  describe('evaluateAndGenerate — Edge Cases', () => {
    it('handles assessment-rejected trigger without error', async () => {
      const db = getDb();
      const payload: SignalTriggerPayload = {
        trigger: 'assessment-rejected',
        entityId: 'entity-1',
        incidentId: 'incident-1',
      };

      await expect(
        ActionSignalService.evaluateAndGenerate(payload)
      ).resolves.toBeUndefined();

      expect(db.actionSignal.create).not.toHaveBeenCalled();
    });

    it('handles response-rejected trigger by dispatching to response handler', async () => {
      const db = getDb();
      const payload: SignalTriggerPayload = {
        trigger: 'response-rejected',
        entityId: 'entity-1',
        incidentId: 'incident-1',
        responseType: 'HEALTH',
      };

      await ActionSignalService.evaluateAndGenerate(payload);

      expect(db.entity.findUnique).toHaveBeenCalled();
    });

    it('uses transaction when provided', async () => {
      const db = getDb();
      const mockTx = {
        entityAssignment: { findMany: jest.fn().mockResolvedValue(ASSIGNEES_ALL_ROLES) },
        entity: { findUnique: jest.fn().mockResolvedValue(BASE_ENTITY) },
        incident: { findUnique: jest.fn().mockResolvedValue(BASE_INCIDENT) },
        rapidAssessment: { findFirst: jest.fn().mockResolvedValue(null) },
        actionSignal: {
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({ id: 'tx-signal-1' }),
          update: jest.fn().mockResolvedValue({ id: 'tx-signal-updated' }),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          findMany: jest.fn().mockResolvedValue([]),
          count: jest.fn().mockResolvedValue(0),
        },
        notification: { create: jest.fn().mockResolvedValue({ id: 'notif-1' }) },
        donorCommitment: { findUnique: jest.fn().mockResolvedValue(null) },
      };

      const payload: SignalTriggerPayload = {
        trigger: 'assessment-verified',
        entityId: 'entity-1',
        incidentId: 'incident-1',
        assessmentId: 'assessment-1',
        assessmentType: 'HEALTH',
        assessmentPriority: 'HIGH',
      };

      await ActionSignalService.evaluateAndGenerate(payload, mockTx as any);

      expect(mockTx.actionSignal.create).toHaveBeenCalled();
      expect(db.actionSignal.create).not.toHaveBeenCalled();
    });

    it('swallows errors in evaluateAndGenerate without throwing', async () => {
      const db = getDb();
      db.entityAssignment.findMany.mockRejectedValue(new Error('DB error'));

      const payload: SignalTriggerPayload = {
        trigger: 'assessment-verified',
        entityId: 'entity-1',
        incidentId: 'incident-1',
        assessmentType: 'HEALTH',
      };

      const originalError = console.error;
      console.error = jest.fn();

      await expect(
        ActionSignalService.evaluateAndGenerate(payload)
      ).resolves.toBeUndefined();

      expect(console.error).toHaveBeenCalled();
      console.error = originalError;
    });
  });
});
