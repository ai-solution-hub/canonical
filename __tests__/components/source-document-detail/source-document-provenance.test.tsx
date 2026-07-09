/**
 * SourceDocumentProvenance — id-111 B-28 field set + {131.9} classification
 * family (ID-135.14, TECH.md BI-24 / BI-3). Props-driven: no data fetching,
 * no sibling dependency — the caller passes the full `source_documents` row.
 */
import { describe, it, expect } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { SourceDocumentProvenance } from '@/components/source-document-detail/source-document-provenance';
import type { Tables } from '@/supabase/types/database.types';

/**
 * `source_documents` carries a handful of DB-level NOT NULL columns
 * (`admission_status`, `content_hash`, `created_at`, `file_size`, `filename`,
 * `id`, `mime_type`, `primary_domain`, `primary_subtopic`,
 * `publication_status`, `status`, `storage_path`, `version`) — this fixture
 * supplies innocuous baseline values for those and leaves every genuinely
 * nullable column `null` unless overridden, so each test only sets the
 * fields it cares about.
 */
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
    id: '00000000-0000-4000-8000-000000000000',
    locator: null,
    logical_path: null,
    mime_type: 'application/octet-stream',
    op_id: null,
    origin_type: null,
    original_filename: null,
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

describe('SourceDocumentProvenance', () => {
  it('renders the filename, mime type, source link, and landed date', () => {
    const doc = makeSourceDocument({
      original_filename: 'tender-spec.pdf',
      filename: 'raw-upload-843.pdf',
      mime_type: 'application/pdf',
      source_url: 'https://example.com/tender-spec.pdf',
      created_at: '2026-03-14T09:00:00.000Z',
    });
    render(<SourceDocumentProvenance sourceDocument={doc} />);

    expect(screen.getByText('tender-spec.pdf')).toBeInTheDocument();
    expect(screen.getByText(/application\/pdf/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /view source/i })).toHaveAttribute(
      'href',
      'https://example.com/tender-spec.pdf',
    );
    expect(screen.getByText(/14\/03\/2026/)).toBeInTheDocument();
  });

  it('falls back to filename when original_filename is absent', () => {
    const doc = makeSourceDocument({ filename: 'raw-upload-843.pdf' });
    render(<SourceDocumentProvenance sourceDocument={doc} />);
    expect(screen.getByText('raw-upload-843.pdf')).toBeInTheDocument();
  });

  it.each([
    ['docling', 'Extracted via Docling'],
    ['docling-v2', 'Extracted via Docling'],
    ['trafilatura', 'Extracted via Trafilatura'],
    ['trafilatura-fallback', 'Extracted via Trafilatura'],
    ['manual-upload', 'Extracted from a source document'],
  ])(
    'renders extraction_method %s in plain language, never the raw enum',
    (raw, expected) => {
      const doc = makeSourceDocument({ extraction_method: raw });
      const { container } = render(
        <SourceDocumentProvenance sourceDocument={doc} />,
      );
      expect(screen.getByText(expected)).toBeInTheDocument();
      expect(container.textContent).not.toContain(raw);
    },
  );

  it('omits the extraction method line when extraction_method is null', () => {
    const doc = makeSourceDocument({ primary_domain: 'Procurement' });
    render(<SourceDocumentProvenance sourceDocument={doc} />);
    expect(screen.queryByText(/extracted/i)).not.toBeInTheDocument();
  });

  it('omits the source link when source_url is null', () => {
    const doc = makeSourceDocument({ primary_domain: 'Procurement' });
    render(<SourceDocumentProvenance sourceDocument={doc} />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('renders the classification family as plain metadata', () => {
    const doc = makeSourceDocument({
      primary_domain: 'Procurement',
      primary_subtopic: 'Tender notices',
      secondary_domain: 'Legal',
      secondary_subtopic: 'Contract terms',
      summary: 'A summary of the tender document.',
      ai_keywords: ['tender', 'procurement', 'deadline'],
    });
    render(<SourceDocumentProvenance sourceDocument={doc} />);

    expect(screen.getByText('Procurement')).toBeInTheDocument();
    expect(screen.getByText('Tender notices')).toBeInTheDocument();
    expect(screen.getByText('Legal')).toBeInTheDocument();
    expect(screen.getByText('Contract terms')).toBeInTheDocument();
    expect(
      screen.getByText('A summary of the tender document.'),
    ).toBeInTheDocument();
    expect(screen.getByText('tender')).toBeInTheDocument();
    expect(screen.getByText('procurement')).toBeInTheDocument();
    expect(screen.getByText('deadline')).toBeInTheDocument();
  });

  it('never renders classification_confidence or classification_reasoning, even when present', () => {
    const doc = makeSourceDocument({
      classification_confidence: 0.42424242,
      classification_reasoning:
        'Matched on keyword density and heading structure.',
      primary_domain: 'Procurement',
    });
    const { container } = render(
      <SourceDocumentProvenance sourceDocument={doc} />,
    );

    expect(container.textContent).not.toContain('0.42424242');
    expect(
      screen.queryByText(/Matched on keyword density/),
    ).not.toBeInTheDocument();
    expect(container.textContent?.toLowerCase()).not.toContain('confidence');
  });

  it('shows "Not recorded" when neither original_filename nor filename is available', () => {
    const doc = makeSourceDocument({ filename: '', original_filename: null });
    render(<SourceDocumentProvenance sourceDocument={doc} />);
    expect(screen.getByText(/not recorded/i)).toBeInTheDocument();
  });

  it('never crashes and renders no raw undefined/null/NaN when every optional field is absent', () => {
    const doc = makeSourceDocument();
    const { container } = render(
      <SourceDocumentProvenance sourceDocument={doc} />,
    );

    expect(container.textContent).not.toMatch(/\bundefined\b/);
    expect(container.textContent).not.toMatch(/\bnull\b/);
    expect(container.textContent).not.toMatch(/\bNaN\b/);
    // No classification section renders when the classification family is empty.
    expect(screen.queryByText('Classification')).not.toBeInTheDocument();
  });
});
