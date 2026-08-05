'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Users,
  Loader2,
  UserPlus,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
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
import { Label } from '@/components/ui/label';
import type { ContentOwnerStats } from '@/types/owner';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EnrichedOwnerStats extends ContentOwnerStats {
  display_name?: string;
}

interface TeamMember {
  id: string;
  email: string;
  display_name: string | null;
  role: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getDisplayName(owner: EnrichedOwnerStats): string {
  if (owner.display_name?.trim()) return owner.display_name.trim();
  return owner.owner_id.slice(0, 8) + '...';
}

function freshnessVariant(
  count: number,
  type: 'stale' | 'expired',
): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (count === 0) return 'outline';
  if (type === 'expired') return 'destructive';
  return 'secondary';
}

// ---------------------------------------------------------------------------
// Content Owner Management Section
// ---------------------------------------------------------------------------

export function ContentOwnerManagement() {
  const [stats, setStats] = useState<EnrichedOwnerStats[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [ownerId, setOwnerId] = useState('');
  const [saving, setSaving] = useState(false);

  // Fetch owner stats
  const fetchStats = useCallback(async () => {
    try {
      const response = await fetch('/api/content-owners/stats');
      if (!response.ok) {
        throw new Error('Failed to fetch owner stats');
      }
      const data = await response.json();
      setStats(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to fetch owner stats:', err);
      toast.error('Failed to load content owner statistics');
    }
  }, []);

  // Fetch team members for owner selection
  const fetchTeamMembers = useCallback(async () => {
    try {
      const supabase = createClient();
      // id-369 F9: a dropped `error` here rendered an EMPTY owner dropdown,
      // so an admin concluded there were no team members. Surface it instead.
      const { data: roles, error } = await supabase
        .from('user_roles')
        .select('user_id, role')
        .in('role', ['admin', 'editor']);

      if (error) throw error;

      if (!roles || roles.length === 0) {
        setTeamMembers([]);
        return;
      }

      // Fetch display names
      const response = await fetch('/api/users/display-names', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: roles.map((r) => r.user_id) }),
      });

      const names: Record<string, string> = response.ok
        ? await response.json()
        : {};

      setTeamMembers(
        roles.map((r) => ({
          id: r.user_id,
          email: names[r.user_id] ?? r.user_id.slice(0, 8),
          display_name: names[r.user_id] ?? null,
          role: r.role as string,
        })),
      );
    } catch (err) {
      console.error('Failed to fetch team members:', err);
      // Without this the dropdown just renders empty and the admin reads it as
      // "no team members exist" — the exact F9 wrong conclusion. Mirrors the
      // `fetchStats` failure path above.
      toast.error('Failed to load team members');
    }
  }, []);

  useEffect(() => {
    async function init() {
      setLoading(true);
      await Promise.all([fetchStats(), fetchTeamMembers()]);
      setLoading(false);
    }
    init();
  }, [fetchStats, fetchTeamMembers]);

  // Handle assign action — unowned items only (the former by-domain scope
  // retired with the subject taxonomy, DR-130)
  async function handleAssign() {
    if (!ownerId) {
      toast.error('Please select an owner');
      return;
    }

    setSaving(true);
    try {
      const filter: Record<string, unknown> = { unowned_only: true };

      const response = await fetch('/api/content-owners/bulk-assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filter, owner_id: ownerId }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error ?? 'Failed to assign');
      }

      const result = await response.json();
      toast.success(`Assigned ${result.items_updated} unowned items`);
      setDialogOpen(false);
      resetForm();
      await fetchStats();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to assign content',
      );
    } finally {
      setSaving(false);
    }
  }

  function resetForm() {
    setOwnerId('');
  }

  function getTeamMemberLabel(member: TeamMember): string {
    return member.display_name?.trim() || member.email;
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Users className="size-5 text-muted-foreground" aria-hidden="true" />
          <h2 className="text-lg font-semibold">Content Owners</h2>
        </div>
        <div className="flex items-center justify-center py-8">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="size-5 text-muted-foreground" aria-hidden="true" />
          <h2 className="text-lg font-semibold">Content Owners</h2>
        </div>
        {/* Assign owner dialog */}
        <Dialog
          open={dialogOpen}
          onOpenChange={(open) => {
            setDialogOpen(open);
            if (!open) resetForm();
          }}
        >
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5">
              <UserPlus className="size-4" />
              Assign owner
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Assign content owner</DialogTitle>
              <DialogDescription>
                Assign unowned content items to a team member.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              {/* Owner picker */}
              <div className="space-y-2">
                <Label htmlFor="assign-owner">Owner</Label>
                <Select value={ownerId} onValueChange={setOwnerId}>
                  <SelectTrigger id="assign-owner">
                    <SelectValue placeholder="Select owner" />
                  </SelectTrigger>
                  <SelectContent>
                    {teamMembers.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {getTeamMemberLabel(m)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setDialogOpen(false);
                  resetForm();
                }}
              >
                Cancel
              </Button>
              <Button onClick={handleAssign} disabled={saving || !ownerId}>
                {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
                Assign
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Description */}
      <p className="text-sm text-muted-foreground">
        Content owners receive targeted notifications when their content becomes
        stale or needs governance review. Assign owners to ensure the right
        person is notified.
      </p>

      {/* Owner stats table */}
      {stats.length === 0 ? (
        <Card className="p-6 text-center">
          <CheckCircle2
            className="mx-auto mb-2 size-8 text-muted-foreground"
            aria-hidden="true"
          />
          <p className="text-sm font-medium text-foreground">
            No content owners assigned yet
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Use the Assign owner button above to assign content to a team
            member.
          </p>
        </Card>
      ) : (
        <div className="overflow-x-auto">
          <table
            className="w-full text-sm"
            aria-label="Content owner statistics"
          >
            <thead>
              <tr className="border-b border-border text-left">
                <th className="pb-2 pr-4 font-medium text-muted-foreground">
                  Owner
                </th>
                <th className="pb-2 pr-4 text-right font-medium text-muted-foreground">
                  Total
                </th>
                <th className="pb-2 pr-4 text-right font-medium text-muted-foreground">
                  Fresh
                </th>
                <th className="pb-2 pr-4 text-right font-medium text-muted-foreground">
                  Ageing
                </th>
                <th className="pb-2 pr-4 text-right font-medium text-muted-foreground">
                  Stale
                </th>
                <th className="pb-2 text-right font-medium text-muted-foreground">
                  Expired
                </th>
              </tr>
            </thead>
            <tbody>
              {stats.map((owner) => {
                const needsAttention = owner.stale_count + owner.expired_count;
                return (
                  <tr
                    key={owner.owner_id}
                    className="border-b border-border last:border-0"
                  >
                    <td className="py-3 pr-4">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-foreground">
                          {getDisplayName(owner)}
                        </span>
                        {needsAttention > 0 && (
                          <AlertTriangle
                            className="size-4 text-status-warning"
                            aria-label={`${needsAttention} items need attention`}
                          />
                        )}
                      </div>
                    </td>
                    <td className="py-3 pr-4 text-right text-foreground">
                      {owner.total_items}
                    </td>
                    <td className="py-3 pr-4 text-right">
                      <Badge variant="outline" className="text-quality-good">
                        {owner.fresh_count}
                      </Badge>
                    </td>
                    <td className="py-3 pr-4 text-right">
                      <Badge variant="outline">{owner.aging_count}</Badge>
                    </td>
                    <td className="py-3 pr-4 text-right">
                      <Badge
                        variant={freshnessVariant(owner.stale_count, 'stale')}
                      >
                        {owner.stale_count}
                      </Badge>
                    </td>
                    <td className="py-3 text-right">
                      <Badge
                        variant={freshnessVariant(
                          owner.expired_count,
                          'expired',
                        )}
                      >
                        {owner.expired_count}
                      </Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
