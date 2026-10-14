/**
 * Production-simulation seed — a fully populated, bottom-up consistent world.
 *
 * Run:   SEED_SIMULATION=1 (container entrypoint)  or  `npx tsx prisma/seed-simulation.ts`
 * After: `prisma db seed` (baseline: permissions, roles, entities, registry).
 *
 * Unlike prisma/seed.ts (which raw-inserts its demo world without rollups or
 * signals), this script builds every artefact through the SAME service-layer
 * flows the UI/API routes use, so derived state is exactly what a live
 * operator session would produce:
 *
 *   users/roles/assignments → incidents → preliminary assessments →
 *   registry severity authoring (admin severity page parity) →
 *   rapid assessments via RapidAssessmentService.create (frozen snapshot,
 *   engine-derived gapAnalysis + priority) → coordinator verify/reject
 *   (route-parity: audit + signals + gap re-derive + incident rollup) →
 *   donor commitments via CommitmentService.createCommitment →
 *   response plans (ResponseService.createPlannedResponse + the
 *   from-commitment route flow) → deliveries via ResponseService.confirmDelivery
 *   (commitment quantity/status rollup) → response verification
 *   (route-parity signals incl. reassessment-needed).
 *
 * The result: question answers → gap severities → assessment priorities →
 * incident severities propagate bottom-up, and ActionSignals + Notifications
 * exist for every stakeholder (coordinator queues, responder worklists,
 * donor coverage/partial-fulfilment, assessor reassessment).
 *
 * Severity ladder: the seeded catalog ships every GAP question at MEDIUM, so
 * this seed first authorizes severities through QuestionRegistryService
 * .setSeverity (exactly the admin severity page) to give the world a real
 * CRITICAL/HIGH/MEDIUM/LOW spread.
 *
 * Idempotency: the simulation world owns fixed incident ids (sim-incident-*)
 * and is fully reconstructed on every run — the baseline `prisma db seed`
 * wipes assessments/commitments/responses on re-run, so this script deletes
 * its previous scoped world first (never touching rows it did not create:
 * scope = sim incidents + sim commitments + placeholder assessments).
 */

import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { seedQuestions } from './seed-questions'
import { seedCrossFieldRules } from './seed-rules'
import { RapidAssessmentService } from '../src/lib/services/rapid-assessment.service'
import { PreliminaryAssessmentService } from '../src/lib/services/preliminary-assessment.service'
import { CommitmentService } from '../src/lib/services/commitment.service'
import { ResponseService } from '../src/lib/services/response.service'
import { QuestionRegistryService } from '../src/lib/services/question-registry.service'
import { ActionSignalService } from '../src/lib/services/action-signal.service'
import { IncidentService } from '../src/lib/services/incident.service'
import { incidentSeverityService } from '../src/lib/services/incident-severity.service'

const prisma = new PrismaClient()

const SIM_PASSWORD = 'SimPass123!'
const INCIDENT_IDS = [
  'sim-incident-flood',
  'sim-incident-conflict',
  'sim-incident-outbreak',
] as const

const daysAgo = (days: number): Date => new Date(Date.now() - days * 24 * 60 * 60 * 1000)

/** Deterministic question ids are `{TYPE}:{questionKey}` (see registry-validation). */
const qid = (type: string, key: string): string => `${type}:${key}`

