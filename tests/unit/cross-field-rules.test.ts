import {
  crossFieldSuperRefine,
  evaluateCrossFieldRules,
  hasCrossFieldViolations,
  type SuperRefineContext,
} from '@/lib/questions/rule-engine'

/**
 * Unit — cross-field rules semantics (P4, re-homed in P10-3): the EXACT
 * refinement predicates of the six deleted hardcoded forms, keyed by registry
 * question keys, plus the three legacy live aggregate alerts (Population sums)
 * with their interpolated messages. The hardcoded module was deleted in
 * P10-3 — these pins now run against its seed-backed parity shims in
 * `rule-engine.ts` (same signatures; pre-deletion legacy parity is archived
 * in `_bmad-output/implementation-artifacts/dqr-p10-3-parity-final.log`).
 * Pure functions — deterministic order, no I/O.
 */

const VALID_POPULATION = {
  totalPopulation: 500,
  totalHouseholds: 100,
  populationMale: 240,
  populationFemale: 250,
  populationUnder5: 80,
  pregnantWomen: 20,
  lactatingMothers: 15,
  personWithDisability: 10,
  elderlyPersons: 40,
  separatedChildren: 5,
  numberLivesLost: 2,
  numberInjured: 12,
}

describe('evaluateCrossFieldRules — POPULATION refinements (legacy parity)', () => {
  test('consistent population data produces no violations', () => {
    expect(evaluateCrossFieldRules('POPULATION', VALID_POPULATION)).toEqual([])
  })

  test('male + female exceeding total → flags populationMale', () => {
    const violations = evaluateCrossFieldRules('POPULATION', {
      ...VALID_POPULATION,
      populationFemale: 300,
    })
    // The live gender aggregate (same predicate) co-fires — refinements only:
    const refinements = violations.filter((violation) => violation.kind === 'refinement')
    expect(refinements).toEqual([
      {
        key: 'populationMale',
        kind: 'refinement',
        message: 'The sum of Male and Female population cannot exceed the Total Population',
      },
    ])
  })

  test.each([
    ['populationUnder5', 'Children Under 5 cannot exceed the Total Population'],
    ['pregnantWomen', 'Pregnant Women cannot exceed the Total Population'],
    ['lactatingMothers', 'Lactating Mothers cannot exceed the Total Population'],
    ['personWithDisability', 'Persons with Disabilities cannot exceed the Total Population'],
    ['elderlyPersons', 'Elderly Persons (60+) cannot exceed the Total Population'],
    ['separatedChildren', 'Separated Children cannot exceed the Total Population'],
  ] as const)('%s beyond the total → flagged with its legacy message', (key, message) => {
    const violations = evaluateCrossFieldRules('POPULATION', {
      ...VALID_POPULATION,
      [key]: 501,
    })
    // A vulnerable-group exceedance also trips the live vulnerable-sum alert,
    // so compare the refinement violations only.
    const refinements = violations.filter((violation) => violation.kind === 'refinement')
    expect(refinements).toEqual([{ key, kind: 'refinement', message }])
  })

  test('lives lost + injured exceeding total → flags numberLivesLost', () => {
    const violations = evaluateCrossFieldRules('POPULATION', {
      ...VALID_POPULATION,
      numberLivesLost: 250,
      numberInjured: 251,
    })
    const refinements = violations.filter((violation) => violation.kind === 'refinement')
    expect(refinements).toEqual([
      {
        key: 'numberLivesLost',
        kind: 'refinement',
        message: 'The sum of Lives Lost and Injured Persons cannot exceed the Total Population',
      },
    ])
  })

  test('sums equal to the total are allowed (strictly greater fires)', () => {
    const result = evaluateCrossFieldRules('POPULATION', {
      ...VALID_POPULATION,
      populationMale: 500,
      populationFemale: 0,
      populationUnder5: 500,
      pregnantWomen: 0,
      lactatingMothers: 0,
      personWithDisability: 0,
      elderlyPersons: 0,
      separatedChildren: 0,
      numberLivesLost: 500,
      numberInjured: 0,
    })
    expect(result).toEqual([])
  })

  test('all 8 refinements fire together on a zero-total map (and aggregates stay gated)', () => {
    const violations = evaluateCrossFieldRules('POPULATION', {
      totalPopulation: 0,
      populationMale: 1,
      populationFemale: 1,
      populationUnder5: 1,
      pregnantWomen: 1,
      lactatingMothers: 1,
      personWithDisability: 1,
      elderlyPersons: 1,
      separatedChildren: 1,
      numberLivesLost: 1,
      numberInjured: 1,
    })
    expect(violations).toHaveLength(8)
    expect(violations.every((violation) => violation.kind === 'refinement')).toBe(true)
    expect(violations.map((violation) => violation.key)).toEqual([
      'populationMale',
      'populationUnder5',
      'pregnantWomen',
      'lactatingMothers',
      'personWithDisability',
      'elderlyPersons',
      'separatedChildren',
      'numberLivesLost',
    ])
  })

  test('non-number values count as 0 (legacy num() semantics)', () => {
    const result = evaluateCrossFieldRules('POPULATION', {
      ...VALID_POPULATION,
      populationMale: 'many',
      populationFemale: 'few',
    })
    expect(result).toEqual([])
  })
})

