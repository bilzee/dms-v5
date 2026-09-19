import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/client';
import { z } from 'zod';
import type { EntityType } from '@prisma/client';
import {
  AnswerValue,
  fromAnswers,
  hydrateFromSnapshot,
  RapidAssessmentAnswers,
  SnapshotHydrationStructure,
} from '@/lib/questions/answers';
import type { GapEngineResult } from '@/lib/questions/gap-engine';
import { buildCategoryGapSummary, type CategoryGapSummary, type QuestionTypeMetadata, type SummaryQuestionMeta } from '@/lib/questions/gap-summary';
import { QuestionRegistryService } from '@/lib/services/question-registry.service';
import { getGapRowsPerCategory } from '@/lib/services/dashboard-config.service';
import { handleApiError } from '@/lib/api/response';

/** The stored P3 gap-engine result — the single source of truth for summaries. */
type StoredGapAnalysis = GapEngineResult;

/** The five gap-bearing assessment types rendered as summary cards. */
type GapAssessmentType = 'HEALTH' | 'FOOD' | 'WASH' | 'SHELTER' | 'SECURITY';

const GAP_ASSESSMENT_TYPES: readonly GapAssessmentType[] = ['HEALTH', 'FOOD', 'WASH', 'SHELTER', 'SECURITY'];

const LATEST_ASSESSMENT_KEY: Record<GapAssessmentType, 'health' | 'food' | 'wash' | 'shelter' | 'security'> = {
  HEALTH: 'health',
  FOOD: 'food',
  WASH: 'wash',
  SHELTER: 'shelter',
  SECURITY: 'security',
};

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

// Per-type gap-bearing aggregate: counts + the ranked, registry-labeled
// CategoryGapSummary (P7). Dead per-type totals (facilities/latrines/etc.) were
// dropped — cards render ranked gap rows, not summed context fields.
interface AggregatedTypeGaps {
  totalEntities: number;
  entitiesWithGaps: number;
  entitiesWithoutGaps: number;
  gapSummary: CategoryGapSummary;
}

interface AggregatedPopulationAssessment {
  totalEntities: number;
  totalPopulation: number;
  totalHouseholds: number;
  totalLivesLost: number;
  totalInjured: number;
}

