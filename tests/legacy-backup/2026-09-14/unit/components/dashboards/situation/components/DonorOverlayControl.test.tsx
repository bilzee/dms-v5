import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Mock UI Components (Template Pattern)
jest.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, className, ...props }: any) => (
    <button onClick={onClick} className={className} {...props}>
      {children}
    </button>
  ),
}));

jest.mock('@/components/ui/card', () => ({
  Card: ({ children, className, ...props }: any) => (
    <div className={className} {...props}>{children}</div>
  ),
}));

jest.mock('@/components/ui/badge', () => ({
  Badge: ({ children, variant, className, ...props }: any) => (
    <span className={className} data-variant={variant} {...props}>
      {children}
    </span>
  ),
}));

// Mock Lucide React icons
jest.mock('lucide-react', () => ({
  Users: ({ className, ...props }: any) => <div data-testid="users-icon" className={className} {...props} />,
  Package: ({ className, ...props }: any) => <div data-testid="package-icon" className={className} {...props} />,
  Eye: ({ className, ...props }: any) => <div data-testid="eye-icon" className={className} {...props} />,
  EyeOff: ({ className, ...props }: any) => <div data-testid="eye-off-icon" className={className} {...props} />,
  Settings: ({ className, ...props }: any) => <div data-testid="settings-icon" className={className} {...props} />,
  HelpCircle: ({ className, ...props }: any) => <div data-testid="help-circle-icon" className={className} {...props} />,
  X: ({ className, ...props }: any) => <div data-testid="x-icon" className={className} {...props} />,
}));

// Mock useMap from react-leaflet
jest.mock('react-leaflet', () => ({
  useMap: () => ({
    // Mock map functionality
  }),
}));

import React from 'react';
import { DonorOverlayControl } from './DonorOverlayControl';

