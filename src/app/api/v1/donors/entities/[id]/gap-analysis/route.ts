import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/client';
import { AssessmentType } from '@prisma/client';
import {
  GapAnalysisQuerySchema,
  GapAnalysisResponseSchema,
  AssessmentTypeSchema
} from '@/lib/validation/entity-insights';
import { fromAnswers, RapidAssessmentAnswers, RapidAssessmentType } from '@/lib/questions/legacy-convert';
import { handleApiError } from '@/lib/api/response'

// Hydrates the legacy typed payload view from the canonical answers map
function assessmentDataOf(type: AssessmentType, assessment: any): any {
  return fromAnswers(type as RapidAssessmentType, (assessment.answers ?? {}) as RapidAssessmentAnswers);
}

interface GapAnalysisItem {
  category: 'HEALTH' | 'FOOD' | 'WASH' | 'SHELTER' | 'SECURITY' | 'POPULATION';
  severity: 'critical' | 'high' | 'medium' | 'low';
  description: string;
  affectedPopulation: number;
  recommendedActions: string[];
  trend?: 'improving' | 'worsening' | 'stable';
}

export const GET = withAuth(async (request: NextRequest, context, nextContext) => {
  try {
    const { userId, roles } = context;
    // Extract params from nextContext in Next.js 14.2.5
    const entityId = nextContext?.params?.id;

    // Check if user has donor role
    if (!roles.includes('DONOR')) {
      return NextResponse.json(
        { success: false, error: 'Donor role required' },
        { status: 403 }
      );
    }

    // Validate entity ID format
    if (!entityId || typeof entityId !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Valid entity ID is required' },
        { status: 400 }
      );
    }

    // Parse and validate query parameters
    const { searchParams } = new URL(request.url);
    const categoriesParam = searchParams.get('categories');
    const severity = searchParams.get('severity') as any;
    const includeTrends = searchParams.get('includeTrends') !== 'false';

    const queryData = {
      categories: categoriesParam ? categoriesParam.split(',') : undefined,
      severity,
      includeTrends
    };

    const validationResult = GapAnalysisQuerySchema.safeParse(queryData);
    if (!validationResult.success) {
      return NextResponse.json(
        { success: false, error: 'Invalid query parameters', details: validationResult.error.errors },
        { status: 400 }
      );
    }

    const query = validationResult.data;

    // Verify donor has access to this entity through EntityAssignment
    const entityAssignment = await prisma.entityAssignment.findFirst({
      where: {
        userId: userId,
        entityId: entityId
      },
      include: {
        entity: {
          select: {
            metadata: true
          }
        }
      }
    });

    if (!entityAssignment) {
      return NextResponse.json(
        { success: false, error: 'Entity not found or access denied' },
        { status: 404 }
      );
    }

    // Get categories to analyze
    const categories = query.categories || AssessmentTypeSchema.options;

    // Get entity population for impact calculation
    const metadata = entityAssignment.entity.metadata as any || {};
    const entityPopulation = metadata.population || metadata.totalPopulation || 1000; // Default fallback

    // Perform gap analysis for each category
    const gaps: GapAnalysisItem[] = [];
    let totalGapScore = 0;
    let categoryCount = 0;

    for (const type of categories) {
      // Get latest verified assessment for this category
      const latestAssessment = await prisma.rapidAssessment.findFirst({
        where: {
          entityId: entityId,
          rapidAssessmentType: type,
          verificationStatus: 'VERIFIED'
        },
        select: {
          answers: true
        },
        orderBy: { rapidAssessmentDate: 'desc' }
      });

      if (!latestAssessment) {
        continue; // Skip categories with no verified assessments
      }

      const categoryGaps = await analyzeCategoryGaps(
        type, 
        latestAssessment, 
        entityPopulation,
        includeTrends ? entityId : null
      );

      // Filter by severity if specified
      const filteredGaps = query.severity 
        ? categoryGaps.filter(gap => gap.severity === query.severity)
        : categoryGaps;

      gaps.push(...filteredGaps);

      // Calculate category gap score for overall score
      if (categoryGaps.length > 0) {
        const categoryScore = categoryGaps.reduce((sum, gap) => {
          const severityWeight = getSeverityWeight(gap.severity);
          return sum + (severityWeight * 20); // Max 100 points per category
        }, 0) / categoryGaps.length;
        
        totalGapScore += Math.min(categoryScore, 100);
        categoryCount++;
      }
    }

    // Calculate summary statistics
    const totalGaps = gaps.length;
    const criticalGaps = gaps.filter(gap => gap.severity === 'critical').length;
    const highPriorityGaps = gaps.filter(gap => gap.severity === 'high').length;
    
    const mostAffectedCategory = gaps.length > 0 
      ? gaps.reduce((most, current) => {
          const currentCount = gaps.filter(gap => gap.category === current.category).length;
          const mostCount = gaps.filter(gap => gap.category === most.category).length;
          return currentCount > mostCount ? current : most;
        }).category
      : categories[0];

    const overallGapScore = categoryCount > 0 ? Math.round((totalGapScore / categoryCount) * 100) / 100 : 0;

    const responseData = {
      entityId: entityId,
      analysisDate: new Date(),
      overallGapScore,
      gaps,
      summary: {
        totalGaps,
        criticalGaps,
        highPriorityGaps,
        mostAffectedCategory
      }
    };

    // Validate response against schema
    const validatedResponse = GapAnalysisResponseSchema.safeParse({ success: true, data: responseData });
    if (!validatedResponse.success) {
      console.error('Response validation error:', validatedResponse.error);
    }

    return NextResponse.json({
      success: true,
      data: responseData,
      meta: {
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        requestId: crypto.randomUUID()
      }
    });

  } catch (error) {
    console.error('Gap analysis API error:', error);
    return handleApiError(error);
  }
});

