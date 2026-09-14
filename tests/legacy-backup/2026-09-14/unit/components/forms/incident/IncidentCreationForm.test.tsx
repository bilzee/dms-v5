import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IncidentCreationForm } from '@/components/forms/incident/IncidentCreationForm'
import { useIncident } from '@/hooks/useIncident'
import * as IncidentService from '@/lib/services/incident.service'

// Mock UI components
jest.mock('@/components/ui/select', () => ({
  SelectRoot: ({ children, onValueChange }: any) => <div onChange={(e: any) => onValueChange(e.target.value)}>{children}</div>,
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

jest.mock('@/components/ui/textarea', () => ({
  Textarea: ({ className, ...props }: any) => <textarea className={className} {...props} />,
}));

jest.mock('@/components/ui/button', () => ({
  Button: ({ children, disabled, ...props }: any) => (
    <button disabled={disabled} {...props}>{children}</button>
  ),
}));

jest.mock('@/components/ui/card', () => ({
  Card: ({ children, className }: any) => <div className={className}>{children}</div>,
  CardContent: ({ children }: any) => <div>{children}</div>,
  CardHeader: ({ children }: any) => <div>{children}</div>,
  CardTitle: ({ children }: any) => <div>{children}</div>,
  CardDescription: ({ children }: any) => <div>{children}</div>,
}));

jest.mock('@/components/ui/label', () => ({
  Label: ({ children, ...props }: any) => <label {...props}>{children}</label>,
}));

jest.mock('@/components/ui/alert', () => ({
  Alert: ({ children, className }: any) => <div className={className}>{children}</div>,
  AlertDescription: ({ children }: any) => <div>{children}</div>,
}));

jest.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, open, onOpenChange }: any) => open ? <div onClick={() => onOpenChange?.(false)}>{children}</div> : null,
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <div>{children}</div>,
  DialogDescription: ({ children }: any) => <div>{children}</div>,
  DialogTrigger: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}));

// Mock useIncident hook
const mockCreateIncident = jest.fn()
const mockCreateIncidentFromAssessment = jest.fn()
const mockIncidentTypes = ['Flood', 'Fire', 'Earthquake', 'Storm']

jest.mock('@/hooks/useIncident', () => ({
  useIncident: () => ({
    incidents: [],
    activeIncidents: [],
    criticalIncidents: [],
    isLoading: false,
    error: null,
    incidentTypes: mockIncidentTypes,
    createIncident: mockCreateIncident,
    createIncidentFromAssessment: mockCreateIncidentFromAssessment,
    loadIncidents: jest.fn(),
    loadIncidentTypes: jest.fn(),
    updateIncidentStatus: jest.fn(),
    clearError: jest.fn(),
    setError: jest.fn(),
    getIncidentById: jest.fn()
  })
}))

