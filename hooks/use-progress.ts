'use client';

import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useReadMarks } from '@/contexts/read-marks-context';
import { createClient } from '@/lib/supabase/client';
import { queryKeys } from '@/lib/query/query-keys';
import { toast } from 'sonner';

const MILESTONES = [10, 25, 50, 100, 250, 500];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProgressStats {
  streak: number;
  itemsThisWeek: number;
}

interface UseProgressReturn {
  readCount: number;
  totalCount: number;
  unreadCount: number;
  percentage: number;
  streak: number;
  itemsThisWeek: number;
  isLoaded: boolean;
}

// ---------------------------------------------------------------------------
// Query function
// ---------------------------------------------------------------------------

/**
 * Fetches read_marks from the last 30 days and computes streak + items this week.
 * Moved out of useEffect to serve as the queryFn for TanStack Query.
 */
async function fetchProgressStats(): Promise<ProgressStats> {
  const supabase = createClient();
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const { data, error } = await supabase
    .from('read_marks')
    .select('read_at')
    .gte('read_at', thirtyDaysAgo.toISOString())
    .order('read_at', { ascending: false });

  if (error || !data?.length) {
    return { streak: 0, itemsThisWeek: 0 };
  }

  // Get distinct dates (YYYY-MM-DD) in descending order
  const distinctDates = new Set<string>();
  for (const row of data) {
    if (row.read_at) {
      distinctDates.add(row.read_at.split('T')[0]);
    }
  }

  const sortedDates = Array.from(distinctDates).sort().reverse();
  if (sortedDates.length === 0) {
    return { streak: 0, itemsThisWeek: 0 };
  }

  // Check if today or yesterday is included (streak must be current)
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];

  let streak = 0;
  if (sortedDates[0] !== todayStr && sortedDates[0] !== yesterdayStr) {
    streak = 0;
  } else {
    // Count consecutive days
    streak = 1;
    for (let i = 1; i < sortedDates.length; i++) {
      const current = new Date(sortedDates[i - 1]);
      const prev = new Date(sortedDates[i]);
      const diffMs = current.getTime() - prev.getTime();
      const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

      if (diffDays === 1) {
        streak++;
      } else {
        break;
      }
    }
  }

  // Calculate items this week (Monday start)
  const startOfWeek = new Date();
  startOfWeek.setDate(
    startOfWeek.getDate() - ((startOfWeek.getDay() + 6) % 7),
  ); // Monday
  startOfWeek.setHours(0, 0, 0, 0);

  const itemsThisWeek = data.filter((row: { read_at: string }) => {
    return new Date(row.read_at) >= startOfWeek;
  }).length;

  return { streak, itemsThisWeek };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Progress tracking hook using TanStack Query.
 *
 * Streak/week calculation is a useQuery (Supabase direct query, enabled when
 * read marks are loaded). Milestone celebrations stay as a useEffect (side
 * effect, not a query). Derived values (unreadCount, percentage) are computed
 * from readCount/totalCount.
 *
 * Return interface is preserved exactly for zero consumer changes.
 */
export function useProgress(): UseProgressReturn {
  const { readCount, totalCount, isLoaded, loadReadMarks } = useReadMarks();

  // Trigger lazy loading of read marks counts for consumers of this hook
  useEffect(() => { loadReadMarks(); }, [loadReadMarks]);

  const celebratedRef = useRef<Set<number>>(new Set());

  // Derived values
  const unreadCount = totalCount - readCount;
  const percentage =
    totalCount > 0 ? Math.round((readCount / totalCount) * 100) : 0;

  // Streak and items this week from read_marks — uses TanStack Query
  const { data: stats } = useQuery({
    queryKey: queryKeys.progress.stats(readCount),
    queryFn: fetchProgressStats,
    enabled: isLoaded,
    staleTime: 60_000,
  });

  const streak = stats?.streak ?? 0;
  const itemsThisWeek = stats?.itemsThisWeek ?? 0;

  // Milestone celebrations (side effect — not a query)
  useEffect(() => {
    if (!isLoaded || readCount === 0) return;

    // Check if all items read
    if (
      readCount === totalCount &&
      totalCount > 0 &&
      !celebratedRef.current.has(-1)
    ) {
      celebratedRef.current.add(-1);
      toast.success('All items reviewed! Incredible work!', { duration: 5000 });
      return;
    }

    for (const milestone of MILESTONES) {
      if (readCount >= milestone && !celebratedRef.current.has(milestone)) {
        celebratedRef.current.add(milestone);
        toast.success(`${milestone} items reviewed! Keep going!`, {
          duration: 4000,
        });
      }
    }
  }, [readCount, totalCount, isLoaded]);

  return {
    readCount,
    totalCount,
    unreadCount,
    percentage,
    streak,
    itemsThisWeek,
    isLoaded,
  };
}
