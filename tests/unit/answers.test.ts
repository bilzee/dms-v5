import {
  ASSESSMENT_TYPES,
  coerceArray,
  fromAnswers,
  questionKeysForType,
  type RapidAssessmentType,
} from '@/lib/questions/answers'
import { EXPECTED_CATALOG_COUNTS } from '@/lib/questions/registry-validation'

/**
 * Unit — canonical answers map layer (P4).
 *
 * `questionKeysForType` / `fromAnswers` / `coerceArray` own everything between
 * the stored `RapidAssessment.answers` map and the UI: presentation order,
 * read-side hydration defaults (legacy form parity), and tolerant multi-select
 * coercion. Pure catalog functions — no DB, no DOM.
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
