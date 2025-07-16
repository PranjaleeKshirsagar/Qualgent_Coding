// Example: tests/onboarding.spec.js
// This is an example AppWright test file that would be referenced by the CLI

import { test, expect } from '@playwright/test';

test.describe('Onboarding Flow', () => {
  test('should complete user registration', async ({ page }) => {
    // Navigate to registration page
    await page.goto('/register');
    
    // Fill registration form
    await page.fill('[data-testid="email"]', 'user@example.com');
    await page.fill('[data-testid="password"]', 'password123');
    await page.fill('[data-testid="confirm-password"]', 'password123');
    await page.click('[data-testid="submit"]');
    
    // Verify successful registration
    await expect(page.locator('[data-testid="welcome-message"]')).toBeVisible();
    await expect(page.locator('[data-testid="welcome-message"]')).toContainText('Welcome');
  });

  test('should complete profile setup', async ({ page }) => {
    // Navigate to profile setup
    await page.goto('/profile-setup');
    
    // Fill profile information
    await page.fill('[data-testid="first-name"]', 'John');
    await page.fill('[data-testid="last-name"]', 'Doe');
    await page.fill('[data-testid="company"]', 'Test Company');
    await page.selectOption('[data-testid="role"]', 'developer');
    await page.click('[data-testid="save-profile"]');
    
    // Verify profile completion
    await expect(page.locator('[data-testid="setup-complete"]')).toBeVisible();
    await expect(page.locator('[data-testid="setup-complete"]')).toContainText('Profile Complete');
  });

  test('should complete app onboarding tutorial', async ({ page }) => {
    // Navigate to tutorial
    await page.goto('/tutorial');
    
    // Complete tutorial steps
    await page.click('[data-testid="tutorial-start"]');
    
    // Step 1: Welcome
    await expect(page.locator('[data-testid="tutorial-step-1"]')).toBeVisible();
    await page.click('[data-testid="tutorial-next"]');
    
    // Step 2: Features overview
    await expect(page.locator('[data-testid="tutorial-step-2"]')).toBeVisible();
    await page.click('[data-testid="tutorial-next"]');
    
    // Step 3: First test
    await expect(page.locator('[data-testid="tutorial-step-3"]')).toBeVisible();
    await page.click('[data-testid="tutorial-complete"]');
    
    // Verify tutorial completion
    await expect(page.locator('[data-testid="tutorial-complete-message"]')).toBeVisible();
  });

  test('should handle onboarding errors gracefully', async ({ page }) => {
    // Test with invalid email
    await page.goto('/register');
    await page.fill('[data-testid="email"]', 'invalid-email');
    await page.fill('[data-testid="password"]', 'password123');
    await page.click('[data-testid="submit"]');
    
    // Verify error message
    await expect(page.locator('[data-testid="error-message"]')).toBeVisible();
    await expect(page.locator('[data-testid="error-message"]')).toContainText('Invalid email');
  });
});

test.describe('Mobile Onboarding', () => {
  test('should work on mobile devices', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    
    await page.goto('/register');
    
    // Verify mobile-specific elements
    await expect(page.locator('[data-testid="mobile-menu"]')).toBeVisible();
    
    // Complete mobile registration
    await page.fill('[data-testid="email"]', 'mobile@example.com');
    await page.fill('[data-testid="password"]', 'password123');
    await page.click('[data-testid="mobile-submit"]');
    
    // Verify mobile success
    await expect(page.locator('[data-testid="mobile-success"]')).toBeVisible();
  });
}); 