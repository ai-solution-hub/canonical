'use client';

import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import type {
  FeedSource,
  FeedSourceInput,
} from '@/hooks/intelligence/use-feed-sources';

interface FeedSourceFormProps {
  initialData?: FeedSource;
  onSubmit: (data: FeedSourceInput) => void;
  onCancel: () => void;
  onTest?: () => void;
  isPending: boolean;
  isTestPending?: boolean;
}

export function FeedSourceForm({
  initialData,
  onSubmit,
  onCancel,
  onTest,
  isPending,
  isTestPending,
}: FeedSourceFormProps) {
  const [name, setName] = useState(initialData?.name ?? '');
  const [url, setUrl] = useState(initialData?.url ?? '');
  const [sourceType, setSourceType] = useState<'rss' | 'web' | 'api'>(
    initialData?.source_type ?? 'rss',
  );
  const [pollingInterval, setPollingInterval] = useState(
    initialData?.polling_interval_minutes ?? 30,
  );
  const [isActive, setIsActive] = useState(initialData?.is_active ?? true);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      onSubmit({
        name,
        url,
        source_type: sourceType,
        polling_interval_minutes: pollingInterval,
        is_active: isActive,
      });
    },
    [name, url, sourceType, pollingInterval, isActive, onSubmit],
  );

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-lg border bg-card p-4 shadow-sm"
    >
      <h3 className="mb-4 text-base font-semibold text-foreground">
        {initialData ? 'Edit Feed Source' : 'Add Feed Source'}
      </h3>

      <div className="space-y-4">
        {/* Name */}
        <div className="space-y-2">
          <Label htmlFor="source-name">Name *</Label>
          <Input
            id="source-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Gov.uk Education Updates"
            required
          />
        </div>

        {/* URL */}
        <div className="space-y-2">
          <Label htmlFor="source-url">Feed URL *</Label>
          <div className="flex gap-2">
            <Input
              id="source-url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/feed.xml"
              required
              className="flex-1"
            />
            {onTest && initialData && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onTest}
                disabled={isTestPending}
              >
                {isTestPending ? 'Testing...' : 'Test Feed'}
              </Button>
            )}
          </div>
        </div>

        {/* Source type and polling interval */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="source-type">Source Type</Label>
            <Select
              value={sourceType}
              onValueChange={(v) => setSourceType(v as 'rss' | 'web' | 'api')}
            >
              <SelectTrigger id="source-type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="rss">RSS / Atom</SelectItem>
                <SelectItem value="web">Web Page</SelectItem>
                <SelectItem value="api">API</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="source-interval">Poll Interval (minutes)</Label>
            <Input
              id="source-interval"
              type="number"
              min={5}
              max={1440}
              value={pollingInterval}
              onChange={(e) => setPollingInterval(Number(e.target.value))}
            />
          </div>
        </div>

        {/* Active toggle */}
        <div className="flex items-center gap-3">
          <Switch
            id="source-active"
            checked={isActive}
            onCheckedChange={setIsActive}
          />
          <Label htmlFor="source-active" className="cursor-pointer">
            Active (included in polling)
          </Label>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-end gap-3">
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={isPending || !name || !url}>
          {isPending
            ? 'Saving...'
            : initialData
              ? 'Update Source'
              : 'Add Source'}
        </Button>
      </div>
    </form>
  );
}
