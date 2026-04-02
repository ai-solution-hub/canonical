import {
  differenceInDays,
  format,
  formatDistanceToNow,
  isToday,
  isYesterday,
  parseISO,
} from 'date-fns';
import { enGB } from 'date-fns/locale';

/** Format a date string as DD MMM YYYY (e.g. "15 Jan 2026") */
export function formatDate(dateString: string | null): string {
  if (!dateString) return '';
  try {
    const date = parseISO(dateString);
    return format(date, 'd MMM yyyy', { locale: enGB });
  } catch {
    return '';
  }
}

/** Format a date string as relative time (e.g. "2 days ago") */
export function formatRelativeDate(dateString: string | null): string {
  if (!dateString) return '';
  try {
    const date = parseISO(dateString);
    return formatDistanceToNow(date, { addSuffix: true, locale: enGB });
  } catch {
    return '';
  }
}

/** Format a date string as DD/MM/YYYY */
export function formatDateUK(dateString: string | null): string {
  if (!dateString) return '';
  try {
    const date = parseISO(dateString);
    return format(date, 'dd/MM/yyyy', { locale: enGB });
  } catch {
    return '';
  }
}

/** Get display title — suggested_title, then title, then truncated content, then "Untitled" */
export function getDisplayTitle(item: {
  suggested_title?: string | null;
  title?: string | null;
  content?: string | null;
}): string {
  if (item.suggested_title?.trim()) return item.suggested_title.trim();
  if (item.title?.trim()) return item.title.trim();
  if (item.content?.trim())
    return (
      item.content.trim().slice(0, 80) +
      (item.content.trim().length > 80 ? '...' : '')
    );
  return 'Untitled';
}

/** Format a number as a percentage string (e.g. 0.93 → "93%") */
export function formatSimilarity(score: number): string {
  return `${Math.round(score * 100)}%`;
}

/** Format seconds to human-readable timestamp (mm:ss or h:mm:ss) */
export function formatSecondsToTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0)
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const PLATFORM_DISPLAY_NAMES: Record<string, string> = {
  extraction: 'Imported',
  manual: 'Manual entry',
  web: 'Web article',
  upload: 'Uploaded',
  email: 'Email',
  other: 'Other',
};

/** Format platform for display with human-friendly labels */
export function formatPlatform(platform: string | null): string {
  if (!platform) return '';
  return (
    PLATFORM_DISPLAY_NAMES[platform] ??
    platform.charAt(0).toUpperCase() + platform.slice(1)
  );
}

/** Smart date: "Today", "Yesterday", "3 days ago" for <7 days, else "15 Jan 2026" */
export function formatSmartDate(dateString: string | null): string {
  if (!dateString) return '';
  try {
    const date = parseISO(dateString);
    if (isToday(date)) return 'Today';
    if (isYesterday(date)) return 'Yesterday';
    const diff = differenceInDays(new Date(), date);
    if (diff < 7 && diff >= 0) {
      return formatDistanceToNow(date, { addSuffix: true, locale: enGB });
    }
    return format(date, 'd MMM yyyy', { locale: enGB });
  } catch {
    return '';
  }
}

/** Confidence label and colour based on classification score */
export function getConfidenceDisplay(confidence: number | null): {
  label: string;
  colourClass: string;
} {
  if (confidence === null || confidence === undefined) {
    return { label: 'Unknown', colourClass: 'text-muted-foreground' };
  }
  if (confidence >= 0.8) {
    return {
      label: 'High',
      colourClass: 'text-success',
    };
  }
  if (confidence >= 0.5) {
    return {
      label: 'Medium',
      colourClass: 'text-status-warning',
    };
  }
  return { label: 'Low', colourClass: 'text-destructive' };
}

/**
 * Display name overrides for content types that use underscores or
 * need special formatting (e.g. abbreviations, ampersands).
 */
const CONTENT_TYPE_DISPLAY_NAMES: Record<string, string> = {
  q_a_pair: 'Q&A Pair',
  case_study: 'Case Study',
  product_description: 'Product Description',
  // Single-word underscore types map naturally via the fallback
};

/** Format content type for display (kebab/underscore-case to Title Case) */
export function formatContentType(type: string | null): string {
  if (!type) return '';
  // Check explicit display name map first
  const override = CONTENT_TYPE_DISPLAY_NAMES[type];
  if (override) return override;
  // Fallback: split on hyphens or underscores and title-case each word
  return type
    .split(/[-_]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** Format a date string as "25 Feb" (day + short month) */
export function formatDateShort(dateString: string | null): string {
  if (!dateString) return '';
  try {
    const date = parseISO(dateString);
    return format(date, 'd MMM', { locale: enGB });
  } catch {
    return '';
  }
}

/** Format a date string as "14:32" (24-hour time) */
export function formatTimeShort(dateString: string | null): string {
  if (!dateString) return '';
  try {
    const date = parseISO(dateString);
    return format(date, 'HH:mm', { locale: enGB });
  } catch {
    return '';
  }
}

/** Format a date string as "25 Feb 14:32" */
export function formatDateTime(dateString: string | null): string {
  if (!dateString) return '';
  try {
    const date = parseISO(dateString);
    return format(date, 'd MMM HH:mm', { locale: enGB });
  } catch {
    return '';
  }
}

/** Format seconds to human-readable duration (e.g. "1h 23m" or "45m") */
export function formatDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/**
 * Formats a byte count into a human-readable file size string.
 * Uses SI-style KB/MB/GB units with 1024-byte boundaries.
 */
export function formatFileSize(bytes: number | null): string {
  if (bytes === null || bytes === undefined) return 'Unknown';
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
