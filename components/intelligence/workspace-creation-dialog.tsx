'use client';

import { useState, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useCompanyProfiles } from '@/hooks/intelligence/use-company-profiles';
import { useCreateIntelligenceWorkspace } from '@/hooks/intelligence/use-intelligence-workspaces';
import type { IntelligenceWorkspace } from '@/hooks/intelligence/use-intelligence-workspaces';
import Link from 'next/link';
import { Building2 } from 'lucide-react';

interface WorkspaceCreationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (workspace: IntelligenceWorkspace) => void;
}

export function WorkspaceCreationDialog({
  open,
  onOpenChange,
  onCreated,
}: WorkspaceCreationDialogProps) {
  const { data: profiles, isLoading: profilesLoading } = useCompanyProfiles();
  const createMutation = useCreateIntelligenceWorkspace();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [companyProfileId, setCompanyProfileId] = useState('');

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      createMutation.mutate(
        {
          name,
          description: description || undefined,
          company_profile_id: companyProfileId,
        },
        {
          onSuccess: (data) => {
            setName('');
            setDescription('');
            setCompanyProfileId('');
            onOpenChange(false);
            onCreated?.(data);
          },
        },
      );
    },
    [
      name,
      description,
      companyProfileId,
      createMutation,
      onOpenChange,
      onCreated,
    ],
  );

  const hasProfiles = profiles && profiles.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create Intelligence Workspace</DialogTitle>
          <DialogDescription>
            Set up a new intelligence stream to monitor sector and competitor
            news.
          </DialogDescription>
        </DialogHeader>

        {profilesLoading ? (
          <div className="py-8 text-center">
            <p className="text-sm text-muted-foreground">Loading profiles...</p>
          </div>
        ) : !hasProfiles ? (
          <div className="py-8 text-center">
            <Building2
              className="mx-auto mb-3 size-8 text-muted-foreground/50"
              aria-hidden="true"
            />
            <p className="text-sm font-medium text-foreground">
              Create a company profile first
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Intelligence workspaces require a company profile to configure
              relevance scoring.
            </p>
            <Button asChild className="mt-4" size="sm">
              <Link href="/intelligence/profiles">Go to Profiles</Link>
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Workspace name */}
            <div className="space-y-2">
              <Label htmlFor="ws-name">Workspace Name *</Label>
              <Input
                id="ws-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Education Sector Watch"
                required
              />
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label htmlFor="ws-description">Description</Label>
              <Textarea
                id="ws-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What this intelligence stream monitors"
                rows={2}
              />
            </div>

            {/* Company profile selector */}
            <div className="space-y-2">
              <Label htmlFor="ws-profile">Company Profile *</Label>
              <Select
                value={companyProfileId}
                onValueChange={setCompanyProfileId}
              >
                <SelectTrigger id="ws-profile" className="w-full">
                  <SelectValue placeholder="Select a company profile" />
                </SelectTrigger>
                <SelectContent>
                  {profiles?.map((profile) => (
                    <SelectItem key={profile.id} value={profile.id}>
                      {profile.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                The company profile defines what counts as relevant — sectors,
                services, and topics that matter to you.
              </p>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={
                  createMutation.isPending || !name || !companyProfileId
                }
              >
                {createMutation.isPending ? 'Creating...' : 'Create Workspace'}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
