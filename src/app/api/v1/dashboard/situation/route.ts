import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/client';
import { z } from 'zod';
import type { EntityType, AssessmentType } from '@prisma/client';
import {
  analyzeHealthGaps,
  analyzeFoodGaps,
  analyzeWASHGaps,
  analyzeShelterGaps,
  analyzeSecurityGaps,
  getGapFieldSeverity,
  type HealthGapAnalysis,
  type FoodGapAnalysis,
  type WASHGapAnalysis,
  type ShelterGapAnalysis,
  type SecurityGapAnalysis
} from '@/lib/services/gap-analysis.service';
import { fromAnswers, RapidAssessmentAnswers } from '@/lib/questions/legacy-convert';
import { handleApiError } from '@/lib/api/response'

// Rate limiting implementation
class RateLimiter {
  private static requests = new Map<string, { count: number; resetTime: number }>();
  
  static isRateLimited(request: NextRequest, limit: number = 100, windowMs: number = 60000): boolean {
    const clientIp = this.getClientIp(request);
    const now = Date.now();
    const key = `${clientIp}:${Math.floor(now / windowMs)}`;
    
    const current = this.requests.get(key);
    
    if (!current) {
      this.requests.set(key, { count: 1, resetTime: now + windowMs });
      this.cleanup();
      return false;
    }
    
    if (current.count >= limit) {
      return true;
    }
    
    current.count++;
    return false;
  }
  
  private static getClientIp(request: NextRequest): string {
    // Try various headers for client IP
    const forwardedFor = request.headers.get('x-forwarded-for');
    const realIp = request.headers.get('x-real-ip');
    const clientIp = request.headers.get('x-client-ip');
    
    if (forwardedFor) {
      return forwardedFor.split(',')[0].trim();
    }
    
    if (realIp) {
      return realIp;
    }
    
    if (clientIp) {
      return clientIp;
    }
    
    // Fallback to request IP
    return 'unknown';
  }
  
  private static cleanup(): void {
    const now = Date.now();
    for (const [key, value] of this.requests.entries()) {
      if (now > value.resetTime) {
        this.requests.delete(key);
      }
    }
  }
}

// Query parameter validation schema - Enhanced security to prevent SQL injection
const DashboardQuerySchema = z.object({
  incidentId: z.string().regex(/^[a-zA-Z0-9_-]+$/, 'Invalid incident ID format').nullish(),
  entityId: z.string().regex(/^[a-zA-Z0-9_-]+$|^all$/, 'Invalid entity ID format').nullish(),
  realTime: z.coerce.boolean().default(false),
  includeHistorical: z.coerce.boolean().default(false),
  limit: z.coerce.number().min(1).max(100).default(50),
  // Interactive map parameters
  includeEntityLocations: z.coerce.boolean().default(false),
  includeDonorAssignments: z.coerce.boolean().default(false),
  severityFilter: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'ALL']).default('ALL').nullish(),
  entityTypeFilter: z.enum(['COMMUNITY', 'WARD', 'LGA', 'STATE', 'FACILITY', 'CAMP', 'ALL']).default('ALL').nullish(),
  // Gap analysis summary parameter
  includeGapSummary: z.coerce.boolean().default(false)
}).transform(data => ({
  ...data,
  incidentId: data.incidentId || undefined,
  entityId: data.entityId || undefined,
  severityFilter: data.severityFilter || 'ALL',
  entityTypeFilter: data.entityTypeFilter || 'ALL'
}));

// Enhanced type definitions for dashboard data
interface IncidentSummary {
  id: string;
  type: string;
  subType: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  status: 'ACTIVE' | 'CONTAINED' | 'RESOLVED';
  description: string;
  location: string;
  coordinates?: any;
  createdAt: Date;
  updatedAt: Date;
  populationImpact?: number;
  durationDays?: number;
  durationInCurrentStatus?: number;
  totalDuration?: number;
}

// Verified Population Assessment data (from Population Assessments)
interface VerifiedPopulationImpact {
  totalPopulation: number;
  totalHouseholds: number;
  livesLost: number;
  injured: number;
  percentageMale: number;
  percentageFemale: number;
  percentageChildren: number;
  pregnantWomen: number;
  lactatingWomen: number;
  demographicBreakdown: {
    under5: number;
    elderly: number;
    pwd: number;
    pregnantWomen: number;
    lactatingMothers: number;
    separatedChildren: number;
    populationMale: number;
    populationFemale: number;
  };
  latestAssessmentDate: string | null;
  assessmentCount: number;
}

// Preliminary Assessment data (estimates, not verified)
interface PreliminaryImpact {
  livesLost: number;
  injured: number;
  displaced: number;
  housesAffected: number;
  schoolsAffected: number;
  medicalFacilitiesAffected: number;
  agriculturalLandAffected: number;
  latestAssessmentDate: string | null;
  assessmentCount: number;
}

// Combined interface for backward compatibility and complete data structure
interface PopulationImpact {
  // Verified data from Population Assessments
  verified: VerifiedPopulationImpact;
  // Preliminary data from Preliminary Assessments
  preliminary: PreliminaryImpact;
  // Legacy combined fields for backward compatibility
  totalPopulation: number;
  totalHouseholds: number;
  aggregatedLivesLost: number;
  aggregatedInjured: number;
  aggregatedDisplaced: number;
  demographicBreakdown: {
    under5: number;
    elderly: number;
    pwd: number;
    pregnantWomen: number;
    lactatingMothers: number;
    separatedChildren: number;
    populationMale: number;
    populationFemale: number;
  };
  sourceAssessments: {
    populationCount: number;
    preliminaryCount: number;
  };
}

// Enhanced assessment data interfaces
export interface HealthAssessmentData {
  rapidAssessmentId: string;
  hasFunctionalClinic: boolean;
  hasEmergencyServices: boolean;
  numberHealthFacilities: number;
  healthFacilityType: string;
  qualifiedHealthWorkers: number;
  hasTrainedStaff: boolean;
  hasMedicineSupply: boolean;
  hasMedicalSupplies: boolean;
  hasMaternalChildServices: boolean;
  commonHealthIssues: string[];
  additionalHealthDetails?: any;
  rapidAssessmentDate: Date;
  verificationStatus: string;
  assessorName: string;
}

export interface FoodAssessmentData {
  rapidAssessmentId: string;
  isFoodSufficient: boolean;
  hasRegularMealAccess: boolean;
  hasInfantNutrition: boolean;
  foodSource: string[];
  availableFoodDurationDays: number;
  additionalFoodRequiredPersons: number;
  additionalFoodRequiredHouseholds: number;
  additionalFoodDetails?: any;
  rapidAssessmentDate: Date;
  verificationStatus: string;
  assessorName: string;
}

export interface WASHAssessmentData {
  rapidAssessmentId: string;
  waterSource: string[];
  isWaterSufficient: boolean;
  hasCleanWaterAccess: boolean;
  functionalLatrinesAvailable: number;
  areLatrinesSufficient: boolean;
  hasHandwashingFacilities: boolean;
  hasOpenDefecationConcerns: boolean;
  additionalWashDetails?: any;
  rapidAssessmentDate: Date;
  verificationStatus: string;
  assessorName: string;
}

export interface ShelterAssessmentData {
  rapidAssessmentId: string;
  areSheltersSufficient: boolean;
  hasSafeStructures: boolean;
  shelterTypes: string[];
  requiredShelterType: string[];
  numberSheltersRequired: number;
  areOvercrowded: boolean;
  provideWeatherProtection: boolean;
  additionalShelterDetails?: any;
  rapidAssessmentDate: Date;
  verificationStatus: string;
  assessorName: string;
}

export interface SecurityAssessmentData {
  rapidAssessmentId: string;
  isSafeFromViolence: boolean;
  gbvCasesReported: boolean;
  hasSecurityPresence: boolean;
  hasProtectionReportingMechanism: boolean;
  vulnerableGroupsHaveAccess: boolean;
  hasLighting: boolean;
  additionalSecurityDetails?: any;
  rapidAssessmentDate: Date;
  verificationStatus: string;
  assessorName: string;
}

export interface PopulationAssessmentData {
  rapidAssessmentId: string;
  totalHouseholds: number;
  totalPopulation: number;
  populationMale: number;
  populationFemale: number;
  populationUnder5: number;
  pregnantWomen: number;
  lactatingMothers: number;
  personWithDisability: number;
  elderlyPersons: number;
  separatedChildren: number;
  numberLivesLost: number;
  numberInjured: number;
  additionalPopulationDetails?: any;
  rapidAssessmentDate: Date;
  verificationStatus: string;
  assessorName: string;
}

// Interactive map type definitions
interface EntityLocation {
  id: string;
  name: string;
  type: string;
  coordinates?: {
    latitude: number;
    longitude: number;
  };
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  gapSummary: {
    totalGaps: number;
    totalNoGaps: number;
    criticalGaps: number;
    severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  };
  donorAssignments?: Array<{
    donorId: string;
    donorName: string;
    commitmentStatus: string;
    items: Array<{
      name: string;
      quantity: number;
      unit: string;
    }>;
  }>;
}

interface EntityLocationsResponse {
  entities: EntityLocation[];
  mapBounds: {
    northEast: { lat: number; lng: number };
    southWest: { lat: number; lng: number };
  };
  totalCount: number;
}

// Gap analysis interfaces are now imported from gap-analysis.service

interface AggregatedHealthAssessment {
  totalEntities: number;
  entitiesWithGaps: number;
  entitiesWithoutGaps: number;
  totalHealthFacilities: number;
  totalQualifiedWorkers: number;
}

interface AggregatedFoodAssessment {
  totalEntities: number;
  entitiesWithGaps: number;
  entitiesWithoutGaps: number;
  averageFoodDuration: number;
  totalAdditionalPersonsRequired: number;
}

interface AggregatedWASHAssessment {
  totalEntities: number;
  entitiesWithGaps: number;
  entitiesWithoutGaps: number;
  totalFunctionalLatrines: number;
}

interface AggregatedShelterAssessment {
  totalEntities: number;
  entitiesWithGaps: number;
  entitiesWithoutGaps: number;
  totalSheltersRequired: number;
}

interface AggregatedSecurityAssessment {
  totalEntities: number;
  entitiesWithGaps: number;
  entitiesWithoutGaps: number;
}

interface AggregatedPopulationAssessment {
  totalEntities: number;
  totalPopulation: number;
  totalHouseholds: number;
  totalLivesLost: number;
  totalInjured: number;
}

interface AggregatedAssessments {
  health: AggregatedHealthAssessment;
  food: AggregatedFoodAssessment;
  wash: AggregatedWASHAssessment;
  shelter: AggregatedShelterAssessment;
  security: AggregatedSecurityAssessment;
  population: AggregatedPopulationAssessment;
  gapSummary: {
    totalGaps: number;
    totalNoGaps: number;
    criticalGaps: number;
    entitiesWithGaps: number;
    entitiesWithoutGaps: number;
  };
}

