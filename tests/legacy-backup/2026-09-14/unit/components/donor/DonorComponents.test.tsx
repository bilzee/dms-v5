import { describe, it, expect, jest, beforeEach } from '@jest/globals'
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { DonorProfile } from '@/components/donor/DonorProfile'
import { EntitySelector } from '@/components/donor/EntitySelector'
import { toast } from 'sonner'

// Mock fetch
global.fetch = jest.fn()

// Mock toast
jest.mock('sonner', () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn()
  }
}))

// Mock localStorage
const localStorageMock = {
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn()
}
Object.defineProperty(window, 'localStorage', {
  value: localStorageMock
})

// Mock useAuthStore
jest.mock('@/stores/auth.store', () => ({
  useAuthStore: () => ({
    user: { id: '1', name: 'Test User' }
  })
}))

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false }
    }
  })
}

function renderWithQueryClient(component: React.ReactElement) {
  const queryClient = createTestQueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      {component}
    </QueryClientProvider>
  )
}

describe('DonorProfile Component', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    localStorageMock.getItem.mockReturnValue('test-token')
  })

  it('should display donor profile information', async () => {
    const mockProfileData = {
      success: true,
      data: {
        donor: {
          id: '1',
          name: 'Test Donor Organization',
          type: 'ORGANIZATION',
          contactEmail: 'test@donor.org',
          contactPhone: '+1234567890',
          organization: 'Test Organization Details',
          isActive: true,
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-01-01T00:00:00.000Z',
          metrics: {
            commitments: {
              total: 5,
              totalCommitted: 100,
              delivered: 80,
              deliveryRate: 80
            },
            responses: {
              total: 3
            },
            combined: {
              totalActivities: 8
            }
          }
        }
      }
    }

    ;(fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => mockProfileData
    })

    renderWithQueryClient(<DonorProfile />)

    await waitFor(() => {
      expect(screen.getByText('Test Donor Organization')).toBeInTheDocument()
      expect(screen.getByText('test@donor.org')).toBeInTheDocument()
      expect(screen.getByText('+1234567890')).toBeInTheDocument()
      expect(screen.getByText('Test Organization Details')).toBeInTheDocument()
    })

    expect(screen.getByText('Organization Information')).toBeInTheDocument()
    expect(screen.getByText('Performance Metrics')).toBeInTheDocument()
  })

  it('should enable profile editing mode', async () => {
    const mockProfileData = {
      success: true,
      data: {
        donor: {
          id: '1',
          name: 'Test Donor',
          type: 'ORGANIZATION',
          contactEmail: 'test@donor.org',
          isActive: true,
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-01-01T00:00:00.000Z',
          metrics: {
            commitments: { total: 1, totalCommitted: 10, delivered: 8, deliveryRate: 80 },
            responses: { total: 1 },
            combined: { totalActivities: 2 }
          }
        }
      }
    }

    ;(fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => mockProfileData
    })

    renderWithQueryClient(<DonorProfile />)

    await waitFor(() => {
      expect(screen.getByText('Edit Profile')).toBeInTheDocument()
    })

    // Click edit button
    fireEvent.click(screen.getByText('Edit Profile'))

    // Should show form fields
    await waitFor(() => {
      expect(screen.getByLabelText('Organization Name')).toBeInTheDocument()
      expect(screen.getByLabelText('Contact Email')).toBeInTheDocument()
      expect(screen.getByText('Save')).toBeInTheDocument()
      expect(screen.getByText('Cancel')).toBeInTheDocument()
    })
  })

  it('should save profile changes', async () => {
    const mockProfileData = {
      success: true,
      data: {
        donor: {
          id: '1',
          name: 'Test Donor',
          type: 'ORGANIZATION',
          contactEmail: 'test@donor.org',
          isActive: true,
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-01-01T00:00:00.000Z',
          metrics: {
            commitments: { total: 1, totalCommitted: 10, delivered: 8, deliveryRate: 80 },
            responses: { total: 1 },
            combined: { totalActivities: 2 }
          }
        }
      }
    }

    const mockUpdateResponse = {
      success: true,
      data: {
        donor: {
          id: '1',
          name: 'Updated Donor Organization',
          type: 'ORGANIZATION',
          contactEmail: 'updated@donor.org',
          isActive: true,
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-01-02T00:00:00.000Z'
        }
      }
    }

    ;(fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockProfileData
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockUpdateResponse
      })

    renderWithQueryClient(<DonorProfile />)

    await waitFor(() => {
      expect(screen.getByText('Edit Profile')).toBeInTheDocument()
    })

    // Enter edit mode
    fireEvent.click(screen.getByText('Edit Profile'))

    await waitFor(() => {
      expect(screen.getByLabelText('Organization Name')).toBeInTheDocument()
    })

    // Update fields
    const nameInput = screen.getByLabelText('Organization Name')
    const emailInput = screen.getByLabelText('Contact Email')

    fireEvent.change(nameInput, { target: { value: 'Updated Donor Organization' } })
    fireEvent.change(emailInput, { target: { value: 'updated@donor.org' } })

    // Save changes
    fireEvent.click(screen.getByText('Save'))

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('Profile updated successfully')
    })

    // Verify PATCH request was made
    expect(fetch).toHaveBeenCalledWith('/api/v1/donors/profile', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer test-token'
      },
      body: JSON.stringify({
        name: 'Updated Donor Organization',
        contactEmail: 'updated@donor.org'
      })
    })
  })

  it('should cancel profile editing', async () => {
    const mockProfileData = {
      success: true,
      data: {
        donor: {
          id: '1',
          name: 'Test Donor',
          type: 'ORGANIZATION',
          contactEmail: 'test@donor.org',
          isActive: true,
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-01-01T00:00:00.000Z',
          metrics: {
            commitments: { total: 1, totalCommitted: 10, delivered: 8, deliveryRate: 80 },
            responses: { total: 1 },
            combined: { totalActivities: 2 }
          }
        }
      }
    }

    ;(fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => mockProfileData
    })

    renderWithQueryClient(<DonorProfile />)

    await waitFor(() => {
      expect(screen.getByText('Edit Profile')).toBeInTheDocument()
    })

    // Enter edit mode
    fireEvent.click(screen.getByText('Edit Profile'))

    await waitFor(() => {
      expect(screen.getByLabelText('Organization Name')).toBeInTheDocument()
    })

    // Modify a field
    const nameInput = screen.getByLabelText('Organization Name')
    fireEvent.change(nameInput, { target: { value: 'Modified Name' } })

    // Cancel editing
    fireEvent.click(screen.getByText('Cancel'))

    await waitFor(() => {
      expect(screen.getByText('Edit Profile')).toBeInTheDocument()
    })

    // Should show original value
    expect(screen.getByText('Test Donor')).toBeInTheDocument()
  })

  it('should calculate profile completion percentage', async () => {
    const mockProfileData = {
      success: true,
      data: {
        donor: {
          id: '1',
          name: 'Test Donor',
          type: 'ORGANIZATION',
          // Missing optional fields
          isActive: true,
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-01-01T00:00:00.000Z',
          metrics: {
            commitments: { total: 1, totalCommitted: 10, delivered: 8, deliveryRate: 80 },
            responses: { total: 1 },
            combined: { totalActivities: 2 }
          }
        }
      }
    }

    ;(fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => mockProfileData
    })

    renderWithQueryClient(<DonorProfile />)

    await waitFor(() => {
      expect(screen.getByText('Profile Completion')).toBeInTheDocument()
    })

    // Should show completion percentage
    const progressBar = screen.getByRole('progressbar').first()
    expect(progressBar).toBeInTheDocument()
  })

  it('should handle profile loading error', async () => {
    ;(fetch as any).mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ error: 'Profile not found' })
    })

    renderWithQueryClient(<DonorProfile />)

    await waitFor(() => {
      expect(screen.getByText('Failed to load donor profile')).toBeInTheDocument()
    })
  })
})

