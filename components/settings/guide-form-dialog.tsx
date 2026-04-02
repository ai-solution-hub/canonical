'use client';

import { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { useTaxonomy } from '@/contexts/taxonomy-context';
import { VALID_GUIDE_TYPES } from '@/lib/validation/guide-schemas';
import { type Guide, GUIDE_TYPE_LABELS, generateSlug } from './guide-types';

// ---------------------------------------------------------------------------
// Guide form dialog
// ---------------------------------------------------------------------------

export function GuideFormDialog({
  open,
  onOpenChange,
  guide,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  guide: Guide | null;
  onSave: () => void;
}) {
  const { domains } = useTaxonomy();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [guideType, setGuideType] = useState<string>('sector');
  const [domainFilter, setDomainFilter] = useState<string>('none');
  const [saving, setSaving] = useState(false);
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);

  // Populate form when editing
  useEffect(() => {
    if (guide) {
      setName(guide.name);
      setSlug(guide.slug);
      setDescription(guide.description ?? '');
      setGuideType(guide.guide_type);
      setDomainFilter(guide.domain_filter ?? 'none');
      setSlugManuallyEdited(true);
    } else {
      setName('');
      setSlug('');
      setDescription('');
      setGuideType('sector');
      setDomainFilter('none');
      setSlugManuallyEdited(false);
    }
  }, [guide, open]);

  // Auto-generate slug from name
  const handleNameChange = (value: string) => {
    setName(value);
    if (!slugManuallyEdited) {
      setSlug(generateSlug(value));
    }
  };

  const handleSave = async () => {
    if (!name.trim() || !slug.trim()) {
      toast.error('Name and slug are required');
      return;
    }

    setSaving(true);
    try {
      const body = {
        name: name.trim(),
        slug: slug.trim(),
        description: description.trim() || undefined,
        guide_type: guideType,
        domain_filter:
          domainFilter && domainFilter !== 'none' ? domainFilter : undefined,
      };

      const res = guide
        ? await fetch(`/api/guides/${encodeURIComponent(guide.slug)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          })
        : await fetch('/api/guides', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? 'Failed to save guide');
        return;
      }

      toast.success(guide ? 'Guide updated' : 'Guide created');
      onSave();
      onOpenChange(false);
    } catch {
      toast.error('Failed to save guide');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{guide ? 'Edit Guide' : 'Create Guide'}</DialogTitle>
          <DialogDescription>
            {guide
              ? 'Update the guide details below.'
              : 'Define a new curated guide for your knowledge base.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <label
              htmlFor="guide-name"
              className="text-xs font-medium text-muted-foreground"
            >
              Name
            </label>
            <Input
              id="guide-name"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="e.g. SCP Sector Guide"
              className="mt-1"
            />
          </div>

          <div>
            <label
              htmlFor="guide-slug"
              className="text-xs font-medium text-muted-foreground"
            >
              Slug
            </label>
            <Input
              id="guide-slug"
              value={slug}
              onChange={(e) => {
                setSlug(e.target.value);
                setSlugManuallyEdited(true);
              }}
              placeholder="e.g. scp-sector"
              className="mt-1"
            />
          </div>

          <div>
            <label
              htmlFor="guide-description"
              className="text-xs font-medium text-muted-foreground"
            >
              Description
            </label>
            <Input
              id="guide-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description"
              className="mt-1"
            />
          </div>

          <div>
            <label
              htmlFor="guide-type"
              className="text-xs font-medium text-muted-foreground"
            >
              Type
            </label>
            <Select value={guideType} onValueChange={setGuideType}>
              <SelectTrigger id="guide-type" className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VALID_GUIDE_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {GUIDE_TYPE_LABELS[type] ?? type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label
              htmlFor="guide-domain"
              className="text-xs font-medium text-muted-foreground"
            >
              Domain Filter
            </label>
            <Select value={domainFilter} onValueChange={setDomainFilter}>
              <SelectTrigger id="guide-domain" className="mt-1">
                <SelectValue placeholder="None (cross-domain)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None (cross-domain)</SelectItem>
                {domains.map((d) => (
                  <SelectItem key={d.name} value={d.name}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
            {guide ? 'Save Changes' : 'Create Guide'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
