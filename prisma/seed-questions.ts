/**
 * Dynamic Question Registry — deterministic, idempotent question catalog seeding.
 *
 * Shared by `prisma/seed.ts` (full seed) and `prisma/seed-essential.ts`
 * (and therefore the `POST /api/v1/admin/seed` route) so every seeding path
 * produces the exact same 55-question registry.
 *
 * Behavior:
 * - Deterministic ids: `{AssessmentType}:{questionKey}` / `{AssessmentType}:{sectionKey}`.
 * - Upserts keyed by id; a re-run with identical content is a no-op (versions unchanged).
 * - Content drift on an existing question updates it in place, increments `version`,
 *   and writes a `QuestionAuditLog` row (`action: 'UPDATE'`, `changes`, `previous`).
 * - New questions get exactly one `QuestionAuditLog` row (`action: 'CREATE'`).
 * - Initializes the `SystemSetting` version counters
 *   (`QUESTION_REGISTRY` / `structureVersion|contentVersion/{TYPE}`) to 1 per
 *   type; a content-drift bump increments the type's `contentVersion` counter.
 * - All writes for one assessment type run in a single transaction.
 * - Runs `validateRegistry()` + expected-count assertions before touching the DB.
 *
 * The catalog itself lives in `src/lib/questions/registry-validation.ts`.
 */

import { Prisma, PrismaClient, Question, QuestionSection } from '@prisma/client'
import {
  QUESTION_CATALOG,
  EXPECTED_CATALOG_COUNTS,
  deriveQuestionId,
  deriveSectionId,
  validateRegistry,
  QuestionOptionDef,
} from '../src/lib/questions/registry-validation'
import {
  REGISTRY_VERSION_SECTION,
  structureVersionSettingKey,
  contentVersionSettingKey,
} from '../src/lib/questions/registry-versions'

export type SeedableAssessmentType = 'HEALTH' | 'FOOD' | 'WASH' | 'SHELTER' | 'SECURITY' | 'POPULATION'

interface QuestionSeedResult {
  sections: number
  questions: number
  created: number
  updated: number
  unchanged: number
  versionsBumped: number
}

function normalizeOptions(options: QuestionOptionDef[] | undefined): Prisma.InputJsonValue | undefined {
  // Undefined omits the field entirely (column NULL); Prisma's Json input types
  // require a plain-JSON index-signature shape, hence the structural cast.
  return options && options.length > 0 ? (options as unknown as Prisma.InputJsonValue) : undefined
}

/**
 * Canonical JSON for drift comparison. Postgres JSONB normalizes object key
 * order (by key length, then bytewise), so a round-tripped catalog payload
 * never stringifies identically to the in-memory literal — a naive
 * `JSON.stringify` equality check would flag every choice question as
 * "changed" on every re-seed (and spuriously bump contentVersion). Object
 * keys are sorted recursively; array order is preserved (option order is
 * presentation order and meaningful). Shared with prisma/seed-rules.ts (P10-2).
 */
export function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0
    )
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function diffQuestion(existing: Question, incoming: {
  questionKey: string
  assessmentType: SeedableAssessmentType
  sectionId: string
  questionType: string
  label: string
  helperText: string | null
  required: boolean
  options: unknown
  category: string
  inverted: boolean
  gapLabel: string | null
  gapMeaning: string | null
  recommendation: string | null
  severity: string
  numberMin: number | null
  numberMax: number | null
  order: number
  isActive: boolean
}): Record<string, unknown> {
  const changes: Record<string, unknown> = {}
  const comparators: Array<[string, unknown, unknown]> = [
    ['sectionId', existing.sectionId, incoming.sectionId],
    ['questionType', existing.questionType, incoming.questionType],
    ['label', existing.label, incoming.label],
    ['helperText', existing.helperText, incoming.helperText],
    ['required', existing.required, incoming.required],
    ['options', canonicalJson(existing.options ?? null), canonicalJson(incoming.options ?? null)],
    ['category', existing.category, incoming.category],
    ['inverted', existing.inverted, incoming.inverted],
    ['gapLabel', existing.gapLabel, incoming.gapLabel],
    ['gapMeaning', existing.gapMeaning, incoming.gapMeaning],
    ['recommendation', existing.recommendation, incoming.recommendation],
    ['severity', existing.severity, incoming.severity],
    ['numberMin', existing.numberMin, incoming.numberMin],
    ['numberMax', existing.numberMax, incoming.numberMax],
    ['order', existing.order, incoming.order],
    ['isActive', existing.isActive, incoming.isActive],
  ]
  for (const [field, before, after] of comparators) {
    if (before !== after) {
      changes[field] = { from: before, to: after }
    }
  }
  return changes
}

