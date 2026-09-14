import {
  analyzeHealthGaps,
  analyzeFoodGaps,
  analyzeWASHGaps,
  analyzeShelterGaps,
  analyzeSecurityGaps,
} from '@/lib/services/gap-analysis.service'
import { gapFieldSeverityService } from '@/lib/services/gap-field-severity.service'

/**
 * Unit — gap detection logic of the five sector analyzers.
 * The ONLY mocked seam is gapFieldSeverityService (DB-backed config source);
 * everything under test (field detection incl. inverted flags, hasGap,
 * recommendation mapping, severity passthrough) is real code.
 */

/**
 * tests/setup.ts globally mocks '@prisma/client' with ONLY PrismaClient —
 * no enums — so the value-imported AssessmentType/Priority enums in the
 * service would be undefined. Re-register the module mock here (test-file
 * registration overrides the setup-file one) with the enums the service
 * reads at runtime. No DB access happens through this seam.
 */
jest.mock('@prisma/client', () => ({
  AssessmentType: {
    POPULATION: 'POPULATION',
    HEALTH: 'HEALTH',
    FOOD: 'FOOD',
    WASH: 'WASH',
    SHELTER: 'SHELTER',
    SECURITY: 'SECURITY',
  },
  Priority: {
    UNCLASSIFIED: 'UNCLASSIFIED',
    LOW: 'LOW',
    MEDIUM: 'MEDIUM',
    HIGH: 'HIGH',
    CRITICAL: 'CRITICAL',
  },
}))

jest.mock('@/lib/services/gap-field-severity.service', () => ({
  gapFieldSeverityService: {
    calculateAssessmentSeverity: jest.fn(async (_type: string, fields: string[]) =>
      fields.includes('hasFunctionalClinic')
        ? 'CRITICAL'
        : fields.length > 0
          ? 'HIGH'
          : 'LOW'
    ),
    calculateFieldSeverity: jest.fn(async () => 'MEDIUM'),
  },
}))

const ALL_GOOD_HEALTH = {
  hasFunctionalClinic: true,
  hasEmergencyServices: true,
  hasTrainedStaff: true,
  hasMedicineSupply: true,
  hasMedicalSupplies: true,
  hasMaternalChildServices: true,
}

const ALL_DIRE_HEALTH = {
  hasFunctionalClinic: false,
  hasEmergencyServices: false,
  hasTrainedStaff: false,
  hasMedicineSupply: false,
  hasMedicalSupplies: false,
  hasMaternalChildServices: false,
}

