'use client';

import {
  ShieldCheck,
  ShieldAlert,
  Clock,
  ShieldX,
} from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export type GovernanceStatus =
  | 'pending'
  | 'approved'
  | 'changes_requested'
  | 'reverted'
  | null
  | undefined;

interface GovernanceBadgeProps {
  status: GovernanceStatus | string;
  className?: string;
  /** Compact mode — icon only, with tooltip */
  compact?: boolean;
}

const STATUS_CONFIG: Record<
  string,
  {
    icon: typeof ShieldCheck;
    label: string;
    description: string;
    className: string;
  }
> = {
  pending: {
    icon: Clock,
    label: 'Review Pending',
    description: 'This item is awaiting governance review after a change',
    className:
      'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800/50',
  },
  approved: {
    icon: ShieldCheck,
    label: 'Approved',
    description: 'This item has been reviewed and approved',
    className:
      'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800/50',
  },
  changes_requested: {
    icon: ShieldAlert,
    label: 'Changes Requested',
    description: 'A reviewer has requested changes to this item',
    className:
      'text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-950/30 border-orange-200 dark:border-orange-800/50',
  },
  reverted: {
    icon: ShieldX,
    label: 'Reverted',
    description: 'This item was reverted by a reviewer',
    className:
      'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800/50',
  },
};

/**
 * Governance review status badge.
 *
 * WCAG 2.1 AA compliant: uses icon + text + colour (never colour alone).
 * Compact mode shows icon only with a tooltip for the full label.
 */
export function GovernanceBadge({
  status,
  className,
  compact = false,
}: GovernanceBadgeProps) {
  if (!status) return null;

  const config = STATUS_CONFIG[status];
  if (!config) return null;

  const Icon = config.icon;

  if (compact) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className={cn(
                'inline-flex items-center rounded border px-1 py-0.5',
                config.className,
                className,
              )}
              aria-label={config.label}
            >
              <Icon className="size-3" />
            </span>
          </TooltipTrigger>
          <TooltipContent side="top">
            <p className="text-xs font-medium">{config.label}</p>
            <p className="text-xs text-muted-foreground">
              {config.description}
            </p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded border px-2 py-1 text-xs font-medium',
        config.className,
        className,
      )}
    >
      <Icon className="size-3.5" />
      {config.label}
    </span>
  );
}
