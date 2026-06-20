/**
 * ReferenceContent — /reference browse/search/filters surface tests (ID-111.10).
 *
 * Behaviour-first (test-philosophy.md): drives the REAL client component AND
 * the real `useReferenceData` hook together, mocking only the I/O + routing
 * seams (`createClient().rpc`, `fetchJson`, `next/navigation`). This proves the
 * end-to-end surface behaviour the spec asserts: default list renders cards;
 * corpus-empty vs no-match are distinct; search swaps to the {111.9} endpoint
 * and clearing restores the default list; a transport error is distinct from an
 * empty list; a filter change writes the param to the URL (server pushdown).
 *
 * The reference_list RPC is MOCKED (no live DB in vitest).
 *
 * Spec: PRODUCT.md B-11..B-22, B-26, B-27; TECH.md Seam 1.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import { createQueryWrapper } from '@/__tests__/helpers/query-wrapper';

const { mockRpc, mockFetchJson, mockPush, navState } = vi.hoisted(() => ({
  mockRpc: vi.fn(),
  mockFetchJson: vi.fn(),
  mockPush: vi.fn(),
  navState: { search: '' },
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ rpc: mockRpc }),
}));

vi.mock('@/lib/query/fetchers', async () => {
  const actual = await vi.importActual<typeof import('@/lib/query/fetchers')>(
    '@/lib/query/fetchers',
  );
  return { ...actual, fetchJson: mockFetchJson };
});

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(navState.search),
  useRouter: () => ({ push: mockPush }),
  usePathname: () => '/reference',
}));

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: Record<string, unknown>) => (
    <a href={href as string} {...props}>
      {children as React.ReactNode}
    </a>
  ),
}));

import { ReferenceContent } from '@/app/reference/reference-content';
import type { ReferenceListItem } from '@/types/reference';

let idCounter = 0;
function makeRow(overrides: Partial<ReferenceListItem> = {}) {
  idCounter += 1;
  return {
    reference_id: `1111111${idCounter}-1111-4111-8111-111111111111`,
    title: `Reference ${idCounter}`,
    summary_preview: `Summary preview ${idCounter}.`,
    body_preview: 'Body preview.',
    source_url: 'https://example.com/a',
    published_at: '2026-01-15T00:00:00Z',
    primary_domain: 'procurement',
    primary_subtopic: 'tendering',
    layer: 'detail',
    ingestion_source: 'url_import',
    source_document_id: '22222222-2222-4222-8222-222222222222',
    ...overrides,
  };
}

function renderContent() {
  const { Wrapper } = createQueryWrapper();
  return render(<ReferenceContent />, { wrapper: Wrapper });
}

beforeEach(() => {
  vi.clearAllMocks();
  navState.search = '';
  idCounter = 0;
  mockRpc.mockResolvedValue({ data: [], error: null });
  mockFetchJson.mockResolvedValue({ results: [] });
});

describe('ReferenceContent — default list', () => {
  it('renders reference cards from the reference_list RPC, linking to detail', async () => {
    mockRpc.mockResolvedValue({
      data: [makeRow({ title: 'Procurement Reform Bill' })],
      error: null,
    });

    renderContent();

    expect(
      await screen.findByText('Procurement Reform Bill'),
    ).toBeInTheDocument();
    const card = screen
      .getAllByRole('link')
      .find((a) => a.getAttribute('href')?.startsWith('/reference/'));
    expect(card).toBeDefined();
    expect(mockFetchJson).not.toHaveBeenCalled();
  });

  it('shows the corpus-empty state when there are no references at all', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });

    renderContent();

    expect(await screen.findByText('No references yet')).toBeInTheDocument();
    expect(screen.queryByText('No references match')).not.toBeInTheDocument();
  });
});

describe('ReferenceContent — error is distinct from empty (B-20)', () => {
  it('renders the error state, not the empty state, on an RPC failure', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: new Error('connection refused'),
    });

    renderContent();

    expect(
      await screen.findByText("Couldn't load references"),
    ).toBeInTheDocument();
    // Must NOT collapse into the corpus-empty state.
    expect(screen.queryByText('No references yet')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /try again/i }),
    ).toBeInTheDocument();
  });
});

describe('ReferenceContent — search mode (B-13/B-15/B-18/B-23)', () => {
  it('uses the {111.9} endpoint and shows a no-match state distinct from corpus-empty', async () => {
    navState.search = 'q=nothing+matches';
    mockFetchJson.mockResolvedValue({ results: [] });

    renderContent();

    expect(await screen.findByText('No references match')).toBeInTheDocument();
    // Distinct from corpus-empty.
    expect(screen.queryByText('No references yet')).not.toBeInTheDocument();
    expect(mockFetchJson).toHaveBeenCalledWith(
      '/api/search/reference',
      expect.objectContaining({ method: 'POST' }),
    );
    // The default-list RPC is not called in search mode.
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('submitting the search box writes ?q= to the URL', async () => {
    renderContent();
    await waitFor(() => expect(mockRpc).toHaveBeenCalled());

    const input = screen.getByLabelText('Search references');
    fireEvent.change(input, { target: { value: 'vat thresholds' } });
    fireEvent.submit(input.closest('form')!);

    expect(mockPush).toHaveBeenCalledWith('/reference?q=vat+thresholds');
  });

  it('clearing search navigates back to the default list (drops ?q=)', async () => {
    navState.search = 'q=procurement';
    mockFetchJson.mockResolvedValue({ results: [makeRow()] });

    renderContent();
    await waitFor(() => expect(mockFetchJson).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: /clear/i }));

    expect(mockPush).toHaveBeenCalledWith('/reference');
  });
});

describe('ReferenceContent — filters (server-side pushdown, B-16/B-17/B-31)', () => {
  it('changing the source filter writes the param to the URL', async () => {
    renderContent();
    await waitFor(() => expect(mockRpc).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText('Source'), {
      target: { value: 'rss_feed' },
    });

    expect(mockPush).toHaveBeenCalledWith('/reference?source=rss_feed');
  });

  it('passes an active domain filter into the reference_list RPC param', async () => {
    navState.search = 'domain=legal';
    mockRpc.mockResolvedValue({ data: [makeRow()], error: null });

    renderContent();

    await waitFor(() =>
      expect(mockRpc).toHaveBeenCalledWith(
        'reference_list',
        expect.objectContaining({ p_primary_domain: 'legal' }),
      ),
    );
  });
});
