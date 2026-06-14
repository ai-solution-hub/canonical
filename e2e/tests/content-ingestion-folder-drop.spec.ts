/**
 * {56.12} — folder-drop async ingest UI happy-path (ID-56 Path B).
 *
 * Scope: this test proves the FOLDER-DROP UI flow drives off REAL poll state —
 * drop a file → "Stage & ingest" → staging view → polling view → ingested
 * success card once the content_items row appears.
 *
 * Why the API is mocked here (and the synchronous upload e2e is NOT): Path B
 * stages bytes into a live cocoindex corpus and triggers an async incremental
 * walk on the worker (`POST /stage` + `POST /walk`). That worker is not present
 * in CI, and the end-to-end stage→walk→content_items→ingested path is recorded
 * as a manual-staging verification follow-up (see the {56.12} journal). What we
 * CAN and MUST verify deterministically in CI is that the UI:
 *   (a) POSTs the file to the authed /api/ingest/folder-drop route,
 *   (b) hands the returned source_file to the poll loop,
 *   (c) shows pending state while the row is absent, and
 *   (d) flips to the ingested success card the moment the poll reports the row
 *       — driven by the poll response, NOT a cosmetic timer.
 * So the two NEW routes are stubbed via page.route(); the component logic under
 * test (mutation → poll → terminal transition) is exercised for real.
 */

import { test, expect } from '../fixtures';

test.describe('Content ingestion -- {56.12} folder-drop async (Path B)', () => {
  test('stages a file then polls content_items until ingested', async ({
    authenticatedPage: page,
  }) => {
    test.setTimeout(60_000);

    const SOURCE_FILE = 'folder-drop-e2e.md';
    const ITEM_ID = '00000000-0000-4000-8000-0000000056c1';
    let pollCount = 0;

    // Stub the stage+walk trigger route — accept the upload, echo the
    // source_file the poll loop will correlate on.
    await page.route('**/api/ingest/folder-drop', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      await route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({
          sourceFile: SOURCE_FILE,
          destPath: `folder-drop/${SOURCE_FILE}`,
          stageRequestId: 'e2e-req',
        }),
      });
    });

    // Stub the poll route — report "not yet" for the first two polls, then
    // "ingested", proving the UI flips on the REAL poll response.
    await page.route('**/api/ingest/folder-drop/status**', async (route) => {
      pollCount += 1;
      const ingested = pollCount >= 2;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ingested,
          itemId: ingested ? ITEM_ID : null,
        }),
      });
    });

    // 1. Navigate to /item/new and switch to the Upload file tab.
    await page.goto('/item/new');
    await expect(page.getByRole('tablist')).toBeVisible({ timeout: 10_000 });
    await page.getByRole('tab', { name: /Upload file/i }).click();
    await expect(
      page.locator('section[aria-label="Upload documents"]'),
    ).toBeVisible({ timeout: 10_000 });

    // 2. Attach a small markdown fixture to the dropzone's hidden input.
    const fileInput = page
      .locator('section[aria-label="Upload documents"] input[type="file"]')
      .first();
    await fileInput.setInputFiles({
      name: SOURCE_FILE,
      mimeType: 'text/markdown',
      buffer: Buffer.from('# Folder drop e2e\n\nbody text\n'),
    });
    await expect(page.getByText(SOURCE_FILE).first()).toBeVisible({
      timeout: 10_000,
    });

    // 3. Click "Stage & ingest" (Path B) and wait for the trigger POST.
    const stagePromise = page.waitForResponse(
      (resp) =>
        resp.url().includes('/api/ingest/folder-drop') &&
        !resp.url().includes('/status') &&
        resp.request().method() === 'POST',
    );
    await page.getByTestId('folder-drop-ingest-button').click();
    const stageResp = await stagePromise;
    expect(stageResp.status()).toBe(202);

    // 4. The active (staging/polling) view appears while the row is absent.
    await expect(page.getByTestId('folder-drop-active')).toBeVisible({
      timeout: 10_000,
    });

    // 5. Once the poll reports the row, the ingested success card renders.
    await expect(page.getByTestId('folder-drop-ingested')).toBeVisible({
      timeout: 30_000,
    });

    // The transition was driven by the poll loop reporting the row, so the
    // poll endpoint must have been hit at least twice (pending → ingested).
    expect(pollCount).toBeGreaterThanOrEqual(2);
  });
});
