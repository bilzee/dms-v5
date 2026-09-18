/**
 * Validation schemas for the question-registry governance API (P2).
 *
 * The invariants that live in the DB/registry layer (GAP ⇒ BOOLEAN+required+
 * gap metadata, category-match with the section, ≥1 active GAP per non-
 * POPULATION type, ...) are deliberately NOT re-implemented here — they are
 * enforced transactionally by QuestionRegistryService.validateRegistryState,
 * which rejects invalid writes with 400 `registry_invalid` and rolls back.
 *
 * `questionKey` IS accepted by UpdateQuestionSchema so the API can reject a
 * rename explicitly with 400 `question_key_immutable` (the service enforces
 * it); it is never applied.
 */

import { z } from 'zod'
import { ASSESSMENT_TYPES, QUESTION_CATEGORIES, QUESTION_TYPES } from '@/lib/questions/registry-validation'
import { QuestionOptionSchema } from '@/lib/validation/dynamic-assessment'
import { CompareSchema, WhenSchema } from '@/lib/questions/rule-engine'

const AssessmentTypeSchema = z.enum(ASSESSMENT_TYPES)
const QuestionTypeSchema = z.enum(QUESTION_TYPES)
const QuestionCategorySchema = z.enum(QUESTION_CATEGORIES)
const SeveritySchema = z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'])
/** GAP severities only — LOW/UNCLASSIFIED are not valid GAP severities. */
const GapSeveritySchema = z.enum(['CRITICAL', 'HIGH', 'MEDIUM'])

const ReasonSchema = z.string().min(1).max(2000).optional()

/** camelCase question keys (matches the seeded catalog, e.g. hasFunctionalClinic). */
const QuestionKeySchema = z.string().regex(/^[a-zA-Z][a-zA-Z0-9]*$/, 'questionKey must be camelCase')

/** kebab-case section keys (matches the seeded catalog, e.g. health-gaps). */
const SectionKeySchema = z.string().regex(
  /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
  'sectionKey must be kebab-case'
)

export const CreateQuestionSchema = z.object({
  assessmentType: AssessmentTypeSchema,
  questionKey: QuestionKeySchema,
  sectionId: z.string().min(1),
  questionType: QuestionTypeSchema,
  label: z.string().min(1).max(500),
  helperText: z.string().max(1000).optional(),
  required: z.boolean().optional(),
  options: z.array(QuestionOptionSchema).optional(),
  category: QuestionCategorySchema,
  inverted: z.boolean().optional(),
  // Nullable = explicitly no GAP metadata (the editor sends null for CONTEXT
  // questions); the service treats null and undefined identically.
  gapLabel: z.string().min(1).nullable().optional(),
  gapMeaning: z.string().min(1).nullable().optional(),
  recommendation: z.string().min(1).nullable().optional(),
  severity: SeveritySchema.optional(),
  numberMin: z.number().int().nullable().optional(),
  numberMax: z.number().int().nullable().optional(),
  order: z.number().int().min(1).optional(),
  reason: ReasonSchema,
})

export const UpdateQuestionSchema = CreateQuestionSchema.omit({ assessmentType: true })
  .extend({
    // Nullable = explicit clear (needed when flipping GAP → CONTEXT).
    gapLabel: z.string().min(1).nullable().optional(),
    gapMeaning: z.string().min(1).nullable().optional(),
    recommendation: z.string().min(1).nullable().optional(),
    helperText: z.string().max(1000).nullable().optional(),
  })
  .partial()

export const SeverityPatchSchema = z.object({
  severity: GapSeveritySchema,
  reason: ReasonSchema,
})

export const CreateSectionSchema = z.object({
  assessmentType: AssessmentTypeSchema,
  sectionKey: SectionKeySchema,
  title: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  category: QuestionCategorySchema,
  order: z.number().int().min(1).optional(),
  reason: ReasonSchema,
})

export const UpdateSectionSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).nullable().optional(),
  category: QuestionCategorySchema.optional(),
  order: z.number().int().min(1).optional(),
  reason: ReasonSchema,
})

/**
 * Both branches are strict so a mixed payload (sectionIds AND sectionId/
 * questionIds) matches neither side and fails with 400 instead of being
 * silently reinterpreted as a section reorder via zod key stripping.
 */
export const ReorderSchema = z.union([
  z.object({
    sectionIds: z.array(z.string().min(1)).min(1),
    reason: ReasonSchema,
  }).strict(),
  z.object({
    sectionId: z.string().min(1),
    questionIds: z.array(z.string().min(1)).min(1),
    reason: ReasonSchema,
  }).strict(),
])

export type CreateQuestionInput = z.infer<typeof CreateQuestionSchema>
export type UpdateQuestionInput = z.infer<typeof UpdateQuestionSchema>
export type SeverityPatchInput = z.infer<typeof SeverityPatchSchema>
export type CreateSectionInput = z.infer<typeof CreateSectionSchema>
export type UpdateSectionInput = z.infer<typeof UpdateSectionSchema>
export type ReorderInput = z.infer<typeof ReorderSchema>

// ---------------------------------------------------------------------------
// Cross-field rule schemas (P10-2). The AST fields reuse the engine's shared
// zod grammar so the admin API boundary and the evaluator can never disagree;
// the registry-level invariants (referenceKeys ⊆ active questions of the
// type, ruleKey immutability, reason governance) are enforced by
// QuestionRegistryService.
// ---------------------------------------------------------------------------

/** kebab-case rule keys (matches the seeded baseline, e.g. population-gender-sum-exceeds-total). */
const RuleKeySchema = z.string().regex(
  /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
  'ruleKey must be kebab-case'
)

const RuleKindSchema = z.enum(['REFINEMENT', 'AGGREGATE'])

export const CreateRuleSchema = z.object({
  assessmentType: AssessmentTypeSchema,
  ruleKey: RuleKeySchema,
  kind: RuleKindSchema,
  name: z.string().min(1).max(200),
  message: z.string().min(1).max(1000),
  // Nullable = explicitly no gate; undefined = field omitted.
  when: WhenSchema.nullable().optional(),
  expression: CompareSchema,
  referenceKeys: z.array(z.string().min(1)).min(1),
  order: z.number().int().min(1).optional(),
  reason: ReasonSchema,
})

export const UpdateRuleSchema = CreateRuleSchema.omit({ assessmentType: true }).partial()

export type CreateRuleInput = z.infer<typeof CreateRuleSchema>
export type UpdateRuleInput = z.infer<typeof UpdateRuleSchema>
