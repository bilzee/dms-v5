import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/client';
import { AssessmentType } from '@prisma/client';
import {
  AssessmentTrendsQuerySchema,
  AssessmentTrendsResponseSchema,
  AssessmentTypeSchema
} from '@/lib/validation/entity-insights';
import { fromAnswers, RapidAssessmentAnswers, RapidAssessmentType } from '@/lib/questions/answers';
import { handleApiError } from '@/lib/api/response'

// Hydrates the legacy typed payload view from the canonical answers map
function assessmentDataOf(type: AssessmentType, assessment: any): any {
  return fromAnswers(type as RapidAssessmentType, (assessment.answers ?? {}) as RapidAssessmentAnswers);
}

interface RouteParams {
  params: { id: string }
}

interface TrendInsight {
  category: string;
  trend: string;
  recommendation: string;
}

export const GET = withAuth(async (request: NextRequest, context, { params }: RouteParams) => {
  try {
    const { userId, roles } = context;
    const entityId = params.id;

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
    const timeframe = searchParams.get('timeframe') || '1y';
    const granularity = searchParams.get('granularity') || 'monthly';

    const queryData = {
      timeframe,
      categories: categoriesParam ? categoriesParam.split(',') : undefined,
      granularity
    };

    const validationResult = AssessmentTrendsQuerySchema.safeParse(queryData);
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
      }
    });

    if (!entityAssignment) {
      return NextResponse.json(
        { success: false, error: 'Entity not found or access denied' },
        { status: 404 }
      );
    }

    // Calculate date range based on timeframe
    const endDate = new Date();
    const startDate = new Date();
    
    switch (query.timeframe) {
      case '3m':
        startDate.setMonth(startDate.getMonth() - 3);
        break;
      case '6m':
        startDate.setMonth(startDate.getMonth() - 6);
        break;
      case '1y':
        startDate.setFullYear(startDate.getFullYear() - 1);
        break;
      case '2y':
        startDate.setFullYear(startDate.getFullYear() - 2);
        break;
    }

    // Get categories to analyze
    const categories = query.categories || AssessmentTypeSchema.options;

    // Generate trend data for each category
    const trends = await Promise.all(
      categories.map(async (type) => {
        // Get assessments for this category within the timeframe
        const assessments = await prisma.rapidAssessment.findMany({
          where: {
            entityId: entityId,
            rapidAssessmentType: type,
            verificationStatus: 'VERIFIED',
            rapidAssessmentDate: {
              gte: startDate,
              lte: endDate
            }
          },
          select: {
            answers: true,
            rapidAssessmentDate: true
          },
          orderBy: { rapidAssessmentDate: 'asc' }
        });

        if (assessments.length === 0) {
          return {
            type,
            dataPoints: []
          };
        }

        // Generate time periods based on granularity
        const periods = generateTimePeriods(startDate, endDate, query.granularity);
        
        // Group assessments by time periods and calculate metrics
        const dataPoints = periods.map(period => {
          const periodAssessments = assessments.filter(assessment => 
            isAssessmentInPeriod(assessment.rapidAssessmentDate, period, query.granularity)
          );

          if (periodAssessments.length === 0) {
            return {
              period: period.label,
              score: 0,
              gapCount: 0,
              assessmentCount: 0,
              trend: 'stable' as const
            };
          }

          // Calculate average score and gap count for this period
          const scores = periodAssessments.map(assessment => 
            calculateAssessmentScore(type, assessment)
          ).filter(score => score !== null) as number[];

          const avgScore = scores.length > 0 
            ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100
            : 0;

          const gapCount = periodAssessments.reduce((count, assessment) => 
            count + calculateGapCount(type, assessment), 0
          );

          return {
            period: period.label,
            score: avgScore,
            gapCount,
            assessmentCount: periodAssessments.length,
            trend: 'stable' // Will be calculated later
          };
        });

        // Calculate trends for each data point (except the first)
        const dataPointsWithTrends = dataPoints.map((point, index) => {
          if (index === 0) return point;
          
          const previousPoint = dataPoints[index - 1];
          const scoreChange = point.score - previousPoint.score;
          const gapChange = point.gapCount - previousPoint.gapCount;
          
          let trend: 'improving' | 'declining' | 'stable' = 'stable';
          
          // Determine trend based on score improvement and gap reduction
          if (scoreChange > 5 && gapChange <= 0) {
            trend = 'improving';
          } else if (scoreChange < -5 && gapChange > 0) {
            trend = 'declining';
          }

          return {
            ...point,
            trend
          };
        });

        return {
          type,
          dataPoints: dataPointsWithTrends
        };
      })
    );

    // Generate insights based on trends
    const insights = generateInsights(trends, categories);

    const responseData = {
      entityId: entityId,
      timeframe: {
        start: startDate,
        end: endDate,
        granularity: query.granularity
      },
      trends,
      insights
    };

    // Validate response against schema
    const validatedResponse = AssessmentTrendsResponseSchema.safeParse({ success: true, data: responseData });
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
    console.error('Assessment trends API error:', error);
    return handleApiError(error);
  }
});

