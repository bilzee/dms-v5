import { NextRequest } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { GET } from '@/app/api/v1/donors/entities/[id]/demographics/route';

// Mock authentication
jest.mock('next-auth', () => ({
  getServerSession: jest.fn(),
}));

// Mock auth middleware
jest.mock('@/lib/auth/middleware', () => ({
  withAuth: (handler: any) => async (request: any, context: any, params: any) => {
    const safeParams = params || {};
    return handler(request, context, safeParams);
  }
}));

// Mock implementation for when database is not available
const mockPrisma = {
  $connect: jest.fn().mockRejectedValue(new Error('Test database not available')),
  $disconnect: jest.fn(),
  user: {
    create: jest.fn(),
    findUnique: jest.fn(),
    deleteMany: jest.fn(),
    delete: jest.fn()
  },
  donor: {
    create: jest.fn(),
    findUnique: jest.fn(),
    deleteMany: jest.fn(),
    update: jest.fn(),
    delete: jest.fn()
  },
  entity: {
    create: jest.fn(),
    findUnique: jest.fn(),
    deleteMany: jest.fn(),
    delete: jest.fn()
  },
  incident: {
    create: jest.fn(),
    findUnique: jest.fn(),
    deleteMany: jest.fn(),
    delete: jest.fn()
  },
  rapidAssessment: {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
    deleteMany: jest.fn()
  },
  entityAssignment: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    deleteMany: jest.fn()
  },
  assessmentCategory: {
    findMany: jest.fn(),
    findUnique: jest.fn()
  },
  userRole: {
    create: jest.fn(),
    deleteMany: jest.fn(),
    findMany: jest.fn()
  },
  role: {
    findUnique: jest.fn(),
    findMany: jest.fn()
  }
};

let prisma: PrismaClient | typeof mockPrisma;
let isDatabaseAvailable = false;

