import { NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { withAuth, AuthContext } from '@/lib/auth/middleware'
import { RapidAssessmentService } from '@/lib/services/rapid-assessment.service'
import { UpdateRapidAssessmentSchema, findLegacySectorPayloadKey } from '@/lib/validation/rapid-assessment'
import { RapidAssessmentResponse, RapidAssessmentWithData } from '@/types/rapid-assessment'
import { handleApiError, errorResponse } from '@/lib/api/response'

interface RouteParams {
  params: { id: string }
}

export const GET = withAuth(
  async (request: NextRequest, context: AuthContext, { params }: RouteParams) => {
    try {
      // RBAC: ASSESSOR (own), COORDINATOR, ADMIN (any)
      if (!context.roles.some(r => ['ASSESSOR', 'COORDINATOR', 'ADMIN'].includes(r))) {
        return NextResponse.json(
          {
            error: 'Insufficient permissions to view assessments',
            meta: {
              timestamp: new Date().toISOString(),
              version: '1.0.0',
              requestId: uuidv4()
            }
          },
          { status: 403 }
        )
      }

      const { id } = params
      
      const assessment = await RapidAssessmentService.findById(id)
      
      if (!assessment) {
        return NextResponse.json(
          {
            error: 'Assessment not found',
            meta: {
              timestamp: new Date().toISOString(),
              version: '1.0.0',
              requestId: uuidv4()
            }
          },
          { status: 404 }
        )
      }

      // Check if user has permission to view this assessment
      // COORDINATOR and ADMIN can view any assessment
      const isPrivileged = context.roles.some(r => ['COORDINATOR', 'ADMIN'].includes(r))
      if (!isPrivileged && assessment.assessorId !== context.userId) {
        return NextResponse.json(
          {
            error: 'Not authorized to view this assessment',
            meta: {
              timestamp: new Date().toISOString(),
              version: '1.0.0',
              requestId: uuidv4()
            }
          },
          { status: 403 }
        )
      }

      const response: RapidAssessmentResponse = {
        success: true as const,
        data: assessment as unknown as RapidAssessmentWithData,
        meta: {
          timestamp: new Date().toISOString(),
          version: '1.0.0',
          requestId: uuidv4()
        }
      }

      return NextResponse.json(response, { status: 200 })
    } catch (error) {
      return handleApiError(error)
    }
  }
)

export const PUT = withAuth(
  async (request: NextRequest, context: AuthContext, { params }: RouteParams) => {
    try {
      // RBAC: ASSESSOR (own), COORDINATOR, ADMIN
      if (!context.roles.some(r => ['ASSESSOR', 'COORDINATOR', 'ADMIN'].includes(r))) {
        return NextResponse.json(
          {
            error: 'Insufficient permissions to update assessments',
            meta: {
              timestamp: new Date().toISOString(),
              version: '1.0.0',
              requestId: uuidv4()
            }
          },
          { status: 403 }
        )
      }

      const { id } = params
      const body = await request.json()
      const legacyKey = findLegacySectorPayloadKey(body)
      if (legacyKey) {
        return errorResponse(
          `Legacy typed payloads are no longer accepted: "${legacyKey}" was removed with the hardcoded forms. Submit the registry-keyed "answers" map instead.`,
          422
        )
      }
      const input = UpdateRapidAssessmentSchema.parse(body)
      
      const assessment = await RapidAssessmentService.update(
        id,
        input,
        context.userId
      )

      const response: RapidAssessmentResponse = {
        success: true as const,
        data: assessment as unknown as RapidAssessmentWithData,
        meta: {
          timestamp: new Date().toISOString(),
          version: '1.0.0',
          requestId: uuidv4()
        }
      }

      return NextResponse.json(response, { status: 200 })
    } catch (error) {
      console.error('Update rapid assessment error:', error)
      
      if (error instanceof Error && error.message.includes('not found')) {
        return NextResponse.json(
          {
            error: error.message,
            meta: {
              timestamp: new Date().toISOString(),
              version: '1.0.0',
              requestId: uuidv4()
            }
          },
          { status: 404 }
        )
      }
      
      if (error instanceof Error && error.message.includes('authorized')) {
        return NextResponse.json(
          {
            error: error.message,
            meta: {
              timestamp: new Date().toISOString(),
              version: '1.0.0',
              requestId: uuidv4()
            }
          },
          { status: 403 }
        )
      }
      return handleApiError(error)
    }
  }
)

export const DELETE = withAuth(
  async (request: NextRequest, context: AuthContext, { params }: RouteParams) => {
    try {
      // RBAC: Only COORDINATOR and ADMIN can delete assessments
      if (!context.roles.some(r => ['COORDINATOR', 'ADMIN'].includes(r))) {
        return NextResponse.json(
          {
            error: 'Insufficient permissions to delete assessments',
            meta: {
              timestamp: new Date().toISOString(),
              version: '1.0.0',
              requestId: uuidv4()
            }
          },
          { status: 403 }
        )
      }

      const { id } = params
      
      await RapidAssessmentService.delete(id, context.userId)

      return NextResponse.json(
        {
          success: true,
          message: 'Assessment deleted successfully',
          meta: {
            timestamp: new Date().toISOString(),
            version: '1.0.0',
            requestId: uuidv4()
          }
        },
        { status: 200 }
      )
    } catch (error) {
      console.error('Delete rapid assessment error:', error)
      
      if (error instanceof Error && error.message.includes('not found')) {
        return NextResponse.json(
          {
            error: error.message,
            meta: {
              timestamp: new Date().toISOString(),
              version: '1.0.0',
              requestId: uuidv4()
            }
          },
          { status: 404 }
        )
      }
      
      if (error instanceof Error && error.message.includes('authorized')) {
        return NextResponse.json(
          {
            error: error.message,
            meta: {
              timestamp: new Date().toISOString(),
              version: '1.0.0',
              requestId: uuidv4()
            }
          },
          { status: 403 }
        )
      }
      return handleApiError(error)
    }
  }
)
