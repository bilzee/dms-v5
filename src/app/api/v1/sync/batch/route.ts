import { NextRequest } from 'next/server';
import { z } from 'zod';
import { withAuth, AuthContext } from '@/lib/auth/middleware';
import { entityAssignmentService } from '@/lib/services/entity-assignment.service';
import { SyncProcessingService } from '@/lib/services/sync-processing.service';
import { successResponse, errorResponse, handleApiError } from '@/lib/api/response';

const SyncChangeSchema = z.object({
  type: z.enum(['assessment', 'response', 'entity']),
  action: z.enum(['create', 'update', 'delete']),
  data: z.record(z.unknown()),
  offlineId: z.string().optional(),
  versionNumber: z.number().int().positive(),
  entityUuid: z.string().min(1)
});

const BatchSyncRequestSchema = z.object({
  changes: z.array(SyncChangeSchema).min(1).max(100)
});

export const POST = withAuth(async (
  request: NextRequest,
  context: AuthContext
) => {
  try {
    const assignedEntities = await entityAssignmentService.getAssignedEntities(context.userId);
    const entityIds = new Set(assignedEntities.map(entity => entity.id));

    const body = await request.json();
    const validationResult = BatchSyncRequestSchema.safeParse(body);

    if (!validationResult.success) {
      return errorResponse('Invalid request format', 400, validationResult.error.issues);
    }

    const { changes } = validationResult.data;

    // P10-4 (4c) — assessment updates key their entityUuid slot by the
    // assessment ROW id (the consumer resolves rows by it), so the entity-uuid
    // gate cannot authorize them here. Authorization is enforced per-entry
    // downstream: ownership in updateOfflineAssessment, re-point targets via
    // assertAssignmentForTargets → per-entry conflict (never-reject).
    const unauthorizedEntities = changes
      .filter(change => change.type !== 'assessment' || change.action !== 'update')
      .filter(change => !entityIds.has(change.entityUuid))
      .map(change => change.entityUuid);

    if (unauthorizedEntities.length > 0) {
      const unique = [...new Set(unauthorizedEntities)];
      return errorResponse(
        'Entity permission denied',
        403,
        { unauthorizedEntities: unique }
      );
    }

    const results = await SyncProcessingService.processBatch(changes, context.userId);

    // P5: the contract is unchanged except that assessment results may now
    // carry a per-item `warnings` array (registry drift — the client surfaces
    // it and never unwinds the submission).
    const successful = results.filter(r => r.status === 'success');
    const conflicts = results.filter(r => r.status === 'conflict');
    const failed = results.filter(r => r.status === 'failed');

    return successResponse({
      results,
      summary: {
        totalProcessed: results.length,
        successful: successful.length,
        conflicts: conflicts.length,
        failed: failed.length
      }
    }, results.every(r => r.status === 'failed') ? 207 : 200);

  } catch (error) {
    return handleApiError(error);
  }
});
