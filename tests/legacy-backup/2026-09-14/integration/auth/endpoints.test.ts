import { NextRequest } from 'next/server'
import { POST as loginHandler } from '@/app/api/v1/auth/login/route'
import { GET as meHandler } from '@/app/api/v1/auth/me/route'
import { POST as refreshHandler } from '@/app/api/v1/auth/refresh/route'
import { AuthService } from '@/lib/auth/service'

// Mock the auth service
jest.mock('@/lib/auth/service')

// Mock UUID
jest.mock('uuid', () => ({
  v4: () => 'mock-uuid'
}))

const mockedAuthService = AuthService as jest.Mocked<typeof AuthService>

describe('Authentication API Endpoints', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('POST /api/v1/auth/login', () => {
    it('should authenticate user successfully', async () => {
      const mockUser = {
        id: 'user-1',
        email: 'test@example.com',
        name: 'Test User',
        roles: [
          {
            role: {
              id: 'role-1',
              name: 'ASSESSOR',
              permissions: [
                { permission: { code: 'CREATE_ASSESSMENT' } }
              ]
            }
          }
        ]
      }

      mockedAuthService.authenticate.mockResolvedValue({
        user: mockUser as any,
        token: 'jwt-token'
      })

      const request = new NextRequest('http://localhost:3000/api/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: 'test@example.com',
          password: 'password123'
        }),
        headers: {
          'Content-Type': 'application/json'
        }
      })

      const response = await loginHandler(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.data.user.email).toBe('test@example.com')
      expect(data.data.token).toBe('jwt-token')
      expect(data.meta.requestId).toBe('mock-uuid')
    })

    it('should return 400 for invalid input', async () => {
      const request = new NextRequest('http://localhost:3000/api/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: 'invalid-email',
          password: ''
        }),
        headers: {
          'Content-Type': 'application/json'
        }
      })

      const response = await loginHandler(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Validation failed')
      expect(data.details).toBeDefined()
    })

    it('should return 401 for invalid credentials', async () => {
      mockedAuthService.authenticate.mockResolvedValue(null)

      const request = new NextRequest('http://localhost:3000/api/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: 'test@example.com',
          password: 'wrong-password'
        }),
        headers: {
          'Content-Type': 'application/json'
        }
      })

      const response = await loginHandler(request)
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Invalid email or password')
    })

    it('should handle account locked error', async () => {
      mockedAuthService.authenticate.mockRejectedValue(new Error('Account is locked'))

      const request = new NextRequest('http://localhost:3000/api/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: 'test@example.com',
          password: 'password123'
        }),
        headers: {
          'Content-Type': 'application/json'
        }
      })

      const response = await loginHandler(request)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Account is locked')
    })
  })

  describe('GET /api/v1/auth/me', () => {
    it('should return current user data', async () => {
      const mockUser = {
        id: 'user-1',
        email: 'test@example.com',
        name: 'Test User',
        roles: [
          {
            role: {
              permissions: [
                { permission: { code: 'CREATE_ASSESSMENT' } }
              ]
            }
          }
        ]
      }

      mockedAuthService.verifyToken.mockReturnValue({
        userId: 'user-1',
        email: 'test@example.com',
        roles: ['ASSESSOR'],
        permissions: ['CREATE_ASSESSMENT'],
        iat: 1234567890,
        exp: 1234567890 + 86400
      })

      mockedAuthService.getUserWithRoles.mockResolvedValue(mockUser as any)

      const request = new NextRequest('http://localhost:3000/api/v1/auth/me', {
        method: 'GET',
        headers: {
          'Authorization': 'Bearer valid-token'
        }
      })

      const response = await meHandler(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.data.user.id).toBe('user-1')
      expect(data.data.permissions).toEqual(['CREATE_ASSESSMENT'])
    })

    it('should return 401 for missing token', async () => {
      const request = new NextRequest('http://localhost:3000/api/v1/auth/me', {
        method: 'GET'
      })

      const response = await meHandler(request)
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Missing or invalid authorization header')
    })

    it('should return 401 for invalid token', async () => {
      mockedAuthService.verifyToken.mockImplementation(() => {
        throw new Error('Invalid token')
      })

      const request = new NextRequest('http://localhost:3000/api/v1/auth/me', {
        method: 'GET',
        headers: {
          'Authorization': 'Bearer invalid-token'
        }
      })

      const response = await meHandler(request)
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Invalid or expired token')
    })
  })

  describe('POST /api/v1/auth/refresh', () => {
    it('should refresh token successfully', async () => {
      mockedAuthService.verifyToken.mockReturnValue({
        userId: 'user-1',
        email: 'test@example.com',
        roles: ['ASSESSOR'],
        permissions: ['CREATE_ASSESSMENT'],
        iat: 1234567890,
        exp: 1234567890 + 86400
      })

      mockedAuthService.refreshToken.mockResolvedValue('new-jwt-token')

      const request = new NextRequest('http://localhost:3000/api/v1/auth/refresh', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer valid-token'
        }
      })

      const response = await refreshHandler(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.data.token).toBe('new-jwt-token')
    })

    it('should return 401 for expired token', async () => {
      mockedAuthService.verifyToken.mockImplementation(() => {
        throw new Error('Token expired')
      })

      const request = new NextRequest('http://localhost:3000/api/v1/auth/refresh', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer expired-token'
        }
      })

      const response = await refreshHandler(request)
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Invalid or expired token')
    })
  })
})