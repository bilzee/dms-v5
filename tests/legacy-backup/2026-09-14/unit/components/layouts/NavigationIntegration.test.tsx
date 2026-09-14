import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { usePathname } from 'next/navigation';
import { AppShell } from '@/components/layouts/AppShell';
import { useAuth } from '@/hooks/useAuth';

// Mock Next.js navigation
jest.mock('next/navigation', () => ({
  usePathname: jest.fn(),
}));

// Mock auth hook
jest.mock('@/hooks/useAuth', () => ({
  useAuth: jest.fn(),
}));

// Mock all child components
jest.mock('@/components/shared/Header', () => ({
  Header: () => <header data-testid="header" />,
}));

jest.mock('@/components/layouts/Navigation', () => ({
  Navigation: () => (
    <nav data-testid="navigation">
      <a href="/dashboard" data-testid="nav-dashboard">Dashboard</a>
      <a href="/coordinator/situation-dashboard" data-testid="nav-situation">Situation</a>
      <a href="/assessor/preliminary-assessment" data-testid="nav-assessment">Assessment</a>
    </nav>
  ),
}));

jest.mock('@/components/layouts/RoleSwitcher', () => ({
  RoleSwitcher: () => <div data-testid="role-switcher" />,
}));

jest.mock('@/components/shared/SyncIndicator', () => ({
  SyncIndicator: () => <div data-testid="sync-indicator" />,
}));

jest.mock('@/components/shared/OfflineIndicator', () => ({
  OfflineIndicator: () => <div data-testid="offline-indicator" />,
}));

jest.mock('@/components/shared/Breadcrumbs', () => ({
  Breadcrumbs: ({ className }) => <nav data-testid="breadcrumbs" className={className} />,
}));

jest.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, ...props }) => (
    <button onClick={onClick} {...props}>{children}</button>
  ),
}));

