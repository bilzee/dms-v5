import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/client';
import { AssessmentType } from '@prisma/client';
import { fromAnswers, RapidAssessmentAnswers, RapidAssessmentType } from '@/lib/questions/legacy-convert';
import { handleApiError } from '@/lib/api/response'

export const GET = withAuth(async (request: NextRequest, context) => {
  try {
    const { userId, roles } = context;

    // Check if user has donor role
    if (!roles.includes('DONOR')) {
      return NextResponse.json(
        { success: false, error: 'Donor role required' },
        { status: 403 }
      );
    }

    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const categoriesParam = searchParams.get('categories');
    const includeUnverified = searchParams.get('includeUnverified') === 'true';
    const limitParam = searchParams.get('limit');
    const limit = limitParam ? parseInt(limitParam, 10) : 50; // Default limit

    const categories = categoriesParam ? categoriesParam.split(',') : 
      ['HEALTH', 'FOOD', 'WASH', 'SHELTER', 'SECURITY', 'POPULATION'];

    // Get all entities that the donor has access to through EntityAssignment
    const entityAssignments = await prisma.entityAssignment.findMany({
      where: {
        userId: userId
      },
      select: {
        entityId: true,
        assignedAt: true,
        entity: {
          select: {
            id: true,
            name: true,
            type: true,
            location: true
          }
        }
      }
    });

    if (entityAssignments.length === 0) {
      return NextResponse.json({
        success: true,
        data: {
          totalEntities: 0,
          latestAssessmentsByCategory: {},
          assessmentSummary: {
            totalAssessments: 0,
            entitiesAssessed: 0,
            assessmentCoverage: 0
          },
          entities: []
        },
        meta: {
          timestamp: new Date().toISOString(),
          version: '1.0.0',
          requestId: crypto.randomUUID()
        }
      });
    }

    const entityIds = entityAssignments.map(assignment => assignment.entityId);

    // Build the where clause for assessments
    const whereClause: any = {
      entityId: { in: entityIds },
      rapidAssessmentType: { in: categories },
      verificationStatus: includeUnverified ? undefined : 'VERIFIED'
    };

    // Get latest assessments by category across all entities
    const latestAssessmentsByCategory: Record<string, any[]> = {};
    
    for (const category of categories) {
      const assessments = await prisma.rapidAssessment.findMany({
        where: {
          ...whereClause,
          rapidAssessmentType: category
        },
        select: {
          id: true,
          rapidAssessmentType: true,
          rapidAssessmentDate: true,
          verificationStatus: true,
          priority: true,
          location: true,
          coordinates: true,
          createdAt: true,
          updatedAt: true,
          answers: true,
          assessor: {
            select: {
              id: true,
              name: true,
              organization: true
            }
          },
          entity: {
            select: {
              id: true,
              name: true,
              type: true,
              location: true
            }
          }
        },
        orderBy: { rapidAssessmentDate: 'desc' },
        take: limit
      });

      // Process assessments with summary calculations
      const processedAssessments = await Promise.all(
        assessments.map(async (assessment) => {
          // Hydrate the legacy typed payload from the canonical answers map
          const typeSpecificData = fromAnswers(
            assessment.rapidAssessmentType as RapidAssessmentType,
            (assessment.answers ?? {}) as RapidAssessmentAnswers
          );

          // Calculate assessment summary
          const summary = await calculateAssessmentSummary(assessment.rapidAssessmentType, typeSpecificData);

          return {
            id: assessment.id,
            type: assessment.rapidAssessmentType,
            date: assessment.rapidAssessmentDate,
            status: assessment.verificationStatus,
            priority: assessment.priority,
            location: assessment.location,
            coordinates: assessment.coordinates,
            data: typeSpecificData,
            summary,
            assessor: assessment.assessor,
            entity: assessment.entity,
            createdAt: assessment.createdAt,
            updatedAt: assessment.updatedAt
          };
        })
      );

      latestAssessmentsByCategory[category] = processedAssessments;
    }

    // Calculate overall statistics
    const totalAssessments = Object.values(latestAssessmentsByCategory).reduce(
      (sum, assessments) => sum + assessments.length, 0
    );

    const entitiesWithAssessments = new Set();
    Object.values(latestAssessmentsByCategory).forEach(assessments => {
      assessments.forEach(assessment => {
        entitiesWithAssessments.add(assessment.entity.id);
      });
    });

    const entitiesAssessed = entitiesWithAssessments.size;
    const assessmentCoverage = entityAssignments.length > 0 ? 
      (entitiesAssessed / entityAssignments.length) * 100 : 0;

    // Get most recent assessment across all categories for quick reference
    const allAssessments = Object.values(latestAssessmentsByCategory).flat();
    allAssessments.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    // Calculate category coverage
    const categoryCoverage = categories.reduce((acc, category) => {
      const categoryAssessments = latestAssessmentsByCategory[category] || [];
      const entitiesInCategory = new Set(categoryAssessments.map(a => a.entity.id));
      acc[category] = {
        totalAssessments: categoryAssessments.length,
        entitiesCovered: entitiesInCategory.size,
        coverage: entityAssignments.length > 0 ? 
          (entitiesInCategory.size / entityAssignments.length) * 100 : 0,
        mostRecent: categoryAssessments[0]?.date || null
      };
      return acc;
    }, {} as Record<string, any>);

    // Calculate critical gaps summary
    const criticalGaps: string[] = [];
    const categoryScores: Record<string, number> = {};

    Object.entries(latestAssessmentsByCategory).forEach(([category, assessments]) => {
      const scores = assessments
        .map(a => a.summary.overallScore)
        .filter(score => score !== undefined) as number[];
      
      if (scores.length > 0) {
        const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
        categoryScores[category] = Math.round(avgScore * 100) / 100;
        
        if (avgScore < 50) {
          criticalGaps.push(`Low ${category.toLowerCase()} score: ${Math.round(avgScore)}%`);
        }
      }

      // Aggregate critical gaps
      assessments.forEach(assessment => {
        if (assessment.summary.criticalGaps && assessment.summary.criticalGaps.length > 0) {
          assessment.summary.criticalGaps.forEach((gap: string) => {
            if (!criticalGaps.includes(gap)) {
              criticalGaps.push(gap);
            }
          });
        }
      });
    });

    const responseData = {
      totalEntities: entityAssignments.length,
      latestAssessmentsByCategory,
      assessmentSummary: {
        totalAssessments,
        entitiesAssessed,
        assessmentCoverage: Math.round(assessmentCoverage * 100) / 100,
        categoryCoverage,
        categoryScores,
        criticalGaps: criticalGaps.slice(0, 10), // Top 10 gaps
        mostRecentAssessment: allAssessments[0] || null
      },
      entities: entityAssignments.map(assignment => ({
        id: assignment.entity.id,
        name: assignment.entity.name,
        type: assignment.entity.type,
        location: assignment.entity.location,
        assignedAt: assignment.assignedAt,
        hasAssessments: entitiesWithAssessments.has(assignment.entity.id)
      }))
    };

    return NextResponse.json({
      success: true,
      data: responseData,
      meta: {
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        requestId: crypto.randomUUID(),
        query: {
          categories,
          includeUnverified,
          limit
        }
      }
    });

  } catch (error) {
    console.error('Donor entities impact assessments API error:', error);
    return handleApiError(error);
  }
});

