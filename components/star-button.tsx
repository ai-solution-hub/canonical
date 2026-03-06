'use client';

import { useState, useCallback, useEffect } from 'react';
import { Star } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';

interface StarButtonProps {
  itemId: string;
  starred: boolean;
  size?: 'sm' | 'md';
  onToggle?: (starred: boolean) => void;
  className?: string;
}

export function StarButton({
  itemId,
  starred: initialStarred,
  size = 'sm',
  onToggle,
  className,
}: StarButtonProps) {
  const [starred, setStarred] = useState(initialStarred);
  const [isPending, setIsPending] = useState(false);

  // Sync internal state when parent prop changes (e.g. keyboard shortcut toggle)
  useEffect(() => {
    setStarred(initialStarred);
  }, [initialStarred]);

  const handleClick = useCallback(
    async (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (isPending) return;

      const newStarred = !starred;

      // Optimistic update
      setStarred(newStarred);
      onToggle?.(newStarred);
      setIsPending(true);

      try {
        const supabase = createClient();
        const { error } = await supabase.rpc('toggle_star', {
          p_item_id: itemId,
          p_starred: newStarred,
        });

        if (error) {
          // Rollback
          setStarred(!newStarred);
          onToggle?.(!newStarred);
          console.error('Failed to toggle star:', error.message);
        }
      } catch (err) {
        console.error('Failed to toggle star:', err);
        // Rollback
        setStarred(!newStarred);
        onToggle?.(!newStarred);
      } finally {
        setIsPending(false);
      }
    },
    [starred, isPending, itemId, onToggle],
  );

  const iconSize = size === 'sm' ? 'size-4' : 'size-5';

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      aria-label={starred ? 'Remove star' : 'Star this item'}
      aria-pressed={starred}
      className={cn(
        'inline-flex items-center justify-center rounded-md p-1 transition-all duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-90',
        isPending && 'opacity-50',
        className,
      )}
    >
      <Star
        className={cn(
          iconSize,
          'transition-colors duration-150',
          starred
            ? 'fill-star text-star'
            : 'fill-none text-muted-foreground hover:text-foreground',
        )}
      />
    </button>
  );
}
