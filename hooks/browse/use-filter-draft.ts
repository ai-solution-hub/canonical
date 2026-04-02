'use client';

import { useState, useCallback, useEffect } from 'react';
import type { BrowseFilters } from '@/types/content';

/** Shape of the local draft state managed by this hook */
export interface FilterDraft {
  domains: string[];
  subtopic: string;
  content_types: string[];
  platforms: string[];
  authors: string[];
  date_from: string;
  date_to: string;
  keywords: string;
  starred: boolean;
  priorities: string[];
  workspace: string;
  user_tags: string[];
  freshness: string[];
  layer: string;
  entity: string;
  entity_type: string;
  quality_issues: boolean;
  include_drafts: boolean;
  include_qa: boolean;
  owner: string;
  review_status: string;
}

interface UseFilterDraftParams {
  filters: BrowseFilters;
  setFilters: (newFilters: Partial<BrowseFilters>) => void;
  clearFilters: () => void;
  onClose: () => void;
  /** Callback to reset author search when clearing all filters */
  onClearAuthorSearch?: () => void;
}

function filtersTodraft(filters: BrowseFilters): FilterDraft {
  return {
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
    entity: filters.entity ?? '',
    entity_type: filters.entity_type ?? '',
    quality_issues: filters.quality_issues ?? false,
    include_drafts: filters.include_drafts ?? false,
    include_qa: filters.include_qa ?? false,
    owner: filters.owner ?? '',
    review_status: filters.review_status ?? '',
  };
}

/**
 * Manages the local draft filter state and all toggle/apply/clear handlers.
 *
 * Changes are batched locally until the user clicks "Apply", at which point
 * they are flushed to the URL via `setFilters`.
 */
export function useFilterDraft({
  filters,
  setFilters,
  clearFilters,
  onClose,
  onClearAuthorSearch,
}: UseFilterDraftParams) {
  const [draft, setDraft] = useState<FilterDraft>(() =>
    filtersTodraft(filters),
  );

  // Sync draft when filters change externally (e.g. badge removal)
  useEffect(() => {
    setDraft(filtersTodraft(filters));
  }, [filters]);

  // --- Toggle handlers ---

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

  const handleEntityChange = useCallback((entityName: string) => {
    setDraft((prev) => ({
      ...prev,
      entity: prev.entity === entityName ? '' : entityName,
    }));
  }, []);

  const handleEntityTypeChange = useCallback((entityType: string) => {
    setDraft((prev) => ({
      ...prev,
      entity_type: prev.entity_type === entityType ? '' : entityType,
      // Clear entity name when entity type changes
      entity: prev.entity_type === entityType ? prev.entity : '',
    }));
  }, []);

  const handleOwnerChange = useCallback((ownerValue: string) => {
    setDraft((prev) => ({
      ...prev,
      owner: prev.owner === ownerValue ? '' : ownerValue,
    }));
  }, []);

  const handleReviewStatusChange = useCallback((status: string) => {
    setDraft((prev) => ({
      ...prev,
      review_status: prev.review_status === status ? '' : status,
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
      entity: draft.entity || undefined,
      entity_type: draft.entity_type || undefined,
      quality_issues: draft.quality_issues || undefined,
      include_drafts: draft.include_drafts || undefined,
      include_qa: draft.include_qa || undefined,
      owner: draft.owner || undefined,
      review_status: draft.review_status || undefined,
    });
    onClose();
  }, [draft, setFilters, onClose]);

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
      entity: '',
      entity_type: '',
      quality_issues: false,
      include_drafts: false,
      include_qa: false,
      owner: '',
      review_status: '',
    });
    onClearAuthorSearch?.();
    clearFilters();
    onClose();
  }, [clearFilters, onClose, onClearAuthorSearch]);

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
    draft.entity,
    draft.entity_type,
    draft.quality_issues,
    draft.include_drafts,
    draft.include_qa,
    draft.owner,
    draft.review_status,
  ].filter(Boolean).length;

  return {
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
  };
}
