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
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [guideType, setGuideType] = useState<string>('sector');
  const [saving, setSaving] = useState(false);
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);

  // Populate form when editing
  useEffect(() => {
    if (guide) {
      setName(guide.name);
      setSlug(guide.slug);
      setDescription(guide.description ?? '');
      setGuideType(guide.guide_type);
      setSlugManuallyEdited(true);
    } else {
      setName('');
      setSlug('');
      setDescription('');
      setGuideType('sector');
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
      // The vocabulary-backed domain_filter picker retired with the
      // subject taxonomy (DR-130). The guides.domain_filter COLUMN is not
      // dropping this wave (DR-126's membership predicate is undesigned),
      // so an existing value persists untouched: the PATCH body simply
      // omits the key.
      const body = {
        name: name.trim(),
        slug: slug.trim(),
        description: description.trim() || undefined,
        guide_type: guideType,
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
