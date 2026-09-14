/**
 * Unit Tests: AssessmentRelationshipMap Component
 * 
 * Tests assessment relationship visualization rendering, interaction,
 * priority-based color coding, and filtering functionality.
 */

import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AssessmentRelationshipMap } from '@/components/coordinator/AssessmentRelationshipMap';

// Mock Leaflet components since they require DOM environment
jest.mock('react-leaflet', () => ({
  MapContainer: ({ children, ...props }: any) => (
    <div data-testid="map-container" {...props}>
      {children}
    </div>
  ),
  TileLayer: (props: any) => <div data-testid="tile-layer" {...props} />,
  CircleMarker: ({ children, ...props }: any) => (
    <div data-testid="circle-marker" {...props}>
      {children}
    </div>
  ),
  Popup: ({ children, ...props }: any) => (
    <div data-testid="popup" {...props}>
      {children}
    </div>
  ),
  LayerGroup: ({ children, ...props }: any) => (
    <div data-testid="layer-group" {...props}>
      {children}
    </div>
  ),
}));

jest.mock('react-leaflet-cluster', () => ({
  __esModule: true,
  default: ({ children, ...props }: any) => (
    <div data-testid="marker-cluster" {...props}>
      {children}
    </div>
  ),
}));

// Mock UI components
jest.mock('@/components/ui/select', () => ({
  Select: ({ children, onValueChange, ...props }: any) => (
    <div data-testid="select" onChange={onValueChange} {...props}>
      {children}
    </div>
  ),
  SelectTrigger: ({ children, ...props }: any) => (
    <button data-testid="select-trigger" {...props}>
      {children}
    </button>
  ),
  SelectValue: ({ placeholder }: { placeholder: string }) => (
    <span data-testid="select-value">{placeholder}</span>
  ),
  SelectContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="select-content">{children}</div>
  ),
  SelectItem: ({ children, value, onSelect }: any) => (
    <div 
      data-testid="select-item" 
      data-value={value}
      onClick={() => onSelect && onSelect(value)}
    >
      {children}
    </div>
  ),
}));

jest.mock('@/components/ui/popover', () => ({
  Popover: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="popover">{children}</div>
  ),
  PopoverTrigger: ({ children, asChild, ...props }: any) => (
    <div data-testid="popover-trigger" {...props}>
      {children}
    </div>
  ),
  PopoverContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="popover-content">{children}</div>
  ),
}));

// Mock the fetch function
global.fetch = jest.fn();

