/**
 * Dynamic Question Registry — cross-field validation rules.
 *
 * Ports the EXACT refinement predicates of the deleted hardcoded forms (P4)
 * so the dynamic form enforces them at submit time (superRefine parity with
 * the legacy zod schemas) and live (destructive inline alert + submit
 * disabled), keyed by registry question keys:
 *
 * - POPULATION — the sum-exceeds-total refinements from the legacy
 *   PopulationAssessmentForm zod schema (each flags the first field's key),
 *   plus the three live aggregate alerts the form rendered (gender sum,
 *   vulnerable-groups sum, casualty sum) with their interpolated messages.
 * - FOOD / WASH / SHELTER — the "sufficient but contradicted" refinements
 *   from the legacy typed zod schemas (see src/lib/validation/rapid-assessment.ts
 *   history): FOOD 2, WASH 1, SHELTER 1.
 *
 * HEALTH and SECURITY have no cross-field rules. Everything here is a pure
 * function of the answers map — no I/O, deterministic order.
 */

export type CrossFieldAssessmentType = 'HEALTH' | 'POPULATION' | 'FOOD' | 'WASH' | 'SHELTER' | 'SECURITY'

export type CrossFieldKind = 'refinement' | 'aggregate'

export interface CrossFieldViolation {
  /** Registry question key the violation attaches to (legacy zod `path`). */
  key: string
  message: string
  /**
   * 'refinement' — exact legacy zod refinement predicate (submit-time
   *                superRefine parity).
   * 'aggregate'  — legacy live-form check rendered as a destructive alert
   *                and disabling submit (Population sums).
   */
  kind: CrossFieldKind
}

type Values = Record<string, unknown>

function num(values: Values, key: string): number {
  const value = values[key]
  return typeof value === 'number' && !Number.isNaN(value) ? value : 0
}

function isTrue(values: Values, key: string): boolean {
  return values[key] === true
}

/** Field exceeds the total population. */
function exceedsTotal(values: Values, key: string): boolean {
  return num(values, key) > num(values, 'totalPopulation')
}

const populationRefinements: Array<{ key: string; test: (values: Values) => boolean; message: string }> = [
  {
    key: 'populationMale',
    test: (v) => num(v, 'populationMale') + num(v, 'populationFemale') > num(v, 'totalPopulation'),
    message: 'The sum of Male and Female population cannot exceed the Total Population',
  },
  {
    key: 'populationUnder5',
    test: (v) => exceedsTotal(v, 'populationUnder5'),
    message: 'Children Under 5 cannot exceed the Total Population',
  },
  {
    key: 'pregnantWomen',
    test: (v) => exceedsTotal(v, 'pregnantWomen'),
    message: 'Pregnant Women cannot exceed the Total Population',
  },
  {
    key: 'lactatingMothers',
    test: (v) => exceedsTotal(v, 'lactatingMothers'),
    message: 'Lactating Mothers cannot exceed the Total Population',
  },
  {
    key: 'personWithDisability',
    test: (v) => exceedsTotal(v, 'personWithDisability'),
    message: 'Persons with Disabilities cannot exceed the Total Population',
  },
  {
    key: 'elderlyPersons',
    test: (v) => exceedsTotal(v, 'elderlyPersons'),
    message: 'Elderly Persons (60+) cannot exceed the Total Population',
  },
  {
    key: 'separatedChildren',
    test: (v) => exceedsTotal(v, 'separatedChildren'),
    message: 'Separated Children cannot exceed the Total Population',
  },
  {
    key: 'numberLivesLost',
    test: (v) => num(v, 'numberLivesLost') + num(v, 'numberInjured') > num(v, 'totalPopulation'),
    message: 'The sum of Lives Lost and Injured Persons cannot exceed the Total Population',
  },
]

const VULNERABLE_KEYS = [
  'populationUnder5',
  'pregnantWomen',
  'lactatingMothers',
  'personWithDisability',
  'elderlyPersons',
  'separatedChildren',
] as const

/**
 * Live aggregate checks (legacy PopulationAssessmentForm destructive alerts).
 * Each interpolates the current numbers exactly as the legacy alert did and
 * only fires once a total population has been entered.
 */
