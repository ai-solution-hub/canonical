import { describe, it, expect } from 'vitest';
import {
  INGESTION_SOURCE_LABELS,
  getIngestionSourceLabel,
  parseImportBatchDate,
  formatConfidencePercent,
  truncateUrl,
  detectMarkdownIngest,
} from '@/components/reader/source-metadata-helpers';

describe('source-metadata-helpers', () => {
  describe('INGESTION_SOURCE_LABELS', () => {
    it('includes all known pipeline identifiers', () => {
      // Spec §4.2 + §5.5: every pipeline identifier observed in codebase.
      expect(INGESTION_SOURCE_LABELS).toMatchObject({
        markdown_file: 'Markdown upload',
        markdown_pipeline: 'Markdown upload',
        markdown_import: 'Markdown upload',
        stage2_markdown: 'Markdown upload',
        url_import: 'URL import',
        upload: 'File upload',
        upload_autosplit: 'Auto-split upload',
        manual: 'Manual entry',
        bid_library: 'Procurement library import',
        bid_library_import: 'Procurement library import',
      });
    });
  });

  describe('getIngestionSourceLabel', () => {
    it('maps markdown_file to Markdown upload', () => {
      expect(getIngestionSourceLabel('markdown_file', false)).toBe(
        'Markdown upload',
      );
    });

    it('maps markdown_pipeline alias to Markdown upload', () => {
      expect(getIngestionSourceLabel('markdown_pipeline', false)).toBe(
        'Markdown upload',
      );
    });

    it('maps markdown_import (Python post_insert) to Markdown upload', () => {
      expect(getIngestionSourceLabel('markdown_import', false)).toBe(
        'Markdown upload',
      );
    });

    it('maps stage2_markdown (Python stage-2) to Markdown upload', () => {
      expect(getIngestionSourceLabel('stage2_markdown', false)).toBe(
        'Markdown upload',
      );
    });

    it('maps url_import to URL import', () => {
      expect(getIngestionSourceLabel('url_import', false)).toBe('URL import');
    });

    it('maps upload to File upload', () => {
      expect(getIngestionSourceLabel('upload', false)).toBe('File upload');
    });

    it('maps upload_autosplit to Auto-split upload', () => {
      expect(getIngestionSourceLabel('upload_autosplit', false)).toBe(
        'Auto-split upload',
      );
    });

    it('maps manual to Manual entry', () => {
      expect(getIngestionSourceLabel('manual', false)).toBe('Manual entry');
    });

    it('maps bid_library (raw enum) to Procurement library import', () => {
      expect(getIngestionSourceLabel('bid_library', false)).toBe(
        'Procurement library import',
      );
    });

    it('maps bid_library_import to Procurement library import', () => {
      expect(getIngestionSourceLabel('bid_library_import', false)).toBe(
        'Procurement library import',
      );
    });

    it('falls through to raw value for unknown identifiers (fail-safe)', () => {
      expect(getIngestionSourceLabel('unknown_source', false)).toBe(
        'unknown_source',
      );
    });

    it('returns "RSS feed" when raw is null but feed article exists', () => {
      expect(getIngestionSourceLabel(null, true)).toBe('RSS feed');
    });

    it('returns null when raw is null and no feed article', () => {
      expect(getIngestionSourceLabel(null, false)).toBe(null);
    });

    it('returns null when raw is undefined and no feed article', () => {
      expect(getIngestionSourceLabel(undefined, false)).toBe(null);
    });

    it('returns "RSS feed" when raw is undefined and feed article exists', () => {
      expect(getIngestionSourceLabel(undefined, true)).toBe('RSS feed');
    });
  });

  describe('parseImportBatchDate', () => {
    it('parses a canonical bid-library batch ID', () => {
      const result = parseImportBatchDate('bid-library-20260422-070729');
      expect(result).not.toBeNull();
      expect(result?.toISOString()).toBe('2026-04-22T07:07:29.000Z');
    });

    it('returns null for non-matching format (dashes inside date)', () => {
      expect(parseImportBatchDate('bid-library-2026-04-22')).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(parseImportBatchDate('')).toBeNull();
    });

    it('returns null for null', () => {
      expect(parseImportBatchDate(null)).toBeNull();
    });

    it('returns null for undefined', () => {
      expect(parseImportBatchDate(undefined)).toBeNull();
    });

    it('returns null for invalid month/day components', () => {
      // 99/99 is out of range. Parser must NOT silently roll over.
      expect(parseImportBatchDate('bid-library-99999999-999999')).toBeNull();
    });

    it('returns null for calendar-impossible dates (Feb 31)', () => {
      // 2026-02-31 would auto-roll to March 3 in raw Date. We reject it.
      expect(parseImportBatchDate('bid-library-20260231-120000')).toBeNull();
    });

    it('matches only when the tail format is exact', () => {
      // Extra trailing characters must not match.
      expect(
        parseImportBatchDate('bid-library-20260422-070729-extra'),
      ).toBeNull();
    });
  });

  describe('formatConfidencePercent', () => {
    it('formats 0.7 as "70%"', () => {
      expect(formatConfidencePercent(0.7)).toBe('70%');
    });

    it('rounds 0.753 to "75%" (integer only)', () => {
      expect(formatConfidencePercent(0.753)).toBe('75%');
    });

    it('formats 1 as "100%"', () => {
      expect(formatConfidencePercent(1)).toBe('100%');
    });

    it('formats 0 as "0%" (renderable per §14.2 default)', () => {
      expect(formatConfidencePercent(0)).toBe('0%');
    });

    it('returns null for null', () => {
      expect(formatConfidencePercent(null)).toBeNull();
    });

    it('returns null for undefined', () => {
      expect(formatConfidencePercent(undefined)).toBeNull();
    });
  });

  describe('truncateUrl', () => {
    it('leaves short URLs unchanged', () => {
      expect(truncateUrl('https://example.com/short', 60)).toBe(
        'https://example.com/short',
      );
    });

    it('truncates long URLs with a single-character ellipsis', () => {
      const long = 'https://example.com/' + 'a'.repeat(100);
      const result = truncateUrl(long, 60);
      expect(result.length).toBe(60);
      expect(result.endsWith('…')).toBe(true);
    });

    it('leaves exactly-max-length URLs unchanged', () => {
      const url = 'a'.repeat(60);
      expect(truncateUrl(url, 60)).toBe(url);
    });
  });

  describe('detectMarkdownIngest', () => {
    it('returns true for ingestion_source=markdown_file', () => {
      expect(detectMarkdownIngest({ ingestion_source: 'markdown_file' })).toBe(
        true,
      );
    });

    it('returns true for original_format=markdown', () => {
      expect(detectMarkdownIngest({ original_format: 'markdown' })).toBe(true);
    });

    it('returns false for ingestion_source=url_import', () => {
      expect(detectMarkdownIngest({ ingestion_source: 'url_import' })).toBe(
        false,
      );
    });

    it('returns false for empty metadata', () => {
      expect(detectMarkdownIngest({})).toBe(false);
    });

    it('returns false for null', () => {
      expect(detectMarkdownIngest(null)).toBe(false);
    });

    it('returns false for undefined', () => {
      expect(detectMarkdownIngest(undefined)).toBe(false);
    });
  });
});
