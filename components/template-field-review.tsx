'use client';

import { useCallback, useMemo, useState } from 'react';
import {
  CheckCircle,
  XCircle,
  CircleDot,
  AlertCircle,
  UserPen,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import type { TemplateField, TemplateSummary } from '@/types/template';

interface BidQuestion {
  id: string;
  question_text: string;
  status: string;
}

interface TemplateFieldReviewProps {
  templateId: string;
  bidId: string;
  fields: TemplateField[];
  bidQuestions: BidQuestion[];
  summary: TemplateSummary;
  onMappingUpdate: (fieldId: string, questionId: string | null, status: string) => Promise<void>;
  onAutoMap: () => Promise<void>;
  onFill: () => void;
  onBulkAccept: () => Promise<void>;
}

type FilterStatus = 'all' | 'unreviewed' | 'confirmed' | 'unmapped' | 'rejected';

const STATUS_CONFIG = {
  unreviewed: {
    icon: CircleDot,
    colour: 'text-blue-600 dark:text-blue-400',
    bg: 'bg-blue-100 dark:bg-blue-900/30',
    label: 'Unreviewed',
  },
  confirmed: {
    icon: CheckCircle,
    colour: 'text-green-600 dark:text-green-400',
    bg: 'bg-green-100 dark:bg-green-900/30',
    label: 'Confirmed',
  },
  rejected: {
    icon: XCircle,
    colour: 'text-slate-500 dark:text-slate-400',
    bg: 'bg-slate-100 dark:bg-slate-800/30',
    label: 'Rejected',
  },
  manual: {
    icon: UserPen,
    colour: 'text-amber-600 dark:text-amber-400',
    bg: 'bg-amber-100 dark:bg-amber-900/30',
    label: 'Manual',
  },
  unmapped: {
    icon: AlertCircle,
    colour: 'text-red-600 dark:text-red-400',
    bg: 'bg-red-100 dark:bg-red-900/30',
    label: 'Unmapped',
  },
} as const;

function StatusBadge({ status }: { status: string }) {
  const config = STATUS_CONFIG[status as keyof typeof STATUS_CONFIG];
  if (!config) return <span className="text-xs text-muted-foreground">{status}</span>;
  const Icon = config.icon;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        config.bg,
      )}
    >
      <Icon className={cn('size-3.5', config.colour)} aria-hidden="true" />
      <span className={config.colour}>{config.label}</span>
    </span>
  );
}

function ConfidenceBadge({ confidence }: { confidence: number | null }) {
  if (confidence === null) return null;
  const pct = Math.round(confidence * 100);
  const colour =
    pct >= 90 ? 'text-green-600 dark:text-green-400' :
    pct >= 70 ? 'text-amber-600 dark:text-amber-400' :
    'text-red-600 dark:text-red-400';
  const label = pct >= 90 ? 'High' : pct >= 70 ? 'Medium' : 'Low';
  return (
    <span
      className={cn('text-xs font-medium', colour)}
      title={`${pct}% confidence (${label})`}
    >
      {pct}%
    </span>
  );
}

