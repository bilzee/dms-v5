import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/client';
import { 
  ExportRequestSchema, 
  ExportResponseSchema
} from '@/lib/validation/entity-insights';
import { generateEntityReport, Entity as ExportEntity } from '@/lib/services/assessment-export.service';
import { handleApiError } from '@/lib/api/response'

interface RouteParams {
  params: { id: string }
}

export const POST = withAuth(async (request: NextRequest, context, { params }: RouteParams) => {
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

    // Parse and validate request body
    const body = await request.json();
    const validationResult = ExportRequestSchema.safeParse(body);
    
    if (!validationResult.success) {
      return NextResponse.json(
        { success: false, error: 'Invalid request body', details: validationResult.error.errors },
        { status: 400 }
      );
    }

    const exportRequest = validationResult.data;

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
              where: { verificationStatus: 'VERIFIED' },
              select: {
                id: true,
                rapidAssessmentType: true,
                rapidAssessmentDate: true,
                verificationStatus: true,
                answers: true,
                assessor: {
                  select: {
                    name: true,
                    organization: true
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

    // Generate the report
    const reportData = await generateEntityReport(
      entityId,
      entityAssignment.entity as unknown as ExportEntity,
      exportRequest
    );

    // Create secure download link (in production, this would be a signed URL)
    const downloadId = crypto.randomUUID();
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24); // Expires in 24 hours

    // In a real implementation, you would store the file and generate a secure URL
    // For now, we'll return a data URL or placeholder
    const downloadUrl = `/api/v1/donors/entities/${entityId}/reports/download/${downloadId}`;

    const responseData = {
      downloadUrl,
      expiresAt,
      fileSize: reportData.fileSize,
      format: exportRequest.format,
      metadata: {
        entityId: entityId,
        generatedAt: new Date(),
        categories: exportRequest.categories,
        timeframe: exportRequest.timeframe || 'all',
        includeCharts: exportRequest.includeCharts,
        includeGapAnalysis: exportRequest.includeGapAnalysis,
        includeTrends: exportRequest.includeTrends
      }
    };

    // Validate response against schema
    const validatedResponse = ExportResponseSchema.safeParse({ success: true, data: responseData });
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
    console.error('Export API error:', error);
    return handleApiError(error);
  }
});