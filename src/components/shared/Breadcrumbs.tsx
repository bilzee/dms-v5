'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Home, ChevronRight } from '@/lib/icons';

interface BreadcrumbItem {
  name: string;
  href: string;
}

const breadcrumbStructure: Record<string, BreadcrumbItem[]> = {
  '/coordinator/situation-dashboard': [
    { name: 'Dashboard', href: '/dashboard' },
    { name: 'Situation Awareness', href: '/coordinator/situation-dashboard' }
  ],
  '/coordinator/entities': [
    { name: 'Dashboard', href: '/dashboard' },
    { name: 'Entity Management', href: '/coordinator/entities' }
  ],
  '/coordinator/incidents': [
    { name: 'Dashboard', href: '/dashboard' },
    { name: 'Incidents', href: '/coordinator/incidents' }
  ],
  '/coordinator/analytics': [
    { name: 'Dashboard', href: '/dashboard' },
    { name: 'Analytics', href: '/coordinator/situation-dashboard' }
  ],
  '/coordinator/settings': [
    { name: 'Dashboard', href: '/dashboard' },
    { name: 'Settings', href: '/coordinator/settings/severity-thresholds' }
  ],
  '/assessor/preliminary-assessment': [
    { name: 'Dashboard', href: '/dashboard' },
    { name: 'Assessments', href: '/assessor/rapid-assessments' },
    { name: 'Preliminary', href: '/assessor/preliminary-assessment' }
  ],
  '/rapid-assessments': [
    { name: 'Dashboard', href: '/dashboard' },
    { name: 'Assessments', href: '/assessor/rapid-assessments' },
    { name: 'Rapid', href: '/rapid-assessments' }
  ],
  '/assessor/rapid-assessments': [
    { name: 'Dashboard', href: '/dashboard' },
    { name: 'Assessments', href: '/assessor/rapid-assessments' }
  ],
  '/assessor/rapid-assessments/new': [
    { name: 'Dashboard', href: '/dashboard' },
    { name: 'Assessments', href: '/assessor/rapid-assessments' },
    { name: 'New Assessment', href: '/assessor/rapid-assessments/new' }
  ],
  '/surveys': [
    { name: 'Dashboard', href: '/dashboard' },
    { name: 'Assessments', href: '/assessor/rapid-assessments' },
    { name: 'Surveys', href: '/assessor/preliminary-assessment' }
  ],
  '/assessor/reports': [
    { name: 'Dashboard', href: '/dashboard' },
    { name: 'Reports', href: '/coordinator/reports' }
  ],
  '/responder/planning': [
    { name: 'Dashboard', href: '/dashboard' },
    { name: 'Response Planning', href: '/responder/planning' }
  ],
  '/responder/planning/new': [
    { name: 'Dashboard', href: '/dashboard' },
    { name: 'Response Planning', href: '/responder/planning' },
    { name: 'Create Response', href: '/responder/planning/new' }
  ],
  '/responder/responses': [
    { name: 'Dashboard', href: '/dashboard' },
    { name: 'Response Planning', href: '/responder/planning' },
    { name: 'My Responses', href: '/responder/responses' }
  ],
  '/responder/resources': [
    { name: 'Dashboard', href: '/dashboard' },
    { name: 'Resources', href: '/coordinator/resource-management' }
  ],
  '/donor/dashboard': [
    { name: 'Dashboard', href: '/dashboard' },
    { name: 'Donor Dashboard', href: '/donor/dashboard' }
  ],
  '/donor/entities': [
    { name: 'Dashboard', href: '/dashboard' },
    { name: 'Assigned Entities', href: '/donor/entities' }
  ],
  '/donor/responses': [
    { name: 'Dashboard', href: '/dashboard' },
    { name: 'Donor Dashboard', href: '/donor/dashboard' },
    { name: 'Commitment Status', href: '/donor/responses' }
  ],
  '/donor/performance': [
    { name: 'Dashboard', href: '/dashboard' },
    { name: 'Performance', href: '/donor/performance' }
  ],
  '/donor/leaderboard': [
    { name: 'Dashboard', href: '/dashboard' },
    { name: 'Leaderboard', href: '/donor/leaderboard' }
  ],
  '/admin/users': [
    { name: 'Dashboard', href: '/dashboard' },
    { name: 'User Management', href: '/admin/users' }
  ],
  '/users/new': [
    { name: 'Dashboard', href: '/dashboard' },
    { name: 'User Management', href: '/admin/users' },
    { name: 'Add User', href: '/admin/users' }
  ],
  '/roles': [
    { name: 'Dashboard', href: '/dashboard' },
    { name: 'User Management', href: '/admin/users' },
    { name: 'Role Management', href: '/roles' }
  ],
  '/system/settings': [
    { name: 'Dashboard', href: '/dashboard' },
    { name: 'System', href: '/system/settings' },
    { name: 'Settings', href: '/system/settings' }
  ],
  '/system/audit': [
    { name: 'Dashboard', href: '/dashboard' },
    { name: 'System', href: '/system/settings' },
    { name: 'Audit Logs', href: '/system/audit' }
  ],
  '/system/database': [
    { name: 'Dashboard', href: '/dashboard' },
    { name: 'System', href: '/system/settings' },
    { name: 'Database', href: '/system/database' }
  ],
  '/admin/donors': [
    { name: 'Dashboard', href: '/dashboard' },
    { name: 'Donor Management', href: '/admin/donors' }
  ],
  '/admin/donors/metrics': [
    { name: 'Dashboard', href: '/dashboard' },
    { name: 'Donor Management', href: '/admin/donors' },
    { name: 'Donor Metrics', href: '/admin/donors/metrics' }
  ],
  '/incidents': [
    { name: 'Dashboard', href: '/dashboard' },
    { name: 'Active Incidents', href: '/coordinator/incidents' }
  ],
  '/tasks': [
    { name: 'Dashboard', href: '/dashboard' },
    { name: 'My Tasks', href: '/responder/planning' }
  ],
  '/team': [
    { name: 'Dashboard', href: '/dashboard' },
    { name: 'Team Status', href: '/responder/planning' }
  ],
  '/profile': [
    { name: 'Dashboard', href: '/dashboard' },
    { name: 'Profile', href: '/profile' }
  ],
  '/coordinator/verification': [
    { name: 'Dashboard', href: '/dashboard' },
    { name: 'Verification Queue', href: '/coordinator/verification' }
  ],
  '/coordinator/auto-approval': [
    { name: 'Dashboard', href: '/dashboard' },
    { name: 'Auto-Approval Management', href: '/coordinator/auto-approval' }
  ],
  '/coordinator/entity-management': [
    { name: 'Dashboard', href: '/dashboard' },
    { name: 'Entity Management', href: '/coordinator/entity-management' }
  ],
  '/coordinator/donors': [
    { name: 'Dashboard', href: '/dashboard' },
    { name: 'Donor Management', href: '/coordinator/donors' }
  ],
  '/coordinator/donors/metrics': [
    { name: 'Dashboard', href: '/dashboard' },
    { name: 'Donor Management', href: '/coordinator/donors' },
    { name: 'Metrics', href: '/coordinator/donors/metrics' }
  ],
  '/coordinator/entity-incident-map': [
    { name: 'Dashboard', href: '/dashboard' },
    { name: 'Entity-Incident Map', href: '/coordinator/entity-incident-map' }
  ],
  '/coordinator/settings/severity-thresholds': [
    { name: 'Dashboard', href: '/dashboard' },
    { name: 'Configuration', href: '/coordinator/settings/severity-thresholds' },
    { name: 'Severity Thresholds', href: '/coordinator/settings/severity-thresholds' }
  ],
  '/coordinator/reports': [
    { name: 'Dashboard', href: '/dashboard' },
    { name: 'Reports', href: '/coordinator/reports' }
  ],
  '/donor/analytics': [
    { name: 'Dashboard', href: '/dashboard' },
    { name: 'Donor Dashboard', href: '/donor/dashboard' },
    { name: 'Analytics', href: '/donor/analytics' }
  ],
  '/donor/profile': [
    { name: 'Dashboard', href: '/dashboard' },
    { name: 'Donor Dashboard', href: '/donor/dashboard' },
    { name: 'My Profile', href: '/donor/profile' }
  ],
  '/donor/entities/performance': [
    { name: 'Dashboard', href: '/dashboard' },
    { name: 'Entities', href: '/donor/entities' },
    { name: 'Performance', href: '/donor/entities/performance' }
  ],
  '/donor/reports': [
    { name: 'Dashboard', href: '/dashboard' },
    { name: 'Donor Dashboard', href: '/donor/dashboard' },
    { name: 'Reports', href: '/donor/reports' }
  ],
  '/admin/dashboard': [
    { name: 'Dashboard', href: '/dashboard' },
    { name: 'Admin Dashboard', href: '/admin/dashboard' }
  ],
  '/system/health': [
    { name: 'Dashboard', href: '/dashboard' },
    { name: 'System', href: '/system/settings' },
    { name: 'Health', href: '/system/health' }
  ],
  '/donor/rapid-assessments': [
    { name: 'Dashboard', href: '/dashboard' },
    { name: 'Donor Dashboard', href: '/donor/dashboard' },
    { name: 'Rapid Assessments', href: '/donor/rapid-assessments' }
  ]
};

