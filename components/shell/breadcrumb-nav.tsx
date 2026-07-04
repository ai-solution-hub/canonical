'use client';

interface BreadcrumbNavProps {
  domain?: string | null;
  title: string;
  maxTitleLength?: number;
  className?: string;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + '\u2026';
}

export function BreadcrumbNav({
  domain,
  title,
  maxTitleLength = 40,
  className,
}: BreadcrumbNavProps) {
  const displayTitle = title || 'Untitled item';

  return (
    <nav aria-label="Breadcrumb" className={className}>
      <ol className="flex items-center gap-1 text-xs text-muted-foreground">
        {domain && (
          <>
            <li>{domain}</li>
            <li aria-hidden="true">&rsaquo;</li>
          </>
        )}
        <li className="truncate text-foreground" aria-current="page">
          {truncate(displayTitle, maxTitleLength)}
        </li>
      </ol>
    </nav>
  );
}
