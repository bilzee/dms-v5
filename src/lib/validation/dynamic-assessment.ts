/**
 * Dynamic assessment validation (P2 groundwork).
 *
 * `buildAssessmentSchema(questionSet)` compiles a registry question set
 * (sections → questions) into a zod object schema keyed by question key:
 *
 * - BOOLEAN            → z.boolean()
 * - SINGLE_CHOICE      → z.enum(option values)   (z.string() if no options)
 * - MULTI_SELECT       → z.array(z.enum(values))
 * - NUMBER             → z.number() bounded by numberMin/numberMax when set
 * - TEXT_LONG          → z.string().min(1).max(2000)
 *
 * Required questions are non-optional; everything else accepts `undefined`.
 * Pure function — no DB, no Prisma — so the (P3) submission route and the
 * offline sync layer can share it. `QuestionOptionSchema` is the shared
 * wire format for option objects (also used by the admin validation schemas).
 */

import { z } from 'zod'

export const QuestionOptionSchema = z.object({
  value: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
})

export type QuestionOptionInput = z.infer<typeof QuestionOptionSchema>

export const TEXT_LONG_MIN_LENGTH = 1
export const TEXT_LONG_MAX_LENGTH = 2000

/** Structural question shape the builder consumes (works with registry rows and snapshots). */
export interface DynamicQuestionDef {
  key: string
  questionType: string
  required: boolean
  options?: unknown
  numberMin?: number | null
  numberMax?: number | null
}

export interface DynamicQuestionSet {
  sections: Array<{ questions?: DynamicQuestionDef[] }>
}

function optionValues(options: unknown): string[] {
  if (!Array.isArray(options)) return []
  return options
    .filter(
      (option): option is { value: string } =>
        typeof option === 'object' && option !== null && typeof (option as { value?: unknown }).value === 'string'
    )
    .map((option) => option.value)
}

function asEnumTuple(values: string[]): [string, ...string[]] | null {
  return values.length > 0 ? (values as [string, ...string[]]) : null
}

/** Compiles the zod schema for one question definition. */
export function buildQuestionFieldSchema(question: DynamicQuestionDef): z.ZodTypeAny {
  let base: z.ZodTypeAny

  switch (question.questionType) {
    case 'BOOLEAN': {
      base = z.boolean()
      break
    }
    case 'SINGLE_CHOICE': {
      const tuple = asEnumTuple(optionValues(question.options))
      base = tuple ? z.enum(tuple) : z.string()
      break
    }
    case 'MULTI_SELECT': {
      const tuple = asEnumTuple(optionValues(question.options))
      base = z.array(tuple ? z.enum(tuple) : z.string())
      break
    }
    case 'NUMBER': {
      let numberSchema = z.number()
      if (typeof question.numberMin === 'number') {
        numberSchema = numberSchema.min(question.numberMin)
      }
      if (typeof question.numberMax === 'number') {
        numberSchema = numberSchema.max(question.numberMax)
      }
      base = numberSchema
      break
    }
    case 'TEXT_LONG':
    default: {
      base = z.string().min(TEXT_LONG_MIN_LENGTH).max(TEXT_LONG_MAX_LENGTH)
      break
    }
  }

  return question.required ? base : base.optional()
}

/** Compiles a `{ [questionKey]: value }` zod object schema from a registry question set. */
export function buildAssessmentSchema(questionSet: DynamicQuestionSet): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const shape: Record<string, z.ZodTypeAny> = {}
  for (const section of questionSet.sections ?? []) {
    for (const question of section.questions ?? []) {
      shape[question.key] = buildQuestionFieldSchema(question)
    }
  }
  return z.object(shape)
}
