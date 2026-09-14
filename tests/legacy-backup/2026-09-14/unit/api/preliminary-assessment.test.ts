import { PreliminaryAssessmentService } from '@/lib/services/preliminary-assessment.service'
import { prisma } from '@/lib/db/client'

// Mock prisma
jest.mock('@/lib/db/client', () => ({
  prisma: {
    preliminaryAssessment: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    incident: {
      create: jest.fn(),
    },
  },
}))

describe('PreliminaryAssessmentService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  afterEach(() => {
    jest.resetAllMocks()
  })

  describe('create', () => {
    it('should create a preliminary assessment without incident', async () => {
      const mockAssessment = {
        id: 'test-id',
        reportingDate: new Date(),
        reportingLatitude: 9.072264,
        reportingLongitude: 7.491302,
        reportingLGA: 'Lagos Island',
        reportingWard: 'Ward 1',
        numberLivesLost: 0,
        numberInjured: 5,
        numberDisplaced: 20,
        numberHousesAffected: 10,
        reportingAgent: 'Test Agent',
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      const mockInput = {
        data: {
          reportingDate: new Date(),
          reportingLatitude: 9.072264,
          reportingLongitude: 7.491302,
          reportingLGA: 'Lagos Island',
          reportingWard: 'Ward 1',
          numberLivesLost: 0,
          numberInjured: 5,
          numberDisplaced: 20,
          numberHousesAffected: 10,
          reportingAgent: 'Test Agent',
        },
        createIncident: false,
      }

      ;(prisma.preliminaryAssessment.create as any).mockResolvedValue({
        ...mockAssessment,
        incident: null,
      })

      const result = await PreliminaryAssessmentService.create(mockInput, 'user-id')

      expect(prisma.preliminaryAssessment.create).toHaveBeenCalledWith({
        data: {
          ...mockInput.data,
          incidentId: undefined,
          affectedEntities: undefined,
        },
        include: {
          incident: true,
          affectedEntities: {
            include: {
              entity: true,
            },
          },
        },
      })

      expect(result).toEqual({
        ...mockAssessment,
        incident: null,
      })
    })

    it('should create a preliminary assessment with incident', async () => {
      const mockIncident = {
        id: 'incident-id',
        type: 'Flood',
        severity: 'HIGH',
        description: 'Test incident',
        location: 'Lagos Island, Ward 1',
        createdBy: 'user-id',
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      const mockAssessment = {
        id: 'test-id',
        reportingDate: new Date(),
        reportingLatitude: 9.072264,
        reportingLongitude: 7.491302,
        reportingLGA: 'Lagos Island',
        reportingWard: 'Ward 1',
        numberLivesLost: 0,
        numberInjured: 5,
        numberDisplaced: 20,
        numberHousesAffected: 10,
        reportingAgent: 'Test Agent',
        incidentId: 'incident-id',
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      const mockInput = {
        data: {
          reportingDate: new Date(),
          reportingLatitude: 9.072264,
          reportingLongitude: 7.491302,
          reportingLGA: 'Lagos Island',
          reportingWard: 'Ward 1',
          numberLivesLost: 0,
          numberInjured: 5,
          numberDisplaced: 20,
          numberHousesAffected: 10,
          reportingAgent: 'Test Agent',
        },
        createIncident: true,
        incidentData: {
          type: 'Flood',
          severity: 'HIGH' as const,
          description: 'Test incident',
          location: 'Lagos Island, Ward 1',
        },
      }

      ;(prisma.incident.create as any).mockResolvedValue(mockIncident)
      ;(prisma.preliminaryAssessment.create as any).mockResolvedValue({
        ...mockAssessment,
        incident: mockIncident,
      })

      const result = await PreliminaryAssessmentService.create(mockInput, 'user-id')

      expect(prisma.incident.create).toHaveBeenCalledWith({
        data: {
          type: 'Flood',
          subType: undefined,
          severity: 'HIGH',
          description: 'Test incident',
          location: 'Lagos Island, Ward 1',
          coordinates: {
            lat: 9.072264,
            lng: 7.491302,
          },
          createdBy: 'user-id',
        },
      })

      expect(prisma.preliminaryAssessment.create).toHaveBeenCalledWith({
        data: {
          ...mockInput.data,
          incidentId: 'incident-id',
          affectedEntities: undefined,
        },
        include: {
          incident: true,
          affectedEntities: {
            include: {
              entity: true,
            },
          },
        },
      })

      expect(result).toEqual({
        ...mockAssessment,
        incident: mockIncident,
      })
    })
  })

  describe('findById', () => {
    it('should return a preliminary assessment by id', async () => {
      const mockAssessment = {
        id: 'test-id',
        reportingLGA: 'Lagos Island',
        reportingWard: 'Ward 1',
        incident: null,
      }

      ;(prisma.preliminaryAssessment.findUnique as any).mockResolvedValue(mockAssessment)

      const result = await PreliminaryAssessmentService.findById('test-id')

      expect(prisma.preliminaryAssessment.findUnique).toHaveBeenCalledWith({
        where: { id: 'test-id' },
        include: {
          incident: true,
          affectedEntities: {
            include: {
              entity: true,
            },
          },
        },
      })

      expect(result).toEqual(mockAssessment)
    })

    it('should return null if assessment not found', async () => {
      ;(prisma.preliminaryAssessment.findUnique as any).mockResolvedValue(null)

      const result = await PreliminaryAssessmentService.findById('non-existent')

      expect(result).toBeNull()
    })
  })

  describe('findAll', () => {
    it('should return paginated assessments with filters', async () => {
      const mockAssessments = [
        { id: '1', reportingLGA: 'Lagos Island' },
        { id: '2', reportingLGA: 'Lagos Mainland' },
      ]

      ;(prisma.preliminaryAssessment.count as any).mockResolvedValue(2)
      ;(prisma.preliminaryAssessment.findMany as any).mockResolvedValue(mockAssessments)

      const query = {
        page: 1,
        limit: 10,
        lga: 'Lagos Island',
      }

      const result = await PreliminaryAssessmentService.findAll(query)

      expect(prisma.preliminaryAssessment.count).toHaveBeenCalledWith({
        where: { reportingLGA: 'Lagos Island' },
      })

      expect(prisma.preliminaryAssessment.findMany).toHaveBeenCalledWith({
        where: { reportingLGA: 'Lagos Island' },
        include: {
          incident: true,
          affectedEntities: {
            include: {
              entity: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: 0,
        take: 10,
      })

      expect(result).toEqual({
        assessments: mockAssessments,
        total: 2,
        totalPages: 1,
      })
    })

    it('should handle pagination correctly', async () => {
      const mockAssessments = [{ id: '3' }, { id: '4' }]

      ;(prisma.preliminaryAssessment.count as any).mockResolvedValue(25)
      ;(prisma.preliminaryAssessment.findMany as any).mockResolvedValue(mockAssessments)

      const query = {
        page: 3,
        limit: 10,
      }

      const result = await PreliminaryAssessmentService.findAll(query)

      expect(prisma.preliminaryAssessment.findMany).toHaveBeenCalledWith({
        where: {},
        include: {
          incident: true,
          affectedEntities: {
            include: {
              entity: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: 20,
        take: 10,
      })

      expect(result.totalPages).toBe(3)
    })
  })

  describe('update', () => {
    it('should update a preliminary assessment', async () => {
      const mockUpdatedAssessment = {
        id: 'test-id',
        reportingLGA: 'Updated LGA',
        incident: null,
      }

      ;(prisma.preliminaryAssessment.update as any).mockResolvedValue(mockUpdatedAssessment)

      const updateData = {
        data: { reportingLGA: 'Updated LGA' },
      }

      const result = await PreliminaryAssessmentService.update('test-id', updateData)

      expect(prisma.preliminaryAssessment.update).toHaveBeenCalledWith({
        where: { id: 'test-id' },
        data: { reportingLGA: 'Updated LGA' },
        include: {
          incident: true,
          affectedEntities: {
            include: {
              entity: true,
            },
          },
        },
      })

      expect(result).toEqual(mockUpdatedAssessment)
    })
  })

  describe('delete', () => {
    it('should delete a preliminary assessment', async () => {
      ;(prisma.preliminaryAssessment.delete as any).mockResolvedValue({ id: 'test-id' })

      await PreliminaryAssessmentService.delete('test-id')

      expect(prisma.preliminaryAssessment.delete).toHaveBeenCalledWith({
        where: { id: 'test-id' },
      })
    })
  })
})