import { defineConfig, devices } from '@playwright/test';
import path from 'path';

// Signal E2E test mode — disables non-essential overlays and third-party
// integrations that interfere with test interactions
process.env.NEXT_PUBLIC_E2E = 'true';

// Load .env so Playwright has access to Supabase credentials.
// Using require() for dotenv to avoid ESM default-export quirks.
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('dotenv').config({
  path: path.resolve(__dirname, '.env.local'),
  override: true,
});

const authFile = 'e2e/.auth/admin.json';

export default defineConfig({
  testDir: './e2e/tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : 3,
  reporter: 'html',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    // --- Setup project: authenticates once, saves browser state ---
    {
      name: 'setup',
      testDir: './e2e',
      testMatch: 'auth.setup.ts',
    },

    // --- Browser projects: depend on setup, load saved state ---
    {
      name: 'chromium-desktop',
      use: {
        ...devices['Desktop Chrome'],
        storageState: authFile,
      },
      dependencies: ['setup'],
    },
    {
      name: 'chromium-mobile',
      use: {
        ...devices['Pixel 5'],
        hasTouch: false, // Use mouse events — testing layout, not touch gestures
        storageState: authFile,
      },
      dependencies: ['setup'],
    },

    // --- Smoke project: tag-filtered curated subset for the PR-blocking
    //     CI gate (WP-G4.3). Runs only `@smoke`-tagged tests on Desktop
    //     Chrome. Selection criteria + tagged spec list:
    //     docs/audits/kh-production-readiness-phase-1/specs/
    //       wp-g4.3-e2e-smoke-spec.md §2.
    //     Local invocation: `bun run test:e2e -- --project=smoke`.
    {
      name: 'smoke',
      use: {
        ...devices['Desktop Chrome'],
        storageState: authFile,
      },
      dependencies: ['setup'],
      grep: /@smoke/,
    },
  ],
  webServer: {
    command: 'bun dev',
    port: Number(process.env.PLAYWRIGHT_WEB_SERVER_PORT ?? 3000),
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
});
