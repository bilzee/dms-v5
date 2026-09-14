import { describe, it, expect, beforeEach } from '@jest/globals';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { VerificationActions } from '@/components/verification/VerificationActions';
import type { VerificationQueueItem } from '@/types/verification';

// Mock the hooks
jest.mock('@/hooks/useVerification', () => ({
  useVerifyAssessment: jest.fn(),
  useRejectAssessment: jest.fn()
}));

// Mock lucide-react icons
jest.mock('lucide-react', () => ({
  CheckCircle: ({ className }: { className?: string }) => <div data-testid="check-circle" className={className} />,
  XCircle: ({ className }: { className?: string }) => <div data-testid="x-circle" className={className} />,
  RotateCcw: ({ className }: { className?: string }) => <div data-testid="rotate-ccw" className={className} />,
  AlertTriangle: ({ className }: { className?: string }) => <div data-testid="alert-triangle" className={className} />
}));

import { useVerifyAssessment, useRejectAssessment } from '@/hooks/useVerification';

const mockUseVerifyAssessment = useVerifyAssessment as jest.Mock;
const mockUseRejectAssessment = useRejectAssessment as jest.Mock;

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

describe('VerificationActions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup default mock implementations
    mockUseVerifyAssessment.mockReturnValue({
      mutate: jest.fn(),
      isPending: false,
      error: null
    });
    
    mockUseRejectAssessment.mockReturnValue({
      mutate: jest.fn(),
      isPending: false,
      error: null
    });
  });

  it('renders verification actions for submitted assessment', () => {
    render(
      <TestWrapper>
        <VerificationActions 
          assessment={mockAssessment}
          onActionComplete={jest.fn()}
        />
      </TestWrapper>
    );

    expect(screen.getByRole('button', { name: /verify/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reject/i })).toBeInTheDocument();
    expect(screen.getByTestId('check-circle')).toBeInTheDocument();
    expect(screen.getByTestId('x-circle')).toBeInTheDocument();
  });

  it('does not render actions for non-submitted assessment', () => {
    const verifiedAssessment = {
      ...mockAssessment,
      verificationStatus: 'VERIFIED' as const
    };

    render(
      <TestWrapper>
        <VerificationActions 
          assessment={verifiedAssessment}
          onActionComplete={jest.fn()}
        />
      </TestWrapper>
    );

    expect(screen.queryByRole('button', { name: /verify/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /reject/i })).not.toBeInTheDocument();
  });

  it('opens verification dialog when verify button is clicked', () => {
    render(
      <TestWrapper>
        <VerificationActions 
          assessment={mockAssessment}
          onActionComplete={jest.fn()}
        />
      </TestWrapper>
    );

    const verifyButton = screen.getByRole('button', { name: /verify/i });
    fireEvent.click(verifyButton);

    expect(screen.getByText('Verify Assessment')).toBeInTheDocument();
    expect(screen.getByText('Please provide verification notes (optional)')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Assessment looks complete and accurate...')).toBeInTheDocument();
  });

  it('opens rejection dialog when reject button is clicked', () => {
    render(
      <TestWrapper>
        <VerificationActions 
          assessment={mockAssessment}
          onActionComplete={jest.fn()}
        />
      </TestWrapper>
    );

    const rejectButton = screen.getByRole('button', { name: /reject/i });
    fireEvent.click(rejectButton);

    expect(screen.getByText('Reject Assessment')).toBeInTheDocument();
    expect(screen.getByText('Reason for Rejection')).toBeInTheDocument();
    expect(screen.getByText('Feedback for Assessor')).toBeInTheDocument();
  });

  it('submits verification with notes', async () => {
    const mockVerify = jest.fn();
    const mockOnComplete = jest.fn();
    
    mockUseVerifyAssessment.mockReturnValue({
      mutate: mockVerify,
      isPending: false,
      error: null
    });

    render(
      <TestWrapper>
        <VerificationActions 
          assessment={mockAssessment}
          onActionComplete={mockOnComplete}
        />
      </TestWrapper>
    );

    // Open verification dialog
    const verifyButton = screen.getByRole('button', { name: /verify/i });
    fireEvent.click(verifyButton);

    // Add notes
    const notesInput = screen.getByPlaceholderText('Assessment looks complete and accurate...');
    fireEvent.change(notesInput, { target: { value: 'All data verified and complete' } });

    // Submit verification
    const confirmButton = screen.getByRole('button', { name: /confirm verification/i });
    fireEvent.click(confirmButton);

    expect(mockVerify).toHaveBeenCalledWith({
      assessmentId: 'assessment-1',
      notes: 'All data verified and complete'
    });
  });

  it('submits rejection with reason and feedback', async () => {
    const mockReject = jest.fn();
    const mockOnComplete = jest.fn();
    
    mockUseRejectAssessment.mockReturnValue({
      mutate: mockReject,
      isPending: false,
      error: null
    });

    render(
      <TestWrapper>
        <VerificationActions 
          assessment={mockAssessment}
          onActionComplete={mockOnComplete}
        />
      </TestWrapper>
    );

    // Open rejection dialog
    const rejectButton = screen.getByRole('button', { name: /reject/i });
    fireEvent.click(rejectButton);

    // Select rejection reason
    const reasonSelect = screen.getByDisplayValue('Select rejection reason');
    fireEvent.change(reasonSelect, { target: { value: 'INCOMPLETE_DATA' } });

    // Add feedback
    const feedbackInput = screen.getByPlaceholderText('Please provide specific feedback...');
    fireEvent.change(feedbackInput, { target: { value: 'Missing health facility capacity data' } });

    // Submit rejection
    const confirmButton = screen.getByRole('button', { name: /confirm rejection/i });
    fireEvent.click(confirmButton);

    expect(mockReject).toHaveBeenCalledWith({
      assessmentId: 'assessment-1',
      reason: 'INCOMPLETE_DATA',
      feedback: 'Missing health facility capacity data'
    });
  });

  it('validates rejection form before submission', () => {
    render(
      <TestWrapper>
        <VerificationActions 
          assessment={mockAssessment}
          onActionComplete={jest.fn()}
        />
      </TestWrapper>
    );

    // Open rejection dialog
    const rejectButton = screen.getByRole('button', { name: /reject/i });
    fireEvent.click(rejectButton);

    // Try to submit without selecting reason or providing feedback
    const confirmButton = screen.getByRole('button', { name: /confirm rejection/i });
    expect(confirmButton).toBeDisabled();
  });

  it('enables rejection submit button when form is valid', () => {
    render(
      <TestWrapper>
        <VerificationActions 
          assessment={mockAssessment}
          onActionComplete={jest.fn()}
        />
      </TestWrapper>
    );

    // Open rejection dialog
    const rejectButton = screen.getByRole('button', { name: /reject/i });
    fireEvent.click(rejectButton);

    // Fill form
    const reasonSelect = screen.getByDisplayValue('Select rejection reason');
    fireEvent.change(reasonSelect, { target: { value: 'INCOMPLETE_DATA' } });

    const feedbackInput = screen.getByPlaceholderText('Please provide specific feedback...');
    fireEvent.change(feedbackInput, { target: { value: 'Missing data' } });

    // Submit button should be enabled
    const confirmButton = screen.getByRole('button', { name: /confirm rejection/i });
    expect(confirmButton).not.toBeDisabled();
  });

  it('shows loading state during verification', () => {
    mockUseVerifyAssessment.mockReturnValue({
      mutate: jest.fn(),
      isPending: true,
      error: null
    });

    render(
      <TestWrapper>
        <VerificationActions 
          assessment={mockAssessment}
          onActionComplete={jest.fn()}
        />
      </TestWrapper>
    );

    const verifyButton = screen.getByRole('button', { name: /verify/i });
    expect(verifyButton).toBeDisabled();
  });

  it('shows loading state during rejection', () => {
    mockUseRejectAssessment.mockReturnValue({
      mutate: jest.fn(),
      isPending: true,
      error: null
    });

    render(
      <TestWrapper>
        <VerificationActions 
          assessment={mockAssessment}
          onActionComplete={jest.fn()}
        />
      </TestWrapper>
    );

    const rejectButton = screen.getByRole('button', { name: /reject/i });
    expect(rejectButton).toBeDisabled();
  });

  it('closes dialog and calls onActionComplete after successful verification', async () => {
    const mockVerify = jest.fn((data, { onSuccess }) => {
      onSuccess();
    });
    const mockOnComplete = jest.fn();
    
    mockUseVerifyAssessment.mockReturnValue({
      mutate: mockVerify,
      isPending: false,
      error: null
    });

    render(
      <TestWrapper>
        <VerificationActions 
          assessment={mockAssessment}
          onActionComplete={mockOnComplete}
        />
      </TestWrapper>
    );

    // Open and submit verification
    const verifyButton = screen.getByRole('button', { name: /verify/i });
    fireEvent.click(verifyButton);

    const confirmButton = screen.getByRole('button', { name: /confirm verification/i });
    fireEvent.click(confirmButton);

    // Simulate successful mutation
    const onSuccess = mockVerify.mock.calls[0][1].onSuccess;
    onSuccess();

    await waitFor(() => {
      expect(mockOnComplete).toHaveBeenCalled();
    });
  });

  it('renders inline layout correctly', () => {
    render(
      <TestWrapper>
        <VerificationActions 
          assessment={mockAssessment}
          onActionComplete={jest.fn()}
          inline={true}
        />
      </TestWrapper>
    );

    const actionsContainer = screen.getByRole('button', { name: /verify/i }).parentElement;
    expect(actionsContainer).toHaveClass('flex-row');
  });

  it('renders stacked layout correctly', () => {
    render(
      <TestWrapper>
        <VerificationActions 
          assessment={mockAssessment}
          onActionComplete={jest.fn()}
          inline={false}
        />
      </TestWrapper>
    );

    const actionsContainer = screen.getByRole('button', { name: /verify/i }).parentElement;
    expect(actionsContainer).toHaveClass('flex-col');
  });

  it('cancels verification dialog', () => {
    render(
      <TestWrapper>
        <VerificationActions 
          assessment={mockAssessment}
          onActionComplete={jest.fn()}
        />
      </TestWrapper>
    );

    // Open verification dialog
    const verifyButton = screen.getByRole('button', { name: /verify/i });
    fireEvent.click(verifyButton);

    // Cancel dialog
    const cancelButton = screen.getByRole('button', { name: /cancel/i });
    fireEvent.click(cancelButton);

    expect(screen.queryByText('Verify Assessment')).not.toBeInTheDocument();
  });

  it('cancels rejection dialog', () => {
    render(
      <TestWrapper>
        <VerificationActions 
          assessment={mockAssessment}
          onActionComplete={jest.fn()}
        />
      </TestWrapper>
    );

    // Open rejection dialog
    const rejectButton = screen.getByRole('button', { name: /reject/i });
    fireEvent.click(rejectButton);

    // Cancel dialog
    const cancelButton = screen.getByRole('button', { name: /cancel/i });
    fireEvent.click(cancelButton);

    expect(screen.queryByText('Reject Assessment')).not.toBeInTheDocument();
  });
});