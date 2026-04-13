'use client';

import { useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Plus, Rss } from 'lucide-react';
import { useUserRole } from '@/hooks/use-user-role';
import { ApiError } from '@/lib/query/fetchers';
import {
  useFeedSources,
  useCreateFeedSource,
  useUpdateFeedSource,
  useDeleteFeedSource,
  useTestFeedSource,
} from '@/hooks/intelligence/use-feed-sources';
import type {
  FeedSource,
  FeedSourceInput,
  TestPollResult,
} from '@/hooks/intelligence/use-feed-sources';
import { FeedSourceForm } from '@/components/intelligence/feed-source-form';
import type { LastAddedFeedConfirmation } from '@/components/intelligence/feed-source-form';
import { FeedSourceCard } from '@/components/intelligence/feed-source-card';
import { FeedSourceTestDialog } from '@/components/intelligence/feed-source-test-dialog';
import { SeedStarterPackDialog } from '@/components/intelligence/seed-starter-pack-dialog';

export default function FeedSourcesPage() {
  const params = useParams();
  const workspaceId = params.workspaceId as string;
  const { canAdmin } = useUserRole();

  const { data: sources, isLoading, error } = useFeedSources(workspaceId);
  const createMutation = useCreateFeedSource(workspaceId);
  const updateMutation = useUpdateFeedSource(workspaceId);
  const deleteMutation = useDeleteFeedSource(workspaceId);
  const testMutation = useTestFeedSource(workspaceId);

  const [showForm, setShowForm] = useState(false);
  const [editingSource, setEditingSource] = useState<FeedSource | null>(null);
  const [testDialogOpen, setTestDialogOpen] = useState(false);
  const [testResult, setTestResult] = useState<TestPollResult | null>(null);
  // SI-M5: hold the validated feed metadata returned by the create endpoint so
  // the form can show an inline confirmation card before being dismissed.
  const [lastAdded, setLastAdded] = useState<LastAddedFeedConfirmation | null>(
    null,
  );

  const handleCreate = useCallback(
    (data: FeedSourceInput) => {
      createMutation.mutate(data, {
        onSuccess: (response) => {
          setLastAdded({
            feed_title: response.feed_title,
            initial_article_count: response.initial_article_count,
          });
        },
      });
    },
    [createMutation],
  );

  const handleEdit = useCallback((source: FeedSource) => {
    setEditingSource(source);
    setLastAdded(null);
    setShowForm(true);
  }, []);

  const handleUpdate = useCallback(
    (data: FeedSourceInput) => {
      if (!editingSource) return;
      updateMutation.mutate(
        { sourceId: editingSource.id, data },
        {
          onSuccess: () => {
            setShowForm(false);
            setEditingSource(null);
          },
        },
      );
    },
    [editingSource, updateMutation],
  );

  const handleCancelForm = useCallback(() => {
    setShowForm(false);
    setEditingSource(null);
    setLastAdded(null);
  }, []);

  const handleDelete = useCallback(
    (sourceId: string) => {
      deleteMutation.mutate(sourceId);
    },
    [deleteMutation],
  );

  const handleToggleActive = useCallback(
    (source: FeedSource) => {
      updateMutation.mutate({
        sourceId: source.id,
        data: { is_active: !source.is_active },
      });
    },
    [updateMutation],
  );

  const handleTest = useCallback(
    (sourceId: string) => {
      setTestResult(null);
      setTestDialogOpen(true);
      testMutation.mutate(sourceId, {
        onSuccess: (data) => setTestResult(data),
        onError: () =>
          setTestResult({
            success: false,
            itemCount: 0,
            sampleTitles: [],
            error: 'Test request failed',
          }),
      });
    },
    [testMutation],
  );

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold text-foreground">Feed Sources</h2>
        {!showForm && (
          <div className="flex items-center gap-2">
            {canAdmin && <SeedStarterPackDialog workspaceId={workspaceId} />}
            <Button
              onClick={() => {
                setLastAdded(null);
                setShowForm(true);
              }}
              size="sm"
            >
              <Plus className="mr-1.5 size-4" />
              Add Source
            </Button>
          </div>
        )}
      </div>

      {/* Form (create or edit) */}
      {showForm && (
        <div className="mt-4">
          <FeedSourceForm
            initialData={editingSource ?? undefined}
            onSubmit={editingSource ? handleUpdate : handleCreate}
            onCancel={handleCancelForm}
            onTest={
              editingSource ? () => handleTest(editingSource.id) : undefined
            }
            isPending={
              editingSource
                ? updateMutation.isPending
                : createMutation.isPending
            }
            isTestPending={testMutation.isPending}
            lastAdded={editingSource ? null : lastAdded}
          />
        </div>
      )}

      {/* Loading state */}
      {isLoading && (
        <div className="mt-4 space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="h-28 animate-pulse rounded-lg border bg-card"
              role="status"
              aria-label="Loading source"
            >
              <span className="sr-only">Loading...</span>
            </div>
          ))}
        </div>
      )}

      {/* Error state */}
      {error && (
        <div
          className="mt-4 rounded-lg border border-destructive/50 bg-destructive/10 p-4"
          role="alert"
        >
          <p className="text-sm text-destructive">
            {error instanceof ApiError && error.status === 403
              ? 'You don\u2019t have permission to manage feed sources. Contact an administrator if you need access.'
              : 'Failed to load feed sources. Please try refreshing.'}
          </p>
        </div>
      )}

      {/* Source list */}
      {!isLoading && !error && sources && (
        <>
          {sources.length === 0 && !showForm ? (
            <div className="mt-8 text-center">
              <Rss
                className="mx-auto mb-3 size-8 text-muted-foreground/50"
                aria-hidden="true"
              />
              <p className="text-sm font-medium text-foreground">
                No feed sources configured
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Add an RSS feed URL to start monitoring.
              </p>
              <Button
                onClick={() => {
                  setLastAdded(null);
                  setShowForm(true);
                }}
                size="sm"
                className="mt-3"
              >
                <Plus className="mr-1.5 size-4" />
                Add Source
              </Button>
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              {sources.map((source) => (
                <FeedSourceCard
                  key={source.id}
                  source={source}
                  onEdit={() => handleEdit(source)}
                  onDelete={() => handleDelete(source.id)}
                  onToggleActive={() => handleToggleActive(source)}
                  canAdmin={canAdmin}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* Test dialog */}
      <FeedSourceTestDialog
        isOpen={testDialogOpen}
        onClose={() => setTestDialogOpen(false)}
        result={testResult}
        isPending={testMutation.isPending}
      />
    </div>
  );
}