const generateDynamicBreadcrumbs = (pathname: string): BreadcrumbItem[] => {
  const breadcrumbs: BreadcrumbItem = { name: 'Dashboard', href: '/dashboard' };
  
  // Handle query parameters and dynamic paths
  if (pathname.includes('?tab=exports') || pathname.includes('/dashboard?tab=exports')) {
    return [
      { name: 'Dashboard', href: '/dashboard' },
      { name: 'Settings', href: '/coordinator/settings/severity-thresholds' },
      { name: 'Export Functions', href: '/coordinator/dashboard?tab=exports' }
    ];
  }
  
  if (pathname.includes('?tab=reports') || pathname.includes('/dashboard?tab=reports')) {
    return [
      { name: 'Dashboard', href: '/dashboard' },
      { name: 'Settings', href: '/coordinator/settings/severity-thresholds' },
      { name: 'Report Builder', href: '/coordinator/dashboard?tab=reports' }
    ];
  }
  
  if (pathname.includes('?tab=commitments') || pathname.includes('/dashboard?tab=commitments')) {
    return [
      { name: 'Dashboard', href: '/dashboard' },
      { name: 'Donor Dashboard', href: '/donor/dashboard' },
      { name: 'Manage Commitments', href: '/donor/dashboard?tab=commitments' }
    ];
  }
  
  if (pathname.includes('?tab=achievements') || pathname.includes('/performance?tab=achievements')) {
    return [
      { name: 'Dashboard', href: '/dashboard' },
      { name: 'Performance', href: '/donor/performance' },
      { name: 'Achievements', href: '/donor/performance?tab=achievements' }
    ];
  }
  
  if (pathname.includes('?action=new-commitment')) {
    return [
      { name: 'Dashboard', href: '/dashboard' },
      { name: 'Donor Dashboard', href: '/donor/dashboard' },
      { name: 'New Commitment', href: '/donor/dashboard?action=new-commitment' }
    ];
  }

  // Handle dynamic paths with IDs
  const pathParts = pathname.split('/').filter(Boolean);
  
  if (pathParts.length > 1 && pathParts[0] === 'api') {
    // API routes don't need breadcrumbs
    return [];
  }
  
  // Default fallback for unregistered routes
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length > 1) {
    return [
      breadcrumbs,
      { 
        name: segments[segments.length - 1].charAt(0).toUpperCase() + 
              segments[segments.length - 1].slice(1).replace(/-/g, ' '), 
        href: pathname 
      }
    ];
  }
  
  return [breadcrumbs];
};

