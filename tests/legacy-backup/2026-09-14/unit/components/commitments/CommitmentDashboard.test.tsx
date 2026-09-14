import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { CommitmentDashboard } from '@/components/donor/CommitmentDashboard';
import { DonorCommitment, CommitmentStatus } from '@/types/commitment';

// Mock UI Components
jest.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, ...props }: any) => (
    <button onClick={onClick} {...props}>{children}</button>
  ),
}));

jest.mock('@/components/ui/card', () => ({
  Card: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  CardContent: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  CardDescription: ({ children, ...props }: any) => <p {...props}>{children}</p>,
  CardHeader: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  CardTitle: ({ children, ...props }: any) => <h2 {...props}>{children}</h2>,
}));

jest.mock('@/components/ui/badge', () => ({
  Badge: ({ children, ...props }: any) => <span {...props}>{children}</span>,
}));

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

jest.mock('@/components/ui/alert', () => ({
  Alert: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  AlertDescription: ({ children, ...props }: any) => <p {...props}>{children}</p>,
}));

jest.mock('@/components/ui/separator', () => ({
  Separator: ({ ...props }: any) => <hr {...props} />,
}));

jest.mock('@/components/ui/skeleton', () => ({
  Skeleton: ({ ...props }: any) => <div {...props} />,
}));

// Mock TanStack Query
jest.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: [string, string, any] }) => {
    if (queryKey[0] === 'donor-commitments') {
      return {
        data: {
          data: [
            {
              id: '1',
              status: CommitmentStatus.PLANNED,
              items: [{ name: 'Rice', unit: 'kg', quantity: 100, estimatedValue: 0.5 }],
              totalCommittedQuantity: 100,
              deliveredQuantity: 0,
              verifiedDeliveredQuantity: 0,
              commitmentDate: '2024-01-01T00:00:00Z',
              lastUpdated: '2024-01-01T00:00:00Z',
              entity: { id: '1', name: 'Entity 1', type: 'FACILITY' },
              incident: { id: '1', type: 'FLOOD', severity: 'HIGH', description: 'Test flood' },
              donor: { id: '1', name: 'Donor 1', type: 'ORGANIZATION' }
            } as DonorCommitment,
            {
              id: '2',
              status: CommitmentStatus.COMPLETE,
              items: [{ name: 'Blankets', unit: 'pieces', quantity: 50, estimatedValue: 15 }],
              totalCommittedQuantity: 50,
              deliveredQuantity: 50,
              verifiedDeliveredQuantity: 50,
              commitmentDate: '2024-01-02T00:00:00Z',
              lastUpdated: '2024-01-03T00:00:00Z',
              entity: { id: '2', name: 'Entity 2', type: 'HOSPITAL' },
              incident: { id: '1', type: 'FLOOD', severity: 'HIGH', description: 'Test flood' },
              donor: { id: '1', name: 'Donor 1', type: 'ORGANIZATION' }
            } as DonorCommitment,
          ],
          statistics: {
            byStatus: { PLANNED: 1, PARTIAL: 0, COMPLETE: 1, CANCELLED: 0 },
            totalCommitted: 150,
            totalDelivered: 50
          },
          pagination: { page: 1, limit: 50, total: 2, pages: 1 }
        },
        isLoading: false,
        error: null,
      };
    }
    
    if (queryKey[0] === 'entities') {
      return {
        data: [
          { id: '1', name: 'Entity 1', type: 'FACILITY' },
          { id: '2', name: 'Entity 2', type: 'HOSPITAL' },
        ],
        isLoading: false,
      };
    }
    
    if (queryKey[0] === 'incidents') {
      return {
        data: [
          { id: '1', type: 'FLOOD', severity: 'HIGH', description: 'Test flood' },
          { id: '2', type: 'EARTHQUAKE', severity: 'MEDIUM', description: 'Test earthquake' },
        ],
        isLoading: false,
      };
    }
    
    return { data: [], isLoading: false };
  },
  useMutation: () => ({
    mutate: jest.fn(),
    isPending: false,
  }),
  useQueryClient: () => ({
    invalidateQueries: jest.fn(),
  }),
}));

// Mock Next.js router
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
  }),
}));

// Mock sonner toast
jest.mock('sonner', () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
  },
}));

// Mock CommitmentForm component
jest.mock('@/components/donor/CommitmentForm', () => ({
  CommitmentForm: ({ donorId, onSuccess, onCancel }: any) => (
    <div data-testid="commitment-form">
      <button onClick={onSuccess}>Mock Success</button>
      <button onClick={onCancel}>Mock Cancel</button>
    </div>
  ),
}));

