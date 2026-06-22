'use client';

import { useState, useCallback } from 'react';
import { Loader2, Building2 } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { queryKeys } from '@/lib/query/query-keys';
import { mutationFetchJson } from '@/lib/query/fetchers';
import { useOrganisationProfile } from '@/hooks/use-organisation-profile';
import type { OrganisationProfile } from '@/lib/organisation-profile';
import { StringTagInput } from '@/components/shared/string-tag-input';

// ---------------------------------------------------------------------------
// Organisation form
// ---------------------------------------------------------------------------

interface OrganisationFormData {
  name: string;
  description?: string;
  website_url?: string;
  sectors: string[];
  services: string[];
  certifications: string[];
  geographic_scope: string[];
  key_topics: string[];
  target_customers?: string;
  value_proposition?: string;
}

function OrganisationForm({
  initialData,
  onSubmit,
  isPending,
}: {
  initialData: OrganisationProfile | null;
  onSubmit: (data: OrganisationFormData) => void;
  isPending: boolean;
}) {
  const [name, setName] = useState(initialData?.name ?? '');
  const [description, setDescription] = useState(
    initialData?.description ?? '',
  );
  const [websiteUrl, setWebsiteUrl] = useState(initialData?.website_url ?? '');
  const [sectors, setSectors] = useState<string[]>(initialData?.sectors ?? []);
  const [services, setServices] = useState<string[]>(
    initialData?.services ?? [],
  );
  const [keyTopics, setKeyTopics] = useState<string[]>(
    initialData?.key_topics ?? [],
  );
  const [certifications, setCertifications] = useState<string[]>(
    initialData?.certifications ?? [],
  );
  const [geographicScope, setGeographicScope] = useState<string[]>(
    initialData?.geographic_scope ?? [],
  );
  const [targetCustomers, setTargetCustomers] = useState(
    initialData?.target_customers ?? '',
  );
  const [valueProposition, setValueProposition] = useState(
    initialData?.value_proposition ?? '',
  );

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      onSubmit({
        name,
        description: description || undefined,
        website_url: websiteUrl || undefined,
        sectors,
        services,
        certifications,
        geographic_scope: geographicScope,
        key_topics: keyTopics,
        target_customers: targetCustomers || undefined,
        value_proposition: valueProposition || undefined,
      });
    },
    [
      name,
      description,
      websiteUrl,
      sectors,
      services,
      keyTopics,
      certifications,
      geographicScope,
      targetCustomers,
      valueProposition,
      onSubmit,
    ],
  );

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-4">
        {/* Name */}
        <div className="space-y-2">
          <Label htmlFor="org-name">Organisation Name *</Label>
          <Input
            id="org-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Acme Services Ltd"
            required
          />
        </div>

        {/* Description */}
        <div className="space-y-2">
          <Label htmlFor="org-description">Description</Label>
          <Textarea
            id="org-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Brief description of your organisation"
            rows={3}
          />
        </div>

        {/* Website */}
        <div className="space-y-2">
          <Label htmlFor="org-website">Website URL</Label>
          <Input
            id="org-website"
            type="url"
            value={websiteUrl}
            onChange={(e) => setWebsiteUrl(e.target.value)}
            placeholder="https://example.com"
          />
        </div>

        {/* Sectors */}
        <StringTagInput
          label="Sectors"
          required
          values={sectors}
          onChange={setSectors}
          placeholder="Type a sector and press Enter"
        />

        {/* Services */}
        <StringTagInput
          label="Services"
          values={services}
          onChange={setServices}
          placeholder="Type a service and press Enter"
        />

        {/* Certifications */}
        <StringTagInput
          label="Certifications"
          values={certifications}
          onChange={setCertifications}
          placeholder="e.g. ISO 27001, Cyber Essentials"
        />

        {/* Geographic Scope */}
        <StringTagInput
          label="Geographic Scope"
          values={geographicScope}
          onChange={setGeographicScope}
          placeholder="e.g. UK, Europe, Global"
        />

        {/* Key Topics */}
        <StringTagInput
          label="Key Topics"
          values={keyTopics}
          onChange={setKeyTopics}
          placeholder="Type a topic and press Enter"
        />

        {/* Target Customers */}
        <div className="space-y-2">
          <Label htmlFor="org-target-customers">Target Customers</Label>
          <Textarea
            id="org-target-customers"
            value={targetCustomers}
            onChange={(e) => setTargetCustomers(e.target.value)}
            placeholder="Describe your target customers"
            rows={2}
          />
        </div>

        {/* Value Proposition */}
        <div className="space-y-2">
          <Label htmlFor="org-value-proposition">Value Proposition</Label>
          <Textarea
            id="org-value-proposition"
            value={valueProposition}
            onChange={(e) => setValueProposition(e.target.value)}
            placeholder="What makes your organisation unique?"
            rows={2}
          />
        </div>
      </div>

      {/* Submit */}
      <div className="flex justify-end">
        <Button type="submit" disabled={isPending || !name.trim()}>
          {isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
          {initialData ? 'Save Changes' : 'Create Organisation Profile'}
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// OrganisationSection — Settings section component
// ---------------------------------------------------------------------------

export function OrganisationSection() {
  const { profile, isLoaded } = useOrganisationProfile();
  const queryClient = useQueryClient();

  const upsertMutation = useMutation({
    mutationFn: (data: OrganisationFormData) =>
      mutationFetchJson<{ profile: OrganisationProfile }>(
        '/api/organisation/profile',
        data,
        { method: 'PUT' },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.organisationProfile.all,
      });
      toast.success('Organisation profile saved');
    },
    onError: (err) => {
      toast.error(
        err instanceof Error ? err.message : 'Failed to save profile',
      );
    },
  });

  if (!isLoaded) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div data-testid="organisation-section">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-foreground">Organisation</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {profile
            ? 'Manage your organisation profile. This information is used across the platform to personalise your experience.'
            : 'Set up your organisation profile to personalise search, bid writing, and intelligence features.'}
        </p>
      </div>

      {!profile && (
        <div className="mb-6 flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border py-8 text-center">
          <Building2
            className="size-8 text-muted-foreground"
            aria-hidden="true"
          />
          <div>
            <p className="text-sm font-medium text-foreground">
              No organisation profile yet
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Complete the form below to get started.
            </p>
          </div>
        </div>
      )}

      <OrganisationForm
        key={profile?.id ?? 'new'}
        initialData={profile}
        onSubmit={(data) => upsertMutation.mutate(data)}
        isPending={upsertMutation.isPending}
      />
    </div>
  );
}
