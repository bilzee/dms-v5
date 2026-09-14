import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IncidentManagement } from '@/components/coordinator/IncidentManagement'
import { useQuery, useMutation } from '@tanstack/react-query'

// Mock TanStack Query
jest.mock('@tanstack/react-query', () => ({
  ...jest.requireActual('@tanstack/react-query'),
  useQuery: jest.fn(),
  useMutation: jest.fn()
}))

// Mock UI components
jest.mock('@/components/ui/card', () => ({
  Card: ({ children, className }: any) => <div className={className} data-testid="card">{children}</div>,
  CardContent: ({ children }: any) => <div data-testid="card-content">{children}</div>,
  CardHeader: ({ children }: any) => <div data-testid="card-header">{children}</div>,
  CardTitle: ({ children }: any) => <div data-testid="card-title">{children}</div>,
  CardDescription: ({ children }: any) => <div data-testid="card-description">{children}</div>,
}))

jest.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, disabled, variant, size, className }: any) => (
    <button 
      onClick={onClick} 
      disabled={disabled} 
      className={className}
      data-variant={variant}
      data-size={size}
    >
      {children}
    </button>
  ),
}))

jest.mock('@/components/ui/table', () => ({
  Table: ({ children }: any) => <table data-testid="table">{children}</table>,
  TableBody: ({ children }: any) => <tbody data-testid="table-body">{children}</tbody>,
  TableCell: ({ children }: any) => <td data-testid="table-cell">{children}</td>,
  TableHead: ({ children }: any) => <th data-testid="table-head">{children}</th>,
  TableHeader: ({ children }: any) => <thead data-testid="table-header">{children}</thead>,
  TableRow: ({ children, onClick, className }: any) => (
    <tr onClick={onClick} className={className} data-testid="table-row">{children}</tr>
  ),
}))

jest.mock('@/components/ui/input', () => ({
  Input: ({ className, onChange, placeholder, value, ...props }: any) => (
    <input 
      className={className} 
      onChange={onChange}
      placeholder={placeholder}
      value={value}
      {...props} 
    />
  ),
}))

jest.mock('@/components/ui/select', () => ({
  Select: ({ children, onValueChange, value }: any) => (
    <div data-testid="select" onClick={() => onValueChange && onValueChange('test-value')}>
      {children}
    </div>
  ),
  SelectContent: ({ children }: any) => <div data-testid="select-content">{children}</div>,
  SelectItem: ({ children, value, onSelect }: any) => (
    <div data-testid="select-item" data-value={value} onClick={() => onSelect && onSelect(value)}>
      {children}
    </div>
  ),
  SelectTrigger: ({ children }: any) => <div data-testid="select-trigger">{children}</div>,
  SelectValue: ({ placeholder }: any) => <span data-testid="select-value">{placeholder}</span>,
}))

jest.mock('@/components/ui/badge', () => ({
  Badge: ({ children, className }: any) => (
    <span className={className} data-testid="badge">{children}</span>
  ),
}))

jest.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, open, onOpenChange }: any) => (
    <div data-testid="dialog-wrapper">
      {children}
      {open && <div data-testid="dialog" onClick={() => onOpenChange?.(false)}>Dialog Content</div>}
    </div>
  ),
  DialogContent: ({ children }: any) => <div data-testid="dialog-content">{children}</div>,
  DialogHeader: ({ children }: any) => <div data-testid="dialog-header">{children}</div>,
  DialogTitle: ({ children }: any) => <div data-testid="dialog-title">{children}</div>,
  DialogDescription: ({ children }: any) => <div data-testid="dialog-description">{children}</div>,
  DialogTrigger: ({ children, asChild }: any) => asChild ? children : <button data-testid="dialog-trigger">{children}</button>,
}))

jest.mock('@/components/ui/alert', () => ({
  Alert: ({ children, variant, className }: any) => (
    <div className={className} data-variant={variant} data-testid="alert">{children}</div>
  ),
  AlertDescription: ({ children }: any) => <div data-testid="alert-description">{children}</div>,
}))

