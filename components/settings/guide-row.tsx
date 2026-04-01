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
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { type Guide, type GuideSection, GUIDE_TYPE_LABELS } from './guide-types';
import { SectionFormDialog } from './section-form-dialog';

// ---------------------------------------------------------------------------
// Guide row with expandable sections
// ---------------------------------------------------------------------------

export function GuideRow({
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
  const [sectionLoadError, setSectionLoadError] = useState(false);
  const [sectionDialogOpen, setSectionDialogOpen] = useState(false);
  const [editingSection, setEditingSection] = useState<GuideSection | null>(null);

  const fetchSections = useCallback(async () => {
    setLoadingSections(true);
    setSectionLoadError(false);
    try {
      const res = await fetch(`/api/guides/${encodeURIComponent(guide.slug)}/sections`);
      if (res.ok) {
        const data: GuideSection[] = await res.json();
        setSections(data);
      } else {
        setSectionLoadError(true);
        toast.error('Failed to load sections');
      }
    } catch {
      setSectionLoadError(true);
      toast.error('Failed to load sections');
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
    <div className="rounded-lg border bg-card">
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
          ) : sectionLoadError ? (
            <div className="flex items-center justify-center gap-2 py-4">
              <p className="text-xs text-destructive">
                Failed to load sections.
              </p>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-xs"
                onClick={fetchSections}
              >
                Retry
              </Button>
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