interface AggregateMetrics {
  affectedEntitiesCount: number;
  totalAssessmentsCount: number;
  verifiedAssessmentsCount: number;
  responsesCount: number;
  totalResponsePlans: number;
  deliveryRate: number;
  coverageRate: number;
  trends?: {
    assessmentsChange: number;
    responsesChange: number;
    entitiesChange: number;
  };
}

interface EntityAssessment {
  id: string;
  name: string;
  type: EntityType;
  location: string | null;  // Allow null for entities without location data
  coordinates?: any;
  affectedAt: Date;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  severityCount: number;
  latestAssessments: {
    health?: (HealthAssessmentData & { gapAnalysis: HealthGapAnalysis });
    food?: (FoodAssessmentData & { gapAnalysis: FoodGapAnalysis });
    wash?: (WASHAssessmentData & { gapAnalysis: WASHGapAnalysis });
    shelter?: (ShelterAssessmentData & { gapAnalysis: ShelterGapAnalysis });
    security?: (SecurityAssessmentData & { gapAnalysis: SecurityGapAnalysis });
    population?: PopulationAssessmentData;
  };
  gapSummary: {
    totalGaps: number;
    totalNoGaps: number;
    criticalGaps: number;
  };
  lastUpdated: Date;
}

interface GapAnalysis {
  entityId: string;
  entityName: string;
  entityType: 'COMMUNITY' | 'WARD' | 'LGA' | 'STATE' | 'FACILITY' | 'CAMP';
  location: string | null | undefined;  // Allow both null and undefined for flexibility
  assessmentGaps: {
    [key: string]: {
      hasGap: boolean;
      severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
      lastAssessed: Date;
      indicators: {
        category: string;
        hasGap: boolean;
        description: string;
      }[];
    };
  };
  overallGapSeverity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  totalGapCount: number;
  lastUpdated: Date;
}

// Gap analysis summary interfaces
interface GapAnalysisSummary {
  totalEntities: number;
  severityDistribution: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  assessmentTypeGaps: {
    [assessmentType: string]: {
      severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
      entitiesAffected: number;
      percentage: number;
    };
  };
  lastUpdated: string;
}

interface SituationDashboardData {
  incidents: IncidentSummary[];
  entities: EntityAssessment[];
  gaps: GapAnalysis[];
  realTimeUpdates: boolean;
  lastUpdated: Date;
  // New fields for incident overview panel
  selectedIncident?: {
    incident: IncidentSummary;
    populationImpact: PopulationImpact;
    aggregateMetrics: AggregateMetrics;
  };
  // Enhanced fields for entity assessment panel
  entityAssessments: EntityAssessment[];
  aggregatedAssessments?: AggregatedAssessments;
  // Interactive map fields
  entityLocations?: EntityLocationsResponse;
  // Gap analysis summary fields
  gapAnalysisSummary?: GapAnalysisSummary;
}

// Helper functions for enhanced metrics - Fixed SQL injection vulnerabilities
async function getPopulationImpact(incidentId: string): Promise<PopulationImpact> {
  // Validate incidentId to prevent SQL injection
  if (!incidentId || typeof incidentId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(incidentId)) {
    throw new Error('Invalid incident ID format');
  }

  // First, get all entities that have population assessments for this incident
  const entitiesWithPopulationAssessments = await prisma.entity.findMany({
    where: {
      rapidAssessments: {
        some: {
          incidentId: incidentId,
          verificationStatus: { in: ['VERIFIED', 'AUTO_VERIFIED'] },
          rapidAssessmentType: 'POPULATION',
        },
      },
      isActive: true,
    },
    select: {
      id: true,
    },
  });

  // Then fetch only the latest population assessment for each entity
  const latestPopulationAssessments = await Promise.all(
    entitiesWithPopulationAssessments.map(async (entity) => {
      return prisma.rapidAssessment.findFirst({
        where: {
          entityId: entity.id,
          incidentId: incidentId,
          verificationStatus: { in: ['VERIFIED', 'AUTO_VERIFIED'] },
          rapidAssessmentType: 'POPULATION',
        },
        select: {
          id: true,
          entityId: true,
          rapidAssessmentDate: true,
          answers: true,
        },
        orderBy: {
          rapidAssessmentDate: 'desc',
        },
      });
    })
  );

  // Filter out null results and hydrate the legacy population payload from answers
  const populationData = latestPopulationAssessments
    .filter(
      (assessment): assessment is NonNullable<typeof assessment> =>
        assessment !== null
    )
    .map((assessment) => ({
      payload: fromAnswers('POPULATION', (assessment.answers ?? {}) as RapidAssessmentAnswers),
      rapidAssessmentDate: assessment.rapidAssessmentDate,
    }));

  type PopulationAggregation = {
    totalPopulation: number;
    totalHouseholds: number;
    populationMale: number;
    populationFemale: number;
    under5: number;
    elderly: number;
    pwd: number;
    pregnantWomen: number;
    lactatingMothers: number;
    separatedChildren: number;
    populationLivesLost: number;
    populationInjured: number;
    populationCount: number;
    latestDate: string | null;
  };

  const populationAggregation: PopulationAggregation = populationData.reduce<PopulationAggregation>(
    (acc, assessment) => ({
      totalPopulation: acc.totalPopulation + Number(assessment.payload.totalPopulation || 0),
      totalHouseholds: acc.totalHouseholds + Number(assessment.payload.totalHouseholds || 0),
      populationMale: acc.populationMale + Number(assessment.payload.populationMale || 0),
      populationFemale: acc.populationFemale + Number(assessment.payload.populationFemale || 0),
      under5: acc.under5 + Number(assessment.payload.populationUnder5 || 0),
      elderly: acc.elderly + Number(assessment.payload.elderlyPersons || 0),
      pwd: acc.pwd + Number(assessment.payload.personWithDisability || 0),
      pregnantWomen: acc.pregnantWomen + Number(assessment.payload.pregnantWomen || 0),
      lactatingMothers: acc.lactatingMothers + Number(assessment.payload.lactatingMothers || 0),
      separatedChildren: acc.separatedChildren + Number(assessment.payload.separatedChildren || 0),
      populationLivesLost: acc.populationLivesLost + Number(assessment.payload.numberLivesLost || 0),
      populationInjured: acc.populationInjured + Number(assessment.payload.numberInjured || 0),
      populationCount: acc.populationCount + 1,
      latestDate: acc.latestDate && assessment.rapidAssessmentDate ? 
        (new Date(assessment.rapidAssessmentDate) > new Date(acc.latestDate) ? 
          assessment.rapidAssessmentDate.toISOString() : acc.latestDate) : 
        (assessment.rapidAssessmentDate?.toISOString() || acc.latestDate),
    }),
    {
      totalPopulation: 0,
      totalHouseholds: 0,
      populationMale: 0,
      populationFemale: 0,
      under5: 0,
      elderly: 0,
      pwd: 0,
      pregnantWomen: 0,
      lactatingMothers: 0,
      separatedChildren: 0,
      populationLivesLost: 0,
      populationInjured: 0,
      populationCount: 0,
      latestDate: null as string | null,
    }
  );

  // Use Prisma query to get preliminary assessment data
  const preliminaryData = await prisma.preliminaryAssessment.findMany({
    where: {
      incidentId: incidentId,
    },
    orderBy: {
      createdAt: 'desc'
    }
  });

  const preliminaryAggregation = preliminaryData.reduce(
    (acc, assessment) => ({
      preliminaryLivesLost: acc.preliminaryLivesLost + (assessment.numberLivesLost || 0),
      preliminaryInjured: acc.preliminaryInjured + (assessment.numberInjured || 0),
      aggregatedDisplaced: acc.aggregatedDisplaced + (assessment.numberDisplaced || 0),
      housesAffected: acc.housesAffected + (assessment.numberHousesAffected || 0),
      schoolsAffected: acc.schoolsAffected + (assessment.numberSchoolsAffected || 0),
      medicalFacilitiesAffected: acc.medicalFacilitiesAffected + (assessment.numberMedicalFacilitiesAffected || 0),
      agriculturalLandAffected: acc.agriculturalLandAffected + (assessment.estimatedAgriculturalLandsAffected ? parseFloat(assessment.estimatedAgriculturalLandsAffected) : 0),
      preliminaryCount: acc.preliminaryCount + 1,
      latestDate: acc.latestDate && assessment.createdAt ? 
        (new Date(assessment.createdAt) > new Date(acc.latestDate) ? 
          assessment.createdAt : acc.latestDate) : 
        (assessment.createdAt || acc.latestDate),
    }),
    {
      preliminaryLivesLost: 0,
      preliminaryInjured: 0,
      aggregatedDisplaced: 0,
      housesAffected: 0,
      schoolsAffected: 0,
      medicalFacilitiesAffected: 0,
      agriculturalLandAffected: 0,
      preliminaryCount: 0,
      latestDate: null as Date | null,
    }
  );

  // Calculate percentages for verified population data
  const totalPop = populationAggregation.totalPopulation;
  const percentageMale = totalPop > 0 ? Math.round((populationAggregation.populationMale / totalPop) * 100) : 0;
  const percentageFemale = totalPop > 0 ? Math.round((populationAggregation.populationFemale / totalPop) * 100) : 0;
  const percentageChildren = totalPop > 0 ? Math.round((populationAggregation.under5 / totalPop) * 100) : 0;

  return {
    // New separated structure
    verified: {
      totalPopulation: populationAggregation.totalPopulation,
      totalHouseholds: populationAggregation.totalHouseholds,
      livesLost: populationAggregation.populationLivesLost,
      injured: populationAggregation.populationInjured,
      percentageMale,
      percentageFemale,
      percentageChildren,
      pregnantWomen: populationAggregation.pregnantWomen,
      lactatingWomen: populationAggregation.lactatingMothers,
      demographicBreakdown: {
        under5: populationAggregation.under5,
        elderly: populationAggregation.elderly,
        pwd: populationAggregation.pwd,
        pregnantWomen: populationAggregation.pregnantWomen,
        lactatingMothers: populationAggregation.lactatingMothers,
        separatedChildren: populationAggregation.separatedChildren,
        populationMale: populationAggregation.populationMale,
        populationFemale: populationAggregation.populationFemale,
      },
      latestAssessmentDate: populationAggregation.latestDate,
      assessmentCount: populationAggregation.populationCount,
    },
    preliminary: {
      livesLost: preliminaryAggregation.preliminaryLivesLost,
      injured: preliminaryAggregation.preliminaryInjured,
      displaced: preliminaryAggregation.aggregatedDisplaced,
      housesAffected: preliminaryAggregation.housesAffected,
      schoolsAffected: preliminaryAggregation.schoolsAffected,
      medicalFacilitiesAffected: preliminaryAggregation.medicalFacilitiesAffected,
      agriculturalLandAffected: preliminaryAggregation.agriculturalLandAffected,
      latestAssessmentDate: preliminaryAggregation.latestDate?.toISOString() || null,
      assessmentCount: preliminaryAggregation.preliminaryCount,
    },
    // Legacy combined fields for backward compatibility
    totalPopulation: populationAggregation.totalPopulation,
    totalHouseholds: populationAggregation.totalHouseholds,
    aggregatedLivesLost: populationAggregation.populationLivesLost + preliminaryAggregation.preliminaryLivesLost,
    aggregatedInjured: populationAggregation.populationInjured + preliminaryAggregation.preliminaryInjured,
    aggregatedDisplaced: preliminaryAggregation.aggregatedDisplaced,
    demographicBreakdown: {
      under5: populationAggregation.under5,
      elderly: populationAggregation.elderly,
      pwd: populationAggregation.pwd,
      pregnantWomen: populationAggregation.pregnantWomen,
      lactatingMothers: populationAggregation.lactatingMothers,
      separatedChildren: populationAggregation.separatedChildren,
      populationMale: populationAggregation.populationMale,
      populationFemale: populationAggregation.populationFemale,
    },
    sourceAssessments: {
      populationCount: populationAggregation.populationCount,
      preliminaryCount: preliminaryAggregation.preliminaryCount,
    },
  };
}

