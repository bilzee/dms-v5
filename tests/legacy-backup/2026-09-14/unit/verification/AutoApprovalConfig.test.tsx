import { describe, it, expect, beforeEach } from '@jest/globals';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AutoApprovalConfig } from '@/components/verification/AutoApprovalConfig';

// Mock the hooks
jest.mock('@/hooks/useAutoApproval', () => ({
  useAutoApprovalEntities: jest.fn(),
  useUpdateAutoApproval: jest.fn(),
  useBulkUpdateAutoApproval: jest.fn()
}));

jest.mock('@/hooks/useEntities', () => ({
  useEntities: jest.fn()
}));

// Mock lucide-react icons
jest.mock('lucide-react', () => ({
  Shield: ({ className }: { className?: string }) => <div data-testid="shield" className={className} />,
  Settings: ({ className }: { className?: string }) => <div data-testid="settings" className={className} />,
  Search: ({ className }: { className?: string }) => <div data-testid="search" className={className} />,
  Filter: ({ className }: { className?: string }) => <div data-testid="filter" className={className} />,
  CheckSquare: ({ className }: { className?: string }) => <div data-testid="check-square" className={className} />,
  Square: ({ className }: { className?: string }) => <div data-testid="square" className={className} />,
  Download: ({ className }: { className?: string }) => <div data-testid="download" className={className} />,
  Upload: ({ className }: { className?: string }) => <div data-testid="upload" className={className} />,
  AlertTriangle: ({ className }: { className?: string }) => <div data-testid="alert-triangle" className={className} />
}));

import { useAutoApprovalEntities, useUpdateAutoApproval, useBulkUpdateAutoApproval } from '@/hooks/useAutoApproval';
import { useEntities } from '@/hooks/useEntities';

const mockUseAutoApprovalEntities = useAutoApprovalEntities as jest.Mock;
const mockUseUpdateAutoApproval = useUpdateAutoApproval as jest.Mock;
const mockUseBulkUpdateAutoApproval = useBulkUpdateAutoApproval as jest.Mock;
const mockUseEntities = useEntities as jest.Mock;

const mockEntityWithAutoApproval = {
  id: 'entity-1',
  name: 'Health Center Alpha',
  type: 'HEALTH_FACILITY',
  location: 'District A',
  autoApproveEnabled: true,
  autoApprovalConfig: {
    assessmentTypes: ['HEALTH', 'WASH'],
    thresholds: {
      maxValue: 1000000,
      completenessRequired: 0.9
    },
    enabled: true,
    lastUpdated: '2024-01-15T10:00:00Z',
    updatedBy: 'coordinator-1'
  }
};

const mockEntityWithoutAutoApproval = {
  id: 'entity-2',
  name: 'Health Center Beta',
  type: 'HEALTH_FACILITY',
  location: 'District B',
  autoApproveEnabled: false,
  autoApprovalConfig: null
};

const mockEntitiesData = [
  mockEntityWithAutoApproval,
  mockEntityWithoutAutoApproval
];

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

