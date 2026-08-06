/**
 * SourceDocumentProvenance — id-111 B-28 field set (ID-135.14, TECH.md
 * BI-24 / BI-3). Props-driven: no data fetching, no sibling dependency —
 * the caller passes the full `source_documents` row.
 *
 * id-417 / DR-130 + DR-124: the Classification block (domains, summary,
 * ai_keywords) and the source_url link retired with their columns — this
 * suite pins the surviving provenance-only rendering.
 */
import { describe, it, expect } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { SourceDocumentProvenance } from '@/components/source-document-detail/source-document-provenance';
import type { Tables } from '@/supabase/types/database.types';

/**
 * `source_documents` carries a handful of DB-level NOT NULL columns —
 * this fixture supplies innocuous baseline values for those and leaves every
 * genuinely nullable column `null` unless overridden, so each test only sets
 * the fields it cares about. Typed loosely (Partial cast) so the fixture
 * stays valid across the pre-/post-regen generated-types window (id-417).
 */
function makeSourceDocument(
  overrides: Partial<Tables<'source_documents'>> = {},
): Tables<'source_documents'> {
  return {
    admission_status: 'ingested',
    archived_at: null,
    archived_by: null,
    auth: null,
    cadence: null,
    captured_date: null,
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
    publication_status: 'draft',
    retention_class: null,
    status: 'active',
    storage_path: 'source-documents/fixture-document.pdf',
    summary_data: null,
    updated_at: null,
    updated_by: null,
    uploaded_by: null,
    version: 1,
    ...overrides,
  } as Tables<'source_documents'>;
}

describe('SourceDocumentProvenance', () => {
  it('renders the filename, mime type, and landed date', () => {
    const doc = makeSourceDocument({
      original_filename: 'tender-spec.pdf',
      filename: 'raw-upload-843.pdf',
      mime_type: 'application/pdf',
      created_at: '2026-03-14T09:00:00.000Z',
    });
    render(<SourceDocumentProvenance sourceDocument={doc} />);

    expect(screen.getByText('tender-spec.pdf')).toBeInTheDocument();
    expect(screen.getByText(/application\/pdf/)).toBeInTheDocument();
    expect(screen.getByText(/14\/03\/2026/)).toBeInTheDocument();
    // id-417 / DR-124: the source_url outbound link retired with the column.
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
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
    const doc = makeSourceDocument();
    render(<SourceDocumentProvenance sourceDocument={doc} />);
    expect(screen.queryByText(/extracted/i)).not.toBeInTheDocument();
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
    // id-417 / DR-130: no Classification section exists any more.
    expect(screen.queryByText('Classification')).not.toBeInTheDocument();
  });
});
