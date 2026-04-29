/**
 * ContentDedupActionButtons Component Tests
 *
 * Verifies the three resolution actions:
 *  - Confirm duplicate POSTs to .../confirm-duplicate
 *  - Confirm unique POSTs to .../confirm-unique
 *  - Mark superseded opens a dialog (default direction =
 *    canonical-supersedes-subject) and POSTs to .../supersede with body
 *    `{ canonicalId }`. Direction toggle swaps the path id and body id.
 *
 * Also verifies the 409 "row already resolved" branch routes back to
 * the queue, and that the supersede button is disabled when canonical
 * is null.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { installRadixPointerShims } from '@/__tests__/helpers/radix-pointer-shims';

const { mockMutationFetchJson, mockToast, mockRouterPush } = vi.hoisted(
  () => ({
    mockMutationFetchJson: vi.fn(),
    mockToast: {
      success: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warning: vi.fn(),
    },
    mockRouterPush: vi.fn(),
  }),
);

vi.mock('@/lib/query/fetchers', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/query/fetchers')>(
      '@/lib/query/fetchers',
    );
  return {
    ...actual,
    mutationFetchJson: mockMutationFetchJson,
  };
});

vi.mock('sonner', () => ({
  toast: mockToast,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockRouterPush,
    replace: vi.fn(),
    back: vi.fn(),
  }),
  usePathname: () => '/admin/content-dedup/[id]',
  useSearchParams: () => new URLSearchParams(),
}));

import { ContentDedupActionButtons } from '@/components/admin/content-dedup/content-dedup-action-buttons';
import { createQueryWrapper } from '@/__tests__/helpers/query-wrapper';
import { ApiError } from '@/lib/query/fetchers';
import type { SuspectedDuplicateRow } from '@/lib/query/fetchers';

const SUBJECT_ID = '11111111-1111-4111-8111-111111111111';
const CANONICAL_ID = '22222222-2222-4222-8222-222222222222';

function makeRow(
  overrides: Partial<SuspectedDuplicateRow> = {},
): SuspectedDuplicateRow {
  return {
    id: SUBJECT_ID,
    title: 'A row',
    content: 'body',
    dedup_status: 'suspected_duplicate',
    created_at: '2026-04-28T12:00:00Z',
    domain_primary: 'tech-it',
    content_owner_id: null,
    ingest_source: 'url_import',
    superseded_by: null,
    publication_status: 'in_review',
    metadata: null,
    ...overrides,
  };
}

function renderWithProviders(
  subject: SuspectedDuplicateRow,
  canonical: SuspectedDuplicateRow | null,
) {
  const { Wrapper } = createQueryWrapper();
  return render(
    <ContentDedupActionButtons subject={subject} canonical={canonical} />,
    { wrapper: Wrapper },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  installRadixPointerShims();
});

describe('ContentDedupActionButtons', () => {
  it('confirm-duplicate POSTs to the confirm-duplicate route and routes back', async () => {
    const user = userEvent.setup();
    mockMutationFetchJson.mockResolvedValueOnce({ id: SUBJECT_ID });

    renderWithProviders(makeRow(), makeRow({ id: CANONICAL_ID }));

    await user.click(screen.getByTestId('dedup-confirm-duplicate'));

    await waitFor(() => {
      expect(mockMutationFetchJson).toHaveBeenCalledTimes(1);
    });
    expect(mockMutationFetchJson).toHaveBeenCalledWith(
      `/api/admin/content-dedup/${SUBJECT_ID}/confirm-duplicate`,
      {},
    );
    expect(mockToast.success).toHaveBeenCalledWith(
      expect.stringMatching(/confirmed as duplicate/i),
    );
    expect(mockRouterPush).toHaveBeenCalledWith('/admin/content-dedup');
  });

  it('confirm-unique POSTs to the confirm-unique route', async () => {
    const user = userEvent.setup();
    mockMutationFetchJson.mockResolvedValueOnce({ id: SUBJECT_ID });

    renderWithProviders(makeRow(), makeRow({ id: CANONICAL_ID }));

    await user.click(screen.getByTestId('dedup-confirm-unique'));

    await waitFor(() => {
      expect(mockMutationFetchJson).toHaveBeenCalledTimes(1);
    });
    expect(mockMutationFetchJson).toHaveBeenCalledWith(
      `/api/admin/content-dedup/${SUBJECT_ID}/confirm-unique`,
      {},
    );
    expect(mockRouterPush).toHaveBeenCalledWith('/admin/content-dedup');
  });

  it('forwards a typed note when provided', async () => {
    const user = userEvent.setup();
    mockMutationFetchJson.mockResolvedValueOnce({ id: SUBJECT_ID });

    renderWithProviders(makeRow(), makeRow({ id: CANONICAL_ID }));

    await user.type(
      screen.getByTestId('dedup-note-input'),
      'looks identical',
    );
    await user.click(screen.getByTestId('dedup-confirm-unique'));

    await waitFor(() => {
      expect(mockMutationFetchJson).toHaveBeenCalledWith(
        `/api/admin/content-dedup/${SUBJECT_ID}/confirm-unique`,
        { note: 'looks identical' },
      );
    });
  });

  it('opens supersede dialog and POSTs with default direction (canonical supersedes subject)', async () => {
    const user = userEvent.setup();
    mockMutationFetchJson.mockResolvedValueOnce({ id: SUBJECT_ID });

    renderWithProviders(makeRow(), makeRow({ id: CANONICAL_ID }));

    await user.click(screen.getByTestId('dedup-supersede-trigger'));
    expect(
      await screen.findByRole('dialog', { name: /mark superseded/i }),
    ).toBeInTheDocument();

    // Default radio = canonical-supersedes-subject
    const defaultRadio = screen.getByTestId(
      'supersede-direction-canonical-supersedes-subject',
    );
    expect(defaultRadio).toBeChecked();

    await user.click(screen.getByTestId('supersede-confirm'));

    await waitFor(() => {
      expect(mockMutationFetchJson).toHaveBeenCalledTimes(1);
    });
    expect(mockMutationFetchJson).toHaveBeenCalledWith(
      `/api/admin/content-dedup/${SUBJECT_ID}/supersede`,
      { canonicalId: CANONICAL_ID },
    );
  });

  it('swaps path id and body id when subject-supersedes-canonical is selected', async () => {
    const user = userEvent.setup();
    mockMutationFetchJson.mockResolvedValueOnce({ id: SUBJECT_ID });

    renderWithProviders(makeRow(), makeRow({ id: CANONICAL_ID }));

    await user.click(screen.getByTestId('dedup-supersede-trigger'));
    await screen.findByRole('dialog', { name: /mark superseded/i });

    await user.click(
      screen.getByTestId('supersede-direction-subject-supersedes-canonical'),
    );
    await user.click(screen.getByTestId('supersede-confirm'));

    await waitFor(() => {
      expect(mockMutationFetchJson).toHaveBeenCalledTimes(1);
    });
    expect(mockMutationFetchJson).toHaveBeenCalledWith(
      `/api/admin/content-dedup/${CANONICAL_ID}/supersede`,
      { canonicalId: SUBJECT_ID },
    );
  });

  it('disables supersede button when canonical is null', () => {
    renderWithProviders(makeRow(), null);
    const supersede = screen.getByTestId('dedup-supersede-trigger');
    expect(supersede).toBeDisabled();
  });

  it('handles 409 (row already resolved) by toasting and routing back', async () => {
    const user = userEvent.setup();
    mockMutationFetchJson.mockRejectedValueOnce(
      new ApiError('row already resolved', 409, undefined, {}),
    );

    renderWithProviders(makeRow(), makeRow({ id: CANONICAL_ID }));

    await user.click(screen.getByTestId('dedup-confirm-duplicate'));

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith(
        expect.stringMatching(/already resolved/i),
      );
    });
    expect(mockRouterPush).toHaveBeenCalledWith('/admin/content-dedup');
  });

  it('shows toast on non-409 mutation error', async () => {
    const user = userEvent.setup();
    mockMutationFetchJson.mockRejectedValueOnce(new Error('boom'));

    renderWithProviders(makeRow(), makeRow({ id: CANONICAL_ID }));

    await user.click(screen.getByTestId('dedup-confirm-unique'));

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith('boom');
    });
    expect(mockRouterPush).not.toHaveBeenCalled();
  });
});
