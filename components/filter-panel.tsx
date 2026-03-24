'use client';

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
import { useFilterData } from '@/hooks/use-filter-data';
import { useFilterDraft } from '@/hooks/use-filter-draft';
import { useTaxonomy } from '@/contexts/taxonomy-context';
import { FilterSection } from '@/components/filter-section';
import { DomainFilter } from '@/components/domain-filter';
import { SubtopicFilter } from '@/components/subtopic-filter';
import { ContentTypeFilter } from '@/components/content-type-filter';
import { PlatformFilter } from '@/components/platform-filter';
import { AuthorFilter } from '@/components/author-filter';
import { FreshnessBadge } from '@/components/freshness-badge';
import { Checkbox } from '@/components/ui/checkbox';
import { isFeatureEnabled } from '@/lib/client-config';
import { useLayerVocabulary } from '@/contexts/layer-vocabulary-context';
import { EntityCoOccurrence } from '@/components/entity-co-occurrence';

interface FilterPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function FilterPanel({ open, onOpenChange }: FilterPanelProps) {
  const { filters, activeFilterCount, setFilters, clearFilters } =
    useBrowseFilters();

  const {
    counts,
    authorSearch,
    setAuthorSearch,
    allAuthors,
    popularKeywords,
    allWorkspaces,
    allUserTags,
    allEntities,
    entityTypeCounts,
  } = useFilterData({ isOpen: open });

  const {
    draft,
    setDraft,
    draftFilterCount,
    handleDomainToggle,
    handleSubtopicToggle,
    handleContentTypeToggle,
    handlePlatformToggle,
    handlePriorityToggle,
    handleAddAuthor,
    handleRemoveAuthor,
    handleWorkspaceChange,
    handleFreshnessToggle,
    handleLayerToggle,
    handleEntityChange,
    handleEntityTypeChange,
    handleOwnerChange,
    handleReviewStatusChange,
    handleUserTagToggle,
    handleApply,
    handleClearAll,
  } = useFilterDraft({
    filters,
    setFilters,
    clearFilters,
    onClose: () => onOpenChange(false),
    onClearAuthorSearch: () => setAuthorSearch(''),
  });

  const { layers: layerVocabulary } = useLayerVocabulary();
  const { getDomainNames, getSubtopics } = useTaxonomy();
  const domainNames = getDomainNames();

  // Derive available subtopics: only when exactly ONE domain is selected
  const singleDomain =
    draft.domains.length === 1 ? draft.domains[0] : null;
  const availableSubtopics =
    singleDomain && domainNames.includes(singleDomain)
      ? getSubtopics(singleDomain)
      : [];

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
          {/* Domain — open by default (commonly used) */}
          <DomainFilter
            selectedDomains={draft.domains}
            counts={counts.domain}
            onToggle={handleDomainToggle}
            defaultOpen
          />

          <Separator className="my-3" />

          {/* Subtopic (conditional — exactly one domain selected) */}
          {singleDomain && availableSubtopics.length > 0 && (
            <>
              <SubtopicFilter
                domainName={singleDomain}
                subtopics={availableSubtopics}
                selectedSubtopic={draft.subtopic}
                onToggle={handleSubtopicToggle}
                defaultOpen
              />

              <Separator className="my-3" />
            </>
          )}

          {/* Content Type — open by default (commonly used) */}
          <ContentTypeFilter
            selectedTypes={draft.content_types}
            counts={counts.content_type}
            onToggle={handleContentTypeToggle}
            defaultOpen
          />

          <Separator className="my-3" />

          {/* Platform — collapsed by default */}
          <PlatformFilter
            selectedPlatforms={draft.platforms}
            counts={counts.platform}
            onToggle={handlePlatformToggle}
            defaultOpen={false}
          />

          <Separator className="my-3" />

          {/* Author — collapsed by default */}
          <AuthorFilter
            selectedAuthors={draft.authors}
            authorSearch={authorSearch}
            allAuthors={allAuthors}
            onAuthorSearchChange={setAuthorSearch}
            onAddAuthor={handleAddAuthor}
            onRemoveAuthor={handleRemoveAuthor}
            defaultOpen={false}
          />

          <Separator className="my-3" />

          {/* Date Range — collapsed by default */}
          <FilterSection title="Date Range" defaultOpen={false}>
            <div className="flex flex-col gap-2">
              <div className="flex flex-col gap-1">
                <label
                  htmlFor="filter-date-from"
                  className="text-xs text-muted-foreground"
                >
                  From
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
                  To
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

          {/* Priority — collapsed by default */}
          <FilterSection title="Priority" defaultOpen={false}>
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

