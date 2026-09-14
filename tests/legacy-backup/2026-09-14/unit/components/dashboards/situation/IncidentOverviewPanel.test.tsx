import React from 'react';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock the entire dashboard to focus on API integration
jest.mock('@/stores/dashboardLayout.store', () => ({
  useIncidentSelection: () => ({
    selectedIncidentId: 'test-incident-1',
    incidentHistory: ['test-incident-1'],
    realTimeUpdates: false
  }),
  useIncidentActions: () => ({
    setSelectedIncident: jest.fn(),
    addToIncidentHistory: jest.fn(),
    clearIncidentHistory: jest.fn(),
    setRealTimeUpdates: jest.fn()
  }),
}));

// Mock all sub-components to isolate API testing
jest.mock('@/components/dashboards/situation/components/IncidentSelector', () => ({
  default: () => <div data-testid="incident-selector">Incident Selector</div>,
}));

jest.mock('@/components/dashboards/situation/components/IncidentSummary', () => ({
  default: () => <div data-testid="incident-summary">Incident Summary</div>,
}));

jest.mock('@/components/dashboards/situation/components/PopulationImpact', () => ({
  default: () => <div data-testid="population-impact">Population Impact</div>,
}));

jest.mock('@/components/dashboards/situation/components/AggregateMetrics', () => ({
  default: () => <div data-testid="aggregate-metrics">Aggregate Metrics</div>,
}));

// Mock fetch for API calls
global.fetch = jest.fn();

describe('IncidentOverviewPanel', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const mockDashboardData = {
    incidents: [
      {
        id: 'test-incident-1',
        type: 'FLOOD',
        subType: 'Flash Flood',
        status: 'ACTIVE',
        severity: 'HIGH',
        description: 'Test flood incident',
        location: 'Test Location',
        createdAt: '2025-01-15T10:00:00Z',
        updatedAt: '2025-01-15T12:00:00Z',
      }
    ],
    selectedIncident: {
      incident: {
        id: 'test-incident-1',
        type: 'FLOOD',
        subType: 'Flash Flood',
        status: 'ACTIVE',
        severity: 'HIGH',
        description: 'Test flood incident',
        location: 'Test Location',
        createdAt: '2025-01-15T10:00:00Z',
        updatedAt: '2025-01-15T12:00:00Z',
      },
      populationImpact: {
        totalPopulation: 15000,
        totalHouseholds: 3000,
        aggregatedLivesLost: 5,
        aggregatedInjured: 120,
        aggregatedDisplaced: 500,
      },
      aggregateMetrics: {
        affectedEntitiesCount: 25,
        totalAssessmentsCount: 89,
        verifiedAssessmentsCount: 67,
        responsesCount: 45,
      },
    },
  };

  it('renders without crashing when API call succeeds', async () => {
    // Mock successful API response
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, data: mockDashboardData })
    });

    // Dynamic import to avoid hoisting issues
    const { default: IncidentOverviewPanel } = await import('@/components/dashboards/situation/IncidentOverviewPanel');

    expect(() => 
      render(
        <QueryClientProvider client={queryClient}>
          <IncidentOverviewPanel incidentId="test-incident-1" />
        </QueryClientProvider>
      )
    ).not.toThrow();
  });

  it('renders without crashing when API call fails', async () => {
    // Mock failed API response
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error'
    });

    const { default: IncidentOverviewPanel } = await import('@/components/dashboards/situation/IncidentOverviewPanel');

    expect(() => 
      render(
        <QueryClientProvider client={queryClient}>
          <IncidentOverviewPanel incidentId="test-incident-1" />
        </QueryClientProvider>
      )
    ).not.toThrow();
  });

  it('renders without crashing when no incident selected', async () => {
    // Mock response with no selected incident
    const noIncidentData = { ...mockDashboardData, selectedIncident: undefined };
    
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, data: noIncidentData })
    });

    const { default: IncidentOverviewPanel } = await import('@/components/dashboards/situation/IncidentOverviewPanel');

    expect(() => 
      render(
        <QueryClientProvider client={queryClient}>
          <IncidentOverviewPanel incidentId={undefined} />
        </QueryClientProvider>
      )
    ).not.toThrow();
  });

  it('makes correct API call with incidentId parameter', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, data: mockDashboardData })
    });

    const { default: IncidentOverviewPanel } = await import('@/components/dashboards/situation/IncidentOverviewPanel');

    render(
      <QueryClientProvider client={queryClient}>
        <IncidentOverviewPanel incidentId="test-incident-123" />
      </QueryClientProvider>
    );

    // Wait for API call to be made
    await new Promise(resolve => setTimeout(resolve, 100));

    // Verify fetch was called with correct parameters
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/dashboard/situation?incidentId=test-incident-123')
    );
  });
});