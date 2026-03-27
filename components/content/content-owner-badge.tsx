'use client';

import { User } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ContentOwnerBadgeProps {
  ownerName: string | null;
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * Badge displaying the content owner's name.
 *
 * - sm: compact inline — renders nothing when no owner
 * - md: shows "Unassigned" when no owner
 */
export function ContentOwnerBadge({
  ownerName,
  size = 'sm',
  className,
}: ContentOwnerBadgeProps) {
  if (!ownerName && size === 'sm') return null;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-muted-foreground',
        size === 'sm' ? 'text-xs' : 'text-sm',
        className,
      )}
    >
      <User
        className={cn(size === 'sm' ? 'size-3' : 'size-3.5')}
        aria-hidden="true"
      />
      <span>{ownerName ?? 'Unassigned'}</span>
    </span>
  );
}
