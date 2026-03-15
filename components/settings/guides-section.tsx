'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Loader2,
  Plus,
  Pencil,
  Trash2,
  Eye,
  EyeOff,
  ChevronDown,
  ChevronUp,
  ArrowUp,
  ArrowDown,
  BookOpen,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
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
import { CLIENT_CONFIG } from '@/lib/client-config';
import { VALID_GUIDE_TYPES } from '@/lib/validation/guide-schemas';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Guide {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  guide_type: string;
  domain_filter: string | null;
  icon: string | null;
  color: string | null;
  display_order: number;
  is_published: boolean;
  created_at: string;
  updated_at: string;
}

interface GuideSection {
  id: string;
  guide_id: string;
  section_name: string;
  description: string | null;
  expected_layer: string | null;
  subtopic_filter: string | null;
  content_type_filter: string | null;
  display_order: number;
  is_required: boolean;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GUIDE_TYPE_LABELS: Record<string, string> = {
  sector: 'Sector',
  product: 'Product',
  company: 'Company',
  research: 'Research',
  custom: 'Custom',
};

// ---------------------------------------------------------------------------
// Slug generator
// ---------------------------------------------------------------------------

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 100);
}

// ---------------------------------------------------------------------------
// Guide form dialog
// ---------------------------------------------------------------------------

