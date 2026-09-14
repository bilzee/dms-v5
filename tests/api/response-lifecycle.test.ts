import { POST as createCommitment } from '@/app/api/v1/commitments/route'
import { POST as createFromCommitment } from '@/app/api/v1/responses/from-commitment/route'
import { POST as deliverResponse } from '@/app/api/v1/responses/[id]/deliver/route'
import { POST as verifyResponse } from '@/app/api/v1/responses/[id]/verify/route'
import { makeRequest, tokenFor, withParams, type AuthedUser } from '../helpers/api'
import {
  createUser,
  createEntity,
  createIncident,
  createDonor,
  createEntityAssignment,
} from '../factories'
import { testDb, truncateTestDb } from '../helpers/test-db'

/**
 * P0 — Delivery lifecycle:
 * donor commitment → response plan (from-commitment import) → delivery
 * confirmation (commitment progress propagation) → coordinator verification.
 */

describe('P0 commitment → response → deliver → verify lifecycle', () => {
  let donorUser: AuthedUser
  let coordinator: AuthedUser
  let responder: AuthedUser
  let entityId: string
  let incidentId: string
  let donorId: string
  let commitmentId: string

  beforeAll(async () => {
    await truncateTestDb()
    donorUser = (await createUser({ roles: ['DONOR'] })) as AuthedUser
    coordinator = (await createUser({ roles: ['COORDINATOR'] })) as AuthedUser
    responder = (await createUser({ roles: ['RESPONDER'] })) as AuthedUser
    entityId = (await createEntity()).id
    incidentId = (await createIncident({ createdBy: coordinator.id })).id
    donorId = (await createDonor()).id
    await createEntityAssignment({ userId: responder.id, entityId, assignedBy: coordinator.id })
  })

  afterAll(async () => {
    await truncateTestDb()
    await testDb.$disconnect()
  })

  test('DONOR creates a commitment (201) with items persisted', async () => {
    const response = await createCommitment(
      makeRequest('POST', '/api/v1/commitments', {
        body: {
          donorId,
          entityId,
          incidentId,
          items: [
            { name: 'Blankets', unit: 'pcs', quantity: 100 },
            { name: 'Water', unit: 'cartons', quantity: 50 },
          ],
        },
        token: tokenFor(donorUser),
      })
    )
    expect(response.status).toBe(201)
    const body = await response.json()
    commitmentId = body.data.id

    const stored = await testDb.donorCommitment.findUnique({ where: { id: commitmentId } })
    expect(stored).not.toBeNull()
    expect(stored!.status).toBe('PLANNED')
    expect((stored!.items as any[]).map((i) => i.name)).toEqual(
      expect.arrayContaining(['Blankets', 'Water'])
    )
  })

  test('RESPONDER imports a partial plan from the commitment', async () => {
    const response = await createFromCommitment(
      makeRequest('POST', '/api/v1/responses/from-commitment', {
        body: {
          commitmentId,
          items: [{ name: 'Blankets', unit: 'pcs', quantity: 40 }],
          createAsPlan: true,
        },
        token: tokenFor(responder),
      })
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.success).toBe(true)
    expect(body.data.deliveryStatus).toBe('PLANNED')
    expect(body.data.verificationStatus).toBe('DRAFT')
    expect(body.data.sourceCommitmentId).toBe(commitmentId)

    const audit = await testDb.auditLog.findFirst({
      where: { action: 'CREATE_PLAN_FROM_COMMITMENT', resourceId: body.data.id },
    })
    expect(audit).not.toBeNull()

    // Plan creation must not move commitment progress
    const commitment = await testDb.donorCommitment.findUnique({ where: { id: commitmentId } })
    expect(commitment!.deliveredQuantity).toBe(0)
    expect(commitment!.status).toBe('PLANNED')
  })

  test('importing more than committed → 400', async () => {
    const response = await createFromCommitment(
      makeRequest('POST', '/api/v1/responses/from-commitment', {
        body: {
          commitmentId,
          items: [{ name: 'Blankets', unit: 'pcs', quantity: 5000 }],
        },
        token: tokenFor(responder),
      })
    )
    expect(response.status).toBe(400)
  })

  test('importing an item not in the commitment → 400', async () => {
    const response = await createFromCommitment(
      makeRequest('POST', '/api/v1/responses/from-commitment', {
        body: {
          commitmentId,
          items: [{ name: 'Helicopter', unit: 'pcs', quantity: 1 }],
        },
        token: tokenFor(responder),
      })
    )
    expect(response.status).toBe(400)
  })

  test('DONOR (non-responder) cannot import → 403', async () => {
    const response = await createFromCommitment(
      makeRequest('POST', '/api/v1/responses/from-commitment', {
        body: {
          commitmentId,
          items: [{ name: 'Blankets', unit: 'pcs', quantity: 1 }],
        },
        token: tokenFor(donorUser),
      })
    )
    expect(response.status).toBe(403)
  })

  test('unknown commitment → 404', async () => {
    const response = await createFromCommitment(
      makeRequest('POST', '/api/v1/responses/from-commitment', {
        body: {
          commitmentId: 'ghost-commitment',
          items: [{ name: 'Blankets', unit: 'pcs', quantity: 1 }],
        },
        token: tokenFor(responder),
      })
    )
    expect(response.status).toBe(404)
  })

  describe('delivery confirmation', () => {
    let responseId: string

    beforeAll(async () => {
      const plan = await testDb.rapidResponse.findFirst({
        where: { sourceCommitmentId: commitmentId },
      })
      expect(plan).not.toBeNull()
      responseId = plan!.id
    })

    test('rejects empty deliveredItems with 400', async () => {
      const response = await deliverResponse(
        makeRequest('POST', `/api/v1/responses/${responseId}/deliver`, {
          body: { deliveredItems: [] },
          token: tokenFor(responder),
        }),
        withParams({ id: responseId })
      )
      expect(response.status).toBe(400)
    })

    test('CONFIRM_DELIVERY event: RESPONDER confirms → DELIVERED/SUBMITTED + commitment progress', async () => {
      const response = await deliverResponse(
        makeRequest('POST', `/api/v1/responses/${responseId}/deliver`, {
          body: {
            deliveredItems: [{ name: 'Blankets', unit: 'pcs', quantity: 40 }],
            deliveryLocation: { latitude: 11.8, longitude: 13.1 },
            deliveryNotes: 'Delivered to distribution point',
          },
          token: tokenFor(responder),
        }),
        withParams({ id: responseId })
      )
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.success).toBe(true)

      const stored = await testDb.rapidResponse.findUnique({ where: { id: responseId } })
      expect(stored!.deliveryStatus).toBe('DELIVERED')
      expect(stored!.verificationStatus).toBe('SUBMITTED')
      expect((stored!.items as any[])[0]).toMatchObject({ name: 'Blankets', quantity: 40 })
      const resources = stored!.resources as Record<string, unknown>
      expect(resources.deliveryLocation).toMatchObject({ latitude: 11.8, longitude: 13.1 })

      const commitment = await testDb.donorCommitment.findUnique({ where: { id: commitmentId } })
      expect(commitment!.deliveredQuantity).toBe(40)
      expect(commitment!.status).toBe('PARTIAL')
      const blankets = (commitment!.items as any[]).find((i) => i.name === 'Blankets')
      expect(blankets.deliveredQuantity).toBe(40)
    })

    test('confirming delivery twice → 500 (characterized: message-mapping drift)', async () => {
      // Service throws 'Only planned responses can have delivery confirmed' but the
      // route only matches '...confirmed as delivered', so the 409 branch never
      // fires and the error escapes as 500. Pinned so a fix flips this to 409.
      const responseIdAgain = await testDb.rapidResponse.findFirst({
        where: { sourceCommitmentId: commitmentId },
        select: { id: true },
      })
      const response = await deliverResponse(
        makeRequest('POST', `/api/v1/responses/${responseIdAgain!.id}/deliver`, {
          body: { deliveredItems: [{ name: 'Blankets', unit: 'pcs', quantity: 40 }] },
          token: tokenFor(responder),
        }),
        withParams({ id: responseIdAgain!.id })
      )
      expect(response.status).toBe(500)
    })

    test('delivery confirmation by an UNASSIGNED responder → 403', async () => {
      const commitment2 = await testDb.donorCommitment.create({
        data: {
          donorId,
          entityId,
          incidentId,
          items: [{ name: 'Tents', unit: 'pcs', quantity: 10 }],
          totalCommittedQuantity: 10,
          status: 'PLANNED',
        },
      })
      const plan = await createFromCommitment(
        makeRequest('POST', '/api/v1/responses/from-commitment', {
          body: {
            commitmentId: commitment2.id,
            items: [{ name: 'Tents', unit: 'pcs', quantity: 10 }],
            createAsPlan: true,
          },
          token: tokenFor(responder),
        })
      )
      expect(plan.status).toBe(200)
      const planId = (await plan.json()).data.id

      const stranger = (await createUser({ roles: ['RESPONDER'] })) as AuthedUser
      const response = await deliverResponse(
        makeRequest('POST', `/api/v1/responses/${planId}/deliver`, {
          body: { deliveredItems: [{ name: 'Tents', unit: 'pcs', quantity: 10 }] },
          token: tokenFor(stranger),
        }),
        withParams({ id: planId })
      )
      expect(response.status).toBe(403)
      const stored = await testDb.rapidResponse.findUnique({ where: { id: planId } })
      expect(stored!.deliveryStatus).toBe('PLANNED')
    })
  })

  describe('response verification', () => {
    let deliveredResponseId: string

    beforeAll(async () => {
      const delivered = await testDb.rapidResponse.findFirst({
        where: { deliveryStatus: 'DELIVERED', verificationStatus: 'SUBMITTED' },
        orderBy: { updatedAt: 'asc' },
      })
      expect(delivered).not.toBeNull()
      deliveredResponseId = delivered!.id
    })

    test('RESPONDER cannot verify → 403', async () => {
      const response = await verifyResponse(
        makeRequest('POST', `/api/v1/responses/${deliveredResponseId}/verify`, {
          body: {},
          token: tokenFor(responder),
        })
      )
      expect(response.status).toBe(403)
    })

    test('COORDINATOR verifies → VERIFIED + audit log', async () => {
      const response = await verifyResponse(
        makeRequest('POST', `/api/v1/responses/${deliveredResponseId}/verify`, {
          body: { notes: 'Delivery evidence checked' },
          token: tokenFor(coordinator),
        })
      )
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.success).toBe(true)

      const stored = await testDb.rapidResponse.findUnique({ where: { id: deliveredResponseId } })
      expect(stored!.verificationStatus).toBe('VERIFIED')
      expect(stored!.verifiedBy).toBe(coordinator.id)
      expect(stored!.verifiedAt).not.toBeNull()

      const audit = await testDb.auditLog.findFirst({
        where: { action: 'VERIFY_RESPONSE', resourceId: deliveredResponseId },
      })
      expect(audit).not.toBeNull()
    })

    test('re-verifying → 400', async () => {
      const response = await verifyResponse(
        makeRequest('POST', `/api/v1/responses/${deliveredResponseId}/verify`, {
          body: {},
          token: tokenFor(coordinator),
        })
      )
      expect(response.status).toBe(400)
    })

    test('unknown response → 404', async () => {
      const response = await verifyResponse(
        makeRequest('POST', '/api/v1/responses/ghost/verify', {
          body: {},
          token: tokenFor(coordinator),
        })
      )
      expect(response.status).toBe(404)
    })
  })
})
