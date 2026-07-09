/**
 * SourceDocumentDetailClient + SourceDocumentDetailError — id-135 {135.18}
 * (TECH §3 BI-22/BI-30/BI-31, §4). Composes the five Surface-B sections
 * (`SourceDocumentProvenance`, `DocumentVersionList`, `DocumentCitationsPanel`,
 * `DerivedPairsList`, `CorpusRelatedRecords` — {135.20}) behind their real
 * implementations — only the shared
 * `useDocumentVersions`/`useDocumentCitations`/`useDerivedPairs` I/O seam is
 * mocked (mirroring each section's own test suite), so this file proves the
 * REAL composition: all five sections render for a valid document, one
 * section's independent-query failure shows its own localised error+retry
 * without taking down its siblings (BI-30), and no
 * edit/delete/version-mutation affordance appears anywhere on the page
 * (BI-31).
 *
 * `CorpusRelatedRecords` ({135.20}) is mocked here to a lightweight stub —
 * its own internal wiring (the id-131/id-133 MOCKED fetcher, empty/loading/
 * error states) is proven in its own test suite
 * (`__tests__/components/corpus-search/corpus-related-records.test.tsx`);
 * this file only proves it is MOUNTED and threaded with the right
 * `recordId`/`recordKind` anchor props.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import type { Tables } from '@/supabase/types/database.types';
import type {
  DocumentVersionRow,
  DocumentVersionsResponse,
  CitationsByKind,
  DocumentCitationsResponse,
  DerivedPair,
} from '@/hooks/source-document-detail/use-source-document-detail';

// ---------------------------------------------------------------------------
// vi.hoisted() — mocks referenced in vi.mock() factories
// ---------------------------------------------------------------------------

const {
  mockUseDocumentVersions,
  mockUseDocumentCitations,
  mockUseDerivedPairs,
  mockRefetchVersions,
  mockRefetchCitations,
  mockRefetchDerivedPairs,
  mockCorpusRelatedRecords,
} = vi.hoisted(() => ({
  mockUseDocumentVersions: vi.fn(),
  mockUseDocumentCitations: vi.fn(),
  mockUseDerivedPairs: vi.fn(),
  mockRefetchVersions: vi.fn(),
  mockRefetchCitations: vi.fn(),
  mockRefetchDerivedPairs: vi.fn(),
  mockCorpusRelatedRecords: vi.fn(),
}));

vi.mock('@/hooks/source-document-detail/use-source-document-detail', () => ({
  useDocumentVersions: (id: string) => mockUseDocumentVersions(id),
  useDocumentCitations: (id: string) => mockUseDocumentCitations(id),
  useDerivedPairs: (id: string) => mockUseDerivedPairs(id),
}));

// {135.20}: stubbed here — this file only proves the mount + prop-threading;
// `CorpusRelatedRecords`'s own I/O (the id-131/id-133 MOCKED fetcher) is
// proven in its own test suite (see file-level doc comment above).
vi.mock('@/components/corpus-search/corpus-related-records', () => ({
  CorpusRelatedRecords: (props: { recordId: string; recordKind: string }) => {
    mockCorpusRelatedRecords(props);
    return <div data-testid="related-records-stub" />;
  },
}));

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
    [key: string]: unknown;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

// Import AFTER mocks.
import {
  SourceDocumentDetailClient,
  SourceDocumentDetailError,
} from '@/components/source-document-detail/source-document-detail-client';

// ---------------------------------------------------------------------------
// Data factories
// ---------------------------------------------------------------------------

const DOCUMENT_ID = '11111111-1111-4111-8111-111111111111';

function makeSourceDocument(
  overrides: Partial<Tables<'source_documents'>> = {},
): Tables<'source_documents'> {
  return {
    admission_status: 'ingested',
    ai_keywords: null,
    archived_at: null,
    archived_by: null,
    auth: null,
    cadence: null,
    captured_date: null,
    classification_confidence: null,
    classification_reasoning: null,
    classified_at: null,
    content_hash: 'fixture-hash-0000',
    content_type: null,
    created_at: '2026-01-01T00:00:00.000Z',
    extracted_text: null,
    extraction_metadata: null,
    extraction_method: null,
    file_size: 1024,
    filename: 'fixture-document.pdf',
    id: DOCUMENT_ID,
    locator: null,
    logical_path: null,
    mime_type: 'application/octet-stream',
    op_id: null,
    origin_type: null,
    original_filename: 'Procurement Policy 2026.pdf',
    parent_id: null,
    pipeline_run_id: null,
    primary_domain: '',
    primary_subtopic: '',
    publication_status: 'draft',
    retention_class: null,
    secondary_domain: null,
    secondary_subtopic: null,
    source_url: null,
    status: 'active',
    storage_path: 'source-documents/fixture-document.pdf',
    suggested_title: null,
    summary: null,
    summary_data: null,
    updated_at: null,
    updated_by: null,
    uploaded_by: null,
    version: 1,
    workspace_id: null,
    ...overrides,
  };
}

function makeVersionRow(
  overrides: Partial<DocumentVersionRow> = {},
): DocumentVersionRow {
  return {
    content_hash: 'fixture-hash-0000',
    content_item_count: 0,
    created_at: '2026-01-01T00:00:00.000Z',
    file_size: 1024,
    filename: 'fixture-document.pdf',
    id: '00000000-0000-4000-8000-000000000000',
    mime_type: 'application/pdf',
    original_filename: 'fixture-document.pdf',
    parent_id: '00000000-0000-4000-8000-000000000000',
    status: 'processed',
    storage_path: 'source-documents/fixture-document.pdf',
    uploaded_by: '00000000-0000-4000-8000-000000000001',
    version: 1,
    ...overrides,
  };
}

function makeVersionsResponse(
  versions: DocumentVersionRow[],
): DocumentVersionsResponse {
  return {
    document_id: DOCUMENT_ID,
    total_versions: versions.length,
    versions,
  };
}

function emptyCitationsByKind(): CitationsByKind {
  return {
    q_a_pair: [],
    reference_item: [],
    source_document: [],
    concept: [],
  };
}

function makeCitationsResponse(
  overrides: Partial<CitationsByKind> = {},
): DocumentCitationsResponse {
  return {
    document_id: DOCUMENT_ID,
    citations: { ...emptyCitationsByKind(), ...overrides },
  };
}

function makePair(overrides: Partial<DerivedPair> = {}): DerivedPair {
  return {
    id: 'qa-1',
    question_text: 'What is the policy?',
    answer_standard: 'The policy is X.',
    publication_status: 'published',
    created_at: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

/** A settled, error-free query-state baseline every test overrides from. */
function settledVersions(versions: DocumentVersionRow[] = [makeVersionRow()]) {
  mockUseDocumentVersions.mockReturnValue({
    data: makeVersionsResponse(versions),
    isLoading: false,
    isError: false,
    refetch: mockRefetchVersions,
  });
}

