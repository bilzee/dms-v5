import {
  toAnswers,
  fromAnswers,
  questionKeysForType,
  RapidAssessmentType,
  RapidAssessmentAnswers,
} from '@/lib/questions/legacy-convert'
import { QUESTION_CATALOG, ASSESSMENT_TYPES } from '@/lib/questions/registry-validation'

/**
 * Unit — legacy typed-payload ⇄ answers conversion parity.
 *
 * One exact typed fixture per assessment type (the legacy form payloads) is
 * converted to the canonical answers JSON and round-tripped through
 * `fromAnswers`. Fixtures include the multi-select fields whose legacy columns
 * stored JSON-stringified arrays.
 */

type Fixture = Record<string, unknown>

const FIXTURES: Record<RapidAssessmentType, { payload: Fixture; expected: RapidAssessmentAnswers }> = {
  HEALTH: {
    payload: {
      hasFunctionalClinic: true,
      hasEmergencyServices: false,
      numberHealthFacilities: 3,
      qualifiedHealthWorkers: 12,
      healthFacilityType: 'Clinic',
      hasTrainedStaff: true,
      hasMedicineSupply: false,
      hasMedicalSupplies: true,
      hasMaternalChildServices: false,
      commonHealthIssues: ['Diarrhea', 'Malaria'],
      additionalHealthDetails: 'Mobile clinic visits weekly',
    },
    expected: {
      hasFunctionalClinic: true,
      hasEmergencyServices: false,
      numberHealthFacilities: 3,
      qualifiedHealthWorkers: 12,
      healthFacilityType: 'Clinic',
      hasTrainedStaff: true,
      hasMedicineSupply: false,
      hasMedicalSupplies: true,
      hasMaternalChildServices: false,
      commonHealthIssues: ['Diarrhea', 'Malaria'],
      additionalHealthDetails: 'Mobile clinic visits weekly',
    },
  },
  FOOD: {
    payload: {
      isFoodSufficient: true,
      hasRegularMealAccess: false,
      hasInfantNutrition: true,
      foodSource: ['Government kitchen', 'Community'],
      availableFoodDurationDays: 4,
      additionalFoodRequiredPersons: 250,
      additionalFoodRequiredHouseholds: 55,
      additionalFoodDetails: 'Cereals and oil needed',
    },
    expected: {
      isFoodSufficient: true,
      hasRegularMealAccess: false,
      hasInfantNutrition: true,
      foodSource: ['Government kitchen', 'Community'],
      availableFoodDurationDays: 4,
      additionalFoodRequiredPersons: 250,
      additionalFoodRequiredHouseholds: 55,
      additionalFoodDetails: 'Cereals and oil needed',
    },
  },
  WASH: {
    payload: {
      isWaterSufficient: true,
      hasCleanWaterAccess: false,
      areLatrinesSufficient: true,
      hasHandwashingFacilities: false,
      hasOpenDefecationConcerns: true,
      waterSource: ['Borehole', 'Water trucks'],
      functionalLatrinesAvailable: 8,
      additionalWashDetails: 'Two boreholes broken',
    },
    expected: {
      isWaterSufficient: true,
      hasCleanWaterAccess: false,
      areLatrinesSufficient: true,
      hasHandwashingFacilities: false,
      hasOpenDefecationConcerns: true,
      waterSource: ['Borehole', 'Water trucks'],
      functionalLatrinesAvailable: 8,
      additionalWashDetails: 'Two boreholes broken',
    },
  },
  SHELTER: {
    payload: {
      areSheltersSufficient: false,
      hasSafeStructures: true,
      provideWeatherProtection: false,
      areOvercrowded: true,
      shelterTypes: ['Trampoline'],
      requiredShelterType: ['Local materials', 'Other'],
      numberSheltersRequired: 40,
      additionalShelterDetails: 'Camp is at capacity',
    },
    expected: {
      areSheltersSufficient: false,
      hasSafeStructures: true,
      provideWeatherProtection: false,
      areOvercrowded: true,
      shelterTypes: ['Trampoline'],
      requiredShelterType: ['Local materials', 'Other'],
      numberSheltersRequired: 40,
      additionalShelterDetails: 'Camp is at capacity',
    },
  },
  SECURITY: {
    payload: {
      isSafeFromViolence: false,
      gbvCasesReported: true,
      hasSecurityPresence: true,
      hasProtectionReportingMechanism: false,
      vulnerableGroupsHaveAccess: true,
      hasLighting: false,
      additionalSecurityDetails: 'Night patrols stopped',
    },
    expected: {
      isSafeFromViolence: false,
      gbvCasesReported: true,
      hasSecurityPresence: true,
      hasProtectionReportingMechanism: false,
      vulnerableGroupsHaveAccess: true,
      hasLighting: false,
      additionalSecurityDetails: 'Night patrols stopped',
    },
  },
  POPULATION: {
    payload: {
      totalHouseholds: 120,
      totalPopulation: 640,
      populationMale: 300,
      populationFemale: 340,
      populationUnder5: 90,
      pregnantWomen: 22,
      lactatingMothers: 28,
      personWithDisability: 11,
      elderlyPersons: 45,
      separatedChildren: 6,
      numberLivesLost: 2,
      numberInjured: 9,
      additionalPopulationDetails: 'Influx from Ngala last week',
    },
    expected: {
      totalHouseholds: 120,
      totalPopulation: 640,
      populationMale: 300,
      populationFemale: 340,
      populationUnder5: 90,
      pregnantWomen: 22,
      lactatingMothers: 28,
      personWithDisability: 11,
      elderlyPersons: 45,
      separatedChildren: 6,
      numberLivesLost: 2,
      numberInjured: 9,
      additionalPopulationDetails: 'Influx from Ngala last week',
    },
  },
}

