'use client';

import {
  ShieldCheck,
  ShieldAlert,
  Clock,
  ShieldX,
  FileEdit,
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
  | 'draft'
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
      'text-governance-pending bg-governance-pending-bg border-governance-pending-border',
  },
  approved: {
    icon: ShieldCheck,
    label: 'Approved',
    description: 'This item has been reviewed and approved',
    className:
      'text-governance-approved bg-governance-approved-bg border-governance-approved-border',
  },
  changes_requested: {
    icon: ShieldAlert,
    label: 'Changes Requested',
    description: 'A reviewer has requested changes to this item',
    className:
      'text-governance-changes bg-governance-changes-bg border-governance-changes-border',
  },
  reverted: {
    icon: ShieldX,
    label: 'Reverted',
    description: 'This item was reverted by a reviewer',
    className:
      'text-governance-reverted bg-governance-reverted-bg border-governance-reverted-border',
  },
  draft: {
    icon: FileEdit,
    label: 'Draft',
    description: 'This item is a draft — hidden from search and matching',
    className:
      'text-governance-draft bg-governance-draft-bg border-governance-draft-border',
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