async function main(): Promise<void> {
  console.log('🌍 Seeding production simulation world...')

  // ------------------------------------------------------------------
  // 0. Prerequisites — baseline seed usually ran already; make the script
  //    standalone-safe (roles + registry) without duplicating its world.
  // ------------------------------------------------------------------
  const roleNames = ['ASSESSOR', 'COORDINATOR', 'RESPONDER', 'DONOR', 'ADMIN']
  const roleIds: Record<string, string> = {}
  for (const name of roleNames) {
    const role = await prisma.role.upsert({
      where: { name },
      update: {},
      create: { name, description: `${name.charAt(0)}${name.slice(1).toLowerCase()} role` },
    })
    roleIds[name] = role.id
  }

  if ((await prisma.question.count()) === 0) {
    console.log('📚 Registry missing — seeding question catalog + rules...')
    await seedQuestions(prisma)
    await seedCrossFieldRules(prisma)
  }

  // ------------------------------------------------------------------
  // 1. Scoped cleanup of the previous simulation world (see header note).
  // ------------------------------------------------------------------
  console.log('🧹 Clearing previous simulation world...')
  await prisma.notification.deleteMany({
    where: { signal: { incidentId: { in: [...INCIDENT_IDS] } } },
  })
  await prisma.actionSignal.deleteMany({ where: { incidentId: { in: [...INCIDENT_IDS] } } })
  await prisma.planCommitment.deleteMany({
    where: {
      OR: [
        { commitment: { incidentId: { in: [...INCIDENT_IDS] } } },
        { plan: { assessment: { incidentId: { in: [...INCIDENT_IDS] } } } },
      ],
    },
  })
  await prisma.rapidResponse.deleteMany({
    where: {
      OR: [
        { assessment: { incidentId: { in: [...INCIDENT_IDS] } } },
        { sourceCommitment: { incidentId: { in: [...INCIDENT_IDS] } } },
      ],
    },
  })
  await prisma.donorCommitment.deleteMany({ where: { incidentId: { in: [...INCIDENT_IDS] } } })
  await prisma.preliminaryAssessmentEntity.deleteMany({
    where: { preliminaryAssessment: { incidentId: { in: [...INCIDENT_IDS] } } },
  })
  await prisma.preliminaryAssessment.deleteMany({ where: { incidentId: { in: [...INCIDENT_IDS] } } })
  await prisma.rapidAssessment.deleteMany({ where: { incidentId: { in: [...INCIDENT_IDS] } } })
  await prisma.incident.deleteMany({ where: { id: { in: [...INCIDENT_IDS] } } })

  // ------------------------------------------------------------------
  // 2. Simulation users (docs/production-simulation roster).
  // ------------------------------------------------------------------
  console.log('👤 Creating simulation users...')
  const simPasswordHash = await bcrypt.hash(SIM_PASSWORD, 10)

  interface SimUserSpec {
    email: string
    username: string
    name: string
    organization: string
    roles: string[]
  }
  const userSpecs: SimUserSpec[] = [
    { email: 'sim.admin@dms-sim.gov.ng', username: 'sim.admin', name: 'Simulation Admin', organization: 'Borno State Emergency Management Agency', roles: ['ADMIN'] },
    { email: 'sim.coord@dms-sim.gov.ng', username: 'sim.coord', name: 'Simulation Coordinator', organization: 'Borno State Emergency Management Agency', roles: ['COORDINATOR'] },
    { email: 'sim.assessor@dms-sim.gov.ng', username: 'sim.assessor', name: 'Field Assessor One', organization: 'Borno State Emergency Management Agency', roles: ['ASSESSOR'] },
    { email: 'sim.assessor2@dms-sim.gov.ng', username: 'sim.assessor2', name: 'Field Assessor Two', organization: 'Borno State Emergency Management Agency', roles: ['ASSESSOR'] },
    { email: 'sim.responder@dms-sim.gov.ng', username: 'sim.responder', name: 'Response Officer One', organization: 'National Emergency Management Agency', roles: ['RESPONDER'] },
    { email: 'sim.responder2@dms-sim.gov.ng', username: 'sim.responder2', name: 'Response Officer Two', organization: 'National Emergency Management Agency', roles: ['RESPONDER'] },
    { email: 'sim.multirole@dms-sim.gov.ng', username: 'sim.multirole', name: 'Multi-Role Officer', organization: 'Borno State Emergency Management Agency', roles: ['ASSESSOR', 'COORDINATOR', 'RESPONDER', 'DONOR'] },
    { email: 'sim.donor1@redcross-sim.org', username: 'sim.donor1', name: 'Red Cross Sim Coordinator', organization: 'Red Cross Sim', roles: ['DONOR'] },
    { email: 'sim.donor2@unicef-sim.org', username: 'sim.donor2', name: 'UNICEF Sim Coordinator', organization: 'UNICEF Sim', roles: ['DONOR'] },
    { email: 'sim.donor3@govt-aid-sim.gov.ng', username: 'sim.donor3', name: 'Govt Aid Sim Coordinator', organization: 'Government Aid Sim', roles: ['DONOR'] },
  ]

  const users: Record<string, { id: string; name: string }> = {}
  for (const spec of userSpecs) {
    const user = await prisma.user.upsert({
      where: { email: spec.email },
      update: { name: spec.name, organization: spec.organization },
      create: {
        email: spec.email,
        username: spec.username,
        passwordHash: simPasswordHash,
        name: spec.name,
        organization: spec.organization,
      },
    })
    users[spec.username] = { id: user.id, name: user.name }
    for (const roleName of spec.roles) {
      await prisma.userRole.upsert({
        where: { userId_roleId: { userId: user.id, roleId: roleIds[roleName] } },
        update: {},
        create: { userId: user.id, roleId: roleIds[roleName], assignedBy: users['sim.admin']?.id ?? 'system' },
      })
    }
  }

  // Local operator account (prisma/seed-essential.ts parity).
  const adminHash = await bcrypt.hash('Admin@123456', 10)
  const localAdmin = await prisma.user.upsert({
    where: { email: 'admin@drms.local' },
    update: {},
    create: {
      email: 'admin@drms.local',
      username: 'drms.admin',
      passwordHash: adminHash,
      name: 'DRMS Local Administrator',
      organization: 'Disaster Management System',
    },
  })
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: localAdmin.id, roleId: roleIds['ADMIN'] } },
    update: {},
    create: { userId: localAdmin.id, roleId: roleIds['ADMIN'], assignedBy: 'system' },
  })

  // ------------------------------------------------------------------
  // 3. Donor organisations (linked to donor users via contactEmail — the
  //    commitment-signal donor-resolution heuristic).
  // ------------------------------------------------------------------
  console.log('🏢 Creating donor organisations...')
  const donors = {
    redcross: await prisma.donor.upsert({
      where: { id: 'sim-donor-redcross' },
      update: {},
      create: {
        id: 'sim-donor-redcross',
        name: 'Red Cross Sim',
        type: 'NGO',
        contactEmail: 'sim.donor1@redcross-sim.org',
        contactPhone: '+234-600-000-0001',
        organization: 'Red Cross Sim',
      },
    }),
    unicef: await prisma.donor.upsert({
      where: { id: 'sim-donor-unicef' },
      update: {},
      create: {
        id: 'sim-donor-unicef',
        name: 'UNICEF Sim',
        type: 'NGO',
        contactEmail: 'sim.donor2@unicef-sim.org',
        contactPhone: '+234-600-000-0002',
        organization: 'UNICEF Sim',
      },
    }),
    govtAid: await prisma.donor.upsert({
      where: { id: 'sim-donor-govtaid' },
      update: {},
      create: {
        id: 'sim-donor-govtaid',
        name: 'Govt Aid Sim',
        type: 'GOVERNMENT',
        contactEmail: 'sim.donor3@govt-aid-sim.gov.ng',
        contactPhone: '+234-600-000-0003',
        organization: 'Government Aid Sim',
      },
    }),
  }

  // ------------------------------------------------------------------
  // 4. Entities — 8 per the simulation dataset summary. The FACILITY runs
  //    auto-approval (assessments/filed deliveries verify instantly).
  // ------------------------------------------------------------------
  console.log('🏘️  Creating simulation entities...')
  const entitySpecs = [
    { id: 'sim-entity-gwange', name: 'Gwange Ward Community', type: 'COMMUNITY', location: 'Gwange Ward, Maiduguri', lat: 11.8421, lng: 13.1501 },
    { id: 'sim-entity-bulunkutu', name: 'Bulunkutu Community', type: 'COMMUNITY', location: 'Bulunkutu, Maiduguri', lat: 11.8032, lng: 13.1352 },
    { id: 'sim-entity-gwange-ward', name: 'Gwange Ward', type: 'WARD', location: 'Maiduguri, Borno State', lat: 11.8402, lng: 13.1512 },
    { id: 'sim-entity-jere-ward', name: 'Gongulong Ward', type: 'WARD', location: 'Jere, Borno State', lat: 11.8754, lng: 13.2201 },
    { id: 'sim-entity-maiduguri-lga', name: 'Maiduguri Metropolitan Area', type: 'LGA', location: 'Borno State', lat: 11.8311, lng: 13.1566 },
    { id: 'sim-entity-dalori-camp', name: 'Dalori IDP Camp', type: 'CAMP', location: 'Maiduguri, Borno State', lat: 11.7833, lng: 13.2167 },
    { id: 'sim-entity-health-center', name: 'Gwange Primary Health Center', type: 'FACILITY', location: 'Gwange Ward, Maiduguri', lat: 11.8435, lng: 13.1498 },
    { id: 'sim-entity-borno-state', name: 'Borno State', type: 'STATE', location: 'North-East Nigeria', lat: 11.8311, lng: 13.1566 },
  ]
  const entities: Record<string, string> = {}
  for (const spec of entitySpecs) {
    const entity = await prisma.entity.upsert({
      where: { id: spec.id },
      update: { name: spec.name, location: spec.location },
      create: {
        id: spec.id,
        name: spec.name,
        type: spec.type as never,
        location: spec.location,
        coordinates: { latitude: spec.lat, longitude: spec.lng },
        autoApproveEnabled: spec.id === 'sim-entity-health-center',
        metadata:
          spec.id === 'sim-entity-health-center'
            ? { autoApproval: { scope: 'ENTITY', requiresDocumentation: false } }
            : undefined,
      },
    })
    entities[spec.id] = entity.id
  }

  // ------------------------------------------------------------------
  // 5. Entity assignments — signal recipient resolution intersects
  //    assignment × role, so every stakeholder needs assignments.
  // ------------------------------------------------------------------
  console.log('🔗 Assigning users to entities...')
  const assignmentMatrix: Array<[string, string[]]> = [
    ['sim.assessor', ['sim-entity-gwange', 'sim-entity-bulunkutu', 'sim-entity-dalori-camp', 'sim-entity-health-center', 'sim-entity-gwange-ward']],
    ['sim.assessor2', ['sim-entity-gwange', 'sim-entity-dalori-camp', 'sim-entity-jere-ward']],
    ['sim.responder', ['sim-entity-gwange', 'sim-entity-dalori-camp', 'sim-entity-health-center']],
    ['sim.responder2', ['sim-entity-gwange', 'sim-entity-bulunkutu']],
    ['sim.multirole', ['sim-entity-gwange', 'sim-entity-bulunkutu', 'sim-entity-dalori-camp', 'sim-entity-health-center', 'sim-entity-maiduguri-lga']],
    ['sim.coord', ['sim-entity-gwange', 'sim-entity-dalori-camp', 'sim-entity-health-center', 'sim-entity-maiduguri-lga']],
    ['sim.donor1', ['sim-entity-gwange', 'sim-entity-dalori-camp']],
    ['sim.donor2', ['sim-entity-gwange', 'sim-entity-dalori-camp']],
    ['sim.donor3', ['sim-entity-dalori-camp', 'sim-entity-bulunkutu']],
  ]
  for (const [username, entityKeys] of assignmentMatrix) {
    for (const entityKey of entityKeys) {
      await prisma.entityAssignment.upsert({
        where: {
          userId_entityId: { userId: users[username].id, entityId: entities[entityKey] },
        },
        update: {},
        create: {
          userId: users[username].id,
          entityId: entities[entityKey],
          assignedBy: users['sim.admin'].id,
        },
      })
    }
  }

  // ------------------------------------------------------------------
  // 6. Registry severity authoring (admin severity-page parity). Gives the
  //    catalog a CRITICAL/HIGH ladder so bottom-up propagation is visible.
  // ------------------------------------------------------------------
  console.log('🎚️  Authoring registry severities (admin severity page parity)...')
  const severityPatches: Array<[string, string, 'CRITICAL' | 'HIGH' | 'MEDIUM']> = [
    ['HEALTH', 'hasMedicineSupply', 'CRITICAL'],
    ['HEALTH', 'hasFunctionalClinic', 'HIGH'],
    ['WASH', 'isWaterSufficient', 'CRITICAL'],
    ['WASH', 'hasCleanWaterAccess', 'CRITICAL'],
    ['SHELTER', 'areSheltersSufficient', 'HIGH'],
    ['SHELTER', 'hasSafeStructures', 'HIGH'],
    ['SECURITY', 'isSafeFromViolence', 'HIGH'],
  ]
  for (const [type, key, severity] of severityPatches) {
    await QuestionRegistryService.setSeverity(
      qid(type, key),
      severity,
      users['sim.admin'].id,
      'Simulation seed: severity ladder authoring'
    )
  }

  // ------------------------------------------------------------------
  // 7. Incidents (fixed ids — the cleanup + signal scope).
  // ------------------------------------------------------------------
  console.log('🚨 Creating simulation incidents...')
  const incidents: Record<string, string> = {}
  const incidentSpecs = [
    {
      id: 'sim-incident-flood',
      name: 'Maiduguri Metropolitan Flooding',
      type: 'FLOOD',
      subType: 'SEASONAL_FLOODING',
      description: 'Severe seasonal flooding across Gwange and Bulunkutu after sustained rainfall; widespread displacement and infrastructure damage.',
      location: 'Maiduguri Metropolitan Area, Borno State',
      lat: 11.8311,
      lng: 13.1566,
      createdBy: 'sim.coord',
    },
    {
      id: 'sim-incident-conflict',
      name: 'Gongulong Displacement Incident',
      type: 'ARMED_CONFLICT',
      subType: 'DISPLACEMENT',
      description: 'Armed conflict in Jere LGA driving displacement into Dalori IDP Camp; protection and food-security concerns.',
      location: 'Jere Local Government Area, Borno State',
      lat: 11.8754,
      lng: 13.2201,
      createdBy: 'sim.coord',
    },
    {
      id: 'sim-incident-outbreak',
      name: 'Gwange Cholera Outbreak',
      type: 'DISEASE_OUTBREAK',
      subType: 'CHOLERA',
      description: 'Localized cholera outbreak around Gwange Primary Health Center; contained through rapid response.',
      location: 'Gwange Ward, Maiduguri',
      lat: 11.8435,
      lng: 13.1498,
      createdBy: 'sim.coord',
    },
  ]
  for (const spec of incidentSpecs) {
    const incident = await prisma.incident.create({
      data: {
        id: spec.id,
        name: spec.name,
        type: spec.type,
        subType: spec.subType,
        severity: 'UNCLASSIFIED',
        // All incidents start ACTIVE — assessments can only be filed against
        // active incidents (409 otherwise). The outbreak is contained via
        // IncidentService.updateStatus once its response is delivered.
        status: 'ACTIVE',
        description: spec.description,
        location: spec.location,
        coordinates: { latitude: spec.lat, longitude: spec.lng },
        createdBy: users[spec.createdBy].id,
      },
    })
    incidents[spec.id] = incident.id
  }

  // ------------------------------------------------------------------
  // 8. Preliminary assessments (one per incident, via the service so the
  //    impact-threshold severity fallback and incident rollup run).
  // ------------------------------------------------------------------
  console.log('📋 Creating preliminary assessments...')
  const preliminarySpecs = [
    {
      username: 'sim.assessor',
      data: {
        reportingDate: daysAgo(12).toISOString(),
        reportingLatitude: 11.8421,
        reportingLongitude: 13.1501,
        reportingLGA: 'Maiduguri',
        reportingWard: 'Gwange',
        numberLivesLost: 4,
        numberInjured: 45,
        numberDisplaced: 5200,
        numberHousesAffected: 860,
        numberSchoolsAffected: 3,
        schoolsAffected: 'Gwange Primary School, Gwange Secondary School, Bulunkutu Academy',
        numberMedicalFacilitiesAffected: 1,
        medicalFacilitiesAffected: 'Gwange Primary Health Center (partial)',
        reportingAgent: 'Field Assessor One',
        incidentId: incidents['sim-incident-flood'],
        affectedEntityIds: [entities['sim-entity-gwange'], entities['sim-entity-bulunkutu']],
      },
    },
    {
      username: 'sim.assessor2',
      data: {
        reportingDate: daysAgo(9).toISOString(),
        reportingLatitude: 11.7833,
        reportingLongitude: 13.2167,
        reportingLGA: 'Jere',
        reportingWard: 'Gongulong',
        numberLivesLost: 2,
        numberInjured: 18,
        numberDisplaced: 3100,
        numberHousesAffected: 420,
        numberSchoolsAffected: 1,
        schoolsAffected: 'Gongulong Central School',
        numberMedicalFacilitiesAffected: 0,
        reportingAgent: 'Field Assessor Two',
        incidentId: incidents['sim-incident-conflict'],
        affectedEntityIds: [entities['sim-entity-dalori-camp']],
      },
    },
    {
      username: 'sim.assessor',
      data: {
        reportingDate: daysAgo(20).toISOString(),
        reportingLatitude: 11.8435,
        reportingLongitude: 13.1498,
        reportingLGA: 'Maiduguri',
        reportingWard: 'Gwange',
        numberLivesLost: 1,
        numberInjured: 32,
        numberDisplaced: 0,
        numberHousesAffected: 0,
        numberSchoolsAffected: 0,
        numberMedicalFacilitiesAffected: 0,
        reportingAgent: 'Field Assessor One',
        incidentId: incidents['sim-incident-outbreak'],
        affectedEntityIds: [entities['sim-entity-health-center'], entities['sim-entity-gwange-ward']],
      },
    },
  ]
  for (const spec of preliminarySpecs) {
    await PreliminaryAssessmentService.create(
      { data: spec.data as never, createIncident: false },
      users[spec.username].id
    )
  }

  // ------------------------------------------------------------------
  // 9. Rapid assessments via the service: frozen snapshots, engine-derived
  //    gapAnalysis + priority. Answers respect every active REFINEMENT rule.
  // ------------------------------------------------------------------
  console.log('🩺 Creating rapid assessments (registry-driven)...')

  interface AssessmentSpec {
    type: 'HEALTH' | 'WASH' | 'SHELTER' | 'FOOD' | 'SECURITY' | 'POPULATION'
    incidentId: string
    entityKey: string
    assessor: string
    daysBack: number
    answers: Record<string, unknown>
  }

  const assessmentSpecs: AssessmentSpec[] = [
    // ---- Flood @ Gwange community — CRITICAL driver (medicine + water gaps)
    {
      type: 'HEALTH',
      incidentId: incidents['sim-incident-flood'],
      entityKey: 'sim-entity-gwange',
      assessor: 'sim.assessor',
      daysBack: 8,
      answers: {
        hasFunctionalClinic: true,
        hasEmergencyServices: true,
        numberHealthFacilities: 2,
        qualifiedHealthWorkers: 12,
        healthFacilityType: 'Primary Health Center',
        hasTrainedStaff: true,
        hasMedicineSupply: false,
        hasMedicalSupplies: false,
        hasMaternalChildServices: true,
        commonHealthIssues: ['Diarrhea', 'Malaria'],
      },
    },
    {
      type: 'WASH',
      incidentId: incidents['sim-incident-flood'],
      entityKey: 'sim-entity-gwange',
      assessor: 'sim.assessor',
      daysBack: 8,
      answers: {
        isWaterSufficient: false,
        hasCleanWaterAccess: false,
        areLatrinesSufficient: false,
        hasHandwashingFacilities: false,
        hasOpenDefecationConcerns: true,
        waterSource: ['River/Stream'],
        functionalLatrinesAvailable: 0,
      },
    },
    {
      type: 'SHELTER',
      incidentId: incidents['sim-incident-flood'],
      entityKey: 'sim-entity-gwange',
      assessor: 'sim.assessor2',
      daysBack: 7,
      answers: {
        areSheltersSufficient: false,
        hasSafeStructures: false,
        provideWeatherProtection: false,
        areOvercrowded: true,
        shelterTypes: ['Open space'],
        requiredShelterType: ['Local materials'],
        numberSheltersRequired: 350,
      },
    },
    {
      type: 'POPULATION',
      incidentId: incidents['sim-incident-flood'],
      entityKey: 'sim-entity-gwange',
      assessor: 'sim.assessor',
      daysBack: 6,
      answers: {
        totalHouseholds: 1150,
        totalPopulation: 5200,
        populationMale: 2400,
        populationFemale: 2800,
        populationUnder5: 810,
        pregnantWomen: 156,
        lactatingMothers: 203,
        personWithDisability: 94,
        elderlyPersons: 312,
        separatedChildren: 41,
        numberLivesLost: 4,
        numberInjured: 45,
      },
    },
    // ---- Conflict @ Dalori camp — HIGH driver (safety + food gaps)
    {
      type: 'SECURITY',
      incidentId: incidents['sim-incident-conflict'],
      entityKey: 'sim-entity-dalori-camp',
      assessor: 'sim.assessor2',
      daysBack: 5,
      answers: {
        isSafeFromViolence: false,
        gbvCasesReported: true,
        hasSecurityPresence: false,
        hasProtectionReportingMechanism: true,
        vulnerableGroupsHaveAccess: false,
        hasLighting: false,
      },
    },
    {
      type: 'FOOD',
      incidentId: incidents['sim-incident-conflict'],
      entityKey: 'sim-entity-dalori-camp',
      assessor: 'sim.assessor2',
      daysBack: 5,
      answers: {
        isFoodSufficient: false,
        hasRegularMealAccess: false,
        hasInfantNutrition: false,
        foodSource: ['Community'],
        availableFoodDurationDays: 3,
        additionalFoodRequiredPersons: 1200,
        additionalFoodRequiredHouseholds: 250,
      },
    },
    // ---- Outbreak @ health center (auto-approve entity) — MEDIUM driver
    {
      type: 'HEALTH',
      incidentId: incidents['sim-incident-outbreak'],
      entityKey: 'sim-entity-health-center',
      assessor: 'sim.multirole',
      daysBack: 4,
      answers: {
        hasFunctionalClinic: true,
        hasEmergencyServices: true,
        numberHealthFacilities: 1,
        qualifiedHealthWorkers: 9,
        healthFacilityType: 'Primary Health Center',
        hasTrainedStaff: true,
        hasMedicineSupply: true,
        hasMedicalSupplies: true,
        hasMaternalChildServices: false,
        commonHealthIssues: ['Diarrhea'],
      },
    },
    {
      type: 'WASH',
      incidentId: incidents['sim-incident-outbreak'],
      entityKey: 'sim-entity-health-center',
      assessor: 'sim.multirole',
      daysBack: 4,
      answers: {
        isWaterSufficient: true,
        hasCleanWaterAccess: true,
        areLatrinesSufficient: true,
        hasHandwashingFacilities: true,
        hasOpenDefecationConcerns: false,
        waterSource: ['Borehole'],
        functionalLatrinesAvailable: 14,
      },
    },
  ]

  const assessments: Record<string, { id: string; priority: string; type: string }> = {}
  for (const spec of assessmentSpecs) {
    const created = await RapidAssessmentService.create(
      {
        type: spec.type,
        rapidAssessmentDate: daysAgo(spec.daysBack),
        assessorName: users[spec.assessor].name,
        entityId: entities[spec.entityKey],
        incidentId: spec.incidentId,
        answers: spec.answers,
      },
      users[spec.assessor].id
    )
    const key = `${spec.type}:${spec.entityKey}`
    assessments[key] = { id: created.id, priority: created.priority, type: spec.type }
    console.log(
      `   ${spec.type.padEnd(10)} @ ${spec.entityKey.padEnd(24)} → priority ${created.priority}`
    )
  }

  // ------------------------------------------------------------------
  // 10. Coordinator verification — replicates the verify/reject route
  //     transactions (status + audit + signals + gap re-derive + rollup).
  //     SHELTER (flood) stays SUBMITTED for the coordinator queue.
  // ------------------------------------------------------------------
  console.log('✅ Verifying assessments (coordinator route parity)...')

  const verifyAssessment = async (assessmentId: string, coordinator: string): Promise<void> => {
    const assessment = await prisma.rapidAssessment.findUniqueOrThrow({
      where: { id: assessmentId },
      include: { entity: true },
    })
    if (assessment.verificationStatus !== 'SUBMITTED') return
    await prisma.$transaction(async (tx) => {
      await tx.rapidAssessment.update({
        where: { id: assessmentId },
        data: { verificationStatus: 'VERIFIED', verifiedAt: new Date(), verifiedBy: coordinator },
      })
      await tx.auditLog.create({
        data: {
          userId: coordinator,
          action: 'ASSESSMENT_VERIFIED',
          resource: 'RapidAssessment',
          resourceId: assessmentId,
          newValues: { assessmentType: assessment.rapidAssessmentType, entityName: assessment.entity.name },
        },
      })
      await ActionSignalService.evaluateAndGenerate(
        {
          trigger: 'assessment-verified',
          entityId: assessment.entityId,
          incidentId: assessment.incidentId,
          assessmentId,
          assessmentType: assessment.rapidAssessmentType,
          assessmentPriority: assessment.priority,
        },
        tx
      )
    })
    await RapidAssessmentService.triggerGapAnalysis(assessmentId)
    await incidentSeverityService.recalculateIncidentSeverity(assessment.incidentId)
  }

  const rejectAssessment = async (
    assessmentId: string,
    coordinator: string,
    reason: string,
    feedback: string
  ): Promise<void> => {
    const assessment = await prisma.rapidAssessment.findUniqueOrThrow({
      where: { id: assessmentId },
    })
    if (assessment.verificationStatus !== 'SUBMITTED') return
    await prisma.$transaction(async (tx) => {
      await tx.rapidAssessment.update({
        where: { id: assessmentId },
        data: {
          verificationStatus: 'REJECTED',
          rejectionReason: reason,
          rejectionFeedback: feedback,
          verifiedAt: new Date(),
          verifiedBy: coordinator,
        },
      })
      await tx.auditLog.create({
        data: {
          userId: coordinator,
          action: 'ASSESSMENT_REJECTED',
          resource: 'RapidAssessment',
          resourceId: assessmentId,
          newValues: { assessmentType: assessment.rapidAssessmentType, reason, feedback },
        },
      })
      await ActionSignalService.evaluateAndGenerate(
        {
          trigger: 'assessment-rejected',
          entityId: assessment.entityId,
          incidentId: assessment.incidentId,
          assessmentId,
          assessmentType: assessment.rapidAssessmentType,
          assessmentPriority: assessment.priority,
        },
        tx
      )
    })
  }

  await verifyAssessment(assessments['HEALTH:sim-entity-gwange'].id, users['sim.coord'].id)
  await verifyAssessment(assessments['WASH:sim-entity-gwange'].id, users['sim.coord'].id)
  await verifyAssessment(assessments['POPULATION:sim-entity-gwange'].id, users['sim.coord'].id)
  await verifyAssessment(assessments['SECURITY:sim-entity-dalori-camp'].id, users['sim.coord'].id)
  // FOOD submission rejected — feeds the rejected/resubmit workflow view.
  await rejectAssessment(
    assessments['FOOD:sim-entity-dalori-camp'].id,
    users['sim.coord'].id,
    'INCOMPLETE_DATA',
    'Household counts for the camp do not match the registration figures; please re-verify with camp management and resubmit.'
  )
  // Outbreak assessments are AUTO_VERIFIED at creation (auto-approve entity) —
  // roll them up explicitly like the verify post-hooks would.
  await incidentSeverityService.recalculateIncidentSeverity(incidents['sim-incident-outbreak'])

  // ------------------------------------------------------------------
  // 11. Donor commitments (pre-plan) via the service — awaiting-plan-for-
  //     commitment signals fan out to assigned responders.
  // ------------------------------------------------------------------
  console.log('🤝 Creating donor commitments...')
  const commitmentService = new CommitmentService()

  const commitmentUnicef = await commitmentService.createCommitment(
    {
      donorId: donors.unicef.id,
      entityId: entities['sim-entity-gwange'],
      incidentId: incidents['sim-incident-flood'],
      items: [
        { name: 'Water treatment tablets', unit: 'cartons', quantity: 400, deliveredQuantity: 0 },
        { name: 'Jerry cans', unit: 'units', quantity: 800, deliveredQuantity: 0 },
      ],
      totalCommittedQuantity: 1200,
      notes: 'WASH response for Gwange flood-affected households.',
    },
    users['sim.donor2'].id
  )

  const commitmentRedCross = await commitmentService.createCommitment(
    {
      donorId: donors.redcross.id,
      entityId: entities['sim-entity-gwange'],
      incidentId: incidents['sim-incident-flood'],
      items: [
        { name: 'Emergency shelter kits', unit: 'kits', quantity: 350, deliveredQuantity: 0 },
        { name: 'Tarpaulins', unit: 'units', quantity: 350, deliveredQuantity: 0 },
      ],
      totalCommittedQuantity: 700,
      notes: 'Shelter support matching the 350-shelter gap.',
    },
    users['sim.donor1'].id
  )

  const commitmentGovtAid = await commitmentService.createCommitment(
    {
      donorId: donors.govtAid.id,
      entityId: entities['sim-entity-dalori-camp'],
      incidentId: incidents['sim-incident-conflict'],
      items: [
        { name: 'Food baskets', unit: 'baskets', quantity: 250, deliveredQuantity: 0 },
        { name: 'High-energy biscuits', unit: 'cartons', quantity: 250, deliveredQuantity: 0 },
      ],
      totalCommittedQuantity: 500,
      notes: 'Food aid for displaced households at Dalori (pending plan).',
    },
    users['sim.donor3'].id
  )

  // ------------------------------------------------------------------
  // 12. Response plans.
  //     A — plan from the VERIFIED flood HEALTH assessment (service path).
  //     B — plan imported from the UNICEF commitment (from-commitment route
  //         parity, including the PlanCommitment link + audit).
  //     C — plan imported from the Red Cross commitment, left PLANNED.
  // ------------------------------------------------------------------
  console.log('📦 Creating response plans...')
  const planFromAssessment = await ResponseService.createPlannedResponse(
    {
      assessmentId: assessments['HEALTH:sim-entity-gwange'].id,
      entityId: entities['sim-entity-gwange'],
      type: 'HEALTH',
      priority: 'CRITICAL',
      description: 'Emergency medical resupply for Gwange flood response.',
      items: [
        { name: 'Essential medicine packs', unit: 'packs', quantity: 200 },
        { name: 'IV fluid sets', unit: 'sets', quantity: 400 },
        { name: 'Rapid diagnostic kits', unit: 'kits', quantity: 150 },
      ],
    },
    users['sim.responder'].id
  )

  /** Replicates POST /api/v1/responses/from-commitment (createAsPlan=true). */
  const planFromCommitment = async (
    commitmentId: string,
    responder: string,
    items: Array<{ name: string; quantity: number; unit: string }>,
    notes: string
  ): Promise<string> => {
    const commitment = await prisma.donorCommitment.findUniqueOrThrow({
      where: { id: commitmentId },
      include: { donor: true, incident: true },
    })
    const assessment = await prisma.rapidAssessment.findFirst({
      where: { entityId: commitment.entityId, verificationStatus: { in: ['VERIFIED', 'AUTO_VERIFIED'] } },
      orderBy: { rapidAssessmentDate: 'desc' },
    })
    const response = await prisma.rapidResponse.create({
      data: {
        responderId: responder,
        entityId: commitment.entityId,
        assessmentId: assessment!.id,
        type: (commitment.type as never) ?? 'LOGISTICS',
        sourceCommitmentId: commitment.id,
        deliveryStatus: 'PLANNED',
        priority: commitment.incident.severity as never,
        description: notes || `Response from ${commitment.donor.name} commitment`,
        items: items as never,
        plannedDate: new Date(),
        verificationStatus: 'DRAFT',
      },
    })
    await prisma.planCommitment.create({ data: { planId: response.id, commitmentId: commitment.id } })
    await prisma.auditLog.create({
      data: {
        userId: responder,
        action: 'CREATE_PLAN_FROM_COMMITMENT',
        resource: 'RapidResponse',
        resourceId: response.id,
        newValues: {
          commitmentId: commitment.id,
          donorId: commitment.donorId,
          entityId: commitment.entityId,
          items,
          deliveryStatus: 'PLANNED',
        },
      },
    })
    await ActionSignalService.evaluateAndGenerate({
      trigger: 'response-created',
      entityId: commitment.entityId,
      incidentId: commitment.incidentId,
      responseId: response.id,
      responseType: response.type,
      responsePriority: response.priority,
    })
    return response.id
  }

  const planUnicefId = await planFromCommitment(
    commitmentUnicef.id,
    users['sim.responder'].id,
    [
      { name: 'Water treatment tablets', quantity: 400, unit: 'cartons' },
      { name: 'Jerry cans', quantity: 800, unit: 'units' },
    ],
    'UNICEF WASH commitment import for Gwange.'
  )
  const planRedCrossId = await planFromCommitment(
    commitmentRedCross.id,
    users['sim.responder2'].id,
    [
      { name: 'Emergency shelter kits', quantity: 350, unit: 'kits' },
      { name: 'Tarpaulins', quantity: 350, unit: 'units' },
    ],
    'Red Cross shelter commitment import for Gwange.'
  )

  // ------------------------------------------------------------------
  // 13. Deliveries via ResponseService.confirmDelivery — rolls commitment
  //     quantities/status forward (UNICEF partial → PARTIAL commitment +
  //     partially-fulfilled donor signal).
  // ------------------------------------------------------------------
  console.log('🚚 Confirming deliveries...')
  await ResponseService.confirmDelivery(
    planFromAssessment.id,
    {
      deliveredItems: [
        { name: 'Essential medicine packs', unit: 'packs', quantity: 200 },
        { name: 'IV fluid sets', unit: 'sets', quantity: 400 },
        { name: 'Rapid diagnostic kits', unit: 'kits', quantity: 150 },
      ],
      deliveryLocation: { latitude: 11.8421, longitude: 13.1501, accuracy: 15 },
      deliveryNotes: 'Full delivery received at Gwange Ward distribution point.',
    },
    users['sim.responder'].id
  )
  await ResponseService.confirmDelivery(
    planUnicefId,
    {
      deliveredItems: [
        { name: 'Water treatment tablets', unit: 'cartons', quantity: 200 },
      ],
      deliveryLocation: { latitude: 11.8421, longitude: 13.1501, accuracy: 12 },
      deliveryNotes: 'First tranche of water treatment tablets delivered; jerry cans to follow.',
    },
    users['sim.responder'].id
  )

  // ------------------------------------------------------------------
  // 14. Coordinator verifies the health delivery (response verify route
  //     parity: resolves awaiting-delivery, may raise reassessment-needed).
  // ------------------------------------------------------------------
  console.log('✅ Verifying delivery (coordinator route parity)...')
  const deliveredPlan = await prisma.rapidResponse.findUniqueOrThrow({
    where: { id: planFromAssessment.id },
    include: { assessment: true },
  })
  if (deliveredPlan.verificationStatus === 'SUBMITTED') {
    await prisma.$transaction(async (tx) => {
      await tx.rapidResponse.update({
        where: { id: deliveredPlan.id },
        data: { verificationStatus: 'VERIFIED', verifiedAt: new Date(), verifiedBy: users['sim.coord'].id },
      })
      await tx.auditLog.create({
        data: {
          userId: users['sim.coord'].id,
          action: 'VERIFY_RESPONSE',
          resource: 'RapidResponse',
          resourceId: deliveredPlan.id,
          newValues: { responseType: deliveredPlan.type, deliveryStatus: deliveredPlan.deliveryStatus },
        },
      })
      await ActionSignalService.evaluateAndGenerate(
        {
          trigger: 'response-verified',
          entityId: deliveredPlan.entityId,
          incidentId: deliveredPlan.assessment?.incidentId ?? null,
          responseId: deliveredPlan.id,
          responseType: deliveredPlan.type,
          deliveryStatus: deliveredPlan.deliveryStatus,
        },
        tx
      )
    })
  }

  // ------------------------------------------------------------------
  // 15. Contain the outbreak (incident-status route parity: the response
  //     was delivered + verified, so the cholera incident is contained).
  // ------------------------------------------------------------------
  await IncidentService.updateStatus(incidents['sim-incident-outbreak'], 'CONTAINED')

  // ------------------------------------------------------------------
  // 16. Final rollup + report.
  // ------------------------------------------------------------------
  for (const incidentId of Object.values(incidents)) {
    await incidentSeverityService.recalculateIncidentSeverity(incidentId)
  }

  console.log('')
  console.log('📊 Simulation world summary')
  console.log('   Incidents (bottom-up severity):')
  for (const spec of incidentSpecs) {
    const incident = await prisma.incident.findUniqueOrThrow({ where: { id: spec.id } })
    console.log(`     ${incident.severity.padEnd(12)} ${incident.status.padEnd(9)} ${incident.name}`)
  }
  const assessmentRows = await prisma.rapidAssessment.findMany({
    where: { incidentId: { in: Object.values(incidents) } },
    orderBy: { rapidAssessmentType: 'asc' },
  })
  console.log(`   Assessments: ${assessmentRows.length}`)
  for (const row of assessmentRows) {
    console.log(
      `     ${row.rapidAssessmentType.padEnd(10)} ${row.priority.padEnd(9)} ${row.verificationStatus.padEnd(14)} gaps=${(row.gapAnalysis as { hasGap?: boolean } | null)?.hasGap ? 'yes' : 'no'}`
    )
  }
  const commitmentRows = await prisma.donorCommitment.findMany({
    where: { incidentId: { in: Object.values(incidents) } },
    include: { donor: true },
  })
  console.log(`   Commitments: ${commitmentRows.length}`)
  for (const row of commitmentRows) {
    console.log(
      `     ${row.donor.name.padEnd(18)} ${row.status.padEnd(9)} delivered ${row.deliveredQuantity}/${row.totalCommittedQuantity}`
    )
  }
  const responseRows = await prisma.rapidResponse.findMany({
    where: { entity: { id: { in: Object.values(entities) } } },
  })
  console.log(`   Responses: ${responseRows.length}`)
  for (const row of responseRows) {
    console.log(
      `     ${row.type.padEnd(10)} ${row.deliveryStatus.padEnd(9)} ${row.verificationStatus}`
    )
  }
  const activeSignals = await prisma.actionSignal.findMany({
    where: { incidentId: { in: Object.values(incidents) } },
    include: { user: { select: { username: true } } },
  })
  const openSignals = activeSignals.filter((s) => s.resolvedAt === null)
  console.log(`   Action signals: ${activeSignals.length} total, ${openSignals.length} open`)
  const signalReasons = new Map<string, number>()
  for (const signal of openSignals) {
    signalReasons.set(signal.signalReason, (signalReasons.get(signal.signalReason) ?? 0) + 1)
  }
  for (const [reason, count] of signalReasons) {
    console.log(`     ${reason.padEnd(32)} × ${count}`)
  }
  const notificationCount = await prisma.notification.count()
  console.log(`   Notifications: ${notificationCount}`)
  console.log('')
  console.log('👥 Simulation logins (password SimPass123!):')
  for (const spec of userSpecs) {
    console.log(`     ${spec.email.padEnd(32)} ${spec.roles.join(',')}`)
  }
  console.log('     admin@drms.local                       ADMIN (password Admin@123456)')
  console.log('')
  console.log('✅ Simulation world ready.')
}

main()
  .catch((error) => {
    console.error('❌ Simulation seed failed:', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
