import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/client';
import { v4 as uuidv4 } from 'uuid';
import { fromAnswers, RapidAssessmentAnswers } from '@/lib/questions/answers';
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

    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search');
    const type = searchParams.get('type');
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');

    // Get entities assigned to this donor user
    const entityAssignments = await prisma.entityAssignment.findMany({
      where: {
        userId: userId
      },
      include: {
        entity: {
          include: {
            _count: {
              select: {
                rapidAssessments: true,
                responses: true,
                commitments: true
              }
            }
          }
        }
      },
      orderBy: { assignedAt: 'desc' }
    });

    // Extract entities and apply filters
    let entities = entityAssignments.map(ea => ea.entity);

    // Apply search filter
    if (search) {
      entities = entities.filter(entity =>
        entity.name.toLowerCase().includes(search.toLowerCase()) ||
        entity.type.toLowerCase().includes(search.toLowerCase()) ||
        entity.location?.toLowerCase().includes(search.toLowerCase())
      );
    }

    // Apply type filter
    if (type) {
      entities = entities.filter(entity => entity.type === type);
    }

    // Get total count for pagination
    const total = entities.length;

    // Apply pagination
    const paginatedEntities = entities.slice((page - 1) * limit, page * limit);

    // Get assessment and response data for each entity
    const entitiesWithDetails = await Promise.all(
      paginatedEntities.map(async (entity) => {
        const [assessments, responses, commitments, latestPopulationAssessment] = await Promise.all([
          prisma.rapidAssessment.count({
            where: { 
              entityId: entity.id,
              verificationStatus: 'VERIFIED'
            }
          }),
          prisma.rapidResponse.count({
            where: { 
              entityId: entity.id,
              planCommitments: { some: {} } // Has donor assigned through plan commitment
            }
          }),
          prisma.donorCommitment.count({
            where: { entityId: entity.id }
          }),
          prisma.rapidAssessment.findFirst({
            where: {
              entityId: entity.id,
              rapidAssessmentType: 'POPULATION',
              verificationStatus: 'VERIFIED'
            },
            select: {
              answers: true
            },
            orderBy: {
              rapidAssessmentDate: 'desc'
            }
          })
        ]);

        // Hydrate the legacy population payload from the canonical answers map
        const populationPayload = fromAnswers(
          'POPULATION',
          (latestPopulationAssessment?.answers ?? null) as RapidAssessmentAnswers | null
        );

        // Extract population data from latest population assessment
        const population = Number(populationPayload.totalPopulation || 0);

        return {
          ...entity,
          demographics: {
            population: population,
            vulnerableCount: Number(populationPayload.pregnantWomen || 0) + 
                           Number(populationPayload.populationUnder5 || 0) + 
                           Number(populationPayload.personWithDisability || 0) + 
                           Number(populationPayload.elderlyPersons || 0),
            lga: (entity.metadata as any)?.lga || null,
            ward: (entity.metadata as any)?.ward || null,
            campDetails: entity.type === 'CAMP' ? entity.metadata : null,
            communityDetails: entity.type === 'COMMUNITY' ? entity.metadata : null,
            facilityDetails: entity.type === 'FACILITY' ? entity.metadata : null
          },
          stats: {
            verifiedAssessments: assessments,
            responses: responses,
            commitments: commitments
          }
        };
      })
    );

    return NextResponse.json({
      success: true,
      data: {
        entities: entitiesWithDetails,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
          hasNext: page * limit < total,
          hasPrev: page > 1
        },
        summary: {
          totalAssigned: entityAssignments.length,
          totalWithResponses: entityAssignments.filter(ea => 
            ea.entity._count.responses > 0
          ).length,
          totalWithCommitments: entityAssignments.filter(ea => 
            ea.entity._count.commitments > 0
          ).length
        }
      },
      meta: {
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        requestId: uuidv4()
      }
    });

  } catch (error) {
    console.error('Donor entities error:', error);
    return handleApiError(error);
  }
});