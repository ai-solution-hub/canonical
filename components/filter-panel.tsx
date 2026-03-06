'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { useBrowseFilters } from '@/hooks/use-browse-filters';
import {
  parseJsonb,
  parseJsonbArray,
  FilterCountsSchema,
  AuthorCountSchema,
} from '@/lib/validation/jsonb';
import { useTaxonomy } from '@/contexts/taxonomy-context';
import { createClient } from '@/lib/supabase/client';
import { FilterSection } from '@/components/filter-section';
import { DomainFilter } from '@/components/domain-filter';
import { SubtopicFilter } from '@/components/subtopic-filter';
import { ContentTypeFilter } from '@/components/content-type-filter';
import { PlatformFilter } from '@/components/platform-filter';
import { AuthorFilter } from '@/components/author-filter';
import { FreshnessBadge } from '@/components/freshness-badge';
import { isFeatureEnabled, CLIENT_CONFIG } from '@/lib/client-config';
import type { Workspace } from '@/types/content';

interface FilterPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type FilterCounts = {
  domain: Record<string, number>;
  content_type: Record<string, number>;
  platform: Record<string, number>;
};

export function FilterPanel({ open, onOpenChange }: FilterPanelProps) {
  const supabase = createClient();
  const { filters, activeFilterCount, setFilters, clearFilters } =
    useBrowseFilters();

  // Local draft state so changes are batched until "Apply"
  const [draft, setDraft] = useState({
    domains: filters.domain ?? ([] as string[]),
    subtopic: filters.subtopic ?? '',
    content_types: filters.content_type ?? ([] as string[]),
    platforms: filters.platform ?? ([] as string[]),
    authors: filters.author ?? ([] as string[]),
    date_from: filters.date_from ?? '',
    date_to: filters.date_to ?? '',
    keywords: filters.keywords?.join(', ') ?? '',
    starred: filters.starred ?? false,
    priorities: filters.priority ?? ([] as string[]),
    workspace: filters.workspace ?? '',
    user_tags: filters.user_tags ?? ([] as string[]),
    freshness: filters.freshness ?? ([] as string[]),
    layer: filters.layer ?? '',
    quality_issues: filters.quality_issues ?? false,
    include_drafts: filters.include_drafts ?? false,
    include_qa: filters.include_qa ?? false,
  });

  // Filter counts (M8) — cached with a 30-second TTL to avoid re-fetching on every panel open
  const [counts, setCounts] = useState<FilterCounts>({
    domain: {},
    content_type: {},
    platform: {},
  });
  const countsCache = useRef<{ data: FilterCounts; timestamp: number } | null>(null);
  const COUNTS_CACHE_TTL_MS = 30_000;

  // Author autocomplete state
  const [authorSearch, setAuthorSearch] = useState('');
  const [allAuthors, setAllAuthors] = useState<
    { name: string; count: number }[]
  >([]);
  const [authorsLoaded, setAuthorsLoaded] = useState(false);

  // Popular keywords for quick-filter chips
  const [popularKeywords, setPopularKeywords] = useState<string[]>([]);
  const [keywordsLoaded, setKeywordsLoaded] = useState(false);

  // Workspaces for filter
  const [allWorkspaces, setAllWorkspaces] = useState<Workspace[]>([]);
  const [workspacesLoaded, setWorkspacesLoaded] = useState(false);

  // User tags for filter
  const [allUserTags, setAllUserTags] = useState<{ tag: string; count: number }[]>([]);
  const [userTagsLoaded, setUserTagsLoaded] = useState(false);

  // Sync draft when filters change externally (e.g. badge removal)
  const prevFiltersRef = useRef(filters);
  if (prevFiltersRef.current !== filters) {
    prevFiltersRef.current = filters;
    setDraft({
      domains: filters.domain ?? [],
      subtopic: filters.subtopic ?? '',
      content_types: filters.content_type ?? [],
      platforms: filters.platform ?? [],
      authors: filters.author ?? [],
      date_from: filters.date_from ?? '',
      date_to: filters.date_to ?? '',
      keywords: filters.keywords?.join(', ') ?? '',
      starred: filters.starred ?? false,
      priorities: filters.priority ?? [],
      workspace: filters.workspace ?? '',
      user_tags: filters.user_tags ?? [],
      freshness: filters.freshness ?? [],
      layer: filters.layer ?? '',
      quality_issues: filters.quality_issues ?? false,
      include_drafts: filters.include_drafts ?? false,
      include_qa: filters.include_qa ?? false,
    });
  }

  // Fetch counts when panel opens via server-side aggregation RPC.
  // Results are cached for 30 seconds to avoid redundant fetches.
  useEffect(() => {
    if (!open) return;

    // Serve from cache if still fresh
    if (
      countsCache.current &&
      Date.now() - countsCache.current.timestamp < COUNTS_CACHE_TTL_MS
    ) {
      setCounts(countsCache.current.data);
      return;
    }

    const fetchCounts = async () => {
      const { data, error } = await supabase.rpc('get_filter_counts');

      if (error || !data) {
        console.error('Failed to fetch filter counts:', error?.message);
        return;
      }

      const parsed = parseJsonb(FilterCountsSchema, data);
      const result: FilterCounts = {
        domain: parsed?.domain ?? {},
        content_type: parsed?.content_type ?? {},
        platform: parsed?.platform ?? {},
      };
      countsCache.current = { data: result, timestamp: Date.now() };
      setCounts(result);
    };

    fetchCounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- supabase is a stable singleton from createClient()
  }, [open]);

  // Fetch unique authors when panel opens
  useEffect(() => {
    if (!open || authorsLoaded) return;

    const fetchAuthors = async () => {
      const { data, error } = await supabase.rpc('get_unique_authors');

      if (error || !data) {
        console.error('Failed to fetch authors:', error?.message);
        return;
      }

      const authors = parseJsonbArray(AuthorCountSchema, data).map((row) => ({
        name: row.author_name,
        count: Number(row.count),
      }));
      setAllAuthors(authors);
      setAuthorsLoaded(true);
    };

    fetchAuthors();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- supabase is a stable singleton from createClient()
  }, [open, authorsLoaded]);

  // Fetch popular keywords when panel opens
  useEffect(() => {
    if (!open || keywordsLoaded) return;

    const fetchKeywords = async () => {
      try {
        const res = await fetch('/api/search/suggestions');
        if (res.ok) {
          const data = await res.json();
          setPopularKeywords(data.keywords ?? []);
        }
      } catch {
        // Non-critical — fail silently
      }
      setKeywordsLoaded(true);
    };

    fetchKeywords();
  }, [open, keywordsLoaded]);

  // Fetch workspaces when panel opens
  useEffect(() => {
    if (!open || workspacesLoaded) return;
    const fetchWorkspaces = async () => {
      try {
        const res = await fetch('/api/workspaces');
        if (res.ok) {
          setAllWorkspaces(await res.json());
        }
      } catch {
        // Non-critical
      }
      setWorkspacesLoaded(true);
    };
    fetchWorkspaces();
  }, [open, workspacesLoaded]);

  // Fetch user tags when panel opens
  useEffect(() => {
    if (!open || userTagsLoaded) return;
    const fetchUserTags = async () => {
      try {
        const { data } = await supabase.rpc('get_user_tag_counts');
        if (data && typeof data === 'object') {
          const tagCounts = data as Record<string, number>;
          setAllUserTags(
            Object.entries(tagCounts)
              .map(([tag, count]) => ({ tag, count }))
              .sort((a, b) => b.count - a.count),
          );
        }
      } catch {
        // Non-critical
      }
      setUserTagsLoaded(true);
    };
    fetchUserTags();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- supabase is a stable singleton from createClient()
  }, [open, userTagsLoaded]);

  const { getDomainNames, getSubtopics } = useTaxonomy();
  const domainNames = getDomainNames();

  // Derive available subtopics: only when exactly ONE domain is selected
  const singleDomain =
    draft.domains.length === 1 ? draft.domains[0] : null;
  const availableSubtopics =
    singleDomain && domainNames.includes(singleDomain)
      ? getSubtopics(singleDomain)
      : [];

  const handleDomainToggle = useCallback((domain: string) => {
    setDraft((prev) => {
      const isSelected = prev.domains.includes(domain);
      let newDomains: string[];
      if (isSelected) {
        newDomains = prev.domains.filter((d) => d !== domain);
      } else {
        newDomains = [...prev.domains, domain];
      }
      // Clear subtopic if we no longer have exactly one domain
      const newSubtopic = newDomains.length === 1 ? prev.subtopic : '';
      return { ...prev, domains: newDomains, subtopic: newSubtopic };
    });
  }, []);

  const handleSubtopicToggle = useCallback((subtopic: string) => {
    setDraft((prev) => ({
      ...prev,
      subtopic: prev.subtopic === subtopic ? '' : subtopic,
    }));
  }, []);

  const handleContentTypeToggle = useCallback((type: string) => {
    setDraft((prev) => {
      const isSelected = prev.content_types.includes(type);
      return {
        ...prev,
        content_types: isSelected
          ? prev.content_types.filter((t) => t !== type)
          : [...prev.content_types, type],
      };
    });
  }, []);

  const handlePlatformToggle = useCallback((platform: string) => {
    setDraft((prev) => {
      const isSelected = prev.platforms.includes(platform);
      return {
        ...prev,
        platforms: isSelected
          ? prev.platforms.filter((p) => p !== platform)
          : [...prev.platforms, platform],
      };
    });
  }, []);

  const handlePriorityToggle = useCallback((priority: string) => {
    setDraft((prev) => {
      const isSelected = prev.priorities.includes(priority);
      return {
        ...prev,
        priorities: isSelected
          ? prev.priorities.filter((p) => p !== priority)
          : [...prev.priorities, priority],
      };
    });
  }, []);

  const handleAddAuthor = useCallback((name: string) => {
    setDraft((prev) => ({
      ...prev,
      authors: [...prev.authors, name],
    }));
  }, []);

  const handleRemoveAuthor = useCallback((name: string) => {
    setDraft((prev) => ({
      ...prev,
      authors: prev.authors.filter((a) => a !== name),
    }));
  }, []);

  const handleWorkspaceChange = useCallback((workspaceId: string) => {
    setDraft((prev) => ({
      ...prev,
      workspace: prev.workspace === workspaceId ? '' : workspaceId,
    }));
  }, []);

  const handleFreshnessToggle = useCallback((state: string) => {
    setDraft((prev) => {
      const isSelected = prev.freshness.includes(state);
      return {
        ...prev,
        freshness: isSelected
          ? prev.freshness.filter((f) => f !== state)
          : [...prev.freshness, state],
      };
    });
  }, []);

  const handleLayerToggle = useCallback((layerKey: string) => {
    setDraft((prev) => ({
      ...prev,
      layer: prev.layer === layerKey ? '' : layerKey,
    }));
  }, []);

  const handleUserTagToggle = useCallback((tag: string) => {
    setDraft((prev) => {
      const isSelected = prev.user_tags.includes(tag);
      return {
        ...prev,
        user_tags: isSelected
          ? prev.user_tags.filter((t) => t !== tag)
          : [...prev.user_tags, tag],
      };
    });
  }, []);

  const handleApply = useCallback(() => {
    const keywordsArray = [
      ...new Set(
        draft.keywords
          .split(',')
          .map((k) => k.trim())
          .filter(Boolean),
      ),
    ];

    setFilters({
      domain: draft.domains.length ? draft.domains : undefined,
      subtopic: draft.subtopic || undefined,
      content_type: draft.content_types.length
        ? draft.content_types
        : undefined,
      platform: draft.platforms.length ? draft.platforms : undefined,
      author: draft.authors.length ? draft.authors : undefined,
      date_from: draft.date_from || undefined,
      date_to: draft.date_to || undefined,
      keywords: keywordsArray.length > 0 ? keywordsArray : undefined,
      starred: draft.starred || undefined,
      priority: draft.priorities.length ? draft.priorities : undefined,
      workspace: draft.workspace || undefined,
      user_tags: draft.user_tags.length ? draft.user_tags : undefined,
      freshness: draft.freshness.length ? draft.freshness : undefined,
      layer: draft.layer || undefined,
      quality_issues: draft.quality_issues || undefined,
      include_drafts: draft.include_drafts || undefined,
      include_qa: draft.include_qa || undefined,
    });
    onOpenChange(false);
  }, [draft, setFilters, onOpenChange]);

  const handleClearAll = useCallback(() => {
    setDraft({
      domains: [],
      subtopic: '',
      content_types: [],
      platforms: [],
      authors: [],
      date_from: '',
      date_to: '',
      keywords: '',
      starred: false,
      priorities: [],
      workspace: '',
      user_tags: [],
      freshness: [],
      layer: '',
      quality_issues: false,
      include_drafts: false,
      include_qa: false,
    });
    setAuthorSearch('');
    clearFilters();
    onOpenChange(false);
  }, [clearFilters, onOpenChange]);

  // Count how many draft filters are active
  const draftFilterCount = [
    draft.domains.length > 0,
    draft.subtopic,
    draft.content_types.length > 0,
    draft.platforms.length > 0,
    draft.authors.length > 0,
    draft.date_from || draft.date_to,
    draft.keywords,
    draft.starred,
    draft.priorities.length > 0,
    draft.workspace,
    draft.user_tags.length > 0,
    draft.freshness.length > 0,
    draft.layer,
    draft.quality_issues,
    draft.include_drafts,
    draft.include_qa,
  ].filter(Boolean).length;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex flex-col overflow-hidden">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <SlidersHorizontal className="size-4" />
            Filters
            {draftFilterCount > 0 && (
              <Badge variant="secondary" className="ml-1 tabular-nums">
                {draftFilterCount}
              </Badge>
            )}
          </SheetTitle>
          <SheetDescription>Narrow down your content items</SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 pb-4 -mx-0">
          <DomainFilter
            selectedDomains={draft.domains}
            counts={counts.domain}
            onToggle={handleDomainToggle}
          />

          <Separator className="my-3" />

          {/* Subtopic (conditional -- exactly one domain selected) */}
          {singleDomain && availableSubtopics.length > 0 && (
            <>
              <SubtopicFilter
                domainName={singleDomain}
                subtopics={availableSubtopics}
                selectedSubtopic={draft.subtopic}
                onToggle={handleSubtopicToggle}
              />

              <Separator className="my-3" />
            </>
          )}

          <ContentTypeFilter
            selectedTypes={draft.content_types}
            counts={counts.content_type}
            onToggle={handleContentTypeToggle}
          />

          <Separator className="my-3" />

          <PlatformFilter
            selectedPlatforms={draft.platforms}
            counts={counts.platform}
            onToggle={handlePlatformToggle}
          />

          <Separator className="my-3" />

          <AuthorFilter
            selectedAuthors={draft.authors}
            authorSearch={authorSearch}
            allAuthors={allAuthors}
            onAuthorSearchChange={setAuthorSearch}
            onAddAuthor={handleAddAuthor}
            onRemoveAuthor={handleRemoveAuthor}
          />

          <Separator className="my-3" />

          {/* Date Range */}
          <FilterSection title="Date Range">
            <div className="flex flex-col gap-2">
              <div className="flex flex-col gap-1">
                <label
                  htmlFor="filter-date-from"
                  className="text-xs text-muted-foreground"
                >
                  From (DD/MM/YYYY)
                </label>
                <Input
                  id="filter-date-from"
                  type="date"
                  value={draft.date_from}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, date_from: e.target.value }))
                  }
                  className="h-8 text-sm"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label
                  htmlFor="filter-date-to"
                  className="text-xs text-muted-foreground"
                >
                  To (DD/MM/YYYY)
                </label>
                <Input
                  id="filter-date-to"
                  type="date"
                  value={draft.date_to}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, date_to: e.target.value }))
                  }
                  className="h-8 text-sm"
                />
              </div>
            </div>
          </FilterSection>

          <Separator className="my-3" />

          {/* Priority */}
          <FilterSection title="Priority">
            <div className="flex flex-wrap gap-2">
              {[
                { value: 'high', label: 'High', colour: 'bg-priority-high' },
                { value: 'medium', label: 'Medium', colour: 'bg-priority-medium' },
                { value: 'low', label: 'Low', colour: 'bg-priority-low' },
              ].map((opt) => {
                const isActive = draft.priorities.includes(opt.value);
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => handlePriorityToggle(opt.value)}
                    aria-pressed={isActive}
                    className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                      isActive
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border bg-muted text-foreground hover:bg-accent'
                    }`}
                  >
                    <span className={`size-2 rounded-full ${opt.colour}`} />
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </FilterSection>

          <Separator className="my-3" />

          {/* Workspaces */}
          {allWorkspaces.length > 0 && (
            <>
              <FilterSection title="Workspaces">
                <div className="flex flex-wrap gap-2">
                  {allWorkspaces.map((workspace) => {
                    const isActive = draft.workspace === workspace.id;
                    return (
                      <button
                        key={workspace.id}
                        type="button"
                        onClick={() => handleWorkspaceChange(workspace.id)}
                        aria-pressed={isActive}
                        className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                          isActive
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-border bg-muted text-foreground hover:bg-accent'
                        }`}
                      >
                        <span
                          className="size-2 rounded-full"
                          style={{ backgroundColor: workspace.color }}
                        />
                        {workspace.name}
                      </button>
                    );
                  })}
                </div>
              </FilterSection>

              <Separator className="my-3" />
            </>
          )}

          {/* User Tags */}
          {allUserTags.length > 0 && (
            <>
              <FilterSection title="User Tags">
                <div className="flex flex-wrap gap-2">
                  {allUserTags.map(({ tag, count }) => {
                    const isActive = draft.user_tags.includes(tag);
                    return (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => handleUserTagToggle(tag)}
                        aria-pressed={isActive}
                        className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                          isActive
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-border bg-muted text-foreground hover:bg-accent'
                        }`}
                      >
                        {tag}
                        <span className="text-muted-foreground">{count}</span>
                      </button>
                    );
                  })}
                </div>
              </FilterSection>

              <Separator className="my-3" />
            </>
          )}

          {/* Freshness */}
          <FilterSection title="Freshness">
            <div className="flex flex-wrap gap-2">
              {(['fresh', 'aging', 'stale', 'expired'] as const).map((state) => {
                const isActive = draft.freshness.includes(state);
                return (
                  <button
                    key={state}
                    type="button"
                    onClick={() => handleFreshnessToggle(state)}
                    aria-pressed={isActive}
                    className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                      isActive
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border bg-muted text-foreground hover:bg-accent'
                    }`}
                  >
                    <FreshnessBadge freshness={state} compact />
                    <span className="capitalize">{state}</span>
                  </button>
                );
              })}
            </div>
          </FilterSection>

          {isFeatureEnabled('content_layers') && (
            <>
              <Separator className="my-3" />

              {/* Content Layer */}
              <FilterSection title="Content Layer">
                <div className="flex flex-wrap gap-2">
                  {CLIENT_CONFIG.layer_vocabulary.map((layer) => {
                    const isActive = draft.layer === layer.key;
                    return (
                      <button
                        key={layer.key}
                        type="button"
                        onClick={() => handleLayerToggle(layer.key)}
                        aria-pressed={isActive}
                        className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                          isActive
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-border bg-muted text-foreground hover:bg-accent'
                        }`}
                      >
                        {layer.label}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Filter by content depth layer
                </p>
              </FilterSection>
            </>
          )}

          <Separator className="my-3" />

          {/* Quality Issues */}
          <FilterSection title="Quality">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={draft.quality_issues}
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, quality_issues: e.target.checked }))
                }
                className="size-4 rounded border-border accent-primary"
              />
              <span className="text-sm">Has quality issues</span>
            </label>
          </FilterSection>

          <Separator className="my-3" />

          {/* Include Drafts */}
          <FilterSection title="Drafts">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={draft.include_drafts}
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, include_drafts: e.target.checked }))
                }
                className="size-4 rounded border-border accent-primary"
              />
              <span className="text-sm">Include draft items</span>
            </label>
            <p className="mt-1 text-xs text-muted-foreground">
              Draft items are hidden from search and matching by default
            </p>
          </FilterSection>

          <Separator className="my-3" />

          {/* Include Q&A pairs */}
          <FilterSection title="Q&A Pairs">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={draft.include_qa}
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, include_qa: e.target.checked }))
                }
                className="size-4 rounded border-border accent-primary"
              />
              <span className="text-sm">Include Q&A pairs</span>
            </label>
            <p className="mt-1 text-xs text-muted-foreground">
              Q&A pairs are shown in the Q&A Library by default
            </p>
          </FilterSection>

          <Separator className="my-3" />

          {/* Starred */}
          <FilterSection title="Starred">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={draft.starred}
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, starred: e.target.checked }))
                }
                className="size-4 rounded border-border accent-primary"
              />
              <span className="text-sm">Show starred items only</span>
            </label>
          </FilterSection>

          <Separator className="my-3" />

          {/* Keywords */}
          <FilterSection title="Keywords">
            <Input
              placeholder="e.g. ISO 27001, security, SLA"
              value={draft.keywords}
              onChange={(e) =>
                setDraft((prev) => ({ ...prev, keywords: e.target.value }))
              }
              className="h-8 text-sm"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Comma-separated keywords to search in ai_keywords
            </p>
            {popularKeywords.length > 0 && (
              <div className="mt-2">
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                  Popular
                </p>
                <div className="flex flex-wrap gap-1">
                  {popularKeywords.map((kw) => {
                    const currentKeywords = draft.keywords
                      .split(',')
                      .map((k) => k.trim().toLowerCase())
                      .filter(Boolean);
                    const isActive = currentKeywords.includes(kw.toLowerCase());
                    return (
                      <button
                        key={kw}
                        type="button"
                        onClick={() => {
                          if (isActive) return;
                          const updated = draft.keywords
                            ? `${draft.keywords}, ${kw}`
                            : kw;
                          setDraft((prev) => ({ ...prev, keywords: updated }));
                        }}
                        aria-pressed={isActive}
                        className={`rounded-full border px-2 py-0.5 text-xs transition-colors ${
                          isActive
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-border bg-muted text-foreground hover:bg-accent'
                        }`}
                        disabled={isActive}
                      >
                        {kw}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </FilterSection>
        </div>

        <SheetFooter className="border-t border-border">
          <div className="flex w-full gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={handleClearAll}
              disabled={draftFilterCount === 0 && activeFilterCount === 0}
            >
              Clear all
            </Button>
            <Button className="flex-1" onClick={handleApply}>
              Apply filters
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
