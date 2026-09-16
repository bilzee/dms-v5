import {
  CreateRapidAssessmentSchema,
  UpdateRapidAssessmentSchema,
  AssessmentTypeName,
} from '@/lib/validation/rapid-assessment'
import { buildAssessmentSchema, type DynamicQuestionSet } from '@/lib/validation/dynamic-assessment'
import { crossFieldSuperRefine } from '@/lib/questions/cross-field-rules'
import { CreateIncidentSchema } from '@/lib/validation/incidents'
import { ConfirmDeliverySchema } from '@/lib/validation/response'

/**
 * Unit — zod schema contracts guarding the API surface (P4 answers payloads).
 *
 * The legacy typed sector schemas (FoodAssessmentSchema / WASHAssessmentSchema /
 * ShelterAssessmentSchema / discriminated union) were deleted; their exact
 * refinement predicates now live in cross-field-rules. The composition below
 * mirrors the client form wiring (`buildAssessmentSchema` +
 * `crossFieldSuperRefine`) — the server validates with buildAssessmentSchema
 * alone (cross-field rules are client-side only, Q2=B). These tests pin both
 * the refinements (legacy parity) and the new transport contract (shape-only
 * answers map, priority stripped).
 */

function compileAnswersSchema(type: AssessmentTypeName, set: DynamicQuestionSet) {
  return buildAssessmentSchema(set).superRefine(crossFieldSuperRefine(type))
}

function questionSet(questions: Array<{
  key: string
  questionType: 'BOOLEAN' | 'NUMBER' | 'TEXT_LONG' | 'SINGLE_CHOICE' | 'MULTI_SELECT'
  required?: boolean
  options?: Array<{ value: string; label: string }>
  numberMin?: number
  numberMax?: number
}>): DynamicQuestionSet {
  return {
    sections: [
      {
        questions: questions.map((q) => ({
          key: q.key,
          questionType: q.questionType,
          required: q.required ?? false,
          options: q.options,
          numberMin: q.numberMin,
          numberMax: q.numberMax,
        })),
      },
    ],
  }
}

const FOOD_SET = questionSet([
  { key: 'isFoodSufficient', questionType: 'BOOLEAN', required: true },
  { key: 'availableFoodDurationDays', questionType: 'NUMBER', numberMin: 0 },
  { key: 'additionalFoodRequiredPersons', questionType: 'NUMBER', numberMin: 0 },
])

const WASH_SET = questionSet([
  { key: 'areLatrinesSufficient', questionType: 'BOOLEAN', required: true },
  { key: 'functionalLatrinesAvailable', questionType: 'NUMBER', numberMin: 0 },
])

const SHELTER_SET = questionSet([
  { key: 'areSheltersSufficient', questionType: 'BOOLEAN', required: true },
  { key: 'numberSheltersRequired', questionType: 'NUMBER', numberMin: 0 },
])

const POPULATION_SET = questionSet([
  { key: 'totalPopulation', questionType: 'NUMBER', numberMin: 0 },
  { key: 'populationMale', questionType: 'NUMBER', numberMin: 0 },
  { key: 'populationFemale', questionType: 'NUMBER', numberMin: 0 },
  { key: 'populationUnder5', questionType: 'NUMBER', numberMin: 0 },
  { key: 'numberLivesLost', questionType: 'NUMBER', numberMin: 0 },
  { key: 'numberInjured', questionType: 'NUMBER', numberMin: 0 },
])

function issuesAt(result: { success: boolean }, path: string): boolean {
  if (result.success) return false
  const issues = (result as { error: { issues: Array<{ path: Array<string | number> }> } }).error.issues
  return issues.some((issue) => issue.path[0] === path)
}

