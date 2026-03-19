import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { ClaudePromptButton } from '@/components/claude-prompt-button';

interface AttentionCardProps {
  icon: LucideIcon;
  count: number | null;
  label: string;
  href: string;
  actionLabel: string;
  /** Optional Claude prompt — when provided, shows an "Ask Claude" button */
  claudePrompt?: string;
}

export function AttentionCard({
  icon: Icon,
  count,
  label,
  href,
  actionLabel,
  claudePrompt,
}: AttentionCardProps) {
  if (count === null || count === 0) return null;

  return (
    <div className="group flex items-start gap-3 rounded-lg border border-border bg-card p-4 transition-colors hover:bg-accent/50">
      <Icon
        className="mt-0.5 size-5 shrink-0 text-status-warning"
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">
          {count} {label}
        </p>
        <div className="mt-0.5 flex items-center gap-2">
          <Link
            href={href}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            aria-label={`${count} ${label} — ${actionLabel}`}
          >
            {actionLabel}
            <ArrowRight className="size-3" />
          </Link>
          {claudePrompt && (
            <ClaudePromptButton
              prompt={claudePrompt}
              size="sm"
              className="h-auto px-1.5 py-0.5"
            />
          )}
        </div>
      </div>
    </div>
  );
}
