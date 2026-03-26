'use client';

import { useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { formatQAContent } from '@/components/batch-qa-preview-table';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BatchQAPair {
  question: string;
  answer: string;
}

export interface BatchCreateItem {
  id: string;
  title: string;
  status: 'created' | 'failed';
  error?: string;
}

export interface BatchCreateResult {
  created: number;
  failed: number;
  items: BatchCreateItem[];
  pipeline_run_id: string | null;
  batch_id: string;
}

export interface BatchCreateProgress {
  current: number;
  total: number;
}

export interface DuplicateMatch {
  id: string;
  title: string;
  question: string;
}

export interface UseBatchCreateReturn {
  submit: (
    pairs: BatchQAPair[],
    options?: {
      domain?: string;
      subtopic?: string;
      sourceDocumentLink?: string;
    },
  ) => Promise<BatchCreateResult | null>;
  checkDuplicates: (pairs: BatchQAPair[]) => Promise<DuplicateMatch[]>;
  isSubmitting: boolean;
  isCheckingDuplicates: boolean;
  progress: BatchCreateProgress;
  results: BatchCreateResult | null;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Hook wrapping the `POST /api/items/batch` endpoint for batch Q&A creation.
 *
 * Provides submit, progress tracking, duplicate checking, and error handling.
 */
export function useBatchCreate(): UseBatchCreateReturn {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCheckingDuplicates, setIsCheckingDuplicates] = useState(false);
  const [progress, setProgress] = useState<BatchCreateProgress>({ current: 0, total: 0 });
  const [results, setResults] = useState<BatchCreateResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * Check for potential duplicate titles before submission.
   * Uses a lightweight `ilike` search — best-effort, not semantic.
   */
  const checkDuplicates = useCallback(async (pairs: BatchQAPair[]): Promise<DuplicateMatch[]> => {
    setIsCheckingDuplicates(true);
    try {
      const supabase = createClient();
      const matches: DuplicateMatch[] = [];

      // Check each question against existing content_items titles.
      // Batch into a single query using `or` filters to reduce round-trips.
      for (const pair of pairs) {
        // Trim to first 100 chars for the search to avoid overly long queries
        const searchTerm = pair.question.slice(0, 100).replace(/%/g, '\\%');
        const { data } = await supabase
          .from('content_items')
          .select('id, title')
          .ilike('title', `%${searchTerm}%`)
          .limit(3);

        if (data && data.length > 0) {
          for (const item of data) {
            // Avoid duplicate entries in the matches list
            if (!matches.some((m) => m.id === item.id)) {
              matches.push({
                id: item.id,
                title: item.title,
                question: pair.question,
              });
            }
          }
        }
      }

      return matches;
    } catch {
      // Non-fatal — duplicate checking is best-effort
      return [];
    } finally {
      setIsCheckingDuplicates(false);
    }
  }, []);

  /**
   * Submit batch Q&A pairs to the API.
   * Each pair is formatted as "Q: {question}\n\nA: {answer}".
   */
  const submit = useCallback(async (
    pairs: BatchQAPair[],
    options?: {
      domain?: string;
      subtopic?: string;
      sourceDocumentLink?: string;
    },
  ): Promise<BatchCreateResult | null> => {
    setIsSubmitting(true);
    setError(null);
    setResults(null);
    setProgress({ current: 0, total: pairs.length });

    try {
      const items = pairs.map((pair) => ({
        title: pair.question,
        content: formatQAContent(pair),
        contentType: 'q_a_pair' as const,
      }));

      const body: Record<string, unknown> = { items };

      // The batch API accepts source_document_id (UUID). The sourceDocumentLink
      // is a URL, so we do not pass it as source_document_id. Instead, we pass
      // it via metadata if needed in the future. For now, we only support UUID.
      if (options?.sourceDocumentLink) {
        // Only pass if it looks like a UUID
        const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (uuidPattern.test(options.sourceDocumentLink)) {
          body.source_document_id = options.sourceDocumentLink;
        }
      }

      const res = await fetch('/api/items/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Batch creation failed');
      }

      const result: BatchCreateResult = {
        created: data.created,
        failed: data.failed,
        items: data.items,
        pipeline_run_id: data.pipeline_run_id,
        batch_id: data.batch_id,
      };

      setProgress({ current: pairs.length, total: pairs.length });
      setResults(result);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Batch creation failed';
      setError(message);
      return null;
    } finally {
      setIsSubmitting(false);
    }
  }, []);

  return {
    submit,
    checkDuplicates,
    isSubmitting,
    isCheckingDuplicates,
    progress,
    results,
    error,
  };
}
