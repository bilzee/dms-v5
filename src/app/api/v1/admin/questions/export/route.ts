import { withAuth } from '@/lib/auth/middleware'
import { successResponse, errorResponse, handleApiError } from '@/lib/api/response'
import { QuestionRegistryService } from '@/lib/services/question-registry.service'

/**
 * GET /api/v1/admin/questions/export — ADMIN only.
 * Full-registry JSON document (schemaVersion, generatedAt, per-type versions
 * and all sections/questions incl. inactive rows) for download/backup.
 */
export const GET = withAuth(async (_request, context) => {
  if (!context.roles.includes('ADMIN')) {
    return errorResponse('Insufficient permissions. Admin role required.', 403)
  }

  try {
    const document = await QuestionRegistryService.exportRegistry()
    return successResponse(document)
  } catch (error) {
    return handleApiError(error)
  }
})
