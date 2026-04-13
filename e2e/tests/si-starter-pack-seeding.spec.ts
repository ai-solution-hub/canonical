import { test, expect } from '../fixtures';
import { createServiceClient } from '../fixtures/supabase';

/**
 * Flow: SI Starter Pack Seeding
 *
 * Tests the starter pack seeding flow for intelligence workspaces:
 *   - Happy-path: create workspace, seed Procurement pack (4 feeds)
 *   - Idempotency: re-seeding the same pack does not duplicate feeds
 *   - Cross-pack: seeding a second pack adds feeds additively
 *   - A11Y: ARIA attributes on the seed dialog
 *
 * IMPORTANT — Database verification required:
 *   Every write-path test MUST verify DB state via createServiceClient(),
 *   not just UI text. The dialog shows the API response, which could be
 *   wrong. Only a direct DB query proves data was persisted correctly.
 *
 * Cleanup notes:
 *   The `guides` table has NO `workspace_id` column, so deleting a
 *   workspace does NOT cascade to guides. Guides must be cleaned up
 *   separately in afterAll.
 *
 * Forbidden patterns:
 *   - DO NOT check only UI text for write operations
 *   - DO NOT assume dialog text proves DB state
 *   - DO NOT skip the DB verification step after seeding
 *   - DO NOT rely on optimistic UI without reload verification
 */

