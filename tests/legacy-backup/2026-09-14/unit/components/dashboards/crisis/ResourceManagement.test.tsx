import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock all UI components and dependencies before importing the component
jest.mock('@/components/ui/select', () => ({
  Select: ({ children, onValueChange }: any) => <div onChange={onValueChange}>{children}</div>,
  SelectTrigger: ({ children, ...props }: any) => <button {...props}>{children}</button>,
  SelectValue: ({ placeholder }: { placeholder: string }) => <span>{placeholder}</span>,
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children, value, onSelect }: any) => (
    <div onClick={() => onSelect && onSelect(value)}>{children}</div>
  ),
}));

jest.mock('@/components/ui/input', () => ({
  Input: ({ className, ...props }: any) => <input className={className} {...props} />,
}));

jest.mock('@/components/ui/tabs', () => ({
  Tabs: ({ children, onValueChange, value }: any) => <div data-value={value} onChange={onValueChange}>{children}</div>,
  TabsList: ({ children }: any) => <div>{children}</div>,
  TabsTrigger: ({ children, value }: any) => <button data-value={value}>{children}</button>,
  TabsContent: ({ children, value }: any) => <div data-content={value}>{children}</div>,
}));

jest.mock('@/components/ui/progress', () => ({
  Progress: ({ value, className }: any) => (
    <div className={className} data-progress={value}>
      <div style={{ width: `${value}%` }} />
    </div>
  ),
}));

jest.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, open, onOpenChange }: any) => open ? <div onClick={() => onOpenChange(false)}>{children}</div> : null,
  DialogTrigger: ({ children }: any) => children,
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h3>{children}</h3>,
  DialogDescription: ({ children }: any) => <p>{children}</p>,
}));

jest.mock('@/components/ui/label', () => ({
  Label: ({ children, htmlFor }: any) => <label htmlFor={htmlFor}>{children}</label>,
}));

jest.mock('@/components/ui/textarea', () => ({
  Textarea: ({ className, ...props }: any) => <textarea className={className} {...props} />,
}));

jest.mock('@/components/donor/EntityDonorAssignment', () => ({
  EntityDonorAssignment: ({ className }: any) => (
    <div className={className} data-testid="entity-donor-assignment">
      Entity Donor Assignment Component
    </div>
  ),
}));

jest.mock('@/components/dashboards/crisis/ResourceGapAnalysis', () => ({
  ResourceGapAnalysis: ({ className }: any) => (
    <div className={className} data-testid="resource-gap-analysis">
      Resource Gap Analysis Component
    </div>
  ),
}));

jest.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    token: 'mock-token',
    user: { id: 'test-user', name: 'Test User' },
    currentRole: 'COORDINATOR'
  })
}));

jest.mock('lucide-react', () => ({
  Users: ({ className }: any) => <div className={className} data-testid="users-icon" />,
  Package: ({ className }: any) => <div className={className} data-testid="package-icon" />,
  TrendingUp: ({ className }: any) => <div className={className} data-testid="trending-up-icon" />,
  DollarSign: ({ className }: any) => <div className={className} data-testid="dollar-sign-icon" />,
  Clock: ({ className }: any) => <div className={className} data-testid="clock-icon" />,
  CheckCircle2: ({ className }: any) => <div className={className} data-testid="check-circle-icon" />,
  Truck: ({ className }: any) => <div className={className} data-testid="truck-icon" />,
  XCircle: ({ className }: any) => <div className={className} data-testid="x-circle-icon" />,
  AlertTriangle: ({ className }: any) => <div className={className} data-testid="alert-triangle-icon" />,
  Search: ({ className }: any) => <div className={className} data-testid="search-icon" />,
  Filter: ({ className }: any) => <div className={className} data-testid="filter-icon" />,
  RefreshCw: ({ className }: any) => <div className={className} data-testid="refresh-icon" />,
  BarChart3: ({ className }: any) => <div className={className} data-testid="bar-chart-icon" />,
  Target: ({ className }: any) => <div className={className} data-testid="target-icon" />,
  ArrowUpRight: ({ className }: any) => <div className={className} data-testid="arrow-up-right-icon" />,
  ArrowDownRight: ({ className }: any) => <div className={className} data-testid="arrow-down-right-icon" />,
  Eye: ({ className }: any) => <div className={className} data-testid="eye-icon" />,
  Edit: ({ className }: any) => <div className={className} data-testid="edit-icon" />,
}));

// Import the component after all mocks are set up
import { ResourceManagement } from '@/components/dashboards/crisis/ResourceManagement';

