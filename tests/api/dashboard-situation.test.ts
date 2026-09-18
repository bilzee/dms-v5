import { GET as situationRoute } from '@/app/api/v1/dashboard/situation/route'
import { QuestionRegistryService } from '@/lib/services/question-registry.service'
import { clearDashboardConfigCache } from '@/lib/services/dashboard-config.service'
import { makeRequest, tokenFor, type AuthedUser } from '../helpers/api'
import {
  createUser,
  createEntity,
  createIncident,
  createRapidAssessment,
  ensureQuestionRegistry,
} from '../factories'
import { testDb, truncateTestDb } from '../helpers/test-db'

/**
 * DQR P7 — registry-driven situation dashboard aggregation (real drms_test).
 * Pins the route wiring the unit suite cannot see (review VG1): stored
 * gapAnalysis rows (the P3 engine cache — authoritative, never re-derived)
 * are ranked severity × spread, sliced to DASHBOARD.gapRowsPerCategory with
 * the "+N more" hint math, labeled from the LIVE registry projection, and
 * stamped with the registry contentVersion.
 */

/** Engine-shaped stored cache (GapEngineResult minus presentation rows). */
function storedGapAnalysis(
  gapped: Record<string, 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'>
) {
  const gapFields = Object.keys(gapped)
  const severities = Object.values(gapped)
  const rank: Record<string, number> = { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 }
  const worst = severities.reduce((acc, s) => (rank[s] > rank[acc] ? s : acc), 'LOW' as const)
  return {
    hasGap: gapFields.length > 0,
    gapFields,
    severity: worst,
    recommendations: [],
    fieldSeverityMap: gapped,
    rows: [],
    unanswered: [],
  }
}

