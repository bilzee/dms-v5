/**
 * DQR P10-2 — deterministic, idempotent cross-field rule seeding.
 *
 * Ports the EXACT 15 predicates of `src/lib/questions/cross-field-rules.ts`
 * (plan §4.3 parity map) into `CrossFieldRule` rows so the registry — not a
 * client-side module — owns cross-field validation. Shared by `prisma/seed.ts`
 * (both partitions; the sample-data branch never touches rules) and
 * `prisma/seed-essential.ts`, mirroring the seed-questions.ts contract:
 *
 * - Deterministic ids: `{AssessmentType}:{ruleKey}`; upserts keyed by the
 *   `assessmentType_ruleKey` composite unique.
 * - Content drift on an existing row updates it in place and writes a
 *   `QuestionAuditLog` row (`entityType: 'RULE'`, `changes`/`previous`);
 *   identical re-runs are no-ops.
 * - New rows get exactly one CREATE audit row.
 * - NO version bumps: a re-seed is baseline reconciliation, not a governed
 *   mutation (only the admin API bumps structureVersion for rule edits).
 * - One transaction per assessment type.
 * - Pre-write assertions: 15 rows, every AST passes the shared zod grammar,
 *   and every `referenceKeys` entry is an ACTIVE question key of the type.
 */

import { Prisma, PrismaClient } from '@prisma/client'
import type { BoolGate, Compare } from '../src/lib/questions/rule-engine'
import { RuleAstSchema } from '../src/lib/questions/rule-engine'
import { canonicalJson } from './seed-questions'
import type { SeedableAssessmentType } from './seed-questions'

export type RuleKindSeed = 'REFINEMENT' | 'AGGREGATE'

