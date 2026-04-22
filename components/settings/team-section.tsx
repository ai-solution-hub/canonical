'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Users, Loader2, UserPlus, Ban } from 'lucide-react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import type { UserRole } from '@/lib/roles';
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { roleBadgeVariant, roleLabel } from '@/lib/user-helpers';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TeamUser {
  id: string;
  email: string;
  display_name: string | null;
  role: string;
  created_at: string;
  last_sign_in_at: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(dateString: string | null): string {
  if (!dateString) return 'Never';
  return new Date(dateString).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function getDisplayFallback(user: TeamUser): string {
  if (user.display_name?.trim()) return user.display_name.trim();
  const atIndex = user.email.indexOf('@');
  return atIndex > 0 ? user.email.slice(0, atIndex) : user.email;
}

// ---------------------------------------------------------------------------
// Invite User Dialog
// ---------------------------------------------------------------------------

function InviteUserDialog({ onInvited }: { onInvited: () => void }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<UserRole>('viewer');
  const [displayName, setDisplayName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;

    setSubmitting(true);
    try {
      const res = await fetch('/api/admin/users/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          role,
          display_name: displayName.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to invite user');
      }

      const warnings = Array.isArray(data.warnings) ? data.warnings : [];
      if (warnings.length > 0) {
        toast.warning(`Invitation sent with warnings: ${warnings.join('; ')}`);
      } else {
        toast.success(`Invitation sent to ${email.trim()}`);
      }
      setEmail('');
      setRole('viewer');
      setDisplayName('');
      setOpen(false);
      onInvited();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to invite user');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <UserPlus className="mr-2 size-4" />
          Invite User
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite User</DialogTitle>
          <DialogDescription>
            Send an invitation email to add a new team member.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleInvite} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="invite-email">Email Address</Label>
            <Input
              id="invite-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="invite-name">Display Name</Label>
            <Input
              id="invite-name"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Optional"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="invite-role">Role</Label>
            <Select value={role} onValueChange={(v) => setRole(v as UserRole)}>
              <SelectTrigger id="invite-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="viewer">Viewer</SelectItem>
                <SelectItem value="editor">Editor</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Viewers can read. Editors can read and write. Admins have full
              access.
            </p>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="mr-2 size-4 animate-spin" />}
              Send Invitation
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Team Member Row — single responsive layout for all viewports
// ---------------------------------------------------------------------------

function TeamMemberRow({
  user,
  isSelf,
  onRoleChange,
  onDeactivate,
}: {
  user: TeamUser;
  isSelf: boolean;
  onRoleChange: (userId: string, newRole: UserRole) => void;
  onDeactivate: (userId: string) => void;
}) {
  return (
    <div
      role="listitem"
      className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4"
    >
      {/* Avatar + identity */}
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium uppercase text-muted-foreground">
          {getDisplayFallback(user)[0]?.toUpperCase() ?? '?'}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {getDisplayFallback(user)}
            {isSelf && (
              <span className="ml-1.5 text-xs text-muted-foreground">
                (you)
              </span>
            )}
          </p>
          <p className="truncate text-xs text-muted-foreground">{user.email}</p>
        </div>
      </div>

      {/* Role + last sign-in + deactivate — responsive row */}
      <div className="flex items-center gap-3 pl-11 sm:gap-4 sm:pl-0">
        {/* Role */}
        {isSelf ? (
          <Badge variant={roleBadgeVariant(user.role)}>
            {roleLabel(user.role)}
          </Badge>
        ) : (
          <Select
            value={user.role}
            onValueChange={(v) => onRoleChange(user.id, v as UserRole)}
          >
            <SelectTrigger
              size="sm"
              className="h-7 w-[100px]"
              aria-label={`Role for ${getDisplayFallback(user)}`}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="viewer">Viewer</SelectItem>
              <SelectItem value="editor">Editor</SelectItem>
              <SelectItem value="admin">Admin</SelectItem>
            </SelectContent>
          </Select>
        )}

        {/* Last sign-in — hidden on small screens to save space */}
        <span className="hidden whitespace-nowrap text-xs text-muted-foreground sm:inline">
          {formatDate(user.last_sign_in_at)}
        </span>

        {/* Deactivate — inline button with confirm dialog */}
        {!isSelf && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
                aria-label={`Deactivate ${getDisplayFallback(user)}`}
              >
                <Ban className="size-3.5" />
                <span className="hidden sm:inline">Deactivate</span>
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Deactivate User</AlertDialogTitle>
                <AlertDialogDescription>
                  Are you sure you want to deactivate{' '}
                  <strong>{user.display_name ?? user.email}</strong>? They will
                  no longer be able to sign in.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => onDeactivate(user.id)}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Deactivate
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Team Section
// ---------------------------------------------------------------------------

export function TeamSection() {
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const supabase = useMemo(() => createClient(), []);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/users');
      if (!res.ok) {
        throw new Error('Failed to load team members');
      }
      const data = await res.json();
      if (Array.isArray(data)) {
        setUsers(data);
      } else {
        console.warn('Expected array from /api/admin/users, got:', typeof data);
        setUsers([]);
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to load team members',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
    async function loadCurrentUser() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) setCurrentUserId(user.id);
    }
    loadCurrentUser();
  }, [fetchUsers, supabase]);

  const handleRoleChange = useCallback(
    async (userId: string, newRole: UserRole) => {
      try {
        const res = await fetch(`/api/admin/users/${userId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: newRole }),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || 'Failed to update role');
        }
        setUsers((prev) =>
          prev.map((u) => (u.id === userId ? { ...u, role: newRole } : u)),
        );
        toast.success('Role updated');
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : 'Failed to update role',
        );
      }
    },
    [],
  );

  const handleDeactivate = useCallback(
    async (userId: string) => {
      try {
        const res = await fetch(`/api/admin/users/${userId}`, {
          method: 'DELETE',
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || 'Failed to deactivate user');
        }
        toast.success('User deactivated');
        fetchUsers();
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : 'Failed to deactivate user',
        );
      }
    },
    [fetchUsers],
  );

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
          <h3 className="text-base font-semibold">Team Members</h3>
          <p className="text-sm text-muted-foreground">
            {users.length} {users.length === 1 ? 'member' : 'members'}
          </p>
        </div>
        <InviteUserDialog onInvited={fetchUsers} />
      </div>

      <Card>
        {users.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
            <Users
              className="size-8 text-muted-foreground/50"
              aria-hidden="true"
            />
            <p className="text-sm font-medium text-foreground">
              No team members found
            </p>
            <p className="text-xs text-muted-foreground">
              Invite team members to collaborate on your knowledge base.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border" role="list">
            {users.map((user) => (
              <TeamMemberRow
                key={user.id}
                user={user}
                isSelf={user.id === currentUserId}
                onRoleChange={handleRoleChange}
                onDeactivate={handleDeactivate}
              />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
