import { Calendar, FileText, FileType } from 'lucide-react';
import { formatDateUK } from '@/lib/format';
import type { Tables } from '@/supabase/types/database.types';

/**
 * SourceDocumentProvenance — id-111 B-28 field set (filenames, mime_type,
 * plain-language extraction_method, landed date).
 *
 * id-417 / DR-130 + owner ruling: the Classification block (domain/subtopic
 * badges, summary, ai_keywords) and the source_url link retired with their
 * columns — URL identity belongs to reference_items (DR-124) and the
 * classification stage is gone.
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
          {landedLabel && (
            <li className="flex items-start gap-2">
              <Calendar className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>Added {landedLabel}</span>
            </li>
          )}
        </ul>
      </div>
    </section>
  );
}
