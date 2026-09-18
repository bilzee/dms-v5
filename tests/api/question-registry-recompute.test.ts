import { QuestionRegistryService } from '@/lib/services/question-registry.service'
import {
  createUser,
  createEntity,
  createIncident,
  createRapidAssessment,
  ensureQuestionRegistry,
  ensureRoles,
} from '../factories'
import { testDb, truncateTestDb } from '../helpers/test-db'

/**
 * DQR P10-1 review patch (VG-F2) — pins the recompute scaling path the
 * P3-era suite never exercised past one page:
 *   A. 206 candidates (one factory row + 205 clones of its frozen snapshot)
 *      force `scanRecomputeCandidates` across its 200-row page boundary; the
 *      severity PATCH must rewrite every row with the identical affectedCount.
 *   B. `recomputeAssessmentsForKey` invoked with NO pre-scan (the
 *      identity-edit race fallback) pages the whole type INSIDE the
 *      transaction and converges to the same rows.
 */

type StoredGapAnalysis = {
  severity: string
  fieldSeverityMap: Record<string, string>
}

describe('DQR P10-1 — recompute pagination + in-tx fallback (VG-F2)', () => {
  let adminId: string
  let entityId: string
  let incidentId: string
  let gapQuestionId: string

  const ANSWERS = { isFoodSufficient: false, hasRegularMealAccess: true, hasInfantNutrition: true }

  beforeAll(async () => {
    await truncateTestDb()
    await ensureRoles()
    await ensureQuestionRegistry()
    const admin = await createUser({ roles: ['ADMIN'] })
    adminId = admin.id
    const entity = await createEntity({ name: 'P10 Recompute Entity' })
    entityId = entity.id
    const incident = await createIncident({ createdBy: adminId, severity: 'MEDIUM' })
    incidentId = incident.id

    const question = await testDb.question.findFirst({
      where: { assessmentType: 'FOOD', questionKey: 'isFoodSufficient' },
    })
    expect(question).not.toBeNull()
    gapQuestionId = question!.id
    await testDb.question.update({ where: { id: gapQuestionId }, data: { severity: 'MEDIUM' } })

    // 1 factory row (snapshot frozen from the live registry) + 205 clones of
    // its frozen snapshot/answers = 206 candidates → 2 scan pages + 2 chunks.
    const seed = await createRapidAssessment({
      assessorId: adminId,
      assessorName: 'P10 Seeder',
      entityId,
      incidentId,
      assessmentType: 'FOOD',
      verificationStatus: 'VERIFIED',
      withSnapshot: true,
      answers: ANSWERS,
    })
    await testDb.rapidAssessment.createMany({
      data: Array.from({ length: 205 }, () => ({
        rapidAssessmentType: 'FOOD' as const,
        rapidAssessmentDate: new Date(),
        assessorId: adminId,
        assessorName: 'P10 Seeder',
        entityId,
        incidentId,
        priority: 'MEDIUM' as const,
        verificationStatus: 'VERIFIED' as const,
        answers: seed.answers as never,
        structureVersion: seed.structureVersion,
        contentVersion: seed.contentVersion,
        questionSnapshot: seed.questionSnapshot as never,
      })),
    })
  })

  afterAll(async () => {
    await truncateTestDb()
    await testDb.$disconnect()
  })

  test('severity PATCH recomputes 206 candidates across page boundaries (outside scan)', async () => {
    expect(await testDb.rapidAssessment.count({ where: { rapidAssessmentType: 'FOOD' } })).toBe(206)

    const { affectedCount } = await QuestionRegistryService.setSeverity(
      gapQuestionId,
      'CRITICAL',
      adminId,
      'P10-1 VG-F2 pagination coverage'
    )
    expect(affectedCount).toBe(206)

    const rows = await testDb.rapidAssessment.findMany({
      where: { rapidAssessmentType: 'FOOD' },
      select: { id: true, priority: true, gapAnalysis: true },
    })
    expect(rows).toHaveLength(206)
    for (const row of rows) {
      expect(row.priority).toBe('CRITICAL')
      const analysis = row.gapAnalysis as unknown as StoredGapAnalysis
      expect(analysis.severity).toBe('CRITICAL')
      expect(analysis.fieldSeverityMap.isFoodSufficient).toBe('CRITICAL')
    }
  })

  test('recomputeAssessmentsForKey without a pre-scan pages in-transaction (race fallback)', async () => {
    // Move the ladder directly (no service fast path) so the ONLY exercised
    // path is the in-transaction fallback scan.
    await testDb.question.update({ where: { id: gapQuestionId }, data: { severity: 'HIGH' } })

    const recompute = (
      QuestionRegistryService as unknown as {
        recomputeAssessmentsForKey: (
          tx: unknown,
          assessmentType: 'FOOD',
          questionKey: string,
          candidateIds?: string[]
        ) => Promise<{ affectedCount: number; affectedIncidentIds: string[] }>
      }
    ).recomputeAssessmentsForKey.bind(QuestionRegistryService)

    const result = await testDb.$transaction((tx) => recompute(tx, 'FOOD', 'isFoodSufficient', undefined))
    expect(result.affectedCount).toBe(206)
    expect(result.affectedIncidentIds).toEqual([incidentId])

    const rows = await testDb.rapidAssessment.findMany({
      where: { rapidAssessmentType: 'FOOD' },
      select: { priority: true, gapAnalysis: true },
    })
    expect(rows).toHaveLength(206)
    for (const row of rows) {
      expect(row.priority).toBe('HIGH')
      const analysis = row.gapAnalysis as unknown as StoredGapAnalysis
      expect(analysis.fieldSeverityMap.isFoodSufficient).toBe('HIGH')
    }
  })
})
