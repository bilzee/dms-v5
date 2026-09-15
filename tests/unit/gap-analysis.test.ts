import {
  analyzeGaps,
  analyzeHealthGaps,
  analyzeFoodGaps,
  analyzeWASHGaps,
  analyzeShelterGaps,
  analyzeSecurityGaps,
  derivePriorityFromGaps,
  clearGapQuestionCache,
} from '@/lib/services/gap-analysis.service'

/**
 * Unit — registry-driven gap analysis.
 *
 * The ONLY mocked seam is `@/lib/db/client` (the registry question source):
 * `prisma.question.findMany` returns the catalog's real GAP questions, so the
 * code under test — field detection incl. inverted flags, severity MAX
 * roll-up, recommendation mapping, per-type caching, POPULATION early-return,
 * priority derivation — all run against the real catalog definitions.
 *
 * tests/setup.ts globally mocks '@prisma/client' with the const-object enums
 * (AssessmentType / Priority) the service value-imports; no DB access happens.
 */
jest.mock('@/lib/db/client', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { QUESTION_CATALOG } = require('@/lib/questions/registry-validation')
  const findMany = jest.fn(async (args?: { where?: { assessmentType?: string; category?: string } }) => {
    const type = args?.where?.assessmentType
    const category = args?.where?.category
    return QUESTION_CATALOG.filter((entry: any) => !type || entry.assessmentType === type)
      .flatMap((entry: any) =>
        entry.sections.flatMap((section: any) =>
          section.questions.map((question: any) => ({
            questionKey: question.questionKey,
            inverted: question.inverted ?? false,
            severity: question.severity ?? 'LOW',
            recommendation: question.recommendation ?? null,
            _category: question.category,
          }))
        )
      )
      .filter((row: any) => !category || row._category === category)
  })
  return { prisma: { question: { findMany } } }
})

import { prisma } from '@/lib/db/client'

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

describe('unit — gap-analysis registry analyzers', () => {
  beforeEach(() => {
    clearGapQuestionCache()
    ;(prisma.question.findMany as jest.Mock).mockClear()
  })

  describe('analyzeHealthGaps', () => {
    test('healthy facility → no gaps, no recommendations, LOW severity', async () => {
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

    test('severity comes from the registry Question rows (MEDIUM for clinic gap at P1 seed)', async () => {
      const result = await analyzeHealthGaps({
        ...ALL_GOOD_HEALTH,
        hasFunctionalClinic: false,
      })
      expect(result.severity).toBe('MEDIUM')
    })

    test('severity is the MAX of gapped questions, not the last', async () => {
      // P1 seed policy is all-MEDIUM, so the MAX roll-up is proven with
      // synthetic registry rows: HIGH (trained staff) + MEDIUM (maternal) → HIGH
      ;(prisma.question.findMany as jest.Mock).mockImplementationOnce(async () => [
        { questionKey: 'hasTrainedStaff', inverted: false, severity: 'HIGH', recommendation: null },
        { questionKey: 'hasMaternalChildServices', inverted: false, severity: 'MEDIUM', recommendation: null },
      ])
      const result = await analyzeHealthGaps({
        ...ALL_GOOD_HEALTH,
        hasMaternalChildServices: false,
        hasTrainedStaff: false,
      })
      expect(result.gapFields).toEqual(['hasTrainedStaff', 'hasMaternalChildServices'])
      expect(result.severity).toBe('HIGH')
      // Same cached rows: single MEDIUM gap → MEDIUM
      const mediumOnly = await analyzeHealthGaps({
        ...ALL_GOOD_HEALTH,
        hasMaternalChildServices: false,
      })
      expect(mediumOnly.severity).toBe('MEDIUM')
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

  describe('POPULATION (context-only type)', () => {
    test('analyzes to LOW with no gaps and never queries the registry', async () => {
      const result = await analyzeGaps('POPULATION', {
        totalPopulation: 5000,
        numberLivesLost: 3,
      })
      expect(result.hasGap).toBe(false)
      expect(result.gapFields).toEqual([])
      expect(result.severity).toBe('LOW')
      expect(prisma.question.findMany).not.toHaveBeenCalled()
    })

    test('derivePriorityFromGaps always yields LOW for POPULATION', () => {
      expect(derivePriorityFromGaps('POPULATION', { hasGap: true, gapFields: ['x'], severity: 'CRITICAL', recommendations: [] })).toBe('LOW')
    })

    test('derivePriorityFromGaps passes the gap severity through for gap types', async () => {
      ;(prisma.question.findMany as jest.Mock).mockImplementationOnce(async () => [
        { questionKey: 'hasFunctionalClinic', inverted: false, severity: 'CRITICAL', recommendation: null },
      ])
      const analysis = await analyzeHealthGaps({ ...ALL_GOOD_HEALTH, hasFunctionalClinic: false })
      expect(analysis.severity).toBe('CRITICAL')
      expect(derivePriorityFromGaps('HEALTH', analysis)).toBe('CRITICAL')
    })
  })

  describe('registry query caching', () => {
    test('GAP questions are queried once per type and cached across analyses', async () => {
      await analyzeHealthGaps(ALL_DIRE_HEALTH)
      expect(prisma.question.findMany).toHaveBeenCalledTimes(1)

      await analyzeHealthGaps(ALL_GOOD_HEALTH)
      await analyzeHealthGaps({ ...ALL_GOOD_HEALTH, hasMedicineSupply: false })
      // Still one registry query (30s per-type cache)
      expect(prisma.question.findMany).toHaveBeenCalledTimes(1)

      await analyzeFoodGaps({ isFoodSufficient: false, hasRegularMealAccess: true, hasInfantNutrition: true })
      // A different type triggers its own single query
      expect(prisma.question.findMany).toHaveBeenCalledTimes(2)
    })
  })
})
