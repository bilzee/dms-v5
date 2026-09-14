import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { EntityInsightsCards, EntityInsightsCard } from '@/components/donor/EntityInsightsCards';
import { useRouter } from 'next/navigation';

// Mock next/navigation
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
}));

// Mock fetch
global.fetch = jest.fn();

// Mock UI Components (Template Pattern)
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

jest.mock('@/components/ui/progress', () => ({
  Progress: ({ value, className, ...props }: any) => (
    <div 
      className={className} 
      data-value={value} 
      style={{ backgroundColor: value >= 80 ? '#10b981' : value >= 60 ? '#f59e0b' : '#ef4444' }}
      {...props}
    />
  ),
}));

describe('EntityInsightsCards', () => {
  let queryClient: QueryClient;
  let user: ReturnType<typeof userEvent.setup>;
  let mockPush: jest.Mock;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    user = userEvent.setup();
    mockPush = jest.fn();
    (useRouter as jest.Mock).mockReturnValue({
      push: mockPush,
    });

    // Mock fetch responses
    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (url.includes('/api/v1/donors/entities')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            data: {
              entities: [
                { id: 'entity1', name: 'Hospital A', type: 'FACILITY' },
                { id: 'entity2', name: 'School B', type: 'EDUCATIONAL' },
              ],
              summary: { totalAssigned: 2, totalWithResponses: 1, totalWithCommitments: 1 }
            }
          })
        });
      }
      if (url.includes('/assessments/latest')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            data: { latestAssessments: [] }
          })
        });
      }
      if (url.includes('/gap-analysis')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            data: {
              overallGapScore: 25,
              summary: { totalGaps: 3, criticalGaps: 1 }
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
        <EntityInsightsCards {...props} />
      </QueryClientProvider>
    );
  };

  it('renders entity insights overview header', async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Entity Insights Overview')).toBeInTheDocument();
    });
  });

  it('displays loading state while fetching entities', () => {
    renderComponent();

    // Should show skeleton loading cards
    expect(screen.getAllByText('')).toHaveLength(expect.any(Number));
  });

  it('renders entity cards with data', async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Hospital A')).toBeInTheDocument();
      expect(screen.getByText('School B')).toBeInTheDocument();
      expect(screen.getByText('FACILITY')).toBeInTheDocument();
      expect(screen.getByText('EDUCATIONAL')).toBeInTheDocument();
    });
  });

  it('displays entity metrics correctly', async () => {
    renderComponent();

    await waitFor(() => {
      // Should show overall scores and metrics
      expect(screen.getByText('Score')).toBeInTheDocument();
      expect(screen.getByText('Assessments')).toBeInTheDocument();
      expect(screen.getByText('Gaps')).toBeInTheDocument();
    });
  });

  it('handles empty entity list', async () => {
    // Mock empty response
    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (url.includes('/api/v1/donors/entities')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            data: { entities: [] }
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
      expect(screen.getByText('No Assigned Entities')).toBeInTheDocument();
      expect(screen.getByText(/You don't have any entities assigned to you yet/)).toBeInTheDocument();
    });
  });

  it('navigates to entity details on card click', async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Hospital A')).toBeInTheDocument();
    });

    const entityCard = screen.getByText('Hospital A').closest('[role="button"]');
    if (entityCard) {
      await user.click(entityCard);
    }

    expect(mockPush).toHaveBeenCalledWith('/donor/entities/entity1');
  });

  it('navigates to entity details via View Details button', async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Hospital A')).toBeInTheDocument();
    });

    const viewDetailsButton = screen.getByText('View Details');
    await user.click(viewDetailsButton);

    expect(mockPush).toHaveBeenCalledWith('/donor/entities/entity1');
  });
});

describe('EntityInsightsCard', () => {
  let queryClient: QueryClient;
  let user: ReturnType<typeof userEvent.setup>;
  let mockPush: jest.Mock;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    user = userEvent.setup();
    mockPush = jest.fn();
    (useRouter as jest.Mock).mockReturnValue({
      push: mockPush,
    });

    // Mock detailed entity responses
    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (url.includes('/demographics')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            data: {
              id: 'entity1',
              name: 'Test Hospital',
              type: 'FACILITY',
              location: 'Test Location',
              stats: {
                verifiedAssessments: 5,
                totalCommitments: 3,
                activeResponses: 2,
                pendingCommitments: 1
              },
              latestActivity: {
                lastAssessment: '2024-01-15T00:00:00.000Z',
                lastAssessmentType: 'HEALTH',
                assignmentDate: '2024-01-01T00:00:00.000Z'
              }
            }
          })
        });
      }
      if (url.includes('/assessments/latest')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            data: {
              latestAssessments: [
                {
                  type: 'HEALTH',
                  assessment: {
                    date: '2024-01-15T00:00:00.000Z',
                    status: 'VERIFIED',
                    summary: {
                      overallScore: 85,
                      criticalGaps: ['Medical supplies', 'Emergency response team']
                    }
                  }
                }
              ]
            }
          })
        });
      }
      if (url.includes('/gap-analysis')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            data: {
              overallGapScore: 15,
              summary: { totalGaps: 2, criticalGaps: 1 }
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

  const renderSingleCard = (props = {}) => {
    return render(
      <QueryClientProvider client={queryClient}>
        <EntityInsightsCard entityId="entity1" {...props} />
      </QueryClientProvider>
    );
  };

  it('displays entity information correctly', async () => {
    renderSingleCard();

    await waitFor(() => {
      expect(screen.getByText('Test Hospital')).toBeInTheDocument();
      expect(screen.getByText('FACILITY')).toBeInTheDocument();
      expect(screen.getByText('Test Location')).toBeInTheDocument();
    });
  });

  it('shows assessment statistics', async () => {
    renderSingleCard();

    await waitFor(() => {
      expect(screen.getByText('5')).toBeInTheDocument(); // verifiedAssessments
    });
  });

  it('displays gap analysis with severity indicators', async () => {
    renderSingleCard();

    await waitFor(() => {
      expect(screen.getByText('1 critical')).toBeInTheDocument(); // criticalGaps
    });
  });

  it('shows overall performance score', async () => {
    renderSingleCard();

    await waitFor(() => {
      expect(screen.getByText('85%')).toBeInTheDocument(); // overallScore
    });
  });

  it('displays activity timestamp in compact mode', async () => {
    renderSingleCard({ compact: true });

    await waitFor(() => {
      expect(screen.getByText('Test Hospital')).toBeInTheDocument();
    });
    
    // In compact mode, should hide the activity timestamp
    expect(screen.queryByText(/Last assessment/)).not.toBeInTheDocument();
  });

  it('shows latest activity in full mode', async () => {
    renderSingleCard({ compact: false });

    await waitFor(() => {
      expect(screen.getByText(/Last assessment:/)).toBeInTheDocument();
      expect(screen.getByText(/1\/15\/2024/)).toBeInTheDocument();
    });
  });

  it('handles loading state', () => {
    renderSingleCard();

    // Should show loading skeleton
    expect(screen.getByRole('status')).toBeInTheDocument();
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

    renderSingleCard();

    await waitFor(() => {
      expect(screen.getByText('Unable to load data')).toBeInTheDocument();
    });
  });
});