import { cn } from '@/lib/utils';
import Link from 'next/link';
import type { ReactNode } from 'react';

export interface EmptyStateCta {
  label: string;
  href: string;
}

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description: string;
  primaryCta?: EmptyStateCta;
  secondaryCta?: EmptyStateCta;
  headingLevel?: 'h2' | 'h3';
  variant?: 'first-run' | 'filter-empty';
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  primaryCta,
  secondaryCta,
  headingLevel = 'h3',
  variant = 'first-run',
  className,
}: EmptyStateProps) {
  const Heading = headingLevel;
  const ariaProps =
    variant === 'filter-empty'
      ? { role: 'status' as const, 'aria-live': 'polite' as const }
      : {};

  return (
    <div
      {...ariaProps}
      className={cn(
        'flex flex-col items-center justify-center gap-4 py-12 text-center',
        className,
      )}
    >
      {icon ? (
        <div className="text-muted-foreground" aria-hidden="true">
          {icon}
        </div>
      ) : null}
      <div className="flex max-w-md flex-col gap-2">
        <Heading className="text-lg font-semibold text-foreground">
          {title}
        </Heading>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {(primaryCta || secondaryCta) && (
        <div className="flex flex-wrap items-center justify-center gap-2">
          {primaryCta ? (
            <Link
              href={primaryCta.href}
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {primaryCta.label}
            </Link>
          ) : null}
          {secondaryCta ? (
            <Link
              href={secondaryCta.href}
              className="inline-flex items-center justify-center rounded-md border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {secondaryCta.label}
            </Link>
          ) : null}
        </div>
      )}
    </div>
  );
}
