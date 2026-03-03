import { format, formatDistanceToNow, parseISO } from 'date-fns';
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

/** Format platform for display */
export function formatPlatform(platform: string | null): string {
  if (!platform) return '';
  return platform.charAt(0).toUpperCase() + platform.slice(1);
}

/** Format content type for display (kebab-case → Title Case) */
export function formatContentType(type: string | null): string {
  if (!type) return '';
  return type
    .split('-')
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

/** Extract YouTube video ID from various URL formats */
export function extractYouTubeVideoId(url: string): string | null {
  const watchMatch = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  if (watchMatch) return watchMatch[1];
  const shortMatch = url.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
  if (shortMatch) return shortMatch[1];
  const embedMatch = url.match(/youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/);
  if (embedMatch) return embedMatch[1];
  return null;
}

/** Format seconds to human-readable duration (e.g. "1h 23m" or "45m") */
export function formatDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
