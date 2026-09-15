import '@testing-library/jest-dom';
import React from 'react';

// Mock Zustand - consolidated mock
const mockStore = {
  user: null,
  token: null,
  isAuthenticated: false,
  isLoading: false,
  permissions: [],
  roles: [],
  currentRole: null,
  availableRoles: [],
  roleSessionState: {},
  login: jest.fn(),
  logout: jest.fn(function() {
    // Remove token from localStorage
    if (typeof window !== 'undefined') {
      localStorage.removeItem('auth_token');
    }
    mockStore.user = null;
    mockStore.token = null;
    mockStore.isAuthenticated = false;
    mockStore.roles = [];
    mockStore.currentRole = null;
    mockStore.permissions = [];
    mockStore.availableRoles = [];
    mockStore.roleSessionState = {};
  }),
  refresh: jest.fn(),
  setUser: jest.fn(function(user: any, token: string) {
    mockStore.user = user;
    mockStore.token = token;
    mockStore.isAuthenticated = true;
    const userRoles = user?.roles?.map((ur: any) => ur.role.name) || [];
    mockStore.roles = userRoles;
    mockStore.availableRoles = userRoles;
    
    // Role priority logic matching real auth store
    const getHighestPriorityRole = (roleList: string[]) => {
      if (roleList.length === 0) return null;
      const rolePriority = ['COORDINATOR', 'ASSESSOR', 'RESPONDER', 'DONOR', 'ADMIN'];
      return roleList.reduce((highest: string | null, role: string) => {
        if (!highest) return role;
        return rolePriority.indexOf(role) < rolePriority.indexOf(highest) ? role : highest;
      }, null);
    };
    
    const highestPriorityRole = getHighestPriorityRole(userRoles);
    
    // Add role property to user object to match real behavior
    mockStore.user = {
      ...user,
      role: highestPriorityRole
    };
    
    // Preserve current role if it exists in the user's roles, otherwise set to highest priority role
    if (mockStore.currentRole && userRoles.includes(mockStore.currentRole)) {
      // Keep existing currentRole
    } else {
      mockStore.currentRole = highestPriorityRole;
    }
    
    // Extract permissions from the nested permission objects
    const permissions = Array.from(
      new Set(
        user?.roles?.flatMap((ur: any) => 
          ur.role.permissions?.map((rp: any) => rp.permission.code) || []
        ) || []
      )
    );
    mockStore.permissions = permissions;
    
    // Set token in localStorage if window is available
    if (typeof window !== 'undefined') {
      localStorage.setItem('auth_token', token);
    }
  }),
  switchRole: jest.fn(function(role: string) {
    if (!mockStore.roles.includes(role)) {
      throw new Error(`Cannot switch to role: ${role}. Role not assigned to user.`);
    }
    mockStore.currentRole = role;
  }),
  canSwitchToRole: jest.fn(function(role: string) {
    return mockStore.roles.includes(role);
  }),
  saveRoleSession: jest.fn(function(role: string, data: any) {
    mockStore.roleSessionState[role] = { ...mockStore.roleSessionState[role], ...data };
  }),
  getRoleSession: jest.fn(function(role: string) {
    return mockStore.roleSessionState[role];
  }),
  clearRoleSession: jest.fn(function(role: string) {
    delete mockStore.roleSessionState[role];
  }),
  hasPermission: jest.fn(function(permission: string) {
    return mockStore.permissions.includes(permission);
  }),
  hasRole: jest.fn(function(role: string) {
    return mockStore.roles.includes(role);
  }),
  hasAnyRole: jest.fn(function(...roles: string[]) {
    return roles.some(role => mockStore.roles.includes(role));
  }),
  getCurrentRolePermissions: jest.fn(function() {
    return mockStore.permissions;
  }),
  setState: jest.fn(function(state: any) {
    if (typeof state === 'function') {
      const newState = state(mockStore);
      Object.assign(mockStore, newState);
    } else {
      Object.assign(mockStore, state);
    }
  }),
};

