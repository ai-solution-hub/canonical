import { describe, it, expect, vi } from 'vitest';
import {
  ContentMetadataSchema,
  parseContentMetadata,
  type ContentMetadata,
} from '@/lib/validation/schemas';

describe('ContentMetadataSchema', () => {
  // ── Valid complete metadata ──────────────────────────────

  const FULL_METADATA: ContentMetadata = {
    // Source provenance
    source_file: 'docs/policies/data-protection.md',
    source_folder: 'policies',
    ingestion_source: 'markdown_pipeline',
    original_format: 'markdown',
    import_batch: 'batch-2026-03-19',
    original_filename: 'data-protection.docx',
    file_size: 245_760,
    mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    batch_tag: 'initial-import',
    source_document: 'Company Policies 2026',

    // Content enrichment
    reader_html: '<h1>Data Protection Policy</h1><p>Content here...</p>',
    extracted_images: [{ url: '/storage/img1.png', alt: 'Diagram' }],
    images_extracted_at: '2026-03-19T14:30:00Z',
    chapters: [{ title: 'Introduction', start: 0, end: 120 }],
    tables: [{ headers: ['Col A', 'Col B'], rows: [['1', '2']] }],
    table_count: 1,
    page_count: 12,

    // User-facing state (layer and starred are now proper columns, not metadata)
    topic_id: 'data-security',

    // Import-specific context
    section_name: 'Information Security',
    table_index: 2,
    row_index: 5,
    has_standard: true,
    has_advanced: false,
    extraction_failed: false,
  };

  it('should accept a fully populated metadata object', () => {
    const result = ContentMetadataSchema.safeParse(FULL_METADATA);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.source_file).toBe('docs/policies/data-protection.md');
      expect(result.data.page_count).toBe(12);
      expect(result.data.table_count).toBe(1);
    }
  });

  // ── Partial metadata ─────────────────────────────────────

  it('should accept an empty object (all keys optional)', () => {
    const result = ContentMetadataSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.source_file).toBeUndefined();
    }
  });

  it('should accept provenance-only metadata (markdown pipeline)', () => {
    const result = ContentMetadataSchema.safeParse({
      source_file: 'docs/overview.md',
      source_folder: 'docs',
      ingestion_source: 'markdown_pipeline',
      original_format: 'markdown',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.source_file).toBe('docs/overview.md');
      expect(result.data.ingestion_source).toBe('markdown_pipeline');
      expect(result.data.reader_html).toBeUndefined();
    }
  });

  it('should accept upload-only metadata', () => {
    const result = ContentMetadataSchema.safeParse({
      original_filename: 'report.pdf',
      file_size: 1_048_576,
      mime_type: 'application/pdf',
      ingestion_source: 'upload',
      page_count: 24,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.original_filename).toBe('report.pdf');
      expect(result.data.file_size).toBe(1_048_576);
    }
  });

  it('should accept bid-library import metadata', () => {
    const result = ContentMetadataSchema.safeParse({
      source_file: 'library/qa-pairs.docx',
      import_batch: 'bid-lib-2026-03',
      section_name: 'Technical Capability',
      table_index: 0,
      row_index: 3,
      has_standard: true,
      has_advanced: true,
    });
    expect(result.success).toBe(true);
  });

  it('should accept topic metadata only', () => {
    const result = ContentMetadataSchema.safeParse({
      topic_id: 'pricing',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.topic_id).toBe('pricing');
    }
  });

  // ── Passthrough for unknown keys ─────────────────────────

  it('should pass through unknown keys without error', () => {
    const result = ContentMetadataSchema.safeParse({
      source_file: 'test.md',
      custom_field: 'custom value',
      future_feature: 42,
      nested_unknown: { a: 1, b: [2, 3] },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.source_file).toBe('test.md');
      expect((result.data as Record<string, unknown>).custom_field).toBe('custom value');
      expect((result.data as Record<string, unknown>).future_feature).toBe(42);
      expect((result.data as Record<string, unknown>).nested_unknown).toEqual({ a: 1, b: [2, 3] });
    }
  });

  // ── Type validation edge cases ───────────────────────────

  it('should reject non-number file_size', () => {
    const result = ContentMetadataSchema.safeParse({
      file_size: '245760',
    });
    expect(result.success).toBe(false);
  });

  it('should reject negative file_size', () => {
    const result = ContentMetadataSchema.safeParse({
      file_size: -100,
    });
    expect(result.success).toBe(false);
  });

  it('should reject non-integer table_index', () => {
    const result = ContentMetadataSchema.safeParse({
      table_index: 1.5,
    });
    expect(result.success).toBe(false);
  });

  it('should reject negative page_count', () => {
    const result = ContentMetadataSchema.safeParse({
      page_count: -1,
    });
    expect(result.success).toBe(false);
  });

  it('should reject non-boolean has_standard', () => {
    const result = ContentMetadataSchema.safeParse({
      has_standard: 1,
    });
    expect(result.success).toBe(false);
  });

  it('should reject non-array extracted_images', () => {
    const result = ContentMetadataSchema.safeParse({
      extracted_images: 'not-an-array',
    });
    expect(result.success).toBe(false);
  });

  it('should reject non-array tables', () => {
    const result = ContentMetadataSchema.safeParse({
      tables: { headers: ['A'], rows: [] },
    });
    expect(result.success).toBe(false);
  });

  it('should reject non-object value at top level', () => {
    const result = ContentMetadataSchema.safeParse('not-an-object');
    expect(result.success).toBe(false);
  });

  it('should reject null at top level', () => {
    const result = ContentMetadataSchema.safeParse(null);
    expect(result.success).toBe(false);
  });

  it('should accept zero for numeric fields', () => {
    const result = ContentMetadataSchema.safeParse({
      file_size: 0,
      page_count: 0,
      table_count: 0,
      table_index: 0,
      row_index: 0,
    });
    expect(result.success).toBe(true);
  });
});

describe('parseContentMetadata', () => {
  it('should return parsed metadata for valid input', () => {
    const result = parseContentMetadata({
      topic_id: 'data-security',
    });
    expect(result).not.toBeNull();
    expect(result!.topic_id).toBe('data-security');
  });

  it('should return parsed metadata for empty object', () => {
    const result = parseContentMetadata({});
    expect(result).not.toBeNull();
    expect(result).toEqual({});
  });

  it('should return null and warn for invalid input', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = parseContentMetadata('not-an-object');
    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      'Invalid content metadata:',
      expect.anything(),
    );
    warnSpy.mockRestore();
  });

  it('should return null for type violations', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = parseContentMetadata({ file_size: 'not-a-number' });
    expect(result).toBeNull();
    warnSpy.mockRestore();
  });

  it('should preserve unknown keys via passthrough', () => {
    const result = parseContentMetadata({
      topic_id: 'research',
      custom_key: 'preserved',
    });
    expect(result).not.toBeNull();
    expect((result as Record<string, unknown>).custom_key).toBe('preserved');
  });
});
