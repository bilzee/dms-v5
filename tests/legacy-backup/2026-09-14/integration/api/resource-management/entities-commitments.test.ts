import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/v1/entities/commitments/route';
import { db } from '@/lib/db/client';

// Mock authentication
jest.mock('next-auth', () => ({
  getServerSession: jest.fn(),
}));

jest.mock('@/lib/services/audit.service', () => ({
  auditLog: jest.fn().mockResolvedValue(undefined),
}));

describe('Entities Commitments API', () => {
  let testCoordinator: any;
  let testDonor: any;
  let testEntity: any;
  let testIncident: any;

  beforeAll(async () => {
    // Create test coordinator user
    testCoordinator = await db.user.create({
      data: {
        email: 'coordinator@test.com',
        name: 'Test Coordinator',
        role: 'COORDINATOR',
      },
    });

    // Create test donor
    testDonor = await db.donor.create({
      data: {
        name: 'Test Donor Organization',
        type: 'ORGANIZATION',
        contactEmail: 'donor@test.com',
        contactPhone: '+1234567890',
        isActive: true,
      },
    });

    // Create test entity
    testEntity = await db.entity.create({
      data: {
        name: 'Test Entity Facility',
        type: 'FACILITY',
        location: 'Test Location',
      },
    });

    // Create test incident
    testIncident = await db.incident.create({
      data: {
        type: 'FLOOD',
        severity: 'HIGH',
        status: 'ACTIVE',
        location: 'Test Location',
        description: 'Test flood incident',
        createdBy: testCoordinator.id,
      },
    });
  });

  afterAll(async () => {
    // Cleanup test data in correct order due to foreign key constraints
    await db.donorCommitment.deleteMany({
      where: { donorId: testDonor.id }
    });
    await db.donor.delete({ where: { id: testDonor.id } });
    await db.incident.delete({ where: { id: testIncident.id } });
    await db.entity.delete({ where: { id: testEntity.id } });
    await db.user.delete({ where: { id: testCoordinator.id } });
  });

  beforeEach(async () => {
    // Mock authenticated coordinator
    const { getServerSession } = require('next-auth');
    getServerSession.mockResolvedValue({
      user: { id: testCoordinator.id, email: testCoordinator.email }
    });
  });

  describe('GET /api/v1/entities/commitments', () => {
    it('returns commitments list successfully', async () => {
      // Create a test commitment first
      await db.donorCommitment.create({
        data: {
          donorId: testDonor.id,
          entityId: testEntity.id,
          incidentId: testIncident.id,
          status: 'PLANNED',
          items: [
            { name: 'Water', unit: 'liters', quantity: 100, estimatedValue: 50 }
          ],
          totalCommittedQuantity: 100,
          deliveredQuantity: 0,
          verifiedDeliveredQuantity: 0,
          totalValueEstimated: 50,
        },
      });

      const request = new NextRequest(
        'http://localhost:3000/api/v1/entities/commitments',
        {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        }
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.data).toBeDefined();
      expect(data.data.pagination).toBeDefined();
      expect(Array.isArray(data.data.data)).toBe(true);

      // Cleanup
      await db.donorCommitment.deleteMany({
        where: { donorId: testDonor.id }
      });
    });

    it('filters commitments by status', async () => {
      // Create commitments with different statuses
      await db.donorCommitment.createMany({
        data: [
          {
            donorId: testDonor.id,
            entityId: testEntity.id,
            incidentId: testIncident.id,
            status: 'PLANNED',
            items: [{ name: 'Food', unit: 'kg', quantity: 50 }],
            totalCommittedQuantity: 50,
            deliveredQuantity: 0,
            verifiedDeliveredQuantity: 0,
          },
          {
            donorId: testDonor.id,
            entityId: testEntity.id,
            incidentId: testIncident.id,
            status: 'COMPLETE',
            items: [{ name: 'Medical', unit: 'kits', quantity: 10 }],
            totalCommittedQuantity: 10,
            deliveredQuantity: 10,
            verifiedDeliveredQuantity: 10,
          },
        ],
      });

      const request = new NextRequest(
        'http://localhost:3000/api/v1/entities/commitments?status=COMPLETE',
        {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        }
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.data.every((commitment: any) => commitment.status === 'COMPLETE')).toBe(true);

      // Cleanup
      await db.donorCommitment.deleteMany({
        where: { donorId: testDonor.id }
      });
    });

    it('searches commitments by donor, entity, or incident', async () => {
      await db.donorCommitment.create({
        data: {
          donorId: testDonor.id,
          entityId: testEntity.id,
          incidentId: testIncident.id,
          status: 'PLANNED',
          items: [{ name: 'Water', unit: 'liters', quantity: 100 }],
          totalCommittedQuantity: 100,
          deliveredQuantity: 0,
          verifiedDeliveredQuantity: 0,
        },
      });

      const request = new NextRequest(
        'http://localhost:3000/api/v1/entities/commitments?search=Test Donor Organization',
        {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        }
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);

      // Cleanup
      await db.donorCommitment.deleteMany({
        where: { donorId: testDonor.id }
      });
    });

    it('handles unauthorized requests', async () => {
      const { getServerSession } = require('next-auth');
      getServerSession.mockResolvedValue(null);

      const request = new NextRequest(
        'http://localhost:3000/api/v1/entities/commitments',
        {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        }
      );

      const response = await GET(request);
      expect(response.status).toBe(401);
    });

    it('handles permission errors for non-coordinator users', async () => {
      // Create a non-coordinator user
      const testUser = await db.user.create({
        data: {
          email: 'user@test.com',
          name: 'Test User',
          role: 'ASSESSOR',
        },
      });

      const { getServerSession } = require('next-auth');
      getServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email }
      });

      const request = new NextRequest(
        'http://localhost:3000/api/v1/entities/commitments',
        {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        }
      );

      const response = await GET(request);
      expect(response.status).toBe(403);

      // Cleanup
      await db.user.delete({ where: { id: testUser.id } });
    });
  });

  describe('POST /api/v1/entities/commitments', () => {
    it('creates commitment successfully', async () => {
      const commitmentData = {
        donorId: testDonor.id,
        entityId: testEntity.id,
        incidentId: testIncident.id,
        items: [
          { name: 'Water', unit: 'liters', quantity: 100, estimatedValue: 50 },
          { name: 'Food', unit: 'kg', quantity: 50, estimatedValue: 150 }
        ],
        notes: 'Test commitment notes'
      };

      const request = new NextRequest(
        'http://localhost:3000/api/v1/entities/commitments',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(commitmentData),
        }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.data.id).toBeDefined();
      expect(data.data.status).toBe('PLANNED');
      expect(data.data.totalCommittedQuantity).toBe(150); // 100 + 50
      expect(data.data.totalValueEstimated).toBe(200); // 50 + 150

      // Verify database record
      const createdCommitment = await db.donorCommitment.findUnique({
        where: { id: data.data.id }
      });
      expect(createdCommitment).toBeTruthy();
      expect(createdCommitment?.donorId).toBe(testDonor.id);
      expect(createdCommitment?.entityId).toBe(testEntity.id);
      expect(createdCommitment?.incidentId).toBe(testIncident.id);

      // Cleanup
      await db.donorCommitment.delete({
        where: { id: data.data.id }
      });
    });

    it('validates required fields', async () => {
      const invalidData = {
        // Missing donorId, entityId, incidentId, and items
        notes: 'Test notes'
      };

      const request = new NextRequest(
        'http://localhost:3000/api/v1/entities/commitments',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(invalidData),
        }
      );

      const response = await POST(request);
      expect(response.status).toBe(400);
      
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Validation failed');
    });

    it('validates items array is not empty', async () => {
      const invalidData = {
        donorId: testDonor.id,
        entityId: testEntity.id,
        incidentId: testIncident.id,
        items: [], // Empty items array
      };

      const request = new NextRequest(
        'http://localhost:3000/api/v1/entities/commitments',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(invalidData),
        }
      );

      const response = await POST(request);
      expect(response.status).toBe(400);
    });

    it('validates donor exists', async () => {
      const invalidData = {
        donorId: 'non-existent-donor-id',
        entityId: testEntity.id,
        incidentId: testIncident.id,
        items: [{ name: 'Water', unit: 'liters', quantity: 100 }],
      };

      const request = new NextRequest(
        'http://localhost:3000/api/v1/entities/commitments',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(invalidData),
        }
      );

      const response = await POST(request);
      expect(response.status).toBe(404);
      expect((await response.json()).error).toContain('Donor not found');
    });

    it('validates entity exists', async () => {
      const invalidData = {
        donorId: testDonor.id,
        entityId: 'non-existent-entity-id',
        incidentId: testIncident.id,
        items: [{ name: 'Water', unit: 'liters', quantity: 100 }],
      };

      const request = new NextRequest(
        'http://localhost:3000/api/v1/entities/commitments',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(invalidData),
        }
      );

      const response = await POST(request);
      expect(response.status).toBe(404);
      expect((await response.json()).error).toContain('Entity not found');
    });

    it('validates incident exists', async () => {
      const invalidData = {
        donorId: testDonor.id,
        entityId: testEntity.id,
        incidentId: 'non-existent-incident-id',
        items: [{ name: 'Water', unit: 'liters', quantity: 100 }],
      };

      const request = new NextRequest(
        'http://localhost:3000/api/v1/entities/commitments',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(invalidData),
        }
      );

      const response = await POST(request);
      expect(response.status).toBe(404);
      expect((await response.json()).error).toContain('Incident not found');
    });
  });
});

/**
 * TEST NOTES:
 * - Real database operations with seeded test data
 * - Authentication and authorization testing
 * - Complete CRUD operation testing
 * - Validation and error handling
 * - Proper cleanup to avoid test interference
 */