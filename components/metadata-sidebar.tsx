'use client';

import { useState, useEffect, useCallback } from 'react';
import { Check, Pencil, AlertTriangle } from 'lucide-react';
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
import { DomainBadge } from '@/components/domain-badge';
import { SourceMetadata } from '@/components/source-metadata';
import {
  formatDateUK,
  formatContentType,
  formatPlatform,
  getConfidenceDisplay,
} from '@/lib/format';
import { useTaxonomy } from '@/contexts/taxonomy-context';
import { FreshnessBadge } from '@/components/freshness-badge';
import { GovernanceBadge } from '@/components/governance-badge';
import { useDisplayNames } from '@/hooks/use-display-names';
import { createClient } from '@/lib/supabase/client';
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
  return labels[flagType] ?? flagType.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

interface MetadataSidebarProps {
  item: ItemData;
  editingField: string | null;
  editValue: string;
  saveSuccess: string | null;
  startEdit: (field: string) => void;
  saveEdit: (field: string, value: unknown) => void;
  readOnly?: boolean;
}

export function MetadataSidebar({
  item,
  editingField,
  editValue,
  saveSuccess,
  startEdit,
  saveEdit,
  readOnly = false,
}: MetadataSidebarProps) {
  const { getDomainNames, getSubtopics, formatSubtopic } = useTaxonomy();
  const displayNames = useDisplayNames([
    item.created_by as string | null,
    item.updated_by as string | null,
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

  const resolveFlag = useCallback(async (flagId: string) => {
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
      console.error('Failed to resolve quality flag:', err);
      toast.error('Failed to resolve quality flag');
    }
  }, []);

  const createdByName = item.created_by
    ? displayNames.get(item.created_by as string) ?? 'System'
    : 'System';
  const updatedByName = item.updated_by
    ? displayNames.get(item.updated_by as string) ?? (item.updated_by as string).slice(0, 8) + '...'
    : null;

  return (
    <aside className="w-full max-w-md shrink-0 lg:max-w-none lg:w-72">
      <div className="bg-transparent border-l border-border pl-4">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Metadata
        </h2>
        <dl className="flex flex-col gap-3 text-sm">
          {/* Domain (editable) */}
          <div className="group flex items-start justify-between">
            <div>
              <dt className="text-xs text-muted-foreground">Domain</dt>
              {editingField === 'primary_domain' ? (
                <Select
                  value={editValue}
                  onValueChange={(val) => {
                    saveEdit('primary_domain', val);
                    // Clear subtopic when domain changes
                    saveEdit(
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
                  <DomainBadge
                    domain={(item.primary_domain as string) ?? ''}
                  />
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
                  {getSubtopics(
                    item.primary_domain as string,
                  ).map((s) => (
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

          {/* Governance review status */}
          {item.governance_review_status && (
            <div>
              <dt className="text-xs text-muted-foreground">Review Status</dt>
              <dd>
                <GovernanceBadge
                  status={item.governance_review_status}
                />
              </dd>
            </div>
          )}

          {item.classification_confidence != null && (() => {
            const confidence = getConfidenceDisplay(item.classification_confidence as number | null);
            return (
              <div>
                <dt className="text-xs text-muted-foreground">Confidence</dt>
                <dd className={`font-medium ${confidence.colourClass}`}>
                  {confidence.label}
                </dd>
              </div>
            );
          })()}

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
                    {'reason' in (flag.details ?? {}) && flag.details?.reason != null && (
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
            <dd className="text-foreground text-xs">
              {createdByName}
            </dd>
          </div>
          {item.updated_by && (
            <div>
              <dt className="text-xs text-muted-foreground">Last edited by</dt>
              <dd className="text-foreground text-xs">
                {updatedByName}
              </dd>
            </div>
          )}
        </dl>
      </div>

      {/* Classification details accordion */}
      <Accordion type="single" collapsible className="mt-4">
        <AccordionItem
          value="classification"
          className="rounded-lg border border-border"
        >
          <AccordionTrigger className="px-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:no-underline">
            Classification Details
          </AccordionTrigger>
          <AccordionContent className="px-4 pb-4">
            <dl className="flex flex-col gap-3 text-sm">
              {item.classification_reasoning && (
                <div>
                  <dt className="text-xs text-muted-foreground">
                    Reasoning
                  </dt>
                  <dd className="mt-0.5 text-xs leading-relaxed text-foreground">
                    {item.classification_reasoning}
                  </dd>
                </div>
              )}
              {(item.secondary_domain || item.secondary_subtopic) && (
                <div>
                  <dt className="text-xs text-muted-foreground">
                    Secondary
                  </dt>
                  <dd className="text-foreground">
                    {item.secondary_domain}
                    {item.secondary_subtopic && (
                      <>
                        {' '}
                        /{' '}
                        {formatSubtopic(item.secondary_subtopic as string)}
                      </>
                    )}
                  </dd>
                </div>
              )}
            </dl>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      <SourceMetadata
        contentType={item.content_type as string}
        platform={item.platform as string}
        metadata={item.metadata}
        content={item.content as string | null}
      />
    </aside>
  );
}
