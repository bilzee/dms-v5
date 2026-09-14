import { AuthService } from '@/lib/auth/service'
import { prisma } from '@/lib/db/client'
import bcrypt from 'bcryptjs'

// Mock Prisma
jest.mock('@/lib/db/client', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    userRole: {
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}))

// Mock bcrypt
jest.mock('bcryptjs')

// Mock jsonwebtoken
jest.mock('jsonwebtoken', () => ({
  sign: jest.fn(() => 'mock-jwt-token'),
  verify: jest.fn(() => ({
    userId: 'user-1',
    email: 'test@example.com',
    roles: ['ASSESSOR'],
    permissions: ['CREATE_ASSESSMENT'],
    iat: 1234567890,
    exp: 1234567890 + 86400,
  })),
}))

describe('AuthService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('hashPassword', () => {
    it('should hash a password', async () => {
      const mockHash = 'hashed-password'
      ;(bcrypt.hash as jest.Mock).mockResolvedValue(mockHash)

      const result = await AuthService.hashPassword('password123')

      expect(bcrypt.hash).toHaveBeenCalledWith('password123', 10)
      expect(result).toBe(mockHash)
    })
  })

  describe('comparePassword', () => {
    it('should compare password correctly', async () => {
      ;(bcrypt.compare as jest.Mock).mockResolvedValue(true)

      const result = await AuthService.comparePassword('password123', 'hashed-password')

      expect(bcrypt.compare).toHaveBeenCalledWith('password123', 'hashed-password')
      expect(result).toBe(true)
    })
  })

  describe('generateToken', () => {
    it('should generate a JWT token', () => {
      const payload = {
        userId: 'user-1',
        email: 'test@example.com',
        roles: ['ASSESSOR'],
        permissions: ['CREATE_ASSESSMENT'],
      }

      const result = AuthService.generateToken(payload)

      expect(result).toBe('mock-jwt-token')
    })
  })

  describe('verifyToken', () => {
    it('should verify and decode a token', () => {
      const result = AuthService.verifyToken('valid-token')

      expect(result).toEqual({
        userId: 'user-1',
        email: 'test@example.com',
        roles: ['ASSESSOR'],
        permissions: ['CREATE_ASSESSMENT'],
        iat: 1234567890,
        exp: 1234567890 + 86400,
      })
    })

    it('should throw error for invalid token', () => {
      const jwt = require('jsonwebtoken')
      ;(jwt.verify as jest.Mock).mockImplementation(() => {
        throw new Error('Invalid token')
      })

      expect(() => AuthService.verifyToken('invalid-token')).toThrow('Invalid or expired token')
    })
  })

  describe('getUserWithRoles', () => {
    it('should get user with roles and permissions', async () => {
      const mockUser = {
        id: 'user-1',
        email: 'test@example.com',
        roles: [
          {
            role: {
              name: 'ASSESSOR',
              permissions: [
                { permission: { code: 'CREATE_ASSESSMENT' } }
              ]
            }
          }
        ]
      }

      ;(prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser)

      const result = await AuthService.getUserWithRoles('user-1')

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        include: {
          roles: {
            include: {
              role: {
                include: {
                  permissions: {
                    include: {
                      permission: true
                    }
                  }
                }
              }
            }
          }
        }
      })
      expect(result).toEqual(mockUser)
    })
  })

  describe('authenticate', () => {
    it('should authenticate user successfully', async () => {
      const mockUser = {
        id: 'user-1',
        email: 'test@example.com',
        passwordHash: 'hashed-password',
        isActive: true,
        isLocked: false,
        roles: [
          {
            role: {
              name: 'ASSESSOR',
              permissions: [
                { permission: { code: 'CREATE_ASSESSMENT' } }
              ]
            }
          }
        ]
      }

      ;(prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser)
      ;(prisma.user.update as jest.Mock).mockResolvedValue(mockUser)
      ;(bcrypt.compare as jest.Mock).mockResolvedValue(true)

      const result = await AuthService.authenticate('test@example.com', 'password123')

      expect(result).toEqual({
        user: mockUser,
        token: 'mock-jwt-token'
      })
    })

    it('should return null for invalid credentials', async () => {
      ;(prisma.user.findUnique as jest.Mock).mockResolvedValue(null)

      const result = await AuthService.authenticate('test@example.com', 'wrong-password')

      expect(result).toBeNull()
    })

    it('should throw error for inactive user', async () => {
      const mockUser = {
        id: 'user-1',
        email: 'test@example.com',
        passwordHash: 'hashed-password',
        isActive: false,
        isLocked: false,
      }

      ;(prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser)

      await expect(
        AuthService.authenticate('test@example.com', 'password123')
      ).rejects.toThrow('Account is deactivated')
    })

    it('should throw error for locked user', async () => {
      const mockUser = {
        id: 'user-1',
        email: 'test@example.com',
        passwordHash: 'hashed-password',
        isActive: true,
        isLocked: true,
      }

      ;(prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser)

      await expect(
        AuthService.authenticate('test@example.com', 'password123')
      ).rejects.toThrow('Account is locked')
    })
  })

  describe('hasPermission', () => {
    it('should check user permission correctly', async () => {
      const mockUser = {
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

      ;(prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser)

      const result = await AuthService.hasPermission('user-1', 'CREATE_ASSESSMENT')

      expect(result).toBe(true)
    })

    it('should return false for missing permission', async () => {
      const mockUser = {
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

      ;(prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser)

      const result = await AuthService.hasPermission('user-1', 'DELETE_ASSESSMENT')

      expect(result).toBe(false)
    })
  })

  describe('createUser', () => {
    it('should create user with roles', async () => {
      const userData = {
        email: 'new@example.com',
        username: 'newuser',
        password: 'password123',
        name: 'New User',
        roleIds: ['role-1'],
        assignedBy: 'admin-1'
      }

      const mockUser = {
        id: 'user-1',
        email: userData.email,
        username: userData.username,
        name: userData.name,
      }

      const mockTransaction = jest.fn().mockImplementation((callback) => callback({
        user: {
          create: jest.fn().mockResolvedValue(mockUser)
        },
        userRole: {
          createMany: jest.fn()
        },
        auditLog: {
          create: jest.fn()
        }
      }))

      ;(prisma.$transaction as jest.Mock).mockImplementation(mockTransaction)
      ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({
        ...mockUser,
        roles: []
      })
      ;(bcrypt.hash as jest.Mock).mockResolvedValue('hashed-password')

      const result = await AuthService.createUser(userData)

      expect(mockTransaction).toHaveBeenCalled()
      expect(result).toEqual({
        ...mockUser,
        roles: []
      })
    })
  })
})