test.describe('SI Starter Pack Seeding', () => {
  /** IDs of workspaces created during these tests — cleaned up in afterAll. */
  const createdWorkspaceIds: string[] = [];

  test.afterAll(async () => {
    const supabase = createServiceClient();

    // Safety-net cleanup: find any orphaned guides matching the test pattern.
    const { data: orphanGuides } = await supabase
      .from('guides')
      .select('id')
      .like('name', '%SI Seed%');

    if (orphanGuides && orphanGuides.length > 0) {
      const guideIds = orphanGuides.map((g) => g.id);
      await supabase.from('guides').delete().in('id', guideIds);
    }

    // Safety-net cleanup: find any orphaned workspaces matching the test pattern.
    // feed_sources CASCADE from workspaces, so deleting the workspace is sufficient.
    const { data: orphanWorkspaces } = await supabase
      .from('workspaces')
      .select('id')
      .like('name', '%SI Seed%');

    if (orphanWorkspaces && orphanWorkspaces.length > 0) {
      const wsIds = orphanWorkspaces.map((w) => w.id);
      await supabase.from('workspaces').delete().in('id', wsIds);
    }

    // Also delete by tracked IDs in case name pattern changed.
    if (createdWorkspaceIds.length > 0) {
      await supabase.from('workspaces').delete().in('id', createdWorkspaceIds);
    }
  });

  // ---------------------------------------------------------------------------
  // SS2.1.5-04 — Happy-path seeding (Procurement pack, 4 feeds)
  // ---------------------------------------------------------------------------

  test('SS2.1.5-04: seed Procurement starter pack adds 4 feeds', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    const supabase = createServiceClient();

    // 1. Navigate to /intelligence
    await page.goto('/intelligence');
    await expect(
      page.getByRole('heading', { name: 'Intelligence' }),
    ).toBeVisible({ timeout: 10000 });

    // 2. Click "Create Workspace"
    const createButton = page.getByRole('button', {
      name: /Create Workspace/i,
    });
    await expect(createButton).toBeVisible({ timeout: 5000 });
    await createButton.click();

    // 3. Wait for the create dialog to appear
    const createDialog = page.getByRole('dialog');
    await expect(createDialog).toBeVisible({ timeout: 5000 });

    // 4. Fill workspace name using worker prefix for isolation
    const workspaceName = `${workerData.prefix} SI Seed ${Date.now()}`;
    const nameInput = createDialog.locator('#ws-name');
    await expect(nameInput).toBeVisible({ timeout: 5000 });
    await nameInput.fill(workspaceName);

    // 5. Select a company profile (click the trigger, then the first option)
    const profileTrigger = createDialog.locator('#ws-profile');
    await expect(profileTrigger).toBeVisible({ timeout: 5000 });
    await profileTrigger.click();

    // Wait for the select dropdown to appear and pick the first option
    const firstOption = page.getByRole('option').first();
    await expect(firstOption).toBeVisible({ timeout: 5000 });
    await firstOption.click();

    // 6. Submit the form
    const submitButton = createDialog.getByRole('button', {
      name: /Create Workspace/i,
    });
    await expect(submitButton).toBeEnabled({ timeout: 3000 });
    await submitButton.click();

    // 7. Wait for workspace page to load (dialog closes, navigates to workspace)
    await page.waitForURL(/\/intelligence\/[a-f0-9-]+/, { timeout: 15000 });

    // 8. Capture workspace ID from URL
    const workspaceId = page
      .url()
      .split('/intelligence/')[1]
      ?.split('/')[0]
      ?.split('?')[0];
    expect(workspaceId).toBeTruthy();
    createdWorkspaceIds.push(workspaceId!);

    // 9. Navigate to the sources tab
    await page.goto(`/intelligence/${workspaceId}/sources`);
    await page.waitForLoadState('networkidle', { timeout: 15000 });

    // 10. Click "Seed Starter Pack" button
    const seedButton = page.getByRole('button', {
      name: /Seed Starter Pack/i,
    });
    await expect(seedButton).toBeVisible({ timeout: 5000 });
    await seedButton.click();

    // 11. The seed dialog appears
    const seedDialog = page.getByRole('dialog');
    await expect(seedDialog).toBeVisible({ timeout: 5000 });

    // 12. Select "Procurement" pack (smallest — 4 feeds)
    const procurementOption = seedDialog.getByText('Procurement', {
      exact: true,
    });
    await expect(procurementOption).toBeVisible({ timeout: 3000 });
    await procurementOption.click();

    // 13. Click "Seed Feeds" and intercept the API response
    const seedResponsePromise = page.waitForResponse(
      (resp) =>
        resp.url().includes('/seed-starter-pack') && resp.status() === 200,
    );
    const seedFeedsButton = seedDialog.getByRole('button', {
      name: /Seed Feeds/i,
    });
    await expect(seedFeedsButton).toBeEnabled({ timeout: 3000 });
    await seedFeedsButton.click();

    // 14. Verify API returned 200
    const seedResponse = await seedResponsePromise;
    expect(seedResponse.status()).toBe(200);

    // 15. Wait for completion — dialog should show "4 feeds added"
    await expect(seedDialog.getByText(/4 feeds? added/)).toBeVisible({
      timeout: 15000,
    });

    // 16. Click "Done" to close dialog
    const doneButton = seedDialog.getByRole('button', { name: /Done/i });
    await expect(doneButton).toBeVisible({ timeout: 3000 });
    await doneButton.click();
    await expect(seedDialog).not.toBeVisible({ timeout: 5000 });

    // ── DB VERIFICATION ─────────────────────────────────────────────────
    // Query feed_sources directly to prove rows were actually persisted.
    const { data: feeds, error: feedsErr } = await supabase
      .from('feed_sources')
      .select('id, name, url, source_type, workspace_id, is_active')
      .eq('workspace_id', workspaceId!)
      .order('name');
    if (feedsErr) throw feedsErr;

    // ASSERTION: exactly 4 feed_sources rows exist for this workspace
    expect(feeds, 'feed_sources must exist in DB').toBeTruthy();
    expect(feeds).toHaveLength(4);

    // ASSERTION: correct feed names from the Procurement pack
    const feedNames = feeds!.map((f) => f.name).sort();
    expect(feedNames).toEqual([
      'Contracts Finder (Google News)',
      'Crown Commercial Service News',
      'Find a Tender Service (Google News)',
      'Public Contracts Scotland (Google News)',
    ]);

    // ASSERTION: all feeds have correct source_type and are active
    for (const feed of feeds!) {
      expect(feed.source_type).toBe('rss');
      expect(feed.is_active).toBe(true);
      expect(feed.workspace_id).toBe(workspaceId);
    }

    // ── POST-RELOAD VERIFICATION ────────────────────────────────────────
    // Reload and verify feeds still render (proves DB persistence, not
    // optimistic UI state).
    await page.reload();
    await page.waitForLoadState('networkidle', { timeout: 15000 });
    await expect(
      page.getByText('Crown Commercial Service News'),
    ).toBeVisible({ timeout: 10000 });
  });

  // ---------------------------------------------------------------------------
  // SS2.1.5-05 — Idempotency: re-seeding the same pack
  // ---------------------------------------------------------------------------

  test('SS2.1.5-05: re-seeding the same pack reports feeds already exist', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    const supabase = createServiceClient();

    // This test depends on Test 1 having created and seeded a workspace.
    // Fallback: create + seed via service client if Test 1 didn't run.
    let workspaceId = createdWorkspaceIds[0];

    if (!workspaceId) {
      const { data: ws } = await supabase
        .from('workspaces')
        .insert({
          name: `${workerData.prefix} SI Seed ${Date.now()}`,
          type: 'intelligence',
          domain_metadata: {},
        })
        .select('id')
        .single()
        .throwOnError();
      workspaceId = ws!.id;
      createdWorkspaceIds.push(workspaceId);

      // Navigate to sources and seed Procurement first
      await page.goto(`/intelligence/${workspaceId}/sources`);
      await page.waitForLoadState('networkidle', { timeout: 15000 });

      const seedBtn = page.getByRole('button', {
        name: /Seed Starter Pack/i,
      });
      await expect(seedBtn).toBeVisible({ timeout: 5000 });
      await seedBtn.click();

      const dlg = page.getByRole('dialog');
      await expect(dlg).toBeVisible({ timeout: 5000 });
      await dlg.getByText('Procurement', { exact: true }).click();
      await dlg.getByRole('button', { name: /Seed Feeds/i }).click();
      await expect(dlg.getByText(/4 feeds? added/)).toBeVisible({
        timeout: 15000,
      });
      await dlg.getByRole('button', { name: /Done/i }).click();
      await expect(dlg).not.toBeVisible({ timeout: 5000 });
    }

    // ── DB BASELINE ─────────────────────────────────────────────────────
    // Record feed count before re-seeding
    const { count: countBefore } = await supabase
      .from('feed_sources')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId);
    expect(countBefore).toBe(4);

    // Navigate to sources page for this workspace
    await page.goto(`/intelligence/${workspaceId}/sources`);
    await page.waitForLoadState('networkidle', { timeout: 15000 });

    // 1. Open seed dialog again
    const seedButton = page.getByRole('button', {
      name: /Seed Starter Pack/i,
    });
    await expect(seedButton).toBeVisible({ timeout: 5000 });
    await seedButton.click();

    const seedDialog = page.getByRole('dialog');
    await expect(seedDialog).toBeVisible({ timeout: 5000 });

    // 2. Select "Procurement" again
    await seedDialog.getByText('Procurement', { exact: true }).click();

    // 3. Click "Seed Feeds" and intercept response
    const responsePromise = page.waitForResponse(
      (resp) =>
        resp.url().includes('/seed-starter-pack') && resp.status() === 200,
    );
    await seedDialog.getByRole('button', { name: /Seed Feeds/i }).click();
    const response = await responsePromise;
    expect(response.status()).toBe(200);

    // 4. Verify dialog shows feeds already existed
    await expect(
      seedDialog.getByText(/already existed/),
    ).toBeVisible({ timeout: 15000 });

    // 5. Close dialog
    await seedDialog.getByRole('button', { name: /Done/i }).click();
    await expect(seedDialog).not.toBeVisible({ timeout: 5000 });

    // ── DB VERIFICATION ─────────────────────────────────────────────────
    // ASSERTION: feed count is STILL exactly 4 (no duplicates created)
    const { count: countAfter } = await supabase
      .from('feed_sources')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId);
    expect(
      countAfter,
      'Feed count must not change after re-seeding the same pack',
    ).toBe(4);
  });

  // ---------------------------------------------------------------------------
  // SS2.1.5-06 — Cross-pack seeding adds feeds additively
  // ---------------------------------------------------------------------------

  test('SS2.1.5-06: seeding a second pack adds feeds without removing existing', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    const supabase = createServiceClient();

    // Re-use workspace from previous tests (Procurement already seeded)
    let workspaceId = createdWorkspaceIds[0];

    if (!workspaceId) {
      // Fallback: create + seed Procurement first
      const { data: ws } = await supabase
        .from('workspaces')
        .insert({
          name: `${workerData.prefix} SI Seed ${Date.now()}`,
          type: 'intelligence',
          domain_metadata: {},
        })
        .select('id')
        .single()
        .throwOnError();
      workspaceId = ws!.id;
      createdWorkspaceIds.push(workspaceId);

      await page.goto(`/intelligence/${workspaceId}/sources`);
      await page.waitForLoadState('networkidle', { timeout: 15000 });

      const seedBtn = page.getByRole('button', {
        name: /Seed Starter Pack/i,
      });
      await expect(seedBtn).toBeVisible({ timeout: 5000 });
      await seedBtn.click();

      const dlg = page.getByRole('dialog');
      await expect(dlg).toBeVisible({ timeout: 5000 });
      await dlg.getByText('Procurement', { exact: true }).click();
      await dlg.getByRole('button', { name: /Seed Feeds/i }).click();
      await expect(dlg.getByText(/4 feeds? added/)).toBeVisible({
        timeout: 15000,
      });
      await dlg.getByRole('button', { name: /Done/i }).click();
      await expect(dlg).not.toBeVisible({ timeout: 5000 });
    }

    // Navigate to sources
    await page.goto(`/intelligence/${workspaceId}/sources`);
    await page.waitForLoadState('networkidle', { timeout: 15000 });

    // 1. Open seed dialog
    const seedButton = page.getByRole('button', {
      name: /Seed Starter Pack/i,
    });
    await expect(seedButton).toBeVisible({ timeout: 5000 });
    await seedButton.click();

    const seedDialog = page.getByRole('dialog');
    await expect(seedDialog).toBeVisible({ timeout: 5000 });

    // 2. Select "Safeguarding" (5 feeds)
    await seedDialog.getByText('Safeguarding', { exact: true }).click();

    // 3. Click "Seed Feeds" and intercept response
    const responsePromise = page.waitForResponse(
      (resp) =>
        resp.url().includes('/seed-starter-pack') && resp.status() === 200,
    );
    await seedDialog.getByRole('button', { name: /Seed Feeds/i }).click();
    const response = await responsePromise;
    expect(response.status()).toBe(200);

    // 4. Verify "5 feeds added"
    await expect(seedDialog.getByText(/5 feeds? added/)).toBeVisible({
      timeout: 15000,
    });

    // 5. Close dialog
    await seedDialog.getByRole('button', { name: /Done/i }).click();
    await expect(seedDialog).not.toBeVisible({ timeout: 5000 });

    // ── DB VERIFICATION ─────────────────────────────────────────────────
    // ASSERTION: total feed_sources count is exactly 9 (4 Procurement + 5 Safeguarding)
    const { data: allFeeds, error: feedsErr } = await supabase
      .from('feed_sources')
      .select('id, name, source_type')
      .eq('workspace_id', workspaceId)
      .order('name');
    if (feedsErr) throw feedsErr;

    expect(allFeeds).toHaveLength(9);

    // ASSERTION: feeds from both packs present
    const feedNames = allFeeds!.map((f) => f.name);
    // Procurement pack feeds
    expect(feedNames).toContain('Crown Commercial Service News');
    expect(feedNames).toContain('Contracts Finder (Google News)');
    // Safeguarding pack feeds
    expect(feedNames).toContain('CQC Safeguarding News');
    expect(feedNames).toContain('Safeguarding News (Google News)');

    // ASSERTION: all feeds have source_type 'rss'
    for (const feed of allFeeds!) {
      expect(feed.source_type).toBe('rss');
    }

    // ── POST-RELOAD VERIFICATION ────────────────────────────────────────
    await page.reload();
    await page.waitForLoadState('networkidle', { timeout: 15000 });
    // Verify feeds from both packs render after reload
    await expect(
      page.getByText('Crown Commercial Service News'),
    ).toBeVisible({ timeout: 10000 });
    await expect(
      page.getByText('CQC Safeguarding News'),
    ).toBeVisible({ timeout: 10000 });
  });

  // ---------------------------------------------------------------------------
  // A11Y-02 — ARIA attributes on the seed dialog
  // ---------------------------------------------------------------------------

  test('A11Y-02: seed dialog has correct ARIA attributes', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    // Navigate to the pre-seeded intelligence workspace's sources page
    await page.goto(
      `/intelligence/${workerData.intelligenceWorkspaceId}/sources`,
    );
    await page.waitForLoadState('networkidle', { timeout: 15000 });

    // Open the seed dialog
    const seedButton = page.getByRole('button', {
      name: /Seed Starter Pack/i,
    });
    await expect(seedButton).toBeVisible({ timeout: 5000 });
    await seedButton.click();

    // Verify dialog ARIA attributes
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await expect(dialog).toHaveAttribute('aria-labelledby', /.+/);
    await expect(dialog).toHaveAttribute('aria-describedby', /.+/);

    // Verify the referenced elements contain expected content
    const labelId = await dialog.getAttribute('aria-labelledby');
    if (labelId) {
      const labelElement = page.locator(`#${labelId}`);
      await expect(labelElement).toContainText('Seed Starter Pack');
    }

    const descId = await dialog.getAttribute('aria-describedby');
    if (descId) {
      const descElement = page.locator(`#${descId}`);
      await expect(descElement).toContainText(/curated feeds/i);
    }

    // Close dialog to leave a clean state
    const cancelButton = dialog.getByRole('button', { name: /Cancel/i });
    await cancelButton.click();
    await expect(dialog).not.toBeVisible({ timeout: 5000 });
  });
});
