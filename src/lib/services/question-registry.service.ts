/**
 * Question Registry Service (P2) — the single write/bump/audit authority for
 * the dynamic question registry.
 *
 * Read path:
 * - `getQuestionSet(type, { includeInactive })` — ordered sections+questions
 *   with the type's version counters, behind a 30s cache.
 * - `getSnapshot(type)` — the frozen per-assessment projection
 *   (`buildQuestionSnapshot`); `rapid-assessment.service` consumes this so
 *   every new assessment freezes from one snapshot source.
 *
 * Mutations (every one is: transaction → freeze gate → write →
 * `validateRegistryState` → version bump → audit row → cache invalidation):
 * - Tier A edits (label/helperText/gap phrasing/recommendation/severity/
 *   option copy+append) bump ONLY contentVersion.
 * - Tier B edits (questionType/category/inverted/required/section move/
 *   number bounds/option-value removal/deactivate/reorder) bump
 *   structureVersion and are blocked with 409 `question_frozen` when the
 *   key appears in the questionSnapshot of any non-DRAFT assessment under an
 *   ACTIVE incident (see plan §2.2 "frozen boundaries"; count is returned).
 *
 * Version counters live in SystemSetting (section QUESTION_REGISTRY) and are
 * bumped with an atomic SQL increment — never read-modify-write.
 *
 * Audit rows are polymorphic (`entityType` QUESTION|SECTION) and a `reason`
 * is mandatory for structural actions (400 `reason_required` otherwise).
 *
 * P3 — severity is a derivation rule: `setSeverity` re-derives, inside the
 * same transaction, every ACTIVE-incident assessment of the type whose
 * frozen snapshot contains the key (gapAnalysis + priority; snapshots and
 * versions untouched) and returns `affectedCount`. Affected incidents are
 * re-derived best-effort after commit via `recalculateIncidentSeverity`.
 * A bulk "Recalculate All" surface deliberately does NOT exist — severity
 * flows bottom-up from the registry.
 */

import { AssessmentType, CrossFieldRule, Prisma, Priority, Question, QuestionSection } from '@prisma/client'
import { prisma } from '@/lib/db/client'
import { incidentSeverityService } from '@/lib/services/incident-severity.service'
import { ApiError } from '@/types/api'
import {
  ASSESSMENT_TYPES,
  AssessmentTypeCatalog,
  CatalogAssessmentType,
  CatalogQuestionCategory,
  CatalogQuestionType,
  CatalogSeverity,
  QuestionOptionDef,
  validateRegistry,
} from '@/lib/questions/registry-validation'
import {
  buildQuestionSnapshot,
  QuestionSnapshot,
  RegistryQuestionRow,
} from '@/lib/questions/question-snapshot'
import type { RapidAssessmentType } from '@/lib/questions/answers'
import { clearGapQuestionCache, derivePriorityFromGaps } from '@/lib/services/gap-analysis.service'
import { analyzeGaps as deriveGaps, type GapEngineSnapshotStructure } from '@/lib/questions/gap-engine'
import {
  contentVersionSettingKey,
  getRegistryVersions,
  REGISTRY_VERSION_SECTION,
  structureVersionSettingKey,
} from '@/lib/questions/registry-versions'
import {
  RuleAstSchema,
  type BoolGate,
  type Compare,
} from '@/lib/questions/rule-engine'

type Tx = Prisma.TransactionClient

type SectionWithQuestions = QuestionSection & { questions: Question[] }

export interface QuestionSet {
  sections: SectionWithQuestions[]
  structureVersion: number
  contentVersion: number
}

export type AuditEntityType = 'QUESTION' | 'SECTION' | 'RULE'
export type AuditAction =
  | 'CREATE'
  | 'UPDATE'
  | 'UPDATE_SEVERITY'
  | 'DEACTIVATE'
  | 'REORDER'
  | 'SECTION_CREATE'
  | 'SECTION_UPDATE'
  | 'SECTION_DELETE'

export interface WriteAuditInput {
  entityType: AuditEntityType
  entityId: string
  action: AuditAction
  /** Before-image (stored in `previous`). */
  before?: Record<string, unknown>
  /** After-diff / result summary (stored in `changes`). */
  after?: Record<string, unknown>
  actorId: string
  reason?: string
  /** Structural actions must carry a human reason (400 reason_required). */
  structural?: boolean
}

export interface CreateQuestionInput {
  assessmentType: CatalogAssessmentType
  questionKey: string
  sectionId: string
  questionType: CatalogQuestionType
  label: string
  helperText?: string
  required?: boolean
  options?: QuestionOptionDef[]
  category: CatalogQuestionCategory
  inverted?: boolean
  // Nullable = explicit "no GAP metadata" (CreateQuestionSchema); the service
  // treats null and undefined identically (mirrors UpdateQuestionInput).
  gapLabel?: string | null
  gapMeaning?: string | null
  recommendation?: string | null
  severity?: CatalogSeverity
  numberMin?: number | null
  numberMax?: number | null
  order?: number
}

export interface UpdateQuestionInput {
  /** Accepted only so the API can reject renames with 400 question_key_immutable. */
  questionKey?: string
  label?: string
  helperText?: string | null
  required?: boolean
  options?: QuestionOptionDef[]
  category?: CatalogQuestionCategory
  inverted?: boolean
  gapLabel?: string | null
  gapMeaning?: string | null
  recommendation?: string | null
  severity?: CatalogSeverity
  questionType?: CatalogQuestionType
  sectionId?: string
  numberMin?: number | null
  numberMax?: number | null
  order?: number
}

export interface CreateSectionInput {
  assessmentType: CatalogAssessmentType
  sectionKey: string
  title: string
  description?: string
  category: CatalogQuestionCategory
  order?: number
}

export interface UpdateSectionInput {
  title?: string
  description?: string | null
  category?: CatalogQuestionCategory
  order?: number
}

export type ReorderPayload =
  | { sectionIds: string[] }
  | { sectionId: string; questionIds: string[] }

/** DB rule kinds (engine maps these to the legacy lowercase violation kinds). */
export type RuleKind = 'REFINEMENT' | 'AGGREGATE'

export interface CreateRuleInput {
  assessmentType: CatalogAssessmentType
  /** kebab-case, immutable after create. */
  ruleKey: string
  kind: RuleKind
  name: string
  message: string
  /** Optional BoolGate/Compare gate (null = no gate). */
  when?: BoolGate | Compare | null
  /** The violationWhen compare AST. */
  expression: Compare
  /** Invariant targets; [0] is the violation attachment key. */
  referenceKeys: string[]
  order?: number
}

export interface UpdateRuleInput {
  /** Accepted only so the API can reject renames with 400 rule_key_immutable. */
  ruleKey?: string
  kind?: RuleKind
  name?: string
  message?: string
  when?: BoolGate | Compare | null
  expression?: Compare
  referenceKeys?: string[]
  order?: number
  isActive?: boolean
}

// ---------------------------------------------------------------------------
// Read cache
// ---------------------------------------------------------------------------

const QUESTION_SET_CACHE_TTL_MS = 30 * 1000

let questionSetCache = new Map<string, { expiresAt: number; value: QuestionSet }>()

/** Per-type 30s cross-field rule cache (P10-2), mirroring the question-set cache. */
const RULE_CACHE_TTL_MS = 30 * 1000
let crossFieldRuleCache = new Map<string, { expiresAt: number; value: CrossFieldRule[] }>()

/** Drops all cached question sets (after mutations, re-seeds, and in tests). */
export function clearQuestionRegistryCache(): void {
  questionSetCache = new Map()
}

/** Drops all cached rule lists (after mutations, re-seeds, and in tests). */
export function clearCrossFieldRuleCache(): void {
  crossFieldRuleCache = new Map()
}

/** Mutation-wide invalidation: question-set + rule caches + gap-analysis metadata cache. */
function invalidateRegistryCaches(): void {
  clearQuestionRegistryCache()
  clearCrossFieldRuleCache()
  clearGapQuestionCache()
}

function parseAssessmentType(value: string): CatalogAssessmentType {
  if (!(ASSESSMENT_TYPES as readonly string[]).includes(value)) {
    throw new ApiError(`Unknown assessment type: ${value}`, 404)
  }
  return value as CatalogAssessmentType
}

function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

