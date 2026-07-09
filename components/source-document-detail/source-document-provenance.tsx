import { Calendar, ExternalLink, FileText, FileType, Tags } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { formatDateUK } from '@/lib/format';
import type { Tables } from '@/supabase/types/database.types';

/**
 * SourceDocumentProvenance — id-111 B-28 field set (filenames, mime_type,
 * plain-language extraction_method, source_url, landed date) PLUS the
 * {131.9} classification family as plain metadata (TECH.md §3 BI-24).
 *
 * BI-3 (AI-invisible): `classification_confidence` / `classification_reasoning`
 * are deliberately NEVER rendered here — no "AI classified" / confidence
 * chrome, per `ai-visibility-policy.md`.
 *
 * Props-driven — the caller (the {135.18} page's server read) passes the
 * full `source_documents` row. No data fetching, no sibling dependency.
 * Any null/absent field is either omitted or shown as a neutral
 * "Not recorded" — never an error.
 */

const NOT_RECORDED = 'Not recorded';

/**
 * Map `source_documents.extraction_method` to a plain-language line.
 * The column is a CHECK-constrained text with producer-prefixed values
 * (`docling*`, `trafilatura*`); surface the producer in plain language,
 * never the raw enum value.
 *
 * Duplicated (not imported) from the file-private `extractionMethodLabel()`
 * at `app/reference/[id]/reference-detail-client.tsx` (id-111 B-28) — that
 * symbol is not exported, so this local copy is the correct pattern per the
 * ID-135.14 dispatch brief rather than reaching into a private module.
 */
function extractionMethodLabel(method: string | null): string | null {
  if (!method) return null;
  const lower = method.toLowerCase();
  if (lower.startsWith('docling')) return 'Extracted via Docling';
  if (lower.startsWith('trafilatura')) return 'Extracted via Trafilatura';
  return 'Extracted from a source document';
}

export interface SourceDocumentProvenanceProps {
  sourceDocument: Tables<'source_documents'>;
}

export function SourceDocumentProvenance({
  sourceDocument,
}: SourceDocumentProvenanceProps) {
  const documentName =
    sourceDocument.original_filename || sourceDocument.filename || null;
  const extractionLabel = extractionMethodLabel(
    sourceDocument.extraction_method,
  );
  const landedLabel = formatDateUK(sourceDocument.created_at);
  const keywords = sourceDocument.ai_keywords ?? [];

  const hasClassification = Boolean(
    sourceDocument.primary_domain ||
    sourceDocument.primary_subtopic ||
    sourceDocument.secondary_domain ||
    sourceDocument.secondary_subtopic ||
    sourceDocument.summary ||
    keywords.length > 0,
  );

  return (
    <section
      aria-label="Document provenance"
      className="space-y-4 rounded-lg border border-border bg-card p-4"
    >
      <div>
        <h2 className="mb-3 text-sm font-medium text-foreground">Provenance</h2>
        <ul className="space-y-2 text-sm text-muted-foreground">
          <li className="flex items-start gap-2">
            <FileText className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>{documentName ?? NOT_RECORDED}</span>
          </li>
          {sourceDocument.mime_type && (
            <li className="flex items-start gap-2">
              <FileType className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>{sourceDocument.mime_type}</span>
            </li>
          )}
          {extractionLabel && (
            <li className="flex items-start gap-2">
              <FileText className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>{extractionLabel}</span>
            </li>
          )}
          {sourceDocument.source_url && (
            <li className="flex items-start gap-2">
              <ExternalLink
                className="mt-0.5 size-4 shrink-0"
                aria-hidden="true"
              />
              <a
                href={sourceDocument.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline underline-offset-2 hover:text-primary/80"
              >
                View source
              </a>
            </li>
          )}
          {landedLabel && (
            <li className="flex items-start gap-2">
              <Calendar className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>Added {landedLabel}</span>
            </li>
          )}
        </ul>
      </div>

      {hasClassification && (
        <div className="border-t border-border pt-4">
          <h3 className="mb-3 text-sm font-medium text-foreground">
            Classification
          </h3>
          <div className="space-y-2 text-sm">
            {(sourceDocument.primary_domain ||
              sourceDocument.primary_subtopic) && (
              <div className="flex items-start gap-2">
                <Tags
                  className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                <div className="flex flex-wrap gap-1.5">
                  {sourceDocument.primary_domain && (
                    <Badge variant="secondary">
                      {sourceDocument.primary_domain}
                    </Badge>
                  )}
                  {sourceDocument.primary_subtopic && (
                    <Badge variant="outline">
                      {sourceDocument.primary_subtopic}
                    </Badge>
                  )}
                </div>
              </div>
            )}
            {(sourceDocument.secondary_domain ||
              sourceDocument.secondary_subtopic) && (
              <div className="flex items-start gap-2">
                <Tags
                  className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                <div className="flex flex-wrap gap-1.5">
                  {sourceDocument.secondary_domain && (
                    <Badge variant="outline">
                      {sourceDocument.secondary_domain}
                    </Badge>
                  )}
                  {sourceDocument.secondary_subtopic && (
                    <Badge variant="outline">
                      {sourceDocument.secondary_subtopic}
                    </Badge>
                  )}
                </div>
              </div>
            )}
            {sourceDocument.summary && (
              <p className="text-muted-foreground">{sourceDocument.summary}</p>
            )}
            {keywords.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {keywords.map((keyword) => (
                  <Badge
                    key={keyword}
                    variant="outline"
                    className="text-[10px]"
                  >
                    {keyword}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
