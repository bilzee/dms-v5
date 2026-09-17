'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/hooks/useAuth';
import { useRoleNavigation } from '@/components/shared/RoleBasedRoute';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useRouter } from 'next/navigation';
import { apiPost } from '@/lib/api';
import { 
  LayoutDashboard,
  FileText,
  Users,
  Settings,
  AlertTriangle,
  HandHeart,
  Building2,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Monitor,
  Package,
  TrendingUp,
  User,
  BarChart3,
  Award,
  Trophy,
  MapPin,
  Image,
  LogOut,
  Menu,
  Bell,
  DollarSign
} from '@/lib/icons';

interface NavItem {
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  description?: string;
  badge?: string;
  children?: NavItem[];
}

const utilityItems: NavItem[] = [
  {
    name: 'Profile',
    href: '/profile',
    icon: User,
    description: 'Your user profile and settings'
  },
  {
    name: 'Help & Support',
    href: '/help',
    icon: Settings,
    description: 'Get help and support'
  },
  {
    name: 'Logout',
    href: '#logout',
    icon: LogOut,
    description: 'Sign out of your account'
  }
];

const getNavigationItems = (role: string | null): { roleItems: NavItem[]; utilityItems: NavItem[] } => {
  const roleSpecificItems: Record<string, NavItem[]> = {
    ASSESSOR: [
      {
        name: 'Dashboard',
        href: '/assessor/dashboard',
        icon: LayoutDashboard,
        description: 'Assessor overview and recent assessments'
      },
      {
        name: 'Rapid Assessments',
        href: '/assessor/rapid-assessments',
        icon: FileText,
        description: 'Rapid assessments management page'
      },
      {
        name: 'Create New Assessment',
        href: '/assessor/rapid-assessments/new',
        icon: AlertTriangle,
        description: 'Create a new rapid assessment'
      },
      {
        name: 'Preliminary Assessment',
        href: '/assessor/preliminary-assessment',
        icon: FileText,
        description: 'Preliminary assessment tools'
      }
    ],
    COORDINATOR: [
      {
        name: 'Crisis Dashboard',
        href: '/coordinator/dashboard',
        icon: LayoutDashboard,
        description: 'Crisis coordination dashboard'
      },
      {
        name: 'Situation Awareness',
        href: '/coordinator/situation-dashboard',
        icon: Monitor,
        description: 'Comprehensive situation monitoring'
      },
      {
        name: 'Signal Analytics',
        href: '/coordinator/analytics',
        icon: BarChart3,
        description: 'Historical signal analytics and operational metrics'
      },
      {
        name: 'Operations Management',
        href: '#coordinator-operations',
        icon: Users,
        children: [
          { 
            name: 'Verification Queue', 
            href: '/coordinator/verification', 
            icon: FileText,
            description: 'Manage verification workflows' 
          },
          {
            name: 'Verification Metrics',
            href: '/verification/metrics',
            icon: BarChart3,
            description: 'View verification analytics and metrics'
          },
          { 
            name: 'Entity Assignment', 
            href: '/coordinator/entities', 
            icon: Building2,
            description: 'Manage entities and user/donor assignments' 
          },
          { 
            name: 'Entity Management', 
            href: '/coordinator/entity-management', 
            icon: Building2,
            description: 'Create and manage entities in the system' 
          },
          { 
            name: 'Resource Allocation', 
            href: '/coordinator/resource-management',
            icon: Package,
            description: 'Coordinate resource distribution' 
          },
          { 
            name: 'Incident Management', 
            href: '/coordinator/incidents', 
            icon: AlertTriangle,
            description: 'Manage disaster incidents' 
          }
        ]
      },
      {
        name: 'Donor Relations',
        href: '#coordinator-donor-relations',
        icon: HandHeart,
        children: [
          {
            name: 'Donor Management',
            href: '/coordinator/donors',
            icon: Building2,
            description: 'Manage donor relationships'
          },
          {
            name: 'Donor Metrics',
            href: '/coordinator/donors/metrics',
            icon: BarChart3,
            description: 'Donor performance analytics'
          },
        ]
      },
      {
        name: 'Configuration',
        href: '#coordinator-configuration',
        icon: Settings,
        children: [
          {
            name: 'Auto-Approval Management',
            href: '/coordinator/auto-approval',
            icon: Settings,
            description: 'Manage automatic verification settings'
          },
          {
            name: 'Severity Thresholds',
            href: '/coordinator/settings/severity-thresholds',
            icon: Settings,
            description: 'Configure severity thresholds for impact badges'
          },
          {
            name: 'Scoring Configuration',
            href: '/coordinator/settings/scoring',
            icon: Trophy,
            description: 'Configure donor scoring formula weights and parameters'
          },
          {
            name: 'GAP Field Severity',
            href: '/coordinator/settings/gap-field-management',
            icon: ClipboardList,
            description: 'Tune GAP question severities for rapid assessments'
          }
        ]
      },
      {
        name: 'Reports',
        href: '#coordinator-reports',
        icon: FileText,
        children: [
          {
            name: 'Report Management',
            href: '/coordinator/reports',
            icon: FileText,
            description: 'View and manage report configurations'
          },
          {
            name: 'Report Builder',
            href: '/reports/builder',
            icon: BarChart3,
            description: 'Create and edit report templates'
          }
        ]
      },
      {
        name: 'Mapping & Visualization',
        href: '#coordinator-mapping',
        icon: MapPin,
        children: [
          { 
            name: 'Entity-Incident Map', 
            href: '/coordinator/entity-incident-map', 
            icon: MapPin,
            description: 'Interactive entity-incident relationship map with incident selector' 
          }
        ]
      }
    ],
    RESPONDER: [
      {
        name: 'Dashboard',
        href: '/responder/dashboard',
        icon: LayoutDashboard,
        description: 'Response overview and active assignments'
      },
      {
        name: 'Response Planning',
        href: '/responder/planning',
        icon: Package,
        children: [
          { name: 'Create Response', href: '/responder/planning/new', icon: Package },
          { name: 'Response Deliveries', href: '/responder/responses', icon: Package },
          { name: 'Response Plans', href: '/responder/planning/', icon: Package }
        ]
      }
    ],
    DONOR: [
      { 
        name: 'Dashboard', 
        href: '/donor/dashboard', 
        icon: LayoutDashboard 
      },
      {
        name: 'My Commitments',
        href: '#donor-commitments',
        icon: HandHeart,
        children: [
          { 
            name: 'Manage Commitments', 
            href: '/donor/dashboard?tab=commitments', 
            icon: HandHeart,
            description: 'View and manage all commitments' 
          },
          { 
            name: 'Create New Commitment', 
            href: '/donor/dashboard?action=new-commitment', 
            icon: HandHeart,
            description: 'Make a new donation commitment' 
          },
          { 
            name: 'Commitment Status', 
            href: '/donor/responses', 
            icon: FileText,
            description: 'Track delivery status' 
          },
        ]
      },
      {
        name: 'Assigned Entities',
        href: '/donor/entities',
        icon: MapPin,
        children: [
          { 
            name: 'Entity Locations', 
            href: '/donor/entities', 
            icon: MapPin,
            description: 'View assigned entity locations' 
          },
          { 
            name: 'Entity Performance', 
            href: '/donor/entities/performance', 
            icon: BarChart3,
            description: 'Track entity impact metrics' 
          },
        ]
      },
      {
        name: 'Performance & Analytics',
        href: '/donor/performance',
        icon: TrendingUp,
        children: [
          { 
            name: 'Performance Dashboard', 
            href: '/donor/performance', 
            icon: TrendingUp,
            description: 'Overall performance overview' 
          },
          { 
            name: 'Achievements', 
            href: '/donor/performance?tab=achievements', 
            icon: Award,
            description: 'View earned achievements' 
          },
          { 
            name: 'Leaderboard', 
            href: '/donor/leaderboard', 
            icon: Trophy,
            description: 'Compare with other donors' 
          },
          {
            name: 'Analytics',
            href: '/donor/analytics',
            icon: BarChart3,
            description: 'Detailed donation analytics'
          }
        ]
      },
    ],
    ADMIN: [
      { 
        name: 'Dashboard', 
        href: '/admin/dashboard', 
        icon: LayoutDashboard 
      },
      {
        name: 'User Management',
        href: '/admin/users',
        icon: Users,
        children: [
          { 
            name: 'All Users', 
            href: '/admin/users', 
            icon: Users,
            description: 'View and manage all users' 
          },
          { 
            name: 'Role Management', 
            href: '/roles', 
            icon: Settings,
            description: 'Manage user roles and permissions' 
          }
        ]
      },
      {
        name: 'Donor Management',
        href: '/admin/donors',
        icon: Building2,
        children: [
          { 
            name: 'All Donors', 
            href: '/admin/donors', 
            icon: Building2,
            description: 'View and manage all donor organizations' 
          },
          { 
            name: 'Register New Donor', 
            href: '/admin/donors/register', 
            icon: HandHeart,
            description: 'Register a new donor organization and user account' 
          }
        ]
      },
      {
        name: 'Reports',
        href: '#admin-reports',
        icon: FileText,
        children: [
          { 
            name: 'Report Management', 
            href: '/coordinator/reports', 
            icon: FileText,
            description: 'View and manage report configurations' 
          },
          { 
            name: 'Report Builder', 
            href: '/reports/builder', 
            icon: BarChart3,
            description: 'Create and edit report templates' 
          }
        ]
      },
      {
        name: 'System Administration',
        href: '#admin-system',
        icon: Settings,
        children: [
          { 
            name: 'System Settings', 
            href: '/system/settings', 
            icon: Settings,
            description: 'System configuration' 
          },
          { 
            name: 'Audit Logs', 
            href: '/system/audit', 
            icon: FileText,
            description: 'System audit and activity logs' 
          },
          { 
            name: 'Database Management', 
            href: '/system/database', 
            icon: FileText,
            description: 'Database administration' 
          },
          { 
            name: 'System Health', 
            href: '/system/health', 
            icon: Monitor,
            description: 'System monitoring and health status' 
          },
          {
            name: 'Notification Settings',
            href: '/admin/settings/notifications',
            icon: Bell,
            description: 'Configure push and in-app notification channels and priorities'
          },
          {
            name: 'Map Settings',
            href: '/admin/settings/map',
            icon: MapPin,
            description: 'Configure default map center and zoom level'
          },
          {
            name: 'Brand Settings',
            href: '/admin/settings/branding',
            icon: Image,
            description: 'Customize app name, logo, and PWA icon'
          },
          {
            name: 'Currency Settings',
            href: '/admin/settings/currency',
            icon: DollarSign,
            description: 'Configure currency symbol and display style'
          },
          {
            name: 'Question Registry',
            href: '/admin/settings/questions',
            icon: ClipboardList,
            description: 'Manage rapid assessment questions, GAP metadata, and severities'
          }
        ]
      }
    ]
  };

  const items = roleSpecificItems[role as keyof typeof roleSpecificItems] || [];
  return { roleItems: items, utilityItems };
};

