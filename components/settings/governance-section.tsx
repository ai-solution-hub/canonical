'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { ShieldCheck, Loader2, Info } from 'lucide-react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import {
  TooltipProvider,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GovernanceConfigEntry {
  id: string;
  domain: string;
  posture: string;
  reviewer_id: string | null;
  timeout_days: number | null;
  quality_score_threshold: number | null;
  auto_flag_on_quality_drop: boolean | null;
  auto_flag_on_freshness_transition: boolean | null;
  auto_flag_cooldown_days: number | null;
  created_at: string | null;
  updated_at: string | null;
}

interface InitialDialogState {
  domain: string;
  posture: string;
  timeout: string;
  autoFlagQuality: boolean;
  autoFlagFreshness: boolean;
  cooldownDays: string;
  qualityThreshold: string;
}

// ---------------------------------------------------------------------------
// Governance Section
// ---------------------------------------------------------------------------

export function GovernanceSection() {
  const [configs, setConfigs] = useState<GovernanceConfigEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editDomain, setEditDomain] = useState('');
  const [editPosture, setEditPosture] = useState<'open' | 'review_on_change'>(
    'open',
  );
  const [editTimeoutDays, setEditTimeoutDays] = useState('7');
  const [editAutoFlagQuality, setEditAutoFlagQuality] = useState(false);
  const [editAutoFlagFreshness, setEditAutoFlagFreshness] = useState(false);
  const [editCooldownDays, setEditCooldownDays] = useState('7');
  const [editQualityThreshold, setEditQualityThreshold] = useState('40');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [recalculating, setRecalculating] = useState(false);
  const [lastRecalcAt, setLastRecalcAt] = useState<string | null>(null);

  // Track initial dialog values for dirty detection
  const initialDialogRef = useRef<InitialDialogState>({
    domain: '',
    posture: 'open',
    timeout: '7',
    autoFlagQuality: false,
    autoFlagFreshness: false,
    cooldownDays: '7',
    qualityThreshold: '40',
  });
  const isDialogDirty =
    dialogOpen &&
    (editDomain !== initialDialogRef.current.domain ||
      editPosture !== initialDialogRef.current.posture ||
      editTimeoutDays !== initialDialogRef.current.timeout ||
      editAutoFlagQuality !== initialDialogRef.current.autoFlagQuality ||
      editAutoFlagFreshness !== initialDialogRef.current.autoFlagFreshness ||
      editCooldownDays !== initialDialogRef.current.cooldownDays ||
      editQualityThreshold !== initialDialogRef.current.qualityThreshold);

  const fetchConfigs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/governance');
      if (!res.ok) throw new Error('Failed to load');
      const data = await res.json();
      setConfigs(data);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to load governance config',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchLastFreshnessCheck = useCallback(async () => {
    try {
      const supabase = createClient();
      const { data } = await supabase
        .from('content_items')
        .select('freshness_checked_at')
        .not('freshness_checked_at', 'is', null)
        .order('freshness_checked_at', { ascending: false })
        .limit(1)
        .single();
      if (data?.freshness_checked_at) {
        setLastRecalcAt(data.freshness_checked_at);
      }
    } catch {
      // Non-critical -- just means we won't show "Last run"
    }
  }, []);

  useEffect(() => {
    fetchConfigs();
    fetchLastFreshnessCheck();
  }, [fetchConfigs, fetchLastFreshnessCheck]);

  // Unsaved changes warning
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isDialogDirty && !saving) {
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDialogDirty, saving]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!editDomain.trim()) return;

    setSaving(true);
    try {
      const res = await fetch('/api/governance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: editDomain.trim(),
          posture: editPosture,
          timeout_days: parseInt(editTimeoutDays, 10) || 7,
          auto_flag_on_quality_drop: editAutoFlagQuality,
          auto_flag_on_freshness_transition: editAutoFlagFreshness,
          auto_flag_cooldown_days: parseInt(editCooldownDays, 10) || 7,
          quality_score_threshold: parseInt(editQualityThreshold, 10) || 40,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to save');
      }

      toast.success('Governance configuration saved');
      setDialogOpen(false);
      resetDialogState();
      fetchConfigs();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to save governance config',
      );
    } finally {
      setSaving(false);
    }
  }

  function resetDialogState() {
    setEditDomain('');
    setEditPosture('open');
    setEditTimeoutDays('7');
    setEditAutoFlagQuality(false);
    setEditAutoFlagFreshness(false);
    setEditCooldownDays('7');
    setEditQualityThreshold('40');
  }

  function handleEdit(config: GovernanceConfigEntry) {
    const domain = config.domain;
    const posture = config.posture as 'open' | 'review_on_change';
    const timeout = String(config.timeout_days ?? 7);
    const autoFlagQuality = config.auto_flag_on_quality_drop ?? false;
    const autoFlagFreshness = config.auto_flag_on_freshness_transition ?? false;
    const cooldownDays = String(config.auto_flag_cooldown_days ?? 7);
    const qualityThreshold = String(config.quality_score_threshold ?? 40);

    setEditDomain(domain);
    setEditPosture(posture);
    setEditTimeoutDays(timeout);
    setEditAutoFlagQuality(autoFlagQuality);
    setEditAutoFlagFreshness(autoFlagFreshness);
    setEditCooldownDays(cooldownDays);
    setEditQualityThreshold(qualityThreshold);
    initialDialogRef.current = {
      domain,
      posture,
      timeout,
      autoFlagQuality,
      autoFlagFreshness,
      cooldownDays,
      qualityThreshold,
    };
    setDialogOpen(true);
  }

  async function handleRecalculateFreshness() {
    setRecalculating(true);
    try {
      const res = await fetch('/api/freshness/recalculate-all', {
        method: 'POST',
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to recalculate');
      }
      const result = await res.json();
      toast.success(`Freshness recalculated: ${result.updated} items updated`);
      setLastRecalcAt(result.recalculated_at);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to recalculate freshness',
      );
    } finally {
      setRecalculating(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h3
            id="governance-config-heading"
            className="flex items-center gap-1.5 text-base font-semibold"
          >
            Quality Review Rules
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex items-center text-muted-foreground hover:text-foreground"
                    aria-label="More information about quality review rules"
                  >
                    <Info className="size-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-xs">
                  &ldquo;Open&rdquo; posture means anyone can edit without
                  review. &ldquo;Review on Change&rdquo; means edits are flagged
                  for a reviewer before being accepted. The timeout sets how
                  many days a review can sit before it auto-approves. Freshness
                  recalculation checks whether content has gone stale based on
                  its type (e.g. policies expire faster than case studies).
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            {isDialogDirty && (
              <span
                className="ml-2 inline-block size-2 rounded-full bg-primary"
                aria-label="Unsaved changes"
              />
            )}
          </h3>
          <p className="text-sm text-muted-foreground">
            Rules that determine when content changes need a second pair of
            eyes, plus freshness monitoring.
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button
              size="sm"
              onClick={() => {
                resetDialogState();
                initialDialogRef.current = {
                  domain: '',
                  posture: 'open',
                  timeout: '7',
                  autoFlagQuality: false,
                  autoFlagFreshness: false,
                  cooldownDays: '7',
                  qualityThreshold: '40',
                };
              }}
            >
              Add Domain
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {editDomain ? 'Edit Governance' : 'Add Governance Config'}
              </DialogTitle>
              <DialogDescription>
                Configure governance posture for a domain.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSave} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="gov-domain">Domain</Label>
                <Input
                  id="gov-domain"
                  value={editDomain}
                  onChange={(e) => setEditDomain(e.target.value)}
                  placeholder="e.g. Technology & Systems"
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="gov-posture">Posture</Label>
                <Select
                  value={editPosture}
                  onValueChange={(v) =>
                    setEditPosture(v as 'open' | 'review_on_change')
                  }
                >
                  <SelectTrigger id="gov-posture">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="open">Open</SelectItem>
                    <SelectItem value="review_on_change">
                      Review on Change
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {editPosture === 'review_on_change' && (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="gov-timeout">Review Timeout (days)</Label>
                  <Input
                    id="gov-timeout"
                    type="number"
                    min="1"
                    max="365"
                    value={editTimeoutDays}
                    onChange={(e) => setEditTimeoutDays(e.target.value)}
                  />
                </div>
              )}

              <Separator />

              <div className="flex flex-col gap-3">
                <p className="text-sm font-medium">Automated Governance</p>
                <p className="text-xs text-muted-foreground">
                  Automatically flag items for governance review when quality or
                  freshness thresholds are breached.
                </p>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="gov-quality-threshold">
                    Quality Score Threshold
                  </Label>
                  <Input
                    id="gov-quality-threshold"
                    type="number"
                    min="0"
                    max="100"
                    value={editQualityThreshold}
                    onChange={(e) => setEditQualityThreshold(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Items scoring below this value are flagged for attention
                    (0-100).
                  </p>
                </div>

                <div className="flex items-center justify-between gap-4">
                  <div className="flex-1">
                    <Label htmlFor="gov-auto-flag-quality" className="text-sm">
                      Auto-flag on quality drop
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Send items to governance review when their quality score
                      drops below threshold.
                    </p>
                  </div>
                  <Switch
                    id="gov-auto-flag-quality"
                    checked={editAutoFlagQuality}
                    onCheckedChange={setEditAutoFlagQuality}
                  />
                </div>

                <div className="flex items-center justify-between gap-4">
                  <div className="flex-1">
                    <Label
                      htmlFor="gov-auto-flag-freshness"
                      className="text-sm"
                    >
                      Auto-flag on freshness transition
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Send items to governance review when they transition to
                      stale or expired.
                    </p>
                  </div>
                  <Switch
                    id="gov-auto-flag-freshness"
                    checked={editAutoFlagFreshness}
                    onCheckedChange={setEditAutoFlagFreshness}
                  />
                </div>

                {(editAutoFlagQuality || editAutoFlagFreshness) && (
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="gov-cooldown">Cooldown Period (days)</Label>
                    <Input
                      id="gov-cooldown"
                      type="number"
                      min="1"
                      max="90"
                      value={editCooldownDays}
                      onChange={(e) => setEditCooldownDays(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      Don&apos;t re-flag items that were auto-flagged within
                      this many days (1-90).
                    </p>
                  </div>
                )}
              </div>

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDialogOpen(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={saving}>
                  {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
                  Save
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        {configs.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
            <ShieldCheck
              className="size-8 text-muted-foreground/50"
              aria-hidden="true"
            />
            <p className="text-sm font-medium text-foreground">
              No governance rules configured
            </p>
            <p className="text-xs text-muted-foreground">
              All domains use the &quot;Open&quot; posture by default. Add rules
              to enforce freshness and ownership.
            </p>
          </div>
        ) : (
          <div
            className="divide-y divide-border"
            role="list"
            aria-labelledby="governance-config-heading"
          >
            {configs.map((config) => (
              <div
                key={config.id}
                role="listitem"
                className="flex items-center justify-between px-4 py-3"
              >
                <div>
                  <p className="text-sm font-medium">{config.domain}</p>
                  <p className="text-xs text-muted-foreground">
                    {config.posture === 'open' ? 'Open' : 'Review on Change'}
                    {config.posture === 'review_on_change' &&
                      ` (${config.timeout_days ?? 7} day timeout)`}
                  </p>
                  {(config.auto_flag_on_quality_drop ||
                    config.auto_flag_on_freshness_transition) && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Auto-flag:{' '}
                      {[
                        config.auto_flag_on_quality_drop && 'quality drop',
                        config.auto_flag_on_freshness_transition && 'freshness',
                      ]
                        .filter(Boolean)
                        .join(', ')}{' '}
                      ({config.auto_flag_cooldown_days ?? 7}d cooldown)
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Badge
                    variant={
                      config.posture === 'open' ? 'secondary' : 'default'
                    }
                  >
                    {config.posture === 'open' ? 'Open' : 'Review'}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleEdit(config)}
                  >
                    Edit
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Separator className="my-2" />

      <div>
        <h3 className="text-base font-semibold">Content Freshness</h3>
        <p className="text-sm text-muted-foreground">
          Recalculate freshness states for all content items based on their
          lifecycle type and last update date.
        </p>
      </div>

      <Card className="flex items-center justify-between px-4 py-4">
        <div className="text-sm text-muted-foreground">
          {lastRecalcAt ? (
            <>
              Last run:{' '}
              {new Date(lastRecalcAt).toLocaleDateString('en-GB', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              })}{' '}
              at{' '}
              {new Date(lastRecalcAt).toLocaleTimeString('en-GB', {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </>
          ) : (
            'Never run'
          )}
        </div>
        <Button
          size="sm"
          onClick={handleRecalculateFreshness}
          disabled={recalculating}
        >
          {recalculating && <Loader2 className="mr-2 size-4 animate-spin" />}
          {recalculating ? 'Recalculating...' : 'Recalculate Now'}
        </Button>
      </Card>
    </div>
  );
}
