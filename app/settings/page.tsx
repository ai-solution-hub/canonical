'use client';

export const dynamic = 'force-dynamic';

import { Suspense, useState, useEffect, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Settings, Users, User, Shield, Loader2, UserPlus, MoreHorizontal, Ban, ShieldCheck, Activity } from 'lucide-react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { useUserRole } from '@/hooks/use-user-role';
import type { UserRole } from '@/lib/roles';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Separator } from '@/components/ui/separator';
import { ActivityFeed } from '@/components/activity-feed';

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
// Role badge helpers
// ---------------------------------------------------------------------------

function roleBadgeVariant(role: string): 'default' | 'secondary' | 'outline' {
  switch (role) {
    case 'admin':
      return 'default';
    case 'editor':
      return 'secondary';
    default:
      return 'outline';
  }
}

function roleLabel(role: string): string {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

function formatDate(dateString: string | null): string {
  if (!dateString) return 'Never';
  return new Date(dateString).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

// ---------------------------------------------------------------------------
// Profile Tab
// ---------------------------------------------------------------------------

function ProfileTab() {
  const supabase = createClient();
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const { role } = useUserRole();

  useEffect(() => {
    async function loadProfile() {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setEmail(user.email ?? '');
        setDisplayName((user.user_metadata?.display_name as string) ?? '');
      }
      setLoading(false);
    }
    loadProfile();
  }, [supabase]);

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({
        data: { display_name: displayName.trim() },
      });
      if (error) throw error;
      toast.success('Profile updated successfully');
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to update profile',
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword.length < 8) {
      toast.error('Password must be at least 8 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }
    setChangingPassword(true);
    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });
      if (error) throw error;
      toast.success('Password changed successfully');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to change password',
      );
    } finally {
      setChangingPassword(false);
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
    <div className="flex flex-col gap-6">
      {/* Profile information */}
      <Card className="p-6">
        <h3 className="mb-4 text-base font-semibold">Profile Information</h3>
        <form onSubmit={handleSaveProfile} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              disabled
              className="bg-muted"
            />
            <p className="text-xs text-muted-foreground">
              Email cannot be changed. Contact an admin if needed.
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="display-name">Display Name</Label>
            <Input
              id="display-name"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Your name"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Role</Label>
            <div>
              <Badge variant={roleBadgeVariant(role ?? 'viewer')}>
                {roleLabel(role ?? 'viewer')}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              Your role is managed by an administrator.
            </p>
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
              Save Changes
            </Button>
          </div>
        </form>
      </Card>

      {/* Change password */}
      <Card className="p-6">
        <h3 className="mb-4 text-base font-semibold">Change Password</h3>
        <form onSubmit={handleChangePassword} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-password">New Password</Label>
            <Input
              id="new-password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Minimum 8 characters"
              minLength={8}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="confirm-password">Confirm Password</Label>
            <Input
              id="confirm-password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Re-enter your new password"
              minLength={8}
              required
            />
          </div>
          <div className="flex justify-end">
            <Button type="submit" variant="outline" disabled={changingPassword}>
              {changingPassword && (
                <Loader2 className="mr-2 size-4 animate-spin" />
              )}
              Change Password
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
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

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to invite user');
      }

      toast.success(`Invitation sent to ${email.trim()}`);
      setEmail('');
      setRole('viewer');
      setDisplayName('');
      setOpen(false);
      onInvited();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to invite user',
      );
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
            <Select
              value={role}
              onValueChange={(v) => setRole(v as UserRole)}
            >
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
              Viewers can read. Editors can read and write. Admins have full access.
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
// Team Tab
// ---------------------------------------------------------------------------