/**
 * Initializes the per-type `SystemSetting` version counters to 1 (create-only:
 * an existing counter is never reset). When content drifted for this type, the
 * `contentVersion` counter is bumped by 1 instead (first seed stays at 1).
 */
async function initializeVersionCounters(
  tx: Prisma.TransactionClient,
  assessmentType: SeedableAssessmentType,
  contentChanged: boolean
): Promise<void> {
  const structureKey = structureVersionSettingKey(assessmentType)
  await tx.systemSetting.upsert({
    where: { section_key: { section: REGISTRY_VERSION_SECTION, key: structureKey } },
    create: { section: REGISTRY_VERSION_SECTION, key: structureKey, value: 1 },
    update: {},
  })

  const contentKey = contentVersionSettingKey(assessmentType)
  if (!contentChanged) {
    await tx.systemSetting.upsert({
      where: { section_key: { section: REGISTRY_VERSION_SECTION, key: contentKey } },
      create: { section: REGISTRY_VERSION_SECTION, key: contentKey, value: 1 },
      update: {},
    })
    return
  }

  const existing = await tx.systemSetting.findUnique({
    where: { section_key: { section: REGISTRY_VERSION_SECTION, key: contentKey } },
    select: { value: true },
  })
  const current =
    typeof existing?.value === 'number' && Number.isFinite(existing.value) && existing.value >= 1
      ? existing.value
      : 1
  await tx.systemSetting.upsert({
    where: { section_key: { section: REGISTRY_VERSION_SECTION, key: contentKey } },
    create: { section: REGISTRY_VERSION_SECTION, key: contentKey, value: 1 },
    update: { value: current + 1 },
  })
}

/**
 * Seeds (idempotently) the full question registry. Throws if the catalog is invalid
 * or does not match the expected counts (6 types / 27 sections / 55 questions / 24 GAP).
 */
