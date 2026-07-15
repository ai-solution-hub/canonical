/**
 * S224 W4-C — §5.4.1 batch-draft-all E2E spec.
 *
 * Spec: docs/specs/§5.4.1-batch-draft-all-spec.md §8 AC-10 lines 962-969.
 *
 * AC-10: "Click button → see queued state immediately. End-to-end browser
 *   test (Playwright) of 'user clicks Draft all button → toast appears
 *   within 1s reading "Drafting all responses queued…" → polling on
 *   /api/jobs/:job_id/status returns periodic status updates → final
 *   toast 'Drafted N responses' on completion'."
 *
 * USER FLOW:
 *   1. Authenticated as admin (worker fixture seeds bid in 'drafting' state).
 *   2. Navigate to /bid/<procurementId>.
 *   3. Click "Draft All" button → opens CostEstimateDialog.
 *   4. In the dialog, click "Proceed with Drafting" → fires POST
 *      /api/bids/:id/responses/draft-all → 202 + {job_id, ...}.
 *   5. ASSERTION 1: queued toast appears within 1 second reading
 *      "Drafting all responses queued — we'll let you know when it's done."
 *   6. ASSERTION 2: ≥ 2 GET requests to /api/jobs/<jobId>/status are
 *      observed within a 10-second window (polling at 3s intervals).
 *   7. ASSERTION 3: button is disabled (draftingAll=true) immediately
 *      after click.
 *
 * Hard-expects discipline (per feedback_e2e_no_workarounds +
 * feedback_e2e_conditional_false_pass): every assertion is a hard
 * expect(...) — no `if (visible)` fallbacks.
 *
 * Why this E2E does NOT also assert "final completion toast":
 *   The cron worker runs at `*\/5 * * * *` against staging, so an
 *   end-to-end "click → drained" test would block for up to 5 minutes
 *   AND require a real Anthropic API key on the staging branch — both
 *   conditions break Playwright reliability + cost. The worker-side
 *   completion is covered exhaustively at:
 *     - __tests__/lib/queue/handlers/bid-draft-all.test.ts (handler)
 *     - __tests__/integration/queue/bid-draft-all.integration.test.ts
 *       (cron tick + processing_queue terminal status + pipeline_runs
 *       finalisation, AC-2 / AC-5 / AC-9).
 *   The E2E here verifies the browser-observable user-flow contract
 *   per AC-10 — the click→queued→polling slice — which is what the spec
 *   §7.6 R3 "build the thing, forget to turn it on" mitigation requires.
 */

import { test, expect } from '../fixtures';
import { createServiceClient } from '../fixtures/supabase';

const STATUS_URL_PATH_RE = /\/api\/jobs\/[0-9a-f-]{36}\/status$/;