const createMock = jest.fn(() => jest.fn(() => mockStore));

jest.mock('zustand', () => ({
  create: createMock,
}));

// Export the mock for tests to use
(global as any).__mockStore = mockStore;
(global as any).__createMock = createMock;

// Mock the auth store specifically
const mockUseAuthStore = jest.fn(() => mockStore);
mockUseAuthStore.setState = jest.fn((state: any) => {
  Object.assign(mockStore, state);
});

jest.mock('@/stores/auth.store', () => ({
  useAuthStore: mockUseAuthStore,
}));

jest.mock('zustand/middleware', () => ({
  persist: (fn: any) => fn,
  createJSONStorage: () => ({}),
}));

// Mock Next.js router
jest.mock('next/navigation', () => ({
  useRouter() {
    return {
      push: jest.fn(),
      replace: jest.fn(),
      back: jest.fn(),
      forward: jest.fn(),
      refresh: jest.fn(),
      prefetch: jest.fn(),
    };
  },
  useSearchParams() {
    return new URLSearchParams();
  },
  usePathname() {
    return '/assessor';
  },
}));

// Mock React Hook Form
jest.mock('react-hook-form', () => ({
  useForm: jest.fn(() => ({
    register: jest.fn(),
    handleSubmit: jest.fn((callback) => (e) => {
      e.preventDefault();
      callback({
        rapidAssessmentDate: new Date(),
        affectedEntityId: 'entity-1',
        assessorName: 'Test Assessor',
        hasFunctionalClinic: false,
        numberHealthFacilities: 0,
        healthFacilityType: '',
        qualifiedHealthWorkers: 0,
        hasMedicineSupply: false,
        hasMedicalSupplies: false,
        hasMaternalChildServices: false,
        commonHealthIssues: [],
        additionalHealthDetails: '',
      });
    }),
    formState: { errors: {}, isValid: true, isSubmitting: false },
    setValue: jest.fn(),
    getValues: jest.fn(),
    watch: jest.fn(),
    reset: jest.fn(),
    trigger: jest.fn(),
  })),
  Controller: ({ render }) => render(),
}));

// Mock Prisma
jest.mock('@prisma/client', () => ({
  // Prisma 6 const-object enums (string-valued, matching the generated client)
  AssessmentType: {
    HEALTH: 'HEALTH',
    WASH: 'WASH',
    SHELTER: 'SHELTER',
    FOOD: 'FOOD',
    SECURITY: 'SECURITY',
    POPULATION: 'POPULATION',
  },
  Priority: {
    CRITICAL: 'CRITICAL',
    HIGH: 'HIGH',
    MEDIUM: 'MEDIUM',
    LOW: 'LOW',
    UNCLASSIFIED: 'UNCLASSIFIED',
  },
  PrismaClient: jest.fn().mockImplementation(() => ({
    $transaction: jest.fn(),
    rapidAssessment: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    // Question registry (dynamic-question-registry data layer)
    question: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      upsert: jest.fn(),
      count: jest.fn(),
    },
    questionSection: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      upsert: jest.fn(),
    },
    questionAuditLog: {
      create: jest.fn(),
    },
    systemSetting: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      upsert: jest.fn(),
    },
  })),
}));

// Mock geolocation
Object.defineProperty(global.navigator, 'geolocation', {
  value: {
    getCurrentPosition: jest.fn((success) => {
      success({
        coords: {
          latitude: 11.506,
          longitude: 13.098,
          accuracy: 10,
        },
        timestamp: Date.now(),
      });
    }),
    watchPosition: jest.fn(),
    clearWatch: jest.fn(),
  },
  writable: true,
});

// Mock FileReader
Object.defineProperty(global, 'FileReader', {
  value: jest.fn().mockImplementation(() => ({
    onload: null,
    readAsDataURL: jest.fn(function() {
      if (this.onload) {
        this.onload({ target: { result: 'data:image/jpeg;base64,test' } });
      }
    }),
  })),
  writable: true,
});

