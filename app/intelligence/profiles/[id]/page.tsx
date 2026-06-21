'use client';

import { useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
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
import { Building2, ChevronLeft, Globe, Pencil, Trash2 } from 'lucide-react';
import { useUserRole } from '@/hooks/use-user-role';
import {
  useCompanyProfile,
  useUpdateCompanyProfile,
  useDeleteCompanyProfile,
} from '@/hooks/intelligence/use-company-profiles';
import type {
  CompanyProfile,
  CompanyProfileInput,
} from '@/hooks/intelligence/use-company-profiles';
import { CompanyProfileForm } from '@/components/intelligence/company-profile-form';

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

const BACK_LINK = (
  <Link
    href="/intelligence/profiles"
    className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
  >
    <ChevronLeft className="size-3.5" aria-hidden="true" />
    Company Profiles
  </Link>
);

export default function CompanyProfileDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const router = useRouter();

  const { canEdit, canAdmin, loading: roleLoading } = useUserRole();
  const { data: profile, isLoading, error } = useCompanyProfile(id);
  const updateMutation = useUpdateCompanyProfile(id);
  const deleteMutation = useDeleteCompanyProfile();

  const [isEditing, setIsEditing] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const { mutate: updateProfile } = updateMutation;
  const handleUpdate = useCallback(
    (data: CompanyProfileInput) => {
      updateProfile(data, { onSuccess: () => setIsEditing(false) });
    },
    [updateProfile],
  );

  const { mutate: deleteProfile } = deleteMutation;
  const handleDelete = useCallback(() => {
    deleteProfile(id, {
      onSuccess: () => router.push('/intelligence/profiles'),
    });
  }, [deleteProfile, id, router]);

  // Role gate — mirrors the list page (defence-in-depth; the route also enforces).
  if (!roleLoading && !canEdit) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-24 text-center sm:px-6">
        <Building2
          className="mx-auto mb-4 size-10 text-muted-foreground/50"
          aria-hidden="true"
        />
        <h2 className="text-lg font-semibold text-foreground">
          Access restricted
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          You need editor or admin permissions to view company profiles.
        </p>
      </div>
    );
  }

  return (
    <section
      aria-label="Company Profile"
      className="mx-auto max-w-7xl px-4 py-8 sm:px-6"
    >
      <div className="mb-6">{BACK_LINK}</div>

      {isLoading && (
        <div
          className="h-64 animate-pulse rounded-lg border bg-card"
          role="status"
          aria-label="Loading company profile"
        >
          <span className="sr-only">Loading...</span>
        </div>
      )}

      {error && (
        <div
          className="rounded-lg border border-destructive/50 bg-destructive/10 p-4"
          role="alert"
        >
          <p className="text-sm text-destructive">
            This company profile could not be found. It may have been removed.
          </p>
        </div>
      )}

      {!isLoading && !error && profile && (
        <>
          {/* Header */}
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-2xl font-bold tracking-tight text-foreground">
                {profile.name}
              </h1>
              {profile.website_url && (
                <a
                  href={profile.website_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
                >
                  <Globe className="size-3.5" aria-hidden="true" />
                  {profile.website_url.replace(/^https?:\/\//, '')}
                </a>
              )}
            </div>
            {!isEditing && (
              <div className="flex shrink-0 items-center gap-2">
                {canEdit && (
                  <Button
                    variant="outline"
                    onClick={() => setIsEditing(true)}
                    className="shrink-0"
                  >
                    <Pencil className="mr-1.5 size-3.5" />
                    Edit
                  </Button>
                )}
                {canAdmin && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setShowDeleteDialog(true)}
                    aria-label={`Delete ${profile.name}`}
                    className="size-9 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </div>
            )}
          </div>

          {isEditing ? (
            <div className="mt-6">
              <CompanyProfileForm
                initialData={profile}
                onSubmit={handleUpdate}
                onCancel={() => setIsEditing(false)}
                isPending={updateMutation.isPending}
              />
            </div>
          ) : (
            <ReadOnlyView profile={profile} />
          )}
        </>
      )}

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove company profile?</AlertDialogTitle>
            <AlertDialogDescription>
              This will archive the profile
              {profile ? (
                <>
                  {' '}
                  for <strong>{profile.name}</strong>
                </>
              ) : null}
              . Existing intelligence workspaces linked to this profile will
              still function but no new workspaces can be created with it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

/** Badge list with an empty-state fallback. */
function BadgeGroup({
  label,
  values,
  variant = 'outline',
}: {
  label: string;
  values: string[];
  variant?: 'secondary' | 'outline';
}) {
  return (
    <div>
      <h2 className="text-sm font-semibold text-foreground">{label}</h2>
      {values.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {values.map((value) => (
            <Badge key={value} variant={variant} className="text-xs">
              {value}
            </Badge>
          ))}
        </div>
      ) : (
        <p className="mt-1 text-sm text-muted-foreground">None</p>
      )}
    </div>
  );
}

/** Read-only paragraph field with an em-dash fallback. */
function TextField({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <h2 className="text-sm font-semibold text-foreground">{label}</h2>
      <p className="mt-1 whitespace-pre-line text-sm text-muted-foreground">
        {value ? value : '—'}
      </p>
    </div>
  );
}

function ReadOnlyView({ profile }: { profile: CompanyProfile }) {
  return (
    <div className="mt-6 space-y-6">
      <div className="rounded-lg border bg-card p-6 shadow-sm">
        <TextField label="Description" value={profile.description} />
      </div>

      <div className="grid grid-cols-1 gap-6 rounded-lg border bg-card p-6 shadow-sm sm:grid-cols-2">
        <BadgeGroup
          label="Sectors"
          values={profile.sectors}
          variant="secondary"
        />
        <BadgeGroup label="Key Topics" values={profile.key_topics} />
        <BadgeGroup label="Services" values={profile.services} />
        <BadgeGroup label="Certifications" values={profile.certifications} />
        <BadgeGroup
          label="Geographic Scope"
          values={profile.geographic_scope}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 rounded-lg border bg-card p-6 shadow-sm sm:grid-cols-2">
        <TextField label="Target Customers" value={profile.target_customers} />
        <TextField
          label="Value Proposition"
          value={profile.value_proposition}
        />
      </div>

      <div className="rounded-lg border bg-card p-6 shadow-sm">
        <h2 className="text-sm font-semibold text-foreground">Competitors</h2>
        {profile.competitors.length > 0 ? (
          <ul className="mt-2 space-y-2">
            {profile.competitors.map((competitor, index) => (
              <li
                key={`${competitor.name}-${index}`}
                className="text-sm text-foreground"
              >
                {competitor.website ? (
                  <a
                    href={competitor.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium hover:text-muted-foreground"
                  >
                    {competitor.name}
                  </a>
                ) : (
                  <span className="font-medium">{competitor.name}</span>
                )}
                {competitor.notes && (
                  <span className="text-muted-foreground">
                    {' '}
                    — {competitor.notes}
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">None</p>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Updated {formatDate(profile.updated_at)}
      </p>
    </div>
  );
}
