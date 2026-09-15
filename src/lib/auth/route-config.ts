import { RoleName } from '@/types/auth';

export const ROLE_DASHBOARD_PATHS: Record<RoleName, string> = {
  ASSESSOR: '/assessor/dashboard',
  COORDINATOR: '/coordinator/dashboard',
  RESPONDER: '/responder/dashboard',
  DONOR: '/donor/dashboard',
  ADMIN: '/admin/dashboard',
};

export const ROLE_ROUTE_PREFIXES: Record<string, string[]> = {
  ASSESSOR: ['/(auth)/assessor'],
  COORDINATOR: ['/(auth)/coordinator'],
  RESPONDER: ['/(auth)/responder'],
  DONOR: ['/(auth)/donor'],
  ADMIN: ['/(auth)/admin', '/(auth)/system'],
};

export const ROLE_PATH_PATTERNS: Record<RoleName, RegExp[]> = {
  ASSESSOR: [/^\/assessor\//, /^\/rapid-assessments/, /^\/dashboard$/, /^\/profile$/, /^\/help$/],
  COORDINATOR: [/^\/coordinator\//, /^\/reports/, /^\/verification/, /^\/dashboard$/, /^\/profile$/, /^\/help$/],
  RESPONDER: [/^\/responder\//, /^\/rapid-assessments/, /^\/dashboard$/, /^\/profile$/, /^\/help$/],
  DONOR: [/^\/donor\//, /^\/dashboard$/, /^\/profile$/, /^\/help$/],
  ADMIN: [/^\/admin\//, /^\/roles/, /^\/system\//, /^\/reports/, /^\/coordinator\//, /^\/verification/, /^\/dashboard$/, /^\/profile$/, /^\/help$/],
};

export const ROLE_ACCESSIBLE_PATHS: Record<RoleName, string[]> = {
  ASSESSOR: [
    '/assessor/dashboard',
    '/assessor/rapid-assessments',
    '/assessor/rapid-assessments/new',
    '/assessor/preliminary-assessment',
    '/assessor/preliminary-assessment/new',
    '/rapid-assessments',
    '/profile',
  ],
  COORDINATOR: [
    '/coordinator/dashboard',
    '/coordinator/situation-dashboard',
    '/coordinator/verification',
    '/coordinator/entities',
    '/coordinator/entity-management',
    '/coordinator/incidents',
    '/coordinator/donors',
    '/coordinator/donors/metrics',
    '/coordinator/resource-management',
    '/coordinator/settings/severity-thresholds',
    '/coordinator/settings/scoring',
    '/coordinator/reports',
    '/coordinator/entity-incident-map',
    '/coordinator/auto-approval',
    '/reports/builder',
    '/profile',
  ],
  RESPONDER: [
    '/responder/dashboard',
    '/responder/planning',
    '/responder/planning/new',
    '/responder/responses',
    '/rapid-assessments',
    '/profile',
  ],
  DONOR: [
    '/donor/dashboard',
    '/donor/entities',
    '/donor/entities/performance',
    '/donor/performance',
    '/donor/leaderboard',
    '/donor/responses',
    '/donor/reports',
    '/donor/rapid-assessments',
    '/donor/analytics',
    '/donor/profile',
    '/profile',
  ],
  ADMIN: [
    '/admin/dashboard',
    '/admin/users',
    '/admin/donors',
    '/admin/donors/register',
    '/admin/donors/metrics',
    '/roles',
    '/system/settings',
    '/system/database',
    '/system/audit',
    '/system/health',
    '/coordinator/reports',
    '/reports/builder',
    '/rapid-assessments',
    '/profile',
  ],
};

export const ROLE_DISPLAY_NAMES: Record<RoleName, string> = {
  ASSESSOR: 'Assessor',
  COORDINATOR: 'Coordinator',
  RESPONDER: 'Responder',
  DONOR: 'Donor',
  ADMIN: 'Admin',
};

export const ROLE_DESCRIPTIONS: Record<RoleName, string> = {
  ASSESSOR: 'Conduct rapid assessments and surveys',
  COORDINATOR: 'Coordinate response efforts and teams',
  RESPONDER: 'Provide direct disaster response',
  DONOR: 'Manage donations and resources',
  ADMIN: 'System administration and oversight',
};
