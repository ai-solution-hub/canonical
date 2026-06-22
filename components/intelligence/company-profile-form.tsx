'use client';

import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { StringTagInput } from '@/components/shared/string-tag-input';
import type {
  CompanyProfile,
  CompanyProfileInput,
} from '@/hooks/intelligence/use-company-profiles';

interface CompanyProfileFormProps {
  initialData?: CompanyProfile;
  onSubmit: (data: CompanyProfileInput) => void;
  onCancel: () => void;
  isPending: boolean;
}

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

export function CompanyProfileForm({
  initialData,
  onSubmit,
  onCancel,
  isPending,
}: CompanyProfileFormProps) {
  const [name, setName] = useState(initialData?.name ?? '');
  const [slug, setSlug] = useState(initialData?.slug ?? '');
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(!!initialData);
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

  const handleNameChange = useCallback(
    (value: string) => {
      setName(value);
      if (!slugManuallyEdited) {
        setSlug(generateSlug(value));
      }
    },
    [slugManuallyEdited],
  );

  const handleSlugChange = useCallback((value: string) => {
    setSlugManuallyEdited(true);
    setSlug(value);
  }, []);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      onSubmit({
        name,
        slug,
        description: description || null,
        website_url: websiteUrl || null,
        sectors,
        services,
        certifications,
        geographic_scope: geographicScope,
        competitors: initialData?.competitors ?? [],
        target_customers: targetCustomers || null,
        value_proposition: valueProposition || null,
        key_topics: keyTopics,
      });
    },
    [
      name,
      slug,
      description,
      websiteUrl,
      sectors,
      services,
      keyTopics,
      certifications,
      geographicScope,
      targetCustomers,
      valueProposition,
      initialData?.competitors,
      onSubmit,
    ],
  );

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="rounded-lg border bg-card p-6 shadow-sm">
        <h3 className="mb-4 text-lg font-semibold text-foreground">
          {initialData ? 'Edit Company Profile' : 'Create Company Profile'}
        </h3>

        <div className="space-y-4">
          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="profile-name">Company Name *</Label>
            <Input
              id="profile-name"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="e.g. Acme Ltd"
              required
            />
          </div>

          {/* Slug */}
          <div className="space-y-2">
            <Label htmlFor="profile-slug">Slug *</Label>
            <Input
              id="profile-slug"
              value={slug}
              onChange={(e) => handleSlugChange(e.target.value)}
              placeholder="e.g. acme-ltd"
              pattern="^[a-z0-9-]+$"
              required
            />
            <p className="text-xs text-muted-foreground">
              Lowercase letters, numbers, and hyphens only
            </p>
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="profile-description">Description</Label>
            <Textarea
              id="profile-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description of the company"
              rows={3}
            />
          </div>

          {/* Website */}
          <div className="space-y-2">
            <Label htmlFor="profile-website">Website URL</Label>
            <Input
              id="profile-website"
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

          {/* Key Topics */}
          <StringTagInput
            label="Key Topics"
            required
            values={keyTopics}
            onChange={setKeyTopics}
            placeholder="Type a topic and press Enter"
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
            placeholder="e.g. UK, London, South East"
          />

          {/* Target Customers */}
          <div className="space-y-2">
            <Label htmlFor="profile-target-customers">Target Customers</Label>
            <Textarea
              id="profile-target-customers"
              value={targetCustomers}
              onChange={(e) => setTargetCustomers(e.target.value)}
              placeholder="Describe the ideal customer profile"
              rows={2}
            />
          </div>

          {/* Value Proposition */}
          <div className="space-y-2">
            <Label htmlFor="profile-value-prop">Value Proposition</Label>
            <Textarea
              id="profile-value-prop"
              value={valueProposition}
              onChange={(e) => setValueProposition(e.target.value)}
              placeholder="What makes this company unique"
              rows={2}
            />
          </div>
        </div>
      </div>

      <div className="flex items-center justify-end gap-3">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={
            isPending ||
            !name ||
            !slug ||
            sectors.length === 0 ||
            keyTopics.length === 0
          }
        >
          {isPending
            ? 'Saving...'
            : initialData
              ? 'Update Profile'
              : 'Create Profile'}
        </Button>
      </div>
    </form>
  );
}
