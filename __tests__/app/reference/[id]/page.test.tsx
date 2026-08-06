/**
 * ReferenceDetailPage — `/reference/[id]` server-component tests (ID-111.7).
 *
 * Behaviour-first (test-philosophy.md): we drive the real server component
 * through its data-fetch branches by mocking only the I/O seam
 * (`@/lib/supabase/server` `createClient`) and `next/navigation.notFound`.
 * Everything below `createClient` — the `reference_get_verbatim` RPC primary
 * read, the notFound/error branching, and the rendered provenance — runs
 * unmocked.
 *
 * id-417 / DR-130 + DR-124: the domain/subtopic badges and the B-28
 * source_documents secondary read retired with the subject-taxonomy axis
 * and the sd shell — the ingestion_source plain-language line is the
 * provenance surface.
 *
 * Spec: PRODUCT.md B-1..B-7, B-27, B-2, B-26; TECH.md Seam 2.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

// ---------------------------------------------------------------------------
// vi.hoisted() — mocks referenced in vi.mock() factories
// ---------------------------------------------------------------------------

const { mockCreateClient, mockNotFound } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockNotFound: vi.fn(() => {
    // Real notFound() throws to halt rendering; mirror that so the component
    // does not continue past the guard.
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => mockCreateClient(),
}));

vi.mock('next/navigation', () => ({
  notFound: () => mockNotFound(),
}));

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: Record<string, unknown>) => (
    <a href={href as string} {...props}>
      {children as React.ReactNode}
    </a>
  ),
}));

// Import AFTER mocks
import ReferenceDetailPage from '@/app/reference/[id]/page';
import type { ReferenceDetail } from '@/types/reference';

// ---------------------------------------------------------------------------
// Data factories
// ---------------------------------------------------------------------------

const REFERENCE_ID = '11111111-1111-4111-8111-111111111111';

function makeReference(
  overrides: Partial<ReferenceDetail> = {},
): ReferenceDetail {
  return {
    id: REFERENCE_ID,
    title: 'UK SMB Procurement Trends 2026',
    body: '## Overview\n\nProcurement is **changing**.\n\n| Year | Spend |\n| ---- | ----- |\n| 2025 | £1.2m |',
    summary: 'A concise summary of procurement trends.',
    source_url: 'https://example.com/procurement-trends',
    published_at: '2026-01-15T00:00:00Z',
    layer: 'detail',
    ingestion_source: 'url_import',
    op_id: 'op-1',
    created_at: '2026-01-16T00:00:00Z',
    updated_at: '2026-01-16T00:00:00Z',
    ...overrides,
  };
}

/**
 * Build a mock Supabase client whose `rpc('reference_get_verbatim', ...)`
 * resolves to `rpcResult` — the real PostgREST `{ data, error }` envelope.
 */
function makeClient(opts: { rpcResult: { data: unknown; error: unknown } }) {
  return {
    rpc: vi.fn().mockResolvedValue(opts.rpcResult),
  };
}

