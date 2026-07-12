/**
 * /promotion-gate page-guard tests (ID-145 {145.22} — TECH §5/§7 section I,
 * BI-38/39).
 *
 * Acceptance (testStrategy): a viewer is blocked — the server page gates on
 * `getAuthorisedClient(['admin','editor'])` and redirects anyone who is not
 * admin/editor, mirroring every other Governance-zone mutation surface
 * (e.g. `/admin/q-a-pairs/dedup-proposals`, ID-120 {120.8}).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetAuthorisedClient, mockRedirect, NextHalt } = vi.hoisted(() => {
  class NextHalt extends Error {}
  const halt = () => {
    throw new NextHalt();
  };
  return {
    NextHalt,
    mockGetAuthorisedClient: vi.fn(),
    mockRedirect: vi.fn(halt),
  };
});

vi.mock('@/lib/auth/client', () => ({
  getAuthorisedClient: mockGetAuthorisedClient,
}));

vi.mock('next/navigation', () => ({
  redirect: mockRedirect,
}));

vi.mock('@/components/governance/promotion-gate/promotion-gate-view', () => ({
  PromotionGateView: () => null,
}));

import PromotionGatePage from '@/app/promotion-gate/page';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('/promotion-gate — page guard', () => {
  it('gates on the admin/editor roles', async () => {
    mockGetAuthorisedClient.mockResolvedValueOnce({ success: true });
    await PromotionGatePage();
    expect(mockGetAuthorisedClient).toHaveBeenCalledWith(['admin', 'editor']);
  });

  it('redirects a forbidden (viewer) caller away from the surface', async () => {
    mockGetAuthorisedClient.mockResolvedValueOnce({
      success: false,
      reason: 'forbidden',
    });
    await expect(PromotionGatePage()).rejects.toBeInstanceOf(NextHalt);
    expect(mockRedirect).toHaveBeenCalledWith('/');
  });

  it('redirects an unauthenticated caller to /login', async () => {
    mockGetAuthorisedClient.mockResolvedValueOnce({
      success: false,
      reason: 'unauthenticated',
    });
    await expect(PromotionGatePage()).rejects.toBeInstanceOf(NextHalt);
    expect(mockRedirect).toHaveBeenCalledWith('/login');
  });
});
