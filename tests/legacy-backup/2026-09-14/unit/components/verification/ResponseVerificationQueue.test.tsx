import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ResponseVerificationQueue } from '@/components/dashboards/crisis/ResponseVerificationQueue';
import { useResponseVerificationQueue, useResponseVerificationActions } from '@/hooks/useResponseVerification';

// Mock hooks
jest.mock('@/hooks/useResponseVerification');

const mockUseResponseVerificationQueue = useResponseVerificationQueue as jest.MockedFunction<typeof useResponseVerificationQueue>;
const mockUseResponseVerificationActions = useResponseVerificationActions as jest.MockedFunction<typeof useResponseVerificationActions>;

// Test data
const mockResponse = {
  id: 'response-1',
  responseType: 'HEALTH',
  responseDate: '2025-01-15T10:00:00Z',
  verificationStatus: 'SUBMITTED' as const,
  priority: 'HIGH' as const,
  responseData: {
    medicalSupplies: {
      bandages: 100,
      antiseptic: 50
    }
  },
  entity: {
    id: 'entity-1',
    name: 'Test Health Center',
    type: 'HEALTH_FACILITY',
    location: 'Test Location'
  },
  donor: {
    id: 'donor-1',
    name: 'Test Medical Supplies Donor',
    contactEmail: 'donor@test.com'
  },
  assessment: {
    id: 'assessment-1',
    rapidAssessmentType: 'HEALTH',
    priority: 'HIGH'
  },
  assessor: {
    id: 'assessor-1',
    name: 'John Assessor',
    email: 'assessor@test.com'
  },
  createdAt: '2025-01-15T09:30:00Z',
  updatedAt: '2025-01-15T10:00:00Z'
};

const createMockQueryClient = () => {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
};

const renderWithQueryClient = (component: React.ReactElement) => {
  const queryClient = createMockQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      {component}
    </QueryClientProvider>
  );
};

