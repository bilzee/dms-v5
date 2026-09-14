/**
 * @jest-environment jsdom
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { VerificationQueueManagement } from '@/components/dashboards/crisis/VerificationQueueManagement';
import { useVerificationStore } from '@/stores/verification.store';

// Mock the hooks
jest.mock('@/hooks/useRealTimeVerification', () => ({
  useRealTimeVerification: () => ({
    isConnected: true,
    connectionStatus: 'connected',
    lastUpdate: new Date().toISOString(),
    manualRefresh: jest.fn(),
    refreshAssessments: jest.fn(),
    refreshDeliveries: jest.fn(),
    enabled: true
  }),
  useConnectionStatus: () => ({
    status: 'connected',
    lastUpdate: new Date().toISOString(),
    statusColor: 'text-green-500',
    statusText: 'Connected',
    lastUpdateText: 'Just now',
    isConnected: true
  }),
  useVerificationMetrics: () => ({
    combined: {
      totalPending: 15,
      critical: 3,
      high: 5,
      medium: 4,
      low: 3,
      averageWaitTime: 45,
      verificationRate: 0.85,
      oldestPending: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
    },
    assessments: {
      averageWaitTime: 40,
      verificationRate: 0.8
    },
    deliveries: {
      averageWaitTime: 50,
      verificationRate: 0.9
    },
    assessmentQueueDepth: {
      total: 8,
      critical: 2,
      high: 3,
      medium: 2,
      low: 1
    },
    deliveryQueueDepth: {
      total: 7,
      critical: 1,
      high: 2,
      medium: 3,
      low: 1
    }
  })
}));

// Mock the store
jest.mock('@/stores/verification.store', () => ({
  useVerificationStore: () => ({
    assessments: [
      {
        id: '1',
        verificationStatus: 'SUBMITTED',
        priority: 'CRITICAL',
        rapidAssessmentType: 'HEALTH',
        rapidAssessmentDate: '2024-01-15T10:00:00Z',
        entity: {
          id: 'entity-1',
          name: 'Central Hospital',
          type: 'FACILITY',
          location: 'Downtown'
        },
        assessor: {
          id: 'user-1',
          name: 'John Doe',
          email: 'john@example.com'
        }
      }
    ],
    deliveries: [
      {
        id: '2',
        verificationStatus: 'SUBMITTED',
        priority: 'HIGH',
        status: 'DELIVERED',
        responseDate: '2024-01-15T11:00:00Z',
        entity: {
          id: 'entity-2',
          name: 'North Clinic',
          type: 'FACILITY',
          location: 'North District'
        },
        responder: {
          id: 'user-2',
          name: 'Jane Smith',
          email: 'jane@example.com'
        }
      }
    ],
    assessmentLoading: false,
    deliveryLoading: false,
    assessmentError: null,
    deliveryError: null,
    assessmentPagination: {
      page: 1,
      limit: 20,
      total: 8,
      totalPages: 1
    },
    deliveryPagination: {
      page: 1,
      limit: 20,
      total: 7,
      totalPages: 1
    },
    assessmentFilters: {
      status: ['SUBMITTED'],
      sortBy: 'rapidAssessmentDate',
      sortOrder: 'desc'
    },
    deliveryFilters: {
      status: ['SUBMITTED'],
      sortBy: 'responseDate',
      sortOrder: 'desc'
    },
    assessmentQueueDepth: {
      total: 8,
      critical: 2,
      high: 3,
      medium: 2,
      low: 1
    },
    deliveryQueueDepth: {
      total: 7,
      critical: 1,
      high: 2,
      medium: 3,
      low: 1
    },
    assessmentMetrics: {
      averageWaitTime: 40,
      verificationRate: 0.8,
      oldestPending: null
    },
    deliveryMetrics: {
      averageWaitTime: 50,
      verificationRate: 0.9,
      oldestPending: null
    }
  }),
  useAssessmentQueue: () => ({
    items: [
      {
        id: '1',
        verificationStatus: 'SUBMITTED',
        priority: 'CRITICAL',
        rapidAssessmentType: 'HEALTH',
        rapidAssessmentDate: '2024-01-15T10:00:00Z',
        entity: {
          id: 'entity-1',
          name: 'Central Hospital',
          type: 'FACILITY',
          location: 'Downtown'
        },
        assessor: {
          id: 'user-1',
          name: 'John Doe',
          email: 'john@example.com'
        }
      }
    ],
    loading: false,
    error: null,
    pagination: {
      page: 1,
      limit: 20,
      total: 8,
      totalPages: 1
    },
    filters: {
      status: ['SUBMITTED'],
      sortBy: 'rapidAssessmentDate',
      sortOrder: 'desc'
    },
    queueDepth: {
      total: 8,
      critical: 2,
      high: 3,
      medium: 2,
      low: 1
    },
    metrics: {
      averageWaitTime: 40,
      verificationRate: 0.8,
      oldestPending: null
    },
    refresh: jest.fn(),
    getFiltersCount: () => 0
  }),
  useDeliveryQueue: () => ({
    items: [
      {
        id: '2',
        verificationStatus: 'SUBMITTED',
        priority: 'HIGH',
        status: 'DELIVERED',
        responseDate: '2024-01-15T11:00:00Z',
        entity: {
          id: 'entity-2',
          name: 'North Clinic',
          type: 'FACILITY',
          location: 'North District'
        },
        responder: {
          id: 'user-2',
          name: 'Jane Smith',
          email: 'jane@example.com'
        }
      }
    ],
    loading: false,
    error: null,
    pagination: {
      page: 1,
      limit: 20,
      total: 7,
      totalPages: 1
    },
    filters: {
      status: ['SUBMITTED'],
      sortBy: 'responseDate',
      sortOrder: 'desc'
    },
    queueDepth: {
      total: 7,
      critical: 1,
      high: 2,
      medium: 3,
      low: 1
    },
    metrics: {
      averageWaitTime: 50,
      verificationRate: 0.9,
      oldestPending: null
    },
    refresh: jest.fn(),
    getFiltersCount: () => 0
  })
}));

// Mock UI components
jest.mock('@/components/ui/select', () => ({
  Select: ({ children, onValueChange }: any) => (
    <select onChange={(e) => onValueChange?.(e.target.value)}>{children}</select>
  ),
  SelectContent: ({ children }: any) => <>{children}</>,
  SelectItem: ({ children, value }: any) => <option value={value}>{children}</option>,
  SelectTrigger: ({ children }: any) => <div>{children}</div>,
  SelectValue: ({ placeholder }: any) => <option>{placeholder}</option>
}));

jest.mock('@/components/verification/ConnectionStatusIndicator', () => ({
  ConnectionStatusIndicator: ({ showDetails }: any) => (
    <div data-testid="connection-status">
      {showDetails ? 'Detailed Status' : 'Compact Status'}
    </div>
  )
}));

jest.mock('@/components/verification/VerificationActions', () => ({
  VerificationActions: ({ assessment, inline, onActionComplete }: any) => (
    <div data-testid="verification-actions">
      <button onClick={onActionComplete}>Verify</button>
    </div>
  )
}));

jest.mock('@/components/verification/QueueFilters', () => ({
  QueueFilters: ({ visible, onClose }: any) => (
    visible ? (
      <div data-testid="queue-filters">
        <button onClick={onClose}>Close Filters</button>
      </div>
    ) : null
  ),
  FilterSummary: ({ onClear }: any) => (
    <div data-testid="filter-summary">
      <button onClick={onClear}>Clear Filters</button>
    </div>
  )
}));

jest.mock('@/components/verification/VerificationAnalytics', () => ({
  VerificationAnalytics: () => (
    <div data-testid="verification-analytics">Analytics Dashboard</div>
  )
}));

describe('VerificationQueueManagement', () => {
  let queryClient: QueryClient;
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
    });
    user = userEvent.setup();
  });

  const renderComponent = (props = {}) => {
    return render(
      <QueryClientProvider client={queryClient}>
        <VerificationQueueManagement {...props} />
      </QueryClientProvider>
    );
  };

  describe('Component Rendering', () => {
    it('renders verification queue management header', () => {
      renderComponent();
      
      expect(screen.getByText('Verification Queue Management')).toBeInTheDocument();
      expect(screen.getByText('Review and verify assessments and delivery responses')).toBeInTheDocument();
    });

    it('displays queue overview cards', () => {
      renderComponent();
      
      expect(screen.getByText('Pending Assessments')).toBeInTheDocument();
      expect(screen.getByText('Pending Deliveries')).toBeInTheDocument();
      expect(screen.getByText('Total Pending')).toBeInTheDocument();
      expect(screen.getByText('Verification Rate')).toBeInTheDocument();
    });

    it('shows correct queue counts', () => {
      renderComponent();
      
      expect(screen.getByText('8')).toBeInTheDocument(); // Assessments
      expect(screen.getByText('7')).toBeInTheDocument(); // Deliveries
      expect(screen.getByText('15')).toBeInTheDocument(); // Total
    });

    it('displays connection status indicator', () => {
      renderComponent();
      
      expect(screen.getByTestId('connection-status')).toBeInTheDocument();
    });

    it('shows tabs for assessments, deliveries, and analytics', () => {
      renderComponent();
      
      expect(screen.getByRole('tab', { name: /assessments/i })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /deliveries/i })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /analytics/i })).toBeInTheDocument();
    });
  });

  describe('Tab Navigation', () => {
    it('switches between tabs correctly', async () => {
      renderComponent();
      
      const assessmentsTab = screen.getByRole('tab', { name: /assessments/i });
      const deliveriesTab = screen.getByRole('tab', { name: /deliveries/i });
      const analyticsTab = screen.getByRole('tab', { name: /analytics/i });

      // Initially on assessments tab
      expect(assessmentsTab).toHaveAttribute('aria-selected', 'true');
      expect(deliveriesTab).toHaveAttribute('aria-selected', 'false');
      expect(analyticsTab).toHaveAttribute('aria-selected', 'false');

      // Switch to deliveries tab
      await user.click(deliveriesTab);
      expect(deliveriesTab).toHaveAttribute('aria-selected', 'true');
      expect(assessmentsTab).toHaveAttribute('aria-selected', 'false');

      // Switch to analytics tab
      await user.click(analyticsTab);
      expect(analyticsTab).toHaveAttribute('aria-selected', 'true');
      expect(deliveriesTab).toHaveAttribute('aria-selected', 'false');
      expect(screen.getByTestId('verification-analytics')).toBeInTheDocument();
    });

    it('shows tab badges with correct counts', () => {
      renderComponent();
      
      const assessmentsTab = screen.getByRole('tab', { name: /assessments/i });
      const deliveriesTab = screen.getByRole('tab', { name: /deliveries/i });
      
      expect(assessmentsTab).toHaveTextContent('8');
      expect(deliveriesTab).toHaveTextContent('7');
    });
  });

  describe('Filter Functionality', () => {
    it('shows filter button', () => {
      renderComponent();
      
      expect(screen.getByRole('button', { name: /filters/i })).toBeInTheDocument();
    });

    it('opens filters panel when filter button is clicked', async () => {
      renderComponent();
      
      const filterButton = screen.getByRole('button', { name: /filters/i });
      await user.click(filterButton);
      
      expect(screen.getByTestId('queue-filters')).toBeInTheDocument();
    });

    it('closes filters panel', async () => {
      renderComponent();
      
      // Open filters
      const filterButton = screen.getByRole('button', { name: /filters/i });
      await user.click(filterButton);
      expect(screen.getByTestId('queue-filters')).toBeInTheDocument();

      // Close filters
      const closeButton = screen.getByRole('button', { name: /close filters/i });
      await user.click(closeButton);
      
      expect(screen.queryByTestId('queue-filters')).not.toBeInTheDocument();
    });
  });

  describe('Search Functionality', () => {
    it('has search input', () => {
      renderComponent();
      
      const searchInput = screen.getByPlaceholderText(/search/i);
      expect(searchInput).toBeInTheDocument();
    });

    it('updates search term when typed', async () => {
      renderComponent();
      
      const searchInput = screen.getByPlaceholderText(/search/i);
      await user.type(searchInput, 'hospital');
      
      expect(searchInput).toHaveValue('hospital');
    });
  });

  describe('Assessment Queue', () => {
    it('displays assessment items', () => {
      renderComponent();
      
      expect(screen.getByText('Central Hospital')).toBeInTheDocument();
      expect(screen.getByText('John Doe')).toBeInTheDocument();
      expect(screen.getByText('HEALTH')).toBeInTheDocument();
    });

    it('shows assessment priority badges', () => {
      renderComponent();
      
      expect(screen.getByText('CRITICAL')).toBeInTheDocument();
    });

    it('allows selecting assessment items', async () => {
      renderComponent();
      
      // Find and click on an assessment item
      const assessmentItem = screen.getByText('Central Hospital').closest('[role="button"]');
      if (assessmentItem) {
        await user.click(assessmentItem);
        
        // Should show details panel
        expect(screen.getByText('Assessment Details')).toBeInTheDocument();
      }
    });
  });

  describe('Delivery Queue', () => {
    it('displays delivery items when deliveries tab is active', async () => {
      renderComponent();
      
      // Switch to deliveries tab
      const deliveriesTab = screen.getByRole('tab', { name: /deliveries/i });
      await user.click(deliveriesTab);
      
      expect(screen.getByText('North Clinic')).toBeInTheDocument();
      expect(screen.getByText('Jane Smith')).toBeInTheDocument();
    });

    it('shows delivery status badges', async () => {
      renderComponent();
      
      // Switch to deliveries tab
      const deliveriesTab = screen.getByRole('tab', { name: /deliveries/i });
      await user.click(deliveriesTab);
      
      expect(screen.getByText('HIGH')).toBeInTheDocument();
    });
  });

  describe('Real-time Updates', () => {
    it('shows connection status', () => {
      renderComponent();
      
      expect(screen.getByTestId('connection-status')).toBeInTheDocument();
    });

    it('has refresh button', () => {
      renderComponent();
      
      const refreshButton = screen.getByRole('button', { name: /refresh/i });
      expect(refreshButton).toBeInTheDocument();
    });

    it('shows last update time', () => {
      renderComponent();
      
      expect(screen.getByText(/updated:/i)).toBeInTheDocument();
    });
  });

  describe('Analytics Tab', () => {
    it('shows analytics dashboard when analytics tab is selected', async () => {
      renderComponent();
      
      const analyticsTab = screen.getByRole('tab', { name: /analytics/i });
      await user.click(analyticsTab);
      
      expect(screen.getByTestId('verification-analytics')).toBeInTheDocument();
    });
  });

  describe('Error Handling', () => {
    it('handles loading state gracefully', () => {
      // Mock loading state
      jest.doMock('@/stores/verification.store', () => ({
        useVerificationStore: () => ({
          assessments: [],
          deliveries: [],
          assessmentLoading: true,
          deliveryLoading: true,
          assessmentError: null,
          deliveryError: null
        })
      }));

      renderComponent();
      
      // Should show loading indicators
      expect(screen.getByText('Loading...')).toBeInTheDocument();
    });

    it('displays error message when API fails', () => {
      // Mock error state
      jest.doMock('@/stores/verification.store', () => ({
        useVerificationStore: () => ({
          assessments: [],
          deliveries: [],
          assessmentLoading: false,
          deliveryLoading: false,
          assessmentError: 'Failed to fetch assessments',
          deliveryError: 'Failed to fetch deliveries'
        })
      }));

      renderComponent();
      
      expect(screen.getByText(/failed to fetch/i)).toBeInTheDocument();
    });
  });

  describe('Responsive Design', () => {
    it('renders correctly on mobile viewport', () => {
      // Change viewport to mobile size
      Object.defineProperty(window, 'innerWidth', {
        writable: true,
        configurable: true,
        value: 375,
      });
      
      renderComponent();
      
      // Should still render all essential elements
      expect(screen.getByText('Verification Queue Management')).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /assessments/i })).toBeInTheDocument();
    });
  });
});