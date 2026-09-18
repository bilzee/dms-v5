import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/client';
import { RoleName } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { seedQuestions } from '../../../../../../prisma/seed-questions';
import { seedCrossFieldRules } from '../../../../../../prisma/seed-rules';
import { clearGapQuestionCache } from '@/lib/services/gap-analysis.service';
import { clearCrossFieldRuleCache, clearQuestionRegistryCache } from '@/lib/services/question-registry.service';

async function assignPermissionsToRole(roleName: RoleName, permCodes: string[]) {
  const role = await prisma.role.findUnique({ where: { name: roleName } });
  if (!role) return 0;
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

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const seedKey = body.seedKey || request.headers.get('x-seed-key');
    const envSeedKey = process.env.SEED_KEY;

    if (envSeedKey && seedKey !== envSeedKey) {
      return NextResponse.json({ error: 'Invalid seed key. Set SEED_KEY env var and pass matching seedKey in body or X-Seed-Key header.' }, { status: 403 });
    }

    const userCount = await prisma.user.count();
    if (userCount > 0 && !body.force) {
      return NextResponse.json({ error: 'Database already has users. Use { "force": true } to re-seed.', userCount }, { status: 409 });
    }

    const logs: string[] = [];

    logs.push('Creating admin user...');
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
    logs.push(`Admin user: ${admin.email}`);

    logs.push('Creating roles...');
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
    logs.push(`${roleDefs.length} roles created`);

    logs.push('Creating permissions...');
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
      await prisma.permission.upsert({ where: { code: perm.code }, update: {}, create: perm });
    }
    logs.push(`${permissions.length} permissions created`);

    logs.push('Assigning permissions to roles...');
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
    logs.push(`ADMIN:${adminCount} COORDINATOR:${coordinatorCount} ASSESSOR:${assessorCount} RESPONDER:${responderCount} DONOR:${donorCount}`);

    const adminRole = await prisma.role.findUnique({ where: { name: RoleName.ADMIN } });
    if (adminRole) {
      await prisma.userRole.upsert({
        where: { userId_roleId: { userId: admin.id, roleId: adminRole.id } },
        update: {},
        create: { userId: admin.id, roleId: adminRole.id, assignedBy: admin.id },
      });
    }

    logs.push('Seeding question registry...');
    const questionSeedResult = await seedQuestions(prisma);
    clearGapQuestionCache();
    clearQuestionRegistryCache();
    logs.push(
      `Question registry: ${questionSeedResult.questions} questions ` +
      `(${questionSeedResult.created} created, ${questionSeedResult.updated} updated, ` +
      `${questionSeedResult.unchanged} unchanged) across ${questionSeedResult.sections} sections`
    );

    logs.push('Seeding cross-field rules...');
    const ruleSeedResult = await seedCrossFieldRules(prisma);
    clearCrossFieldRuleCache();
    logs.push(
      `Cross-field rules: ${ruleSeedResult.rules} rules ` +
      `(${ruleSeedResult.created} created, ${ruleSeedResult.updated} updated, ` +
      `${ruleSeedResult.unchanged} unchanged)`
    );

    logs.push('Creating Borno LGAs...');
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
        create: { id: lga.id, name: lga.name, type: 'LGA', location: 'Borno State', coordinates: { lat: lga.lat, lng: lga.lng }, isActive: true },
      });
    }
    logs.push(`${bornoLgas.length} LGAs`);

    logs.push('Creating system settings...');
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
    logs.push(`${systemSettings.length} system settings`);

    return NextResponse.json({
      success: true,
      message: 'Database seeded successfully',
      logs,
      credentials: {
        email: 'admin@drms.local',
        password: 'Admin@123456',
        warning: 'Change the admin password after first login!',
      },
      summary: {
        adminUser: 1,
        roles: 5,
        permissions: 20,
        questions: questionSeedResult.questions,
        questionSections: questionSeedResult.sections,
        crossFieldRules: ruleSeedResult.rules,
        bornoLgas: 27,
        systemSettings: 9,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: 'Seed failed', details: message }, { status: 500 });
  }
}
