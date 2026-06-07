/**
 * NearDuplicatesActionButtons Component Tests
 *
 * Verifies the three resolution actions:
 *  - Merge — opens the direction dialog and POSTs the chosen oldId/newId.
 *  - Confirm unique — POSTs to /confirm-unique with optional note.
 *  - Defer — invalidates cache + routes back; no API call.
 *
 * Plus the 409 branch (toast + redirect) and note-forwarding.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { installRadixPointerShims } from '@/__tests__/helpers/radix-pointer-shims';

const { mockMerge, mockConfirmUnique, mockToast, mockRouterPush } = vi.hoisted(
  () => ({
    mockMerge: vi.fn(),
    mockConfirmUnique: vi.fn(),
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
  const actual = await vi.importActual<typeof import('@/lib/query/fetchers')>(
    '@/lib/query/fetchers',
  );
  return {
    ...actual,
    postAdminNearDupMerge: mockMerge,
    postAdminNearDupConfirmUnique: mockConfirmUnique,
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
  usePathname: () => '/admin/content-dedup/near-duplicates/[pairId]',
  useSearchParams: () => new URLSearchParams(),
}));

import { NearDuplicatesActionButtons } from '@/components/admin/content-dedup/near-duplicates/near-duplicates-action-buttons';
import { createQueryWrapper } from '@/__tests__/helpers/query-wrapper';
import { ApiError } from '@/lib/query/fetchers';
import type { NearDupPairMember } from '@/lib/query/fetchers';

const LEFT_ID = '11111111-1111-4111-8111-111111111111';
const RIGHT_ID = '22222222-2222-4222-8222-222222222222';
const PAIR_ID = `${LEFT_ID}__${RIGHT_ID}`;

function makeMember(
  overrides: Partial<NearDupPairMember> = {},
): NearDupPairMember {
  return {
    id: LEFT_ID,
    title: 'A row',
    content: 'body',
    dedup_status: 'clean',
    created_at: '2026-04-21T12:00:00Z',
    primary_domain: 'access-control',
    content_type: 'q_a_pair',
    content_owner_id: null,
    ingest_source: 'example-reingest-2026-v2',
    superseded_by: null,
    archived_at: null,
    publication_status: 'published',
    ...overrides,
  };
}

const SIMILARITY = 0.943;
const THRESHOLD = 0.92;

function renderWithProviders(
  left: NearDupPairMember,
  right: NearDupPairMember,
  options: { similarity?: number; threshold?: number } = {},
) {
  const { Wrapper } = createQueryWrapper();
  return render(
    <NearDuplicatesActionButtons
      pairId={PAIR_ID}
      left={left}
      right={right}
      similarity={options.similarity ?? SIMILARITY}
      threshold={options.threshold ?? THRESHOLD}
    />,
    { wrapper: Wrapper },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  installRadixPointerShims();
});

describe('NearDuplicatesActionButtons', () => {
  it('Merge: opens dialog with default heuristic and POSTs chosen ids', async () => {
    const user = userEvent.setup();
    mockMerge.mockResolvedValueOnce({
      pairId: PAIR_ID,
      oldId: RIGHT_ID,
      newId: LEFT_ID,
      dedup_status: 'superseded',
    });

    // Both published + left newer → default = left supersedes right.
    const left = makeMember({
      id: LEFT_ID,
      created_at: '2026-04-21T12:00:00Z',
      publication_status: 'published',
    });
    const right = makeMember({
      id: RIGHT_ID,
      created_at: '2026-03-14T12:00:00Z',
      publication_status: 'published',
    });

    renderWithProviders(left, right);

    await user.click(screen.getByTestId('near-dup-merge-trigger'));
    await screen.findByRole('dialog', { name: /merge near-duplicate pair/i });

    await user.click(screen.getByTestId('merge-direction-confirm'));

    await waitFor(() => {
      expect(mockMerge).toHaveBeenCalledTimes(1);
    });
    // OQ2 audit context (similarity + threshold) is forwarded so the
    // merge audit row can record the resolution context.
    expect(mockMerge).toHaveBeenCalledWith(PAIR_ID, {
      oldId: RIGHT_ID,
      newId: LEFT_ID,
      similarity_at_resolution: SIMILARITY,
      threshold_at_resolution: THRESHOLD,
    });
    expect(mockRouterPush).toHaveBeenCalledWith(
      '/admin/content-dedup/near-duplicates',
    );
  });

  it('Confirm unique: POSTs to /confirm-unique with no body when no note', async () => {
    const user = userEvent.setup();
    mockConfirmUnique.mockResolvedValueOnce({
      pairId: PAIR_ID,
      leftDedupStatus: 'confirmed_unique',
      rightDedupStatus: 'confirmed_unique',
    });

    renderWithProviders(
      makeMember({ id: LEFT_ID }),
      makeMember({ id: RIGHT_ID }),
    );

    await user.click(screen.getByTestId('near-dup-confirm-unique'));

    await waitFor(() => {
      expect(mockConfirmUnique).toHaveBeenCalledTimes(1);
    });
    expect(mockConfirmUnique).toHaveBeenCalledWith(PAIR_ID, {
      similarity_at_resolution: SIMILARITY,
      threshold_at_resolution: THRESHOLD,
    });
    expect(mockToast.success).toHaveBeenCalledWith(
      expect.stringMatching(/confirmed unique/i),
    );
  });

  it('Confirm unique: forwards a typed note', async () => {
    const user = userEvent.setup();
    mockConfirmUnique.mockResolvedValueOnce({
      pairId: PAIR_ID,
      leftDedupStatus: 'confirmed_unique',
      rightDedupStatus: 'confirmed_unique',
    });

    renderWithProviders(
      makeMember({ id: LEFT_ID }),
      makeMember({ id: RIGHT_ID }),
    );

    await user.type(
      screen.getByTestId('near-dup-note-input'),
      'distinct topics',
    );
    await user.click(screen.getByTestId('near-dup-confirm-unique'));

    await waitFor(() => {
      expect(mockConfirmUnique).toHaveBeenCalledWith(PAIR_ID, {
        note: 'distinct topics',
        similarity_at_resolution: SIMILARITY,
        threshold_at_resolution: THRESHOLD,
      });
    });
  });

  it('Defer: routes back without an API call', async () => {
    const user = userEvent.setup();

    renderWithProviders(
      makeMember({ id: LEFT_ID }),
      makeMember({ id: RIGHT_ID }),
    );

    await user.click(screen.getByTestId('near-dup-defer'));

    expect(mockMerge).not.toHaveBeenCalled();
    expect(mockConfirmUnique).not.toHaveBeenCalled();
    expect(mockRouterPush).toHaveBeenCalledWith(
      '/admin/content-dedup/near-duplicates',
    );
  });

  it('Merge: 409 toast routes back to list', async () => {
    const user = userEvent.setup();
    mockMerge.mockRejectedValueOnce(
      new ApiError('already superseded', 409, 'OLD_ALREADY_SUPERSEDED', {}),
    );

    renderWithProviders(
      makeMember({ id: LEFT_ID }),
      makeMember({ id: RIGHT_ID }),
    );

    await user.click(screen.getByTestId('near-dup-merge-trigger'));
    await screen.findByRole('dialog', { name: /merge near-duplicate pair/i });
    await user.click(screen.getByTestId('merge-direction-confirm'));

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith(
        expect.stringMatching(/already resolved/i),
      );
    });
    expect(mockRouterPush).toHaveBeenCalledWith(
      '/admin/content-dedup/near-duplicates',
    );
  });

  it('Confirm unique: shows toast on non-409 error', async () => {
    const user = userEvent.setup();
    mockConfirmUnique.mockRejectedValueOnce(new Error('boom'));

    renderWithProviders(
      makeMember({ id: LEFT_ID }),
      makeMember({ id: RIGHT_ID }),
    );

    await user.click(screen.getByTestId('near-dup-confirm-unique'));

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith('boom');
    });
    expect(mockRouterPush).not.toHaveBeenCalled();
  });
});
