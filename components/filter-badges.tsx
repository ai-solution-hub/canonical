'use client';

import { X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useBrowseFilters } from '@/hooks/use-browse-filters';
import { formatSubtopic } from '@/lib/taxonomy-format';
import { formatContentType, formatPlatform, formatDateUK } from '@/lib/format';

interface FilterBadgeItem {
  id: string;
  label: string;
  value: string;
  onRemove: () => void;
}

export function FilterBadges() {
  const {
    filters,
    activeFilterCount,
    removeFilter,
    removeFilterValue,
    clearFilters,
  } = useBrowseFilters();

  if (activeFilterCount === 0) return null;

  const badges: FilterBadgeItem[] = [];

  // Individual badge per selected domain
  if (filters.domain?.length) {
    for (const domain of filters.domain) {
      badges.push({
        id: `domain-${domain}`,
        label: 'Domain',
        value: domain,
        onRemove: () => removeFilterValue('domain', domain),
      });
    }
  }

  if (filters.subtopic) {
    badges.push({
      id: 'subtopic',
      label: 'Subtopic',
      value: formatSubtopic(filters.subtopic),
      onRemove: () => removeFilter('subtopic'),
    });
  }

  // Individual badge per selected content type
  if (filters.content_type?.length) {
    for (const type of filters.content_type) {
      badges.push({
        id: `type-${type}`,
        label: 'Type',
        value: formatContentType(type),
        onRemove: () => removeFilterValue('content_type', type),
      });
    }
  }

  // Individual badge per selected platform
  if (filters.platform?.length) {
    for (const platform of filters.platform) {
      badges.push({
        id: `platform-${platform}`,
        label: 'Platform',
        value: formatPlatform(platform),
        onRemove: () => removeFilterValue('platform', platform),
      });
    }
  }

  if (filters.author?.length) {
    for (const author of filters.author) {
      badges.push({
        id: `author-${author}`,
        label: 'Author',
        value: author,
        onRemove: () => removeFilterValue('author', author),
      });
    }
  }

  if (filters.date_from || filters.date_to) {
    const fromStr = filters.date_from ? formatDateUK(filters.date_from) : '...';
    const toStr = filters.date_to ? formatDateUK(filters.date_to) : '...';
    badges.push({
      id: 'date-range',
      label: 'Date',
      value: `${fromStr} \u2013 ${toStr}`,
      onRemove: () => {
        removeFilter('date_from');
        removeFilter('date_to');
      },
    });
  }

  if (filters.keywords?.length) {
    for (const keyword of filters.keywords) {
      badges.push({
        id: `keyword-${keyword}`,
        label: 'Keyword',
        value: keyword,
        onRemove: () => removeFilterValue('keywords', keyword),
      });
    }
  }

  if (filters.priority?.length) {
    const priorityLabels: Record<string, string> = {
      high: 'High',
      medium: 'Medium',
      low: 'Low',
    };
    for (const p of filters.priority) {
      badges.push({
        id: `priority-${p}`,
        label: 'Priority',
        value: priorityLabels[p] ?? p,
        onRemove: () => removeFilterValue('priority', p),
      });
    }
  }

  if (filters.project) {
    badges.push({
      id: 'project',
      label: 'Project',
      value: filters.project.slice(0, 8) + '…',
      onRemove: () => removeFilter('project'),
    });
  }

  if (filters.user_tags?.length) {
    for (const tag of filters.user_tags) {
      badges.push({
        id: `user-tag-${tag}`,
        label: 'Tag',
        value: tag,
        onRemove: () => removeFilterValue('user_tags', tag),
      });
    }
  }

  if (filters.starred) {
    badges.push({
      id: 'starred',
      label: 'Filter',
      value: 'Starred only',
      onRemove: () => removeFilter('starred'),
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {badges.map((badge) => (
        <Badge
          key={badge.id}
          variant="secondary"
          className="flex items-center gap-1 py-1 pl-2 pr-1"
        >
          <span className="text-muted-foreground">{badge.label}:</span>
          <span>{badge.value}</span>
          <button
            type="button"
            onClick={badge.onRemove}
            className="relative ml-0.5 rounded-full p-0.5 transition-colors hover:bg-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring before:absolute before:-inset-2 before:content-['']"
            aria-label={`Remove ${badge.label} filter: ${badge.value}`}
          >
            <X className="size-3" />
          </button>
        </Badge>
      ))}

      {activeFilterCount > 1 && (
        <Button
          variant="ghost"
          size="xs"
          onClick={clearFilters}
          className="text-muted-foreground"
        >
          Clear all
        </Button>
      )}
    </div>
  );
}