describe('unit — gap-analysis sector analyzers', () => {
  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('analyzeHealthGaps', () => {
    test('healthy facility → no gaps, no recommendations', async () => {
      const result = await analyzeHealthGaps(ALL_GOOD_HEALTH)
      expect(result.hasGap).toBe(false)
      expect(result.gapFields).toEqual([])
      expect(result.recommendations).toEqual([])
      expect(result.severity).toBe('LOW')
    })

    test('all-failed facility → all 6 gap fields + 6 recommendations', async () => {
      const result = await analyzeHealthGaps(ALL_DIRE_HEALTH)
      expect(result.gapFields).toEqual([
        'hasFunctionalClinic',
        'hasEmergencyServices',
        'hasTrainedStaff',
        'hasMedicineSupply',
        'hasMedicalSupplies',
        'hasMaternalChildServices',
      ])
      expect(result.hasGap).toBe(true)
      expect(result.recommendations).toHaveLength(6)
      expect(result.fieldSeverityMap).toHaveProperty('hasFunctionalClinic')
    })

    test('partial failure detects exactly the failed fields', async () => {
      const result = await analyzeHealthGaps({
        ...ALL_GOOD_HEALTH,
        hasMedicineSupply: false,
      })
      expect(result.gapFields).toEqual(['hasMedicineSupply'])
      expect(result.recommendations).toHaveLength(1)
    })

    test('severity is passed through from the configured mapping (CRITICAL)', async () => {
      const result = await analyzeHealthGaps({
        ...ALL_GOOD_HEALTH,
        hasFunctionalClinic: false,
      })
      expect(result.severity).toBe('CRITICAL')
    })
  })

  describe('analyzeFoodGaps', () => {
    const good = {
      isFoodSufficient: true,
      hasRegularMealAccess: true,
      hasInfantNutrition: true,
    }

    test('sufficient food → no gaps', async () => {
      const result = await analyzeFoodGaps(good)
      expect(result.hasGap).toBe(false)
    })

    test('insufficient food → 3 gap fields', async () => {
      const result = await analyzeFoodGaps({
        isFoodSufficient: false,
        hasRegularMealAccess: false,
        hasInfantNutrition: false,
      })
      expect(result.gapFields).toEqual([
        'isFoodSufficient',
        'hasRegularMealAccess',
        'hasInfantNutrition',
      ])
      expect(result.recommendations).toHaveLength(3)
    })
  })

  describe('analyzeWASHGaps — inverted flag hasOpenDefecationConcerns', () => {
    const good = {
      isWaterSufficient: true,
      hasCleanWaterAccess: true,
      areLatrinesSufficient: true,
      hasHandwashingFacilities: true,
      hasOpenDefecationConcerns: false,
    }

    test('clean camp → no gaps', async () => {
      const result = await analyzeWASHGaps(good)
      expect(result.hasGap).toBe(false)
      expect(result.gapFields).toEqual([])
    })

    test('open defecation concerns TRUE is a gap (flag is inverted)', async () => {
      const result = await analyzeWASHGaps({
        ...good,
        hasOpenDefecationConcerns: true,
      })
      expect(result.gapFields).toEqual(['hasOpenDefecationConcerns'])
      expect(result.recommendations[0]).toMatch(/defecation/i)
    })

    test('insufficient water + no handwashing → both gaps', async () => {
      const result = await analyzeWASHGaps({
        ...good,
        isWaterSufficient: false,
        hasHandwashingFacilities: false,
      })
      expect(result.gapFields).toEqual(['isWaterSufficient', 'hasHandwashingFacilities'])
    })
  })

  describe('analyzeShelterGaps — inverted flag areOvercrowded', () => {
    const good = {
      areSheltersSufficient: true,
      hasSafeStructures: true,
      areOvercrowded: false,
      provideWeatherProtection: true,
    }

    test('adequate shelter → no gaps', async () => {
      const result = await analyzeShelterGaps(good)
      expect(result.hasGap).toBe(false)
    })

    test('overcrowding TRUE is a gap', async () => {
      const result = await analyzeShelterGaps({ ...good, areOvercrowded: true })
      expect(result.gapFields).toEqual(['areOvercrowded'])
      expect(result.recommendations[0]).toMatch(/decongest/i)
    })
  })

  describe('analyzeSecurityGaps — inverted flag gbvCasesReported', () => {
    const safe = {
      isSafeFromViolence: true,
      gbvCasesReported: false,
      hasSecurityPresence: true,
      hasProtectionReportingMechanism: true,
      vulnerableGroupsHaveAccess: true,
      hasLighting: true,
    }

    test('secure site → no gaps', async () => {
      const result = await analyzeSecurityGaps(safe)
      expect(result.hasGap).toBe(false)
    })

    test('GBV reported TRUE is a gap with a GBV-specific recommendation', async () => {
      const result = await analyzeSecurityGaps({ ...safe, gbvCasesReported: true })
      expect(result.gapFields).toEqual(['gbvCasesReported'])
      expect(result.recommendations[0]).toMatch(/GBV/i)
    })

    test('fully insecure site → all 6 gap fields', async () => {
      const result = await analyzeSecurityGaps({
        isSafeFromViolence: false,
        gbvCasesReported: true,
        hasSecurityPresence: false,
        hasProtectionReportingMechanism: false,
        vulnerableGroupsHaveAccess: false,
        hasLighting: false,
      })
      expect(result.gapFields).toHaveLength(6)
      expect(result.recommendations).toHaveLength(6)
    })
  })

  test('every analyzer consults the configured severity source exactly once', async () => {
    await analyzeHealthGaps(ALL_DIRE_HEALTH)
    expect(gapFieldSeverityService.calculateAssessmentSeverity).toHaveBeenCalledTimes(1)
    expect(gapFieldSeverityService.calculateFieldSeverity).toHaveBeenCalledTimes(6)
  })
})
