import React from 'react'

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
  Input: (props: any) => React.createElement('input', { 'data-testid': 'input', ...props })
}))

jest.mock('@/components/ui/select', () => ({
  Select: ({ children, ...props }: any) => 
    React.createElement('div', { 'data-testid': 'select', ...props }, children),
  SelectContent: ({ children, ...props }: any) => 
    React.createElement('div', { 'data-testid': 'select-content', ...props }, children),
  SelectItem: ({ children, ...props }: any) => 
    React.createElement('option', { 'data-testid': 'select-item', ...props }, children),
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
  EyeOff: (props: any) => React.createElement('div', { 'data-testid': 'eye-off-icon', ...props }, 'EyeOff')
}))

// Mock sonner toast
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
global.localStorage = localStorageMock