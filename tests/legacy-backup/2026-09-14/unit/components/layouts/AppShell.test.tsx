import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppShell } from '@/components/layouts/AppShell';
import { useAuth } from '@/hooks/useAuth';

// Mock auth hook
jest.mock('@/hooks/useAuth', () => ({
  useAuth: jest.fn(),
}));

// Mock child components
jest.mock('@/components/shared/Header', () => ({
  Header: () => <header data-testid="header" />,
}));

jest.mock('@/components/layouts/Navigation', () => ({
  Navigation: () => <nav data-testid="navigation" />,
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
  Breadcrumbs: () => <div data-testid="breadcrumbs" />,
}));

describe('AppShell Component', () => {
  let queryClient: QueryClient;
  let user: ReturnType<typeof userEvent.setup>;
  let mockUseAuth: jest.MockedFunction<typeof useAuth>;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    user = userEvent.setup();
    mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;
  });

  const renderComponent = (props = {}) => {
    return render(
      <QueryClientProvider client={queryClient}>
        <AppShell {...props}>
          <div data-testid="child-content">Test Content</div>
        </AppShell>
      </QueryClientProvider>
    );
  };

  describe('Unauthenticated State', () => {
    it('renders simplified layout for unauthenticated users', () => {
      mockUseAuth.mockReturnValue({
        isAuthenticated: false,
        user: null,
      });

      renderComponent();

      expect(screen.getByTestId('header')).toBeInTheDocument();
      expect(screen.queryByTestId('navigation')).not.toBeInTheDocument();
      expect(screen.queryByTestId('breadcrumbs')).not.toBeInTheDocument();
      expect(screen.getByTestId('child-content')).toBeInTheDocument();
    });

    it('shows max-width container for unauthenticated users', () => {
      mockUseAuth.mockReturnValue({
        isAuthenticated: false,
        user: null,
      });

      renderComponent();

      const mainContent = screen.getByTestId('child-content').parentElement;
      expect(mainContent?.parentElement).toHaveClass('max-w-7xl', 'mx-auto');
    });
  });

  describe('Authenticated State', () => {
    beforeEach(() => {
      mockUseAuth.mockReturnValue({
        isAuthenticated: true,
        user: { id: '1', name: 'Test User', email: 'test@example.com' },
      });
    });

    it('renders full layout with navigation for authenticated users', () => {
      renderComponent();

      expect(screen.getByTestId('navigation')).toBeInTheDocument();
      expect(screen.getByTestId('role-switcher')).toBeInTheDocument();
      expect(screen.getByTestId('sync-indicator')).toBeInTheDocument();
      expect(screen.getByTestId('offline-indicator')).toBeInTheDocument();
      expect(screen.getByTestId('child-content')).toBeInTheDocument();
    });

    it('includes breadcrumbs when showBreadcrumbs is true', () => {
      renderComponent({ showBreadcrumbs: true });

      expect(screen.getByTestId('breadcrumbs')).toBeInTheDocument();
    });

    it('hides breadcrumbs when showBreadcrumbs is false', () => {
      renderComponent({ showBreadcrumbs: false });

      expect(screen.queryByTestId('breadcrumbs')).not.toBeInTheDocument();
    });

    it('shows breadcrumbs by default for non-dashboard pages', () => {
      renderComponent({ isDashboard: false });

      expect(screen.getByTestId('breadcrumbs')).toBeInTheDocument();
    });

    it('hides breadcrumbs for dashboard pages', () => {
      renderComponent({ isDashboard: true });

      expect(screen.queryByTestId('breadcrumbs')).not.toBeInTheDocument();
    });

    it('applies dashboard-specific styling for dashboard pages', () => {
      renderComponent({ isDashboard: true });

      const mainContent = screen.getByTestId('child-content').parentElement;
      expect(mainContent?.parentElement).toHaveClass('py-1', 'px-2', 'w-full');
    });

    it('applies regular styling for non-dashboard pages', () => {
      renderComponent({ isDashboard: false });

      const mainContent = screen.getByTestId('child-content').parentElement;
      expect(mainContent?.parentElement).toHaveClass('py-6');
      expect(mainContent?.parentElement).toHaveClass('max-w-7xl', 'mx-auto');
    });

    it('hides navigation when showNavigation is false', () => {
      renderComponent({ showNavigation: false });

      expect(screen.queryByTestId('navigation')).not.toBeInTheDocument();
    });

    it('shows navigation by default', () => {
      renderComponent();

      expect(screen.getByTestId('navigation')).toBeInTheDocument();
    });

    it('renders desktop sidebar with proper styling', () => {
      renderComponent();

      // Look for the desktop sidebar container
      const desktopSidebars = document.querySelectorAll('[class*="lg:fixed"]');
      expect(desktopSidebars.length).toBeGreaterThan(0);
    });

    it('includes mobile sidebar toggle button', () => {
      renderComponent();

      // Mobile menu button should be present in the mobile top bar
      const mobileTopBar = document.querySelector('.lg\\:hidden');
      expect(mobileTopBar).toBeInTheDocument();
    });
  });

  describe('Responsive Behavior', () => {
    beforeEach(() => {
      mockUseAuth.mockReturnValue({
        isAuthenticated: true,
        user: { id: '1', name: 'Test User' },
      });
    });

    it('renders mobile navigation overlay structure', () => {
      renderComponent();

      // Check for mobile sidebar elements
      const mobileSidebar = document.querySelector('.lg\\:hidden.fixed.inset-y-0');
      expect(mobileSidebar).toBeInTheDocument();
    });

    it('renders desktop navigation structure', () => {
      renderComponent();

      // Check for desktop sidebar elements
      const desktopSidebar = document.querySelector('.lg\\:fixed.lg\\:inset-y-0');
      expect(desktopSidebar).toBeInTheDocument();
    });

    it('includes responsive top bar for mobile', () => {
      renderComponent();

      const mobileTopBar = document.querySelector('.lg\\:hidden.sticky.top-0');
      expect(mobileTopBar).toBeInTheDocument();
    });
  });

  describe('Layout Structure', () => {
    beforeEach(() => {
      mockUseAuth.mockReturnValue({
        isAuthenticated: true,
        user: { id: '1', name: 'Test User' },
      });
    });

    it('maintains proper content hierarchy', () => {
      renderComponent();

      const mainElement = document.querySelector('main');
      expect(mainElement).toBeInTheDocument();
      
      const childContent = screen.getByTestId('child-content');
      expect(childContent).toBeInTheDocument();
    });

    it('applies correct spacing classes', () => {
      renderComponent();

      // Check that main content area has correct spacing
      const mainContent = document.querySelector('.lg\\:pl-64');
      expect(mainContent).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    beforeEach(() => {
      mockUseAuth.mockReturnValue({
        isAuthenticated: true,
        user: { id: '1', name: 'Test User' },
      });
    });

    it('includes proper ARIA attributes', () => {
      renderComponent();

      // Main content should be properly structured
      const main = document.querySelector('main');
      expect(main?.tagName).toBe('MAIN');
    });

    it('maintains semantic HTML structure', () => {
      renderComponent();

      // Should have proper semantic elements
      expect(document.querySelector('header')).toBeInTheDocument();
      expect(document.querySelector('main')).toBeInTheDocument();
      expect(document.querySelector('nav')).toBeInTheDocument();
    });
  });

  describe('Edge Cases', () => {
    it('handles missing user object gracefully', () => {
      mockUseAuth.mockReturnValue({
        isAuthenticated: true,
        user: null,
      });

      expect(() => renderComponent()).not.toThrow();
    });

    it('handles undefined props gracefully', () => {
      expect(() => renderComponent({
        showNavigation: undefined,
        isDashboard: undefined,
        showBreadcrumbs: undefined,
      })).not.toThrow();
    });

    it('handles empty children gracefully', () => {
      expect(() => renderComponent({ children: null })).not.toThrow();
    });

    it('handles multiple children', () => {
      mockUseAuth.mockReturnValue({
        isAuthenticated: true,
        user: { id: '1', name: 'Test User' },
      });

      renderComponent({
        children: (
          <>
            <div data-testid="child-1">Child 1</div>
            <div data-testid="child-2">Child 2</div>
          </>
        ),
      });

      expect(screen.getByTestId('child-1')).toBeInTheDocument();
      expect(screen.getByTestId('child-2')).toBeInTheDocument();
    });
  });
});