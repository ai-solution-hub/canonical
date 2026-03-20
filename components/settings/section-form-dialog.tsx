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
import { useLayerVocabulary } from '@/contexts/layer-vocabulary-context';
import { type GuideSection } from './guide-types';

// ---------------------------------------------------------------------------
// Section form dialog
// ---------------------------------------------------------------------------

export function SectionFormDialog({
  open,
  onOpenChange,
  guideSlug,
  section,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  guideSlug: string;
  section: GuideSection | null;
  onSave: () => void;
}) {
  const { subtopics } = useTaxonomy();
  const { layers: layerVocabulary } = useLayerVocabulary();
  const [sectionName, setSectionName] = useState('');
  const [description, setDescription] = useState('');
  const [expectedLayer, setExpectedLayer] = useState<string>('none');
  const [subtopicFilter, setSubtopicFilter] = useState<string>('none');
  const [isRequired, setIsRequired] = useState(true);
  const [displayOrder, setDisplayOrder] = useState(0);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (section) {
      setSectionName(section.section_name);
      setDescription(section.description ?? '');
      setExpectedLayer(section.expected_layer ?? 'none');
      setSubtopicFilter(section.subtopic_filter ?? 'none');
      setIsRequired(section.is_required);
      setDisplayOrder(section.display_order);
    } else {
      setSectionName('');
      setDescription('');
      setExpectedLayer('none');
      setSubtopicFilter('none');
      setIsRequired(true);
      setDisplayOrder(0);
    }
  }, [section, open]);

  const handleSave = async () => {
    if (!sectionName.trim()) {
      toast.error('Section name is required');
      return;
    }

    setSaving(true);
    try {
      const body = {
        section_name: sectionName.trim(),
        description: description.trim() || null,
        expected_layer: expectedLayer && expectedLayer !== 'none' ? expectedLayer : null,
        subtopic_filter: subtopicFilter && subtopicFilter !== 'none' ? subtopicFilter : null,
        display_order: displayOrder,
        is_required: isRequired,
      };

      const url = section
        ? `/api/guides/${encodeURIComponent(guideSlug)}/sections/${section.id}`
        : `/api/guides/${encodeURIComponent(guideSlug)}/sections`;

      const res = await fetch(url, {
        method: section ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? 'Failed to save section');
        return;
      }

      toast.success(section ? 'Section updated' : 'Section created');
      onSave();
      onOpenChange(false);
    } catch {
      toast.error('Failed to save section');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{section ? 'Edit Section' : 'Add Section'}</DialogTitle>
          <DialogDescription>
            Define a section for this guide.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <label htmlFor="section-name" className="text-xs font-medium text-muted-foreground">
              Section Name
            </label>
            <Input
              id="section-name"
              value={sectionName}
              onChange={(e) => setSectionName(e.target.value)}
              placeholder="e.g. Sector Overview"
              className="mt-1"
            />
          </div>

          <div>
            <label htmlFor="section-description" className="text-xs font-medium text-muted-foreground">
              Description
            </label>
            <Input
              id="section-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description"
              className="mt-1"
            />
          </div>

          <div>
            <label htmlFor="section-layer" className="text-xs font-medium text-muted-foreground">
              Expected Layer
            </label>
            <Select value={expectedLayer} onValueChange={setExpectedLayer}>
              <SelectTrigger id="section-layer" className="mt-1">
                <SelectValue placeholder="Any layer" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Any layer</SelectItem>
                {layerVocabulary.map((layer) => (
                  <SelectItem key={layer.key} value={layer.key}>
                    {layer.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label htmlFor="section-subtopic" className="text-xs font-medium text-muted-foreground">
              Subtopic Filter
            </label>
            <Select value={subtopicFilter} onValueChange={setSubtopicFilter}>
              <SelectTrigger id="section-subtopic" className="mt-1">
                <SelectValue placeholder="Any subtopic" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Any subtopic</SelectItem>
                {subtopics.map((s) => (
                  <SelectItem key={s.name} value={s.name}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label htmlFor="section-order" className="text-xs font-medium text-muted-foreground">
              Display Order
            </label>
            <Input
              id="section-order"
              type="number"
              min={0}
              value={displayOrder}
              onChange={(e) => setDisplayOrder(parseInt(e.target.value, 10) || 0)}
              className="mt-1"
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              id="section-required"
              type="checkbox"
              checked={isRequired}
              onChange={(e) => setIsRequired(e.target.checked)}
              className="size-4 rounded border-border"
            />
            <label htmlFor="section-required" className="text-sm text-foreground">
              Required section
            </label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
            {section ? 'Save Changes' : 'Add Section'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
