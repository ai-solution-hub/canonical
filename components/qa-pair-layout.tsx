'use client';

import { VerificationBadge } from '@/components/verification-badge';

interface QaPairLayoutProps {
  question: string;
  itemId: string;
  contentTabs: React.ReactNode;
  sourceDocument?: string | null;
  verified?: boolean;
  canEdit?: boolean;
  onEditQuestion?: () => void;
}

export function QaPairLayout({
  question,
  contentTabs,
  sourceDocument,
  verified,
}: QaPairLayoutProps) {
  return (
    <div className="flex flex-col gap-4">
      {/* Question card */}
      <div className="rounded-lg bg-muted/30 p-4 sm:p-5">
        <div className="flex items-start gap-3">
          {/* Q badge */}
          <span
            className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground"
            aria-hidden="true"
          >
            Q
          </span>

          <div className="min-w-0 flex-1">
            {/* Question text */}
            <p className="text-lg font-medium leading-relaxed text-foreground">
              {question}
            </p>

            {/* Source document attribution + verification */}
            <div className="mt-2 flex flex-wrap items-center gap-3">
              {sourceDocument && (
                <span className="text-xs text-muted-foreground">
                  Source:{' '}
                  <span className="font-medium text-foreground/80">
                    {sourceDocument}
                  </span>
                </span>
              )}
              {verified !== undefined && (
                <VerificationBadge verified={verified} size="sm" />
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Answer content via tabs (rendered by parent) */}
      {contentTabs}
    </div>
  );
}