describe('unit — compileAnswersSchema FOOD refinements (legacy parity)', () => {
  const schema = compileAnswersSchema('FOOD', FOOD_SET)
  const validFood = {
    isFoodSufficient: true,
    availableFoodDurationDays: 14,
    additionalFoodRequiredPersons: 0,
  }

  test('sufficient food with ample duration passes', () => {
    expect(schema.safeParse(validFood).success).toBe(true)
  })

  test('sufficient but additional persons required → rejected on additionalFoodRequiredPersons', () => {
    const result = schema.safeParse({ ...validFood, additionalFoodRequiredPersons: 10 })
    expect(result.success).toBe(false)
    expect(issuesAt(result, 'additionalFoodRequiredPersons')).toBe(true)
  })

  test('sufficient but duration under 7 days → rejected on availableFoodDurationDays', () => {
    const result = schema.safeParse({ ...validFood, availableFoodDurationDays: 3 })
    expect(result.success).toBe(false)
    expect(issuesAt(result, 'availableFoodDurationDays')).toBe(true)
  })

  test('insufficient food may declare short duration AND additional needs', () => {
    const result = schema.safeParse({
      ...validFood,
      isFoodSufficient: false,
      availableFoodDurationDays: 2,
      additionalFoodRequiredPersons: 50,
    })
    expect(result.success).toBe(true)
  })
})

describe('unit — compileAnswersSchema WASH refinement (legacy parity)', () => {
  const schema = compileAnswersSchema('WASH', WASH_SET)
  const validWash = { areLatrinesSufficient: true, functionalLatrinesAvailable: 10 }

  test('consistent WASH data passes', () => {
    expect(schema.safeParse(validWash).success).toBe(true)
  })

  test('latrines marked sufficient but none functional → rejected on functionalLatrinesAvailable', () => {
    const result = schema.safeParse({ ...validWash, functionalLatrinesAvailable: 0 })
    expect(result.success).toBe(false)
    expect(issuesAt(result, 'functionalLatrinesAvailable')).toBe(true)
  })

  test('latrines insufficient with zero functional → allowed', () => {
    const result = schema.safeParse({
      ...validWash,
      areLatrinesSufficient: false,
      functionalLatrinesAvailable: 0,
    })
    expect(result.success).toBe(true)
  })
})

describe('unit — compileAnswersSchema SHELTER refinement (legacy parity)', () => {
  const schema = compileAnswersSchema('SHELTER', SHELTER_SET)
  const validShelter = { areSheltersSufficient: true, numberSheltersRequired: 0 }

  test('consistent shelter data passes', () => {
    expect(schema.safeParse(validShelter).success).toBe(true)
  })

  test('shelters sufficient but more required → rejected on numberSheltersRequired', () => {
    const result = schema.safeParse({ ...validShelter, numberSheltersRequired: 5 })
    expect(result.success).toBe(false)
    expect(issuesAt(result, 'numberSheltersRequired')).toBe(true)
  })

  test('shelters insufficient requiring more → allowed', () => {
    const result = schema.safeParse({
      ...validShelter,
      areSheltersSufficient: false,
      numberSheltersRequired: 5,
    })
    expect(result.success).toBe(true)
  })
})

describe('unit — compileAnswersSchema POPULATION sum-exceeds-total refinements (legacy parity)', () => {
  const schema = compileAnswersSchema('POPULATION', POPULATION_SET)
  const valid = {
    totalPopulation: 500,
    populationMale: 250,
    populationFemale: 250,
    populationUnder5: 80,
    numberLivesLost: 2,
    numberInjured: 12,
  }

  test('consistent population data passes', () => {
    expect(schema.safeParse(valid).success).toBe(true)
  })

  test('male + female exceeding total → rejected on populationMale', () => {
    const result = schema.safeParse({ ...valid, populationFemale: 300 })
    expect(result.success).toBe(false)
    expect(issuesAt(result, 'populationMale')).toBe(true)
  })

  test('children under 5 exceeding total → rejected on populationUnder5', () => {
    const result = schema.safeParse({ ...valid, populationUnder5: 501 })
    expect(result.success).toBe(false)
    expect(issuesAt(result, 'populationUnder5')).toBe(true)
  })

  test('lives lost + injured exceeding total → rejected on numberLivesLost', () => {
    const result = schema.safeParse({ ...valid, numberInjured: 499 })
    expect(result.success).toBe(false)
    expect(issuesAt(result, 'numberLivesLost')).toBe(true)
  })

  test('equal-to-total sums are allowed (strictly greater fires)', () => {
    const result = schema.safeParse({
      ...valid,
      populationMale: 500,
      populationFemale: 0,
      populationUnder5: 500,
      numberLivesLost: 500,
      numberInjured: 0,
    })
    expect(result.success).toBe(true)
  })
})

