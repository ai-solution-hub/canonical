/**
 * Date extraction engine for Knowledge Hub content.
 *
 * Extracts dates from text content using regex patterns, classifies them
 * by context (expiry, effective, review, publication, historical, unknown),
 * and assigns confidence levels. Designed for UK date formats (DD/MM/YYYY).
 *
 * Pure functions only — no database calls, no side effects.
 * Database integration is handled in Phase 2.
 */

// ──────────────────────────────────────────
// Types
// ──────────────────────────────────────────

export type DateContextType =
  | 'expiry'
  | 'effective'
  | 'review'
  | 'publication'
  | 'historical'
  | 'unknown';

type ConfidenceLevel = 'high' | 'medium' | 'low';

export interface DateExtraction {
  /** ISO 8601 normalised date string (YYYY-MM-DD) */
  date: string;
  /** The original text as found in the content */
  original_text: string;
  /** Classified context type based on surrounding keywords */
  context_type: DateContextType;
  /** Confidence in the extraction and classification */
  confidence: ConfidenceLevel;
  /** Character offset in the source text where the date was found */
  position: number;
  /** Surrounding text snippet for context (up to 80 chars either side) */
  context_snippet: string;
}

export interface TemporalReference {
  /** ISO 8601 normalised date string (YYYY-MM-DD) */
  date: string;
  /** Classified context type */
  type: DateContextType;
  /** Confidence level */
  confidence: ConfidenceLevel;
  /** Surrounding text snippet */
  context: string;
}

// ──────────────────────────────────────────
// Constants — month names for regex patterns
// ──────────────────────────────────────────

const MONTH_NAMES: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  sept: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

const MONTH_PATTERN = Object.keys(MONTH_NAMES).join('|');

// ──────────────────────────────────────────
// Context keyword patterns for date classification
// ──────────────────────────────────────────

/**
 * Keywords that indicate a date is an expiry/deadline.
 * Checked within a window of text surrounding the date.
 */
const EXPIRY_KEYWORDS = [
  'expir', // expires, expiry, expiration, expired
  'valid until',
  'valid to',
  'renewal date',
  'renewal due',
  'due for renewal',
  'renew by',
  'lapse', // lapses, lapsed
  'certificate valid until',
  'accreditation valid',
  'valid through',
  'deadline',
  'due date',
  'end date',
  'termination date',
  'best before',
  'use by',
];

/**
 * Keywords that indicate when something became effective/started.
 */
const EFFECTIVE_KEYWORDS = [
  'effective from',
  'effective date',
  'commenced',
  'commencing',
  'start date',
  'date of registration',
  'initial registration',
  'registration:',
  'registered on',
  'date obtained',
  'date of issue',
  'issued on',
  'issued:',
  'granted on',
  'granted:',
  'awarded on',
  'awarded:',
  'date joined',
  'enrolled',
  'activated',
  'in force from',
  'in effect from',
  'came into effect',
];

/**
 * Keywords that indicate a review/audit date.
 */
const REVIEW_KEYWORDS = [
  'next review',
  'review date',
  'review due',
  'audit date',
  'next audit',
  'surveillance audit',
  'audit:',
  'reassessment',
  'inspection date',
  'scheduled review',
  'due for review',
  'review by',
];

/**
 * Keywords that indicate a publication/creation date.
 */
const PUBLICATION_KEYWORDS = [
  'published',
  'publication date',
  'date published',
  'created',
  'created on',
  'written',
  'authored',
  'released',
  'release date',
  'last updated',
  'updated on',
  'version date',
  'revision date',
  'amended',
  'revised',
];

/**
 * Keywords that indicate historical/background context (not actionable).
 */
const HISTORICAL_KEYWORDS = [
  'founded',
  'established',
  'since',
  'incorporated',
  'formed in',
  'set up in',
  'operating since',
  'trading since',
];

// ──────────────────────────────────────────
// False positive patterns — dates to ignore
// ──────────────────────────────────────────

/**
 * Patterns that look like dates but are actually references, version numbers,
 * legislation names, standard identifiers, etc.
 *
 * Each pattern matches the text immediately preceding or surrounding a
 * year-like number to identify false positives.
 */
