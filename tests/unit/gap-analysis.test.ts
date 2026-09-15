import {
  analyzeGaps,
  analyzeHealthGaps,
  analyzeFoodGaps,
  analyzeWASHGaps,
  analyzeShelterGaps,
  analyzeSecurityGaps,
  analyzeGapsFromSnapshot,
  derivePriorityFromGaps,
  getGapFieldSeverity,
  clearGapQuestionCache,
} from '@/lib/services/gap-analysis.service'

/**
 * Unit — registry-driven gap analysis (P3 engine wrapper).
 *
 * The ONLY mocked seam is `@/lib/db/client` (the registry question source):
 * `prisma.question.findMany` returns the catalog's real questions (ALL rows of
 * the type, regardless of category), so the code under test — wrapper
 * structure projection, engine delegation, field detection incl. inverted
 * flags, severity MAX roll-up, recommendation mapping, per-type caching,
 * POPULATION-through-the-same-path, priority derivation — all run against the
 * real catalog definitions.
 *
 * tests/setup.ts globally mocks '@prisma/client' with the const-object enums
 * (AssessmentType / Priority) the service value-imports; no DB access happens.
 */
jest.mock('@/lib/db/client', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { QUESTION_CATALOG } = require('@/lib/questions/registry-validation')
  const registryRowsFor = (assessmentType?: string) =>
    QUESTION_CATALOG.filter((entry: any) => !assessmentType || entry.assessmentType === assessmentType)
      .flatMap((entry: any) =>
        entry.sections.flatMap((section: any, sectionIdx: number) =>
          section.questions.map((question: any, questionIdx: number) => ({
            questionKey: question.questionKey,
            label: question.label,
            category: question.category,
            inverted: question.inverted ?? false,
            gapLabel: question.gapLabel ?? null,
            recommendation: question.recommendation ?? null,
            severity: question.severity ?? 'LOW',
            order: question.order ?? questionIdx + 1,
            isActive: true,
            section: { order: section.order ?? sectionIdx + 1, isActive: true },
          }))
        )
      )
  const findMany = jest.fn(async (args?: { where?: { assessmentType?: string } }) =>
    registryRowsFor(args?.where?.assessmentType)
  )
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
        {
          questionKey: 'hasTrainedStaff',
          label: 'Trained Staff',
          category: 'GAP',
          inverted: false,
          gapLabel: 'No trained staff',
          recommendation: null,
          severity: 'HIGH',
          order: 3,
          isActive: true,
          section: { order: 1, isActive: true },
        },
        {
          questionKey: 'hasMaternalChildServices',
          label: 'Maternal Services',
          category: 'GAP',
          inverted: false,
          gapLabel: 'No maternal services',
          recommendation: null,
          severity: 'MEDIUM',
          order: 6,
          isActive: true,
          section: { order: 1, isActive: true },
        },
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

    test('deactivated registry rows still resolve severity through the ladder', async () => {
      // The registry row for hasTrainedStaff is INACTIVE (removed from new
      // forms) but still lives in the table: the ladder keeps resolving it
      // for stored snapshots. The structure only offers active questions, so
      // the engine never fabricates a row — proven via analyzeGapsFromSnapshot.
      ;(prisma.question.findMany as jest.Mock).mockImplementationOnce(async () => [
        {
          questionKey: 'hasTrainedStaff',
          label: 'Trained Staff',
          category: 'GAP',
          inverted: false,
          gapLabel: 'No trained staff',
          recommendation: null,
          severity: 'HIGH',
          order: 3,
          isActive: false,
          section: { order: 1, isActive: true },
        },
      ])
      const snapshot = {
        sections: [
          {
            order: 1,
            questions: [
              {
                key: 'hasTrainedStaff',
                label: 'Trained Staff',
                category: 'GAP',
                inverted: false,
                gapLabel: 'No trained staff',
                recommendation: null,
                order: 3,
              },
            ],
          },
        ],
      }
      const result = await analyzeGapsFromSnapshot('HEALTH', snapshot, { hasTrainedStaff: false })
      expect(result.gapFields).toEqual(['hasTrainedStaff'])
      expect(result.severity).toBe('HIGH')
      expect(result.rows[0].source).toBe('registry')
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

  describe('engine extensions on the stored shape', () => {
    test('rows expose the per-question truth table (registry ladder source)', async () => {
      const result = await analyzeHealthGaps(ALL_GOOD_HEALTH)
      expect(result.rows).toHaveLength(6)
      expect(result.rows.map((row) => row.key)).toEqual([
        'hasFunctionalClinic',
        'hasEmergencyServices',
        'hasTrainedStaff',
        'hasMedicineSupply',
        'hasMedicalSupplies',
        'hasMaternalChildServices',
      ])
      for (const row of result.rows) {
        expect(row.source).toBe('registry')
        expect(row.severity).toBe('MEDIUM')
        expect(row.unanswered).toBe(false)
        expect(typeof row.label).toBe('string')
      }
      expect(result.unanswered).toEqual([])
    })

    test('missing answers are flagged, never scored as gaps', async () => {
      const result = await analyzeHealthGaps({}) // nothing answered
      expect(result.hasGap).toBe(false)
      expect(result.gapFields).toEqual([])
      expect(result.severity).toBe('LOW')
      expect(result.unanswered).toHaveLength(6)
      expect(result.rows.every((row) => row.unanswered)).toBe(true)
    })

    test('partial answers → only the answered gap triggers; the rest are unanswered', async () => {
      const partial = await analyzeFoodGaps({ isFoodSufficient: false })
      expect(partial.gapFields).toEqual(['isFoodSufficient'])
      expect(partial.unanswered).toEqual(['hasRegularMealAccess', 'hasInfantNutrition'])
    })

    test('getGapFieldSeverity resolves from the registry (MEDIUM if unknown)', async () => {
      expect(await getGapFieldSeverity('HEALTH', 'hasFunctionalClinic')).toBe('MEDIUM')
      expect(await getGapFieldSeverity('HEALTH', 'noSuchQuestion')).toBe('MEDIUM')
    })

    test('getGapFieldSeverity returns the actual severity, isActive-agnostic', async () => {
      ;(prisma.question.findMany as jest.Mock).mockImplementationOnce(async () => [
        {
          questionKey: 'hasTrainedStaff',
          label: 'Trained staff',
          category: 'GAP',
          inverted: false,
          gapLabel: null,
          recommendation: null,
          severity: 'CRITICAL',
          order: 3,
          isActive: false, // deactivated rows still resolve (ladder semantics)
          section: { order: 1, isActive: true },
        },
      ])
      expect(await getGapFieldSeverity('HEALTH', 'hasTrainedStaff')).toBe('CRITICAL')
    })

    test('getGapFieldSeverity normalizes non-gap severities (UNCLASSIFIED → MEDIUM)', async () => {
      ;(prisma.question.findMany as jest.Mock).mockImplementationOnce(async () => [
        {
          questionKey: 'hasTrainedStaff',
          label: 'Trained staff',
          category: 'GAP',
          inverted: false,
          gapLabel: null,
          recommendation: null,
          severity: 'UNCLASSIFIED',
          order: 3,
          isActive: true,
          section: { order: 1, isActive: true },
        },
      ])
      expect(await getGapFieldSeverity('HEALTH', 'hasTrainedStaff')).toBe('MEDIUM')
    })
  })

  describe('POPULATION (context-only type)', () => {
    test('derives LOW through the same engine path (zero GAP questions)', async () => {
      const result = await analyzeGaps('POPULATION', {
        totalPopulation: 5000,
        numberLivesLost: 3,
      })
      expect(result.hasGap).toBe(false)
      expect(result.gapFields).toEqual([])
      expect(result.severity).toBe('LOW')
      expect(result.rows).toEqual([])
      // No special-casing: POPULATION loads the registry like any other type.
      expect(prisma.question.findMany).toHaveBeenCalledTimes(1)
    })

    test('derivePriorityFromGaps always yields LOW for POPULATION', () => {
      expect(derivePriorityFromGaps('POPULATION', { hasGap: true, gapFields: ['x'], severity: 'CRITICAL', recommendations: [] } as never)).toBe('LOW')
    })

    test('derivePriorityFromGaps passes the gap severity through for gap types', async () => {
      ;(prisma.question.findMany as jest.Mock).mockImplementationOnce(async () => [
        {
          questionKey: 'hasFunctionalClinic',
          label: 'Functional Clinic',
          category: 'GAP',
          inverted: false,
          gapLabel: 'No functional clinic',
          recommendation: null,
          severity: 'CRITICAL',
          order: 1,
          isActive: true,
          section: { order: 1, isActive: true },
        },
      ])
      const analysis = await analyzeHealthGaps({ ...ALL_GOOD_HEALTH, hasFunctionalClinic: false })
      expect(analysis.severity).toBe('CRITICAL')
      expect(derivePriorityFromGaps('HEALTH', analysis)).toBe('CRITICAL')
    })
  })

  describe('registry query caching', () => {
    test('the registry view is queried once per type and cached across analyses', async () => {
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
