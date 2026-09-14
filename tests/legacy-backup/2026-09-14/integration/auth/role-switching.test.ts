import request from 'supertest';
import { NextRequest } from 'next/server';

describe('Role Switching Integration Tests', () => {
  let authToken: string;
  let userId: string;
  let isServerAvailable = false;
  
  // Skip entire suite if server not available
  beforeEach(function() {
    if (!isServerAvailable) {
      this.skip();
    }
  });

  beforeAll(async () => {
    // Test if development server is running
    try {
      const testResponse = await request('http://localhost:3000')
        .get('/api/v1/auth/me')
        .timeout(5000);
      
      isServerAvailable = true;
      
      // Setup test user with multiple roles if server is available
      const loginResponse = await request('http://localhost:3000')
        .post('/api/v1/auth/login')
        .send({
          email: 'multirole@test.com',
          password: 'testpassword'
        });

      authToken = loginResponse.body.data?.token;
      userId = loginResponse.body.data?.user?.id;
    } catch (error) {
      console.warn('Development server not available, skipping integration tests');
      isServerAvailable = false;
    }
  });

  afterAll(async () => {
    // Cleanup test data
    await request('http://localhost:3000')
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${authToken}`);
  });

  describe('GET /api/v1/auth/me', () => {
    it('should return user with current role and available roles', async () => {
      if (!isServerAvailable) {
        console.log('Skipping auth test - server not available');
        return;
      }
      
      const response = await request('http://localhost:3000')
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.data.user).toBeDefined();
      expect(response.body.data.user.roles).toBeDefined();
      expect(Array.isArray(response.body.data.user.roles)).toBe(true);
      expect(response.body.data.user.roles.length).toBeGreaterThan(1);
    });

    it('should return 401 without token', async () => {
      await request('http://localhost:3000')
        .get('/api/v1/auth/me')
        .expect(401);
    });

    it('should return 401 with invalid token', async () => {
      await request('http://localhost:3000')
        .get('/api/v1/auth/me')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);
    });
  });

  describe('POST /api/v1/auth/refresh', () => {
    it('should refresh token and maintain role information', async () => {
      const response = await request('http://localhost:3000')
        .post('/api/v1/auth/refresh')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.data.token).toBeDefined();
      expect(typeof response.body.data.token).toBe('string');

      // New token should work for authenticated requests
      const newToken = response.body.data.token;
      const meResponse = await request('http://localhost:3000')
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${newToken}`)
        .expect(200);

      expect(meResponse.body.data.user).toBeDefined();
    });
  });

  describe('Role-based access control', () => {
    it('should allow access to assessor-specific endpoints with assessor role', async () => {
      // First, ensure user has assessor role
      await request('http://localhost:3000')
        .post(`/api/v1/users/${userId}/roles`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ roleIds: ['assessor-role-id'] })
        .expect(200);

      // Then test access to assessor endpoint
      const response = await request('http://localhost:3000')
        .get('/api/v1/assessments')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(Array.isArray(response.body.data)).toBe(true);
    });

    it('should deny access to coordinator-specific endpoints without coordinator role', async () => {
      // Try to access coordinator endpoint without proper role
      const response = await request('http://localhost:3000')
        .get('/api/v1/responses')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(403); // Should be forbidden

      expect(response.body.error).toContain('permission');
    });
  });

  describe('Session persistence across requests', () => {
    it('should maintain role context across multiple requests', async () => {
      // Make multiple requests and verify role consistency
      const responses = await Promise.all([
        request('http://localhost:3000')
          .get('/api/v1/auth/me')
          .set('Authorization', `Bearer ${authToken}`),
        request('http://localhost:3000')
          .get('/api/v1/auth/me')
          .set('Authorization', `Bearer ${authToken}`),
        request('http://localhost:3000')
          .get('/api/v1/auth/me')
          .set('Authorization', `Bearer ${authToken}`)
      ]);

      // All responses should have the same user and role information
      const userRoles = responses.map(r => r.body.data.user.roles);
      expect(userRoles[0]).toEqual(userRoles[1]);
      expect(userRoles[1]).toEqual(userRoles[2]);
    });
  });

  describe('Concurrent role switching', () => {
    it('should handle concurrent role switching requests gracefully', async () => {
      // Simulate multiple rapid role switching attempts
      const switchPromises = [
        request('http://localhost:3000')
          .post('/api/v1/users/switch-role')
          .set('Authorization', `Bearer ${authToken}`)
          .send({ role: 'ASSESSOR' }),
        request('http://localhost:3000')
          .post('/api/v1/users/switch-role')
          .set('Authorization', `Bearer ${authToken}`)
          .send({ role: 'COORDINATOR' }),
        request('http://localhost:3000')
          .post('/api/v1/users/switch-role')
          .set('Authorization', `Bearer ${authToken}`)
          .send({ role: 'ASSESSOR' })
      ];

      const responses = await Promise.allSettled(switchPromises);

      // At least one should succeed
      const successCount = responses.filter(r => 
        r.status === 'fulfilled' && r.value.status < 400
      ).length;
      expect(successCount).toBeGreaterThan(0);

      // Final state should be consistent
      const finalMeResponse = await request('http://localhost:3000')
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${authToken}`);

      expect(finalMeResponse.body.data.user).toBeDefined();
    });
  });

  describe('Role switching edge cases', () => {
    it('should handle switching to same role gracefully', async () => {
      const response = await request('http://localhost:3000')
        .post('/api/v1/users/switch-role')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ role: 'ASSESSOR' })
        .expect(200);

      expect(response.body.data.currentRole).toBe('ASSESSOR');
    });

    it('should reject switching to unassigned role', async () => {
      const response = await request('http://localhost:3000')
        .post('/api/v1/users/switch-role')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ role: 'UNASSIGNED_ROLE' })
        .expect(400);

      expect(response.body.error).toContain('not assigned');
    });

    it('should validate role format', async () => {
      const response = await request('http://localhost:3000')
        .post('/api/v1/users/switch-role')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ role: 'invalid-role-format!' })
        .expect(400);

      expect(response.body.error).toContain('Invalid role');
    });
  });
});