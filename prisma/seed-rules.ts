/**
 * DQR P10-2 — deterministic, idempotent cross-field rule seeding.
 *
 * Seeds the EXACT 15 predicates of the deleted legacy hardcoded module (plan
 * §4.3 parity map) into `CrossFieldRule` rows so the registry — not a
 * client-side module — owns cross-field validation. The seed rows themselves
 * live in `src/lib/questions/rule-seed-data.ts` (pure, client-safe — moved in
 * P10-3 so `rule-engine.ts` can back its parity shims without importing
 * Prisma); this module keeps the deterministic ids, upsert logic and audit
 * rows. Shared by `prisma/seed.ts` (both partitions; the sample-data branch
 * never touches rules) and `prisma/seed-essential.ts`, mirroring the
 * seed-questions.ts contract:
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
import { RuleAstSchema } from '../src/lib/questions/rule-engine'
import { CROSS_FIELD_RULE_SEED } from '../src/lib/questions/rule-seed-data'
import { canonicalJson } from './seed-questions'

// Re-exported for existing importers — the constant itself lives in the
// client-safe rule-seed-data module since P10-3.
export { CROSS_FIELD_RULE_SEED } from '../src/lib/questions/rule-seed-data'
export type { CrossFieldRuleSeed, RuleKindSeed } from '../src/lib/questions/rule-seed-data'

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
