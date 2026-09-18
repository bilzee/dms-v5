import {
  ASSESSMENT_TYPES,
  coerceArray,
  fromAnswers,
  hydrateFromSnapshot,
  questionKeysForType,
  type RapidAssessmentType,
} from '@/lib/questions/answers'
import { EXPECTED_CATALOG_COUNTS, QUESTION_CATALOG } from '@/lib/questions/registry-validation'

/**
 * Unit — canonical answers map layer (P4 + P10-1 read side).
 *
 * `questionKeysForType` / `fromAnswers` / `coerceArray` own everything between
 * the stored `RapidAssessment.answers` map and the UI: presentation order,
 * read-side hydration defaults (legacy form parity), and tolerant multi-select
 * coercion. `hydrateFromSnapshot` (P10-1) owns snapshot-driven hydration:
 * typed values for every frozen-snapshot key with raw passthrough for
 * unmapped drift. Pure catalog functions — no DB, no DOM.
 */

describe('ASSESSMENT_TYPES (re-export)', () => {
  test('exposes the six catalog assessment types', () => {
    expect(ASSESSMENT_TYPES).toEqual(['HEALTH', 'FOOD', 'WASH', 'SHELTER', 'SECURITY', 'POPULATION'])
  })
})

describe('questionKeysForType', () => {
  test('returns HEALTH keys in catalog presentation order', () => {
    expect(questionKeysForType('HEALTH')).toEqual([
      'hasFunctionalClinic',
      'hasEmergencyServices',
      'numberHealthFacilities',
      'qualifiedHealthWorkers',
      'healthFacilityType',
      'hasTrainedStaff',
      'hasMedicineSupply',
      'hasMedicalSupplies',
      'hasMaternalChildServices',
      'commonHealthIssues',
      'additionalHealthDetails',
    ])
  })

  test('keys are unique within every assessment type', () => {
    for (const type of ASSESSMENT_TYPES) {
      const keys = questionKeysForType(type)
      expect(new Set(keys).size).toBe(keys.length)
    }
  })

  test('all six types cover the full seeded catalog (55 questions)', () => {
    const total = ASSESSMENT_TYPES.reduce(
      (sum, type) => sum + questionKeysForType(type).length,
      0
    )
    expect(total).toBe(EXPECTED_CATALOG_COUNTS.questions)
  })

  test('POPULATION is context-only (13 demographic keys, no booleans)', () => {
    expect(questionKeysForType('POPULATION')).toEqual([
      'totalHouseholds',
      'totalPopulation',
      'populationMale',
      'populationFemale',
      'populationUnder5',
      'pregnantWomen',
      'lactatingMothers',
      'personWithDisability',
      'elderlyPersons',
      'separatedChildren',
      'numberLivesLost',
      'numberInjured',
      'additionalPopulationDetails',
    ])
  })

  test('throws for an unknown assessment type', () => {
    expect(() => questionKeysForType('LOGISTICS' as RapidAssessmentType)).toThrow(
      'Unknown assessment type: LOGISTICS'
    )
  })
})

describe('coerceArray', () => {
  test('passes string arrays through and filters non-string entries', () => {
    expect(coerceArray(['Borehole', 'Tap water'])).toEqual(['Borehole', 'Tap water'])
    expect(coerceArray(['Borehole', 42, true, null, 'River/Stream'])).toEqual([
      'Borehole',
      'River/Stream',
    ])
  })

  test('parses JSON-encoded string arrays (offline sync transport)', () => {
    expect(coerceArray('["Malaria","Diarrhea"]')).toEqual(['Malaria', 'Diarrhea'])
  })

  test('returns [] for JSON strings that are not arrays', () => {
    expect(coerceArray('{"values":["a"]}')).toEqual([])
    expect(coerceArray('"Borehole"')).toEqual([])
  })

  test('returns [] for non-JSON strings', () => {
    expect(coerceArray('Borehole')).toEqual([])
  })

  test('returns [] for non-string, non-array values', () => {
    expect(coerceArray(42)).toEqual([])
    expect(coerceArray(true)).toEqual([])
    expect(coerceArray(null)).toEqual([])
    expect(coerceArray(undefined)).toEqual([])
    expect(coerceArray({ value: 'Borehole' })).toEqual([])
  })
})

