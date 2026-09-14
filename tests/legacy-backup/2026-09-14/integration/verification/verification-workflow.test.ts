import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { db } from '@/lib/db/client';
import { getServerSession } from 'next-auth';
import { NextRequest } from 'next/server';

// Import API handlers
import { GET as getVerificationQueue } from '@/app/api/v1/verification/queue/assessments/route';
import { POST as verifyAssessment } from '@/app/api/v1/assessments/[id]/verify/route';
import { POST as rejectAssessment } from '@/app/api/v1/assessments/[id]/reject/route';
import { GET as getMetrics } from '@/app/api/v1/verification/metrics/route';
import { POST as updateAutoApproval } from '@/app/api/v1/entities/[id]/auto-approval/route';

// Mock authentication
jest.mock('next-auth');
jest.mock('@/lib/auth/config', () => ({ authConfig: {} }));

const mockGetServerSession = getServerSession as jest.Mock;

// Test data
const coordinatorSession = {
  user: { id: 'coordinator-test-1' }
};

const coordinatorUser = {
  id: 'coordinator-test-1',
  name: 'Test Coordinator',
  email: 'coordinator@test.com',
  roles: [{ role: { name: 'COORDINATOR' } }]
};

describe('Verification Workflow Integration Tests', () => {
  beforeEach(async () => {
    // Setup authentication
    mockGetServerSession.mockResolvedValue(coordinatorSession);

    // Clean up test data
    await db.auditLog.deleteMany({
      where: { userId: 'coordinator-test-1' }
    });
    await db.rapidAssessment.deleteMany({
      where: { 
        OR: [
          { assessor: { id: 'assessor-test-1' } },
          { verifiedBy: 'coordinator-test-1' }
        ]
      }
    });
    await db.user.deleteMany({
      where: { id: { in: ['coordinator-test-1', 'assessor-test-1'] } }
    });
    await db.entity.deleteMany({
      where: { id: 'entity-test-1' }
    });

    // Create test users
    await db.user.create({
      data: coordinatorUser
    });

    await db.user.create({
      data: {
        id: 'assessor-test-1',
        name: 'Test Assessor',
        email: 'assessor@test.com',
        roles: {
          create: {
            role: {
              connectOrCreate: {
                where: { name: 'ASSESSOR' },
                create: { name: 'ASSESSOR' }
              }
            }
          }
        }
      }
    });

    // Create test entity
    await db.entity.create({
      data: {
        id: 'entity-test-1',
        name: 'Test Health Center',
        type: 'HEALTH_FACILITY',
        location: 'Test Location',
        geoLocation: {
          latitude: 0,
          longitude: 0
        },
        metadata: {},
        autoApproveEnabled: false
      }
    });
  });

  afterEach(async () => {
    // Clean up test data
    await db.auditLog.deleteMany({
      where: { userId: 'coordinator-test-1' }
    });
    await db.rapidAssessment.deleteMany({
      where: { 
        OR: [
          { assessor: { id: 'assessor-test-1' } },
          { verifiedBy: 'coordinator-test-1' }
        ]
      }
    });
    await db.user.deleteMany({
      where: { id: { in: ['coordinator-test-1', 'assessor-test-1'] } }
    });
    await db.entity.deleteMany({
      where: { id: 'entity-test-1' }
    });
  });

  describe('Complete Assessment Verification Workflow', () => {
    it('should handle full verification workflow from submission to approval', async () => {
      // Step 1: Create a submitted assessment
      const assessment = await db.rapidAssessment.create({
        data: {
          rapidAssessmentType: 'HEALTH',
          rapidAssessmentDate: new Date(),
          verificationStatus: 'SUBMITTED',
          priority: 'HIGH',
          assessmentData: { healthFacilityCapacity: 100 },
          entityId: 'entity-test-1',
          assessorId: 'assessor-test-1'
        }
      });

      // Step 2: Verify queue shows the assessment
      const queueRequest = new NextRequest('http://localhost/api/v1/verification/queue/assessments?status=SUBMITTED');
      const queueResponse = await getVerificationQueue(queueRequest);
      
      expect(queueResponse.status).toBe(200);
      const queueData = await queueResponse.json();
      expect(queueData.success).toBe(true);
      expect(queueData.data).toHaveLength(1);
      expect(queueData.data[0].id).toBe(assessment.id);

      // Step 3: Verify the assessment
      const verifyRequest = new NextRequest(`http://localhost/api/v1/assessments/${assessment.id}/verify`, {
        method: 'POST',
        body: JSON.stringify({ notes: 'Assessment approved - all data complete' })
      });

      const verifyResponse = await verifyAssessment(verifyRequest, { params: { id: assessment.id } });
      
      expect(verifyResponse.status).toBe(200);
      const verifyData = await verifyResponse.json();
      expect(verifyData.success).toBe(true);
      expect(verifyData.data.verificationStatus).toBe('VERIFIED');
      expect(verifyData.data.verifiedBy).toBe('coordinator-test-1');

      // Step 4: Verify audit log was created
      const auditLogs = await db.auditLog.findMany({
        where: {
          userId: 'coordinator-test-1',
          action: 'VERIFY_ASSESSMENT'
        }
      });
      expect(auditLogs).toHaveLength(1);
      expect(auditLogs[0].resourceId).toBe(assessment.id);

      // Step 5: Verify metrics are updated
      const metricsRequest = new NextRequest('http://localhost/api/v1/verification/metrics');
      const metricsResponse = await getMetrics(metricsRequest);
      
      expect(metricsResponse.status).toBe(200);
      const metricsData = await metricsResponse.json();
      expect(metricsData.success).toBe(true);
      expect(metricsData.data.totalVerified).toBe(1);
      expect(metricsData.data.totalPending).toBe(0);

      // Step 6: Verify queue no longer shows the assessment
      const updatedQueueResponse = await getVerificationQueue(queueRequest);
      const updatedQueueData = await updatedQueueResponse.json();
      expect(updatedQueueData.data).toHaveLength(0);
    });

    it('should handle full rejection workflow with feedback', async () => {
      // Step 1: Create a submitted assessment
      const assessment = await db.rapidAssessment.create({
        data: {
          rapidAssessmentType: 'HEALTH',
          rapidAssessmentDate: new Date(),
          verificationStatus: 'SUBMITTED',
          priority: 'MEDIUM',
          assessmentData: { healthFacilityCapacity: 50 },
          entityId: 'entity-test-1',
          assessorId: 'assessor-test-1'
        }
      });

      // Step 2: Reject the assessment
      const rejectRequest = new NextRequest(`http://localhost/api/v1/assessments/${assessment.id}/reject`, {
        method: 'POST',
        body: JSON.stringify({
          reason: 'INCOMPLETE_DATA',
          feedback: 'Missing critical health facility data points'
        })
      });

      const rejectResponse = await rejectAssessment(rejectRequest, { params: { id: assessment.id } });
      
      expect(rejectResponse.status).toBe(200);
      const rejectData = await rejectResponse.json();
      expect(rejectData.success).toBe(true);
      expect(rejectData.data.verificationStatus).toBe('REJECTED');
      expect(rejectData.data.rejectionReason).toBe('INCOMPLETE_DATA');
      expect(rejectData.data.rejectionFeedback).toBe('Missing critical health facility data points');

      // Step 3: Verify audit log was created
      const auditLogs = await db.auditLog.findMany({
        where: {
          userId: 'coordinator-test-1',
          action: 'REJECT_ASSESSMENT'
        }
      });
      expect(auditLogs).toHaveLength(1);
      expect(auditLogs[0].resourceId).toBe(assessment.id);

      // Step 4: Verify metrics show rejection
      const metricsRequest = new NextRequest('http://localhost/api/v1/verification/metrics');
      const metricsResponse = await getMetrics(metricsRequest);
      
      const metricsData = await metricsResponse.json();
      expect(metricsData.data.totalRejected).toBe(1);
      expect(metricsData.data.rejectionRate).toBeGreaterThan(0);
    });

    it('should handle auto-approval configuration workflow', async () => {
      // Step 1: Configure auto-approval for entity
      const configRequest = new NextRequest(`http://localhost/api/v1/entities/entity-test-1/auto-approval`, {
        method: 'POST',
        body: JSON.stringify({
          enabled: true,
          config: {
            assessmentTypes: ['HEALTH', 'WASH'],
            thresholds: {
              maxValue: 1000000,
              completenessRequired: 0.9
            },
            enabled: true
          }
        })
      });

      const configResponse = await updateAutoApproval(configRequest, { params: { id: 'entity-test-1' } });
      
      expect(configResponse.status).toBe(200);
      const configData = await configResponse.json();
      expect(configData.success).toBe(true);

      // Step 2: Verify entity has auto-approval enabled
      const entity = await db.entity.findUnique({
        where: { id: 'entity-test-1' }
      });
      expect(entity?.autoApproveEnabled).toBe(true);
      expect(entity?.metadata).toHaveProperty('autoApprovalConfig');

      // Step 3: Create assessment that meets auto-approval criteria
      const assessment = await db.rapidAssessment.create({
        data: {
          rapidAssessmentType: 'HEALTH',
          rapidAssessmentDate: new Date(),
          verificationStatus: 'SUBMITTED',
          priority: 'LOW',
          assessmentData: { 
            healthFacilityCapacity: 100,
            completeness: 0.95
          },
          entityId: 'entity-test-1',
          assessorId: 'assessor-test-1'
        }
      });

      // In a real implementation, auto-approval would happen automatically
      // For this test, we simulate the auto-approval process
      await db.rapidAssessment.update({
        where: { id: assessment.id },
        data: {
          verificationStatus: 'AUTO_VERIFIED',
          verifiedAt: new Date(),
          verifiedBy: 'system'
        }
      });

      // Step 4: Verify metrics include auto-verified assessment
      const metricsRequest = new NextRequest('http://localhost/api/v1/verification/metrics');
      const metricsResponse = await getMetrics(metricsRequest);
      
      const metricsData = await metricsResponse.json();
      expect(metricsData.data.totalAutoVerified).toBe(1);
    });
  });

  describe('Concurrent Verification Handling', () => {
    it('should handle concurrent verification attempts gracefully', async () => {
      // Create assessment
      const assessment = await db.rapidAssessment.create({
        data: {
          rapidAssessmentType: 'HEALTH',
          rapidAssessmentDate: new Date(),
          verificationStatus: 'SUBMITTED',
          priority: 'HIGH',
          assessmentData: { healthFacilityCapacity: 100 },
          entityId: 'entity-test-1',
          assessorId: 'assessor-test-1'
        }
      });

      // Simulate concurrent verification attempts
      const verifyRequest1 = new NextRequest(`http://localhost/api/v1/assessments/${assessment.id}/verify`, {
        method: 'POST',
        body: JSON.stringify({ notes: 'First verification' })
      });

      const verifyRequest2 = new NextRequest(`http://localhost/api/v1/assessments/${assessment.id}/verify`, {
        method: 'POST',
        body: JSON.stringify({ notes: 'Second verification' })
      });

      // Execute both requests
      const [response1, response2] = await Promise.all([
        verifyAssessment(verifyRequest1, { params: { id: assessment.id } }),
        verifyAssessment(verifyRequest2, { params: { id: assessment.id } })
      ]);

      // One should succeed, one should fail
      const responses = [response1, response2];
      const successResponses = responses.filter(r => r.status === 200);
      const errorResponses = responses.filter(r => r.status === 400);

      expect(successResponses).toHaveLength(1);
      expect(errorResponses).toHaveLength(1);

      // Verify final state
      const finalAssessment = await db.rapidAssessment.findUnique({
        where: { id: assessment.id }
      });
      expect(finalAssessment?.verificationStatus).toBe('VERIFIED');
    });
  });

  describe('Data Integrity and Validation', () => {
    it('should maintain data integrity across verification operations', async () => {
      // Create multiple assessments with different statuses
      const assessments = await Promise.all([
        db.rapidAssessment.create({
          data: {
            rapidAssessmentType: 'HEALTH',
            rapidAssessmentDate: new Date(),
            verificationStatus: 'SUBMITTED',
            priority: 'HIGH',
            assessmentData: { healthFacilityCapacity: 100 },
            entityId: 'entity-test-1',
            assessorId: 'assessor-test-1'
          }
        }),
        db.rapidAssessment.create({
          data: {
            rapidAssessmentType: 'WASH',
            rapidAssessmentDate: new Date(),
            verificationStatus: 'SUBMITTED',
            priority: 'MEDIUM',
            assessmentData: { waterSystemCapacity: 500 },
            entityId: 'entity-test-1',
            assessorId: 'assessor-test-1'
          }
        })
      ]);

      // Verify first, reject second
      await verifyAssessment(
        new NextRequest(`http://localhost/api/v1/assessments/${assessments[0].id}/verify`, {
          method: 'POST',
          body: JSON.stringify({ notes: 'Approved' })
        }),
        { params: { id: assessments[0].id } }
      );

      await rejectAssessment(
        new NextRequest(`http://localhost/api/v1/assessments/${assessments[1].id}/reject`, {
          method: 'POST',
          body: JSON.stringify({
            reason: 'INCOMPLETE_DATA',
            feedback: 'Missing water quality data'
          })
        }),
        { params: { id: assessments[1].id } }
      );

      // Verify metrics are consistent
      const metricsRequest = new NextRequest('http://localhost/api/v1/verification/metrics');
      const metricsResponse = await getMetrics(metricsRequest);
      const metricsData = await metricsResponse.json();

      expect(metricsData.data.totalVerified).toBe(1);
      expect(metricsData.data.totalRejected).toBe(1);
      expect(metricsData.data.totalPending).toBe(0);

      // Verify audit trail is complete
      const auditLogs = await db.auditLog.findMany({
        where: { userId: 'coordinator-test-1' },
        orderBy: { createdAt: 'asc' }
      });

      expect(auditLogs).toHaveLength(2);
      expect(auditLogs[0].action).toBe('VERIFY_ASSESSMENT');
      expect(auditLogs[1].action).toBe('REJECT_ASSESSMENT');
    });
  });

  describe('Performance and Scalability', () => {
    it('should handle large verification queues efficiently', async () => {
      // Create multiple assessments
      const assessmentPromises = Array.from({ length: 25 }, (_, i) =>
        db.rapidAssessment.create({
          data: {
            rapidAssessmentType: i % 2 === 0 ? 'HEALTH' : 'WASH',
            rapidAssessmentDate: new Date(),
            verificationStatus: 'SUBMITTED',
            priority: ['LOW', 'MEDIUM', 'HIGH'][i % 3] as any,
            assessmentData: { capacity: 100 + i },
            entityId: 'entity-test-1',
            assessorId: 'assessor-test-1'
          }
        })
      );

      await Promise.all(assessmentPromises);

      // Test pagination performance
      const queueRequest = new NextRequest('http://localhost/api/v1/verification/queue/assessments?page=1&limit=10');
      const startTime = Date.now();
      const queueResponse = await getVerificationQueue(queueRequest);
      const endTime = Date.now();

      expect(queueResponse.status).toBe(200);
      const queueData = await queueResponse.json();
      expect(queueData.data).toHaveLength(10);
      expect(queueData.pagination.total).toBe(25);
      expect(queueData.pagination.totalPages).toBe(3);

      // Verify response time is reasonable (under 1 second)
      expect(endTime - startTime).toBeLessThan(1000);
    });
  });
});