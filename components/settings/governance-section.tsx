'use client';

import { useState, useEffect, useCallback } from 'react';
import { ShieldCheck, Loader2, Info } from 'lucide-react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Separator } from '@/components/ui/separator';
import {
  TooltipProvider,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip';
import { ConceptHelp } from '@/components/ui/concept-help';
import { useTaxonomy } from '@/contexts/taxonomy-context';
import {
  PRESET_LABELS,
  inferPreset,
  type GovernancePreset,
} from '@/lib/governance/presets';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GovernanceConfigEntry {
  id: string;
  domain: string;
  posture: string;
  preset: string | null;
  reviewer_id: string | null;
  timeout_days: number | null;
  quality_score_threshold: number | null;
  auto_flag_on_quality_drop: boolean | null;
  auto_flag_on_freshness_transition: boolean | null;
  auto_flag_cooldown_days: number | null;
  created_at: string | null;
  updated_at: string | null;
}

// ---------------------------------------------------------------------------
// Governance Section
// ---------------------------------------------------------------------------

export function GovernanceSection() {
  const [configs, setConfigs] = useState<GovernanceConfigEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingDomain, setEditingDomain] = useState<string | null>(null);
  const [selectedDomain, setSelectedDomain] = useState('');
  const [selectedPreset, setSelectedPreset] =
    useState<GovernancePreset>('light_touch');
  const [recalculating, setRecalculating] = useState(false);
  const [lastRecalcAt, setLastRecalcAt] = useState<string | null>(null);

  const { domains: taxonomyDomains, loading: taxonomyLoading } = useTaxonomy();

  // Domains already configured — exclude from the "Add" dropdown
  const configuredDomainNames = new Set(configs.map((c) => c.domain));
  const availableDomains = taxonomyDomains.filter(
    (d) => !configuredDomainNames.has(d.name),
  );

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
      // ID-131 {131.19} G-GOV-FACET: content_items is dying —
      // freshness_checked_at now lives on the record_lifecycle facet
      // (owner_kind='source_document', SD-only freshness axis per D7).
      // Ratified TECH.md E3 — this client-side consumer is kept + repointed.
      const supabase = createClient();
      const { data } = await supabase
        .from('record_lifecycle')
        .select('freshness_checked_at')
        .eq('owner_kind', 'source_document')
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

  function resetDialogState() {
    setEditingDomain(null);
    setSelectedDomain('');
    setSelectedPreset('light_touch');
  }

  function handleEdit(config: GovernanceConfigEntry) {
    setEditingDomain(config.domain);
    setSelectedDomain(config.domain);
    setSelectedPreset(
      (config.preset as GovernancePreset) ?? inferPreset(config.posture),
    );
    setDialogOpen(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const domain = editingDomain ?? selectedDomain;
    if (!domain) return;

    setSaving(true);
    try {
      const res = await fetch('/api/governance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain,
          preset: selectedPreset,
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

  /**
   * Resolve a preset label for display. Falls back to inferPreset
   * for rows that were created before the preset column existed.
   */
  function getPresetForConfig(config: GovernanceConfigEntry): GovernancePreset {
    return (config.preset as GovernancePreset) ?? inferPreset(config.posture);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const isEditing = editingDomain !== null;

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
                  Choose a governance preset per domain.
                  &ldquo;Light-touch&rdquo; lets edits land immediately;
                  &ldquo;Strict&rdquo; holds edits for review and automatically
                  flags stale or low-quality items.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
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
              }}
            >
              Add Domain
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {isEditing ? 'Edit Governance Config' : 'Add Governance Config'}
              </DialogTitle>
              <DialogDescription>
                Choose a governance preset for this domain.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSave} className="flex flex-col gap-4">
              {/* Domain selection */}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="gov-domain">Domain</Label>
                {isEditing ? (
                  <p className="text-sm font-medium">{editingDomain}</p>
                ) : taxonomyLoading ? (
                  <p className="text-sm text-muted-foreground">
                    Loading domains...
                  </p>
                ) : availableDomains.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {taxonomyDomains.length === 0
                      ? 'No taxonomy domains configured. Add domains in the taxonomy settings first.'
                      : 'All taxonomy domains already have governance rules configured.'}
                  </p>
                ) : (
                  <Select
                    value={selectedDomain}
                    onValueChange={setSelectedDomain}
                  >
                    <SelectTrigger id="gov-domain">
                      <SelectValue placeholder="Select a domain" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableDomains.map((d) => (
                        <SelectItem key={d.id} value={d.name}>
                          {d.display_name || d.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              {/* Preset selection */}
              <div className="flex flex-col gap-1.5">
                <Label>Preset</Label>
                <RadioGroup
                  value={selectedPreset}
                  onValueChange={(v) =>
                    setSelectedPreset(v as GovernancePreset)
                  }
                  className="grid gap-3"
                >
                  {(
                    Object.entries(PRESET_LABELS) as [
                      GovernancePreset,
                      (typeof PRESET_LABELS)[GovernancePreset],
                    ][]
                  ).map(([key, label]) => (
                    <label
                      key={key}
                      htmlFor={`preset-${key}`}
                      className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 transition-colors has-[:checked]:border-primary has-[:checked]:bg-primary/5"
                    >
                      <RadioGroupItem
                        value={key}
                        id={`preset-${key}`}
                        className="mt-0.5"
                      />
                      <div className="flex-1">
                        <p className="text-sm font-medium">{label.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {label.description}
                        </p>
                      </div>
                    </label>
                  ))}
                </RadioGroup>
              </div>

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDialogOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={
                    saving ||
                    (!isEditing && !selectedDomain) ||
                    (!isEditing && availableDomains.length === 0)
                  }
                >
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
              Add a domain and choose a preset to get started.
            </p>
          </div>
        ) : (
          <div
            className="divide-y divide-border"
            role="list"
            aria-labelledby="governance-config-heading"
          >
            {configs.map((config) => {
              const preset = getPresetForConfig(config);
              const label = PRESET_LABELS[preset];
              return (
                <div
                  key={config.id}
                  role="listitem"
                  className="flex items-center justify-between px-4 py-3"
                >
                  <div>
                    <p className="text-sm font-medium">{config.domain}</p>
                    <p className="text-xs text-muted-foreground">
                      {label.description}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={
                        preset === 'light_touch' ? 'secondary' : 'default'
                      }
                    >
                      {label.name}
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
              );
            })}
          </div>
        )}
      </Card>

      <Separator className="my-2" />

      <div>
        <h3 className="flex items-center gap-1.5 text-base font-semibold">
          Content Freshness
          <ConceptHelp concept="freshness" />
        </h3>
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