describe('fromAnswers', () => {
  test('null answers hydrate to the full legacy default object for HEALTH', () => {
    expect(fromAnswers('HEALTH', null)).toEqual({
      hasFunctionalClinic: false,
      hasEmergencyServices: false,
      numberHealthFacilities: 0,
      qualifiedHealthWorkers: 0,
      healthFacilityType: '',
      hasTrainedStaff: false,
      hasMedicineSupply: false,
      hasMedicalSupplies: false,
      hasMaternalChildServices: false,
      commonHealthIssues: [],
      additionalHealthDetails: undefined,
    })
  })

  test('undefined answers behave like null', () => {
    expect(fromAnswers('FOOD', undefined)).toEqual(fromAnswers('FOOD', null))
  })

  test('stored values hydrate verbatim (edit-page echo)', () => {
    const answers = {
      hasFunctionalClinic: true,
      hasEmergencyServices: false,
      numberHealthFacilities: 3,
      qualifiedHealthWorkers: 12,
      healthFacilityType: 'Clinic',
      hasTrainedStaff: true,
      hasMedicineSupply: true,
      hasMedicalSupplies: false,
      hasMaternalChildServices: true,
      commonHealthIssues: ['Malaria', 'Diarrhea'],
      additionalHealthDetails: 'Mobile clinic visits weekly',
    }
    expect(fromAnswers('HEALTH', answers)).toEqual(answers)
  })

  test('wrong-typed stored values fall back to the per-type default', () => {
    const result = fromAnswers('HEALTH', {
      hasFunctionalClinic: 'yes', // boolean expected → false
      numberHealthFacilities: '5', // number expected → 0
      healthFacilityType: 42, // string expected → ''
      commonHealthIssues: 'Diarrhea', // array expected → [] (not JSON)
      additionalHealthDetails: 99, // string expected → undefined
    })
    expect(result.hasFunctionalClinic).toBe(false)
    expect(result.numberHealthFacilities).toBe(0)
    expect(result.healthFacilityType).toBe('')
    expect(result.commonHealthIssues).toEqual([])
    expect(result.additionalHealthDetails).toBeUndefined()
  })

  test('JSON-encoded multi-select strings are coerced through coerceArray', () => {
    const result = fromAnswers('HEALTH', { commonHealthIssues: '["Malaria"]' })
    expect(result.commonHealthIssues).toEqual(['Malaria'])
  })

  test('unknown keys are ignored — result carries exactly the type key set', () => {
    const result = fromAnswers('WASH', {
      isWaterSufficient: true,
      mysteryLegacyKey: 'gone',
    })
    expect(Object.keys(result).sort()).toEqual(
      [
        'isWaterSufficient',
        'hasCleanWaterAccess',
        'areLatrinesSufficient',
        'hasHandwashingFacilities',
        'hasOpenDefecationConcerns',
        'waterSource',
        'functionalLatrinesAvailable',
        'additionalWashDetails',
      ].sort()
    )
    expect(result).not.toHaveProperty('mysteryLegacyKey')
    expect(result.isWaterSufficient).toBe(true)
  })

  test('POPULATION numbers default to 0 and free text to undefined', () => {
    const result = fromAnswers('POPULATION', { totalPopulation: 1200 })
    expect(result.totalPopulation).toBe(1200)
    expect(result.totalHouseholds).toBe(0)
    expect(result.numberLivesLost).toBe(0)
    expect(result.additionalPopulationDetails).toBeUndefined()
  })

  test('throws for an unknown assessment type', () => {
    expect(() => fromAnswers('LOGISTICS' as RapidAssessmentType, {})).toThrow(
      'Unknown assessment type: LOGISTICS'
    )
  })
})

