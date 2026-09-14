import { describe, it, expect, beforeEach } from '@jest/globals';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { VerificationQueue } from '@/components/verification/VerificationQueue';
import type { VerificationQueueItem } from '@/types/verification';

// Mock the hooks
jest.mock('@/hooks/useVerification', () => ({
  useVerificationQueue: jest.fn()
}));

// Mock lucide-react icons
jest.mock('lucide-react', () => ({
  ChevronDown: ({ className }: { className?: string }) => <div data-testid="chevron-down" className={className} />,
  ChevronUp: ({ className }: { className?: string }) => <div data-testid="chevron-up" className={className} />,
  RefreshCw: ({ className }: { className?: string }) => <div data-testid="refresh-icon" className={className} />,
  Search: ({ className }: { className?: string }) => <div data-testid="search-icon" className={className} />,
  Filter: ({ className }: { className?: string }) => <div data-testid="filter-icon" className={className} />,
  AlertCircle: ({ className }: { className?: string }) => <div data-testid="alert-circle" className={className} />,
  FileText: ({ className }: { className?: string }) => <div data-testid="file-text" className={className} />
}));

import { useVerificationQueue } from '@/hooks/useVerification';

const mockUseVerificationQueue = useVerificationQueue as jest.Mock;

const mockAssessment: VerificationQueueItem = {
  id: 'assessment-1',
  rapidAssessmentType: 'HEALTH',
  rapidAssessmentDate: new Date('2024-01-15T10:00:00Z'),
  verificationStatus: 'SUBMITTED',
  priority: 'HIGH',
  entity: {
    id: 'entity-1',
    name: 'Test Health Center',
    type: 'HEALTH_FACILITY',
    location: 'Test Location'
  },
  assessor: {
    id: 'assessor-1',
    name: 'John Assessor',
    email: 'assessor@test.com'
  },
  createdAt: new Date('2024-01-15T09:00:00Z'),
  updatedAt: new Date('2024-01-15T09:30:00Z')
};

const mockQueueData = {
  data: [mockAssessment],
  pagination: {
    page: 1,
    limit: 10,
    total: 1,
    totalPages: 1
  }
};

function TestWrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
}

