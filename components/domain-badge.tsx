'use client';

import { useTaxonomy } from '@/contexts/taxonomy-context';

interface DomainBadgeProps {
  domain: string;
  className?: string;
}

export function DomainBadge({ domain, className = '' }: DomainBadgeProps) {
  const { getDomainColourKey, formatDomainName } = useTaxonomy();
  const colourKey = getDomainColourKey(domain);

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${className}`}
      style={{
        backgroundColor: `var(--domain-${colourKey}-bg)`,
        color: `var(--domain-${colourKey}-text)`,
      }}
    >
      {formatDomainName(domain)}
    </span>
  );
}