describe('EntitySelector Component', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    localStorageMock.getItem.mockReturnValue('test-token')
  })

  it('should display assigned entities', async () => {
    const mockEntitiesData = {
      success: true,
      data: {
        entities: [
          {
            id: '1',
            name: 'Test Health Facility',
            type: 'HEALTH_FACILITY',
            location: 'Test Location',
            isActive: true,
            autoApproveEnabled: true,
            createdAt: '2025-01-01T00:00:00.000Z',
            stats: {
              verifiedAssessments: 2,
              responses: 1,
              commitments: 1
            }
          }
        ],
        pagination: {
          page: 1,
          limit: 20,
          total: 1,
          totalPages: 1,
          hasNext: false,
          hasPrev: false
        },
        summary: {
          totalAssigned: 1,
          totalWithResponses: 1,
          totalWithCommitments: 1
        }
      }
    }

    ;(fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => mockEntitiesData
    })

    renderWithQueryClient(<EntitySelector />)

    await waitFor(() => {
      expect(screen.getByText('Assigned Entities')).toBeInTheDocument()
      expect(screen.getByText('Test Health Facility')).toBeInTheDocument()
      expect(screen.getByText('HEALTH_FACILITY')).toBeInTheDocument()
      expect(screen.getByText('Test Location')).toBeInTheDocument()
    })

    // Should show summary stats
    expect(screen.getByText('Total Assigned')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument() // Total assigned count
  })

  it('should search and filter entities', async () => {
    const mockEntitiesData = {
      success: true,
      data: {
        entities: [],
        pagination: { page: 1, limit: 20, total: 0, totalPages: 0, hasNext: false, hasPrev: false },
        summary: { totalAssigned: 0, totalWithResponses: 0, totalWithCommitments: 0 }
      }
    }

    ;(fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => mockEntitiesData
    })

    renderWithQueryClient(<EntitySelector />)

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Search entities by name, type, or location...')).toBeInTheDocument()
    })

    // Test search
    const searchInput = screen.getByPlaceholderText('Search entities by name, type, or location...')
    fireEvent.change(searchInput, { target: { value: 'test search' } })

    // Should make API call with search parameter
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('search=test%20search'),
        expect.objectContaining({
          headers: {
            'Authorization': 'Bearer test-token'
          }
        })
      )
    })
  })

  it('should handle empty entities list', async () => {
    const mockEntitiesData = {
      success: true,
      data: {
        entities: [],
        pagination: { page: 1, limit: 20, total: 0, totalPages: 0, hasNext: false, hasPrev: false },
        summary: { totalAssigned: 0, totalWithResponses: 0, totalWithCommitments: 0 }
      }
    }

    ;(fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => mockEntitiesData
    })

    renderWithQueryClient(<EntitySelector />)

    await waitFor(() => {
      expect(screen.getByText('No entities found')).toBeInTheDocument()
      expect(screen.getByText("You haven't been assigned to any entities yet")).toBeInTheDocument()
    })
  })

  it('should show entity activity levels', async () => {
    const mockEntitiesData = {
      success: true,
      data: {
        entities: [
          {
            id: '1',
            name: 'High Activity Entity',
            type: 'HEALTH_FACILITY',
            location: 'Test Location',
            isActive: true,
            autoApproveEnabled: true,
            createdAt: '2025-01-01T00:00:00.000Z',
            stats: {
              verifiedAssessments: 5,
              responses: 3,
              commitments: 2
            }
          }
        ],
        pagination: { page: 1, limit: 20, total: 1, totalPages: 1, hasNext: false, hasPrev: false },
        summary: { totalAssigned: 1, totalWithResponses: 1, totalWithCommitments: 1 }
      }
    }

    ;(fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => mockEntitiesData
    })

    renderWithQueryClient(<EntitySelector />)

    await waitFor(() => {
      expect(screen.getByText('High Activity Entity')).toBeInTheDocument()
      // Should show activity level (High Activity for 10 total activities)
      expect(screen.getByText('High Activity')).toBeInTheDocument()
    })
  })
})