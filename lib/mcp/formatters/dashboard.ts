/**
 * Dashboard and reorientation formatters for MCP tool responses.
 */
import type { ActiveProcurementSummary } from '@/lib/dashboard';
import type { ReorientData } from '@/types/reorient';
import { formatDeadline, formatProgress } from './shared';
import { formatDateUK } from '@/lib/format';
import { formatEntityDisplayName } from '@/lib/entities/entity-dedup';

// ---------------------------------------------------------------------------
// Expiring content types
// ---------------------------------------------------------------------------

export interface ExpiringContentItem {
  id: string;
  title: string;
  expiry_date: string;
  days_remaining: number;
  domain: string | null;
  lifecycle_type: string | null;
}

export interface ExpiringEntityMention {
  canonical_name: string;
  entity_type: string;
  expiry_date: string;
  days_remaining: number;
  expiry_status: string;
}

export interface ExpiringContentData {
  content_items: ExpiringContentItem[];
  entity_mentions: ExpiringEntityMention[];
  days_ahead: number;
}

// ---------------------------------------------------------------------------
// where_are_we_exposed — five-layer exposure framing (ID-71.8, B-INV-4/29)
//
// One outcome-shaped read consolidating the former exposure / freshness /
// coverage / quality / certification reads into the consumption framing:
//   data you have → its quality → how you could use it today → the gaps →
//   the opportunities.
// Gaps and opportunities carry first-class suggested-resolution affordances
// (B-INV-4) — each a callable tool + a ready-to-run prompt.
// ---------------------------------------------------------------------------

/**
 * A first-class resolution affordance attached to a layer (B-INV-4). Points
 * the caller at a callable tool ("Draft content for X" / "Discuss options for
 * Y") rather than leaving a gap as an undifferentiated list entry.
 */
export interface ExposureResolution {
  /** The MCP tool that resolves the gap (e.g. `suggest_content_creation`). */
  tool: string;
  /** A ready-to-run natural-language prompt for the caller. */
  prompt: string;
  /** Human label for the affordance. */
  label: string;
}

/**
 * Stable, ordered layer keys for the five-layer framing. Used only by
 * `ExposureLayer` below, so it is not exported.
 */
type ExposureLayerKey =
  | 'data'
  | 'quality'
  | 'use_today'
  | 'gaps'
  | 'opportunities';

export interface ExposureLayer {
  key: ExposureLayerKey;
  /** Human-readable section heading. */
  title: string;
  /** One-line framing of what this layer answers. */
  summary: string;
  /** Bullet facts for the layer. */
  facts: string[];
  /** First-class resolutions (gaps / opportunities layers). */
  resolutions?: ExposureResolution[];
}

export interface WhereAreWeExposedData {
  /** The five layers, always in canonical order. */
  layers: ExposureLayer[];
  generated_at: string;
}

/**
 * Render the five-layer exposure framing as ordered Markdown. Layers always
 * appear in canonical order; gaps/opportunities resolutions render as a
 * "Suggested resolutions" sub-list so the affordance is visible to humans.
 */
