/**
 * Integration Tests: Assessment Relationships API
 * 
 * Tests assessment relationship query operations with real database,
 * relationship aggregation, statistics calculation, timeline queries,
 * filtering, sorting functionality, and proper authorization.
 */

import { NextRequest } from 'next/server';
import { GET as getIncidentEntities } from '@/app/api/v1/incidents/[id]/entities/route';
import { GET as getEntityIncidents } from '@/app/api/v1/entities/[id]/incidents/route';
import { GET as getRelationshipStatistics } from '@/app/api/v1/relationships/statistics/route';
import { GET as getRelationshipTimeline } from '@/app/api/v1/relationships/timeline/route';
import { db } from '@/lib/db/client';

// Mock next-auth for authentication
jest.mock('next-auth', () => ({
  getServerSession: jest.fn(),
}));

describe('Assessment Relationships API Integration Tests', () => {
  let testIncident: any;
  let testEntity1: any;
  let testEntity2: any;
  let testUser: any;
  let testAssessment1: any;
  let testAssessment2: any;
  let testAssessment3: any;

  beforeAll(async () => {
    // Seed test data
    testUser = await db.user.create({
      data: {
        email: 'assessor@test.com',
        username: 'test-assessor',
        passwordHash: 'hashedpassword',
        name: 'Test Assessor',
      },
    });

    testIncident = await db.incident.create({
      data: {
        type: 'FLOOD',
        description: 'Test flood incident',
        location: 'Test Location',
        severity: 'HIGH',
        createdBy: testUser.id,
      },
    });

    testEntity1 = await db.entity.create({
      data: {
        name: 'Test Hospital',
        type: 'FACILITY',
        location: 'Test City',
        coordinates: { lat: 9.0820, lng: 8.6753 },
      },
    });

    testEntity2 = await db.entity.create({
      data: {
        name: 'Test Community',
        type: 'COMMUNITY',
        location: 'Test Village',
        coordinates: { lat: 9.1820, lng: 8.7753 },
      },
    });

    // Create test assessments with different priorities and types
    testAssessment1 = await db.rapidAssessment.create({
      data: {
        rapidAssessmentType: 'HEALTH',
        rapidAssessmentDate: new Date('2024-01-15T10:30:00Z'),
        assessorId: testUser.id,
        entityId: testEntity1.id,
        incidentId: testIncident.id,
        assessorName: 'Test Assessor',
        priority: 'CRITICAL',
        verificationStatus: 'VERIFIED',
      },
    });

    testAssessment2 = await db.rapidAssessment.create({
      data: {
        rapidAssessmentType: 'WASH',
        rapidAssessmentDate: new Date('2024-01-14T14:45:00Z'),
        assessorId: testUser.id,
        entityId: testEntity2.id,
        incidentId: testIncident.id,
        assessorName: 'Test Assessor',
        priority: 'HIGH',
        verificationStatus: 'SUBMITTED',
      },
    });

    testAssessment3 = await db.rapidAssessment.create({
      data: {
        rapidAssessmentType: 'SHELTER',
        rapidAssessmentDate: new Date('2024-01-13T08:15:00Z'),
        assessorId: testUser.id,
        entityId: testEntity1.id,
        incidentId: testIncident.id,
        assessorName: 'Test Assessor',
        priority: 'MEDIUM',
        verificationStatus: 'DRAFT',
      },
    });
  });

  afterAll(async () => {
    // Cleanup test data
    await db.rapidAssessment.deleteMany({
      where: { incidentId: testIncident.id },
    });
    await db.incident.delete({ where: { id: testIncident.id } });
    await db.entity.delete({ where: { id: testEntity1.id } });
    await db.entity.delete({ where: { id: testEntity2.id } });
    await db.user.delete({ where: { id: testUser.id } });
  });

  beforeEach(async () => {
    // Mock authentication for each test
    const { getServerSession } = require('next-auth');
    getServerSession.mockResolvedValue({
      user: { id: testUser.id, email: 'coordinator@test.com', role: 'COORDINATOR' },
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/v1/incidents/[id]/entities', () => {
    it('returns entities with assessments for specific incident', async () => {
      const request = new NextRequest(
        `http://localhost:3000/api/v1/incidents/${testIncident.id}/entities`
      );

      const response = await getIncidentEntities(request, { params: { id: testIncident.id } });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).toHaveLength(2); // Two unique entities
      expect(data.statistics).toBeDefined();
      expect(data.statistics.totalAssessments).toBe(3);
      expect(data.statistics.totalEntities).toBe(2);
    });

    it('filters entities by priority', async () => {
      const request = new NextRequest(
        `http://localhost:3000/api/v1/incidents/${testIncident.id}/entities?priorityFilter=CRITICAL`
      );

      const response = await getIncidentEntities(request, { params: { id: testIncident.id } });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).toHaveLength(1); // Only entity with CRITICAL assessment
      
      const entity = data.data[0];
      expect(entity.name).toBe('Test Hospital');
      expect(entity.priorityDistribution.CRITICAL).toBe(1);
    });

    it('filters entities by assessment type', async () => {
      const request = new NextRequest(
        `http://localhost:3000/api/v1/incidents/${testIncident.id}/entities?assessmentTypeFilter=HEALTH`
      );

      const response = await getIncidentEntities(request, { params: { id: testIncident.id } });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).toHaveLength(1);
      
      const entity = data.data[0];
      expect(entity.name).toBe('Test Hospital');
    });

    it('filters entities by verification status', async () => {
      const request = new NextRequest(
        `http://localhost:3000/api/v1/incidents/${testIncident.id}/entities?verificationStatusFilter=VERIFIED`
      );

      const response = await getIncidentEntities(request, { params: { id: testIncident.id } });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).toHaveLength(1);
    });

    it('filters entities by date range', async () => {
      const request = new NextRequest(
        `http://localhost:3000/api/v1/incidents/${testIncident.id}/entities?startDate=2024-01-14T00:00:00Z&endDate=2024-01-15T23:59:59Z`
      );

      const response = await getIncidentEntities(request, { params: { id: testIncident.id } });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).toHaveLength(2); // Assessments from Jan 14-15
    });

    it('returns 401 when not authenticated', async () => {
      const { getServerSession } = require('next-auth');
      getServerSession.mockResolvedValue(null);

      const request = new NextRequest(
        `http://localhost:3000/api/v1/incidents/${testIncident.id}/entities`
      );

      const response = await getIncidentEntities(request, { params: { id: testIncident.id } });
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Authentication required');
    });
  });

  describe('GET /api/v1/entities/[id]/incidents', () => {
    it('returns incidents affecting specific entity', async () => {
      const request = new NextRequest(
        `http://localhost:3000/api/v1/entities/${testEntity1.id}/incidents`
      );

      const response = await getEntityIncidents(request, { params: { id: testEntity1.id } });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).toHaveLength(1); // One incident affecting this entity
      expect(data.statistics).toBeDefined();
      expect(data.statistics.totalIncidents).toBe(1);
      expect(data.statistics.totalAssessments).toBe(2); // Two assessments for this entity
    });

    it('returns correct priority distribution for entity', async () => {
      const request = new NextRequest(
        `http://localhost:3000/api/v1/entities/${testEntity1.id}/incidents`
      );

      const response = await getEntityIncidents(request, { params: { id: testEntity1.id } });
      const data = await response.json();

      expect(response.status).toBe(200);
      const incident = data.data[0];
      expect(incident.priorityDistribution.CRITICAL).toBe(1);
      expect(incident.priorityDistribution.MEDIUM).toBe(1);
      expect(incident.assessmentCount).toBe(2);
    });

    it('filters by multiple criteria', async () => {
      const request = new NextRequest(
        `http://localhost:3000/api/v1/entities/${testEntity1.id}/incidents?priorityFilter=CRITICAL,HIGH&assessmentTypeFilter=HEALTH`
      );

      const response = await getEntityIncidents(request, { params: { id: testEntity1.id } });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).toHaveLength(1);
      
      const incident = data.data[0];
      expect(incident.priorityDistribution.CRITICAL).toBe(1);
    });
  });

  describe('GET /api/v1/relationships/statistics', () => {
    it('returns comprehensive relationship statistics', async () => {
      const request = new NextRequest(
        `http://localhost:3000/api/v1/relationships/statistics?incidentId=${testIncident.id}`
      );

      const response = await getRelationshipStatistics(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).toBeDefined();
      
      const stats = data.data;
      expect(stats.totalEntities).toBe(2);
      expect(stats.totalIncidents).toBe(1);
      expect(stats.totalAssessments).toBe(3);
      expect(stats.priorityDistribution.CRITICAL).toBe(1);
      expect(stats.priorityDistribution.HIGH).toBe(1);
      expect(stats.priorityDistribution.MEDIUM).toBe(1);
      expect(stats.assessmentTypeDistribution.HEALTH).toBe(1);
      expect(stats.assessmentTypeDistribution.WASH).toBe(1);
      expect(stats.assessmentTypeDistribution.SHELTER).toBe(1);
    });

    it('filters statistics by entity', async () => {
      const request = new NextRequest(
        `http://localhost:3000/api/v1/relationships/statistics?entityId=${testEntity1.id}`
      );

      const response = await getRelationshipStatistics(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      const stats = data.data;
      expect(stats.totalEntities).toBe(1);
      expect(stats.totalAssessments).toBe(2); // Only assessments for this entity
    });

    it('filters statistics by date range', async () => {
      const request = new NextRequest(
        `http://localhost:3000/api/v1/relationships/statistics?startDate=2024-01-15T00:00:00Z&endDate=2024-01-15T23:59:59Z`
      );

      const response = await getRelationshipStatistics(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      const stats = data.data;
      expect(stats.totalAssessments).toBe(1); // Only assessment from Jan 15
    });
  });

  describe('GET /api/v1/relationships/timeline', () => {
    it('returns assessment timeline data', async () => {
      const request = new NextRequest(
        `http://localhost:3000/api/v1/relationships/timeline?incidentId=${testIncident.id}`
      );

      const response = await getRelationshipTimeline(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).toHaveLength(3); // Three assessments
      expect(data.pagination).toBeDefined();
      
      const timelineItem = data.data[0]; // Most recent (sorted desc)
      expect(timelineItem.assessment.type).toBe('HEALTH');
      expect(timelineItem.entity.name).toBe('Test Hospital');
      expect(timelineItem.incident.type).toBe('FLOOD');
    });

    it('sorts timeline by assessment date descending', async () => {
      const request = new NextRequest(
        `http://localhost:3000/api/v1/relationships/timeline?incidentId=${testIncident.id}`
      );

      const response = await getRelationshipTimeline(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data).toHaveLength(3);
      
      // Check chronological order (newest first)
      const dates = data.data.map((item: any) => new Date(item.assessment.date));
      expect(dates[0] >= dates[1]).toBe(true);
      expect(dates[1] >= dates[2]).toBe(true);
    });

    it('limits timeline results', async () => {
      const request = new NextRequest(
        `http://localhost:3000/api/v1/relationships/timeline?incidentId=${testIncident.id}&limit=2`
      );

      const response = await getRelationshipTimeline(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data).toHaveLength(2); // Limited to 2 results
      expect(data.pagination.limit).toBe(2);
      expect(data.pagination.hasMore).toBe(true);
    });

    it('handles pagination offset', async () => {
      const request = new NextRequest(
        `http://localhost:3000/api/v1/relationships/timeline?incidentId=${testIncident.id}&limit=2&offset=1`
      );

      const response = await getRelationshipTimeline(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data).toHaveLength(2); // 2 results from offset 1
      expect(data.pagination.offset).toBe(1);
    });

    it('filters timeline by assessment type', async () => {
      const request = new NextRequest(
        `http://localhost:3000/api/v1/relationships/timeline?assessmentTypeFilter=HEALTH`
      );

      const response = await getRelationshipTimeline(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data).toHaveLength(1);
      expect(data.data[0].assessment.type).toBe('HEALTH');
    });

    it('validates query parameters', async () => {
      const request = new NextRequest(
        `http://localhost:3000/api/v1/relationships/timeline?limit=invalid`
      );

      const response = await getRelationshipTimeline(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Invalid query parameters');
    });
  });

  describe('Error Handling', () => {
    it('handles database errors gracefully', async () => {
      // Mock database error
      const originalFindMany = db.rapidAssessment.findMany;
      db.rapidAssessment.findMany = jest.fn().mockRejectedValue(new Error('Database error'));

      const request = new NextRequest(
        `http://localhost:3000/api/v1/relationships/statistics`
      );

      const response = await getRelationshipStatistics(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Failed to calculate relationship statistics');

      // Restore original method
      db.rapidAssessment.findMany = originalFindMany;
    });

    it('handles invalid incident ID', async () => {
      const request = new NextRequest(
        `http://localhost:3000/api/v1/incidents/invalid-id/entities`
      );

      const response = await getIncidentEntities(request, { params: { id: 'invalid-id' } });
      const data = await response.json();

      expect(response.status).toBe(200); // Service handles gracefully with empty results
      expect(data.success).toBe(true);
      expect(data.data).toHaveLength(0);
    });
  });
});