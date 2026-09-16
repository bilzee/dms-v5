import { prisma } from '@/lib/db/client'
import { Incident } from '@prisma/client'
import { 
  CreateIncidentInput,
  QueryIncidentInput 
} from '@/lib/validation/incidents'
import { fromAnswers, RapidAssessmentAnswers } from '@/lib/questions/answers'

export class IncidentService {
  static async create(
    input: CreateIncidentInput,
    createdBy: string
  ): Promise<Incident> {
    const { data, preliminaryAssessmentId } = input

    const incident = await prisma.incident.create({
      data: {
        ...data,
        name: (data as any).name || `Incident-${Date.now()}`,
        createdBy
      }
    })

    // Link preliminary assessment if provided
    if (preliminaryAssessmentId) {
      await prisma.preliminaryAssessment.update({
        where: { id: preliminaryAssessmentId },
        data: { incidentId: incident.id }
      })
    }

    return incident
  }

  static async createFromAssessment(
    assessmentId: string,
    incidentData: CreateIncidentInput['data'],
    createdBy: string
  ): Promise<{ incident: Incident; updatedAssessment: any }> {
    // Get the assessment to use its data for the incident
    const assessment = await prisma.preliminaryAssessment.findUnique({
      where: { id: assessmentId }
    })

    if (!assessment) {
      throw new Error('Assessment not found')
    }

    // Create incident with data from assessment
    const incident = await prisma.incident.create({
      data: {
        ...incidentData,
        name: (incidentData as any).name || `${assessment.reportingLGA}-${Date.now()}`,
        location: incidentData.location || `${assessment.reportingLGA}, ${assessment.reportingWard}`,
        coordinates: incidentData.coordinates || {
          lat: assessment.reportingLatitude,
          lng: assessment.reportingLongitude
        },
        createdBy
      }
    })

    // Link the assessment to the incident
    const updatedAssessment = await prisma.preliminaryAssessment.update({
      where: { id: assessmentId },
      data: { incidentId: incident.id },
      include: { incident: true }
    })

    return { incident, updatedAssessment }
  }

  static async findById(id: string): Promise<Incident | null> {
    return await prisma.incident.findUnique({
      where: { id }
    })
  }

  static async findWithAssessments(id: string) {
    return await prisma.incident.findUnique({
      where: { id },
      include: {
        preliminaryAssessments: {
          orderBy: { createdAt: 'desc' }
        }
      }
    })
  }