describe('VerificationQueue', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders empty state when no assessments', () => {
    mockUseVerificationQueue.mockReturnValue({
      data: { data: [], pagination: { total: 0 } },
      isLoading: false,
      error: null,
      refetch: jest.fn()
    });

    render(
      <TestWrapper>
        <VerificationQueue onAssessmentSelect={jest.fn()} />
      </TestWrapper>
    );

    expect(screen.getByText('No assessments pending verification')).toBeInTheDocument();
    expect(screen.getByTestId('file-text')).toBeInTheDocument();
  });

  it('renders loading state', () => {
    mockUseVerificationQueue.mockReturnValue({
      data: null,
      isLoading: true,
      error: null,
      refetch: jest.fn()
    });

    render(
      <TestWrapper>
        <VerificationQueue onAssessmentSelect={jest.fn()} />
      </TestWrapper>
    );

    expect(screen.getByText('Loading verification queue...')).toBeInTheDocument();
  });

  it('renders error state', () => {
    const mockError = new Error('Failed to load queue');
    mockUseVerificationQueue.mockReturnValue({
      data: null,
      isLoading: false,
      error: mockError,
      refetch: jest.fn()
    });

    render(
      <TestWrapper>
        <VerificationQueue onAssessmentSelect={jest.fn()} />
      </TestWrapper>
    );

    expect(screen.getByText('Error loading verification queue')).toBeInTheDocument();
    expect(screen.getByTestId('alert-circle')).toBeInTheDocument();
  });

  it('renders assessment list correctly', () => {
    mockUseVerificationQueue.mockReturnValue({
      data: mockQueueData,
      isLoading: false,
      error: null,
      refetch: jest.fn()
    });

    render(
      <TestWrapper>
        <VerificationQueue onAssessmentSelect={jest.fn()} />
      </TestWrapper>
    );

    expect(screen.getByText('Test Health Center')).toBeInTheDocument();
    expect(screen.getByText('HEALTH')).toBeInTheDocument();
    expect(screen.getByText('John Assessor')).toBeInTheDocument();
    expect(screen.getByText('HIGH')).toBeInTheDocument();
  });

  it('handles assessment selection', () => {
    const mockOnSelect = jest.fn();
    mockUseVerificationQueue.mockReturnValue({
      data: mockQueueData,
      isLoading: false,
      error: null,
      refetch: jest.fn()
    });

    render(
      <TestWrapper>
        <VerificationQueue onAssessmentSelect={mockOnSelect} />
      </TestWrapper>
    );

    const assessmentRow = screen.getByText('Test Health Center').closest('[data-testid="assessment-row"]');
    expect(assessmentRow).toBeInTheDocument();

    fireEvent.click(assessmentRow!);
    expect(mockOnSelect).toHaveBeenCalledWith(mockAssessment);
  });

  it('expands assessment details when clicked', () => {
    mockUseVerificationQueue.mockReturnValue({
      data: mockQueueData,
      isLoading: false,
      error: null,
      refetch: jest.fn()
    });

    render(
      <TestWrapper>
        <VerificationQueue onAssessmentSelect={jest.fn()} />
      </TestWrapper>
    );

    const expandButton = screen.getByTestId('chevron-down');
    fireEvent.click(expandButton);

    expect(screen.getByText('assessor@test.com')).toBeInTheDocument();
    expect(screen.getByText('Test Location')).toBeInTheDocument();
  });

  it('filters assessments by status', async () => {
    const mockRefetch = jest.fn();
    mockUseVerificationQueue.mockReturnValue({
      data: mockQueueData,
      isLoading: false,
      error: null,
      refetch: mockRefetch
    });

    render(
      <TestWrapper>
        <VerificationQueue onAssessmentSelect={jest.fn()} />
      </TestWrapper>
    );

    const statusFilter = screen.getByDisplayValue('All Statuses');
    fireEvent.change(statusFilter, { target: { value: 'VERIFIED' } });

    await waitFor(() => {
      expect(mockRefetch).toHaveBeenCalled();
    });
  });

  it('searches assessments by entity name', async () => {
    const mockRefetch = jest.fn();
    mockUseVerificationQueue.mockReturnValue({
      data: mockQueueData,
      isLoading: false,
      error: null,
      refetch: mockRefetch
    });

    render(
      <TestWrapper>
        <VerificationQueue onAssessmentSelect={jest.fn()} />
      </TestWrapper>
    );

    const searchInput = screen.getByPlaceholderText('Search by entity name...');
    fireEvent.change(searchInput, { target: { value: 'Health Center' } });

    await waitFor(() => {
      expect(mockRefetch).toHaveBeenCalled();
    }, { timeout: 1500 }); // Account for 1 second debounce
  });

  it('handles pagination correctly', () => {
    const multiPageData = {
      data: [mockAssessment],
      pagination: {
        page: 1,
        limit: 10,
        total: 25,
        totalPages: 3
      }
    };

    mockUseVerificationQueue.mockReturnValue({
      data: multiPageData,
      isLoading: false,
      error: null,
      refetch: jest.fn()
    });

    render(
      <TestWrapper>
        <VerificationQueue onAssessmentSelect={jest.fn()} />
      </TestWrapper>
    );

    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument();
    expect(screen.getByText('25 total assessments')).toBeInTheDocument();
  });

  it('refreshes data when refresh button is clicked', () => {
    const mockRefetch = jest.fn();
    mockUseVerificationQueue.mockReturnValue({
      data: mockQueueData,
      isLoading: false,
      error: null,
      refetch: mockRefetch
    });

    render(
      <TestWrapper>
        <VerificationQueue onAssessmentSelect={jest.fn()} />
      </TestWrapper>
    );

    const refreshButton = screen.getByRole('button', { name: /refresh/i });
    fireEvent.click(refreshButton);

    expect(mockRefetch).toHaveBeenCalled();
  });

  it('highlights selected assessment', () => {
    mockUseVerificationQueue.mockReturnValue({
      data: mockQueueData,
      isLoading: false,
      error: null,
      refetch: jest.fn()
    });

    render(
      <TestWrapper>
        <VerificationQueue 
          onAssessmentSelect={jest.fn()} 
          selectedAssessmentId="assessment-1"
        />
      </TestWrapper>
    );

    const assessmentRow = screen.getByText('Test Health Center').closest('[data-testid="assessment-row"]');
    expect(assessmentRow).toHaveClass('ring-2', 'ring-blue-500');
  });

  it('displays correct priority badge colors', () => {
    const criticalAssessment = {
      ...mockAssessment,
      priority: 'CRITICAL' as const
    };

    mockUseVerificationQueue.mockReturnValue({
      data: { 
        data: [criticalAssessment], 
        pagination: mockQueueData.pagination 
      },
      isLoading: false,
      error: null,
      refetch: jest.fn()
    });

    render(
      <TestWrapper>
        <VerificationQueue onAssessmentSelect={jest.fn()} />
      </TestWrapper>
    );

    const priorityBadge = screen.getByText('CRITICAL');
    expect(priorityBadge).toHaveClass('bg-red-100', 'text-red-800');
  });
});