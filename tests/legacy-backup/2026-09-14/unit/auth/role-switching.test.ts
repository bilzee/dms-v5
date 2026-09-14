import { renderHook, act } from '@testing-library/react';
import { useAuthStore } from '@/stores/auth.store';
import { AuthUser, RoleName } from '@/types/auth';

// Mock localStorage
const localStorageMock = {
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn(),
};
Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
});

// Mock fetch
global.fetch = jest.fn();

describe('useAuthStore', () => {
  const mockUser: AuthUser = {
    id: '1',
    email: 'test@example.com',
    username: 'testuser',
    passwordHash: 'hash',
    name: 'Test User',
    isActive: true,
    isLocked: false,
    roles: [
      {
        role: {
          id: '1',
          name: 'ASSESSOR' as RoleName,
          description: 'Assessor role',
          permissions: [
            { permission: { id: '1', code: 'ASSESSMENT_CREATE', name: 'Create Assessment', category: 'assessment', description: 'Can create assessments' } }
          ]
        }
      },
      {
        role: {
          id: '2', 
          name: 'COORDINATOR' as RoleName,
          description: 'Coordinator role',
          permissions: [
            { permission: { id: '2', code: 'RESPONSE_MANAGE', name: 'Manage Response', category: 'response', description: 'Can manage responses' } }
          ]
        }
      }
    ],
    createdAt: new Date(),
    updatedAt: new Date()
  };

  beforeEach(() => {
    // Reset store before each test
    useAuthStore.setState({
      user: null,
      token: null,
      isAuthenticated: false,
      isLoading: false,
      permissions: [],
      roles: [],
      currentRole: null,
      availableRoles: [],
      roleSessionState: {}
    });
    
    // Clear all mocks
    jest.clearAllMocks();
  });

  describe('Role Switching', () => {
    it('should switch role when user has the role', () => {
      // Setup initial state
      useAuthStore.setState({
        user: mockUser,
        token: 'token',
        isAuthenticated: true,
        roles: ['ASSESSOR', 'COORDINATOR'],
        availableRoles: ['ASSESSOR', 'COORDINATOR'],
        currentRole: 'ASSESSOR',
        permissions: ['ASSESSMENT_CREATE']
      });

      const { result } = renderHook(() => useAuthStore());

      act(() => {
        result.current.switchRole('COORDINATOR');
      });

      expect(result.current.currentRole).toBe('COORDINATOR');
    });

    it('should throw error when switching to non-assigned role', () => {
      // Setup initial state
      useAuthStore.setState({
        user: mockUser,
        token: 'token',
        isAuthenticated: true,
        roles: ['ASSESSOR', 'COORDINATOR'],
        availableRoles: ['ASSESSOR', 'COORDINATOR'],
        currentRole: 'ASSESSOR',
        permissions: ['ASSESSMENT_CREATE']
      });

      const { result } = renderHook(() => useAuthStore());

      expect(() => {
        act(() => {
          result.current.switchRole('ADMIN');
        });
      }).toThrow('Cannot switch to role: ADMIN. Role not assigned to user.');

      expect(result.current.currentRole).toBe('ASSESSOR');
    });

    it('should check if user can switch to role', () => {
      useAuthStore.setState({
        user: mockUser,
        token: 'token',
        isAuthenticated: true,
        roles: ['ASSESSOR', 'COORDINATOR'],
        availableRoles: ['ASSESSOR', 'COORDINATOR'],
        currentRole: 'ASSESSOR',
        permissions: ['ASSESSMENT_CREATE']
      });

      const { result } = renderHook(() => useAuthStore());

      expect(result.current.canSwitchToRole('ASSESSOR')).toBe(true);
      expect(result.current.canSwitchToRole('COORDINATOR')).toBe(true);
      expect(result.current.canSwitchToRole('ADMIN')).toBe(false);
    });
  });

  describe('Role Session Management', () => {
    it('should save role session data', () => {
      useAuthStore.setState({
        user: mockUser,
        token: 'token',
        isAuthenticated: true,
        roles: ['ASSESSOR', 'COORDINATOR'],
        availableRoles: ['ASSESSOR', 'COORDINATOR'],
        currentRole: 'ASSESSOR',
        permissions: ['ASSESSMENT_CREATE'],
        roleSessionState: {}
      });

      const { result } = renderHook(() => useAuthStore());

      const sessionData = {
        activeDashboard: '/assessor/dashboard',
        formData: { field1: 'value1' }
      };

      act(() => {
        result.current.saveRoleSession('ASSESSOR', sessionData);
      });

      expect(result.current.roleSessionState['ASSESSOR']).toEqual(sessionData);
    });

    it('should retrieve role session data', () => {
      const sessionData = {
        activeDashboard: '/assessor/dashboard',
        formData: { field1: 'value1' }
      };

      useAuthStore.setState({
        user: mockUser,
        token: 'token',
        isAuthenticated: true,
        roles: ['ASSESSOR', 'COORDINATOR'],
        availableRoles: ['ASSESSOR', 'COORDINATOR'],
        currentRole: 'ASSESSOR',
        permissions: ['ASSESSMENT_CREATE'],
        roleSessionState: {
          'ASSESSOR': sessionData
        }
      });

      const { result } = renderHook(() => useAuthStore());

      expect(result.current.getRoleSession('ASSESSOR')).toEqual(sessionData);
      expect(result.current.getRoleSession('COORDINATOR')).toBeUndefined();
    });

    it('should clear role session data', () => {
      const sessionData = {
        activeDashboard: '/assessor/dashboard',
        formData: { field1: 'value1' }
      };

      useAuthStore.setState({
        user: mockUser,
        token: 'token',
        isAuthenticated: true,
        roles: ['ASSESSOR', 'COORDINATOR'],
        availableRoles: ['ASSESSOR', 'COORDINATOR'],
        currentRole: 'ASSESSOR',
        permissions: ['ASSESSMENT_CREATE'],
        roleSessionState: {
          'ASSESSOR': sessionData,
          'COORDINATOR': { activeDashboard: '/coordinator/dashboard' }
        }
      });

      const { result } = renderHook(() => useAuthStore());

      act(() => {
        result.current.clearRoleSession('ASSESSOR');
      });

      expect(result.current.roleSessionState['ASSESSOR']).toBeUndefined();
      expect(result.current.roleSessionState['COORDINATOR']).toEqual({
        activeDashboard: '/coordinator/dashboard'
      });
    });
  });

  describe('Current Role Permissions', () => {
    it('should return permissions for current role', () => {
      useAuthStore.setState({
        user: mockUser,
        token: 'token',
        isAuthenticated: true,
        roles: ['ASSESSOR', 'COORDINATOR'],
        availableRoles: ['ASSESSOR', 'COORDINATOR'],
        currentRole: 'ASSESSOR',
        permissions: ['ASSESSMENT_CREATE']
      });

      const { result } = renderHook(() => useAuthStore());

      expect(result.current.getCurrentRolePermissions()).toEqual(['ASSESSMENT_CREATE']);
    });

    it('should return empty array when no current role', () => {
      useAuthStore.setState({
        user: null,
        token: null,
        isAuthenticated: false,
        roles: [],
        availableRoles: [],
        currentRole: null,
        permissions: []
      });

      const { result } = renderHook(() => useAuthStore());

      expect(result.current.getCurrentRolePermissions()).toEqual([]);
    });
  });

  describe('User Setup', () => {
    it('should set first available role as current if none set', () => {
      useAuthStore.setState({
        user: null,
        token: null,
        isAuthenticated: false,
        roles: [],
        availableRoles: [],
        currentRole: null,
        permissions: []
      });

      const { result } = renderHook(() => useAuthStore());

      act(() => {
        result.current.setUser(mockUser, 'token');
      });

      expect(result.current.currentRole).toBe('ASSESSOR'); // First role in the array
      expect(result.current.availableRoles).toEqual(['ASSESSOR', 'COORDINATOR']);
    });

    it('should preserve current role if already set', () => {
      useAuthStore.setState({
        user: null,
        token: null,
        isAuthenticated: false,
        roles: [],
        availableRoles: [],
        currentRole: 'COORDINATOR',
        permissions: []
      });

      const { result } = renderHook(() => useAuthStore());

      act(() => {
        result.current.setUser(mockUser, 'token');
      });

      expect(result.current.currentRole).toBe('COORDINATOR');
    });
  });

  describe('Logout', () => {
    it('should clear all state including role state', () => {
      useAuthStore.setState({
        user: mockUser,
        token: 'token',
        isAuthenticated: true,
        roles: ['ASSESSOR', 'COORDINATOR'],
        availableRoles: ['ASSESSOR', 'COORDINATOR'],
        currentRole: 'ASSESSOR',
        permissions: ['ASSESSMENT_CREATE'],
        roleSessionState: {
          'ASSESSOR': { activeDashboard: '/assessor/dashboard' }
        }
      });

      const { result } = renderHook(() => useAuthStore());

      act(() => {
        result.current.logout();
      });

      expect(result.current.user).toBeNull();
      expect(result.current.token).toBeNull();
      expect(result.current.isAuthenticated).toBe(false);
      expect(result.current.roles).toEqual([]);
      expect(result.current.currentRole).toBeNull();
      expect(result.current.availableRoles).toEqual([]);
      expect(result.current.roleSessionState).toEqual({});
    });
  });
});