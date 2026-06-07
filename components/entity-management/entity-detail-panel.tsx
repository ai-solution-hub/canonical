'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import {
  Loader2,
  Network,
  ExternalLink,
  AlertTriangle,
  FileText,
  ArrowRight,
  Save,
  CheckCircle2,
} from 'lucide-react';
import { useEntityDetail } from '@/hooks/use-entity-detail';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { formatContentType } from '@/lib/format';
import { formatEntityDisplayName } from '@/lib/entities/entity-dedup';
import { VALID_ENTITY_TYPES } from '@/lib/validation/schemas';
import {
  deriveExpiryStatus,
  type CertificationMetadata,
  type FrameworkMetadata,
  type RegistrationMetadata,
  type ExpiryStatus,
} from '@/lib/certification-status';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EntityDetailPanelProps {
  canonicalName: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// ---------------------------------------------------------------------------
// Type badge colour map (mirrors entity-list.tsx)
// ---------------------------------------------------------------------------

const TYPE_COLOURS: Record<string, string> = {
  organisation: 'bg-entity-organisation-bg text-entity-organisation-text',
  certification: 'bg-entity-certification-bg text-entity-certification-text',
  regulation: 'bg-entity-regulation-bg text-entity-regulation-text',
  framework: 'bg-entity-framework-bg text-entity-framework-text',
  capability: 'bg-entity-capability-bg text-entity-capability-text',
  person: 'bg-entity-person-bg text-entity-person-text',
  technology: 'bg-entity-technology-bg text-entity-technology-text',
  project: 'bg-entity-project-bg text-entity-project-text',
  sector: 'bg-entity-sector-bg text-entity-sector-text',
  product: 'bg-entity-product-bg text-entity-product-text',
  standard: 'bg-muted text-muted-foreground',
  methodology: 'bg-muted text-muted-foreground',
};

// ---------------------------------------------------------------------------
// Expiry status badge
// ---------------------------------------------------------------------------

const EXPIRY_STATUS_STYLES: Record<ExpiryStatus, string> = {
  valid: 'bg-freshness-fresh-bg text-freshness-fresh',
  expiring_soon: 'bg-freshness-aging-bg text-freshness-aging',
  expired: 'bg-freshness-expired-bg text-freshness-expired',
  unknown: 'bg-muted text-muted-foreground',
};

const EXPIRY_STATUS_LABELS: Record<ExpiryStatus, string> = {
  valid: 'Valid',
  expiring_soon: 'Expiring soon',
  expired: 'Expired',
  unknown: 'Unknown',
};

function ExpiryStatusBadge({ status }: { status: ExpiryStatus }) {
  return (
    <Badge
      variant="outline"
      className={cn('text-xs', EXPIRY_STATUS_STYLES[status])}
    >
      {EXPIRY_STATUS_LABELS[status]}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Enrichable entity types
// ---------------------------------------------------------------------------

const ENRICHABLE_TYPES = new Set(['certification', 'framework', 'regulation']);

// ---------------------------------------------------------------------------
// Relationship display helper
// ---------------------------------------------------------------------------

function formatRelationshipType(type: string): string {
  return type.replace(/_/g, ' ');
}

// ---------------------------------------------------------------------------
// Metadata form sub-components
// ---------------------------------------------------------------------------

function CertificationMetadataForm({
  metadata,
  onChange,
}: {
  metadata: CertificationMetadata;
  onChange: (updates: Partial<CertificationMetadata>) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="cert-version" className="text-xs">
            Version
          </Label>
          <Input
            id="cert-version"
            placeholder="e.g. 2022"
            value={metadata.version ?? ''}
            onChange={(e) => onChange({ version: e.target.value || undefined })}
            className="h-8 text-sm"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="cert-issuing-body" className="text-xs">
            Issuing body
          </Label>
          <Input
            id="cert-issuing-body"
            placeholder="e.g. BSI"
            value={metadata.issuing_body ?? ''}
            onChange={(e) =>
              onChange({ issuing_body: e.target.value || undefined })
            }
            className="h-8 text-sm"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="cert-date-obtained" className="text-xs">
            Date obtained
          </Label>
          <Input
            id="cert-date-obtained"
            type="date"
            value={metadata.date_obtained ?? ''}
            onChange={(e) =>
              onChange({ date_obtained: e.target.value || undefined })
            }
            className="h-8 text-sm"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="cert-expiry-date" className="text-xs">
            Expiry date
          </Label>
          <Input
            id="cert-expiry-date"
            type="date"
            value={metadata.expiry_date ?? ''}
            onChange={(e) =>
              onChange({ expiry_date: e.target.value || undefined })
            }
            className="h-8 text-sm"
          />
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor="cert-scope" className="text-xs">
          Scope
        </Label>
        <Input
          id="cert-scope"
          placeholder="e.g. Design, development, and hosting of SaaS"
          value={metadata.scope ?? ''}
          onChange={(e) => onChange({ scope: e.target.value || undefined })}
          className="h-8 text-sm"
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="cert-number" className="text-xs">
          Certificate number
        </Label>
        <Input
          id="cert-number"
          placeholder="Certificate or registration number"
          value={metadata.certificate_number ?? ''}
          onChange={(e) =>
            onChange({ certificate_number: e.target.value || undefined })
          }
          className="h-8 text-sm"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="cert-holder" className="text-xs">
            Holder
          </Label>
          <Select
            value={metadata.holder ?? ''}
            onValueChange={(value) =>
              onChange({ holder: value as 'self' | 'supplier' })
            }
          >
            <SelectTrigger id="cert-holder" className="h-8 text-sm">
              <SelectValue placeholder="Choose holder…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="self">Self-held</SelectItem>
              <SelectItem value="supplier">Supplier-held</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {metadata.holder === 'supplier' && (
          <div className="space-y-1">
            <Label htmlFor="cert-supplier" className="text-xs">
              Supplier name
            </Label>
            <Input
              id="cert-supplier"
              placeholder="e.g. Example Datacentre Ltd"
              value={metadata.supplier_name ?? ''}
              onChange={(e) =>
                onChange({ supplier_name: e.target.value || undefined })
              }
              className="h-8 text-sm"
            />
          </div>
        )}
      </div>

      <div className="space-y-1">
        <Label htmlFor="cert-notes" className="text-xs">
          Notes
        </Label>
        <Input
          id="cert-notes"
          placeholder="Additional notes"
          value={metadata.notes ?? ''}
          onChange={(e) => onChange({ notes: e.target.value || undefined })}
          className="h-8 text-sm"
        />
      </div>
    </div>
  );
}

function FrameworkMetadataForm({
  metadata,
  onChange,
}: {
  metadata: FrameworkMetadata;
  onChange: (updates: Partial<FrameworkMetadata>) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="fw-round" className="text-xs">
            Round
          </Label>
          <Input
            id="fw-round"
            placeholder="e.g. 14"
            value={metadata.round ?? ''}
            onChange={(e) => onChange({ round: e.target.value || undefined })}
            className="h-8 text-sm"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="fw-status" className="text-xs">
            Status
          </Label>
          <Select
            value={metadata.status ?? ''}
            onValueChange={(value) =>
              onChange({
                status: (value || undefined) as
                  | 'active'
                  | 'expired'
                  | 'pending'
                  | undefined,
              })
            }
          >
            <SelectTrigger id="fw-status" className="h-8 text-sm">
              <SelectValue placeholder="Select status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="expired">Expired</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="fw-date-joined" className="text-xs">
            Date joined
          </Label>
          <Input
            id="fw-date-joined"
            type="date"
            value={metadata.date_joined ?? ''}
            onChange={(e) =>
              onChange({ date_joined: e.target.value || undefined })
            }
            className="h-8 text-sm"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="fw-expiry-date" className="text-xs">
            Expiry date
          </Label>
          <Input
            id="fw-expiry-date"
            type="date"
            value={metadata.expiry_date ?? ''}
            onChange={(e) =>
              onChange({ expiry_date: e.target.value || undefined })
            }
            className="h-8 text-sm"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="fw-lot" className="text-xs">
            Lot
          </Label>
          <Input
            id="fw-lot"
            placeholder="e.g. Cloud Hosting"
            value={metadata.lot ?? ''}
            onChange={(e) => onChange({ lot: e.target.value || undefined })}
            className="h-8 text-sm"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="fw-supplier-id" className="text-xs">
            Supplier ID
          </Label>
          <Input
            id="fw-supplier-id"
            placeholder="Registration/supplier ID"
            value={metadata.supplier_id ?? ''}
            onChange={(e) =>
              onChange({ supplier_id: e.target.value || undefined })
            }
            className="h-8 text-sm"
          />
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor="fw-notes" className="text-xs">
          Notes
        </Label>
        <Input
          id="fw-notes"
          placeholder="Additional notes"
          value={metadata.notes ?? ''}
          onChange={(e) => onChange({ notes: e.target.value || undefined })}
          className="h-8 text-sm"
        />
      </div>
    </div>
  );
}

function RegistrationMetadataForm({
  metadata,
  onChange,
}: {
  metadata: RegistrationMetadata;
  onChange: (updates: Partial<RegistrationMetadata>) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="reg-number" className="text-xs">
            Registration number
          </Label>
          <Input
            id="reg-number"
            placeholder="e.g. ZA123456"
            value={metadata.registration_number ?? ''}
            onChange={(e) =>
              onChange({ registration_number: e.target.value || undefined })
            }
            className="h-8 text-sm"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="reg-body" className="text-xs">
            Registering body
          </Label>
          <Input
            id="reg-body"
            placeholder="e.g. ICO"
            value={metadata.registering_body ?? ''}
            onChange={(e) =>
              onChange({ registering_body: e.target.value || undefined })
            }
            className="h-8 text-sm"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="reg-date" className="text-xs">
            Date registered
          </Label>
          <Input
            id="reg-date"
            type="date"
            value={metadata.date_registered ?? ''}
            onChange={(e) =>
              onChange({ date_registered: e.target.value || undefined })
            }
            className="h-8 text-sm"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="reg-expiry" className="text-xs">
            Expiry date
          </Label>
          <Input
            id="reg-expiry"
            type="date"
            value={metadata.expiry_date ?? ''}
            onChange={(e) =>
              onChange({ expiry_date: e.target.value || undefined })
            }
            className="h-8 text-sm"
          />
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor="reg-notes" className="text-xs">
          Notes
        </Label>
        <Input
          id="reg-notes"
          placeholder="Additional notes"
          value={metadata.notes ?? ''}
          onChange={(e) => onChange({ notes: e.target.value || undefined })}
          className="h-8 text-sm"
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Metadata details section
// ---------------------------------------------------------------------------

function MetadataDetailsSection({
  entityType,
  initialMetadata,
  onSave,
  saving,
  saveSuccess,
  saveError,
  onResetSaveState,
}: {
  entityType: string;
  /**
   * Used as the React `key` on this component at the call site so it remounts
   * when a different entity is selected. Not read inside the component body.
   */
  canonicalName: string;
  initialMetadata?: Record<string, unknown>;
  onSave: (metadata: Record<string, unknown>) => Promise<unknown>;
  saving: boolean;
  saveSuccess: boolean;
  saveError: string | null;
  onResetSaveState: () => void;
}) {
  // No reset-on-prop-change effect: the parent passes a stable `key` prop
  // based on canonicalName so this component remounts when a different
  // entity is selected, giving clean initial state every time.
  const [metadata, setMetadata] = useState<Record<string, unknown>>(
    initialMetadata ?? {},
  );

  const handleChange = useCallback(
    (updates: Record<string, unknown>) => {
      setMetadata((prev) => ({ ...prev, ...updates }));
      onResetSaveState();
    },
    [onResetSaveState],
  );

  const handleSave = useCallback(async () => {
    await onSave(metadata);
  }, [onSave, metadata]);

  const expiryDate = metadata.expiry_date as string | undefined;
  const expiryStatus = deriveExpiryStatus(expiryDate);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold">Details</h4>
        {expiryDate && <ExpiryStatusBadge status={expiryStatus} />}
      </div>

      {entityType === 'certification' && (
        <CertificationMetadataForm
          metadata={metadata as CertificationMetadata}
          onChange={handleChange}
        />
      )}

      {entityType === 'framework' && (
        <FrameworkMetadataForm
          metadata={metadata as FrameworkMetadata}
          onChange={handleChange}
        />
      )}

      {entityType === 'regulation' && (
        <RegistrationMetadataForm
          metadata={metadata as RegistrationMetadata}
          onChange={handleChange}
        />
      )}

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          onClick={handleSave}
          disabled={saving}
          className="gap-1.5"
        >
          {saving ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Save className="size-3.5" />
          )}
          {saving ? 'Saving...' : 'Save details'}
        </Button>

        {saveSuccess && (
          <span className="flex items-center gap-1 text-xs text-freshness-fresh">
            <CheckCircle2 className="size-3.5" />
            Saved
          </span>
        )}

        {saveError && (
          <span className="flex items-center gap-1 text-xs text-freshness-expired">
            <AlertTriangle className="size-3" />
            {saveError}
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function EntityDetailPanel({
  canonicalName,
  open,
  onOpenChange,
}: EntityDetailPanelProps) {
  const {
    detail,
    isLoading: loading,
    error,
    saveMetadata,
    isSaving,
    saveError,
    saveSuccess,
    resetSaveState,
    changeType,
    isChangingType,
  } = useEntityDetail(canonicalName, open);

  const showMetadataSection =
    detail && ENRICHABLE_TYPES.has(detail.effective_type);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Network className="size-5 shrink-0" aria-hidden="true" />
            <span className="truncate">
              {canonicalName
                ? formatEntityDisplayName(canonicalName)
                : 'Entity Detail'}
            </span>
          </SheetTitle>
          <SheetDescription className="sr-only">
            Detailed view for entity {canonicalName}
          </SheetDescription>
        </SheetHeader>

        {loading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {error && (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <AlertTriangle className="size-6 text-freshness-aging" />
            <p className="text-sm text-muted-foreground">{error}</p>
          </div>
        )}

        {!loading && !error && detail && (
          <div className="flex flex-col gap-6 px-4 pt-4 sm:px-6">
            {/* -- Type and stats ----------------------------------------- */}
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Select
                  value={detail.effective_type}
                  onValueChange={(newType) => changeType(newType)}
                  disabled={isChangingType}
                >
                  <SelectTrigger
                    className={cn(
                      'h-7 w-auto gap-1.5 border px-2 text-xs font-medium',
                      TYPE_COLOURS[detail.effective_type],
                      isChangingType && 'opacity-60',
                    )}
                    aria-label="Change entity type"
                  >
                    <SelectValue />
                    {isChangingType && (
                      <Loader2 className="size-3 animate-spin" />
                    )}
                  </SelectTrigger>
                  <SelectContent>
                    {VALID_ENTITY_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {detail.has_type_override && (
                  <span className="text-xs text-muted-foreground">
                    (overridden from {detail.entity_type})
                  </span>
                )}
                {detail.has_type_conflict && (
                  <span className="flex items-center gap-1 text-xs text-freshness-aging">
                    <AlertTriangle className="size-3" />
                    Type conflict
                  </span>
                )}
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-md border bg-muted/30 px-3 py-2 text-center">
                  <div className="text-lg font-semibold tabular-nums">
                    {detail.mention_count}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    Mentions
                  </div>
                </div>
                <div className="rounded-md border bg-muted/30 px-3 py-2 text-center">
                  <div className="text-lg font-semibold tabular-nums">
                    {detail.variant_count}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    Variants
                  </div>
                </div>
                <div className="rounded-md border bg-muted/30 px-3 py-2 text-center">
                  <div className="text-lg font-semibold tabular-nums">
                    {detail.content_item_count}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    Content items
                  </div>
                </div>
              </div>
            </div>

            {/* -- Metadata details (certification/framework/regulation) -- */}
            {showMetadataSection && (
              <>
                <Separator />
                <MetadataDetailsSection
                  // key forces a remount when the selected entity changes,
                  // resetting the locally-edited metadata without needing
                  // a setState-in-effect (react-hooks/set-state-in-effect).
                  key={detail.canonical_name}
                  entityType={detail.effective_type}
                  canonicalName={detail.canonical_name}
                  initialMetadata={detail.metadata}
                  onSave={saveMetadata}
                  saving={isSaving}
                  saveSuccess={saveSuccess}
                  saveError={saveError}
                  onResetSaveState={resetSaveState}
                />
              </>
            )}

            <Separator />

            {/* -- Variant names ------------------------------------------ */}
            <div className="space-y-2">
              <h4 className="text-sm font-semibold">
                Name variants ({detail.variant_count})
              </h4>
              {detail.variant_names.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No variants found.
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {detail.variant_names.map((name) => (
                    <Badge key={name} variant="secondary" className="text-xs">
                      {name}
                    </Badge>
                  ))}
                </div>
              )}
              {detail.has_type_conflict && detail.types_seen.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Types seen across mentions: {detail.types_seen.join(', ')}
                </p>
              )}
            </div>

            <Separator />

            {/* -- Content items ------------------------------------------ */}
            <div className="space-y-2">
              <h4 className="text-sm font-semibold">
                Content items ({detail.content_item_count})
              </h4>
              {detail.content_items.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No content items linked to this entity.
                </p>
              ) : (
                <ul className="space-y-1" role="list">
                  {detail.content_items.map((item) => (
                    <li key={item.id}>
                      <Link
                        href={`/item/${item.id}`}
                        className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent"
                      >
                        <FileText
                          className="size-3.5 shrink-0 text-muted-foreground"
                          aria-hidden="true"
                        />
                        <span className="min-w-0 flex-1 truncate">
                          {item.title}
                        </span>
                        {item.content_type && (
                          <span className="shrink-0 text-[11px] text-muted-foreground">
                            {formatContentType(item.content_type)}
                          </span>
                        )}
                        <ExternalLink
                          className="size-3 shrink-0 text-muted-foreground"
                          aria-hidden="true"
                        />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* -- Relationships ------------------------------------------ */}
            {detail.relationships.length > 0 && (
              <>
                <Separator />
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold">
                    Relationships ({detail.relationship_count})
                  </h4>
                  <ul className="space-y-1.5" role="list">
                    {detail.relationships.map((rel, idx) => {
                      const isSource =
                        rel.source_entity === detail.canonical_name;
                      const otherEntity = isSource
                        ? rel.target_entity
                        : rel.source_entity;

                      return (
                        <li
                          key={`${rel.source_entity}-${rel.relationship_type}-${rel.target_entity}-${idx}`}
                          className="flex items-center gap-2 rounded-md border bg-muted/20 px-3 py-2 text-sm"
                        >
                          <span className="shrink-0 font-medium">
                            {formatEntityDisplayName(detail.canonical_name)}
                          </span>
                          <ArrowRight
                            className={cn(
                              'size-3.5 shrink-0 text-muted-foreground',
                              !isSource && 'rotate-180',
                            )}
                            aria-hidden="true"
                          />
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {formatRelationshipType(rel.relationship_type)}
                          </span>
                          <ArrowRight
                            className="size-3.5 shrink-0 text-muted-foreground"
                            aria-hidden="true"
                          />
                          <span className="min-w-0 flex-1 truncate font-medium">
                            {formatEntityDisplayName(otherEntity)}
                          </span>
                          {rel.confidence < 1 && (
                            <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                              {Math.round(rel.confidence * 100)}%
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
