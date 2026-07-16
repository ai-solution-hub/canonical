'use client';

/**
 * ID-145 {145.47} (TECH §3/§4, PRODUCT §C1-C4, DR-064).
 *
 * §C fill-slot review: detected `form_instance_fields` box-overlaid
 * page-accurately on the rendered PDF (`HighlightArea` via the 147-H
 * `SpatialOverlay` over `PdfDocument`); slot-list <-> overlay linkage is
 * bidirectional (select slot -> scroll/highlight box; select box -> select
 * slot) via a shared selection id, never colour-only (icon + text label);
 * `fill_status` drives the per-slot status label (§C3); a DOCX/XLSX form (or
 * one where every field's geometry is NULL/unresolvable) degrades to a plain
 * list with a note, never a misaligned box (§C4).
 */
import * as React from 'react';
import {
  CheckCircle2,
  Clock,
  Loader2,
  SkipForward,
  XCircle,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';
import { SectionErrorState } from '@/components/source-document-detail/section-error-state';
import { PdfDocument } from '@/components/reader/pdf-document';
import {
  SpatialOverlay,
  type SpatialOverlayBox,
} from '@/components/procurement/extend/spatial-overlay';
import {
  parseGeometry,
  geometryToHighlightArea,
} from '@/lib/domains/procurement/geometry-schema';
import {
  useProcurementFormFields,
  type ProcurementFormFieldRow,
} from '@/hooks/procurement/use-procurement-form-fields';

export interface ItemFillSlotReviewProps {
  formId: string;
  className?: string;
}

const PDF_MIME_TYPE = 'application/pdf';

const FILL_STATUS_META: Record<
  string,
  { label: string; icon: React.ComponentType<{ className?: string }> }
> = {
  pending: { label: 'Not filled', icon: Clock },
  filled: { label: 'Filled', icon: CheckCircle2 },
  skipped: { label: 'Skipped', icon: SkipForward },
  failed: { label: 'Fill failed', icon: XCircle },
};

function fillStatusMeta(status: string | null) {
  return FILL_STATUS_META[status ?? 'pending'] ?? FILL_STATUS_META.pending;
}

/** Resolve a Supabase Storage signed URL for the form's own PDF. */
function useSignedFormUrl(storagePath: string | null) {
  const [signedUrl, setSignedUrl] = React.useState<string | null>(null);

  React.useEffect(() => {
    setSignedUrl(null);
    if (!storagePath) return;

    let cancelled = false;
    const supabase = createClient();
    supabase.storage
      .from('documents')
      .createSignedUrl(storagePath, 3600)
      .then(({ data }) => {
        if (!cancelled && data?.signedUrl) setSignedUrl(data.signedUrl);
      })
      .catch(() => {
        // Signed-URL failure degrades to "spatial pane stays loading" —
        // PdfDocument itself never mounts without a URL, and the slot list
        // (the primary content) is unaffected either way.
      });

    return () => {
      cancelled = true;
    };
  }, [storagePath]);

  return signedUrl;
}

export function ItemFillSlotReview({
  formId,
  className,
}: ItemFillSlotReviewProps) {
  const { data, isLoading, isError, refetch } =
    useProcurementFormFields(formId);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [currentPage, setCurrentPage] = React.useState(1);
  const signedUrl = useSignedFormUrl(data?.storage_path ?? null);

  const handleSelectSlot = React.useCallback((fieldId: string) => {
    setSelectedId(fieldId);
  }, []);

  if (isLoading) {
    return (
      <div
        data-testid="item-fill-slot-review"
        className={className ?? 'rounded-lg border p-3'}
      >
        <FillSlotReviewSkeleton />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div
        data-testid="item-fill-slot-review"
        className={className ?? 'rounded-lg border p-3'}
      >
        <SectionErrorState
          heading="Couldn't load the fill-slot review"
          message="Something went wrong while loading this form's fields. This is usually temporary."
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  const fields = data.fields;

  if (fields.length === 0) {
    return (
      <div
        data-testid="item-fill-slot-review"
        className={
          className ?? 'rounded-lg border border-dashed p-6 text-center text-sm'
        }
      >
        <p className="text-muted-foreground">
          No fill-slots detected for this form.
        </p>
      </div>
    );
  }

  const isPdf = data.mime_type === PDF_MIME_TYPE;
  const geometryByFieldId = new Map(
    fields.map((field) => [field.id, parseGeometry(field.geometry)] as const),
  );
  const hasAnyGeometry = [...geometryByFieldId.values()].some(
    (geometry) => geometry !== null,
  );
  // §C4 — PDF-only; a DOCX/XLSX form OR one where every field's geometry is
  // NULL/unresolvable degrades to the list, never a misaligned box.
  const eligibleForOverlay = isPdf && hasAnyGeometry;

  const boxes: SpatialOverlayBox[] = fields.flatMap((field) => {
    const geometry = geometryByFieldId.get(field.id);
    if (!geometry) return [];
    const meta = fillStatusMeta(field.fill_status);
    return [
      {
        id: field.id,
        page: geometry.page,
        area: geometryToHighlightArea(geometry),
        label: field.question_text
          ? `${field.question_text} — ${meta.label}`
          : meta.label,
        icon: meta.icon,
      },
    ];
  });

  return (
    <div
      data-testid="item-fill-slot-review"
      className={className ?? 'space-y-3 rounded-lg border p-3'}
    >
      <h3 className="text-sm font-medium text-foreground">Fill-slot review</h3>
      {!eligibleForOverlay && (
        <p className="text-xs text-muted-foreground">
          {isPdf
            ? 'No mapped page positions yet for this form — showing the detected slots as a list.'
            : 'Spatial review is available for PDF forms only — showing the detected slots as a list.'}
        </p>
      )}
      <div className={cn(eligibleForOverlay && 'grid gap-4 md:grid-cols-2')}>
        <FillSlotList
          fields={fields}
          selectedId={selectedId}
          interactive={eligibleForOverlay}
          hasGeometry={(fieldId) => geometryByFieldId.get(fieldId) !== null}
          onSelect={handleSelectSlot}
        />
        {eligibleForOverlay &&
          (signedUrl ? (
            <div className="relative h-[520px] overflow-hidden rounded-md border border-border">
              <PdfDocument
                sourceUrl={signedUrl}
                currentPage={currentPage}
                onPageChange={setCurrentPage}
                renderPageOverlay={(page) => (
                  <SpatialOverlay
                    boxes={boxes}
                    currentPage={page}
                    goToPage={setCurrentPage}
                    selectedId={selectedId}
                    onSelect={handleSelectSlot}
                  />
                )}
              />
            </div>
          ) : (
            <div className="flex h-[520px] items-center justify-center rounded-md border border-border bg-muted/30">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          ))}
      </div>
    </div>
  );
}

function FillSlotList({
  fields,
  selectedId,
  interactive,
  hasGeometry,
  onSelect,
}: {
  fields: ProcurementFormFieldRow[];
  selectedId: string | null;
  interactive: boolean;
  hasGeometry: (fieldId: string) => boolean;
  onSelect: (fieldId: string) => void;
}) {
  return (
    <ul className="space-y-1.5" aria-label="Detected fill-slots">
      {fields.map((field) => {
        const meta = fillStatusMeta(field.fill_status);
        const Icon = meta.icon;
        const isSelected = field.id === selectedId;
        const label = field.question_text ?? field.field_type;
        const canNavigate = interactive && hasGeometry(field.id);

        return (
          <li key={field.id}>
            {interactive ? (
              <button
                type="button"
                onClick={() => canNavigate && onSelect(field.id)}
                disabled={!canNavigate}
                aria-pressed={isSelected}
                className={cn(
                  'flex w-full items-center justify-between gap-2 rounded-md border p-2 text-left text-sm transition-colors',
                  'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:outline-none',
                  isSelected
                    ? 'border-ring bg-accent'
                    : 'border-border hover:bg-accent/50',
                  !canNavigate && 'cursor-default opacity-70',
                )}
              >
                <span className="truncate">{label}</span>
                <FillStatusBadge
                  icon={Icon}
                  label={meta.label}
                  emphasised={isSelected}
                />
              </button>
            ) : (
              <div className="flex w-full items-center justify-between gap-2 rounded-md border border-border p-2 text-sm">
                <span className="truncate">{label}</span>
                <FillStatusBadge icon={Icon} label={meta.label} />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function FillStatusBadge({
  icon: Icon,
  label,
  emphasised = false,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  emphasised?: boolean;
}) {
  return (
    <Badge
      variant={emphasised ? 'default' : 'secondary'}
      className="gap-1 whitespace-nowrap"
    >
      <Icon className="size-3" aria-hidden="true" />
      {label}
    </Badge>
  );
}

function FillSlotReviewSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading fill-slot review"
      className="space-y-2"
    >
      <span className="sr-only">Loading fill-slot review...</span>
      <div className="h-4 w-32 animate-pulse rounded bg-accent" />
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="h-8 w-full animate-pulse rounded bg-accent" />
      ))}
    </div>
  );
}
