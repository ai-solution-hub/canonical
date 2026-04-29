'use client';

import { useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { BulkProgress, BulkRunnerReturn } from './types';
import { logger } from '@/lib/logger';

/**
 * Shared sequential bulk-operation runner with progress tracking.
 *
 * Runs an async operation over each ID sequentially, tracks progress,
 * and invalidates TanStack Query caches on completion.
 *
 * @param queryInvalidationKey - TanStack Query key to invalidate after completion
 */
export function useContentBulkRunner<TItem = unknown>(
  queryInvalidationKey: readonly unknown[],
): BulkRunnerReturn<TItem> {
  const queryClient = useQueryClient();

  const [bulkOperating, setBulkOperating] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<BulkProgress>({
    current: 0,
    total: 0,
    label: '',
  });

  const runBulkOperation = useCallback(
    async (
      label: string,
      ids: string[],
      operation: (id: string, item?: TItem) => Promise<boolean>,
      itemLookup?: (id: string) => TItem | undefined,
    ): Promise<number> => {
      if (ids.length === 0) return 0;
      setBulkOperating(true);
      setBulkProgress({ current: 0, total: ids.length, label });
      let successCount = 0;
      let errorCount = 0;

      for (let i = 0; i < ids.length; i++) {
        const item = itemLookup ? itemLookup(ids[i]) : undefined;

        // Skip items that should exist but cannot be found via lookup
        if (itemLookup && !item) {
          setBulkProgress({ current: i + 1, total: ids.length, label });
          continue;
        }

        try {
          const ok = await operation(ids[i], item);
          if (ok) successCount++;
          else errorCount++;
        } catch (err) {
          errorCount++;
          logger.error(
            { err },
            `Bulk operation "${label}" failed for item ${ids[i]}`,
          );
        }

        setBulkProgress({ current: i + 1, total: ids.length, label });
      }

      setBulkOperating(false);
      setBulkProgress({ current: 0, total: 0, label: '' });

      // Invalidate queries so TanStack Query refetches automatically
      await queryClient.invalidateQueries({
        queryKey: queryInvalidationKey,
      });

      if (errorCount > 0) {
        toast.error(
          `${errorCount} item${errorCount !== 1 ? 's' : ''} failed during ${label.toLowerCase()}`,
        );
      }

      return successCount;
    },
    [queryClient, queryInvalidationKey],
  );

  return {
    bulkOperating,
    bulkProgress,
    runBulkOperation,
  };
}
