'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { FormCard } from '@/components/shared/FormCard'
import { FormActionBar } from '@/components/shared/FormActionBar'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { useAuth } from '@/hooks/useAuth'
import { useAuthStore } from '@/stores/auth.store'
import { User, Shield, Users, Heart, Package } from '@/lib/icons'

const loginSchema = z.object({
  email: z.string().min(1, 'Email is required').email('Invalid email format'),
  password: z.string().min(1, 'Password is required')
})

type LoginFormData = z.infer<typeof loginSchema>

// Development test users (only visible in development) — the E2E baseline
// users seeded into the test database by tests/e2e-baseline/global-setup.ts
// (mirrors tests/e2e-baseline/baseline-users.ts). Per-user password overrides
// can be supplied via the NEXT_PUBLIC_DEV_TEST_PASSWORDS JSON env var.
const DEV_TEST_DEFAULT_PASSWORD = 'Baseline#Pass1'

const DEV_TEST_USERS = [
  {
    id: 'admin',
    name: 'E2E Admin',
    email: 'e2e.admin@baseline.test',
    roles: ['Admin'],
    icon: Shield,
    description: 'Full system access'
  },
  {
    id: 'coordinator',
    name: 'E2E Coordinator',
    email: 'e2e.coordinator@baseline.test',
    roles: ['Coordinator'],
    icon: Users,
    description: 'Verifies assessments, manages entities'
  },
  {
    id: 'assessor',
    name: 'E2E Assessor',
    email: 'e2e.assessor@baseline.test',
    roles: ['Assessor'],
    icon: Heart,
    description: 'Conducts rapid assessments in the field'
  },
  {
    id: 'responder',
    name: 'E2E Responder',
    email: 'e2e.responder@baseline.test',
    roles: ['Responder'],
    icon: Package,
    description: 'Plans and delivers disaster response resources'
  },
  {
    id: 'donor',
    name: 'E2E Donor',
    email: 'e2e.donor@baseline.test',
    roles: ['Donor'],
    icon: Heart,
    description: 'Donor role only - manages contributions and assessments'
  }
]

const DEV_TEST_PASSWORDS: Record<string, string> = (() => {
  try {
    return JSON.parse(process.env.NEXT_PUBLIC_DEV_TEST_PASSWORDS || '{}')
  } catch {
    return {}
  }
})()

export function LoginForm() {
  const [error, setError] = useState<string | null>(null)
  const [selectedTestUser, setSelectedTestUser] = useState<string>('')
  const router = useRouter()
  const { login } = useAuth()

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting }
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema)
  })

  const isDevelopment = process.env.NODE_ENV === 'development'

  const handleTestUserSelect = (userId: string) => {
    const user = DEV_TEST_USERS.find(u => u.id === userId)
    if (user) {
      setValue('email', user.email)
      setValue('password', DEV_TEST_PASSWORDS[userId] ?? DEV_TEST_DEFAULT_PASSWORD)
      setSelectedTestUser(userId)
    }
  }

  const onSubmit = async (data: LoginFormData) => {
    try {
      setError(null)
      await login(data.email, data.password)
      
      setTimeout(() => {
        const roleRedirectMap: Record<string, string> = {
          ADMIN: '/admin/dashboard',
          COORDINATOR: '/coordinator/dashboard',
          RESPONDER: '/responder/dashboard',
          ASSESSOR: '/assessor/dashboard',
          DONOR: '/donor/dashboard',
        }

        const currentRole = useAuthStore.getState().currentRole
        const redirectPath = currentRole
          ? roleRedirectMap[currentRole]
          : '/dashboard'

        router.push(redirectPath)
      }, 100)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    }
  }

  return (
    <FormCard
      title="Login"
      description="Enter your credentials to access the disaster management system"
      variant="default"
      className="w-full max-w-md"
    >
      <form onSubmit={handleSubmit(onSubmit)}>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* Development Test User Selector - Only shown in development */}
          {isDevelopment && (
            <div className="space-y-3 p-4 border rounded-lg bg-blue-50 border-blue-200">
              <div className="flex items-center gap-2">
                <User className="h-4 w-4 text-blue-600" />
                <Label className="text-sm font-medium text-blue-800">
                  Development Test Users
                </Label>
              </div>
              <Select value={selectedTestUser} onValueChange={handleTestUserSelect}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a test user for quick login..." />
                </SelectTrigger>
                <SelectContent>
                  {DEV_TEST_USERS.map((user) => {
                    const IconComponent = user.icon
                    return (
                      <SelectItem key={user.id} value={user.id}>
                        <div className="flex items-center gap-3 py-1">
                          <IconComponent className="h-4 w-4 text-gray-600" />
                          <div className="flex flex-col">
                            <span className="font-medium">{user.name}</span>
                            <span className="text-xs text-gray-500">
                              {user.roles.join(', ')} • {user.description}
                            </span>
                          </div>
                        </div>
                      </SelectItem>
                    )
                  })}
                </SelectContent>
              </Select>
              <p className="text-xs text-blue-600">
                Selecting a test user will automatically fill the email and password fields below.
              </p>
            </div>
          )}

          {isDevelopment && <Separator />}
          
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="your@email.com"
              data-testid="email"
              {...register('email')}
              aria-invalid={errors.email ? 'true' : 'false'}
            />
            {errors.email && (
              <p className="text-sm text-red-600" role="alert">
                {errors.email.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              placeholder="Enter your password"
              data-testid="password"
              {...register('password')}
              aria-invalid={errors.password ? 'true' : 'false'}
            />
            {errors.password && (
              <p className="text-sm text-red-600" role="alert">
                {errors.password.message}
              </p>
            )}
          </div>

          <FormActionBar
            submitLabel={isSubmitting ? 'Signing in...' : 'Sign in'}
            loading={isSubmitting}
          />
        </form>
    </FormCard>
  )
}