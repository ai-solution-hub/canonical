'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { ShieldCheck, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import { Separator } from '@/components/ui/separator';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GovernanceConfigEntry {
  id: string;
  domain: string;
  posture: string;
  reviewer_id: string | null;
  timeout_days: number | null;
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
  const [editDomain, setEditDomain] = useState('');
  const [editPosture, setEditPosture] = useState<'open' | 'review_on_change'>('open');
  const [editTimeoutDays, setEditTimeoutDays] = useState('7');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [recalculating, setRecalculating] = useState(false);
  const [lastRecalcAt, setLastRecalcAt] = useState<string | null>(null);

  // Track initial dialog values for dirty detection
  const initialDialogRef = useRef({ domain: '', posture: 'open', timeout: '7' });
  const isDialogDirty = dialogOpen && (
    editDomain !== initialDialogRef.current.domain ||
    editPosture !== initialDialogRef.current.posture ||
    editTimeoutDays !== initialDialogRef.current.timeout
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
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to save');
      }

      toast.success('Governance configuration saved');
      setDialogOpen(false);
      setEditDomain('');
      setEditPosture('open');
      setEditTimeoutDays('7');
      fetchConfigs();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to save governance config',
      );
    } finally {
      setSaving(false);
    }
  }

  function handleEdit(config: GovernanceConfigEntry) {
    const domain = config.domain;
    const posture = config.posture as 'open' | 'review_on_change';
    const timeout = String(config.timeout_days ?? 7);
    setEditDomain(domain);
    setEditPosture(posture);
    setEditTimeoutDays(timeout);
    initialDialogRef.current = { domain, posture, timeout };
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
      toast.success(
        `Freshness recalculated: ${result.updated} items updated`,
      );
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
          <h3 id="governance-config-heading" className="text-base font-semibold">
            Governance Configuration
            {isDialogDirty && (
              <span
                className="ml-2 inline-block size-2 rounded-full bg-primary"
                aria-label="Unsaved changes"
              />
            )}
          </h3>
          <p className="text-sm text-muted-foreground">
            Set review posture per domain. &quot;Open&quot; allows changes freely.
            &quot;Review on Change&quot; requires review after edits.
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button
              size="sm"
              onClick={() => {
                setEditDomain('');
                setEditPosture('open');
                setEditTimeoutDays('7');
                initialDialogRef.current = { domain: '', posture: 'open', timeout: '7' };
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
            <ShieldCheck className="size-8 text-muted-foreground/50" aria-hidden="true" />
            <p className="text-sm font-medium text-foreground">No governance rules configured</p>
            <p className="text-xs text-muted-foreground">
              All domains use the &quot;Open&quot; posture by default. Add rules to enforce freshness and ownership.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border" role="list" aria-labelledby="governance-config-heading">
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
