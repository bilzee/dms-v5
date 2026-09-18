/**
 * DQR P10-3 — pure cross-field rule seed data (client-safe).
 *
 * The 15 baseline rule definitions moved here from `prisma/seed-rules.ts` so
 * `rule-engine.ts` can back its parity shims (`evaluateCrossFieldRules` etc.)
 * without importing Prisma (the seed module pulls in `@prisma/client`).
 * `prisma/seed-rules.ts` re-imports this constant and keeps the deterministic
 * ids, upsert logic and audit rows — the move changes no data.
 *
 * Rows are the EXACT predicates of the deleted legacy hardcoded module
 * `src/lib/questions/cross-field-rules.ts` (plan §4.3 parity map): POPULATION
 * runs its 8 refinements first (orders 1-8 = legacy array order) then its 3
 * aggregates (9-11), reproducing the legacy output order exactly. Types only
 * are imported from `./rule-engine` (erased at runtime — no cycle).
 */

import type { BoolGate, Compare, CrossFieldAssessmentType } from './rule-engine'

export type RuleKindSeed = 'REFINEMENT' | 'AGGREGATE'

export interface CrossFieldRuleSeed {
  assessmentType: CrossFieldAssessmentType
  /** kebab-case, immutable once seeded. */
  ruleKey: string
  kind: RuleKindSeed
  /** Admin-facing display name. */
  name: string
  /** Violation message; AGGREGATE rows carry `{{value:…}}`/`{{sum:…}}` tokens. */
  message: string
  /** Optional gate: BoolGate (FOOD/WASH/SHELTER) or Compare (POPULATION aggregates). */
  when?: BoolGate | Compare
  /** The violationWhen compare (AST grammar §4.2). */
  expression: Compare
  /** Invariant targets; [0] is the violation attachment key (legacy zod path). */
  referenceKeys: string[]
  order: number
}

/** Legacy `total <= 0` early-return gate, expressed as a Compare when-AST. */
const totalPopulationPositive: Compare = {
  op: '>',
  left: { type: 'question', key: 'totalPopulation' },
  right: { type: 'literal', value: 0 },
}

const exceedsTotal = (key: string): Compare => ({
  op: '>',
  left: { type: 'question', key },
  right: { type: 'question', key: 'totalPopulation' },
})

/**
 * The 15 legacy rules (plan §4.3 verbatim parity map). POPULATION runs its
 * refinements first (orders 1-8 = legacy array order) then the aggregates
 * (9-11), reproducing `evaluateCrossFieldRules` output order exactly.
 */