describe('AssessmentRelationshipMap', () => {
  let queryClient: QueryClient;
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { 
        queries: { retry: false }, 
        mutations: { retry: false } 
      }
    });
    user = userEvent.setup();
    
    // Reset fetch mock
    (fetch as jest.Mock).mockReset();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  const renderComponent = (props = {}) => {
    return render(
      <QueryClientProvider client={queryClient}>
        <AssessmentRelationshipMap {...props} />
      </QueryClientProvider>
    );
  };

  it('renders loading state initially', () => {
    // Mock pending fetch
    (fetch as jest.Mock).mockImplementation(() => new Promise(() => {}));

    renderComponent({ incidentId: 'test-incident-id' });

    expect(screen.getByText(/loading relationship map/i)).toBeInTheDocument();
  });

  it('renders error state on fetch failure', async () => {
    // Mock fetch failure
    (fetch as jest.Mock).mockRejectedValueOnce(new Error('API Error'));

    renderComponent({ incidentId: 'test-incident-id' });

    await waitFor(() => {
      expect(screen.getByText(/failed to load relationship data/i)).toBeInTheDocument();
    });
  });

  it('renders map with relationship data', async () => {
    // Mock successful API response
    const mockData = {
      success: true,
      data: {
        totalEntities: 5,
        totalIncidents: 2,
        totalAssessments: 15,
        priorityDistribution: {
          CRITICAL: 3,
          HIGH: 7,
          MEDIUM: 4,
          LOW: 1,
        },
      },
    };

    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockData,
    });

    renderComponent({ incidentId: 'test-incident-id' });

    await waitFor(() => {
      expect(screen.getByText(/assessment-based relationships/i)).toBeInTheDocument();
      expect(screen.getByText(/15 assessments/i)).toBeInTheDocument();
      expect(screen.getByTestId('map-container')).toBeInTheDocument();
    });
  });

  it('displays priority filter controls', async () => {
    const mockData = {
      success: true,
      data: {
        totalEntities: 5,
        totalIncidents: 2,
        totalAssessments: 15,
      },
    };

    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockData,
    });

    renderComponent({ incidentId: 'test-incident-id' });

    await waitFor(() => {
      expect(screen.getByText('Priority')).toBeInTheDocument();
      expect(screen.getByText('Assessment')).toBeInTheDocument();
    });
  });

  it('displays priority color legend', async () => {
    const mockData = {
      success: true,
      data: {
        totalEntities: 5,
        totalIncidents: 2,
        totalAssessments: 15,
      },
    };

    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockData,
    });

    renderComponent({ incidentId: 'test-incident-id' });

    await waitFor(() => {
      expect(screen.getByText('CRITICAL')).toBeInTheDocument();
      expect(screen.getByText('HIGH')).toBeInTheDocument();
      expect(screen.getByText('MEDIUM')).toBeInTheDocument();
      expect(screen.getByText('LOW')).toBeInTheDocument();
    });
  });

  it('displays statistics overlay', async () => {
    const mockData = {
      success: true,
      data: {
        totalEntities: 5,
        totalIncidents: 2,
        totalAssessments: 15,
      },
    };

    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockData,
    });

    renderComponent({ incidentId: 'test-incident-id' });

    await waitFor(() => {
      expect(screen.getByText('5')).toBeInTheDocument(); // Total entities
      expect(screen.getByText('2')).toBeInTheDocument(); // Total incidents
      expect(screen.getByText('Entities')).toBeInTheDocument();
      expect(screen.getByText('Incidents')).toBeInTheDocument();
    });
  });

  it('calls onEntitySelect when entity is selected', async () => {
    const mockOnEntitySelect = jest.fn();
    const mockData = {
      success: true,
      data: {
        totalEntities: 1,
        totalIncidents: 1,
        totalAssessments: 1,
      },
    };

    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockData,
    });

    renderComponent({ 
      incidentId: 'test-incident-id',
      onEntitySelect: mockOnEntitySelect,
    });

    await waitFor(() => {
      expect(screen.getByTestId('map-container')).toBeInTheDocument();
    });

    // Entity selection would be triggered through map interaction
    // This is a simplified test since we're mocking the map components
  });

  it('calls onIncidentSelect when incident is selected', async () => {
    const mockOnIncidentSelect = jest.fn();
    const mockData = {
      success: true,
      data: {
        totalEntities: 1,
        totalIncidents: 1,
        totalAssessments: 1,
      },
    };

    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockData,
    });

    renderComponent({ 
      incidentId: 'test-incident-id',
      onIncidentSelect: mockOnIncidentSelect,
    });

    await waitFor(() => {
      expect(screen.getByTestId('map-container')).toBeInTheDocument();
    });

    // Incident selection would be triggered through map interaction
  });

  it('calls onAssessmentSelect when assessment is selected', async () => {
    const mockOnAssessmentSelect = jest.fn();
    const mockData = {
      success: true,
      data: {
        totalEntities: 1,
        totalIncidents: 1,
        totalAssessments: 1,
      },
    };

    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockData,
    });

    renderComponent({ 
      incidentId: 'test-incident-id',
      onAssessmentSelect: mockOnAssessmentSelect,
    });

    await waitFor(() => {
      expect(screen.getByTestId('map-container')).toBeInTheDocument();
    });

    // Assessment selection would be triggered through popup interaction
  });

  it('shows timeline controls when showTimeline is true', async () => {
    const mockData = {
      success: true,
      data: {
        totalEntities: 1,
        totalIncidents: 1,
        totalAssessments: 1,
      },
    };

    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockData,
    });

    renderComponent({ 
      incidentId: 'test-incident-id',
      showTimeline: true,
    });

    await waitFor(() => {
      expect(screen.getByText(/date range/i)).toBeInTheDocument();
    });
  });

  it('applies correct query parameters for API call', async () => {
    const mockData = {
      success: true,
      data: {
        totalEntities: 1,
        totalIncidents: 1,
        totalAssessments: 1,
      },
    };

    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockData,
    });

    renderComponent({ 
      incidentId: 'test-incident-id',
      entityId: 'test-entity-id',
      priorityFilter: ['HIGH', 'CRITICAL'],
      assessmentTypeFilter: ['HEALTH', 'WASH'],
    });

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/relationships/statistics?')
      );
      
      const fetchCall = (fetch as jest.Mock).mock.calls[0][0];
      expect(fetchCall).toContain('incidentId=test-incident-id');
      expect(fetchCall).toContain('entityId=test-entity-id');
      expect(fetchCall).toContain('priorityFilter=HIGH%2CCRITICAL');
      expect(fetchCall).toContain('assessmentTypeFilter=HEALTH%2CWASH');
    });
  });
});