describe('unit — legacy-convert parity (all six assessment types)', () => {
  ASSESSMENT_TYPES.forEach((assessmentType) => {
    describe(`${assessmentType} typed payload ⇄ answers`, () => {
      const { payload, expected } = FIXTURES[assessmentType]

      test('toAnswers produces the exact expected answers JSON', () => {
        expect(toAnswers(assessmentType, payload)).toEqual(expected)
      })

      test('fixture covers every catalog question key for the type', () => {
        expect(Object.keys(payload).sort()).toEqual(questionKeysForType(assessmentType).sort())
      })

      test('fromAnswers(toAnswers(payload)) round-trips the typed payload', () => {
        expect(fromAnswers(assessmentType, toAnswers(assessmentType, payload))).toEqual(expected)
      })
    })
  })

  describe('legacy JSON-stringified array normalization', () => {
    test('string-encoded multi-select arrays parse into real arrays', () => {
      const answers = toAnswers('HEALTH', {
        hasFunctionalClinic: true,
        hasEmergencyServices: true,
        hasTrainedStaff: true,
        hasMedicineSupply: true,
        hasMedicalSupplies: true,
        hasMaternalChildServices: true,
        commonHealthIssues: '["Diarrhea","Malaria"]',
      })
      expect(answers.commonHealthIssues).toEqual(['Diarrhea', 'Malaria'])
      expect(Array.isArray(answers.commonHealthIssues)).toBe(true)
    })

    test('string-encoded WASH/SHELTER/FOOD multi-selects normalize too', () => {
      expect(toAnswers('WASH', { waterSource: '["Borehole"]' }).waterSource).toEqual(['Borehole'])
      expect(toAnswers('SHELTER', { shelterTypes: '["Trampoline","Other"]' }).shelterTypes).toEqual([
        'Trampoline',
        'Other',
      ])
      expect(toAnswers('FOOD', { foodSource: '["Community"]' }).foodSource).toEqual(['Community'])
    })

    test('malformed JSON string yields an empty array (legacy default)', () => {
      expect(toAnswers('HEALTH', { commonHealthIssues: 'not-json' }).commonHealthIssues).toEqual([])
    })
  })

  describe('toAnswers edge cases', () => {
    test('unknown keys are dropped (answers are registry-keyed)', () => {
      const answers = toAnswers('HEALTH', {
        hasFunctionalClinic: true,
        notAQuestionKey: 'x',
      })
      expect(answers).toEqual({ hasFunctionalClinic: true })
      expect('notAQuestionKey' in answers).toBe(false)
    })

    test('null values map to undefined (absent)', () => {
      const answers = toAnswers('HEALTH', { additionalHealthDetails: null })
      expect(answers.additionalHealthDetails).toBeUndefined()
      expect('additionalHealthDetails' in answers).toBe(true)
    })

    test('empty payload yields an empty answers map', () => {
      expect(toAnswers('FOOD', {})).toEqual({})
    })
  })

  describe('fromAnswers defaults (edit-form hydration of missing answers)', () => {
    test('booleans → false, numbers → 0, arrays → [], choices → "", text → undefined', () => {
      const hydrated = fromAnswers('HEALTH', {})
      expect(hydrated.hasFunctionalClinic).toBe(false)
      expect(hydrated.numberHealthFacilities).toBe(0)
      expect(hydrated.commonHealthIssues).toEqual([])
      expect(hydrated.healthFacilityType).toBe('')
      expect(hydrated.additionalHealthDetails).toBeUndefined()
    })

    test('null/undefined answers hydrate to the same defaults', () => {
      expect(fromAnswers('POPULATION', null).totalPopulation).toBe(0)
      expect(fromAnswers('POPULATION', undefined).totalHouseholds).toBe(0)
    })

    test('every key of the type is present in the hydrated payload', () => {
      const hydrated = fromAnswers('SECURITY', {})
      expect(Object.keys(hydrated).sort()).toEqual(questionKeysForType('SECURITY').sort())
    })
  })

  test('questionKeysForType returns catalog presentation order', () => {
    // HEALTH interleaves GAP/CONTEXT per the legacy form card order
    expect(questionKeysForType('HEALTH').slice(0, 3)).toEqual([
      'hasFunctionalClinic',
      'hasEmergencyServices',
      'numberHealthFacilities',
    ])
    // Catalog totals: every type's keys sum to 55 questions
    const total = ASSESSMENT_TYPES.reduce(
      (sum, type) => sum + questionKeysForType(type).length,
      0
    )
    expect(total).toBe(55)
    expect(QUESTION_CATALOG).toHaveLength(6)
  })
})
