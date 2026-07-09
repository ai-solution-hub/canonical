/**
 * SourceDocumentDetailPage — `/documents/[id]` server-component tests
 * (ID-135 {135.18}, TECH §3 BI-1/BI-22/BI-23/BI-30, BND-2).
 *
 * Behaviour-first (test-philosophy.md): drives the real server component
 * through its branches by mocking only the I/O seams — `getAuthenticatedClient`
 * (`@/lib/auth/client`), `notFound`/`redirect` (`next/navigation`), and the
 * client presenter (`SourceDocumentDetailClient`/`SourceDocumentDetailError`,
 * whose own composition is covered by
 * `source-document-detail-client.test.tsx`). The UUID gate, the auth check,
 * and the primary `source_documents` read/branching all run unmocked.
 *
 * Spec: PRODUCT.md BI-1, BI-22, BI-23, BI-30; TECH.md §2, §3 BI-1/22/23/30;
 * BND-2 (sibling of the shipped `/documents/[id]/diff`).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';

// ---------------------------------------------------------------------------
// vi.hoisted() — mocks referenced in vi.mock() factories
// ---------------------------------------------------------------------------

const {
  mockGetAuthenticatedClient,
  mockNotFound,
  mockRedirect,
  NotFoundHalt,
  RedirectHalt,
} = vi.hoisted(() => {
  class NotFoundHalt extends Error {}
  class RedirectHalt extends Error {}
  return {
    NotFoundHalt,
    RedirectHalt,
    mockGetAuthenticatedClient: vi.fn(),
    mockNotFound: vi.fn(() => {
      throw new NotFoundHalt();
    }),
    mockRedirect: vi.fn(() => {
      throw new RedirectHalt();
    }),
  };
});

vi.mock('@/lib/auth/client', () => ({
  getAuthenticatedClient: mockGetAuthenticatedClient,
}));

vi.mock('next/navigation', () => ({
  notFound: mockNotFound,
  redirect: mockRedirect,
}));

vi.mock(
  '@/components/source-document-detail/source-document-detail-client',
  () => ({
    SourceDocumentDetailClient: ({
      documentId,
      sourceDocument,
    }: {
      documentId: string;
      sourceDocument: { filename: string | null };
    }) => (
      <div data-testid="source-document-detail-client">
        <span data-testid="document-id">{documentId}</span>
        <span data-testid="document-filename">{sourceDocument.filename}</span>
      </div>
    ),
    SourceDocumentDetailError: () => (
      <div data-testid="source-document-detail-error" />
    ),
  }),
);

// Import AFTER mocks.
import SourceDocumentDetailPage from '@/app/documents/[id]/page';

// ---------------------------------------------------------------------------
// Data factories
// ---------------------------------------------------------------------------

const DOCUMENT_ID = '11111111-1111-4111-8111-111111111111';

function makeAuthenticatedResult(supabase: unknown) {
  return { success: true as const, user: { id: 'user-1' }, supabase };
}

/**
 * Build a mock Supabase client whose
 * `from('source_documents').select(...).eq(...).maybeSingle()` resolves to
 * `sdResult` — the single primary read this page performs.
 */
function makeSupabaseClient(sdResult: { data: unknown; error: unknown }) {
  const chain = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue(sdResult),
  };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  return { from: vi.fn().mockReturnValue(chain) };
}

function renderPage(id: string) {
  return SourceDocumentDetailPage({ params: Promise.resolve({ id }) }).then(
    (element) => render(element),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SourceDocumentDetailPage (/documents/[id])', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNotFound.mockImplementation(() => {
      throw new NotFoundHalt();
    });
    mockRedirect.mockImplementation(() => {
      throw new RedirectHalt();
    });
  });

  it('404s when the id is not a valid uuid, before any auth/DB call (BI-23)', async () => {
    await expect(renderPage('not-a-real-uuid')).rejects.toBeInstanceOf(
      NotFoundHalt,
    );
    expect(mockNotFound).toHaveBeenCalled();
    expect(mockGetAuthenticatedClient).not.toHaveBeenCalled();
  });

  it('redirects an unauthenticated visitor to /login without querying source_documents (BI-1)', async () => {
    mockGetAuthenticatedClient.mockResolvedValue({
      success: false,
      reason: 'unauthenticated',
    });

    await expect(renderPage(DOCUMENT_ID)).rejects.toBeInstanceOf(RedirectHalt);
    expect(mockRedirect).toHaveBeenCalledWith('/login');
    expect(mockNotFound).not.toHaveBeenCalled();
  });

  it('404s when a well-formed id resolves to no source_documents row (BI-23)', async () => {
    mockGetAuthenticatedClient.mockResolvedValue(
      makeAuthenticatedResult(makeSupabaseClient({ data: null, error: null })),
    );

    await expect(renderPage(DOCUMENT_ID)).rejects.toBeInstanceOf(NotFoundHalt);
    expect(mockNotFound).toHaveBeenCalled();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it('renders SourceDocumentDetailError on a primary read failure that is not a not-found (BI-30)', async () => {
    mockGetAuthenticatedClient.mockResolvedValue(
      makeAuthenticatedResult(
        makeSupabaseClient({
          data: null,
          error: { message: 'connection refused', code: 'PGRST500' },
        }),
      ),
    );

    await renderPage(DOCUMENT_ID);

    expect(
      screen.getByTestId('source-document-detail-error'),
    ).toBeInTheDocument();
    expect(mockNotFound).not.toHaveBeenCalled();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it('renders SourceDocumentDetailClient with the resolved document for a valid id', async () => {
    mockGetAuthenticatedClient.mockResolvedValue(
      makeAuthenticatedResult(
        makeSupabaseClient({
          data: { id: DOCUMENT_ID, filename: 'policy.pdf' },
          error: null,
        }),
      ),
    );

    await renderPage(DOCUMENT_ID);

    expect(
      screen.getByTestId('source-document-detail-client'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('document-id')).toHaveTextContent(DOCUMENT_ID);
    expect(screen.getByTestId('document-filename')).toHaveTextContent(
      'policy.pdf',
    );
    expect(mockNotFound).not.toHaveBeenCalled();
    expect(mockRedirect).not.toHaveBeenCalled();
  });
});
