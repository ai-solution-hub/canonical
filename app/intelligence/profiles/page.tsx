'use client';

import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Plus, Building2 } from 'lucide-react';
import { useUserRole } from '@/hooks/use-user-role';
import {
  useCompanyProfiles,
  useCreateCompanyProfile,
  useUpdateCompanyProfile,
  useDeleteCompanyProfile,
} from '@/hooks/intelligence/use-company-profiles';
import type {
  CompanyProfile,
  CompanyProfileInput,
} from '@/hooks/intelligence/use-company-profiles';
import { CompanyProfileForm } from '@/components/intelligence/company-profile-form';
import { CompanyProfileCard } from '@/components/intelligence/company-profile-card';

export default function CompanyProfilesPage() {
  const { canEdit, canAdmin, loading: roleLoading } = useUserRole();
  const { data: profiles, isLoading, error } = useCompanyProfiles();

  const createMutation = useCreateCompanyProfile();
  const deleteMutation = useDeleteCompanyProfile();

  const [showForm, setShowForm] = useState(false);
  const [editingProfile, setEditingProfile] = useState<CompanyProfile | null>(
    null,
  );

  const handleCreate = useCallback(
    (data: CompanyProfileInput) => {
      createMutation.mutate(data, {
        onSuccess: () => setShowForm(false),
      });
    },
    [createMutation],
  );

  const handleEdit = useCallback((profile: CompanyProfile) => {
    setEditingProfile(profile);
    setShowForm(true);
  }, []);

  const handleCancelForm = useCallback(() => {
    setShowForm(false);
    setEditingProfile(null);
  }, []);

  const handleDelete = useCallback(
    (id: string) => {
      deleteMutation.mutate(id);
    },
    [deleteMutation],
  );

  // Role gate
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
          You need editor or admin permissions to manage company profiles.
        </p>
      </div>
    );
  }

  return (
    <section
      aria-label="Company Profiles"
      className="mx-auto max-w-7xl px-4 py-8 sm:px-6"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Company Profiles
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Configure company context for intelligence scoring. Each profile
            defines sectors, services, and topics that determine article
            relevance.
          </p>
        </div>
        {canEdit && !showForm && (
          <Button onClick={() => setShowForm(true)} className="shrink-0">
            <Plus className="mr-1.5 size-4" />
            Create Profile
          </Button>
        )}
      </div>

      {/* Form (create or edit) */}
      {showForm && (
        <div className="mt-6">
          {editingProfile ? (
            <EditProfileFormWrapper
              profile={editingProfile}
              onCancel={handleCancelForm}
            />
          ) : (
            <CompanyProfileForm
              onSubmit={handleCreate}
              onCancel={handleCancelForm}
              isPending={createMutation.isPending}
            />
          )}
        </div>
      )}

      {/* Loading state */}
      {isLoading && (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="h-40 animate-pulse rounded-lg border bg-card"
              role="status"
              aria-label="Loading profile"
            >
              <span className="sr-only">Loading...</span>
            </div>
          ))}
        </div>
      )}

      {/* Error state */}
      {error && (
        <div
          className="mt-6 rounded-lg border border-destructive/50 bg-destructive/10 p-4"
          role="alert"
        >
          <p className="text-sm text-destructive">
            Failed to load company profiles. Please try refreshing.
          </p>
        </div>
      )}

      {/* Profile list */}
      {!isLoading && !error && profiles && (
        <>
          {profiles.length === 0 && !showForm ? (
            <div className="mt-12 text-center">
              <Building2
                className="mx-auto mb-4 size-10 text-muted-foreground/50"
                aria-hidden="true"
              />
              <h2 className="text-base font-medium text-foreground">
                No company profiles yet
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Create one to configure intelligence scoring.
              </p>
              <Button onClick={() => setShowForm(true)} className="mt-4">
                <Plus className="mr-1.5 size-4" />
                Create Profile
              </Button>
            </div>
          ) : (
            <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {profiles.map((profile) => (
                <CompanyProfileCard
                  key={profile.id}
                  profile={profile}
                  onEdit={() => handleEdit(profile)}
                  onDelete={() => handleDelete(profile.id)}
                  canAdmin={canAdmin}
                />
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

/** Wrapper to handle the update mutation for an individual profile */
function EditProfileFormWrapper({
  profile,
  onCancel,
}: {
  profile: CompanyProfile;
  onCancel: () => void;
}) {
  const updateMutation = useUpdateCompanyProfile(profile.id);

  const handleUpdate = useCallback(
    (data: CompanyProfileInput) => {
      updateMutation.mutate(data, {
        onSuccess: () => onCancel(),
      });
    },
    [updateMutation, onCancel],
  );

  return (
    <CompanyProfileForm
      initialData={profile}
      onSubmit={handleUpdate}
      onCancel={onCancel}
      isPending={updateMutation.isPending}
    />
  );
}
