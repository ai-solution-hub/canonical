import { defineConfig, devices } from '@playwright/test';
import path from 'path';

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

// task-view (task-mirror) specs exercise the vendored task-view patch-server,
// not Canonical product surfaces — they are excluded from the Canonical browser
// projects (and therefore the nightly chromium-desktop lane). Their failures
// (e.g. `spawn bun ENOENT` from the spawned patch-server) are tracked + fixed
// in the task-view lane, not gated against Canonical. The spec file is retained
// so it can still be run via an explicit invocation.
const taskViewSpecs = '**/task-mirror-*.spec.ts';

// Specs the Canonical browser projects skip. task-view is the only permanent
// exclusion (it drives the vendored task-view patch-server, not Canonical
// surfaces). The prior temporary bid-* exclusion (gated on id-130 {130.9}
// regenerating the api.* views) was removed once {130.9} landed — bl-420
// retired the gate; bid-*.spec.ts rejoins the nightly unconditionally.
const nightlyExcludedSpecs = [taskViewSpecs];

export default defineConfig({
  testDir: './e2e/tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : 3,
  // id-128 {128.7}: the sharded nightly sets PW_BLOB_REPORT=1 so each shard emits
  // a `blob` report; a downstream `merge-reports` job stitches the shards into one
  // aggregated HTML report. Smoke + non-sharded CI keep html/list/github; local
  // keeps html/list. (Unset PW_BLOB_REPORT → unchanged for every existing lane.)
  reporter: process.env.PW_BLOB_REPORT
    ? [['blob']]
    : process.env.CI
      ? [['html'], ['list'], ['github']]
      : [['html'], ['list']],
  // Web-first assertions auto-retry up to this budget before failing — gives
  // settling UI (view transitions, debounced effects) room to converge without
  // a fixed sleep. Sits above the per-assertion default (5s) but below the
  // per-action/navigation caps so a genuinely stuck assertion still fails fast.
  expect: { timeout: 10_000 },
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
  // Hydration-mismatch root-cause investigation is tracked as backlog item
  // bl-337 (BUG-S19-HYD) — resolved via suppressHydrationWarning on the
  // dashboard activity-feed relative-time spans.
  // {128.8}: env-overridable so the sharded nightly drives tighter fail-fast
  // budgets (PW_GLOBAL_TIMEOUT_MS / PW_MAX_FAILURES per shard) while smoke and
  // local keep the CI defaults below — env unset → byte-identical to before.
  globalTimeout: process.env.PW_GLOBAL_TIMEOUT_MS
    ? Number(process.env.PW_GLOBAL_TIMEOUT_MS)
    : process.env.CI
      ? 12 * 60_000
      : undefined,
  maxFailures: process.env.PW_MAX_FAILURES
    ? Number(process.env.PW_MAX_FAILURES)
    : process.env.CI
      ? 5
      : 0,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
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
      testIgnore: nightlyExcludedSpecs,
      use: {
        ...devices['Desktop Chrome'],
        storageState: authFile,
      },
      dependencies: ['setup'],
    },
    {
      name: 'chromium-mobile',
      testIgnore: nightlyExcludedSpecs,
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
    // id-128 {128.6}: the nightly serves a local PRODUCTION build via `next start`
    // (it sets PLAYWRIGHT_WEB_SERVER_CMD='bun run start'), so every route is
    // precompiled — there is NO next-dev compile-on-first-hit, which is what
    // produced run #9's `page.goto: Timeout 15000ms` storm under --workers=3.
    // Smoke + local default to `bun dev` (env unset) — unchanged.
    command: process.env.PLAYWRIGHT_WEB_SERVER_CMD ?? 'bun dev',
    port: Number(process.env.PLAYWRIGHT_WEB_SERVER_PORT ?? 3000),
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
});