const FALSE_POSITIVE_PATTERNS = [
  // Legislation and acts: "Act 2018", "Regulation 2016", "Order 2019"
  /\b(?:Act|Regulation|Regulations|Order|Directive|Law|Statute|Bill|Amendment)\s+\d{4}\b/i,
  // Standards with colon notation: "ISO 27001:2022", "BS EN 1234:2020"
  /\b(?:ISO|BS|EN|IEC|IEEE|ANSI|DIN|AS|NF)\s*[\w./-]*:\d{4}\b/i,
  // Version numbers: "v2.0", "Version 3.1", "v1.2.3"
  /\bv(?:ersion)?\s*\d+\.\d+/i,
  // Page references: "page 3", "p.12", "pp. 5-10"
  /\bp(?:age|p)?\.?\s*\d+/i,
  // Section references: "section 3.2", "clause 4.1"
  /\b(?:section|clause|paragraph|appendix|annex|schedule|part|chapter|article)\s+\d+/i,
  // Reference numbers with year-like format: "Ref: 2022-1234"
  /\b(?:ref|reference|no|number)[.:]?\s*\d{4}[-/]\d+/i,
  // Standard references without colon: "ISO 9001" (the year is the standard number)
  /\b(?:ISO|BS|EN)\s+\d{4,5}(?:\s|$|[,;.])/i,
  // Copyright notices: "(c) 2024", "Copyright 2023"
  /(?:\u00a9|\(c\)|copyright)\s*\d{4}/i,
  // Year ranges in prose: "2020-2025" (often budget or plan periods)
  /\b\d{4}\s*[-\u2013\u2014]\s*\d{4}\b/,
];

/**
 * Check whether a matched date string is actually a false positive.
 * Examines the text immediately surrounding the match to determine if
 * this date is part of a reference, version number, legislation name, etc.
 *
 * The check uses a tight window (30 chars before + 10 chars after) to avoid
 * rejecting legitimate dates that merely appear in the same paragraph as
 * standard references like "ISO 27001".
 *
 * @param text - The full source text
 * @param matchPosition - Character offset where the date match starts
 * @param matchLength - Length of the matched date string
 * @returns true if this match should be rejected as a false positive
 */
function isFalsePositive(
  text: string,
  matchPosition: number,
  matchLength: number,
): boolean {
  // Use a tight window around the match — the false positive patterns should
  // overlap with the actual date text, not just be in the neighbourhood.
  // 20 chars before captures "Act ", "Regulation ", etc. that immediately
  // precede a year, without reaching back to unrelated ISO references.
  const contextStart = Math.max(0, matchPosition - 20);
  const contextEnd = Math.min(text.length, matchPosition + matchLength + 10);
  const context = text.slice(contextStart, contextEnd);

  for (const pattern of FALSE_POSITIVE_PATTERNS) {
    if (pattern.test(context)) {
      return true;
    }
  }

  return false;
}

// ──────────────────────────────────────────
// Date validation helpers
// ──────────────────────────────────────────

/**
 * Validate that a date has valid day/month/year values.
 * Returns false for impossible dates like 31 February.
 */
function isValidDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  if (year < 1900 || year > 2100) return false;

  // Check days in month (accounting for leap years)
  const daysInMonth = new Date(year, month, 0).getDate();
  return day <= daysInMonth;
}

/**
 * Format a date as ISO 8601 string (YYYY-MM-DD).
 */
function toISODate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Check whether a numeric DD/MM date is ambiguous (day value <= 12).
 * When day <= 12, the date could be read as either DD/MM or MM/DD.
 * We default to UK (DD/MM) but lower confidence to 'medium'.
 */
function isAmbiguousDateOrder(day: number, month: number): boolean {
  return day <= 12 && month <= 12 && day !== month;
}

/**
 * Extract a context snippet from the source text around a position.
 * Returns up to 80 characters on each side of the match.
 */