async function getAggregateMetrics(incidentId: string): Promise<AggregateMetrics> {
  // Get affected entities count — entities with at least one verified/auto-verified
  // assessment for this incident (consistent with the rest of the dashboard).
  const affectedEntitiesCount = await prisma.entity.count({
    where: {
      rapidAssessments: {
        some: {
          incidentId: incidentId,
          verificationStatus: { in: ['VERIFIED', 'AUTO_VERIFIED'] },
        },
      },
      isActive: true,
    },
  });

  // Get assessment counts — only non-draft assessments are counted.
  const totalAssessmentsCount = await prisma.rapidAssessment.count({
    where: {
      incidentId: incidentId,
      verificationStatus: { in: ['SUBMITTED', 'VERIFIED', 'AUTO_VERIFIED'] },
    },
  });

  const verifiedAssessmentsCount = await prisma.rapidAssessment.count({
    where: {
      incidentId: incidentId,
      verificationStatus: { in: ['VERIFIED', 'AUTO_VERIFIED'] },
    },
  });

  // Get response counts — delivered responses plus planned (not yet delivered) responses.
  const deliveredResponsesCount = await prisma.rapidResponse.count({
    where: {
      assessment: {
        incidentId: incidentId,
      },
      deliveryStatus: 'DELIVERED',
    },
  });

  const plannedResponsesCount = await prisma.rapidResponse.count({
    where: {
      assessment: {
        incidentId: incidentId,
      },
      deliveryStatus: 'PLANNED',
    },
  });

  const totalResponsePlans = deliveredResponsesCount + plannedResponsesCount;

  return {
    affectedEntitiesCount,
    totalAssessmentsCount,
    verifiedAssessmentsCount,
    responsesCount: deliveredResponsesCount,
    totalResponsePlans,
    deliveryRate: totalResponsePlans > 0 ? deliveredResponsesCount / totalResponsePlans : 0,
    coverageRate: affectedEntitiesCount > 0 ? totalAssessmentsCount / affectedEntitiesCount : 0,
  };
}

function calculateDurationInfo(incident: any) {
  const now = new Date();
  const createdAt = new Date(incident.createdAt);
  const updatedAt = new Date(incident.updatedAt);
  
  const totalDurationHours = Math.floor((now.getTime() - createdAt.getTime()) / (1000 * 60 * 60));
  const inCurrentStatusHours = Math.floor((now.getTime() - updatedAt.getTime()) / (1000 * 60 * 60));
  
  return {
    totalDuration: totalDurationHours,
    durationInCurrentStatus: inCurrentStatusHours,
    durationDays: Math.floor(totalDurationHours / 24),
  };
}