describe('evaluateCrossFieldRules — POPULATION aggregates (legacy live alerts)', () => {
  test('gender sum alert interpolates the exact legacy message', () => {
    const violations = evaluateCrossFieldRules('POPULATION', {
      ...VALID_POPULATION,
      populationMale: 300,
      populationFemale: 300,
    })
    const aggregate = violations.find((violation) => violation.kind === 'aggregate')
    expect(aggregate).toEqual({
      key: 'populationMale',
      kind: 'aggregate',
      message:
        'The sum of Male (300) and Female (300) population (600) exceeds the Total Population (500).',
    })
    // The refinement twin (same predicate) fires alongside the live alert.
    expect(violations.filter((violation) => violation.kind === 'refinement')).toHaveLength(1)
  })

  test('vulnerable-groups sum fires on its own when every group is within the total', () => {
    const violations = evaluateCrossFieldRules('POPULATION', {
      ...VALID_POPULATION,
      populationUnder5: 100,
      pregnantWomen: 100,
      lactatingMothers: 100,
      personWithDisability: 100,
      elderlyPersons: 100,
      separatedChildren: 100,
    })
    expect(violations).toEqual([
      {
        key: 'populationUnder5',
        kind: 'aggregate',
        message:
          'The sum of vulnerable groups (600) exceeds the Total Population (500). Please verify the numbers.',
      },
    ])
  })

  test('casualty sum alert interpolates the exact legacy message', () => {
    const violations = evaluateCrossFieldRules('POPULATION', {
      ...VALID_POPULATION,
      numberLivesLost: 250,
      numberInjured: 300,
    })
    const aggregate = violations.find((violation) => violation.kind === 'aggregate')
    expect(aggregate).toEqual({
      key: 'numberLivesLost',
      kind: 'aggregate',
      message:
        'The sum of Lives Lost (250) and Injured Persons (300) (550) exceeds the Total Population (500).',
    })
  })

  test('aggregates are gated until a total population is entered (total <= 0)', () => {
    const violations = evaluateCrossFieldRules('POPULATION', {
      totalPopulation: 0,
      populationMale: 0,
      populationFemale: 0,
      populationUnder5: 0,
      pregnantWomen: 0,
      lactatingMothers: 0,
      personWithDisability: 0,
      elderlyPersons: 0,
      separatedChildren: 0,
      numberLivesLost: 0,
      numberInjured: 0,
    })
    expect(violations).toEqual([])
  })

  test('refinements run before aggregates in deterministic order', () => {
    const violations = evaluateCrossFieldRules('POPULATION', {
      ...VALID_POPULATION,
      populationMale: 300,
      populationFemale: 300,
      separatedChildren: 600,
    })
    expect(violations.map((violation) => violation.kind)).toEqual([
      'refinement', // populationMale (gender sum)
      'refinement', // separatedChildren
      'aggregate', // populationMale (live gender alert)
      'aggregate', // populationUnder5 (live vulnerable-sum alert)
    ])
    expect(violations.map((violation) => violation.key)).toEqual([
      'populationMale',
      'separatedChildren',
      'populationMale',
      'populationUnder5',
    ])
  })
})

describe('evaluateCrossFieldRules — FOOD refinements (legacy parity)', () => {
  const valid = {
    isFoodSufficient: true,
    availableFoodDurationDays: 14,
    additionalFoodRequiredPersons: 0,
  }

  test('sufficient food with ample duration passes', () => {
    expect(evaluateCrossFieldRules('FOOD', valid)).toEqual([])
  })

  test('sufficient but additional persons required → flagged', () => {
    expect(evaluateCrossFieldRules('FOOD', { ...valid, additionalFoodRequiredPersons: 10 })).toEqual([
      {
        key: 'additionalFoodRequiredPersons',
        kind: 'refinement',
        message: 'Food marked sufficient but additional persons required',
      },
    ])
  })

  test('sufficient but duration under 7 days → flagged (exactly 7 is fine)', () => {
    expect(evaluateCrossFieldRules('FOOD', { ...valid, availableFoodDurationDays: 3 })).toEqual([
      {
        key: 'availableFoodDurationDays',
        kind: 'refinement',
        message: 'Food marked sufficient but duration is less than 7 days',
      },
    ])
    expect(evaluateCrossFieldRules('FOOD', { ...valid, availableFoodDurationDays: 7 })).toEqual([])
  })

  test('both FOOD contradictions fire together', () => {
    const violations = evaluateCrossFieldRules('FOOD', {
      ...valid,
      availableFoodDurationDays: 2,
      additionalFoodRequiredPersons: 40,
    })
    expect(violations).toHaveLength(2)
  })

  test('insufficient food may declare short duration AND additional needs', () => {
    expect(
      evaluateCrossFieldRules('FOOD', {
        ...valid,
        isFoodSufficient: false,
        availableFoodDurationDays: 2,
        additionalFoodRequiredPersons: 40,
      })
    ).toEqual([])
  })
})