function extractContextSnippet(
  text: string,
  position: number,
  matchLength: number,
): string {
  const snippetPadding = 80;
  const start = Math.max(0, position - snippetPadding);
  const end = Math.min(text.length, position + matchLength + snippetPadding);

  let snippet = text.slice(start, end).trim();
  // Replace newlines and multiple spaces with a single space
  snippet = snippet.replace(/\s+/g, ' ');
  if (start > 0) snippet = '...' + snippet;
  if (end < text.length) snippet = snippet + '...';

  return snippet;
}

// ──────────────────────────────────────────
// Date context classification
// ──────────────────────────────────────────

/**
 * Classify the type of a date based on the surrounding text context.
 *
 * Examines a window of text around the date for keyword proximity.
 * Returns the most likely classification and its confidence.
 *
 * @param text - The full source text
 * @param position - Character offset of the date in the text
 * @param matchLength - Length of the matched date string
 * @returns An object with context_type and whether keywords were found
 */
export function classifyDateType(
  text: string,
  position: number,
  matchLength: number,
): { context_type: DateContextType; hasKeyword: boolean } {
  // Extract context window: 80 chars before and 20 chars after the date.
  // Then trim to the nearest sentence boundary (. or newline) if one exists
  // within the window, to prevent adjacent dates from contaminating each other.
  const rawStart = Math.max(0, position - 80);
  const rawEnd = Math.min(text.length, position + matchLength + 20);
  let contextBefore = text.slice(rawStart, position).toLowerCase();
  let contextAfter = text.slice(position + matchLength, rawEnd).toLowerCase();

  // Trim the "before" context at the last sentence boundary to avoid
  // picking up keywords from previous sentences
  const sentenceBreakBefore = contextBefore.search(/[.!?\n][^.!?\n]*$/);
  if (sentenceBreakBefore >= 0) {
    contextBefore = contextBefore.slice(sentenceBreakBefore + 1);
  }

  // Trim the "after" context at the first sentence boundary to avoid
  // picking up keywords from subsequent sentences
  const sentenceBreakAfter = contextAfter.search(/[.!?\n]/);
  if (sentenceBreakAfter >= 0) {
    contextAfter = contextAfter.slice(0, sentenceBreakAfter);
  }

  const context = contextBefore + contextAfter;

  // Check each keyword category (order matters — more specific first)
  for (const keyword of EXPIRY_KEYWORDS) {
    if (context.includes(keyword)) {
      return { context_type: 'expiry', hasKeyword: true };
    }
  }
  for (const keyword of REVIEW_KEYWORDS) {
    if (context.includes(keyword)) {
      return { context_type: 'review', hasKeyword: true };
    }
  }
  for (const keyword of EFFECTIVE_KEYWORDS) {
    if (context.includes(keyword)) {
      return { context_type: 'effective', hasKeyword: true };
    }
  }
  for (const keyword of PUBLICATION_KEYWORDS) {
    if (context.includes(keyword)) {
      return { context_type: 'publication', hasKeyword: true };
    }
  }
  for (const keyword of HISTORICAL_KEYWORDS) {
    if (context.includes(keyword)) {
      return { context_type: 'historical', hasKeyword: true };
    }
  }

  return { context_type: 'unknown', hasKeyword: false };
}

// ──────────────────────────────────────────
// Confidence scoring
// ──────────────────────────────────────────

/**
 * Determine the confidence level for an extracted date.
 *
 * - high: explicit keyword match + unambiguous date format
 * - medium: keyword match + ambiguous format, OR no keyword but future date
 * - low: standalone date with no contextual clues
 */
function determineConfidence(
  hasKeyword: boolean,
  isAmbiguous: boolean,
  dateYear: number,
  hasFullDate: boolean,
): ConfidenceLevel {
  if (hasKeyword && !isAmbiguous && hasFullDate) {
    return 'high';
  }
  if (hasKeyword) {
    return isAmbiguous ? 'medium' : 'high';
  }
  // No keyword — check if it is a future date (more likely to be actionable)
  const currentYear = new Date().getFullYear();
  if (dateYear >= currentYear && hasFullDate) {
    return 'medium';
  }
  return 'low';
}

// ──────────────────────────────────────────
// Core extraction — regex patterns
// ──────────────────────────────────────────