describe('unit — CreateRapidAssessmentSchema (transport: answers payloads)', () => {
  const base = {
    rapidAssessmentDate: new Date().toISOString(),
    assessorName: 'Schema Probe',
    entityId: 'entity-1',
    incidentId: 'incident-1',
  }
  const answers = {
    hasFunctionalClinic: true,
    hasEmergencyServices: true,
    numberHealthFacilities: 1,
    healthFacilityType: 'Clinic',
    qualifiedHealthWorkers: 2,
    hasTrainedStaff: true,
    hasMedicineSupply: true,
    hasMedicalSupplies: true,
    hasMaternalChildServices: true,
    commonHealthIssues: [],
  }

  test('HEALTH payload with the answers map parses', () => {
    const result = CreateRapidAssessmentSchema.safeParse({ ...base, type: 'HEALTH', answers })
    expect(result.success).toBe(true)
  })

  test('typed payload props and priority are stripped, not validated', () => {
    const result = CreateRapidAssessmentSchema.parse({
      ...base,
      type: 'HEALTH',
      answers,
      healthData: { legacy: true },
      priority: 'CRITICAL',
    })
    expect(result).not.toHaveProperty('healthData')
    expect(result).not.toHaveProperty('priority')
    expect(result.answers).toEqual(answers)
  })

  test('unknown assessment type → rejected', () => {
    const result = CreateRapidAssessmentSchema.safeParse({ ...base, type: 'LOGISTICS', answers })
    expect(result.success).toBe(false)
  })

  test('incidentId is required', () => {
    const { incidentId: _omit, ...noIncident } = base
    const result = CreateRapidAssessmentSchema.safeParse({ ...noIncident, type: 'HEALTH', answers })
    expect(result.success).toBe(false)
  })

  test('answers must be a JSON object', () => {
    const result = CreateRapidAssessmentSchema.safeParse({ ...base, type: 'HEALTH', answers: ['nope'] })
    expect(result.success).toBe(false)
  })
})

describe('unit — UpdateRapidAssessmentSchema (full answers replace)', () => {
  test('requires type + answers; metadata optional; verificationStatus accepted', () => {
    const result = UpdateRapidAssessmentSchema.safeParse({
      type: 'HEALTH',
      answers: { hasFunctionalClinic: false },
      verificationStatus: 'SUBMITTED',
    })
    expect(result.success).toBe(true)
  })

  test('missing answers → rejected', () => {
    const result = UpdateRapidAssessmentSchema.safeParse({ type: 'HEALTH' })
    expect(result.success).toBe(false)
  })
})

describe('unit — CreateIncidentSchema', () => {
  test('minimal valid incident data parses with status defaulting to ACTIVE', () => {
    const result = CreateIncidentSchema.parse({
      data: { type: 'FLOOD', description: 'd', location: 'l' },
    })
    expect(result.data.status).toBe('ACTIVE')
  })

  test('out-of-range coordinates → rejected', () => {
    const result = CreateIncidentSchema.safeParse({
      data: {
        type: 'FLOOD',
        description: 'd',
        location: 'l',
        coordinates: { lat: 999, lng: 0 },
      },
    })
    expect(result.success).toBe(false)
  })

  test('unknown status enum → rejected', () => {
    const result = CreateIncidentSchema.safeParse({
      data: { type: 'FLOOD', description: 'd', location: 'l', status: 'MAYBE' },
    })
    expect(result.success).toBe(false)
  })
})

describe('unit — ConfirmDeliverySchema', () => {
  test('requires at least one delivered item', () => {
    expect(ConfirmDeliverySchema.safeParse({ deliveredItems: [] }).success).toBe(false)
  })

  test('zero-quantity item → rejected', () => {
    const result = ConfirmDeliverySchema.safeParse({
      deliveredItems: [{ name: 'Blankets', unit: 'pcs', quantity: 0 }],
    })
    expect(result.success).toBe(false)
  })

  test('valid delivery with optional location parses', () => {
    const result = ConfirmDeliverySchema.safeParse({
      deliveredItems: [{ name: 'Blankets', unit: 'pcs', quantity: 10 }],
      deliveryLocation: { latitude: 11.8, longitude: 13.1 },
    })
    expect(result.success).toBe(true)
  })
})
