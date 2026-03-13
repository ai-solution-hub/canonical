import { defineConfig, devices } from '@playwright/test';
import path from 'path';

// Disable CopilotKit in E2E tests — eliminates health check overhead,
// error boundary, and runtime banners that interfere with test interactions
process.env.NEXT_PUBLIC_E2E = 'true';

// Load .env so Playwright has access to Supabase credentials.
// Using require() for dotenv to avoid ESM default-export quirks.
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('dotenv').config({ path: path.resolve(__dirname, '.env.local'), override: true });

const authFile = 'e2e/.auth/admin.json';

export default defineConfig({
  testDir: './e2e/tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : 3,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:3000',
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
  ],
  webServer: {
    command: 'bun dev',
    port: 3000,
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
});
