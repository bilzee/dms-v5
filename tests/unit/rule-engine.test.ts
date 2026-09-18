import {
  evaluateRules,
  evaluateRefinements,
  interpolateMessage,
  num,
  BoolGateSchema,
  CompareSchema,
  WhenSchema,
  type Compare,
  type RegistryRuleRecord,
} from '@/lib/questions/rule-engine'
import {
  evaluateCrossFieldRules,
  type CrossFieldAssessmentType,
} from '@/lib/questions/cross-field-rules'
import { CROSS_FIELD_RULE_SEED } from '../../prisma/seed-rules'

/**
 * Unit — registry-driven rule engine (P10-2): operator matrix, gates
 * (BoolGate strict-=== and the aggregates' Compare `total > 0` form), sum
 * operands, legacy `num()` coercion, `{{value:}}`/`{{sum:}}` token
 * interpolation, deterministic ordering, skip-not-throw on invalid rows —
 * and the GOLDEN PARITY harness: per-type fixtures (violating, boundary,
 * clean) run through BOTH the legacy hardcoded module and the engine over
 * `CROSS_FIELD_RULE_SEED`, asserting deep-equal violation arrays.
 */

/** Projects the type's seed rows into the evaluator's record shape (getRules parity). */
function seedRowsFor(assessmentType: CrossFieldAssessmentType): RegistryRuleRecord[] {
  return CROSS_FIELD_RULE_SEED.filter((rule) => rule.assessmentType === assessmentType).map(
    (rule) => ({
      ruleKey: rule.ruleKey,
      kind: rule.kind,
      message: rule.message,
      when: rule.when,
      expression: rule.expression,
      referenceKeys: rule.referenceKeys,
      order: rule.order,
    })
  )
}

// ---------------------------------------------------------------------------
// Operator matrix
// ---------------------------------------------------------------------------

const OPERAND_FIXTURE: Record<string, number> = { a: 10, b: 5, c: 10, zero: 0, neg: -3 }

function compareWith(op: Compare['op'], left: number, right: number): RegistryRuleRecord {
  return {
    ruleKey: `matrix-${op}`,
    kind: 'REFINEMENT',
    message: `op ${op}`,
    expression: {
      op,
      left: { type: 'literal', value: left },
      right: { type: 'literal', value: right },
    },
    referenceKeys: ['a'],
    order: 1,
  }
}

