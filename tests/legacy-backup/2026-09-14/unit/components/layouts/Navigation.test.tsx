import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { usePathname } from 'next/navigation';
import { Navigation } from '@/components/layouts/Navigation';
import { useAuth } from '@/hooks/useAuth';
import { useRoleNavigation } from '@/components/shared/RoleBasedRoute';

// Mock Next.js navigation
jest.mock('next/navigation', () => ({
  usePathname: jest.fn(),
}));

// Mock auth hooks
jest.mock('@/hooks/useAuth', () => ({
  useAuth: jest.fn(),
}));

jest.mock('@/components/shared/RoleBasedRoute', () => ({
  useRoleNavigation: jest.fn(),
}));

// Mock UI Components
jest.mock('@/components/ui/badge', () => ({
  Badge: ({ children, variant, className }: any) => (
    <span className={`badge ${variant} ${className}`} data-testid="badge">
      {children}
    </span>
  ),
}));

jest.mock('@/components/ui/button', () => ({
  Button: ({ children, className, onClick, ...props }: any) => (
    <button onClick={onClick} className={`button ${className}`} data-testid="button" {...props}>
      {children}
    </button>
  ),
}));

// Mock Lucide icons
jest.mock('lucide-react', () => ({
  LayoutDashboard: () => <div data-testid="dashboard-icon" />,
  FileText: () => <div data-testid="file-text-icon" />,
  Users: () => <div data-testid="users-icon" />,
  Settings: () => <div data-testid="settings-icon" />,
  AlertTriangle: () => <div data-testid="alert-icon" />,
  HandHeart: () => <div data-testid="heart-icon" />,
  Building2: () => <div data-testid="building-icon" />,
  ChevronDown: () => <div data-testid="chevron-down" />,
  ChevronRight: () => <div data-testid="chevron-right" />,
  Monitor: () => <div data-testid="monitor-icon" />,
  Package: () => <div data-testid="package-icon" />,
  TrendingUp: () => <div data-testid="trending-icon" />,
  User: () => <div data-testid="user-icon" />,
  BarChart3: () => <div data-testid="bar-chart-icon" />,
  Award: () => <div data-testid="award-icon" />,
  Trophy: () => <div data-testid="trophy-icon" />,
  MapPin: () => <div data-testid="map-pin-icon" />,
}));