describe('AutoApprovalConfig', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup default mock implementations
    mockUseAutoApprovalEntities.mockReturnValue({
      data: mockEntitiesData,
      isLoading: false,
      error: null,
      refetch: jest.fn()
    });

    mockUseEntities.mockReturnValue({
      data: mockEntitiesData,
      isLoading: false,
      error: null
    });
    
    mockUseUpdateAutoApproval.mockReturnValue({
      mutate: jest.fn(),
      isPending: false,
      error: null
    });
    
    mockUseBulkUpdateAutoApproval.mockReturnValue({
      mutate: jest.fn(),
      isPending: false,
      error: null
    });
  });

  it('renders auto-approval configuration page', () => {
    render(
      <TestWrapper>
        <AutoApprovalConfig />
      </TestWrapper>
    );

    expect(screen.getByText('Auto-Approval Configuration')).toBeInTheDocument();
    expect(screen.getByText('Configure automatic verification settings for entities and assessment types')).toBeInTheDocument();
    expect(screen.getByTestId('shield')).toBeInTheDocument();
  });

  it('displays entity list with auto-approval status', () => {
    render(
      <TestWrapper>
        <AutoApprovalConfig />
      </TestWrapper>
    );

    expect(screen.getByText('Health Center Alpha')).toBeInTheDocument();
    expect(screen.getByText('Health Center Beta')).toBeInTheDocument();
    expect(screen.getByText('District A')).toBeInTheDocument();
    expect(screen.getByText('District B')).toBeInTheDocument();
  });

  it('shows enabled badge for entities with auto-approval', () => {
    render(
      <TestWrapper>
        <AutoApprovalConfig />
      </TestWrapper>
    );

    const enabledBadges = screen.getAllByText('Enabled');
    expect(enabledBadges).toHaveLength(1);
    
    const disabledBadges = screen.getAllByText('Disabled');
    expect(disabledBadges).toHaveLength(1);
  });

  it('opens configuration dialog when configure button is clicked', () => {
    render(
      <TestWrapper>
        <AutoApprovalConfig />
      </TestWrapper>
    );

    const configureButtons = screen.getAllByText('Configure');
    fireEvent.click(configureButtons[0]);

    expect(screen.getByText('Configure Auto-Approval')).toBeInTheDocument();
    expect(screen.getByText('Health Center Alpha')).toBeInTheDocument();
  });

  it('loads existing configuration in dialog', () => {
    render(
      <TestWrapper>
        <AutoApprovalConfig />
      </TestWrapper>
    );

    const configureButtons = screen.getAllByText('Configure');
    fireEvent.click(configureButtons[0]);

    // Check if existing config is loaded
    expect(screen.getByDisplayValue('1000000')).toBeInTheDocument();
    expect(screen.getByDisplayValue('90')).toBeInTheDocument();
  });

  it('enables bulk actions when entities are selected', () => {
    render(
      <TestWrapper>
        <AutoApprovalConfig />
      </TestWrapper>
    );

    // Select an entity
    const checkboxes = screen.getAllByTestId('square');
    fireEvent.click(checkboxes[0]);

    expect(screen.getByText('Bulk Enable')).toBeInTheDocument();
    expect(screen.getByText('Bulk Disable')).toBeInTheDocument();
    expect(screen.getByText('Bulk Configure')).toBeInTheDocument();
  });

  it('filters entities by search term', async () => {
    render(
      <TestWrapper>
        <AutoApprovalConfig />
      </TestWrapper>
    );

    const searchInput = screen.getByPlaceholderText('Search entities...');
    fireEvent.change(searchInput, { target: { value: 'Alpha' } });

    await waitFor(() => {
      expect(screen.getByText('Health Center Alpha')).toBeInTheDocument();
      expect(screen.queryByText('Health Center Beta')).not.toBeInTheDocument();
    });
  });

  it('filters entities by type', () => {
    render(
      <TestWrapper>
        <AutoApprovalConfig />
      </TestWrapper>
    );

    const typeFilter = screen.getByDisplayValue('All Types');
    fireEvent.change(typeFilter, { target: { value: 'HEALTH_FACILITY' } });

    expect(screen.getByText('Health Center Alpha')).toBeInTheDocument();
    expect(screen.getByText('Health Center Beta')).toBeInTheDocument();
  });

  it('filters entities by auto-approval status', () => {
    render(
      <TestWrapper>
        <AutoApprovalConfig />
      </TestWrapper>
    );

    const statusFilter = screen.getByDisplayValue('All Statuses');
    fireEvent.change(statusFilter, { target: { value: 'enabled' } });

    expect(screen.getByText('Health Center Alpha')).toBeInTheDocument();
    expect(screen.queryByText('Health Center Beta')).not.toBeInTheDocument();
  });

  it('submits configuration changes', async () => {
    const mockUpdate = jest.fn();
    mockUseUpdateAutoApproval.mockReturnValue({
      mutate: mockUpdate,
      isPending: false,
      error: null
    });

    render(
      <TestWrapper>
        <AutoApprovalConfig />
      </TestWrapper>
    );

    // Open configuration dialog
    const configureButtons = screen.getAllByText('Configure');
    fireEvent.click(configureButtons[0]);

    // Modify configuration
    const maxValueInput = screen.getByDisplayValue('1000000');
    fireEvent.change(maxValueInput, { target: { value: '2000000' } });

    // Submit changes
    const saveButton = screen.getByRole('button', { name: /save configuration/i });
    fireEvent.click(saveButton);

    expect(mockUpdate).toHaveBeenCalledWith({
      entityId: 'entity-1',
      config: expect.objectContaining({
        thresholds: expect.objectContaining({
          maxValue: 2000000
        })
      })
    });
  });

  it('performs bulk enable operation', async () => {
    const mockBulkUpdate = jest.fn();
    mockUseBulkUpdateAutoApproval.mockReturnValue({
      mutate: mockBulkUpdate,
      isPending: false,
      error: null
    });

    render(
      <TestWrapper>
        <AutoApprovalConfig />
      </TestWrapper>
    );

    // Select entities
    const checkboxes = screen.getAllByTestId('square');
    fireEvent.click(checkboxes[0]);
    fireEvent.click(checkboxes[1]);

    // Perform bulk enable
    const bulkEnableButton = screen.getByText('Bulk Enable');
    fireEvent.click(bulkEnableButton);

    const confirmButton = screen.getByRole('button', { name: /enable auto-approval/i });
    fireEvent.click(confirmButton);

    expect(mockBulkUpdate).toHaveBeenCalledWith({
      entityIds: ['entity-1', 'entity-2'],
      enabled: true,
      config: expect.any(Object)
    });
  });

  it('shows loading state', () => {
    mockUseAutoApprovalEntities.mockReturnValue({
      data: null,
      isLoading: true,
      error: null,
      refetch: jest.fn()
    });

    render(
      <TestWrapper>
        <AutoApprovalConfig />
      </TestWrapper>
    );

    expect(screen.getByText('Loading auto-approval settings...')).toBeInTheDocument();
  });

  it('shows error state', () => {
    const mockError = new Error('Failed to load settings');
    mockUseAutoApprovalEntities.mockReturnValue({
      data: null,
      isLoading: false,
      error: mockError,
      refetch: jest.fn()
    });

    render(
      <TestWrapper>
        <AutoApprovalConfig />
      </TestWrapper>
    );

    expect(screen.getByText('Error loading auto-approval settings')).toBeInTheDocument();
    expect(screen.getByTestId('alert-triangle')).toBeInTheDocument();
  });

  it('validates configuration form', () => {
    render(
      <TestWrapper>
        <AutoApprovalConfig />
      </TestWrapper>
    );

    // Open configuration dialog
    const configureButtons = screen.getAllByText('Configure');
    fireEvent.click(configureButtons[1]); // Entity without config

    // Try to submit without required fields
    const saveButton = screen.getByRole('button', { name: /save configuration/i });
    expect(saveButton).toBeDisabled();
  });

  it('enables save button when form is valid', () => {
    render(
      <TestWrapper>
        <AutoApprovalConfig />
      </TestWrapper>
    );

    // Open configuration dialog for entity without config
    const configureButtons = screen.getAllByText('Configure');
    fireEvent.click(configureButtons[1]);

    // Fill required fields
    const maxValueInput = screen.getByPlaceholderText('e.g., 1000000');
    fireEvent.change(maxValueInput, { target: { value: '500000' } });

    const completenessInput = screen.getByPlaceholderText('e.g., 90');
    fireEvent.change(completenessInput, { target: { value: '85' } });

    // Save button should be enabled
    const saveButton = screen.getByRole('button', { name: /save configuration/i });
    expect(saveButton).not.toBeDisabled();
  });

  it('selects all entities when select all checkbox is clicked', () => {
    render(
      <TestWrapper>
        <AutoApprovalConfig />
      </TestWrapper>
    );

    const selectAllCheckbox = screen.getByRole('checkbox', { name: /select all/i });
    fireEvent.click(selectAllCheckbox);

    expect(screen.getByText('2 selected')).toBeInTheDocument();
  });

  it('closes dialogs when cancel is clicked', () => {
    render(
      <TestWrapper>
        <AutoApprovalConfig />
      </TestWrapper>
    );

    // Open configuration dialog
    const configureButtons = screen.getAllByText('Configure');
    fireEvent.click(configureButtons[0]);

    // Cancel dialog
    const cancelButton = screen.getByRole('button', { name: /cancel/i });
    fireEvent.click(cancelButton);

    expect(screen.queryByText('Configure Auto-Approval')).not.toBeInTheDocument();
  });
});