describe('evaluateRules — operator matrix over literals', () => {
  test.each([
    ['>', 10, 5, true],
    ['>', 5, 10, false],
    ['>', 5, 5, false],
    ['>=', 5, 5, true],
    ['>=', 4, 5, false],
    ['<', 5, 10, true],
    ['<', 10, 5, false],
    ['<', 5, 5, false],
    ['<=', 5, 5, true],
    ['<=', 6, 5, false],
    ['==', 10, 10, true],
    ['==', 10, '10' as unknown as number, false],
    ['!=', 10, 5, true],
    ['!=', 10, 10, false],
  ] as const)('%s %p %p → %p', (op, left, right, expected) => {
    const violations = evaluateRules([compareWith(op, left, right)], OPERAND_FIXTURE)
    expect(violations.length).toBe(expected ? 1 : 0)
  })

  test('question and sum operands resolve through num() coercion', () => {
    const rule: RegistryRuleRecord = {
      ruleKey: 'sum-a-c',
      kind: 'REFINEMENT',
      message: 'sum exceeds a',
      expression: {
        op: '>',
        left: { type: 'sum', keys: ['a', 'c'] },
        right: { type: 'question', key: 'zero' },
      },
      referenceKeys: ['a'],
      order: 1,
    }
    // 10 + 10 = 20 > 0(coerced missing) → fires
    expect(evaluateRules([rule], OPERAND_FIXTURE)).toHaveLength(1)
  })

  test('sum of an empty key list cannot be expressed (zod min(1)) — literal 0 fallback never parses', () => {
    const bogus: RegistryRuleRecord = {
      ruleKey: 'bogus-sum',
      kind: 'REFINEMENT',
      message: 'never',
      expression: {
        op: '>',
        left: { type: 'sum', keys: [] },
        right: { type: 'literal', value: -1 },
      },
      referenceKeys: ['a'],
      order: 1,
    }
    expect(evaluateRules([bogus], OPERAND_FIXTURE)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Coercion parity (legacy num())
// ---------------------------------------------------------------------------

describe('num — legacy coercion parity', () => {
  test.each([
    [42, 42],
    [0, 0],
    [-3.5, -3.5],
    [Number.NaN, 0],
    [undefined, 0],
    [null, 0],
    ['5', 0], // no string parsing
    ['many', 0],
    [true, 0],
    [[], 0],
  ])('num(%p) === %p', (input, expected) => {
    expect(num({ key: input }, 'key')).toBe(expected)
  })
})

// ---------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------

describe('evaluateRules — when gates', () => {
  const expression: Compare = {
    op: '>',
    left: { type: 'question', key: 'count' },
    right: { type: 'literal', value: 0 },
  }

  test('BoolGate true: rule fires only when the answer is strictly true', () => {
    const rule: RegistryRuleRecord = {
      ruleKey: 'gate-bool',
      kind: 'REFINEMENT',
      message: 'contradiction',
      when: { questionKey: 'flagged', is: true },
      expression,
      referenceKeys: ['count'],
      order: 1,
    }
    expect(evaluateRules([rule], { flagged: true, count: 5 })).toHaveLength(1)
    expect(evaluateRules([rule], { flagged: false, count: 5 })).toEqual([])
    // Legacy isTrue strictness: the STRING 'true' is not the boolean true.
    expect(evaluateRules([rule], { flagged: 'true', count: 5 })).toEqual([])
    expect(evaluateRules([rule], { count: 5 })).toEqual([])
  })

  test('BoolGate false: rule fires when the answer is strictly false', () => {
    const rule: RegistryRuleRecord = {
      ruleKey: 'gate-bool-false',
      kind: 'REFINEMENT',
      message: 'negated',
      when: { questionKey: 'flagged', is: false },
      expression,
      referenceKeys: ['count'],
      order: 1,
    }
    expect(evaluateRules([rule], { flagged: false, count: 5 })).toHaveLength(1)
    expect(evaluateRules([rule], { flagged: true, count: 5 })).toEqual([])
    expect(evaluateRules([rule], { count: 5 })).toEqual([])
  })

  test('Compare-when: the legacy `totalPopulation > 0` aggregate gate', () => {
    const rule: RegistryRuleRecord = {
      ruleKey: 'gate-compare',
      kind: 'AGGREGATE',
      message: 'sum exceeds total',
      when: {
        op: '>',
        left: { type: 'question', key: 'totalPopulation' },
        right: { type: 'literal', value: 0 },
      },
      expression: {
        op: '>',
        left: { type: 'sum', keys: ['male', 'female'] },
        right: { type: 'question', key: 'totalPopulation' },
      },
      referenceKeys: ['male'],
      order: 1,
    }
    // Gate open and violated → fires.
    expect(evaluateRules([rule], { totalPopulation: 100, male: 60, female: 60 })).toHaveLength(1)
    // Gate open, equality passes (strictly-greater boundary).
    expect(evaluateRules([rule], { totalPopulation: 120, male: 60, female: 60 })).toEqual([])
    // Gate CLOSED (total <= 0) even though the sum would violate → skipped.
    expect(evaluateRules([rule], { totalPopulation: 0, male: 60, female: 60 })).toEqual([])
    expect(evaluateRules([rule], { totalPopulation: -5, male: 60, female: 60 })).toEqual([])
    // Missing total coerces to 0 → gate closed (legacy early return).
    expect(evaluateRules([rule], { male: 60, female: 60 })).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Token interpolation
// ---------------------------------------------------------------------------

describe('interpolateMessage — {{value:}} / {{sum:}} tokens', () => {
  const values = { male: 300, female: 250, total: 500, nothing: undefined }

  test('interpolates value and sum tokens with num() coercion', () => {
    expect(
      interpolateMessage('Male {{value:male}} + Female {{value:female}} = {{sum:male,female}} of {{value:total}}', values)
    ).toBe('Male 300 + Female 250 = 550 of 500')
  })

  test('missing keys coerce to 0 inside tokens', () => {
    expect(interpolateMessage('{{value:nothing}} and {{sum:male,missing}}', values)).toBe('0 and 300')
  })

  test('fractional numbers stringify via String(number)', () => {
    expect(interpolateMessage('{{value:h}}', { h: 1.5 })).toBe('1.5')
  })

  test('unknown tokens render literally', () => {
    expect(interpolateMessage('{{count:male}} and {{ value:male }}', values)).toBe(
      '{{count:male}} and 300'
    )
  })

  test('AGGREGATE seed messages reproduce the exact legacy strings', () => {
    expect(
      interpolateMessage(
        'The sum of Male ({{value:populationMale}}) and Female ({{value:populationFemale}}) population ({{sum:populationMale,populationFemale}}) exceeds the Total Population ({{value:totalPopulation}}).',
        { populationMale: 300, populationFemale: 300, totalPopulation: 500 }
      )
    ).toBe(
      'The sum of Male (300) and Female (300) population (600) exceeds the Total Population (500).'
    )
  })
})

// ---------------------------------------------------------------------------
// Deterministic order, skip-not-throw, kind mapping
// ---------------------------------------------------------------------------

describe('evaluateRules — ordering, invalid rows, kind mapping', () => {
  test('rules are evaluated by order asc, tie-break ruleKey — input order irrelevant', () => {
    const make = (ruleKey: string, order: number, key: string): RegistryRuleRecord => ({
      ruleKey,
      kind: 'REFINEMENT',
      message: `fires ${ruleKey}`,
      expression: { op: '>', left: { type: 'literal', value: 1 }, right: { type: 'literal', value: 0 } },
      referenceKeys: [key],
      order,
    })
    const shuffled = [make('z-rule', 3, 'z'), make('a-rule', 1, 'a'), make('b-rule', 2, 'b'), make('c-rule', 1, 'c')]
    const violations = evaluateRules(shuffled, {})
    expect(violations.map((v) => v.key)).toEqual(['a', 'c', 'b', 'z'])
    expect(violations.map((v) => v.message)).toEqual(['fires a-rule', 'fires c-rule', 'fires b-rule', 'fires z-rule'])
  })

  test('invalid rows are skipped wholesale, never thrown', () => {
    const valid: RegistryRuleRecord = {
      ruleKey: 'valid',
      kind: 'REFINEMENT',
      message: 'ok',
      expression: { op: '>', left: { type: 'literal', value: 1 }, right: { type: 'literal', value: 0 } },
      referenceKeys: ['k'],
      order: 2,
    }
    const broken: RegistryRuleRecord[] = [
      // Bad operator
      { ...valid, ruleKey: 'bad-op', expression: { op: '<>' as never, left: { type: 'literal', value: 1 }, right: { type: 'literal', value: 0 } }, order: 1 },
      // Missing expression
      { ...valid, ruleKey: 'no-expression', expression: undefined as unknown as Compare, order: 1 },
      // Operand of an unknown type
      { ...valid, ruleKey: 'bad-operand', expression: { op: '>', left: { type: 'constant' } as never, right: { type: 'literal', value: 0 } }, order: 1 },
      // Empty referenceKeys
      { ...valid, ruleKey: 'no-refs', referenceKeys: [], order: 1 },
      // referenceKeys not a string array
      { ...valid, ruleKey: 'bad-refs', referenceKeys: 'k' as unknown as string[], order: 1 },
      // Invalid when shape
      { ...valid, ruleKey: 'bad-when', when: { questionKey: 'k', is: 'yes' }, order: 1 },
    ]
    const violations = evaluateRules([...broken, valid], { k: 1 })
    expect(violations).toEqual([
      { key: 'k', message: 'ok', kind: 'refinement' },
    ])
  })

  test('violation key is referenceKeys[0]; DB kinds map to legacy lowercase', () => {
    const base = (kind: string): RegistryRuleRecord => ({
      ruleKey: 'kind-mapping',
      kind,
      message: 'm',
      expression: { op: '>', left: { type: 'literal', value: 1 }, right: { type: 'literal', value: 0 } },
      referenceKeys: ['first', 'second'],
      order: 1,
    })
    expect(evaluateRules([base('REFINEMENT')], {})).toEqual([
      { key: 'first', message: 'm', kind: 'refinement' },
    ])
    expect(evaluateRules([base('AGGREGATE')], {})).toEqual([
      { key: 'first', message: 'm', kind: 'aggregate' },
    ])
    // Defensive default: anything unexpected maps to 'refinement'.
    expect(evaluateRules([base('weird')], {})[0].kind).toBe('refinement')
  })

  test('evaluateRefinements drops aggregates (server enforcement scope)', () => {
    const all = seedRowsFor('POPULATION')
    // Gender sum exceeds total → 1 refinement + 1 aggregate (same predicate).
    const violating = { totalPopulation: 500, populationMale: 300, populationFemale: 300 }
    expect(evaluateRules(all, violating)).toHaveLength(2)
    expect(evaluateRefinements(all, violating)).toEqual([
      {
        key: 'populationMale',
        kind: 'refinement',
        message: 'The sum of Male and Female population cannot exceed the Total Population',
      },
    ])
  })
})

// ---------------------------------------------------------------------------
// Shared zod grammar exports (admin API boundary === evaluator boundary)
// ---------------------------------------------------------------------------

describe('AST schema exports', () => {
  test('CompareSchema accepts the seeded compare shapes and rejects malformed ones', () => {
    expect(
      CompareSchema.safeParse({ op: '>', left: { type: 'sum', keys: ['a'] }, right: { type: 'literal', value: 0 } }).success
    ).toBe(true)
    expect(
      CompareSchema.safeParse({ op: '~', left: { type: 'literal', value: 1 }, right: { type: 'literal', value: 0 } }).success
    ).toBe(false)
  })

  test('BoolGateSchema / WhenSchema discriminate the two when shapes', () => {
    expect(BoolGateSchema.safeParse({ questionKey: 'k', is: true }).success).toBe(true)
    expect(BoolGateSchema.safeParse({ questionKey: 'k', is: 'true' }).success).toBe(false)
    expect(WhenSchema.safeParse({ questionKey: 'k', is: false }).success).toBe(true)
    expect(
      WhenSchema.safeParse({ op: '>', left: { type: 'question', key: 't' }, right: { type: 'literal', value: 0 } }).success
    ).toBe(true)
    expect(WhenSchema.safeParse({ nope: true }).success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// GOLDEN PARITY — legacy module vs engine-over-seed
// ---------------------------------------------------------------------------

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

describe('golden parity — engine-over-CROSS_FIELD_RULE_SEED === legacy evaluateCrossFieldRules', () => {
  type Fixture = [string, CrossFieldAssessmentType, Record<string, unknown>]
  const fixtures: Fixture[] = [
    // --- POPULATION: clean ---
    ['POPULATION clean', 'POPULATION', VALID_POPULATION],
    // --- POPULATION: violating — gender refinement + aggregate twins ---
    ['POPULATION gender sum violates', 'POPULATION', { ...VALID_POPULATION, populationFemale: 300 }],
    // --- POPULATION: violating — the maximal multi-fire case ---
    [
      'POPULATION multi-fire (refinements before aggregates)',
      'POPULATION',
      { ...VALID_POPULATION, populationMale: 300, populationFemale: 300, separatedChildren: 600 },
    ],
    // --- POPULATION: violating — vulnerable-sum aggregate alone ---
    [
      'POPULATION vulnerable aggregate alone',
      'POPULATION',
      {
        ...VALID_POPULATION,
        populationUnder5: 100,
        pregnantWomen: 100,
        lactatingMothers: 100,
        personWithDisability: 100,
        elderlyPersons: 100,
        separatedChildren: 100,
      },
    ],
    // --- POPULATION: violating — casualty aggregate interpolation ---
    [
      'POPULATION casualty aggregate',
      'POPULATION',
      { ...VALID_POPULATION, numberLivesLost: 250, numberInjured: 300 },
    ],
    // --- POPULATION: boundary — equality passes everywhere ---
    [
      'POPULATION boundary (sums equal the total)',
      'POPULATION',
      {
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
      },
    ],
    // --- POPULATION: zero total — 8 refinements, aggregates gated ---
    [
      'POPULATION zero total (aggregates gated)',
      'POPULATION',
      {
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
      },
    ],
    // --- POPULATION: coercion — junk strings count as 0 ---
    [
      'POPULATION junk strings coerce to 0',
      'POPULATION',
      { ...VALID_POPULATION, populationMale: 'many', populationFemale: 'few' },
    ],
    // --- POPULATION: empty map — refinements 0>0 never fire, aggregates gated ---
    ['POPULATION empty map', 'POPULATION', {}],
    // --- FOOD ---
    ['FOOD clean', 'FOOD', { isFoodSufficient: true, availableFoodDurationDays: 14, additionalFoodRequiredPersons: 0 }],
    [
      'FOOD both contradictions',
      'FOOD',
      { isFoodSufficient: true, availableFoodDurationDays: 2, additionalFoodRequiredPersons: 40 },
    ],
    // FOOD boundary: exactly 7 days passes the < 7 rule.
    ['FOOD boundary 7 days', 'FOOD', { isFoodSufficient: true, availableFoodDurationDays: 7, additionalFoodRequiredPersons: 0 }],
    // Gate closed: insufficient food may declare anything.
    [
      'FOOD gate closed',
      'FOOD',
      { isFoodSufficient: false, availableFoodDurationDays: 2, additionalFoodRequiredPersons: 40 },
    ],
    // Gate strictness: string 'true' is NOT the boolean true (legacy isTrue).
    [
      'FOOD gate strict (string true ≠ true)',
      'FOOD',
      { isFoodSufficient: 'true', availableFoodDurationDays: 2, additionalFoodRequiredPersons: 40 },
    ],
    // --- WASH ---
    ['WASH violating', 'WASH', { areLatrinesSufficient: true, functionalLatrinesAvailable: 0 }],
    ['WASH gate closed', 'WASH', { areLatrinesSufficient: false, functionalLatrinesAvailable: 0 }],
    ['WASH clean', 'WASH', { areLatrinesSufficient: true, functionalLatrinesAvailable: 10 }],
    // --- SHELTER ---
    ['SHELTER violating', 'SHELTER', { areSheltersSufficient: true, numberSheltersRequired: 5 }],
    ['SHELTER gate closed', 'SHELTER', { areSheltersSufficient: false, numberSheltersRequired: 5 }],
    // --- No-rule types ---
    ['HEALTH junk map', 'HEALTH', { anything: 999, somethingElse: true }],
    ['SECURITY junk map', 'SECURITY', { anything: 999, somethingElse: true }],
  ]

  test.each(fixtures)('%s → deep-equal arrays (order included)', (_label, assessmentType, values) => {
    const legacy = evaluateCrossFieldRules(assessmentType, values)
    const engine = evaluateRules(seedRowsFor(assessmentType), values)
    expect(engine).toEqual(legacy)
  })

  test('the seed itself is complete: 15 rows, POPULATION 11 / FOOD 2 / WASH 1 / SHELTER 1', () => {
    expect(CROSS_FIELD_RULE_SEED).toHaveLength(15)
    expect(CROSS_FIELD_RULE_SEED.filter((r) => r.assessmentType === 'POPULATION')).toHaveLength(11)
    expect(CROSS_FIELD_RULE_SEED.filter((r) => r.assessmentType === 'POPULATION' && r.kind === 'REFINEMENT')).toHaveLength(8)
    expect(CROSS_FIELD_RULE_SEED.filter((r) => r.assessmentType === 'POPULATION' && r.kind === 'AGGREGATE')).toHaveLength(3)
    expect(CROSS_FIELD_RULE_SEED.filter((r) => r.assessmentType === 'FOOD')).toHaveLength(2)
    expect(CROSS_FIELD_RULE_SEED.filter((r) => r.assessmentType === 'WASH')).toHaveLength(1)
    expect(CROSS_FIELD_RULE_SEED.filter((r) => r.assessmentType === 'SHELTER')).toHaveLength(1)
  })

  test('POPULATION seed orders reproduce the legacy output sequence (8 refinements then 3 aggregates)', () => {
    const population = seedRowsFor('POPULATION')
    expect(population.map((rule) => rule.ruleKey)).toEqual([
      'population-male-female-vs-total',
      'population-under5-vs-total',
      'pregnant-women-vs-total',
      'lactating-mothers-vs-total',
      'persons-with-disability-vs-total',
      'elderly-persons-vs-total',
      'separated-children-vs-total',
      'lives-lost-injured-vs-total',
      'population-gender-sum-exceeds-total',
      'population-vulnerable-sum-exceeds-total',
      'population-casualty-sum-exceeds-total',
    ])
  })
})
