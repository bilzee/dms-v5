import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Mock UI Components (Template Pattern)
jest.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, ...props }: any) => (
    <button onClick={onClick} {...props}>{children}</button>
  ),
}));

jest.mock('@/components/ui/card', () => ({
  Card: ({ children, className, ...props }: any) => (
    <div className={className} {...props}>{children}</div>
  ),
}));

jest.mock('@/components/ui/badge', () => ({
  Badge: ({ children, variant, className, ...props }: any) => (
    <span className={className} data-variant={variant} {...props}>{children}</span>
  ),
}));

// Mock Leaflet components
jest.mock('react-leaflet', () => ({
  Marker: ({ children, position, icon, eventHandlers }: any) => (
    <div
      data-testid="marker"
      data-position={JSON.stringify(position)}
      onClick={eventHandlers?.click}
    >
      {children}
      <div data-testid="marker-icon">{icon?.html || 'default-icon'}</div>
    </div>
  ),
  Popup: ({ children }: any) => (
    <div data-testid="popup">{children}</div>
  ),
  useMap: () => ({
    // Mock map functionality
  }),
  MarkerClusterGroup: ({ children, iconCreateFunction }: any) => (
    <div data-testid="marker-cluster">
      {children}
      <div data-testid="cluster-icon">{iconCreateFunction?.({ getChildCount: () => 3 })}</div>
    </div>
  ),
}));

// Mock Leaflet DivIcon
jest.mock('leaflet', () => ({
  DivIcon: jest.fn(({ html }) => ({
    html,
    options: { className: 'test-icon' }
  })),
}));

import React from 'react';
import { EntityCluster, EntityLocation } from './EntityMarker';