// Mock File
Object.defineProperty(global, 'File', {
  value: jest.fn().mockImplementation(function(chunks: any[], name: string, options: any) {
    this.chunks = chunks;
    this.name = name;
    this.options = options;
    this.size = chunks.reduce((total: number, chunk: any) => total + (chunk.size || 0), 0);
    this.type = options?.type || '';
  }),
  writable: true,
});

// Mock localStorage
const localStorageMock = {
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn(),
};
Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
  writable: true,
});

// Mock IndexedDB
const indexedDBMock = {
  open: jest.fn(),
  deleteDatabase: jest.fn(),
  cmp: jest.fn(),
};
Object.defineProperty(window, 'indexedDB', {
  value: indexedDBMock,
  writable: true,
});

// Mock fetch and related Web APIs
global.fetch = jest.fn();

// Mock NextRequest properly
jest.mock('next/server', () => ({
  NextRequest: class MockNextRequest {
    url: string;
    method: string;
    headers: any;
    
    constructor(url: string, options: any = {}) {
      this.url = url;
      this.method = options.method || 'GET';
      this.headers = new Map();
      if (options.headers) {
        Object.entries(options.headers).forEach(([key, value]) => {
          this.headers.set(key.toLowerCase(), value);
        });
      }
    }
    
    json() { return Promise.resolve({}); }
    text() { return Promise.resolve(''); }
  },
  NextResponse: {
    json: (body: any, options?: any) => ({
      status: options?.status || 200,
      json: () => Promise.resolve(body)
    })
  }
}));

// Mock Request class with proper Headers
global.Request = class MockRequest {
  url: string;
  method: string;
  headers: any;
  
  constructor(url: string, options: any = {}) {
    this.url = url;
    this.method = options.method || 'GET';
    this.headers = new Map();
    if (options.headers) {
      Object.entries(options.headers).forEach(([key, value]) => {
        this.headers.set(key.toLowerCase(), value);
      });
    }
  }
} as any;

// Mock Response class
global.Response = class MockResponse {
  status: number;
  statusText: string;
  headers: any;
  
  constructor(body?: any, options: any = {}) {
    this.status = options.status || 200;
    this.statusText = options.statusText || 'OK';
    this.headers = new Map();
  }
  
  json() { return Promise.resolve({}); }
  text() { return Promise.resolve(''); }
} as any;

// Mock Headers class
global.Headers = class MockHeaders {
  private map = new Map();
  
  set(name: string, value: string) { this.map.set(name.toLowerCase(), value); }
  get(name: string) { return this.map.get(name.toLowerCase()); }
  has(name: string) { return this.map.has(name.toLowerCase()); }
  delete(name: string) { this.map.delete(name.toLowerCase()); }
  entries() { return this.map.entries(); }
} as any;

// Mock IntersectionObserver
global.IntersectionObserver = class IntersectionObserver {
  constructor() {}
  disconnect() {}
  observe() {}
  unobserve() {}
};

// Mock ResizeObserver
global.ResizeObserver = class ResizeObserver {
  constructor() {}
  disconnect() {}
  observe() {}
  unobserve() {}
};

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: jest.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: jest.fn(), // deprecated
    removeListener: jest.fn(), // deprecated
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  })),
});

// Setup test environment
process.env.NODE_ENV = 'test';

// Polyfill for TextEncoder and TextDecoder for integration tests
import { TextEncoder, TextDecoder } from 'util'
global.TextEncoder = TextEncoder
global.TextDecoder = TextDecoder

// Mock FormData
global.FormData = class MockFormData {
  private data = new Map<string, any>()
  
  append(name: string, value: any) {
    this.data.set(name, value)
  }
  
  get(name: string) {
    return this.data.get(name)
  }
  
  entries() {
    return this.data.entries()
  }
} as any

// Mock all UI components for testing
jest.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, ...props }: any) => 
    React.createElement('button', { onClick, ...props }, children)
}))