export const Breadcrumbs = ({ className, ...props }: React.HTMLAttributes<HTMLElement>) => {
  const pathname = usePathname();
  
  // Get predefined breadcrumbs or generate dynamic ones
  const breadcrumbs = breadcrumbStructure[pathname] || generateDynamicBreadcrumbs(pathname);
  
  // Don't show breadcrumbs on dashboard root
  if (pathname === '/dashboard' || pathname === '/') {
    return null;
  }
  
  if (breadcrumbs.length === 0) {
    return null;
  }
  
  return (
    <nav
      aria-label="Breadcrumb"
      className={cn("flex items-center space-x-2 text-sm text-muted-foreground", className)}
      {...props}
    >
      <Link
        href="/dashboard"
        className="flex items-center hover:text-foreground transition-colors"
      >
        <Home className="h-4 w-4" />
      </Link>
      
      {breadcrumbs.map((item, index) => {
        const isLast = index === breadcrumbs.length - 1;
        const isMiddle = !isLast && index > 0;
        const hasMiddleItems = breadcrumbs.length > 2;
        
        return (
          <React.Fragment key={item.href}>
            {isMiddle && hasMiddleItems && index === 1 && (
              <>
                <ChevronRight className="h-4 w-4 flex-shrink-0 sm:hidden" />
                <span className="sm:hidden text-muted-foreground">…</span>
              </>
            )}
            <ChevronRight className={cn("h-4 w-4 flex-shrink-0", isMiddle && hasMiddleItems && "hidden sm:block")} />
            {isLast ? (
              <span className="text-foreground font-medium truncate" aria-current="page">
                {item.name}
              </span>
            ) : (
              <Link
                href={item.href}
                className={cn(
                  "hover:text-foreground transition-colors",
                  isMiddle && hasMiddleItems && "hidden sm:inline"
                )}
              >
                {item.name}
              </Link>
            )}
          </React.Fragment>
        );
      })}
    </nav>
  );
};