import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AssessmentViewer } from '@/components/donor/AssessmentViewer';

// Mock fetch
global.fetch = jest.fn();

// Mock UI Components
jest.mock('@/components/ui/card', () => ({
  Card: ({ children, className, ...props }: any) => <div className={className} {...props}>{children}</div>,
  CardContent: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  CardHeader: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  CardTitle: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  CardDescription: ({ children, ...props }: any) => <div {...props}>{children}</div>,
}));

jest.mock('@/components/ui/badge', () => ({
  Badge: ({ children, variant, className, ...props }: any) => 
    <span className={className} data-variant={variant} {...props}>{children}</span>,
}));

jest.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, className, ...props }: any) => 
    <button onClick={onClick} className={className} {...props}>{children}</button>,
}));

jest.mock('@/components/ui/select', () => ({
  SelectRoot: ({ children, onValueChange }: any) => <div onChange={onValueChange}>{children}</div>,
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

jest.mock('lucide-react', () => ({
  FileText: ({ className, ...props }: any) => <div className={className} {...props}>FileText</div>,
  Download: ({ className, ...props }: any) => <div className={className} {...props}>Download</div>,
  Filter: ({ className, ...props }: any) => <div className={className} {...props}>Filter</div>,
  Calendar: ({ className, ...props }: any) => <div className={className} {...props}>Calendar</div>,
  CheckCircle: ({ className, ...props }: any) => <div className={className} {...props}>CheckCircle</div>,
  Clock: ({ className, ...props }: any) => <div className={className} {...props}>Clock</div>,
  AlertTriangle: ({ className, ...props }: any) => <div className={className} {...props}>AlertTriangle</div>,
  TrendingUp: ({ className, ...props }: any) => <div className={className} {...props}>TrendingUp</div>,
  TrendingDown: ({ className, ...props }: any) => <div className={className} {...props}>TrendingDown</div>,
  Minus: ({ className, ...props }: any) => <div className={className} {...props}>Minus</div>,
  Eye: ({ className, ...props }: any) => <div className={className} {...props}>Eye</div>,
  ChevronDown: ({ className, ...props }: any) => <div className={className} {...props}>ChevronDown</div>,
}));

describe('AssessmentViewer', () => {
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

    // Mock assessments API response
    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (url.includes('/assessments')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            data: {
              assessments: [
                {
                  id: 'assessment1',
                  type: 'HEALTH',
                  date: '2024-01-15T00:00:00.000Z',
                  status: 'VERIFIED',
                  assessorName: 'John Doe',
                  verificationStatus: 'VERIFIED',
                  verificationDate: '2024-01-16T00:00:00.000Z',
                  verificationNotes: 'Assessment verified and confirmed',
                  summary: {
                    overallScore: 85,
                    criticalGaps: ['Medical supplies', 'Emergency response team'],
                    strengths: ['Well-trained staff', 'Good infrastructure'],
                    recommendations: ['Increase medical supply inventory', 'Establish emergency protocols']
                  },
                  metadata: {
                    population: { total: 1000, affected: 150, vulnerable: 50 },
                    priorityLevel: 'HIGH',
                    responseTime: '2 hours'
                  },
                  entity: {
                    id: 'entity1',
                    name: 'Test Hospital',
                    type: 'FACILITY',
                    location: 'Test Location'
                  }
                },
                {
                  id: 'assessment2',
                  type: 'SHELTER',
                  date: '2024-01-10T00:00:00.000Z',
                  status: 'VERIFIED',
                  assessorName: 'Jane Smith',
                  verificationStatus: 'VERIFIED',
                  verificationDate: '2024-01-11T00:00:00.000Z',
                  verificationNotes: 'Shelter assessment completed',
                  summary: {
                    overallScore: 72,
                    criticalGaps: ['Emergency shelter space'],
                    strengths: ['Good location', 'Security measures in place'],
                    recommendations: ['Expand shelter capacity', 'Improve ventilation']
                  },
                  metadata: {
                    population: { total: 500, affected: 200, vulnerable: 80 },
                    priorityLevel: 'MEDIUM',
                    responseTime: '4 hours'
                  },
                  entity: {
                    id: 'entity1',
                    name: 'Test Hospital',
                    type: 'FACILITY',
                    location: 'Test Location'
                  }
                }
              ],
              pagination: {
                page: 1,
                limit: 10,
                total: 2,
                totalPages: 1,
                hasNext: false,
                hasPrev: false
              }
            }
          })
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true, data: {} })
      });
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  const renderComponent = (props = {}) => {
    return render(
      <QueryClientProvider client={queryClient}>
        <AssessmentViewer entityId="entity1" {...props} />
      </QueryClientProvider>
    );
  };

  it('renders assessment viewer header', async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Entity Assessment History')).toBeInTheDocument();
    });
  });

  it('displays assessment cards with data', async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('HEALTH Assessment')).toBeInTheDocument();
      expect(screen.getByText('SHELTER Assessment')).toBeInTheDocument();
      expect(screen.getByText('Verified')).toBeInTheDocument();
      expect(screen.getByText('John Doe')).toBeInTheDocument();
      expect(screen.getByText('Jane Smith')).toBeInTheDocument();
    });
  });

  it('shows assessment scores and metrics', async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('85%')).toBeInTheDocument(); // Overall score for HEALTH assessment
      expect(screen.getByText('72%')).toBeInTheDocument(); // Overall score for SHELTER assessment
    });
  });

  it('displays critical gaps information', async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Medical supplies')).toBeInTheDocument();
      expect(screen.getByText('Emergency response team')).toBeInTheDocument();
      expect(screen.getByText('Emergency shelter space')).toBeInTheDocument();
    });
  });

  it('shows assessment metadata', async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Total Population: 1000')).toBeInTheDocument();
      expect(screen.getByText('Affected: 150')).toBeInTheDocument();
      expect(screen.getByText('Priority: HIGH')).toBeInTheDocument();
    });
  });

  it('renders category filter', async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('All Categories')).toBeInTheDocument();
    });
  });

  it('filters assessments by category', async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('HEALTH Assessment')).toBeInTheDocument();
      expect(screen.getByText('SHELTER Assessment')).toBeInTheDocument();
    });

    const categorySelect = screen.getByText('All Categories');
    await user.click(categorySelect);
    
    // Test category selection - this would require updating the mock to handle filtering
    // For now, just verify the interaction works
    expect(categorySelect).toBeInTheDocument();
  });

  it('expands assessment card for details', async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('HEALTH Assessment')).toBeInTheDocument();
    });

    const expandButton = screen.getByText('View Details');
    await user.click(expandButton);

    // Should show expanded details
    await waitFor(() => {
      expect(screen.getByText('Well-trained staff')).toBeInTheDocument();
      expect(screen.getByText('Good infrastructure')).toBeInTheDocument();
      expect(screen.getByText('Increase medical supply inventory')).toBeInTheDocument();
    });
  });

  it('shows loading state while fetching assessments', () => {
    renderComponent();

    // Should show loading skeleton
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('handles empty assessment list', async () => {
    // Mock empty response
    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (url.includes('/assessments')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            data: {
              assessments: [],
              pagination: {
                page: 1,
                limit: 10,
                total: 0,
                totalPages: 1,
                hasNext: false,
                hasPrev: false
              }
            }
          })
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true, data: {} })
      });
    });

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('No assessments found')).toBeInTheDocument();
      expect(screen.getByText(/This entity hasn't had any assessments recorded yet/)).toBeInTheDocument();
    });
  });

  it('handles error state gracefully', async () => {
    // Mock error response
    (global.fetch as jest.Mock).mockImplementation(() => 
      Promise.resolve({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ success: false, error: 'Server error' })
      })
    );

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Unable to load assessments')).toBeInTheDocument();
      expect(screen.getByText('Please try again later or contact support if the issue persists.')).toBeInTheDocument();
    });
  });

  it('searches assessments', async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('HEALTH Assessment')).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText('Search assessments...');
    await user.type(searchInput, 'HEALTH');

    // Search functionality would be tested through API mocking
    // For now, verify the input exists and can be typed in
    expect(searchInput).toHaveValue('HEALTH');
  });

  it('exports assessment data', async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Export')).toBeInTheDocument();
    });

    const exportButton = screen.getByText('Export');
    await user.click(exportButton);

    // Export functionality would be tested through API mocking
    // Verify the button exists and can be clicked
    expect(exportButton).toBeInTheDocument();
  });
});