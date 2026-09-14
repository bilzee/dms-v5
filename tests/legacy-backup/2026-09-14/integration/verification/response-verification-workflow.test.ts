import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { db } from '@/lib/db/client';
import { getServerSession } from 'next-auth';
import { NextRequest } from 'next/server';

// Import API handlers
import { GET as getResponseVerificationQueue } from '@/app/api/v1/verification/queue/responses/route';
import { POST as verifyResponse } from '@/app/api/v1/responses/[id]/verify/route';
import { POST as rejectResponse } from '@/app/api/v1/responses/[id]/reject/route';
import { GET as getResponseVerificationMetrics } from '@/app/api/v1/verification/metrics/responses/route';
import { POST as updateResponseAutoApproval } from '@/app/api/v1/verification/auto-approval/responses/route';
import { GET as getDonorMetrics } from '@/app/api/v1/donors/metrics/route';

// Mock authentication
jest.mock('next-auth');
jest.mock('@/lib/auth/config', () => ({ authConfig: {} }));

const mockGetServerSession = getServerSession as any;

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

const testDonor = {
  id: 'donor-test-1',
  name: 'Test Medical Supplies Donor',
  contactEmail: 'donor@medical.com',
  createdAt: new Date('2025-01-01')
};

const testEntity = {
  id: 'entity-test-1',
  name: 'Test Health Center',
  type: 'HEALTH_FACILITY',
  location: 'Test Location',
  geoLocation: { latitude: 0, longitude: 0 },
  metadata: {},
  autoApproveEnabled: false
};

const testAssessor = {
  id: 'assessor-test-1',
  name: 'Test Assessor',
  email: 'assessor@test.com'
};

