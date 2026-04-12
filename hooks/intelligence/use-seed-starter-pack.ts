'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/query-keys';
import { mutationFetchJson } from '@/lib/query/fetchers';
import { toast } from 'sonner';

export interface SeedStarterPackResult {
  starter_pack_id: string;
  starter_pack_name: string;
  seeded: string[];
  skipped_existing: string[];
  failed: Array<{ url: string; error: string }>;
  warnings?: string[];
}

export function useSeedStarterPack(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: queryKeys.intelligence.sources.seedStarterPack(workspaceId),
    mutationFn: (starterPackId: string) =>
      mutationFetchJson<SeedStarterPackResult>(
        `/api/intelligence/workspaces/${workspaceId}/seed-starter-pack`,
        { starter_pack_id: starterPackId },
      ),
    onSuccess: (data) => {
      // Invalidate the sources list so the UI refreshes immediately
      queryClient.invalidateQueries({
        queryKey: queryKeys.intelligence.sources.all(workspaceId),
      });

      const seededCount = data.seeded.length;
      const skippedCount = data.skipped_existing.length;
      const failedCount = data.failed.length;

      if (seededCount > 0 && failedCount === 0) {
        const skippedNote =
          skippedCount > 0 ? ` (${skippedCount} already existed)` : '';
        toast.success(
          `Seeded ${seededCount} feed${seededCount === 1 ? '' : 's'} from "${data.starter_pack_name}"${skippedNote}`,
        );
      } else if (seededCount > 0 && failedCount > 0) {
        toast.warning(
          `Seeded ${seededCount} feed${seededCount === 1 ? '' : 's'}, ${failedCount} failed`,
        );
      } else if (seededCount === 0 && skippedCount > 0) {
        toast.info('All feeds from this starter pack already exist');
      } else {
        toast.error('Failed to seed any feeds');
      }
    },
    onError: (err: Error) => toast.error(err.message),
  });
}
