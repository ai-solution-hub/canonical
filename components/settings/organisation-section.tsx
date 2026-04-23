'use client';

import { useState, useCallback } from 'react';
import { Loader2, X, Building2 } from 'lucide-react';
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

// ---------------------------------------------------------------------------
// Tag input (adapted from SI company-profile-form)
// ---------------------------------------------------------------------------

function TagInput({
  label,
  values,
  onChange,
  placeholder,
  required,
}: {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  required?: boolean;
}) {
  const [input, setInput] = useState('');

  const addTag = useCallback(() => {
    const trimmed = input.trim();
    if (trimmed && !values.includes(trimmed)) {
      onChange([...values, trimmed]);
    }
    setInput('');
  }, [input, values, onChange]);

  const removeTag = useCallback(
    (index: number) => {
      onChange(values.filter((_, i) => i !== index));
    },
    [values, onChange],
  );

  return (
    <div className="space-y-2">
      <Label>
        {label}
        {required && ' *'}
      </Label>
      <div className="flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addTag();
            }
          }}
          placeholder={placeholder}
          className="flex-1"
        />
        <Button type="button" variant="outline" size="sm" onClick={addTag}>
          Add
        </Button>
      </div>
      {values.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {values.map((tag, i) => (
            <span
              key={`${tag}-${i}`}
              className="inline-flex items-center gap-1 rounded-md border bg-accent px-2 py-0.5 text-xs text-foreground"
            >
              {tag}
              <button
                type="button"
                onClick={() => removeTag(i)}
                className="text-muted-foreground hover:text-foreground"
                aria-label={`Remove ${tag}`}
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

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
        <TagInput
          label="Sectors"
          required
          values={sectors}
          onChange={setSectors}
          placeholder="Type a sector and press Enter"
        />

        {/* Services */}
        <TagInput
          label="Services"
          values={services}
          onChange={setServices}
          placeholder="Type a service and press Enter"
        />

        {/* Certifications */}
        <TagInput
          label="Certifications"
          values={certifications}
          onChange={setCertifications}
          placeholder="e.g. ISO 27001, Cyber Essentials"
        />

        {/* Geographic Scope */}
        <TagInput
          label="Geographic Scope"
          values={geographicScope}
          onChange={setGeographicScope}
          placeholder="e.g. UK, Europe, Global"
        />

        {/* Key Topics */}
        <TagInput
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
          <Building2 className="size-8 text-muted-foreground" aria-hidden="true" />
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
        initialData={profile}
        onSubmit={(data) => upsertMutation.mutate(data)}
        isPending={upsertMutation.isPending}
      />
    </div>
  );
}
