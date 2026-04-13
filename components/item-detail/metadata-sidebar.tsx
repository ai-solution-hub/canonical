'use client';

import { useState, useEffect, useCallback } from 'react';
import { Check, Pencil, AlertTriangle, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DomainBadge } from '@/components/shared/domain-badge';
import { SourceMetadata } from '@/components/reader/source-metadata';
import {
  formatDateUK,
  formatContentType,
  formatPlatform,
  getConfidenceDisplay,
} from '@/lib/format';
import { useTaxonomy } from '@/contexts/taxonomy-context';
import { FreshnessBadge } from '@/components/shared/freshness-badge';
import { ExpiryDateDisplay } from '@/components/shared/expiry-date-display';
import { TemporalReferencesSection } from '@/components/item-detail/temporal-references-section';
import { GovernanceBadge } from '@/components/shared/governance-badge';
import { ContentOwnerSelector } from '@/components/content/content-owner-selector';
import { ContentOwnerBadge } from '@/components/content/content-owner-badge';
import { QualityScoreBreakdown } from '@/components/shared/quality-score-breakdown';
import { useDisplayNames } from '@/hooks/use-display-names';
import { createClient } from '@/lib/supabase/client';
import { captureClientException } from '@/lib/client-telemetry';
import { cn } from '@/lib/utils';
import type { ItemData } from '@/app/item/[id]/item-detail-client';

interface QualityFlag {
  id: string;
  flag_type: string;
  severity: string;
  details: Record<string, unknown> | null;
  created_at: string | null;
}