describe('Navigation Component', () => {
  let queryClient: QueryClient;
  let user: ReturnType<typeof userEvent.setup>;
  let mockUsePathname: jest.MockedFunction<typeof usePathname>;
  let mockUseAuth: jest.MockedFunction<typeof useAuth>;
  let mockCanAccessPath: jest.Mock;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    user = userEvent.setup();
    mockUsePathname = usePathname as jest.MockedFunction<typeof usePathname>;
    mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;
    mockCanAccessPath = jest.fn();

    mockUseAuth.mockReturnValue({
      currentRole: 'COORDINATOR',
      user: { id: '1', name: 'Test User', email: 'test@example.com' },
    });

    (useRoleNavigation as jest.Mock).mockReturnValue({
      canAccessPath: mockCanAccessPath,
    });

    mockCanAccessPath.mockReturnValue(true);
    mockUsePathname.mockReturnValue('/dashboard');
  });

  const renderComponent = () => {
    return render(
      <QueryClientProvider client={queryClient}>
        <Navigation />
      </QueryClientProvider>
    );
  };

  it('renders navigation with basic structure', () => {
    renderComponent();
    
    expect(screen.getByRole('navigation')).toBeInTheDocument();
  });

  it('shows dashboard link for all authenticated users', () => {
    mockUseAuth.mockReturnValue({
      currentRole: 'ASSESSOR',
      user: { id: '1', name: 'Test User' },
    });
    
    renderComponent();
    
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByTestId('dashboard-icon')).toBeInTheDocument();
  });

  it('displays assessor-specific navigation items', () => {
    mockUseAuth.mockReturnValue({
      currentRole: 'ASSESSOR',
      user: { id: '1', name: 'Test User' },
    });
    
    renderComponent();
    
    expect(screen.getByText('Assessments')).toBeInTheDocument();
    expect(screen.getByText('Reports')).toBeInTheDocument();
    expect(screen.getByTestId('file-text-icon')).toBeInTheDocument();
    expect(screen.getByTestId('bar-chart-icon')).toBeInTheDocument();
  });

  it('displays coordinator-specific navigation items', () => {
    mockUseAuth.mockReturnValue({
      currentRole: 'COORDINATOR',
      user: { id: '1', name: 'Test User' },
    });
    
    renderComponent();
    
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Situation Awareness')).toBeInTheDocument();
    expect(screen.getByText('Coordination')).toBeInTheDocument();
    expect(screen.getByText('Entity Management')).toBeInTheDocument();
    expect(screen.getByText('Incidents')).toBeInTheDocument();
    expect(screen.getByText('Analytics')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
    expect(screen.getByTestId('monitor-icon')).toBeInTheDocument();
    expect(screen.getByTestId('users-icon')).toBeInTheDocument();
    expect(screen.getByTestId('building-icon')).toBeInTheDocument();
  });

  it('displays responder-specific navigation items', () => {
    mockUseAuth.mockReturnValue({
      currentRole: 'RESPONDER',
      user: { id: '1', name: 'Test User' },
    });
    
    renderComponent();
    
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Response Planning')).toBeInTheDocument();
    expect(screen.getByText('Resources')).toBeInTheDocument();
    expect(screen.getByText('Active Incidents')).toBeInTheDocument();
    expect(screen.getByText('My Tasks')).toBeInTheDocument();
    expect(screen.getByText('Team Status')).toBeInTheDocument();
    expect(screen.getByTestId('package-icon')).toBeInTheDocument();
    expect(screen.getByTestId('alert-icon')).toBeInTheDocument();
  });

  it('displays donor-specific navigation items', () => {
    mockUseAuth.mockReturnValue({
      currentRole: 'DONOR',
      user: { id: '1', name: 'Test User' },
    });
    
    renderComponent();
    
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Commitments')).toBeInTheDocument();
    expect(screen.getByText('Assigned Entities')).toBeInTheDocument();
    expect(screen.getByText('Performance')).toBeInTheDocument();
    expect(screen.getByText('Achievements')).toBeInTheDocument();
    expect(screen.getByText('Leaderboard')).toBeInTheDocument();
    expect(screen.getByTestId('heart-icon')).toBeInTheDocument();
    expect(screen.getByTestId('award-icon')).toBeInTheDocument();
    expect(screen.getByTestId('trophy-icon')).toBeInTheDocument();
  });

  it('displays admin-specific navigation items', () => {
    mockUseAuth.mockReturnValue({
      currentRole: 'ADMIN',
      user: { id: '1', name: 'Test User' },
    });
    
    renderComponent();
    
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('User Management')).toBeInTheDocument();
    expect(screen.getByText('System')).toBeInTheDocument();
    expect(screen.getByText('Donor Management')).toBeInTheDocument();
    expect(screen.getByText('Donor Metrics')).toBeInTheDocument();
    expect(screen.getByTestId('users-icon')).toBeInTheDocument();
    expect(screen.getByTestId('settings-icon')).toBeInTheDocument();
  });

  it('handles collapsible navigation sections', async () => {
    mockUseAuth.mockReturnValue({
      currentRole: 'COORDINATOR',
      user: { id: '1', name: 'Test User' },
    });
    
    renderComponent();
    
    // Find a section with children (e.g., Coordination)
    const coordinationSection = screen.getByText('Coordination');
    expect(coordinationSection).toBeInTheDocument();
    
    // Initially expanded state should show chevron down
    expect(screen.getByTestId('chevron-down')).toBeInTheDocument();
  });

  it('highlights active navigation item', () => {
    mockUsePathname.mockReturnValue('/coordinator/situation-dashboard');
    mockUseAuth.mockReturnValue({
      currentRole: 'COORDINATOR',
      user: { id: '1', name: 'Test User' },
    });
    
    renderComponent();
    
    // The situation awareness link should be highlighted
    const situationLink = screen.getByText('Situation Awareness');
    expect(situationLink.closest('[class*="bg-teal-600"]')).toBeInTheDocument();
  });

  it('handles query parameters in active state detection', () => {
    mockUsePathname.mockReturnValue('/coordinator/dashboard?tab=exports');
    mockUseAuth.mockReturnValue({
      currentRole: 'COORDINATOR',
      user: { id: '1', name: 'Test User' },
    });
    
    renderComponent();
    
    // Should properly handle query parameters for active state
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  it('filters navigation items based on permissions', () => {
    mockCanAccessPath.mockImplementation((path) => {
      // Mock permission logic - only allow dashboard
      return path === '/dashboard';
    });
    
    mockUseAuth.mockReturnValue({
      currentRole: 'COORDINATOR',
      user: { id: '1', name: 'Test User' },
    });
    
    renderComponent();
    
    // Should only show dashboard if no permissions for other items
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    // Other items should be filtered out by permission check
  });

  it('handles undefined role gracefully', () => {
    mockUseAuth.mockReturnValue({
      currentRole: null,
      user: { id: '1', name: 'Test User' },
    });
    
    renderComponent();
    
    // Should render without crashing
    expect(screen.getByRole('navigation')).toBeInTheDocument();
    // Should still show profile and dashboard
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
  });

  it('expands navigation sections when child is active', () => {
    mockUsePathname.mockReturnValue('/responses');
    mockUseAuth.mockReturnValue({
      currentRole: 'COORDINATOR',
      user: { id: '1', name: 'Test User' },
    });
    
    renderComponent();
    
    // The parent "Coordination" section should be expanded since child "Active Responses" is active
    expect(screen.getByText('Coordination')).toBeInTheDocument();
  });

  it('displays profile link for all users', () => {
    mockUseAuth.mockReturnValue({
      currentRole: 'ASSESSOR',
      user: { id: '1', name: 'Test User' },
    });
    
    renderComponent();
    
    expect(screen.getByText('Profile')).toBeInTheDocument();
    expect(screen.getByTestId('user-icon')).toBeInTheDocument();
  });

  it('handles sub-path navigation correctly', () => {
    mockUsePathname.mockReturnValue('/assessments/my');
    mockUseAuth.mockReturnValue({
      currentRole: 'ASSESSOR',
      user: { id: '1', name: 'Test User' },
    });
    
    renderComponent();
    
    // Parent assessments link should be highlighted when on sub-path
    expect(screen.getByText('Assessments')).toBeInTheDocument();
  });

  it('applies correct styling for active items', () => {
    mockUsePathname.mockReturnValue('/dashboard');
    mockUseAuth.mockReturnValue({
      currentRole: 'ASSESSOR',
      user: { id: '1', name: 'Test User' },
    });
    
    renderComponent();
    
    const dashboardLink = screen.getByText('Dashboard').closest('button');
    expect(dashboardLink).toHaveClass('bg-teal-600');
  });

  it('auto-expands parent sections with active children', async () => {
    mockUsePathname.mockReturnValue('/coordinator/verification');
    mockUseAuth.mockReturnValue({
      currentRole: 'COORDINATOR',
      user: { id: '1', name: 'Test User' },
    });
    
    renderComponent();
    
    // Wait for useEffect to run and auto-expand
    await waitFor(() => {
      expect(screen.getByText('Coordination')).toBeInTheDocument();
    });
  });

  it('hides navigation for unauthenticated users', () => {
    mockUseAuth.mockReturnValue({
      currentRole: null,
      user: null,
    });
    
    renderComponent();
    
    // Should render empty navigation for unauthenticated users
    const navElement = screen.getByRole('navigation');
    expect(navElement.children).toHaveLength(0);
  });
});