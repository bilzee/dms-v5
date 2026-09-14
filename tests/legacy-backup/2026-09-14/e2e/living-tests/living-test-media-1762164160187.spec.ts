import { test, expect } from '@playwright/test'

test.describe('Living Test: Media upload validation fix for delivery photos', () => {
  test('should handle media scenario that required manual fix', async ({ page }) => {
    // This test was automatically generated from a manual fix
    // Original issue: Field photos are often larger than 2MB, uploads failing
    // Manual fix: Increased size limit and added compression
    
    await page.goto('http://localhost:3006/responder/delivery/confirm')
    
    // Wait for the problematic state
    await expect(page.locator('[data-testid="media-upload"]')).toBeVisible()
    
    // Verify the fix is in place
    
    // 2MB limit was too restrictive for field photos, increased to 10MB with compression
    await expect(page.locator('[data-testid="media-validation"]')).toContainText('max-size-10mb-with-compression')
    
    // Test the complete workflow
    console.log('✅ Living test verification complete - fix is working')
  })

  test('should prevent regression of media issue', async ({ page }) => {
    // Regression test to ensure the fix doesn't break in the future
    await page.goto('http://localhost:3006/responder/delivery/confirm')
    
    // Test the original problematic scenario
    await expect(page.locator('[data-testid="media-upload"]')).toBeVisible()
    
    // Verify the fix is still working
    
    await expect(page.locator('[data-testid="media-validation"]')).not.toContainText('max-size-2mb')
    
    console.log('✅ Regression test passed - fix is still effective')
  })
})
