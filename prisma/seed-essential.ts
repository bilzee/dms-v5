import { PrismaClient, RoleName, ReportType } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { seedQuestions } from './seed-questions';
import { seedCrossFieldRules } from './seed-rules';

const prisma = new PrismaClient();

async function assignPermissionsToRole(roleName: RoleName, permCodes: string[]) {
  const role = await prisma.role.findUnique({ where: { name: roleName } });
  if (!role) return;
  let count = 0;
  for (const code of permCodes) {
    const permission = await prisma.permission.findUnique({ where: { code } });
    if (permission) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
        update: {},
        create: { roleId: role.id, permissionId: permission.id },
      });
      count++;
    }
  }
  return count;
}

async function main() {
  console.log('🌱 Starting essential seed...');

  // ========================================
  // 1. ADMIN USER
  // ========================================
  console.log('Creating admin user...');

  const passwordHash = await bcrypt.hash('Admin@123456', 10);

  const admin = await prisma.user.upsert({
    where: { email: 'admin@drms.local' },
    update: {},
    create: {
      email: 'admin@drms.local',
      username: 'admin',
      passwordHash,
      name: 'System Administrator',
      phone: '+2348000000000',
      organization: 'DRMS System',
      isActive: true,
    },
  });

  console.log(`✅ Admin user created: ${admin.email}`);

  // ========================================
  // 2. ROLES
  // ========================================
  console.log('Creating roles...');

  const roleDefs = [
    { name: RoleName.ADMIN, description: 'System administrators with full access' },
    { name: RoleName.COORDINATOR, description: 'Coordinators who verify and manage assessments and responses' },
    { name: RoleName.ASSESSOR, description: 'Field assessors who conduct rapid assessments' },
    { name: RoleName.RESPONDER, description: 'Response teams who execute intervention activities' },
    { name: RoleName.DONOR, description: 'Donors and funding organizations' },
  ];

  for (const rd of roleDefs) {
    await prisma.role.upsert({
      where: { name: rd.name },
      update: { description: rd.description },
      create: rd,
    });
  }
  console.log(`✅ ${roleDefs.length} roles created`);

  // ========================================
  // 3. PERMISSIONS
  // ========================================
  console.log('Creating permissions...');

  const permissions = [
    { name: 'Create Assessment', code: 'CREATE_ASSESSMENT', category: 'assessment', description: 'Can create new assessments' },
    { name: 'View Assessment', code: 'VIEW_ASSESSMENT', category: 'assessment', description: 'Can view assessments' },
    { name: 'Edit Assessment', code: 'EDIT_ASSESSMENT', category: 'assessment', description: 'Can edit own assessments' },
    { name: 'Verify Assessment', code: 'VERIFY_ASSESSMENT', category: 'assessment', description: 'Can verify assessments' },
    { name: 'Publish Assessment', code: 'PUBLISH_ASSESSMENT', category: 'assessment', description: 'Can publish verified assessments' },
    { name: 'Create Response', code: 'CREATE_RESPONSE', category: 'response', description: 'Can create response plans' },
    { name: 'View Response', code: 'VIEW_RESPONSE', category: 'response', description: 'Can view response plans' },
    { name: 'Edit Response', code: 'EDIT_RESPONSE', category: 'response', description: 'Can edit own responses' },
    { name: 'Verify Response', code: 'VERIFY_RESPONSE', category: 'response', description: 'Can verify responses' },
    { name: 'Execute Response', code: 'EXECUTE_RESPONSE', category: 'response', description: 'Can execute response activities' },
    { name: 'View Entities', code: 'VIEW_ENTITIES', category: 'entity', description: 'Can view assigned entities' },
    { name: 'Manage Entities', code: 'MANAGE_ENTITIES', category: 'entity', description: 'Can manage entity assignments' },
    { name: 'View Crisis Dashboard', code: 'VIEW_CRISIS_DASHBOARD', category: 'dashboard', description: 'Can access crisis management dashboard' },
    { name: 'View Situation Dashboard', code: 'VIEW_SITUATION_DASHBOARD', category: 'dashboard', description: 'Can access situation awareness dashboard' },
    { name: 'View Donor Dashboard', code: 'VIEW_DONOR_DASHBOARD', category: 'dashboard', description: 'Can access donor dashboard' },
    { name: 'Manage Users', code: 'MANAGE_USERS', category: 'user', description: 'Can create and manage users' },
    { name: 'Assign Roles', code: 'ASSIGN_ROLES', category: 'user', description: 'Can assign roles to users' },
    { name: 'View Audit Logs', code: 'VIEW_AUDIT_LOGS', category: 'audit', description: 'Can view system audit logs' },
    { name: 'View Sync Conflicts', code: 'VIEW_SYNC_CONFLICTS', category: 'sync', description: 'Can view synchronization conflicts' },
    { name: 'Resolve Sync Conflicts', code: 'RESOLVE_SYNC_CONFLICTS', category: 'sync', description: 'Can resolve sync conflicts' },
  ];

  for (const perm of permissions) {
    await prisma.permission.upsert({
      where: { code: perm.code },
      update: {},
      create: perm,
    });
  }
  console.log(`✅ ${permissions.length} permissions created`);

  // ========================================
  // 4. ROLE-PERMISSION ASSIGNMENTS
  // ========================================
  console.log('Assigning permissions to roles...');

  const allPermCodes = permissions.map(p => p.code);
  const adminCount = await assignPermissionsToRole(RoleName.ADMIN, allPermCodes);

  const coordinatorCount = await assignPermissionsToRole(RoleName.COORDINATOR, [
    'CREATE_ASSESSMENT', 'VIEW_ASSESSMENT', 'EDIT_ASSESSMENT', 'VERIFY_ASSESSMENT', 'PUBLISH_ASSESSMENT',
    'CREATE_RESPONSE', 'VIEW_RESPONSE', 'EDIT_RESPONSE', 'VERIFY_RESPONSE',
    'VIEW_ENTITIES', 'MANAGE_ENTITIES',
    'VIEW_CRISIS_DASHBOARD', 'VIEW_SITUATION_DASHBOARD',
    'VIEW_SYNC_CONFLICTS', 'RESOLVE_SYNC_CONFLICTS',
  ]);

  const assessorCount = await assignPermissionsToRole(RoleName.ASSESSOR, [
    'CREATE_ASSESSMENT', 'VIEW_ASSESSMENT', 'EDIT_ASSESSMENT',
    'VIEW_ENTITIES', 'VIEW_SITUATION_DASHBOARD',
  ]);

  const responderCount = await assignPermissionsToRole(RoleName.RESPONDER, [
    'VIEW_ASSESSMENT', 'CREATE_RESPONSE', 'VIEW_RESPONSE', 'EDIT_RESPONSE', 'EXECUTE_RESPONSE',
    'VIEW_ENTITIES', 'VIEW_SITUATION_DASHBOARD',
  ]);

  const donorCount = await assignPermissionsToRole(RoleName.DONOR, [
    'VIEW_ASSESSMENT', 'VIEW_RESPONSE', 'VIEW_DONOR_DASHBOARD',
  ]);

  console.log(`✅ Permissions assigned — ADMIN: ${adminCount}, COORDINATOR: ${coordinatorCount}, ASSESSOR: ${assessorCount}, RESPONDER: ${responderCount}, DONOR: ${donorCount}`);

  // Assign admin role to admin user
  const adminRole = await prisma.role.findUnique({ where: { name: RoleName.ADMIN } });
  if (adminRole) {
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: admin.id, roleId: adminRole.id } },
      update: {},
      create: { userId: admin.id, roleId: adminRole.id, assignedBy: admin.id },
    });
    console.log('✅ Admin role assigned to admin user');
  }

  // ========================================
  // 5. QUESTION REGISTRY (Dynamic Question Registry — shared with prisma/seed.ts)
  // ========================================
  console.log('Seeding question registry...');

  const questionSeedResult = await seedQuestions(prisma);
  console.log(
    `✅ Question registry: ${questionSeedResult.questions} questions ` +
    `(${questionSeedResult.created} created, ${questionSeedResult.updated} updated, ` +
    `${questionSeedResult.unchanged} unchanged) across ${questionSeedResult.sections} sections`
  );

  // Cross-field rule baseline (P10-2) — idempotent, shared with prisma/seed.ts.
  const ruleSeedResult = await seedCrossFieldRules(prisma);
  console.log(
    `✅ Cross-field rules: ${ruleSeedResult.rules} rules ` +
    `(${ruleSeedResult.created} created, ${ruleSeedResult.updated} updated, ` +
    `${ruleSeedResult.unchanged} unchanged)`
  );

  // ========================================
  // 6. REPORT TEMPLATES
  // ========================================
  console.log('Creating report templates...');

  const reportTemplates = [
    {
      id: 'rapid-assessment-template',
      name: 'Rapid Needs Assessment',
      description: 'Quick initial assessment for disaster response planning',
      type: 'CUSTOM' as ReportType,
      layout: {
        sections: [
          { id: 'basic-info', title: 'Basic Information', fields: [
            { id: 'location', type: 'text', label: 'Location Name', required: true },
            { id: 'population', type: 'number', label: 'Estimated Population', required: true },
            { id: 'date', type: 'date', label: 'Assessment Date', required: true },
          ]},
          { id: 'health-needs', title: 'Health Needs', fields: [
            { id: 'disease_outbreaks', type: 'text', label: 'Disease Outbreaks Reported' },
            { id: 'medical_supplies', type: 'text', label: 'Medical Supplies Status' },
            { id: 'health_personnel', type: 'text', label: 'Health Personnel Available' },
          ]},
          { id: 'wash-needs', title: 'WASH Needs', fields: [
            { id: 'water_access', type: 'text', label: 'Water Access Status' },
            { id: 'sanitation_facilities', type: 'text', label: 'Sanitation Facilities' },
          ]},
        ],
      },
    },
    {
      id: 'daily-sitrep-template',
      name: 'Daily Situation Report',
      description: 'Daily summary of disaster response activities and situation',
      type: 'CUSTOM' as ReportType,
      layout: {
        sections: [
          { id: 'situation-update', title: 'Situation Update', fields: [
            { id: 'security_situation', type: 'textarea', label: 'Security Situation', required: true },
            { id: 'weather_conditions', type: 'text', label: 'Weather Conditions' },
            { id: 'population_movements', type: 'textarea', label: 'Population Movements' },
          ]},
          { id: 'response-activities', title: 'Response Activities', fields: [
            { id: 'health_response', type: 'textarea', label: 'Health Response Activities' },
            { id: 'wash_response', type: 'textarea', label: 'WASH Response Activities' },
            { id: 'shelter_response', type: 'textarea', label: 'Shelter Response Activities' },
          ]},
        ],
      },
    },
    {
      id: 'assessment-summary-template',
      name: 'Assessment Summary Report',
      description: 'Comprehensive summary of all assessment findings across sectors',
      type: 'ASSESSMENT' as ReportType,
      layout: {
        sections: [
          { id: 'overview', title: 'Assessment Overview', fields: [
            { id: 'assessment_date', type: 'date', label: 'Assessment Period', required: true },
            { id: 'area_covered', type: 'text', label: 'Geographic Area Covered' },
            { id: 'total_assessed', type: 'number', label: 'Total Entities Assessed' },
          ]},
          { id: 'findings', title: 'Key Findings', fields: [
            { id: 'critical_gaps', type: 'textarea', label: 'Critical Gaps Identified' },
            { id: 'priority_needs', type: 'textarea', label: 'Priority Needs' },
            { id: 'population_impact', type: 'textarea', label: 'Population Impact Summary' },
          ]},
          { id: 'recommendations', title: 'Recommendations', fields: [
            { id: 'immediate_actions', type: 'textarea', label: 'Immediate Actions Required' },
            { id: 'resource_needs', type: 'textarea', label: 'Resource Requirements' },
          ]},
        ],
      },
    },
    {
      id: 'response-impact-template',
      name: 'Response Impact Report',
      description: 'Analysis of response plan effectiveness and delivery outcomes',
      type: 'RESPONSE' as ReportType,
      layout: {
        sections: [
          { id: 'response-overview', title: 'Response Overview', fields: [
            { id: 'response_period', type: 'date', label: 'Reporting Period', required: true },
            { id: 'active_plans', type: 'number', label: 'Active Response Plans' },
            { id: 'completion_rate', type: 'number', label: 'Completion Rate (%)' },
          ]},
          { id: 'delivery-status', title: 'Delivery Status', fields: [
            { id: 'items_delivered', type: 'textarea', label: 'Items Delivered' },
            { id: 'beneficiaries_reached', type: 'number', label: 'Beneficiaries Reached' },
            { id: 'pending_deliveries', type: 'textarea', label: 'Pending Deliveries' },
          ]},
          { id: 'outcomes', title: 'Outcomes & Impact', fields: [
            { id: 'lives_impacted', type: 'number', label: 'Lives Impacted' },
            { id: 'lessons_learned', type: 'textarea', label: 'Lessons Learned' },
          ]},
        ],
      },
    },
    {
      id: 'entity-status-template',
      name: 'Entity Status Dashboard Report',
      description: 'Current status overview of all monitored entities and facilities',
      type: 'ENTITY' as ReportType,
      layout: {
        sections: [
          { id: 'entity-overview', title: 'Entity Overview', fields: [
            { id: 'total_entities', type: 'number', label: 'Total Monitored Entities' },
            { id: 'active_incidents', type: 'number', label: 'Active Incidents' },
            { id: 'reporting_period', type: 'date', label: 'Report Date', required: true },
          ]},
          { id: 'facility-status', title: 'Facility Status', fields: [
            { id: 'operational_facilities', type: 'number', label: 'Operational Facilities' },
            { id: 'damaged_facilities', type: 'number', label: 'Damaged/Non-functional' },
            { id: 'facilities_needing_repair', type: 'textarea', label: 'Facilities Needing Repair' },
          ]},
        ],
      },
    },
    {
      id: 'donor-performance-template',
      name: 'Donor Performance Report',
      description: 'Tracking donor commitments, deliveries, and fulfillment rates',
      type: 'DONOR' as ReportType,
      layout: {
        sections: [
          { id: 'commitment-overview', title: 'Commitment Overview', fields: [
            { id: 'total_commitments', type: 'number', label: 'Total Commitments' },
            { id: 'total_value', type: 'number', label: 'Total Value (NGN)' },
            { id: 'fulfillment_rate', type: 'number', label: 'Overall Fulfillment Rate (%)' },
          ]},
          { id: 'delivery-tracking', title: 'Delivery Tracking', fields: [
            { id: 'delivered_items', type: 'number', label: 'Items Delivered' },
            { id: 'pending_items', type: 'number', label: 'Items Pending' },
            { id: 'overdue_commitments', type: 'textarea', label: 'Overdue Commitments' },
          ]},
          { id: 'donor-rankings', title: 'Donor Rankings', fields: [
            { id: 'top_performers', type: 'textarea', label: 'Top Performing Donors' },
            { id: 'needs_followup', type: 'textarea', label: 'Donors Needing Follow-up' },
          ]},
        ],
      },
    },
  ];

  for (const tpl of reportTemplates) {
    await prisma.reportTemplate.upsert({
      where: { id: tpl.id },
      update: {},
      create: { ...tpl, createdById: admin.id, isPublic: true },
    });
  }
  console.log(`✅ ${reportTemplates.length} report templates created`);

  // ========================================
  // 7. BORNO STATE LGAs (all 27)
  // ========================================
  console.log('Creating Borno State LGA entities...');

  const bornoLgas = [
    { id: 'lga-abadam', name: 'Abadam', lat: 13.50, lng: 13.50 },
    { id: 'lga-askira-uba', name: 'Askira/Uba', lat: 10.12, lng: 12.85 },
    { id: 'lga-bama', name: 'Bama', lat: 11.52, lng: 13.39 },
    { id: 'lga-bayo', name: 'Bayo', lat: 9.64, lng: 12.16 },
    { id: 'lga-biu', name: 'Biu', lat: 9.60, lng: 12.20 },
    { id: 'lga-chibok', name: 'Chibok', lat: 9.63, lng: 12.83 },
    { id: 'lga-damboa', name: 'Damboa', lat: 10.55, lng: 12.45 },
    { id: 'lga-dikwa', name: 'Dikwa', lat: 12.03, lng: 13.92 },
    { id: 'lga-gubio', name: 'Gubio', lat: 12.47, lng: 13.13 },
    { id: 'lga-guzamala', name: 'Guzamala', lat: 12.63, lng: 13.07 },
    { id: 'lga-gwoza', name: 'Gwoza', lat: 10.70, lng: 13.40 },
    { id: 'lga-hawul', name: 'Hawul', lat: 9.82, lng: 12.35 },
    { id: 'lga-jere', name: 'Jere', lat: 11.87, lng: 13.17 },
    { id: 'lga-kaga', name: 'Kaga', lat: 11.95, lng: 12.44 },
    { id: 'lga-kala-balge', name: 'Kala/Balge', lat: 12.17, lng: 14.55 },
    { id: 'lga-konduga', name: 'Konduga', lat: 11.65, lng: 13.10 },
    { id: 'lga-kukawa', name: 'Kukawa', lat: 12.87, lng: 13.62 },
    { id: 'lga-kwaya-kusar', name: 'Kwaya Kusar', lat: 9.88, lng: 12.08 },
    { id: 'lga-mafa', name: 'Mafa', lat: 11.85, lng: 13.43 },
    { id: 'lga-magumeri', name: 'Magumeri', lat: 12.13, lng: 12.75 },
    { id: 'lga-maiduguri', name: 'Maiduguri', lat: 11.85, lng: 13.15 },
    { id: 'lga-marte', name: 'Marte', lat: 12.36, lng: 13.83 },
    { id: 'lga-mobbar', name: 'Mobbar', lat: 13.18, lng: 13.32 },
    { id: 'lga-monguno', name: 'Monguno', lat: 12.67, lng: 13.62 },
    { id: 'lga-ngala', name: 'Ngala', lat: 11.65, lng: 14.20 },
    { id: 'lga-nganzai', name: 'Nganzai', lat: 12.30, lng: 13.32 },
    { id: 'lga-shani', name: 'Shani', lat: 9.38, lng: 12.18 },
  ];

  for (const lga of bornoLgas) {
    await prisma.entity.upsert({
      where: { id: lga.id },
      update: {},
      create: {
        id: lga.id,
        name: lga.name,
        type: 'LGA',
        location: 'Borno State',
        coordinates: { lat: lga.lat, lng: lga.lng },
        isActive: true,
      },
    });
  }
  console.log(`✅ ${bornoLgas.length} Borno State LGAs created`);

  // ========================================
  // 8. SYSTEM SETTINGS (defaults)
  // ========================================
  console.log('Creating default system settings...');

  const systemSettings = [
    { section: 'map-config', key: 'activePreset', value: 'borno' },
    { section: 'map-config', key: 'centerLat', value: '11.8311' },
    { section: 'map-config', key: 'centerLng', value: '13.1511' },
    { section: 'map-config', key: 'zoom', value: '9' },
    { section: 'general', key: 'siteName', value: 'DRMS' },
    { section: 'general', key: 'timezone', value: 'Africa/Lagos' },
    { section: 'general', key: 'dateFormat', value: 'DD/MM/YYYY' },
    { section: 'general', key: 'language', value: 'en' },
    { section: 'branding', key: 'appName', value: 'Disaster Response Management System' },
  ];

  for (const setting of systemSettings) {
    await prisma.systemSetting.upsert({
      where: { section_key: { section: setting.section, key: setting.key } },
      update: {},
      create: setting,
    });
  }
  console.log(`✅ ${systemSettings.length} system settings created`);

  console.log('');
  console.log('🎉 Seed completed successfully!');
  console.log('');
  console.log('📋 Summary:');
  console.log('   - Admin user: admin@drms.local / Admin@123456');
  console.log('   - 5 roles with full permission assignments');
  console.log('   - 20 permissions');
  console.log('   - 55-question registry (24 GAP / 31 CONTEXT) across 6 assessment types');
  console.log('   - 6 report templates');
  console.log('   - 27 Borno State LGAs with coordinates');
  console.log('   - 9 default system settings');
  console.log('');
  console.log('⚠️  IMPORTANT: Change the admin password after first login!');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
