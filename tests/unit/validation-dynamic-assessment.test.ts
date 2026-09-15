import {
  buildAssessmentSchema,
  buildQuestionFieldSchema,
  QuestionOptionSchema,
  TEXT_LONG_MAX_LENGTH,
  DynamicQuestionDef,
} from '@/lib/validation/dynamic-assessment'

/**
 * Unit — buildAssessmentSchema compilation matrix.
 *
 * Pure zod: one block per questionType asserting accept/reject behavior,
 * plus the required/optional enforcement and the multi-section key
 * flattening. No DB, no Prisma.
 */

function question(overrides: Partial<DynamicQuestionDef> & { key: string }): DynamicQuestionDef {
  return {
    questionType: 'BOOLEAN',
    required: false,
    ...overrides,
  }
}

describe('buildQuestionFieldSchema', () => {
  describe('BOOLEAN', () => {
    const schema = buildQuestionFieldSchema(question({ key: 'q', questionType: 'BOOLEAN', required: true }))

    it('accepts true and false', () => {
      expect(schema.safeParse(true).success).toBe(true)
      expect(schema.safeParse(false).success).toBe(true)
    })

    it('rejects truthy non-booleans', () => {
      expect(schema.safeParse('true').success).toBe(false)
      expect(schema.safeParse(1).success).toBe(false)
      expect(schema.safeParse(undefined).success).toBe(false)
    })
  })

  describe('SINGLE_CHOICE', () => {
    const schema = buildQuestionFieldSchema(
      question({
        key: 'q',
        questionType: 'SINGLE_CHOICE',
        required: true,
        options: [
          { value: 'NONE', label: 'None' },
          { value: 'PARTIAL', label: 'Partial' },
          { value: 'FULL', label: 'Full' },
        ],
      })
    )

    it('accepts a listed option value', () => {
      expect(schema.safeParse('PARTIAL').success).toBe(true)
    })

    it('rejects values outside the option set (enum semantics)', () => {
      const result = schema.safeParse('SOMETIMES')
      expect(result.success).toBe(false)
    })

    it('falls back to plain string when the question has no options', () => {
      const noOptions = buildQuestionFieldSchema(
        question({ key: 'q', questionType: 'SINGLE_CHOICE', required: true, options: null })
      )
      expect(noOptions.safeParse('ANY_FREE_TEXT').success).toBe(true)
    })
  })

  describe('MULTI_SELECT', () => {
    const schema = buildQuestionFieldSchema(
      question({
        key: 'q',
        questionType: 'MULTI_SELECT',
        required: true,
        options: [
          { value: 'BOREHOLE', label: 'Borehole' },
          { value: 'WELL', label: 'Well' },
          { value: 'TRUCKED', label: 'Trucked' },
        ],
      })
    )

    it('accepts a subset of the option values', () => {
      expect(schema.safeParse(['BOREHOLE', 'TRUCKED']).success).toBe(true)
      expect(schema.safeParse([]).success).toBe(true)
    })

    it('rejects arrays containing unknown values', () => {
      expect(schema.safeParse(['BOREHOLE', 'RIVER']).success).toBe(false)
    })

    it('rejects non-array values', () => {
      expect(schema.safeParse('BOREHOLE').success).toBe(false)
    })
  })

  describe('NUMBER', () => {
    const schema = buildQuestionFieldSchema(
      question({ key: 'q', questionType: 'NUMBER', required: true, numberMin: 0, numberMax: 100 })
    )

    it('accepts values within the bounds', () => {
      expect(schema.safeParse(0).success).toBe(true)
      expect(schema.safeParse(50).success).toBe(true)
      expect(schema.safeParse(100).success).toBe(true)
    })

    it('rejects values outside numberMin/numberMax', () => {
      expect(schema.safeParse(-1).success).toBe(false)
      expect(schema.safeParse(101).success).toBe(false)
    })

    it('rejects non-numbers', () => {
      expect(schema.safeParse('50').success).toBe(false)
    })

    it('is unbounded when numberMin/numberMax are absent', () => {
      const unbounded = buildQuestionFieldSchema(
        question({ key: 'q', questionType: 'NUMBER', required: true, numberMin: null, numberMax: null })
      )
      expect(unbounded.safeParse(1_000_000).success).toBe(true)
      expect(unbounded.safeParse(-1_000_000).success).toBe(true)
    })
  })

  describe('TEXT_LONG', () => {
    const schema = buildQuestionFieldSchema(question({ key: 'q', questionType: 'TEXT_LONG', required: true }))

    it('accepts non-empty strings up to the max length', () => {
      expect(schema.safeParse('ok').success).toBe(true)
      expect(schema.safeParse('x'.repeat(TEXT_LONG_MAX_LENGTH)).success).toBe(true)
    })

    it('rejects empty strings and strings past the max length', () => {
      expect(schema.safeParse('').success).toBe(false)
      expect(schema.safeParse('x'.repeat(TEXT_LONG_MAX_LENGTH + 1)).success).toBe(false)
    })
  })

  describe('required enforcement', () => {
    it('required questions reject undefined', () => {
      const schema = buildQuestionFieldSchema(question({ key: 'q', questionType: 'BOOLEAN', required: true }))
      expect(schema.safeParse(undefined).success).toBe(false)
    })

    it('optional questions accept undefined', () => {
      const schema = buildQuestionFieldSchema(question({ key: 'q', questionType: 'BOOLEAN', required: false }))
      expect(schema.safeParse(undefined).success).toBe(true)
    })
  })
})

