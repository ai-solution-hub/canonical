/**
 * Content item formatters for MCP tool responses.
 */
import { formatDateUK, formatContentType } from '@/lib/format';
import { truncate } from './shared';

// ---------------------------------------------------------------------------
// Content item detail
// ---------------------------------------------------------------------------

export interface ContentItemDetail {
  id: string;
  title: string | null;
  suggested_title: string | null;
  content_type: string | null;
  primary_domain: string | null;
  primary_subtopic: string | null;
  ai_summary: string | null;
  ai_keywords: string[] | null;
  freshness: string | null;
  classification_confidence: number | null;
  source_url: string | null;
  content: string | null;
  created_at: string | null;
  updated_at: string | null;
  governance_review_status: string | null;
  priority: string | null;
}

export function formatContentItem(item: ContentItemDetail): string {
  const title = item.suggested_title || item.title || 'Untitled';
  const type = formatContentType(item.content_type);

  const lines: string[] = [`# ${title}`, '', `**Type:** ${type}`];

  if (item.primary_domain) {
    const domain = item.primary_subtopic
      ? `${item.primary_domain} > ${item.primary_subtopic}`
      : item.primary_domain;
    lines.push(`**Domain:** ${domain}`);
  }

  if (item.freshness) {
    lines.push(`**Freshness:** ${item.freshness}`);
  }

  if (item.priority) {
    lines.push(`**Priority:** ${item.priority}`);
  }

  if (item.classification_confidence !== null) {
    lines.push(
      `**Classification confidence:** ${Math.round(item.classification_confidence * 100)}%`,
    );
  }

  if (item.governance_review_status) {
    lines.push(`**Governance status:** ${item.governance_review_status}`);
  }

  if (item.source_url) {
    lines.push(`**Source:** ${item.source_url}`);
  }

  if (item.created_at) {
    lines.push(`**Created:** ${formatDateUK(item.created_at)}`);
  }

  if (item.updated_at) {
    lines.push(`**Updated:** ${formatDateUK(item.updated_at)}`);
  }

  if (item.ai_keywords && item.ai_keywords.length > 0) {
    lines.push(`**Keywords:** ${item.ai_keywords.join(', ')}`);
  }

  lines.push(`**ID:** ${item.id}`);

  // Summary
  if (item.ai_summary) {
    lines.push('', '## Summary', '', item.ai_summary);
  }

  // Content excerpt
  if (item.content) {
    const excerpt = truncate(item.content, 2000);
    lines.push('', '## Content', '', excerpt);
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Content item created
// ---------------------------------------------------------------------------

export interface CreatedItem {
  id: string;
  title: string;
  content_type: string;
}

export function formatCreatedItem(item: CreatedItem): string {
  return [
    '# Content Item Created',
    '',
    `**Title:** ${item.title}`,
    `**Type:** ${formatContentType(item.content_type)}`,
    `**ID:** ${item.id}`,
    '',
    'The item has been created successfully.',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Content item updated
// ---------------------------------------------------------------------------

export interface UpdatedItemResult {
  id: string;
  updated_fields: string[];
  previous_values: Record<string, unknown>;
  reason: string | null;
}

export function formatUpdatedItem(data: UpdatedItemResult): string {
  const lines: string[] = [
    '# Content Item Updated',
    '',
    `**ID:** ${data.id}`,
    `**Fields updated:** ${data.updated_fields.join(', ')}`,
  ];

  if (data.reason) {
    lines.push(`**Reason:** ${data.reason}`);
  }

  lines.push('', 'The item has been updated successfully.');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Batch content items
// ---------------------------------------------------------------------------

export interface BatchContentItemsResult {
  count: number;
  items: ContentItemDetail[];
  not_found: string[];
}

export function formatBatchContentItems(data: BatchContentItemsResult): string {
  const lines: string[] = [
    `# ${data.count} Content Item${data.count === 1 ? '' : 's'}`,
    '',
  ];

  if (data.not_found.length > 0) {
    lines.push(
      `**Not found:** ${data.not_found.length} ID${data.not_found.length === 1 ? '' : 's'} returned no result`,
      '',
    );
  }

  for (const item of data.items) {
    lines.push(formatContentItem(item));
    lines.push('', '---', '');
  }

  return lines.join('\n');
}