          {/* Workspaces — collapsed by default */}
          {allWorkspaces.length > 0 && (
            <>
              <FilterSection title="Collections" defaultOpen={false}>
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

          {/* User Tags — collapsed by default */}
          {allUserTags.length > 0 && (
            <>
              <FilterSection title="User Tags" defaultOpen={false}>
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

          {/* Entity Type — collapsed by default */}
          {entityTypeCounts.length > 0 && (
            <>
              <FilterSection title="Entity Type" defaultOpen={false}>
                <div className="flex flex-wrap gap-2">
                  {entityTypeCounts.map(({ type, count }) => {
                    const isActive = draft.entity_type === type;
                    return (
                      <button
                        key={type}
                        type="button"
                        onClick={() => handleEntityTypeChange(type)}
                        aria-pressed={isActive}
                        className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs capitalize transition-colors ${
                          isActive
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-border bg-muted text-foreground hover:bg-accent'
                        }`}
                      >
                        {type}
                        <span className="text-muted-foreground">{count}</span>
                      </button>
                    );
                  })}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Filter content by entity type
                </p>
              </FilterSection>

              <Separator className="my-3" />
            </>
          )}

          {/* Entity Name — collapsed by default, filtered by selected type */}
          {allEntities.length > 0 && (
            <>
              <FilterSection title="Entities" defaultOpen={false}>
                <div className="flex flex-wrap gap-2">
                  {allEntities
                    .filter((e) => !draft.entity_type || e.type === draft.entity_type)
                    .map(({ name, type, count }) => {
                      const isActive = draft.entity === name;
                      return (
                        <button
                          key={`${name}-${type}`}
                          type="button"
                          onClick={() => handleEntityChange(name)}
                          aria-pressed={isActive}
                          className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                            isActive
                              ? 'border-primary bg-primary/10 text-primary'
                              : 'border-border bg-muted text-foreground hover:bg-accent'
                          }`}
                        >
                          {name}
                          <span className="text-muted-foreground">{count}</span>
                        </button>
                      );
                    })}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {draft.entity_type
                    ? `Showing ${draft.entity_type} entities — clear type filter to see all`
                    : 'Filter by entity mentioned in content'}
                </p>
              </FilterSection>

              <Separator className="my-3" />
            </>
          )}

          {/* Entity Co-occurrence — collapsed by default */}
          {allEntities.length > 0 && (
            <>
              <EntityCoOccurrence
                show={open}
                defaultOpen={false}
                onEntityClick={(name) => handleEntityChange(name)}
              />
              <Separator className="my-3" />
            </>
          )}

          {/* Freshness — collapsed by default */}
          <FilterSection title="Freshness" defaultOpen={false}>
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

          {/* Review Status — collapsed by default */}
          <FilterSection title="Review Status" defaultOpen={false}>
            <div className="flex flex-wrap gap-2">
              {[
                { value: 'verified', label: 'Verified' },
                { value: 'unverified', label: 'Unverified' },
                { value: 'flagged', label: 'Flagged' },
              ].map((opt) => {
                const isActive = draft.review_status === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => handleReviewStatusChange(opt.value)}
                    aria-pressed={isActive}
                    className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                      isActive
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border bg-muted text-foreground hover:bg-accent'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Filter by verification status
            </p>
          </FilterSection>

          <Separator className="my-3" />

          {/* Content Owner — collapsed by default */}
          <FilterSection title="Owner" defaultOpen={false}>
            <div className="flex flex-wrap gap-2">
              {[
                { value: 'me', label: 'My content' },
                { value: 'unowned', label: 'Unowned' },
              ].map((opt) => {
                const isActive = draft.owner === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => handleOwnerChange(opt.value)}
                    aria-pressed={isActive}
                    className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                      isActive
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border bg-muted text-foreground hover:bg-accent'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Filter by content ownership
            </p>
          </FilterSection>

          <Separator className="my-3" />

          {isFeatureEnabled('content_layers') && (
            <>
              <Separator className="my-3" />

              {/* Content Layer — collapsed by default */}
              <FilterSection title="Content Layer" defaultOpen={false}>
                <div className="flex flex-wrap gap-2">
                  {layerVocabulary.map((layer) => {
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

          {/* Quality Issues — collapsed by default */}
          <FilterSection title="Quality" defaultOpen={false}>
            <label htmlFor="filter-quality" className="flex cursor-pointer items-center gap-2">
              <Checkbox
                id="filter-quality"
                checked={draft.quality_issues}
                onCheckedChange={(checked) =>
                  setDraft((prev) => ({ ...prev, quality_issues: checked === true }))
                }
              />
              <span className="text-sm">Has quality issues</span>
            </label>
          </FilterSection>

          <Separator className="my-3" />

          {/* Include Drafts — collapsed by default */}
          <FilterSection title="Drafts" defaultOpen={false}>
            <label htmlFor="filter-drafts" className="flex cursor-pointer items-center gap-2">
              <Checkbox
                id="filter-drafts"
                checked={draft.include_drafts}
                onCheckedChange={(checked) =>
                  setDraft((prev) => ({ ...prev, include_drafts: checked === true }))
                }
              />
              <span className="text-sm">Include draft items</span>
            </label>
            <p className="mt-1 text-xs text-muted-foreground">
              Draft items are hidden from search and matching by default
            </p>
          </FilterSection>

          <Separator className="my-3" />

          {/* Include Q&A pairs — collapsed by default */}
          <FilterSection title="Q&A Pairs" defaultOpen={false}>
            <label htmlFor="filter-qa" className="flex cursor-pointer items-center gap-2">
              <Checkbox
                id="filter-qa"
                checked={draft.include_qa}
                onCheckedChange={(checked) =>
                  setDraft((prev) => ({ ...prev, include_qa: checked === true }))
                }
              />
              <span className="text-sm">Include Q&A pairs</span>
            </label>
            <p className="mt-1 text-xs text-muted-foreground">
              Q&A pairs are shown in the Q&A Library by default
            </p>
          </FilterSection>

          <Separator className="my-3" />

          {/* Starred — collapsed by default */}
          <FilterSection title="Starred" defaultOpen={false}>
            <label htmlFor="filter-starred" className="flex cursor-pointer items-center gap-2">
              <Checkbox
                id="filter-starred"
                checked={draft.starred}
                onCheckedChange={(checked) =>
                  setDraft((prev) => ({ ...prev, starred: checked === true }))
                }
              />
              <span className="text-sm">Show starred items only</span>
            </label>
          </FilterSection>

          <Separator className="my-3" />

          {/* Keywords — collapsed by default */}
          <FilterSection title="Keywords" defaultOpen={false}>
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
