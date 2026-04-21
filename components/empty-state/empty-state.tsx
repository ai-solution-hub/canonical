import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import type { ReactNode } from 'react';

export interface EmptyStateCta {
  label: string;
  /** Navigation target. If provided, CTA renders as a link. */
  href?: string;
  /** Action handler. If provided (without href), CTA renders as a button. */
  onClick?: () => void;
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

/**
 * Render a CTA as either a link or button depending on props.
 * href takes precedence when both href and onClick are provided.
 */
function CtaButton({
  cta,
  variant,
}: {
  cta: EmptyStateCta;
  variant: 'outline' | 'ghost';
}) {
  if (cta.href) {
    return (
      <Button variant={variant} size="sm" asChild>
        <Link href={cta.href}>{cta.label}</Link>
      </Button>
    );
  }

  return (
    <Button variant={variant} size="sm" onClick={cta.onClick}>
      {cta.label}
    </Button>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  primaryCta,
  secondaryCta,
  headingLevel = 'h2',
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
        'flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-border py-12 text-center',
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
            <CtaButton cta={primaryCta} variant="outline" />
          ) : null}
          {secondaryCta ? (
            <CtaButton cta={secondaryCta} variant="ghost" />
          ) : null}
        </div>
      )}
    </div>
  );
}
