'use client';

import { useState, useEffect, useCallback } from 'react';
import { Loader2, Plus, BookOpen, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import {
  TooltipProvider,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip';
import { type Guide } from './guide-types';
import { GuideFormDialog } from './guide-form-dialog';
import { GuideRow } from './guide-row';

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
    if (
      !confirm(
        `Delete "${guide.name}"? This will also delete all its sections.`,
      )
    )
      return;

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
        toast.success(
          guide.is_published ? 'Guide unpublished' : 'Guide published',
        );
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
          <h2 className="flex items-center gap-1.5 text-lg font-semibold text-foreground">
            Guides
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex items-center text-muted-foreground hover:text-foreground"
                    aria-label="More information about guides"
                  >
                    <Info className="size-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-xs">
                  A guide is a curated reading experience — a sequence of
                  sections that pulls in relevant knowledge items. For example,
                  a &ldquo;Health &amp; Safety Overview&rdquo; guide might have
                  sections for policies, certifications, and risk assessments.
                  Guides can be published or kept as drafts.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Curated reading paths through your knowledge base, designed for
            specific audiences or topics.
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
            <BookOpen
              className="size-8 text-muted-foreground/50"
              aria-hidden="true"
            />
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