describe('buildAssessmentSchema', () => {
  const schema = buildAssessmentSchema({
    sections: [
      {
        questions: [
          question({ key: 'health.facilityFunctional', questionType: 'BOOLEAN', required: true }),
          question({
            key: 'health.facilityType',
            questionType: 'SINGLE_CHOICE',
            required: true,
            options: [
              { value: 'CLINIC', label: 'Clinic' },
              { value: 'HOSPITAL', label: 'Hospital' },
            ],
          }),
        ],
      },
      {
        questions: [
          question({ key: 'context.notes', questionType: 'TEXT_LONG', required: false }),
          question({ key: 'population.count', questionType: 'NUMBER', required: false, numberMin: 0 }),
        ],
      },
    ],
  })

  it('flattens every section into one keyed object schema', () => {
    const parsed = schema.parse({
      'health.facilityFunctional': true,
      'health.facilityType': 'CLINIC',
      'population.count': 42,
    })
    expect(parsed['population.count']).toBe(42)
    expect(parsed['context.notes']).toBeUndefined()
  })

  it('passes when only required keys are answered (optionals may be omitted)', () => {
    const result = schema.safeParse({
      'health.facilityFunctional': false,
      'health.facilityType': 'HOSPITAL',
    })
    expect(result.success).toBe(true)
  })

  it('fails when a required key is missing', () => {
    const result = schema.safeParse({
      'health.facilityType': 'CLINIC',
    })
    expect(result.success).toBe(false)
  })

  it('fails when any single question violates its compiled rule', () => {
    const result = schema.safeParse({
      'health.facilityFunctional': true,
      'health.facilityType': 'CLINIC',
      'population.count': -5,
    })
    expect(result.success).toBe(false)
  })

  it('compiles an empty registry to a permissive object', () => {
    const empty = buildAssessmentSchema({ sections: [] })
    expect(empty.safeParse({}).success).toBe(true)
  })
})

describe('QuestionOptionSchema', () => {
  it('accepts a well-formed option and rejects missing/empty value or label', () => {
    expect(QuestionOptionSchema.safeParse({ value: 'A', label: 'Alpha' }).success).toBe(true)
    expect(QuestionOptionSchema.safeParse({ value: 'A', label: 'Alpha', description: 'd' }).success).toBe(true)
    expect(QuestionOptionSchema.safeParse({ value: '', label: 'Alpha' }).success).toBe(false)
    expect(QuestionOptionSchema.safeParse({ value: 'A' }).success).toBe(false)
    expect(QuestionOptionSchema.safeParse({ label: 'Alpha' }).success).toBe(false)
  })
})