describe('ResourceManagement', () => {
  let queryClient: QueryClient;
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    user = userEvent.setup();
    
    // Mock fetch globally
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  const renderComponent = (props = {}) => {
    return render(
      <QueryClientProvider client={queryClient}>
        <ResourceManagement {...props} />
      </QueryClientProvider>
    );
  };

  it('renders resource management header correctly', () => {
    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, data: {} })
    }).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, data: { data: [], pagination: {} } })
    }).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, data: { criticalGaps: [] } })
    });

    renderComponent();
    
    expect(screen.getByText('Resource & Donation Management')).toBeInTheDocument();
    expect(screen.getByText('Monitor donor commitments, track delivery progress, and identify resource gaps')).toBeInTheDocument();
  });

  it('displays statistics cards when data is loaded', async () => {
    const mockStats = {
      totalCommitments: 25,
      totalValue: 150000,
      totalCommittedQuantity: 1000,
      totalDeliveredQuantity: 750,
      averageDeliveryRate: 75,
      responseDeliveryRate: 60,
      deliveredResponses: 6,
      totalResponsePlans: 10,
      byStatus: { PLANNED: 10, PARTIAL: 8, COMPLETE: 7 },
      criticalGaps: 3
    };

    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, data: mockStats })
    }).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, data: { data: [], pagination: {} } })
    }).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, data: { criticalGaps: [] } })
    });

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('25')).toBeInTheDocument(); // Total Commitments
      expect(screen.getByText('60%')).toBeInTheDocument(); // Response Delivery Rate
      expect(screen.getByText('10 planned')).toBeInTheDocument(); // Active Donors
      expect(screen.getByText('0')).toBeInTheDocument(); // Critical Gaps
    });
  });

  it('displays critical gaps alert when gaps exist', async () => {
    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, data: {} })
    }).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, data: { data: [], pagination: {} } })
    }).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ 
        success: true, 
        data: { 
          criticalGaps: [
            { resource: 'Water', unmetNeed: 500, severity: 'HIGH' },
            { resource: 'Food', unmetNeed: 200, severity: 'MEDIUM' }
          ] 
        } 
      })
    });

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText(/2 critical resource gap\(s\) identified/)).toBeInTheDocument();
      expect(screen.getByText('Review the Gap Analysis tab for details and recommended actions.')).toBeInTheDocument();
    });
  });

  it('renders tabs correctly', () => {
    (fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: {} })
    });

    renderComponent();
    
    expect(screen.getByText('Donation Overview')).toBeInTheDocument();
    expect(screen.getByText('Entity Assignments')).toBeInTheDocument();
    expect(screen.getByText('Gap Analysis')).toBeInTheDocument();
  });

  it('handles filter search input', async () => {
    (fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: {} })
    });

    renderComponent();
    
    const searchInput = screen.getByPlaceholderText('Search commitments...');
    expect(searchInput).toBeInTheDocument();
    
    await user.type(searchInput, 'test search');
    
    expect(searchInput).toHaveValue('test search');
  });

  it('displays commitments when data is available', async () => {
    const mockCommitments = {
      data: [
        {
          id: '1',
          donor: { name: 'Test Donor', type: 'ORGANIZATION' },
          entity: { name: 'Test Entity', type: 'FACILITY' },
          incident: { type: 'FLOOD', severity: 'HIGH' },
          status: 'PLANNED',
          items: [{ name: 'Water', unit: 'liters', quantity: 100 }],
          totalCommittedQuantity: 100,
          deliveredQuantity: 0,
          commitmentDate: '2024-01-01T00:00:00Z'
        }
      ],
      pagination: { page: 1, limit: 50, total: 1 }
    };

    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, data: {} })
    }).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, data: mockCommitments })
    }).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, data: { criticalGaps: [] } })
    });

    renderComponent();

    await waitFor(() => {
      expect(screen.getAllByText('100 liters of Water')).toHaveLength(2); // Header and content
      expect(screen.getByText(/Test Donor/)).toBeInTheDocument();
      expect(screen.getByText(/Test Entity/)).toBeInTheDocument();
      expect(screen.getByText('PLANNED')).toBeInTheDocument();
    });
  });

  it('displays empty state when no commitments found', async () => {
    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, data: {} })
    }).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, data: { data: [], pagination: {} } })
    }).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, data: { criticalGaps: [] } })
    });

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('No commitments found')).toBeInTheDocument();
      expect(screen.getByText('No commitments match the current filters.')).toBeInTheDocument();
    });
  });

  it('handles API errors gracefully', async () => {
    (fetch as jest.Mock).mockRejectedValue(new Error('API Error'));

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Failed to load resource management data. Please try again later.')).toBeInTheDocument();
    });
  });

  it('refreshes data when refresh button is clicked', async () => {
    (fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: {} })
    });

    renderComponent();
    
    // Wait for initial load to complete
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledTimes(3); // Initial load (3 calls)
    });
    
    const refreshButton = screen.getByText('Refresh');
    expect(refreshButton).toBeInTheDocument();
    
    await user.click(refreshButton);
    
    // Verify fetch was called again for refresh
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledTimes(6); // Initial 3 + refresh 3
    });
  });
});

/**
 * TEST NOTES:
 * - ResourceManagement component uses real API calls via TanStack Query
 * - UI components are mocked to avoid dependency on Radix UI implementation
 * - Auth hook is mocked to provide authentication token
 * - Tests verify proper rendering, state management, and user interactions
 * - Error handling is tested for API failures
 */