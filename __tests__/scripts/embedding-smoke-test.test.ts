import { describe, it, expect } from 'vitest';
import { isPythonIngested } from '@/scripts/embedding-smoke-test';

describe('isPythonIngested', () => {
  it('returns true for extraction_source = trafilatura', () => {
    expect(
      isPythonIngested({ metadata: { extraction_source: 'trafilatura' } }),
    ).toBe(true);
  });

  it('returns true for extraction_source = jina_reader', () => {
    expect(
      isPythonIngested({ metadata: { extraction_source: 'jina_reader' } }),
    ).toBe(true);
  });

  it('returns true for extraction_source = pdfplumber', () => {
    expect(
      isPythonIngested({ metadata: { extraction_source: 'pdfplumber' } }),
    ).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(
      isPythonIngested({ metadata: { extraction_source: 'TRAFILATURA' } }),
    ).toBe(true);
  });

  it('returns false for extraction_source = readability (TS pipeline)', () => {
    expect(
      isPythonIngested({ metadata: { extraction_source: 'readability' } }),
    ).toBe(false);
  });

  it('returns false for extraction_source = firecrawl (TS pipeline)', () => {
    expect(
      isPythonIngested({ metadata: { extraction_source: 'firecrawl' } }),
    ).toBe(false);
  });

  it('returns false when metadata is null', () => {
    expect(isPythonIngested({ metadata: null })).toBe(false);
  });

  it('returns false when metadata is undefined', () => {
    expect(isPythonIngested({ metadata: undefined })).toBe(false);
  });

  it('returns false when extraction_source is not a string', () => {
    expect(isPythonIngested({ metadata: { extraction_source: 42 } })).toBe(
      false,
    );
  });

  it('falls back to pipeline field when extraction_source is missing', () => {
    expect(isPythonIngested({ metadata: { pipeline: 'trafilatura' } })).toBe(
      true,
    );
  });

  it('falls back to ingest_source field when earlier fields are missing', () => {
    expect(
      isPythonIngested({ metadata: { ingest_source: 'pdfplumber' } }),
    ).toBe(true);
  });

  it('returns false when all known fields are absent', () => {
    expect(
      isPythonIngested({ metadata: { some_other_key: 'trafilatura' } }),
    ).toBe(false);
  });

  it('rejects the pre-fix substring match (e.g. "python-pipeline")', () => {
    expect(
      isPythonIngested({ metadata: { extraction_source: 'python-pipeline' } }),
    ).toBe(false);
  });
});
