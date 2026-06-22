'use client';

import Link from 'next/link';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Eye,
  Flag,
  Info,
  Shield,
  ShieldAlert,
  FileText,
  Bell,
  LayoutGrid,
  FileQuestion,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { AttentionItem } from '@/lib/attention';
import { ClaudePromptButton } from '@/components/content/claude-prompt-button';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UnifiedAttentionSectionProps {
  items: AttentionItem[];
  userRole: string;
}

// ---------------------------------------------------------------------------
// Severity tier configuration
// ---------------------------------------------------------------------------

interface TierConfig {
  label: string;
  borderClass: string;
  bgClass: string;
  iconColourClass: string;
  headerColourClass: string;
}

const TIER_CONFIG: Record<AttentionItem['severity'], TierConfig> = {
  critical: {
    label: 'Critical',
    borderClass: 'border-l-status-error',
    bgClass: 'bg-muted/30',
    iconColourClass: 'text-status-error',
    headerColourClass: 'text-status-error',
  },
  high: {
    label: 'High Priority',
    borderClass: 'border-l-status-warning',
    bgClass: 'bg-muted/30',
    iconColourClass: 'text-status-warning',
    headerColourClass: 'text-status-warning',
  },
  medium: {
    label: 'Medium',
    borderClass: 'border-l-border',
    bgClass: 'bg-card',
    iconColourClass: 'text-muted-foreground',
    headerColourClass: 'text-muted-foreground',
  },
  info: {
    label: 'Informational',
    borderClass: 'border-l-border',
    bgClass: 'bg-card',
    iconColourClass: 'text-muted-foreground',
    headerColourClass: 'text-muted-foreground',
  },
};

// ---------------------------------------------------------------------------
// Icon mapping by attention type
// ---------------------------------------------------------------------------

const TYPE_ICONS: Record<AttentionItem['type'], LucideIcon> = {
  governance_review: ShieldAlert,
  stale_content: Clock,
  expired_content: AlertTriangle,
  quality_flag: Flag,
  unverified_content: Eye,
  bid_deadline: Clock,
  expiring_certification: Shield,
  expiring_content_date: Clock,
  source_document_change: FileText,
  coverage_gap: LayoutGrid,
  taxonomy_coverage: FileQuestion,
  unread_notifications: Bell,
};

// ---------------------------------------------------------------------------
// Severity grouping helper
// ---------------------------------------------------------------------------

const SEVERITY_ORDER: AttentionItem['severity'][] = [
  'critical',
  'high',
  'medium',
  'info',
];

function groupBySeverity(
  items: AttentionItem[],
): { severity: AttentionItem['severity']; items: AttentionItem[] }[] {
  const groups: {
    severity: AttentionItem['severity'];
    items: AttentionItem[];
  }[] = [];

  for (const severity of SEVERITY_ORDER) {
    const tierItems = items.filter((item) => item.severity === severity);
    if (tierItems.length > 0) {
      groups.push({ severity, items: tierItems });
    }
  }

  return groups;
}

// ---------------------------------------------------------------------------
// Role filtering
// ---------------------------------------------------------------------------

function filterByRole(items: AttentionItem[], role: string): AttentionItem[] {
  return items.filter((item) =>
    item.role_visibility.includes(role as 'admin' | 'editor' | 'viewer'),
  );
}

// ---------------------------------------------------------------------------
// Attention item card
// ---------------------------------------------------------------------------

function AttentionItemCard({
  item,
  tierConfig,
}: {
  item: AttentionItem;
  tierConfig: TierConfig;
}) {
  const Icon = TYPE_ICONS[item.type] ?? Info;

  return (
    <div
      className={`group flex items-start gap-3 rounded-lg border border-border ${tierConfig.borderClass} border-l-2 ${tierConfig.bgClass} p-4 transition-colors hover:bg-accent/50`}
    >
      <Icon
        className={`mt-0.5 size-5 shrink-0 ${tierConfig.iconColourClass}`}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{item.title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
          {item.detail}
        </p>
        <div className="mt-1.5 flex items-center gap-2">
          <Link
            href={item.action_url}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 rounded-sm"
            aria-label={
              item.count != null
                ? `${item.action_label} (${item.count} item${item.count === 1 ? '' : 's'}) — ${item.title}`
                : `${item.action_label} — ${item.title}`
            }
          >
            {item.action_label}
            <ArrowRight className="size-3" />
          </Link>
          {item.claude_prompt && (
            <ClaudePromptButton
              prompt={item.claude_prompt}
              label="Review with Claude"
              size="sm"
              className="h-auto px-1.5 py-0.5"
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Prompt strip
// ---------------------------------------------------------------------------

function AttentionPromptStrip({ items }: { items: AttentionItem[] }) {
  if (items.length === 0) return null;

  // Build severity breakdown
  const counts = { critical: 0, high: 0, medium: 0, info: 0 };
  for (const item of items) {
    counts[item.severity]++;
  }

  const parts: string[] = [];
  if (counts.critical > 0) parts.push(`${counts.critical} critical`);
  if (counts.high > 0) parts.push(`${counts.high} high priority`);
  if (counts.medium > 0) parts.push(`${counts.medium} medium`);
  if (counts.info > 0) parts.push(`${counts.info} informational`);

  const summaryText = `${parts.join(', ')} ${items.length === 1 ? 'item needs' : 'items need'} attention`;

  // Build composite prompt from all items' claude_prompts
  const itemPrompts = items
    .filter((item) => item.claude_prompt)
    .map((item) => `- ${item.title}: ${item.claude_prompt}`)
    .join('\n');

  const compositePrompt = `I have ${items.length} attention items on my dashboard:\n\n${itemPrompts}\n\nHelp me prioritise these and create an action plan.`;

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 px-4 py-2">
      <p className="text-xs text-muted-foreground">{summaryText}</p>
      <ClaudePromptButton
        prompt={compositePrompt}
        label="Plan with Claude"
        size="sm"
        className="h-auto shrink-0 px-1.5 py-0.5"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function UnifiedAttentionSection({
  items,
  userRole,
}: UnifiedAttentionSectionProps) {
  const roleItems = filterByRole(items, userRole);
  const groups = groupBySeverity(roleItems);

  return (
    <section
      aria-label="Items needing attention"
      className="rounded-lg border bg-card p-4 shadow-sm"
    >
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        Needs Attention
        {roleItems.length > 0 && ` (${roleItems.length})`}
      </h2>

      {roleItems.length === 0 ? (
        <div className="rounded-lg border bg-card p-6 text-center">
          <CheckCircle2
            className="mx-auto mb-2 size-8 text-quality-good"
            aria-hidden="true"
          />
          <p className="text-sm font-medium text-foreground">
            All clear — your knowledge base is in good shape.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            All content is verified, governance reviews are complete, and no
            bids have imminent deadlines.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((group) => {
            const config = TIER_CONFIG[group.severity];
            return (
              <div key={group.severity}>
                <h3
                  className={`mb-2 text-xs font-medium uppercase tracking-wider ${config.headerColourClass}`}
                >
                  {config.label} ({group.items.length})
                </h3>
                <div className="space-y-2">
                  {group.items.map((item) => (
                    <AttentionItemCard
                      key={item.id}
                      item={item}
                      tierConfig={config}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Prompt strip — only when items exist */}
      {roleItems.length > 0 && (
        <div className="mt-4">
          <AttentionPromptStrip items={roleItems} />
        </div>
      )}
    </section>
  );
}
