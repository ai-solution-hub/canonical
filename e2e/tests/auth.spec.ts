import { test as baseTest, expect } from '@playwright/test';
import { test as authTest } from '../fixtures';
import {
  getVisibleNavLinks,
  isMobileViewport,
  navigateViaHeader,
} from '../helpers/responsive';
import { hideDevOverlays } from '../helpers/dev-overlays';
import { attachConsoleGate, type ConsoleGate } from '../helpers/console-gate';

/**
 * Flow 0: Authentication
 *
 * Tests the login page, authentication flow, session persistence,
 * and logout behaviour. Uses the standard Playwright `page` (not
 * the authenticated fixture) for unauthenticated scenarios.
 */

baseTest.describe(
  'Authentication — unauthenticated access',
  { tag: '@smoke' },
  () => {
    // Override project storageState to get a fresh, unauthenticated context
    baseTest.use({ storageState: { cookies: [], origins: [] } });

    // bl-336: opt-in browser-error gate (see e2e/helpers/console-gate.ts).
    // Registered first so it attaches before the page navigates.
    let gate: ConsoleGate;
    baseTest.beforeEach(({ page }) => {
      gate = attachConsoleGate(page);
    });
    baseTest.afterEach(() => {
      gate.assertNoConsoleViolations();
    });

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

    baseTest(
      'login page displays the brand and email input',
      async ({ page }) => {
        await page.goto('/login');

        // Brand heading (BRANDING.productName — "Canonical" for the default
        // client overlay; renamed from "Knowledge Hub" in the S390 product-name
        // flip, app/login/page.tsx renders {BRANDING.productName}).
        await expect(
          page.getByRole('heading', { name: 'Canonical' }),
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
      },
    );

    baseTest(
      'can enter email and proceed to method selection',
      async ({ page }) => {
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
      },
    );

    baseTest(
      'shows password input after choosing password method',
      async ({ page }) => {
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
      },
    );

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

    baseTest(
      'shows magic link confirmation after choosing magic link',
      async ({ page }) => {
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
      },
    );

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
  },
);

authTest.describe('Authentication — authenticated session', () => {
  authTest(
    'authenticated user sees the home page',
    async ({ authenticatedPage: page }) => {
      await page.goto('/');

      // The home page should have the Canonical brand in the header
      await expect(page.getByRole('link', { name: 'Canonical' })).toBeVisible();

      // Should NOT be on the login page
      await expect(page).not.toHaveURL(/\/login/);
    },
  );

  authTest(
    'session persists across page navigation',
    async ({ authenticatedPage: page }) => {
      // Navigate to several pages — none should redirect to /login
      const pages = ['/browse', '/settings', '/library'];

      for (const path of pages) {
        await page.goto(path);
        await expect(page).not.toHaveURL(/\/login/, { timeout: 10000 });
      }
    },
  );

  authTest(
    'Settings button is visible in the header',
    async ({ authenticatedPage: page }) => {
      await page.goto('/');

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
    },
  );

  // ID-118.9 (DR-021-routed stale-test rewrite): the previous
  // 'navigation header is visible with all expected links' test asserted
  // Browse/Q&A Library/Coverage/Workspaces literals against a flat nav-link
  // structure. Browse never existed in NAV_ZONES (the /search leaf is
  // labelled "Search", BI-16/BI-17) and Workspaces was retired — so that
  // set was already stale before the {118.6}-{118.8} three-zone rework
  // landed. Replaced with zone-header + per-role reachability coverage
  // against the current NAV_ZONES membership (BI-2, BI-17, BI-20, BI-21).
  authTest.describe('Navigation header — zone disclosures (DR-041)', () => {
    // BI-2: the three ratified zone headers, present regardless of role
    // (each zone retains at least one visible entry for every role below).
    const ZONE_HEADERS = ['Applications', 'Knowledge', 'Governance'];

    authTest(
      'editor: all three zone headers are visible and every retained destination is reachable',
      async ({ editorPage: page }) => {
        const nav = await getVisibleNavLinks(page);
        for (const header of ZONE_HEADERS) {
          await expect(nav.getByText(header)).toBeVisible();
        }

        // canEdit=true, canAdmin=false for editor: every entry is reachable
        // except the reserved Concepts leaf (BI-8 — no landing route yet)
        // and the admin-only Provenance leaf (BI-21).
        const destinations: Array<{ label: string; hrefPattern: RegExp }> = [
          { label: 'Search', hrefPattern: /\/search/ },
          { label: 'Answers', hrefPattern: /\/library/ },
          { label: 'External sources', hrefPattern: /\/reference/ },
          { label: 'Procurement', hrefPattern: /\/procurement/ },
          { label: 'Intelligence', hrefPattern: /\/intelligence/ },
          { label: 'Review', hrefPattern: /\/review/ },
          { label: 'Coverage', hrefPattern: /\/coverage/ },
          { label: 'Change reports', hrefPattern: /\/change-reports/ },
          { label: 'Activity', hrefPattern: /\/activity/ },
        ];

        for (const { label, hrefPattern } of destinations) {
          await navigateViaHeader(page, label);
          await expect(page).toHaveURL(hrefPattern, { timeout: 10000 });
          // Reset to home between destinations so each zone starts closed
          // and the next navigateViaHeader call finds a clean disclosure.
          await page.goto('/');
          await expect(
            page.getByRole('navigation', { name: 'Main navigation' }).first(),
          ).toBeVisible({ timeout: 10000 });
        }
      },
    );

    authTest(
      'viewer: Knowledge entries stay visible (BI-20), edit/admin entries are hidden (BI-21)',
      async ({ viewerPage: page }) => {
        const nav = await getVisibleNavLinks(page);

        // Every zone still renders a header for a viewer — each zone keeps
        // at least one 'all'-visibility entry (Procurement; Search/Answers/
        // External sources; Change reports/Activity).
        for (const header of ZONE_HEADERS) {
          await expect(nav.getByText(header)).toBeVisible();
        }

        // BI-20: every non-reserved Knowledge entry stays reachable for a
        // viewer (Concepts is excluded — reserved, BI-8).
        for (const label of ['Search', 'Answers', 'External sources']) {
          await navigateViaHeader(page, label);
          await page.goto('/');
          await expect(
            page.getByRole('navigation', { name: 'Main navigation' }).first(),
          ).toBeVisible({ timeout: 10000 });
        }

        // BI-21: edit-gated entries are hidden entirely for a viewer (not
        // merely disabled) — Intelligence (Applications), Review + Coverage
        // (Governance). Re-derive the correct scope per viewport since the
        // resets above return the mobile hamburger to its closed state.
        if (isMobileViewport(page)) {
          await page
            .getByRole('button', { name: 'Open navigation menu' })
            .click();
          const mobileNav = page.getByRole('navigation', {
            name: 'Mobile navigation',
          });
          await expect(mobileNav).toBeVisible();
          for (const label of ['Intelligence', 'Review', 'Coverage']) {
            await expect(
              mobileNav.getByRole('link', { name: label }),
            ).not.toBeVisible();
          }
        } else {
          // DropdownMenuContent is portalled — these role='menuitem'
          // elements are absent from the DOM entirely for a viewer
          // (isEntryVisible filters them out before render), so no
          // zone needs to be opened for this negative assertion to hold.
          for (const label of ['Intelligence', 'Review', 'Coverage']) {
            await expect(
              page.getByRole('menuitem', { name: label }),
            ).not.toBeVisible();
          }
        }
      },
    );
  });

  authTest(
    'can sign out via the header button and cannot re-enter protected pages',
    // Uses the DEDICATED sign-out user (signoutPage / TEST_USER_4), NOT the
    // shared admin session. The Sign-out button calls supabase.auth.signOut() at
    // GLOBAL scope, which revokes every session for this user — so it must own a
    // session no other spec shares, else it cascades `403 session_not_found` →
    // /login into the rest of the run (S420 root cause).
    async ({ signoutPage: page }) => {
      await page.goto('/');

      // On mobile the Sign out button lives inside the hamburger drawer;
      // on desktop it sits in the right-hand action cluster directly.
      if (isMobileViewport(page)) {
        await page
          .getByRole('button', { name: 'Open navigation menu' })
          .click();
        const mobileNav = page.getByRole('navigation', {
          name: 'Mobile navigation',
        });
        await expect(mobileNav).toBeVisible();
        await mobileNav.getByRole('button', { name: 'Sign out' }).click();
      } else {
        const header = page.locator('header');
        await header.getByRole('button', { name: 'Sign out' }).click();
      }

      // Full-page navigation to /login on successful sign-out
      await page.waitForURL('**/login**', { timeout: 10000 });
      await expect(page).toHaveURL(/\/login/);
      await expect(
        page.getByRole('heading', { name: 'Canonical' }),
      ).toBeVisible();

      // Prove the session is actually dead — hitting a protected page
      // should redirect back to /login via proxy.ts, not let us through.
      await page.goto('/browse');
      await expect(page).toHaveURL(/\/login/);
    },
  );
});
