import {
  validateRegistry,
  QUESTION_CATALOG,
  EXPECTED_CATALOG_COUNTS,
  AssessmentTypeCatalog,
  QuestionDef,
} from '@/lib/questions/registry-validation'

/**
 * Unit — registry catalog invariants. One negative test per invariant: each
 * mutates a deep clone of the real catalog and asserts the exact violation
 * surfaces (and `valid` flips false). The seeded catalog itself must validate.
 */

/** Deep-clones the catalog, applies a mutation, returns the result. */
function mutated(mutate: (catalog: AssessmentTypeCatalog[]) => void): AssessmentTypeCatalog[] {
  const clone = JSON.parse(JSON.stringify(QUESTION_CATALOG)) as AssessmentTypeCatalog[]
  mutate(clone)
  return clone
}

function findQuestion(
  catalog: AssessmentTypeCatalog[],
  assessmentType: string,
  questionKey: string
): { question: QuestionDef; section: AssessmentTypeCatalog['sections'][number]; typeEntry: AssessmentTypeCatalog } {
  const typeEntry = catalog.find((entry) => entry.assessmentType === assessmentType)!
  for (const section of typeEntry.sections) {
    const question = section.questions.find((q) => q.questionKey === questionKey)
    if (question) return { question, section, typeEntry }
  }
  throw new Error(`question ${assessmentType}/${questionKey} not found`)
}

describe('unit — registry-validation: the real catalog validates', () => {
  test('QUESTION_CATALOG is valid with the expected counts', () => {
    const result = validateRegistry(QUESTION_CATALOG)
    expect(result.errors).toEqual([])
    expect(result.valid).toBe(true)
    expect(result.counts).toEqual({
      assessmentTypes: EXPECTED_CATALOG_COUNTS.assessmentTypes,
      sections: EXPECTED_CATALOG_COUNTS.sections,
      questions: EXPECTED_CATALOG_COUNTS.questions,
      gapQuestions: EXPECTED_CATALOG_COUNTS.gapQuestions,
      contextQuestions: EXPECTED_CATALOG_COUNTS.contextQuestions,
    })
  })

  test('an empty catalog is invalid', () => {
    const result = validateRegistry([])
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Catalog is empty')
  })
})