export async function seedQuestions(db: PrismaClient): Promise<QuestionSeedResult> {
  const validation = validateRegistry(QUESTION_CATALOG)
  if (!validation.valid) {
    throw new Error(`Question catalog validation failed:\n${validation.errors.join('\n')}`)
  }
  const { counts } = validation
  if (
    counts.assessmentTypes !== EXPECTED_CATALOG_COUNTS.assessmentTypes ||
    counts.sections !== EXPECTED_CATALOG_COUNTS.sections ||
    counts.questions !== EXPECTED_CATALOG_COUNTS.questions ||
    counts.gapQuestions !== EXPECTED_CATALOG_COUNTS.gapQuestions ||
    counts.contextQuestions !== EXPECTED_CATALOG_COUNTS.contextQuestions
  ) {
    throw new Error(
      `Question catalog counts drifted from expectations: ${JSON.stringify(counts)} vs ${JSON.stringify(
        EXPECTED_CATALOG_COUNTS
      )}`
    )
  }

  let created = 0
  let updated = 0
  let unchanged = 0
  let versionsBumped = 0
  let sectionCount = 0

  for (const typeCatalog of QUESTION_CATALOG) {
    const assessmentType = typeCatalog.assessmentType as SeedableAssessmentType
    let typeVersionsBumped = 0

    // One transaction per assessment type: sections + questions + version counters
    // land (or roll back) together.
    await db.$transaction(async (tx) => {
      for (const section of typeCatalog.sections) {
        const sectionId = deriveSectionId(assessmentType, section.sectionKey)
        const sectionData = {
          id: sectionId,
          assessmentType,
          sectionKey: section.sectionKey,
          title: section.title,
          description: section.description ?? null,
          category: section.category,
          order: section.order,
          isActive: true,
        }
        await tx.questionSection.upsert({
          where: { id: sectionId },
          create: sectionData,
          update: {
            sectionKey: sectionData.sectionKey,
            title: sectionData.title,
            description: sectionData.description,
            category: sectionData.category,
            order: sectionData.order,
            isActive: true,
          },
        })
        sectionCount += 1
      }

      for (const section of typeCatalog.sections) {
        const sectionId = deriveSectionId(assessmentType, section.sectionKey)
        for (let index = 0; index < section.questions.length; index += 1) {
          const question = section.questions[index]
          const id = deriveQuestionId(assessmentType, question.questionKey)
          const incoming = {
            id,
            questionKey: question.questionKey,
            assessmentType,
            sectionId,
            questionType: question.questionType,
            label: question.label,
            helperText: question.helperText ?? null,
            required: question.required,
            options: normalizeOptions(question.options),
            category: question.category,
            inverted: question.inverted ?? false,
            gapLabel: question.gapLabel ?? null,
            gapMeaning: question.gapMeaning ?? null,
            recommendation: question.recommendation ?? null,
            severity: question.severity ?? 'LOW',
            numberMin: question.numberMin ?? null,
            numberMax: question.numberMax ?? null,
            order: index + 1,
            isActive: true,
          }

          const existing = await tx.question.findUnique({ where: { id } })
          if (!existing) {
            await tx.question.create({ data: incoming })
            // One CREATE audit row per question, tagged with the new P2
            // entity columns (entityType/entityId) instead of the dropped
            // question FK. Seed rows carry no actor.
            await tx.questionAuditLog.create({
              data: {
                entityType: 'QUESTION',
                entityId: id,
                action: 'CREATE',
                changes: { created: incoming.questionKey, assessmentType, order: incoming.order },
              },
            })
            created += 1
            continue
          }

          const changes = diffQuestion(existing, incoming)
          if (Object.keys(changes).length === 0) {
            unchanged += 1
            continue
          }

          const previousSnapshot = {
            sectionId: existing.sectionId,
            questionType: existing.questionType,
            label: existing.label,
            helperText: existing.helperText,
            required: existing.required,
            options: existing.options ?? null,
            category: existing.category,
            inverted: existing.inverted,
            gapLabel: existing.gapLabel,
            gapMeaning: existing.gapMeaning,
            recommendation: existing.recommendation,
            severity: existing.severity,
            numberMin: existing.numberMin,
            numberMax: existing.numberMax,
            order: existing.order,
            isActive: existing.isActive,
            version: existing.version,
          }
          await tx.question.update({
            where: { id },
            data: { ...incoming, version: { increment: 1 } },
          })
          await tx.questionAuditLog.create({
            data: {
              entityType: 'QUESTION',
              entityId: id,
              action: 'UPDATE',
              changes: changes as object,
              previous: previousSnapshot as object,
            },
          })
          updated += 1
          versionsBumped += 1
          typeVersionsBumped += 1
        }
      }

      // Both counters initialize to 1; drift bumps this type's contentVersion.
      await initializeVersionCounters(tx, assessmentType, typeVersionsBumped > 0)
    })
  }

  return {
    sections: sectionCount,
    questions: created + updated + unchanged,
    created,
    updated,
    unchanged,
    versionsBumped,
  }
}

export type { Question, QuestionSection }
