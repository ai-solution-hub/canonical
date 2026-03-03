'use client';

import { useState, useEffect, useRef } from 'react';
import { useReadMarks } from '@/contexts/read-marks-context';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';

const MILESTONES = [10, 25, 50, 100, 250, 500];

interface UseProgressReturn {
  readCount: number;
  totalCount: number;
  unreadCount: number;
  percentage: number;
  streak: number;
  itemsThisWeek: number;
  isLoaded: boolean;
}

export function useProgress(): UseProgressReturn {
  const supabase = createClient();
  const { readItemIds, totalCount, isLoaded, loadReadMarks } = useReadMarks();

  // Trigger lazy loading of read marks for consumers of this hook
  useEffect(() => { loadReadMarks(); }, [loadReadMarks]);
  const [streak, setStreak] = useState(0);
  const [itemsThisWeek, setItemsThisWeek] = useState(0);
  const celebratedRef = useRef<Set<number>>(new Set());

  const readCount = readItemIds.size;
  const unreadCount = totalCount - readCount;
  const percentage =
    totalCount > 0 ? Math.round((readCount / totalCount) * 100) : 0;

  // Calculate streak and items this week from read_marks
  // L1 fix: added 30-day date filter to prevent unbounded query
  useEffect(() => {
    async function calculateStats() {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const { data, error } = await supabase
        .from('read_marks')
        .select('read_at')
        .gte('read_at', thirtyDaysAgo.toISOString())
        .order('read_at', { ascending: false });

      if (error || !data?.length) {
        setStreak(0);
        setItemsThisWeek(0);
        return;
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
        setStreak(0);
        setItemsThisWeek(0);
        return;
      }

      // Check if today or yesterday is included (streak must be current)
      const today = new Date();
      const todayStr = today.toISOString().split('T')[0];
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];

      if (sortedDates[0] !== todayStr && sortedDates[0] !== yesterdayStr) {
        setStreak(0);
      } else {
        // Count consecutive days
        let count = 1;
        for (let i = 1; i < sortedDates.length; i++) {
          const current = new Date(sortedDates[i - 1]);
          const prev = new Date(sortedDates[i]);
          const diffMs = current.getTime() - prev.getTime();
          const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

          if (diffDays === 1) {
            count++;
          } else {
            break;
          }
        }
        setStreak(count);
      }

      // Calculate items this week (Monday start)
      const startOfWeek = new Date();
      startOfWeek.setDate(
        startOfWeek.getDate() - ((startOfWeek.getDay() + 6) % 7),
      ); // Monday
      startOfWeek.setHours(0, 0, 0, 0);

      const thisWeekCount = data.filter((row: { read_at: string }) => {
        return new Date(row.read_at) >= startOfWeek;
      }).length;
      setItemsThisWeek(thisWeekCount);
    }

    if (isLoaded) {
      calculateStats();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, readItemIds]);

  // Milestone celebrations
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