export function TemplateFieldReview({
  templateId,
  bidId,
  fields,
  bidQuestions,
  summary,
  onMappingUpdate,
  onAutoMap,
  onFill,
  onBulkAccept,
}: TemplateFieldReviewProps) {
  // templateId and bidId are available for future use (e.g. direct API calls)
  void templateId;
  void bidId;

  const [filter, setFilter] = useState<FilterStatus>('all');
  const [activeFieldId, setActiveFieldId] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [autoMapping, setAutoMapping] = useState(false);

  const filteredFields = useMemo(() => {
    if (filter === 'all') return fields;
    return fields.filter((f) => f.mapping_status === filter);
  }, [fields, filter]);

  const confirmedCount = summary.confirmed_fields;
  const totalMappable = summary.total_fields - summary.rejected_fields;
  const progressPct = totalMappable > 0 ? (confirmedCount / totalMappable) * 100 : 0;

  const handleConfirm = useCallback(
    async (field: TemplateField) => {
      if (!field.question_id) return;
      setLoading(field.id);
      try {
        await onMappingUpdate(field.id, field.question_id, 'confirmed');
        toast.success('Mapping confirmed');
      } catch {
        toast.error('Failed to confirm mapping');
      } finally {
        setLoading(null);
      }
    },
    [onMappingUpdate],
  );

  const handleReject = useCallback(
    async (field: TemplateField) => {
      setLoading(field.id);
      try {
        await onMappingUpdate(field.id, null, 'rejected');
        toast.success('Field rejected');
      } catch {
        toast.error('Failed to reject field');
      } finally {
        setLoading(null);
      }
    },
    [onMappingUpdate],
  );

  const handleManualMap = useCallback(
    async (fieldId: string, questionId: string) => {
      setLoading(fieldId);
      try {
        await onMappingUpdate(fieldId, questionId, 'manual');
        setActiveFieldId(null);
        toast.success('Manual mapping set');
      } catch {
        toast.error('Failed to set mapping');
      } finally {
        setLoading(null);
      }
    },
    [onMappingUpdate],
  );

  const handleAutoMap = useCallback(async () => {
    setAutoMapping(true);
    try {
      await onAutoMap();
      toast.success('Auto-mapping complete');
    } catch {
      toast.error('Auto-mapping failed');
    } finally {
      setAutoMapping(false);
    }
  }, [onAutoMap]);

  const handleBulkAccept = useCallback(async () => {
    setLoading('bulk');
    try {
      await onBulkAccept();
      toast.success('All unreviewed mappings accepted');
    } catch {
      toast.error('Bulk accept failed');
    } finally {
      setLoading(null);
    }
  }, [onBulkAccept]);

  const hasConfirmedFields = summary.confirmed_fields > 0;
  const hasUnreviewed = summary.unreviewed_fields > 0;

  return (
    <div className="space-y-4">
      {/* Summary header */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">
            {summary.total_fields} fields found
            {summary.confirmed_fields > 0 && ` · ${summary.confirmed_fields} confirmed`}
            {summary.rejected_fields > 0 && ` · ${summary.rejected_fields} rejected`}
            {summary.unmapped_fields > 0 && ` · ${summary.unmapped_fields} unmapped`}
          </p>
          <Progress
            value={progressPct}
            className="h-2 w-64"
            aria-label={`${confirmedCount} of ${totalMappable} fields mapped`}
          />
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleAutoMap}
            disabled={autoMapping}
          >
            {autoMapping ? 'Mapping...' : 'Auto-Map'}
          </Button>
          {hasUnreviewed && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleBulkAccept}
              disabled={loading === 'bulk'}
            >
              Accept All Unreviewed
            </Button>
          )}
          <Button size="sm" onClick={onFill} disabled={!hasConfirmedFields}>
            Fill Template
          </Button>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 rounded-lg bg-muted p-1" role="tablist" aria-label="Filter fields by status">
        {(['all', 'unreviewed', 'confirmed', 'unmapped', 'rejected'] as const).map((f) => {
          const count =
            f === 'unreviewed' ? summary.unreviewed_fields :
            f === 'confirmed' ? summary.confirmed_fields :
            f === 'unmapped' ? summary.unmapped_fields :
            f === 'rejected' ? summary.rejected_fields :
            null;

          return (
            <button
              key={f}
              role="tab"
              aria-selected={filter === f}
              className={cn(
                'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                filter === f
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
              onClick={() => setFilter(f)}
            >
              {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
              {count !== null && (
                <span className="ml-1 text-muted-foreground">({count})</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Fields table */}
      <div className="rounded-lg border overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="px-3 py-2 text-left font-medium w-8">#</th>
              <th className="px-3 py-2 text-left font-medium">Section</th>
              <th className="px-3 py-2 text-left font-medium">Question (from template)</th>
              <th className="px-3 py-2 text-left font-medium">Mapped To</th>
              <th className="px-3 py-2 text-left font-medium w-28">Confidence</th>
              <th className="px-3 py-2 text-left font-medium w-28">Status</th>
              <th className="px-3 py-2 text-left font-medium w-32">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredFields.map((field) => (
              <tr
                key={field.id}
                className={cn(
                  'border-b last:border-0 transition-colors',
                  field.mapping_status === 'rejected' && 'opacity-50',
                  loading === field.id && 'opacity-70',
                )}
              >
                <td className="px-3 py-2 text-muted-foreground">{field.sequence + 1}</td>
                <td
                  className="px-3 py-2 text-xs text-muted-foreground max-w-[120px] truncate"
                  title={field.section_name ?? ''}
                >
                  {field.section_name || '--'}
                </td>
                <td className="px-3 py-2 max-w-[250px]">
                  <p className="truncate" title={field.question_text ?? ''}>
                    {field.question_text || '--'}
                  </p>
                  {field.word_limit && (
                    <span className="text-xs text-muted-foreground">
                      {field.word_limit} words
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 max-w-[200px]">
                  {field.matched_question ? (
                    <p
                      className="truncate text-xs"
                      title={field.matched_question.question_text}
                    >
                      {field.matched_question.question_text}
                    </p>
                  ) : activeFieldId === field.id ? (
                    <select
                      className="w-full rounded border bg-background px-2 py-1 text-xs"
                      defaultValue=""
                      onChange={(e) => {
                        if (e.target.value) handleManualMap(field.id, e.target.value);
                      }}
                      autoFocus
                      aria-label={`Select a bid question to map to field ${field.sequence + 1}`}
                    >
                      <option value="">Select a question...</option>
                      {bidQuestions.map((q) => (
                        <option key={q.id} value={q.id}>
                          {q.question_text.substring(0, 80)}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <button
                      className="text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => setActiveFieldId(field.id)}
                    >
                      Assign question...
                    </button>
                  )}
                </td>
                <td className="px-3 py-2">
                  <ConfidenceBadge confidence={field.mapping_confidence} />
                </td>
                <td className="px-3 py-2">
                  <StatusBadge status={field.mapping_status} />
                </td>
                <td className="px-3 py-2">
                  <div className="flex gap-1">
                    {(field.mapping_status === 'unreviewed' || field.mapping_status === 'unmapped') &&
                      field.question_id && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={() => handleConfirm(field)}
                          disabled={loading === field.id}
                        >
                          Confirm
                        </Button>
                      )}
                    {field.mapping_status !== 'rejected' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs text-muted-foreground"
                        onClick={() => handleReject(field)}
                        disabled={loading === field.id}
                      >
                        Reject
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {filteredFields.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">
                  No fields match the current filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