jest.mock('@/components/ui/card', () => ({
  Card: ({ children, ...props }: any) => 
    React.createElement('div', { 'data-testid': 'card', ...props }, children),
  CardHeader: ({ children, ...props }: any) => 
    React.createElement('div', { 'data-testid': 'card-header', ...props }, children),
  CardContent: ({ children, ...props }: any) => 
    React.createElement('div', { 'data-testid': 'card-content', ...props }, children),
  CardDescription: ({ children, ...props }: any) => 
    React.createElement('p', { 'data-testid': 'card-description', ...props }, children),
  CardTitle: ({ children, ...props }: any) => 
    React.createElement('h3', { 'data-testid': 'card-title', ...props }, children)
}))

jest.mock('@/components/ui/input', () => ({
  Input: (props: any) => {
    const { 'data-testid': testId, ...fieldProps } = props
    // Support React Hook Form field props
    const field = fieldProps
    if (field.onChange && typeof field.onChange === 'function') {
      return React.createElement('input', { 
        'data-testid': testId || 'input', 
        onChange: (e) => field.onChange?.(e.target.value),
        value: field.value || '',
        ...fieldProps 
      })
    }
    return React.createElement('input', { 'data-testid': testId || 'input', ...props })
  }
}))

jest.mock('@/components/ui/select', () => ({
  Select: ({ children, ...props }: any) => 
    React.createElement('div', { 'data-testid': 'select', ...props }, children),
  SelectContent: ({ children, ...props }: any) => 
    React.createElement('div', { 'data-testid': 'select-content', ...props }, children),
  SelectItem: ({ children, value, ...props }: any) => 
    React.createElement('div', { 'data-testid': 'select-item', 'data-value': value, ...props }, children),
  SelectTrigger: ({ children, ...props }: any) => 
    React.createElement('button', { 'data-testid': 'select-trigger', ...props }, children),
  SelectValue: (props: any) => React.createElement('span', { 'data-testid': 'select-value', ...props })
}))

jest.mock('@/components/ui/form', () => ({
  Form: ({ children, ...props }: any) => 
    React.createElement('form', { 'data-testid': 'form', ...props }, children),
  FormControl: ({ children, ...props }: any) => 
    React.createElement('div', { 'data-testid': 'form-control', ...props }, children),
  FormDescription: ({ children, ...props }: any) => 
    React.createElement('p', { 'data-testid': 'form-description', ...props }, children),
  FormField: ({ children, ...props }: any) => 
    React.createElement('div', { 'data-testid': 'form-field', ...props }, children),
  FormItem: ({ children, ...props }: any) => 
    React.createElement('div', { 'data-testid': 'form-item', ...props }, children),
  FormLabel: ({ children, ...props }: any) => 
    React.createElement('label', { 'data-testid': 'form-label', ...props }, children),
  FormMessage: ({ children, ...props }: any) => 
    React.createElement('span', { 'data-testid': 'form-message', ...props }, children)
}))

jest.mock('@/components/ui/alert', () => ({
  Alert: ({ children, ...props }: any) => 
    React.createElement('div', { 'data-testid': 'alert', ...props }, children),
  AlertDescription: ({ children, ...props }: any) => 
    React.createElement('div', { 'data-testid': 'alert-description', ...props }, children)
}))

jest.mock('@/components/ui/progress', () => ({
  Progress: ({ value, ...props }: any) => 
    React.createElement('div', { 'data-testid': 'progress', 'data-value': value, ...props }, 
      React.createElement('div', { style: { width: `${value}%` } }, `${value}%`)
    )
}))

jest.mock('@/components/ui/separator', () => ({
  Separator: (props: any) => React.createElement('hr', { 'data-testid': 'separator', ...props })
}))

