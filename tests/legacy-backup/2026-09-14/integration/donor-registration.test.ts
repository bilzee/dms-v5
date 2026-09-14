import { createMocks } from 'node-mocks-http'
import donorRegistrationHandler from '@/app/api/v1/donors/route'
import donorProfileHandler from '@/app/api/v1/donors/profile/route'
import donorEntitiesHandler from '@/app/api/v1/donors/entities/route'
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

describe('Donor Registration API Integration Tests', () => {
  beforeEach(async () => {
    // Clean up test data
    await prisma.donor.deleteMany({
      where: { name: { contains: 'TEST_DONOR_' } }
    })
    await prisma.user.deleteMany({
      where: { username: { contains: 'test_donor_' } }
    })
  })

  afterEach(async () => {
    // Clean up test data
    await prisma.donor.deleteMany({
      where: { name: { contains: 'TEST_DONOR_' } }
    })
    await prisma.user.deleteMany({
      where: { username: { contains: 'test_donor_' } }
    })
  })

  describe('POST /api/v1/donors - Registration', () => {
    it('should register a new donor successfully', async () => {
      const donorData = {
        name: 'TEST_DONOR_ORG',
        type: 'ORGANIZATION',
        contactEmail: 'test@donor.org',
        contactPhone: '+1234567890',
        organization: 'Test Organization',
        userCredentials: {
          username: 'test_donor_user',
          password: 'TestPassword123',
          email: 'user@testdonor.org',
          name: 'Test User'
        }
      }

      const { req } = createMocks({
        method: 'POST',
        body: donorData,
        headers: {
          'content-type': 'application/json',
        },
      })

      const response = await donorRegistrationHandler(req)

      expect(response.status).toBe(201)
      const data = await response.json()
      expect(data.success).toBe(true)
      expect(data.data.donor.name).toBe(donorData.name)
      expect(data.data.donor.type).toBe(donorData.type)
      expect(data.data.user.username).toBe(donorData.userCredentials.username)
      expect(data.data.token).toBeDefined()
      expect(data.data.roles).toContain('DONOR')
    })

    it('should reject duplicate organization names', async () => {
      const donorData = {
        name: 'TEST_DONOR_DUPLICATE',
        type: 'ORGANIZATION',
        userCredentials: {
          username: 'test_donor_user1',
          password: 'TestPassword123',
          email: 'user1@testdonor.org',
          name: 'Test User 1'
        }
      }

      // First registration should succeed
      const { req: firstReq } = createMocks({
        method: 'POST',
        body: donorData,
        headers: { 'content-type': 'application/json' },
      })
      const firstResponse = await donorRegistrationHandler(firstReq)
      expect(firstResponse.status).toBe(201)

      // Second registration with same name should fail
      const duplicateData = {
        ...donorData,
        userCredentials: {
          username: 'test_donor_user2',
          password: 'TestPassword123',
          email: 'user2@testdonor.org',
          name: 'Test User 2'
        }
      }

      const { req: secondReq } = createMocks({
        method: 'POST',
        body: duplicateData,
        headers: { 'content-type': 'application/json' },
      })
      const secondResponse = await donorRegistrationHandler(secondReq)
      expect(secondResponse.status).toBe(409)

      const errorData = await secondResponse.json()
      expect(errorData.success).toBe(false)
      expect(errorData.error).toContain('already exists')
    })

    it('should reject invalid donor types', async () => {
      const donorData = {
        name: 'TEST_DONOR_INVALID',
        type: 'INVALID_TYPE',
        userCredentials: {
          username: 'test_donor_invalid',
          password: 'TestPassword123',
          email: 'invalid@testdonor.org',
          name: 'Test User'
        }
      }

      const { req } = createMocks({
        method: 'POST',
        body: donorData,
        headers: { 'content-type': 'application/json' },
      })

      const response = await donorRegistrationHandler(req)
      expect(response.status).toBe(400)

      const errorData = await response.json()
      expect(errorData.success).toBe(false)
      expect(errorData.error).toBe('Validation failed')
    })

    it('should reject weak passwords', async () => {
      const donorData = {
        name: 'TEST_DONOR_WEAK',
        type: 'ORGANIZATION',
        userCredentials: {
          username: 'test_donor_weak',
          password: '123', // Too short
          email: 'weak@testdonor.org',
          name: 'Test User'
        }
      }

      const { req } = createMocks({
        method: 'POST',
        body: donorData,
        headers: { 'content-type': 'application/json' },
      })

      const response = await donorRegistrationHandler(req)
      expect(response.status).toBe(400)

      const errorData = await response.json()
      expect(errorData.success).toBe(false)
      expect(errorData.error).toBe('Validation failed')
    })
  })

  describe('Authentication and Profile Access', () => {
    let authToken: string
    let userId: string

    beforeEach(async () => {
      // Create a test donor user directly in the database
      const passwordHash = await bcrypt.hash('TestPassword123', 10)
      
      const user = await prisma.user.create({
        data: {
          username: 'test_donor_auth',
          email: 'auth@testdonor.org',
          name: 'Test Auth User',
          passwordHash,
          isActive: true,
          roles: {
            create: {
              role: {
                create: {
                  name: 'DONOR',
                  permissions: {
                    create: [
                      { code: 'VIEW_DONOR_DASHBOARD', name: 'View Donor Dashboard' },
                      { code: 'MANAGE_DONOR_PROFILE', name: 'Manage Donor Profile' }
                    ]
                  }
                }
              }
            }
          },
          donor: {
            create: {
              name: 'TEST_DONOR_AUTH',
              type: 'ORGANIZATION',
              contactEmail: 'auth@donor.org',
              isActive: true
            }
          }
        },
        include: { roles: true }
      })

      userId = user.id

      // Generate JWT token (simplified for testing)
      const jwt = require('jsonwebtoken')
      authToken = jwt.sign(
        { 
          userId: user.id, 
          username: user.username,
          roles: ['DONOR']
        },
        process.env.JWT_SECRET || 'test-secret',
        { expiresIn: '1h' }
      )
    })

    it('should allow authenticated donor to access profile', async () => {
      const { req } = createMocks({
        method: 'GET',
        headers: {
          'authorization': `Bearer ${authToken}`,
          'content-type': 'application/json',
        },
      })

      // Mock the getUserFromToken function to return our test user
      jest.spyOn(require('@/lib/auth/middleware'), 'getUserFromToken')
        .mockResolvedValue({ userId, username: 'test_donor_auth', roles: ['DONOR'] })

      const response = await donorProfileHandler(req)
      expect(response.status).toBe(200)

      const data = await response.json()
      expect(data.success).toBe(true)
      expect(data.data.donor.name).toBe('TEST_DONOR_AUTH')
    })

    it('should reject unauthenticated access to profile', async () => {
      const { req } = createMocks({
        method: 'GET',
        headers: {
          'content-type': 'application/json',
        },
      })

      const response = await donorProfileHandler(req)
      expect(response.status).toBe(401)

      const errorData = await response.json()
      expect(errorData.error).toContain('authorization')
    })

    it('should reject invalid tokens', async () => {
      const { req } = createMocks({
        method: 'GET',
        headers: {
          'authorization': 'Bearer invalid-token',
          'content-type': 'application/json',
        },
      })

      const response = await donorProfileHandler(req)
      expect(response.status).toBe(401)

      const errorData = await response.json()
      expect(errorData.error).toContain('Invalid or expired')
    })

    it('should allow authenticated donor to access entities', async () => {
      const { req } = createMocks({
        method: 'GET',
        headers: {
          'authorization': `Bearer ${authToken}`,
          'content-type': 'application/json',
        },
      })

      // Mock the getUserFromToken function
      jest.spyOn(require('@/lib/auth/middleware'), 'getUserFromToken')
        .mockResolvedValue({ userId, username: 'test_donor_auth', roles: ['DONOR'] })

      const response = await donorEntitiesHandler(req)
      expect(response.status).toBe(200)

      const data = await response.json()
      expect(data.success).toBe(true)
      expect(data.data.entities).toBeInstanceOf(Array)
      expect(data.data.summary).toBeDefined()
    })
  })

  describe('Profile Management', () => {
    let authToken: string
    let userId: string

    beforeEach(async () => {
      // Create a test donor user
      const passwordHash = await bcrypt.hash('TestPassword123', 10)
      
      const user = await prisma.user.create({
        data: {
          username: 'test_donor_profile',
          email: 'profile@testdonor.org',
          name: 'Test Profile User',
          passwordHash,
          isActive: true,
          roles: {
            create: {
              role: {
                create: {
                  name: 'DONOR',
                  permissions: {
                    create: [
                      { code: 'VIEW_DONOR_DASHBOARD', name: 'View Donor Dashboard' },
                      { code: 'MANAGE_DONOR_PROFILE', name: 'Manage Donor Profile' }
                    ]
                  }
                }
              }
            }
          },
          donor: {
            create: {
              name: 'TEST_DONOR_PROFILE',
              type: 'ORGANIZATION',
              contactEmail: 'profile@donor.org',
              isActive: true
            }
          }
        }
      })

      userId = user.id

      // Generate JWT token
      const jwt = require('jsonwebtoken')
      authToken = jwt.sign(
        { 
          userId: user.id, 
          username: user.username,
          roles: ['DONOR']
        },
        process.env.JWT_SECRET || 'test-secret',
        { expiresIn: '1h' }
      )
    })

    it('should update donor profile', async () => {
      const updateData = {
        contactEmail: 'updated@donor.org',
        contactPhone: '+1987654321',
        organization: 'Updated Organization Name'
      }

      const { req } = createMocks({
        method: 'PATCH',
        body: updateData,
        headers: {
          'authorization': `Bearer ${authToken}`,
          'content-type': 'application/json',
        },
      })

      // Mock the getUserFromToken function
      jest.spyOn(require('@/lib/auth/middleware'), 'getUserFromToken')
        .mockResolvedValue({ userId, username: 'test_donor_profile', roles: ['DONOR'] })

      const response = await donorProfileHandler(req)
      expect(response.status).toBe(200)

      const data = await response.json()
      expect(data.success).toBe(true)
      expect(data.data.donor.contactEmail).toBe(updateData.contactEmail)
      expect(data.data.donor.contactPhone).toBe(updateData.contactPhone)
      expect(data.data.donor.organization).toBe(updateData.organization)
    })

    it('should reject invalid email format in profile update', async () => {
      const updateData = {
        contactEmail: 'invalid-email'
      }

      const { req } = createMocks({
        method: 'PATCH',
        body: updateData,
        headers: {
          'authorization': `Bearer ${authToken}`,
          'content-type': 'application/json',
        },
      })

      // Mock the getUserFromToken function
      jest.spyOn(require('@/lib/auth/middleware'), 'getUserFromToken')
        .mockResolvedValue({ userId, username: 'test_donor_profile', roles: ['DONOR'] })

      const response = await donorProfileHandler(req)
      expect(response.status).toBe(400)

      const errorData = await response.json()
      expect(errorData.success).toBe(false)
      expect(errorData.error).toBe('Validation failed')
    })
  })
})