'use client';

import { AlertTriangle, Info, GitCompareArrows } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReuploadBannerProps {
  /** Whether this is an identical re-upload or a new version */
  matchType: 'identical' | 'new_version';
  /** The version number of the previously uploaded document */
  previousVersion: number;
  /** The ID of the previous source document */
  previousDocumentId: string;
  /** Whether a Q&A pair diff was computed for this re-upload */
  diffAvailable?: boolean;
  /** The new document ID to link to the diff review page */
  diffDocumentId?: string;
  /** Additional CSS class names */
  className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Banner displayed during file upload when a re-upload is detected.
 *
 * - `identical`: amber warning that the file has already been uploaded
 *   with identical content.
 * - `new_version`: blue/info banner that a new version will be created.
 *
 * Uses semantic colour tokens only; never raw Tailwind colours.
 * WCAG 2.1 AA compliant: uses icons alongside colour for meaning.
 */
export function ReuploadBanner({
  matchType,
  previousVersion,
  previousDocumentId,
  diffAvailable,
  diffDocumentId,
  className,
}: ReuploadBannerProps) {
  const isIdentical = matchType === 'identical';

  return (
    <div
      role="alert"
      aria-live="polite"
      data-previous-document-id={previousDocumentId}
      className={cn(
        'flex items-start gap-3 rounded-lg border p-4',
        isIdentical
          ? 'border-freshness-aging/30 bg-freshness-aging-bg'
          : 'border-primary/20 bg-primary/5',
        className,
      )}
    >
      {/* Icon provides non-colour meaning indicator (WCAG) */}
      {isIdentical ? (
        <AlertTriangle
          className="mt-0.5 size-5 shrink-0 text-freshness-aging"
          aria-hidden="true"
        />
      ) : (
        <Info
          className="mt-0.5 size-5 shrink-0 text-primary"
          aria-hidden="true"
        />
      )}

      <div className="min-w-0 flex-1">
        <p
          className={cn(
            'text-sm font-medium',
            isIdentical ? 'text-freshness-aging' : 'text-primary',
          )}
        >
          {isIdentical
            ? 'Duplicate file detected'
            : 'Updated document detected'}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {isIdentical
            ? `This file has already been uploaded (identical content). Version ${previousVersion} was uploaded previously.`
            : `This appears to be an update to a previously uploaded document. Creating version ${previousVersion + 1}.`}
        </p>
        {diffAvailable && diffDocumentId && (
          <Link
            href={`/documents/${diffDocumentId}/diff`}
            className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
            target="_blank"
          >
            <GitCompareArrows className="size-3.5" aria-hidden="true" />
            Review Q&amp;A changes
          </Link>
        )}
      </div>
    </div>
  );
}