describe('ResponseVerificationQueue', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup default mocks
    mockUseResponseVerificationQueue.mockReturnValue({
      data: {
        data: [mockResponse],
        pagination: {
          page: 1,
          limit: 10,
          total: 1,
          totalPages: 1
        }
      },
      isLoading: false,
      error: null,
      refetch: jest.fn()
    } as any);

    mockUseResponseVerificationActions.mockReturnValue({
      verifyResponse: jest.fn().mockResolvedValue({ success: true }),
      rejectResponse: jest.fn().mockResolvedValue({ success: true }),
      isLoading: false,
      error: null
    } as any);
  });

  describe('Component Rendering', () => {
    it('should render response verification queue correctly', () => {
      renderWithQueryClient(<ResponseVerificationQueue />);
      
      expect(screen.getByTestId('response-verification-queue')).toBeInTheDocument();
      expect(screen.getByTestId('verification-filters')).toBeInTheDocument();
      expect(screen.getByTestId('response-queue-table')).toBeInTheDocument();
    });

    it('should display response data correctly', () => {
      renderWithQueryClient(<ResponseVerificationQueue />);
      
      expect(screen.getByText('response-1')).toBeInTheDocument();
      expect(screen.getByText('HEALTH')).toBeInTheDocument();
      expect(screen.getByText('HIGH')).toBeInTheDocument();
      expect(screen.getByText('Test Health Center')).toBeInTheDocument();
      expect(screen.getByText('Test Medical Supplies Donor')).toBeInTheDocument();
    });

    it('should show loading state correctly', () => {
      mockUseResponseVerificationQueue.mockReturnValue({
        data: null,
        isLoading: true,
        error: null,
        refetch: jest.fn()
      } as any);

      renderWithQueryClient(<ResponseVerificationQueue />);
      
      expect(screen.getByTestId('loading-spinner')).toBeInTheDocument();
      expect(screen.getByText('Loading responses...')).toBeInTheDocument();
    });

    it('should show error state correctly', () => {
      mockUseResponseVerificationQueue.mockReturnValue({
        data: null,
        isLoading: false,
        error: new Error('Failed to load responses'),
        refetch: jest.fn()
      } as any);

      renderWithQueryClient(<ResponseVerificationQueue />);
      
      expect(screen.getByTestId('error-message')).toBeInTheDocument();
      expect(screen.getByText(/Failed to load responses/)).toBeInTheDocument();
      expect(screen.getByTestId('retry-button')).toBeInTheDocument();
    });

    it('should show empty state when no responses', () => {
      mockUseResponseVerificationQueue.mockReturnValue({
        data: {
          data: [],
          pagination: {
            page: 1,
            limit: 10,
            total: 0,
            totalPages: 0
          }
        },
        isLoading: false,
        error: null,
        refetch: jest.fn()
      } as any);

      renderWithQueryClient(<ResponseVerificationQueue />);
      
      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
      expect(screen.getByText(/No responses found/)).toBeInTheDocument();
    });
  });

  describe('Filtering Functionality', () => {
    it('should render filter controls', () => {
      renderWithQueryClient(<ResponseVerificationQueue />);
      
      expect(screen.getByTestId('status-filter')).toBeInTheDocument();
      expect(screen.getByTestId('response-type-filter')).toBeInTheDocument();
      expect(screen.getByTestId('priority-filter')).toBeInTheDocument();
      expect(screen.getByTestId('entity-filter')).toBeInTheDocument();
      expect(screen.getByTestId('clear-filters-btn')).toBeInTheDocument();
    });

    it('should handle status filter change', async () => {
      renderWithQueryClient(<ResponseVerificationQueue />);
      
      const statusFilter = screen.getByTestId('status-filter');
      fireEvent.change(statusFilter, { target: { value: 'VERIFIED' } });
      
      await waitFor(() => {
        expect(mockUseResponseVerificationQueue).toHaveBeenCalled();
      });
    });

    it('should handle response type filter change', async () => {
      renderWithQueryClient(<ResponseVerificationQueue />);
      
      const typeFilter = screen.getByTestId('response-type-filter');
      fireEvent.change(typeFilter, { target: { value: 'WASH' } });
      
      await waitFor(() => {
        expect(mockUseResponseVerificationQueue).toHaveBeenCalled();
      });
    });

    it('should handle priority filter change', async () => {
      renderWithQueryClient(<ResponseVerificationQueue />);
      
      const priorityFilter = screen.getByTestId('priority-filter');
      fireEvent.change(priorityFilter, { target: { value: 'MEDIUM' } });
      
      await waitFor(() => {
        expect(mockUseResponseVerificationQueue).toHaveBeenCalled();
      });
    });

    it('should handle clear filters', async () => {
      renderWithQueryClient(<ResponseVerificationQueue />);
      
      const clearFiltersBtn = screen.getByTestId('clear-filters-btn');
      fireEvent.click(clearFiltersBtn);
      
      await waitFor(() => {
        expect(mockUseResponseVerificationQueue).toHaveBeenCalled();
      });
    });
  });

  describe('Response Actions', () => {
    it('should show action buttons for submitted responses', () => {
      renderWithQueryClient(<ResponseVerificationQueue />);
      
      expect(screen.getByTestId('verify-response-btn')).toBeInTheDocument();
      expect(screen.getByTestId('reject-response-btn')).toBeInTheDocument();
      expect(screen.getByTestId('view-details-btn')).toBeInTheDocument();
    });

    it('should open verification dialog when verify button clicked', async () => {
      renderWithQueryClient(<ResponseVerificationQueue />);
      
      const verifyBtn = screen.getByTestId('verify-response-btn');
      fireEvent.click(verifyBtn);
      
      await waitFor(() => {
        expect(screen.getByTestId('verify-confirmation-dialog')).toBeInTheDocument();
        expect(screen.getByTestId('verification-notes-input')).toBeInTheDocument();
        expect(screen.getByTestId('confirm-verify-btn')).toBeInTheDocument();
        expect(screen.getByTestId('cancel-verify-btn')).toBeInTheDocument();
      });
    });

    it('should open rejection dialog when reject button clicked', async () => {
      renderWithQueryClient(<ResponseVerificationQueue />);
      
      const rejectBtn = screen.getByTestId('reject-response-btn');
      fireEvent.click(rejectBtn);
      
      await waitFor(() => {
        expect(screen.getByTestId('reject-confirmation-dialog')).toBeInTheDocument();
        expect(screen.getByTestId('rejection-reason-select')).toBeInTheDocument();
        expect(screen.getByTestId('rejection-feedback-input')).toBeInTheDocument();
        expect(screen.getByTestId('confirm-reject-btn')).toBeInTheDocument();
        expect(screen.getByTestId('cancel-reject-btn')).toBeInTheDocument();
      });
    });

    it('should handle response verification successfully', async () => {
      const mockVerifyResponse = jest.fn().mockResolvedValue({ success: true });
      mockUseResponseVerificationActions.mockReturnValue({
        verifyResponse: mockVerifyResponse,
        rejectResponse: jest.fn(),
        isLoading: false,
        error: null
      } as any);

      renderWithQueryClient(<ResponseVerificationQueue />);
      
      // Open verification dialog
      const verifyBtn = screen.getByTestId('verify-response-btn');
      fireEvent.click(verifyBtn);
      
      await waitFor(() => {
        expect(screen.getByTestId('verification-notes-input')).toBeInTheDocument();
      });
      
      // Fill notes and confirm
      const notesInput = screen.getByTestId('verification-notes-input');
      fireEvent.change(notesInput, { target: { value: 'Response verified successfully' } });
      
      const confirmBtn = screen.getByTestId('confirm-verify-btn');
      fireEvent.click(confirmBtn);
      
      await waitFor(() => {
        expect(mockVerifyResponse).toHaveBeenCalledWith('response-1', {
          notes: 'Response verified successfully'
        });
      });
    });

    it('should handle response rejection successfully', async () => {
      const mockRejectResponse = jest.fn().mockResolvedValue({ success: true });
      mockUseResponseVerificationActions.mockReturnValue({
        verifyResponse: jest.fn(),
        rejectResponse: mockRejectResponse,
        isLoading: false,
        error: null
      } as any);

      renderWithQueryClient(<ResponseVerificationQueue />);
      
      // Open rejection dialog
      const rejectBtn = screen.getByTestId('reject-response-btn');
      fireEvent.click(rejectBtn);
      
      await waitFor(() => {
        expect(screen.getByTestId('rejection-reason-select')).toBeInTheDocument();
      });
      
      // Fill rejection details and confirm
      const reasonSelect = screen.getByTestId('rejection-reason-select');
      fireEvent.change(reasonSelect, { target: { value: 'INADEQUATE_SUPPLIES' } });
      
      const feedbackInput = screen.getByTestId('rejection-feedback-input');
      fireEvent.change(feedbackInput, { target: { value: 'Insufficient supplies for facility needs' } });
      
      const confirmBtn = screen.getByTestId('confirm-reject-btn');
      fireEvent.click(confirmBtn);
      
      await waitFor(() => {
        expect(mockRejectResponse).toHaveBeenCalledWith('response-1', {
          rejectionReason: 'INADEQUATE_SUPPLIES',
          notes: 'Insufficient supplies for facility needs'
        });
      });
    });

    it('should show loading state during verification', async () => {
      mockUseResponseVerificationActions.mockReturnValue({
        verifyResponse: jest.fn().mockReturnValue(new Promise(() => {})), // Never resolves
        rejectResponse: jest.fn(),
        isLoading: true,
        error: null
      } as any);

      renderWithQueryClient(<ResponseVerificationQueue />);
      
      const verifyBtn = screen.getByTestId('verify-response-btn');
      fireEvent.click(verifyBtn);
      
      await waitFor(() => {
        expect(screen.getByTestId('loading-state')).toBeInTheDocument();
      });
    });
  });

  describe('Response Details', () => {
    it('should show response details when view details clicked', async () => {
      renderWithQueryClient(<ResponseVerificationQueue />);
      
      const detailsBtn = screen.getByTestId('view-details-btn');
      fireEvent.click(detailsBtn);
      
      await waitFor(() => {
        expect(screen.getByTestId('response-details-dialog')).toBeInTheDocument();
        expect(screen.getByText(/Response Details/)).toBeInTheDocument();
        expect(screen.getByTestId('response-type-display')).toBeInTheDocument();
        expect(screen.getByTestId('response-priority-display')).toBeInTheDocument();
        expect(screen.getByTestId('entity-information')).toBeInTheDocument();
        expect(screen.getByTestId('donor-information')).toBeInTheDocument();
        expect(screen.getByTestId('assessment-information')).toBeInTheDocument();
        expect(screen.getByTestId('response-data-display')).toBeInTheDocument();
      });
    });

    it('should display response data correctly in details', async () => {
      renderWithQueryClient(<ResponseVerificationQueue />);
      
      const detailsBtn = screen.getByTestId('view-details-btn');
      fireEvent.click(detailsBtn);
      
      await waitFor(() => {
        expect(screen.getByTestId('medical-supplies-data')).toBeInTheDocument();
        expect(screen.getByText('Bandages: 100')).toBeInTheDocument();
        expect(screen.getByText('Antiseptic: 50')).toBeInTheDocument();
      });
    });

    it('should close details dialog when close button clicked', async () => {
      renderWithQueryClient(<ResponseVerificationQueue />);
      
      // Open details
      const detailsBtn = screen.getByTestId('view-details-btn');
      fireEvent.click(detailsBtn);
      
      await waitFor(() => {
        expect(screen.getByTestId('response-details-dialog')).toBeInTheDocument();
      });
      
      // Close details
      const closeBtn = screen.getByTestId('close-details-btn');
      fireEvent.click(closeBtn);
      
      await waitFor(() => {
        expect(screen.queryByTestId('response-details-dialog')).not.toBeInTheDocument();
      });
    });
  });

  describe('Pagination', () => {
    it('should show pagination controls when multiple pages', () => {
      mockUseResponseVerificationQueue.mockReturnValue({
        data: {
          data: [mockResponse],
          pagination: {
            page: 1,
            limit: 10,
            total: 25,
            totalPages: 3
          }
        },
        isLoading: false,
        error: null,
        refetch: jest.fn()
      } as any);

      renderWithQueryClient(<ResponseVerificationQueue />);
      
      expect(screen.getByTestId('pagination-controls')).toBeInTheDocument();
      expect(screen.getByText(/Page 1 of 3/)).toBeInTheDocument();
      expect(screen.getByTestId('next-page-btn')).toBeInTheDocument();
    });

    it('should handle page navigation', async () => {
      const mockRefetch = jest.fn();
      mockUseResponseVerificationQueue.mockReturnValue({
        data: {
          data: [mockResponse],
          pagination: {
            page: 1,
            limit: 10,
            total: 25,
            totalPages: 3
          }
        },
        isLoading: false,
        error: null,
        refetch: mockRefetch
      } as any);

      renderWithQueryClient(<ResponseVerificationQueue />);
      
      const nextPageBtn = screen.getByTestId('next-page-btn');
      fireEvent.click(nextPageBtn);
      
      await waitFor(() => {
        expect(mockRefetch).toHaveBeenCalled();
      });
    });
  });

  describe('Bulk Actions', () => {
    it('should show select checkboxes for bulk actions', () => {
      renderWithQueryClient(<ResponseVerificationQueue />);
      
      expect(screen.getByTestId('select-all-checkbox')).toBeInTheDocument();
      expect(screen.getByTestId('response-checkbox-response-1')).toBeInTheDocument();
    });

    it('should enable bulk actions when responses selected', async () => {
      renderWithQueryClient(<ResponseVerificationQueue />);
      
      const responseCheckbox = screen.getByTestId('response-checkbox-response-1');
      fireEvent.click(responseCheckbox);
      
      await waitFor(() => {
        expect(screen.getByTestId('bulk-actions')).toBeInTheDocument();
        expect(screen.getByTestId('bulk-verify-btn')).toBeInTheDocument();
        expect(screen.getByTestId('bulk-reject-btn')).toBeInTheDocument();
      });
    });

    it('should handle select all functionality', async () => {
      mockUseResponseVerificationQueue.mockReturnValue({
        data: {
          data: [mockResponse, { ...mockResponse, id: 'response-2' }],
          pagination: {
            page: 1,
            limit: 10,
            total: 2,
            totalPages: 1
          }
        },
        isLoading: false,
        error: null,
        refetch: jest.fn()
      } as any);

      renderWithQueryClient(<ResponseVerificationQueue />);
      
      const selectAllCheckbox = screen.getByTestId('select-all-checkbox');
      fireEvent.click(selectAllCheckbox);
      
      await waitFor(() => {
        expect(screen.getByTestId('response-checkbox-response-1')).toBeChecked();
        expect(screen.getByTestId('response-checkbox-response-2')).toBeChecked();
        expect(screen.getByTestId('bulk-actions')).toBeInTheDocument();
      });
    });

    it('should open bulk verification dialog', async () => {
      renderWithQueryClient(<ResponseVerificationQueue />);
      
      // Select a response
      const responseCheckbox = screen.getByTestId('response-checkbox-response-1');
      fireEvent.click(responseCheckbox);
      
      await waitFor(() => {
        expect(screen.getByTestId('bulk-verify-btn')).toBeInTheDocument();
      });
      
      // Click bulk verify
      const bulkVerifyBtn = screen.getByTestId('bulk-verify-btn');
      fireEvent.click(bulkVerifyBtn);
      
      await waitFor(() => {
        expect(screen.getByTestId('bulk-verify-dialog')).toBeInTheDocument();
        expect(screen.getByTestId('bulk-verification-notes')).toBeInTheDocument();
        expect(screen.getByTestId('confirm-bulk-verify-btn')).toBeInTheDocument();
      });
    });
  });

  describe('Error Handling', () => {
    it('should show error message when verification fails', async () => {
      mockUseResponseVerificationActions.mockReturnValue({
        verifyResponse: jest.fn().mockRejectedValue(new Error('Verification failed')),
        rejectResponse: jest.fn(),
        isLoading: false,
        error: new Error('Verification failed')
      } as any);

      renderWithQueryClient(<ResponseVerificationQueue />);
      
      // Attempt verification
      const verifyBtn = screen.getByTestId('verify-response-btn');
      fireEvent.click(verifyBtn);
      
      // Fill notes and confirm
      await waitFor(() => {
        expect(screen.getByTestId('verification-notes-input')).toBeInTheDocument();
      });
      
      const notesInput = screen.getByTestId('verification-notes-input');
      fireEvent.change(notesInput, { target: { value: 'Test verification' } });
      
      const confirmBtn = screen.getByTestId('confirm-verify-btn');
      fireEvent.click(confirmBtn);
      
      await waitFor(() => {
        expect(screen.getByTestId('error-message')).toBeInTheDocument();
        expect(screen.getByText(/Verification failed/)).toBeInTheDocument();
      });
    });

    it('should handle network errors gracefully', async () => {
      mockUseResponseVerificationActions.mockReturnValue({
        verifyResponse: jest.fn().mockRejectedValue(new Error('Network error')),
        rejectResponse: jest.fn(),
        isLoading: false,
        error: null
      } as any);

      renderWithQueryClient(<ResponseVerificationQueue />);
      
      const verifyBtn = screen.getByTestId('verify-response-btn');
      fireEvent.click(verifyBtn);
      
      await waitFor(() => {
        expect(screen.getByTestId('network-error-message')).toBeInTheDocument();
        expect(screen.getByTestId('retry-button')).toBeInTheDocument();
      });
    });
  });

  describe('Accessibility', () => {
    it('should have proper ARIA labels', () => {
      renderWithQueryClient(<ResponseVerificationQueue />);
      
      expect(screen.getByRole('table')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /verify/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /reject/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /view details/i })).toBeInTheDocument();
    });

    it('should support keyboard navigation', () => {
      renderWithQueryClient(<ResponseVerificationQueue />);
      
      const verifyBtn = screen.getByTestId('verify-response-btn');
      verifyBtn.focus();
      expect(verifyBtn).toHaveFocus();
      
      fireEvent.keyPress(verifyBtn, { key: 'Enter' });
      fireEvent.keyPress(verifyBtn, { key: ' ' });
      
      // Should open dialog
      expect(screen.getByTestId('verify-confirmation-dialog')).toBeInTheDocument();
    });

    it('should have proper focus management in dialogs', async () => {
      renderWithQueryClient(<ResponseVerificationQueue />);
      
      const verifyBtn = screen.getByTestId('verify-response-btn');
      fireEvent.click(verifyBtn);
      
      await waitFor(() => {
        const confirmBtn = screen.getByTestId('confirm-verify-btn');
        expect(confirmBtn).toHaveFocus();
      });
    });
  });
});