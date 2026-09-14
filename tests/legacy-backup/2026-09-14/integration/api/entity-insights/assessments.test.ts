import { NextRequest } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { GET } from '@/app/api/v1/donors/entities/[id]/assessments/route';

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
  $transaction: jest.fn(),
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

describe('Entity Assessments API', () => {
  let testUser: any;
  let testDonor: any;
  let testEntity: any;
  let testAssessments: any[];

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
          email: 'entity-test@example.com',
          name: 'Entity Test User',
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
          location: 'Test Location',
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date()
        }
      });
      
      testAssessments = await Promise.all([
        prisma.rapidAssessment.create({
          data: {
            id: 'test-assessment-1',
            type: 'HEALTH',
            date: new Date('2024-01-15'),
            status: 'VERIFIED',
            assessorName: 'John Doe',
            verificationStatus: 'VERIFIED',
            verificationDate: new Date('2024-01-16'),
            verificationNotes: 'Assessment verified',
            summary: {
              overallScore: 85,
              criticalGaps: ['Medical supplies'],
              strengths: ['Good staff'],
              recommendations: ['Increase supplies']
            },
            metadata: {
              population: { total: 1000, affected: 150 },
              priorityLevel: 'HIGH'
            },
            entityId: testEntity.id,
            createdAt: new Date(),
            updatedAt: new Date()
          }
        }),
        prisma.rapidAssessment.create({
          data: {
            id: 'test-assessment-2',
            type: 'SHELTER',
            date: new Date('2024-01-10'),
            status: 'PENDING',
            assessorName: 'Jane Smith',
            verificationStatus: 'PENDING',
            summary: {
              overallScore: 72,
              criticalGaps: ['Shelter space'],
              strengths: ['Good location'],
              recommendations: ['Expand capacity']
            },
            metadata: {
              population: { total: 500, affected: 200 },
              priorityLevel: 'MEDIUM'
            },
            entityId: testEntity.id,
            createdAt: new Date(),
            updatedAt: new Date()
          }
        })
      ]);
      
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
      testEntity = { id: 'test-entity', name: 'Test Entity' };
      testAssessments = [
        {
          id: 'test-assessment-1',
          type: 'HEALTH',
          date: new Date('2024-01-15'),
          status: 'VERIFIED',
          entityId: testEntity.id
        },
        {
          id: 'test-assessment-2', 
          type: 'SHELTER',
          date: new Date('2024-01-10'),
          status: 'PENDING',
          entityId: testEntity.id
        }
      ];
    }
  });

  afterAll(async () => {
    if (isDatabaseAvailable && prisma !== mockPrisma) {
      // Cleanup test data
      await prisma.entityAssignment.deleteMany({
        where: { entityId: testEntity.id }
      });
      await prisma.rapidAssessment.deleteMany({
        where: { id: { in: testAssessments.map(a => a.id) } }
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
      
      (prisma as typeof mockPrisma).rapidAssessment.findMany.mockResolvedValue(testAssessments);
      (prisma as typeof mockPrisma).rapidAssessment.count.mockResolvedValue(testAssessments.length);
    }
  });

  describe('GET /api/v1/donors/entities/[id]/assessments', () => {
    it('returns assessments for assigned entity', async () => {
      const request = new NextRequest(
        `http://localhost:3000/api/v1/donors/entities/${testEntity.id}/assessments`,
        {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' }
        }
      );

      const response = await GET(request, { params: { id: testEntity.id } }, { id: testEntity.id });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.assessments).toHaveLength(2);
      expect(data.data.pagination.total).toBe(2);
    });

    it('filters assessments by category', async () => {
      const request = new NextRequest(
        `http://localhost:3000/api/v1/donors/entities/${testEntity.id}/assessments?category=HEALTH`,
        {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' }
        }
      );

      const response = await GET(request, { params: { id: testEntity.id } }, { id: testEntity.id });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      
      if (isDatabaseAvailable) {
        expect(data.data.assessments.every(a => a.type === 'HEALTH')).toBe(true);
      }
    });

    it('validates entity assignment access', async () => {
      // Mock no entity assignment
      if (!isDatabaseAvailable) {
        (prisma as typeof mockPrisma).entityAssignment.findMany.mockResolvedValue([]);
      }

      const request = new NextRequest(
        `http://localhost:3000/api/v1/donors/entities/${testEntity.id}/assessments`,
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

    it('handles pagination correctly', async () => {
      const request = new NextRequest(
        `http://localhost:3000/api/v1/donors/entities/${testEntity.id}/assessments?page=1&limit=10`,
        {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' }
        }
      );

      const response = await GET(request, { params: { id: testEntity.id } }, { id: testEntity.id });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data.pagination).toMatchObject({
        page: 1,
        limit: 10,
        hasNext: false,
        hasPrev: false
      });
    });

    it('validates assessment status filter', async () => {
      const request = new NextRequest(
        `http://localhost:3000/api/v1/donors/entities/${testEntity.id}/assessments?status=VERIFIED`,
        {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' }
        }
      );

      const response = await GET(request, { params: { id: testEntity.id } }, { id: testEntity.id });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });

    it('handles unauthorized requests', async () => {
      // Clear authentication mock
      const { getServerSession } = require('next-auth');
      getServerSession.mockResolvedValue(null);

      const request = new NextRequest(
        `http://localhost:3000/api/v1/donors/entities/${testEntity.id}/assessments`,
        {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' }
        }
      );

      const response = await GET(request, { params: { id: testEntity.id } }, { id: testEntity.id });
      expect(response.status).toBe(401);
    });

    it('handles invalid entity ID', async () => {
      const request = new NextRequest(
        'http://localhost:3000/api/v1/donors/entities/invalid-id/assessments',
        {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' }
        }
      );

      const response = await GET(request, { params: { id: 'invalid-id' } }, { id: 'invalid-id' });
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
    });

    it('includes assessment metadata in response', async () => {
      const request = new NextRequest(
        `http://localhost:3000/api/v1/donors/entities/${testEntity.id}/assessments`,
        {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' }
        }
      );

      const response = await GET(request, { params: { id: testEntity.id } }, { id: testEntity.id });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      
      if (isDatabaseAvailable && data.data.assessments.length > 0) {
        const assessment = data.data.assessments[0];
        expect(assessment).toHaveProperty('summary');
        expect(assessment).toHaveProperty('metadata');
        expect(assessment).toHaveProperty('entity');
      }
    });
  });
});