describe('Response Verification Workflow Integration Tests', () => {
  beforeEach(async () => {
    // Setup authentication
    mockGetServerSession.mockResolvedValue(coordinatorSession);

    // Clean up test data
    await db.auditLog.deleteMany({
      where: { userId: 'coordinator-test-1' }
    });
    await db.rapidResponse.deleteMany({
      where: {
        OR: [
          { assessor: { id: 'assessor-test-1' } },
          { verifiedBy: 'coordinator-test-1' }
        ]
      }
    });
    await db.rapidAssessment.deleteMany({
      where: { 
        OR: [
          { assessor: { id: 'assessor-test-1' } },
          { verifiedBy: 'coordinator-test-1' }
        ]
      }
    });
    await db.commitment.deleteMany({
      where: { donorId: 'donor-test-1' }
    });
    await db.user.deleteMany({
      where: { id: { in: ['coordinator-test-1', 'assessor-test-1'] } }
    });
    await db.donor.deleteMany({
      where: { id: 'donor-test-1' }
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

    // Create test donor
    await db.donor.create({
      data: testDonor
    });

    // Create test entity
    await db.entity.create({
      data: testEntity
    });

    // Create test assessor
    await db.user.create({
      data: testAssessor
    });
  });

  afterEach(async () => {
    // Clean up test data
    await db.auditLog.deleteMany({
      where: { userId: 'coordinator-test-1' }
    });
    await db.rapidResponse.deleteMany({
      where: {
        OR: [
          { assessor: { id: 'assessor-test-1' } },
          { verifiedBy: 'coordinator-test-1' }
        ]
      }
    });
    await db.rapidAssessment.deleteMany({
      where: { 
        OR: [
          { assessor: { id: 'assessor-test-1' } },
          { verifiedBy: 'coordinator-test-1' }
        ]
      }
    });
    await db.commitment.deleteMany({
      where: { donorId: 'donor-test-1' }
    });
    await db.user.deleteMany({
      where: { id: { in: ['coordinator-test-1', 'assessor-test-1'] } }
    });
    await db.donor.deleteMany({
      where: { id: 'donor-test-1' }
    });
    await db.entity.deleteMany({
      where: { id: 'entity-test-1' }
    });
  });

  describe('Complete Response Verification Workflow', () => {
    it('should handle full response verification workflow from submission to approval', async () => {
      // Step 1: Create a submitted response
      const response = await db.rapidResponse.create({
        data: {
          responseType: 'HEALTH',
          responseDate: new Date(),
          verificationStatus: 'SUBMITTED',
          priority: 'HIGH',
          responseData: { 
            medicalSupplies: {
              bandages: 100,
              antiseptic: 50,
              painkillers: 200
            }
          },
          entityId: 'entity-test-1',
          assessorId: 'assessor-test-1'
        }
      });

      // Step 2: Verify queue shows the response
      const queueRequest = new NextRequest('http://localhost/api/v1/verification/queue/responses?status=SUBMITTED');
      const queueResponse = await getResponseVerificationQueue(queueRequest);
      
      expect(queueResponse.status).toBe(200);
      const queueData = await queueResponse.json();
      expect(queueData.success).toBe(true);
      expect(queueData.data).toHaveLength(1);
      expect(queueData.data[0].id).toBe(response.id);

      // Step 3: Verify the response
      const verifyRequest = new NextRequest(`http://localhost/api/v1/responses/${response.id}/verify`, {
        method: 'POST',
        body: JSON.stringify({ notes: 'Medical supplies verified - quantities appropriate for facility size' })
      });

      const verifyResponse = await verifyResponse(verifyRequest, { params: { id: response.id } });
      
      expect(verifyResponse.status).toBe(200);
      const verifyData = await verifyResponse.json();
      expect(verifyData.success).toBe(true);
      expect(verifyData.data.verificationStatus).toBe('VERIFIED');
      expect(verifyData.data.verifiedBy).toBe('coordinator-test-1');

      // Step 4: Verify audit log was created
      const auditLogs = await db.auditLog.findMany({
        where: {
          userId: 'coordinator-test-1',
          action: 'VERIFY_RESPONSE'
        }
      });
      expect(auditLogs).toHaveLength(1);
      expect(auditLogs[0].resourceId).toBe(response.id);

      // Step 5: Verify metrics are updated
      const metricsRequest = new NextRequest('http://localhost/api/v1/verification/metrics/responses');
      const metricsResponse = await getResponseVerificationMetrics(metricsRequest);
      
      expect(metricsResponse.status).toBe(200);
      const metricsData = await metricsResponse.json();
      expect(metricsData.success).toBe(true);
      expect(metricsData.data.totalVerified).toBe(1);
      expect(metricsData.data.totalPending).toBe(0);

      // Step 6: Verify queue no longer shows the response
      const updatedQueueResponse = await getResponseVerificationQueue(queueRequest);
      const updatedQueueData = await updatedQueueResponse.json();
      expect(updatedQueueData.data).toHaveLength(0);
    });

    it('should handle full response rejection workflow with feedback', async () => {
      // Step 1: Create a submitted response
      const response = await db.rapidResponse.create({
        data: {
          responseType: 'WASH',
          responseDate: new Date(),
          verificationStatus: 'SUBMITTED',
          priority: 'MEDIUM',
          responseData: { 
            waterSystem: {
              filters: 10,
              purificationTablets: 1000
            }
          },
          entityId: 'entity-test-1',
          assessorId: 'assessor-test-1'
        }
      });

      // Step 2: Reject the response
      const rejectRequest = new NextRequest(`http://localhost/api/v1/responses/${response.id}/reject`, {
        method: 'POST',
        body: JSON.stringify({
          rejectionReason: 'INADEQUATE_SUPPLIES',
          notes: 'Water purification tablets below minimum required quantity for facility population'
        })
      });

      const rejectResponse = await rejectResponse(rejectRequest, { params: { id: response.id } });
      
      expect(rejectResponse.status).toBe(200);
      const rejectData = await rejectResponse.json();
      expect(rejectData.success).toBe(true);
      expect(rejectData.data.verificationStatus).toBe('REJECTED');
      expect(rejectData.data.rejectionReason).toBe('INADEQUATE_SUPPLIES');

      // Step 3: Verify audit log was created
      const auditLogs = await db.auditLog.findMany({
        where: {
          userId: 'coordinator-test-1',
          action: 'REJECT_RESPONSE'
        }
      });
      expect(auditLogs).toHaveLength(1);
      expect(auditLogs[0].resourceId).toBe(response.id);

      // Step 4: Verify metrics show rejection
      const metricsRequest = new NextRequest('http://localhost/api/v1/verification/metrics/responses');
      const metricsResponse = await getResponseVerificationMetrics(metricsRequest);
      
      const metricsData = await metricsResponse.json();
      expect(metricsData.data.totalRejected).toBe(1);
      expect(metricsData.data.rejectionRate).toBeGreaterThan(0);
    });
  });

  describe('Donor Metrics Integration', () => {
    it('should update donor metrics when response is verified', async () => {
      // Create a commitment for the donor
      await db.commitment.create({
        data: {
          donorId: 'donor-test-1',
          totalCommittedQuantity: 500,
          status: 'PLANNED',
          commitmentDate: new Date(),
          items: {
            create: [
              {
                name: 'Medical Supplies',
                unit: 'kits',
                quantity: 500
              }
            ]
          }
        }
      });

      // Create and verify a response
      const response = await db.rapidResponse.create({
        data: {
          responseType: 'HEALTH',
          responseDate: new Date(),
          verificationStatus: 'SUBMITTED',
          priority: 'HIGH',
          responseData: { medicalSupplies: { bandages: 100 } },
          entityId: 'entity-test-1',
          assessorId: 'assessor-test-1'
        }
      });

      // Verify the response
      const verifyRequest = new NextRequest(`http://localhost/api/v1/responses/${response.id}/verify`, {
        method: 'POST',
        body: JSON.stringify({ notes: 'Response verified' })
      });
      await verifyResponse(verifyRequest, { params: { id: response.id } });

      // Check donor metrics
      const donorMetricsRequest = new NextRequest('http://localhost/api/v1/donors/metrics?donorId=donor-test-1');
      const donorMetricsResponse = await getDonorMetrics(donorMetricsRequest);
      
      expect(donorMetricsResponse.status).toBe(200);
      const donorMetricsData = await donorMetricsResponse.json();
      expect(donorMetricsData.success).toBe(true);
      expect(donorMetricsData.data.donors).toHaveLength(1);
      
      const donor = donorMetricsData.data.donors[0];
      expect(donor.metrics.responses.total).toBe(1);
      expect(donor.metrics.responses.verified).toBe(1);
      expect(donor.metrics.responses.verificationRate).toBe(1.0);
      expect(donor.metrics.combined.verifiedActivities).toBe(1);
      expect(donor.metrics.combined.totalActivities).toBe(2); // 1 commitment + 1 response
    });

    it('should calculate combined donor success rate correctly', async () => {
      // Create multiple commitments with different statuses
      await db.commitment.createMany({
        data: [
          {
            donorId: 'donor-test-1',
            totalCommittedQuantity: 100,
            status: 'COMPLETE', // Fulfilled
            commitmentDate: new Date()
          },
          {
            donorId: 'donor-test-1',
            totalCommittedQuantity: 200,
            status: 'PLANNED', // Available
            commitmentDate: new Date()
          }
        ]
      });

      // Create verified and rejected responses
      const [verifiedResponse, rejectedResponse] = await db.rapidResponse.createMany({
        data: [
          {
            responseType: 'HEALTH',
            responseDate: new Date(),
            verificationStatus: 'VERIFIED',
            priority: 'HIGH',
            responseData: { medicalSupplies: { bandages: 100 } },
            entityId: 'entity-test-1',
            assessorId: 'assessor-test-1',
            verifiedBy: 'coordinator-test-1',
            verifiedAt: new Date()
          },
          {
            responseType: 'WASH',
            responseDate: new Date(),
            verificationStatus: 'REJECTED',
            priority: 'MEDIUM',
            responseData: { waterSystem: { filters: 10 } },
            entityId: 'entity-test-1',
            assessorId: 'assessor-test-1',
            verifiedBy: 'coordinator-test-1',
            verifiedAt: new Date()
          }
        ]
      });

      // Check donor metrics
      const donorMetricsRequest = new NextRequest('http://localhost/api/v1/donors/metrics?donorId=donor-test-1');
      const donorMetricsResponse = await getDonorMetrics(donorMetricsRequest);
      
      const donorMetricsData = await donorMetricsResponse.json();
      const donor = donorMetricsData.data.donors[0];
      
      // Expectations:
      // Commitments: 2 total, 1 fulfilled, 1 available = 50% fulfillment rate
      // Responses: 2 total, 1 verified, 1 rejected = 50% verification rate
      // Combined: 4 total activities, 2 verified = 50% overall success rate
      
      expect(donor.metrics.commitments.total).toBe(2);
      expect(donor.metrics.commitments.fulfilled).toBe(1);
      expect(donor.metrics.commitments.fulfillmentRate).toBe(0.5);
      
      expect(donor.metrics.responses.total).toBe(2);
      expect(donor.metrics.responses.verified).toBe(1);
      expect(donor.metrics.responses.verificationRate).toBe(0.5);
      
      expect(donor.metrics.combined.totalActivities).toBe(4);
      expect(donor.metrics.combined.verifiedActivities).toBe(2);
      expect(donor.metrics.combined.overallSuccessRate).toBe(0.5);
    });
  });

  describe('Auto-Approval Integration', () => {
    it('should handle response auto-approval configuration', async () => {
      // Step 1: Configure auto-approval for responses
      const configRequest = new NextRequest('http://localhost/api/v1/verification/auto-approval/responses', {
        method: 'POST',
        body: JSON.stringify({
          entityIds: ['entity-test-1'],
          enabled: true,
          scope: 'responses',
          conditions: {
            responseTypes: ['HEALTH', 'WASH'],
            minDonorRating: 4.0
          }
        })
      });

      const configResponse = await updateResponseAutoApproval(configRequest);
      expect(configResponse.status).toBe(200);

      // Step 2: Create response that meets auto-approval criteria
      const response = await db.rapidResponse.create({
        data: {
          responseType: 'HEALTH', // Meets criteria
          responseDate: new Date(),
          verificationStatus: 'SUBMITTED',
          priority: 'LOW',
          responseData: { 
            medicalSupplies: {
              bandages: 100,
              completeness: 0.95
            }
          },
          entityId: 'entity-test-1',
          assessorId: 'assessor-test-1'
        }
      });

      // Simulate auto-approval process (in real implementation, this would be automatic)
      await db.rapidResponse.update({
        where: { id: response.id },
        data: {
          verificationStatus: 'AUTO_VERIFIED',
          verifiedAt: new Date(),
          verifiedBy: 'system'
        }
      });

      // Step 3: Verify metrics include auto-verified response
      const metricsRequest = new NextRequest('http://localhost/api/v1/verification/metrics/responses');
      const metricsResponse = await getResponseVerificationMetrics(metricsRequest);
      
      const metricsData = await metricsResponse.json();
      expect(metricsData.data.totalAutoVerified).toBe(1);
    });

    it('should auto-approve responses during delivery confirmation with correct metadata field', async () => {
      // Step 1: Configure auto-approval using correct metadata structure
      await db.entity.update({
        where: { id: 'entity-test-1' },
        data: {
          autoApproveEnabled: true,
          metadata: {
            autoApproval: { // Use correct field path (not autoApprovalConfig)
              scope: 'responses',
              responseTypes: ['HEALTH'],
              requiresDocumentation: false,
              maxPriority: 'MEDIUM'
            }
          }
        }
      });

      // Step 2: Create a planned response
      const response = await db.rapidResponse.create({
        data: {
          responseType: 'HEALTH',
          status: 'PLANNED', // Must be planned to be delivered
          verificationStatus: 'DRAFT',
          priority: 'MEDIUM', // Within auto-approval criteria
          responseData: { 
            medicalSupplies: { bandages: 100 }
          },
          entityId: 'entity-test-1',
          assessorId: 'assessor-test-1'
        }
      });

      // Step 3: Simulate delivery confirmation (this should trigger auto-approval)
      const deliveryData = {
        deliveredItems: [
          { name: 'Medical Bandages', quantity: 100, unit: 'pieces' }
        ],
        deliveryLocation: { latitude: 11.5, longitude: 13.5 },
        deliveryNotes: 'Delivered to main facility',
        mediaAttachmentIds: []
      };

      // Import and test the actual delivery confirmation service
      const { ResponseService } = require('@/lib/services/response.service');
      
      const confirmedResponse = await ResponseService.confirmDelivery(
        response.id,
        deliveryData,
        'assessor-test-1'
      );

      // Step 4: Verify response was auto-approved (not just delivered)
      expect(confirmedResponse.status).toBe('DELIVERED');
      expect(confirmedResponse.verificationStatus).toBe('VERIFIED'); // Should be auto-approved
      expect(confirmedResponse.verifiedBy).toBe('auto-approval');
      expect(confirmedResponse.verifiedAt).toBeDefined();
    });

    it('should not auto-approve when delivery data does not meet documentation requirements', async () => {
      // Step 1: Configure auto-approval with documentation requirement
      await db.entity.update({
        where: { id: 'entity-test-1' },
        data: {
          autoApproveEnabled: true,
          metadata: {
            autoApproval: {
              scope: 'responses',
              responseTypes: ['HEALTH'],
              requiresDocumentation: true, // Requires documentation
              maxPriority: 'HIGH'
            }
          }
        }
      });

      // Step 2: Create a planned response
      const response = await db.rapidResponse.create({
        data: {
          responseType: 'HEALTH',
          status: 'PLANNED',
          verificationStatus: 'DRAFT',
          priority: 'MEDIUM',
          responseData: { medicalSupplies: { bandages: 100 } },
          entityId: 'entity-test-1',
          assessorId: 'assessor-test-1'
        }
      });

      // Step 3: Deliver with insufficient documentation (no notes or media)
      const deliveryData = {
        deliveredItems: [
          { name: 'Medical Bandages', quantity: 100, unit: 'pieces' }
        ],
        deliveryLocation: { latitude: 11.5, longitude: 13.5 },
        deliveryNotes: '', // No notes
        mediaAttachmentIds: [] // No media
      };

      const { ResponseService } = require('@/lib/services/response.service');
      
      const confirmedResponse = await ResponseService.confirmDelivery(
        response.id,
        deliveryData,
        'assessor-test-1'
      );

      // Step 4: Verify response was NOT auto-approved due to missing documentation
      expect(confirmedResponse.status).toBe('DELIVERED');
      expect(confirmedResponse.verificationStatus).toBe('SUBMITTED'); // Should remain submitted
      expect(confirmedResponse.verifiedBy).toBeNull();
      expect(confirmedResponse.verifiedAt).toBeNull();
    });

    it('should respect scope limitations in auto-approval', async () => {
      // Configure auto-approval for responses only
      const configRequest = new NextRequest('http://localhost/api/v1/verification/auto-approval/responses', {
        method: 'POST',
        body: JSON.stringify({
          entityIds: ['entity-test-1'],
          enabled: true,
          scope: 'responses', // Only responses, not assessments
          conditions: {
            responseTypes: ['HEALTH']
          }
        })
      });

      const configResponse = await updateResponseAutoApproval(configRequest);
      expect(configResponse.status).toBe(200);

      // Create both assessment and response
      await db.rapidAssessment.create({
        data: {
          rapidAssessmentType: 'HEALTH',
          rapidAssessmentDate: new Date(),
          verificationStatus: 'SUBMITTED',
          priority: 'LOW',
          assessmentData: { healthFacilityCapacity: 100 },
          entityId: 'entity-test-1',
          assessorId: 'assessor-test-1'
        }
      });

      const response = await db.rapidResponse.create({
        data: {
          responseType: 'HEALTH',
          responseDate: new Date(),
          verificationStatus: 'SUBMITTED',
          priority: 'LOW',
          responseData: { medicalSupplies: { bandages: 100 } },
          entityId: 'entity-test-1',
          assessorId: 'assessor-test-1'
        }
      });

      // Only response should be auto-verified (simulated)
      await db.rapidResponse.update({
        where: { id: response.id },
        data: {
          verificationStatus: 'AUTO_VERIFIED',
          verifiedAt: new Date(),
          verifiedBy: 'system'
        }
      });

      // Verify response metrics
      const responseMetricsRequest = new NextRequest('http://localhost/api/v1/verification/metrics/responses');
      const responseMetricsResponse = await getResponseVerificationMetrics(responseMetricsRequest);
      const responseMetricsData = await responseMetricsResponse.json();
      expect(responseMetricsData.data.totalAutoVerified).toBe(1);

      // Assessment should remain submitted (not auto-approved)
      const assessmentQueueRequest = new NextRequest('http://localhost/api/v1/verification/queue/assessments?status=SUBMITTED');
      const assessmentQueueResponse = await getResponseVerificationQueue(assessmentQueueRequest);
      const assessmentQueueData = await assessmentQueueResponse.json();
      expect(assessmentQueueData.data).toHaveLength(1);
    });
  });

  describe('Concurrent Response Verification', () => {
    it('should handle concurrent response verification attempts gracefully', async () => {
      // Create response
      const response = await db.rapidResponse.create({
        data: {
          responseType: 'HEALTH',
          responseDate: new Date(),
          verificationStatus: 'SUBMITTED',
          priority: 'HIGH',
          responseData: { medicalSupplies: { bandages: 100 } },
          entityId: 'entity-test-1',
          assessorId: 'assessor-test-1'
        }
      });

      // Simulate concurrent verification attempts
      const verifyRequest1 = new NextRequest(`http://localhost/api/v1/responses/${response.id}/verify`, {
        method: 'POST',
        body: JSON.stringify({ notes: 'First verification' })
      });

      const verifyRequest2 = new NextRequest(`http://localhost/api/v1/responses/${response.id}/verify`, {
        method: 'POST',
        body: JSON.stringify({ notes: 'Second verification' })
      });

      // Execute both requests
      const [response1, response2] = await Promise.all([
        verifyResponse(verifyRequest1, { params: { id: response.id } }),
        verifyResponse(verifyRequest2, { params: { id: response.id } })
      ]);

      // One should succeed, one should fail
      const responses = [response1, response2];
      const successResponses = responses.filter(r => r.status === 200);
      const errorResponses = responses.filter(r => r.status === 400);

      expect(successResponses).toHaveLength(1);
      expect(errorResponses).toHaveLength(1);

      // Verify final state
      const finalResponse = await db.rapidResponse.findUnique({
        where: { id: response.id }
      });
      expect(finalResponse?.verificationStatus).toBe('VERIFIED');
    });
  });

  describe('Data Integrity and Validation', () => {
    it('should maintain data integrity across response verification operations', async () => {
      // Create multiple responses with different types and statuses
      const responses = await Promise.all([
        db.rapidResponse.create({
          data: {
            responseType: 'HEALTH',
            responseDate: new Date(),
            verificationStatus: 'SUBMITTED',
            priority: 'HIGH',
            responseData: { medicalSupplies: { bandages: 100 } },
            entityId: 'entity-test-1',
            assessorId: 'assessor-test-1'
          }
        }),
        db.rapidResponse.create({
          data: {
            responseType: 'WASH',
            responseDate: new Date(),
            verificationStatus: 'SUBMITTED',
            priority: 'MEDIUM',
            responseData: { waterSystem: { filters: 50 } },
            entityId: 'entity-test-1',
            assessorId: 'assessor-test-1'
          }
        }),
        db.rapidResponse.create({
          data: {
            responseType: 'SHELTER',
            responseDate: new Date(),
            verificationStatus: 'SUBMITTED',
            priority: 'LOW',
            responseData: { shelterMaterials: { tents: 20 } },
            entityId: 'entity-test-1',
            assessorId: 'assessor-test-1'
          }
        })
      ]);

      // Verify first, reject second, leave third pending
      await verifyResponse(
        new NextRequest(`http://localhost/api/v1/responses/${responses[0].id}/verify`, {
          method: 'POST',
          body: JSON.stringify({ notes: 'Approved' })
        }),
        { params: { id: responses[0].id } }
      );

      await rejectResponse(
        new NextRequest(`http://localhost/api/v1/responses/${responses[1].id}/reject`, {
          method: 'POST',
          body: JSON.stringify({
            rejectionReason: 'INADEQUATE_SUPPLIES',
            notes: 'Insufficient filter quantity'
          })
        }),
        { params: { id: responses[1].id } }
      );

      // Verify metrics are consistent
      const metricsRequest = new NextRequest('http://localhost/api/v1/verification/metrics/responses');
      const metricsResponse = await getResponseVerificationMetrics(metricsRequest);
      const metricsData = await metricsResponse.json();

      expect(metricsData.data.totalVerified).toBe(1);
      expect(metricsData.data.totalRejected).toBe(1);
      expect(metricsData.data.totalPending).toBe(1);

      // Verify audit trail is complete
      const auditLogs = await db.auditLog.findMany({
        where: { userId: 'coordinator-test-1' },
        orderBy: { createdAt: 'asc' }
      });

      expect(auditLogs).toHaveLength(2);
      expect(auditLogs[0].action).toBe('VERIFY_RESPONSE');
      expect(auditLogs[1].action).toBe('REJECT_RESPONSE');

      // Verify queue shows only pending response
      const queueRequest = new NextRequest('http://localhost/api/v1/verification/queue/responses?status=SUBMITTED');
      const queueResponse = await getResponseVerificationQueue(queueRequest);
      const queueData = await queueResponse.json();

      expect(queueData.data).toHaveLength(1);
      expect(queueData.data[0].id).toBe(responses[2].id);
      expect(queueData.data[0].responseType).toBe('SHELTER');
    });
  });

  describe('Performance and Scalability', () => {
    it('should handle large response verification queues efficiently', async () => {
      // Create multiple responses
      const responsePromises = Array.from({ length: 30 }, (_, i) =>
        db.rapidResponse.create({
          data: {
            responseType: ['HEALTH', 'WASH', 'SHELTER', 'FOOD', 'SECURITY'][i % 5] as any,
            responseDate: new Date(),
            verificationStatus: 'SUBMITTED',
            priority: ['LOW', 'MEDIUM', 'HIGH'][i % 3] as any,
            responseData: { capacity: 100 + i },
            entityId: 'entity-test-1',
            assessorId: 'assessor-test-1'
          }
        })
      );

      await Promise.all(responsePromises);

      // Test pagination performance
      const queueRequest = new NextRequest('http://localhost/api/v1/verification/queue/responses?page=1&limit=10');
      const startTime = Date.now();
      const queueResponse = await getResponseVerificationQueue(queueRequest);
      const endTime = Date.now();

      expect(queueResponse.status).toBe(200);
      const queueData = await queueResponse.json();
      expect(queueData.data).toHaveLength(10);
      expect(queueData.pagination.total).toBe(30);
      expect(queueData.pagination.totalPages).toBe(3);

      // Verify response time is reasonable (under 1 second)
      expect(endTime - startTime).toBeLessThan(1000);
    });

    it('should handle complex donor metrics calculations efficiently', async () => {
      // Create multiple commitments and responses for comprehensive testing
      const commitmentPromises = Array.from({ length: 10 }, (_, i) =>
        db.commitment.create({
          data: {
            donorId: 'donor-test-1',
            totalCommittedQuantity: 100 + i * 10,
            status: i % 2 === 0 ? 'COMPLETE' : 'PLANNED',
            commitmentDate: new Date()
          }
        })
      );

      const responsePromises = Array.from({ length: 15 }, (_, i) =>
        db.rapidResponse.create({
          data: {
            responseType: ['HEALTH', 'WASH', 'SHELTER'][i % 3] as any,
            responseDate: new Date(),
            verificationStatus: i % 3 === 0 ? 'VERIFIED' : i % 3 === 1 ? 'REJECTED' : 'SUBMITTED',
            priority: 'MEDIUM',
            responseData: { items: 50 + i },
            entityId: 'entity-test-1',
            assessorId: 'assessor-test-1',
            ...(i % 3 !== 2 && {
              verifiedBy: 'coordinator-test-1',
              verifiedAt: new Date()
            })
          }
        })
      );

      await Promise.all([...commitmentPromises, ...responsePromises]);

      // Test metrics calculation performance
      const donorMetricsRequest = new NextRequest('http://localhost/api/v1/donors/metrics?donorId=donor-test-1');
      const startTime = Date.now();
      const donorMetricsResponse = await getDonorMetrics(donorMetricsRequest);
      const endTime = Date.now();

      expect(donorMetricsResponse.status).toBe(200);
      const donorMetricsData = await donorMetricsResponse.json();
      expect(donorMetricsData.data.donors).toHaveLength(1);

      const donor = donorMetricsData.data.donors[0];
      expect(donor.metrics.commitments.total).toBe(10);
      expect(donor.metrics.responses.total).toBe(15);

      // Verify performance is reasonable (under 2 seconds for complex calculations)
      expect(endTime - startTime).toBeLessThan(2000);
    });
  });
});