// Helper function to analyze gaps for a specific category
async function analyzeCategoryGaps(
  type: AssessmentType, 
  assessment: any, 
  entityPopulation: number,
  entityId: string | null
): Promise<GapAnalysisItem[]> {
  const gaps: GapAnalysisItem[] = [];
  const assessmentData = assessmentDataOf(type, assessment);

  switch (type) {
    case 'HEALTH':
      if (assessmentData) {
        if (!assessmentData.hasFunctionalClinic) {
          gaps.push({
            category: 'HEALTH' as const,
            severity: classifyGapSeverity('critical', entityPopulation),
            description: 'No functional health clinic available',
            affectedPopulation: entityPopulation,
            recommendedActions: [
              'Establish temporary health facility',
              'Deploy mobile health clinic',
              'Coordinate with local health authorities'
            ],
            trend: undefined
          } as GapAnalysisItem);
        }
        if (!assessmentData.hasMedicineSupply) {
          gaps.push({
            category: 'HEALTH' as const,
            severity: classifyGapSeverity('critical', entityPopulation),
            description: 'No essential medicine supply available',
            affectedPopulation: entityPopulation,
            recommendedActions: [
              'Emergency medicine supply distribution',
              'Establish essential drug supply chain',
              'Partner with health organizations'
            ],
            trend: undefined
          } as GapAnalysisItem);
        }
        if (!assessmentData.hasEmergencyServices) {
          gaps.push({
            category: 'HEALTH' as const,
            severity: classifyGapSeverity('high', entityPopulation),
            description: 'No emergency medical services available',
            affectedPopulation: Math.round(entityPopulation * 0.3), // Assume 30% need emergency care
            recommendedActions: [
              'Establish emergency response team',
              'Create emergency transport system',
              'Train community health workers'
            ],
            trend: undefined
          } as GapAnalysisItem);
        }
        if (assessmentData.qualifiedHealthWorkers === 0) {
          gaps.push({
            category: 'HEALTH' as const,
            severity: classifyGapSeverity('critical', entityPopulation),
            description: 'No qualified health workers available',
            affectedPopulation: entityPopulation,
            recommendedActions: [
              'Deploy qualified health personnel',
              'Train community health volunteers',
              'Establish partnership with health agencies'
            ],
            trend: undefined
          } as GapAnalysisItem);
        }
      }
      break;

    case 'FOOD':
      if (assessmentData) {
        if (!assessmentData.isFoodSufficient) {
          gaps.push({
            category: 'FOOD' as const,
            severity: classifyGapSeverity('critical', entityPopulation),
            description: 'Insufficient food supply for population',
            affectedPopulation: entityPopulation,
            recommendedActions: [
              'Emergency food distribution',
              'Establish food supply chain',
              'Coordinate with World Food Programme'
            ],
            trend: undefined
          } as GapAnalysisItem);
        }
        if (!assessmentData.hasRegularMealAccess) {
          gaps.push({
            category: 'FOOD' as const,
            severity: classifyGapSeverity('high', entityPopulation),
            description: 'Population lacks regular meal access',
            affectedPopulation: Math.round(entityPopulation * 0.7), // Assume 70% affected
            recommendedActions: [
              'Set up community kitchens',
              'Distribute food parcels',
              'Establish meal programs'
            ],
            trend: undefined
          } as GapAnalysisItem);
        }
        if (assessmentData.availableFoodDurationDays < 7) {
          gaps.push({
            category: 'FOOD' as const,
            severity: classifyGapSeverity('high', entityPopulation),
            description: `Food reserves only sufficient for ${assessmentData.availableFoodDurationDays} days`,
            affectedPopulation: entityPopulation,
            recommendedActions: [
              'Increase emergency food reserves',
              'Establish regular food supply convoys',
              'Create local food storage facilities'
            ],
            trend: undefined
          } as GapAnalysisItem);
        }
      }
      break;

    case 'WASH':
      if (assessmentData) {
        if (!assessmentData.isWaterSufficient) {
          gaps.push({
            category: 'WASH' as const,
            severity: classifyGapSeverity('critical', entityPopulation),
            description: 'Insufficient water supply for population',
            affectedPopulation: entityPopulation,
            recommendedActions: [
              'Install water storage tanks',
              'Establish water trucking services',
              'Drill new boreholes or wells'
            ],
            trend: undefined
          } as GapAnalysisItem);
        }
        if (!assessmentData.hasCleanWaterAccess) {
          gaps.push({
            category: 'WASH' as const,
            severity: classifyGapSeverity('critical', entityPopulation),
            description: 'No access to clean drinking water',
            affectedPopulation: entityPopulation,
            recommendedActions: [
              'Establish water purification systems',
              'Distribute water purification tablets',
              'Create protected water points'
            ],
            trend: undefined
          } as GapAnalysisItem);
        }
        if (assessmentData.functionalLatrinesAvailable === 0) {
          gaps.push({
            category: 'WASH' as const,
            severity: classifyGapSeverity('critical', entityPopulation),
            description: 'No functional latrines available',
            affectedPopulation: entityPopulation,
            recommendedActions: [
              'Construct emergency latrines',
              'Establish sanitation facilities',
              'Promote community-led total sanitation'
            ],
            trend: undefined
          } as GapAnalysisItem);
        }
        if (!assessmentData.hasHandwashingFacilities) {
          gaps.push({
            category: 'WASH' as const,
            severity: classifyGapSeverity('high', entityPopulation),
            description: 'No handwashing facilities available',
            affectedPopulation: Math.round(entityPopulation * 0.8),
            recommendedActions: [
              'Install handwashing stations',
              'Distribute soap and hand sanitizer',
              'Conduct hygiene promotion campaigns'
            ],
            trend: undefined
          } as GapAnalysisItem);
        }
      }
      break;

    case 'SHELTER':
      if (assessmentData) {
        if (!assessmentData.areSheltersSufficient) {
          gaps.push({
            category: 'SHELTER' as const,
            severity: classifyGapSeverity('critical', entityPopulation),
            description: 'Insufficient shelter for affected population',
            affectedPopulation: Math.round(entityPopulation * 0.9), // Assume 90% need shelter
            recommendedActions: [
              'Deploy emergency shelters',
              'Distribute shelter kits',
              'Establish temporary camps'
            ],
            trend: undefined
          } as GapAnalysisItem);
        }
        if (!assessmentData.hasSafeStructures) {
          gaps.push({
            category: 'SHELTER' as const,
            severity: classifyGapSeverity('critical', entityPopulation),
            description: 'No safe shelter structures available',
            affectedPopulation: Math.round(entityPopulation * 0.7),
            recommendedActions: [
              'Construct safe temporary shelters',
              'Reinforce existing structures',
              'Establish safe zones'
            ],
            trend: undefined
          } as GapAnalysisItem);
        }
        if (assessmentData.numberSheltersRequired > 0) {
          gaps.push({
            category: 'SHELTER' as const,
            severity: classifyGapSeverity('high', entityPopulation),
            description: `${assessmentData.numberSheltersRequired} additional shelters required`,
            affectedPopulation: assessmentData.numberSheltersRequired * 5, // Assume 5 people per shelter
            recommendedActions: [
              'Urgent construction of additional shelters',
              'Request shelter assistance from partners',
              'Set up temporary accommodation'
            ],
            trend: undefined
          } as GapAnalysisItem);
        }
        if (assessmentData.areOvercrowded) {
          gaps.push({
            category: 'SHELTER' as const,
            severity: classifyGapSeverity('high', entityPopulation),
            description: 'Existing shelters are overcrowded',
            affectedPopulation: Math.round(entityPopulation * 0.6),
            recommendedActions: [
              'Decongest existing shelters',
              'Establish additional shelter sites',
              'Improve ventilation and space'
            ],
            trend: undefined
          } as GapAnalysisItem);
        }
      }
      break;

    case 'SECURITY':
      if (assessmentData) {
        if (!assessmentData.isSafeFromViolence) {
          gaps.push({
            category: 'SECURITY' as const,
            severity: classifyGapSeverity('critical', entityPopulation),
            description: 'Population not safe from violence',
            affectedPopulation: entityPopulation,
            recommendedActions: [
              'Deploy security personnel',
              'Establish safe zones',
              'Implement protective measures'
            ],
            trend: undefined
          } as GapAnalysisItem);
        }
        if (!assessmentData.hasSecurityPresence) {
          gaps.push({
            category: 'SECURITY' as const,
            severity: classifyGapSeverity('high', entityPopulation),
            description: 'No security presence in the area',
            affectedPopulation: entityPopulation,
            recommendedActions: [
              'Establish security patrol',
              'Set up security checkpoints',
              'Coordinate with local authorities'
            ],
            trend: undefined
          } as GapAnalysisItem);
        }
        if (!assessmentData.hasProtectionReportingMechanism) {
          gaps.push({
            category: 'SECURITY' as const,
            severity: classifyGapSeverity('high', entityPopulation),
            description: 'No protection reporting mechanism available',
            affectedPopulation: Math.round(entityPopulation * 0.5),
            recommendedActions: [
              'Establish reporting hotlines',
              'Create community protection committees',
              'Set up feedback mechanisms'
            ],
            trend: undefined
          } as GapAnalysisItem);
        }
        if (!assessmentData.vulnerableGroupsHaveAccess) {
          gaps.push({
            category: 'SECURITY' as const,
            severity: classifyGapSeverity('critical', entityPopulation),
            description: 'Vulnerable groups lack protection access',
            affectedPopulation: Math.round(entityPopulation * 0.3), // Assume 30% are vulnerable
            recommendedActions: [
              'Establish targeted protection programs',
              'Create safe spaces for vulnerable groups',
              'Provide specialized protection services'
            ],
            trend: undefined
          } as GapAnalysisItem);
        }
      }
      break;

    case 'POPULATION':
      if (assessmentData) {
        if (assessmentData.numberLivesLost > 0) {
          gaps.push({
            category: 'POPULATION' as const,
            severity: classifyGapSeverity('critical', assessmentData.numberLivesLost),
            description: `${assessmentData.numberLivesLost} lives lost`,
            affectedPopulation: assessmentData.numberLivesLost,
            recommendedActions: [
              'Provide emergency medical care',
              'Establish mortuary services',
              'Provide psychosocial support'
            ],
            trend: undefined
          } as GapAnalysisItem);
        }
        if (assessmentData.numberInjured > 0) {
          gaps.push({
            category: 'POPULATION' as const,
            severity: classifyGapSeverity('high', assessmentData.numberInjured),
            description: `${assessmentData.numberInjured} persons injured`,
            affectedPopulation: assessmentData.numberInjured,
            recommendedActions: [
              'Establish emergency medical facilities',
              'Deploy medical personnel',
              'Provide trauma care services'
            ],
            trend: undefined
          } as GapAnalysisItem);
        }
      }
      break;
  }

  // Add trend analysis if requested
  if (entityId) {
    const trend = await analyzeGapTrend(type, entityId);
    gaps.forEach(gap => {
      gap.trend = trend;
    });
  }

  return gaps;
}

