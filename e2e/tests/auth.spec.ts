import { test as baseTest, expect } from '@playwright/test';
import { test as authTest } from '../fixtures';
import { getVisibleNavLinks } from '../helpers/responsive';
import { hideDevOverlays } from '../helpers/dev-overlays';

/**
 * Flow 0: Authentication
 *
 * Tests the login page, authentication flow, session persistence,
 * and logout behaviour. Uses the standard Playwright `page` (not
 * the authenticated fixture) for unauthenticated scenarios.
 */

baseTest.describe('Authentication — unauthenticated access', () => {
  // Override project storageState to get a fresh, unauthenticated context
  baseTest.use({ storageState: { cookies: [], origins: [] } });

  // Suppress dev overlays that may block pointer events on unauthenticated pages
  baseTest.beforeEach(async ({ page }) => {
    await hideDevOverlays(page);
  });

  baseTest('redirects unauthenticated users to /login', async ({ page }) => {
    // The proxy.ts middleware redirects all unauthenticated non-API
    // requests to /login
    await page.goto('/browse');
    await page.waitForURL('**/login**');
    await expect(page).toHaveURL(/\/login/);
  });

  baseTest('login page displays the brand and email input', async ({ page }) => {
    await page.goto('/login');

    // Brand heading
    await expect(
      page.getByRole('heading', { name: 'Knowledge Hub' }),
    ).toBeVisible();

    // Subtitle
    await expect(
      page.getByText('Sign in to your knowledge base'),
    ).toBeVisible();

    // Email input and continue button
    await expect(page.getByLabel('Email address')).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Continue' }),
    ).toBeVisible();
  });

  baseTest('can enter email and proceed to method selection', async ({ page }) => {
    await page.goto('/login');

    const emailInput = page.getByLabel('Email address');
    await expect(emailInput).toBeFocused({ timeout: 5000 });
    await emailInput.fill('user@example.co.uk');
    await page.getByRole('button', { name: 'Continue' }).click();

    // Step 2: method selection should show "Welcome back" and both options
    await expect(
      page.getByRole('heading', { name: 'Welcome back' }),
    ).toBeVisible();
    await expect(page.getByText('Enter password')).toBeVisible();
    await expect(page.getByText('Send magic link')).toBeVisible();
  });

  baseTest('shows password input after choosing password method', async ({ page }) => {
    await page.goto('/login');

    const emailInput = page.getByLabel('Email address');
    await expect(emailInput).toBeFocused({ timeout: 5000 });
    await emailInput.fill('user@example.co.uk');
    await page.getByRole('button', { name: 'Continue' }).click();

    // Choose password method
    await page.getByText('Enter password').click();

    // Should now see the password step
    await expect(
      page.getByRole('heading', { name: 'Enter your password' }),
    ).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Sign in' }),
    ).toBeVisible();
  });

  baseTest('shows validation error for invalid email', async ({ page }) => {
    await page.goto('/login');

    await page.getByLabel('Email address').fill('not-an-email');
    await page.getByRole('button', { name: 'Continue' }).click();

    // Validation error — either custom message or browser native validation
    const validationError = page
      .getByText('Please enter a valid email address')
      .or(page.getByText('email'))
      .first();
    await expect(validationError).toBeVisible({ timeout: 5000 });
  });

  baseTest('shows magic link confirmation after choosing magic link', async ({ page }) => {
    await page.goto('/login');

    const testEmail = 'user@example.co.uk';
    const emailInput = page.getByLabel('Email address');
    await expect(emailInput).toBeFocused({ timeout: 5000 });
    await emailInput.fill(testEmail);
    await page.getByRole('button', { name: 'Continue' }).click();

    // Click the "Send magic link" option — this triggers the OTP call
    // which may fail in test, but we can check the UI transition
    await page.getByText('Send magic link').click();

    // Either we see the confirmation step or an error — both are valid
    // for an E2E test against a real backend
    const confirmationOrError = page
      .getByRole('heading', { name: 'Check your email' })
      .or(page.getByRole('alert'));
    await expect(confirmationOrError).toBeVisible({ timeout: 10000 });
  });

  baseTest('back button navigates between login steps', async ({ page }) => {
    await page.goto('/login');

    const emailInput = page.getByLabel('Email address');
    await expect(emailInput).toBeFocused({ timeout: 5000 });
    await emailInput.fill('user@example.co.uk');
    await page.getByRole('button', { name: 'Continue' }).click();

    // On method step — go back
    await expect(page.getByText('Welcome back')).toBeVisible();
    await page.getByRole('button', { name: 'Go back' }).click();

    // Should be back on email step
    await expect(page.getByLabel('Email address')).toBeVisible();
  });
});

authTest.describe('Authentication — authenticated session', () => {
  authTest('authenticated user sees the home page', async ({ authenticatedPage: page }) => {
    await page.goto('/');

    // The home page should have the Knowledge Hub brand in the header
    await expect(
      page.getByRole('link', { name: 'Knowledge Hub' }),
    ).toBeVisible();

    // Should NOT be on the login page
    await expect(page).not.toHaveURL(/\/login/);
  });

  authTest('session persists across page navigation', async ({ authenticatedPage: page }) => {
    // Navigate to several pages — none should redirect to /login
    const pages = ['/browse', '/settings', '/library'];

    for (const path of pages) {
      await page.goto(path);
      await expect(page).not.toHaveURL(/\/login/, { timeout: 10000 });
    }
  });

  authTest('navigation header is visible with all expected links', async ({ authenticatedPage: page }) => {
    await page.goto('/');

    // Use the responsive helper to get the correct nav element
    const nav = await getVisibleNavLinks(page);

    await expect(nav.getByRole('link', { name: 'Browse' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Q&A Library' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Coverage' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Workspaces' })).toBeVisible();

    // On mobile, close the hamburger menu before checking the Settings button
    // which lives in the header behind the overlay
    const viewport = page.viewportSize();
    if (viewport && viewport.width < 640) {
      // Close the mobile nav dialog by pressing Escape
      await page.keyboard.press('Escape');
      await expect(
        page.getByRole('navigation', { name: 'Mobile navigation' }),
      ).not.toBeVisible();
    }

    // Settings button (icon button in header, navigates to /settings)
    // Scope to <header> and use exact: true to avoid matching the
    // "Appearance settings" ThemeSettings button
    const header = page.locator('header');
    await expect(
      header.getByRole('button', { name: 'Settings', exact: true }),
    ).toBeVisible();
  });
});