describe('unit — registry-validation negatives (one per invariant)', () => {
  test('duplicate assessment type in catalog', () => {
    const catalog = mutated((c) => c.push(JSON.parse(JSON.stringify(c[0]))))
    const result = validateRegistry(catalog)
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Duplicate assessment type in catalog: HEALTH')
  })

  test('unknown assessment type', () => {
    const catalog = mutated((c) => {
      c[0] = { ...c[0], assessmentType: 'LOGISTICS' as never }
    })
    const result = validateRegistry(catalog)
    expect(result.errors).toContain('Unknown assessment type: LOGISTICS')
  })

  test('type with no sections', () => {
    const catalog = mutated((c) => {
      c[0] = { ...c[0], sections: [] }
    })
    const result = validateRegistry(catalog)
    expect(result.errors).toContain('HEALTH: no sections defined')
  })

  test('duplicate question key within a type', () => {
    const catalog = mutated((c) => {
      const { question } = findQuestion(c, 'HEALTH', 'hasTrainedStaff')
      const services = c[0].sections.find((s) => s.sectionKey === 'services')!
      services.questions.push(JSON.parse(JSON.stringify(question)))
    })
    const result = validateRegistry(catalog)
    expect(result.errors).toContain('HEALTH: duplicate question key hasTrainedStaff')
  })

  test('question whose sectionKey mismatches the enclosing section', () => {
    const catalog = mutated((c) => {
      const { question } = findQuestion(c, 'HEALTH', 'hasTrainedStaff')
      question.sectionKey = 'facilities'
    })
    const result = validateRegistry(catalog)
    expect(result.errors).toContain(
      'HEALTH/hasTrainedStaff: sectionKey facilities does not match enclosing section services'
    )
  })

  test('question whose category mismatches the enclosing section category', () => {
    const catalog = mutated((c) => {
      const details = c[0].sections.find((s) => s.sectionKey === 'details')!
      details.category = 'GAP'
    })
    const result = validateRegistry(catalog)
    expect(result.errors).toContain(
      'HEALTH/numberHealthFacilities: category CONTEXT does not match section details category GAP'
    )
  })

  test('empty question label', () => {
    const catalog = mutated((c) => {
      const { question } = findQuestion(c, 'FOOD', 'isFoodSufficient')
      question.label = '  '
    })
    const result = validateRegistry(catalog)
    expect(result.errors).toContain('FOOD/isFoodSufficient: empty label')
  })

  test('choice question without options', () => {
    const catalog = mutated((c) => {
      const { question } = findQuestion(c, 'HEALTH', 'commonHealthIssues')
      question.options = []
    })
    const result = validateRegistry(catalog)
    expect(result.errors).toContain(
      'HEALTH/commonHealthIssues: MULTI_SELECT requires at least one option'
    )
  })

  test('option with an empty value', () => {
    const catalog = mutated((c) => {
      const { question } = findQuestion(c, 'HEALTH', 'commonHealthIssues')
      question.options![0] = { ...question.options![0], value: '' }
    })
    const result = validateRegistry(catalog)
    expect(result.errors).toContain('HEALTH/commonHealthIssues: option with empty value')
  })

  test('duplicate option value', () => {
    let duplicatedValue = ''
    const catalog = mutated((c) => {
      const { question } = findQuestion(c, 'HEALTH', 'commonHealthIssues')
      duplicatedValue = question.options![0].value
      question.options![1] = { ...question.options![1], value: duplicatedValue }
    })
    const result = validateRegistry(catalog)
    expect(result.errors).toContain(
      `HEALTH/commonHealthIssues: duplicate option value "${duplicatedValue}"`
    )
  })

  test('option with an empty label', () => {
    const catalog = mutated((c) => {
      const { question } = findQuestion(c, 'HEALTH', 'healthFacilityType')
      question.options![0] = { value: 'Clinic', label: '' }
    })
    const result = validateRegistry(catalog)
    expect(result.errors).toContain('HEALTH/healthFacilityType: option "Clinic" has empty label')
  })

  test('options on a non-choice question', () => {
    const catalog = mutated((c) => {
      const { question } = findQuestion(c, 'HEALTH', 'hasFunctionalClinic')
      ;(question as QuestionDef & { options?: never }).options = [
        { value: 'yes', label: 'Yes' },
      ] as never
    })
    const result = validateRegistry(catalog)
    expect(result.errors).toContain(
      'HEALTH/hasFunctionalClinic: options are only allowed on SINGLE_CHOICE/MULTI_SELECT questions'
    )
  })

  test('GAP question that is not BOOLEAN', () => {
    const catalog = mutated((c) => {
      const { question } = findQuestion(c, 'WASH', 'isWaterSufficient')
      question.questionType = 'NUMBER'
      question.numberMin = 0
    })
    const result = validateRegistry(catalog)
    expect(result.errors).toContain('WASH/isWaterSufficient: GAP questions must be BOOLEAN')
  })

  test('GAP question that is not required', () => {
    const catalog = mutated((c) => {
      const { question } = findQuestion(c, 'WASH', 'hasCleanWaterAccess')
      question.required = false
    })
    const result = validateRegistry(catalog)
    expect(result.errors).toContain('WASH/hasCleanWaterAccess: GAP questions must be required')
  })

  test('GAP question with severity LOW (must be CRITICAL/HIGH/MEDIUM)', () => {
    const catalog = mutated((c) => {
      const { question } = findQuestion(c, 'SECURITY', 'hasLighting')
      question.severity = 'LOW'
    })
    const result = validateRegistry(catalog)
    expect(result.errors).toContain(
      'SECURITY/hasLighting: GAP questions must set severity to CRITICAL, HIGH, or MEDIUM'
    )
  })

  test('GAP question missing gapLabel', () => {
    const catalog = mutated((c) => {
      const { question } = findQuestion(c, 'FOOD', 'isFoodSufficient')
      question.gapLabel = ''
    })
    const result = validateRegistry(catalog)
    expect(result.errors).toContain('FOOD/isFoodSufficient: GAP questions require gapLabel')
  })

  test('GAP question missing gapMeaning', () => {
    const catalog = mutated((c) => {
      const { question } = findQuestion(c, 'FOOD', 'hasRegularMealAccess')
      delete question.gapMeaning
    })
    const result = validateRegistry(catalog)
    expect(result.errors).toContain('FOOD/hasRegularMealAccess: GAP questions require gapMeaning')
  })

  test('GAP question missing recommendation', () => {
    const catalog = mutated((c) => {
      const { question } = findQuestion(c, 'SHELTER', 'areSheltersSufficient')
      question.recommendation = ' '
    })
    const result = validateRegistry(catalog)
    expect(result.errors).toContain('SHELTER/areSheltersSufficient: GAP questions require recommendation')
  })

  test('non-POPULATION type with no GAP questions', () => {
    const catalog = mutated((c) => {
      const security = c.find((entry) => entry.assessmentType === 'SECURITY')!
      for (const section of security.sections) {
        section.questions = section.questions.map((question) => {
          if (question.category !== 'GAP') return question
          question.category = 'CONTEXT'
          question.inverted = false
          question.severity = 'LOW'
          delete question.gapLabel
          delete question.gapMeaning
          delete question.recommendation
          return question
        })
      }
    })
    const result = validateRegistry(catalog)
    expect(result.valid).toBe(false)
    expect(result.errors).toContain(
      'SECURITY: must have at least one active GAP question (only POPULATION is context-only)'
    )
  })

  test('CONTEXT question carrying gap metadata', () => {
    const catalog = mutated((c) => {
      const { question } = findQuestion(c, 'HEALTH', 'numberHealthFacilities')
      question.gapLabel = 'No facilities counted'
    })
    const result = validateRegistry(catalog)
    expect(result.errors).toContain(
      'HEALTH/numberHealthFacilities: CONTEXT questions must not define gap metadata'
    )
  })

  test('CONTEXT question with non-LOW severity', () => {
    const catalog = mutated((c) => {
      const { question } = findQuestion(c, 'HEALTH', 'qualifiedHealthWorkers')
      question.severity = 'HIGH'
    })
    const result = validateRegistry(catalog)
    expect(result.errors).toContain('HEALTH/qualifiedHealthWorkers: CONTEXT questions must use severity LOW')
  })

  test('inverted flag on a CONTEXT question', () => {
    const catalog = mutated((c) => {
      const { question } = findQuestion(c, 'HEALTH', 'commonHealthIssues')
      question.inverted = true
    })
    const result = validateRegistry(catalog)
    expect(result.errors).toContain(
      'HEALTH/commonHealthIssues: inverted is only allowed on GAP questions'
    )
  })

  test('NUMBER question without numberMin', () => {
    const catalog = mutated((c) => {
      const { question } = findQuestion(c, 'POPULATION', 'totalPopulation')
      delete question.numberMin
    })
    const result = validateRegistry(catalog)
    expect(result.errors).toContain('POPULATION/totalPopulation: NUMBER questions require numberMin')
  })

  test('numberMin on a non-NUMBER question', () => {
    const catalog = mutated((c) => {
      const { question } = findQuestion(c, 'HEALTH', 'hasFunctionalClinic')
      ;(question as QuestionDef & { numberMin?: number }).numberMin = 0
    })
    const result = validateRegistry(catalog)
    expect(result.errors).toContain(
      'HEALTH/hasFunctionalClinic: numberMin/numberMax are only allowed on NUMBER questions'
    )
  })

  test('non-contiguous section order', () => {
    const catalog = mutated((c) => {
      const section = c[0].sections.find((s) => s.sectionKey === 'services')!
      section.order = 9
    })
    const result = validateRegistry(catalog)
    expect(result.errors).toContain(
      'HEALTH/services: section order 9 is not contiguous (expected 3)'
    )
  })

  test('duplicate section key within a type', () => {
    const catalog = mutated((c) => {
      const additional = c[0].sections.find((s) => s.sectionKey === 'additional')!
      additional.sectionKey = 'issues'
      additional.questions.forEach((q) => {
        q.sectionKey = 'issues'
      })
    })
    const result = validateRegistry(catalog)
    expect(result.errors).toContain('HEALTH: duplicate section key issues')
  })

  test('empty section title', () => {
    const catalog = mutated((c) => {
      const section = c[0].sections.find((s) => s.sectionKey === 'facilities')!
      section.title = ''
    })
    const result = validateRegistry(catalog)
    expect(result.errors).toContain('HEALTH/facilities: empty section title')
  })

  test('section with no questions', () => {
    const catalog = mutated((c) => {
      const section = c[0].sections.find((s) => s.sectionKey === 'additional')!
      section.questions = []
    })
    const result = validateRegistry(catalog)
    expect(result.errors).toContain('HEALTH/additional: no questions defined')
  })

  test('multiple violations are ALL reported, not just the first', () => {
    const catalog = mutated((c) => {
      // Three independent violations in different types/sections
      const facilitiesGap = findQuestion(c, 'HEALTH', 'hasFunctionalClinic').question
      facilitiesGap.required = false
      const foodGap = findQuestion(c, 'FOOD', 'isFoodSufficient').question
      foodGap.gapLabel = ''
      const numberQuestion = findQuestion(c, 'POPULATION', 'totalPopulation').question
      delete numberQuestion.numberMin
    })
    const result = validateRegistry(catalog)
    expect(result.valid).toBe(false)
    expect(result.errors).toEqual(
      expect.arrayContaining([
        'HEALTH/hasFunctionalClinic: GAP questions must be required',
        'FOOD/isFoodSufficient: GAP questions require gapLabel',
        'POPULATION/totalPopulation: NUMBER questions require numberMin',
      ])
    )
    expect(result.errors.length).toBeGreaterThanOrEqual(3)
  })
})
