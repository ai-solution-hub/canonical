import { test, expect } from '../fixtures';
import { createServiceClient } from '../fixtures/supabase';

/**
 * Flow: Document Diff Review
 *
 * Tests the Document Diff Review page at /documents/[id]/diff.
 * This is a server-rendered page showing differences between two versions
 * of a source document, with review actions (Apply/Dismiss), filter tabs,
 * and bulk operations.
 *
 * Tests seed their own source_documents and source_document_diffs records.
 */

// ---------------------------------------------------------------------------
// Test data seeding helper
// ---------------------------------------------------------------------------

/**
 * Create a pair of source documents and diff entries for testing.
 * Returns IDs needed for navigation and cleanup.
 */
async function createTestDiffPair(prefix: string): Promise<{
  oldDocId: string;
  newDocId: string;
  diffEntryIds: string[];
}> {
  const supabase = createServiceClient();

  // Get an admin user ID for the uploaded_by field
  const { data: adminRole } = await supabase
    .from('user_roles')
    .select('user_id')
    .eq('role', 'admin')
    .limit(1)
    .single();

  const uploadedBy = adminRole?.user_id ?? '00000000-0000-0000-0000-000000000000';

  // Create old document (v1)
  const { data: oldDoc } = await supabase
    .from('source_documents')
    .insert({
      filename: `${prefix}_test_doc.docx`,
      original_filename: `${prefix}_test_doc.docx`,
      storage_path: `e2e-test/${prefix}_v1.docx`,
      content_hash: `hash_old_${Date.now()}`,
      file_size: 1024,
      mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      uploaded_by: uploadedBy,
      version: 1,
      status: 'processed',
    })
    .select('id')
    .single()
    .throwOnError();

  const oldDocId = oldDoc!.id;

  // Create new document (v2) linked via parent_id
  const { data: newDoc } = await supabase
    .from('source_documents')
    .insert({
      filename: `${prefix}_test_doc.docx`,
      original_filename: `${prefix}_test_doc.docx`,
      storage_path: `e2e-test/${prefix}_v2.docx`,
      content_hash: `hash_new_${Date.now()}`,
      file_size: 2048,
      mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      uploaded_by: uploadedBy,
      version: 2,
      status: 'processed',
      parent_id: oldDocId,
    })
    .select('id')
    .single()
    .throwOnError();

  const newDocId = newDoc!.id;

  // Create diff entries covering all types.
  // NOTE: Seeded data does not include `section_header` values. The diff review
  // component supports section headers for grouping entries, but this is not
  // testable with the current seed data. A future enhancement could add
  // section_header values to exercise that rendering path.
  const diffEntries = [
    {
      old_document_id: oldDocId,
      new_document_id: newDocId,
      diff_type: 'added',
      diff_mode: 'full_text',
      new_content: 'This is newly added content about cloud security.',
      status: 'pending_review',
    },
    {
      old_document_id: oldDocId,
      new_document_id: newDocId,
      diff_type: 'removed',
      diff_mode: 'full_text',
      old_content: 'This section about legacy systems has been removed.',
      status: 'pending_review',
    },
    {
      old_document_id: oldDocId,
      new_document_id: newDocId,
      diff_type: 'modified',
      diff_mode: 'full_text',
      old_content: 'Our approach to data protection follows GDPR guidelines.',
      new_content: 'Our approach to data protection follows GDPR and UK DPA 2018 guidelines.',
      similarity_score: 0.85,
      status: 'pending_review',
    },
    {
      old_document_id: oldDocId,
      new_document_id: newDocId,
      diff_type: 'unchanged',
      diff_mode: 'full_text',
      old_content: 'Company overview and mission statement remain the same.',
      new_content: 'Company overview and mission statement remain the same.',
      status: 'pending_review',
    },
  ];

  const { data: diffs } = await supabase
    .from('source_document_diffs')
    .insert(diffEntries)
    .select('id')
    .throwOnError();

  const diffEntryIds = (diffs ?? []).map((d) => d.id);

  return { oldDocId, newDocId, diffEntryIds };
}

/**
 * Clean up test diff data.
 */
