import Link from 'next/link';
import { CheckCircle2, GitCompare, Calendar, FileText } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { formatDateUK } from '@/lib/format';
import type { DocumentVersionRow } from '@/hooks/source-document-detail/use-source-document-detail';

/**
 * DocumentVersionList — id-135 {135.15}, TECH.md §3 BI-25/BI-26, RD-4.
 *
 * A THIN presentational map of `get_document_version_chain` rows (the
 * shipped id-117 RPC, reused as-is via `useDocumentVersions` {135.13}).
 * Props-driven — the caller (the {135.18} page wiring) supplies the
 * `versions` array; this component does no data fetching of its own.
 *
 * HARD RULE (id-135 reuse-revisit, S430): no net-new version/diff component,
 * no `UnifiedDiffContainer` composed inline — each non-current row links out
 * to the shipped `/documents/[id]/diff` surface (BI-26, RD-4) rather than
 * embedding a pairwise diff. The SD version chain is structurally distinct
 * from the content_history-coupled `VersionHistory`, so that component is
 * not reused here.
 *
 * "Current" = the highest `version` number in the chain (the tip). A
 * single-row chain renders a single, current-marked entry — never an
 * empty/error state (RD-4).
 */

export interface DocumentVersionListProps {
  versions: DocumentVersionRow[];
}

export function DocumentVersionList({ versions }: DocumentVersionListProps) {
  if (versions.length === 0) {
    return (
      <section
        aria-label="Version history"
        className="text-sm text-muted-foreground"
      >
        No version history available.
      </section>
    );
  }

  const ordered = [...versions].sort((a, b) => a.version - b.version);
  const currentVersion = ordered[ordered.length - 1].version;

  return (
    <section aria-label="Version history" className="space-y-3">
      <h2 className="text-sm font-medium text-foreground">Version history</h2>
      <ul className="space-y-2">
        {ordered.map((row) => {
          const isCurrent = row.version === currentVersion;
          const landedLabel = formatDateUK(row.created_at);

          return (
            <li
              key={row.id}
              className="flex items-start justify-between gap-3 rounded-lg border border-border bg-card p-3 text-sm"
            >
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <FileText
                    className="size-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <span className="font-medium text-foreground">
                    Version {row.version}
                  </span>
                  <span className="truncate text-muted-foreground">
                    {row.filename}
                  </span>
                  {isCurrent && (
                    <Badge variant="secondary" className="gap-1">
                      <CheckCircle2 className="size-3" aria-hidden="true" />
                      Current
                    </Badge>
                  )}
                </div>
                {landedLabel && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Calendar
                      className="size-3.5 shrink-0"
                      aria-hidden="true"
                    />
                    <span>Landed {landedLabel}</span>
                  </div>
                )}
              </div>

              {!isCurrent && (
                <Link
                  href={`/documents/${row.id}/diff`}
                  className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-primary underline underline-offset-2 hover:text-primary/80"
                >
                  <GitCompare className="size-4" aria-hidden="true" />
                  Compare
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