// Enhanced entity assessment functions
async function getEntityAssessments(incidentId: string, entityId?: string): Promise<EntityAssessment[]> {
  if (!incidentId || typeof incidentId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(incidentId)) {
    throw new Error('Invalid incident ID format');
  }

  const entitiesQuery = entityId && entityId !== 'all'
    ? prisma.$queryRaw`
        SELECT 
          e.id,
          e.name,
          e.type,
          e.location,
          e.coordinates,
          ra."rapidAssessmentDate" as "affectedAt",
          ra.id as "rapidAssessmentId",
          ra."rapidAssessmentDate",
          ra."verificationStatus",
          ra."assessorName"
        FROM entities e
        JOIN rapid_assessments ra ON e.id = ra."entityId" 
          AND ra."incidentId" = ${incidentId}
          AND ra."verificationStatus" IN ('VERIFIED', 'AUTO_VERIFIED')
        WHERE e."isActive" = true
          AND e.id = ${entityId}
        ORDER BY ra."rapidAssessmentDate" DESC
      ` as unknown as any[]
    : prisma.$queryRaw`
        SELECT 
          e.id,
          e.name,
          e.type,
          e.location,
          e.coordinates,
          ra."rapidAssessmentDate" as "affectedAt",
          ra.id as "rapidAssessmentId",
          ra."rapidAssessmentDate",
          ra."verificationStatus",
          ra."assessorName"
        FROM entities e
        JOIN rapid_assessments ra ON e.id = ra."entityId" 
          AND ra."incidentId" = ${incidentId}
          AND ra."verificationStatus" IN ('VERIFIED', 'AUTO_VERIFIED')
        WHERE e."isActive" = true
        ORDER BY e.name, ra."rapidAssessmentDate" DESC
        LIMIT 100
      ` as unknown as any[];

  const entities = await entitiesQuery;
  
  // Get latest assessments for each entity
  const entityAssessments: EntityAssessment[] = [];
  const entityMap = new Map<string, any>();

  entities.forEach(row => {
    if (!entityMap.has(row.id)) {
      entityMap.set(row.id, {
        id: row.id,
        name: row.name,
        type: row.type,
        location: row.location,
        coordinates: row.coordinates,
        affectedAt: row.affectedAt,
        severity: 'LOW', // Will be calculated dynamically
        severityCount: 0, // Will be calculated dynamically
        latestAssessments: {},
        gapSummary: {
          totalGaps: 0,
          totalNoGaps: 0,
          criticalGaps: 0
        },
        lastUpdated: new Date()
      });
    }
  });

  // Fetch detailed assessment data for each entity
  for (const [entityId, entityData] of entityMap) {
    const assessments = await Promise.all([
      getLatestHealthAssessment(entityId, incidentId),
      getLatestFoodAssessment(entityId, incidentId),
      getLatestWASHAssessment(entityId, incidentId),
      getLatestShelterAssessment(entityId, incidentId),
      getLatestSecurityAssessment(entityId, incidentId),
      getLatestPopulationAssessment(entityId, incidentId)
    ]);

    entityData.latestAssessments = {
      health: assessments[0],
      food: assessments[1],
      wash: assessments[2],
      shelter: assessments[3],
      security: assessments[4],
      population: assessments[5]
    };

    // Calculate entity severity based on highest assessment severity
    const assessmentSeverities: ('CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW')[] = [];
    
    assessments.slice(0, 5).forEach(assessment => { // Exclude population from gap analysis
      if (assessment && 'gapAnalysis' in assessment && assessment.gapAnalysis.hasGap) {
        assessmentSeverities.push(assessment.gapAnalysis.severity as 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW');
      } else if (assessment) {
        assessmentSeverities.push('LOW'); // No gaps means LOW severity
      }
    });

    // Calculate highest severity and count
    let entitySeverity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' = 'LOW';
    let highestSeverityCount = 0;
    
    if (assessmentSeverities.length > 0) {
      // Priority order: CRITICAL > HIGH > MEDIUM > LOW
      if (assessmentSeverities.includes('CRITICAL')) {
        entitySeverity = 'CRITICAL';
        highestSeverityCount = assessmentSeverities.filter(s => s === 'CRITICAL').length;
      } else if (assessmentSeverities.includes('HIGH')) {
        entitySeverity = 'HIGH';
        highestSeverityCount = assessmentSeverities.filter(s => s === 'HIGH').length;
      } else if (assessmentSeverities.includes('MEDIUM')) {
        entitySeverity = 'MEDIUM';
        highestSeverityCount = assessmentSeverities.filter(s => s === 'MEDIUM').length;
      } else {
        entitySeverity = 'LOW';
        highestSeverityCount = assessmentSeverities.filter(s => s === 'LOW').length;
      }
    }

    // Store calculated entity severity and count
    entityData.severity = entitySeverity;
    entityData.severityCount = highestSeverityCount;

    // Calculate gap summary
    let totalGaps = 0;
    let totalNoGaps = 0;
    let criticalGaps = 0;

    assessments.slice(0, 5).forEach(assessment => { // Exclude population from gap analysis
      if (assessment && 'gapAnalysis' in assessment) {
        if (assessment.gapAnalysis.hasGap) {
          totalGaps++;
          if (assessment.gapAnalysis.severity === 'CRITICAL') {
            criticalGaps++;
          }
        } else {
          totalNoGaps++;
        }
      }
    });

    entityData.gapSummary = { totalGaps, totalNoGaps, criticalGaps };
    entityAssessments.push(entityData);
  }

  return entityAssessments;
}

async function getAggregatedAssessments(incidentId: string): Promise<AggregatedAssessments> {
  if (!incidentId || typeof incidentId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(incidentId)) {
    throw new Error('Invalid incident ID format');
  }

  // Mock aggregated assessments for now
  const aggregatedHealth = { 
    totalEntities: 3, 
    entitiesWithGaps: 2, 
    entitiesWithoutGaps: 1,
    totalHealthFacilities: 5,
    totalQualifiedWorkers: 12
  };
  const aggregatedFood = { 
    totalEntities: 3, 
    entitiesWithGaps: 1, 
    entitiesWithoutGaps: 2,
    averageFoodDuration: 7,
    totalAdditionalPersonsRequired: 500
  };
  const aggregatedWASH = { 
    totalEntities: 3, 
    entitiesWithGaps: 1, 
    entitiesWithoutGaps: 2,
    totalFunctionalLatrines: 25
  };
  const aggregatedShelter = { 
    totalEntities: 3, 
    entitiesWithGaps: 1, 
    entitiesWithoutGaps: 2,
    totalSheltersRequired: 150
  };
  const aggregatedSecurity = { 
    totalEntities: 3, 
    entitiesWithGaps: 0, 
    entitiesWithoutGaps: 3
  };
  const aggregatedPopulation = { 
    totalEntities: 3, 
    totalPopulation: 25000, 
    totalHouseholds: 5000, 
    totalLivesLost: 0, 
    totalInjured: 5 
  };

  // Calculate aggregated gap summary
  let totalGaps = 0;
  let totalNoGaps = 0;
  let criticalGaps = 0;
  let entitiesWithGaps = 0;
  let entitiesWithoutGaps = 0;

  // Calculate gap summary - remove this since entityAssessments is not available here
  totalGaps = 5; // Mock for now
  totalNoGaps = 10;
  criticalGaps = 2;
  entitiesWithGaps = 2;
  entitiesWithoutGaps = 1;

  return {
    health: aggregatedHealth,
    food: aggregatedFood,
    wash: aggregatedWASH,
    shelter: aggregatedShelter,
    security: aggregatedSecurity,
    population: aggregatedPopulation,
    gapSummary: {
      totalGaps,
      totalNoGaps,
      criticalGaps,
      entitiesWithGaps,
      entitiesWithoutGaps
    }
  };
}

// Individual assessment fetchers — all types now live on RapidAssessment.answers,
// hydrated back to the legacy typed shape via the registry converter.
interface LatestTypedAssessment {
  id: string;
  rapidAssessmentDate: Date;
  verificationStatus: string;
  assessorName: string | null;
  assessorNameFallback: string | null;
  answers: RapidAssessmentAnswers;
  gapAnalysis: unknown;
}

async function findLatestTypedAssessment(
  entityId: string,
  incidentId: string | undefined,
  assessmentType: 'HEALTH' | 'FOOD' | 'WASH' | 'SHELTER' | 'SECURITY' | 'POPULATION'
): Promise<LatestTypedAssessment | null> {
  const assessment = await prisma.rapidAssessment.findFirst({
    where: {
      entityId,
      incidentId,
      rapidAssessmentType: assessmentType,
      verificationStatus: { in: ['VERIFIED', 'AUTO_VERIFIED'] },
    },
    select: {
      id: true,
      answers: true,
      gapAnalysis: true,
      rapidAssessmentDate: true,
      verificationStatus: true,
      assessorName: true,
      assessor: {
        select: {
          name: true,
        },
      },
    },
    orderBy: {
      rapidAssessmentDate: 'desc',
    },
  });

  if (!assessment) return null;

  return {
    id: assessment.id,
    rapidAssessmentDate: assessment.rapidAssessmentDate,
    verificationStatus: assessment.verificationStatus,
    assessorName: assessment.assessorName,
    assessorNameFallback: assessment.assessor?.name ?? null,
    answers: (assessment.answers ?? {}) as RapidAssessmentAnswers,
    gapAnalysis: assessment.gapAnalysis,
  };
}

async function getLatestHealthAssessment(entityId: string, incidentId?: string): Promise<(HealthAssessmentData & { gapAnalysis: HealthGapAnalysis }) | null> {
  const assessment = await findLatestTypedAssessment(entityId, incidentId, 'HEALTH');
  if (!assessment) return null;

  const payload = fromAnswers('HEALTH', assessment.answers) as unknown as HealthAssessmentData;
  const data: HealthAssessmentData = {
    ...payload,
    rapidAssessmentId: assessment.id,
    rapidAssessmentDate: assessment.rapidAssessmentDate,
    verificationStatus: assessment.verificationStatus,
    assessorName: assessment.assessorName || assessment.assessorNameFallback || 'Unknown',
  };

  const storedGapAnalysis = assessment.gapAnalysis as unknown as HealthGapAnalysis;
  const gapAnalysis = storedGapAnalysis ?? await analyzeHealthGaps(data);

  return {
    ...data,
    gapAnalysis
  };
}

async function getLatestFoodAssessment(entityId: string, incidentId?: string): Promise<(FoodAssessmentData & { gapAnalysis: FoodGapAnalysis }) | null> {
  const assessment = await findLatestTypedAssessment(entityId, incidentId, 'FOOD');
  if (!assessment) return null;

  const payload = fromAnswers('FOOD', assessment.answers) as unknown as FoodAssessmentData;
  const data: FoodAssessmentData = {
    ...payload,
    rapidAssessmentId: assessment.id,
    rapidAssessmentDate: assessment.rapidAssessmentDate,
    verificationStatus: assessment.verificationStatus,
    assessorName: assessment.assessorName || assessment.assessorNameFallback || 'Unknown',
  };

  const storedGapAnalysis = assessment.gapAnalysis as unknown as FoodGapAnalysis;
  const gapAnalysis = storedGapAnalysis ?? await analyzeFoodGaps(data);

  return {
    ...data,
    gapAnalysis
  };
}

async function getLatestWASHAssessment(entityId: string, incidentId?: string): Promise<(WASHAssessmentData & { gapAnalysis: WASHGapAnalysis }) | null> {
  const assessment = await findLatestTypedAssessment(entityId, incidentId, 'WASH');
  if (!assessment) return null;

  const payload = fromAnswers('WASH', assessment.answers) as unknown as WASHAssessmentData;
  const data: WASHAssessmentData = {
    ...payload,
    rapidAssessmentId: assessment.id,
    rapidAssessmentDate: assessment.rapidAssessmentDate,
    verificationStatus: assessment.verificationStatus,
    assessorName: assessment.assessorName || assessment.assessorNameFallback || 'Unknown',
  };

  const storedGapAnalysis = assessment.gapAnalysis as unknown as WASHGapAnalysis;
  const gapAnalysis = storedGapAnalysis ?? await analyzeWASHGaps(data);

  return {
    ...data,
    gapAnalysis
  };
}

async function getLatestShelterAssessment(entityId: string, incidentId?: string): Promise<(ShelterAssessmentData & { gapAnalysis: ShelterGapAnalysis }) | null> {
  const assessment = await findLatestTypedAssessment(entityId, incidentId, 'SHELTER');
  if (!assessment) return null;

  const payload = fromAnswers('SHELTER', assessment.answers) as unknown as ShelterAssessmentData;
  const data: ShelterAssessmentData = {
    ...payload,
    rapidAssessmentId: assessment.id,
    rapidAssessmentDate: assessment.rapidAssessmentDate,
    verificationStatus: assessment.verificationStatus,
    assessorName: assessment.assessorName || assessment.assessorNameFallback || 'Unknown',
  };

  const storedGapAnalysis = assessment.gapAnalysis as unknown as ShelterGapAnalysis;
  const gapAnalysis = storedGapAnalysis ?? await analyzeShelterGaps(data);

  return {
    ...data,
    gapAnalysis
  };
}

async function getLatestSecurityAssessment(entityId: string, incidentId?: string): Promise<(SecurityAssessmentData & { gapAnalysis: SecurityGapAnalysis }) | null> {
  const assessment = await findLatestTypedAssessment(entityId, incidentId, 'SECURITY');
  if (!assessment) return null;

  const payload = fromAnswers('SECURITY', assessment.answers) as unknown as SecurityAssessmentData;
  const data: SecurityAssessmentData = {
    ...payload,
    rapidAssessmentId: assessment.id,
    rapidAssessmentDate: assessment.rapidAssessmentDate,
    verificationStatus: assessment.verificationStatus,
    assessorName: assessment.assessorName || assessment.assessorNameFallback || 'Unknown',
  };

  const storedGapAnalysis = assessment.gapAnalysis as unknown as SecurityGapAnalysis;
  const gapAnalysis = storedGapAnalysis ?? await analyzeSecurityGaps(data);

  return {
    ...data,
    gapAnalysis
  };
}

async function getLatestPopulationAssessment(entityId: string, incidentId?: string): Promise<PopulationAssessmentData | null> {
  const assessment = await findLatestTypedAssessment(entityId, incidentId, 'POPULATION');
  if (!assessment) return null;

  const payload = fromAnswers('POPULATION', assessment.answers) as unknown as PopulationAssessmentData;

  return {
    ...payload,
    rapidAssessmentId: assessment.id,
    rapidAssessmentDate: assessment.rapidAssessmentDate,
    verificationStatus: assessment.verificationStatus,
    assessorName: assessment.assessorName || assessment.assessorNameFallback || 'Unknown',
  };
}



/**
 * Calculate field-level gap analysis based on count-based severity
 * @param assessments Array of assessments for a specific category
 * @param gapIndicators Array of field indicators that represent gaps
 * @returns Field-level gap analysis with severity and recommendations
 */
async function calculateFieldLevelGaps(assessments: any[], gapIndicators: Array<{key: string, label: string}>, assessmentType: 'HEALTH' | 'FOOD' | 'WASH' | 'SHELTER' | 'SECURITY'): Promise<{
  gapFields: string[];
  fieldSeverityMap: Record<string, 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'>;
  overallSeverity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  recommendations: string[];
  fieldCounts: Record<string, { gaps: number; total: number }>;
}> {
  const gapFields: string[] = [];
  const fieldSeverityMap: Record<string, 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'> = {};
  const fieldCounts: Record<string, { gaps: number; total: number }> = {};
  const totalAssessments = assessments.length;
  
  if (totalAssessments === 0) {
    return {
      gapFields: [],
      fieldSeverityMap: {},
      overallSeverity: 'LOW',
      recommendations: [],
      fieldCounts: {}
    };
  }

  // Define inverted fields (where true indicates a gap)
  const invertedFields = ['hasOpenDefecationConcerns', 'areOvercrowded', 'gbvCasesReported'];

  // Calculate gaps for each field
  for (const { key } of gapIndicators) {
    const gapCount = assessments.filter(assessment => {
      // Gap exists if field is false (or inverted)
      const value = assessment[key];
      const isInverted = invertedFields.includes(key);
      
      if (isInverted) {
        return value === true;
      } else {
        return value === false || value === 0 || value === null;
      }
    }).length;

    // Store counts for display in badges
    fieldCounts[key] = {
      gaps: gapCount,
      total: totalAssessments
    };

    if (gapCount > 0) {
      gapFields.push(key);
      
      // Get severity from Gap Field Severity Management instead of hardcoded calculation
      // This ensures consistency with individual entity assessments
      const severity = await getFieldSeverityFromDatabase(key, assessmentType);
      fieldSeverityMap[key] = severity;
    }
  }

  // Calculate overall severity from stored gapAnalysis.severity of each assessment
  // This is the bottom-up max rule: take the highest stored severity across all assessments
  const SEVERITY_ORDER: Record<string, number> = { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };
  let overallSeverity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' = 'LOW';

  for (const assessment of assessments) {
    const stored = assessment?.gapAnalysis;
    if (stored && stored.hasGap && stored.severity) {
      const sev = stored.severity as string;
      if (SEVERITY_ORDER[sev] > SEVERITY_ORDER[overallSeverity]) {
        overallSeverity = sev as 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
      }
    }
  }

  // Return the analysis results
  return {
    gapFields,
    fieldSeverityMap,
    overallSeverity,
    recommendations: [],
    fieldCounts
  };
}

/**
 * Get field severity from the Dynamic Question Registry (Question.severity).
 * This ensures consistency between individual entity and "All Entities" views.
 */
async function getFieldSeverityFromDatabase(fieldName: string, assessmentType: 'HEALTH' | 'FOOD' | 'WASH' | 'SHELTER' | 'SECURITY'): Promise<'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'> {
  try {
    return await getGapFieldSeverity(assessmentType as AssessmentType, fieldName);
  } catch (error) {
    console.warn(`Error getting field severity for ${fieldName} in ${assessmentType}:`, error);
    // Fallback to MEDIUM if lookup unavailable
    return 'MEDIUM';
  }
}

async function aggregateHealthAssessments(entityAssessments: EntityAssessment[]): Promise<any> {
  const healthAssessments = entityAssessments.map(e => e.latestAssessments.health).filter(Boolean);
  
  // Return null if no health assessments exist
  if (healthAssessments.length === 0) {
    return null;
  }

  // Calculate field-level gap analysis
  const healthGapIndicators = [
    { key: 'hasFunctionalClinic', label: 'Functional Clinic' },
    { key: 'hasEmergencyServices', label: 'Emergency Services' },
    { key: 'hasTrainedStaff', label: 'Trained Staff' },
    { key: 'hasMedicineSupply', label: 'Medicine Supply' },
    { key: 'hasMedicalSupplies', label: 'Medical Supplies' },
    { key: 'hasMaternalChildServices', label: 'Maternal/Child Services' }
  ];

  const fieldGapAnalysis = await calculateFieldLevelGaps(healthAssessments, healthGapIndicators, 'HEALTH');
  
  return {
    totalEntities: healthAssessments.length,
    entitiesWithGaps: healthAssessments.filter(a => a && a.gapAnalysis.hasGap).length,
    entitiesWithoutGaps: healthAssessments.filter(a => a && !a.gapAnalysis.hasGap).length,
    totalHealthFacilities: healthAssessments.reduce((sum, a) => sum + (a?.numberHealthFacilities || 0), 0),
    totalQualifiedWorkers: healthAssessments.reduce((sum, a) => sum + (a?.qualifiedHealthWorkers || 0), 0),
    fieldGapAnalysis
  };
}

async function aggregateFoodAssessments(entityAssessments: EntityAssessment[]): Promise<any> {
  const foodAssessments = entityAssessments.map(e => e.latestAssessments.food).filter(Boolean);
  
  // Return null if no food assessments exist
  if (foodAssessments.length === 0) {
    return null;
  }

  // Calculate field-level gap analysis
  const foodGapIndicators = [
    { key: 'isFoodSufficient', label: 'Food Sufficiency' },
    { key: 'hasRegularMealAccess', label: 'Regular Meal Access' },
    { key: 'hasInfantNutrition', label: 'Infant Nutrition' }
  ];

  const fieldGapAnalysis = await calculateFieldLevelGaps(foodAssessments, foodGapIndicators, 'FOOD');
  
  return {
    totalEntities: foodAssessments.length,
    entitiesWithGaps: foodAssessments.filter(a => a && a.gapAnalysis.hasGap).length,
    entitiesWithoutGaps: foodAssessments.filter(a => a && !a.gapAnalysis.hasGap).length,
    totalFoodDurationDays: foodAssessments.reduce((sum, a) => sum + (a?.availableFoodDurationDays || 0), 0),
    additionalFoodRequiredPersons: foodAssessments.reduce((sum, a) => sum + (a?.additionalFoodRequiredPersons || 0), 0),
    fieldGapAnalysis
  };
}

async function aggregateWASHAssessments(entityAssessments: EntityAssessment[]): Promise<any> {
  const washAssessments = entityAssessments.map(e => e.latestAssessments.wash).filter(Boolean);
  
  // Return null if no WASH assessments exist
  if (washAssessments.length === 0) {
    return null;
  }

  // Calculate field-level gap analysis
  const washGapIndicators = [
    { key: 'isWaterSufficient', label: 'Water Sufficiency' },
    { key: 'hasCleanWaterAccess', label: 'Clean Water Access' },
    { key: 'areLatrinesSufficient', label: 'Sufficient Latrines' },
    { key: 'hasHandwashingFacilities', label: 'Handwashing Facilities' },
    { key: 'hasOpenDefecationConcerns', label: 'Open Defecation Concerns' }
  ];

  const fieldGapAnalysis = await calculateFieldLevelGaps(washAssessments, washGapIndicators, 'WASH');
  
  return {
    totalEntities: washAssessments.length,
    entitiesWithGaps: washAssessments.filter(a => a && a.gapAnalysis.hasGap).length,
    entitiesWithoutGaps: washAssessments.filter(a => a && !a.gapAnalysis.hasGap).length,
    totalFunctionalLatrines: washAssessments.reduce((sum, a) => sum + (a?.functionalLatrinesAvailable || 0), 0),
    fieldGapAnalysis
  };
}

async function aggregateShelterAssessments(entityAssessments: EntityAssessment[]): Promise<any> {
  const shelterAssessments = entityAssessments.map(e => e.latestAssessments.shelter).filter(Boolean);
  
  // Return null if no shelter assessments exist
  if (shelterAssessments.length === 0) {
    return null;
  }

  // Calculate field-level gap analysis
  const shelterGapIndicators = [
    { key: 'areSheltersSufficient', label: 'Sufficient Shelters' },
    { key: 'hasSafeStructures', label: 'Safe Structures' },
    { key: 'areOvercrowded', label: 'Overcrowding' },
    { key: 'provideWeatherProtection', label: 'Weather Protection' }
  ];

  const fieldGapAnalysis = await calculateFieldLevelGaps(shelterAssessments, shelterGapIndicators, 'SHELTER');
  
  return {
    totalEntities: shelterAssessments.length,
    entitiesWithGaps: shelterAssessments.filter(a => a && a.gapAnalysis.hasGap).length,
    entitiesWithoutGaps: shelterAssessments.filter(a => a && !a.gapAnalysis.hasGap).length,
    totalSheltersRequired: shelterAssessments.reduce((sum, a) => sum + (a?.numberSheltersRequired || 0), 0),
    fieldGapAnalysis
  };
}

async function aggregateSecurityAssessments(entityAssessments: EntityAssessment[]): Promise<any> {
  const securityAssessments = entityAssessments.map(e => e.latestAssessments.security).filter(Boolean);
  
  // Return null if no security assessments exist
  if (securityAssessments.length === 0) {
    return null;
  }

  // Calculate field-level gap analysis
  const securityGapIndicators = [
    { key: 'isSafeFromViolence', label: 'Safe from Violence' },
    { key: 'gbvCasesReported', label: 'GBV Cases Reported' },
    { key: 'hasSecurityPresence', label: 'Security Presence' },
    { key: 'hasProtectionReportingMechanism', label: 'Protection Reporting' },
    { key: 'vulnerableGroupsHaveAccess', label: 'Vulnerable Groups Access' },
    { key: 'hasLighting', label: 'Lighting' }
  ];

  const fieldGapAnalysis = await calculateFieldLevelGaps(securityAssessments, securityGapIndicators, 'SECURITY');
  
  return {
    totalEntities: securityAssessments.length,
    entitiesWithGaps: securityAssessments.filter(a => a && a.gapAnalysis.hasGap).length,
    entitiesWithoutGaps: securityAssessments.filter(a => a && !a.gapAnalysis.hasGap).length,
    fieldGapAnalysis
  };
}

function aggregatePopulationAssessments(entityAssessments: EntityAssessment[]): any {
  const populationAssessments = entityAssessments.map(e => e.latestAssessments.population).filter(Boolean);
  return {
    totalEntities: populationAssessments.length,
    totalPopulation: populationAssessments.reduce((sum, a) => sum + (a?.totalPopulation || 0), 0),
    totalHouseholds: populationAssessments.reduce((sum, a) => sum + (a?.totalHouseholds || 0), 0),
    totalLivesLost: populationAssessments.reduce((sum, a) => sum + (a?.numberLivesLost || 0), 0),
    totalInjured: populationAssessments.reduce((sum, a) => sum + (a?.numberInjured || 0), 0)
  };
}

// Gap analysis summary function
async function getGapAnalysisSummary(incidentId: string): Promise<GapAnalysisSummary> {
  if (!incidentId || typeof incidentId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(incidentId)) {
    throw new Error('Invalid incident ID format');
  }

  // Use the same entity assessment data structure as the main API for consistency
  const entityAssessments = await getEntityAssessments(incidentId);

  const totalEntities = entityAssessments.length;

  // Initialize assessment type gaps
  const assessmentTypeGaps: { [key: string]: { severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'; entitiesAffected: number; percentage: number } } = {
    HEALTH: { severity: 'LOW', entitiesAffected: 0, percentage: 0 },
    FOOD: { severity: 'LOW', entitiesAffected: 0, percentage: 0 },
    WASH: { severity: 'LOW', entitiesAffected: 0, percentage: 0 },
    SHELTER: { severity: 'LOW', entitiesAffected: 0, percentage: 0 },
    SECURITY: { severity: 'LOW', entitiesAffected: 0, percentage: 0 }
  };

  // Initialize severity distribution (4 buckets)
  const severityDistribution = { critical: 0, high: 0, medium: 0, low: 0 };

  // Track max stored severity per assessment type across all entities
  const SEVERITY_ORDER: Record<string, number> = { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };
  const assessmentTypeCounts = {
    HEALTH: { entitiesWithGaps: 0, totalEntities: 0 },
    FOOD: { entitiesWithGaps: 0, totalEntities: 0 },
    WASH: { entitiesWithGaps: 0, totalEntities: 0 },
    SHELTER: { entitiesWithGaps: 0, totalEntities: 0 },
    SECURITY: { entitiesWithGaps: 0, totalEntities: 0 },
  };

  // Analyze each entity's assessments using stored gapAnalysis.severity
  for (const entityAssessment of entityAssessments) {
    let entitySeverity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' = 'LOW';
    
    // Check each assessment type for gaps using latestAssessments
    const latestAssessments = entityAssessment.latestAssessments;

    const assessmentTypes: Array<{ key: keyof typeof assessmentTypeCounts; data: any }> = [
      { key: 'HEALTH', data: latestAssessments.health },
      { key: 'FOOD', data: latestAssessments.food },
      { key: 'WASH', data: latestAssessments.wash },
      { key: 'SHELTER', data: latestAssessments.shelter },
      { key: 'SECURITY', data: latestAssessments.security },
    ];

    for (const { key, data } of assessmentTypes) {
      if (!data) continue;
      assessmentTypeCounts[key].totalEntities++;
      const gapData = data.gapAnalysis;
      if (gapData && gapData.hasGap) {
        assessmentTypeCounts[key].entitiesWithGaps++;
        const sev = gapData.severity as string;
        // Update per-type max severity
        if (SEVERITY_ORDER[sev] > SEVERITY_ORDER[assessmentTypeGaps[key].severity]) {
          assessmentTypeGaps[key].severity = sev as 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
        }
        // Update entity severity (max across all assessment types)
        if (SEVERITY_ORDER[sev] > SEVERITY_ORDER[entitySeverity]) {
          entitySeverity = sev as 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
        }
      }
    }

    // Update severity distribution (4 buckets)
    severityDistribution[entitySeverity.toLowerCase() as keyof typeof severityDistribution]++;
  }

  // Calculate percentages for assessment types
  for (const key in assessmentTypeGaps) {
    const counts = assessmentTypeCounts[key as keyof typeof assessmentTypeCounts];
    const entitiesAffected = counts.entitiesWithGaps;
    const total = counts.totalEntities;
    const percentage = total > 0 ? Math.round((entitiesAffected / total) * 100) : 0;
    
    assessmentTypeGaps[key].entitiesAffected = entitiesAffected;
    assessmentTypeGaps[key].percentage = percentage;
  }

  return {
    totalEntities,
    severityDistribution,
    assessmentTypeGaps,
    lastUpdated: new Date().toISOString()
  };
}

// Interactive map helper function
async function getEntityLocations(
  incidentId?: string,
  severityFilter?: string,
  entityTypeFilter?: string,
  includeDonorAssignments?: boolean
): Promise<EntityLocationsResponse> {
  try {
    // Validate inputs to prevent SQL injection
    if (incidentId && (!/^[a-zA-Z0-9_-]+$/.test(incidentId) || typeof incidentId !== 'string')) {
      throw new Error('Invalid incident ID format');
    }
    if (severityFilter && !/^[A-Z_]+$/.test(severityFilter)) {
      throw new Error('Invalid severity filter format');
    }
    if (entityTypeFilter && !/^[A-Z_]+$/.test(entityTypeFilter)) {
      throw new Error('Invalid entity type filter format');
    }

    // Get entities with coordinates and gap analysis - Fixed SQL injection with conditional queries
    const entitiesWithLocations = await (async () => {
      if (incidentId) {
        if (severityFilter && severityFilter !== 'ALL' && entityTypeFilter && entityTypeFilter !== 'ALL') {
          return prisma.$queryRaw`
            SELECT DISTINCT
              e.id,
              e.name,
              e.type,
              e.coordinates,
              'MEDIUM' as severity,
              ra."rapidAssessmentDate" as "affectedAt"
            FROM entities e
            INNER JOIN rapid_assessments ra ON e.id = ra."entityId"
              AND ra."incidentId" = ${incidentId}
              AND ra."verificationStatus" IN ('VERIFIED', 'AUTO_VERIFIED')
            WHERE e.type = ${entityTypeFilter}
              AND e.coordinates IS NOT NULL
              AND e.coordinates->>'latitude' IS NOT NULL
              AND e.coordinates->>'longitude' IS NOT NULL
            ORDER BY e.name
            LIMIT 500
          ` as unknown as Array<{
            id: string;
            name: string;
            type: string;
            coordinates: any;
            severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
            affectedAt: Date;
          }>;
        } else if (severityFilter && severityFilter !== 'ALL') {
          return prisma.$queryRaw`
            SELECT DISTINCT
              e.id,
              e.name,
              e.type,
              e.coordinates,
              'MEDIUM' as severity,
              ra."rapidAssessmentDate" as "affectedAt"
            FROM entities e
            INNER JOIN rapid_assessments ra ON e.id = ra."entityId"
              AND ra."incidentId" = ${incidentId}
              AND ra."verificationStatus" IN ('VERIFIED', 'AUTO_VERIFIED')
            WHERE e.coordinates IS NOT NULL
              AND e.coordinates->>'latitude' IS NOT NULL
              AND e.coordinates->>'longitude' IS NOT NULL
            ORDER BY e.name
            LIMIT 500
          ` as unknown as Array<{
            id: string;
            name: string;
            type: string;
            coordinates: any;
            severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
            affectedAt: Date;
          }>;
        } else if (entityTypeFilter && entityTypeFilter !== 'ALL') {
          return prisma.$queryRaw`
            SELECT DISTINCT
              e.id,
              e.name,
              e.type,
              e.coordinates,
              'MEDIUM' as severity,
              ra."rapidAssessmentDate" as "affectedAt"
            FROM entities e
            INNER JOIN rapid_assessments ra ON e.id = ra."entityId"
              AND ra."incidentId" = ${incidentId}
              AND ra."verificationStatus" IN ('VERIFIED', 'AUTO_VERIFIED')
            WHERE e.type = ${entityTypeFilter}
              AND e.coordinates IS NOT NULL
              AND e.coordinates->>'latitude' IS NOT NULL
              AND e.coordinates->>'longitude' IS NOT NULL
            ORDER BY e.name
            LIMIT 500
          ` as unknown as Array<{
            id: string;
            name: string;
            type: string;
            coordinates: any;
            severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
            affectedAt: Date;
          }>;
        } else {
          return prisma.$queryRaw`
            SELECT DISTINCT
              e.id,
              e.name,
              e.type,
              e.coordinates,
              'MEDIUM' as severity,
              ra."rapidAssessmentDate" as "affectedAt"
            FROM entities e
            INNER JOIN rapid_assessments ra ON e.id = ra."entityId"
              AND ra."incidentId" = ${incidentId}
              AND ra."verificationStatus" IN ('VERIFIED', 'AUTO_VERIFIED')
            WHERE e.coordinates IS NOT NULL
              AND e.coordinates->>'latitude' IS NOT NULL
              AND e.coordinates->>'longitude' IS NOT NULL
            ORDER BY e.name
            LIMIT 500
          ` as unknown as Array<{
            id: string;
            name: string;
            type: string;
            coordinates: any;
            severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
            affectedAt: Date;
          }>;
        }
      } else {
        // No incident filter - get all entities with assessments
        return prisma.$queryRaw`
          SELECT DISTINCT
            e.id,
            e.name,
            e.type,
            e.coordinates,
            'MEDIUM' as severity,
            ra."rapidAssessmentDate" as "affectedAt"
          FROM entities e
          INNER JOIN rapid_assessments ra ON e.id = ra."entityId"
            AND ra."verificationStatus" IN ('VERIFIED', 'AUTO_VERIFIED')
          WHERE e.coordinates IS NOT NULL
            AND e.coordinates->>'latitude' IS NOT NULL
            AND e.coordinates->>'longitude' IS NOT NULL
          ORDER BY e.name
          LIMIT 500
        ` as unknown as Array<{
          id: string;
          name: string;
          type: string;
          coordinates: any;
          severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
          affectedAt: Date;
        }>;
      }
    })();

    // Process entities and calculate gap summary
    const processedEntities: EntityLocation[] = [];
    
    for (const entity of entitiesWithLocations) {
      // Get gap analysis for this entity, scoped to the incident when provided.
      // Use latest-per-type to match the bottom-up severity rule.
      const gapAnalysisQuery = incidentId
        ? await prisma.$queryRaw`
            SELECT
              ra."rapidAssessmentType",
              ra."gapAnalysis",
              ra."verificationStatus"
            FROM rapid_assessments ra
            WHERE ra."entityId" = ${entity.id}
              AND ra."incidentId" = ${incidentId}
              AND ra."verificationStatus" IN ('VERIFIED', 'AUTO_VERIFIED')
            ORDER BY ra."rapidAssessmentDate" DESC
          ` as unknown as Array<{
            rapidAssessmentType: string;
            gapAnalysis: any;
            verificationStatus: string;
          }>
        : await prisma.$queryRaw`
            SELECT
              ra."rapidAssessmentType",
              ra."gapAnalysis",
              ra."verificationStatus"
            FROM rapid_assessments ra
            WHERE ra."entityId" = ${entity.id}
              AND ra."verificationStatus" IN ('VERIFIED', 'AUTO_VERIFIED')
            ORDER BY ra."rapidAssessmentDate" DESC
          ` as unknown as Array<{
            rapidAssessmentType: string;
            gapAnalysis: any;
            verificationStatus: string;
          }>;

      // Calculate gap summary — only count the LATEST assessment per type
      // (query is ordered by date desc, so the first row per type wins).
      let totalGaps = 0;
      let totalNoGaps = 0;
      let criticalGaps = 0;
      let worstSeverity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' = 'LOW';

      const seenTypes = new Set<string>();
      for (const assessment of gapAnalysisQuery) {
        // Skip older assessments of the same type (latest-per-type rule)
        if (seenTypes.has(assessment.rapidAssessmentType)) continue;
        seenTypes.add(assessment.rapidAssessmentType);

        if (assessment.gapAnalysis && typeof assessment.gapAnalysis === 'object') {
          const gapData = assessment.gapAnalysis as any;
          if (gapData.hasGap) {
            totalGaps++;
            if (gapData.severity === 'CRITICAL') criticalGaps++;
            
            // Update worst severity
            if (gapData.severity === 'CRITICAL') worstSeverity = 'CRITICAL';
            else if (gapData.severity === 'HIGH' && worstSeverity !== 'CRITICAL') worstSeverity = 'HIGH';
            else if (gapData.severity === 'MEDIUM' && worstSeverity === 'LOW') worstSeverity = 'MEDIUM';
          } else {
            totalNoGaps++;
          }
        }
      }

      // Parse coordinates
      let coordinates: { latitude: number; longitude: number } | undefined;
      try {
        if (typeof entity.coordinates === 'object' && entity.coordinates !== null) {
          const coords = entity.coordinates as any;
          coordinates = {
            latitude: parseFloat(coords.latitude || coords.lat || 0),
            longitude: parseFloat(coords.longitude || coords.lng || 0)
          };
        }
      } catch (error) {
        console.warn('Error parsing coordinates for entity:', entity.id);
        continue;
      }

      if (!coordinates) continue;

      // Get donor assignments if requested
      let donorAssignments: EntityLocation['donorAssignments'] = [];
      if (includeDonorAssignments && incidentId) {
        const donorData = await prisma.$queryRaw`
          SELECT 
            dc.id,
            d.name as "donorName",
            dc.status as "commitmentStatus",
            dc.items
          FROM donor_commitments dc
          INNER JOIN donors d ON dc."donorId" = d.id
          WHERE dc."entityId" = ${entity.id}
            AND dc."incidentId" = ${incidentId}
          ORDER BY dc."createdAt" DESC
        ` as unknown as Array<{
          id: string;
          donorName: string;
          commitmentStatus: string;
          items: any;
        }>;

        donorAssignments = donorData.map(donor => ({
          donorId: donor.id,
          donorName: donor.donorName,
          commitmentStatus: donor.commitmentStatus,
          items: Array.isArray(donor.items) ? donor.items : []
        }));
      }

      processedEntities.push({
        id: entity.id,
        name: entity.name,
        type: entity.type,
        coordinates,
        severity: totalGaps > 0 ? worstSeverity : 'LOW',
        gapSummary: {
          totalGaps,
          totalNoGaps,
          criticalGaps,
          severity: totalGaps > 0 ? worstSeverity : 'LOW'
        },
        donorAssignments: donorAssignments.length > 0 ? donorAssignments : undefined
      });
    }

    // Calculate map bounds
    let mapBounds = {
      northEast: { lat: 10.0, lng: 8.0 }, // Default to Nigeria bounds
      southWest: { lat: 4.0, lng: 3.0 }
    };

    if (processedEntities.length > 0) {
      const lats = processedEntities.map(e => e.coordinates!.latitude);
      const lngs = processedEntities.map(e => e.coordinates!.longitude);
      
      const minLat = Math.min(...lats);
      const maxLat = Math.max(...lats);
      const minLng = Math.min(...lngs);
      const maxLng = Math.max(...lngs);
      
      // Add padding
      const latPadding = (maxLat - minLat) * 0.1;
      const lngPadding = (maxLng - minLng) * 0.1;
      
      mapBounds = {
        northEast: { lat: maxLat + latPadding, lng: maxLng + lngPadding },
        southWest: { lat: minLat - latPadding, lng: minLng - lngPadding }
      };
    }

    return {
      entities: processedEntities,
      mapBounds,
      totalCount: processedEntities.length
    };
  } catch (error) {
    console.error('Error fetching entity locations:', error);
    return {
      entities: [],
      mapBounds: {
        northEast: { lat: 10.0, lng: 8.0 },
        southWest: { lat: 4.0, lng: 3.0 }
      },
      totalCount: 0
    };
  }
}

/**
 * GET /api/v1/dashboard/situation
 * 
 * Returns aggregated data for the situation dashboard
 * 
 * Query Parameters:
 * - incidentId: Filter by specific incident (optional)
 * - entityId: Filter by specific entity or "all" for aggregated (optional)
 * - realTime: Enable real-time updates (default: false)
 * - includeHistorical: Include historical data (default: false)
 * - limit: Limit number of records returned (default: 50)
 */
export const GET = withAuth(async (request: NextRequest, context) => {
  try {
    // Apply rate limiting
    if (RateLimiter.isRateLimited(request, 100, 60000)) { // 100 requests per minute
      return NextResponse.json(
        { 
          success: false, 
          error: 'Rate limit exceeded. Please try again later.',
          retryAfter: 60
        },
        { 
          status: 429,
          headers: {
            'Retry-After': '60',
            'X-RateLimit-Limit': '100',
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': new Date(Date.now() + 60000).toISOString()
          }
        }
      );
    }

    // Check role permissions
    if (!context.roles.includes('COORDINATOR')) {
      return NextResponse.json(
        { success: false, error: 'Insufficient permissions' },
        { status: 403 }
      );
    }

    // Validate query parameters
    const { searchParams } = new URL(request.url);
    const queryParams = DashboardQuerySchema.parse({
      incidentId: searchParams.get('incidentId'),
      entityId: searchParams.get('entityId'),
      realTime: searchParams.get('realTime') || 'false',
      includeHistorical: searchParams.get('includeHistorical') || 'false',
      limit: searchParams.get('limit') || '50',
      includeEntityLocations: searchParams.get('includeEntityLocations') || 'false',
      includeDonorAssignments: searchParams.get('includeDonorAssignments') || 'false',
      severityFilter: searchParams.get('severityFilter'),
      entityTypeFilter: searchParams.get('entityTypeFilter'),
      includeGapSummary: searchParams.get('includeGapSummary') || 'false'
    });

    // Fetch real incidents from database
    const incidents = await (async (): Promise<IncidentSummary[]> => {
      const incidentQuery = queryParams.incidentId
        ? prisma.incident.findMany({
            where: {
              id: queryParams.incidentId,
            },
            include: {
              preliminaryAssessments: {
                select: {
                  numberLivesLost: true,
                  numberInjured: true,
                  numberDisplaced: true,
                },
              },
            },
            orderBy: { createdAt: 'desc' },
            take: queryParams.limit,
          })
        : prisma.incident.findMany({
            where: {
              status: { in: ['ACTIVE', 'CONTAINED'] },
            },
            include: {
              preliminaryAssessments: {
                select: {
                  numberLivesLost: true,
                  numberInjured: true,
                  numberDisplaced: true,
                },
              },
            },
            orderBy: { createdAt: 'desc' },
            take: queryParams.limit,
          });

      const rawIncidents = await incidentQuery;

      // Recompute incident severity bottom-up so the dashboard never shows a
      // stale stored value (e.g. seed defaults or a value from before a
      // verification change). Best-effort: failures fall back to stored value.
      const { incidentSeverityService } = await import('@/lib/services/incident-severity.service');
      const computedSeverityById = new Map<string, 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'>();
      await Promise.all(rawIncidents.map(async (incident) => {
        try {
          const computed = await incidentSeverityService.computeIncidentSeverity(incident.id);
          if (computed) {
            computedSeverityById.set(incident.id, computed);
            // Persist the refreshed value so other consumers stay in sync.
            await prisma.incident.update({
              where: { id: incident.id },
              data: { severity: computed },
            }).catch(() => {});
          }
        } catch {}
      }));

      return rawIncidents.map(incident => {
        const populationImpact = incident.preliminaryAssessments.reduce(
          (sum, assessment) => sum + (assessment.numberDisplaced || 0),
          0
        );

        const recomputedSeverity = computedSeverityById.get(incident.id);

        return {
          id: incident.id,
          type: incident.type,
          subType: incident.subType || 'N/A',
          severity: (recomputedSeverity || incident.severity) as 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW',
          status: incident.status as 'ACTIVE' | 'CONTAINED' | 'RESOLVED',
          description: incident.description,
          location: incident.location,
          coordinates: incident.coordinates,
          createdAt: incident.createdAt,
          updatedAt: incident.updatedAt,
          populationImpact,
        };
      });
    })();

    // Removed duplicate line - incidents already defined above

    // Calculate duration for each incident
    const incidentsWithDuration = incidents.map(incident => {
      const durationInfo = calculateDurationInfo(incident);
      return {
        ...incident,
        ...durationInfo
      };
    });

    // Fetch real entities from database
    const rawEntities = await (async () => {
      if (!queryParams.incidentId) {
        return [];
      }

      // Get entities that have assessments for this incident
      const entitiesQuery = await prisma.entity.findMany({
        where: {
          rapidAssessments: {
            some: {
              incidentId: queryParams.incidentId,
              verificationStatus: { in: ['VERIFIED', 'AUTO_VERIFIED'] },
            },
          },
          isActive: true,
        },
        select: {
          id: true,
          name: true,
          type: true,
          location: true,
          coordinates: true,
        },
        orderBy: { name: 'asc' },
        take: queryParams.limit,
      });

      return entitiesQuery;
    })();

    // Transform entities data - fetch latest assessments for each entity
    const entities = [];
    for (const entity of rawEntities) {
      try {
        // Fetch latest assessments using the proper functions
        const [
          healthAssessment,
          foodAssessment,
          washAssessment,
          shelterAssessment,
          securityAssessment,
          populationAssessment
        ] = await Promise.all([
          getLatestHealthAssessment(entity.id, queryParams.incidentId),
          getLatestFoodAssessment(entity.id, queryParams.incidentId),
          getLatestWASHAssessment(entity.id, queryParams.incidentId),
          getLatestShelterAssessment(entity.id, queryParams.incidentId),
          getLatestSecurityAssessment(entity.id, queryParams.incidentId),
          getLatestPopulationAssessment(entity.id, queryParams.incidentId)
        ]);

        // Build latest assessments object with only existing assessments
        const latestAssessments: any = {};
        let lastUpdated = new Date();

        if (healthAssessment) {
          latestAssessments.health = {
            id: healthAssessment.rapidAssessmentId,
            date: healthAssessment.rapidAssessmentDate,
            status: healthAssessment.verificationStatus || 'VERIFIED',
            verified: healthAssessment.verificationStatus === 'VERIFIED' || healthAssessment.verificationStatus === 'AUTO_VERIFIED',
            assessorName: healthAssessment.assessorName,
            gapIndicators: {
              hasGap: healthAssessment.gapAnalysis.hasGap,
              severity: healthAssessment.gapAnalysis.severity,
            }
          };
          lastUpdated = new Date(healthAssessment.rapidAssessmentDate) > lastUpdated ? new Date(healthAssessment.rapidAssessmentDate) : lastUpdated;
        }

        if (foodAssessment) {
          latestAssessments.food = {
            id: foodAssessment.rapidAssessmentId,
            date: foodAssessment.rapidAssessmentDate,
            status: foodAssessment.verificationStatus || 'VERIFIED',
            verified: foodAssessment.verificationStatus === 'VERIFIED' || foodAssessment.verificationStatus === 'AUTO_VERIFIED',
            assessorName: foodAssessment.assessorName,
            gapIndicators: {
              hasGap: foodAssessment.gapAnalysis.hasGap,
              severity: foodAssessment.gapAnalysis.severity,
            }
          };
          lastUpdated = new Date(foodAssessment.rapidAssessmentDate) > lastUpdated ? new Date(foodAssessment.rapidAssessmentDate) : lastUpdated;
        }

        if (washAssessment) {
          latestAssessments.wash = {
            id: washAssessment.rapidAssessmentId,
            date: washAssessment.rapidAssessmentDate,
            status: washAssessment.verificationStatus || 'VERIFIED',
            verified: washAssessment.verificationStatus === 'VERIFIED' || washAssessment.verificationStatus === 'AUTO_VERIFIED',
            assessorName: washAssessment.assessorName,
            gapIndicators: {
              hasGap: washAssessment.gapAnalysis.hasGap,
              severity: washAssessment.gapAnalysis.severity,
            }
          };
          lastUpdated = new Date(washAssessment.rapidAssessmentDate) > lastUpdated ? new Date(washAssessment.rapidAssessmentDate) : lastUpdated;
        }

        if (shelterAssessment) {
          latestAssessments.shelter = {
            id: shelterAssessment.rapidAssessmentId,
            date: shelterAssessment.rapidAssessmentDate,
            status: shelterAssessment.verificationStatus || 'VERIFIED',
            verified: shelterAssessment.verificationStatus === 'VERIFIED' || shelterAssessment.verificationStatus === 'AUTO_VERIFIED',
            assessorName: shelterAssessment.assessorName,
            gapIndicators: {
              hasGap: shelterAssessment.gapAnalysis.hasGap,
              severity: shelterAssessment.gapAnalysis.severity,
            }
          };
          lastUpdated = new Date(shelterAssessment.rapidAssessmentDate) > lastUpdated ? new Date(shelterAssessment.rapidAssessmentDate) : lastUpdated;
        }

        if (securityAssessment) {
          latestAssessments.security = {
            id: securityAssessment.rapidAssessmentId,
            date: securityAssessment.rapidAssessmentDate,
            status: securityAssessment.verificationStatus || 'VERIFIED',
            verified: securityAssessment.verificationStatus === 'VERIFIED' || securityAssessment.verificationStatus === 'AUTO_VERIFIED',
            assessorName: securityAssessment.assessorName,
            gapIndicators: {
              hasGap: securityAssessment.gapAnalysis.hasGap,
              severity: securityAssessment.gapAnalysis.severity,
            }
          };
          lastUpdated = new Date(securityAssessment.rapidAssessmentDate) > lastUpdated ? new Date(securityAssessment.rapidAssessmentDate) : lastUpdated;
        }

        if (populationAssessment) {
          latestAssessments.population = {
            id: populationAssessment.rapidAssessmentId,
            date: populationAssessment.rapidAssessmentDate,
            status: populationAssessment.verificationStatus || 'VERIFIED',
            verified: populationAssessment.verificationStatus === 'VERIFIED' || populationAssessment.verificationStatus === 'AUTO_VERIFIED',
            assessorName: populationAssessment.assessorName,
            gapIndicators: {
              hasGap: false, // Population assessments don't have gap analysis
              severity: 'LOW',
            }
          };
          lastUpdated = new Date(populationAssessment.rapidAssessmentDate) > lastUpdated ? new Date(populationAssessment.rapidAssessmentDate) : lastUpdated;
        }

        entities.push({
          id: entity.id,
          name: entity.name,
          type: entity.type,
          location: entity.location,
          coordinates: entity.coordinates,
          affectedAt: new Date(), // Will be updated based on actual data
          severity: 'LOW' as 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW', // Will be calculated dynamically
          severityCount: 0, // Will be calculated dynamically
          latestAssessments,
          gapSummary: {
            totalGaps: 0,
            totalNoGaps: 0,
            criticalGaps: 0
          },
          lastUpdated
        });

      } catch (error) {
        console.error(`Error fetching assessments for entity ${entity.id}:`, error);
        // Add entity with empty assessments if there's an error
        entities.push({
          id: entity.id,
          name: entity.name,
          type: entity.type,
          location: entity.location,
          coordinates: entity.coordinates,
          affectedAt: new Date(),
          severity: 'LOW' as 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW',
          severityCount: 0,
          latestAssessments: {},
          gapSummary: {
            totalGaps: 0,
            totalNoGaps: 0,
            criticalGaps: 0
          },
          lastUpdated: new Date()
        });
      }
    }

    // Compute gap analysis
    const gaps = entities.map(entity => {
      const assessmentGaps: any = {};
      let totalGapCount = 0;
      let hasCriticalGaps = false;
      let hasHighGaps = false;

      Object.entries(entity.latestAssessments).forEach(([type, assessment]: [string, any]) => {
        const gapAnalysis = {
          hasGap: assessment.gapIndicators.hasGap,
          severity: assessment.gapIndicators.severity,
          lastAssessed: assessment.date,
          indicators: getGapIndicatorsByType(type)
        };

        assessmentGaps[type] = gapAnalysis;
        
        if (gapAnalysis.hasGap) {
          totalGapCount++;
          if (gapAnalysis.severity === 'CRITICAL') hasCriticalGaps = true;
          if (gapAnalysis.severity === 'HIGH') hasHighGaps = true;
        }
      });

      // Determine overall gap severity
      let overallGapSeverity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' = 'LOW';
      if (hasCriticalGaps) overallGapSeverity = 'CRITICAL';
      else if (hasHighGaps) overallGapSeverity = 'HIGH';
      else if (totalGapCount > 0) overallGapSeverity = 'MEDIUM';

      return {
        entityId: entity.id,
        entityName: entity.name,
        entityType: entity.type,
        location: entity.location,
        assessmentGaps,
        overallGapSeverity,
        totalGapCount,
        lastUpdated: entity.lastUpdated
      };
    });

    // Add selected incident data if incidentId is provided
    let selectedIncidentData = undefined;
    if (queryParams.incidentId) {
      const selectedIncident = incidentsWithDuration.find(i => i.id === queryParams.incidentId);
      if (selectedIncident) {
        const [populationImpact, aggregateMetrics] = await Promise.all([
          getPopulationImpact(queryParams.incidentId),
          getAggregateMetrics(queryParams.incidentId)
        ]);

        selectedIncidentData = {
          incident: selectedIncident,
          populationImpact,
          aggregateMetrics
        };
      }
    }

    // Fetch entity assessment data
    let entityAssessments: EntityAssessment[] = [];
    let aggregatedAssessments: AggregatedAssessments | undefined;
    
    if (queryParams.incidentId) {
      if (queryParams.entityId === 'all') {
        // Get all entities for this incident
        entityAssessments = await getEntityAssessments(queryParams.incidentId);
        
        // Calculate aggregated assessments for all entities
        aggregatedAssessments = {
          health: await aggregateHealthAssessments(entityAssessments),
          food: await aggregateFoodAssessments(entityAssessments),
          wash: await aggregateWASHAssessments(entityAssessments),
          shelter: await aggregateShelterAssessments(entityAssessments),
          security: await aggregateSecurityAssessments(entityAssessments),
          population: aggregatePopulationAssessments(entityAssessments),
          gapSummary: {
            totalGaps: 0,
            totalNoGaps: 0,
            criticalGaps: 0,
            entitiesWithGaps: 0,
            entitiesWithoutGaps: 0
          }
        };
        
        // Calculate gap summary
        const allGapBasedAssessments = [
          ...entityAssessments.map(e => e.latestAssessments.health).filter(Boolean),
          ...entityAssessments.map(e => e.latestAssessments.food).filter(Boolean),
          ...entityAssessments.map(e => e.latestAssessments.wash).filter(Boolean),
          ...entityAssessments.map(e => e.latestAssessments.shelter).filter(Boolean),
          ...entityAssessments.map(e => e.latestAssessments.security).filter(Boolean)
        ];
        
        aggregatedAssessments.gapSummary = {
          totalGaps: allGapBasedAssessments.filter(a => a && a.gapAnalysis.hasGap).length,
          totalNoGaps: allGapBasedAssessments.filter(a => a && !a.gapAnalysis.hasGap).length,
          criticalGaps: allGapBasedAssessments.filter(a => a && a.gapAnalysis.severity === 'CRITICAL').length,
          entitiesWithGaps: entityAssessments.filter(e => {
            const entityGaps = [
              e.latestAssessments.health?.gapAnalysis.hasGap,
              e.latestAssessments.food?.gapAnalysis.hasGap,
              e.latestAssessments.wash?.gapAnalysis.hasGap,
              e.latestAssessments.shelter?.gapAnalysis.hasGap,
              e.latestAssessments.security?.gapAnalysis.hasGap
            ].filter(Boolean);
            return entityGaps.length > 0;
          }).length,
          entitiesWithoutGaps: entityAssessments.filter(e => {
            const entityGaps = [
              e.latestAssessments.health?.gapAnalysis.hasGap,
              e.latestAssessments.food?.gapAnalysis.hasGap,
              e.latestAssessments.wash?.gapAnalysis.hasGap,
              e.latestAssessments.shelter?.gapAnalysis.hasGap,
              e.latestAssessments.security?.gapAnalysis.hasGap
            ].filter(Boolean);
            return entityGaps.length === 0;
          }).length
        };
      } else {
        // Get specific entity assessment data
        entityAssessments = await getEntityAssessments(queryParams.incidentId, queryParams.entityId);
      }
    }

    // Get real entity locations from database
    let entityLocations: EntityLocationsResponse | undefined;
    if (queryParams.includeEntityLocations) {
      entityLocations = await getEntityLocations(
        queryParams.incidentId,
        queryParams.severityFilter,
        queryParams.entityTypeFilter,
        queryParams.includeDonorAssignments
      );
    }

    // Get real gap analysis summary from database
    let gapAnalysisSummary: GapAnalysisSummary | undefined;
    if (queryParams.includeGapSummary && queryParams.incidentId) {
      gapAnalysisSummary = await getGapAnalysisSummary(queryParams.incidentId);
    }

    const dashboardData: SituationDashboardData = {
      incidents: incidentsWithDuration,
      entities: entities,
      gaps: gaps,
      realTimeUpdates: queryParams.realTime,
      lastUpdated: new Date(),
      selectedIncident: selectedIncidentData,
      entityAssessments,
      aggregatedAssessments,
      entityLocations,
      gapAnalysisSummary
    };

    // Add rate limiting headers to successful responses
    const addRateLimitHeaders = (response: NextResponse) => {
      response.headers.set('X-RateLimit-Limit', '100');
      response.headers.set('X-RateLimit-Remaining', '99'); // Approximate
      response.headers.set('X-RateLimit-Reset', new Date(Date.now() + 60000).toISOString());
      return response;
    };

    const response = NextResponse.json({
      success: true,
      data: dashboardData,
      timestamp: new Date().toISOString(),
      metadata: {
        recordCounts: {
          incidents: incidentsWithDuration.length,
          entities: entities.length,
          gaps: gaps.length,
          entityLocations: entityLocations?.totalCount || 0
        },
        realTimeEnabled: queryParams.realTime,
        incidentFilter: queryParams.incidentId,
        entityLocationsEnabled: queryParams.includeEntityLocations,
        donorAssignmentsEnabled: queryParams.includeDonorAssignments,
        severityFilter: queryParams.severityFilter,
        entityTypeFilter: queryParams.entityTypeFilter
      }
    });

    return addRateLimitHeaders(response);

  } catch (error) {
    return handleApiError(error)
  }
});

// Helper function
function getGapIndicatorsByType(assessmentType: string) {
  // Fallback gap indicators by assessment type - returns empty indicators since
  // real gap data comes from the actual assessment gapAnalysis, not random generation
  return [];
}