interface RawDateMatch {
  year: number;
  month: number;
  day: number;
  original_text: string;
  position: number;
  isAmbiguous: boolean;
  hasFullDate: boolean; // true if day+month+year; false for "Month YYYY" (day defaults to 1)
}

/**
 * Extract all date-like patterns from text using regex.
 *
 * Patterns matched (in order of specificity):
 * 1. DD/MM/YYYY or DD-MM-YYYY (UK numeric format)
 * 2. DD Month YYYY or DD Month, YYYY (UK named month)
 * 3. Month DD, YYYY (US named month — also common in formal documents)
 * 4. Month YYYY (partial date — day defaults to 1st)
 * 5. YYYY-MM-DD (ISO 8601 format)
 * 6. Standalone year with explicit context: "until 2027", "expires 2027"
 */
function extractRawDates(text: string): RawDateMatch[] {
  const matches: RawDateMatch[] = [];
  const seenPositions = new Set<number>(); // Avoid duplicate matches at the same position

  // ── Pattern 1: DD/MM/YYYY or DD-MM-YYYY ──
  // Matches: 25/03/2027, 01-12-2026, etc.
  // Negative lookbehind for digits to avoid matching mid-number sequences
  const numericDatePattern =
    /(?<!\d)(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})(?!\d)/g;
  let match: RegExpExecArray | null;

  while ((match = numericDatePattern.exec(text)) !== null) {
    const pos = match.index;
    if (seenPositions.has(pos)) continue;

    const dayOrMonth = parseInt(match[1], 10);
    const monthOrDay = parseInt(match[2], 10);
    const year = parseInt(match[3], 10);

    // Default to UK format: DD/MM/YYYY
    let day = dayOrMonth;
    let month = monthOrDay;

    // If first number > 12, it must be a day (unambiguous UK)
    // If second number > 12, first must be the month (likely US format but we still parse)
    if (dayOrMonth > 12 && monthOrDay <= 12) {
      // First is definitely a day, second is month (UK: DD/MM/YYYY) — unambiguous
      day = dayOrMonth;
      month = monthOrDay;
    } else if (monthOrDay > 12 && dayOrMonth <= 12) {
      // Second is definitely a day, so first is month (US: MM/DD/YYYY)
      day = monthOrDay;
      month = dayOrMonth;
    }
    // else: both <= 12 — ambiguous, default to UK (DD/MM/YYYY)

    if (!isValidDate(year, month, day)) continue;
    if (isFalsePositive(text, pos, match[0].length)) continue;

    const isAmbiguous = isAmbiguousDateOrder(dayOrMonth, monthOrDay);

    seenPositions.add(pos);
    matches.push({
      year,
      month,
      day,
      original_text: match[0],
      position: pos,
      isAmbiguous,
      hasFullDate: true,
    });
  }

  // ── Pattern 2: DD Month YYYY or DD Month, YYYY ──
  // Matches: 25 March 2027, 1st January 2026, 3rd Feb 2027
  const dayMonthYearPattern = new RegExp(
    '(?<![\\w])' +
      '(\\d{1,2})(?:st|nd|rd|th)?\\s+' + // Day with optional ordinal
      '(' +
      MONTH_PATTERN +
      ')' + // Month name
      '(?:[,]?\\s+)(\\d{4})' + // Year (optional comma)
      '(?![\\w])',
    'gi',
  );

  while ((match = dayMonthYearPattern.exec(text)) !== null) {
    const pos = match.index;
    if (seenPositions.has(pos)) continue;

    const day = parseInt(match[1], 10);
    const monthName = match[2].toLowerCase();
    const month = MONTH_NAMES[monthName];
    const year = parseInt(match[3], 10);

    if (!month || !isValidDate(year, month, day)) continue;
    if (isFalsePositive(text, pos, match[0].length)) continue;

    seenPositions.add(pos);
    matches.push({
      year,
      month,
      day,
      original_text: match[0],
      position: pos,
      isAmbiguous: false, // Named month — never ambiguous
      hasFullDate: true,
    });
  }

  // ── Pattern 3: Month DD, YYYY (US named format — also seen in UK documents) ──
  // Matches: March 25, 2027, January 1 2026
  const monthDayYearPattern = new RegExp(
    '(?<![\\w])' +
      '(' +
      MONTH_PATTERN +
      ')\\s+' + // Month name
      '(\\d{1,2})(?:st|nd|rd|th)?' + // Day with optional ordinal
      '(?:[,]?\\s+)(\\d{4})' + // Year (optional comma)
      '(?![\\w])',
    'gi',
  );

  while ((match = monthDayYearPattern.exec(text)) !== null) {
    const pos = match.index;
    if (seenPositions.has(pos)) continue;

    const monthName = match[1].toLowerCase();
    const month = MONTH_NAMES[monthName];
    const day = parseInt(match[2], 10);
    const year = parseInt(match[3], 10);

    if (!month || !isValidDate(year, month, day)) continue;
    if (isFalsePositive(text, pos, match[0].length)) continue;

    seenPositions.add(pos);
    matches.push({
      year,
      month,
      day,
      original_text: match[0],
      position: pos,
      isAmbiguous: false,
      hasFullDate: true,
    });
  }

  // ── Pattern 4: Month YYYY (partial date — day defaults to 1st) ──
  // Matches: March 2027, December 2026, Jun 2025
  // Negative lookbehind ensures we do not re-match "25 March 2027"
  const monthYearPattern = new RegExp(
    '(?<![\\d]\\s)' + // Not preceded by a day number
      '(?<![\\w])' +
      '(' +
      MONTH_PATTERN +
      ')\\s+' + // Month name
      '(\\d{4})' + // Year
      '(?![\\w/\\-:])', // Not followed by more date chars
    'gi',
  );

  while ((match = monthYearPattern.exec(text)) !== null) {
    const pos = match.index;
    if (seenPositions.has(pos)) continue;

    // Check this was not already matched as part of a full date
    let overlaps = false;
    for (const existing of matches) {
      if (
        pos >= existing.position &&
        pos < existing.position + existing.original_text.length
      ) {
        overlaps = true;
        break;
      }
    }
    if (overlaps) continue;

    const monthName = match[1].toLowerCase();
    const month = MONTH_NAMES[monthName];
    const year = parseInt(match[2], 10);

    if (!month || !isValidDate(year, month, 1)) continue;
    if (isFalsePositive(text, pos, match[0].length)) continue;

    seenPositions.add(pos);
    matches.push({
      year,
      month,
      day: 1, // Default to 1st of the month for partial dates
      original_text: match[0],
      position: pos,
      isAmbiguous: false,
      hasFullDate: false,
    });
  }

  // ── Pattern 5: YYYY-MM-DD (ISO 8601) ──
  // Matches: 2027-03-25, 2026-12-01
  const isoDatePattern = /(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/g;

  while ((match = isoDatePattern.exec(text)) !== null) {
    const pos = match.index;
    if (seenPositions.has(pos)) continue;

    const year = parseInt(match[1], 10);
    const month = parseInt(match[2], 10);
    const day = parseInt(match[3], 10);

    if (!isValidDate(year, month, day)) continue;
    if (isFalsePositive(text, pos, match[0].length)) continue;

    seenPositions.add(pos);
    matches.push({
      year,
      month,
      day,
      original_text: match[0],
      position: pos,
      isAmbiguous: false, // ISO format is unambiguous
      hasFullDate: true,
    });
  }

  // ── Pattern 6: Standalone year with explicit temporal context ──
  // Matches: "valid until 2027", "expires 2027", "renewal 2028"
  // Only matches bare years when preceded by a clear temporal keyword
  const yearWithContextPattern =
    /(?:expir(?:es|y|ation)?|valid\s+(?:until|to|through)|renewal|renew\s+by|due\s+(?:date|for\s+renewal)?|deadline|review(?:\s+date)?)\s*:?\s*(\d{4})(?!\d|[-/.])/gi;

  while ((match = yearWithContextPattern.exec(text)) !== null) {
    const yearStart = match.index + match[0].length - match[1].length;
    if (seenPositions.has(yearStart)) continue;

    // Check this year was not already matched as part of a full date
    let overlaps = false;
    for (const existing of matches) {
      if (
        yearStart >= existing.position &&
        yearStart < existing.position + existing.original_text.length
      ) {
        overlaps = true;
        break;
      }
    }
    if (overlaps) continue;

    const year = parseInt(match[1], 10);
    if (year < 2000 || year > 2100) continue;
    if (isFalsePositive(text, match.index, match[0].length)) continue;

    seenPositions.add(yearStart);
    matches.push({
      year,
      month: 12, // Default to end of year for expiry-context standalone years
      day: 31,
      original_text: match[1],
      position: yearStart,
      isAmbiguous: false,
      hasFullDate: false,
    });
  }

  // Sort by position in text
  return matches.sort((a, b) => a.position - b.position);
}