export function formatWhereAreWeExposed(data: WhereAreWeExposedData): string {
  const lines: string[] = ['# Where are we exposed?', ''];

  for (const layer of data.layers) {
    lines.push(`## ${layer.title}`);
    lines.push('');
    lines.push(layer.summary);
    lines.push('');
    if (layer.facts.length > 0) {
      for (const fact of layer.facts) {
        lines.push(`- ${fact}`);
      }
      lines.push('');
    }
    if (layer.resolutions && layer.resolutions.length > 0) {
      lines.push('**Suggested resolutions:**');
      for (const res of layer.resolutions) {
        lines.push(`- ${res.label} — \`${res.tool}\`: ${res.prompt}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n').trimEnd();
}

// ---------------------------------------------------------------------------
// Active procurements list
// ---------------------------------------------------------------------------

export function formatActiveProcurements(
  bids: ActiveProcurementSummary[],
): string {
  if (bids.length === 0) {
    return '# Active Procurements\n\nNo active procurements found.';
  }

  const lines: string[] = [
    '# Active Procurements',
    '',
    `${bids.length} active procurement${bids.length === 1 ? '' : 's'}:`,
    '',
  ];

  for (const bid of bids) {
    const progress = formatProgress(
      bid.answered_questions,
      bid.total_questions,
    );
    const deadline = formatDeadline(bid.deadline, bid.days_until_deadline);

    lines.push(`## ${bid.name}`);
    lines.push(`- **Buyer:** ${bid.buyer ?? 'Not specified'}`);
    lines.push(`- **Status:** ${bid.status}`);
    lines.push(`- **Deadline:** ${deadline}`);
    lines.push(
      `- **Questions:** ${bid.answered_questions}/${bid.total_questions} answered (${progress})`,
    );
    lines.push(
      `- **Approved:** ${bid.approved_questions}/${bid.total_questions}`,
    );
    lines.push(`- **ID:** ${bid.id}`);
    lines.push('');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Freshness report
// ---------------------------------------------------------------------------

export interface FreshnessReport {
  fresh: number;
  aging: number;
  stale: number;
  expired: number;
}

// ---------------------------------------------------------------------------
// Reorientation briefing
// ---------------------------------------------------------------------------

export function formatReorientation(data: ReorientData): string {
  const greeting = data.user_display_name
    ? `Welcome back, ${data.user_display_name}.`
    : 'Welcome back.';

  const lastActive = data.last_active_relative
    ? ` You were last active ${data.last_active_relative}.`
    : '';

  const lines: string[] = [
    `# Reorientation Briefing`,
    '',
    `${greeting}${lastActive}`,
    '',
  ];

  // Urgent items
  if (data.urgent.length > 0) {
    lines.push('## Urgent Items', '');
    for (const item of data.urgent) {
      lines.push(`- **${item.title}** — ${item.detail}`);
    }
    lines.push('');
  }

  // Team changes
  if (data.team_changes.length > 0) {
    lines.push('## Team Activity', '');
    const displayed = data.team_changes.slice(0, 10);
    for (const change of displayed) {
      const who = change.user_name ?? 'A team member';
      lines.push(
        `- ${who} ${change.action} "${change.entity_title}"${change.domain ? ` (${change.domain})` : ''}`,
      );
    }
    if (data.team_changes.length > 10) {
      lines.push(`- ...and ${data.team_changes.length - 10} more changes`);
    }
    lines.push('');
  }

  // Recent work
  if (data.my_recent_work.length > 0) {
    lines.push('## Your Recent Work', '');
    for (const work of data.my_recent_work) {
      lines.push(`- ${work.action} "${work.entity_title}"`);
    }
    lines.push('');
  }

  // Procurement summary
  if (data.forms_summary.length > 0) {
    lines.push('## Procurement Summary', '');
    const displayedBids = data.forms_summary.slice(0, 10);
    for (const bid of displayedBids) {
      const progress = formatProgress(
        bid.answered_questions,
        bid.total_questions,
      );
      const deadline = formatDeadline(bid.deadline, bid.days_until_deadline);
      const urgencyLabel =
        bid.urgency !== 'normal' && bid.urgency !== 'unknown'
          ? ` [${bid.urgency.toUpperCase()}]`
          : '';
      lines.push(`### ${bid.name}${urgencyLabel}`);
      lines.push(`- **Status:** ${bid.status}`);
      lines.push(`- **Deadline:** ${deadline}`);
      lines.push(
        `- **Progress:** ${bid.answered_questions}/${bid.total_questions} answered (${progress})`,
      );
      if (bid.gap_count > 0) {
        lines.push(
          `- **Gaps:** ${bid.gap_count} question${bid.gap_count === 1 ? '' : 's'} need content`,
        );
      }
      lines.push('');
    }
    if (data.forms_summary.length > 10) {
      lines.push(
        `- ...and ${data.forms_summary.length - 10} more procurements`,
        '',
      );
    }
  }

  // Counts summary
  const counts = data.counts;
  const countItems: string[] = [];
  if (counts.unread_notifications > 0)
    countItems.push(
      `${counts.unread_notifications} unread notification${counts.unread_notifications === 1 ? '' : 's'}`,
    );
  if (counts.pending_reviews > 0)
    countItems.push(
      `${counts.pending_reviews} pending review${counts.pending_reviews === 1 ? '' : 's'}`,
    );
  if (counts.stale_or_expired > 0)
    countItems.push(
      `${counts.stale_or_expired} stale/expired item${counts.stale_or_expired === 1 ? '' : 's'}`,
    );
  if (counts.quality_flags > 0)
    countItems.push(
      `${counts.quality_flags} quality flag${counts.quality_flags === 1 ? '' : 's'}`,
    );

  if (countItems.length > 0) {
    lines.push('## At a Glance', '');
    for (const item of countItems) {
      lines.push(`- ${item}`);
    }
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Expiring content
// ---------------------------------------------------------------------------

/**
 * Urgency indicator for expiring items.
 * - OVERDUE for items past their expiry date
 * - URGENT for items expiring within 7 days
 * - SOON for items expiring within 30 days
 * - UPCOMING for items expiring further out
 */
function urgencyIndicator(daysRemaining: number): string {
  if (daysRemaining < 0) return 'OVERDUE';
  if (daysRemaining <= 7) return 'URGENT';
  if (daysRemaining <= 30) return 'SOON';
  return 'UPCOMING';
}

/**
 * Format expiring content items and entity mentions into readable markdown.
 *
 * Produces two sections:
 *   1. Expiring Content Items — KB items with approaching expiry dates
 *   2. Expiring Certifications/Registrations — entity-level expiry from
 *      entity_mentions metadata
 *
 * Each entry includes an urgency indicator and days remaining.
 */
export function formatExpiringContent(data: ExpiringContentData): string {
  const lines: string[] = [
    '# Expiring Content',
    '',
    `Looking ahead **${data.days_ahead} days** from today.`,
    '',
  ];

  // Section 1: Content items
  if (data.content_items.length > 0) {
    lines.push(`## Expiring Content Items (${data.content_items.length})`, '');
    lines.push('| Item | Domain | Expiry Date | Days Remaining | Urgency |');
    lines.push('| ---- | ------ | ----------- | -------------- | ------- |');

    for (const item of data.content_items) {
      const urgency = urgencyIndicator(item.days_remaining);
      const domain = item.domain ?? 'Unclassified';
      const dateStr = formatDateUK(item.expiry_date);
      const daysStr =
        item.days_remaining < 0
          ? `${Math.abs(item.days_remaining)} overdue`
          : `${item.days_remaining}`;
      lines.push(
        `| ${item.title} | ${domain} | ${dateStr} | ${daysStr} | ${urgency} |`,
      );
    }
    lines.push('');
  } else {
    lines.push('## Expiring Content Items', '');
    lines.push('No content items expiring within this period.', '');
  }

  // Section 2: Entity mentions (certifications/registrations)
  if (data.entity_mentions.length > 0) {
    lines.push(
      `## Expiring Certifications/Registrations (${data.entity_mentions.length})`,
      '',
    );
    lines.push('| Name | Type | Expiry Date | Days Remaining | Status |');
    lines.push('| ---- | ---- | ----------- | -------------- | ------ |');

    for (const entity of data.entity_mentions) {
      const urgency = urgencyIndicator(entity.days_remaining);
      const dateStr = formatDateUK(entity.expiry_date);
      const daysStr =
        entity.days_remaining < 0
          ? `${Math.abs(entity.days_remaining)} overdue`
          : `${entity.days_remaining}`;
      lines.push(
        `| ${formatEntityDisplayName(entity.canonical_name)} | ${entity.entity_type} | ${dateStr} | ${daysStr} | ${urgency} |`,
      );
    }
    lines.push('');
  } else {
    lines.push('## Expiring Certifications/Registrations', '');
    lines.push(
      'No certifications or registrations expiring within this period.',
      '',
    );
  }

  return lines.join('\n');
}