function renderPage() {
  // Server component returns a Promise<JSX>; await it then render the element.
  return ReferenceDetailPage({
    params: Promise.resolve({ id: REFERENCE_ID }),
  }).then((element) => render(element));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ReferenceDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNotFound.mockImplementation(() => {
      throw new Error('NEXT_NOT_FOUND');
    });
  });

  // ---- Happy path: body + metadata ----

  it('renders the title, markdown body, and summary for an existing reference', async () => {
    mockCreateClient.mockResolvedValue(
      makeClient({ rpcResult: { data: [makeReference()], error: null } }),
    );

    await renderPage();

    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'UK SMB Procurement Trends 2026',
      }),
    ).toBeInTheDocument();
    // Body markdown renders (GFM table -> a <table>, heading -> "Overview").
    expect(screen.getByText('Overview')).toBeInTheDocument();
    expect(screen.getByText('changing')).toBeInTheDocument();
    expect(
      screen.getByText('A concise summary of procurement trends.'),
    ).toBeInTheDocument();
  });

  it('renders the layer badge when present and omits it when null', async () => {
    mockCreateClient.mockResolvedValue(
      makeClient({ rpcResult: { data: [makeReference()], error: null } }),
    );

    await renderPage();

    expect(screen.getByText('detail')).toBeInTheDocument();
  });

  it('omits the layer badge when the column is null', async () => {
    mockCreateClient.mockResolvedValue(
      makeClient({
        rpcResult: { data: [makeReference({ layer: null })], error: null },
      }),
    );

    await renderPage();

    expect(screen.queryByText('detail')).not.toBeInTheDocument();
  });

  it('renders the source_url as an outbound link', async () => {
    mockCreateClient.mockResolvedValue(
      makeClient({ rpcResult: { data: [makeReference()], error: null } }),
    );

    await renderPage();

    const link = screen
      .getAllByRole('link')
      .find(
        (a) =>
          a.getAttribute('href') === 'https://example.com/procurement-trends',
      );
    expect(link).toBeDefined();
  });

  it('surfaces the ingestion_source plain-language provenance line (B-2)', async () => {
    mockCreateClient.mockResolvedValue(
      makeClient({ rpcResult: { data: [makeReference()], error: null } }),
    );

    await renderPage();

    expect(screen.getByText(/Imported from URL/)).toBeInTheDocument();
  });

  it('shows the RSS-feed plain-language line for rss_feed references', async () => {
    mockCreateClient.mockResolvedValue(
      makeClient({
        rpcResult: {
          data: [makeReference({ ingestion_source: 'rss_feed' })],
          error: null,
        },
      }),
    );

    await renderPage();

    expect(screen.getByText(/From an RSS feed/)).toBeInTheDocument();
  });

  // ---- Not found ----

  it('404s when the reference does not exist (empty RPC result)', async () => {
    mockCreateClient.mockResolvedValue(
      makeClient({ rpcResult: { data: [], error: null } }),
    );

    await expect(renderPage()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mockNotFound).toHaveBeenCalled();
  });

  it('404s on PGRST116 (single-row not found)', async () => {
    mockCreateClient.mockResolvedValue(
      makeClient({
        rpcResult: {
          data: null,
          error: { message: 'no rows', code: 'PGRST116' },
        },
      }),
    );

    await expect(renderPage()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mockNotFound).toHaveBeenCalled();
  });

  it('404s when the id is not a valid uuid (B-5), before any DB call', async () => {
    mockCreateClient.mockResolvedValue(
      makeClient({ rpcResult: { data: [], error: null } }),
    );

    await expect(
      ReferenceDetailPage({
        params: Promise.resolve({ id: 'not-a-real-uuid' }),
      }).then((element) => render(element)),
    ).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mockNotFound).toHaveBeenCalled();
    // The malformed id is rejected before the I/O seam is even opened.
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  // ---- Transport error -> error + retry, never blank, never notFound ----

  it('renders an error state with a retry affordance on a non-not-found RPC error', async () => {
    mockCreateClient.mockResolvedValue(
      makeClient({
        rpcResult: {
          data: null,
          error: { message: 'connection refused', code: 'PGRST500' },
        },
      }),
    );

    await renderPage();

    // Not a 404.
    expect(mockNotFound).not.toHaveBeenCalled();
    // A non-destructive error state with retry — never a blank page.
    expect(
      screen.getByRole('button', { name: /try again|retry/i }),
    ).toBeInTheDocument();
    // The reference title is NOT rendered (we have no data).
    expect(
      screen.queryByText('UK SMB Procurement Trends 2026'),
    ).not.toBeInTheDocument();
  });

  // ---- published_at formatting (B-27) ----

  it('renders published_at as DD/MM/YYYY when present', async () => {
    mockCreateClient.mockResolvedValue(
      makeClient({
        rpcResult: {
          data: [makeReference({ published_at: '2026-03-25T00:00:00Z' })],
          error: null,
        },
      }),
    );

    await renderPage();

    expect(screen.getByText(/25\/03\/2026/)).toBeInTheDocument();
  });

  it('shows an explicit "no publication date" treatment when published_at is null', async () => {
    mockCreateClient.mockResolvedValue(
      makeClient({
        rpcResult: {
          data: [makeReference({ published_at: null })],
          error: null,
        },
      }),
    );

    await renderPage();

    expect(screen.getByText(/no publication date/i)).toBeInTheDocument();
  });
});
