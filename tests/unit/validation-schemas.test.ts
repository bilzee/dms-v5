import {
  CreateRapidAssessmentSchema,
  FoodAssessmentSchema,
  WASHAssessmentSchema,
  ShelterAssessmentSchema,
} from '@/lib/validation/rapid-assessment'
import { CreateIncidentSchema } from '@/lib/validation/incidents'
import { ConfirmDeliverySchema } from '@/lib/validation/response'

/**
 * Unit — zod schema contracts guarding the API surface.
 * Cross-field refinements encode business invariants; a schema change that
 * loosens them changes validation behavior at every dependent route.
 */

const validFood = {
  isFoodSufficient: true,
  hasRegularMealAccess: true,
  hasInfantNutrition: true,
  foodSource: ['market'],
  availableFoodDurationDays: 14,
  additionalFoodRequiredPersons: 0,
  additionalFoodRequiredHouseholds: 0,
}

describe('unit — FoodAssessmentSchema refinements', () => {
  test('sufficient food with ample duration passes', () => {
    expect(FoodAssessmentSchema.safeParse(validFood).success).toBe(true)
  })

  test('sufficient but additional persons required → rejected', () => {
    const result = FoodAssessmentSchema.safeParse({
      ...validFood,
      additionalFoodRequiredPersons: 10,
    })
    expect(result.success).toBe(false)
  })

  test('sufficient but duration under 7 days → rejected', () => {
    const result = FoodAssessmentSchema.safeParse({
      ...validFood,
      availableFoodDurationDays: 3,
    })
    expect(result.success).toBe(false)
  })

  test('insufficient food may declare short duration AND additional needs', () => {
    const result = FoodAssessmentSchema.safeParse({
      ...validFood,
      isFoodSufficient: false,
      availableFoodDurationDays: 2,
      additionalFoodRequiredPersons: 50,
    })
    expect(result.success).toBe(true)
  })
})

describe('unit — WASHAssessmentSchema refinement', () => {
  const validWash = {
    waterSource: ['borehole'],
    isWaterSufficient: true,
    hasCleanWaterAccess: true,
    functionalLatrinesAvailable: 10,
    areLatrinesSufficient: true,
    hasHandwashingFacilities: true,
    hasOpenDefecationConcerns: false,
  }

  test('consistent WASH data passes', () => {
    expect(WASHAssessmentSchema.safeParse(validWash).success).toBe(true)
  })

  test('latrines marked sufficient but none functional → rejected', () => {
    const result = WASHAssessmentSchema.safeParse({
      ...validWash,
      functionalLatrinesAvailable: 0,
    })
    expect(result.success).toBe(false)
  })

  test('latrines insufficient with zero functional → allowed', () => {
    const result = WASHAssessmentSchema.safeParse({
      ...validWash,
      areLatrinesSufficient: false,
      functionalLatrinesAvailable: 0,
    })
    expect(result.success).toBe(true)
  })
})

describe('unit — ShelterAssessmentSchema refinement', () => {
  const validShelter = {
    areSheltersSufficient: true,
    hasSafeStructures: true,
    shelterTypes: ['tent'],
    requiredShelterType: ['tent'],
    numberSheltersRequired: 0,
    areOvercrowded: false,
    provideWeatherProtection: true,
  }

  test('consistent shelter data passes', () => {
    expect(ShelterAssessmentSchema.safeParse(validShelter).success).toBe(true)
  })

  test('shelters sufficient but more required → rejected', () => {
    const result = ShelterAssessmentSchema.safeParse({
      ...validShelter,
      numberSheltersRequired: 5,
    })
    expect(result.success).toBe(false)
  })

  test('shelters insufficient requiring more → allowed', () => {
    const result = ShelterAssessmentSchema.safeParse({
      ...validShelter,
      areSheltersSufficient: false,
      numberSheltersRequired: 5,
    })
    expect(result.success).toBe(true)
  })
})

describe('unit — CreateRapidAssessmentSchema discriminated union', () => {
  const base = {
    rapidAssessmentDate: new Date().toISOString(),
    assessorName: 'Schema Probe',
    entityId: 'entity-1',
    incidentId: 'incident-1',
  }
  const healthData = {
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

  test('HEALTH payload with valid healthData parses', () => {
    const result = CreateRapidAssessmentSchema.safeParse({
      ...base,
      type: 'HEALTH',
      healthData,
    })
    expect(result.success).toBe(true)
  })

  test('type/data discriminators must match (SECURITY type with healthData → rejected)', () => {
    const result = CreateRapidAssessmentSchema.safeParse({
      ...base,
      type: 'SECURITY',
      healthData,
    })
    expect(result.success).toBe(false)
  })

  test('unknown assessment type → rejected', () => {
    const result = CreateRapidAssessmentSchema.safeParse({
      ...base,
      type: 'LOGISTICS',
    })
    expect(result.success).toBe(false)
  })

  test('incidentId is required', () => {
    const { incidentId: _omit, ...noIncident } = base
    const result = CreateRapidAssessmentSchema.safeParse({
      ...noIncident,
      type: 'HEALTH',
      healthData,
    })
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
