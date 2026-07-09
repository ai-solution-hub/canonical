/**
 * `/search` server page shell — auth gate + Suspense wrap (ID-135 {135.9}).
 *
 * The client `CorpusSearchContent` is mocked — its own behaviour is covered
 * end-to-end by `search-content.test.tsx`. This file proves only the page
 * shell's own responsibilities: an unauthenticated visitor is redirected to
 * `/login` (defence-in-depth alongside the `proxy.ts` publicRoutes
 * omission, BI-1); an authenticated visitor sees the search surface; no
 * create/update/delete affordance is ever rendered (BI-1).
 *
 * Spec: TECH §2, §3 BI-1, BI-7; PRODUCT.md BI-1, BI-7.
 */
import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';

// `redirect()` HALTS execution in Next.js by throwing — model that so the
// unauthenticated-visitor case short-circuits the handler exactly as in
// production (mirrors `__tests__/app/admin/q-a-pairs/dedup-proposals/page.test.tsx`).
const { mockGetAuthenticatedClient, mockRedirect, NextHalt } = vi.hoisted(
  () => {
    class NextHalt extends Error {}
    return {
      NextHalt,
      mockGetAuthenticatedClient: vi.fn(),
      mockRedirect: vi.fn(() => {
        throw new NextHalt();
      }),
    };
  },
);

vi.mock('@/lib/auth/client', () => ({
  getAuthenticatedClient: mockGetAuthenticatedClient,
}));

vi.mock('next/navigation', () => ({
  redirect: mockRedirect,
}));

vi.mock('@/app/search/search-content', () => ({
  CorpusSearchContent: () => <div data-testid="corpus-search-content" />,
}));

import SearchPage from '@/app/search/page';

describe('/search page shell (ID-135 {135.9})', () => {
  it('renders CorpusSearchContent for an authenticated visitor', async () => {
    mockGetAuthenticatedClient.mockResolvedValue({
      success: true,
      user: { id: 'user-1' },
      supabase: {},
    });

    render(await SearchPage());

    expect(screen.getByTestId('corpus-search-content')).toBeInTheDocument();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it('redirects an unauthenticated visitor to /login without rendering the search content', async () => {
    mockGetAuthenticatedClient.mockResolvedValue({
      success: false,
      reason: 'unauthenticated',
    });

    await expect(SearchPage()).rejects.toBeInstanceOf(NextHalt);
    expect(mockRedirect).toHaveBeenCalledWith('/login');
  });

  it('renders no create/update/delete affordance (BI-1)', async () => {
    mockGetAuthenticatedClient.mockResolvedValue({
      success: true,
      user: { id: 'user-1' },
      supabase: {},
    });

    render(await SearchPage());

    expect(
      screen.queryByRole('button', { name: /create|delete|remove|update/i }),
    ).not.toBeInTheDocument();
  });
});