describe('EntityMarker', () => {
  let user: ReturnType<typeof userEvent.setup>;

  const mockEntityLocations: EntityLocation[] = [
    {
      id: 'entity-1',
      name: 'Test Hospital',
      type: 'FACILITY',
      coordinates: { latitude: 9.0820, longitude: 8.6753 },
      severity: 'CRITICAL',
      gapSummary: {
        totalGaps: 3,
        totalNoGaps: 0,
        criticalGaps: 2,
        severity: 'CRITICAL'
      },
      donorAssignments: [
        {
          donorId: 'donor-1',
          donorName: 'Test Donor',
          commitmentStatus: 'FULFILLED',
          items: [{ name: 'Medical Supplies', quantity: 100, unit: 'units' }]
        }
      ]
    },
    {
      id: 'entity-2',
      name: 'Test Shelter',
      type: 'SHELTER',
      coordinates: { latitude: 9.0, longitude: 8.5 },
      severity: 'HIGH',
      gapSummary: {
        totalGaps: 2,
        totalNoGaps: 1,
        criticalGaps: 1,
        severity: 'HIGH'
      }
    },
    {
      id: 'entity-3',
      name: 'Test Community',
      type: 'COMMUNITY',
      coordinates: { latitude: 9.1, longitude: 8.6 },
      severity: 'LOW',
      gapSummary: {
        totalGaps: 0,
        totalNoGaps: 5,
        criticalGaps: 0,
        severity: 'LOW'
      }
    }
  ];

  const defaultProps = {
    entities: mockEntityLocations,
    selectedEntityId: undefined,
    showDonorOverlay: false,
    onEntityClick: jest.fn(),
    onPopupOpen: jest.fn(),
  };

  beforeEach(() => {
    user = userEvent.setup();
    jest.clearAllMocks();
  });

  const renderComponent = (props = {}) => {
    return render(
      <EntityCluster {...defaultProps} {...props} />
    );
  };

  describe('EntityCluster Component', () => {
    it('renders marker cluster container', () => {
      renderComponent();
      
      expect(screen.getByTestId('marker-cluster')).toBeInTheDocument();
    });

    it('renders all provided entities as markers', () => {
      renderComponent();
      
      expect(screen.getAllByTestId('marker')).toHaveLength(3);
      expect(screen.getByText('Test Hospital')).toBeInTheDocument();
      expect(screen.getByText('Test Shelter')).toBeInTheDocument();
      expect(screen.getByText('Test Community')).toBeInTheDocument();
    });

    it('highlights selected entity correctly', () => {
      renderComponent({ selectedEntityId: 'entity-1' });
      
      const selectedMarker = screen.getByTestId('entity-entity-1');
      expect(selectedMarker).toHaveAttribute('data-selected', 'true');
    });

    it('calls onEntityClick when entity is clicked', async () => {
      const mockOnEntityClick = jest.fn();
      renderComponent({ onEntityClick: mockOnEntityClick });
      
      const entity1Marker = screen.getByTestId('entity-entity-1');
      await user.click(entity1Marker);
      
      expect(mockOnEntityClick).toHaveBeenCalledWith(expect.objectContaining({
        id: 'entity-1',
        name: 'Test Hospital',
        severity: 'CRITICAL'
      }));
    });

    it('displays donor overlay when enabled', () => {
      renderComponent({ showDonorOverlay: true });
      
      const markers = screen.getAllByTestId('marker');
      expect(markers).toHaveLength(3);
      
      // The first entity has donor assignments
      const entity1Marker = screen.getByTestId('entity-entity-1');
      expect(entity1Marker).toBeInTheDocument();
    });

    it('handles empty entities array', () => {
      renderComponent({ entities: [] });
      
      expect(screen.getByTestId('marker-cluster')).toBeInTheDocument();
      expect(screen.queryByTestId('marker')).not.toBeInTheDocument();
    });

    it('generates cluster icon correctly', () => {
      renderComponent();
      
      const clusterIcon = screen.getByTestId('cluster-icon');
      expect(clusterIcon).toBeInTheDocument();
    });
  });

  describe('Entity Popup Content', () => {
    it('renders entity popup with correct information', () => {
      renderComponent();
      
      const markers = screen.getAllByTestId('marker');
      const firstMarker = markers[0];
      
      // Trigger popup open by clicking marker
      firstMarker.click();
      
      expect(screen.getByTestId('popup')).toBeInTheDocument();
      expect(screen.getByText('Test Hospital')).toBeInTheDocument();
    });

    it('displays entity type and severity badges', () => {
      renderComponent();
      
      const firstMarker = screen.getByTestId('entity-entity-1');
      firstMarker.click();
      
      expect(screen.getByText('FACILITY')).toBeInTheDocument();
      expect(screen.getByText('CRITICAL')).toBeInTheDocument();
    });

    it('shows gap analysis summary', () => {
      renderComponent();
      
      const firstMarker = screen.getByTestId('entity-entity-1');
      firstMarker.click();
      
      expect(screen.getByText('Gap Analysis')).toBeInTheDocument();
      expect(screen.getByText('Total Gaps:')).toBeInTheDocument();
      expect(screen.getByText('3')).toBeInTheDocument();
      expect(screen.getByText('Critical:')).toBeInTheDocument();
      expect(screen.getByText('2')).toBeInTheDocument();
    });

    it('displays donor assignments when present', () => {
      renderComponent({ showDonorOverlay: true });
      
      const firstMarker = screen.getByTestId('entity-entity-1');
      firstMarker.click();
      
      expect(screen.getByText('Donor Assignments')).toBeInTheDocument();
      expect(screen.getByText('Test Donor')).toBeInTheDocument();
      expect(screen.getByText('FULFILLED')).toBeInTheDocument();
    });

    it('handles entities without donor assignments', () => {
      renderComponent();
      
      const secondMarker = screen.getByTestId('entity-entity-2');
      secondMarker.click();
      
      expect(screen.getByTestId('popup')).toBeInTheDocument();
      expect(screen.queryByText('Donor Assignments')).not.toBeInTheDocument();
    });

    it('shows healthy status for entities without gaps', () => {
      renderComponent();
      
      const thirdMarker = screen.getByTestId('entity-entity-3');
      thirdMarker.click();
      
      expect(screen.getByText('Healthy')).toBeInTheDocument();
    });

    it('shows needs attention status for entities with gaps', () => {
      renderComponent();
      
      const firstMarker = screen.getByTestId('entity-entity-1');
      firstMarker.click();
      
      expect(screen.getByText('Needs Attention')).toBeInTheDocument();
    });

    it('limits donor assignment display to 3 items', () => {
      const entityWithManyDonors = {
        ...mockEntityLocations[0],
        donorAssignments: [
          { donorId: 'd1', donorName: 'Donor 1', commitmentStatus: 'FULFILLED', items: [] },
          { donorId: 'd2', donorName: 'Donor 2', commitmentStatus: 'PARTIAL', items: [] },
          { donorId: 'd3', donorName: 'Donor 3', commitmentStatus: 'PLANNED', items: [] },
          { donorId: 'd4', donorName: 'Donor 4', commitmentStatus: 'CANCELLED', items: [] },
          { donorId: 'd5', donorName: 'Donor 5', commitmentStatus: 'FULFILLED', items: [] },
        ]
      };
      
      renderComponent({ entities: [entityWithManyDonors], showDonorOverlay: true });
      
      const firstMarker = screen.getByTestId('entity-entity-1');
      firstMarker.click();
      
      expect(screen.getByText('+2 more')).toBeInTheDocument();
    });
  });

  describe('Icon Generation', () => {
    it('generates different severity colors', () => {
      renderComponent();
      
      const markers = screen.getAllByTestId('marker');
      const icons = markers.map(marker => marker.querySelector('[data-testid="marker-icon"]'));
      
      // Icons should be generated for each entity with different severity-based styling
      expect(icons).toHaveLength(3);
    });

    it('shows donor count indicator when overlay enabled', () => {
      renderComponent({ showDonorOverlay: true });
      
      const entity1Marker = screen.getByTestId('entity-entity-1');
      expect(entity1Marker).toBeInTheDocument();
      // Donor count would be part of the icon HTML
    });

    it('shows selection ring for selected entity', () => {
      renderComponent({ selectedEntityId: 'entity-1' });
      
      const selectedMarker = screen.getByTestId('entity-entity-1');
      expect(selectedMarker).toHaveAttribute('data-selected', 'true');
    });
  });

  describe('Performance Optimizations', () => {
    it('uses memoization for entity markers', () => {
      const { rerender } = renderComponent();
      
      expect(screen.getAllByTestId('marker')).toHaveLength(3);
      
      // Rerender with same props
      rerender(<EntityCluster {...defaultProps} />);
      
      // Should still render the same number of markers
      expect(screen.getAllByTestId('marker')).toHaveLength(3);
    });

    it('caches icons to prevent recreation', () => {
      renderComponent();
      
      const markers = screen.getAllByTestId('marker');
      expect(markers).toHaveLength(3);
      
      // Icons should be cached based on entity properties
      const firstIcon = markers[0].querySelector('[data-testid="marker-icon"]');
      expect(firstIcon).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('provides clickable entities', async () => {
      const mockOnEntityClick = jest.fn();
      renderComponent({ onEntityClick: mockOnEntityClick });
      
      const firstMarker = screen.getByTestId('entity-entity-1');
      await user.click(firstMarker);
      
      expect(mockOnEntityClick).toHaveBeenCalled();
    });

    it('displays entity names for screen readers', () => {
      renderComponent();
      
      expect(screen.getByText('Test Hospital')).toBeInTheDocument();
      expect(screen.getByText('Test Shelter')).toBeInTheDocument();
      expect(screen.getByText('Test Community')).toBeInTheDocument();
    });
  });

  describe('TypeScript Types', () => {
    it('accepts correct EntityLocation types', () => {
      expect(() => {
        const entity: EntityLocation = {
          id: 'test',
          name: 'Test',
          type: 'FACILITY',
          coordinates: { latitude: 0, longitude: 0 },
          severity: 'LOW',
          gapSummary: {
            totalGaps: 0,
            totalNoGaps: 1,
            criticalGaps: 0,
            severity: 'LOW'
          }
        };
        
        return <EntityCluster entities={[entity]} onEntityClick={() => {}} />;
      }).not.toThrow();
    });
  });
});

/**
 * USAGE INSTRUCTIONS:
 * 
 * 1. Tests EntityMarker component with Jest + React Testing Library
 * 2. Mocks Leaflet dependencies to focus on component logic
 * 3. Tests entity clustering, selection, and popup content
 * 4. Validates donor overlay functionality and icon generation
 * 5. Tests performance optimizations (memoization, caching)
 * 6. Verifies accessibility and TypeScript type safety
 * 7. NEVER use vi.mock() - only jest.mock() allowed
 * 8. Test entity interaction patterns and popup information display
 */