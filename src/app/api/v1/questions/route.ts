import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/auth/middleware'
import { successResponse, errorResponse, handleApiError } from '@/lib/api/response'
import { QuestionRegistryService } from '@/lib/services/question-registry.service'

/**
 * GET /api/v1/questions?assessmentType=HEALTH[&includeInactive=1]
 *
 * The assessor-facing read surface: active sections (with nested questions)
 * in presentation order plus the type's structureVersion/contentVersion.
 * `includeInactive=1` (admin editor) additionally returns inactive rows and
 * requires the ADMIN role.
 */
export const GET = withAuth(async (request: NextRequest, context) => {
  const url = new URL(request.url)
  const assessmentType = url.searchParams.get('assessmentType')
  if (!assessmentType) {
    return errorResponse('assessmentType query parameter is required', 400)
  }
  const includeInactive = url.searchParams.get('includeInactive') === '1'

  if (includeInactive && !context.roles.includes('ADMIN')) {
    return errorResponse('Insufficient permissions. Admin role required to view inactive registry rows.', 403)
  }

  try {
    const questionSet = await QuestionRegistryService.getQuestionSet(assessmentType, { includeInactive })
    return successResponse({
      sections: questionSet.sections,
      structureVersion: questionSet.structureVersion,
      contentVersion: questionSet.contentVersion,
    })
  } catch (error) {
    return handleApiError(error)
  }
})
