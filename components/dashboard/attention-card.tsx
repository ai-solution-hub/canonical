import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

interface AttentionCardProps {
  icon: LucideIcon;
  count: number | null;
  label: string;
  href: string;
  actionLabel: string;
}

export function AttentionCard({
  icon: Icon,
  count,
  label,
  href,
  actionLabel,
}: AttentionCardProps) {
  if (count === null || count === 0) return null;

  return (
    <Link
      href={href}
      className="group flex items-start gap-3 rounded-lg border border-border bg-card p-4 transition-colors hover:bg-accent/50"
      aria-label={`${count} ${label} — ${actionLabel}`}
    >
      <Icon
        className="mt-0.5 size-5 shrink-0 text-status-warning"
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">
          {count} {label}
        </p>
        <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground group-hover:text-foreground">
          {actionLabel}
          <ArrowRight className="size-3" />
        </p>
      </div>
    </Link>
  );
}
