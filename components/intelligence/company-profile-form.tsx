'use client';

import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { X } from 'lucide-react';
import type { CompanyProfile, CompanyProfileInput } from '@/hooks/intelligence/use-company-profiles';

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

/** Reusable tag input — type a value and press Enter to add it */
function TagInput({
  label,
  values,
  onChange,
  placeholder,
}: {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
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
      <Label>{label}</Label>
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

export function CompanyProfileForm({
  initialData,
  onSubmit,
  onCancel,
  isPending,
}: CompanyProfileFormProps) {
  const [name, setName] = useState(initialData?.name ?? '');
  const [slug, setSlug] = useState(initialData?.slug ?? '');
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(!!initialData);
  const [description, setDescription] = useState(initialData?.description ?? '');
  const [websiteUrl, setWebsiteUrl] = useState(initialData?.website_url ?? '');
  const [sectors, setSectors] = useState<string[]>(initialData?.sectors ?? []);
  const [services, setServices] = useState<string[]>(initialData?.services ?? []);
  const [keyTopics, setKeyTopics] = useState<string[]>(initialData?.key_topics ?? []);
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
        description: description || undefined,
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
              placeholder="e.g. example-client Design"
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
              placeholder="e.g. example-client-design"
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
          <TagInput
            label="Sectors *"
            values={sectors}
            onChange={setSectors}
            placeholder="Type a sector and press Enter"
          />

          {/* Key Topics */}
          <TagInput
            label="Key Topics *"
            values={keyTopics}
            onChange={setKeyTopics}
            placeholder="Type a topic and press Enter"
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
        <Button type="submit" disabled={isPending || !name || !slug || sectors.length === 0 || keyTopics.length === 0}>
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
