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
  // WP1.3 (S19): bound suite wall-clock under the workflow's 15-min budget.
  // S18-flagged run hit 15m0s budget exhaustion driven by an ECONNRESET storm
  // (dev-server flake or hydration-mismatch retry spiral). Three guards:
  //   - globalTimeout: hard suite cap below the workflow timeout so failure
  //     surfaces as a Playwright signal rather than a runner kill.
  //   - maxFailures: abort once enough failures accumulate to indicate the
  //     server is broken — no point burning 15m re-running against a crashed
  //     dev process.
  //   - per-action / per-navigation timeouts on `use`: cap individual waits
  //     so a hung response fails fast rather than starving the per-test 30s.
  // Hydration-mismatch root-cause investigation is a separate ticket
  // (BUG-S19-HYD; see docs/reference/product-backlog.md) — DO NOT touch
  // app/ or lib/ from this WP per S19 prompt.
  globalTimeout: process.env.CI ? 12 * 60_000 : undefined,
  maxFailures: process.env.CI ? 5 : 0,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
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
