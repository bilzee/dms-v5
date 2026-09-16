/**
 * Rapid assessment transport validation (P4 — registry answers payloads).
 *
 * Create/update bodies carry the registry-keyed answers map directly:
 *
 *   { type, rapidAssessmentDate, assessorName, location?, coordinates?,
 *     mediaAttachments?, entityId, incidentId, answers }
 *
 * `answers` is `{ [questionKey]: boolean | number | string | string[] }`.
 * The transport schema only checks it is a JSON object — the per-question
 * contract is validated against the CURRENT registry snapshot via
 * `buildAssessmentSchema` at the service boundary, so unknown keys are
 * stripped and required questions are enforced for whatever the registry
 * contains at submit time. Cross-field rules are client-side only (Q2=B:
 * direct API calls bypass them — accepted parity loss). Priority is NEVER
 * accepted from the client — the server derives it from the gap engine.
 */

import { z } from 'zod'

export const AssessmentTypeEnum = z.enum(['HEALTH', 'WASH', 'SHELTER', 'FOOD', 'SECURITY', 'POPULATION'])

export type AssessmentTypeName = z.infer<typeof AssessmentTypeEnum>

// Base Rapid Assessment Schema (type-independent metadata)
const BaseRapidAssessmentSchema = z.object({
  rapidAssessmentDate: z.coerce.date(),
  assessorName: z.string().min(1, 'Assessor name is required'),
  location: z.string().optional(),
  coordinates: z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    accuracy: z.number().optional(),
    timestamp: z.coerce.date(),
    captureMethod: z.enum(['GPS', 'MANUAL'])
  }).optional(),
  mediaAttachments: z.array(z.string()).optional(),
  entityId: z.string().min(1, 'Entity is required'),
  incidentId: z.string().min(1, 'Incident is required')
})

/**
 * Create schema: type + full metadata + the raw answers map. The answers
 * themselves are compiled against the live registry in the service
 * (`buildAssessmentSchema`) — this layer deliberately stays shape-only so a
 * registry edit never requires a transport-schema change.
 */
export const CreateRapidAssessmentSchema = BaseRapidAssessmentSchema.extend({
  type: AssessmentTypeEnum,
  answers: z.record(z.unknown())
})

/**
 * Update schema: same payload, metadata fields optional (only `type` and the
 * replacement `answers` map are required — updates are full-answer replaces).
 * `verificationStatus` stays an accepted optional field so the rejected-edit
 * page can resubmit (SUBMITTED resets the rejection stamps in the service).
 */
export const UpdateRapidAssessmentSchema = BaseRapidAssessmentSchema.partial().extend({
  type: AssessmentTypeEnum,
  answers: z.record(z.unknown()),
  verificationStatus: z.enum(['DRAFT', 'SUBMITTED', 'VERIFIED', 'AUTO_VERIFIED', 'REJECTED']).optional()
})

/**
 * The six legacy typed transport keys (`healthData`, `populationData`, …) were
 * deleted with the hardcoded forms. A body that carries one of them WITHOUT an
 * `answers` map is a stale legacy client submission and is rejected with 422
 * (junk keys alongside a valid `answers` map are simply stripped by zod).
 */
export const LEGACY_SECTOR_PAYLOAD_KEYS = [
  'healthData',
  'populationData',
  'foodData',
  'washData',
  'shelterData',
  'securityData',
] as const

export function findLegacySectorPayloadKey(body: unknown): string | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  if ('answers' in body) return null
  return LEGACY_SECTOR_PAYLOAD_KEYS.find((key) => key in body) ?? null
}

// Query Schema (unchanged surface)
export const QueryRapidAssessmentSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  userId: z.string().optional(),
  entityId: z.string().optional(),
  incidentId: z.string().optional(),
  type: AssessmentTypeEnum.optional(),
  status: z.never().optional(),
  verificationStatus: z.enum(['DRAFT', 'SUBMITTED', 'VERIFIED', 'AUTO_VERIFIED', 'REJECTED']).optional(),
  priority: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']).optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional()
})

// Export Types
export type CreateRapidAssessmentInput = z.infer<typeof CreateRapidAssessmentSchema>
export type UpdateRapidAssessmentInput = z.infer<typeof UpdateRapidAssessmentSchema>
export type QueryRapidAssessmentInput = z.infer<typeof QueryRapidAssessmentSchema>
