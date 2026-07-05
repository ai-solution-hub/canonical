/**
 * {56.12} — folder-drop UI mechanics: default retention class + per-file
 * admission failure handling.
 *
 * ID-131 "17-final" REWRITE (G-IMS-DELETE tail): the original spec covered
 * the async "Stage & ingest" Path B UI (`folder-drop-ingest-button` /
 * `folder-drop-active` / `folder-drop-ingested` testids, a poll loop against
 * `content_items`). That whole transport is retired —
 * `components/create-content/upload-tab-content.tsx`'s header comment
 * confirms BOTH the old synchronous `/api/upload` pipeline AND the async
 * stage-then-poll flow were replaced by ONE binding-admission gate
 * (`POST /api/ingest/folder-drop`, ID-138 {138.13}) that resolves
 * synchronously — there is no more poll loop to test.
 *
 * This file now covers UI mechanics that
 * `content-ingestion-upload.spec.ts` (the real, unmocked end-to-end
 * happy-path + re-upload-dedup test) does not: the DEFAULT retention class
 * (`keep_and_watch`, when the picker is left untouched) and per-file
 * admission-failure handling in a multi-file batch. `page.route()` mocking
 * IS appropriate here (unlike the sibling spec's "do not mock" rule) — the
 * point of THIS test is to deterministically exercise the UI's success/
 * failure branching, not the real Storage/RPC admission path.
 *
 * VERIFIED AGAINST PRODUCTION:
 *   - Upload tab lives at `section[aria-label="Upload documents"]`
 *     (`components/create-content/upload-tab-content.tsx`), reached via
 *     `/item/new?tab=upload`.
 *   - Retention picker: `#upload-retention-class`, defaulting to
 *     `keep_and_watch` ("Keep & watch") until changed.
 *   - Per-file admission results render in
 *     `[data-testid="admission-results"]`; a failed file shows its error
 *     text, a succeeded file shows its retention-class label (plus
 *     "already connected" when `wasMinted === false`).
 *   - `POST /api/ingest/folder-drop` is the single admission endpoint for
 *     every file in the batch (`hooks/use-file-upload-pipeline.ts`).
 */

import { test, expect } from '../fixtures';

test.describe('Content ingestion -- folder-drop UI mechanics (Upload tab)', () => {
  test('keeps the default "Keep & watch" retention class and surfaces a per-file admission failure without blocking a later success', async ({
    authenticatedPage: page,
  }) => {
    test.setTimeout(60_000);

    let callCount = 0;
    await page.route('**/api/ingest/folder-drop', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      callCount += 1;
      if (callCount === 1) {
        // First file: simulate an admission failure (e.g. a busy writer
        // fence) — the route surfaces a clean JSON error envelope.
        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({
            error: 'Corpus writer is busy — try again shortly',
            stage: 'fence',
          }),
        });
        return;
      }
      // Second file: succeeds, echoing the default retention class back —
      // proves the UI never overrode it just because an earlier file failed.
      await route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({
          sourceFile: 'folder-drop-e2e-ok.md',
          destPath: 'folder-drop/folder-drop-e2e-ok.md',
          sourceDocumentId: '00000000-0000-4000-8000-0000000056c2',
          wasMinted: true,
          retentionClass: 'keep_and_watch',
        }),
      });
    });

    // 1. Navigate straight to the Upload tab via deep link.
    await page.goto('/item/new?tab=upload');
    await expect(
      page.locator('section[aria-label="Upload documents"]'),
    ).toBeVisible({ timeout: 10_000 });

    // 2. The retention picker defaults to "Keep & watch" — never touched.
    await expect(page.locator('#upload-retention-class')).toHaveText(
      /Keep & watch/,
    );

    // 3. Attach and connect the first (failing) file.
    const fileInput = page
      .locator('section[aria-label="Upload documents"] input[type="file"]')
      .first();
    await fileInput.setInputFiles({
      name: 'folder-drop-e2e-fail.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from('# Folder drop e2e (fails)\n\nbody text\n'),
    });
    await expect(page.getByText('folder-drop-e2e-fail.md').first()).toBeVisible(
      { timeout: 10_000 },
    );

    const firstResponsePromise = page.waitForResponse(
      (resp) =>
        resp.url().includes('/api/ingest/folder-drop') &&
        resp.request().method() === 'POST',
    );
    await page.getByRole('button', { name: /^Connect/ }).click();
    const firstResponse = await firstResponsePromise;
    expect(firstResponse.status()).toBe(409);

    const resultsList = page.getByTestId('admission-results');
    await expect(resultsList).toBeVisible({ timeout: 10_000 });
    await expect(
      resultsList.getByText('folder-drop-e2e-fail.md'),
    ).toBeVisible();
    await expect(
      resultsList.getByText('Corpus writer is busy — try again shortly'),
    ).toBeVisible();

    // 4. Attach and connect a second file — the earlier failure must not
    //    block it, and the retention class must still be the default.
    await fileInput.setInputFiles({
      name: 'folder-drop-e2e-ok.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from('# Folder drop e2e (ok)\n\nbody text\n'),
    });
    await expect(page.getByText('folder-drop-e2e-ok.md').first()).toBeVisible({
      timeout: 10_000,
    });

    const secondResponsePromise = page.waitForResponse(
      (resp) =>
        resp.url().includes('/api/ingest/folder-drop') &&
        resp.request().method() === 'POST',
    );
    await page.getByRole('button', { name: /^Connect/ }).click();
    const secondResponse = await secondResponsePromise;
    expect(secondResponse.status()).toBe(202);
    const secondBody = await secondResponse.json();
    expect(secondBody.retentionClass).toBe('keep_and_watch');

    // 5. Both rows are visible: the earlier failure persists, and the new
    //    file shows the connected state with the default retention label.
    await expect(
      resultsList.getByText('folder-drop-e2e-fail.md'),
    ).toBeVisible();
    await expect(resultsList.getByText('folder-drop-e2e-ok.md')).toBeVisible();
    await expect(resultsList.getByText('Keep & watch')).toBeVisible();

    expect(callCount).toBe(2);
  });
});