interface AggregatedAssessments {
  health: AggregatedTypeGaps | null;
  food: AggregatedTypeGaps | null;
  wash: AggregatedTypeGaps | null;
  shelter: AggregatedTypeGaps | null;
  security: AggregatedTypeGaps | null;
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
    health?: (HealthAssessmentData & { gapAnalysis: StoredGapAnalysis | null });
    food?: (FoodAssessmentData & { gapAnalysis: StoredGapAnalysis | null });
    wash?: (WASHAssessmentData & { gapAnalysis: StoredGapAnalysis | null });
    shelter?: (ShelterAssessmentData & { gapAnalysis: StoredGapAnalysis | null });
    security?: (SecurityAssessmentData & { gapAnalysis: StoredGapAnalysis | null });
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
  // P7: live registry projection embedded once per payload (5 gap types) +
  // the effective category-card row limit (DASHBOARD.gapRowsPerCategory).
  questionMetadata?: Record<string, QuestionTypeMetadata>;
  gapRowsPerCategory?: number;
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
          questionSnapshot: true,
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
      // P10-1: hydrate from the row's frozen snapshot when present so
      // post-seed keys aggregate; pre-data-layer rows fall back to the catalog.
      payload: hydrateAnswersFromRow(
        'POPULATION',
        assessment.questionSnapshot,
        (assessment.answers ?? {}) as RapidAssessmentAnswers
      ),
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
      if (assessment && 'gapAnalysis' in assessment && assessment.gapAnalysis?.hasGap) {
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
      if (assessment && 'gapAnalysis' in assessment && assessment.gapAnalysis) {
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

// Individual assessment fetchers — all types now live on RapidAssessment.answers,
// hydrated back to the legacy typed shape via the registry converter.
// gapAnalysis is the STORED P3 engine result and is authoritative: no
// re-derivation happens in the dashboard path.
interface LatestTypedAssessment {
  id: string;
  rapidAssessmentDate: Date;
  verificationStatus: string;
  assessorName: string | null;
  assessorNameFallback: string | null;
  answers: RapidAssessmentAnswers;
  questionSnapshot: unknown;
  gapAnalysis: unknown;
}

/**
 * Snapshot-hydrated read side (P10-1): typed values for every key of the
 * row's frozen `questionSnapshot` — admin-authored post-seed keys included
 * (raw passthrough for keys in neither) — falling back to catalog hydration
 * (`fromAnswers`) for pre-data-layer rows stored without a snapshot. Pure
 * hydration; never throws.
 */
function hydrateAnswersFromRow(
  assessmentType: 'HEALTH' | 'FOOD' | 'WASH' | 'SHELTER' | 'SECURITY' | 'POPULATION',
  questionSnapshot: unknown,
  answers: RapidAssessmentAnswers
): Record<string, AnswerValue> {
  if (questionSnapshot && typeof questionSnapshot === 'object') {
    return hydrateFromSnapshot(
      questionSnapshot as SnapshotHydrationStructure,
      answers
    ).values;
  }
  return fromAnswers(assessmentType, answers);
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
      questionSnapshot: true,
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
    questionSnapshot: assessment.questionSnapshot,
    gapAnalysis: assessment.gapAnalysis,
  };
}

async function getLatestHealthAssessment(entityId: string, incidentId?: string): Promise<(HealthAssessmentData & { gapAnalysis: StoredGapAnalysis | null }) | null> {
  const assessment = await findLatestTypedAssessment(entityId, incidentId, 'HEALTH');
  if (!assessment) return null;

  const payload = hydrateAnswersFromRow('HEALTH', assessment.questionSnapshot, assessment.answers) as unknown as HealthAssessmentData;
  const data: HealthAssessmentData = {
    ...payload,
    rapidAssessmentId: assessment.id,
    rapidAssessmentDate: assessment.rapidAssessmentDate,
    verificationStatus: assessment.verificationStatus,
    assessorName: assessment.assessorName || assessment.assessorNameFallback || 'Unknown',
  };

  return {
    ...data,
    gapAnalysis: assessment.gapAnalysis as unknown as StoredGapAnalysis | null
  };
}

async function getLatestFoodAssessment(entityId: string, incidentId?: string): Promise<(FoodAssessmentData & { gapAnalysis: StoredGapAnalysis | null }) | null> {
  const assessment = await findLatestTypedAssessment(entityId, incidentId, 'FOOD');
  if (!assessment) return null;

  const payload = hydrateAnswersFromRow('FOOD', assessment.questionSnapshot, assessment.answers) as unknown as FoodAssessmentData;
  const data: FoodAssessmentData = {
    ...payload,
    rapidAssessmentId: assessment.id,
    rapidAssessmentDate: assessment.rapidAssessmentDate,
    verificationStatus: assessment.verificationStatus,
    assessorName: assessment.assessorName || assessment.assessorNameFallback || 'Unknown',
  };

  return {
    ...data,
    gapAnalysis: assessment.gapAnalysis as unknown as StoredGapAnalysis | null
  };
}

async function getLatestWASHAssessment(entityId: string, incidentId?: string): Promise<(WASHAssessmentData & { gapAnalysis: StoredGapAnalysis | null }) | null> {
  const assessment = await findLatestTypedAssessment(entityId, incidentId, 'WASH');
  if (!assessment) return null;

  const payload = hydrateAnswersFromRow('WASH', assessment.questionSnapshot, assessment.answers) as unknown as WASHAssessmentData;
  const data: WASHAssessmentData = {
    ...payload,
    rapidAssessmentId: assessment.id,
    rapidAssessmentDate: assessment.rapidAssessmentDate,
    verificationStatus: assessment.verificationStatus,
    assessorName: assessment.assessorName || assessment.assessorNameFallback || 'Unknown',
  };

  return {
    ...data,
    gapAnalysis: assessment.gapAnalysis as unknown as StoredGapAnalysis | null
  };
}

async function getLatestShelterAssessment(entityId: string, incidentId?: string): Promise<(ShelterAssessmentData & { gapAnalysis: StoredGapAnalysis | null }) | null> {
  const assessment = await findLatestTypedAssessment(entityId, incidentId, 'SHELTER');
  if (!assessment) return null;

  const payload = hydrateAnswersFromRow('SHELTER', assessment.questionSnapshot, assessment.answers) as unknown as ShelterAssessmentData;
  const data: ShelterAssessmentData = {
    ...payload,
    rapidAssessmentId: assessment.id,
    rapidAssessmentDate: assessment.rapidAssessmentDate,
    verificationStatus: assessment.verificationStatus,
    assessorName: assessment.assessorName || assessment.assessorNameFallback || 'Unknown',
  };

  return {
    ...data,
    gapAnalysis: assessment.gapAnalysis as unknown as StoredGapAnalysis | null
  };
}

async function getLatestSecurityAssessment(entityId: string, incidentId?: string): Promise<(SecurityAssessmentData & { gapAnalysis: StoredGapAnalysis | null }) | null> {
  const assessment = await findLatestTypedAssessment(entityId, incidentId, 'SECURITY');
  if (!assessment) return null;

  const payload = hydrateAnswersFromRow('SECURITY', assessment.questionSnapshot, assessment.answers) as unknown as SecurityAssessmentData;
  const data: SecurityAssessmentData = {
    ...payload,
    rapidAssessmentId: assessment.id,
    rapidAssessmentDate: assessment.rapidAssessmentDate,
    verificationStatus: assessment.verificationStatus,
    assessorName: assessment.assessorName || assessment.assessorNameFallback || 'Unknown',
  };

  return {
    ...data,
    gapAnalysis: assessment.gapAnalysis as unknown as StoredGapAnalysis | null
  };
}

async function getLatestPopulationAssessment(entityId: string, incidentId?: string): Promise<PopulationAssessmentData | null> {
  const assessment = await findLatestTypedAssessment(entityId, incidentId, 'POPULATION');
  if (!assessment) return null;

  const payload = hydrateAnswersFromRow('POPULATION', assessment.questionSnapshot, assessment.answers) as unknown as PopulationAssessmentData;

  return {
    ...payload,
    rapidAssessmentId: assessment.id,
    rapidAssessmentDate: assessment.rapidAssessmentDate,
    verificationStatus: assessment.verificationStatus,
    assessorName: assessment.assessorName || assessment.assessorNameFallback || 'Unknown',
  };
}



/**
 * Live registry projection for the five gap types, embedded once per payload.
 * Labels/meanings/orders are always CURRENT (deactivation is prospective);
 * keys that fall out of the live set are still rendered from the stored
 * gapAnalysis via the gap-summary label ladder. Never throws: a registry
 * failure for one type degrades to an empty projection (stored fallback
 * labels, stamp v0) instead of 500-ing the whole dashboard — the same
 * resilience contract as getGapRowsPerCategory.
 */
async function getQuestionMetadata(): Promise<Record<GapAssessmentType, QuestionTypeMetadata>> {
  const entries = await Promise.all(
    GAP_ASSESSMENT_TYPES.map(async (assessmentType): Promise<[GapAssessmentType, QuestionTypeMetadata]> => {
      try {
        const set = await QuestionRegistryService.getQuestionSet(assessmentType);
        const questions: SummaryQuestionMeta[] = [];
        for (const section of set.sections) {
          for (const question of section.questions) {
            questions.push({
              key: question.questionKey,
              label: question.label,
              gapLabel: question.gapLabel,
              gapMeaning: question.gapMeaning,
              category: question.category,
              questionType: question.questionType,
              order: questions.length + 1,
            });
          }
        }
        return [assessmentType, {
          questions,
          structureVersion: set.structureVersion,
          contentVersion: set.contentVersion,
        }];
      } catch (error) {
        console.warn(`[situation] registry projection failed for ${assessmentType}, degrading to stored gap labels:`, error);
        return [assessmentType, { questions: [], structureVersion: 0, contentVersion: 0 }];
      }
    })
  );
  return Object.fromEntries(entries) as Record<GapAssessmentType, QuestionTypeMetadata>;
}

/**
 * Generic per-type aggregate: entitiesWithGaps/WithoutGaps counts plus the
 * ranked CategoryGapSummary derived from the STORED gapAnalysis of every
 * latest assessment (no per-field scanning, no severity DB lookups). Returns
 * null when no entity reported this type (card renders "Assessment Missing").
 */
function aggregateTypeGaps(
  entityAssessments: EntityAssessment[],
  assessmentType: GapAssessmentType,
  metadata: SummaryQuestionMeta[],
  limit: number,
  contentVersion: number,
  computedAt: Date
): AggregatedTypeGaps | null {
  const assessments = entityAssessments
    .map((entity) => entity.latestAssessments[LATEST_ASSESSMENT_KEY[assessmentType]])
    .filter((assessment): assessment is NonNullable<typeof assessment> => Boolean(assessment));

  if (assessments.length === 0) {
    return null;
  }

  return {
    totalEntities: assessments.length,
    entitiesWithGaps: assessments.filter((assessment) => assessment.gapAnalysis?.hasGap).length,
    entitiesWithoutGaps: assessments.filter((assessment) => !assessment.gapAnalysis?.hasGap).length,
    gapSummary: buildCategoryGapSummary({
      assessments,
      metadata,
      limit,
      contentVersion,
      computedAt: computedAt.toISOString(),
    }),
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
          ORDER BY dc."commitmentDate" DESC
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
              hasGap: healthAssessment.gapAnalysis?.hasGap ?? false,
              severity: healthAssessment.gapAnalysis?.severity ?? 'LOW',
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
              hasGap: foodAssessment.gapAnalysis?.hasGap ?? false,
              severity: foodAssessment.gapAnalysis?.severity ?? 'LOW',
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
              hasGap: washAssessment.gapAnalysis?.hasGap ?? false,
              severity: washAssessment.gapAnalysis?.severity ?? 'LOW',
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
              hasGap: shelterAssessment.gapAnalysis?.hasGap ?? false,
              severity: shelterAssessment.gapAnalysis?.severity ?? 'LOW',
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
              hasGap: securityAssessment.gapAnalysis?.hasGap ?? false,
              severity: securityAssessment.gapAnalysis?.severity ?? 'LOW',
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
          indicators: []
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
    let questionMetadata: Record<string, QuestionTypeMetadata> | undefined;
    let gapRowsPerCategory: number | undefined;
    
    if (queryParams.incidentId) {
      // Wire the coordinator-tunable row limit (never throws; clamped 1..7)
      // and embed the live registry projection once per payload (5 gap types).
      const [resolvedGapRowLimit, metadata] = await Promise.all([
        getGapRowsPerCategory(),
        getQuestionMetadata(),
      ]);
      gapRowsPerCategory = resolvedGapRowLimit;
      questionMetadata = metadata;

      if (queryParams.entityId === 'all') {
        // Get all entities for this incident
        entityAssessments = await getEntityAssessments(queryParams.incidentId);

        // Ranked per-type gap summaries derived from the STORED gapAnalysis
        // (P7 — no per-field scanning, no severity lookups, no dead totals).
        const computedAt = new Date();
        aggregatedAssessments = {
          health: aggregateTypeGaps(entityAssessments, 'HEALTH', metadata.HEALTH.questions, resolvedGapRowLimit, metadata.HEALTH.contentVersion, computedAt),
          food: aggregateTypeGaps(entityAssessments, 'FOOD', metadata.FOOD.questions, resolvedGapRowLimit, metadata.FOOD.contentVersion, computedAt),
          wash: aggregateTypeGaps(entityAssessments, 'WASH', metadata.WASH.questions, resolvedGapRowLimit, metadata.WASH.contentVersion, computedAt),
          shelter: aggregateTypeGaps(entityAssessments, 'SHELTER', metadata.SHELTER.questions, resolvedGapRowLimit, metadata.SHELTER.contentVersion, computedAt),
          security: aggregateTypeGaps(entityAssessments, 'SECURITY', metadata.SECURITY.questions, resolvedGapRowLimit, metadata.SECURITY.contentVersion, computedAt),
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
          totalGaps: allGapBasedAssessments.filter(a => a && a.gapAnalysis?.hasGap).length,
          totalNoGaps: allGapBasedAssessments.filter(a => a && !a.gapAnalysis?.hasGap).length,
          criticalGaps: allGapBasedAssessments.filter(a => a && a.gapAnalysis?.severity === 'CRITICAL').length,
          entitiesWithGaps: entityAssessments.filter(e => {
            const entityGaps = [
              e.latestAssessments.health?.gapAnalysis?.hasGap,
              e.latestAssessments.food?.gapAnalysis?.hasGap,
              e.latestAssessments.wash?.gapAnalysis?.hasGap,
              e.latestAssessments.shelter?.gapAnalysis?.hasGap,
              e.latestAssessments.security?.gapAnalysis?.hasGap
            ].filter(Boolean);
            return entityGaps.length > 0;
          }).length,
          entitiesWithoutGaps: entityAssessments.filter(e => {
            const entityGaps = [
              e.latestAssessments.health?.gapAnalysis?.hasGap,
              e.latestAssessments.food?.gapAnalysis?.hasGap,
              e.latestAssessments.wash?.gapAnalysis?.hasGap,
              e.latestAssessments.shelter?.gapAnalysis?.hasGap,
              e.latestAssessments.security?.gapAnalysis?.hasGap
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
      questionMetadata,
      gapRowsPerCategory,
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
