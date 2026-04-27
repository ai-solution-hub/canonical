'use client';

/**
 * Tag Morphology Drift section — admin/editor-only Settings sub-page.
 *
 * Lists `tag_morphology_drift_flags` rows surfaced by the corpus regression
 * eval. Per-flag triage actions: Accept (queue for backfill), Add override
 * (preserve current form), Dismiss (library agrees / noise).
 *
 * Spec: docs/specs/p1-tag-morphology-library-adoption-spec.md §3.5.4
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Loader2,
  CheckCircle2,
  Shield,
  XCircle,
  Inbox,
  AlertCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';

type Decision = 'pending' | 'accept' | 'add_override' | 'dismiss';

interface MorphologyFlag {
  id: string;
  stored_tag: string;
  proposed_canonical: string;
  usage_count: number;
  affected_content_ids: string[];
  detected_at: string;
  decision: Decision;
  decided_by: string | null;
  decided_at: string | null;
  decision_rationale: string | null;
}

const TAB_FILTERS: { value: Decision | 'all'; label: string }[] = [
  { value: 'pending', label: 'Pending' },
  { value: 'accept', label: 'Accepted' },
  { value: 'add_override', label: 'Overrides' },
  { value: 'dismiss', label: 'Dismissed' },
  { value: 'all', label: 'All' },
];

const DECISION_LABELS: Record<Decision, string> = {
  pending: 'Pending',
  accept: 'Accepted',
  add_override: 'Override added',
  dismiss: 'Dismissed',
};

const DECISION_VARIANTS: Record<Decision, 'default' | 'secondary' | 'outline'> =
  {
    pending: 'outline',
    accept: 'default',
    add_override: 'secondary',
    dismiss: 'secondary',
  };

export function TagMorphologySection() {
  const [activeTab, setActiveTab] = useState<Decision | 'all'>('pending');
  const [flags, setFlags] = useState<MorphologyFlag[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);
  const [rationaleOpen, setRationaleOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<{
    flagId: string;
    decision: 'accept' | 'add_override' | 'dismiss';
  } | null>(null);
  const [rationale, setRationale] = useState('');

  const fetchFlags = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '200' });
      if (activeTab !== 'all') {
        params.set('decision', activeTab);
      }
      const res = await fetch(`/api/admin/tag-morphology/flags?${params}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? 'Failed to load flags');
      }
      const data = await res.json();
      setFlags(data.flags ?? []);
      setTotal(data.total ?? 0);
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : 'Failed to load tag morphology flags',
      );
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  useEffect(() => {
    fetchFlags();
  }, [fetchFlags]);

  async function applyDecision(
    flagId: string,
    decision: 'accept' | 'add_override' | 'dismiss',
    decisionRationale?: string,
  ) {
    setUpdating(flagId);
    try {
      const res = await fetch(`/api/admin/tag-morphology/flags/${flagId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision,
          decision_rationale: decisionRationale,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? 'Failed to apply decision');
      }
      toast.success(`Flag marked ${DECISION_LABELS[decision].toLowerCase()}`);
      await fetchFlags();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to apply decision',
      );
    } finally {
      setUpdating(null);
    }
  }

  function handleQuickAction(
    flagId: string,
    decision: 'accept' | 'add_override' | 'dismiss',
  ) {
    void applyDecision(flagId, decision);
  }

  function openRationaleDialog(
    flagId: string,
    decision: 'accept' | 'add_override' | 'dismiss',
  ) {
    setPendingAction({ flagId, decision });
    setRationale('');
    setRationaleOpen(true);
  }

  async function submitRationale() {
    if (!pendingAction) return;
    await applyDecision(
      pendingAction.flagId,
      pendingAction.decision,
      rationale.trim() || undefined,
    );
    setRationaleOpen(false);
    setPendingAction(null);
    setRationale('');
  }

  const flagsSorted = useMemo(
    () => [...flags].sort((a, b) => b.usage_count - a.usage_count),
    [flags],
  );

  return (
    <TooltipProvider>
      <div className="space-y-6">
        <header className="space-y-2">
          <h2 className="text-lg font-semibold">Tag Morphology Drift</h2>
          <p className="text-sm text-muted-foreground">
            Tags where the morphology library proposes a different canonical
            form than what is currently stored. Review each flag and choose to
            accept the rewrite, preserve the current form via an override, or
            dismiss the proposal.
          </p>
          <p className="text-xs text-muted-foreground">
            Backfill of accepted flags runs separately via the
            <code className="mx-1 rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
              scripts/apply-tag-morphology-backfill.ts
            </code>
            CLI on Liam&apos;s schedule.
          </p>
        </header>

        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as Decision | 'all')}
        >
          <TabsList>
            {TAB_FILTERS.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value}>
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {TAB_FILTERS.map((tab) => (
            <TabsContent key={tab.value} value={tab.value} className="mt-4">
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="size-5 animate-spin text-muted-foreground" />
                </div>
              ) : flagsSorted.length === 0 ? (
                <Card className="flex flex-col items-center gap-2 p-12 text-center">
                  <Inbox
                    className="size-8 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <p className="text-sm font-medium">No flags in this view</p>
                  <p className="text-xs text-muted-foreground">
                    {activeTab === 'pending'
                      ? 'Run the eval script to populate this queue.'
                      : 'No flags match this filter.'}
                  </p>
                </Card>
              ) : (
                <div className="space-y-3">
                  <p className="text-xs text-muted-foreground">
                    {flagsSorted.length} flag
                    {flagsSorted.length === 1 ? '' : 's'}
                    {total !== flagsSorted.length ? ` (${total} total)` : ''}
                  </p>
                  <ul className="divide-y divide-border rounded-lg border">
                    {flagsSorted.map((flag) => (
                      <li
                        key={flag.id}
                        className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex flex-wrap items-baseline gap-2">
                            <span className="font-mono text-sm font-medium">
                              {flag.stored_tag}
                            </span>
                            <span
                              className="text-xs text-muted-foreground"
                              aria-hidden="true"
                            >
                              →
                            </span>
                            <span className="font-mono text-sm text-foreground">
                              {flag.proposed_canonical}
                            </span>
                            <Badge variant={DECISION_VARIANTS[flag.decision]}>
                              {DECISION_LABELS[flag.decision]}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Used by {flag.usage_count} item
                            {flag.usage_count === 1 ? '' : 's'} · detected{' '}
                            {new Date(flag.detected_at).toLocaleDateString(
                              'en-GB',
                            )}
                          </p>
                          {flag.decision_rationale ? (
                            <p className="text-xs italic text-muted-foreground">
                              &ldquo;{flag.decision_rationale}&rdquo;
                            </p>
                          ) : null}
                        </div>

                        {flag.decision === 'pending' ? (
                          <div className="flex shrink-0 flex-wrap gap-2">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="sm"
                                  variant="default"
                                  disabled={updating === flag.id}
                                  onClick={() =>
                                    handleQuickAction(flag.id, 'accept')
                                  }
                                >
                                  {updating === flag.id ? (
                                    <Loader2 className="size-3.5 animate-spin" />
                                  ) : (
                                    <CheckCircle2 className="size-3.5" />
                                  )}
                                  Accept
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                Queue this rewrite for the next backfill batch.
                              </TooltipContent>
                            </Tooltip>

                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  disabled={updating === flag.id}
                                  onClick={() =>
                                    openRationaleDialog(flag.id, 'add_override')
                                  }
                                >
                                  <Shield className="size-3.5" />
                                  Add override
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                Preserve the current form. Records intent;
                                editing the override list is a code change.
                              </TooltipContent>
                            </Tooltip>

                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  disabled={updating === flag.id}
                                  onClick={() =>
                                    handleQuickAction(flag.id, 'dismiss')
                                  }
                                >
                                  <XCircle className="size-3.5" />
                                  Dismiss
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                The library agrees with the current form, or
                                this flag is noise.
                              </TooltipContent>
                            </Tooltip>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <AlertCircle
                              className="size-3.5"
                              aria-hidden="true"
                            />
                            {flag.decided_at
                              ? `Decided ${new Date(flag.decided_at).toLocaleDateString('en-GB')}`
                              : 'Decision recorded'}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </TabsContent>
          ))}
        </Tabs>

        <Dialog open={rationaleOpen} onOpenChange={setRationaleOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add a decision rationale</DialogTitle>
              <DialogDescription>
                Optional but recommended — a short note explaining why this tag
                should be preserved or dismissed helps future reviewers.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="tag-morphology-rationale">Rationale</Label>
              <Textarea
                id="tag-morphology-rationale"
                rows={4}
                placeholder="e.g. Industry-specific term that the library mishandles…"
                value={rationale}
                onChange={(e) => setRationale(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button
                variant="ghost"
                onClick={() => {
                  setRationaleOpen(false);
                  setPendingAction(null);
                }}
              >
                Cancel
              </Button>
              <Button
                onClick={submitRationale}
                disabled={updating === pendingAction?.flagId}
              >
                {updating === pendingAction?.flagId ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : null}
                Save decision
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}
