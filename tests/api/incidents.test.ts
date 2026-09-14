import { GET as listIncidents, POST as createIncidentRoute } from '@/app/api/v1/incidents/route'
import { GET as getIncident, PUT as updateIncident, DELETE as deleteIncident } from '@/app/api/v1/incidents/[id]/route'
import { POST as createFromAssessment } from '@/app/api/v1/incidents/from-assessment/route'
import { makeRequest, tokenFor, withParams, type AuthedUser } from '../helpers/api'
import {
  createUser,
  createIncident,
  createPreliminaryAssessment,
  type RoleName,
} from '../factories'
import { testDb, truncateTestDb } from '../helpers/test-db'

/**
 * P0 — Incident pipeline: create → list/filter → detail → update → soft-delete,
 * plus incident creation linked to a preliminary assessment.
 */

const VALID_BODY = {
  data: {
    type: 'FLOOD',
    description: 'Pipeline probe flood',
    location: 'Pipeline County',
  },
}

describe('P0 /api/v1/incidents pipeline', () => {
  let coordinator: AuthedUser
  let assessor: AuthedUser

  beforeAll(async () => {
    await truncateTestDb()
    coordinator = (await createUser({ roles: ['COORDINATOR'] })) as AuthedUser
    assessor = (await createUser({ roles: ['ASSESSOR'] })) as AuthedUser
  })

  afterAll(async () => {
    await truncateTestDb()
    await testDb.$disconnect()
  })

  describe('POST /api/v1/incidents', () => {
    test('creates an incident (201) and persists with defaults', async () => {
      const response = await createIncidentRoute(
        makeRequest('POST', '/api/v1/incidents', { body: VALID_BODY, token: tokenFor(coordinator) })
      )
      expect(response.status).toBe(201)
      const body = await response.json()
      expect(body.success).toBe(true)
      expect(body.data.id).toBeDefined()

      const stored = await testDb.incident.findUnique({ where: { id: body.data.id } })
      expect(stored).not.toBeNull()
      expect(stored!.type).toBe('FLOOD')
      expect(stored!.status).toBe('ACTIVE')
      expect(stored!.createdBy).toBe(coordinator.id)
    })

    test('links a preliminary assessment when preliminaryAssessmentId is provided', async () => {
      const assessment = await createPreliminaryAssessment({ reportingAgent: assessor.id })
      const response = await createIncidentRoute(
        makeRequest('POST', '/api/v1/incidents', {
          body: { ...VALID_BODY, preliminaryAssessmentId: assessment.id },
          token: tokenFor(coordinator),
        })
      )
      expect(response.status).toBe(201)
      const body = await response.json()

      const linked = await testDb.preliminaryAssessment.findUnique({ where: { id: assessment.id } })
      expect(linked!.incidentId).toBe(body.data.id)
    })

    test('rejects an invalid body with 400', async () => {
      const response = await createIncidentRoute(
        makeRequest('POST', '/api/v1/incidents', {
          body: { data: { type: 'FLOOD' } },
          token: tokenFor(coordinator),
        })
      )
      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body.success).toBe(false)
    })
  })

  describe('GET /api/v1/incidents', () => {
    beforeAll(async () => {
      await testDb.incident.deleteMany()
      await createIncident({ createdBy: coordinator.id, type: 'FLOOD', status: 'ACTIVE' })
      await createIncident({ createdBy: coordinator.id, type: 'FIRE', status: 'RESOLVED' })
      await createIncident({ createdBy: coordinator.id, type: 'FLOOD', status: 'CONTAINED' })
    })

    test('returns paginated items with pagination metadata', async () => {
      const response = await listIncidents(
        makeRequest('GET', '/api/v1/incidents', { token: tokenFor(assessor) })
      )
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.success).toBe(true)
      expect(body.data.items).toHaveLength(3)
      expect(body.data.pagination).toMatchObject({ page: 1, limit: 10, total: 3 })
    })

    test('filters by status', async () => {
      const response = await listIncidents(
        makeRequest('GET', '/api/v1/incidents', {
          query: { status: 'RESOLVED' },
          token: tokenFor(assessor),
        })
      )
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.data.items).toHaveLength(1)
      expect(body.data.items[0].status).toBe('RESOLVED')
    })

    test('filters by type and paginates', async () => {
      const response = await listIncidents(
        makeRequest('GET', '/api/v1/incidents', {
          query: { type: 'FLOOD', limit: 1, page: 1 },
          token: tokenFor(assessor),
        })
      )
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.data.items).toHaveLength(1)
      expect(body.data.pagination).toMatchObject({ page: 1, limit: 1, total: 2 })
    })
  })

  describe('GET /api/v1/incidents/[id]', () => {
    test('returns the incident with a populationImpact summary', async () => {
      const incident = await createIncident({ createdBy: coordinator.id })
      const response = await getIncident(
        makeRequest('GET', `/api/v1/incidents/${incident.id}`, { token: tokenFor(assessor) }),
        withParams({ id: incident.id })
      )
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.data.id).toBe(incident.id)
      expect(body.data.populationImpact).toMatchObject({ livesLost: 0, injured: 0, displaced: 0 })
    })

    test('404 for an unknown id', async () => {
      const response = await getIncident(
        makeRequest('GET', '/api/v1/incidents/does-not-exist', { token: tokenFor(assessor) }),
        withParams({ id: 'does-not-exist' })
      )
      expect(response.status).toBe(404)
    })
  })

  describe('PUT /api/v1/incidents/[id]', () => {
    test('ASSESSOR → 403', async () => {
      const incident = await createIncident({ createdBy: coordinator.id })
      const response = await updateIncident(
        makeRequest('PUT', `/api/v1/incidents/${incident.id}`, {
          body: { status: 'CONTAINED' },
          token: tokenFor(assessor),
        }),
        withParams({ id: incident.id })
      )
      expect(response.status).toBe(403)
    })

    test('COORDINATOR updates status (200) and it persists', async () => {
      const incident = await createIncident({ createdBy: coordinator.id })
      const response = await updateIncident(
        makeRequest('PUT', `/api/v1/incidents/${incident.id}`, {
          body: { status: 'CONTAINED' },
          token: tokenFor(coordinator),
        }),
        withParams({ id: incident.id })
      )
      expect(response.status).toBe(200)
      const stored = await testDb.incident.findUnique({ where: { id: incident.id } })
      expect(stored!.status).toBe('CONTAINED')
    })

    test('404 for an unknown id', async () => {
      const response = await updateIncident(
        makeRequest('PUT', '/api/v1/incidents/does-not-exist', {
          body: { status: 'CONTAINED' },
          token: tokenFor(coordinator),
        }),
        withParams({ id: 'does-not-exist' })
      )
      expect(response.status).toBe(404)
    })
  })

  describe('DELETE /api/v1/incidents/[id] — soft delete', () => {
    test('ASSESSOR → 403', async () => {
      const incident = await createIncident({ createdBy: coordinator.id })
      const response = await deleteIncident(
        makeRequest('DELETE', `/api/v1/incidents/${incident.id}`, { token: tokenFor(assessor) }),
        withParams({ id: incident.id })
      )
      expect(response.status).toBe(403)
    })

    test('COORDINATOR → 200, row survives with status RESOLVED', async () => {
      const incident = await createIncident({ createdBy: coordinator.id, status: 'ACTIVE' })
      const response = await deleteIncident(
        makeRequest('DELETE', `/api/v1/incidents/${incident.id}`, { token: tokenFor(coordinator) }),
        withParams({ id: incident.id })
      )
      expect(response.status).toBe(200)
      const stored = await testDb.incident.findUnique({ where: { id: incident.id } })
      expect(stored).not.toBeNull()
      expect(stored!.status).toBe('RESOLVED')
    })

    test('404 for an unknown id', async () => {
      const response = await deleteIncident(
        makeRequest('DELETE', '/api/v1/incidents/does-not-exist', { token: tokenFor(coordinator) }),
        withParams({ id: 'does-not-exist' })
      )
      expect(response.status).toBe(404)
    })
  })

  describe('POST /api/v1/incidents/from-assessment', () => {
    test('creates an incident and links the assessment', async () => {
      const assessment = await createPreliminaryAssessment({ reportingAgent: assessor.id })
      const response = await createFromAssessment(
        makeRequest('POST', '/api/v1/incidents/from-assessment', {
          body: {
            assessmentId: assessment.id,
            incidentData: {
              type: 'CONFLICT',
              description: 'Escalated from preliminary assessment',
              location: 'From Assessment County',
            },
          },
          token: tokenFor(assessor),
        })
      )
      expect(response.status).toBe(201)
      const body = await response.json()
      expect(body.success).toBe(true)
      expect(body.data.incident.id).toBeDefined()

      const linked = await testDb.preliminaryAssessment.findUnique({ where: { id: assessment.id } })
      expect(linked!.incidentId).toBe(body.data.incident.id)
    })

    test('404 for an unknown assessment', async () => {
      const response = await createFromAssessment(
        makeRequest('POST', '/api/v1/incidents/from-assessment', {
          body: {
            assessmentId: 'ghost-assessment',
            incidentData: {
              type: 'CONFLICT',
              description: 'x',
              location: 'y',
            },
          },
          token: tokenFor(assessor),
        })
      )
      expect(response.status).toBe(404)
    })

    test('RESPONDER → 403', async () => {
      const responder = (await createUser({ roles: ['RESPONDER'] })) as AuthedUser
      const response = await createFromAssessment(
        makeRequest('POST', '/api/v1/incidents/from-assessment', {
          body: {
            assessmentId: 'any',
            incidentData: { type: 'CONFLICT', description: 'x', location: 'y' },
          },
          token: tokenFor(responder),
        })
      )
      expect(response.status).toBe(403)
    })
  })
})