describe('IncidentCreationForm', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    
    jest.clearAllMocks()
  })

  const renderComponent = (props = {}) => {
    return render(
      <QueryClientProvider client={queryClient}>
        <IncidentCreationForm {...props} />
      </QueryClientProvider>
    )
  }

  describe('form rendering', () => {
    it('renders all required fields', () => {
      renderComponent()
      
      expect(screen.getByLabelText(/incident type/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/description/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/location/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/severity/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/status/i)).toBeInTheDocument()
    })

    it('shows incident type options', () => {
      renderComponent()
      
      mockIncidentTypes.forEach(type => {
        expect(screen.getByText(type)).toBeInTheDocument()
      })
      
      expect(screen.getByText('Custom Type...')).toBeInTheDocument()
    })

    it('displays severity options with correct colors', () => {
      renderComponent()
      
      const severitySelect = screen.getByLabelText(/severity/i)
      fireEvent.click(severitySelect)
      
      expect(screen.getByText('Low')).toBeInTheDocument()
      expect(screen.getByText('Medium')).toBeInTheDocument()
      expect(screen.getByText('High')).toBeInTheDocument()
      expect(screen.getByText('Critical')).toBeInTheDocument()
    })

    it('shows custom type input when custom is selected', async () => {
      renderComponent()
      
      const typeSelect = screen.getByLabelText(/incident type/i)
      fireEvent.click(typeSelect)
      
      const customOption = screen.getByText('Custom Type...')
      fireEvent.click(customOption)
      
      expect(screen.getByPlaceholderText(/enter custom incident type/i)).toBeInTheDocument()
    })
  })

  describe('form validation', () => {
    it('shows validation errors for required fields', async () => {
      renderComponent()
      
      const submitButton = screen.getByRole('button', { name: /submit/i })
      fireEvent.click(submitButton)
      
      await waitFor(() => {
        expect(screen.getByText(/incident type is required/i)).toBeInTheDocument()
        expect(screen.getByText(/description is required/i)).toBeInTheDocument()
        expect(screen.getByText(/location is required/i)).toBeInTheDocument()
      })
    })

    it('validates severity field correctly', async () => {
      renderComponent({
        initialData: {
          type: 'Test',
          description: 'Test Description',
          location: 'Test Location'
        }
      })
      
      // Simulate empty severity
      const severitySelect = screen.getByLabelText(/severity/i)
      fireEvent.change(severitySelect, { target: { value: '' } })
      
      const submitButton = screen.getByRole('button', { name: /submit/i })
      fireEvent.click(submitButton)
      
      await waitFor(() => {
        expect(screen.getByText(/severity is required/i)).toBeInTheDocument()
      })
    })

    it('accepts GPS coordinates when valid', async () => {
      const mockGPS = {
        lat: 6.5244,
        lng: 3.3792
      }
      
      // Mock navigator.geolocation
      Object.defineProperty(global.navigator, 'geolocation', {
        value: {
          getCurrentPosition: jest.fn().mockImplementation(
            (success) => success({
              coords: mockGPS,
              timestamp: Date.now()
            })
          )
        ),
        },
        writable: true,
      })
      
      renderComponent({ gpsEnabled: true })
      
      const locationInput = screen.getByLabelText(/location/i)
      fireEvent.focus(locationInput)
      
      const getGPSCta = await screen.findByTitle(/get gps location/i)
      expect(getGPSCta).toBeInTheDocument()
      
      fireEvent.click(getGPSCta)
      
      await waitFor(() => {
        expect(global.navigator.geolocation.getCurrentPosition).toHaveBeenCalled()
        expect(screen.getByText(/gps: 6\.5244.*, 3\.3792*/i)).toBeInTheDocument()
      })
    })
  })

  describe('form submission', () => {
    it('creates incident with form data', async () => {
      const onSubmitMock = jest.fn()
      renderComponent({
        onSubmit: onSubmitMock,
        initialData: {
          type: 'Test Incident',
          severity: 'HIGH',
          description: 'Test Description',
          location: 'Test Location'
        }
      })
      
      const submitButton = screen.getByRole('button', { name: /create incident/i })
      fireEvent.click(submitButton)
      
      await waitFor(() => {
        expect(onSubmitMock).toHaveBeenCalledWith({
          type: 'Test Incident',
          severity: 'HIGH',
          description: 'Test Description',
          location: 'Test Location'
        })
      })
    })

    it('creates incident from assessment when assessmentId provided', async () => {
      const assessmentId = 'test-assessment-id'
      renderComponent({
        assessmentId,
        initialData: {
          type: 'Test Incident',
          description: 'Test Description',
          location: 'Test Location'
        }
      })
      
      const submitButton = screen.getByRole('button', { name: /create incident/i })
      fireEvent.click(submitButton)
      
      await waitFor(() => {
        expect(mockCreateIncidentFromAssessment).toHaveBeenCalledWith(
          assessmentId,
          expect.objectContaining({
            type: 'Test Incident',
            description: 'Test Description',
            location: 'Test Location'
          })
        )
      })
    })

    it('handles submission errors', async () => {
      mockCreateIncident.mockRejectedValue(new Error('Failed to create incident'))
      
      renderComponent({
        initialData: {
          type: 'Test Incident',
          severity: 'HIGH',
          description: 'Test Description',
          location: 'Test Location'
        }
      })
      
      const submitButton = screen.getByRole('button', { name: /create incident/i })
      fireEvent.click(submitButton)
      
      await waitFor(() => {
        expect(screen.getByText(/failed to create incident/i)).toBeInTheDocument()
      })
    })
  })

  describe('auto-save functionality', () => {
    beforeEach(() => {
      // Setup localStorage mock
      const localStorageMock = {
        getItem: jest.fn(),
        setItem: jest.fn(),
        removeItem: jest.fn(),
      }
      Object.defineProperty(window, 'localStorage', {
        value: localStorageMock,
      })
    })

    it('saves form data to localStorage when auto-save is enabled', async () => {
      renderComponent({ autoSave: true })
      
      // Fill form
      const typeInput = screen.getByLabelText(/incident type/i)
      fireEvent.change(typeInput, { target: { value: 'Test Type' } })
      
      // Wait for auto-save (2 seconds timeout)
      await new Promise(resolve => setTimeout(resolve, 2500))
      
      expect(window.localStorage.setItem).toHaveBeenCalledWith(
        expect.stringMatching(/incident-draft-.+/),
        expect.stringContaining('Test Type')
      )
    })

    it('loads saved draft on mount', async () => {
      const savedDraft = {
        type: 'Saved Type',
        description: 'Saved Description',
        savedAt: new Date().toISOString()
      }
      
      window.localStorage.getItem.mockReturnValue(JSON.stringify(savedDraft))
      
      renderComponent({ autoSave: true })
      
      await waitFor(() => {
        expect(screen.getByDisplayValue('Saved Type')).toBeInTheDocument()
        expect(screen.getByDisplayValue('Saved Description')).toBeInTheDocument()
      })
    })

    it('shows draft status with last saved time', async () => {
      const savedDraft = {
        type: 'Test Type',
        savedAt: '2025-01-26T10:30:00.000Z'
      }
      
      window.localStorage.getItem.mockReturnValue(JSON.stringify(savedDraft))
      
      renderComponent({ autoSave: true })
      
      await waitFor(() => {
        expect(screen.getByText(/draft \(auto-saved: .+\)/)).toBeInTheDocument()
      })
    })
  })

  describe('GPS functionality', () => {
    beforeEach(() => {
      Object.defineProperty(global.navigator, 'geolocation', {
        value: {
          getCurrentPosition: jest.fn(),
        },
        writable: true,
      })
    })

    it('handles GPS location capture', async () => {
      const mockGPS = { lat: 6.5244, lng: 3.3792 }
      
      ;(global.navigator.geolocation.getCurrentPosition as jest.Mock).mockImplementation(
        (success) => success({ coords: mockGPS })
      )
      
      renderComponent({ gpsEnabled: true })
      
      const getGPSButton = await screen.findByTitle(/get gps location/i)
      expect(getGPSButton).toBeInTheDocument()
      
      fireEvent.click(getGPSButton)
      
      await waitFor(() => {
        expect(global.navigator.geolocation.getCurrentPosition).toHaveBeenCalled()
      })
    })

    it('shows loading state while getting GPS location', async () => {
      ;(global.navigator.geolocation.getCurrentPosition as jest.Mock).mockImplementation(
        (success) => setTimeout(() => success({ coords: {} }), 100)
      )
      
      renderComponent({ gpsEnabled: true })
      
      const getGPSButton = await screen.findByTitle(/get gps location/i)
      fireEvent.click(getGPSButton)
      
      // Check for loading spinner
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /loading/i })).toBeInTheDocument()
      })
    })

    it('displays GPS coordinates after successful capture', async () => {
      const mockGPS = { lat: 6.5244, lng: 3.3792 }
      
      ;(global.navigator.geolocation.getCurrentPosition as jest.Mock).mockImplementation(
        (success) => success({ coords: mockGPS })
      )
      
      renderComponent({ gpsEnabled: true })
      
      const getGPSButton = await screen.findByTitle(/get gps location/i)
      fireEvent.click(getGPSButton)
      
      await waitFor(() => {
        expect(screen.getByText(/gps: 6\.5244.*, 3\.3792*/i)).toBeInTheDocument()
      })
    })
  })

  describe('accessibility', () => {
    it('has proper form labels', () => {
      renderComponent()
      
      expect(screen.getByLabelText(/incident type \*/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/location \*/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/description \*/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/severity \*/i)).toBeInTheDocument()
    })

    it('shows severity warnings for critical incidents', () => {
      renderComponent({
        initialData: {
          type: 'Test',
          severity: 'CRITICAL',
          description: 'Test Description',
          location: 'Test Location'
        }
      })
      
      expect(screen.getByText(/critical incident:/i)).toBeInTheDocument()
      expect(screen.getByText(/will be flagged for immediate attention/i)).toBeInTheDocument()
    })
  })

  describe('assessment link functionality', () => {
    it('shows assessment link when assessmentId provided', () => {
      renderComponent({
        assessmentId: 'test-assessment-id',
        showAssessmentLink: true
      })
      
      expect(screen.getByText(/\(from assessment\)/i)).toBeInTheDocument()
    })

    it('hides assessment link when not provided', () => {
      renderComponent({
        assessmentId: undefined,
        showAssessmentLink: false
      })
      
      expect(screen.queryByText(/\(from assessment\)/i)).not.toBeInTheDocument()
    })
  })

  describe('component state management', () => {
    it('respects disabled state', () => {
      renderComponent({ disabled: true })
      
      expect(screen.getByRole('button', { name: /submit/i })).toBeDisabled()
      expect(screen.getByLabelText(/incident type/i)).toBeDisabled()
    })

    it('calls onCancel when cancel button clicked', () => {
      const onCancelMock = jest.fn()
      renderComponent({
        onCancel: onCancelMock
      })
      
      const cancelButton = screen.getByRole('button', { name: /cancel/i })
      fireEvent.click(cancelButton)
      
      expect(onCancelMock).toHaveBeenCalled()
    })
  })
})

/**
 * USAGE INSTRUCTIONS:
 * 
 * 1. Copy this template to: tests/unit/components/forms/incident/IncidentCreationForm.test.tsx
 * 2. Replace {{COMPONENT_NAME}} with "IncidentCreationForm"
 * 3. Update import paths to match actual component location
 * 4. Add specific field assertions based on actual form fields
 * 5. Test GPS functionality with proper geolocation mocking
 * 6. Test auto-save functionality with localStorage mocking
 * 7. Test custom incident type functionality
 * 8. Add accessibility and error handling tests
 */