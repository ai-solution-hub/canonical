'use client';

import { useState, useEffect, useCallback } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ReadinessCriterion {
  name: string;
  passed: boolean;
  details: string;
}

interface QuestionIssue {
  question_number: number;
  question_title: string;
  issues: string[];
}

export interface ReadinessData {
  ready: boolean;
  summary: {
    total_questions: number;
    answered: number;
    approved: number;
    quality_checked: number;
    passing_quality: number;
  };
  criteria: ReadinessCriterion[];
  issues: QuestionIssue[];
}

interface UseBidReadinessReturn {
  readiness: ReadinessData | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useBidReadiness(bidId: string): UseBidReadinessReturn {
  const [readiness, setReadiness] = useState<ReadinessData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchReadiness = useCallback(async () => {
    if (!bidId) return;

    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/bids/${bidId}/readiness`);

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Failed to fetch readiness (${res.status})`);
      }

      const data: ReadinessData = await res.json();
      setReadiness(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to check readiness';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [bidId]);

  useEffect(() => {
    fetchReadiness();
  }, [fetchReadiness]);

  const refresh = useCallback(() => {
    fetchReadiness();
  }, [fetchReadiness]);

  return { readiness, isLoading, error, refresh };
}
