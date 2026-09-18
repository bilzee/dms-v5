/**
 * DQR P10-2 — registry-driven cross-field rule engine.
 *
 * Pure evaluator + shared zod AST schema for `CrossFieldRule` rows (plan §4.2
 * grammar, with the recorded `when` extension accepting `BoolGate | Compare`).
 * Exact behavioral parity with the legacy hardcoded module
 * `src/lib/questions/cross-field-rules.ts` is the contract:
 *
 * - same `num()` coercion — `typeof value === 'number' && !Number.isNaN(value)`
 *   else 0 (no string parsing, null/undefined/NaN → 0);
 * - same violation shape `{ key, message, kind }` (`kind` is the legacy
 *   lowercase form; the DB stores 'REFINEMENT'/'AGGREGATE');
 * - same evaluation order — rules sorted by `order` (tie-break `ruleKey`),
 *   seeded so POPULATION runs its 8 refinements then its 3 aggregates;
 * - same boundary semantics — equality passes `>` rules, the aggregates'
 *   `totalPopulation > 0` when-gate mirrors the legacy `total <= 0` early
 *   return, and the seeded messages reproduce the legacy interpolated
 *   aggregate strings via `{{value:key}}` / `{{sum:k1,k2}}` tokens.
 *
 * The evaluator NEVER throws: a stored rule whose `when`/`expression`/
 * `referenceKeys` fails its zod parse (hand-edited DB row, forward-incompatible
 * payload) is skipped wholesale rather than breaking assessment submission.
 */

import { z } from 'zod'
import type { CrossFieldKind, CrossFieldViolation } from './cross-field-rules'

// ---------------------------------------------------------------------------
// AST grammar (plan §4.2 + recorded `when` extension)
// ---------------------------------------------------------------------------

export const COMPARE_OPS = ['>', '>=', '<', '<=', '==', '!='] as const
export type CompareOp = (typeof COMPARE_OPS)[number]

const OperandSchema: z.ZodType<Operand> = z.discriminatedUnion('type', [
  z.object({ type: z.literal('question'), key: z.string().min(1) }),
  z.object({ type: z.literal('sum'), keys: z.array(z.string().min(1)).min(1) }),
  z.object({ type: z.literal('literal'), value: z.number() }),
])

/** `{{questionKey}}` numeric reference, `sum(keys)` or a literal number. */
export type Operand =
  | { type: 'question'; key: string }
  | { type: 'sum'; keys: string[] }
  | { type: 'literal'; value: number }

/** Numeric comparison between two operands — the violation condition. */
export const CompareSchema = z.object({
  op: z.enum(COMPARE_OPS),
  left: OperandSchema,
  right: OperandSchema,
})
export type Compare = z.infer<typeof CompareSchema>

/** Strict boolean gate: the rule only evaluates when `values[questionKey] === is`. */
export const BoolGateSchema = z.object({
  questionKey: z.string().min(1),
  is: z.boolean(),
})
export type BoolGate = z.infer<typeof BoolGateSchema>

/**
 * `when` gate — `BoolGate | Compare`. The Compare form exists for the legacy
 * aggregates' `totalPopulation > 0` gate (recorded decision, spec Design Notes).
 */
export const WhenSchema = z.union([BoolGateSchema, CompareSchema])
export type When = z.infer<typeof WhenSchema>

/** Full rule AST: optional gate + mandatory violation condition. */
export const RuleAstSchema = z.object({
  when: WhenSchema.optional(),
  violationWhen: CompareSchema,
})
export type RuleAst = z.infer<typeof RuleAstSchema>

// ---------------------------------------------------------------------------
// Rule record shape (DB row / seed row projected into the evaluator)
// ---------------------------------------------------------------------------

/** Minimal fields `evaluateRules` consumes from a stored/seeded rule row. */
export interface RegistryRuleRecord {
  ruleKey: string
  /** DB value: 'REFINEMENT' | 'AGGREGATE' (anything else maps to 'refinement'). */
  kind: string
  message: string
  when?: unknown
  expression: unknown
  referenceKeys: unknown
  order: number
}

// ---------------------------------------------------------------------------
// Evaluation primitives (legacy `num()` parity)
// ---------------------------------------------------------------------------

/** Legacy `num()`: finite-number check, everything else (incl. NaN) coerces to 0. */
export function num(values: Record<string, unknown>, key: string): number {
  const value = values[key]
  return typeof value === 'number' && !Number.isNaN(value) ? value : 0
}