/** Human-readable labels for quality flag types */
function formatFlagType(flagType: string): string {
  const labels: Record<string, string> = {
    classification_low: 'Low Classification',
    short_content: 'Short Content',
    missing_content: 'Missing Content',
    manual_review: 'Needs Review',
    duplicate_candidate: 'Possible Duplicate',
    review_needed: 'Review Needed',
    freshness_expired: 'Expired Content',
    import_warning: 'Import Warning',
    governance_review: 'Governance Review',
    needs_review: 'Needs Review',
  };
  return (
    labels[flagType] ??
    flagType.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

interface MetadataSidebarProps {
  item: ItemData;
  editingField: string | null;
  editValue: string;
  saveSuccess: string | null;
  startEdit: (field: string) => void;
  saveEdit: (field: string, value: unknown) => void;
  readOnly?: boolean;
  onOwnerChanged?: (ownerId: string | null) => void;
}

export function MetadataSidebar({
  item,
  editingField,
  editValue,
  saveSuccess,
  startEdit,
  saveEdit,
  readOnly = false,
  onOwnerChanged,
}: MetadataSidebarProps) {
  const { getDomainNames, getSubtopics, formatSubtopic } = useTaxonomy();
  const displayNames = useDisplayNames([
    item.created_by as string | null,
    item.updated_by as string | null,
    item.content_owner_id as string | null,
  ]);

  // Quality flags
  const [qualityFlags, setQualityFlags] = useState<QualityFlag[]>([]);
  useEffect(() => {
    const fetchFlags = async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from('ingestion_quality_log')
        .select('id, flag_type, severity, details, created_at')
        .eq('content_item_id', item.id)
        .eq('resolved', false)
        .order('created_at', { ascending: false });
      if (data) setQualityFlags(data as QualityFlag[]);
    };
    fetchFlags();
  }, [item.id]);

  const resolveFlag = useCallback(
    async (flagId: string) => {
      try {
        const res = await fetch('/api/quality', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ flag_id: flagId }),
        });
        if (res.ok) {
          setQualityFlags((prev) => prev.filter((f) => f.id !== flagId));
          toast.success('Quality flag resolved');
        } else {
          const data = await res.json();
          toast.error(data.error ?? 'Failed to resolve flag');
        }
      } catch (err) {
        captureClientException(err, {
          scope: 'item-detail.metadata-sidebar.resolveQualityFlag',
          extras: { flagId, itemId: item.id },
        });
        toast.error('Failed to resolve quality flag');
      }
    },
    [item.id],
  );

  const createdByName = item.created_by
    ? (displayNames.get(item.created_by as string) ?? 'System')
    : 'System';
  const updatedByName = item.updated_by
    ? (displayNames.get(item.updated_by as string) ??
      (item.updated_by as string).slice(0, 8) + '...')
    : null;

  return (
    <div className="w-full">
      <dl className="flex flex-col gap-3 text-sm">
        {/* Domain (editable) */}
        <div className="group flex items-start justify-between">
          <div>
            <dt className="text-xs text-muted-foreground">Domain</dt>
            {editingField === 'primary_domain' ? (
              <Select
                value={editValue}
                onValueChange={async (val) => {
                  await saveEdit('primary_domain', val);
                  // Reset subtopic after domain save completes to avoid concurrent PATCH calls
                  await saveEdit(
                    'primary_subtopic',
                    getSubtopics(val)?.[0] ?? '',
                  );
                }}
              >
                <SelectTrigger className="mt-1 h-8 w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {getDomainNames().map((d) => (
                    <SelectItem key={d} value={d}>
                      {d}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <dd className="flex items-center gap-1.5">
                <DomainBadge domain={(item.primary_domain as string) ?? ''} />
                {saveSuccess === 'primary_domain' ? (
                  <Check className="size-3 text-[var(--success)]" />
                ) : (
                  <button
                    onClick={() => !readOnly && startEdit('primary_domain')}
                    className={`flex min-h-[44px] min-w-[44px] items-center justify-center rounded-sm p-2 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring ${readOnly ? 'hidden' : ''}`}
                    aria-label="Edit domain"
                  >
                    <Pencil className="size-3 text-muted-foreground" />
                  </button>
                )}
              </dd>
            )}
          </div>
        </div>

        {/* Subtopic (editable) */}
        <div className="group">
          <dt className="text-xs text-muted-foreground">Subtopic</dt>
          {editingField === 'primary_subtopic' ? (
            <Select
              value={editValue}
              onValueChange={(val) => saveEdit('primary_subtopic', val)}
            >
              <SelectTrigger className="mt-1 h-8 w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {getSubtopics(item.primary_domain as string).map((s) => (
                  <SelectItem key={s} value={s}>
                    {formatSubtopic(s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <dd className="flex items-center gap-1.5 text-foreground">
              {formatSubtopic((item.primary_subtopic as string) ?? '')}
              {saveSuccess === 'primary_subtopic' ? (
                <Check className="size-3 text-[var(--success)]" />
              ) : (
                <button
                  onClick={() => !readOnly && startEdit('primary_subtopic')}
                  className={`flex min-h-[44px] min-w-[44px] items-center justify-center rounded-sm p-2 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring ${readOnly ? 'hidden' : ''}`}
                  aria-label="Edit subtopic"
                >
                  <Pencil className="size-3 text-muted-foreground" />
                </button>
              )}
            </dd>
          )}
        </div>

        <div>
          <dt className="text-xs text-muted-foreground">Type</dt>
          <dd className="text-foreground">
            {formatContentType(item.content_type as string)}
          </dd>
        </div>

        <div>
          <dt className="text-xs text-muted-foreground">Platform</dt>
          <dd className="text-foreground">
            {formatPlatform(item.platform as string)}
          </dd>
        </div>

        {item.author_name && (
          <div>
            <dt className="text-xs text-muted-foreground">Author</dt>
            <dd className="text-foreground">{item.author_name}</dd>
          </div>
        )}

        {item.source_domain && (
          <div>
            <dt className="text-xs text-muted-foreground">Source</dt>
            <dd className="text-foreground">{item.source_domain}</dd>
          </div>
        )}

        <div>
          <dt className="text-xs text-muted-foreground">Captured</dt>
          <dd className="text-foreground">
            {formatDateUK(item.captured_date as string)}
          </dd>
        </div>

        {/* Freshness */}
        {item.freshness && (
          <div>
            <dt className="text-xs text-muted-foreground">Freshness</dt>
            <dd>
              <FreshnessBadge freshness={item.freshness as string} />
            </dd>
          </div>
        )}

        {/* Expiry date — editable when not readOnly */}
        {(() => {
          const itemExpiry = item as ItemData & {
            expiry_date?: string | null;
            lifecycle_type?: string | null;
          };
          const hasExpiry = !!itemExpiry.expiry_date;

          if (readOnly) {
            return hasExpiry ? (
              <ExpiryDateDisplay
                expiryDate={itemExpiry.expiry_date!}
                lifecycleType={itemExpiry.lifecycle_type ?? null}
              />
            ) : null;
          }

          if (editingField === 'expiry_date') {
            return (
              <div>
                <dt className="text-xs text-muted-foreground">Expiry Date</dt>
                <dd className="flex items-center gap-2 mt-1">
                  <input
                    type="date"
                    defaultValue={itemExpiry.expiry_date ?? ''}
                    className="h-8 rounded-md border border-input bg-card px-2 text-sm text-foreground"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const val =
                          (e.target as HTMLInputElement).value || null;
                        saveEdit('expiry_date', val);
                        if (val) {
                          saveEdit('lifecycle_type', 'date_bound');
                        }
                      }
                    }}
                    onBlur={(e) => {
                      const val = e.target.value || null;
                      saveEdit('expiry_date', val);
                      if (val) {
                        saveEdit('lifecycle_type', 'date_bound');
                      }
                    }}
                    autoFocus
                    aria-label="Set expiry date"
                  />
                  {hasExpiry && (
                    <button
                      onClick={() => {
                        saveEdit('expiry_date', null);
                      }}
                      className="flex items-center justify-center rounded-sm p-1 text-muted-foreground hover:text-foreground"
                      aria-label="Clear expiry date"
                    >
                      <X className="size-3.5" />
                    </button>
                  )}
                </dd>
              </div>
            );
          }

          // Non-edit mode: clickable to enter edit
          return (
            <div className="group">
              <dt className="text-xs text-muted-foreground">Expiry Date</dt>
              <dd className="flex items-center gap-1.5">
                {hasExpiry ? (
                  <>
                    <span className="text-foreground">
                      {new Date(itemExpiry.expiry_date!).toLocaleDateString(
                        'en-GB',
                      )}
                    </span>
                    {(() => {
                      const now = new Date();
                      now.setHours(0, 0, 0, 0);
                      const exp = new Date(itemExpiry.expiry_date!);
                      exp.setHours(0, 0, 0, 0);
                      const days = Math.ceil(
                        (exp.getTime() - now.getTime()) / (24 * 60 * 60 * 1000),
                      );
                      if (days <= 0) {
                        return (
                          <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-freshness-expired-bg text-freshness-expired">
                            Expired
                          </span>
                        );
                      }
                      if (days <= 30) {
                        return (
                          <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-freshness-aging-bg text-freshness-aging">
                            {days}d
                          </span>
                        );
                      }
                      return (
                        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-freshness-fresh-bg text-freshness-fresh">
                          {days}d
                        </span>
                      );
                    })()}
                  </>
                ) : (
                  <span className="text-muted-foreground text-xs">Not set</span>
                )}
                {saveSuccess === 'expiry_date' ? (
                  <Check className="size-3 text-[var(--success)]" />
                ) : (
                  <button
                    onClick={() => startEdit('expiry_date')}
                    className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-sm p-2 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label="Edit expiry date"
                  >
                    <Pencil className="size-3 text-muted-foreground" />
                  </button>
                )}
              </dd>
            </div>
          );
        })()}

        {/* Governance review status */}
        {item.governance_review_status && (
          <div>
            <dt className="text-xs text-muted-foreground">Review Status</dt>
            <dd>
              <GovernanceBadge status={item.governance_review_status} />
            </dd>
          </div>
        )}

        {/* Content owner */}
        <div>
          <dt className="text-xs text-muted-foreground">Owner</dt>
          <dd>
            {readOnly ? (
              <ContentOwnerBadge
                ownerName={
                  item.content_owner_id
                    ? (displayNames.get(item.content_owner_id as string) ??
                      null)
                    : null
                }
                size="md"
              />
            ) : (
              <ContentOwnerSelector
                itemId={item.id}
                currentOwnerId={(item.content_owner_id as string) ?? null}
                currentOwnerName={
                  item.content_owner_id
                    ? (displayNames.get(item.content_owner_id as string) ??
                      null)
                    : null
                }
                onOwnerChanged={onOwnerChanged}
              />
            )}
          </dd>
        </div>

        {item.classification_confidence != null &&
          (() => {
            const confidence = getConfidenceDisplay(
              item.classification_confidence as number | null,
            );
            return (
              <div>
                <dt className="text-xs text-muted-foreground">Confidence</dt>
                <dd className={`font-medium ${confidence.colourClass}`}>
                  {confidence.label}
                </dd>
              </div>
            );
          })()}

        {/* Quality score breakdown */}
        <QualityScoreBreakdown
          item={{
            freshness: item.freshness as string | null,
            classification_confidence: item.classification_confidence as
              | number
              | null,
            brief: item.brief as string | null,
            detail: item.detail as string | null,
            reference: item.reference as string | null,
            summary: item.summary as string | null,
            citation_count: item.citation_count ?? 0,
          }}
        />

        {/* Quality flags */}
        {qualityFlags.length > 0 && (
          <div>
            <dt className="mb-1 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <AlertTriangle className="size-3" aria-hidden="true" />
                Quality Flags ({qualityFlags.length})
              </span>
            </dt>
            <dd className="space-y-1.5">
              {qualityFlags.map((flag) => (
                <div
                  key={flag.id}
                  className={cn(
                    'rounded px-2 py-1.5 text-xs',
                    flag.severity === 'error'
                      ? 'bg-freshness-stale-bg text-status-error'
                      : flag.severity === 'warning'
                        ? 'bg-quality-moderate-bg text-quality-severity-warning'
                        : 'bg-confidence-needs-sme-bg text-quality-severity-info',
                  )}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-medium">
                      {formatFlagType(flag.flag_type)}
                    </span>
                    {!readOnly && (
                      <button
                        onClick={() => resolveFlag(flag.id)}
                        className="text-[11px] underline-offset-2 hover:underline"
                        aria-label={`Resolve ${formatFlagType(flag.flag_type)} flag`}
                      >
                        Resolve
                      </button>
                    )}
                  </div>
                  {'reason' in (flag.details ?? {}) &&
                    flag.details?.reason != null && (
                      <p className="mt-0.5 text-[11px] opacity-80">
                        {String(flag.details.reason)}
                      </p>
                    )}
                </div>
              ))}
            </dd>
          </div>
        )}

        {/* Attribution */}
        {item.created_at && (
          <div>
            <dt className="text-xs text-muted-foreground">Created</dt>
            <dd className="text-foreground">
              {formatDateUK(item.created_at as string)}
            </dd>
          </div>
        )}
        <div>
          <dt className="text-xs text-muted-foreground">Created by</dt>
          <dd className="text-foreground text-xs">{createdByName}</dd>
        </div>
        {item.updated_by && (
          <div>
            <dt className="text-xs text-muted-foreground">Last edited by</dt>
            <dd className="text-foreground text-xs">{updatedByName}</dd>
          </div>
        )}
      </dl>

      {/* Classification details accordion */}
      <Accordion type="single" collapsible className="mt-2">
        <AccordionItem
          value="classification"
          className="border-t border-border"
        >
          <AccordionTrigger className="text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:no-underline py-3">
            Classification Details
          </AccordionTrigger>
          <AccordionContent className="pb-2">
            <dl className="flex flex-col gap-3 text-sm">
              {item.classification_reasoning && (
                <div>
                  <dt className="text-xs text-muted-foreground">Reasoning</dt>
                  <dd className="mt-0.5 text-xs leading-relaxed text-foreground">
                    {item.classification_reasoning}
                  </dd>
                </div>
              )}
              {(item.secondary_domain || item.secondary_subtopic) && (
                <div>
                  <dt className="text-xs text-muted-foreground">Secondary</dt>
                  <dd className="text-foreground">
                    {item.secondary_domain}
                    {item.secondary_subtopic && (
                      <>
                        {' '}
                        / {formatSubtopic(item.secondary_subtopic as string)}
                      </>
                    )}
                  </dd>
                </div>
              )}
            </dl>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      {/* Temporal references — merged from regex extraction and AI classification */}
      {(() => {
        const meta = item.metadata as Record<string, unknown> | null;
        if (!meta) return null;

        const regexRefs = Array.isArray(meta.temporal_references)
          ? (meta.temporal_references as import('@/lib/date-extraction').TemporalReference[])
          : [];

        // Normalise AI temporal references to the TemporalReference shape
        const aiRefs = Array.isArray(meta.ai_temporal_references)
          ? (
              meta.ai_temporal_references as Array<{
                date: string;
                context: string;
                context_type: string;
              }>
            ).map((ref) => ({
              date: ref.date,
              type: (ref.context_type ||
                'unknown') as import('@/lib/date-extraction').DateContextType,
              confidence:
                'medium' as import('@/lib/date-extraction').ConfidenceLevel,
              context: ref.context,
            }))
          : [];

        // Merge and deduplicate by date + type
        const seen = new Set<string>();
        const merged: import('@/lib/date-extraction').TemporalReference[] = [];
        for (const ref of [...regexRefs, ...aiRefs]) {
          const key = `${ref.date}|${ref.type}`;
          if (!seen.has(key)) {
            seen.add(key);
            merged.push(ref);
          }
        }

        if (merged.length === 0) return null;

        return <TemporalReferencesSection temporalReferences={merged} />;
      })()}

      <SourceMetadata
        contentType={item.content_type as string}
        platform={item.platform as string}
        metadata={item.metadata}
        content={item.content as string | null}
      />
    </div>
  );
}
