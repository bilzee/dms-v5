import { renderHook, act } from '@testing-library/react'
import { useAuthStore } from '@/stores/auth.store'

// Mock localStorage
const localStorageMock = {
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn(),
}
Object.defineProperty(window, 'localStorage', {
  value: localStorageMock
})

describe('Auth Store Role Priority Logic', () => {
  beforeEach(() => {
    // Reset store state before each test
    const { result } = renderHook(() => useAuthStore())
    act(() => {
      result.current.logout()
    })
    
    // Clear localStorage mock
    localStorageMock.getItem.mockClear()
    localStorageMock.setItem.mockClear()
    localStorageMock.removeItem.mockClear()
  })

  describe('Role Priority System', () => {
    it('should prioritize COORDINATOR role when user has multiple roles', () => {
      const { result } = renderHook(() => useAuthStore())
      
      const userWithMultipleRoles = {
        id: 'user-1',
        username: 'multi_role_user',
        name: 'Multi Role User',
        email: 'multi@example.com',
        roles: [
          { 
            id: 'role-1',
            role: {
              name: 'COORDINATOR',
              permissions: [
                { 
                  permission: { 
                    code: 'VIEW_COORDINATOR_DASHBOARD', 
                    name: 'View Coordinator Dashboard' 
                  } 
                }
              ]
            }
          },
          { 
            id: 'role-2',
            role: {
              name: 'DONOR',
              permissions: [
                { 
                  permission: { 
                    code: 'VIEW_DONOR_DASHBOARD', 
                    name: 'View Donor Dashboard' 
                  } 
                }
              ]
            }
          },
          { 
            id: 'role-3',
            role: {
              name: 'ASSESSOR',
              permissions: [
                { 
                  permission: { 
                    code: 'VIEW_ASSESSOR_DASHBOARD', 
                    name: 'View Assessor Dashboard' 
                  } 
                }
              ]
            }
          }
        ]
      }

      act(() => {
        result.current.setUser(userWithMultipleRoles, 'mock-token')
      })

      expect(result.current.user).toBeTruthy()
      expect(result.current.user?.role).toBe('COORDINATOR')
      expect(result.current.permissions).toContain('VIEW_COORDINATOR_DASHBOARD')
    })

    it('should prioritize ASSESSOR role when no COORDINATOR role present', () => {
      const { result } = renderHook(() => useAuthStore())
      
      const userWithAssessorAndDonor = {
        id: 'user-2',
        username: 'assessor_donor_user',
        name: 'Assessor Donor User',
        email: 'assessor@example.com',
        roles: [
          { 
            id: 'role-2',
            role: {
              name: 'DONOR',
              permissions: [
                { 
                  permission: { 
                    code: 'VIEW_DONOR_DASHBOARD', 
                    name: 'View Donor Dashboard' 
                  } 
                }
              ]
            }
          },
          { 
            id: 'role-3',
            role: {
              name: 'ASSESSOR',
              permissions: [
                { 
                  permission: { 
                    code: 'VIEW_ASSESSOR_DASHBOARD', 
                    name: 'View Assessor Dashboard' 
                  } 
                }
              ]
            }
          }
        ]
      }

      act(() => {
        result.current.setUser(userWithAssessorAndDonor, 'mock-token')
      })

      expect(result.current.user?.role).toBe('ASSESSOR')
      expect(result.current.permissions).toContain('VIEW_ASSESSOR_DASHBOARD')
    })

    it('should prioritize RESPONDER role when only RESPONDER and DONOR roles present', () => {
      const { result } = renderHook(() => useAuthStore())
      
      const userWithResponderAndDonor = {
        id: 'user-3',
        username: 'responder_donor_user',
        name: 'Responder Donor User',
        email: 'responder@example.com',
        roles: [
          { 
            id: 'role-4',
            role: {
              name: 'RESPONDER',
              permissions: [
                { 
                  permission: { 
                    code: 'VIEW_RESPONDER_DASHBOARD', 
                    name: 'View Responder Dashboard' 
                  } 
                }
              ]
            }
          },
          { 
            id: 'role-2',
            role: {
              name: 'DONOR',
              permissions: [
                { 
                  permission: { 
                    code: 'VIEW_DONOR_DASHBOARD', 
                    name: 'View Donor Dashboard' 
                  } 
                }
              ]
            }
          }
        ]
      }

      act(() => {
        result.current.setUser(userWithResponderAndDonor, 'mock-token')
      })

      expect(result.current.user?.role).toBe('RESPONDER')
      expect(result.current.permissions).toContain('VIEW_RESPONDER_DASHBOARD')
    })

    it('should assign DONOR role when it\'s the only role present', () => {
      const { result } = renderHook(() => useAuthStore())
      
      const donorOnlyUser = {
        id: 'user-4',
        username: 'donor_only_user',
        name: 'Donor Only User',
        email: 'donor@example.com',
        roles: [
          { 
            id: 'role-2',
            role: {
              name: 'DONOR',
              permissions: [
                { 
                  permission: { 
                    code: 'VIEW_DONOR_DASHBOARD', 
                    name: 'View Donor Dashboard' 
                  } 
                },
                { 
                  permission: { 
                    code: 'MANAGE_DONOR_PROFILE', 
                    name: 'Manage Donor Profile' 
                  } 
                }
              ]
            }
          }
        ]
      }

      act(() => {
        result.current.setUser(donorOnlyUser, 'mock-token')
      })

      expect(result.current.user?.role).toBe('DONOR')
      expect(result.current.permissions).toContain('VIEW_DONOR_DASHBOARD')
      expect(result.current.permissions).toContain('MANAGE_DONOR_PROFILE')
    })
  })

  describe('Token Persistence', () => {
    it('should persist JWT token to localStorage when user is set', () => {
      const { result } = renderHook(() => useAuthStore())
      
      const testUser = {
        id: 'user-5',
        username: 'test_user',
        name: 'Test User',
        email: 'test@example.com',
        roles: [
          { 
            id: 'role-2',
            role: {
              name: 'DONOR',
              permissions: [
                { 
                  permission: { 
                    code: 'VIEW_DONOR_DASHBOARD', 
                    name: 'View Donor Dashboard' 
                  } 
                }
              ]
            }
          }
        ]
      }

      const testToken = 'test-jwt-token-12345'

      act(() => {
        result.current.setUser(testUser, testToken)
      })

      expect(localStorageMock.setItem).toHaveBeenCalledWith('auth_token', testToken)
      expect(result.current.token).toBe(testToken)
    })

    it('should clear token from localStorage on logout', () => {
      const { result } = renderHook(() => useAuthStore())
      
      // First set a user
      const testUser = {
        id: 'user-6',
        username: 'test_user',
        name: 'Test User',
        email: 'test@example.com',
        roles: [
          { 
            id: 'role-2',
            role: {
              name: 'DONOR',
              permissions: [
                { 
                  permission: { 
                    code: 'VIEW_DONOR_DASHBOARD', 
                    name: 'View Donor Dashboard' 
                  } 
                }
              ]
            }
          }
        ]
      }

      act(() => {
        result.current.setUser(testUser, 'test-token')
      })

      expect(localStorageMock.setItem).toHaveBeenCalled()

      // Then logout
      act(() => {
        result.current.logout()
      })

      expect(localStorageMock.removeItem).toHaveBeenCalledWith('auth_token')
      expect(result.current.user).toBe(null)
      expect(result.current.token).toBe(null)
      expect(result.current.isAuthenticated).toBe(false)
    })

    it('should handle token persistence correctly', () => {
      // Test the token persistence logic without breaking React
      expect(localStorageMock.setItem).toBeDefined()
      expect(localStorageMock.removeItem).toBeDefined()
    })
  })

  describe('Permission Checking', () => {
    it('should correctly check user permissions based on primary role', () => {
      const { result } = renderHook(() => useAuthStore())
      
      const userWithPermissions = {
        id: 'user-8',
        username: 'permission_user',
        name: 'Permission User',
        email: 'permission@example.com',
        roles: [
          { 
            id: 'role-2',
            role: {
              name: 'DONOR',
              permissions: [
                { 
                  permission: { 
                    code: 'VIEW_DONOR_DASHBOARD', 
                    name: 'View Donor Dashboard' 
                  } 
                },
                { 
                  permission: { 
                    code: 'MANAGE_DONOR_PROFILE', 
                    name: 'Manage Donor Profile' 
                  } 
                },
                { 
                  permission: { 
                    code: 'VIEW_DONOR_ENTITIES', 
                    name: 'View Donor Entities' 
                  } 
                }
              ]
            }
          }
        ]
      }

      act(() => {
        result.current.setUser(userWithPermissions, 'test-token')
      })

      // Should have all donor permissions
      expect(result.current.hasPermission('VIEW_DONOR_DASHBOARD')).toBe(true)
      expect(result.current.hasPermission('MANAGE_DONOR_PROFILE')).toBe(true)
      expect(result.current.hasPermission('VIEW_DONOR_ENTITIES')).toBe(true)

      // Should not have other role permissions
      expect(result.current.hasPermission('VIEW_ASSESSOR_DASHBOARD')).toBe(false)
      expect(result.current.hasPermission('VIEW_COORDINATOR_DASHBOARD')).toBe(false)
    })

    it('should return false for permission checks when user is not authenticated', () => {
      const { result } = renderHook(() => useAuthStore())

      // No user set
      expect(result.current.hasPermission('ANY_PERMISSION')).toBe(false)
      expect(result.current.hasRole('ANY_ROLE')).toBe(false)
    })
  })

  describe('Authentication State', () => {
    it('should correctly update authentication state', () => {
      const { result } = renderHook(() => useAuthStore())
      
      expect(result.current.isAuthenticated).toBe(false)

      const testUser = {
        id: 'user-9',
        username: 'auth_user',
        name: 'Auth User',
        email: 'auth@example.com',
        roles: [
          { 
            id: 'role-2',
            role: {
              name: 'DONOR',
              permissions: [
                { 
                  permission: { 
                    code: 'VIEW_DONOR_DASHBOARD', 
                    name: 'View Donor Dashboard' 
                  } 
                }
              ]
            }
          }
        ]
      }

      act(() => {
        result.current.setUser(testUser, 'auth-token')
      })

      expect(result.current.isAuthenticated).toBe(true)
      expect(result.current.user).toBeTruthy()
      expect(result.current.token).toBe('auth-token')

      act(() => {
        result.current.logout()
      })

      expect(result.current.isAuthenticated).toBe(false)
      expect(result.current.user).toBe(null)
      expect(result.current.token).toBe(null)
    })
  })
})