import { GET as auditRoute } from '@/app/api/v1/admin/questions/[id]/audit/route'
import { GET as impactRoute } from '@/app/api/v1/admin/questions/[id]/impact/route'
import { PUT as updateQuestionRoute } from '@/app/api/v1/admin/questions/[id]/route'
import { makeRequest, tokenFor, withParams, jsonOf, type AuthedUser } from '../helpers/api'
import { createUser, createEntity, createIncident, createRapidAssessment, ensureRoles, ensureQuestionRegistry } from '../factories'
import { testDb, truncateTestDb } from '../helpers/test-db'

/**
 * P8 — Admin registry editor read-only surfaces (audit timeline + impact report)
 * and the role gates around them.
 *
 * The two GET routes power the editor UIs: the audit timeline shows the
 * last 50 QUESTION audit rows (newest first, with actor identity) and the
 * impact report counts frozen-snapshot usage before a deactivation (admin)
 * and before a severity re-ladder confirmation (coordinator — severity
 * PATCHes re-derive the same ACTIVE-incident population, so impact is open
 * to both roles). COORDINATOR keeps exactly one mutation surface — the
 * severity PATCH — so its access to PUT and audit must stay 403 (regression).
 */

describe('P8 admin registry editor surfaces', () => {
  let admin: AuthedUser
  let coordinator: AuthedUser
  let assessor: AuthedUser

  beforeAll(async () => {
    await truncateTestDb()
    await ensureRoles()
    await ensureQuestionRegistry()
    admin = (await createUser({ roles: ['ADMIN'] })) as AuthedUser
    coordinator = (await createUser({ roles: ['COORDINATOR'] })) as AuthedUser
    assessor = (await createUser({ roles: ['ASSESSOR'] })) as AuthedUser
  })

  afterAll(async () => {
    await truncateTestDb()
    await testDb.$disconnect()
  })

  async function firstActiveQuestion(assessmentType: string, filter: Record<string, unknown> = {}) {
    const question = await testDb.question.findFirst({
      where: { assessmentType, isActive: true, ...filter },
      orderBy: { order: 'asc' },
    })
    if (!question) throw new Error(`No active ${assessmentType} question matching ${JSON.stringify(filter)}`)
    return question
  }

  // ---------------------------------------------------------- role gates ----

  test('ASSESSOR → 403 on both audit and impact', async () => {
    const question = await firstActiveQuestion('WASH')

    const audit = await auditRoute(
      makeRequest('GET', `/api/v1/admin/questions/${question.id}/audit`, {
        token: tokenFor(assessor),
      }),
      withParams({ id: question.id })
    )
    expect(audit.status).toBe(403)

    const impact = await impactRoute(
      makeRequest('GET', `/api/v1/admin/questions/${question.id}/impact`, {
        token: tokenFor(assessor),
      }),
      withParams({ id: question.id })
    )
    expect(impact.status).toBe(403)
  })

  test('COORDINATOR → 403 on audit and the PUT field edit; impact is open for severity confirms (regression)', async () => {
    const question = await firstActiveQuestion('WASH')

    const audit = await auditRoute(
      makeRequest('GET', `/api/v1/admin/questions/${question.id}/audit`, {
        token: tokenFor(coordinator),
      }),
      withParams({ id: question.id })
    )
    expect(audit.status).toBe(403)

    // The severity page's confirm dialog quotes this before Save All — the
    // same ACTIVE-incident population the severity PATCH re-derives.
    const impact = await impactRoute(
      makeRequest('GET', `/api/v1/admin/questions/${question.id}/impact`, {
        token: tokenFor(coordinator),
      }),
      withParams({ id: question.id })
    )
    expect(impact.status).toBe(200)
    const impactBody = await jsonOf(impact)
    expect(impactBody.success).toBe(true)
    expect(typeof impactBody.data.activeUnderIncidentCount).toBe('number')

    // The severity PATCH stays open to COORDINATOR, but the general PUT does not.
    const edit = await updateQuestionRoute(
      makeRequest('PUT', `/api/v1/admin/questions/${question.id}`, {
        body: { label: `${question.label} (coordinator attempt)`, reason: 'role gate regression' },
        token: tokenFor(coordinator),
      }),
      withParams({ id: question.id })
    )
    expect(edit.status).toBe(403)
    expect((await testDb.question.findUnique({ where: { id: question.id } }))?.label).toBe(question.label)
  })

  test('anonymous → 401 on both routes', async () => {
    const question = await firstActiveQuestion('WASH')

    const audit = await auditRoute(
      makeRequest('GET', `/api/v1/admin/questions/${question.id}/audit`),
      withParams({ id: question.id })
    )
    expect(audit.status).toBe(401)

    const impact = await impactRoute(
      makeRequest('GET', `/api/v1/admin/questions/${question.id}/impact`),
      withParams({ id: question.id })
    )
    expect(impact.status).toBe(401)
  })

  // ------------------------------------------------------------ audit -------

  describe('GET /api/v1/admin/questions/[id]/audit', () => {
    test('returns QUESTION entries newest-first with actor identity and reason', async () => {
      const question = await firstActiveQuestion('WASH')
      const newLabel = `${question.label} (p8 audit fixture)`
      const reason = 'p8 audit timeline fixture'

      // Produce a deterministic audit row through the real governance PUT.
      const edit = await updateQuestionRoute(
        makeRequest('PUT', `/api/v1/admin/questions/${question.id}`, {
          body: { label: newLabel, reason },
          token: tokenFor(admin),
        }),
        withParams({ id: question.id })
      )
      expect(edit.status).toBe(200)

      const response = await auditRoute(
        makeRequest('GET', `/api/v1/admin/questions/${question.id}/audit`, {
          token: tokenFor(admin),
        }),
        withParams({ id: question.id })
      )
      expect(response.status).toBe(200)
      const body = await jsonOf(response)
      expect(body.success).toBe(true)
      expect(Array.isArray(body.data.entries)).toBe(true)
      expect(body.data.entries.length).toBeGreaterThanOrEqual(1)

      const newest = body.data.entries[0]
      expect(newest.entityType).toBe('QUESTION')
      expect(newest.entityId).toBe(question.id)
      expect(newest.action).toBe('UPDATE')
      expect(newest.reason).toBe(reason)
      expect(newest.actor).toMatchObject({ email: admin.email, name: admin.name })
      expect((newest.changes as { label?: { to?: string } }).label?.to).toBe(newLabel)

      // Newest-first ordering.
      const times = body.data.entries.map((e: { actedAt: string }) => new Date(e.actedAt).getTime())
      expect([...times].sort((a, b) => b - a)).toEqual(times)
      // Only QUESTION-scope rows are served (SECTION history excluded).
      expect(body.data.entries.every((e: { entityType: string }) => e.entityType === 'QUESTION')).toBe(true)
    })
  })

  // ------------------------------------------------------------ impact ------

  describe('GET /api/v1/admin/questions/[id]/impact', () => {
    test('count 0 — question never used in a non-DRAFT snapshot', async () => {
      // No FOOD assessments exist in this suite, so every FOOD question is unused.
      const question = await firstActiveQuestion('FOOD')

      const response = await impactRoute(
        makeRequest('GET', `/api/v1/admin/questions/${question.id}/impact`, {
          token: tokenFor(admin),
        }),
        withParams({ id: question.id })
      )
      expect(response.status).toBe(200)
      const body = await jsonOf(response)
      expect(body.data).toEqual({
        questionKey: question.questionKey,
        snapshotCount: 0,
        activeUnderIncidentCount: 0,
        // Alias for the severity-PATCH confirm dialog (same population).
        affectedCount: 0,
        latestSnapshot: null,
      })
    })

    test('count >0 — ACTIVE incident snapshot fixture with resolved + draft controls', async () => {
      const question = await firstActiveQuestion('SHELTER', { category: 'GAP' })

      const entity = await createEntity()
      const activeIncident = await createIncident({ createdBy: coordinator.id, status: 'ACTIVE' })
      const resolvedIncident = await createIncident({ createdBy: coordinator.id, status: 'RESOLVED' })

      const affectedActive = await createRapidAssessment({
        assessorId: assessor.id,
        entityId: entity.id,
        incidentId: activeIncident.id,
        assessmentType: 'SHELTER',
        verificationStatus: 'SUBMITTED',
        withSnapshot: true,
        rapidAssessmentDate: new Date('2026-01-02T12:00:00Z'),
      })
      const affectedResolved = await createRapidAssessment({
        assessorId: assessor.id,
        entityId: entity.id,
        incidentId: resolvedIncident.id,
        assessmentType: 'SHELTER',
        verificationStatus: 'VERIFIED',
        withSnapshot: true,
        rapidAssessmentDate: new Date('2026-01-01T12:00:00Z'),
      })
      // DRAFT assessments are excluded even under an ACTIVE incident.
      await createRapidAssessment({
        assessorId: assessor.id,
        entityId: entity.id,
        incidentId: activeIncident.id,
        assessmentType: 'SHELTER',
        verificationStatus: 'DRAFT',
        withSnapshot: true,
        rapidAssessmentDate: new Date('2026-01-03T12:00:00Z'),
      })

      const response = await impactRoute(
        makeRequest('GET', `/api/v1/admin/questions/${question.id}/impact`, {
          token: tokenFor(admin),
        }),
        withParams({ id: question.id })
      )
      expect(response.status).toBe(200)
      const body = await jsonOf(response)

      expect(body.data.questionKey).toBe(question.questionKey)
      expect(body.data.snapshotCount).toBe(2)
      expect(body.data.activeUnderIncidentCount).toBe(1)
      expect(body.data.affectedCount).toBe(1)
      // latestSnapshot = the most recent non-DRAFT affected assessment (the
      // newer DRAFT row must not win).
      expect(new Date(body.data.latestSnapshot.rapidAssessmentDate).getTime()).toBe(
        affectedActive.rapidAssessmentDate.getTime()
      )
      expect(body.data.latestSnapshot.structureVersion).toBe(affectedActive.structureVersion)
      expect(body.data.latestSnapshot.contentVersion).toBe(affectedActive.contentVersion)

      // The snapshot projection genuinely contains the GAP key (fixture sanity:
      // buildQuestionSnapshot freezes structure-only rows keyed by questionKey).
      const row = await testDb.rapidAssessment.findUniqueOrThrow({ where: { id: affectedActive.id } })
      expect(JSON.stringify(row.questionSnapshot)).toContain(`"key":"${question.questionKey}"`)
      expect(affectedResolved.id).toBeDefined()
    })

    test('unknown id → 404', async () => {
      const response = await impactRoute(
        makeRequest('GET', '/api/v1/admin/questions/does-not-exist/impact', {
          token: tokenFor(admin),
        }),
        withParams({ id: 'does-not-exist' })
      )
      expect(response.status).toBe(404)
    })
  })
})
