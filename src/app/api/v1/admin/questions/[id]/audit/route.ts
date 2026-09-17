import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/auth/middleware'
import { successResponse, errorResponse, handleApiError } from '@/lib/api/response'
import { prisma } from '@/lib/db/client'

interface RouteParams {
  params: { id: string }
}

/**
 * GET /api/v1/admin/questions/[id]/audit — ADMIN only.
 *
 * Latest 50 `question_audit_logs` rows for the question (entityType QUESTION),
 * newest first, with the acting user's email/name. Read-only view for the
 * admin editor's audit timeline; writes still flow exclusively through the
 * governance-mutating routes.
 */
export const GET = withAuth(async (request: NextRequest, context, { params }: RouteParams) => {
  if (!context.roles.includes('ADMIN')) {
    return errorResponse('Insufficient permissions. Admin role required to view the question audit trail.', 403)
  }

  try {
    const entries = await prisma.questionAuditLog.findMany({
      where: { entityType: 'QUESTION', entityId: params.id },
      orderBy: { actedAt: 'desc' },
      take: 50,
      include: { actor: { select: { email: true, name: true } } },
    })
    return successResponse({ entries })
  } catch (error) {
    return handleApiError(error)
  }
})
