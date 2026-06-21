'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Pencil, Trash2, Globe, Tag, Briefcase, Star } from 'lucide-react';
import type { CompanyProfile } from '@/hooks/intelligence/use-company-profiles';

interface CompanyProfileCardProps {
  profile: CompanyProfile & { is_primary?: boolean };
  onEdit: () => void;
  onDelete: () => void;
  canAdmin: boolean;
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function CompanyProfileCard({
  profile,
  onEdit,
  onDelete,
  canAdmin,
}: CompanyProfileCardProps) {
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  return (
    <>
      <div className="rounded-lg border bg-card p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-base font-semibold text-foreground">
                <Link
                  href={`/intelligence/profiles/${profile.id}`}
                  className="hover:text-muted-foreground"
                >
                  {profile.name}
                </Link>
              </h3>
              {profile.is_primary && (
                <Badge variant="default" className="shrink-0 gap-1 text-xs">
                  <Star className="size-3" aria-hidden="true" />
                  Primary
                </Badge>
              )}
            </div>
            {profile.website_url && (
              <a
                href={profile.website_url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <Globe className="size-3" aria-hidden="true" />
                {profile.website_url.replace(/^https?:\/\//, '')}
              </a>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={onEdit}
              aria-label={`Edit ${profile.name}`}
              className="size-8"
            >
              <Pencil className="size-3.5" />
            </Button>
            {canAdmin && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowDeleteDialog(true)}
                aria-label={`Delete ${profile.name}`}
                className="size-8 text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="size-3.5" />
              </Button>
            )}
          </div>
        </div>

        {profile.description && (
          <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
            {profile.description}
          </p>
        )}

        {/* Sectors */}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {profile.sectors.map((sector) => (
            <Badge key={sector} variant="secondary" className="text-xs">
              {sector}
            </Badge>
          ))}
        </div>

        {/* Stats row */}
        <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
          {profile.services.length > 0 && (
            <span className="flex items-center gap-1">
              <Briefcase className="size-3" aria-hidden="true" />
              {profile.services.length} service
              {profile.services.length !== 1 ? 's' : ''}
            </span>
          )}
          <span className="flex items-center gap-1">
            <Tag className="size-3" aria-hidden="true" />
            {profile.key_topics.length} topic
            {profile.key_topics.length !== 1 ? 's' : ''}
          </span>
          <span className="ml-auto">
            Updated {formatDate(profile.updated_at)}
          </span>
        </div>
      </div>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove company profile?</AlertDialogTitle>
            <AlertDialogDescription>
              This will archive the profile for <strong>{profile.name}</strong>.
              Existing intelligence workspaces linked to this profile will still
              function but no new workspaces can be created with it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={onDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
