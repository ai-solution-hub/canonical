/**
 * VersionHistory `change_reason` round-trip regression test (S157 WP6 / M7).
 *
 * S153 WP3 added an optional `change_reason` field typed via `ChangeReasonInput`
 * and persisted to `content_history.change_reason`. The read path was wired to
 * `change_summary` instead — so user-typed reasons shipped dark.
 *
 * This test pins the fix: when the API returns a version row with
 * `change_reason`, the component must render it in the DOM so users can see
 * the reason they typed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createQueryWrapper } from '@/__tests__/helpers/query-wrapper';

// ---------------------------------------------------------------------------
// Mocks (hoisted)
// ---------------------------------------------------------------------------

vi.mock('@/hooks/use-display-names', () => ({
  useDisplayNames: vi.fn().mockReturnValue(new Map()),
}));

vi.mock('@/hooks/use-user-role', () => ({
  useUserRole: vi.fn().mockReturnValue({ canEdit: false }),
}));

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

import { VersionHistory } from '@/components/item-detail/version-history';

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const ITEM_ID = '11111111-1111-4111-8111-111111111111';

const SAMPLE_VERSION = {
  id: 'version-1',
  content_item_id: ITEM_ID,
  version: 3,
  title: 'Sample item',
  change_summary: 'Updated detail section',
  change_reason: 'rebrand refresh',
  change_type: 'edit',
  created_by: null,
  created_at: '2026-04-08T10:00:00Z',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('VersionHistory — change_reason round-trip (S157 WP6 / M7)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('surfaces change_reason returned by /api/items/[id]/history in the DOM', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        versions: [SAMPLE_VERSION],
        total: 1,
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { Wrapper } = createQueryWrapper();
    render(
      <VersionHistory
        itemId={ITEM_ID}
        currentContent="current body"
        currentTitle="Sample item"
      />,
      { wrapper: Wrapper },
    );

    // Expand the history panel to trigger the fetch
    const toggle = screen.getByRole('button', { name: /version history/i });
    await userEvent.click(toggle);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/items/${ITEM_ID}/history?limit=50`,
        undefined,
      );
    });

    // The change_summary is still surfaced, but the change_reason must also
    // appear so users can see the "Why change?" text they typed.
    await waitFor(() => {
      expect(screen.getByText(/rebrand refresh/)).toBeInTheDocument();
    });
  });

  it('omits change_reason span when the field is null', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        versions: [{ ...SAMPLE_VERSION, change_reason: null }],
        total: 1,
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { Wrapper } = createQueryWrapper();
    render(
      <VersionHistory
        itemId={ITEM_ID}
        currentContent="current body"
        currentTitle="Sample item"
      />,
      { wrapper: Wrapper },
    );

    const toggle = screen.getByRole('button', { name: /version history/i });
    await userEvent.click(toggle);

    await waitFor(() => {
      expect(screen.getByText('Updated detail section')).toBeInTheDocument();
    });

    expect(screen.queryByText(/rebrand refresh/)).not.toBeInTheDocument();
  });
});
