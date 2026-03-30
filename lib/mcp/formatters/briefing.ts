/**
 * Quality briefing formatter for the kb://quality-briefing MCP resource.
 *
 * Produces a structured Markdown briefing aggregating quality intelligence
 * from 6 data sources: below-threshold items, score drops, freshness
 * transitions, outstanding quality flags, coverage alerts, and
 * certification warnings.
 */
import { formatDateUK } from '@/lib/format';
import { formatEntityDisplayName } from '@/lib/entities/entity-dedup';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BelowThresholdItem {
  id: string;
  title: string | null;
  suggested_title: string | null;
  primary_domain: string | null;
  primary_subtopic: string | null;
  quality_score: number;
  freshness: string | null;
  ai_summary: string | null;
  classification_confidence: number | null;
}

export interface ScoreDropItem {
  id: string;
  title: string | null;
  suggested_title: string | null;
  primary_domain: string | null;
  quality_score: number;
  previous_quality_score: number;
}

export interface FreshnessTransitionItem {
  id: string;
  title: string | null;
  suggested_title: string | null;
  primary_domain: string | null;
  freshness: string | null;
  previous_freshness: string | null;
}

export interface QualityFlagNotification {
  id: string;
  type: string;
  message: string | null;
  created_at: string;
  entity_id: string | null;
}

export interface CoverageAlertNotification {
  id: string;
  type: string;
  message: string | null;
  created_at: string;
}

export interface CertificationWarning {
  canonical_name: string;
  entity_type: string;
  expiry_date: string;
  status: string; // 'expiring_soon' | 'expired'
}

export interface QualityBriefingData {
  below_threshold: BelowThresholdItem[];
  score_drops: ScoreDropItem[];
  freshness_transitions: FreshnessTransitionItem[];
  quality_flags: QualityFlagNotification[];
  coverage_alerts: CoverageAlertNotification[];
  certification_warnings: CertificationWarning[];
  generated_at: string; // ISO 8601
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function itemTitle(item: { title: string | null; suggested_title: string | null }): string {
  return item.suggested_title || item.title || 'Untitled';
}

function describeDeficiencies(item: BelowThresholdItem): string {
  const issues: string[] = [];
  if (item.freshness === 'stale' || item.freshness === 'expired') {
    issues.push(`freshness ${item.freshness}`);
  }
  if (!item.ai_summary) {
    issues.push('no summary');
  }
  if (item.classification_confidence !== null && item.classification_confidence < 0.6) {
    issues.push(`low confidence (${Math.round(item.classification_confidence * 100)}%)`);
  }
  return issues.length > 0 ? issues.join(', ') : 'composite score low';
}

// ---------------------------------------------------------------------------
// Formatter
// ---------------------------------------------------------------------------

export function formatQualityBriefing(data: QualityBriefingData): string {
  const lines: string[] = [
    '# Quality Briefing',
    '',
    `**Generated:** ${formatDateUK(data.generated_at)}`,
    '',
  ];

  // Section 1: Below threshold
  lines.push(`## Items Below Quality Threshold`);
  lines.push(`**Count:** ${data.below_threshold.length}`);
  lines.push('');

  if (data.below_threshold.length === 0) {
    lines.push('No items currently below the quality threshold.');
    lines.push('');
  } else {
    for (let i = 0; i < data.below_threshold.length; i++) {
      const item = data.below_threshold[i];
      const title = itemTitle(item);
      const domain = item.primary_domain
        ? (item.primary_subtopic ? `${item.primary_domain} > ${item.primary_subtopic}` : item.primary_domain)
        : 'Unclassified';
      const issues = describeDeficiencies(item);
      lines.push(`### ${i + 1}. "${title}" (Score: ${item.quality_score})`);
      lines.push(`**Domain:** ${domain} | **Issues:** ${issues}`);
      lines.push(`**ID:** ${item.id}`);
      lines.push('');
    }
  }

  // Section 2: Score drops
  lines.push(`## Quality Score Drops`);
  lines.push(`**Count:** ${data.score_drops.length} item${data.score_drops.length === 1 ? '' : 's'} dropped since last check`);
  lines.push('');

  if (data.score_drops.length === 0) {
    lines.push('No quality score drops detected.');
    lines.push('');
  } else {
    for (const item of data.score_drops) {
      const title = itemTitle(item);
      const delta = item.previous_quality_score - item.quality_score;
      lines.push(`- **"${title}"** — ${item.previous_quality_score} -> ${item.quality_score} (dropped ${delta} points)`);
    }
    lines.push('');
  }

  // Section 3: Freshness transitions
  lines.push(`## Freshness Transitions`);
  lines.push(`**${data.freshness_transitions.length} item${data.freshness_transitions.length === 1 ? '' : 's'}** changed freshness state`);
  lines.push('');

  if (data.freshness_transitions.length === 0) {
    lines.push('No freshness transitions detected.');
    lines.push('');
  } else {
    for (const item of data.freshness_transitions) {
      const title = itemTitle(item);
      lines.push(`- **"${title}"** — ${item.previous_freshness} -> ${item.freshness}`);
    }
    lines.push('');
  }

  // Section 4: Outstanding quality flags
  lines.push(`## Outstanding Quality Flags`);
  lines.push(`**${data.quality_flags.length} flag${data.quality_flags.length === 1 ? '' : 's'}** awaiting resolution`);
  lines.push('');

  if (data.quality_flags.length === 0) {
    lines.push('No outstanding quality flags.');
    lines.push('');
  } else {
    for (const flag of data.quality_flags) {
      const date = formatDateUK(flag.created_at);
      const msg = flag.message || 'Quality flag raised';
      lines.push(`- ${msg} (${date})`);
    }
    lines.push('');
  }

  // Section 5: Coverage alerts
  lines.push(`## Coverage Alerts`);
  lines.push(`**${data.coverage_alerts.length} alert${data.coverage_alerts.length === 1 ? '' : 's'}** active`);
  lines.push('');

  if (data.coverage_alerts.length === 0) {
    lines.push('No active coverage alerts.');
    lines.push('');
  } else {
    for (const alert of data.coverage_alerts) {
      const date = formatDateUK(alert.created_at);
      const msg = alert.message || 'Coverage alert';
      lines.push(`- ${msg} (${date})`);
    }
    lines.push('');
  }

  // Section 6: Certification warnings
  lines.push(`## Certification Warnings`);
  lines.push(`**${data.certification_warnings.length} certification${data.certification_warnings.length === 1 ? '' : 's'}** expiring or expired`);
  lines.push('');

  if (data.certification_warnings.length === 0) {
    lines.push('No certification warnings.');
  } else {
    for (const cert of data.certification_warnings) {
      const expiryDate = formatDateUK(cert.expiry_date);
      const statusLabel = cert.status === 'expired' ? 'EXPIRED' : 'EXPIRING SOON';
      lines.push(`- **${formatEntityDisplayName(cert.canonical_name)}** (${cert.entity_type}) — ${statusLabel}, expires ${expiryDate}`);
    }
  }

  return lines.join('\n');
}