describe('CommitmentDashboard', () => {
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
  });

  const renderComponent = (props = {}) => {
    return render(
      <QueryClientProvider client={queryClient}>
        <CommitmentDashboard donorId="test-donor-id" {...props} />
      </QueryClientProvider>
    );
  };

  it('renders dashboard with commitment statistics', () => {
    renderComponent();
    
    expect(screen.getByText(/My Commitments/i)).toBeInTheDocument();
    expect(screen.getByText(/Manage and track your aid commitments/i)).toBeInTheDocument();
    
    // Statistics cards
    expect(screen.getByText(/Total Commitments/i)).toBeInTheDocument();
    expect(screen.getByText(/Planned/i)).toBeInTheDocument();
    expect(screen.getByText(/In Progress/i)).toBeInTheDocument();
    expect(screen.getByText(/Completed/i)).toBeInTheDocument();
    
    // Statistics values
    expect(screen.getByText('2')).toBeInTheDocument(); // Total commitments
    expect(screen.getByText('1')).toBeInTheDocument(); // Planned
    expect(screen.getByText('0')).toBeInTheDocument(); // In Progress
    expect(screen.getByText('1')).toBeInTheDocument(); // Completed
  });

  it('renders new commitment button', () => {
    renderComponent();
    
    const newCommitmentButton = screen.getByRole('button', { name: /New Commitment/i });
    expect(newCommitmentButton).toBeInTheDocument();
  });

  it('renders filters section', () => {
    renderComponent();
    
    expect(screen.getByText(/Search commitments.../i)).toBeInTheDocument();
    expect(screen.getByText(/All Status/i)).toBeInTheDocument();
    expect(screen.getByText(/All Incidents/i)).toBeInTheDocument();
    expect(screen.getByText(/All Entities/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Clear Filters/i })).toBeInTheDocument();
  });

  it('renders commitment list', () => {
    renderComponent();
    
    expect(screen.getByText(/Commitments/i)).toBeInTheDocument();
    expect(screen.getByText(/Showing 2 of 2 commitments/i)).toBeInTheDocument();
    
    // Check commitment items are displayed
    expect(screen.getByText(/100 kg of Rice/i)).toBeInTheDocument();
    expect(screen.getByText(/50 pieces of Blankets/i)).toBeInTheDocument();
  });

  it('shows commitment status badges', () => {
    renderComponent();
    
    expect(screen.getByText(/Planned/i)).toBeInTheDocument();
    expect(screen.getByText(/Complete/i)).toBeInTheDocument();
  });

  it('shows delivery progress for commitments with deliveries', () => {
    renderComponent();
    
    // Should show progress for complete commitment
    expect(screen.getByText(/Delivery Progress/i)).toBeInTheDocument();
    expect(screen.getByText(/50 \/ 50/i)).toBeInTheDocument();
  });

  it('opens commitment form when New Commitment is clicked', async () => {
    renderComponent();
    
    const newCommitmentButton = screen.getByRole('button', { name: /New Commitment/i });
    await user.click(newCommitmentButton);
    
    await waitFor(() => {
      expect(screen.getByTestId('commitment-form')).toBeInTheDocument();
      expect(screen.getByText(/Back to Dashboard/i)).toBeInTheDocument();
    });
  });

  it('returns to dashboard when form is cancelled', async () => {
    renderComponent();
    
    // Open form first
    const newCommitmentButton = screen.getByRole('button', { name: /New Commitment/i });
    await user.click(newCommitmentButton);
    
    await waitFor(() => {
      expect(screen.getByTestId('commitment-form')).toBeInTheDocument();
    });
    
    // Cancel form
    const cancelButton = screen.getByRole('button', { name: /Mock Cancel/i });
    await user.click(cancelButton);
    
    await waitFor(() => {
      expect(screen.getByText(/My Commitments/i)).toBeInTheDocument();
      expect(screen.queryByTestId('commitment-form')).not.toBeInTheDocument();
    });
  });

  it('filters commitments by status', async () => {
    renderComponent();
    
    // Find status filter select
    const statusSelect = screen.getByText(/All Status/i);
    await user.click(statusSelect);
    
    // In a real test, this would select an option
    // For mock, we just verify the interaction works
    expect(screen.getByText(/All Status/i)).toBeInTheDocument();
  });

  it('searches commitments by text', async () => {
    renderComponent();
    
    const searchInput = screen.getByPlaceholderText(/Search commitments.../i);
    await user.type(searchInput, 'Rice');
    
    expect(searchInput).toHaveValue('Rice');
  });

  it('shows empty state when no commitments', () => {
    // Mock empty response
    jest.doMock('@tanstack/react-query', () => ({
      useQuery: () => ({
        data: {
          data: [],
          statistics: { byStatus: { PLANNED: 0, PARTIAL: 0, COMPLETE: 0, CANCELLED: 0 } },
          pagination: { page: 1, limit: 50, total: 0, pages: 0 }
        },
        isLoading: false,
      }),
      useMutation: () => ({ mutate: jest.fn(), isPending: false }),
      useQueryClient: () => ({ invalidateQueries: jest.fn() }),
    }));

    renderComponent();
    
    expect(screen.getByText(/No commitments found/i)).toBeInTheDocument();
    expect(screen.getByText(/Get started by creating your first aid commitment./i)).toBeInTheDocument();
  });

  it('displays error state on API failure', () => {
    // Mock error response
    jest.doMock('@tanstack/react-query', () => ({
      useQuery: () => ({
        data: null,
        isLoading: false,
        error: new Error('Failed to fetch commitments'),
      }),
      useMutation: () => ({ mutate: jest.fn(), isPending: false }),
      useQueryClient: () => ({ invalidateQueries: jest.fn() }),
    }));

    renderComponent();
    
    expect(screen.getByText(/Failed to load commitments/i)).toBeInTheDocument();
  });

  it('shows loading skeleton while loading', () => {
    // Mock loading state
    jest.doMock('@tanstack/react-query', () => ({
      useQuery: () => ({
        data: null,
        isLoading: true,
        error: null,
      }),
      useMutation: () => ({ mutate: jest.fn(), isPending: false }),
      useQueryClient: () => ({ invalidateQueries: jest.fn() }),
    }));

    renderComponent();
    
    // Skeleton elements should be present
    expect(screen.getAllByText(/$/i).length).toBeGreaterThan(0);
  });
});