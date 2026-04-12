'use client';

import Image from 'next/image';
import { BRANDING } from '@/lib/client-config';

interface BrandLogoProps {
  /** Alternative size variants — 'full' for header, 'compact' for drawers. */
  variant?: 'full' | 'compact';
  /** CSS class overrides for edge cases (should be rare). */
  className?: string;
}

export function BrandLogo({ variant = 'full', className }: BrandLogoProps) {
  const maxWidth = variant === 'compact' ? 32 : BRANDING.logoMaxWidthPx;
  // Use the configured aspect ratio so the rendered height matches the
  // real logo proportions for non-3:1 logos.
  const height = Math.round(maxWidth / BRANDING.logoAspectRatio);

  return (
    <span
      className={className ?? 'inline-flex items-center gap-2'}
      aria-label={BRANDING.logoAlt}
    >
      {/* Light-mode logo — Next.js Image handles caching internally,
          no query-string cache-buster needed (unlike favicon <link> tags). */}
      <Image
        src={BRANDING.logoUrl}
        alt={BRANDING.logoAlt}
        width={maxWidth}
        height={height}
        className="block dark:hidden"
        priority
      />
      {/* Dark-mode logo — falls back to light if not supplied */}
      <Image
        src={BRANDING.logoUrlDark ?? BRANDING.logoUrl}
        alt={BRANDING.logoAlt}
        width={maxWidth}
        height={height}
        className="hidden dark:block"
        priority
      />
      {variant === 'full' && (
        <span className="sr-only">{BRANDING.productName}</span>
      )}
    </span>
  );
}