  static async findAll(
    query: QueryIncidentInput
  ): Promise<{
    incidents: (Incident & { populationImpact?: any })[]
    total: number
    totalPages: number
  }> {
    const { page, limit, type, severity, status, entityId } = query

    const where: any = {}

    // Add filters
    if (type) {
      where.type = type
    }

    if (severity) {
      where.severity = severity
    }

    if (status) {
      where.status = status
    }

    if (entityId) {
      where.rapidAssessments = {
        some: {
          entityId: entityId
        }
      }
    }

    // Get total count
    const total = await prisma.incident.count({ where })
    const totalPages = Math.ceil(total / limit)

    // Get incidents with related assessments for population impact
    const incidents = await prisma.incident.findMany({
      where,
      include: {
        preliminaryAssessments: {
          select: {
            numberLivesLost: true,
            numberInjured: true,
            numberDisplaced: true,
            numberHousesAffected: true,
            numberSchoolsAffected: true,
            numberMedicalFacilitiesAffected: true,
            estimatedAgriculturalLandsAffected: true,
            reportingLatitude: true,
            reportingLongitude: true
          }
        },
        rapidAssessments: {
          select: {
            id: true,
            location: true,
            coordinates: true,
            createdAt: true,
            rapidAssessmentType: true,
            answers: true
          }
        },
        commitments: {
          select: {
            id: true,
            status: true,
            items: true,
            donorId: true,
            entityId: true,
            totalCommittedQuantity: true,
            deliveredQuantity: true,
            totalValueEstimated: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      },
      skip: (page - 1) * limit,
      take: limit
    })

    // Resolve createdBy user IDs to names
    const creatorIds = [...new Set(incidents.map(i => i.createdBy).filter(Boolean))]
    const creators = creatorIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: creatorIds } },
          select: { id: true, name: true, email: true }
        })
      : []
    const creatorMap = new Map(creators.map(u => [u.id, { name: u.name, email: u.email }]))

    // Calculate population impact for each incident
    const incidentsWithImpact = incidents.map(incident => ({
      ...incident,
      createdByUser: creatorMap.get(incident.createdBy) || null,
      populationImpact: this.calculatePopulationImpactFromData(incident)
    }))

    return {
      incidents: incidentsWithImpact,
      total,
      totalPages
    }
  }

  static async update(
    id: string,
    data: Record<string, any>
  ): Promise<Incident> {
    return await prisma.incident.update({
      where: { id },
      data: {
        ...data,
        updatedAt: new Date()
      }
    })
  }

  static async updateStatus(
    id: string,
    status: 'ACTIVE' | 'CONTAINED' | 'RESOLVED'
  ): Promise<Incident> {
    return await prisma.incident.update({
      where: { id },
      data: { status }
    })
  }

  static async delete(id: string): Promise<void> {
    await prisma.incident.delete({
      where: { id }
    })
  }

  static async softDelete(id: string, deletedBy: string): Promise<Incident> {
    return await prisma.incident.update({
      where: { id },
      data: {
        status: 'RESOLVED',
        updatedAt: new Date()
        // Note: You could add a deletedAt field if needed
      }
    })
  }

  static async getIncidentTypes(): Promise<string[]> {
    // Get unique incident types from the database
    const types = await prisma.incident.findMany({
      select: { type: true },
      distinct: ['type']
    })
    
    return types.map(t => t.type)
  }

  static async getActiveIncidentsCount(): Promise<number> {
    return await prisma.incident.count({
      where: { status: 'ACTIVE' }
    })
  }

  static async getCriticalIncidentsCount(): Promise<number> {
    return await prisma.incident.count({
      where: { 
        status: 'ACTIVE',
        severity: 'CRITICAL'
      }
    })
  }

  // Calculate population impact from incident data (preliminary + rapid assessments)
  static calculatePopulationImpactFromData(incident: any & {
    preliminaryAssessments?: any[]
    rapidAssessments?: any[]
  }): any {
    const preliminaryAssessments = incident.preliminaryAssessments || []
    const rapidAssessments = incident.rapidAssessments || []

    if (preliminaryAssessments.length === 0 && rapidAssessments.length === 0) {
      return {
        totalPopulation: 0,
        livesLost: 0,
        injured: 0,
        displaced: 0,
        affectedEntities: 0,
        housesAffected: 0,
        schoolsAffected: 0,
        medicalFacilitiesAffected: 0,
        agriculturalLandAffected: 0,
        epicenter: incident.coordinates || null,
        lastUpdated: new Date().toISOString(),
        assessmentCount: 0
      }
    }

    // Aggregate population data from preliminary assessments
    const populationData = preliminaryAssessments.reduce((acc: any, assessment: any) => {
      acc.livesLost += assessment.numberLivesLost || 0
      acc.injured += assessment.numberInjured || 0
      acc.displaced += assessment.numberDisplaced || 0
      acc.housesAffected += assessment.numberHousesAffected || 0
      acc.schoolsAffected += assessment.numberSchoolsAffected || 0
      acc.medicalFacilitiesAffected += assessment.numberMedicalFacilitiesAffected || 0
      
      // Process agricultural land
      if (assessment.estimatedAgriculturalLandsAffected) {
        const [hectares] = assessment.estimatedAgriculturalLandsAffected.toString().split(' ').map(Number)
        acc.agriculturalLandAffected += hectares || 0
      }
      
      // Calculate epicenter (average coordinates)
      if (assessment.reportingLatitude && assessment.reportingLongitude) {
        acc.latSum += assessment.reportingLatitude
        acc.lngSum += assessment.reportingLongitude
        acc.coordinateCount += 1
      }
      
      return acc
    }, {
      livesLost: 0,
      injured: 0,
      displaced: 0,
      housesAffected: 0,
      schoolsAffected: 0,
      medicalFacilitiesAffected: 0,
      agriculturalLandAffected: 0,
      latSum: 0,
      lngSum: 0,
      coordinateCount: 0,
      totalPopulation: 0
    })

    // Aggregate population data from rapid assessments (nested structure)
    rapidAssessments.forEach((assessment: any) => {
      // Hydrate the legacy typed payload view from the canonical answers map
      if (assessment.rapidAssessmentType === 'POPULATION') {
        const population = fromAnswers('POPULATION', (assessment.answers ?? {}) as RapidAssessmentAnswers)
        populationData.livesLost += population.numberLivesLost || 0
        populationData.injured += population.numberInjured || 0
        populationData.totalPopulation += population.totalPopulation || 0
        populationData.housesAffected += population.totalHouseholds || 0
      }

      if (assessment.rapidAssessmentType === 'HEALTH') {
        const health = fromAnswers('HEALTH', (assessment.answers ?? {}) as RapidAssessmentAnswers)
        populationData.medicalFacilitiesAffected += health.numberHealthFacilities || 0
      }

      // Calculate epicenter (average coordinates) from rapid assessment location
      if (assessment.coordinates?.lat && assessment.coordinates?.lng) {
        populationData.latSum += assessment.coordinates.lat
        populationData.lngSum += assessment.coordinates.lng
        populationData.coordinateCount += 1
      }
    })

    // Calculate epicenter
    const epicenter = populationData.coordinateCount > 0 
      ? { 
          lat: populationData.latSum / populationData.coordinateCount,
          lng: populationData.lngSum / populationData.coordinateCount
        }
      : incident.coordinates || null

    return {
      totalPopulation: populationData.totalPopulation,
      livesLost: populationData.livesLost,
      injured: populationData.injured,
      displaced: populationData.displaced,
      affectedEntities: preliminaryAssessments.length + rapidAssessments.length,
      housesAffected: populationData.housesAffected,
      schoolsAffected: populationData.schoolsAffected,
      medicalFacilitiesAffected: populationData.medicalFacilitiesAffected,
      agriculturalLandAffected: populationData.agriculturalLandAffected,
      epicenter,
      lastUpdated: new Date().toISOString(),
      assessmentCount: preliminaryAssessments.length + rapidAssessments.length
    }
  }

  // Calculate population impact for specific incident ID
  static async calculatePopulationImpact(incidentId: string): Promise<any> {
    const incident = await this.findWithAssessments(incidentId)
    
    if (!incident) {
      throw new Error('Incident not found')
    }

    return this.calculatePopulationImpactFromData(incident)
  }
}