import { render, screen } from '@testing-library/react';
import { usePathname } from 'next/navigation';
import { Breadcrumbs } from '@/components/shared/Breadcrumbs';

// Mock Next.js navigation
jest.mock('next/navigation', () => ({
  usePathname: jest.fn(),
}));

// Mock Lucide icons
jest.mock('lucide-react', () => ({
  Home: () => <div data-testid="home-icon" />,
  ChevronRight: () => <div data-testid="chevron-right-icon" />,
}));

describe('Breadcrumbs Component', () => {
  let mockUsePathname: jest.MockedFunction<typeof usePathname>;

  beforeEach(() => {
    mockUsePathname = usePathname as jest.MockedFunction<typeof usePathname>;
  });

  const renderComponent = (props = {}) => {
    return render(<Breadcrumbs {...props} />);
  };

  describe('Basic Rendering', () => {
    it('does not render on dashboard root', () => {
      mockUsePathname.mockReturnValue('/dashboard');
      
      renderComponent();
      
      expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    });

    it('does not render on root path', () => {
      mockUsePathname.mockReturnValue('/');
      
      renderComponent();
      
      expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    });

    it('renders for sub-pages', () => {
      mockUsePathname.mockReturnValue('/coordinator/situation-dashboard');
      
      renderComponent();
      
      expect(screen.getByRole('navigation')).toBeInTheDocument();
      expect(screen.getByLabelText('Breadcrumb')).toBeInTheDocument();
    });

    it('includes home icon link to dashboard', () => {
      mockUsePathname.mockReturnValue('/coordinator/situation-dashboard');
      
      renderComponent();
      
      expect(screen.getByTestId('home-icon')).toBeInTheDocument();
      const homeLink = screen.getByTestId('home-icon').closest('a');
      expect(homeLink).toHaveAttribute('href', '/dashboard');
    });
  });

  describe('Coordinator Routes', () => {
    it('renders situation dashboard breadcrumbs', () => {
      mockUsePathname.mockReturnValue('/coordinator/situation-dashboard');
      
      renderComponent();
      
      expect(screen.getByText('Dashboard')).toBeInTheDocument();
      expect(screen.getByText('Situation Awareness')).toBeInTheDocument();
    });

    it('renders entity management breadcrumbs', () => {
      mockUsePathname.mockReturnValue('/coordinator/entities');
      
      renderComponent();
      
      expect(screen.getByText('Dashboard')).toBeInTheDocument();
      expect(screen.getByText('Entity Management')).toBeInTheDocument();
    });

    it('renders incidents breadcrumbs', () => {
      mockUsePathname.mockReturnValue('/coordinator/incidents');
      
      renderComponent();
      
      expect(screen.getByText('Dashboard')).toBeInTheDocument();
      expect(screen.getByText('Incidents')).toBeInTheDocument();
    });

    it('renders analytics breadcrumbs', () => {
      mockUsePathname.mockReturnValue('/coordinator/analytics');
      
      renderComponent();
      
      expect(screen.getByText('Dashboard')).toBeInTheDocument();
      expect(screen.getByText('Analytics')).toBeInTheDocument();
    });

    it('renders settings breadcrumbs', () => {
      mockUsePathname.mockReturnValue('/coordinator/settings');
      
      renderComponent();
      
      expect(screen.getByText('Dashboard')).toBeInTheDocument();
      expect(screen.getByText('Settings')).toBeInTheDocument();
    });
  });

  describe('Assessor Routes', () => {
    it('renders preliminary assessment breadcrumbs', () => {
      mockUsePathname.mockReturnValue('/assessor/preliminary-assessment');
      
      renderComponent();
      
      expect(screen.getByText('Dashboard')).toBeInTheDocument();
      expect(screen.getByText('Assessments')).toBeInTheDocument();
      expect(screen.getByText('Preliminary')).toBeInTheDocument();
    });

    it('renders rapid assessments breadcrumbs', () => {
      mockUsePathname.mockReturnValue('/rapid-assessments');
      
      renderComponent();
      
      expect(screen.getByText('Dashboard')).toBeInTheDocument();
      expect(screen.getByText('Assessments')).toBeInTheDocument();
      expect(screen.getByText('Rapid')).toBeInTheDocument();
    });

    it('renders my assessments breadcrumbs', () => {
      mockUsePathname.mockReturnValue('/assessments/my');
      
      renderComponent();
      
      expect(screen.getByText('Dashboard')).toBeInTheDocument();
      expect(screen.getByText('Assessments')).toBeInTheDocument();
      expect(screen.getByText('My Assessments')).toBeInTheDocument();
    });

    it('renders assessor reports breadcrumbs', () => {
      mockUsePathname.mockReturnValue('/assessor/reports');
      
      renderComponent();
      
      expect(screen.getByText('Dashboard')).toBeInTheDocument();
      expect(screen.getByText('Reports')).toBeInTheDocument();
    });
  });

  describe('Responder Routes', () => {
    it('renders response planning breadcrumbs', () => {
      mockUsePathname.mockReturnValue('/responder/planning');
      
      renderComponent();
      
      expect(screen.getByText('Dashboard')).toBeInTheDocument();
      expect(screen.getByText('Response Planning')).toBeInTheDocument();
    });

    it('renders create response breadcrumbs', () => {
      mockUsePathname.mockReturnValue('/responder/planning/new');
      
      renderComponent();
      
      expect(screen.getByText('Dashboard')).toBeInTheDocument();
      expect(screen.getByText('Response Planning')).toBeInTheDocument();
      expect(screen.getByText('Create Response')).toBeInTheDocument();
    });

    it('renders my responses breadcrumbs', () => {
      mockUsePathname.mockReturnValue('/responder/responses');
      
      renderComponent();
      
      expect(screen.getByText('Dashboard')).toBeInTheDocument();
      expect(screen.getByText('Response Planning')).toBeInTheDocument();
      expect(screen.getByText('My Responses')).toBeInTheDocument();
    });

    it('renders resources breadcrumbs', () => {
      mockUsePathname.mockReturnValue('/responder/resources');
      
      renderComponent();
      
      expect(screen.getByText('Dashboard')).toBeInTheDocument();
      expect(screen.getByText('Resources')).toBeInTheDocument();
    });
  });

  describe('Donor Routes', () => {
    it('renders donor dashboard breadcrumbs', () => {
      mockUsePathname.mockReturnValue('/donor/dashboard');
      
      renderComponent();
      
      expect(screen.getByText('Dashboard')).toBeInTheDocument();
      expect(screen.getByText('Donor Dashboard')).toBeInTheDocument();
    });

    it('renders assigned entities breadcrumbs', () => {
      mockUsePathname.mockReturnValue('/donor/entities');
      
      renderComponent();
      
      expect(screen.getByText('Dashboard')).toBeInTheDocument();
      expect(screen.getByText('Assigned Entities')).toBeInTheDocument();
    });

    it('renders donor performance breadcrumbs', () => {
      mockUsePathname.mockReturnValue('/donor/performance');
      
      renderComponent();
      
      expect(screen.getByText('Dashboard')).toBeInTheDocument();
      expect(screen.getByText('Performance')).toBeInTheDocument();
    });

    it('renders achievements breadcrumbs', () => {
      mockUsePathname.mockReturnValue('/donor/performance?tab=achievements');
      
      renderComponent();
      
      expect(screen.getByText('Dashboard')).toBeInTheDocument();
      expect(screen.getByText('Performance')).toBeInTheDocument();
      expect(screen.getByText('Achievements')).toBeInTheDocument();
    });

    it('renders leaderboard breadcrumbs', () => {
      mockUsePathname.mockReturnValue('/donor/leaderboard');
      
      renderComponent();
      
      expect(screen.getByText('Dashboard')).toBeInTheDocument();
      expect(screen.getByText('Leaderboard')).toBeInTheDocument();
    });
  });

  describe('Admin Routes', () => {
    it('renders user management breadcrumbs', () => {
      mockUsePathname.mockReturnValue('/users');
      
      renderComponent();
      
      expect(screen.getByText('Dashboard')).toBeInTheDocument();
      expect(screen.getByText('User Management')).toBeInTheDocument();
    });

    it('renders add user breadcrumbs', () => {
      mockUsePathname.mockReturnValue('/users/new');
      
      renderComponent();
      
      expect(screen.getByText('Dashboard')).toBeInTheDocument();
      expect(screen.getByText('User Management')).toBeInTheDocument();
      expect(screen.getByText('Add User')).toBeInTheDocument();
    });

    it('renders role management breadcrumbs', () => {
      mockUsePathname.mockReturnValue('/roles');
      
      renderComponent();
      
      expect(screen.getByText('Dashboard')).toBeInTheDocument();
      expect(screen.getByText('User Management')).toBeInTheDocument();
      expect(screen.getByText('Role Management')).toBeInTheDocument();
    });

    it('renders system settings breadcrumbs', () => {
      mockUsePathname.mockReturnValue('/system/settings');
      
      renderComponent();
      
      expect(screen.getByText('Dashboard')).toBeInTheDocument();
      expect(screen.getByText('System')).toBeInTheDocument();
      expect(screen.getByText('Settings')).toBeInTheDocument();
    });
  });

  describe('Dynamic Route Handling', () => {
    it('handles export functions query parameter', () => {
      mockUsePathname.mockReturnValue('/coordinator/dashboard?tab=exports');
      
      renderComponent();
      
      expect(screen.getByText('Dashboard')).toBeInTheDocument();
      expect(screen.getByText('Settings')).toBeInTheDocument();
      expect(screen.getByText('Export Functions')).toBeInTheDocument();
    });

    it('handles report builder query parameter', () => {
      mockUsePathname.mockReturnValue('/coordinator/dashboard?tab=reports');
      
      renderComponent();
      
      expect(screen.getByText('Dashboard')).toBeInTheDocument();
      expect(screen.getByText('Settings')).toBeInTheDocument();
      expect(screen.getByText('Report Builder')).toBeInTheDocument();
    });

    it('handles commitments query parameter', () => {
      mockUsePathname.mockReturnValue('/donor/dashboard?tab=commitments');
      
      renderComponent();
      
      expect(screen.getByText('Dashboard')).toBeInTheDocument();
      expect(screen.getByText('Donor Dashboard')).toBeInTheDocument();
      expect(screen.getByText('Manage Commitments')).toBeInTheDocument();
    });

    it('handles new commitment action parameter', () => {
      mockUsePathname.mockReturnValue('/donor/dashboard?action=new-commitment');
      
      renderComponent();
      
      expect(screen.getByText('Dashboard')).toBeInTheDocument();
      expect(screen.getByText('Donor Dashboard')).toBeInTheDocument();
      expect(screen.getByText('New Commitment')).toBeInTheDocument();
    });

    it('generates fallback breadcrumbs for unregistered routes', () => {
      mockUsePathname.mockReturnValue('/unregistered/path');
      
      renderComponent();
      
      expect(screen.getByText('Dashboard')).toBeInTheDocument();
      expect(screen.getByText('Unregistered')).toBeInTheDocument();
    });

    it('handles complex unregistered routes', () => {
      mockUsePathname.mockReturnValue('/very/complex/unregistered/route/path');
      
      renderComponent();
      
      expect(screen.getByText('Dashboard')).toBeInTheDocument();
      expect(screen.getByText('Very/complex/unregistered/route/path')).toBeInTheDocument();
    });

    it('does not render for API routes', () => {
      mockUsePathname.mockReturnValue('/api/v1/assessments');
      
      renderComponent();
      
      expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    });

    it('generates simple fallback for single segment paths', () => {
      mockUsePathname.mockReturnValue('/simple');
      
      renderComponent();
      
      expect(screen.getByText('Dashboard')).toBeInTheDocument();
      expect(screen.getByText('Simple')).toBeInTheDocument();
    });
  });

  describe('Component Behavior', () => {
    it('applies correct ARIA attributes', () => {
      mockUsePathname.mockReturnValue('/coordinator/situation-dashboard');
      
      renderComponent();
      
      expect(screen.getByLabelText('Breadcrumb')).toBeInTheDocument();
    });

    it('includes chevron separators', () => {
      mockUsePathname.mockReturnValue('/coordinator/situation-dashboard');
      
      renderComponent();
      
      const chevronIcons = screen.getAllByTestId('chevron-right-icon');
      expect(chevronIcons.length).toBeGreaterThan(0);
    });

    it('marks last item as current page', () => {
      mockUsePathname.mockReturnValue('/coordinator/situation-dashboard');
      
      renderComponent();
      
      const currentPage = screen.getByText('Situation Awareness');
      expect(currentPage).toHaveAttribute('aria-current', 'page');
    });

    it('renders links for intermediate items', () => {
      mockUsePathname.mockReturnValue('/coordinator/situation-dashboard');
      
      renderComponent();
      
      const dashboardLink = screen.getByText('Dashboard');
      expect(dashboardLink.closest('a')).toHaveAttribute('href', '/dashboard');
    });

    it('handles custom className prop', () => {
      mockUsePathname.mockReturnValue('/coordinator/situation-dashboard');
      
      renderComponent({ className: 'custom-class' });
      
      const nav = screen.getByRole('navigation');
      expect(nav).toHaveClass('custom-class');
    });
  });

  describe('Edge Cases', () => {
    it('handles empty pathname', () => {
      mockUsePathname.mockReturnValue('');
      
      renderComponent();
      
      expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    });

    it('handles undefined pathname gracefully', () => {
      mockUsePathname.mockReturnValue(undefined as any);
      
      expect(() => {
        try {
          renderComponent();
        } catch (error) {
          // Should not throw a fatal error
          expect(error.message).not.toContain('Cannot read properties of undefined');
        }
      }).not.toThrow();
    });

    it('handles very long routes', () => {
      mockUsePathname.mockReturnValue('/a/very/long/path/with/many/segments');
      
      renderComponent();
      
      expect(screen.getByText('Dashboard')).toBeInTheDocument();
      expect(screen.getByText('Very/long/path/with/many/segments')).toBeInTheDocument();
    });
  });
});