async function cleanupTestDiffPair(
  oldDocId: string,
  newDocId: string,
  diffEntryIds: string[],
): Promise<void> {
  const supabase = createServiceClient();

  // Delete diff entries first (FK constraint)
  if (diffEntryIds.length > 0) {
    await supabase
      .from('source_document_diffs')
      .delete()
      .in('id', diffEntryIds);
  }

  // Delete documents
  await supabase.from('source_documents').delete().eq('id', newDocId);
  await supabase.from('source_documents').delete().eq('id', oldDocId);
}

// ---------------------------------------------------------------------------
// 1. Document Diff Page
// ---------------------------------------------------------------------------

test.describe('Document diff page', () => {
  test('diff page loads with document comparison header', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    const { oldDocId, newDocId, diffEntryIds } = await createTestDiffPair(
      `${workerData.prefix}-diff1`,
    );

    try {
      await page.goto(`/documents/${oldDocId}/diff`);

      // Wait for the diff review section to load.
      // L4 note: .first() is retained because the server-rendered page may
      // briefly render two section[aria-label="Document diff review"] elements
      // (e.g. error state + content state during hydration/navigation). Using
      // .first() targets the visible one reliably.
      const diffSection = page.locator('section[aria-label="Document diff review"]').first();
      await expect(diffSection).toBeVisible({ timeout: 15000 });

      // Heading "Document Diff Review" is visible
      await expect(
        diffSection.getByRole('heading', { name: 'Document Diff Review' }),
      ).toBeVisible();

      // Filename text is visible in the header (matches 2 elements: link + description)
      await expect(diffSection.getByText('_test_doc.docx').first()).toBeVisible();

      // Version indicators are visible
      await expect(diffSection.getByText(/v1/)).toBeVisible();
      await expect(diffSection.getByText(/v2/)).toBeVisible();
    } finally {
      await cleanupTestDiffPair(oldDocId, newDocId, diffEntryIds);
    }
  });

  test('summary bar shows correct diff type counts', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    const { oldDocId, newDocId, diffEntryIds } = await createTestDiffPair(
      `${workerData.prefix}-diff2`,
    );

    try {
      await page.goto(`/documents/${oldDocId}/diff`);

      const diffSection = page.locator('section[aria-label="Document diff review"]').first();
      await expect(diffSection).toBeVisible({ timeout: 15000 });

      // Summary counts are visible (scoped within diffSection to avoid duplicate elements)
      const summaryBar = diffSection.locator('[aria-label="Diff summary"]');
      await expect(summaryBar).toBeVisible();

      // Each type should show its count
      await expect(summaryBar.getByText('Added')).toBeVisible();
      await expect(summaryBar.getByText('Removed')).toBeVisible();
      await expect(summaryBar.getByText('Modified')).toBeVisible();
      await expect(summaryBar.getByText('Unchanged')).toBeVisible();

      // Pending count in the summary bar includes all entries with pending_review status
      // (4 total: added, removed, modified, unchanged -- all seeded as pending_review)
      await expect(summaryBar.getByText(/4 pending/)).toBeVisible();
    } finally {
      await cleanupTestDiffPair(oldDocId, newDocId, diffEntryIds);
    }
  });

  test('filter tabs show correct entries when selected', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    const { oldDocId, newDocId, diffEntryIds } = await createTestDiffPair(
      `${workerData.prefix}-diff3`,
    );

    try {
      await page.goto(`/documents/${oldDocId}/diff`);

      const diffSection = page.locator('section[aria-label="Document diff review"]').first();
      await expect(diffSection).toBeVisible({ timeout: 15000 });

      // The "All" tab is selected by default (scoped within diffSection)
      const allTab = diffSection.locator('#diff-tab-all');
      await expect(allTab).toHaveAttribute('aria-selected', 'true');

      // Count visible entry cards with "All" filter (unchanged hidden by default)
      const entryFeed = diffSection.locator('[role="feed"][aria-label="Diff review entries"]');
      await expect(entryFeed).toBeVisible();

      // Click "Added" filter tab
      const addedTab = diffSection.locator('#diff-tab-added');
      await addedTab.click();

      // After filtering, only added entries should be visible
      const addedBadge = diffSection.locator('[aria-label="Diff type: Added"]');
      await expect(addedBadge.first()).toBeVisible();

      // Removed/Modified badges should NOT be visible
      const removedBadge = diffSection.locator('[aria-label="Diff type: Removed"]');
      await expect(removedBadge).not.toBeVisible();

      // Click "All" tab to restore
      await allTab.click();
      await expect(allTab).toHaveAttribute('aria-selected', 'true');
    } finally {
      await cleanupTestDiffPair(oldDocId, newDocId, diffEntryIds);
    }
  });

  test('diff entry cards display correct content and badges', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    const { oldDocId, newDocId, diffEntryIds } = await createTestDiffPair(
      `${workerData.prefix}-diff4`,
    );

    try {
      await page.goto(`/documents/${oldDocId}/diff`);

      const diffSection = page.locator('section[aria-label="Document diff review"]').first();
      await expect(diffSection).toBeVisible({ timeout: 15000 });

      // Find a modified entry card (scoped within diffSection)
      const modifiedBadge = diffSection.locator('[aria-label="Diff type: Modified"]');
      await expect(modifiedBadge.first()).toBeVisible();

      // Status badge should show "Needs Review"
      const statusBadge = diffSection.locator('[aria-label="Status: Needs Review"]');
      await expect(statusBadge.first()).toBeVisible();

      // NOTE: Similarity score is only rendered by the Q&A mode DiffEntryCard,
      // not by FullTextDiffEntryCard. Since the seeded data uses full_text mode,
      // the similarity score (0.85) is stored in the DB but never displayed.
      // To test similarity rendering, a Q&A mode diff entry would need to be seeded.
      const similarityText = diffSection.getByText(/similarity: 85%/);
      await expect(similarityText).not.toBeVisible();

      // Apply and Dismiss buttons should be visible
      await expect(
        diffSection.locator('[aria-label="Apply this change"]').first(),
      ).toBeVisible();
      await expect(
        diffSection.locator('[aria-label="Dismiss this change"]').first(),
      ).toBeVisible();
    } finally {
      await cleanupTestDiffPair(oldDocId, newDocId, diffEntryIds);
    }
  });

  test('apply action updates entry status to Applied', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    const { oldDocId, newDocId, diffEntryIds } = await createTestDiffPair(
      `${workerData.prefix}-diff5`,
    );

    try {
      await page.goto(`/documents/${oldDocId}/diff`);

      const diffSection = page.locator('section[aria-label="Document diff review"]').first();
      await expect(diffSection).toBeVisible({ timeout: 15000 });

      // Capture the initial pending count from the bulk toolbar
      const toolbar = diffSection.locator('[role="toolbar"][aria-label="Bulk review actions"]');
      await expect(toolbar).toBeVisible();
      const initialStatusText = await toolbar.locator('[aria-live="polite"]').textContent();
      const initialPending = parseInt(initialStatusText?.match(/(\d+) pending/)?.[1] ?? '0', 10);

      // Find the first Apply button (scoped within diffSection)
      const applyButton = diffSection.locator('[aria-label="Apply this change"]').first();
      await expect(applyButton).toBeVisible();

      // Click Apply
      await applyButton.click();

      // Status should change to "Applied"
      await expect(
        diffSection.locator('[aria-label="Status: Applied"]').first(),
      ).toBeVisible({ timeout: 10000 });

      // Reset button should appear
      await expect(
        diffSection.locator('[aria-label="Reset to pending review"]').first(),
      ).toBeVisible();

      // Pending count in the bulk toolbar should have decreased by 1
      await expect(toolbar.locator('[aria-live="polite"]')).toHaveText(
        new RegExp(`${initialPending - 1} pending`),
        { timeout: 5000 },
      );
    } finally {
      await cleanupTestDiffPair(oldDocId, newDocId, diffEntryIds);
    }
  });

  test('dismiss action updates entry status to Dismissed', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    const { oldDocId, newDocId, diffEntryIds } = await createTestDiffPair(
      `${workerData.prefix}-diff6`,
    );

    try {
      await page.goto(`/documents/${oldDocId}/diff`);

      const diffSection = page.locator('section[aria-label="Document diff review"]').first();
      await expect(diffSection).toBeVisible({ timeout: 15000 });

      // Capture the initial pending count from the bulk toolbar
      const toolbar = diffSection.locator('[role="toolbar"][aria-label="Bulk review actions"]');
      await expect(toolbar).toBeVisible();
      const initialStatusText = await toolbar.locator('[aria-live="polite"]').textContent();
      const initialPending = parseInt(initialStatusText?.match(/(\d+) pending/)?.[1] ?? '0', 10);

      // Find the first Dismiss button (scoped within diffSection)
      const dismissButton = diffSection.locator('[aria-label="Dismiss this change"]').first();
      await expect(dismissButton).toBeVisible();

      // Click Dismiss
      await dismissButton.click();

      // Status should change to "Dismissed"
      await expect(
        diffSection.locator('[aria-label="Status: Dismissed"]').first(),
      ).toBeVisible({ timeout: 10000 });

      // Reset button should appear
      await expect(
        diffSection.locator('[aria-label="Reset to pending review"]').first(),
      ).toBeVisible();

      // Pending count in the bulk toolbar should have decreased by 1
      await expect(toolbar.locator('[aria-live="polite"]')).toHaveText(
        new RegExp(`${initialPending - 1} pending`),
        { timeout: 5000 },
      );
    } finally {
      await cleanupTestDiffPair(oldDocId, newDocId, diffEntryIds);
    }
  });

  test('bulk actions toolbar shows correct counts', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    const { oldDocId, newDocId, diffEntryIds } = await createTestDiffPair(
      `${workerData.prefix}-diff7`,
    );

    try {
      await page.goto(`/documents/${oldDocId}/diff`);

      const diffSection = page.locator('section[aria-label="Document diff review"]').first();
      await expect(diffSection).toBeVisible({ timeout: 15000 });

      // Bulk actions toolbar should be visible (scoped within diffSection)
      const toolbar = diffSection.locator('[role="toolbar"][aria-label="Bulk review actions"]');
      await expect(toolbar).toBeVisible();

      // "Accept All Pending" button should be visible and enabled
      const acceptAllButton = toolbar.locator('[aria-label="Accept all pending changes"]');
      await expect(acceptAllButton).toBeVisible();
      await expect(acceptAllButton).toBeEnabled();

      // "Dismiss All Pending" button should be visible and enabled
      const dismissAllButton = toolbar.locator('[aria-label="Dismiss all pending changes"]');
      await expect(dismissAllButton).toBeVisible();
      await expect(dismissAllButton).toBeEnabled();

      // Status text shows pending count for actionable entries only (non-unchanged = 3)
      await expect(toolbar.getByText(/3 pending, 0 applied, 0 dismissed/)).toBeVisible();
    } finally {
      await cleanupTestDiffPair(oldDocId, newDocId, diffEntryIds);
    }
  });

  test('full-text diff entries use correct labels', async ({
    authenticatedPage: page,
    workerData,
  }) => {
    const { oldDocId, newDocId, diffEntryIds } = await createTestDiffPair(
      `${workerData.prefix}-diff8`,
    );

    try {
      await page.goto(`/documents/${oldDocId}/diff`);

      const diffSection = page.locator('section[aria-label="Document diff review"]').first();
      await expect(diffSection).toBeVisible({ timeout: 15000 });

      // Full-text entries should use "Added:", "Removed:", "Old version:", "New version:" labels
      // not "Q:" labels used for Q&A mode.
      // The seeded data guarantees full_text mode entries, so these must be mandatory.

      // For an added entry, "Added:" label should be present (scoped within diffSection)
      const addedEntry = diffSection.locator('[aria-label="added text block"]');
      await expect(addedEntry).toBeVisible({ timeout: 5000 });
      await expect(addedEntry.getByText('Added:')).toBeVisible();

      // For a modified entry, "Old version:" and "New version:" labels should be present
      const modifiedCard = diffSection.locator('[aria-label="modified text block"]');
      await expect(modifiedCard).toBeVisible({ timeout: 5000 });
      await expect(modifiedCard.getByText('Old version:')).toBeVisible();
      await expect(modifiedCard.getByText('New version:')).toBeVisible();

      // "Q:" label should NOT appear (that is Q&A mode)
      const qaLabel = diffSection.getByText(/^Q: /);
      await expect(qaLabel).not.toBeVisible();
    } finally {
      await cleanupTestDiffPair(oldDocId, newDocId, diffEntryIds);
    }
  });
});
