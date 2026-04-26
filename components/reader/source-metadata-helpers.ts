/**
 * Pure helpers for SourceMetadata — label mapping, date parsing, formatting,
 * truncation, and markdown-ingest detection.
 *
 * All functions are pure, null-safe, and framework-free. See
 * `docs/specs/source-information-spec.md` §4, §5.5 for authority.
 */

export const INGESTION_SOURCE_LABELS = {
  markdown_file: 'Markdown upload',
  markdown_pipeline: 'Markdown upload',
  markdown_import: 'Markdown upload',
  stage2_markdown: 'Markdown upload',
  url_import: 'URL import',
  upload: 'File upload',
  upload_autosplit: 'Auto-split upload',
  manual: 'Manual entry',
  bid_library: 'Bid library import',
  bid_library_import: 'Bid library import',
} as const;

/**
 * Resolve a human-readable ingestion-source label.
 *
 * - `markdown_*` / `stage2_markdown` pipeline aliases collapse to "Markdown upload".
 * - Unknown non-null raw values fall through to the raw string (fail-safe).
 * - `null`/`undefined` + `hasFeedArticle=true` → "RSS feed" (RSS fallback).
 * - `null`/`undefined` + `hasFeedArticle=false` → `null` (hide the row).
 */
export function getIngestionSourceLabel(
  raw: string | null | undefined,
  hasFeedArticle: boolean,
): string | null {
  if (!raw && hasFeedArticle) return 'RSS feed';
  if (!raw) return null;
  return (
    INGESTION_SOURCE_LABELS[raw as keyof typeof INGESTION_SOURCE_LABELS] ?? raw
  );
}

/**
 * Parse the trailing `-YYYYMMDD-HHMMSS` tail of an import_batch string.
 *
 * Example: `"bid-library-20260422-070729"` → Date UTC 2026-04-22T07:07:29.
 *
 * Returns `null` for empty, null, regex-miss, or invalid calendar dates.
 * Silent fallback — no error state surfaced to the UI. Spec §4.3.
 */
export function parseImportBatchDate(
  importBatch: string | null | undefined,
): Date | null {
  if (!importBatch) return null;
  const match = importBatch.match(/-(\d{8})-(\d{6})$/);
  if (!match) return null;
  const datePart = match[1];
  const timePart = match[2];
  const yyyy = Number(datePart.slice(0, 4));
  const mm = Number(datePart.slice(4, 6));
  const dd = Number(datePart.slice(6, 8));
  const hh = Number(timePart.slice(0, 2));
  const mi = Number(timePart.slice(2, 4));
  const ss = Number(timePart.slice(4, 6));
  // Calendar-validity check: reject if any component out of range.
  if (
    mm < 1 ||
    mm > 12 ||
    dd < 1 ||
    dd > 31 ||
    hh > 23 ||
    mi > 59 ||
    ss > 59
  ) {
    return null;
  }
  const date = new Date(Date.UTC(yyyy, mm - 1, dd, hh, mi, ss));
  if (Number.isNaN(date.getTime())) return null;
  // Guard against auto-rollover (e.g. Feb 31 → Mar 3): verify the UTC
  // components round-trip. JS Date silently rolls over invalid dates.
  if (
    date.getUTCFullYear() !== yyyy ||
    date.getUTCMonth() !== mm - 1 ||
    date.getUTCDate() !== dd
  ) {
    return null;
  }
  return date;
}

/**
 * Format a 0..1 confidence value as an integer percentage string.
 *
 * - `0.7` → "70%"
 * - `0.753` → "75%" (rounded to integer; spec §3.2 rule 5 — no decimals).
 * - `null`/`undefined` → `null` (hide the row).
 *
 * The caller is responsible for role-gating. This helper has no role concept.
 */
export function formatConfidencePercent(
  confidence: number | null | undefined,
): string | null {
  if (confidence == null) return null;
  return `${Math.round(confidence * 100)}%`;
}

/**
 * Truncate a URL to `maxLen` characters with an ellipsis suffix.
 *
 * - Strings <= maxLen are returned unchanged.
 * - Longer strings are cut at `maxLen - 1` and appended with "…" (single
 *   Unicode ellipsis — one display character).
 * - The full URL remains in the `href`; only the visible text is truncated.
 */
export function truncateUrl(url: string, maxLen: number): string {
  if (url.length <= maxLen) return url;
  return url.slice(0, maxLen - 1) + '…';
}

/**
 * Detect the markdown-ingest dispatch path.
 *
 * Fires when `metadata.ingestion_source === 'markdown_file'` OR
 * `metadata.original_format === 'markdown'`. Spec §3.1.3 and §6.4.
 */
export function detectMarkdownIngest(
  metadata: Record<string, unknown> | null | undefined,
): boolean {
  if (!metadata) return false;
  const ingestionSource = metadata.ingestion_source;
  const originalFormat = metadata.original_format;
  return (
    ingestionSource === 'markdown_file' || originalFormat === 'markdown'
  );
}