// Helper function to generate time periods based on granularity
function generateTimePeriods(startDate: Date, endDate: Date, granularity: string) {
  const periods = [];
  const current = new Date(startDate);

  while (current < endDate) {
    let label: string;
    let periodStart: Date;
    let periodEnd: Date;

    switch (granularity) {
      case 'monthly':
        const month = current.getMonth();
        const year = current.getFullYear();
        label = `${year}-${String(month + 1).padStart(2, '0')}`;
        periodStart = new Date(year, month, 1);
        periodEnd = new Date(year, month + 1, 0);
        current.setMonth(month + 1);
        break;
        
      case 'quarterly':
        const quarter = Math.floor(current.getMonth() / 3) + 1;
        const qYear = current.getFullYear();
        label = `${qYear}-Q${quarter}`;
        const qStartMonth = (quarter - 1) * 3;
        periodStart = new Date(qYear, qStartMonth, 1);
        periodEnd = new Date(qYear, qStartMonth + 3, 0);
        current.setMonth(qStartMonth + 3);
        break;
        
      case 'yearly':
        const y = current.getFullYear();
        label = `${y}`;
        periodStart = new Date(y, 0, 1);
        periodEnd = new Date(y, 11, 31);
        current.setFullYear(y + 1);
        break;
        
      default:
        const m = current.getMonth();
        const yr = current.getFullYear();
        label = `${yr}-${String(m + 1).padStart(2, '0')}`;
        periodStart = new Date(yr, m, 1);
        periodEnd = new Date(yr, m + 1, 0);
        current.setMonth(m + 1);
    }

    periods.push({ label, start: periodStart, end: periodEnd });
  }

  return periods;
}

// Helper function to check if assessment falls within a time period
function isAssessmentInPeriod(assessmentDate: Date, period: any, granularity: string): boolean {
  return assessmentDate >= period.start && assessmentDate <= period.end;
}

// Helper function to calculate assessment score (0-100)
function calculateAssessmentScore(type: AssessmentType, assessment: any): number | null {
  let totalScore = 0;
  let maxScore = 0;

  try {
    switch (type) {
      case 'HEALTH':
        const health = assessmentDataOf(type, assessment);
        if (health) {
          totalScore += health.hasFunctionalClinic ? 20 : 0;
          totalScore += health.hasEmergencyServices ? 20 : 0;
          totalScore += health.qualifiedHealthWorkers > 0 ? 20 : 0;
          totalScore += health.hasMedicineSupply ? 20 : 0;
          totalScore += health.hasMedicalSupplies ? 20 : 0;
          maxScore = 100;
        }
        break;

      case 'FOOD':
        const food = assessmentDataOf(type, assessment);
        if (food) {
          totalScore += food.isFoodSufficient ? 33 : 0;
          totalScore += food.hasRegularMealAccess ? 33 : 0;
          totalScore += food.availableFoodDurationDays >= 7 ? 34 : 0;
          maxScore = 100;
        }
        break;

      case 'WASH':
        const wash = assessmentDataOf(type, assessment);
        if (wash) {
          totalScore += wash.isWaterSufficient ? 25 : 0;
          totalScore += wash.hasCleanWaterAccess ? 25 : 0;
          totalScore += wash.functionalLatrinesAvailable > 0 ? 25 : 0;
          totalScore += wash.hasHandwashingFacilities ? 25 : 0;
          maxScore = 100;
        }
        break;

      case 'SHELTER':
        const shelter = assessmentDataOf(type, assessment);
        if (shelter) {
          totalScore += shelter.areSheltersSufficient ? 25 : 0;
          totalScore += shelter.hasSafeStructures ? 25 : 0;
          totalScore += shelter.numberSheltersRequired === 0 ? 25 : 0;
          totalScore += !shelter.areOvercrowded ? 25 : 0;
          maxScore = 100;
        }
        break;

      case 'SECURITY':
        const security = assessmentDataOf(type, assessment);
        if (security) {
          totalScore += security.isSafeFromViolence ? 25 : 0;
          totalScore += security.hasSecurityPresence ? 25 : 0;
          totalScore += security.hasProtectionReportingMechanism ? 25 : 0;
          totalScore += security.vulnerableGroupsHaveAccess ? 25 : 0;
          maxScore = 100;
        }
        break;

      case 'POPULATION':
        // Population assessments are data collection, not scored
        return null;
    }

    return maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : null;
  } catch (error) {
    console.error('Error calculating assessment score:', error);
    return null;
  }
}