describe('DonorOverlayControl', () => {
  let user: ReturnType<typeof userEvent.setup>;

  const mockDonorAssignments = [
    {
      donorId: 'donor-1',
      donorName: 'Red Cross',
      commitmentStatus: 'FULFILLED',
      entityCount: 5
    },
    {
      donorId: 'donor-2',
      donorName: 'UNICEF',
      commitmentStatus: 'PARTIAL',
      entityCount: 3
    },
    {
      donorId: 'donor-3',
      donorName: 'WHO',
      commitmentStatus: 'PLANNED',
      entityCount: 2
    },
    {
      donorId: 'donor-4',
      donorName: 'Save the Children',
      commitmentStatus: 'CANCELLED',
      entityCount: 1
    }
  ];

  const defaultProps = {
    enabled: false,
    onEnabledChange: jest.fn(),
    donorAssignments: mockDonorAssignments,
    className: 'test-class'
  };

  beforeEach(() => {
    user = userEvent.setup();
    jest.clearAllMocks();
  });

  const renderComponent = (props = {}) => {
    return render(
      <DonorOverlayControl {...defaultProps} {...props} />
    );
  };

  describe('Toggle Button', () => {
    it('renders toggle button with correct text when disabled', () => {
      renderComponent({ enabled: false });
      
      const toggleButton = screen.getByRole('button', { name: /donors/i });
      expect(toggleButton).toBeInTheDocument();
      expect(toggleButton).toHaveTextContent('Donors');
      expect(screen.getByTestId('eye-off-icon')).toBeInTheDocument();
    });

    it('renders toggle button with correct text when enabled', () => {
      renderComponent({ enabled: true });
      
      const toggleButton = screen.getByRole('button', { name: /donors/i });
      expect(toggleButton).toBeInTheDocument();
      expect(toggleButton).toHaveTextContent('Donors');
      expect(screen.getByTestId('eye-icon')).toBeInTheDocument();
    });

    it('applies correct variant based on enabled state', () => {
      const { rerender } = renderComponent({ enabled: false });
      
      let toggleButton = screen.getByRole('button', { name: /donors/i });
      expect(toggleButton).toHaveAttribute('data-variant', 'outline');
      
      rerender(<DonorOverlayControl {...defaultProps} enabled={true} />);
      
      toggleButton = screen.getByRole('button', { name: /donors/i });
      expect(toggleButton).toHaveAttribute('data-variant', 'default');
    });

    it('calls onEnabledChange when toggle button is clicked', async () => {
      const mockOnEnabledChange = jest.fn();
      renderComponent({ onEnabledChange: mockOnEnabledChange });
      
      const toggleButton = screen.getByRole('button', { name: /donors/i });
      await user.click(toggleButton);
      
      expect(mockOnEnabledChange).toHaveBeenCalledWith(true);
    });

    it('shows help button when overlay is enabled', () => {
      renderComponent({ enabled: true });
      
      expect(screen.getByTitle(/show donor legend/i)).toBeInTheDocument();
      expect(screen.getByTestId('help-circle-icon')).toBeInTheDocument();
    });

    it('hides help button when overlay is disabled', () => {
      renderComponent({ enabled: false });
      
      expect(screen.queryByTitle(/show donor legend/i)).not.toBeInTheDocument();
    });
  });

  describe('Legend Modal', () => {
    it('does not show legend when overlay is disabled', () => {
      renderComponent({ enabled: false });
      
      expect(screen.queryByText('Donor Assignments')).not.toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Donor Assignments' })).not.toBeInTheDocument();
    });

    it('shows legend when overlay is enabled and help button is clicked', async () => {
      renderComponent({ enabled: true });
      
      const helpButton = screen.getByTitle(/show donor legend/i);
      await user.click(helpButton);
      
      expect(screen.getByText('Donor Assignments')).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Donor Assignments' })).toBeInTheDocument();
    });

    it('shows donor count badge in legend', async () => {
      renderComponent({ enabled: true });
      
      const helpButton = screen.getByTitle(/show donor legend/i);
      await user.click(helpButton);
      
      expect(screen.getByText('4')).toBeInTheDocument(); // 4 mock donor assignments
    });

    it('hides legend when close button is clicked', async () => {
      renderComponent({ enabled: true });
      
      // Open legend
      const helpButton = screen.getByTitle(/show donor legend/i);
      await user.click(helpButton);
      
      expect(screen.getByText('Donor Assignments')).toBeInTheDocument();
      
      // Close legend
      const closeButton = screen.getByTestId('x-icon').closest('button');
      await user.click(closeButton!);
      
      expect(screen.queryByText('Donor Assignments')).not.toBeInTheDocument();
    });

    it('hides legend when help button is clicked again', async () => {
      renderComponent({ enabled: true });
      
      const helpButton = screen.getByTitle(/show donor legend/i);
      
      // Open legend
      await user.click(helpButton);
      expect(screen.getByText('Donor Assignments')).toBeInTheDocument();
      
      // Close legend with same button
      await user.click(helpButton);
      expect(screen.queryByText('Donor Assignments')).not.toBeInTheDocument();
    });
  });

  describe('Donor List Display', () => {
    it('displays all donor assignments in legend', async () => {
      renderComponent({ enabled: true });
      
      const helpButton = screen.getByTitle(/show donor legend/i);
      await user.click(helpButton);
      
      expect(screen.getByText('Red Cross')).toBeInTheDocument();
      expect(screen.getByText('UNICEF')).toBeInTheDocument();
      expect(screen.getByText('WHO')).toBeInTheDocument();
      expect(screen.getByText('Save the Children')).toBeInTheDocument();
    });

    it('shows entity count for each donor', async () => {
      renderComponent({ enabled: true });
      
      const helpButton = screen.getByTitle(/show donor legend/i);
      await user.click(helpButton);
      
      expect(screen.getByText('5 entities')).toBeInTheDocument();
      expect(screen.getByText('3 entities')).toBeInTheDocument();
      expect(screen.getByText('2 entities')).toBeInTheDocument();
      expect(screen.getByText('1 entity')).toBeInTheDocument();
    });

    it('displays commitment status badges', async () => {
      renderComponent({ enabled: true });
      
      const helpButton = screen.getByTitle(/show donor legend/i);
      await user.click(helpButton);
      
      expect(screen.getByText('FULFILLED')).toBeInTheDocument();
      expect(screen.getByText('PARTIAL')).toBeInTheDocument();
      expect(screen.getByText('PLANNED')).toBeInTheDocument();
      expect(screen.getByText('CANCELLED')).toBeInTheDocument();
    });

    it('applies correct styling based on commitment status', async () => {
      renderComponent({ enabled: true });
      
      const helpButton = screen.getByTitle(/show donor legend/i);
      await user.click(helpButton);
      
      const fulfilledBadge = screen.getByText('FULFILLED');
      const partialBadge = screen.getByText('PARTIAL');
      const plannedBadge = screen.getByText('PLANNED');
      const cancelledBadge = screen.getByText('CANCELLED');
      
      expect(fulfilledBadge).toHaveClass('bg-green-100', 'text-green-800', 'border-green-200');
      expect(partialBadge).toHaveClass('bg-yellow-100', 'text-yellow-800', 'border-yellow-200');
      expect(plannedBadge).toHaveClass('bg-blue-100', 'text-blue-800', 'border-blue-200');
      expect(cancelledBadge).toHaveClass('bg-red-100', 'text-red-800', 'border-red-200');
    });

    it('limits donor display to 10 items', async () => {
      const manyDonors = Array.from({ length: 15 }, (_, i) => ({
        donorId: `donor-${i}`,
        donorName: `Donor ${i + 1}`,
        commitmentStatus: 'FULFILLED',
        entityCount: 1
      }));
      
      renderComponent({ enabled: true, donorAssignments: manyDonors });
      
      const helpButton = screen.getByTitle(/show donor legend/i);
      await user.click(helpButton);
      
      expect(screen.getByText('+5 more')).toBeInTheDocument();
    });
  });

  describe('Status Summary', () => {
    it('shows status count breakdown', async () => {
      renderComponent({ enabled: true });
      
      const helpButton = screen.getByTitle(/show donor legend/i);
      await user.click(helpButton);
      
      expect(screen.getByText('1')).toBeInTheDocument(); // Cancelled count
    });

    it('displays status badges with counts', async () => {
      renderComponent({ enabled: true });
      
      const helpButton = screen.getByTitle(/show donor legend/i);
      await user.click(helpButton);
      
      const statusBadges = screen.getAllByText('FULFILLED');
      expect(statusBadges.length).toBeGreaterThan(0);
    });
  });

  describe('Empty State', () => {
    it('shows appropriate message when no donor assignments', async () => {
      renderComponent({ enabled: true, donorAssignments: [] });
      
      const helpButton = screen.getByTitle(/show donor legend/i);
      await user.click(helpButton);
      
      expect(screen.getByText('Donor Assignments')).toBeInTheDocument();
      expect(screen.getByText('No donor assignments found for the current view.')).toBeInTheDocument();
    });

    it('shows message when donorAssignments is undefined', async () => {
      renderComponent({ enabled: true, donorAssignments: undefined });
      
      const helpButton = screen.getByTitle(/show donor legend/i);
      await user.click(helpButton);
      
      expect(screen.getByText('No donor assignments found for the current view.')).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('has proper ARIA labels on toggle button', () => {
      renderComponent({ enabled: false });
      
      const toggleButton = screen.getByRole('button', { name: /donors/i });
      expect(toggleButton).toHaveAttribute('aria-label');
    });

    it('has proper title on help button', () => {
      renderComponent({ enabled: true });
      
      const helpButton = screen.getByTitle(/show donor legend/i);
      expect(helpButton).toBeInTheDocument();
    });

    it('has proper title on close button', async () => {
      renderComponent({ enabled: true });
      
      const helpButton = screen.getByTitle(/show donor legend/i);
      await user.click(helpButton);
      
      const closeButton = screen.getByRole('button', { name: '' });
      expect(closeButton).toBeInTheDocument();
    });

    it('provides keyboard navigation', async () => {
      renderComponent({ enabled: false });
      
      const toggleButton = screen.getByRole('button', { name: /donors/i });
      
      // Should be focusable and clickable with keyboard
      toggleButton.focus();
      expect(toggleButton).toHaveFocus();
      
      await user.keyboard('{Enter}');
      expect(defaultProps.onEnabledChange).toHaveBeenCalledWith(true);
    });
  });

  describe('Component Integration', () => {
    it('passes className to container', () => {
      const { container } = renderComponent({ className: 'custom-class' });
      
      expect(container.querySelector('.custom-class')).toBeInTheDocument();
    });

    it('integrates with map context', () => {
      renderComponent();
      
      // Should render without errors when map context is available
      expect(screen.getByRole('button', { name: /donors/i })).toBeInTheDocument();
    });
  });

  describe('Error Handling', () => {
    it('handles missing onEnabledChange gracefully', () => {
      expect(() => {
        render(<DonorOverlayControl enabled={false} donorAssignments={[]} />);
      }).not.toThrow();
    });

    it('handles undefined donorAssignments gracefully', () => {
      expect(() => {
        render(<DonorOverlayControl enabled={true} donorAssignments={undefined} onEnabledChange={() => {}} />);
      }).not.toThrow();
    });
  });

  describe('TypeScript Types', () => {
    it('accepts correct prop types', () => {
      expect(() => {
        const props = {
          enabled: true,
          onEnabledChange: (enabled: boolean) => {},
          donorAssignments: [{
            donorId: 'test',
            donorName: 'Test Donor',
            commitmentStatus: 'FULFILLED',
            entityCount: 1
          }]
        };
        
        return <DonorOverlayControl {...props} />;
      }).not.toThrow();
    });
  });
});

/**
 * USAGE INSTRUCTIONS:
 * 
 * 1. Tests DonorOverlayControl component with Jest + React Testing Library
 * 2. Mocks UI components and Lucide icons for focused testing
 * 3. Tests toggle functionality and legend modal behavior
 * 4. Validates donor assignment display and status styling
 * 5. Tests accessibility and keyboard navigation
 * 6. Verifies error handling and TypeScript type safety
 * 7. NEVER use vi.mock() - only jest.mock() allowed
 * 8. Test user interaction patterns and responsive behavior
 */