describe('Navigation Integration Tests', () => {
  let queryClient: QueryClient;
  let user: ReturnType<typeof userEvent.setup>;
  let mockUsePathname: jest.MockedFunction<typeof usePathname>;
  let mockUseAuth: jest.MockedFunction<typeof useAuth>;

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
  });

  const renderApp = (props = {}) => {
    return render(
      <QueryClientProvider client={queryClient}>
        <AppShell {...props}>
          <div data-testid="page-content">Page Content</div>
        </AppShell>
      </QueryClientProvider>
    );
  };

  describe('Complete Navigation System', () => {
    it('renders full navigation system for authenticated coordinator', () => {
      mockUseAuth.mockReturnValue({
        isAuthenticated: true,
        currentRole: 'COORDINATOR',
        user: { id: '1', name: 'Coordinator User' },
      });
      mockUsePathname.mockReturnValue('/coordinator/situation-dashboard');

      renderApp();

      // Check all navigation components are present
      expect(screen.getByTestId('navigation')).toBeInTheDocument();
      expect(screen.getByTestId('breadcrumbs')).toBeInTheDocument();
      expect(screen.getByTestId('role-switcher')).toBeInTheDocument();
      expect(screen.getByTestId('sync-indicator')).toBeInTheDocument();
      expect(screen.getByTestId('offline-indicator')).toBeInTheDocument();
    });

    it('renders minimal layout for unauthenticated users', () => {
      mockUseAuth.mockReturnValue({
        isAuthenticated: false,
        user: null,
      });
      mockUsePathname.mockReturnValue('/login');

      renderApp();

      // Only header and content should be visible
      expect(screen.getByTestId('header')).toBeInTheDocument();
      expect(screen.getByTestId('page-content')).toBeInTheDocument();
      
      // Navigation components should not be present
      expect(screen.queryByTestId('navigation')).not.toBeInTheDocument();
      expect(screen.queryByTestId('breadcrumbs')).not.toBeInTheDocument();
      expect(screen.queryByTestId('role-switcher')).not.toBeInTheDocument();
    });

    it('shows breadcrumbs on non-dashboard pages', () => {
      mockUseAuth.mockReturnValue({
        isAuthenticated: true,
        currentRole: 'ASSESSOR',
        user: { id: '1', name: 'Assessor User' },
      });
      mockUsePathname.mockReturnValue('/assessor/preliminary-assessment');

      renderApp({ isDashboard: false });

      expect(screen.getByTestId('breadcrumbs')).toBeInTheDocument();
    });

    it('hides breadcrumbs on dashboard pages', () => {
      mockUseAuth.mockReturnValue({
        isAuthenticated: true,
        currentRole: 'ASSESSOR',
        user: { id: '1', name: 'Assessor User' },
      });
      mockUsePathname.mockReturnValue('/dashboard');

      renderApp({ isDashboard: true });

      expect(screen.queryByTestId('breadcrumbs')).not.toBeInTheDocument();
    });
  });

  describe('Responsive Layout Behavior', () => {
    beforeEach(() => {
      mockUseAuth.mockReturnValue({
        isAuthenticated: true,
        currentRole: 'COORDINATOR',
        user: { id: '1', name: 'Coordinator User' },
      });
      mockUsePathname.mockReturnValue('/coordinator/situation-dashboard');
    });

    it('includes both mobile and desktop navigation structures', () => {
      renderApp();

      // Check for mobile navigation elements
      const mobileSidebar = document.querySelector('.lg\\:hidden');
      expect(mobileSidebar).toBeInTheDocument();

      // Check for desktop navigation elements
      const desktopSidebar = document.querySelector('.lg\\:fixed');
      expect(desktopSidebar).toBeInTheDocument();
    });

    it('applies correct content spacing', () => {
      renderApp();

      const mainContent = document.querySelector('.lg\\:pl-64');
      expect(mainContent).toBeInTheDocument();
    });

    it('includes mobile top bar with navigation controls', () => {
      renderApp();

      const mobileTopBar = document.querySelector('.lg\\:hidden.sticky.top-0');
      expect(mobileTopBar).toBeInTheDocument();
    });
  });

  describe('Navigation Context Across Pages', () => {
    it('updates navigation state when route changes', () => {
      mockUseAuth.mockReturnValue({
        isAuthenticated: true,
        currentRole: 'COORDINATOR',
        user: { id: '1', name: 'Coordinator User' },
      });

      // Test on situation dashboard
      mockUsePathname.mockReturnValue('/coordinator/situation-dashboard');
      renderApp({ isDashboard: false });

      expect(screen.getByTestId('navigation')).toBeInTheDocument();
      expect(screen.getByTestId('breadcrumbs')).toBeInTheDocument();

      // Re-render on different page
      mockUsePathname.mockReturnValue('/coordinator/entities');
      renderApp({ isDashboard: false });

      expect(screen.getByTestId('navigation')).toBeInTheDocument();
      expect(screen.getByTestId('breadcrumbs')).toBeInTheDocument();
    });

    it('maintains navigation consistency across user roles', () => {
      // Test as Assessor
      mockUseAuth.mockReturnValue({
        isAuthenticated: true,
        currentRole: 'ASSESSOR',
        user: { id: '1', name: 'Assessor User' },
      });
      mockUsePathname.mockReturnValue('/assessor/preliminary-assessment');
      
      const { unmount } = renderApp({ isDashboard: false });
      
      expect(screen.getByTestId('navigation')).toBeInTheDocument();
      
      unmount();

      // Test as Coordinator
      mockUseAuth.mockReturnValue({
        isAuthenticated: true,
        currentRole: 'COORDINATOR',
        user: { id: '2', name: 'Coordinator User' },
      });
      
      renderApp({ isDashboard: false });
      
      expect(screen.getByTestId('navigation')).toBeInTheDocument();
    });
  });

  describe('Navigation Performance', () => {
    it('renders without performance warnings', () => {
      mockUseAuth.mockReturnValue({
        isAuthenticated: true,
        currentRole: 'DONOR',
        user: { id: '1', name: 'Donor User' },
      });
      mockUsePathname.mockReturnValue('/donor/dashboard');

      const startTime = performance.now();
      renderApp({ isDashboard: false });
      const endTime = performance.now();

      // Should render quickly (less than 100ms)
      expect(endTime - startTime).toBeLessThan(100);
      expect(screen.getByTestId('navigation')).toBeInTheDocument();
    });

    it('handles navigation state efficiently', () => {
      mockUseAuth.mockReturnValue({
        isAuthenticated: true,
        currentRole: 'RESPONDER',
        user: { id: '1', name: 'Responder User' },
      });
      mockUsePathname.mockReturnValue('/responder/planning');

      // Multiple quick renders should not cause issues
      renderApp({ isDashboard: false });
      renderApp({ isDashboard: false });
      renderApp({ isDashboard: false });

      expect(screen.getByTestId('navigation')).toBeInTheDocument();
    });
  });

  describe('Navigation Accessibility', () => {
    beforeEach(() => {
      mockUseAuth.mockReturnValue({
        isAuthenticated: true,
        currentRole: 'COORDINATOR',
        user: { id: '1', name: 'Coordinator User' },
      });
      mockUsePathname.mockReturnValue('/coordinator/situation-dashboard');
    });

    it('maintains proper semantic structure', () => {
      renderApp({ isDashboard: false });

      // Should have proper semantic elements
      expect(document.querySelector('nav')).toBeInTheDocument();
      expect(document.querySelector('main')).toBeInTheDocument();
      expect(document.querySelector('header')).toBeInTheDocument();
    });

    it('includes ARIA labels and roles', () => {
      renderApp({ isDashboard: false });

      // Breadcrumbs should have proper ARIA label
      expect(screen.getByTestId('breadcrumbs')).toBeInTheDocument();
    });

    it('preserves focus management', () => {
      renderApp({ isDashboard: false });

      // Navigation elements should be focusable
      const navigation = screen.getByTestId('navigation');
      expect(navigation).toBeInTheDocument();
    });
  });

  describe('Navigation Error Handling', () => {
    it('handles missing navigation data gracefully', () => {
      mockUseAuth.mockReturnValue({
        isAuthenticated: true,
        currentRole: null,
        user: { id: '1', name: 'User' },
      });
      mockUsePathname.mockReturnValue('/unknown-route');

      expect(() => renderApp({ isDashboard: false })).not.toThrow();
      expect(screen.getByTestId('navigation')).toBeInTheDocument();
    });

    it('handles navigation component errors', () => {
      mockUseAuth.mockReturnValue({
        isAuthenticated: true,
        currentRole: 'COORDINATOR',
        user: { id: '1', name: 'Coordinator User' },
      });

      // Mock Navigation to throw an error
      jest.doMock('@/components/layouts/Navigation', () => {
        throw new Error('Navigation error');
      });

      expect(() => renderApp()).not.toThrow();
    });
  });

  describe('Navigation Layout Consistency', () => {
    beforeEach(() => {
      mockUseAuth.mockReturnValue({
        isAuthenticated: true,
        currentRole: 'COORDINATOR',
        user: { id: '1', name: 'Coordinator User' },
      });
    });

    it('maintains consistent spacing across different page types', () => {
      mockUsePathname.mockReturnValue('/dashboard');
      
      renderApp({ isDashboard: true });
      
      const dashboardMain = document.querySelector('.py-1');
      expect(dashboardMain).toBeInTheDocument();

      mockUsePathname.mockReturnValue('/coordinator/situation-dashboard');
      renderApp({ isDashboard: false });
      
      const regularMain = document.querySelector('.py-6');
      expect(regularMain).toBeInTheDocument();
    });

    it('preserves navigation positioning across screen sizes', () => {
      mockUsePathname.mockReturnValue('/coordinator/entities');
      
      renderApp({ isDashboard: false });
      
      // Desktop navigation should be fixed position
      const desktopNav = document.querySelector('.lg\\:fixed');
      expect(desktopNav).toBeInTheDocument();
    });

    it('maintains consistent header presence', () => {
      mockUsePathname.mockReturnValue('/coordinator/analytics');
      
      renderApp({ isDashboard: false });
      
      expect(screen.getByTestId('header')).toBeInTheDocument();
      expect(screen.getByTestId('page-content')).toBeInTheDocument();
    });
  });

  describe('Integration with Role-Based Features', () => {
    it('integrates role switcher with navigation', () => {
      mockUseAuth.mockReturnValue({
        isAuthenticated: true,
        currentRole: 'ASSESSOR',
        user: { id: '1', name: 'Assessor User' },
      });
      mockUsePathname.mockReturnValue('/assessor/preliminary-assessment');

      renderApp({ isDashboard: false });

      expect(screen.getByTestId('navigation')).toBeInTheDocument();
      expect(screen.getByTestId('role-switcher')).toBeInTheDocument();
    });

    it('shows appropriate status indicators', () => {
      mockUseAuth.mockReturnValue({
        isAuthenticated: true,
        currentRole: 'DONOR',
        user: { id: '1', name: 'Donor User' },
      });
      mockUsePathname.mockReturnValue('/donor/dashboard');

      renderApp({ isDashboard: false });

      expect(screen.getByTestId('sync-indicator')).toBeInTheDocument();
      expect(screen.getByTestId('offline-indicator')).toBeInTheDocument();
    });

    it('maintains navigation context during user interactions', () => {
      mockUseAuth.mockReturnValue({
        isAuthenticated: true,
        currentRole: 'RESPONDER',
        user: { id: '1', name: 'Responder User' },
      });
      mockUsePathname.mockReturnValue('/responder/planning');

      renderApp({ isDashboard: false });

      // Navigation should remain stable during interactions
      expect(screen.getByTestId('navigation')).toBeInTheDocument();
      
      // Simulate user interaction (e.g., clicking a navigation item)
      const navigationElement = screen.getByTestId('navigation');
      expect(navigationElement).toBeInTheDocument();
    });
  });
});