function populationAggregates(values: Values): CrossFieldViolation[] {
  const total = num(values, 'totalPopulation')
  if (total <= 0) return []

  const violations: CrossFieldViolation[] = []
  const male = num(values, 'populationMale')
  const female = num(values, 'populationFemale')
  const genderTotal = male + female
  if (genderTotal > total) {
    violations.push({
      key: 'populationMale',
      kind: 'aggregate',
      message: `The sum of Male (${male}) and Female (${female}) population (${genderTotal}) exceeds the Total Population (${total}).`,
    })
  }

  const vulnerableTotal = VULNERABLE_KEYS.reduce((sum, key) => sum + num(values, key), 0)
  if (vulnerableTotal > total) {
    violations.push({
      key: 'populationUnder5',
      kind: 'aggregate',
      message: `The sum of vulnerable groups (${vulnerableTotal}) exceeds the Total Population (${total}). Please verify the numbers.`,
    })
  }

  const lives = num(values, 'numberLivesLost')
  const injured = num(values, 'numberInjured')
  const casualtyTotal = lives + injured
  if (casualtyTotal > total) {
    violations.push({
      key: 'numberLivesLost',
      kind: 'aggregate',
      message: `The sum of Lives Lost (${lives}) and Injured Persons (${injured}) (${casualtyTotal}) exceeds the Total Population (${total}).`,
    })
  }
  return violations
}

const foodWashShelterRefinements: Record<'FOOD' | 'WASH' | 'SHELTER', Array<{ key: string; test: (values: Values) => boolean; message: string }>> = {
  FOOD: [
    {
      key: 'additionalFoodRequiredPersons',
      test: (v) => isTrue(v, 'isFoodSufficient') && num(v, 'additionalFoodRequiredPersons') > 0,
      message: 'Food marked sufficient but additional persons required',
    },
    {
      key: 'availableFoodDurationDays',
      test: (v) => isTrue(v, 'isFoodSufficient') && num(v, 'availableFoodDurationDays') < 7,
      message: 'Food marked sufficient but duration is less than 7 days',
    },
  ],
  WASH: [
    {
      key: 'functionalLatrinesAvailable',
      test: (v) => isTrue(v, 'areLatrinesSufficient') && num(v, 'functionalLatrinesAvailable') === 0,
      message: 'Latrines marked sufficient but none are functional',
    },
  ],
  SHELTER: [
    {
      key: 'numberSheltersRequired',
      test: (v) => isTrue(v, 'areSheltersSufficient') && num(v, 'numberSheltersRequired') > 0,
      message: 'Shelters marked sufficient but additional shelters required',
    },
  ],
}

/**
 * Evaluates every cross-field rule of the type against an answers/values map.
 * Order: refinement predicates first (legacy schema order), then aggregates.
 */
export function evaluateCrossFieldRules(
  assessmentType: CrossFieldAssessmentType,
  values: Values
): CrossFieldViolation[] {
  const violations: CrossFieldViolation[] = []

  if (assessmentType === 'POPULATION') {
    for (const rule of populationRefinements) {
      if (rule.test(values)) {
        violations.push({ key: rule.key, kind: 'refinement', message: rule.message })
      }
    }
    violations.push(...populationAggregates(values))
  } else if (assessmentType === 'FOOD' || assessmentType === 'WASH' || assessmentType === 'SHELTER') {
    for (const rule of foodWashShelterRefinements[assessmentType]) {
      if (rule.test(values)) {
        violations.push({ key: rule.key, kind: 'refinement', message: rule.message })
      }
    }
  }

  return violations
}

/** Narrowing helper for submit-time gating. */
export function hasCrossFieldViolations(assessmentType: CrossFieldAssessmentType, values: Values): boolean {
  return evaluateCrossFieldRules(assessmentType, values).length > 0
}

export interface SuperRefineContext {
  addIssue: (issue: { code: 'custom'; path: (string | number)[]; message: string }) => void
}

/**
 * Submit-time superRefine callback factory: adds one custom issue per legacy
 * refinement violation, on the exact legacy path (field key). Aggregates are
 * live-only (they disable submit in the form, exactly like the legacy form).
 */
export function crossFieldSuperRefine(
  assessmentType: CrossFieldAssessmentType
): (answers: Values, ctx: SuperRefineContext) => void {
  return (answers, ctx) => {
    for (const violation of evaluateCrossFieldRules(assessmentType, answers)) {
      if (violation.kind !== 'refinement') continue
      ctx.addIssue({ code: 'custom', path: [violation.key], message: violation.message })
    }
  }
}