// Helper function to calculate gap count for an assessment
function calculateGapCount(type: AssessmentType, assessment: any): number {
  let gapCount = 0;

  try {
    switch (type) {
      case 'HEALTH':
        const health = assessmentDataOf(type, assessment);
        if (health) {
          if (!health.hasFunctionalClinic) gapCount++;
          if (!health.hasMedicineSupply) gapCount++;
          if (!health.hasMedicalSupplies) gapCount++;
          if (health.qualifiedHealthWorkers === 0) gapCount++;
          if (!health.hasEmergencyServices) gapCount++;
        }
        break;

      case 'FOOD':
        const food = assessmentDataOf(type, assessment);
        if (food) {
          if (!food.isFoodSufficient) gapCount++;
          if (!food.hasRegularMealAccess) gapCount++;
          if (food.availableFoodDurationDays < 7) gapCount++;
        }
        break;

      case 'WASH':
        const wash = assessmentDataOf(type, assessment);
        if (wash) {
          if (!wash.isWaterSufficient) gapCount++;
          if (!wash.hasCleanWaterAccess) gapCount++;
          if (wash.functionalLatrinesAvailable === 0) gapCount++;
          if (!wash.hasHandwashingFacilities) gapCount++;
        }
        break;

      case 'SHELTER':
        const shelter = assessmentDataOf(type, assessment);
        if (shelter) {
          if (!shelter.areSheltersSufficient) gapCount++;
          if (!shelter.hasSafeStructures) gapCount++;
          if (shelter.numberSheltersRequired > 0) gapCount++;
          if (shelter.areOvercrowded) gapCount++;
        }
        break;

      case 'SECURITY':
        const security = assessmentDataOf(type, assessment);
        if (security) {
          if (!security.isSafeFromViolence) gapCount++;
          if (!security.hasSecurityPresence) gapCount++;
          if (!security.hasProtectionReportingMechanism) gapCount++;
          if (!security.vulnerableGroupsHaveAccess) gapCount++;
        }
        break;
    }
  } catch (error) {
    console.error('Error calculating gap count:', error);
  }

  return gapCount;
}

// Helper function to generate insights based on trends
function generateInsights(trends: any[], categories: string[]): TrendInsight[] {
  const insights: TrendInsight[] = [];

  trends.forEach(trend => {
    if (trend.dataPoints.length < 2) return;

    const latestPoint = trend.dataPoints[trend.dataPoints.length - 1];
    const previousPoint = trend.dataPoints[trend.dataPoints.length - 2];
    
    const scoreChange = latestPoint.score - previousPoint.score;
    const gapChange = latestPoint.gapCount - previousPoint.gapCount;
    
    let trendDescription = 'stable';
    let recommendation = 'Continue monitoring current conditions.';
    
    if (scoreChange > 10) {
      trendDescription = 'improving significantly';
      recommendation = `Positive trend in ${trend.type.toLowerCase()}. Maintain current interventions.`;
    } else if (scoreChange > 5) {
      trendDescription = 'improving';
      recommendation = `Good progress in ${trend.type.toLowerCase()}. Consider scaling successful interventions.`;
    } else if (scoreChange < -10) {
      trendDescription = 'declining significantly';
      recommendation = `Urgent attention needed for ${trend.type.toLowerCase()}. Immediate intervention required.`;
    } else if (scoreChange < -5) {
      trendDescription = 'declining';
      recommendation = `Declining trend in ${trend.type.toLowerCase()}. Review and adjust current strategies.`;
    }
    
    if (gapChange > 2) {
      recommendation += ' Increasing gaps require immediate attention.';
    } else if (gapChange < -2) {
      recommendation += ' Gaps are decreasing, showing positive impact.';
    }

    insights.push({
      category: trend.type,
      trend: trendDescription,
      recommendation
    });
  });

  return insights;
}