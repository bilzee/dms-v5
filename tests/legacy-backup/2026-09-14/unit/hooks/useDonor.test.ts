import { describe, it, expect, jest, beforeEach } from '@jest/globals'
import React from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useDonorProfile, useDonorEntities, useDonorAuth } from '@/hooks/useDonor'

// Mock fetch
global.fetch = jest.fn()

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

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false }
    }
  })
}

function renderHookWithQueryClient(hook: () => any) {
  const queryClient = createTestQueryClient()
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    React.createElement(QueryClientProvider, { client: queryClient }, children)
  )
  return renderHook(hook, { wrapper })
}

describe('useDonor', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    localStorageMock.getItem.mockReturnValue('test-token')
  })

  describe('useDonorProfile', () => {
    it('should fetch donor profile successfully', async () => {
      const mockProfileData = {
        donor: {
          id: '1',
          name: 'Test Donor',
          type: 'ORGANIZATION',
          contactEmail: 'test@donor.org',
          contactPhone: '+1234567890',
          organization: 'Test Organization',
          isActive: true,
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-01-01T00:00:00.000Z',
          metrics: {
            commitments: { total: 5, totalCommitted: 100, delivered: 80, deliveryRate: 80 },
            responses: { total: 3 },
            combined: { totalActivities: 8 }
          }
        }
      }

      ;(fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockProfileData
      })

      const { result } = renderHookWithQueryClient(() => useDonorProfile())

      expect(result.current.isLoading).toBe(true)

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
        expect(result.current.profile).toBeDefined()
        expect(result.current.profile?.name).toBe('Test Donor')
      })

      expect(fetch).toHaveBeenCalledWith('/api/v1/donors/profile', {
        headers: {
          'Authorization': 'Bearer test-token'
        }
      })
    })

    it('should handle profile fetch error', async () => {
      ;(fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ error: 'Profile not found' })
      })

      const { result } = renderHookWithQueryClient(() => useDonorProfile())

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
        expect(result.current.error).toBeDefined()
      })

      expect(result.current.profile).toBeUndefined()
    })

    it('should not fetch when no token available', () => {
      localStorageMock.getItem.mockReturnValue(null)

      const { result } = renderHookWithQueryClient(() => useDonorProfile())

      expect(result.current.isLoading).toBe(false)
      expect(result.current.profile).toBeUndefined()
      expect(fetch).not.toHaveBeenCalled()
    })
  })

  describe('useDonorEntities', () => {
    it('should fetch donor entities successfully', async () => {
      const mockEntitiesData = {
        entities: [
          {
            id: '1',
            name: 'Test Entity',
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

      ;(fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockEntitiesData
      })

      const { result } = renderHookWithQueryClient(() => useDonorEntities())

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
        expect(result.current.entities).toHaveLength(1)
        expect(result.current.entities[0].name).toBe('Test Entity')
        expect(result.current.summary?.totalAssigned).toBe(1)
      })

      expect(fetch).toHaveBeenCalledWith('/api/v1/donors/entities?', {
        headers: {
          'Authorization': 'Bearer test-token'
        }
      })
    })

    it('should pass filters to API request', async () => {
      const mockEntitiesData = {
        success: true,
        data: {
          entities: [],
          pagination: { page: 1, limit: 10, total: 0, totalPages: 0, hasNext: false, hasPrev: false },
          summary: { totalAssigned: 0, totalWithResponses: 0, totalWithCommitments: 0 }
        }
      }

      ;(fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockEntitiesData
      })

      const filters = { search: 'test', type: 'HEALTH_FACILITY', page: 2, limit: 10 }
      renderHookWithQueryClient(() => useDonorEntities(filters))

      await waitFor(() => {
        expect(fetch).toHaveBeenCalledWith(
          '/api/v1/donors/entities?search=test&type=HEALTH_FACILITY&page=2&limit=10',
          {
            headers: {
              'Authorization': 'Bearer test-token'
            }
          }
        )
      })
    })
  })

  describe('useDonorAuth', () => {
    it('should determine donor authentication status', async () => {
      const mockProfileData = {
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

      ;(fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockProfileData
      })

      const { result } = renderHookWithQueryClient(() => useDonorAuth())

      await waitFor(() => {
        expect(result.current.isDonor).toBe(true)
        expect(result.current.isProfileComplete).toBe(true)
        expect(result.current.profile?.name).toBe('Test Donor')
      })
    })

    it('should determine incomplete profile status', async () => {
      const mockProfileData = {
        donor: {
          id: '1',
          name: 'Test Donor',
          type: 'ORGANIZATION',
            // Missing contact email and phone
            isActive: true,
            createdAt: '2025-01-01T00:00:00.000Z',
            updatedAt: '2025-01-01T00:00:00.000Z',
            metrics: {
              commitments: { total: 0, totalCommitted: 0, delivered: 0, deliveryRate: 0 },
              responses: { total: 0 },
              combined: { totalActivities: 0 }
            }
        }
      }

      ;(fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockProfileData
      })

      const { result } = renderHookWithQueryClient(() => useDonorAuth())

      await waitFor(() => {
        expect(result.current.isDonor).toBe(true)
        expect(result.current.isProfileComplete).toBe(false)
      })
    })
  })
})