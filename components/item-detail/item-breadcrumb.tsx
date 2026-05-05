'use client';

import Link from 'next/link';
import { BreadcrumbNav } from '@/components/shell/breadcrumb-nav';

/** @public */
export interface ItemBreadcrumbProps {
  isQAPair: boolean;
  primaryDomain: string | null;
  title: string;
}

/**
 * Breadcrumb navigation for item detail page.
 * Q&A pairs show a custom breadcrumb linking to the Q&A Library;
 * other content types use the standard BreadcrumbNav component.
 */
export function ItemBreadcrumb({
  isQAPair,
  primaryDomain,
  title,
}: ItemBreadcrumbProps) {
  if (isQAPair) {
    return (
      <nav aria-label="Breadcrumb" className="mb-4">
        <ol className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <li>
            <Link
              href="/library"
              className="hover:text-foreground transition-colors"
            >
              Q&A Library
            </Link>
          </li>
          {primaryDomain && (
            <>
              <li aria-hidden="true">/</li>
              <li>{primaryDomain}</li>
            </>
          )}
        </ol>
      </nav>
    );
  }

  return (
    <BreadcrumbNav domain={primaryDomain} title={title} className="mb-4" />
  );
}
