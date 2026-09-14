import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LeaderboardDisplay } from '@/components/donor/LeaderboardDisplay';
import type { LeaderboardEntry } from '@/types/gamification';

// Mock UI components
jest.mock('@/components/ui/select', () => ({
  Select: ({ children, onValueChange, ...props }: any) => (
    <select {...props} onChange={(e) => onValueChange?.(e.target.value)} data-testid="select">
      {children}
    </select>
  ),
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ children, value }: any) => <option value={value}>{children}</option>,
  SelectTrigger: ({ children }: any) => <div data-testid="select-trigger">{children}</div>,
  SelectValue: ({ placeholder }: any) => <option>{placeholder}</option>
}));

jest.mock('@/components/ui/input', () => ({
  Input: (props: any) => <input {...props} data-testid="input" />
}));

jest.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, ...props }: any) => (
    <button {...props} onClick={onClick} data-testid="button">
      {children}
    </button>
  )
}));

jest.mock('@/components/ui/card', () => ({
  Card: ({ children, className }: any) => <div className={className} data-testid="card">{children}</div>,
  CardHeader: ({ children }: any) => <div data-testid="card-header">{children}</div>,
  CardTitle: ({ children }: any) => <h2 data-testid="card-title">{children}</h2>,
  CardContent: ({ children }: any) => <div data-testid="card-content">{children}</div>
}));

jest.mock('@/components/ui/badge', () => ({
  Badge: ({ children, className }: any) => <span className={className} data-testid="badge">{children}</span>
}));

jest.mock('@/components/ui/skeleton', () => ({
  Skeleton: ({ className }: any) => <div className={className} data-testid="skeleton">Loading...</div>
}));

jest.mock('@/components/ui/alert', () => ({
  Alert: ({ children }: any) => <div data-testid="alert">{children}</div>,
  AlertDescription: ({ children }: any) => <div data-testid="alert-description">{children}</div>
}));

jest.mock('@/components/donor/GameBadgeSystem', () => ({
  GameBadgeSystem: ({ badges, size }: { badges: string[], size?: string }) => (
    <div data-testid="game-badge-system" data-badges={badges.join(',')} data-size={size}>
      {badges.map(badge => <span key={badge} data-testid={`badge-${badge}`}>{badge}</span>)}
    </div>
  )
}));

// Mock fetch API
const mockFetch = jest.fn();
global.fetch = mockFetch;

const createTestClient = () => new QueryClient({
  defaultOptions: {
    queries: { retry: false },
    mutations: { retry: false }
  }
});

const mockLeaderboardData: LeaderboardEntry[] = [
  {
    rank: 1,
    donor: {
      id: 'donor-1',
      organizationName: 'Helping Hands Organization',
      region: 'North'
    },
    metrics: {
      commitments: {
        total: 25,
        completed: 20,
        partial: 3,
        totalValue: 50000,
        totalItems: 500,
        deliveredItems: 480,
        verifiedItems: 450
      },
      deliveryRates: {
        selfReported: 96,
        verified: 90
      },
      responses: {
        total: 30,
        verified: 28,
        verificationRate: 93
      },
      performance: {
        overallScore: 95.5,
        deliveryScore: 90,
        valueScore: 85,
        consistencyScore: 88,
        speedScore: 92,
        activityFrequency: 2.5,
        avgResponseTimeHours: 8
      }
    },
    badges: ['Reliable Delivery Gold', 'High Volume Silver', 'Quick Response Gold'],
    trend: 'up',
    previousRank: 3,
    lastActivityDate: new Date('2024-12-01')
  },
  {
    rank: 2,
    donor: {
      id: 'donor-2',
      organizationName: 'Community Support Group',
      region: 'South'
    },
    metrics: {
      commitments: {
        total: 18,
        completed: 15,
        partial: 2,
        totalValue: 35000,
        totalItems: 350,
        deliveredItems: 320,
        verifiedItems: 300
      },
      deliveryRates: {
        selfReported: 91,
        verified: 86
      },
      responses: {
        total: 22,
        verified: 20,
        verificationRate: 91
      },
      performance: {
        overallScore: 88.2,
        deliveryScore: 86,
        valueScore: 75,
        consistencyScore: 92,
        speedScore: 78,
        activityFrequency: 1.8,
        avgResponseTimeHours: 15
      }
    },
    badges: ['Reliable Delivery Silver', 'High Volume Bronze', 'Consistency Silver'],
    trend: 'stable',
    lastActivityDate: new Date('2024-11-30')
  }
];

