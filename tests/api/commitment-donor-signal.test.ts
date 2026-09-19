import { CommitmentService } from '@/lib/services/commitment.service'
import { ActionSignalService } from '@/lib/services/action-signal.service'
import { createUser, createDonor, createEntity, createIncident, createEntityAssignment } from '../factories'
import { testDb, truncateTestDb } from '../helpers/test-db'

/**
 * P10-4 (5a) — CommitmentService.createCommitment must pass the donor's
 * linked USER id (users/me/donor heuristic in reverse: contactEmail →
 * organization → name → username) to the signal engine's donor branch —
 * NOT the Donor org id (an FK failure waiting to happen).
 *
 * The dispatch payload is observed with a call-through spy (the resolution
 * is private and has no other observable seam); the real engine still runs,
 * so the responder-branch rows are asserted from the database, not mocks.
 */

interface CapturedSignalPayload {
  trigger: string
  entityId?: string
  incidentId?: string
  commitmentId?: string
  donorId?: string
}

describe('P10-4 commitment donor-branch signal resolution (5a)', () => {
  let coordinatorId: string
  let responderId: string
  let entityId: string
  let incidentId: string
  let captured: CapturedSignalPayload[]
  let service: CommitmentService

  beforeAll(async () => {
    await truncateTestDb()
    const coordinator = await createUser({ roles: ['COORDINATOR'] })
    const responder = await createUser({ roles: ['RESPONDER'] })
    const entity = await createEntity()
    const incident = await createIncident({ createdBy: coordinator.id })
    coordinatorId = coordinator.id
    responderId = responder.id
    entityId = entity.id
    incidentId = incident.id
    await createEntityAssignment({ userId: responder.id, entityId, assignedBy: coordinator.id })

    captured = []
    const real = ActionSignalService.evaluateAndGenerate.bind(ActionSignalService)
    jest
      .spyOn(ActionSignalService, 'evaluateAndGenerate')
      .mockImplementation(async (payload: never, tx?: never) => {
        captured.push(payload as CapturedSignalPayload)
        return (real as (p: never, t?: never) => Promise<void>)(payload, tx)
      })

    service = new CommitmentService()
  })

  afterAll(async () => {
    jest.restoreAllMocks()
    await truncateTestDb()
    await testDb.$disconnect()
  })

  function commitmentData(donorId: string) {
    return {
      donorId,
      entityId,
      incidentId,
      items: [{ name: 'Blankets', unit: 'units', quantity: 100, deliveredQuantity: 0 }],
      totalCommittedQuantity: 100,
    }
  }

  test('linked donor: dispatch carries the linked USER id; responder rows survive; PARTIAL donor-branch signal lands for the linked user', async () => {
    const donorUser = await createUser({ roles: ['DONOR'] })
    // contactEmail match — the strongest users/me/donor linkage strategy.
    const donor = await testDb.donor.create({
      data: {
        name: `Linked Donor ${donorUser.username}`,
        type: 'ORGANIZATION',
        contactEmail: donorUser.email,
      },
    })

    const commitment = await service.createCommitment(commitmentData(donor.id), coordinatorId)

    // THE 5a contract: the engine receives the linked USER id, not donor.id.
    const payload = captured.find((p) => p.commitmentId === commitment.id)
    expect(payload).toBeDefined()
    expect(payload!.donorId).toBe(donorUser.id)
    expect(payload!.donorId).not.toBe(donor.id)
    expect(payload!.trigger).toBe('commitment-created')

    // The responder-branch rows survived the dispatch (previously the org-id
    // donorId could FK-fail the handler mid-loop).
    const responderSignal = await testDb.actionSignal.findFirst({
      where: {
        userId: responderId,
        entityId,
        incidentId,
        signalReason: 'awaiting-plan-for-commitment',
      },
    })
    expect(responderSignal).not.toBeNull()

    // Drive the PARTIAL lifecycle with the donorId the service resolved: the
    // donor branch must produce the 'partially-fulfilled' signal for the
    // LINKED USER.
    await testDb.donorCommitment.update({
      where: { id: commitment.id },
      data: { status: 'PARTIAL', deliveredQuantity: 40 },
    })
    await ActionSignalService.evaluateAndGenerate({
      trigger: 'commitment-updated',
      entityId,
      incidentId,
      commitmentId: commitment.id,
      donorId: payload!.donorId,
    })
    const donorSignal = await testDb.actionSignal.findFirst({
      where: {
        userId: donorUser.id,
        entityId,
        incidentId,
        signalReason: 'partially-fulfilled',
      },
    })
    expect(donorSignal).not.toBeNull()
  })

  test('unlinked donor: donorId omitted (branch skipped), no crash, responder rows still generated', async () => {
    // Factory donor: unique email that no user holds, null organization.
    const donor = await createDonor()
    const commitment = await service.createCommitment(commitmentData(donor.id), coordinatorId)

    // No crash, and the dispatch omits donorId entirely (skipped branch).
    expect(await testDb.donorCommitment.count({ where: { id: commitment.id } })).toBe(1)
    const payload = captured.find((p) => p.commitmentId === commitment.id)
    expect(payload).toBeDefined()
    expect(payload!.donorId).toBeUndefined()

    // The org id never leaked into a signal recipient slot.
    expect(await testDb.actionSignal.count({ where: { userId: donor.id } })).toBe(0)

    const responderSignal = await testDb.actionSignal.findFirst({
      where: {
        userId: responderId,
        entityId,
        incidentId,
        signalReason: 'awaiting-plan-for-commitment',
        context: { path: ['commitmentId'], equals: commitment.id },
      },
    })
    expect(responderSignal).not.toBeNull()
  })
})