// ──────────────────────────────────────────
// Historical date filtering
// ──────────────────────────────────────────

/**
 * Apply historical date rules:
 * - Dates before 2020 are classified as 'historical' unless preceded by an expiry phrase
 * - Dates more than 10 years in the future are classified as 'unknown' (likely OCR artefacts)
 */
function applyDateRules(
  extraction: DateExtraction,
  dateYear: number,
): DateExtraction {
  const currentYear = new Date().getFullYear();

  // Rule: dates before 2020 default to historical unless already classified by keyword
  if (dateYear < 2020 && extraction.context_type === 'unknown') {
    return { ...extraction, context_type: 'historical', confidence: 'low' };
  }

  // Rule: dates more than 10 years in the future are suspicious
  if (dateYear > currentYear + 10) {
    return { ...extraction, context_type: 'unknown', confidence: 'low' };
  }

  return extraction;
}

// ──────────────────────────────────────────
// Public API
// ──────────────────────────────────────────

/**
 * Extract all dates from text content using regex patterns.
 *
 * Returns an array of DateExtraction objects, each containing the normalised
 * ISO date, context classification, confidence level, and surrounding text.
 *
 * @param text - Plain text content to scan for dates
 * @returns Array of extracted dates, sorted by position in text
 */
export function extractDates(text: string): DateExtraction[] {
  if (!text || text.trim().length === 0) return [];

  const rawMatches = extractRawDates(text);
  const extractions: DateExtraction[] = [];

  for (const raw of rawMatches) {
    const { context_type, hasKeyword } = classifyDateType(
      text,
      raw.position,
      raw.original_text.length,
    );

    const confidence = determineConfidence(
      hasKeyword,
      raw.isAmbiguous,
      raw.year,
      raw.hasFullDate,
    );

    const contextSnippet = extractContextSnippet(
      text,
      raw.position,
      raw.original_text.length,
    );

    let extraction: DateExtraction = {
      date: toISODate(raw.year, raw.month, raw.day),
      original_text: raw.original_text,
      context_type,
      confidence,
      position: raw.position,
      context_snippet: contextSnippet,
    };

    extraction = applyDateRules(extraction, raw.year);
    extractions.push(extraction);
  }

  return extractions;
}

/**
 * Find the most relevant expiry date from an array of extracted dates.
 *
 * Returns the earliest future date classified as 'expiry' with high or medium
 * confidence. Returns null if no qualifying expiry date is found.
 *
 * @param dates - Array of DateExtraction objects (from extractDates)
 * @returns ISO 8601 date string of the earliest future expiry, or null
 */
export function findExpiryDate(dates: DateExtraction[]): string | null {
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  const expiryDates = dates
    .filter(
      (d) =>
        d.context_type === 'expiry' &&
        (d.confidence === 'high' || d.confidence === 'medium') &&
        new Date(d.date) >= now,
    )
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  return expiryDates.length > 0 ? expiryDates[0].date : null;
}

/**
 * Main entry point: extract temporal references from text.
 *
 * Combines date extraction, classification, and confidence scoring into
 * a simplified return format suitable for storage in content metadata.
 *
 * @param text - Plain text content to scan
 * @returns Array of temporal references
 */
export function extractTemporalReferences(text: string): TemporalReference[] {
  const extractions = extractDates(text);

  return extractions.map((e) => ({
    date: e.date,
    type: e.context_type,
    confidence: e.confidence,
    context: e.context_snippet,
  }));
}
