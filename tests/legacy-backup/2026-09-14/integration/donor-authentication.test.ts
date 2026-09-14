import { test, expect } from '@playwright/test'
import { authenticate } from '../../fixtures/auth-helper'

test.describe('Donor Authentication and Role-Based Access', () => {
  test.beforeEach(async ({ page }) => {
    // Clear localStorage before each test
    await page.goto('http://localhost:3001')
    await page.evaluate(() => {
      localStorage.clear()
      sessionStorage.clear()
    })
  })

  test('should persist JWT token to localStorage after login', async ({ page }) => {
    await page.goto('http://localhost:3001/login')
    
    // Login as donor user
    await page.fill('input[name="username"]', 'donor_user')
    await page.fill('input[name="password"]', 'donor123!')
    await page.click('[data-testid="login-submit-button"]')
    
    // Wait for login to complete
    await page.waitForURL('**/dashboard')
    
    // Check that token is persisted in localStorage
    const authToken = await page.evaluate(() => {
      return localStorage.getItem('auth_token')
    })
    
    expect(authToken).toBeTruthy()
    expect(authToken?.length).toBeGreaterThan(20) // JWT tokens are substantial
    
    // Verify token is passed to API calls
    await page.goto('http://localhost:3001/donor/profile')
    
    // Monitor network requests to verify Authorization header
    const apiRequests: any[] = []
    page.on('request', request => {
      if (request.url().includes('/api/v1/donors/')) {
        apiRequests.push({
          url: request.url(),
          headers: request.headers()
        })
      }
    })
    
    await page.reload()
    await page.waitForTimeout(2000)
    
    // Check that API calls include Authorization header
    const donorProfileRequest = apiRequests.find(req => req.url.includes('/api/v1/donors/profile'))
    expect(donorProfileRequest).toBeTruthy()
    expect(donorProfileRequest.headers['authorization']).toBeTruthy()
    expect(donorProfileRequest.headers['authorization']).toContain('Bearer')
  })

  test('should handle role priority correctly for multi-role users', async ({ page }) => {
    // Login as multi-role user (coordinator role should be prioritized over donor)
    await page.goto('http://localhost:3001/login')
    
    await page.fill('input[name="username"]', 'multi_role_user')
    await page.fill('input[name="password"]', 'multi123!')
    await page.click('[data-testid="login-submit-button"]')
    
    // Wait for login and check redirect
    await page.waitForTimeout(3000)
    
    // Multi-role user should see coordinator dashboard (highest priority role)
    const currentUrl = page.url()
    expect(currentUrl).toContain('/dashboard')
    
    // Should NOT be redirected to donor dashboard since coordinator role has higher priority
    expect(currentUrl).not.toContain('/donor/dashboard')
    
    // Verify role-based visibility
    const userRole = await page.evaluate(() => {
      return (window as any).__ZUSTAND_STORE__?.getState()?.auth?.user?.role
    })
    
    expect(userRole).toBe('COORDINATOR')
  })

  test('should redirect donor-only users to dashboard after registration', async ({ page }) => {
    await page.goto('http://localhost:3001/register')
    
    const timestamp = Date.now()
    
    // Complete registration form
    await page.fill('[data-testid="donor-name-input"]', `Test Donor ${timestamp}`)
    
    // Select organization type
    await page.click('[data-testid="donor-type-select"]')
    await page.waitForTimeout(500)
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    
    await page.fill('[data-testid="donor-contact-email-input"]', `test-${timestamp}@donor.org`)
    await page.fill('[data-testid="donor-contact-phone-input"]', '+1234567890')
    await page.fill('[data-testid="donor-organization-details-input"]', 'Test Organization')
    
    // Click next to go to user account step
    await page.click('[data-testid="registration-next-button"]')
    await page.waitForTimeout(2000)
    
    // Fill user account information
    await page.fill('input[name="userCredentials.name"]', `Test User ${timestamp}`)
    await page.fill('input[name="userCredentials.email"]', `user-${timestamp}@testdonor.org`)
    await page.fill('input[name="userCredentials.username"]', `testdonor${timestamp}`)
    await page.fill('input[name="userCredentials.password"]', 'TestPassword123')
    await page.fill('input[name="userCredentials.confirmPassword"]', 'TestPassword123')
    
    // Complete registration
    const submitButton = page.locator('[data-testid="registration-next-button"]:has-text("Complete Registration")')
    await submitButton.click()
    
    // Wait for registration completion and redirect
    await page.waitForTimeout(5000)
    
    // Should redirect to donor dashboard after successful registration
    const currentUrl = page.url()
    expect(currentUrl).toContain('/donor/dashboard')
    
    // Verify authentication state
    const authToken = await page.evaluate(() => {
      return localStorage.getItem('auth_token')
    })
    expect(authToken).toBeTruthy()
  })

  test('should enforce proper role-based access control', async ({ page }) => {
    // Login as donor-only user
    await page.goto('http://localhost:3001/login')
    
    await page.fill('input[name="username"]', 'donor_user')
    await page.fill('input[name="password"]', 'donor123!')
    await page.click('[data-testid="login-submit-button"]')
    
    await page.waitForTimeout(3000)
    
    // Donor should NOT be able to access assessor-specific pages
    const restrictedPaths = [
      '/assessor/dashboard',
      '/assessor/planning',
      '/assessor/assessments/new'
    ]
    
    for (const path of restrictedPaths) {
      const response = await page.goto(`http://localhost:3001${path}`)
      
      if (response) {
        // Should be redirected to unauthorized page or dashboard
        const status = response.status()
        expect(status).toBe(302) // Redirect
      }
      
      // Or if it loads, it should show access denied
      await page.waitForTimeout(1000)
      const currentUrl = page.url()
      
      // Should not remain on the restricted page
      if (currentUrl.includes(path)) {
        const accessDenied = await page.getByText(/access denied|unauthorized|not allowed/i).isVisible()
        expect(accessDenied).toBe(true)
      }
    }
    
    // Donor SHOULD be able to access donor-specific pages
    const allowedPaths = [
      '/donor/dashboard',
      '/donor/profile',
      '/donor/entities',
      '/donor/commitments'
    ]
    
    for (const path of allowedPaths) {
      await page.goto(`http://localhost:3001${path}`)
      await page.waitForTimeout(2000)
      
      // Should load successfully without access denied
      const accessDenied = await page.getByText(/access denied|unauthorized/i).isVisible()
      expect(accessDenied).toBe(false)
      
      // Should not redirect away from donor pages
      const currentUrl = page.url()
      expect(currentUrl).toContain(path)
    }
  })

  test('should handle missing authentication tokens gracefully', async ({ page }) => {
    // Clear any existing auth
    await page.goto('http://localhost:3001')
    await page.evaluate(() => {
      localStorage.removeItem('auth_token')
      sessionStorage.clear()
    })
    
    // Try to access donor-protected page without authentication
    const response = await page.goto('http://localhost:3001/donor/profile')
    
    // Should redirect to login page
    if (response) {
      expect(response.status()).toBe(302)
    }
    
    await page.waitForTimeout(2000)
    const currentUrl = page.url()
    expect(currentUrl).toContain('/login')
  })

  test('should show donor dashboard links based on proper permissions', async ({ page }) => {
    // Login as donor user
    await page.goto('http://localhost:3001/login')
    
    await page.fill('input[name="username"]', 'donor_user')
    await page.fill('input[name="password"]', 'donor123!')
    await page.click('[data-testid="login-submit-button"]')
    
    await page.waitForTimeout(3000)
    
    // Should see donor dashboard tile
    const donorTile = page.getByTestId('donor-dashboard-tile')
    await expect(donorTile).toBeVisible()
    
    // Should see donor registration portal link
    const donorRegistrationLink = page.getByTestId('donor-registration-portal-link')
    await expect(donorRegistrationLink).toBeVisible()
    
    // Click donor dashboard tile
    await donorTile.click()
    
    // Should navigate to donor dashboard
    await page.waitForTimeout(2000)
    const currentUrl = page.url()
    expect(currentUrl).toContain('/donor/dashboard')
  })
})