export const CROSS_FIELD_RULE_SEED: CrossFieldRuleSeed[] = [
  // ---------------- POPULATION — 8 refinements (legacy L54-95) ----------------
  {
    assessmentType: 'POPULATION',
    ruleKey: 'population-male-female-vs-total',
    kind: 'REFINEMENT',
    name: 'Gender sum within total population',
    message: 'The sum of Male and Female population cannot exceed the Total Population',
    expression: {
      op: '>',
      left: { type: 'sum', keys: ['populationMale', 'populationFemale'] },
      right: { type: 'question', key: 'totalPopulation' },
    },
    referenceKeys: ['populationMale', 'populationFemale', 'totalPopulation'],
    order: 1,
  },
  {
    assessmentType: 'POPULATION',
    ruleKey: 'population-under5-vs-total',
    kind: 'REFINEMENT',
    name: 'Children under 5 within total population',
    message: 'Children Under 5 cannot exceed the Total Population',
    expression: exceedsTotal('populationUnder5'),
    referenceKeys: ['populationUnder5', 'totalPopulation'],
    order: 2,
  },
  {
    assessmentType: 'POPULATION',
    ruleKey: 'pregnant-women-vs-total',
    kind: 'REFINEMENT',
    name: 'Pregnant women within total population',
    message: 'Pregnant Women cannot exceed the Total Population',
    expression: exceedsTotal('pregnantWomen'),
    referenceKeys: ['pregnantWomen', 'totalPopulation'],
    order: 3,
  },
  {
    assessmentType: 'POPULATION',
    ruleKey: 'lactating-mothers-vs-total',
    kind: 'REFINEMENT',
    name: 'Lactating mothers within total population',
    message: 'Lactating Mothers cannot exceed the Total Population',
    expression: exceedsTotal('lactatingMothers'),
    referenceKeys: ['lactatingMothers', 'totalPopulation'],
    order: 4,
  },
  {
    assessmentType: 'POPULATION',
    ruleKey: 'persons-with-disability-vs-total',
    kind: 'REFINEMENT',
    name: 'Persons with disabilities within total population',
    message: 'Persons with Disabilities cannot exceed the Total Population',
    expression: exceedsTotal('personWithDisability'),
    referenceKeys: ['personWithDisability', 'totalPopulation'],
    order: 5,
  },
  {
    assessmentType: 'POPULATION',
    ruleKey: 'elderly-persons-vs-total',
    kind: 'REFINEMENT',
    name: 'Elderly persons within total population',
    message: 'Elderly Persons (60+) cannot exceed the Total Population',
    expression: exceedsTotal('elderlyPersons'),
    referenceKeys: ['elderlyPersons', 'totalPopulation'],
    order: 6,
  },
  {
    assessmentType: 'POPULATION',
    ruleKey: 'separated-children-vs-total',
    kind: 'REFINEMENT',
    name: 'Separated children within total population',
    message: 'Separated Children cannot exceed the Total Population',
    expression: exceedsTotal('separatedChildren'),
    referenceKeys: ['separatedChildren', 'totalPopulation'],
    order: 7,
  },
  {
    assessmentType: 'POPULATION',
    ruleKey: 'lives-lost-injured-vs-total',
    kind: 'REFINEMENT',
    name: 'Casualties within total population',
    message: 'The sum of Lives Lost and Injured Persons cannot exceed the Total Population',
    expression: {
      op: '>',
      left: { type: 'sum', keys: ['numberLivesLost', 'numberInjured'] },
      right: { type: 'question', key: 'totalPopulation' },
    },
    referenceKeys: ['numberLivesLost', 'numberInjured', 'totalPopulation'],
    order: 8,
  },
  // ---------------- POPULATION — 3 aggregates (legacy L111-147) ----------------
  {
    assessmentType: 'POPULATION',
    ruleKey: 'population-gender-sum-exceeds-total',
    kind: 'AGGREGATE',
    name: 'Gender sum aggregate warning',
    message:
      'The sum of Male ({{value:populationMale}}) and Female ({{value:populationFemale}}) ' +
      'population ({{sum:populationMale,populationFemale}}) exceeds the Total Population ' +
      '({{value:totalPopulation}}).',
    when: totalPopulationPositive,
    expression: {
      op: '>',
      left: { type: 'sum', keys: ['populationMale', 'populationFemale'] },
      right: { type: 'question', key: 'totalPopulation' },
    },
    referenceKeys: ['populationMale', 'populationFemale', 'totalPopulation'],
    order: 9,
  },
  {
    assessmentType: 'POPULATION',
    ruleKey: 'population-vulnerable-sum-exceeds-total',
    kind: 'AGGREGATE',
    name: 'Vulnerable groups sum aggregate warning',
    message:
      'The sum of vulnerable groups ' +
      '({{sum:populationUnder5,pregnantWomen,lactatingMothers,personWithDisability,elderlyPersons,separatedChildren}}) ' +
      'exceeds the Total Population ({{value:totalPopulation}}). Please verify the numbers.',
    when: totalPopulationPositive,
    expression: {
      op: '>',
      left: {
        type: 'sum',
        keys: [
          'populationUnder5',
          'pregnantWomen',
          'lactatingMothers',
          'personWithDisability',
          'elderlyPersons',
          'separatedChildren',
        ],
      },
      right: { type: 'question', key: 'totalPopulation' },
    },
    referenceKeys: [
      'populationUnder5',
      'pregnantWomen',
      'lactatingMothers',
      'personWithDisability',
      'elderlyPersons',
      'separatedChildren',
      'totalPopulation',
    ],
    order: 10,
  },
  {
    assessmentType: 'POPULATION',
    ruleKey: 'population-casualty-sum-exceeds-total',
    kind: 'AGGREGATE',
    name: 'Casualty sum aggregate warning',
    message:
      'The sum of Lives Lost ({{value:numberLivesLost}}) and Injured Persons ' +
      '({{value:numberInjured}}) ({{sum:numberLivesLost,numberInjured}}) exceeds the ' +
      'Total Population ({{value:totalPopulation}}).',
    when: totalPopulationPositive,
    expression: {
      op: '>',
      left: { type: 'sum', keys: ['numberLivesLost', 'numberInjured'] },
      right: { type: 'question', key: 'totalPopulation' },
    },
    referenceKeys: ['numberLivesLost', 'numberInjured', 'totalPopulation'],
    order: 11,
  },
  // ---------------- FOOD — 2 refinements (legacy L150-161) ----------------
  {
    assessmentType: 'FOOD',
    ruleKey: 'food-sufficient-but-additional-required',
    kind: 'REFINEMENT',
    name: 'Food sufficiency vs additional persons required',
    message: 'Food marked sufficient but additional persons required',
    when: { questionKey: 'isFoodSufficient', is: true },
    expression: {
      op: '>',
      left: { type: 'question', key: 'additionalFoodRequiredPersons' },
      right: { type: 'literal', value: 0 },
    },
    referenceKeys: ['additionalFoodRequiredPersons', 'isFoodSufficient'],
    order: 1,
  },
  {
    assessmentType: 'FOOD',
    ruleKey: 'food-sufficient-but-short-duration',
    kind: 'REFINEMENT',
    name: 'Food sufficiency vs available duration',
    message: 'Food marked sufficient but duration is less than 7 days',
    when: { questionKey: 'isFoodSufficient', is: true },
    expression: {
      op: '<',
      left: { type: 'question', key: 'availableFoodDurationDays' },
      right: { type: 'literal', value: 7 },
    },
    referenceKeys: ['availableFoodDurationDays', 'isFoodSufficient'],
    order: 2,
  },
  // ---------------- WASH — 1 refinement (legacy L164-168) ----------------
  {
    assessmentType: 'WASH',
    ruleKey: 'wash-latrines-sufficient-but-none-functional',
    kind: 'REFINEMENT',
    name: 'Latrine sufficiency vs functional latrines',
    message: 'Latrines marked sufficient but none are functional',
    when: { questionKey: 'areLatrinesSufficient', is: true },
    expression: {
      op: '==',
      left: { type: 'question', key: 'functionalLatrinesAvailable' },
      right: { type: 'literal', value: 0 },
    },
    referenceKeys: ['functionalLatrinesAvailable', 'areLatrinesSufficient'],
    order: 1,
  },
  // ---------------- SHELTER — 1 refinement (legacy L171-175) ----------------
  {
    assessmentType: 'SHELTER',
    ruleKey: 'shelter-sufficient-but-shelters-required',
    kind: 'REFINEMENT',
    name: 'Shelter sufficiency vs shelters required',
    message: 'Shelters marked sufficient but additional shelters required',
    when: { questionKey: 'areSheltersSufficient', is: true },
    expression: {
      op: '>',
      left: { type: 'question', key: 'numberSheltersRequired' },
      right: { type: 'literal', value: 0 },
    },
    referenceKeys: ['numberSheltersRequired', 'areSheltersSufficient'],
    order: 1,
  },
]
