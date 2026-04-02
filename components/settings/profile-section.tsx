'use client';

import { useState, useEffect, useRef } from 'react';
import { Info, Loader2 } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { useUserRole } from '@/hooks/use-user-role';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { roleBadgeVariant, roleLabel } from '@/lib/user-helpers';

export function ProfileSection() {
  const supabase = createClient();
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const { role } = useUserRole();

  // Track initial display name for dirty detection
  const initialDisplayNameRef = useRef('');
  const isDirty = displayName !== initialDisplayNameRef.current;

  useEffect(() => {
    async function loadProfile() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        setEmail(user.email ?? '');
        const name = (user.user_metadata?.display_name as string) ?? '';
        setDisplayName(name);
        initialDisplayNameRef.current = name;
      }
      setLoading(false);
    }
    loadProfile();
  }, [supabase]);

  // Unsaved changes warning
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isDirty && !saving) {
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty, saving]);

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({
        data: { display_name: displayName.trim() },
      });
      if (error) throw error;
      initialDisplayNameRef.current = displayName.trim();
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
        <h3 className="mb-1 flex items-center gap-1.5 text-base font-semibold">
          Profile Information
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="inline-flex items-center text-muted-foreground hover:text-foreground"
                  aria-label="More information about profile"
                >
                  <Info className="size-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-xs">
                Your display name appears on content you create or edit. Your
                role (viewer, editor, or admin) determines what you can change.
                Password must be at least 8 characters.
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          {isDirty && (
            <span
              className="ml-2 inline-block size-2 rounded-full bg-primary"
              aria-label="Unsaved changes"
            />
          )}
        </h3>
        <p className="mb-4 text-sm text-muted-foreground">
          Your name, role, and sign-in credentials.
        </p>
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
            <p className="text-sm font-medium leading-none">Role</p>
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
            <Button type="submit" disabled={saving || !isDirty}>
              {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
              Save Changes
            </Button>
          </div>
        </form>
      </Card>

      {/* Change password */}
      <Card className="p-6">
        <h3 className="mb-1 text-base font-semibold">Change Password</h3>
        <p className="mb-4 text-sm text-muted-foreground">
          Update your password to keep your account secure. Passwords must be at
          least 8 characters long.
        </p>
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
              aria-describedby={
                newPassword.length > 0 ? 'password-requirements' : undefined
              }
            />
            {newPassword.length > 0 && (
              <div
                id="password-requirements"
                className="mt-1.5 space-y-1"
                aria-live="polite"
              >
                <p
                  className={cn(
                    'text-xs',
                    newPassword.length >= 8
                      ? 'text-freshness-fresh'
                      : 'text-muted-foreground',
                  )}
                >
                  {newPassword.length >= 8 ? '\u2713' : '\u25CB'} At least 8
                  characters
                </p>
              </div>
            )}
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
            {confirmPassword.length > 0 && (
              <p
                className={cn(
                  'mt-1.5 text-xs',
                  newPassword === confirmPassword
                    ? 'text-freshness-fresh'
                    : 'text-destructive',
                )}
                aria-live="polite"
              >
                {newPassword === confirmPassword
                  ? '\u2713 Passwords match'
                  : '\u2717 Passwords do not match'}
              </p>
            )}
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
