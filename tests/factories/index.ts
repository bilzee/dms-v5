import bcrypt from 'bcryptjs'
import type {
  User,
  Entity,
  Incident,
  PreliminaryAssessment,
  RapidAssessment,
  Donor,
  DonorCommitment,
  RapidResponse,
  EntityAssignment,
  ActionSignal,
  Role,
} from '@prisma/client'
import { testDb } from '../helpers/test-db'
import { buildQuestionSnapshot } from '../../src/lib/questions/question-snapshot'
import type { RapidAssessmentType } from '../../src/lib/questions/answers'
import { getRegistryVersions } from '../../src/lib/questions/registry-versions'
import { seedQuestions } from '../../prisma/seed-questions'

/**
 * Data factories for the API integration suite (tests/api/**).
 *
 * Rules (tests/resources/knowledge/test-quality.md + data-factories.md):
 * - Every factory generates UNIQUE data (timestamp + random suffix) so tests
 *   are parallel-safe and re-runnable without manual cleanup between them.
 * - Every factory accepts a partial override so each test states only what
 *   matters to it.
 * - Factories write to drms_test via the shared test client. They must never
 *   be imported by the jsdom unit suite.
 */

export type RoleName = 'ASSESSOR' | 'COORDINATOR' | 'RESPONDER' | 'DONOR' | 'ADMIN'

export const DEFAULT_TEST_PASSWORD = 'TestPass123!'

