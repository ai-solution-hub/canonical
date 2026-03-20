/**
 * Shared constants and helpers used across MCP formatter domain files.
 *
 * Dates are formatted as DD/MM/YYYY per UK English conventions.
 */
import { formatDateUK } from '@/lib/format';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Maximum character limit for Markdown tool response text. Prevents oversized
 * responses from large PDFs or busy dashboards overwhelming the LLM context.
 */
export const CHARACTER_LIMIT = 10_000;

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Truncate text to a maximum length with ellipsis */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}

/**
 * Truncate a Markdown response to CHARACTER_LIMIT. Appends a note when
 * content is truncated so the LLM knows to request specific items instead.
 */
export function truncateResponse(text: string): string {
  if (text.length <= CHARACTER_LIMIT) return text;
  return text.slice(0, CHARACTER_LIMIT) + '\n\n... (content truncated — request specific items for full detail)';
}

/** Format a deadline with days remaining */
export function formatDeadline(deadline: string | null, daysUntil: number | null): string {
  if (!deadline) return 'No deadline set';
  const dateStr = formatDateUK(deadline);
  if (daysUntil === null) return dateStr;
  if (daysUntil < 0) return `${dateStr} (${Math.abs(daysUntil)} days overdue)`;
  if (daysUntil === 0) return `${dateStr} (due today)`;
  if (daysUntil === 1) return `${dateStr} (1 day remaining)`;
  return `${dateStr} (${daysUntil} days remaining)`;
}

/** Format a percentage from a fraction */
export function formatProgress(completed: number, total: number): string {
  if (total === 0) return '0%';
  return `${Math.round((completed / total) * 100)}%`;
}