function settledCitations(overrides: Partial<CitationsByKind> = {}) {
  mockUseDocumentCitations.mockReturnValue({
    data: makeCitationsResponse(overrides),
    isLoading: false,
    isError: false,
    refetch: mockRefetchCitations,
  });
}

function settledDerivedPairs(pairs: DerivedPair[] = [makePair()]) {
  mockUseDerivedPairs.mockReturnValue({
    data: pairs,
    isLoading: false,
    isError: false,
    refetch: mockRefetchDerivedPairs,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SourceDocumentDetailClient', () => {
  beforeEach(() => {
    mockUseDocumentVersions.mockReset();
    mockUseDocumentCitations.mockReset();
    mockUseDerivedPairs.mockReset();
    mockRefetchVersions.mockReset();
    mockRefetchCitations.mockReset();
    mockRefetchDerivedPairs.mockReset();
    mockCorpusRelatedRecords.mockReset();

    settledVersions();
    settledCitations();
    settledDerivedPairs();
  });

  it('renders the document name as the page heading', () => {
    render(
      <SourceDocumentDetailClient
        documentId={DOCUMENT_ID}
        sourceDocument={makeSourceDocument()}
      />,
    );

    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'Procurement Policy 2026.pdf',
      }),
    ).toBeInTheDocument();
  });

  it('composes all five Surface-B sections for a valid document (BI-22)', () => {
    render(
      <SourceDocumentDetailClient
        documentId={DOCUMENT_ID}
        sourceDocument={makeSourceDocument()}
      />,
    );

    expect(
      screen.getByRole('heading', { name: 'Provenance' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Version history' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Citations' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Derived answers' }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('related-records-stub')).toBeInTheDocument();
  });

  it('mounts the ontology-grounded related-records rail, anchored on this document (BI-22, {135.20})', () => {
    render(
      <SourceDocumentDetailClient
        documentId={DOCUMENT_ID}
        sourceDocument={makeSourceDocument()}
      />,
    );

    expect(mockCorpusRelatedRecords).toHaveBeenCalledWith(
      expect.objectContaining({
        recordId: DOCUMENT_ID,
        recordKind: 'document',
      }),
    );
  });

  it('threads documentId into every per-section hook', () => {
    render(
      <SourceDocumentDetailClient
        documentId={DOCUMENT_ID}
        sourceDocument={makeSourceDocument()}
      />,
    );

    expect(mockUseDocumentVersions).toHaveBeenCalledWith(DOCUMENT_ID);
    expect(mockUseDocumentCitations).toHaveBeenCalledWith(DOCUMENT_ID);
    expect(mockUseDerivedPairs).toHaveBeenCalledWith(DOCUMENT_ID);
  });

  it("shows only the failing section's localised error+retry, while its siblings render normally (BI-30)", () => {
    mockUseDocumentCitations.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: mockRefetchCitations,
    });

    render(
      <SourceDocumentDetailClient
        documentId={DOCUMENT_ID}
        sourceDocument={makeSourceDocument()}
      />,
    );

    // The failing section shows its own localised error, not a page crash.
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/couldn.t load citations/i);

    // Siblings are unaffected — version history and derived answers still
    // render their normal (non-error, non-empty) content.
    expect(
      screen.getByRole('heading', { name: 'Version history' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/current/i)).toBeInTheDocument();
    expect(screen.getByText('What is the policy?')).toBeInTheDocument();

    // Only one alert on the page — the other two sections did not also fail.
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });

  it('renders no edit/delete/version-mutation/re-ingest/send-to-review affordance anywhere (BI-31)', () => {
    render(
      <SourceDocumentDetailClient
        documentId={DOCUMENT_ID}
        sourceDocument={makeSourceDocument()}
      />,
    );

    expect(
      screen.queryByRole('button', {
        name: /edit|delete|remove|re-?ingest|send to review|publish/i,
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: /edit|delete|re-?ingest/i }),
    ).not.toBeInTheDocument();
  });

  it('offers a way back to the search surface', () => {
    render(
      <SourceDocumentDetailClient
        documentId={DOCUMENT_ID}
        sourceDocument={makeSourceDocument()}
      />,
    );

    const backLink = screen.getByRole('link', { name: /back to search/i });
    expect(backLink).toHaveAttribute('href', '/search');
  });
});

describe('SourceDocumentDetailError', () => {
  let originalLocation: Location;

  beforeEach(() => {
    originalLocation = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: { ...originalLocation, reload: vi.fn() },
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: originalLocation,
    });
  });

  it('renders a non-technical, non-blank error with a retry affordance (BI-30)', () => {
    render(<SourceDocumentDetailError />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(
      screen.getByText(/this document could not be loaded/i),
    ).toBeInTheDocument();
  });

  it('retries by reloading the page', () => {
    render(<SourceDocumentDetailError />);

    screen.getByRole('button', { name: /try again/i }).click();
    expect(window.location.reload).toHaveBeenCalledTimes(1);
  });
});