// Helper function to classify gap severity
function classifyGapSeverity(baseSeverity: string, affectedPopulation: number): 'critical' | 'high' | 'medium' | 'low' {
  // Adjust severity based on population impact
  if (affectedPopulation >= 1000) {
    return 'critical';
  } else if (affectedPopulation >= 500) {
    return baseSeverity === 'critical' ? 'critical' : 'high';
  } else if (affectedPopulation >= 100) {
    return baseSeverity === 'critical' ? 'high' : baseSeverity === 'high' ? 'medium' : 'medium';
  } else {
    return 'low';
  }
}

// Helper function to get severity weight for scoring
function getSeverityWeight(severity: string): number {
  switch (severity) {
    case 'critical': return 1.0;
    case 'high': return 0.8;
    case 'medium': return 0.6;
    case 'low': return 0.4;
    default: return 0.5;
  }
}

// Helper function to analyze gap trends over time
async function analyzeGapTrend(type: AssessmentType, entityId: string): Promise<'improving' | 'worsening' | 'stable'> {
  try {
    // Get last 3 assessments for this category
    const recentAssessments = await prisma.rapidAssessment.findMany({
      where: {
        entityId: entityId,
        rapidAssessmentType: type,
        verificationStatus: 'VERIFIED'
      },
      select: {
        answers: true
      },
      orderBy: { rapidAssessmentDate: 'desc' },
      take: 3
    });

    if (recentAssessments.length < 2) {
      return 'stable';
    }

    // Calculate gap counts for each assessment
    const gapCounts = recentAssessments.map(assessment => 
      calculateGapCount(type, assessment)
    );

    // Analyze trend
    const latest = gapCounts[0];
    const previous = gapCounts[1];
    const change = latest - previous;

    if (change <= -2) {
      return 'improving';
    } else if (change >= 2) {
      return 'worsening';
    } else {
      return 'stable';
    }
  } catch (error) {
    console.error('Error analyzing gap trend:', error);
    return 'stable';
  }
}

