'use client';

import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface PaginationControlsProps {
  itemCount: number;
  totalCount: number | null;
  isLoadingMore: boolean;
  onLoadMore: () => void;
}

export function PaginationControls({
  itemCount,
  totalCount,
  isLoadingMore,
  onLoadMore,
}: PaginationControlsProps) {
  return (
    <div className="mt-8 flex justify-center">
      <Button
        variant="outline"
        onClick={onLoadMore}
        disabled={isLoadingMore}
        className="mx-auto"
      >
        {isLoadingMore ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            Loading...
          </>
        ) : (
          <>
            Load more
            <span className="hidden sm:inline">
              {' '}(showing {itemCount} of {totalCount?.toLocaleString('en-GB') ?? '...'})
            </span>
          </>
        )}
      </Button>
    </div>
  );
}