describe('LeaderboardDisplay Component', () => {
  let queryClient: QueryClient;
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    queryClient = createTestClient();
    user = userEvent.setup();
    mockFetch.mockClear();
  });

  const renderComponent = (props = {}) => {
    return render(
      <QueryClientProvider client={queryClient}>
        <LeaderboardDisplay {...props} />
      </QueryClientProvider>
    );
  };

  it('should render loading state initially', () => {
    mockFetch.mockImplementation(() => 
      new Promise(() => {}) // Never resolves
    );

    renderComponent();

    expect(screen.getByTestId('skeleton')).toBeInTheDocument();
    expect(screen.getAllByTestId('skeleton')).toHaveLengthGreaterThan(0);
  });

  it('should render error state when fetch fails', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));

    renderComponent();

    await waitFor(() => {
      expect(screen.getByTestId('alert')).toBeInTheDocument();
      expect(screen.getByText(/Failed to load leaderboard data/)).toBeInTheDocument();
    });
  });

  it('should render leaderboard data successfully', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          rankings: mockLeaderboardData,
          metadata: {
            lastUpdated: new Date().toISOString(),
            totalParticipants: 100,
            updateFrequency: '15 minutes',
            timeframe: '30d',
            region: 'All Regions',
            sortBy: 'overall',
            limit: 50
          }
        }
      })
    });

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Donor Leaderboard')).toBeInTheDocument();
    });

    // Check if top performers are displayed
    expect(screen.getByText('Helping Hands Organization')).toBeInTheDocument();
    expect(screen.getByText('Community Support Group')).toBeInTheDocument();
    expect(screen.getByText('North')).toBeInTheDocument();
    expect(screen.getByText('South')).toBeInTheDocument();
  });

  it('should display correct rankings and scores', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          rankings: mockLeaderboardData,
          metadata: {
            lastUpdated: new Date().toISOString(),
            totalParticipants: 100,
            updateFrequency: '15 minutes',
            timeframe: '30d',
            region: 'All Regions',
            sortBy: 'overall',
            limit: 50
          }
        }
      })
    });

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('95.5')).toBeInTheDocument();
      expect(screen.getByText('88.2')).toBeInTheDocument();
      expect(screen.getByText('90%')).toBeInTheDocument();
      expect(screen.getByText('86%')).toBeInTheDocument();
    });
  });

  it('should filter results when search term is entered', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          rankings: mockLeaderboardData,
          metadata: {
            lastUpdated: new Date().toISOString(),
            totalParticipants: 100,
            updateFrequency: '15 minutes',
            timeframe: '30d',
            region: 'All Regions',
            sortBy: 'overall',
            limit: 50
          }
        }
      })
    });

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Helping Hands Organization')).toBeInTheDocument();
    });

    const searchInput = screen.getByTestId('input');
    await user.type(searchInput, 'Community');

    expect(screen.getByText('Helping Hands Organization')).not.toBeInTheDocument();
    expect(screen.getByText('Community Support Group')).toBeInTheDocument();
  });

  it('should change timeframe when selected', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          rankings: mockLeaderboardData,
          metadata: {
            lastUpdated: new Date().toISOString(),
            totalParticipants: 100,
            updateFrequency: '15 minutes',
            timeframe: '7d',
            region: 'All Regions',
            sortBy: 'overall',
            limit: 50
          }
        }
      })
    });

    renderComponent();

    await waitFor(() => {
      expect(screen.getByTestId('select')).toBeInTheDocument();
    });

    const timeframeSelect = screen.getByTestId('select');
    await user.selectOptions(timeframeSelect, '7d');

    // Should make new API call with updated parameters
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('timeframe=7d'),
      expect.objectContaining({
        headers: expect.any(Object)
      })
    );
  });

  it('should display badges for each donor', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          rankings: mockLeaderboardData,
          metadata: {
            lastUpdated: new Date().toISOString(),
            totalParticipants: 100,
            updateFrequency: '15 minutes',
            timeframe: '30d',
            region: 'All Regions',
            sortBy: 'overall',
            limit: 50
          }
        }
      })
    });

    renderComponent();

    await waitFor(() => {
      const badgeSystems = screen.getAllByTestId('game-badge-system');
      expect(badgeSystems).toHaveLength(2);

      // Check badges for first donor
      const firstBadges = screen.getByTestId('game-badge-system[data-badges="Reliable Delivery Gold, High Volume Silver, Quick Response Gold"]');
      expect(firstBadges).toBeInTheDocument();

      // Check individual badge components
      expect(screen.getByTestId('badge-Reliable Delivery Gold')).toBeInTheDocument();
      expect(screen.getByTestId('badge-High Volume Silver')).toBeInTheDocument();
    });
  });

  it('should show trend indicators for ranking changes', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          rankings: mockLeaderboardData,
          metadata: {
            lastUpdated: new Date().toISOString(),
            totalParticipants: 100,
            updateFrequency: '15 minutes',
            timeframe: '30d',
            region: 'All Regions',
            sortBy: 'overall',
            limit: 50
          }
        }
      })
    });

    renderComponent();

    await waitFor(() => {
      // Should show rank change for first donor (up from 3 to 1)
      expect(screen.getByText(/#3 → #1/)).toBeInTheDocument();
    });
  });

  it('should show "No donors found" message when search returns no results', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          rankings: [],
          metadata: {
            lastUpdated: new Date().toISOString(),
            totalParticipants: 0,
            updateFrequency: '15 minutes',
            timeframe: '30d',
            region: 'All Regions',
            sortBy: 'overall',
            limit: 50
          }
        }
      })
    });

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('No donors found')).toBeInTheDocument();
      expect(screen.getByText('Try adjusting your search or filter criteria')).toBeInTheDocument();
    });
  });

  it('should refresh data when refresh button is clicked', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          rankings: mockLeaderboardData,
          metadata: {
            lastUpdated: new Date().toISOString(),
            totalParticipants: 100,
            updateFrequency: '15 minutes',
            timeframe: '30d',
            region: 'All Regions',
            sortBy: 'overall',
            limit: 50
          }
        }
      })
    });

    // Mock second call after refresh
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          rankings: mockLeaderboardData.slice(0, 1), // Different data to indicate refresh
          metadata: {
            lastUpdated: new Date().toISOString(),
            totalParticipants: 100,
            updateFrequency: '15 minutes',
            timeframe: '30d',
            region: 'All Regions',
            sortBy: 'overall',
            limit: 50
          }
        }
      })
    });

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Helping Hands Organization')).toBeInTheDocument();
    });

    const refreshButton = screen.getByTestId('button');
    await user.click(refreshButton);

    // Should make second API call for refresh
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('should limit display based on limit prop', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          rankings: mockLeaderboardData,
          metadata: {
            lastUpdated: new Date().toISOString(),
            totalParticipants: 100,
            updateFrequency: '15 minutes',
            timeframe: '30d',
            region: 'All Regions',
            sortBy: 'overall',
            limit: 2
          }
        }
      })
    });

    renderComponent({ limit: 2 });

    await waitFor(() => {
      expect(screen.getByText('Helping Hands Organization')).toBeInTheDocument();
      expect(screen.getByText('Community Support Group')).toBeInTheDocument();
    });

    // Should show both donors since limit is 2 and we have 2 in mock data
    expect(screen.queryAllByTestId('game-badge-system')).toHaveLength(2);
  });

  it('should show "Load More" button when there are more results', async () => {
    // Create mock data with more items than default limit
    const extensiveMockData = Array.from({ length: 60 }, (_, i) => ({
      rank: i + 1,
      donor: {
        id: `donor-${i + 1}`,
        organizationName: `Organization ${i + 1}`,
        region: 'North'
      },
      metrics: {
        commitments: { total: 10, completed: 8, partial: 1, totalValue: 10000, totalItems: 100, deliveredItems: 90, verifiedItems: 85 },
        deliveryRates: { selfReported: 90, verified: 85 },
        responses: { total: 12, verified: 11, verificationRate: 92 },
        performance: { overallScore: 80 + (i * 0.5), deliveryScore: 85, valueScore: 75, consistencyScore: 88, speedScore: 78, activityFrequency: 1.5, avgResponseTimeHours: 10 }
      },
      badges: ['Reliable Delivery Bronze'],
      trend: i % 2 === 0 ? 'up' as const : 'stable' as const,
      lastActivityDate: new Date('2024-12-01')
    }));

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          rankings: extensiveMockData,
          metadata: {
            lastUpdated: new Date().toISOString(),
            totalParticipants: 200,
            updateFrequency: '15 minutes',
            timeframe: '30d',
            region: 'All Regions',
            sortBy: 'overall',
            limit: 50
          }
        }
      })
    });

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Organization 1')).toBeInTheDocument();
      expect(screen.getByText('Load More')).toBeInTheDocument();
    });
  });
});