// Helper function to calculate gap count for an assessment
function calculateGapCount(type: AssessmentType, assessment: any): number {
  let gapCount = 0;
  const assessmentData = assessmentDataOf(type, assessment);

  switch (type) {
    case 'HEALTH':
      if (assessmentData) {
        if (!assessmentData.hasFunctionalClinic) gapCount++;
        if (!assessmentData.hasMedicineSupply) gapCount++;
        if (!assessmentData.hasMedicalSupplies) gapCount++;
        if (assessmentData.qualifiedHealthWorkers === 0) gapCount++;
        if (!assessmentData.hasEmergencyServices) gapCount++;
      }
      break;

    case 'FOOD':
      if (assessmentData) {
        if (!assessmentData.isFoodSufficient) gapCount++;
        if (!assessmentData.hasRegularMealAccess) gapCount++;
        if (assessmentData.availableFoodDurationDays < 7) gapCount++;
      }
      break;

    case 'WASH':
      if (assessmentData) {
        if (!assessmentData.isWaterSufficient) gapCount++;
        if (!assessmentData.hasCleanWaterAccess) gapCount++;
        if (assessmentData.functionalLatrinesAvailable === 0) gapCount++;
        if (!assessmentData.hasHandwashingFacilities) gapCount++;
      }
      break;

    case 'SHELTER':
      if (assessmentData) {
        if (!assessmentData.areSheltersSufficient) gapCount++;
        if (!assessmentData.hasSafeStructures) gapCount++;
        if (assessmentData.numberSheltersRequired > 0) gapCount++;
        if (assessmentData.areOvercrowded) gapCount++;
      }
      break;

    case 'SECURITY':
      if (assessmentData) {
        if (!assessmentData.isSafeFromViolence) gapCount++;
        if (!assessmentData.hasSecurityPresence) gapCount++;
        if (!assessmentData.hasProtectionReportingMechanism) gapCount++;
        if (!assessmentData.vulnerableGroupsHaveAccess) gapCount++;
      }
      break;
  }

  return gapCount;
}