import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/auth/middleware'
import { createdResponse, errorResponse, handleApiError } from '@/lib/api/response'
import { QuestionRegistryService } from '@/lib/services/question-registry.service'
import { CreateQuestionSchema } from '@/lib/validation/questions'

/**
 * POST /api/v1/admin/questions — ADMIN only.
 * Creates a registry question. Ungated by the freeze rule (a new key cannot
 * appear in any snapshot) but structurally validated in-transaction: an
 * invalid catalog (e.g. GAP question without gap metadata) rolls back with
 * 400 `registry_invalid`. `reason` is mandatory for this structural action.
 */
export const POST = withAuth(async (request: NextRequest, context) => {
  if (!context.roles.includes('ADMIN')) {
    return errorResponse('Insufficient permissions. Admin role required.', 403)
  }

  try {
    const body = await request.json()
    const { reason, ...input } = CreateQuestionSchema.parse(body)
    const question = await QuestionRegistryService.createQuestion(input, context.userId, reason)
    return createdResponse(question)
  } catch (error) {
    return handleApiError(error)
  }
})
