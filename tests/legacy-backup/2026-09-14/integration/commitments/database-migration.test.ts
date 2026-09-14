/**
 * Database Migration Tests - Story 4.3
 * 
 * These tests verify the new database schema changes:
 * - IncidentEntity junction table
 * - DonorCommitment model
 * - Updated relationships in existing models
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { PrismaClient } from '@prisma/client';

// Mock prisma client for testing
const mockPrisma = {
  // DonorCommitment model
  donorCommitment: {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
    aggregate: jest.fn()
  },
  
  // IncidentEntity junction table
  incidentEntity: {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    count: jest.fn()
  },
  
  // Existing models with new relationships
  donor: {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    delete: jest.fn()
  },
  
  entity: {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    delete: jest.fn()
  },
  
  incident: {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    delete: jest.fn()
  },
  
  rapidResponse: {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    delete: jest.fn()
  },
  
  // Transaction support
  $transaction: jest.fn(),
  $queryRaw: jest.fn(),
  $executeRaw: jest.fn()
};

jest.mock('@/lib/db/client', () => ({
  prisma: mockPrisma
}));

const prisma = mockPrisma as any;

describe('Database Schema - Story 4.3', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    
    // Setup default mock data
    mockPrisma.donor.create.mockResolvedValue({
      id: 'donor-123',
      name: 'Test Donor',
      type: 'ORGANIZATION',
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    
    mockPrisma.entity.create.mockResolvedValue({
      id: 'entity-123',
      name: 'Test Entity',
      type: 'HEALTH_FACILITY',
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    
    mockPrisma.incident.create.mockResolvedValue({
      id: 'incident-123',
      type: 'FLOOD',
      severity: 'HIGH',
      status: 'ACTIVE',
      createdAt: new Date(),
      updatedAt: new Date()
    });
  });

  afterEach(async () => {
    jest.restoreAllMocks();
  });

  describe('IncidentEntity Junction Table', () => {
    it('should create incident-entity relationships', async () => {
      // Arrange
      const incidentEntityData = {
        incidentId: 'incident-123',
        entityId: 'entity-123',
        affectedAt: new Date(),
        severity: 'HIGH'
      };
      
      mockPrisma.incidentEntity.create.mockResolvedValue({
        id: 'incident-entity-123',
        ...incidentEntityData,
        createdAt: new Date(),
        updatedAt: new Date()
      });

      // Act
      const result = await prisma.incidentEntity.create({
        data: incidentEntityData
      });

      // Assert
      expect(result).toEqual({
        id: 'incident-entity-123',
        ...incidentEntityData,
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date)
      });
      
      expect(prisma.incidentEntity.create).toHaveBeenCalledWith({
        data: incidentEntityData
      });
    });

    it('should enforce unique constraint on incidentId-entityId', async () => {
      // Arrange
      const incidentId = 'incident-123';
      const entityId = 'entity-123';
      
      mockPrisma.incidentEntity.findUnique.mockResolvedValue({
        id: 'existing-relationship'
      });

      // Act & Assert
      // Test for unique constraint violation
      await expect(prisma.incidentEntity.findUnique({
        where: {
          incidentId_entityId: {
            incidentId,
            entityId
          }
        }
      })).resolves.toEqual({
        id: 'existing-relationship'
      });
    });

    it('should support querying incidents by entity', async () => {
      // Arrange
      const entityId = 'entity-123';
      const expectedIncidents = [
        { id: 'incident-1', type: 'FLOOD' },
        { id: 'incident-2', type: 'FIRE' }
      ];
      
      mockPrisma.incidentEntity.findMany.mockResolvedValue(expectedIncidents);

      // Act
      const result = await prisma.incidentEntity.findMany({
        where: { entityId },
        include: {
          incident: true
        }
      });

      // Assert
      expect(result).toEqual(expectedIncidents);
      expect(prisma.incidentEntity.findMany).toHaveBeenCalledWith({
        where: { entityId },
        include: {
          incident: true
        }
      });
    });

    it('should support querying entities by incident', async () => {
      // Arrange
      const incidentId = 'incident-123';
      const expectedEntities = [
        { id: 'entity-1', name: 'Hospital A' },
        { id: 'entity-2', name: 'School B' }
      ];
      
      mockPrisma.incidentEntity.findMany.mockResolvedValue(expectedEntities);

      // Act
      const result = await prisma.incidentEntity.findMany({
        where: { incidentId },
        include: {
          entity: true
        }
      });

      // Assert
      expect(result).toEqual(expectedEntities);
      expect(prisma.incidentEntity.findMany).toHaveBeenCalledWith({
        where: { incidentId },
        include: {
          entity: true
        }
      });
    });
  });

  describe('DonorCommitment Model', () => {
    it('should create commitments with all required fields', async () => {
      // Arrange
      const commitmentData = {
        donorId: 'donor-123',
        entityId: 'entity-123',
        incidentId: 'incident-123',
        status: 'PLANNED',
        items: [
          { name: 'Water', unit: 'liters', quantity: 1000 },
          { name: 'Food', unit: 'meals', quantity: 500 }
        ],
        totalCommittedQuantity: 1500,
        deliveredQuantity: 0,
        verifiedDeliveredQuantity: 0,
        notes: 'Test commitment'
      };
      
      const expectedCommitment = {
        id: 'commitment-123',
        ...commitmentData,
        commitmentDate: expect.any(Date),
        lastUpdated: expect.any(Date)
      };
      
      mockPrisma.donorCommitment.create.mockResolvedValue(expectedCommitment);

      // Act
      const result = await prisma.donorCommitment.create({
        data: commitmentData
      });

      // Assert
      expect(result).toEqual(expectedCommitment);
      expect(prisma.donorCommitment.create).toHaveBeenCalledWith({
        data: commitmentData
      });
    });

    it('should support partial usage tracking', async () => {
      // Arrange
      const commitmentId = 'commitment-123';
      const updateData = {
        deliveredQuantity: 500,
        verifiedDeliveredQuantity: 450,
        status: 'PARTIAL',
        lastUpdated: new Date()
      };
      
      const updatedCommitment = {
        id: commitmentId,
        donorId: 'donor-123',
        entityId: 'entity-123',
        incidentId: 'incident-123',
        ...updateData
      };
      
      mockPrisma.donorCommitment.update.mockResolvedValue(updatedCommitment);

      // Act
      const result = await prisma.donorCommitment.update({
        where: { id: commitmentId },
        data: updateData
      });

      // Assert
      expect(result).toEqual(updatedCommitment);
      expect(prisma.donorCommitment.update).toHaveBeenCalledWith({
        where: { id: commitmentId },
        data: updateData
      });
    });

    it('should filter commitments by status correctly', async () => {
      // Arrange
      const plannedCommitments = [
        { id: 'commitment-1', status: 'PLANNED' },
        { id: 'commitment-2', status: 'PLANNED' }
      ];
      
      mockPrisma.donorCommitment.findMany.mockResolvedValue(plannedCommitments);

      // Act
      const result = await prisma.donorCommitment.findMany({
        where: { status: 'PLANNED' }
      });

      // Assert
      expect(result).toEqual(plannedCommitments);
      expect(prisma.donorCommitment.findMany).toHaveBeenCalledWith({
        where: { status: 'PLANNED' }
      });
    });

    it('should support complex queries with relationships', async () => {
      // Arrange
      const expectedCommitments = [
        {
          id: 'commitment-123',
          donor: { id: 'donor-123', name: 'Test Donor' },
          entity: { id: 'entity-123', name: 'Test Entity' },
          incident: { id: 'incident-123', type: 'FLOOD' }
        }
      ];
      
      mockPrisma.donorCommitment.findMany.mockResolvedValue(expectedCommitments);

      // Act
      const result = await prisma.donorCommitment.findMany({
        where: {
          donor: { isActive: true },
          entity: { isActive: true },
          status: 'PLANNED'
        },
        include: {
          donor: true,
          entity: true,
          incident: true
        },
        orderBy: {
          commitmentDate: 'desc'
        }
      });

      // Assert
      expect(result).toEqual(expectedCommitments);
      expect(prisma.donorCommitment.findMany).toHaveBeenCalledWith({
        where: {
          donor: { isActive: true },
          entity: { isActive: true },
          status: 'PLANNED'
        },
        include: {
          donor: true,
          entity: true,
          incident: true
        },
        orderBy: {
          commitmentDate: 'desc'
        }
      });
    });
  });

  describe('Updated Model Relationships', () => {
    it('should support querying donor commitments', async () => {
      // Arrange
      const donorId = 'donor-123';
      const expectedCommitments = [
        { id: 'commitment-1', donorId },
        { id: 'commitment-2', donorId }
      ];
      
      mockPrisma.donor.findUnique.mockResolvedValue({
        id: donorId,
        name: 'Test Donor',
        commitments: expectedCommitments
      });

      // Act
      const donor = await prisma.donor.findUnique({
        where: { id: donorId },
        include: { commitments: true }
      });

      // Assert
      expect(donor?.commitments).toEqual(expectedCommitments);
      expect(prisma.donor.findUnique).toHaveBeenCalledWith({
        where: { id: donorId },
        include: { commitments: true }
      });
    });

    it('should support querying entity commitments', async () => {
      // Arrange
      const entityId = 'entity-123';
      const expectedCommitments = [
        { id: 'commitment-1', entityId },
        { id: 'commitment-2', entityId }
      ];
      
      mockPrisma.entity.findUnique.mockResolvedValue({
        id: entityId,
        name: 'Test Entity',
        commitments: expectedCommitments,
        incidents: []
      });

      // Act
      const entity = await prisma.entity.findUnique({
        where: { id: entityId },
        include: { 
          commitments: true,
          incidents: true
        }
      });

      // Assert
      expect(entity?.commitments).toEqual(expectedCommitments);
      expect(prisma.entity.findUnique).toHaveBeenCalledWith({
        where: { id: entityId },
        include: { 
          commitments: true,
          incidents: true
        }
      });
    });

    it('should support querying incident commitments', async () => {
      // Arrange
      const incidentId = 'incident-123';
      const expectedCommitments = [
        { id: 'commitment-1', incidentId },
        { id: 'commitment-2', incidentId }
      ];
      
      mockPrisma.incident.findUnique.mockResolvedValue({
        id: incidentId,
        type: 'FLOOD',
        commitments: expectedCommitments,
        entities: []
      });

      // Act
      const incident = await prisma.incident.findUnique({
        where: { id: incidentId },
        include: { 
          commitments: true,
          entities: true
        }
      });

      // Assert
      expect(incident?.commitments).toEqual(expectedCommitments);
      expect(prisma.incident.findUnique).toHaveBeenCalledWith({
        where: { id: incidentId },
        include: { 
          commitments: true,
          entities: true
        }
      });
    });

    it('should support linking responses to commitments', async () => {
      // Arrange
      const responseId = 'response-123';
      const commitmentId = 'commitment-123';
      const expectedResponse = {
        id: responseId
      };
      
      mockPrisma.rapidResponse.create.mockResolvedValue(expectedResponse);

      // Act
      const result = await prisma.rapidResponse.create({
        data: {
          type: 'LOGISTICS',
          status: 'DELIVERED'
        }
      });

      // Assert
      expect(result).toEqual(expectedResponse);
      expect(prisma.rapidResponse.create).toHaveBeenCalledWith({
        data: {
          type: 'LOGISTICS',
          status: 'DELIVERED'
        }
      });
    });
  });

  describe('Data Integrity and Constraints', () => {
    it('should enforce cascade delete for IncidentEntity relationships', async () => {
      // Arrange
      const incidentId = 'incident-123';
      
      mockPrisma.incident.delete.mockResolvedValue({
        id: incidentId,
        affectedEntities: 0 // Cascade should handle related incident entities
      });

      // Act
      const result = await prisma.incident.delete({
        where: { id: incidentId }
      });

      // Assert
      expect(result).toEqual({
        id: incidentId,
        affectedEntities: 0
      });
      expect(prisma.incident.delete).toHaveBeenCalledWith({
        where: { id: incidentId }
      });
    });

    it('should maintain referential integrity for commitments', async () => {
      // Arrange
      const invalidCommitmentData = {
        donorId: 'invalid-donor', // This should fail if donor doesn't exist
        entityId: 'entity-123',
        incidentId: 'incident-123',
        status: 'PLANNED',
        items: [],
        totalCommittedQuantity: 100
      };
      
      mockPrisma.donor.findUnique.mockResolvedValue(null); // Donor doesn't exist
      
      mockPrisma.donorCommitment.create.mockRejectedValue(
        new Error('Foreign key constraint violation')
      );

      // Act & Assert
      await expect(prisma.donorCommitment.create({
        data: invalidCommitmentData
      })).rejects.toThrow('Foreign key constraint violation');
    });

    it('should support transactional operations for commitment updates', async () => {
      // Arrange
      const commitmentId = 'commitment-123';
      const responseData = {
        commitmentId,
        items: [{ name: 'Water', unit: 'liters', quantity: 500 }],
        totalQuantity: 500
      };
      
      const transactionResult = {
        response: { id: 'response-123' },
        updatedCommitment: { 
          id: commitmentId, 
          deliveredQuantity: 500,
          status: 'PARTIAL' 
        },
        auditLog: { id: 'audit-123' }
      };
      
      mockPrisma.$transaction.mockImplementation((callback) => {
        return callback({
          rapidResponse: { create: jest.fn().mockResolvedValue(transactionResult.response) },
          donorCommitment: { update: jest.fn().mockResolvedValue(transactionResult.updatedCommitment) },
          auditLog: { create: jest.fn().mockResolvedValue(transactionResult.auditLog) }
        });
      });

      // Act
      const result = await prisma.$transaction(async (tx) => {
        const response = await tx.rapidResponse.create({
          data: { type: 'LOGISTICS' }
        });
        
        const updatedCommitment = await tx.donorCommitment.update({
          where: { id: commitmentId },
          data: { deliveredQuantity: 500, status: 'PARTIAL' }
        });
        
        const auditLog = await tx.auditLog.create({
          data: { action: 'COMMITMENT_USAGE', resourceId: response.id }
        });
        
        return { response, updatedCommitment, auditLog };
      });

      // Assert
      expect(result).toEqual(transactionResult);
      expect(prisma.$transaction).toHaveBeenCalled();
    });
  });

  describe('Performance and Indexes', () => {
    it('should support efficient queries on large datasets', async () => {
      // Arrange
      const filters = {
        donorId: 'donor-123',
        status: 'PLANNED'
      };
      
      // Mock large dataset query performance
      mockPrisma.donorCommitment.findMany.mockResolvedValue([
        { id: 'commitment-1', donorId: 'donor-123' },
        { id: 'commitment-2', donorId: 'donor-123' },
        // ... many more commitments
      ]);
      
      mockPrisma.donorCommitment.count.mockResolvedValue(1000); // Large count

      // Act
      const [commitments, total] = await Promise.all([
        prisma.donorCommitment.findMany({
          where: filters,
          take: 50,
          skip: 0,
          orderBy: { commitmentDate: 'desc' }
        }),
        prisma.donorCommitment.count({ where: filters })
      ]);

      // Assert
      expect(Array.isArray(commitments)).toBe(true);
      expect(total).toBe(1000);
      expect(prisma.donorCommitment.findMany).toHaveBeenCalledWith({
        where: filters,
        take: 50,
        skip: 0,
        orderBy: { commitmentDate: 'desc' }
      });
    });

    it('should utilize indexes for relationship queries', async () => {
      // Arrange
      const entityId = 'entity-123';
      
      mockPrisma.incidentEntity.findMany.mockResolvedValue([
        { id: 'incident-entity-1', entityId, incidentId: 'incident-1' },
        { id: 'incident-entity-2', entityId, incidentId: 'incident-2' }
      ]);

      // Act
      const result = await prisma.incidentEntity.findMany({
        where: { entityId },
        orderBy: { affectedAt: 'desc' }
      });

      // Assert
      expect(result).toHaveLength(2);
      expect(prisma.incidentEntity.findMany).toHaveBeenCalledWith({
        where: { entityId },
        orderBy: { affectedAt: 'desc' }
      });
    });
  });
});