describe('DQR P7 — situation dashboard registry-driven summaries', () => {
  let coordinator: AuthedUser
  let entityA: string
  let entityB: string
  let incidentId: string

  beforeAll(async () => {
    await truncateTestDb()
    await ensureQuestionRegistry()
    coordinator = (await createUser({ roles: ['COORDINATOR'] })) as AuthedUser

    const a = await createEntity({ name: 'P7 Entity A' })
    const b = await createEntity({ name: 'P7 Entity B' })
    entityA = a.id
    entityB = b.id
    const incident = await createIncident({ createdBy: coordinator.id, severity: 'MEDIUM' })
    incidentId = incident.id

    // Coordinator-tunable row limit (clamped 1..7) — the route must serve it.
    await testDb.systemSetting.upsert({
      where: { section_key: { section: 'DASHBOARD', key: 'gapRowsPerCategory' } },
      create: { section: 'DASHBOARD', key: 'gapRowsPerCategory', value: 2 },
      update: { value: 2 },
    })
    clearDashboardConfigCache()

    const seed = async (
      entityId: string,
      type: 'HEALTH' | 'WASH',
      gapped: Record<string, 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'>
    ) => {
      const assessment = await createRapidAssessment({
        assessorId: coordinator.id,
        assessorName: 'P7 Seeder',
        entityId,
        incidentId,
        assessmentType: type,
        verificationStatus: 'VERIFIED',
        answers: {},
      })
      await testDb.rapidAssessment.update({
        where: { id: assessment.id },
        data: { gapAnalysis: storedGapAnalysis(gapped) as never },
      })
    }

    // HEALTH across two entities:
    //   hasFunctionalClinic  max(CRITICAL, HIGH) = CRITICAL, spread 2
    //   hasEmergencyServices HIGH,  spread 1
    //   hasTrainedStaff      MEDIUM, spread 1   → hidden at limit 2
    await seed(entityA, 'HEALTH', {
      hasFunctionalClinic: 'CRITICAL',
      hasEmergencyServices: 'HIGH',
      hasTrainedStaff: 'MEDIUM',
    })
    await seed(entityB, 'HEALTH', { hasFunctionalClinic: 'HIGH' })
    // WASH: one assessment, zero confirmed gaps.
    await seed(entityA, 'WASH', {})
  })

  afterAll(async () => {
    await truncateTestDb()
    await testDb.$disconnect()
  })

  test('All-Entities payload ranks stored gaps, chips overflow, stamps the registry version', async () => {
    const response = await situationRoute(
      makeRequest(
        'GET',
        `/api/v1/dashboard/situation?incidentId=${incidentId}&entityId=all`,
        { token: tokenFor(coordinator) }
      )
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    const data = body.data

    // Coordinator setting is served through and the live projection embedded.
    expect(data.gapRowsPerCategory).toBe(2)
    const healthMeta = data.questionMetadata.HEALTH
    expect(Array.isArray(healthMeta.questions)).toBe(true)
    expect(healthMeta.questions.length).toBeGreaterThan(0)
    expect(typeof healthMeta.contentVersion).toBe('number')

    // HEALTH aggregate: counts from the stored cache only.
    const health = data.aggregatedAssessments.health
    expect(health.totalEntities).toBe(2)
    expect(health.entitiesWithGaps).toBe(2)
    expect(health.entitiesWithoutGaps).toBe(0)

    const hs = health.gapSummary
    expect(hs.hasGaps).toBe(true)
    expect(hs.overallSeverity).toBe('CRITICAL')
    expect(hs.totalGapRows).toBe(3)

    // Ranking: severity DESC, then spread DESC. All rows carried for expansion.
    expect(hs.rows).toHaveLength(3)
    expect(hs.rows[0]).toMatchObject({
      key: 'hasFunctionalClinic',
      severity: 'CRITICAL',
      spread: 2,
      total: 2,
    })
    expect(hs.rows[1]).toMatchObject({ key: 'hasEmergencyServices', severity: 'HIGH', spread: 1 })

    // Overflow math at the seeded limit: 3 rows − limit 2 → "+1 more · 1 MEDIUM".
    expect(hs.hiddenCount).toBe(1)
    expect(hs.hiddenSeverityHint).toEqual({ severity: 'MEDIUM', count: 1 })

    // Labels come from the LIVE registry projection (gapLabel → label).
    const clinicQuestion = await testDb.question.findFirst({
      where: { assessmentType: 'HEALTH', questionKey: 'hasFunctionalClinic' },
      select: { label: true, gapLabel: true },
    })
    expect(clinicQuestion).not.toBeNull()
    expect(hs.rows[0].label).toBe(clinicQuestion!.gapLabel || clinicQuestion!.label)

    // Stamp: current registry contentVersion + computation timestamp.
    expect(hs.stamp.contentVersion).toBe(healthMeta.contentVersion)
    expect(hs.stamp.contentVersion).toBeGreaterThan(0)
    expect(Number.isNaN(Date.parse(hs.stamp.computedAt))).toBe(false)

    // Zero-gap suppression: WASH collapses (no rows), still counted.
    const wash = data.aggregatedAssessments.wash
    expect(wash.entitiesWithoutGaps).toBe(1)
    expect(wash.gapSummary.hasGaps).toBe(false)
    expect(wash.gapSummary.rows).toEqual([])

    // No FOOD assessments at all → null aggregate ("Assessment Missing").
    expect(data.aggregatedAssessments.food).toBeNull()
  })
})

describe('DQR P10-1 — situation route snapshot-hydrated read side', () => {
  let coordinator: AuthedUser
  let snapshotEntity: string
  let legacyEntity: string
  let incidentId: string

  beforeAll(async () => {
    await truncateTestDb()
    await ensureQuestionRegistry()
    coordinator = (await createUser({ roles: ['COORDINATOR'] })) as AuthedUser

    const a = await createEntity({ name: 'P10 Snapshot Entity' })
    const b = await createEntity({ name: 'P10 Legacy Entity' })
    snapshotEntity = a.id
    legacyEntity = b.id
    const incident = await createIncident({ createdBy: coordinator.id, severity: 'MEDIUM' })
    incidentId = incident.id

    // Row WITH a frozen snapshot that contains an admin-authored post-seed
    // key: the registry-frozen snapshot is extended with p9tPatientsPerDay —
    // exactly what a row answered against a registry that later churned
    // would have stored.
    const withPostSeed = await createRapidAssessment({
      assessorId: coordinator.id,
      assessorName: 'P10 Seeder',
      entityId: snapshotEntity,
      incidentId,
      assessmentType: 'POPULATION',
      verificationStatus: 'VERIFIED',
      withSnapshot: true,
      answers: { totalPopulation: 5000, p9tPatientsPerDay: 42 },
    })
    const snapshot = withPostSeed.questionSnapshot as {
      sections: Array<{ questions: Array<Record<string, unknown>> }>
    }
    snapshot.sections[0].questions.push({
      id: 'q-p9t-post-seed',
      key: 'p9tPatientsPerDay',
      label: 'Patients per day',
      helperText: null,
      type: 'NUMBER',
      required: false,
      options: null,
      category: 'CONTEXT',
      inverted: false,
      gapLabel: null,
      gapMeaning: null,
      recommendation: null,
      numberMin: null,
      numberMax: null,
      order: 99,
    })
    await testDb.rapidAssessment.update({
      where: { id: withPostSeed.id },
      data: { questionSnapshot: snapshot as never },
    })

    // Pre-data-layer row: answers but NO snapshot → catalog fallback.
    await createRapidAssessment({
      assessorId: coordinator.id,
      assessorName: 'P10 Seeder',
      entityId: legacyEntity,
      incidentId,
      assessmentType: 'POPULATION',
      verificationStatus: 'VERIFIED',
      answers: { totalPopulation: 1200 },
    })
  })

  afterAll(async () => {
    await truncateTestDb()
    await testDb.$disconnect()
  })

  test('post-seed snapshot keys are carried typed — the card renders the value, not N/A', async () => {
    const response = await situationRoute(
      makeRequest(
        'GET',
        `/api/v1/dashboard/situation?incidentId=${incidentId}&entityId=${snapshotEntity}`,
        { token: tokenFor(coordinator) }
      )
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    const population = body.data.entityAssessments[0].latestAssessments.population
    expect(population).not.toBeNull()
    expect(population.totalPopulation).toBe(5000)
    // Catalog hydration dropped this key before P10-1 (rendered "N/A"); the
    // snapshot-hydrated read side carries it typed.
    expect(population.p9tPatientsPerDay).toBe(42)
  })

  test('snapshot-less rows fall back to catalog hydration (pre-data-layer)', async () => {
    const response = await situationRoute(
      makeRequest(
        'GET',
        `/api/v1/dashboard/situation?incidentId=${incidentId}&entityId=${legacyEntity}`,
        { token: tokenFor(coordinator) }
      )
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    const population = body.data.entityAssessments[0].latestAssessments.population
    expect(population).not.toBeNull()
    expect(population.totalPopulation).toBe(1200)
    // fromAnswers parity: unknown keys stay dropped for snapshot-less rows.
    expect(population).not.toHaveProperty('p9tPatientsPerDay')
  })
})

describe('DQR P10-1 — per-type sector readers hydrate post-seed snapshot keys (VG-F3)', () => {
  let coordinator: AuthedUser
  let incidentId: string

  const SECTOR_PROBES: Array<{
    type: 'HEALTH' | 'FOOD' | 'WASH' | 'SHELTER' | 'SECURITY'
    key: 'health' | 'food' | 'wash' | 'shelter' | 'security'
    probeKey: string
    entityId?: string
  }> = [
    { type: 'HEALTH', key: 'health', probeKey: 'p10tProbeHealth' },
    { type: 'FOOD', key: 'food', probeKey: 'p10tProbeFood' },
    { type: 'WASH', key: 'wash', probeKey: 'p10tProbeWash' },
    { type: 'SHELTER', key: 'shelter', probeKey: 'p10tProbeShelter' },
    { type: 'SECURITY', key: 'security', probeKey: 'p10tProbeSecurity' },
  ]

  beforeAll(async () => {
    await truncateTestDb()
    await ensureQuestionRegistry()
    coordinator = (await createUser({ roles: ['COORDINATOR'] })) as AuthedUser
    const incident = await createIncident({ createdBy: coordinator.id, severity: 'MEDIUM' })
    incidentId = incident.id

    for (const sector of SECTOR_PROBES) {
      // Author a post-seed CONTEXT question into the LIVE registry first…
      const section = await testDb.questionSection.findFirst({
        where: { assessmentType: sector.type, category: 'CONTEXT', isActive: true },
      })
      expect(section).not.toBeNull()
      await QuestionRegistryService.createQuestion(
        {
          assessmentType: sector.type,
          questionKey: sector.probeKey,
          sectionId: section!.id,
          questionType: 'TEXT_LONG',
          label: `Probe ${sector.key}`,
          category: 'CONTEXT',
        },
        coordinator.id,
        'P10-1 sector reader coverage probe'
      )
      // …then a VERIFIED row whose factory-frozen snapshot contains the probe.
      const entity = await createEntity({ name: `P10 Probe ${sector.key}` })
      await createRapidAssessment({
        assessorId: coordinator.id,
        assessorName: 'P10 Seeder',
        entityId: entity.id,
        incidentId,
        assessmentType: sector.type,
        verificationStatus: 'VERIFIED',
        withSnapshot: true,
        answers: { [sector.probeKey]: `probe-${sector.key}` },
      })
      sector.entityId = entity.id
    }
  })

  afterAll(async () => {
    await truncateTestDb()
    await testDb.$disconnect()
  })

  test('every sector reader carries its post-seed snapshot key (not N/A)', async () => {
    for (const sector of SECTOR_PROBES) {
      const response = await situationRoute(
        makeRequest(
          'GET',
          `/api/v1/dashboard/situation?incidentId=${incidentId}&entityId=${sector.entityId}`,
          { token: tokenFor(coordinator) }
        )
      )
      expect(response.status).toBe(200)
      const body = await response.json()
      const latest = body.data.entityAssessments[0].latestAssessments[sector.key]
      expect(latest).not.toBeNull()
      // Catalog-bound readers dropped this key before P10-1 (rendered "N/A").
      expect(latest[sector.probeKey]).toBe(`probe-${sector.key}`)
    }
  })
})
