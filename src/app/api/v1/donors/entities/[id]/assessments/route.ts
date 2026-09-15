import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/client';
import {
  EntityAssessmentsQuerySchema,
  EntityAssessmentsResponseSchema,
  AssessmentTypeSchema,
  VerificationStatusSchema
} from '@/lib/validation/entity-insights';
import { fromAnswers, RapidAssessmentAnswers, RapidAssessmentType } from '@/lib/questions/legacy-convert';
import { handleApiError } from '@/lib/api/response'

interface RouteParams {
  params: { id: string }
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
    const queryData = {
      category: searchParams.get('category'),
      status: searchParams.get('status'),
      limit: parseInt(searchParams.get('limit') || '50'),
      offset: parseInt(searchParams.get('offset') || '0'),
      startDate: searchParams.get('startDate'),
      endDate: searchParams.get('endDate')
    };

    const validationResult = EntityAssessmentsQuerySchema.safeParse(queryData);
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
          include: {
            rapidAssessments: {
              where: {
                ...(query.category && { rapidAssessmentType: query.category }),
                ...(query.status && { verificationStatus: query.status }),
                ...(query.startDate && { rapidAssessmentDate: { gte: new Date(query.startDate) } }),
                ...(query.endDate && { rapidAssessmentDate: { lte: new Date(query.endDate) } })
              },
              include: {
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
                    type: true
                  }
                }
              },
              orderBy: { rapidAssessmentDate: 'desc' }
            }
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

    const entity = entityAssignment.entity;
    const allAssessments = entity.rapidAssessments;

    // Get total count for pagination
    const totalCount = allAssessments.length;

    // Apply pagination
    const paginatedAssessments = allAssessments.slice(query.offset, query.offset + query.limit);

    // Process assessment data including type-specific data
    const processedAssessments = await Promise.all(
      paginatedAssessments.map(async (assessment) => {
        // Hydrate the legacy typed payload from the canonical answers map
        const typeSpecificData = fromAnswers(
          assessment.rapidAssessmentType as RapidAssessmentType,
          (assessment.answers ?? {}) as RapidAssessmentAnswers
        );

        return {
          id: assessment.id,
          type: assessment.rapidAssessmentType,
          date: assessment.rapidAssessmentDate,
          status: assessment.verificationStatus,
          data: {
            ...typeSpecificData,
            location: assessment.location,
            coordinates: assessment.coordinates,
            priority: assessment.priority,
            mediaAttachments: assessment.mediaAttachments
          },
          assessor: assessment.assessor,
          entity: assessment.entity
        };
      })
    );

    // Calculate summary statistics
    const categorySummaries = AssessmentTypeSchema.options.map(type => ({
      type,
      count: allAssessments.filter(a => a.rapidAssessmentType === type).length,
      latestDate: allAssessments
        .filter(a => a.rapidAssessmentType === type)
        .sort((a, b) => b.rapidAssessmentDate.getTime() - a.rapidAssessmentDate.getTime())[0]?.rapidAssessmentDate
    }));

    const responseData = {
      entity: {
        id: entity.id,
        name: entity.name,
        type: entity.type,
        location: entity.location,
        coordinates: entity.coordinates,
        demographics: entity.metadata as any, // Parse metadata for demographics
        isActive: entity.isActive,
        createdAt: entity.createdAt,
        updatedAt: entity.updatedAt
      },
      assessments: processedAssessments,
      pagination: {
        total: totalCount,
        limit: query.limit,
        offset: query.offset,
        hasMore: query.offset + query.limit < totalCount
      },
      summary: {
        totalAssessments: totalCount,
        verifiedAssessments: allAssessments.filter(a => a.verificationStatus === 'VERIFIED').length,
        categories: categorySummaries
      }
    };

    // Validate response against schema
    const validatedResponse = EntityAssessmentsResponseSchema.safeParse({ success: true, data: responseData });
    if (!validatedResponse.success) {
      console.error('Response validation error:', validatedResponse.error);
      // Continue with response even if validation fails, but log the error
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
    console.error('Entity assessments API error:', error);
    return handleApiError(error);
  }
});