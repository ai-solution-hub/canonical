'use client';

import { useState, useCallback, useEffect } from 'react';
import { Flag } from 'lucide-react';
import { toast } from 'sonner';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export type Priority = 'high' | 'medium' | 'low' | null;

const PRIORITY_CONFIG = {
  high: { label: 'High', colour: 'text-priority-high', dot: 'bg-priority-high', fill: 'fill-priority-high' },
  medium: { label: 'Medium', colour: 'text-priority-medium', dot: 'bg-priority-medium', fill: 'fill-priority-medium' },
  low: { label: 'Low', colour: 'text-priority-low', dot: 'bg-priority-low', fill: 'fill-priority-low' },
} as const;

const PRIORITY_OPTIONS: { value: Priority; label: string }[] = [
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
  { value: null, label: 'Clear' },
];

interface PrioritySelectorProps {
  itemId: string;
  priority: Priority;
  size?: 'sm' | 'md';
  onChanged?: (priority: Priority) => void;
  className?: string;
}

export function PrioritySelector({
  itemId,
  priority: initialPriority,
  size = 'md',
  onChanged,
  className,
}: PrioritySelectorProps) {
  const [priority, setPriority] = useState<Priority>(initialPriority);
  const [isPending, setIsPending] = useState(false);
  const [open, setOpen] = useState(false);

  // Sync internal state when parent prop changes
  useEffect(() => {
    setPriority(initialPriority);
  }, [initialPriority]);

  const handleSelect = useCallback(
    async (newPriority: Priority) => {
      if (isPending) return;

      const previousPriority = priority;

      // Optimistic update
      setPriority(newPriority);
      onChanged?.(newPriority);
      setOpen(false);
      setIsPending(true);

      try {
        const res = await fetch(`/api/items/${itemId}/priority`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ priority: newPriority }),
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || 'Failed to update priority');
        }

        const label = newPriority
          ? PRIORITY_CONFIG[newPriority].label
          : 'Cleared';
        toast(`Priority: ${label}`, { duration: 1500 });
      } catch (err) {
        console.error('Failed to update priority:', err);
        // Rollback
        setPriority(previousPriority);
        onChanged?.(previousPriority);
        toast.error('Failed to update priority');
      } finally {
        setIsPending(false);
      }
    },
    [isPending, priority, itemId, onChanged],
  );

  const config = priority ? PRIORITY_CONFIG[priority] : null;
  const iconSize = size === 'sm' ? 'size-4' : 'size-5';

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={isPending}
          aria-label={
            priority
              ? `Priority: ${PRIORITY_CONFIG[priority].label}`
              : 'Set priority'
          }
          className={cn(
            'inline-flex items-center justify-center rounded-md p-1 transition-all duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-90',
            isPending && 'opacity-50',
            className,
          )}
        >
          <Flag
            className={cn(
              iconSize,
              'transition-colors duration-150',
              config
                ? `${config.colour} ${config.fill}`
                : 'fill-none text-muted-foreground hover:text-foreground',
            )}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-36 p-1">
        <div className="flex flex-col">
          {PRIORITY_OPTIONS.map((option) => {
            const optConfig = option.value
              ? PRIORITY_CONFIG[option.value]
              : null;
            const isActive = priority === option.value;
            return (
              <button
                key={option.value ?? 'clear'}
                type="button"
                onClick={() => handleSelect(option.value)}
                className={cn(
                  'flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm transition-colors hover:bg-accent',
                  isActive && 'bg-accent font-medium',
                )}
              >
                {optConfig ? (
                  <span
                    className={cn('size-2 rounded-full', optConfig.dot)}
                  />
                ) : (
                  <span className="size-2 rounded-full bg-muted-foreground/30" />
                )}
                {option.label}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Small badge to indicate priority on cards/rows */
export function PriorityBadge({ priority }: { priority: string | null }) {
  if (!priority || !(priority in PRIORITY_CONFIG)) return null;
  const config = PRIORITY_CONFIG[priority as keyof typeof PRIORITY_CONFIG];
  return (
    <span
      className={cn('size-2 shrink-0 rounded-full', config.dot)}
      aria-label={`${config.label} priority`}
      title={`${config.label} priority`}
    />
  );
}
