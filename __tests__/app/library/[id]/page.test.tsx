/**
 * QAPairViewerPage — `/library/[id]` server-component tests (ID-135 {135.22}).
 *
 * Behaviour-first (test-philosophy.md): drives the real server component
 * through its branches by mocking only the I/O seams — `getAuthorisedClient`
 * (`@/lib/auth/client`), `notFound`/`redirect` (`next/navigation`), and the
 * client presenter (`QAPairViewer`). The UUID gate, the auth/role check, and
 * the primary `q_a_pairs` read/branching all run unmocked.
 *
 * Mirrors `__tests__/app/documents/[id]/page.test.tsx` (the established Surface
 * B detail-page pattern this route reuses per TECH's "reuse the id-111/documents
 * detail-shell pattern" note).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';

const {
  mockGetAuthorisedClient,
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
    mockGetAuthorisedClient: vi.fn(),
    mockNotFound: vi.fn(() => {
      throw new NotFoundHalt();
    }),
    mockRedirect: vi.fn(() => {
      throw new RedirectHalt();
    }),
  };
});

vi.mock('@/lib/auth/client', () => ({
  getAuthorisedClient: mockGetAuthorisedClient,
}));

vi.mock('next/navigation', () => ({
  notFound: mockNotFound,
  redirect: mockRedirect,
}));

vi.mock('@/components/qa/qa-pair-viewer', () => ({
  QAPairViewer: ({
    pair,
    canEdit,
  }: {
    pair: { id: string; question_text: string };
    canEdit: boolean;
  }) => (
    <div data-testid="qa-pair-viewer">
      <span data-testid="pair-id">{pair.id}</span>
      <span data-testid="pair-question">{pair.question_text}</span>
      <span data-testid="pair-can-edit">{String(canEdit)}</span>
    </div>
  ),
  QAPairViewerError: () => <div data-testid="qa-pair-viewer-error" />,
}));

import QAPairViewerPage from '@/app/library/[id]/page';

const PAIR_ID = '22222222-2222-4222-8222-222222222222';

function makeAuthorisedResult(supabase: unknown, role: string) {
  return { success: true as const, user: { id: 'user-1' }, supabase, role };
}

function makeSupabaseClient(pairResult: { data: unknown; error: unknown }) {
  const chain = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue(pairResult),
  };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  return { from: vi.fn().mockReturnValue(chain) };
}

function renderPage(id: string) {
  return QAPairViewerPage({ params: Promise.resolve({ id }) }).then((element) =>
    render(element),
  );
}

describe('QAPairViewerPage (/library/[id])', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNotFound.mockImplementation(() => {
      throw new NotFoundHalt();
    });
    mockRedirect.mockImplementation(() => {
      throw new RedirectHalt();
    });
  });

  it('404s when the id is not a valid uuid, before any auth/DB call', async () => {
    await expect(renderPage('not-a-real-uuid')).rejects.toBeInstanceOf(
      NotFoundHalt,
    );
    expect(mockNotFound).toHaveBeenCalled();
    expect(mockGetAuthorisedClient).not.toHaveBeenCalled();
  });

  it('redirects an unauthenticated visitor to /login without querying q_a_pairs', async () => {
    mockGetAuthorisedClient.mockResolvedValue({
      success: false,
      reason: 'unauthenticated',
    });

    await expect(renderPage(PAIR_ID)).rejects.toBeInstanceOf(RedirectHalt);
    expect(mockRedirect).toHaveBeenCalledWith('/login');
    expect(mockNotFound).not.toHaveBeenCalled();
  });

  it('404s when a well-formed id resolves to no q_a_pairs row', async () => {
    mockGetAuthorisedClient.mockResolvedValue(
      makeAuthorisedResult(
        makeSupabaseClient({ data: null, error: null }),
        'viewer',
      ),
    );

    await expect(renderPage(PAIR_ID)).rejects.toBeInstanceOf(NotFoundHalt);
    expect(mockNotFound).toHaveBeenCalled();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it('renders QAPairViewerError on a primary read failure that is not a not-found', async () => {
    mockGetAuthorisedClient.mockResolvedValue(
      makeAuthorisedResult(
        makeSupabaseClient({
          data: null,
          error: { message: 'connection refused', code: 'PGRST500' },
        }),
        'viewer',
      ),
    );

    await renderPage(PAIR_ID);

    expect(screen.getByTestId('qa-pair-viewer-error')).toBeInTheDocument();
    expect(mockNotFound).not.toHaveBeenCalled();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it('renders QAPairViewer with the resolved pair for a valid id (viewer role, canEdit false)', async () => {
    mockGetAuthorisedClient.mockResolvedValue(
      makeAuthorisedResult(
        makeSupabaseClient({
          data: { id: PAIR_ID, question_text: 'What is the refund policy?' },
          error: null,
        }),
        'viewer',
      ),
    );

    await renderPage(PAIR_ID);

    expect(screen.getByTestId('qa-pair-viewer')).toBeInTheDocument();
    expect(screen.getByTestId('pair-id')).toHaveTextContent(PAIR_ID);
    expect(screen.getByTestId('pair-question')).toHaveTextContent(
      'What is the refund policy?',
    );
    expect(screen.getByTestId('pair-can-edit')).toHaveTextContent('false');
    expect(mockNotFound).not.toHaveBeenCalled();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it('passes canEdit=true for an editor role', async () => {
    mockGetAuthorisedClient.mockResolvedValue(
      makeAuthorisedResult(
        makeSupabaseClient({
          data: { id: PAIR_ID, question_text: 'What is the refund policy?' },
          error: null,
        }),
        'editor',
      ),
    );

    await renderPage(PAIR_ID);

    expect(screen.getByTestId('pair-can-edit')).toHaveTextContent('true');
  });
});
