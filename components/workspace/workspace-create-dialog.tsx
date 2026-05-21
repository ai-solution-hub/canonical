'use client';

import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { WorkspaceColourPicker } from '@/components/workspace/workspace-colour-picker';
import { WorkspaceIconPicker } from '@/components/workspace/workspace-icon-picker';
import { useWorkspaceType } from '@/hooks/workspaces/use-application-types';
import type { Workspace } from '@/types/content';

interface WorkspaceCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (workspace: Workspace) => void;
  type?: string;
  onBidCreate?: () => void;
}

export function WorkspaceCreateDialog({
  open,
  onOpenChange,
  onCreated,
  // Post-T2 (S246 WP2b): `kb_section` was retired (no rows in either env)
  // and removed from `application_types`. Default to `procurement` so the
  // generic create dialog continues to function until the T4 UX redesign
  // adds a proper application_type selector.
  // TODO(T4): replace this defaulted prop with a required application_type
  // selector wired to `application_types` via a TanStack Query hook.
  type = 'procurement',
  onBidCreate,
}: WorkspaceCreateDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState('#d4880f');
  const [icon, setIcon] = useState('folder');
  const [submitting, setSubmitting] = useState(false);
  const [nameError, setNameError] = useState('');

  // ID-29.7: migrated from static getWorkspaceType() to useWorkspaceType() hook.
  // On first dialog open the hook may render once with `typeConfig === undefined`
  // before resolving (~50ms from cache). The existing `typeConfig?.label ?? 'Workspace'`
  // / `typeConfig?.description ?? 'Create a new workspace.'` fallbacks at L137/L139
  // cover that frame. The useEffect deps below already include `typeConfig`, so the
  // effect re-runs when the hook resolves and fires the custom-creation delegate.
  const { data: typeConfig } = useWorkspaceType(type);

  // When type has a custom creation flow, close the dialog and delegate
  useEffect(() => {
    if (open && typeConfig?.hasCustomCreation) {
      onOpenChange(false);
      onBidCreate?.();
    }
  }, [open, typeConfig, onOpenChange, onBidCreate]);

  function resetForm() {
    setName('');
    setDescription('');
    setColor('#d4880f');
    setIcon('folder');
    setNameError('');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError('Name is required');
      return;
    }

    setSubmitting(true);
    setNameError('');

    try {
      const res = await fetch('/api/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: trimmed,
          description: description.trim() || undefined,
          color,
          icon,
          type,
        }),
      });

      if (res.status === 409) {
        setNameError('A workspace with this name already exists');
        return;
      }

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || 'Failed to create workspace');
      }

      const workspace: Workspace = await res.json();
      toast(`Created "${workspace.name}"`, { duration: 2000 });
      resetForm();
      onOpenChange(false);
      onCreated(workspace);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to create section',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) resetForm();
        onOpenChange(v);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New {typeConfig?.label ?? 'Workspace'}</DialogTitle>
          <DialogDescription>
            {typeConfig?.description ?? 'Create a new workspace.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Name */}
          <div className="space-y-1.5">
            <Label htmlFor="workspace-name">Name</Label>
            <Input
              id="workspace-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (nameError) setNameError('');
              }}
              placeholder="Name"
              maxLength={200}
              autoFocus
            />
            {nameError && (
              <p className="text-xs text-destructive">{nameError}</p>
            )}
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <Label htmlFor="workspace-desc">Description</Label>
            <Textarea
              id="workspace-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description"
              rows={3}
              maxLength={2000}
            />
          </div>

          {/* Colour */}
          <div className="space-y-1.5">
            <Label>Colour</Label>
            <WorkspaceColourPicker value={color} onChange={setColor} />
          </div>

          {/* Icon */}
          <div className="space-y-1.5">
            <Label>Icon</Label>
            <WorkspaceIconPicker value={icon} onChange={setIcon} />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                resetForm();
                onOpenChange(false);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting
                ? 'Creating...'
                : `Create ${typeConfig?.label ?? 'Workspace'}`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