// Helper function to calculate assessment summary and gap analysis
async function calculateAssessmentSummary(type: AssessmentType, data: any): Promise<{
  overallScore?: number;
  criticalGaps: string[];
  keyMetrics: Record<string, any>;
}> {
  const criticalGaps: string[] = [];
  const keyMetrics: Record<string, any> = {};
  let totalScore = 0;
  let scoreCount = 0;

  switch (type) {
    case 'HEALTH':
      keyMetrics.facilities = data.numberHealthFacilities || 0;
      keyMetrics.hasClinic = data.hasFunctionalClinic || false;
      keyMetrics.hasEmergencyServices = data.hasEmergencyServices || false;
      keyMetrics.staffCount = data.qualifiedHealthWorkers || 0;
      keyMetrics.hasSupplies = data.hasMedicineSupply || false;

      if (!data.hasFunctionalClinic) criticalGaps.push('No functional clinic');
      if (!data.hasMedicineSupply) criticalGaps.push('No medicine supply');
      if (!data.hasMedicalSupplies) criticalGaps.push('No medical supplies');
      if (data.qualifiedHealthWorkers === 0) criticalGaps.push('No qualified health workers');

      totalScore = [
        data.hasFunctionalClinic ? 20 : 0,
        data.hasEmergencyServices ? 20 : 0,
        data.qualifiedHealthWorkers > 0 ? 20 : 0,
        data.hasMedicineSupply ? 20 : 0,
        data.hasMedicalSupplies ? 20 : 0
      ].reduce((a, b) => a + b, 0);
      scoreCount = 1;
      break;

    case 'FOOD':
      keyMetrics.isSufficient = data.isFoodSufficient || false;
      keyMetrics.hasRegularAccess = data.hasRegularMealAccess || false;
      keyMetrics.durationDays = data.availableFoodDurationDays || 0;
      keyMetrics.additionalFoodNeeded = data.additionalFoodRequiredPersons || 0;

      if (!data.isFoodSufficient) criticalGaps.push('Insufficient food');
      if (!data.hasRegularMealAccess) criticalGaps.push('No regular meal access');
      if (data.availableFoodDurationDays < 7) criticalGaps.push('Food reserves less than 7 days');

      totalScore = [
        data.isFoodSufficient ? 33 : 0,
        data.hasRegularMealAccess ? 33 : 0,
        data.availableFoodDurationDays >= 7 ? 34 : 0
      ].reduce((a, b) => a + b, 0);
      scoreCount = 1;
      break;

    case 'WASH':
      keyMetrics.waterSource = data.waterSource || [];
      keyMetrics.isSufficient = data.isWaterSufficient || false;
      keyMetrics.hasCleanAccess = data.hasCleanWaterAccess || false;
      keyMetrics.latrineCount = data.functionalLatrinesAvailable || 0;
      keyMetrics.hasHandwashing = data.hasHandwashingFacilities || false;

      if (!data.isWaterSufficient) criticalGaps.push('Insufficient water');
      if (!data.hasCleanWaterAccess) criticalGaps.push('No clean water access');
      if (data.functionalLatrinesAvailable === 0) criticalGaps.push('No functional latrines');
      if (!data.hasHandwashingFacilities) criticalGaps.push('No handwashing facilities');

      totalScore = [
        data.isWaterSufficient ? 25 : 0,
        data.hasCleanWaterAccess ? 25 : 0,
        data.functionalLatrinesAvailable > 0 ? 25 : 0,
        data.hasHandwashingFacilities ? 25 : 0
      ].reduce((a, b) => a + b, 0);
      scoreCount = 1;
      break;

    case 'SHELTER':
      keyMetrics.areSufficient = data.areSheltersSufficient || false;
      keyMetrics.hasSafeStructures = data.hasSafeStructures || false;
      keyMetrics.numberRequired = data.numberSheltersRequired || 0;
      keyMetrics.areOvercrowded = data.areOvercrowded || false;
      keyMetrics.weatherProtection = data.provideWeatherProtection || false;

      if (!data.areSheltersSufficient) criticalGaps.push('Insufficient shelters');
      if (!data.hasSafeStructures) criticalGaps.push('No safe structures');
      if (data.numberSheltersRequired > 0) criticalGaps.push(`${data.numberSheltersRequired} shelters required`);
      if (data.areOvercrowded) criticalGaps.push('Overcrowded shelters');

      totalScore = [
        data.areSheltersSufficient ? 25 : 0,
        data.hasSafeStructures ? 25 : 0,
        data.numberSheltersRequired === 0 ? 25 : 0,
        !data.areOvercrowded ? 25 : 0
      ].reduce((a, b) => a + b, 0);
      scoreCount = 1;
      break;

    case 'SECURITY':
      keyMetrics.isSafe = data.isSafeFromViolence || false;
      keyMetrics.hasPresence = data.hasSecurityPresence || false;
      keyMetrics.hasReporting = data.hasProtectionReportingMechanism || false;
      keyMetrics.vulnerableAccess = data.vulnerableGroupsHaveAccess || false;
      keyMetrics.hasLighting = data.hasLighting || false;

      if (!data.isSafeFromViolence) criticalGaps.push('Safety concerns');
      if (!data.hasSecurityPresence) criticalGaps.push('No security presence');
      if (!data.hasProtectionReportingMechanism) criticalGaps.push('No protection reporting mechanism');

      totalScore = [
        data.isSafeFromViolence ? 25 : 0,
        data.hasSecurityPresence ? 25 : 0,
        data.hasProtectionReportingMechanism ? 25 : 0,
        data.vulnerableGroupsHaveAccess ? 25 : 0
      ].reduce((a, b) => a + b, 0);
      scoreCount = 1;
      break;

    case 'POPULATION':
      keyMetrics.totalPopulation = data.totalPopulation || 0;
      keyMetrics.totalHouseholds = data.totalHouseholds || 0;
      keyMetrics.vulnerableCount = (
        (data.populationUnder5 || 0) +
        (data.pregnantWomen || 0) +
        (data.personWithDisability || 0) +
        (data.elderlyPersons || 0)
      );
      keyMetrics.livesLost = data.numberLivesLost || 0;
      keyMetrics.injured = data.numberInjured || 0;

      if (data.numberLivesLost > 0) criticalGaps.push(`${data.numberLivesLost} lives lost`);
      if (data.numberInjured > 0) criticalGaps.push(`${data.numberInjured} injured persons`);
      if (keyMetrics.vulnerableCount > data.totalPopulation * 0.3) criticalGaps.push('High vulnerable population ratio');

      totalScore = 100; // Population assessments are data collection, not scored
      scoreCount = 1;
      break;
  }

  const overallScore = scoreCount > 0 ? totalScore : undefined;

  return {
    overallScore,
    criticalGaps,
    keyMetrics
  };
}