jest.mock('@/components/ui/tabs', () => ({
  Tabs: ({ children, ...props }: any) => 
    React.createElement('div', { 'data-testid': 'tabs', ...props }, children),
  TabsContent: ({ children, ...props }: any) => 
    React.createElement('div', { 'data-testid': 'tabs-content', ...props }, children),
  TabsList: ({ children, ...props }: any) => 
    React.createElement('div', { 'data-testid': 'tabs-list', ...props }, children),
  TabsTrigger: ({ children, ...props }: any) => 
    React.createElement('button', { 'data-testid': 'tabs-trigger', ...props }, children)
}))

jest.mock('@/components/ui/badge', () => ({
  Badge: ({ children, ...props }: any) => 
    React.createElement('span', { 'data-testid': 'badge', ...props }, children)
}))

// Mock lucide-react icons
jest.mock('lucide-react', () => ({
  Building: (props: any) => React.createElement('div', { 'data-testid': 'building-icon', ...props }, 'Building'),
  User: (props: any) => React.createElement('div', { 'data-testid': 'user-icon', ...props }, 'User'),
  Mail: (props: any) => React.createElement('div', { 'data-testid': 'mail-icon', ...props }, 'Mail'),
  Phone: (props: any) => React.createElement('div', { 'data-testid': 'phone-icon', ...props }, 'Phone'),
  Shield: (props: any) => React.createElement('div', { 'data-testid': 'shield-icon', ...props }, 'Shield'),
  CheckCircle: (props: any) => React.createElement('div', { 'data-testid': 'check-circle-icon', ...props }, 'Check'),
  AlertCircle: (props: any) => React.createElement('div', { 'data-testid': 'alert-circle-icon', ...props }, 'Alert'),
  Eye: (props: any) => React.createElement('div', { 'data-testid': 'eye-icon', ...props }, 'Eye'),
  EyeOff: (props: any) => React.createElement('div', { 'data-testid': 'eye-off-icon', ...props }, 'EyeOff'),
  Search: (props: any) => React.createElement('div', { 'data-testid': 'search-icon', ...props }, 'Search'),
  MapPin: (props: any) => React.createElement('div', { 'data-testid': 'map-pin-icon', ...props }, 'MapPin'),
  Filter: (props: any) => React.createElement('div', { 'data-testid': 'filter-icon', ...props }, 'Filter'),
  RefreshCw: (props: any) => React.createElement('div', { 'data-testid': 'refresh-cw-icon', ...props }, 'RefreshCw'),
  AlertTriangle: (props: any) => React.createElement('div', { 'data-testid': 'alert-triangle-icon', ...props }, 'AlertTriangle'),
  Clock: (props: any) => React.createElement('div', { 'data-testid': 'clock-icon', ...props }, 'Clock'),
  Users: (props: any) => React.createElement('div', { 'data-testid': 'users-icon', ...props }, 'Users'),
  Activity: (props: any) => React.createElement('div', { 'data-testid': 'activity-icon', ...props }, 'Activity'),
  Package: (props: any) => React.createElement('div', { 'data-testid': 'package-icon', ...props }, 'Package'),
  Edit: (props: any) => React.createElement('div', { 'data-testid': 'edit-icon', ...props }, 'Edit'),
  Edit2: (props: any) => React.createElement('div', { 'data-testid': 'edit2-icon', ...props }, 'Edit2'),
  Edit3: (props: any) => React.createElement('div', { 'data-testid': 'edit3-icon', ...props }, 'Edit3'),
  TrendingUp: (props: any) => React.createElement('div', { 'data-testid': 'trending-up-icon', ...props }, 'TrendingUp'),
  Plus: (props: any) => React.createElement('div', { 'data-testid': 'plus-icon', ...props }, 'Plus'),
  MoreHorizontal: (props: any) => React.createElement('div', { 'data-testid': 'more-horizontal-icon', ...props }, 'MoreHorizontal'),
  ChevronRight: (props: any) => React.createElement('div', { 'data-testid': 'chevron-right-icon', ...props }, 'ChevronRight'),
  ArrowRight: (props: any) => React.createElement('div', { 'data-testid': 'arrow-right-icon', ...props }, 'ArrowRight')
}))

// Mock sonner toast
jest.mock('sonner', () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn()
  }
}))