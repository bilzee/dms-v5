import { NextRequest } from 'next/server'
import { db } from '@/lib/db/client'
import { IncidentService } from '@/lib/services/incident.service'
import * as IncidentServiceMock from '@/lib/services/incident.service'
import { IncidentSchema, CreateIncidentSchema, QueryIncidentSchema } from '@/lib/validation/incidents'

// Mock the IncidentService methods
jest.mock('@/lib/services/incident.service', () => IncidentServiceMock)

describe('/api/v1/incidents', () => {
  let testData: any = {}

  beforeAll(async () => {
    // Setup test database with known data
    testData = await db.incident.create({
      data: {
        type: 'Test Flood',
        severity: 'HIGH',
        status: 'ACTIVE',
        description: 'Test flood description',
        location: 'Test Location',
        coordinates: { lat: 6.5244, lng: 3.3792 },
        createdBy: 'test-user'
      }
    })
  })

  afterAll(async () => {
    // Cleanup test data
    if (testData?.id) {
      await db.incident.delete({ where: { id: testData.id } })
    }
  })

  describe('GET /api/v1/incidents', () => {
    it('returns paginated incidents successfully', async () => {
      const request = new NextRequest('http://localhost:3000/api/v1/incidents', {
        method: 'GET',
        headers: {
          'cookie': 'next-auth.session-token=test-session'
        }
      })

      // Mock authenticated context
      const mockContext = {
        userId: 'test-user',
        roles: ['COORDINATOR']
      }

      const response = await IncidentService.findAll({
        page: 1,
        limit: 10
      })

      expect(response.incidents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'Test Flood',
            severity: 'HIGH',
            status: 'ACTIVE'
          })
        ])
      )
      expect(response.total).toBe(1)
      expect(response.totalPages).toBe(1)
    })

    it('applies filters correctly', async () => {
      // Create test incidents with different types
      await db.incident.createMany({
        data: [
          {
            type: 'Fire',
            severity: 'CRITICAL',
            status: 'ACTIVE',
            description: 'Fire incident',
            location: 'Location A',
            coordinates: { lat: 6.5, lng: 3.4 },
            createdBy: 'test-user'
          },
          {
            type: 'Flood',
            severity: 'MEDIUM',
            status: 'CONTAINED',
            description: 'Flood incident',
            location: 'Location B',
            coordinates: { lat: 6.6, lng: 3.5 },
            createdBy: 'test-user'
          }
        ]
      })

      const request = new NextRequest('http://localhost:3000/api/v1/incidents?type=Fire&severity=CRITICAL', {
        method: 'GET',
        headers: {
          'cookie': 'next-auth.session-token=test-session'
        }
      })

      // Mock authenticated context
      const mockContext = {
        userId: 'test-user',
        roles: ['COORDINATOR']
      }

      const response = await IncidentService.findAll({
        type: 'Fire',
        severity: 'CRITICAL',
        page: 1,
        limit: 10
      })

      expect(response.incidents).toHaveLength(1)
      expect(response.incidents[0]).toMatchObject({
        type: 'Fire',
        severity: 'CRITICAL',
        status: 'ACTIVE'
      })
    })

    it('handles unauthorized requests', async () => {
      const request = new NextRequest('http://localhost:3000/api/v1/incidents', {
        method: 'GET'
      })

      // Mock unauthenticated context
      const mockContext = {
        userId: null,
        roles: []
      }

      const { GET } = await import('@/app/api/v1/incidents/route')
      
      const response = await GET(request, mockContext)
      
      expect(response.status).toBe(403)
      expect(response.body).toEqual({
        success: false,
        error: 'Insufficient permissions. Assessor, Coordinator, or Admin role required.',
        meta: expect.objectContaining({
          timestamp: expect.any(String),
          version: '1.0.0',
          requestId: expect.any(String)
        })
      })
    })

    it('handles pagination correctly', async () => {
      // Create test incidents
      await db.incident.createMany({
        data: Array.from({ length: 25 }, (_, i) => ({
          type: `Incident ${i + 1}`,
          severity: i % 2 === 0 ? 'HIGH' : 'MEDIUM',
          status: 'ACTIVE',
          description: `Description for incident ${i + 1}`,
          location: `Location ${i + 1}`,
          createdBy: 'test-user'
        }))
      })

      const request = new NextRequest('http://localhost:3000/api/v1/incidents?page=2&limit=5', {
        method: 'GET',
        headers: {
          'cookie': 'next-auth.session-token=test-session'
        }
      })

      // Mock authenticated context
      const mockContext = {
        userId: 'test-user',
        roles: ['COORDINATOR']
      }

      const response = await IncidentService.findAll({
        page: 2,
        limit: 5
      })

      expect(response.incidents).toHaveLength(5)
      expect(response.total).toBe(25)
      expect(response.totalPages).toBe(5)
      expect(response.pagination.page).toBe(2)
      expect(response.pagination.limit).toBe(5)
    })

    it('includes population impact calculations', async () => {
      // Create incident with linked assessment
      const assessment = await db.preliminaryAssessment.create({
        data: {
          reportingDate: new Date(),
          reportingLatitude: 6.5244,
          reportingLongitude: 3.3792,
          reportingLGA: 'Test LGA',
          reportingWard: 'Test Ward',
          numberLivesLost: 5,
          numberInjured: 10,
          numberDisplaced: 20,
          numberHousesAffected: 15,
          numberSchoolsAffected: 2,
          numberMedicalFacilitiesAffected: 1,
          estimatedAgriculturalLandsAffected: '100 hectares',
          reportingAgent: 'test-user'
        }
      })

      const incident = await db.incident.create({
        data: {
          type: 'Flood with Impact',
          severity: 'HIGH',
          status: 'ACTIVE',
          description: 'Test incident with assessment',
          location: 'Test Location',
          coordinates: { lat: 6.5244, lng: 3.3792 },
          createdBy: 'test-user'
        }
      })

      // Link assessment to incident
      await db.preliminaryAssessment.update({
        where: { id: assessment.id },
        data: { incidentId: incident.id }
      })

      const request = new NextRequest(`http://localhost:3000/api/v1/incidents/${incident.id}`, {
        method: 'GET',
        headers: {
          'cookie': 'next-auth.session-token=test-session'
        }
      })

      // Mock authenticated context
      const mockContext = {
        userId: 'test-user',
        roles: ['COORDINATOR']
      }

      const { GET } = await import('@/app/api/v1/incidents/[id]/route')
      
      const response = await GET(request, mockContext)
      
      expect(response.status).toBe(200)
      expect(response.data).toMatchObject({
        id: incident.id,
        type: 'Flood with Impact'
      })
      expect(response.data.populationImpact).toMatchObject({
        livesLost: 5,
        injured: 10,
        displaced: 20,
        housesAffected: 15,
        schoolsAffected: 2,
        medicalFacilitiesAffected: 1,
        agriculturalLandAffected: 100
      })
    })
  })

  describe('POST /api/v1/incidents', () => {
    it('creates incident successfully', async () => {
      const requestBody = {
        type: 'Earthquake',
        severity: 'CRITICAL',
        description: 'Major earthquake incident',
        location: 'Test City',
        coordinates: { lat: -6.5, lng: 106.8 }
      }

      const request = new NextRequest('http://localhost:3000/api/v1/incidents', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'cookie': 'next-auth.session-token=test-session'
        },
        body: JSON.stringify(requestBody)
      })

      // Mock authenticated context
      const mockContext = {
        userId: 'test-user',
        roles: ['COORDINATOR']
      }

      const { POST } = await import('@/app/api/v1/incidents/route')
      
      const response = await POST(request, mockContext)
      
      expect(response.status).toBe(201)
      expect(response.data).toMatchObject({
        type: 'Earthquake',
        severity: 'CRITICAL',
        description: 'Major earthquake incident',
        location: 'Test City',
        coordinates: { lat: -6.5, lng: 106.8 },
        createdBy: 'test-user'
      })
    })

    it('creates incident from assessment', async () => {
      // Create test assessment
      const assessment = await db.preliminaryAssessment.create({
        data: {
          reportingDate: new Date(),
          reportingLatitude: 6.5244,
          reportingLongitude: 3.3792,
          reportingLGA: 'Test LGA',
          reportingWard: 'Test Ward',
          numberLivesLost: 3,
          numberInjured: 7,
          numberDisplaced: 15,
          reportingAgent: 'test-user'
        }
      })

      const requestBody = {
        type: 'Fire from Assessment',
        severity: 'HIGH',
        description: 'Fire incident based on assessment',
        preliminaryAssessmentId: assessment.id
      }

      const request = new NextRequest('http://localhost:3000/api/v1/incidents', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'cookie': 'next-auth.session-token=test-session'
        },
        body: JSON.stringify(requestBody)
      })

      // Mock authenticated context
      const mockContext = {
        userId: 'test-user',
        roles: ['COORDINATOR']
      }

      const { POST } = await import('@/app/api/v1/incidents/route')
      
      const response = await POST(request, mockContext)
      
      expect(response.status).toBe(201)
      expect(response.data).toMatchObject({
        type: 'Fire from Assessment',
        severity: 'HIGH',
        description: 'Fire incident based on assessment'
      })

      // Verify assessment is linked
      const updatedAssessment = await db.preliminaryAssessment.findUnique({
        where: { id: assessment.id }
      })
      
      expect(updatedAssessment.incidentId).toBe(response.data.id)
    })

    it('validates required fields', async () => {
      const invalidRequests = [
        { description: 'Valid type but missing description' },
        { type: '', description: 'Valid description but missing type' },
        { location: '', description: 'Valid type and description but missing location' }
      ]

      for (const invalidBody of invalidRequests) {
        const request = new NextRequest('http://localhost:3000/api/v1/incidents', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'cookie': 'next-auth.session-token=test-session'
          },
          body: JSON.stringify(invalidBody)
        })

        // Mock authenticated context
        const mockContext = {
          userId: 'test-user',
          roles: ['COORDINATOR']
        }

        const { POST } = await import('@/app/api/v1/incidents/route')
        
        const response = await POST(request, mockContext)
        
        expect(response.status).toBe(400)
        expect(response.body).toMatchObject({
          error: expect.stringContaining('is required')
        })
      }
    })

    it('handles unauthorized creation requests', async () => {
      const request = new NextRequest('http://localhost:3000/api/v1/incidents', {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          type: 'Test',
          description: 'Test description',
          location: 'Test location'
        })
      })

      // Mock unauthenticated context
      const mockContext = {
        userId: null,
        roles: []
      }

      const { POST } = await import('@/app/api/v1/incidents/route')
      
      const response = await POST(request, mockContext)
      
      expect(response.status).toBe(403)
      expect(response.body).toEqual({
        success: false,
        error: 'Insufficient permissions. Assessor, Coordinator, or Admin role required.'
      })
    })
  })

  describe('PUT /api/v1/incidents/[id]', () => {
    it('updates incident successfully', async () => {
      const incident = await db.incident.create({
        data: {
          type: 'Test Incident',
          severity: 'MEDIUM',
          status: 'ACTIVE',
          description: 'Original description',
          location: 'Original location',
          createdBy: 'test-user'
        }
      })

      const updateData = {
        status: 'CONTAINED',
        description: 'Updated description',
        severity: 'HIGH'
      }

      const request = new NextRequest(`http://localhost:3000/api/v1/incidents/${incident.id}`, {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          'cookie': 'next-auth.session-token=test-session'
        },
        body: JSON.stringify(updateData)
      })

      // Mock authenticated context with coordinator role
      const mockContext = {
        userId: 'test-user',
        roles: ['COORDINATOR']
      }

      const { PUT } = await import('@/app/api/v1/incidents/[id]/route')
      
      const response = await PUT(request, mockContext)
      
      expect(response.status).toBe(200)
      expect(response.data).toMatchObject({
        id: incident.id,
        type: 'Test Incident',
        status: 'CONTAINED',
        description: 'Updated description',
        severity: 'HIGH',
        location: 'Original location'
      })
      expect(response.data.populationImpact).toBeDefined()
    })

    it('validates update fields', async () => {
      const incident = await db.incident.create({
        data: {
          type: 'Test Incident',
          severity: 'MEDIUM',
          status: 'ACTIVE',
          description: 'Original description',
          location: 'Original location',
          createdBy: 'test-user'
        }
      })

      const invalidUpdate = {
        status: 'INVALID_STATUS'
      }

      const request = new NextRequest(`http://localhost:3000/api/v1/incidents/${incident.id}`, {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          'cookie': 'next-auth.session-token=test-session'
        },
        body: JSON.stringify(invalidUpdate)
      })

      // Mock authenticated context
      const mockContext = {
        userId: 'test-user',
        roles: ['COORDINATOR']
      }

      const { PUT } = await import('@/app/api/v1/incidents/[id]/route')
      
      const response = await PUT(request, mockContext)
      
      expect(response.status).toBe(400)
      expect(response.body).toMatchObject({
        error: expect.stringContaining('Invalid')
      })
    })

    it('handles unauthorized update requests', async () => {
      const incident = await db.incident.create({
        data: {
          type: 'Test Incident',
          severity: 'MEDIUM',
          status: 'ACTIVE',
          description: 'Original description',
          location: 'Original location',
          createdBy: 'test-user'
        }
      })

      const updateData = {
        description: 'Updated description'
      }

      const request = new NextRequest(`http://localhost:3000/api/v1/incidents/${incident.id}`, {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          'cookie': 'next-auth.session-token=test-session'
        },
        body: JSON.stringify(updateData)
      })

      // Mock unauthenticated context
      const mockContext = {
        userId: null,
        roles: []
      }

      const { PUT } = await import('@/app/api/v1/incidents/[id]/route')
      
      const response = await PUT(request, mockContext)
      
      expect(response.status).toBe(403)
      expect(response.body).toEqual({
        success: false,
        error: 'Insufficient permissions. Coordinator or Admin role required.'
      })
    })

    it('handles incident not found', async () => {
      const request = new NextRequest('http://localhost:3000/api/v1/incidents/non-existent-id', {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          'cookie': 'next-auth.session-token=test-session'
        },
        body: JSON.stringify({
          description: 'Updated description'
        })
      })

      // Mock authenticated context
      const mockContext = {
        userId: 'test-user',
        roles: ['COORDINATOR']
      }

      const { PUT } = await import('@/app/api/v1/incidents/[id]/route')
      
      const response = await PUT(request, mockContext)
      
      expect(response.status).toBe(404)
      expect(response.body).toMatchObject({
        error: 'Incident not found'
      })
    })
  })

  describe('DELETE /api/v1/incidents/[id]', () => {
    it('soft deletes incident successfully', async () => {
      const incident = await db.incident.create({
        data: {
          type: 'Test Incident',
          severity: 'MEDIUM',
          status: 'ACTIVE',
          description: 'Test description',
          location: 'Test location',
          createdBy: 'test-user'
        }
      })

      const request = new NextRequest(`http://localhost:3000/api/v1/incidents/${incident.id}`, {
        method: 'DELETE',
        headers: {
          'cookie': 'next-auth.session-token=test-session'
        }
      })

      // Mock authenticated context
      const mockContext = {
        userId: 'test-user',
        roles: ['COORDINATOR']
      }

      const { DELETE } = await import('@/app/api/v1/incidents/[id]/route')
      
      const response = await DELETE(request, mockContext)
      
      expect(response.status).toBe(200)
      expect(response.body).toMatchObject({
        data: {
          success: true,
          message: 'Incident deleted successfully',
          deletedIncident: expect.objectContaining({
            id: incident.id,
            status: 'RESOLVED'
          })
        }
      })
    })

    it('handles unauthorized delete requests', async () => {
      const request = new NextRequest('http://localhost:3000/api/v1/incidents/test-id', {
        method: 'DELETE',
        headers: {
          'cookie': 'next-auth.session-token=test-session'
        }
      })

      // Mock unauthenticated context
      const mockContext = {
        userId: null,
        roles: []
      }

      const { DELETE } = await import('@/app/api/v1/incidents/[id]/route')
      
      const response = await DELETE(request, mockContext)
      
      expect(response.status).toBe(403)
      expect(response.body).toMatchObject({
        success: false,
        error: 'Insufficient permissions. Coordinator or Admin role required.'
      })
    })

    it('handles incident not found on delete', async () => {
      const request = new NextRequest('http://localhost:3000/api/v1/incidents/non-existent-id', {
        method: 'DELETE',
        headers: {
          'cookie': 'next-auth.session-token=test-session'
        }
      })

      // Mock authenticated context
      const mockContext = {
        userId: 'test-user',
        roles: ['COORDINATOR']
      }

      const { DELETE } = await import('@/app/api/v1/incidents/[id]/route')
      
      const response = await DELETE(request, mockContext)
      
      expect(response.status).toBe(404)
      expect(response.body).toMatchObject({
        error: 'Incident not found'
      })
    })
  })

  describe('Population Impact Calculations', () => {
    it('calculates impact from multiple assessments', async () => {
      // Create incident with multiple linked assessments
      const incident = await db.incident.create({
        data: {
          type: 'Multi-Assessment Incident',
          severity: 'HIGH',
          status: 'ACTIVE',
          description: 'Test incident with multiple assessments',
          location: 'Test Location',
          createdBy: 'test-user'
        }
      })

      // Create multiple assessments
      const assessments = await db.preliminaryAssessment.createMany({
        data: Array.from({ length: 3 }, (_, i) => ({
          reportingDate: new Date(),
          reportingLatitude: 6.5 + (i * 0.01),
          reportingLongitude: 3.4 + (i * 0.01),
          reportingLGA: `LGA ${i + 1}`,
          reportingWard: `Ward ${i + 1}`,
          numberLivesLost: i + 1,
          numberInjured: (i + 1) * 2,
          numberDisplaced: (i + 1) * 3,
          numberHousesAffected: (i + 1) * 4,
          numberSchoolsAffected: i + 1,
          numberMedicalFacilitiesAffected: i + 1,
          estimatedAgriculturalLandsAffected: `${(i + 1) * 10} hectares`,
          reportingAgent: 'test-user',
          incidentId: incident.id
        }))
      })

      const populationImpact = await IncidentService.calculatePopulationImpact(incident.id)

      // Verify aggregated calculations
      expect(populationImpact.livesLost).toBe(6) // 1 + 2 + 3
      expect(populationImpact.injured).toBe(12) // 2 + 4 + 6
      expect(populationImpact.displaced).toBe(18) // 3 + 6 + 9
      expect(populationImpact.housesAffected).toBe(20) // 4 + 8 + 8
      expect(populationImpact.schoolsAffected).toBe(6) // 1 + 2 + 3
      expect(populationImpact.medicalFacilitiesAffected).toBe(6) // 1 + 2 + 3
      expect(populationImpact.agriculturalLandAffected).toBe(60) // 10 + 20 + 30
      expect(populationImpact.assessmentCount).toBe(3)
    })

    it('calculates epicenter from assessment coordinates', async () => {
      const incident = await db.incident.create({
        data: {
          type: 'Epicenter Test',
          severity: 'HIGH',
          status: 'ACTIVE',
          description: 'Test incident for epicenter calculation',
          location: 'Test Location',
          createdBy: 'test-user'
        }
      })

      // Create assessments with different coordinates
      const coordinates = [
        { lat: 6.0, lng: 3.0 },
        { lat: 7.0, lng: 4.0 },
        { lat: 5.0, lng: 2.0 }
      ]

      await db.preliminaryAssessment.createMany({
        data: coordinates.map((coord, i) => ({
          reportingDate: new Date(),
          reportingLatitude: coord.lat,
          reportingLongitude: coord.lng,
          reportingLGA: `LGA ${i + 1}`,
          reportingWard: `Ward ${i + 1}`,
          numberLivesLost: 1,
          reportingAgent: 'test-user',
          incidentId: incident.id
        }))
      })

      const populationImpact = await IncidentService.calculatePopulationImpact(incident.id)

      // Verify epicenter calculation (average of coordinates)
      expect(populationImpact.epicenter).toEqual({
        lat: 6.0, // (6.0 + 7.0 + 5.0) / 3
        lng: 3.0  // (3.0 + 4.0 + 2.0) / 3
      })
    })

    it('returns zero impact when no assessments', async () => {
      const incident = await db.incident.create({
        data: {
          type: 'No Assessments Incident',
          severity: 'MEDIUM',
          status: 'ACTIVE',
          description: 'Test incident with no assessments',
          location: 'Test Location',
          createdBy: 'test-user'
        }
      })

      const populationImpact = await IncidentService.calculatePopulationImpact(incident.id)

      expect(populationImpact.livesLost).toBe(0)
      expect(populationImpact.injured).toBe(0)
      expect(populationImpact.displaced).toBe(0)
      expect(populationImpact.affectedEntities).toBe(0)
      expect(populationImpact.housesAffected).toBe(0)
      expect(populationImpact.schoolsAffected).toBe(0)
      expect(populationImpact.medicalFacilitiesAffected).toBe(0)
      expect(populationImpact.agriculturalLandAffected).toBe(0)
      expect(populationImpact.assessmentCount).toBe(0)
    })
  })
})