let counter = 0
function uniq(): string {
  counter += 1
  return `${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

export function uniqueEmail(prefix = 'user'): string {
  return `${prefix}-${uniq()}@dms.test`
}

/** Upsert the five application roles. Idempotent; call in beforeAll. */
export async function ensureRoles(): Promise<Record<RoleName, Role>> {
  const names: RoleName[] = ['ASSESSOR', 'COORDINATOR', 'RESPONDER', 'DONOR', 'ADMIN']
  const result = {} as Record<RoleName, Role>
  for (const name of names) {
    result[name] = await testDb.role.upsert({
      where: { name },
      update: {},
      create: { name, description: `${name} role (test)` },
    })
  }
  return result
}

export interface CreateUserOptions {
  roles?: RoleName[]
  password?: string
  email?: string
  name?: string
  isActive?: boolean
  isLocked?: boolean
}

/** Create a user with unique email/username and the given roles. */
export async function createUser(options: CreateUserOptions = {}): Promise<User> {
  const roleNames = options.roles ?? ['ASSESSOR']
  const password = options.password ?? DEFAULT_TEST_PASSWORD
  const email = options.email ?? uniqueEmail(roleNames[0].toLowerCase())
  const suffix = uniq()

  const roleRecords = await ensureRoles()

  return testDb.user.create({
    data: {
      email,
      username: `user-${suffix}`,
      passwordHash: await bcrypt.hash(password, 10),
      name: options.name ?? `Test ${roleNames.join('/')} User ${suffix}`,
      isActive: options.isActive ?? true,
      isLocked: options.isLocked ?? false,
      roles: {
        create: roleNames.map((name) => ({
          roleId: roleRecords[name].id,
          assignedBy: 'test-factory',
        })),
      },
    },
    include: {
      roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
    },
  }) as unknown as User
}

export interface CreateEntityOptions {
  name?: string
  type?: 'COMMUNITY' | 'WARD' | 'LGA' | 'STATE' | 'FACILITY' | 'CAMP'
  autoApproveEnabled?: boolean
}

export async function createEntity(options: CreateEntityOptions = {}): Promise<Entity> {
  const suffix = uniq()
  return testDb.entity.create({
    data: {
      name: options.name ?? `Test Entity ${suffix}`,
      type: options.type ?? 'COMMUNITY',
      location: `Test Location ${suffix}`,
      coordinates: { latitude: 11.8 + Math.random(), longitude: 13.1 + Math.random() },
      autoApproveEnabled: options.autoApproveEnabled ?? false,
    },
  })
}

export interface CreateIncidentOptions {
  createdBy: string
  name?: string
  type?: string
  severity?: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'UNCLASSIFIED'
  status?: 'ACTIVE' | 'CONTAINED' | 'RESOLVED'
}

export async function createIncident(options: CreateIncidentOptions): Promise<Incident> {
  const suffix = uniq()
  return testDb.incident.create({
    data: {
      name: options.name ?? `Test Incident ${suffix}`,
      type: options.type ?? 'FLOOD',
      description: `Test incident description ${suffix}`,
      location: `Test Location ${suffix}`,
      severity: options.severity ?? 'UNCLASSIFIED',
      status: options.status ?? 'ACTIVE',
      createdBy: options.createdBy,
    },
  })
}

export interface CreatePreliminaryAssessmentOptions {
  reportingAgent: string
  incidentId?: string
  entityIds?: string[]
  numberLivesLost?: number
  numberInjured?: number
  numberDisplaced?: number
}

export async function createPreliminaryAssessment(
  options: CreatePreliminaryAssessmentOptions
): Promise<PreliminaryAssessment> {
  const suffix = uniq()
  return testDb.preliminaryAssessment.create({
    data: {
      reportingDate: new Date(),
      reportingLatitude: 11.8,
      reportingLongitude: 13.1,
      reportingLGA: `Test LGA ${suffix}`,
      reportingWard: `Test Ward ${suffix}`,
      reportingAgent: options.reportingAgent,
      numberLivesLost: options.numberLivesLost ?? 0,
      numberInjured: options.numberInjured ?? 0,
      numberDisplaced: options.numberDisplaced ?? 0,
      incidentId: options.incidentId ?? null,
      affectedEntities: options.entityIds
        ? { create: options.entityIds.map((entityId) => ({ entityId })) }
        : undefined,
    },
  })
}

/**
 * Ensures the question registry exists in drms_test. `truncateTestDb()` wipes it,
 * so every suite that creates assessments through the API (service path requires
 * active registry questions) must call this in beforeAll after truncating.
 * Idempotent: seeds only when the questions table is empty.
 */
export async function ensureQuestionRegistry(): Promise<void> {
  const existing = await testDb.question.count()
  if (existing === 0) {
    await seedQuestions(testDb)
  }
}

export interface CreateRapidAssessmentOptions {
  assessorId: string
  assessorName?: string
  entityId: string
  incidentId: string
  assessmentType?: 'HEALTH' | 'WASH' | 'SHELTER' | 'FOOD' | 'SECURITY' | 'POPULATION'
  priority?: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'UNCLASSIFIED'
  verificationStatus?: 'DRAFT' | 'SUBMITTED' | 'VERIFIED' | 'AUTO_VERIFIED' | 'REJECTED'
  rapidAssessmentDate?: Date
  /** Registry-keyed answers map, stored verbatim ({ [questionKey]: value }). */
  answers?: Record<string, unknown>
  /** Stamp the live registry snapshot + versions (registry-governance fixtures). */
  withSnapshot?: boolean
}

export async function createRapidAssessment(
  options: CreateRapidAssessmentOptions
): Promise<RapidAssessment> {
  const assessmentType = options.assessmentType ?? 'HEALTH'
  // Answers layer: the registry-keyed answers map is stored verbatim (the
  // typed sector payloads and toAnswers conversion were deleted in P4).
  // Freeze-rule fixtures: stamp structureVersion/contentVersion/questionSnapshot
  // from the live drms_test registry, exactly as the service path would.
  let snapshotData:
    | { structureVersion: number; contentVersion: number; questionSnapshot: unknown }
    | undefined
  if (options.withSnapshot) {
    const questions = await testDb.question.findMany({
      where: { assessmentType, isActive: true },
      orderBy: [{ section: { order: 'asc' } }, { order: 'asc' }],
      include: {
        section: {
          select: { sectionKey: true, title: true, description: true, category: true, order: true },
        },
      },
    })
    const versions = await getRegistryVersions(testDb, assessmentType as RapidAssessmentType)
    snapshotData = {
      ...versions,
      questionSnapshot: buildQuestionSnapshot(questions, versions),
    }
  }
  return testDb.rapidAssessment.create({
    data: {
      rapidAssessmentType: assessmentType,
      rapidAssessmentDate: options.rapidAssessmentDate ?? new Date(),
      assessorId: options.assessorId,
      assessorName: options.assessorName ?? 'Test Assessor',
      entityId: options.entityId,
      incidentId: options.incidentId,
      priority: options.priority ?? 'MEDIUM',
      verificationStatus: options.verificationStatus ?? 'SUBMITTED',
      answers: options.answers ? (options.answers as never) : undefined,
      ...(snapshotData
        ? {
            structureVersion: snapshotData.structureVersion,
            contentVersion: snapshotData.contentVersion,
            questionSnapshot: snapshotData.questionSnapshot as never,
          }
        : {}),
    },
  })
}

export interface CreateDonorOptions {
  name?: string
  type?: 'INDIVIDUAL' | 'ORGANIZATION' | 'GOVERNMENT' | 'NGO' | 'CORPORATE'
}

export async function createDonor(options: CreateDonorOptions = {}): Promise<Donor> {
  const suffix = uniq()
  return testDb.donor.create({
    data: {
      name: options.name ?? `Test Donor ${suffix}`,
      type: options.type ?? 'ORGANIZATION',
      contactEmail: uniqueEmail('donor'),
    },
  })
}

export interface CommitmentItem {
  name: string
  quantity: number
  unit: string
}

export interface CreateDonorCommitmentOptions {
  donorId: string
  entityId: string
  incidentId: string
  items?: CommitmentItem[]
  status?: 'PLANNED' | 'PARTIAL' | 'COMPLETE' | 'CANCELLED'
  type?: 'HEALTH' | 'WASH' | 'SHELTER' | 'FOOD' | 'SECURITY' | 'POPULATION' | 'LOGISTICS'
}

export async function createDonorCommitment(
  options: CreateDonorCommitmentOptions
): Promise<DonorCommitment> {
  const items = options.items ?? [
    { name: `Test Item ${uniq()}`, quantity: 100, unit: 'units' },
  ]
  return testDb.donorCommitment.create({
    data: {
      donorId: options.donorId,
      entityId: options.entityId,
      incidentId: options.incidentId,
      type: options.type ?? 'LOGISTICS',
      status: options.status ?? 'PLANNED',
      items: items as unknown as object[],
      totalCommittedQuantity: items.reduce((sum, item) => sum + item.quantity, 0),
    },
  })
}

export interface CreateRapidResponseOptions {
  responderId: string
  entityId: string
  assessmentId: string
  items?: CommitmentItem[]
  type?: 'HEALTH' | 'WASH' | 'SHELTER' | 'FOOD' | 'SECURITY' | 'POPULATION' | 'LOGISTICS'
  deliveryStatus?: 'PLANNED' | 'DELIVERED'
  verificationStatus?: 'DRAFT' | 'SUBMITTED' | 'VERIFIED' | 'AUTO_VERIFIED' | 'REJECTED'
}

export async function createRapidResponse(
  options: CreateRapidResponseOptions
): Promise<RapidResponse> {
  const items = options.items ?? [
    { name: `Test Item ${uniq()}`, quantity: 50, unit: 'units' },
  ]
  return testDb.rapidResponse.create({
    data: {
      responderId: options.responderId,
      entityId: options.entityId,
      assessmentId: options.assessmentId,
      type: options.type ?? 'LOGISTICS',
      deliveryStatus: options.deliveryStatus ?? 'PLANNED',
      verificationStatus: options.verificationStatus ?? 'DRAFT',
      items: items as unknown as object[],
    },
  })
}

export interface CreateEntityAssignmentOptions {
  userId: string
  entityId: string
  assignedBy: string
}

export async function createEntityAssignment(
  options: CreateEntityAssignmentOptions
): Promise<EntityAssignment> {
  return testDb.entityAssignment.create({
    data: {
      userId: options.userId,
      entityId: options.entityId,
      assignedBy: options.assignedBy,
    },
  })
}

export interface CreateActionSignalOptions {
  userId: string
  entityId: string
  incidentId?: string
  type?: string
  signalReason?: string
  priority?: string
}

export async function createActionSignal(
  options: CreateActionSignalOptions
): Promise<ActionSignal> {
  const suffix = uniq()
  return testDb.actionSignal.create({
    data: {
      userId: options.userId,
      entityId: options.entityId,
      incidentId: options.incidentId ?? null,
      type: options.type ?? 'ASSESSMENT_STALE',
      signalReason: options.signalReason ?? `test reason ${suffix}`,
      priority: options.priority ?? 'MEDIUM',
      context: { source: 'test-factory' } as unknown as object,
    },
  })
}

/** Grant a permission (by code) to a role, creating the Permission row if needed. */
export async function grantPermission(roleName: RoleName, code: string, category = 'test'): Promise<void> {
  const roles = await ensureRoles()
  const permission = await testDb.permission.upsert({
    where: { code },
    update: {},
    create: { name: code, code, category, description: `${code} (test)` },
  })
  await testDb.rolePermission.upsert({
    where: { roleId_permissionId: { roleId: roles[roleName].id, permissionId: permission.id } },
    update: {},
    create: { roleId: roles[roleName].id, permissionId: permission.id },
  })
}
