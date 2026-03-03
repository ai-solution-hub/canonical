import Link from 'next/link';
import { getDomainColourKey, formatSubtopic } from '@/lib/taxonomy';

interface DomainCardProps {
  domain: string;
  count: number;
  topSubtopics?: { subtopic: string; count: number }[];
  unreadCount?: number;
}

export function DomainCard({
  domain,
  count,
  topSubtopics,
  unreadCount,
}: DomainCardProps) {
  const colourKey = getDomainColourKey(domain);

  return (
    <Link
      href={`/browse?domain=${encodeURIComponent(domain)}`}
      className="group flex flex-col gap-3 rounded-lg border border-border p-4 transition-[border-color,transform] duration-150 hover:border-primary/30 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      style={{ backgroundColor: `var(--domain-${colourKey}-surface)` }}
    >
      <div>
        <h3
          className="text-sm font-semibold"
          style={{ color: `var(--domain-${colourKey}-text)` }}
        >
          {domain}
        </h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {count} {count === 1 ? 'item' : 'items'}
          {unreadCount != null && unreadCount > 0 && (
            <span className="ml-1.5 inline-flex items-center justify-center rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold leading-none text-primary-foreground tabular-nums">
              {unreadCount > 99 ? '99+' : unreadCount} unread
            </span>
          )}
        </p>
      </div>
      {topSubtopics && topSubtopics.length > 0 && (
        <ul className="flex flex-col gap-0.5">
          {topSubtopics.slice(0, 3).map((s) => (
            <li key={s.subtopic} className="text-xs text-muted-foreground">
              {formatSubtopic(s.subtopic)}{' '}
              <span className="opacity-60">({s.count})</span>
            </li>
          ))}
        </ul>
      )}
    </Link>
  );
}
