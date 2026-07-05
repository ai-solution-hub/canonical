/**
 * WP2 Phase 1 spec — 8.0.4 file upload ingestion
 *
 * ID-131 "17-final" REWRITE (G-IMS-DELETE tail): the original draft targeted
 * `POST /api/upload`, deleted under {131.24} (G-UPLOAD-GATE) along with its
 * `upload-review-step` testid and the synchronous extract/embed/classify/
 * summarise pipeline that landed a `content_items` row. There is now ONE
 * binding-admission gate (`lib/upload/folder-drop.ts` `stageAndWalk`,
 * ID-138 {138.13}): gate-pass -> Storage PUT (`corpus` bucket) -> an
 * admission-minted `source_documents` row via the `resolve_or_mint_
 * source_identity` M2 resolver (content_hash-first). NO `content_items` row
 * is created at admission time and no async worker is involved — DR-020
 * confirms the old `/stage` cocoindex-worker hop never worked from Vercel,
 * so this leg is now fully synchronous and safely exercisable end-to-end in
 * CI (no worker dependency).
 *
 * VERIFIED AGAINST PRODUCTION:
 *   - Admission endpoint is `POST /api/ingest/folder-drop`, multipart
 *     (`file` + optional `retention_class`), gated
 *     `getAuthorisedClient(['admin', 'editor'])`, returns 202 with
 *     `{ sourceFile, destPath, sourceDocumentId, wasMinted, retentionClass }`
 *     (`app/api/ingest/folder-drop/route.ts`).
 *   - New-item page tabs (verified at `app/item/new/new-item-tabs.tsx`):
 *     "Import from URL" | "Upload file" | "Batch Q&A" — the "Write content"
 *     tab died at {131.18}.
 *   - Upload tab UI (`components/create-content/upload-tab-content.tsx`):
 *     dropzone lives in `section[aria-label="Upload documents"]`, retention
 *     picker is `#upload-retention-class`, per-file results render in
 *     `[data-testid="admission-results"]`, the connect button reads
 *     "Connect" / "Connect (n)" / "Connecting…".
 *   - `e2e/fixtures/files/e2e-upload-sentinel-8-0-4.pdf` already exists
 *     (~721 bytes, deterministic, committed) — reused unchanged from the
 *     pre-{131.24} spec.
 *
 * USER FLOW:
 *   1. As admin (authenticatedPage), navigate to `/item/new?tab=upload`.
 *   2. Attach the fixture PDF to the dropzone's hidden file input.
 *   3. Select the "Ingest once" retention class (exercises the picker
 *      rather than relying on the `keep_and_watch` default).
 *   4. Click "Connect" and wait for the `POST /api/ingest/folder-drop`
 *      response (NOT a fixed timeout).
 *   5. Assert the response envelope AND the admission-results row.
 *   6. Assert DB state: a `source_documents` row exists at the returned
 *      `sourceDocumentId` with the expected `storage_path`, `content_hash`
 *      (locally-computed sha256, matched exactly), and `mime_type`.
 *   7. Assert the Storage object at `storage_path` is downloadable and its
 *      bytes match the fixture exactly.
 *   8. Re-attach and re-connect the SAME file: the admission gate resolves
 *      the SAME `sourceDocumentId` with `wasMinted: false` (idempotent
 *      content_hash-first resolution — `folder-drop.ts` line ~298), and
 *      the UI surfaces "already connected".
 *
 * ASSERTIONS (each must be verifiable from browser state OR DB state — no
 * trivial "element exists" checks; every assertion must map to a failure
 * mode; NO conditional skips):
 *   - The admission response is 202 with a truthy `sourceDocumentId` and
 *     `retentionClass === 'ingest_once'` (proves the picker selection
 *     round-trips to the route, not just the UI default).
 *   - A `source_documents` row exists at that id with non-null
 *     `storage_path` AND `content_hash` equal to the LOCALLY-computed
 *     sha256 of the fixture bytes (proves the stored row matches the file
 *     we uploaded, not some other row).
 *   - The Storage object at `storage_path` downloads successfully and its
 *     bytes are byte-for-byte identical to the fixture (NOT just "row
 *     exists"; the object must actually be present and correct).
 *   - The admission-results UI row shows the filename with the "connected"
 *     (CheckCircle) state and the "Ingest once" retention label.
 *   - Re-connecting the identical file returns `wasMinted: false` for the
 *     SAME `sourceDocumentId` (regression here means duplicate identities
 *     are silently minted for the same bytes) and the UI shows the
 *     "already connected" hint.
 *
 * FIXTURE DATA (pre-seeded before test runs):
 *   - `e2e/fixtures/files/e2e-upload-sentinel-8-0-4.pdf` (existing fixture,
 *     ~721 bytes, deterministic).
 *   - Admin user from `authenticatedPage` fixture.
 *   - No worker-data dependencies.
 *
 * EXPECTED FAILURE MODES (production-code breakages this test must catch —
 * each must map to >= 1 assertion above):
 *   - Admission silently swallowed (UI shows "connected", no DB row) →
 *     caught by the `source_documents` existence assertion.
 *   - `source_documents` row created but Storage object missing (broken
 *     Storage PUT) → caught by the storage download assertion.
 *   - Route stores the wrong bytes (e.g. swapped buffers between
 *     concurrent requests) → caught by the byte-for-byte + content_hash
 *     equality assertions.
 *   - Retention-class selection is ignored (route always applies the
 *     `keep_and_watch` default) → caught by the
 *     `retentionClass === 'ingest_once'` assertion.
 *   - Re-upload identity resolution regresses to "always mint a new row"
 *     → caught by the second-call `wasMinted === false` +
 *     same-`sourceDocumentId` assertions.
 *
 * ROLE SCOPING:
 *   Uses `authenticatedPage` (admin) fixture. Reason: admin can write
 *   content; viewer write attempts are 8.0.6 territory
 *   (`role-write-enforcement.spec.ts`).
 *
 * CLEANUP:
 *   afterEach: service-key delete of the captured `source_documents` row +
 *   its Storage object. Idempotent so partial-failure runs still leave a
 *   clean slate.
 *
 * EXPLICIT FORBIDDEN PATTERNS:
 *   - DO NOT mock `/api/ingest/folder-drop` with `page.route()` — the test
 *     must exercise the real admission gate: Storage PUT + identity RPC.
 *   - DO NOT replace the content_hash equality check with a truthiness
 *     check — a stub returning a fixed placeholder hash would pass.
 */

