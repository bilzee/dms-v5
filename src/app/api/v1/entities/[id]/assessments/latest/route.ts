/**
 * API Route: GET /api/v1/entities/[id]/assessments/latest
 * 
 * Gets latest assessments by type for a specific entity.
 * Available for coordinators and admins to view assessment details.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/client';
import { AssessmentType } from '@prisma/client';
import { z } from 'zod';
import { fromAnswers, RapidAssessmentAnswers } from '@/lib/questions/answers';
import { handleApiError } from '@/lib/api/response'

interface RouteParams {
  params: { id: string }
}

// Assessment type schema
const AssessmentTypeSchema = z.enum(['HEALTH', 'WASH', 'SHELTER', 'FOOD', 'SECURITY', 'POPULATION']);

export const GET = withAuth(async (request: NextRequest, context, { params }: RouteParams) => {
  try {
    // Authorization check - only coordinators and admins can access assessments
    if (!context.roles.includes('COORDINATOR') && !context.roles.includes('ADMIN')) {
      return NextResponse.json(
        { success: false, error: 'Insufficient permissions. Coordinator or Admin role required.' },
        { status: 403 }
      );
    }

    const entityId = params.id;

    // Validate entity ID format
    if (!entityId || typeof entityId !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Valid entity ID is required' },
        { status: 400 }
      );
    }

    // Verify entity exists
    const entity = await prisma.entity.findUnique({
      where: { id: entityId },
      select: {
        id: true,
        name: true,
        type: true,
      }
    });

    if (!entity) {
      return NextResponse.json(
        { success: false, error: 'Entity not found' },
        { status: 404 }
      );
    }

    // Get latest assessment for each category
    const latestAssessments = await Promise.all(
      AssessmentTypeSchema.options.map(async (type) => {
        const latestAssessment = await prisma.rapidAssessment.findFirst({
          where: {
            entityId: entityId,
            rapidAssessmentType: type,
            verificationStatus: 'VERIFIED' // Only show verified assessments
          },
          select: {
            id: true,
            rapidAssessmentType: true,
            rapidAssessmentDate: true,
            verificationStatus: true,
            priority: true,
            location: true,
            answers: true,
            assessor: {
              select: {
                id: true,
                name: true,
                organization: true
              }
            },
            incident: {
              select: {
                id: true,
                type: true,
                description: true,
                severity: true,
                status: true
              }
            }
          },
          orderBy: { rapidAssessmentDate: 'desc' }
        });

        if (!latestAssessment) {
          return null;
        }

        // Hydrate the legacy typed payload from the canonical answers map
        const typeSpecificData = fromAnswers(
          type,
          (latestAssessment.answers ?? {}) as RapidAssessmentAnswers
        );

        // Calculate assessment summary and gap analysis
        const summary = await calculateAssessmentSummary(type, typeSpecificData);

        return {
          type: latestAssessment.rapidAssessmentType,
          assessment: {
            id: latestAssessment.id,
            type: latestAssessment.rapidAssessmentType,
            date: latestAssessment.rapidAssessmentDate,
            status: latestAssessment.verificationStatus,
            priority: latestAssessment.priority,
            location: latestAssessment.location,
            data: typeSpecificData,
            assessor: latestAssessment.assessor,
            incident: latestAssessment.incident,
            summary
          }
        };
      })
    );

    // Filter out null values (categories with no assessments)
    const validAssessments = latestAssessments.filter(assessment => assessment !== null);

    const responseData = {
      entityId: entityId,
      entity: entity,
      latestAssessments: validAssessments,
      lastUpdated: new Date()
    };

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
    console.error('Latest assessments API error:', error);
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
      scoreCount = 5;
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
      scoreCount = 3;
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
      scoreCount = 4;
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
      scoreCount = 4;
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
      scoreCount = 4;
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

  const overallScore = scoreCount > 0 ? Math.round((totalScore / scoreCount) * 100) / 100 : undefined;

  return {
    overallScore,
    criticalGaps,
    keyMetrics
  };
}