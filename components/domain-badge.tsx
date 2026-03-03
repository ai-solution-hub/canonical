import { getDomainColourKey } from '@/lib/taxonomy';

interface DomainBadgeProps {
  domain: string;
  className?: string;
}

export function DomainBadge({ domain, className = '' }: DomainBadgeProps) {
  const colourKey = getDomainColourKey(domain);

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${className}`}
      style={{
        backgroundColor: `var(--domain-${colourKey}-bg)`,
        color: `var(--domain-${colourKey}-text)`,
      }}
    >
      {domain}
    </span>
  );
}
