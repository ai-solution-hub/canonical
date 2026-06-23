/**
 * /admin/q-a-pairs/dedup-proposals page-guard tests (ID-120 {120.8}, TECH P-4).
 *
 * Acceptance (testStrategy): a viewer is blocked — both the list and detail
 * server pages gate on `getAuthorisedClient(['admin','editor'])` and redirect
 * anyone who is not admin/editor (INV-22), leaking nothing about the surface.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// `notFound()` / `redirect()` HALT execution in Next.js by throwing — model
// that so a 404/redirect short-circuits the handler exactly as in production.
const { mockGetAuthorisedClient, mockRedirect, mockNotFound, NextHalt } =
  vi.hoisted(() => {
    class NextHalt extends Error {}
    const halt = () => {
      throw new NextHalt();
    };
    return {
      NextHalt,
      mockGetAuthorisedClient: vi.fn(),
      mockRedirect: vi.fn(halt),
      mockNotFound: vi.fn(halt),
    };
  });

vi.mock('@/lib/auth/client', () => ({
  getAuthorisedClient: mockGetAuthorisedClient,
}));

vi.mock('next/navigation', () => ({
  redirect: mockRedirect,
  notFound: mockNotFound,
}));

// The client components are not exercised here (the guard rejects before
// render); stub them so the import graph stays cheap.
vi.mock('@/components/admin/q-a-pairs/dedup-proposals/proposal-list', () => ({
  QaDedupProposalListClient: () => null,
}));
vi.mock('@/components/admin/q-a-pairs/dedup-proposals/proposal-detail', () => ({
  QaDedupProposalDetailClient: () => null,
}));

import AdminQaDedupProposalsPage from '@/app/admin/q-a-pairs/dedup-proposals/page';
import AdminQaDedupProposalDetailPage from '@/app/admin/q-a-pairs/dedup-proposals/[proposalId]/page';

const VALID_PROPOSAL_ID = '99999999-9999-4999-8999-999999999999';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('/admin/q-a-pairs/dedup-proposals — list page guard', () => {
  it('gates on the admin/editor roles (INV-22)', async () => {
    mockGetAuthorisedClient.mockResolvedValueOnce({ success: true });
    await AdminQaDedupProposalsPage();
    expect(mockGetAuthorisedClient).toHaveBeenCalledWith(['admin', 'editor']);
  });

  it('redirects a forbidden (viewer) caller away from the surface', async () => {
    mockGetAuthorisedClient.mockResolvedValueOnce({
      success: false,
      reason: 'forbidden',
    });
    await expect(AdminQaDedupProposalsPage()).rejects.toBeInstanceOf(NextHalt);
    expect(mockRedirect).toHaveBeenCalledWith('/');
  });

  it('redirects an unauthenticated caller to /login', async () => {
    mockGetAuthorisedClient.mockResolvedValueOnce({
      success: false,
      reason: 'unauthenticated',
    });
    await expect(AdminQaDedupProposalsPage()).rejects.toBeInstanceOf(NextHalt);
    expect(mockRedirect).toHaveBeenCalledWith('/login');
  });
});

describe('/admin/q-a-pairs/dedup-proposals/[proposalId] — detail page guard', () => {
  it('404s a malformed proposalId before any auth/render', async () => {
    await expect(
      AdminQaDedupProposalDetailPage({
        params: Promise.resolve({ proposalId: 'not-a-uuid' }),
      }),
    ).rejects.toBeInstanceOf(NextHalt);
    expect(mockNotFound).toHaveBeenCalled();
    expect(mockGetAuthorisedClient).not.toHaveBeenCalled();
  });

  it('gates a valid proposalId on the admin/editor roles (INV-22)', async () => {
    mockGetAuthorisedClient.mockResolvedValueOnce({ success: true });
    await AdminQaDedupProposalDetailPage({
      params: Promise.resolve({ proposalId: VALID_PROPOSAL_ID }),
    });
    expect(mockGetAuthorisedClient).toHaveBeenCalledWith(['admin', 'editor']);
  });

  it('redirects a forbidden (viewer) caller away from the detail surface', async () => {
    mockGetAuthorisedClient.mockResolvedValueOnce({
      success: false,
      reason: 'forbidden',
    });
    await expect(
      AdminQaDedupProposalDetailPage({
        params: Promise.resolve({ proposalId: VALID_PROPOSAL_ID }),
      }),
    ).rejects.toBeInstanceOf(NextHalt);
    expect(mockRedirect).toHaveBeenCalledWith('/');
  });
});
