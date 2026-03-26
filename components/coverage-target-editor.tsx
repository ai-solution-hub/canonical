'use client';

import { useState, useMemo, useCallback } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useTaxonomy } from '@/contexts/taxonomy-context';
import type { CoverageTargetRow } from '@/hooks/use-coverage-targets';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CoverageTargetEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targets: CoverageTargetRow[];
  onSave: (
    entries: Array<{
      domain_id: string;
      metric_name: 'item_count' | 'fresh_pct' | 'max_expired';
      target_value: number;
    }>,
  ) => Promise<{ success: boolean; error?: string }>;
}

type MetricName = 'item_count' | 'fresh_pct' | 'max_expired';

const METRICS: { key: MetricName; label: string; placeholder: string }[] = [
  { key: 'item_count', label: 'Min items', placeholder: 'e.g. 10' },
  { key: 'fresh_pct', label: 'Fresh %', placeholder: 'e.g. 70' },
  { key: 'max_expired', label: 'Max expired', placeholder: 'e.g. 2' },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CoverageTargetEditor({
  open,
  onOpenChange,
  targets,
  onSave,
}: CoverageTargetEditorProps) {
  const { domains } = useTaxonomy();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Build initial form state from existing targets
  const initialValues = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of targets) {
      map.set(`${t.domain_id}|${t.metric_name}`, t.target_value);
    }
    return map;
  }, [targets]);

  // Local form values: domain_id|metric_name -> string (for controlled input)
  const [formValues, setFormValues] = useState<Map<string, string>>(() => {
    const map = new Map<string, string>();
    for (const [key, value] of initialValues.entries()) {
      map.set(key, String(value));
    }
    return map;
  });

  // Reset form when dialog opens/targets change
  const resetForm = useCallback(() => {
    const map = new Map<string, string>();
    for (const t of targets) {
      map.set(`${t.domain_id}|${t.metric_name}`, String(t.target_value));
    }
    setFormValues(map);
    setSaveError(null);
  }, [targets]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (nextOpen) {
        resetForm();
      }
      onOpenChange(nextOpen);
    },
    [onOpenChange, resetForm],
  );

  const handleInputChange = useCallback(
    (domainId: string, metric: MetricName, value: string) => {
      setFormValues((prev) => {
        const next = new Map(prev);
        const key = `${domainId}|${metric}`;
        if (value === '') {
          next.delete(key);
        } else {
          next.set(key, value);
        }
        return next;
      });
    },
    [],
  );

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveError(null);

    // Collect all non-empty values
    const entries: Array<{
      domain_id: string;
      metric_name: MetricName;
      target_value: number;
    }> = [];

    for (const [key, value] of formValues.entries()) {
      if (value === '') continue;
      const num = parseFloat(value);
      if (isNaN(num) || num < 0) continue;

      const [domainId, metricName] = key.split('|') as [string, MetricName];
      entries.push({
        domain_id: domainId,
        metric_name: metricName,
        target_value: num,
      });
    }

    if (entries.length === 0) {
      setSaving(false);
      setSaveError('No valid targets to save');
      return;
    }

    const result = await onSave(entries);

    setSaving(false);
    if (result.success) {
      onOpenChange(false);
    } else {
      setSaveError(result.error ?? 'Save failed');
    }
  }, [formValues, onSave, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Coverage Targets</DialogTitle>
          <DialogDescription>
            Set coverage targets per domain. Leave blank to skip a metric.
          </DialogDescription>
        </DialogHeader>

        {/* Table */}
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="pb-2 pr-4 font-medium text-muted-foreground">
                  Domain
                </th>
                {METRICS.map((m) => (
                  <th
                    key={m.key}
                    className="pb-2 px-2 text-center font-medium text-muted-foreground"
                  >
                    {m.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {domains.map((domain) => (
                <tr key={domain.id} className="border-b border-border/50">
                  <td className="py-2 pr-4 font-medium text-foreground">
                    {domain.name}
                  </td>
                  {METRICS.map((m) => {
                    const key = `${domain.id}|${m.key}`;
                    return (
                      <td key={m.key} className="px-2 py-2">
                        <Input
                          type="number"
                          min={0}
                          step={m.key === 'fresh_pct' ? 1 : 1}
                          max={m.key === 'fresh_pct' ? 100 : undefined}
                          placeholder={m.placeholder}
                          value={formValues.get(key) ?? ''}
                          onChange={(e) =>
                            handleInputChange(domain.id, m.key, e.target.value)
                          }
                          className="h-8 w-24 text-center"
                          aria-label={`${domain.name} ${m.label}`}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {saveError && (
          <p className="mt-2 text-sm text-destructive" role="alert">
            {saveError}
          </p>
        )}

        <DialogFooter className="mt-4">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && (
              <Loader2 className="mr-1.5 size-3.5 animate-spin" aria-hidden="true" />
            )}
            Save All
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