describe('evaluateCrossFieldRules — WASH refinement (legacy parity)', () => {
  test('latrines sufficient but none functional → flagged', () => {
    expect(
      evaluateCrossFieldRules('WASH', { areLatrinesSufficient: true, functionalLatrinesAvailable: 0 })
    ).toEqual([
      {
        key: 'functionalLatrinesAvailable',
        kind: 'refinement',
        message: 'Latrines marked sufficient but none are functional',
      },
    ])
  })

  test('latrines insufficient with zero functional → allowed', () => {
    expect(
      evaluateCrossFieldRules('WASH', { areLatrinesSufficient: false, functionalLatrinesAvailable: 0 })
    ).toEqual([])
  })

  test('latrines sufficient with functional stock → allowed', () => {
    expect(
      evaluateCrossFieldRules('WASH', { areLatrinesSufficient: true, functionalLatrinesAvailable: 10 })
    ).toEqual([])
  })
})

describe('evaluateCrossFieldRules — SHELTER refinement (legacy parity)', () => {
  test('shelters sufficient but more required → flagged', () => {
    expect(
      evaluateCrossFieldRules('SHELTER', { areSheltersSufficient: true, numberSheltersRequired: 5 })
    ).toEqual([
      {
        key: 'numberSheltersRequired',
        kind: 'refinement',
        message: 'Shelters marked sufficient but additional shelters required',
      },
    ])
  })

  test('shelters insufficient requiring more → allowed', () => {
    expect(
      evaluateCrossFieldRules('SHELTER', { areSheltersSufficient: false, numberSheltersRequired: 5 })
    ).toEqual([])
  })
})

describe('evaluateCrossFieldRules — HEALTH and SECURITY have no cross-field rules', () => {
  test('any answers map produces zero violations', () => {
    const junk = { anything: 999, somethingElse: true, more: ['x'] }
    expect(evaluateCrossFieldRules('HEALTH', junk)).toEqual([])
    expect(evaluateCrossFieldRules('SECURITY', junk)).toEqual([])
  })
})

describe('hasCrossFieldViolations', () => {
  test('narrows to a boolean for submit gating', () => {
    expect(
      hasCrossFieldViolations('FOOD', {
        isFoodSufficient: true,
        availableFoodDurationDays: 14,
        additionalFoodRequiredPersons: 5,
      })
    ).toBe(true)
    expect(
      hasCrossFieldViolations('FOOD', {
        isFoodSufficient: true,
        availableFoodDurationDays: 14,
        additionalFoodRequiredPersons: 0,
      })
    ).toBe(false)
  })
})

describe('crossFieldSuperRefine (submit-time zod parity)', () => {
  function makeContext() {
    const addIssue = jest.fn()
    const ctx = { addIssue } as unknown as SuperRefineContext
    return { ctx, addIssue }
  }

  test('adds one custom issue per refinement violation on the legacy path', () => {
    const { ctx, addIssue } = makeContext()
    crossFieldSuperRefine('POPULATION')(
      { ...VALID_POPULATION, populationMale: 300, populationFemale: 300 },
      ctx
    )
    expect(addIssue).toHaveBeenCalledTimes(1)
    expect(addIssue).toHaveBeenCalledWith({
      code: 'custom',
      path: ['populationMale'],
      message: 'The sum of Male and Female population cannot exceed the Total Population',
    })
  })

  test('aggregates are live-only and never become zod issues', () => {
    const { ctx, addIssue } = makeContext()
    // Every vulnerable group is within the total, but their sum is not —
    // exactly one (aggregate) violation, which superRefine must skip.
    crossFieldSuperRefine('POPULATION')(
      {
        ...VALID_POPULATION,
        populationUnder5: 100,
        pregnantWomen: 100,
        lactatingMothers: 100,
        personWithDisability: 100,
        elderlyPersons: 100,
        separatedChildren: 100,
      },
      ctx
    )
    expect(addIssue).not.toHaveBeenCalled()
  })

  test('FOOD violation maps to the additionalFoodRequiredPersons path', () => {
    const { ctx, addIssue } = makeContext()
    crossFieldSuperRefine('FOOD')(
      { isFoodSufficient: true, availableFoodDurationDays: 14, additionalFoodRequiredPersons: 10 },
      ctx
    )
    expect(addIssue).toHaveBeenCalledWith({
      code: 'custom',
      path: ['additionalFoodRequiredPersons'],
      message: 'Food marked sufficient but additional persons required',
    })
  })

  test('consistent answers add no issues', () => {
    const { ctx, addIssue } = makeContext()
    crossFieldSuperRefine('POPULATION')(VALID_POPULATION, ctx)
    crossFieldSuperRefine('WASH')({ areLatrinesSufficient: true, functionalLatrinesAvailable: 4 }, ctx)
    expect(addIssue).not.toHaveBeenCalled()
  })
})