jest.mock('@/components/ui/label', () => ({
  Label: ({ children, ...props }: any) => <label {...props} data-testid="label">{children}</label>,
}))

// Mock IncidentCreationForm
jest.mock('@/components/forms/incident/IncidentCreationForm', () => ({
  IncidentCreationForm: ({ onSubmit, onCancel }: any) => (
    <div data-testid="incident-creation-form">
      <button onClick={() => onSubmit?.({ type: 'Test', description: 'Test desc', location: 'Test loc' })}>
        Submit Form
      </button>
      <button onClick={() => onCancel?.()}>Cancel Form</button>
    </div>
  ),
}))

// Mock hooks
jest.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'test-user', role: 'COORDINATOR' },
    isAuthenticated: true
  })
}))

const mockIncidents = [
  {
    id: '1',
    type: 'Flood',
    subType: 'Flash Flood',
    severity: 'HIGH',
    status: 'ACTIVE',
    description: 'Major flooding in test area',
    location: 'Test Location 1',
    coordinates: { lat: 6.5244, lng: 3.3792 },
    createdAt: '2025-01-26T10:00:00Z',
    populationImpact: {
      totalPopulation: 1000,
      livesLost: 2,
      injured: 5,
      affectedEntities: 3
    }
  },
  {
    id: '2',
    type: 'Fire',
    severity: 'CRITICAL',
    status: 'CONTAINED',
    description: 'Building fire incident',
    location: 'Test Location 2',
    createdAt: '2025-01-26T11:00:00Z',
    populationImpact: {
      totalPopulation: 500,
      livesLost: 0,
      injured: 3,
      affectedEntities: 1
    }
  }
]

