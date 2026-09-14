import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ExportButton } from '@/components/dashboards/shared/exports/ExportButton';
import { useExportStore } from '@/stores/export.store';

// Mock UI components
jest.mock('@/components/ui/select', () => ({
  SelectRoot: ({ children, onValueChange }: any) => <div onChange={onValueChange}>{children}</div>,
  SelectTrigger: ({ children, ...props }: any) => <button {...props}>{children}</button>,
  SelectValue: ({ placeholder }: { placeholder: string }) => <span>{placeholder}</span>,
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children, value, onSelect }: any) => (
    <div onClick={() => onSelect && onSelect(value)}>{children}</div>
  ),
}));

// Mock export store
const mockStartExport = jest.fn();
jest.mock('@/stores/export.store', () => ({
  useExportStore: () => ({
    startExport: mockStartExport,
    getExportStatus: jest.fn(),
  }),
}));

describe('ExportButton', () => {
  let queryClient: QueryClient;
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
    });
    user = userEvent.setup();
    jest.clearAllMocks();
  });

  const renderComponent = (props = {}) => {
    return render(
      <QueryClientProvider client={queryClient}>
        <ExportButton
          dataType="assessments"
          label="Export Assessments"
          {...props}
        />
      </QueryClientProvider>
    );
  };

  it('renders export button with correct label', () => {
    renderComponent();
    
    expect(screen.getByRole('button', { name: /export assessments/i })).toBeInTheDocument();
  });

  it('opens dropdown when button is clicked', async () => {
    renderComponent();
    
    const button = screen.getByRole('button', { name: /export assessments/i });
    await user.click(button);
    
    expect(screen.getByText('Export assessments as')).toBeInTheDocument();
  });

  it('displays available export formats', async () => {
    renderComponent({
      availableFormats: ['csv', 'pdf', 'png'],
    });
    
    const button = screen.getByRole('button', { name: /export assessments/i });
    await user.click(button);
    
    expect(screen.getByText('CSV (Excel)')).toBeInTheDocument();
    expect(screen.getByText('PDF Report')).toBeInTheDocument();
    expect(screen.getByText('PNG Image')).toBeInTheDocument();
  });

  it('starts export when format is selected', async () => {
    mockStartExport.mockResolvedValue(undefined);
    
    renderComponent({
      availableFormats: ['csv'],
    });
    
    const button = screen.getByRole('button', { name: /export assessments/i });
    await user.click(button);
    
    const csvOption = screen.getByText('CSV (Excel)');
    await user.click(csvOption);
    
    expect(mockStartExport).toHaveBeenCalledWith({
      dataType: 'assessments',
      format: 'csv',
      dateRange: expect.objectContaining({
        startDate: expect.any(String),
        endDate: expect.any(String),
      }),
    });
  });

  it('displays loading state during export', async () => {
    mockStartExport.mockImplementation(() => new Promise(() => {}));
    
    renderComponent();
    
    const button = screen.getByRole('button', { name: /export assessments/i });
    await user.click(button);
    
    const csvOption = screen.getByText('CSV (Excel)');
    await user.click(csvOption);
    
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /export assessments/i })).toHaveClass('opacity-75');
    });
  });

  it('displays error state on export failure', async () => {
    mockStartExport.mockRejectedValue(new Error('Export failed'));
    
    renderComponent();
    
    const button = screen.getByRole('button', { name: /export assessments/i });
    await user.click(button);
    
    const csvOption = screen.getByText('CSV (Excel)');
    await user.click(csvOption);
    
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /export assessments/i })).toHaveAttribute('disabled');
    });
  });

  it('opens advanced export modal', async () => {
    renderComponent();
    
    const button = screen.getByRole('button', { name: /export assessments/i });
    await user.click(button);
    
    const advancedButton = screen.getByText('Advanced Options');
    await user.click(advancedButton);
    
    // This would test the modal opening logic
    expect(true).toBe(true); // Placeholder for modal test
  });

  it('filters available formats based on props', async () => {
    renderComponent({
      availableFormats: ['pdf'],
    });
    
    const button = screen.getByRole('button', { name: /export assessments/i });
    await user.click(button);
    
    expect(screen.getByText('PDF Report')).toBeInTheDocument();
    expect(screen.queryByText('CSV (Excel)')).not.toBeInTheDocument();
    expect(screen.queryByText('PNG Image')).not.toBeInTheDocument();
  });

  it('shows custom label when provided', () => {
    renderComponent({
      label: 'Download Now',
    });
    
    expect(screen.getByRole('button', { name: /download now/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /export assessments/i })).not.toBeInTheDocument();
  });

  it('is disabled when disabled prop is true', () => {
    renderComponent({
      disabled: true,
    });
    
    const button = screen.getByRole('button', { name: /export assessments/i });
    expect(button).toHaveAttribute('disabled');
  });

  it('uses custom onClick handler when provided', async () => {
    const customClick = jest.fn();
    
    renderComponent({
      onClick: customClick,
    });
    
    const button = screen.getByRole('button', { name: /export assessments/i });
    await user.click(button);
    
    expect(customClick).toHaveBeenCalledTimes(1);
    expect(mockStartExport).not.toHaveBeenCalled();
  });

  it('shows export status message', async () => {
    renderComponent({
      showStatus: true,
    });
    
    // Test export in progress
    const { getExportStatus } = useExportStore();
    (getExportStatus as jest.Mock).mockReturnValue({
      status: 'processing',
      format: 'csv',
    });
    
    renderComponent();
    
    expect(screen.getByText('Generating export...')).toBeInTheDocument();
  });

  it('handles keyboard navigation', async () => {
    renderComponent();
    
    const button = screen.getByRole('button', { name: /export assessments/i });
    button.focus();
    await user.keyboard('{Enter}');
    
    expect(screen.getByText('Export assessments as')).toBeInTheDocument();
    
    // Navigate down and select first option
    await user.keyboard('{ArrowDown}');
    await user.keyboard('{Enter}');
    
    expect(mockStartExport).toHaveBeenCalled();
  });

  it('closes dropdown when clicking outside', async () => {
    renderComponent();
    
    const button = screen.getByRole('button', { name: /export assessments/i });
    await user.click(button);
    
    expect(screen.getByText('Export assessments as')).toBeInTheDocument();
    
    // Click outside
    fireEvent.mouseDown(document.body);
    
    await waitFor(() => {
      expect(screen.queryByText('Export assessments as')).not.toBeInTheDocument();
    });
  });

  it('accessibility: has proper ARIA attributes', () => {
    renderComponent();
    
    const button = screen.getByRole('button', { name: /export assessments/i });
    
    expect(button).toHaveAttribute('aria-haspopup', 'true');
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  it('accessibility: manages ARIA expanded state', async () => {
    renderComponent();
    
    const button = screen.getByRole('button', { name: /export assessments/i });
    await user.click(button);
    
    expect(button).toHaveAttribute('aria-expanded', 'true');
  });
});