function parseOptionDefs(options: unknown): QuestionOptionDef[] {
  if (!Array.isArray(options)) return []
  return options.filter(
    (o): o is QuestionOptionDef =>
      typeof o === 'object' && o !== null &&
      typeof (o as QuestionOptionDef).value === 'string' &&
      typeof (o as QuestionOptionDef).label === 'string'
  )
}

/** Rejects inverted NUMBER bounds (400 number_bounds_invalid). */
function assertNumberBounds(min: number | null | undefined, max: number | null | undefined): void {
  if (min != null && max != null && min > max) {
    throw new ApiError('number_bounds_invalid', 400, { numberMin: min, numberMax: max })
  }
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class QuestionRegistryService {
  /** Page size for the severity-recompute scan (P10-1 scaling). */
  private static readonly RECOMPUTE_PAGE_SIZE = 200

  // ---- Read path ----------------------------------------------------------

  /**
   * Ordered sections (with nested questions) for an assessment type plus its
   * version counters. Default: active rows only; `includeInactive` returns
   * every row for the admin editor.
   */
  static async getQuestionSet(
    assessmentType: string,
    options: { includeInactive?: boolean } = {}
  ): Promise<QuestionSet> {
    const type = parseAssessmentType(assessmentType)
    const includeInactive = options.includeInactive ?? false
    const cacheKey = `${type}:${includeInactive ? 'all' : 'active'}`

    const cached = questionSetCache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value
    }

    const sections = await prisma.questionSection.findMany({
      where: { assessmentType: type as AssessmentType, ...(includeInactive ? {} : { isActive: true }) },
      orderBy: [{ order: 'asc' }, { id: 'asc' }],
      include: {
        questions: {
          where: includeInactive ? {} : { isActive: true },
          orderBy: [{ order: 'asc' }, { id: 'asc' }],
        },
      },
    })

    const versions = await getRegistryVersions(prisma, type)
    const value: QuestionSet = {
      sections,
      structureVersion: versions.structureVersion,
      contentVersion: versions.contentVersion,
    }
    questionSetCache.set(cacheKey, { expiresAt: Date.now() + QUESTION_SET_CACHE_TTL_MS, value })
    return value
  }

  /**
   * Cross-field rules of a type, ordered (`order` asc, tie-break `ruleKey`
   * asc — the engine's deterministic evaluation order). Default: active rows
   * only; `includeInactive` returns every row for the admin editor. Behind a
   * per-type 30s cache cleared by `invalidateRegistryCaches`.
   */
  static async getRules(
    assessmentType: string,
    options: { includeInactive?: boolean } = {}
  ): Promise<CrossFieldRule[]> {
    const type = parseAssessmentType(assessmentType)
    const includeInactive = options.includeInactive ?? false
    const cacheKey = `${type}:${includeInactive ? 'all' : 'active'}`

    const cached = crossFieldRuleCache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value
    }

    const rules = await prisma.crossFieldRule.findMany({
      where: { assessmentType: type as AssessmentType, ...(includeInactive ? {} : { isActive: true }) },
      orderBy: [{ order: 'asc' }, { ruleKey: 'asc' }],
    })
    crossFieldRuleCache.set(cacheKey, { expiresAt: Date.now() + RULE_CACHE_TTL_MS, value: rules })
    return rules
  }

  /**
   * The single snapshot source for new assessments: the active question set
   * projected through `buildQuestionSnapshot` with the current counters.
   */
  static async getSnapshot(assessmentType: string): Promise<QuestionSnapshot> {
    const type = parseAssessmentType(assessmentType)
    const set = await QuestionRegistryService.getQuestionSet(type)
    const rows: RegistryQuestionRow[] = set.sections.flatMap((section) =>
      section.questions.map((question) => ({
        ...question,
        section: {
          sectionKey: section.sectionKey,
          title: section.title,
          description: section.description,
          category: section.category,
          order: section.order,
        },
      }))
    )
    return buildQuestionSnapshot(rows, {
      structureVersion: set.structureVersion,
      contentVersion: set.contentVersion,
    })
  }

  /** Full-registry export document (admin download). */
  static async exportRegistry(): Promise<Record<string, unknown>> {
    const sections = await prisma.questionSection.findMany({
      orderBy: [{ assessmentType: 'asc' }, { order: 'asc' }, { id: 'asc' }],
      include: { questions: { orderBy: [{ order: 'asc' }, { id: 'asc' }] } },
    })

    const types: Array<Record<string, unknown>> = []
    for (const assessmentType of ASSESSMENT_TYPES) {
      const versions = await getRegistryVersions(prisma, assessmentType)
      const typeSections = sections.filter((s) => s.assessmentType === assessmentType)
      types.push({
        assessmentType,
        structureVersion: versions.structureVersion,
        contentVersion: versions.contentVersion,
        sections: typeSections,
      })
    }

    return {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      types,
    }
  }

  // ---- Shared primitives (spec-exposed) ------------------------------------

  /**
   * Atomically increments the structure/content counter for a type. The row
   * is ensured first (seed creates it, but a fresh DB may not have it yet).
   */
  static async bumpVersions(
    tx: Tx,
    assessmentType: CatalogAssessmentType,
    bump: { structure?: boolean; content?: boolean }
  ): Promise<void> {
    if (!bump.structure && !bump.content) return

    for (const key of [
      ...(bump.structure ? [structureVersionSettingKey(assessmentType)] : []),
      ...(bump.content ? [contentVersionSettingKey(assessmentType)] : []),
    ]) {
      await tx.systemSetting.upsert({
        where: { section_key: { section: REGISTRY_VERSION_SECTION, key } },
        update: {},
        create: { section: REGISTRY_VERSION_SECTION, key, value: 1 },
      })
    }

    // NOTE: system_settings columns are Prisma-mapped camelCase ("updatedAt")
    // except the explicitly @map'd table name — the DDL in
    // 20260519122434_add_system_settings keeps updatedAt/updatedBy unquoted
    // camelCase, so the raw UPDATE must quote them.
    if (bump.structure) {
      await tx.$executeRaw`UPDATE system_settings SET value = to_jsonb((value #>> '{}')::int + 1), "updatedAt" = now() WHERE section = ${REGISTRY_VERSION_SECTION} AND key = ${structureVersionSettingKey(assessmentType)}`
    }
    if (bump.content) {
      await tx.$executeRaw`UPDATE system_settings SET value = to_jsonb((value #>> '{}')::int + 1), "updatedAt" = now() WHERE section = ${REGISTRY_VERSION_SECTION} AND key = ${contentVersionSettingKey(assessmentType)}`
    }
  }

  /** Writes one polymorphic audit row; enforces `reason` for structural actions. */
  static async writeAudit(tx: Tx, input: WriteAuditInput): Promise<void> {
    if (input.structural && !(input.reason ?? '').trim()) {
      throw new ApiError('reason_required', 400, 'A reason is required for structural registry changes')
    }
    await tx.questionAuditLog.create({
      data: {
        entityType: input.entityType,
        entityId: input.entityId,
        action: input.action,
        changes: input.after === undefined ? undefined : toJson(input.after),
        previous: input.before === undefined ? undefined : toJson(input.before),
        reason: input.reason?.trim() || null,
        actorId: input.actorId,
      },
    })
  }

  /**
   * Freeze gate: a key is editable unless it appears in the questionSnapshot
   * of a non-DRAFT assessment of this type under an ACTIVE incident.
   * Throws 409 `question_frozen` with the affected assessment count.
   */
  static async assertKeyEditable(
    tx: Tx,
    assessmentType: CatalogAssessmentType,
    questionKey: string
  ): Promise<void> {
    const affected = await QuestionRegistryService.countFrozenSnapshots(tx, assessmentType, [questionKey])
    if (affected > 0) {
      throw new ApiError('question_frozen', 409, { questionKey, affectedCount: affected })
    }
  }

  /** Count of ACTIVE-incident non-DRAFT assessments whose snapshot contains any of the keys. */
  static async countFrozenSnapshots(
    tx: Tx,
    assessmentType: CatalogAssessmentType,
    questionKeys: string[]
  ): Promise<number> {
    const rows = await tx.rapidAssessment.findMany({
      where: {
        rapidAssessmentType: assessmentType as AssessmentType,
        verificationStatus: { not: 'DRAFT' },
        incident: { status: 'ACTIVE' },
      },
      select: { questionSnapshot: true },
    })

    const keys = new Set(questionKeys)
    let count = 0
    for (const row of rows) {
      if (snapshotHasAnyKey(row.questionSnapshot, keys)) count += 1
    }
    return count
  }

  /**
   * In-transaction invariant check: projects the ACTIVE registry of the type
   * (empty sections dropped, orders renumbered by position) and runs the
   * catalog invariants via `validateRegistry`. Throws 400 `registry_invalid`.
   */
  static async validateRegistryState(tx: Tx, assessmentType: CatalogAssessmentType): Promise<void> {
    const sections = await tx.questionSection.findMany({
      where: { assessmentType: assessmentType as AssessmentType, isActive: true },
      orderBy: [{ order: 'asc' }, { id: 'asc' }],
      include: { questions: { where: { isActive: true }, orderBy: [{ order: 'asc' }, { id: 'asc' }] } },
    })

    const catalog: AssessmentTypeCatalog = {
      assessmentType,
      sections: sections
        .filter((section) => section.questions.length > 0)
        .map((section, sectionIndex) => ({
          sectionKey: section.sectionKey,
          title: section.title,
          description: section.description ?? undefined,
          category: section.category as CatalogQuestionCategory,
          order: sectionIndex + 1,
          questions: section.questions.map((q) => ({
            questionKey: q.questionKey,
            sectionKey: section.sectionKey,
            questionType: q.questionType as CatalogQuestionType,
            label: q.label,
            helperText: q.helperText ?? undefined,
            required: q.required,
            options: parseOptionDefs(q.options),
            category: q.category as CatalogQuestionCategory,
            inverted: q.inverted,
            gapLabel: q.gapLabel ?? undefined,
            gapMeaning: q.gapMeaning ?? undefined,
            recommendation: q.recommendation ?? undefined,
            severity: q.severity as CatalogSeverity,
            numberMin: q.numberMin ?? undefined,
            numberMax: q.numberMax ?? undefined,
          })),
        })),
    }

    const result = validateRegistry([catalog])
    if (!result.valid) {
      throw new ApiError('registry_invalid', 400, { errors: result.errors })
    }
  }

  // ---- Question mutations ---------------------------------------------------

  /** Creates a question (new keys are never frozen). Structure bump + CREATE audit. */
  static async createQuestion(
    input: CreateQuestionInput,
    actorId: string,
    reason?: string
  ): Promise<Question> {
    const created = await prisma.$transaction(async (tx) => {
      const section = await tx.questionSection.findUnique({ where: { id: input.sectionId } })
      if (!section) {
        throw new ApiError('section_not_found', 404)
      }
      if (section.assessmentType !== (input.assessmentType as AssessmentType)) {
        throw new ApiError('section_type_mismatch', 400, {
          sectionAssessmentType: section.assessmentType,
          payloadAssessmentType: input.assessmentType,
        })
      }

      const assessmentType = section.assessmentType as CatalogAssessmentType

      const duplicate = await tx.question.findFirst({
        where: { assessmentType: section.assessmentType, questionKey: input.questionKey },
        select: { id: true },
      })
      if (duplicate) {
        throw new ApiError('question_key_duplicate', 409, {
          assessmentType: section.assessmentType,
          questionKey: input.questionKey,
        })
      }
      assertNumberBounds(input.numberMin ?? null, input.numberMax ?? null)
      if (input.order !== undefined) {
        await QuestionRegistryService.assertOrderAvailable(tx, 'question', input.sectionId, input.order)
      }

      const order =
        input.order ?? (await QuestionRegistryService.nextOrder(tx, 'question', input.sectionId))

      const question = await tx.question.create({
        data: {
          questionKey: input.questionKey,
          assessmentType: section.assessmentType,
          sectionId: section.id,
          questionType: input.questionType,
          label: input.label,
          helperText: input.helperText ?? null,
          required: input.required ?? false,
          options: input.options && input.options.length > 0 ? toJson(input.options)! : undefined,
          category: input.category,
          inverted: input.inverted ?? false,
          gapLabel: input.gapLabel ?? null,
          gapMeaning: input.gapMeaning ?? null,
          recommendation: input.recommendation ?? null,
          severity: (input.severity ?? 'LOW') as Priority,
          numberMin: input.numberMin ?? null,
          numberMax: input.numberMax ?? null,
          order,
          isActive: true,
        },
      })

      await QuestionRegistryService.validateRegistryState(tx, assessmentType)
      await QuestionRegistryService.bumpVersions(tx, assessmentType, { structure: true })
      await QuestionRegistryService.writeAudit(tx, {
        entityType: 'QUESTION',
        entityId: question.id,
        action: 'CREATE',
        after: {
          questionKey: question.questionKey,
          assessmentType: question.assessmentType,
          questionType: question.questionType,
          category: question.category,
          order: question.order,
        },
        actorId,
        reason,
        structural: true,
      })
      return question
    })

    invalidateRegistryCaches()
    return created
  }

  /**
   * Updates a question. Tier A field edits bump contentVersion only; Tier B
   * field edits (incl. option-value removals) bump structureVersion and pass
   * the freeze gate first. `questionKey` is immutable (400 question_key_immutable).
   */
  static async updateQuestion(
    id: string,
    input: UpdateQuestionInput,
    actorId: string,
    reason?: string
  ): Promise<Question> {
    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.question.findUnique({ where: { id } })
      if (!existing) {
        throw new ApiError('question_not_found', 404)
      }
      if (input.questionKey !== undefined && input.questionKey !== existing.questionKey) {
        throw new ApiError('question_key_immutable', 400, {
          questionKey: existing.questionKey,
          requested: input.questionKey,
        })
      }

      const data: Prisma.QuestionUpdateInput = {}
      const diff: Record<string, { from: unknown; to: unknown }> = {}
      let structural = false

      const touch = (field: string, from: unknown, to: unknown): void => {
        diff[field] = { from, to }
      }

      // --- Tier A: presentation/content fields ---
      if (input.label !== undefined && input.label !== existing.label) {
        data.label = input.label
        touch('label', existing.label, input.label)
      }
      if (input.helperText !== undefined && (input.helperText ?? null) !== (existing.helperText ?? null)) {
        data.helperText = input.helperText ?? null
        touch('helperText', existing.helperText ?? null, input.helperText ?? null)
      }
      if (input.gapLabel !== undefined && (input.gapLabel ?? null) !== (existing.gapLabel ?? null)) {
        data.gapLabel = input.gapLabel ?? null
        touch('gapLabel', existing.gapLabel ?? null, input.gapLabel ?? null)
      }
      if (input.gapMeaning !== undefined && (input.gapMeaning ?? null) !== (existing.gapMeaning ?? null)) {
        data.gapMeaning = input.gapMeaning ?? null
        touch('gapMeaning', existing.gapMeaning ?? null, input.gapMeaning ?? null)
      }
      if (input.recommendation !== undefined && (input.recommendation ?? null) !== (existing.recommendation ?? null)) {
        data.recommendation = input.recommendation ?? null
        touch('recommendation', existing.recommendation ?? null, input.recommendation ?? null)
      }
      if (input.severity !== undefined && input.severity !== existing.severity) {
        data.severity = input.severity as Priority
        touch('severity', existing.severity, input.severity)
      }

      // --- Options: copy edits / appends are Tier A; removing any existing
      //     value (answer semantics change) is Tier B. ---
      if (input.options !== undefined) {
        const oldOptions = parseOptionDefs(existing.options)
        const oldValues = oldOptions.map((o) => o.value)
        const newValues = input.options.map((o) => o.value)
        const newSet = new Set(newValues)
        const removesExistingValue = oldValues.some((value) => !newSet.has(value))
        const changed =
          JSON.stringify(oldOptions) !== JSON.stringify(input.options)

        if (changed) {
          if (removesExistingValue) {
            structural = true
          }
          // Always serialize the provided list — `undefined` would be a silent
          // no-op in Prisma, leaving the row at odds with the audit + bumps.
          data.options = toJson(input.options)!
          diff.options = { from: oldOptions, to: input.options }
        }
      }

      // --- Tier B: structural fields ---
      if (input.questionType !== undefined && input.questionType !== existing.questionType) {
        data.questionType = input.questionType
        touch('questionType', existing.questionType, input.questionType)
        structural = true
      }
      if (input.category !== undefined && input.category !== existing.category) {
        data.category = input.category
        touch('category', existing.category, input.category)
        structural = true
      }
      if (input.inverted !== undefined && input.inverted !== existing.inverted) {
        data.inverted = input.inverted
        touch('inverted', existing.inverted, input.inverted)
        structural = true
      }
      if (input.required !== undefined && input.required !== existing.required) {
        data.required = input.required
        touch('required', existing.required, input.required)
        structural = true
      }
      if (input.numberMin !== undefined && (input.numberMin ?? null) !== (existing.numberMin ?? null)) {
        data.numberMin = input.numberMin ?? null
        touch('numberMin', existing.numberMin ?? null, input.numberMin ?? null)
        structural = true
      }
      if (input.numberMax !== undefined && (input.numberMax ?? null) !== (existing.numberMax ?? null)) {
        data.numberMax = input.numberMax ?? null
        touch('numberMax', existing.numberMax ?? null, input.numberMax ?? null)
        structural = true
      }
      if (input.order !== undefined && input.order !== existing.order) {
        data.order = input.order
        touch('order', existing.order, input.order)
        structural = true
      }
      if (input.sectionId !== undefined && input.sectionId !== existing.sectionId) {
        const target = await tx.questionSection.findUnique({ where: { id: input.sectionId } })
        if (!target) {
          throw new ApiError('Section not found', 404)
        }
        if (target.assessmentType !== existing.assessmentType) {
          throw new ApiError('section_type_mismatch', 400, {
            sectionAssessmentType: target.assessmentType,
            questionAssessmentType: existing.assessmentType,
          })
        }
        data.section = { connect: { id: input.sectionId } }
        touch('sectionId', existing.sectionId, input.sectionId)
        structural = true
      }

      assertNumberBounds(
        input.numberMin !== undefined ? input.numberMin : existing.numberMin,
        input.numberMax !== undefined ? input.numberMax : existing.numberMax
      )
      if (input.order !== undefined && input.order !== existing.order) {
        await QuestionRegistryService.assertOrderAvailable(
          tx,
          'question',
          input.sectionId ?? existing.sectionId,
          input.order,
          id
        )
      }

      if (Object.keys(diff).length === 0) {
        return existing
      }

      if (structural) {
        await QuestionRegistryService.assertKeyEditable(
          tx,
          existing.assessmentType as CatalogAssessmentType,
          existing.questionKey
        )
      }

      const before = {
        label: existing.label,
        helperText: existing.helperText,
        options: existing.options ?? null,
        category: existing.category,
        inverted: existing.inverted,
        gapLabel: existing.gapLabel,
        gapMeaning: existing.gapMeaning,
        recommendation: existing.recommendation,
        severity: existing.severity,
        questionType: existing.questionType,
        required: existing.required,
        sectionId: existing.sectionId,
        numberMin: existing.numberMin,
        numberMax: existing.numberMax,
        order: existing.order,
        isActive: existing.isActive,
      }

      const question = await tx.question.update({
        where: { id },
        data: { ...data, updatedAt: new Date() },
      })

      const content =
        data.label !== undefined ||
        data.helperText !== undefined ||
        data.gapLabel !== undefined ||
        data.gapMeaning !== undefined ||
        data.recommendation !== undefined ||
        data.severity !== undefined ||
        data.options !== undefined

      await QuestionRegistryService.validateRegistryState(tx, existing.assessmentType as CatalogAssessmentType)
      await QuestionRegistryService.bumpVersions(tx, existing.assessmentType as CatalogAssessmentType, {
        structure: structural,
        content,
      })
      await QuestionRegistryService.writeAudit(tx, {
        entityType: 'QUESTION',
        entityId: id,
        action: 'UPDATE',
        before,
        after: diff,
        actorId,
        reason,
        structural,
      })
      return question
    })

    invalidateRegistryCaches()
    return updated
  }

  /** Soft-deletes a question (isActive=false). Freeze gate + structure bump. */
  static async deactivateQuestion(id: string, actorId: string, reason?: string): Promise<Question> {
    const deactivated = await prisma.$transaction(async (tx) => {
      const existing = await tx.question.findUnique({ where: { id } })
      if (!existing) {
        throw new ApiError('question_not_found', 404)
      }
      if (!existing.isActive) {
        return existing
      }

      await QuestionRegistryService.assertKeyEditable(
        tx,
        existing.assessmentType as CatalogAssessmentType,
        existing.questionKey
      )

      // P10-2 rule-reference guard: an ACTIVE cross-field rule referencing
      // this question's key blocks deactivation (its invariant would dangle).
      // Deactivating/editing the rule first lifts the block.
      const referencingRules = await tx.crossFieldRule.findMany({
        where: {
          assessmentType: existing.assessmentType,
          isActive: true,
          referenceKeys: { array_contains: existing.questionKey },
        },
        select: { id: true, ruleKey: true, name: true, kind: true },
      })
      if (referencingRules.length > 0) {
        throw new ApiError('registry_invalid', 400, {
          errors: referencingRules.map((rule) => ({
            ruleId: rule.id,
            ruleKey: rule.ruleKey,
            name: rule.name,
            kind: rule.kind,
            questionKey: existing.questionKey,
            hint: 'Deactivate or edit the referencing cross-field rule first',
          })),
        })
      }

      const question = await tx.question.update({
        where: { id },
        data: { isActive: false },
      })

      await QuestionRegistryService.validateRegistryState(tx, existing.assessmentType as CatalogAssessmentType)
      await QuestionRegistryService.bumpVersions(tx, existing.assessmentType as CatalogAssessmentType, {
        structure: true,
      })
      await QuestionRegistryService.writeAudit(tx, {
        entityType: 'QUESTION',
        entityId: id,
        action: 'DEACTIVATE',
        before: {
          questionKey: existing.questionKey,
          assessmentType: existing.assessmentType,
          order: existing.order,
          isActive: existing.isActive,
        },
        actorId,
        reason,
        structural: true,
      })
      return question
    })

    invalidateRegistryCaches()
    return deactivated
  }

  // ---- Cross-field rule mutations (P10-2) -----------------------------------

  /**
   * Shared rule validation: AST must pass the shared zod grammar and every
   * `referenceKeys` entry must be an ACTIVE question key of the type.
   * Throws 400 `registry_invalid` with the error list.
   */
  private static async validateRuleState(
    tx: Tx,
    assessmentType: CatalogAssessmentType,
    rule: {
      when?: BoolGate | Compare | null
      expression: Compare
      referenceKeys: string[]
    }
  ): Promise<void> {
    const errors: string[] = []

    const ast = RuleAstSchema.safeParse({
      when: rule.when ?? undefined,
      violationWhen: rule.expression,
    })
    if (!ast.success) {
      errors.push(`expression/when failed AST validation: ${ast.error.message}`)
    }
    if (rule.referenceKeys.length === 0) {
      errors.push('referenceKeys must be a non-empty array')
    }

    const activeQuestions = await tx.question.findMany({
      where: { assessmentType: assessmentType as AssessmentType, isActive: true },
      select: { questionKey: true },
    })
    const activeKeys = new Set(activeQuestions.map((row) => row.questionKey))
    const unknown = [...new Set(rule.referenceKeys)].filter((key) => !activeKeys.has(key))
    if (unknown.length > 0) {
      errors.push(
        `referenceKeys not active questions of type ${assessmentType}: ${unknown.join(', ')}`
      )
    }

    if (errors.length > 0) {
      throw new ApiError('registry_invalid', 400, { errors })
    }
  }

  /** Next available rule order for a type (max existing order + 1). */
  private static async nextRuleOrder(
    tx: Tx,
    assessmentType: CatalogAssessmentType
  ): Promise<number> {
    const last = await tx.crossFieldRule.findFirst({
      where: { assessmentType: assessmentType as AssessmentType },
      orderBy: { order: 'desc' },
      select: { order: true },
    })
    return (last?.order ?? 0) + 1
  }

  /**
   * Creates a cross-field rule. Rules are never per-question freeze-gated
   * (they do not alter answer shape); every mutation bumps the type's
   * structureVersion (validation semantics changed) and writes a RULE audit
   * row with a mandatory `reason`.
   */
  static async createRule(
    input: CreateRuleInput,
    actorId: string,
    reason?: string
  ): Promise<CrossFieldRule> {
    const created = await prisma.$transaction(async (tx) => {
      const assessmentType = parseAssessmentType(input.assessmentType)

      const duplicate = await tx.crossFieldRule.findFirst({
        where: { assessmentType: assessmentType as AssessmentType, ruleKey: input.ruleKey },
        select: { id: true },
      })
      if (duplicate) {
        throw new ApiError('rule_key_duplicate', 409, {
          assessmentType,
          ruleKey: input.ruleKey,
        })
      }

      await QuestionRegistryService.validateRuleState(tx, assessmentType, {
        when: input.when ?? null,
        expression: input.expression,
        referenceKeys: input.referenceKeys,
      })

      const order = input.order ?? (await QuestionRegistryService.nextRuleOrder(tx, assessmentType))

      const rule = await tx.crossFieldRule.create({
        data: {
          assessmentType: assessmentType as AssessmentType,
          ruleKey: input.ruleKey,
          kind: input.kind,
          name: input.name,
          message: input.message,
          when: (input.when ?? undefined) as Prisma.InputJsonValue | undefined,
          expression: input.expression as unknown as Prisma.InputJsonValue,
          referenceKeys: input.referenceKeys as unknown as Prisma.InputJsonValue,
          isActive: true,
          order,
        },
      })

      await QuestionRegistryService.bumpVersions(tx, assessmentType, { structure: true })
      await QuestionRegistryService.writeAudit(tx, {
        entityType: 'RULE',
        entityId: rule.id,
        action: 'CREATE',
        after: {
          ruleKey: rule.ruleKey,
          assessmentType: rule.assessmentType,
          kind: rule.kind,
          order: rule.order,
        },
        actorId,
        reason,
        structural: true,
      })
      return rule
    })

    invalidateRegistryCaches()
    return created
  }

  /**
   * Updates a rule (name/message/kind/when/expression/referenceKeys/order/
   * isActive). `ruleKey` and `assessmentType` are immutable
   * (400 `rule_key_immutable`). Structure bump + UPDATE audit.
   */
  static async updateRule(
    id: string,
    input: UpdateRuleInput,
    actorId: string,
    reason?: string
  ): Promise<CrossFieldRule> {
    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.crossFieldRule.findUnique({ where: { id } })
      if (!existing) {
        throw new ApiError('rule_not_found', 404)
      }
      if (input.ruleKey !== undefined && input.ruleKey !== existing.ruleKey) {
        throw new ApiError('rule_key_immutable', 400, {
          ruleKey: existing.ruleKey,
          requested: input.ruleKey,
        })
      }

      const data: Prisma.CrossFieldRuleUpdateInput = {}
      const diff: Record<string, { from: unknown; to: unknown }> = {}
      const touch = (field: string, from: unknown, to: unknown): void => {
        diff[field] = { from, to }
      }

      if (input.kind !== undefined && input.kind !== existing.kind) {
        data.kind = input.kind
        touch('kind', existing.kind, input.kind)
      }
      if (input.name !== undefined && input.name !== existing.name) {
        data.name = input.name
        touch('name', existing.name, input.name)
      }
      if (input.message !== undefined && input.message !== existing.message) {
        data.message = input.message
        touch('message', existing.message, input.message)
      }
      if (input.order !== undefined && input.order !== existing.order) {
        data.order = input.order
        touch('order', existing.order, input.order)
      }
      if (input.isActive !== undefined && input.isActive !== existing.isActive) {
        data.isActive = input.isActive
        touch('isActive', existing.isActive, input.isActive)
      }
      if (input.when !== undefined) {
        const from = existing.when ?? null
        const to = input.when ?? null
        if (JSON.stringify(from) !== JSON.stringify(to)) {
          data.when = (input.when ?? undefined) as Prisma.InputJsonValue | undefined
          touch('when', from, to)
        }
      }
      if (input.expression !== undefined) {
        const from = existing.expression
        if (JSON.stringify(from) !== JSON.stringify(input.expression)) {
          data.expression = input.expression as unknown as Prisma.InputJsonValue
          touch('expression', from, input.expression)
        }
      }
      if (input.referenceKeys !== undefined) {
        const from = existing.referenceKeys as unknown
        if (JSON.stringify(from) !== JSON.stringify(input.referenceKeys)) {
          data.referenceKeys = input.referenceKeys as unknown as Prisma.InputJsonValue
          touch('referenceKeys', from, input.referenceKeys)
        }
      }

      if (Object.keys(diff).length === 0) {
        return existing
      }

      // Re-validate the merged rule whenever any semantics-bearing field is
      // in the payload (a pure isActive flip needs no AST re-check).
      if (
        input.when !== undefined ||
        input.expression !== undefined ||
        input.referenceKeys !== undefined
      ) {
        await QuestionRegistryService.validateRuleState(
          tx,
          existing.assessmentType as CatalogAssessmentType,
          {
            when:
              input.when !== undefined
                ? input.when ?? null
                : (existing.when as BoolGate | Compare | null),
            expression: input.expression ?? (existing.expression as unknown as Compare),
            referenceKeys: input.referenceKeys ?? (existing.referenceKeys as unknown as string[]),
          }
        )
      }

      const before = {
        kind: existing.kind,
        name: existing.name,
        message: existing.message,
        when: existing.when ?? null,
        expression: existing.expression,
        referenceKeys: existing.referenceKeys,
        order: existing.order,
        isActive: existing.isActive,
      }

      const rule = await tx.crossFieldRule.update({
        where: { id },
        data: { ...data, updatedAt: new Date() },
      })

      await QuestionRegistryService.bumpVersions(tx, existing.assessmentType as CatalogAssessmentType, {
        structure: true,
      })
      await QuestionRegistryService.writeAudit(tx, {
        entityType: 'RULE',
        entityId: id,
        action: 'UPDATE',
        before,
        after: diff,
        actorId,
        reason,
        structural: true,
      })
      return rule
    })

    invalidateRegistryCaches()
    return updated
  }

  /**
   * Soft-deactivates a rule (isActive=false). Reason + audit + structure
   * bump, like every rule mutation. Deactivating the LAST active REFINEMENT
   * of a type is allowed — cross-field validation is optional by design
   * (plan §4.4).
   */
  static async deactivateRule(id: string, actorId: string, reason?: string): Promise<CrossFieldRule> {
    const deactivated = await prisma.$transaction(async (tx) => {
      const existing = await tx.crossFieldRule.findUnique({ where: { id } })
      if (!existing) {
        throw new ApiError('rule_not_found', 404)
      }
      if (!existing.isActive) {
        return existing
      }

      const rule = await tx.crossFieldRule.update({
        where: { id },
        data: { isActive: false },
      })

      await QuestionRegistryService.bumpVersions(tx, existing.assessmentType as CatalogAssessmentType, {
        structure: true,
      })
      await QuestionRegistryService.writeAudit(tx, {
        entityType: 'RULE',
        entityId: id,
        action: 'DEACTIVATE',
        before: {
          ruleKey: existing.ruleKey,
          assessmentType: existing.assessmentType,
          kind: existing.kind,
          order: existing.order,
          isActive: existing.isActive,
        },
        actorId,
        reason,
        structural: true,
      })
      return rule
    })

    invalidateRegistryCaches()
    return deactivated
  }

  /**
   * GAP-question severity update (coordinator/admin surface). Content bump
   * only — severity is never frozen into snapshots, so no freeze gate. Because
   * severity is a derivation rule, affected assessments (ACTIVE incident,
   * snapshot contains the key) are re-derived in the same transaction and the
   * count is surfaced as `affectedCount`; affected incidents are re-derived
   * best-effort after commit. Identity edits recompute nothing and bump
   * nothing.
   */
  static async setSeverity(
    id: string,
    severity: 'CRITICAL' | 'HIGH' | 'MEDIUM',
    actorId: string,
    reason?: string
  ): Promise<{ question: Question; affectedCount: number; affectedIncidentIds: string[] }> {
    // Pre-transaction fast path (P10-1): resolve the question and, when the
    // severity actually changes, scan recompute candidates OUTSIDE the
    // interactive transaction (plain prisma reads) so the expensive
    // whole-type scan never holds tx locks. Everything is re-verified inside
    // the transaction; the recompute is idempotent (see
    // recomputeAssessmentsForKey).
    const pre = await prisma.question.findUnique({ where: { id } })
    if (!pre) {
      throw new ApiError('question_not_found', 404)
    }
    if (pre.category !== 'GAP') {
      throw new ApiError('severity_not_editable', 400, {
        questionKey: pre.questionKey,
        category: pre.category,
        hint: 'Only GAP questions carry editable severity',
      })
    }
    const scanned = severity !== pre.severity
    const candidateIds = scanned
      ? await QuestionRegistryService.scanRecomputeCandidates(
          pre.assessmentType as CatalogAssessmentType,
          pre.questionKey
        )
      : []

    const { question, affectedCount, affectedIncidentIds } = await prisma.$transaction(async (tx) => {
      const existing = await tx.question.findUnique({ where: { id } })
      if (!existing) {
        throw new ApiError('question_not_found', 404)
      }
      if (existing.category !== 'GAP') {
        throw new ApiError('severity_not_editable', 400, {
          questionKey: existing.questionKey,
          category: existing.category,
          hint: 'Only GAP questions carry editable severity',
        })
      }
      if (severity === existing.severity) {
        return { question: existing, affectedCount: 0, affectedIncidentIds: [] as string[] }
      }

      const before = { severity: existing.severity }
      const question = await tx.question.update({
        where: { id },
        data: { severity: severity as Priority },
      })

      await QuestionRegistryService.validateRegistryState(tx, existing.assessmentType as CatalogAssessmentType)
      await QuestionRegistryService.bumpVersions(tx, existing.assessmentType as CatalogAssessmentType, {
        content: true,
      })
      await QuestionRegistryService.writeAudit(tx, {
        entityType: 'QUESTION',
        entityId: id,
        action: 'UPDATE_SEVERITY',
        before,
        after: { severity },
        actorId,
        reason,
      })

      const { affectedCount, affectedIncidentIds } = await QuestionRegistryService.recomputeAssessmentsForKey(
        tx,
        existing.assessmentType as CatalogAssessmentType,
        existing.questionKey,
        // Identity-edit race (severity changed between the pre-tx read and
        // this transaction) → no scan ran → recompute falls back to its own
        // in-transaction scan. Correctness over latency in a rare interleave.
        scanned ? candidateIds : undefined
      )
      return { question, affectedCount, affectedIncidentIds }
    })

    invalidateRegistryCaches()

    // Propagate the re-derived assessment priorities to incident severity
    // (best-effort after commit — never fails the PATCH).
    for (const incidentId of affectedIncidentIds) {
      try {
        await incidentSeverityService.recalculateIncidentSeverity(incidentId)
      } catch (error) {
        console.error(
          `[question-registry] post-severity-edit incident re-derivation failed for incident ${incidentId}:`,
          error
        )
      }
    }

    return { question, affectedCount, affectedIncidentIds }
  }

  /**
   * Candidate scan for a severity recompute (P10-1) — runs OUTSIDE the
   * interactive transaction on plain `prisma` (never holds tx locks). Pages
   * the type's assessments by descending id in bounded 200-row pages (the
   * collected id list grows only with matching candidates), keeping only
   * rows on ACTIVE incidents whose frozen `questionSnapshot` contains the
   * key. The result is advisory: `recomputeAssessmentsForKey` re-verifies
   * inside the transaction.
   */
  private static async scanRecomputeCandidates(
    assessmentType: CatalogAssessmentType,
    questionKey: string
  ): Promise<string[]> {
    const keys = new Set([questionKey])
    const ids: string[] = []
    let cursor: string | undefined
    for (;;) {
      const rows = await prisma.rapidAssessment.findMany({
        where: {
          ...(cursor !== undefined ? { id: { lt: cursor } } : {}),
          rapidAssessmentType: assessmentType as AssessmentType,
          incident: { status: 'ACTIVE' },
          questionSnapshot: { not: Prisma.DbNull },
        },
        select: { id: true, questionSnapshot: true },
        orderBy: { id: 'desc' },
        take: QuestionRegistryService.RECOMPUTE_PAGE_SIZE,
      })
      if (rows.length === 0) break
      cursor = rows[rows.length - 1].id
      for (const row of rows) {
        if (snapshotHasAnyKey(row.questionSnapshot, keys)) ids.push(row.id)
      }
    }
    return ids
  }

  /**
   * In-transaction recompute for a severity edit: re-derives `gapAnalysis` +
   * `priority` of every assessment of the type whose frozen snapshot contains
   * the key AND whose incident is ACTIVE (DRAFT assessments with a snapshot
   * are included; offline DRAFTs have none and are naturally excluded).
   * Registry rows are read inside the transaction AFTER the severity update,
   * so the engine's severity ladder already sees the new value. Rows without
   * answers (pre-data-layer) are skipped — no fabricated gaps. Snapshots and
   * version stamps are never touched.
   *
   * Scaling (P10-1): the expensive whole-type candidate scan runs OUTSIDE the
   * interactive transaction (`scanRecomputeCandidates` on plain `prisma`);
   * inside, only the pre-scanned ids are re-verified — snapshot still present,
   * incident still ACTIVE, key-containment post-filter — and rewritten with
   * the existing per-row derive in chunks of `RECOMPUTE_PAGE_SIZE` (200), so
   * transaction lock time and memory scale with AFFECTED rows, not table
   * size.
   *
   * Idempotency: the severity row is updated first inside this transaction
   * and `deriveGaps` resolves severities through `tx` (new value), while each
   * assessment derives purely from its frozen snapshot + stored answers. A
   * retry after a failed PATCH therefore converges row-by-row; a row that
   * drifts between the outside scan and this transaction is either caught by
   * the in-tx re-verification or corrected by the next severity edit.
   */
  private static async recomputeAssessmentsForKey(
    tx: Tx,
    assessmentType: CatalogAssessmentType,
    questionKey: string,
    candidateIds?: string[]
  ): Promise<{ affectedCount: number; affectedIncidentIds: string[] }> {
    const registryRows = await tx.question.findMany({
      where: { assessmentType: assessmentType as AssessmentType },
      select: { questionKey: true, severity: true },
    })

    const keys = new Set([questionKey])
    let affectedCount = 0
    const incidentIds = new Set<string>()

    // No pre-scan supplied (identity-edit race): page the whole type inside
    // the transaction — correctness over latency in a rare interleave.
    let candidates = candidateIds
    if (candidates === undefined) {
      candidates = []
      let cursor: string | undefined
      for (;;) {
        const rows = await tx.rapidAssessment.findMany({
          where: {
            ...(cursor !== undefined ? { id: { lt: cursor } } : {}),
            rapidAssessmentType: assessmentType as AssessmentType,
            incident: { status: 'ACTIVE' },
          },
          select: { id: true, questionSnapshot: true },
          orderBy: { id: 'desc' },
          take: QuestionRegistryService.RECOMPUTE_PAGE_SIZE,
        })
        if (rows.length === 0) break
        cursor = rows[rows.length - 1].id
        for (const row of rows) {
          if (snapshotHasAnyKey(row.questionSnapshot, keys)) candidates.push(row.id)
        }
      }
    }
    if (candidates.length === 0) {
      return { affectedCount: 0, affectedIncidentIds: [] }
    }

    // Re-verify + rewrite in chunks of RECOMPUTE_PAGE_SIZE: each chunk is one
    // bounded re-read (snapshot present, incident ACTIVE) + the existing
    // per-row derive and update.
    for (
      let offset = 0;
      offset < candidates.length;
      offset += QuestionRegistryService.RECOMPUTE_PAGE_SIZE
    ) {
      const chunk = candidates.slice(offset, offset + QuestionRegistryService.RECOMPUTE_PAGE_SIZE)
      const rows = await tx.rapidAssessment.findMany({
        where: {
          id: { in: chunk },
          incident: { status: 'ACTIVE' },
          questionSnapshot: { not: Prisma.DbNull },
        },
        select: { id: true, incidentId: true, answers: true, questionSnapshot: true },
      })
      for (const row of rows) {
        if (row.incidentId === null || row.answers == null) continue
        if (!snapshotHasAnyKey(row.questionSnapshot, keys)) continue
        const gapAnalysis = deriveGaps(
          row.questionSnapshot as unknown as GapEngineSnapshotStructure,
          row.answers as Record<string, unknown>,
          registryRows
        )
        await tx.rapidAssessment.update({
          where: { id: row.id },
          data: {
            gapAnalysis: gapAnalysis as unknown as Prisma.InputJsonValue,
            priority: derivePriorityFromGaps(assessmentType as AssessmentType, gapAnalysis),
          },
        })
        affectedCount += 1
        incidentIds.add(row.incidentId)
      }
    }
    return { affectedCount, affectedIncidentIds: [...incidentIds] }
  }

  // ---- Section mutations ----------------------------------------------------

  /** Creates a section (no freeze gate — nothing references it yet). */
  static async createSection(
    input: CreateSectionInput,
    actorId: string,
    reason?: string
  ): Promise<QuestionSection> {
    const created = await prisma.$transaction(async (tx) => {
      const duplicate = await tx.questionSection.findFirst({
        where: {
          assessmentType: input.assessmentType as AssessmentType,
          sectionKey: input.sectionKey,
        },
        select: { id: true },
      })
      if (duplicate) {
        throw new ApiError('section_key_duplicate', 409, {
          assessmentType: input.assessmentType,
          sectionKey: input.sectionKey,
        })
      }
      if (input.order !== undefined) {
        await QuestionRegistryService.assertOrderAvailable(tx, 'section', input.assessmentType, input.order)
      }

      const order =
        input.order ??
        (await QuestionRegistryService.nextOrder(tx, 'section', input.assessmentType))

      const section = await tx.questionSection.create({
        data: {
          assessmentType: input.assessmentType as AssessmentType,
          sectionKey: input.sectionKey,
          title: input.title,
          description: input.description ?? null,
          category: input.category,
          order,
          isActive: true,
        },
      })

      await QuestionRegistryService.bumpVersions(tx, input.assessmentType, { structure: true })
      await QuestionRegistryService.writeAudit(tx, {
        entityType: 'SECTION',
        entityId: section.id,
        action: 'SECTION_CREATE',
        after: {
          sectionKey: section.sectionKey,
          assessmentType: section.assessmentType,
          category: section.category,
          order: section.order,
        },
        actorId,
        reason,
        structural: true,
      })
      return section
    })

    invalidateRegistryCaches()
    return created
  }

  /**
   * Updates a section. Title/description edits are Tier A (content bump);
   * category/order edits are structural (freeze gate on the section's active
   * question keys + structure bump).
   */
  static async updateSection(
    id: string,
    input: UpdateSectionInput,
    actorId: string,
    reason?: string
  ): Promise<QuestionSection> {
    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.questionSection.findUnique({ where: { id } })
      if (!existing) {
        throw new ApiError('section_not_found', 404)
      }

      const data: Prisma.QuestionSectionUpdateInput = {}
      const diff: Record<string, { from: unknown; to: unknown }> = {}
      let structural = false

      if (input.title !== undefined && input.title !== existing.title) {
        data.title = input.title
        diff.title = { from: existing.title, to: input.title }
      }
      if (input.description !== undefined && (input.description ?? null) !== (existing.description ?? null)) {
        data.description = input.description ?? null
        diff.description = { from: existing.description ?? null, to: input.description ?? null }
      }
      if (input.category !== undefined && input.category !== existing.category) {
        data.category = input.category
        diff.category = { from: existing.category, to: input.category }
        structural = true
      }
      if (input.order !== undefined && input.order !== existing.order) {
        await QuestionRegistryService.assertOrderAvailable(
          tx,
          'section',
          existing.assessmentType as CatalogAssessmentType,
          input.order,
          id
        )
        data.order = input.order
        diff.order = { from: existing.order, to: input.order }
        structural = true
      }

      if (Object.keys(diff).length === 0) {
        return existing
      }

      if (structural) {
        const questions = await tx.question.findMany({
          where: { sectionId: id, isActive: true },
          select: { questionKey: true },
        })
        const affected = await QuestionRegistryService.countFrozenSnapshots(
          tx,
          existing.assessmentType as CatalogAssessmentType,
          questions.map((q) => q.questionKey)
        )
        if (affected > 0) {
          throw new ApiError('question_frozen', 409, {
            sectionKey: existing.sectionKey,
            affectedCount: affected,
          })
        }
      }

      const before = {
        sectionKey: existing.sectionKey,
        title: existing.title,
        description: existing.description,
        category: existing.category,
        order: existing.order,
      }

      const section = await tx.questionSection.update({
        where: { id },
        data: { ...data, updatedAt: new Date() },
      })

      const content = data.title !== undefined || data.description !== undefined

      await QuestionRegistryService.validateRegistryState(tx, existing.assessmentType as CatalogAssessmentType)
      await QuestionRegistryService.bumpVersions(tx, existing.assessmentType as CatalogAssessmentType, {
        structure: structural,
        content,
      })
      await QuestionRegistryService.writeAudit(tx, {
        entityType: 'SECTION',
        entityId: id,
        action: 'SECTION_UPDATE',
        before,
        after: diff,
        actorId,
        reason,
        structural,
      })
      return section
    })

    invalidateRegistryCaches()
    return updated
  }

  /** Hard-deletes an EMPTY section (400 section_not_empty otherwise). */
  static async deleteSection(id: string, actorId: string, reason?: string): Promise<void> {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.questionSection.findUnique({
        where: { id },
        include: { questions: { select: { id: true } } },
      })
      if (!existing) {
        throw new ApiError('section_not_found', 404)
      }
      if (existing.questions.length > 0) {
        throw new ApiError('section_not_empty', 400, {
          sectionKey: existing.sectionKey,
          questionCount: existing.questions.length,
        })
      }

      const before = {
        sectionKey: existing.sectionKey,
        assessmentType: existing.assessmentType,
        title: existing.title,
        description: existing.description,
        category: existing.category,
        order: existing.order,
      }

      await tx.questionSection.delete({ where: { id } })

      await QuestionRegistryService.bumpVersions(tx, existing.assessmentType as CatalogAssessmentType, {
        structure: true,
      })
      await QuestionRegistryService.writeAudit(tx, {
        entityType: 'SECTION',
        entityId: id,
        action: 'SECTION_DELETE',
        before,
        actorId,
        reason,
        structural: true,
      })
    })

    invalidateRegistryCaches()
  }

  // ---- Reorder ---------------------------------------------------------------

  /**
   * Reorders sections of one assessment type (`{ sectionIds }`) or the active
   * questions of one section (`{ sectionId, questionIds }`). Listed actives
   * get contiguous 1..n orders; inactive rows are shifted after them. Any
   * moved key that is frozen → 409 question_frozen.
   */
  static async reorder(payload: ReorderPayload, actorId: string, reason?: string): Promise<{ reordered: number }> {
    const result = await prisma.$transaction(async (tx) => {
      if ('sectionIds' in payload) {
        return QuestionRegistryService.reorderSections(tx, payload.sectionIds, actorId, reason)
      }
      return QuestionRegistryService.reorderQuestions(tx, payload.sectionId, payload.questionIds, actorId, reason)
    })

    invalidateRegistryCaches()
    return result
  }

  private static async reorderSections(
    tx: Tx,
    sectionIds: string[],
    actorId: string,
    reason?: string
  ): Promise<{ reordered: number }> {
    const listed = await tx.questionSection.findMany({
      where: { id: { in: sectionIds }, isActive: true },
    })
    if (listed.length !== sectionIds.length) {
      throw new ApiError('Unknown or inactive section id in sectionIds', 404)
    }
    const assessmentTypes = new Set(listed.map((s) => s.assessmentType))
    if (assessmentTypes.size !== 1) {
      throw new ApiError('reorder_scope_mismatch', 400, {
        hint: 'sectionIds must cover exactly the active sections of one assessment type',
      })
    }
    const assessmentType = [...assessmentTypes][0] as AssessmentType

    const allSections = await tx.questionSection.findMany({
      where: { assessmentType },
      orderBy: [{ order: 'asc' }, { id: 'asc' }],
    })
    const activeSections = allSections.filter((s) => s.isActive)
    const listedIds = new Set(sectionIds)
    const activeIds = new Set(activeSections.map((s) => s.id))
    if (
      listedIds.size !== sectionIds.length ||
      sectionIds.length !== activeSections.length ||
      [...listedIds].some((id) => !activeIds.has(id))
    ) {
      throw new ApiError('reorder_scope_mismatch', 400, {
        hint: 'sectionIds must list every active section of the assessment type exactly once',
      })
    }

    // Moved sections → every active question key under them is affected.
    // "Moved" is computed against the REQUESTED sequence (target order = index + 1),
    // never against the DB return order of `listed`.
    const sectionById = new Map(listed.map((s) => [s.id, s]))
    const movedSections = sectionIds
      .map((id, index) => ({ section: sectionById.get(id)!, target: index + 1 }))
      .filter(({ section, target }) => section.order !== target)
      .map(({ section }) => section)
    if (movedSections.length > 0) {
      const movedQuestions = await tx.question.findMany({
        where: {
          sectionId: { in: movedSections.map((s) => s.id) },
          isActive: true,
        },
        select: { questionKey: true },
      })
      const affected = await QuestionRegistryService.countFrozenSnapshots(
        tx,
        assessmentType as CatalogAssessmentType,
        movedQuestions.map((q) => q.questionKey)
      )
      if (affected > 0) {
        throw new ApiError('question_frozen', 409, {
          movedSections: movedSections.map((s) => s.sectionKey),
          affectedCount: affected,
        })
      }
    }

    const sectionOrders = sectionIds.map((id, index) => {
      const section = listed.find((s) => s.id === id)!
      return { id: section.id, sectionKey: section.sectionKey, from: section.order, to: index + 1 }
    })
    let cursor = 0
    let changed = false
    for (const entry of sectionOrders) {
      cursor += 1
      if (entry.from !== cursor) {
        await tx.questionSection.update({ where: { id: entry.id }, data: { order: cursor } })
        changed = true
      }
    }
    // Park inactive sections after the active block to keep orders unique.
    for (const section of allSections.filter((s) => !s.isActive)) {
      cursor += 1
      if (section.order !== cursor) {
        await tx.questionSection.update({ where: { id: section.id }, data: { order: cursor } })
        changed = true
      }
    }

    // Identity reorder: no writes happened — skip validate/bump/audit.
    if (!changed) {
      return { reordered: sectionIds.length }
    }

    await QuestionRegistryService.validateRegistryState(tx, assessmentType as CatalogAssessmentType)
    await QuestionRegistryService.bumpVersions(tx, assessmentType as CatalogAssessmentType, {
      structure: true,
    })
    for (const entry of sectionOrders) {
      await QuestionRegistryService.writeAudit(tx, {
        entityType: 'SECTION',
        entityId: entry.id,
        action: 'REORDER',
        before: { order: entry.from },
        after: { order: entry.to },
        actorId,
        reason,
        structural: true,
      })
    }
    return { reordered: sectionIds.length }
  }

  private static async reorderQuestions(
    tx: Tx,
    sectionId: string,
    questionIds: string[],
    actorId: string,
    reason?: string
  ): Promise<{ reordered: number }> {
    const section = await tx.questionSection.findUnique({ where: { id: sectionId } })
    if (!section) {
      throw new ApiError('section_not_found', 404)
    }

    const allQuestions = await tx.question.findMany({
      where: { sectionId },
      orderBy: [{ order: 'asc' }, { id: 'asc' }],
    })
    const activeQuestions = allQuestions.filter((q) => q.isActive)
    const listedIds = new Set(questionIds)
    const activeIds = new Set(activeQuestions.map((q) => q.id))
    if (
      listedIds.size !== questionIds.length ||
      questionIds.length !== activeQuestions.length ||
      [...listedIds].some((id) => !activeIds.has(id))
    ) {
      throw new ApiError('reorder_scope_mismatch', 400, {
        hint: 'questionIds must list every active question of the section exactly once',
      })
    }

    // "Moved" is computed against the REQUESTED sequence (target order = index + 1);
    // iterating the current-order-sorted list would never detect a move when the
    // existing orders are already contiguous 1..n.
    const questionById = new Map(activeQuestions.map((q) => [q.id, q]))
    const moved = questionIds
      .map((id, index) => ({ question: questionById.get(id)!, target: index + 1 }))
      .filter(({ question, target }) => question.order !== target)
      .map(({ question }) => question)
    if (moved.length > 0) {
      await QuestionRegistryService.assertKeyEditableBatch(
        tx,
        section.assessmentType as CatalogAssessmentType,
        moved.map((q) => q.questionKey)
      )
    }

    const before: Record<string, number> = {}
    const after: Record<string, number> = {}
    let cursor = 0
    let changed = false
    for (const id of questionIds) {
      const question = activeQuestions.find((q) => q.id === id)!
      before[question.questionKey] = question.order
      cursor += 1
      after[question.questionKey] = cursor
      if (question.order !== cursor) {
        await tx.question.update({ where: { id }, data: { order: cursor } })
        changed = true
      }
    }
    for (const question of allQuestions.filter((q) => !q.isActive)) {
      cursor += 1
      if (question.order !== cursor) {
        await tx.question.update({ where: { id: question.id }, data: { order: cursor } })
        changed = true
      }
    }

    // Identity reorder: no writes happened — skip validate/bump/audit.
    if (!changed) {
      return { reordered: questionIds.length }
    }

    await QuestionRegistryService.validateRegistryState(tx, section.assessmentType as CatalogAssessmentType)
    await QuestionRegistryService.bumpVersions(tx, section.assessmentType as CatalogAssessmentType, {
      structure: true,
    })
    await QuestionRegistryService.writeAudit(tx, {
      entityType: 'SECTION',
      entityId: section.id,
      action: 'REORDER',
      before,
      after,
      actorId,
      reason,
      structural: true,
    })
    return { reordered: questionIds.length }
  }

  /** Freeze gate over many keys at once (409 with the combined affected count). */
  private static async assertKeyEditableBatch(
    tx: Tx,
    assessmentType: CatalogAssessmentType,
    questionKeys: string[]
  ): Promise<void> {
    const affected = await QuestionRegistryService.countFrozenSnapshots(tx, assessmentType, questionKeys)
    if (affected > 0) {
      throw new ApiError('question_frozen', 409, { questionKeys, affectedCount: affected })
    }
  }

  /**
   * Rejects explicit order values that collide with another row in scope
   * (409 order_conflict) — reordering existing rows belongs to /reorder.
   */
  private static async assertOrderAvailable(
    tx: Tx,
    kind: 'question' | 'section',
    scopeId: string,
    order: number,
    excludeId?: string
  ): Promise<void> {
    const notId = excludeId ? { id: { not: excludeId } } : {}
    const clash =
      kind === 'question'
        ? await tx.question.findFirst({
            where: { sectionId: scopeId, order, ...notId },
            select: { id: true },
          })
        : await tx.questionSection.findFirst({
            where: { assessmentType: scopeId as AssessmentType, order, ...notId },
            select: { id: true },
          })
    if (clash) {
      throw new ApiError('order_conflict', 409, {
        kind,
        order,
        hint: 'Another row already occupies this order; use /reorder to rearrange',
      })
    }
  }

  /** Next order value for a new question (in a section) or section (of a type). */
  private static async nextOrder(
    tx: Tx,
    kind: 'question' | 'section',
    scopeId: string
  ): Promise<number> {
    if (kind === 'question') {
      const last = await tx.question.findFirst({
        where: { sectionId: scopeId },
        orderBy: [{ order: 'desc' }, { id: 'desc' }],
        select: { order: true },
      })
      return (last?.order ?? 0) + 1
    }
    const last = await tx.questionSection.findFirst({
      where: { assessmentType: scopeId as AssessmentType },
      orderBy: [{ order: 'desc' }, { id: 'desc' }],
      select: { order: true },
    })
    return (last?.order ?? 0) + 1
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** True when the stored snapshot JSON contains any of the given question keys. */
function snapshotHasAnyKey(snapshot: unknown, keys: Set<string>): boolean {
  if (!snapshot || typeof snapshot !== 'object') return false
  const sections = (snapshot as { sections?: unknown }).sections
  if (!Array.isArray(sections)) return false
  for (const section of sections) {
    const questions = (section as { questions?: unknown }).questions
    if (!Array.isArray(questions)) continue
    for (const question of questions) {
      const key = (question as { key?: unknown }).key
      if (typeof key === 'string' && keys.has(key)) return true
    }
  }
  return false
}

export type { RapidAssessmentType }
