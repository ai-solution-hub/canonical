'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle,
  XCircle,
  CircleDot,
  AlertCircle,
  UserPen,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
  onBulkReject?: (fieldIds: string[]) => Promise<void>;
}

type FilterStatus = 'all' | 'unreviewed' | 'confirmed' | 'unmapped' | 'rejected';
type SortField = 'sequence' | 'section' | 'confidence' | 'status';
type SortDirection = 'asc' | 'desc';

const STATUS_CONFIG = {
  unreviewed: {
    icon: CircleDot,
    colour: 'text-template-unreviewed',
    bg: 'bg-template-unreviewed-bg',
    label: 'Unreviewed',
  },
  confirmed: {
    icon: CheckCircle,
    colour: 'text-template-confirmed',
    bg: 'bg-template-confirmed-bg',
    label: 'Confirmed',
  },
  rejected: {
    icon: XCircle,
    colour: 'text-template-rejected',
    bg: 'bg-template-rejected-bg',
    label: 'Rejected',
  },
  manual: {
    icon: UserPen,
    colour: 'text-template-manual',
    bg: 'bg-template-manual-bg',
    label: 'Manual',
  },
  unmapped: {
    icon: AlertCircle,
    colour: 'text-template-unmapped',
    bg: 'bg-template-unmapped-bg',
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
    pct >= 90 ? 'text-confidence-strong' :
    pct >= 70 ? 'text-confidence-partial' :
    'text-freshness-stale';
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

/** Status sort weight — lower = earlier in ascending sort */
const STATUS_ORDER: Record<string, number> = {
  unmapped: 0,
  unreviewed: 1,
  manual: 2,
  confirmed: 3,
  rejected: 4,
};

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
  onBulkReject,
}: TemplateFieldReviewProps) {
  // templateId and bidId are available for future use (e.g. direct API calls)
  void templateId;
  void bidId;

  const [filter, setFilter] = useState<FilterStatus>('all');
  const [activeFieldId, setActiveFieldId] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [autoMapping, setAutoMapping] = useState(false);

  // Sorting state
  const [sortField, setSortField] = useState<SortField>('sequence');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  // Keyboard focus state
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);
  const rowRefs = useRef<Map<number, HTMLTableRowElement>>(new Map());

  // Bulk selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const filteredFields = useMemo(() => {
    const result = filter === 'all' ? [...fields] : fields.filter((f) => f.mapping_status === filter);

    // Apply sorting
    result.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'sequence':
          cmp = a.sequence - b.sequence;
          break;
        case 'section':
          cmp = (a.section_name ?? '').localeCompare(b.section_name ?? '');
          break;
        case 'confidence':
          cmp = (a.mapping_confidence ?? -1) - (b.mapping_confidence ?? -1);
          break;
        case 'status':
          cmp = (STATUS_ORDER[a.mapping_status] ?? 99) - (STATUS_ORDER[b.mapping_status] ?? 99);
          break;
      }
      return sortDirection === 'asc' ? cmp : -cmp;
    });

    return result;
  }, [fields, filter, sortField, sortDirection]);

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
      } catch (err) {
        console.error('Failed to confirm mapping:', err);
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
      } catch (err) {
        console.error('Failed to reject field:', err);
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
      } catch (err) {
        console.error('Failed to set mapping:', err);
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
    } catch (err) {
      console.error('Auto-mapping failed:', err);
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
    } catch (err) {
      console.error('Bulk accept failed:', err);
      toast.error('Bulk accept failed');
    } finally {
      setLoading(null);
    }
  }, [onBulkAccept]);

  const handleBulkReject = useCallback(async () => {
    if (!onBulkReject || selectedIds.size === 0) return;
    setLoading('bulk-reject');
    try {
      await onBulkReject(Array.from(selectedIds));
      setSelectedIds(new Set());
      toast.success(`${selectedIds.size} field(s) rejected`);
    } catch (err) {
      console.error('Bulk reject failed:', err);
      toast.error('Bulk reject failed');
    } finally {
      setLoading(null);
    }
  }, [onBulkReject, selectedIds]);

  const toggleSort = useCallback((field: SortField) => {
    setSortField((prev) => {
      if (prev === field) {
        setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
        return prev;
      }
      setSortDirection('asc');
      return field;
    });
  }, []);

  const toggleSelection = useCallback((fieldId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(fieldId)) next.delete(fieldId);
      else next.add(fieldId);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    const selectableIds = filteredFields
      .filter((f) => f.mapping_status !== 'rejected')
      .map((f) => f.id);

    setSelectedIds((prev) => {
      const allSelected = selectableIds.every((id) => prev.has(id));
      if (allSelected) return new Set();
      return new Set(selectableIds);
    });
  }, [filteredFields]);

  // Keyboard navigation
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Ignore if user is typing in an input/select/textarea
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'select' || tag === 'textarea') return;

      switch (e.key) {
        case 'j': {
          e.preventDefault();
          setFocusedIndex((prev) => {
            const next = Math.min(prev + 1, filteredFields.length - 1);
            rowRefs.current.get(next)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            return next;
          });
          break;
        }
        case 'k': {
          e.preventDefault();
          setFocusedIndex((prev) => {
            const next = Math.max(prev - 1, 0);
            rowRefs.current.get(next)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            return next;
          });
          break;
        }
        case 'n': {
          e.preventDefault();
          const nextUnreviewed = filteredFields.findIndex(
            (f, i) => i > focusedIndex && (f.mapping_status === 'unreviewed' || f.mapping_status === 'unmapped'),
          );
          if (nextUnreviewed !== -1) {
            setFocusedIndex(nextUnreviewed);
            rowRefs.current.get(nextUnreviewed)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          } else {
            // Wrap around from beginning
            const fromStart = filteredFields.findIndex(
              (f) => f.mapping_status === 'unreviewed' || f.mapping_status === 'unmapped',
            );
            if (fromStart !== -1) {
              setFocusedIndex(fromStart);
              rowRefs.current.get(fromStart)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }
          }
          break;
        }
        case 'Enter': {
          if (focusedIndex < 0 || focusedIndex >= filteredFields.length) return;
          const field = filteredFields[focusedIndex];
          if (field.question_id && (field.mapping_status === 'unreviewed' || field.mapping_status === 'unmapped')) {
            e.preventDefault();
            handleConfirm(field);
          }
          break;
        }
        case 'r': {
          if (focusedIndex < 0 || focusedIndex >= filteredFields.length) return;
          const field = filteredFields[focusedIndex];
          if (field.mapping_status !== 'rejected') {
            e.preventDefault();
            handleReject(field);
          }
          break;
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [filteredFields, focusedIndex, handleConfirm, handleReject]);

  // Reset focused index when filter or sort changes
  useEffect(() => {
    setFocusedIndex(-1);
  }, [filter, sortField, sortDirection]);

  // Clear selection when filter changes
  useEffect(() => {
    setSelectedIds(new Set());
  }, [filter]);

  const SortIcon = useCallback(
    ({ field }: { field: SortField }) => {
      if (sortField !== field) return <ArrowUpDown className="ml-1 inline size-3.5 text-muted-foreground/50" />;
      return sortDirection === 'asc'
        ? <ArrowUp className="ml-1 inline size-3.5" />
        : <ArrowDown className="ml-1 inline size-3.5" />;
    },
    [sortField, sortDirection],
  );

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
          {selectedIds.size > 0 && onBulkReject && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleBulkReject}
              disabled={loading === 'bulk-reject'}
              className="text-destructive hover:text-destructive"
            >
              Reject Selected ({selectedIds.size})
            </Button>
          )}
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
              {onBulkReject && (
                <th className="px-2 py-2 w-8">
                  <Checkbox
                    checked={filteredFields.length > 0 && filteredFields.filter((f) => f.mapping_status !== 'rejected').every((f) => selectedIds.has(f.id))}
                    onCheckedChange={() => toggleSelectAll()}
                    aria-label="Select all fields"
                  />
                </th>
              )}
              <th className="px-3 py-2 text-left font-medium w-8">
                <button className="inline-flex items-center" onClick={() => toggleSort('sequence')}>
                  #<SortIcon field="sequence" />
                </button>
              </th>
              <th className="px-3 py-2 text-left font-medium">
                <button className="inline-flex items-center" onClick={() => toggleSort('section')}>
                  Section<SortIcon field="section" />
                </button>
              </th>
              <th className="px-3 py-2 text-left font-medium">Question (from template)</th>
              <th className="px-3 py-2 text-left font-medium">Mapped To</th>
              <th className="px-3 py-2 text-left font-medium w-28">
                <button className="inline-flex items-center" onClick={() => toggleSort('confidence')}>
                  Confidence<SortIcon field="confidence" />
                </button>
              </th>
              <th className="px-3 py-2 text-left font-medium w-28">
                <button className="inline-flex items-center" onClick={() => toggleSort('status')}>
                  Status<SortIcon field="status" />
                </button>
              </th>
              <th className="px-3 py-2 text-left font-medium w-32">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredFields.map((field, idx) => (
              <tr
                key={field.id}
                ref={(el) => { if (el) rowRefs.current.set(idx, el); }}
                className={cn(
                  'border-b last:border-0 transition-colors',
                  field.mapping_status === 'rejected' && 'opacity-50',
                  loading === field.id && 'opacity-70',
                  focusedIndex === idx && 'bg-accent/50',
                )}
              >
                {onBulkReject && (
                  <td className="px-2 py-2">
                    {field.mapping_status !== 'rejected' && (
                      <Checkbox
                        checked={selectedIds.has(field.id)}
                        onCheckedChange={() => toggleSelection(field.id)}
                        aria-label={`Select field ${field.sequence + 1}`}
                      />
                    )}
                  </td>
                )}
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
                <td colSpan={onBulkReject ? 8 : 7} className="px-3 py-8 text-center text-muted-foreground">
                  No fields match the current filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Keyboard shortcuts hint */}
      <p className="text-xs text-muted-foreground">
        Keyboard: <kbd className="rounded border px-1 font-mono text-[10px]">j</kbd>/<kbd className="rounded border px-1 font-mono text-[10px]">k</kbd> navigate
        · <kbd className="rounded border px-1 font-mono text-[10px]">Enter</kbd> confirm
        · <kbd className="rounded border px-1 font-mono text-[10px]">r</kbd> reject
        · <kbd className="rounded border px-1 font-mono text-[10px]">n</kbd> next unreviewed
      </p>
    </div>
  );
}