function TeamTab() {
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const supabase = createClient();

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/users');
      if (!res.ok) {
        throw new Error('Failed to load team members');
      }
      const data = await res.json();
      setUsers(data);
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
      const { data: { user } } = await supabase.auth.getUser();
      if (user) setCurrentUserId(user.id);
    }
    loadCurrentUser();
  }, [fetchUsers, supabase]);

  async function handleRoleChange(userId: string, newRole: UserRole) {
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
  }

  async function handleDeactivate(userId: string) {
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
          <h3 className="text-base font-semibold">Team Members</h3>
          <p className="text-sm text-muted-foreground">
            {users.length} {users.length === 1 ? 'member' : 'members'}
          </p>
        </div>
        <InviteUserDialog onInvited={fetchUsers} />
      </div>

      <Card>
        {/* Desktop table header */}
        <div className="hidden border-b border-border px-4 py-3 sm:grid sm:grid-cols-[1fr_1fr_120px_120px_48px] sm:gap-4">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            User
          </span>
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Email
          </span>
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Role
          </span>
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Last Sign In
          </span>
          <span className="sr-only">Actions</span>
        </div>

        {users.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
            <Users className="size-8" />
            <p className="text-sm">No team members found</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {users.map((user) => {
              const isSelf = user.id === currentUserId;
              return (
                <div
                  key={user.id}
                  className="flex flex-col gap-2 px-4 py-3 sm:grid sm:grid-cols-[1fr_1fr_120px_120px_48px] sm:items-center sm:gap-4"
                >
                  {/* Name */}
                  <div className="flex items-center gap-2">
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium uppercase text-muted-foreground">
                      {(user.display_name ?? user.email)?.[0] ?? '?'}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {user.display_name ?? 'No name'}
                        {isSelf && (
                          <span className="ml-1.5 text-xs text-muted-foreground">
                            (you)
                          </span>
                        )}
                      </p>
                      {/* Mobile: show email inline */}
                      <p className="truncate text-xs text-muted-foreground sm:hidden">
                        {user.email}
                      </p>
                    </div>
                  </div>

                  {/* Email (desktop) */}
                  <p className="hidden truncate text-sm text-muted-foreground sm:block">
                    {user.email}
                  </p>

                  {/* Role */}
                  <div>
                    {isSelf ? (
                      <Badge variant={roleBadgeVariant(user.role)}>
                        {roleLabel(user.role)}
                      </Badge>
                    ) : (
                      <Select
                        value={user.role}
                        onValueChange={(v) =>
                          handleRoleChange(user.id, v as UserRole)
                        }
                      >
                        <SelectTrigger size="sm" className="h-7 w-[100px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="viewer">Viewer</SelectItem>
                          <SelectItem value="editor">Editor</SelectItem>
                          <SelectItem value="admin">Admin</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  </div>

                  {/* Last sign in */}
                  <p className="text-xs text-muted-foreground sm:text-sm">
                    {formatDate(user.last_sign_in_at)}
                  </p>

                  {/* Actions */}
                  <div>
                    {!isSelf && (
                      <AlertDialog>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8"
                              aria-label={`Actions for ${user.display_name ?? user.email}`}
                            >
                              <MoreHorizontal className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <AlertDialogTrigger asChild>
                              <DropdownMenuItem className="text-destructive focus:text-destructive">
                                <Ban className="mr-2 size-4" />
                                Deactivate
                              </DropdownMenuItem>
                            </AlertDialogTrigger>
                          </DropdownMenuContent>
                        </DropdownMenu>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>
                              Deactivate User
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                              Are you sure you want to deactivate{' '}
                              <strong>
                                {user.display_name ?? user.email}
                              </strong>
                              ? They will no longer be able to sign in.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => handleDeactivate(user.id)}
                              className="bg-destructive text-white hover:bg-destructive/90"
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
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Governance Tab (admin-only)
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

function GovernanceTab() {
  const [configs, setConfigs] = useState<GovernanceConfigEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editDomain, setEditDomain] = useState('');
  const [editPosture, setEditPosture] = useState<'open' | 'review_on_change'>('open');
  const [editTimeoutDays, setEditTimeoutDays] = useState('7');
  const [dialogOpen, setDialogOpen] = useState(false);

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

  useEffect(() => {
    fetchConfigs();
  }, [fetchConfigs]);

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
    setEditDomain(config.domain);
    setEditPosture(config.posture as 'open' | 'review_on_change');
    setEditTimeoutDays(String(config.timeout_days ?? 7));
    setDialogOpen(true);
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
          <h3 className="text-base font-semibold">Governance Configuration</h3>
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
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
            <ShieldCheck className="size-8" />
            <p className="text-sm">
              No governance configuration yet. All domains use &quot;Open&quot;
              posture by default.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {configs.map((config) => (
              <div
                key={config.id}
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
    </div>
  );
}

// ---------------------------------------------------------------------------
// Settings Page
// ---------------------------------------------------------------------------

function SettingsContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { loading, canAdmin } = useUserRole();
  const tabParam = searchParams.get('tab');
  const defaultTab =
    (tabParam === 'team' || tabParam === 'governance' || tabParam === 'activity') && canAdmin
      ? tabParam
      : 'profile';

  function handleTabChange(value: string) {
    const newParams = new URLSearchParams(searchParams.toString());
    newParams.set('tab', value);
    router.replace(`/settings?${newParams.toString()}`, { scroll: false });
  }

  if (loading) {
    return (
      <div className="mx-auto flex max-w-3xl items-center justify-center px-4 py-16 sm:px-6">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex items-center gap-3">
        <Settings className="size-6 text-muted-foreground" />
        <div>
          <h1 className="text-xl font-semibold">Settings</h1>
          <p className="text-sm text-muted-foreground">
            Manage your profile and team
          </p>
        </div>
      </div>

      <Tabs value={defaultTab} onValueChange={handleTabChange}>
        <TabsList>
          <TabsTrigger value="profile">
            <User className="mr-1.5 size-3.5" />
            Profile
          </TabsTrigger>
          {canAdmin && (
            <TabsTrigger value="team">
              <Shield className="mr-1.5 size-3.5" />
              Team
            </TabsTrigger>
          )}
          {canAdmin && (
            <TabsTrigger value="governance">
              <ShieldCheck className="mr-1.5 size-3.5" />
              Governance
            </TabsTrigger>
          )}
          {canAdmin && (
            <TabsTrigger value="activity">
              <Activity className="mr-1.5 size-3.5" />
              Activity
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="profile" className="mt-6">
          <ProfileTab />
        </TabsContent>

        {canAdmin && (
          <TabsContent value="team" className="mt-6">
            <TeamTab />
          </TabsContent>
        )}

        {canAdmin && (
          <TabsContent value="governance" className="mt-6">
            <GovernanceTab />
          </TabsContent>
        )}

        {canAdmin && (
          <TabsContent value="activity" className="mt-6">
            <div className="flex flex-col gap-4">
              <div>
                <h3 className="text-base font-semibold">Activity Log</h3>
                <p className="text-sm text-muted-foreground">
                  Recent edits, rollbacks, and quality events across the knowledge base.
                </p>
              </div>
              <ActivityFeed />
            </div>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

function SettingsPageSkeleton() {
  return (
    <div className="mx-auto flex max-w-3xl items-center justify-center px-4 py-16 sm:px-6">
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<SettingsPageSkeleton />}>
      <SettingsContent />
    </Suspense>
  );
}