describe('Entity Demographics API', () => {
  let testUser: any;
  let testDonor: any;
  let testEntity: any;

  beforeAll(async () => {
    // Try to connect to real database first
    try {
      const realPrisma = new PrismaClient({
        datasources: {
          db: {
            url: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL
          }
        }
      });
      
      await realPrisma.$connect();
      prisma = realPrisma;
      isDatabaseAvailable = true;
      
      // Create test data if database is available
      testUser = await prisma.user.create({
        data: {
          email: 'demographics-test@example.com',
          name: 'Demographics Test User',
          createdAt: new Date(),
          updatedAt: new Date()
        }
      });
      
      testDonor = await prisma.donor.create({
        data: {
          name: 'Test Donor Organization',
          type: 'ORGANIZATION',
          contactEmail: 'donor@test.com',
          createdAt: new Date(),
          updatedAt: new Date()
        }
      });
      
      testEntity = await prisma.entity.create({
        data: {
          name: 'Test Entity Facility',
          type: 'FACILITY',
          location: 'Test Location, Country',
          metadata: {
            capacity: 500,
            establishedYear: 2000,
            facilityType: 'Hospital',
            services: ['Emergency', 'Outpatient', 'Inpatient'],
            operatingHours: '24/7',
            staffCount: 150,
            bedCount: 200,
            specialization: 'General Medicine',
            accreditation: 'National Health Board',
            infrastructure: {
              buildingArea: 10000,
              floors: 5,
              emergencyExits: 8,
              parkingSpaces: 100,
              backupPower: true,
              waterSupply: 'Municipal',
              wasteManagement: 'Contracted'
            },
            contact: {
              phone: '+1234567890',
              email: 'contact@entity.com',
              address: '123 Test Street',
              coordinates: { lat: 40.7128, lng: -74.0060 }
            }
          },
          createdAt: new Date(),
          updatedAt: new Date()
        }
      });
      
      // Create entity assignment
      await prisma.entityAssignment.create({
        data: {
          entityId: testEntity.id,
          assignedToId: testDonor.id,
          assignedToType: 'DONOR',
          status: 'ACTIVE',
          assignedAt: new Date(),
          assignedBy: testUser.id,
          createdAt: new Date(),
          updatedAt: new Date()
        }
      });
      
    } catch (error) {
      console.warn('Database not available, using mock implementation');
      prisma = mockPrisma;
      isDatabaseAvailable = false;
      
      // Set up mock data
      testUser = { id: 'test-user', email: 'test@example.com' };
      testDonor = { id: 'test-donor', name: 'Test Donor' };
      testEntity = {
        id: 'test-entity',
        name: 'Test Entity Facility',
        type: 'FACILITY',
        location: 'Test Location, Country',
        metadata: {
          capacity: 500,
          establishedYear: 2000,
          facilityType: 'Hospital',
          services: ['Emergency', 'Outpatient', 'Inpatient'],
          operatingHours: '24/7',
          staffCount: 150,
          bedCount: 200
        }
      };
    }
  });

  afterAll(async () => {
    if (isDatabaseAvailable && prisma !== mockPrisma) {
      // Cleanup test data
      await prisma.entityAssignment.deleteMany({
        where: { entityId: testEntity.id }
      });
      await prisma.entity.delete({ where: { id: testEntity.id } });
      await prisma.donor.delete({ where: { id: testDonor.id } });
      await prisma.user.delete({ where: { id: testUser.id } });
      await prisma.$disconnect();
    }
  });

  beforeEach(async () => {
    // Mock authenticated user with donor role
    const { getServerSession } = require('next-auth');
    getServerSession.mockResolvedValue({
      user: { 
        id: testUser.id, 
        email: testUser.email,
        roles: [{ role: { name: 'DONOR' } }]
      }
    });

    if (!isDatabaseAvailable) {
      // Mock database methods
      (prisma as typeof mockPrisma).entityAssignment.findMany.mockResolvedValue([
        {
          entityId: testEntity.id,
          assignedToId: testDonor.id,
          status: 'ACTIVE'
        }
      ]);
      
      (prisma as typeof mockPrisma).entity.findUnique.mockResolvedValue(testEntity);
    }
  });

  describe('GET /api/v1/donors/entities/[id]/demographics', () => {
    it('returns entity demographic information', async () => {
      const request = new NextRequest(
        `http://localhost:3000/api/v1/donors/entities/${testEntity.id}/demographics`,
        {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' }
        }
      );

      const response = await GET(request, { params: { id: testEntity.id } }, { id: testEntity.id });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).toMatchObject({
        id: testEntity.id,
        name: testEntity.name,
        type: testEntity.type,
        location: testEntity.location
      });
    });

    it('includes parsed metadata in response', async () => {
      const request = new NextRequest(
        `http://localhost:3000/api/v1/donors/entities/${testEntity.id}/demographics`,
        {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' }
        }
      );

      const response = await GET(request, { params: { id: testEntity.id } }, { id: testEntity.id });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).toHaveProperty('parsedMetadata');
      
      if (isDatabaseAvailable) {
        expect(data.data.parsedMetadata).toHaveProperty('capacity');
        expect(data.data.parsedMetadata).toHaveProperty('facilityType');
        expect(data.data.parsedMetadata).toHaveProperty('services');
      }
    });

    it('includes entity statistics', async () => {
      if (!isDatabaseAvailable) {
        // Mock assessment statistics
        (prisma as typeof mockPrisma).rapidAssessment.aggregate.mockResolvedValue({
          _count: { _all: 5 },
          _max: { date: new Date('2024-01-15') }
        });
      }

      const request = new NextRequest(
        `http://localhost:3000/api/v1/donors/entities/${testEntity.id}/demographics`,
        {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' }
        }
      );

      const response = await GET(request, { params: { id: testEntity.id } }, { id: testEntity.id });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).toHaveProperty('stats');
      expect(data.data.stats).toHaveProperty('totalAssessments');
      expect(data.data.stats).toHaveProperty('lastAssessmentDate');
    });

    it('validates entity assignment access', async () => {
      // Mock no entity assignment
      if (!isDatabaseAvailable) {
        (prisma as typeof mockPrisma).entityAssignment.findMany.mockResolvedValue([]);
      }

      const request = new NextRequest(
        `http://localhost:3000/api/v1/donors/entities/${testEntity.id}/demographics`,
        {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' }
        }
      );

      const response = await GET(request, { params: { id: testEntity.id } }, { id: testEntity.id });
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.success).toBe(false);
      expect(data.error).toContain('access to this entity');
    });

    it('handles entity not found', async () => {
      if (!isDatabaseAvailable) {
        (prisma as typeof mockPrisma).entity.findUnique.mockResolvedValue(null);
      }

      const request = new NextRequest(
        'http://localhost:3000/api/v1/donors/entities/non-existent-entity/demographics',
        {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' }
        }
      );

      const response = await GET(request, { params: { id: 'non-existent-entity' } }, { id: 'non-existent-entity' });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.success).toBe(false);
      expect(data.error).toContain('Entity not found');
    });

    it('handles unauthorized requests', async () => {
      // Clear authentication mock
      const { getServerSession } = require('next-auth');
      getServerSession.mockResolvedValue(null);

      const request = new NextRequest(
        `http://localhost:3000/api/v1/donors/entities/${testEntity.id}/demographics`,
        {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' }
        }
      );

      const response = await GET(request, { params: { id: testEntity.id } }, { id: testEntity.id });
      expect(response.status).toBe(401);
    });

    it('includes latest activity information', async () => {
      if (isDatabaseAvailable) {
        // Create a test assessment for activity
        await prisma.rapidAssessment.create({
          data: {
            id: 'activity-test-assessment',
            type: 'HEALTH',
            date: new Date('2024-01-20'),
            status: 'VERIFIED',
            assessorName: 'Test Assessor',
            verificationStatus: 'VERIFIED',
            verificationDate: new Date('2024-01-21'),
            summary: {
              overallScore: 90,
              criticalGaps: [],
              strengths: ['Excellent facility'],
              recommendations: ['Maintain current standards']
            },
            metadata: {},
            entityId: testEntity.id,
            createdAt: new Date(),
            updatedAt: new Date()
          }
        });
      }

      const request = new NextRequest(
        `http://localhost:3000/api/v1/donors/entities/${testEntity.id}/demographics`,
        {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' }
        }
      );

      const response = await GET(request, { params: { id: testEntity.id } }, { id: testEntity.id });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).toHaveProperty('latestActivity');
      
      if (isDatabaseAvailable) {
        expect(data.data.latestActivity).toHaveProperty('lastAssessment');
        expect(data.data.latestActivity).toHaveProperty('lastAssessmentType');
        expect(data.data.latestActivity).toHaveProperty('assignmentDate');
      }
    });

    it('handles invalid entity ID format', async () => {
      const request = new NextRequest(
        'http://localhost:3000/api/v1/donors/entities//demographics',
        {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' }
        }
      );

      const response = await GET(request, { params: { id: '' } }, { id: '' });
      expect(response.status).toBe(500);
    });
  });
});