export interface CrossFieldRuleSeed {
  assessmentType: SeedableAssessmentType
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

export const EXPECTED_RULE_COUNT = 15

export interface RuleSeedResult {
  rules: number
  created: number
  updated: number
  unchanged: number
}

function diffRule(
  existing: {
    assessmentType: string
    ruleKey: string
    kind: string
    name: string
    message: string
    when: unknown
    expression: unknown
    referenceKeys: unknown
    isActive: boolean
    order: number
  },
  incoming: {
    kind: string
    name: string
    message: string
    when: unknown
    expression: unknown
    referenceKeys: unknown
    isActive: boolean
    order: number
  }
): Record<string, unknown> {
  const changes: Record<string, unknown> = {}
  const comparators: Array<[string, unknown, unknown]> = [
    ['kind', existing.kind, incoming.kind],
    ['name', existing.name, incoming.name],
    ['message', existing.message, incoming.message],
    ['when', canonicalJson(existing.when ?? null), canonicalJson(incoming.when ?? null)],
    ['expression', canonicalJson(existing.expression), canonicalJson(incoming.expression)],
    [
      'referenceKeys',
      canonicalJson(existing.referenceKeys),
      canonicalJson(incoming.referenceKeys),
    ],
    ['isActive', existing.isActive, incoming.isActive],
    ['order', existing.order, incoming.order],
  ]
  for (const [field, before, after] of comparators) {
    if (before !== after) {
      changes[field] = { from: before, to: after }
    }
  }
  return changes
}

/**
 * Seeds (idempotently) the 15 baseline cross-field rules. Throws if the seed
 * drifts from the expected count, an AST fails the shared grammar, or a
 * `referenceKeys` entry is not an ACTIVE question key of its type.
 */
export async function seedCrossFieldRules(db: PrismaClient): Promise<RuleSeedResult> {
  if (CROSS_FIELD_RULE_SEED.length !== EXPECTED_RULE_COUNT) {
    throw new Error(
      `Cross-field rule seed drifted from expectations: ${CROSS_FIELD_RULE_SEED.length} rows vs ${EXPECTED_RULE_COUNT}`
    )
  }

  // Pre-write assertions: grammar validity + referenceKeys ⊆ active questions.
  for (const rule of CROSS_FIELD_RULE_SEED) {
    const ast = RuleAstSchema.safeParse({
      when: rule.when,
      violationWhen: rule.expression,
    })
    if (!ast.success) {
      throw new Error(
        `Cross-field rule seed AST invalid for ${rule.assessmentType}:${rule.ruleKey}: ${ast.error.message}`
      )
    }
    if (rule.referenceKeys.length === 0) {
      throw new Error(`Cross-field rule seed ${rule.assessmentType}:${rule.ruleKey} has empty referenceKeys`)
    }
  }

  const types = [...new Set(CROSS_FIELD_RULE_SEED.map((rule) => rule.assessmentType))]
  for (const assessmentType of types) {
    const activeKeys = await db.question.findMany({
      where: { assessmentType, isActive: true },
      select: { questionKey: true },
    })
    const activeKeySet = new Set(activeKeys.map((row) => row.questionKey))
    for (const rule of CROSS_FIELD_RULE_SEED.filter((r) => r.assessmentType === assessmentType)) {
      const unknown = rule.referenceKeys.filter((key) => !activeKeySet.has(key))
      if (unknown.length > 0) {
        throw new Error(
          `Cross-field rule seed ${assessmentType}:${rule.ruleKey} references non-active question keys: ${unknown.join(', ')}`
        )
      }
    }
  }

  let created = 0
  let updated = 0
  let unchanged = 0

  for (const assessmentType of types) {
    await db.$transaction(async (tx) => {
      for (const rule of CROSS_FIELD_RULE_SEED.filter(
        (r) => r.assessmentType === assessmentType
      )) {
        const id = `${assessmentType}:${rule.ruleKey}`
        const incoming = {
          id,
          assessmentType,
          ruleKey: rule.ruleKey,
          kind: rule.kind,
          name: rule.name,
          message: rule.message,
          when: (rule.when ?? undefined) as unknown as Prisma.InputJsonValue | undefined,
          expression: rule.expression as unknown as Prisma.InputJsonValue,
          referenceKeys: rule.referenceKeys as unknown as Prisma.InputJsonValue,
          isActive: true,
          order: rule.order,
        }

        const existing = await tx.crossFieldRule.findUnique({ where: { id } })
        if (!existing) {
          await tx.crossFieldRule.create({ data: incoming })
          await tx.questionAuditLog.create({
            data: {
              entityType: 'RULE',
              entityId: id,
              action: 'CREATE',
              changes: {
                created: rule.ruleKey,
                assessmentType,
                kind: rule.kind,
                order: rule.order,
              },
            },
          })
          created += 1
          continue
        }

        const changes = diffRule(existing, incoming)
        if (Object.keys(changes).length === 0) {
          unchanged += 1
          continue
        }

        const previousSnapshot = {
          kind: existing.kind,
          name: existing.name,
          message: existing.message,
          when: existing.when ?? null,
          expression: existing.expression,
          referenceKeys: existing.referenceKeys,
          isActive: existing.isActive,
          order: existing.order,
        }
        // `source-of-truth` reconciliation: content fields only — the row id,
        // assessmentType and ruleKey are the identity and never drift.
        await tx.crossFieldRule.update({
          where: { id },
          data: {
            kind: rule.kind,
            name: rule.name,
            message: rule.message,
            // No gate ⇒ SQL NULL (Prisma.DbNull), not JSON null.
            when: incoming.when ?? Prisma.DbNull,
            expression: incoming.expression,
            referenceKeys: incoming.referenceKeys,
            isActive: true,
            order: rule.order,
          },
        })
        await tx.questionAuditLog.create({
          data: {
            entityType: 'RULE',
            entityId: id,
            action: 'UPDATE',
            changes: changes as object,
            previous: previousSnapshot as object,
          },
        })
        updated += 1
      }
    })
  }

  return { rules: created + updated + unchanged, created, updated, unchanged }
}