export const Navigation = ({ onNavigate }: { onNavigate?: () => void } = {}) => {
  const pathname = usePathname();
  const router = useRouter();
  const { currentRole } = useAuth();
  const { canAccessPath } = useRoleNavigation();
  
  // Memoize navigationItems to prevent infinite re-renders
  const { roleItems, utilityItems: footerItems } = useMemo(() => getNavigationItems(currentRole), [currentRole]);
  
  // Determine which parent group contains the current path
  const getActiveParentItems = (items: NavItem[], path: string): string[] => {
    const activeHrefs: string[] = [];
    items.forEach(item => {
      if (item.children && item.children.length > 0) {
        const childMatches = item.children.some(child => {
          const childHref = child.href.split('?')[0];
          return path === childHref || path.startsWith(childHref + '/');
        });
        const parentMatches = item.href !== '#' && (path === item.href || path.startsWith(item.href + '/'));
        if (childMatches || parentMatches) {
          activeHrefs.push(item.href);
        }
      }
    });
    return activeHrefs;
  };

  const activeParentItems = useMemo(() => getActiveParentItems(roleItems, pathname), [roleItems, pathname]);

  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set(activeParentItems));

  // Update expanded items when path changes — auto-expand active group, collapse others
  useEffect(() => {
    setExpandedItems(new Set(activeParentItems));
  }, [activeParentItems]);

  const toggleExpanded = (href: string) => {
    const newExpanded = new Set(expandedItems);
    if (newExpanded.has(href)) {
      newExpanded.delete(href);
    } else {
      newExpanded.add(href);
    }
    setExpandedItems(newExpanded);
  };

  const isActive = (href: string) => {
    // Handle query parameters and sub-paths
    const normalizePath = (path: string) => {
      if (path.includes('?')) {
        return path.split('?')[0];
      }
      return path;
    };
    
    const normalizedHref = normalizePath(href);
    const normalizedPathname = normalizePath(pathname);
    
    return normalizedPathname === normalizedHref || 
           normalizedPathname.startsWith(normalizedHref + '/') ||
           (href.includes('?') && normalizedPathname === normalizePath(href));
  };

  const isAccessible = (href: string) => {
    if (href.startsWith('#')) return true;
    if (href === '/profile' || href === '/help') return true;
    return canAccessPath(href);
  };

  const NavItemComponent = ({ item, depth = 0 }: { item: NavItem; depth?: number }) => {
    const hasChildren = item.children && item.children.length > 0;
    const isItemActive = isActive(item.href);
    const isExpanded = expandedItems.has(item.href);

    const handleLogout = React.useCallback(async () => {
      try {
        await apiPost('/api/v1/auth/logout');
      } catch {}
      router.push('/login');
    }, [router]);

    if (!isAccessible(item.href)) {
      return null;
    }

    // Auto-expand logic handled at parent level through expanded state

    if (hasChildren) {
      return (
        <div className="space-y-1">
          <Button
            variant="ghost"
            aria-expanded={isExpanded}
            aria-controls={`nav-section-${item.href.replace('#', '')}`}
            className={cn(
              "w-full justify-between font-normal transition-colors",
              depth > 0 && "ml-4",
              isExpanded && "bg-accent text-accent-foreground",
              !isExpanded && "hover:bg-accent hover:text-accent-foreground"
            )}
            onClick={(e) => {
              e.preventDefault();
              toggleExpanded(item.href);
            }}
          >
            <div className="flex items-center gap-3">
              <item.icon className="h-4 w-4 transition-colors" />
              <span>{item.name}</span>
              {item.badge && (
                <Badge variant="secondary" className="ml-auto">
                  {item.badge}
                </Badge>
              )}
            </div>
            {isExpanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </Button>
          
          {isExpanded && (
            <div
              id={`nav-section-${item.href.replace('#', '')}`}
              role="region"
              className="ml-4 space-y-1"
            >
              {item.children!.map((child) => (
                <NavItemComponent key={child.href} item={child} depth={depth + 1} />
              ))}
            </div>
          )}
        </div>
      );
    }

    if (item.href === '#logout') {
      return (
        <Button
          variant="ghost"
          className={cn(
            "w-full justify-start font-normal transition-colors",
            depth > 0 && "ml-4",
            "hover:bg-accent hover:text-accent-foreground"
          )}
          onClick={handleLogout}
        >
          <div className="flex items-center gap-3">
            <item.icon className="h-4 w-4 transition-colors" />
            <span>{item.name}</span>
          </div>
        </Button>
      );
    }

    if (item.href.startsWith('#')) {
      return null;
    }

    return (
      <Link href={item.href} onClick={() => { if (!isItemActive && onNavigate) onNavigate(); }}>
        <Button
          variant="ghost"
          className={cn(
            "w-full justify-start font-normal transition-colors",
            depth > 0 && "ml-4",
            isItemActive && "bg-primary text-primary-foreground hover:bg-primary/90",
            !isItemActive && "hover:bg-accent hover:text-accent-foreground"
          )}
        >
          <div className="flex items-center gap-3">
            <item.icon className={cn(
              "h-4 w-4 transition-colors",
              isItemActive && "text-primary-foreground"
            )} />
            <span>{item.name}</span>
            {item.badge && (
              <Badge variant={isItemActive ? "default" : "secondary"} className="ml-auto">
                {item.badge}
              </Badge>
            )}
          </div>
        </Button>
      </Link>
    );
  };

  return (
    <nav className="space-y-2 p-4">
      {currentRole && (
        <div className="mb-6 p-3 bg-accent/50 rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <Badge variant="outline">{currentRole}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Role-specific navigation and features
          </p>
        </div>
      )}
      
      {roleItems.map((item) => (
        <NavItemComponent key={item.href} item={item} />
      ))}
      
      <div className="my-3 border-t border-border" />
      
      {footerItems.map((item) => (
        <NavItemComponent key={item.href} item={item} />
      ))}
    </nav>
  );
};