function evalOperand(operand: Operand, values: Record<string, unknown>): number {
  switch (operand.type) {
    case 'question':
      return num(values, operand.key)
    case 'sum':
      return operand.keys.reduce((sum, key) => sum + num(values, key), 0)
    case 'literal':
      return operand.value
  }
}

function compareValues(op: CompareOp, left: number, right: number): boolean {
  switch (op) {
    case '>':
      return left > right
    case '>=':
      return left >= right
    case '<':
      return left < right
    case '<=':
      return left <= right
    case '==':
      return left === right
    case '!=':
      return left !== right
  }
}

function isBoolGate(candidate: When): candidate is BoolGate {
  return 'questionKey' in candidate
}

function whenHolds(when: When, values: Record<string, unknown>): boolean {
  if (isBoolGate(when)) {
    // Strict ===, mirroring the legacy `isTrue` helper ('true' !== true).
    return values[when.questionKey] === when.is
  }
  return compareValues(
    when.op,
    evalOperand(when.left, values),
    evalOperand(when.right, values)
  )
}

// ---------------------------------------------------------------------------
// Message token interpolation
// ---------------------------------------------------------------------------

const VALUE_TOKEN = /\{\{\s*value:([^}]+?)\s*\}\}/g
const SUM_TOKEN = /\{\{\s*sum:([^}]+?)\s*\}\}/g

/**
 * Interpolates `{{value:key}}` with `num()`-coerced values and
 * `{{sum:k1,k2}}` with their sum. Unknown tokens render literally.
 * Numbers stringify exactly like the legacy template literals
 * (`String(number)` — 1000 → "1000", 1.5 → "1.5").
 */
export function interpolateMessage(
  template: string,
  values: Record<string, unknown>
): string {
  return template
    .replace(VALUE_TOKEN, (_match, key: string) => String(num(values, key.trim())))
    .replace(SUM_TOKEN, (_match, keys: string) =>
      String(keys.split(',').reduce((sum, key) => sum + num(values, key.trim()), 0))
    )
}

// ---------------------------------------------------------------------------
// Evaluator
// ---------------------------------------------------------------------------

function toLegacyKind(kind: string): CrossFieldKind {
  return String(kind).toLowerCase() === 'aggregate' ? 'aggregate' : 'refinement'
}

/**
 * Evaluates rules against an answers/values map in deterministic order
 * (sorted by `order`, tie-break `ruleKey`) and returns the violations whose
 * `when` gate (if any) holds and whose `violationWhen` compare is true.
 * The violation `key` is `referenceKeys[0]`. Never throws — rules that fail
 * AST/referenceKeys validation are skipped.
 */
export function evaluateRules(
  rules: RegistryRuleRecord[],
  values: Record<string, unknown>
): CrossFieldViolation[] {
  const ordered = [...rules].sort(
    (a, b) =>
      a.order - b.order ||
      (a.ruleKey < b.ruleKey ? -1 : a.ruleKey > b.ruleKey ? 1 : 0)
  )

  const violations: CrossFieldViolation[] = []
  for (const rule of ordered) {
    const ast = RuleAstSchema.safeParse({
      when: rule.when ?? undefined,
      violationWhen: rule.expression,
    })
    if (!ast.success) continue

    const referenceKeys = z.array(z.string().min(1)).min(1).safeParse(rule.referenceKeys)
    if (!referenceKeys.success) continue

    if (ast.data.when && !whenHolds(ast.data.when, values)) continue

    const { op, left, right } = ast.data.violationWhen
    if (compareValues(op, evalOperand(left, values), evalOperand(right, values))) {
      violations.push({
        key: referenceKeys.data[0],
        message: interpolateMessage(rule.message, values),
        kind: toLegacyKind(rule.kind),
      })
    }
  }
  return violations
}

/**
 * REFINEMENT-only projection — what the server enforces on online
 * create/update/submit and what offline replay stores as informational
 * flags. AGGREGATE rules stay client-live-only (legacy parity).
 */
export function evaluateRefinements(
  rules: RegistryRuleRecord[],
  values: Record<string, unknown>
): CrossFieldViolation[] {
  return evaluateRules(rules, values).filter(
    (violation) => violation.kind === 'refinement'
  )
}