describe('hydrateFromSnapshot (P10-1 snapshot-driven read side)', () => {
  /** Stored-snapshot fixture: one catalog key + one admin-authored post-seed key. */
  const snapshot = {
    structureVersion: 3,
    contentVersion: 1,
    generatedAt: '2026-01-01T00:00:00.000Z',
    sections: [
      {
        id: 'sec-facilities',
        key: 'facilities',
        title: 'Healthcare Facilities',
        category: 'GAP',
        order: 1,
        questions: [
          {
            id: 'q-hasFunctionalClinic',
            key: 'hasFunctionalClinic',
            label: 'Functional Clinic',
            type: 'BOOLEAN',
            required: true,
            category: 'GAP',
            inverted: false,
            order: 1,
          },
          {
            id: 'q-p9t',
            key: 'p9tPatientsPerDay',
            label: 'Patients per day (post-seed)',
            type: 'NUMBER',
            required: false,
            category: 'CONTEXT',
            inverted: false,
            order: 2,
          },
          {
            id: 'q-notes',
            key: 'clinicianNotes',
            label: 'Clinician notes',
            type: 'TEXT_LONG',
            required: false,
            category: 'CONTEXT',
            inverted: false,
            order: 3,
          },
        ],
      },
    ],
  }

  test('post-seed keys in the snapshot hydrate typed (carried, never dropped)', () => {
    const { values, unmappedKeys } = hydrateFromSnapshot(snapshot, {
      hasFunctionalClinic: true,
      p9tPatientsPerDay: 42,
      clinicianNotes: 'Weekly mobile clinic',
    })
    expect(values).toEqual({
      hasFunctionalClinic: true,
      p9tPatientsPerDay: 42,
      clinicianNotes: 'Weekly mobile clinic',
    })
    expect(unmappedKeys).toEqual([])
  })

  test('absent snapshot keys default per type (booleans false, numbers 0, text undefined)', () => {
    const { values } = hydrateFromSnapshot(snapshot, {})
    expect(values).toEqual({
      hasFunctionalClinic: false,
      p9tPatientsPerDay: 0,
      clinicianNotes: undefined,
    })
  })

  test('unmapped drift passes through RAW and is listed — no fabricated defaults', () => {
    const { values, unmappedKeys } = hydrateFromSnapshot(snapshot, {
      mysteryLegacyKey: 'gone',
    })
    expect(unmappedKeys).toEqual(['mysteryLegacyKey'])
    expect(values.mysteryLegacyKey).toBe('gone') // raw stored value, not a default
    expect(values.hasFunctionalClinic).toBe(false)
  })

  test('wrong-typed stored values fall back to the snapshot type default', () => {
    const { values } = hydrateFromSnapshot(snapshot, {
      hasFunctionalClinic: 'yes', // BOOLEAN expected → false
      p9tPatientsPerDay: '12', // NUMBER expected → 0
      clinicianNotes: 99, // TEXT_LONG expected → undefined
    })
    expect(values.hasFunctionalClinic).toBe(false)
    expect(values.p9tPatientsPerDay).toBe(0)
    expect(values.clinicianNotes).toBeUndefined()
  })

  test('never throws on malformed/absent structures (stored-JSON tolerance)', () => {
    expect(hydrateFromSnapshot(null, { a: 1 })).toEqual({ values: { a: 1 }, unmappedKeys: ['a'] })
    expect(hydrateFromSnapshot(undefined, null)).toEqual({ values: {}, unmappedKeys: [] })
    expect(hydrateFromSnapshot({}, { a: 1 })).toEqual({ values: { a: 1 }, unmappedKeys: ['a'] })
    expect(hydrateFromSnapshot({ sections: 'not-an-array' }, { a: 1 }).unmappedKeys).toEqual(['a'])
    expect(
      hydrateFromSnapshot(
        { sections: [{ questions: [{ key: 'a', type: 'NUMBER' }, { nope: true }] }] },
        { a: 3, b: 'raw' }
      )
    ).toEqual({ values: { a: 3, b: 'raw' }, unmappedKeys: ['b'] })
  })

  test('fromAnswers wrapper drops unmapped keys (catalog parity preserved)', () => {
    const result = fromAnswers('WASH', { isWaterSufficient: true, mysteryLegacyKey: 'gone' })
    expect(result).not.toHaveProperty('mysteryLegacyKey')
  })
})

describe('fromAnswers catalog-key parity (P10-1 wrapper)', () => {
  test('catalog-keyed maps hydrate verbatim for all six types (55 keys)', () => {
    for (const catalog of QUESTION_CATALOG) {
      const type = catalog.assessmentType as RapidAssessmentType
      const answers: Record<string, unknown> = {}
      for (const section of catalog.sections) {
        for (const question of section.questions) {
          switch (question.questionType) {
            case 'BOOLEAN':
              answers[question.questionKey] = true
              break
            case 'NUMBER':
              answers[question.questionKey] = 7
              break
            case 'MULTI_SELECT':
              answers[question.questionKey] = ['one', 'two']
              break
            case 'SINGLE_CHOICE':
              answers[question.questionKey] = 'CHOICE_A'
              break
            default:
              answers[question.questionKey] = 'some notes'
              break
          }
        }
      }
      expect(fromAnswers(type, answers)).toEqual(answers)
      // Null hydration covers exactly the type's catalog key set.
      expect(Object.keys(fromAnswers(type, null)).sort()).toEqual(
        questionKeysForType(type).sort()
      )
    }
  })
})