function GuideFormDialog({
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
        domain_filter: domainFilter && domainFilter !== 'none' ? domainFilter : undefined,
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
            <label htmlFor="guide-name" className="text-xs font-medium text-muted-foreground">
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
            <label htmlFor="guide-slug" className="text-xs font-medium text-muted-foreground">
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
            <label htmlFor="guide-description" className="text-xs font-medium text-muted-foreground">
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
            <label htmlFor="guide-type" className="text-xs font-medium text-muted-foreground">
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
            <label htmlFor="guide-domain" className="text-xs font-medium text-muted-foreground">
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
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
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

// ---------------------------------------------------------------------------
// Section form dialog
// ---------------------------------------------------------------------------

function SectionFormDialog({
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
                {CLIENT_CONFIG.layer_vocabulary.map((layer) => (
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

// ---------------------------------------------------------------------------
// Guide row with expandable sections
// ---------------------------------------------------------------------------

function GuideRow({
  guide,
  onEdit,
  onDelete,
  onTogglePublish,
}: {
  guide: Guide;
  onEdit: () => void;
  onDelete: () => void;
  onTogglePublish: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [sections, setSections] = useState<GuideSection[]>([]);
  const [loadingSections, setLoadingSections] = useState(false);
  const [sectionDialogOpen, setSectionDialogOpen] = useState(false);
  const [editingSection, setEditingSection] = useState<GuideSection | null>(null);

  const fetchSections = useCallback(async () => {
    setLoadingSections(true);
    try {
      const res = await fetch(`/api/guides/${encodeURIComponent(guide.slug)}/sections`);
      if (res.ok) {
        const data: GuideSection[] = await res.json();
        setSections(data);
      }
    } catch {
      // Ignore
    } finally {
      setLoadingSections(false);
    }
  }, [guide.slug]);

  useEffect(() => {
    if (expanded) {
      fetchSections();
    }
  }, [expanded, fetchSections]);

  const handleMoveSection = async (sectionIndex: number, direction: 'up' | 'down') => {
    const swapIndex = direction === 'up' ? sectionIndex - 1 : sectionIndex + 1;
    if (swapIndex < 0 || swapIndex >= sections.length) return;

    // Swap display orders
    const updatedSections = sections.map((s, i) => ({
      id: s.id,
      display_order:
        i === sectionIndex
          ? sections[swapIndex].display_order
          : i === swapIndex
            ? sections[sectionIndex].display_order
            : s.display_order,
    }));

    try {
      const res = await fetch(`/api/guides/${encodeURIComponent(guide.slug)}/sections`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sections: updatedSections }),
      });

      if (res.ok) {
        fetchSections();
      } else {
        toast.error('Failed to reorder sections');
      }
    } catch {
      toast.error('Failed to reorder sections');
    }
  };

  const handleDeleteSection = async (sectionId: string) => {
    if (!confirm('Delete this section? This cannot be undone.')) return;

    try {
      const res = await fetch(
        `/api/guides/${encodeURIComponent(guide.slug)}/sections/${sectionId}`,
        { method: 'DELETE' },
      );

      if (res.ok) {
        toast.success('Section deleted');
        fetchSections();
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? 'Failed to delete section');
      }
    } catch {
      toast.error('Failed to delete section');
    }
  };

  return (
    <div className="rounded-lg border border-border bg-card">
      {/* Guide header */}
      <div className="flex items-center gap-3 p-3">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="shrink-0 text-muted-foreground hover:text-foreground"
          aria-label={expanded ? 'Collapse sections' : 'Expand sections'}
        >
          {expanded ? (
            <ChevronUp className="size-4" />
          ) : (
            <ChevronDown className="size-4" />
          )}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-foreground">
              {guide.name}
            </span>
            <Badge variant="secondary" className="text-[10px]">
              {GUIDE_TYPE_LABELS[guide.guide_type] ?? guide.guide_type}
            </Badge>
            {guide.is_published ? (
              <Badge variant="outline" className="text-[10px] text-freshness-fresh border-freshness-fresh/30">
                Published
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[10px]">
                Draft
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            /{guide.slug}
            {guide.domain_filter && ` · ${guide.domain_filter}`}
          </p>
        </div>

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={onTogglePublish}
            title={guide.is_published ? 'Unpublish' : 'Publish'}
          >
            {guide.is_published ? (
              <EyeOff className="size-3.5" />
            ) : (
              <Eye className="size-3.5" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={onEdit}
            title="Edit guide"
          >
            <Pencil className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-destructive hover:text-destructive"
            onClick={onDelete}
            title="Delete guide"
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* Expanded sections list */}
      {expanded && (
        <div className="border-t border-border px-3 py-3">
          {loadingSections ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {sections.length === 0 && (
                <p className="py-2 text-xs text-muted-foreground">
                  No sections yet.
                </p>
              )}

              <div className="space-y-1">
                {sections.map((section, index) => (
                  <div
                    key={section.id}
                    className="flex items-center gap-2 rounded-md bg-muted/30 px-2 py-1.5"
                  >
                    <span className="w-6 text-center text-xs text-muted-foreground">
                      {section.display_order}
                    </span>
                    <span className="min-w-0 flex-1 text-xs font-medium text-foreground truncate">
                      {section.section_name}
                    </span>
                    {section.expected_layer && (
                      <Badge variant="outline" className="text-[9px] shrink-0">
                        {section.expected_layer}
                      </Badge>
                    )}
                    {section.is_required && (
                      <Badge variant="outline" className="text-[9px] shrink-0">
                        Req
                      </Badge>
                    )}
                    <div className="flex items-center gap-0.5 shrink-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-6"
                        disabled={index === 0}
                        onClick={() => handleMoveSection(index, 'up')}
                        title="Move up"
                      >
                        <ArrowUp className="size-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-6"
                        disabled={index === sections.length - 1}
                        onClick={() => handleMoveSection(index, 'down')}
                        title="Move down"
                      >
                        <ArrowDown className="size-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-6"
                        onClick={() => {
                          setEditingSection(section);
                          setSectionDialogOpen(true);
                        }}
                        title="Edit section"
                      >
                        <Pencil className="size-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-6 text-destructive hover:text-destructive"
                        onClick={() => handleDeleteSection(section.id)}
                        title="Delete section"
                      >
                        <Trash2 className="size-3" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>

              <Button
                variant="outline"
                size="sm"
                className="mt-2 gap-1.5"
                onClick={() => {
                  setEditingSection(null);
                  setSectionDialogOpen(true);
                }}
              >
                <Plus className="size-3" />
                Add Section
              </Button>

              <SectionFormDialog
                open={sectionDialogOpen}
                onOpenChange={setSectionDialogOpen}
                guideSlug={guide.slug}
                section={editingSection}
                onSave={fetchSections}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main guides section component
// ---------------------------------------------------------------------------

export function GuidesSection() {
  const [guides, setGuides] = useState<Guide[]>([]);
  const [loading, setLoading] = useState(true);
  const [guideDialogOpen, setGuideDialogOpen] = useState(false);
  const [editingGuide, setEditingGuide] = useState<Guide | null>(null);

  const fetchGuides = useCallback(async () => {
    try {
      const res = await fetch('/api/guides?include_unpublished=true');
      if (res.ok) {
        const data: Guide[] = await res.json();
        setGuides(data);
      }
    } catch {
      toast.error('Failed to load guides');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchGuides();
  }, [fetchGuides]);

  const handleDelete = async (guide: Guide) => {
    if (!confirm(`Delete "${guide.name}"? This will also delete all its sections.`)) return;

    try {
      const res = await fetch(`/api/guides/${encodeURIComponent(guide.slug)}`, {
        method: 'DELETE',
      });

      if (res.ok) {
        toast.success('Guide deleted');
        fetchGuides();
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? 'Failed to delete guide');
      }
    } catch {
      toast.error('Failed to delete guide');
    }
  };

  const handleTogglePublish = async (guide: Guide) => {
    try {
      const res = await fetch(`/api/guides/${encodeURIComponent(guide.slug)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_published: !guide.is_published }),
      });

      if (res.ok) {
        toast.success(guide.is_published ? 'Guide unpublished' : 'Guide published');
        fetchGuides();
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? 'Failed to update guide');
      }
    } catch {
      toast.error('Failed to update guide');
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Guides</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Manage curated reading experiences over your knowledge base.
          </p>
        </div>
        <Button
          size="sm"
          className="gap-1.5"
          onClick={() => {
            setEditingGuide(null);
            setGuideDialogOpen(true);
          }}
        >
          <Plus className="size-3.5" />
          Create Guide
        </Button>
      </div>

      <div className="mt-4 space-y-3">
        {loading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {!loading && guides.length === 0 && (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border px-6 py-12 text-center">
            <BookOpen className="size-8 text-muted-foreground/50" aria-hidden="true" />
            <p className="mt-3 text-sm text-muted-foreground">
              No guides created yet. Create your first guide to get started.
            </p>
          </div>
        )}

        {guides.map((guide) => (
          <GuideRow
            key={guide.id}
            guide={guide}
            onEdit={() => {
              setEditingGuide(guide);
              setGuideDialogOpen(true);
            }}
            onDelete={() => handleDelete(guide)}
            onTogglePublish={() => handleTogglePublish(guide)}
          />
        ))}
      </div>

      <GuideFormDialog
        open={guideDialogOpen}
        onOpenChange={setGuideDialogOpen}
        guide={editingGuide}
        onSave={fetchGuides}
      />
    </div>
  );
}