import { test, expect } from '../fixtures';
import { createServiceClient } from '../fixtures/supabase';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';

const FIXTURE_PDF = path.resolve(
  process.cwd(),
  'e2e/fixtures/files/e2e-upload-sentinel-8-0-4.pdf',
);
const FIXTURE_NAME = 'e2e-upload-sentinel-8-0-4.pdf';

interface AdmittedSource {
  sourceDocumentId: string;
  storagePath: string | null;
}

async function deleteAdmittedSource(item: AdmittedSource): Promise<void> {
  const svc = createServiceClient();
  if (item.storagePath) {
    await svc.storage.from('corpus').remove([item.storagePath]);
  }
  await svc.from('source_documents').delete().eq('id', item.sourceDocumentId);
}

test.describe('Content ingestion -- 8.0.4 file upload (binding-admission gate)', () => {
  const created: AdmittedSource[] = [];

  test.afterEach(async () => {
    while (created.length > 0) {
      const item = created.pop();
      if (!item) continue;
      try {
        await deleteAdmittedSource(item);
      } catch (err) {
        // Surface cleanup failures so they cannot mask leaked rows.
        console.error('cleanup failed for', item.sourceDocumentId, err);
      }
    }
  });

  test('connects a source, mints a source_documents row, and dedups on re-connect', async ({
    authenticatedPage: page,
  }) => {
    test.setTimeout(90_000);

    // Sanity-check the fixture exists with non-zero size and compute the
    // expected sha256 the route's M2 resolver derives independently.
    const fixtureBytes = fs.readFileSync(FIXTURE_PDF);
    expect(fixtureBytes.length).toBeGreaterThan(0);
    expect(fixtureBytes.length).toBeLessThan(50_000);
    const expectedHash = crypto
      .createHash('sha256')
      .update(fixtureBytes)
      .digest('hex');

    // 1. Navigate straight to the Upload tab via deep link.
    await page.goto('/item/new?tab=upload');
    await expect(
      page.locator('section[aria-label="Upload documents"]'),
    ).toBeVisible({ timeout: 10_000 });

    // 2. Attach the fixture to the dropzone's hidden input.
    const fileInput = page
      .locator('section[aria-label="Upload documents"] input[type="file"]')
      .first();
    await fileInput.setInputFiles(FIXTURE_PDF);
    await expect(page.getByText(FIXTURE_NAME).first()).toBeVisible({
      timeout: 10_000,
    });

    // 3. Select the "Ingest once" retention class (exercise the picker
    //    rather than relying on the keep_and_watch default).
    await page.locator('#upload-retention-class').click();
    await page.getByRole('option', { name: 'Ingest once' }).click();

    // 4. Click Connect and wait for the admission response.
    const admitResponsePromise = page.waitForResponse(
      (resp) =>
        resp.url().includes('/api/ingest/folder-drop') &&
        !resp.url().includes('/status') &&
        resp.request().method() === 'POST',
      { timeout: 60_000 },
    );
    await page.getByRole('button', { name: /^Connect/ }).click();

    const admitResponse = await admitResponsePromise;
    expect(admitResponse.status()).toBe(202);
    const admitBody = await admitResponse.json();
    expect(admitBody.sourceDocumentId).toBeTruthy();
    expect(admitBody.wasMinted).toBe(true);
    expect(admitBody.retentionClass).toBe('ingest_once');

    const sourceDocumentId: string = admitBody.sourceDocumentId;
    created.push({ sourceDocumentId, storagePath: null });

    // 5. The admission-results row shows the connected file + retention label.
    const resultsList = page.getByTestId('admission-results');
    await expect(resultsList).toBeVisible({ timeout: 10_000 });
    await expect(resultsList.getByText(FIXTURE_NAME)).toBeVisible();
    await expect(resultsList.getByText('Ingest once')).toBeVisible();

    // 6. DB-side assertions via service key.
    const svc = createServiceClient();
    const { data: sourceDoc, error: srcErr } = await svc
      .from('source_documents')
      .select('id, storage_path, content_hash, mime_type, filename')
      .eq('id', sourceDocumentId)
      .single();
    expect(srcErr).toBeNull();
    expect(sourceDoc).not.toBeNull();
    expect(sourceDoc!.storage_path).toBeTruthy();
    expect(sourceDoc!.content_hash).toBe(expectedHash);
    expect(sourceDoc!.mime_type).toBe('application/pdf');

    created[created.length - 1].storagePath = sourceDoc!.storage_path as string;

    // 7. Storage object check — actually downloadable, byte-for-byte match.
    const { data: blob, error: dlErr } = await svc.storage
      .from('corpus')
      .download(sourceDoc!.storage_path as string);
    expect(dlErr).toBeNull();
    expect(blob).not.toBeNull();
    const downloaded = Buffer.from(await blob!.arrayBuffer());
    expect(downloaded.length).toBe(fixtureBytes.length);
    expect(downloaded.equals(fixtureBytes)).toBe(true);

    // 8. Re-connect the SAME file: content_hash-first resolution must
    //    return the SAME sourceDocumentId with wasMinted: false, and the
    //    UI must surface the "already connected" hint.
    await fileInput.setInputFiles(FIXTURE_PDF);
    await expect(page.getByText(FIXTURE_NAME).first()).toBeVisible({
      timeout: 10_000,
    });

    const reconnectResponsePromise = page.waitForResponse(
      (resp) =>
        resp.url().includes('/api/ingest/folder-drop') &&
        !resp.url().includes('/status') &&
        resp.request().method() === 'POST',
      { timeout: 60_000 },
    );
    await page.getByRole('button', { name: /^Connect/ }).click();
    const reconnectResponse = await reconnectResponsePromise;
    expect(reconnectResponse.status()).toBe(202);
    const reconnectBody = await reconnectResponse.json();
    expect(reconnectBody.sourceDocumentId).toBe(sourceDocumentId);
    expect(reconnectBody.wasMinted).toBe(false);

    await expect(
      resultsList.getByText('already connected').first(),
    ).toBeVisible({ timeout: 10_000 });
  });
});