describe('IncidentManagement', () => {
  let queryClient: QueryClient
  const mockRefetch = jest.fn()
  const mockMutate = jest.fn()

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })

    // Mock useQuery for incidents
    ;(useQuery as jest.Mock).mockImplementation(({ queryKey }) => {
      if (queryKey[0] === 'incidents') {
        return {
          data: {
            incidents: mockIncidents,
            pagination: { page: 1, limit: 10, total: 2, totalPages: 1 }
          },
          isLoading: false,
          error: null,
          refetch: mockRefetch
        }
      }
      if (queryKey[0] === 'incident-types') {
        return {
          data: ['Flood', 'Fire', 'Earthquake'],
          isLoading: false,
          error: null
        }
      }
      return { data: null, isLoading: false, error: null }
    })

    // Mock useMutation for status updates
    ;(useMutation as jest.Mock).mockReturnValue({
      mutate: mockMutate,
      isPending: false
    })

    jest.clearAllMocks()
  })

  const renderComponent = (props = {}) => {
    return render(
      <QueryClientProvider client={queryClient}>
        <IncidentManagement {...props} />
      </QueryClientProvider>
    )
  }

  describe('component rendering', () => {
    it('renders incident management header', () => {
      renderComponent()
      
      expect(screen.getByText('Incident Management')).toBeInTheDocument()
      expect(screen.getByText(/manage and monitor disaster incidents/i)).toBeInTheDocument()
    })

    it('shows create button when enabled', () => {
      renderComponent({ showCreateButton: true })
      
      expect(screen.getByText('New Incident')).toBeInTheDocument()
    })

    it('hides create button when disabled', () => {
      renderComponent({ showCreateButton: false })
      
      expect(screen.queryByText('New Incident')).not.toBeInTheDocument()
    })

    it('shows real-time updates indicator when enabled', () => {
      renderComponent({ enableRealTimeUpdates: true })
      
      expect(screen.getByText(/real-time updates enabled/i)).toBeInTheDocument()
    })
  })

  describe('incident list rendering', () => {
    it('displays incident data in table format', () => {
      renderComponent()
      
      // Check table structure
      expect(screen.getByTestId('table')).toBeInTheDocument()
      expect(screen.getByTestId('table-header')).toBeInTheDocument()
      expect(screen.getByTestId('table-body')).toBeInTheDocument()
      
      // Check incident data
      expect(screen.getByText('Flood')).toBeInTheDocument()
      expect(screen.getByText('Flash Flood')).toBeInTheDocument()
      expect(screen.getByText('Test Location 1')).toBeInTheDocument()
      expect(screen.getByText('Fire')).toBeInTheDocument()
      expect(screen.getByText('Test Location 2')).toBeInTheDocument()
    })

    it('displays population impact data correctly', () => {
      renderComponent()
      
      expect(screen.getByText('Population: 1000')).toBeInTheDocument()
      expect(screen.getByText('Lives Lost: 2')).toBeInTheDocument()
      expect(screen.getByText('Injured: 5')).toBeInTheDocument()
      expect(screen.getByText('Entities: 3')).toBeInTheDocument()
    })

    it('shows incident count in header', () => {
      renderComponent()
      
      expect(screen.getByText('Incidents (2)')).toBeInTheDocument()
    })

    it('displays empty state when no incidents', () => {
      ;(useQuery as jest.Mock).mockImplementation(({ queryKey }) => {
        if (queryKey[0] === 'incidents') {
          return {
            data: { incidents: [], pagination: { page: 1, limit: 10, total: 0, totalPages: 0 } },
            isLoading: false,
            error: null,
            refetch: mockRefetch
          }
        }
        return { data: [], isLoading: false, error: null }
      })

      renderComponent()
      
      expect(screen.getByText('No incidents found')).toBeInTheDocument()
    })
  })

  describe('filtering functionality', () => {
    it('renders all filter controls', () => {
      renderComponent()
      
      expect(screen.getByPlaceholderText('Search by location...')).toBeInTheDocument()
      expect(screen.getByText('All Statuses')).toBeInTheDocument()
      expect(screen.getByText('All Severities')).toBeInTheDocument()
      expect(screen.getByText('All Types')).toBeInTheDocument()
    })

    it('handles location search filter', async () => {
      renderComponent()
      
      const searchInput = screen.getByPlaceholderText('Search by location...')
      await userEvent.type(searchInput, 'Test Location 1')
      
      expect(searchInput).toHaveValue('Test Location 1')
    })

    it('handles status filter selection', async () => {
      renderComponent()
      
      const statusFilter = screen.getByText('All Statuses').closest('[data-testid="select"]')
      expect(statusFilter).toBeInTheDocument()
    })

    it('handles severity filter selection', async () => {
      renderComponent()
      
      const severityFilter = screen.getByText('All Severities').closest('[data-testid="select"]')
      expect(severityFilter).toBeInTheDocument()
    })
  })

  describe('incident creation', () => {
    it('opens creation dialog when New Incident clicked', async () => {
      renderComponent({ showCreateButton: true })
      
      const newIncidentButton = screen.getByText('New Incident')
      await userEvent.click(newIncidentButton)
      
      expect(screen.getByTestId('dialog')).toBeInTheDocument()
      expect(screen.getByText('Create New Incident')).toBeInTheDocument()
    })

    it('shows incident creation form in dialog', async () => {
      renderComponent({ showCreateButton: true })
      
      const newIncidentButton = screen.getByText('New Incident')
      await userEvent.click(newIncidentButton)
      
      expect(screen.getByTestId('incident-creation-form')).toBeInTheDocument()
    })

    it('handles form submission and closes dialog', async () => {
      renderComponent({ showCreateButton: true })
      
      // Open dialog
      const newIncidentButton = screen.getByText('New Incident')
      await userEvent.click(newIncidentButton)
      
      // Submit form
      const submitButton = screen.getByText('Submit Form')
      await userEvent.click(submitButton)
      
      // Dialog should close and refetch should be called
      await waitFor(() => {
        expect(mockRefetch).toHaveBeenCalled()
      })
    })
  })

  describe('status management', () => {
    it('shows status change dropdowns for each incident', () => {
      renderComponent()
      
      const statusSelects = screen.getAllByTestId('select')
      // Should have filters + status dropdowns for each incident
      expect(statusSelects.length).toBeGreaterThan(4) // 4 filters + incident status dropdowns
    })

    it('handles status change mutation', async () => {
      renderComponent()
      
      // Find and click a status dropdown (assuming it triggers the mutation)
      const statusSelects = screen.getAllByTestId('select')
      const incidentStatusSelect = statusSelects[statusSelects.length - 1] // Last one should be incident status
      
      await userEvent.click(incidentStatusSelect)
      
      // The mock will trigger onValueChange which should call the mutation
      await waitFor(() => {
        expect(mockMutate).toHaveBeenCalled()
      })
    })
  })

  describe('incident selection', () => {
    it('handles incident row clicks', async () => {
      const onIncidentSelect = jest.fn()
      renderComponent({ onIncidentSelect })
      
      const incidentRows = screen.getAllByTestId('table-row')
      // First row should be header, second should be first incident
      const firstIncidentRow = incidentRows[1] 
      
      await userEvent.click(firstIncidentRow)
      
      expect(onIncidentSelect).toHaveBeenCalledWith(expect.objectContaining({
        id: '1',
        type: 'Flood'
      }))
    })

    it('highlights selected incident', () => {
      renderComponent({ selectedIncidentId: '1' })
      
      const incidentRows = screen.getAllByTestId('table-row')
      const selectedRow = incidentRows.find(row => 
        row.className?.includes('bg-blue-50')
      )
      
      expect(selectedRow).toBeInTheDocument()
    })
  })

  describe('loading and error states', () => {
    it('shows loading state', () => {
      ;(useQuery as jest.Mock).mockReturnValue({
        data: null,
        isLoading: true,
        error: null,
        refetch: mockRefetch
      })

      renderComponent()
      
      expect(screen.getByText('Loading incidents...')).toBeInTheDocument()
    })

    it('displays error message when error occurs', () => {
      ;(useQuery as jest.Mock).mockReturnValue({
        data: null,
        isLoading: false,
        error: 'Failed to load incidents',
        refetch: mockRefetch
      })

      renderComponent()
      
      expect(screen.getByTestId('alert')).toBeInTheDocument()
      expect(screen.getByText('Failed to load incidents')).toBeInTheDocument()
    })
  })

  describe('refresh functionality', () => {
    it('shows refresh button', () => {
      renderComponent()
      
      const refreshButton = screen.getByRole('button', { name: /refresh/i })
      expect(refreshButton).toBeInTheDocument()
    })

    it('calls refetch when refresh clicked', async () => {
      renderComponent()
      
      const refreshButton = screen.getByRole('button', { name: /refresh/i })
      await userEvent.click(refreshButton)
      
      expect(mockRefetch).toHaveBeenCalled()
    })
  })

  describe('accessibility', () => {
    it('has proper table structure for screen readers', () => {
      renderComponent()
      
      expect(screen.getByTestId('table')).toBeInTheDocument()
      expect(screen.getByTestId('table-header')).toBeInTheDocument()
      expect(screen.getByTestId('table-body')).toBeInTheDocument()
      expect(screen.getAllByTestId('table-head')).toHaveLength(7) // 7 columns
    })

    it('provides meaningful labels for filter controls', () => {
      renderComponent()
      
      expect(screen.getByText('Search Location')).toBeInTheDocument()
      expect(screen.getByText('Status')).toBeInTheDocument()
      expect(screen.getByText('Severity')).toBeInTheDocument()
      expect(screen.getByText('Type')).toBeInTheDocument()
    })
  })

  describe('real-time updates', () => {
    beforeEach(() => {
      jest.useFakeTimers()
    })

    afterEach(() => {
      jest.useRealTimers()
    })

    it('sets up interval for real-time updates when enabled', () => {
      renderComponent({ enableRealTimeUpdates: true })
      
      // Fast forward time
      jest.advanceTimersByTime(30000) // 30 seconds
      
      expect(mockRefetch).toHaveBeenCalled()
    })

    it('does not set up interval when real-time updates disabled', () => {
      renderComponent({ enableRealTimeUpdates: false })
      
      // Fast forward time
      jest.advanceTimersByTime(30000) // 30 seconds
      
      // Should not have been called from interval (only from initial load)
      expect(mockRefetch).not.toHaveBeenCalled()
    })
  })
})