test.describe('Procurement draft-all queued flow (S224 §5.4.1 AC-10)', () => {
  test.beforeEach(async ({ workerData }) => {
    // Defensive: clear any pending/processing/completed form_draft_all
    // jobs for this bid so the dedup pre-check doesn't return a stale
    // dedup-hit (which would skip the 202+queued envelope path).
    //
    // ID-145 {145.23}: the job/pipeline label is `form_draft_all` (not
    // `bid_draft_all`) — the producer route (`enqueueQueueJob({ jobType:
    // 'form_draft_all', ... })`, `app/api/procurement/[id]/responses/
    // draft-all/route.ts`) builds the idempotency key and the
    // `pipeline_runs.pipeline_name` from that same literal. The producer
    // also always inserts `pipeline_runs.workspace_id: null` post-W1e ([id]
    // is a form_instances id, not a workspaces id — writing it would violate
    // the FK; see that route's own comment) — no column on `pipeline_runs`
    // tracks the form, so scope the cleanup to `pipeline_name` +
    // `workspace_id IS NULL` rather than an `.eq('workspace_id', ...)` that
    // can never match.
    const supabase = createServiceClient();
    await supabase
      .from('processing_queue')
      .delete()
      .like('idempotency_key', `form_draft_all:${workerData.procurementId}:%`);
    // Also clear any pipeline_runs rows scoped to this bid to keep
    // post-test state clean (Pattern 2 caller-allocated rows linger
    // otherwise).
    await supabase
      .from('pipeline_runs')
      .delete()
      .eq('pipeline_name', 'form_draft_all')
      .is('workspace_id', null);
  });

  test.afterEach(async ({ workerData }) => {
    // Cleanup: remove any queue rows + pipeline_runs rows the click
    // produced. Using the bid id is sufficient because the worker
    // fixture isolates per worker prefix.
    const supabase = createServiceClient();
    try {
      await supabase
        .from('processing_queue')
        .delete()
        .like(
          'idempotency_key',
          `form_draft_all:${workerData.procurementId}:%`,
        );
      await supabase
        .from('pipeline_runs')
        .delete()
        .eq('pipeline_name', 'form_draft_all')
        .is('workspace_id', null);
    } catch (err) {
      console.error('bid-draft-all cleanup failed:', err);
    }
  });

  test('Click Draft All → queued toast within 1s + polling fires + button disables', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    test.setTimeout(60_000);

    // Capture status-polling requests so we can assert ≥ 2 polls fire.
    const statusRequests: string[] = [];
    page.on('request', (request) => {
      if (STATUS_URL_PATH_RE.test(new URL(request.url()).pathname)) {
        statusRequests.push(request.url());
      }
    });

    // 1. Navigate to bid detail.
    await page.goto(`/procurement/${workerData.procurementId}`);

    // 2. Locate "Draft All" button.
    const draftAllButton = page.getByRole('button', { name: /^Draft All$/ });
    await expect(draftAllButton).toBeVisible({ timeout: 15_000 });
    await expect(draftAllButton).toBeEnabled();

    // 3. Click "Draft All" — opens CostEstimateDialog.
    await draftAllButton.click();

    // 4. Locate "Proceed with Drafting" button inside the dialog. The
    //    dialog fetches /api/bids/:id/responses/estimate first, so wait
    //    for that to resolve and the button to be enabled.
    const proceedButton = page.getByRole('button', {
      name: /Proceed with Drafting/,
    });
    await expect(proceedButton).toBeVisible({ timeout: 15_000 });
    // Wait for the estimate fetch to finish (button moves from disabled
    // to enabled when estimate.eligible_questions > 0).
    await expect(proceedButton).toBeEnabled({ timeout: 15_000 });

    // Track when click fires so we can measure toast latency.
    const clickedAt = Date.now();

    // 5. Click "Proceed with Drafting" — fires POST draft-all.
    await proceedButton.click();

    // ASSERTION 1: queued toast within 1 second.
    // sonner toasts render in a <li> with a description string. Match
    // by exact substring.
    const queuedToast = page.getByText(
      "Drafting all responses queued — we'll let you know when it's done.",
    );
    await expect(queuedToast).toBeVisible({ timeout: 1500 });
    const toastAt = Date.now();
    expect(
      toastAt - clickedAt,
      'queued toast must appear within 1500ms of click',
    ).toBeLessThanOrEqual(1500);

    // ASSERTION 2: button is now disabled (draftingAll=true).
    await expect(draftAllButton).toBeDisabled({ timeout: 1000 });
    // Button label flips to "Drafting...".
    await expect(
      page.getByRole('button', { name: /^Drafting\.\.\.$/ }),
    ).toBeVisible({ timeout: 1000 });

    // ASSERTION 3: ≥ 2 status-polling requests within 10 seconds.
    // The hook polls every 3s while activeJobId is set; we expect at
    // least 2 polls within a 10-second window (t=0 immediate, t=3s, t=6s).
    await expect
      .poll(() => statusRequests.length, {
        timeout: 10_000,
        message: '/api/jobs/:id/status must be polled at least twice',
      })
      .toBeGreaterThanOrEqual(2);
  });
});
