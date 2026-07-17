/**
 * DocumentCitationsPanel — ID-135.16 (TECH §3 BI-27, §4, AAT-4). Renders
 * citations grouped/labelled by `cited_target_kind` (text+icon per BI-4);
 * 0 rows renders a clear empty state (never an error, BI-27); loading
 * renders a skeleton; a fetch failure renders its own localised error +
 * retry (BI-30) without throwing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import type {
  CitationSummary,
  CitationsByKind,
  DocumentCitationsResponse,
} from '@/hooks/source-document-detail/use-source-document-detail';

const { mockUseDocumentCitations, mockRefetch } = vi.hoisted(() => ({
  mockUseDocumentCitations: vi.fn(),
  mockRefetch: vi.fn(),
}));

vi.mock('@/hooks/source-document-detail/use-source-document-detail', () => ({
  useDocumentCitations: (id: string) => mockUseDocumentCitations(id),
}));

// Import component AFTER mocks.
import { DocumentCitationsPanel } from '@/components/source-document-detail/document-citations-panel';

const DOCUMENT_ID = '00000000-0000-4000-8000-000000000001';

function emptyCitationsByKind(): CitationsByKind {
  return {
    q_a_pair: [],
    reference_item: [],
    source_document: [],
    concept: [],
  };
}

function makeResponse(
  overrides: Partial<CitationsByKind> = {},
): DocumentCitationsResponse {
  return {
    document_id: DOCUMENT_ID,
    citations: { ...emptyCitationsByKind(), ...overrides },
  };
}

describe('DocumentCitationsPanel', () => {
  beforeEach(() => {
    mockUseDocumentCitations.mockReset();
    mockRefetch.mockReset();
    mockUseDocumentCitations.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
      refetch: mockRefetch,
    });
  });

  it('shows a loading skeleton while the citations query is in flight', () => {
    mockUseDocumentCitations.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: mockRefetch,
    });
    render(<DocumentCitationsPanel documentId={DOCUMENT_ID} />);

    expect(
      screen.getByRole('status', { name: /loading citations/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/no citations yet/i)).not.toBeInTheDocument();
  });

  it('renders a clear empty state, never an error, when all 4 buckets are 0 rows', () => {
    mockUseDocumentCitations.mockReturnValue({
      data: makeResponse(),
      isLoading: false,
      isError: false,
      refetch: mockRefetch,
    });
    render(<DocumentCitationsPanel documentId={DOCUMENT_ID} />);

    expect(screen.getByText(/no citations yet/i)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(
      screen.queryByText(/couldn.t load citations/i),
    ).not.toBeInTheDocument();
  });

  it('renders the empty state when data is undefined (e.g. query not yet settled)', () => {
    render(<DocumentCitationsPanel documentId={DOCUMENT_ID} />);
    expect(screen.getByText(/no citations yet/i)).toBeInTheDocument();
  });

  it('renders citation rows grouped and labelled by cited_target_kind, each with text+icon', () => {
    mockUseDocumentCitations.mockReturnValue({
      data: makeResponse({
        q_a_pair: [
          {
            id: 'cite-1',
            cited_kind: 'q_a_pair',
            citing_kind: 'form_response',
            citation_type: 'reference',
            cited_text: 'What is the tender deadline?',
            cited_q_a_pair_id: 'qa-1',
            cited_reference_item_id: null,
            cited_source_document_id: null,
            cited_concept_path: null,
            created_at: '2026-03-14T09:00:00.000Z',
          },
        ],
        concept: [
          {
            id: 'cite-2',
            cited_kind: 'concept',
            citing_kind: 'form_response',
            citation_type: 'reference',
            cited_text: null,
            cited_q_a_pair_id: null,
            cited_reference_item_id: null,
            cited_source_document_id: null,
            cited_concept_path: 'procurement.tender-notices',
            created_at: '2026-03-15T09:00:00.000Z',
          },
        ],
      }),
      isLoading: false,
      isError: false,
      refetch: mockRefetch,
    });
    const { container } = render(
      <DocumentCitationsPanel documentId={DOCUMENT_ID} />,
    );

    // Group labels present, text.
    const answersHeading = screen.getByText('Answers (1)');
    const conceptsHeading = screen.getByText('Concepts (1)');
    expect(answersHeading).toBeInTheDocument();
    expect(conceptsHeading).toBeInTheDocument();

    // Every rendered group heading carries an icon (BI-4 text+icon, never
    // colour-only) — assert an <svg> sibling inside each heading element.
    expect(
      answersHeading.closest('h3')?.querySelector('svg'),
    ).toBeInTheDocument();
    expect(
      conceptsHeading.closest('h3')?.querySelector('svg'),
    ).toBeInTheDocument();

    // Buckets with 0 rows are not rendered as empty groups.
    expect(screen.queryByText(/References \(/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Source documents \(/)).not.toBeInTheDocument();

    // Row content.
    expect(
      screen.getByText('What is the tender deadline?'),
    ).toBeInTheDocument();
    expect(screen.getByText(/14\/03\/2026/)).toBeInTheDocument();
    // concept row falls back to citation_type when cited_text is null.
    expect(screen.getByText('reference')).toBeInTheDocument();

    expect(screen.queryByText(/no citations yet/i)).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(/\bundefined\b/);
    expect(container.textContent).not.toMatch(/\bnull\b/);
  });

  it('renders a localised error state with retry on fetch failure, not a crash', () => {
    mockUseDocumentCitations.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: mockRefetch,
    });
    render(<DocumentCitationsPanel documentId={DOCUMENT_ID} />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/couldn.t load citations/i)).toBeInTheDocument();

    screen.getByRole('button', { name: /try again/i }).click();
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });

  describe('§D wiring — bidirectional selection (ID-145 {145.47})', () => {
    function citationRow(
      overrides: Partial<CitationSummary> = {},
    ): CitationSummary {
      return {
        id: 'cite-1',
        cited_kind: 'q_a_pair',
        citing_kind: 'form_response',
        citation_type: 'reference',
        cited_text: 'What is the tender deadline?',
        cited_q_a_pair_id: 'qa-1',
        cited_reference_item_id: null,
        cited_source_document_id: null,
        cited_concept_path: null,
        created_at: '2026-03-14T09:00:00.000Z',
        ...overrides,
      };
    }

    it('renders plain, non-interactive rows when onSelectCitation is omitted (backward compatible)', () => {
      mockUseDocumentCitations.mockReturnValue({
        data: makeResponse({ q_a_pair: [citationRow()] }),
        isLoading: false,
        isError: false,
        refetch: mockRefetch,
      });
      render(<DocumentCitationsPanel documentId={DOCUMENT_ID} />);

      expect(
        screen.queryByRole('button', { name: /tender deadline/i }),
      ).not.toBeInTheDocument();
    });

    it('renders a row as a selectable button and reports the shared id on click', () => {
      const handleSelect = vi.fn();
      mockUseDocumentCitations.mockReturnValue({
        data: makeResponse({ q_a_pair: [citationRow()] }),
        isLoading: false,
        isError: false,
        refetch: mockRefetch,
      });
      render(
        <DocumentCitationsPanel
          documentId={DOCUMENT_ID}
          onSelectCitation={handleSelect}
        />,
      );

      const button = screen.getByRole('button', {
        name: /tender deadline/i,
      });
      button.click();
      expect(handleSelect).toHaveBeenCalledWith('cite-1');
    });

    it('marks the row aria-pressed when its id matches the shared selectedId', () => {
      mockUseDocumentCitations.mockReturnValue({
        data: makeResponse({ q_a_pair: [citationRow()] }),
        isLoading: false,
        isError: false,
        refetch: mockRefetch,
      });
      render(
        <DocumentCitationsPanel
          documentId={DOCUMENT_ID}
          selectedId="cite-1"
          onSelectCitation={vi.fn()}
        />,
      );

      expect(
        screen.getByRole('button', { name: /tender deadline/i }),
      ).toHaveAttribute('aria-pressed', 'true');
    });

    it('shows a text+icon "On page" hint only for citations in resolvedCitationIds', () => {
      mockUseDocumentCitations.mockReturnValue({
        data: makeResponse({
          q_a_pair: [
            citationRow({ id: 'cite-1', cited_text: 'Resolved citation' }),
            citationRow({ id: 'cite-2', cited_text: 'Unresolved citation' }),
          ],
        }),
        isLoading: false,
        isError: false,
        refetch: mockRefetch,
      });
      render(
        <DocumentCitationsPanel
          documentId={DOCUMENT_ID}
          onSelectCitation={vi.fn()}
          resolvedCitationIds={new Set(['cite-1'])}
        />,
      );

      const resolvedRow = screen
        .getByText('Resolved citation')
        .closest('button')!;
      const unresolvedRow = screen
        .getByText('Unresolved citation')
        .closest('button')!;
      expect(resolvedRow).toHaveTextContent('On page');
      expect(unresolvedRow).not.toHaveTextContent('On page');
    });
  });
});
