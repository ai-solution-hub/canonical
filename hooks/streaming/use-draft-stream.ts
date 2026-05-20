'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/query-keys';
import type { CitationEntry } from '@/types/procurement-metadata';

export type StreamPhase =
  | 'idle'
  | 'analysing'
  | 'drafting'
  | 'quality'
  | 'saving'
  | 'done'
  | 'error';

interface StreamState {
  phase: StreamPhase;
  text: string;
  citations: CitationEntry[];
  qualityScore: number | null;
  responseId: string | null;
  totalCost: number | null;
  error: string | null;
}

const INITIAL_STATE: StreamState = {
  phase: 'idle',
  text: '',
  citations: [],
  qualityScore: null,
  responseId: null,
  totalCost: null,
  error: null,
};

/**
 * Hook for consuming the SSE draft-stream endpoint.
 * Shows response text appearing in real time as it's generated.
 */
export function useDraftStream(procurementId: string) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<StreamState>(INITIAL_STATE);
  const abortRef = useRef<AbortController | null>(null);

  // Invalidate bid caches when stream completes
  useEffect(() => {
    if (state.phase === 'done') {
      queryClient.invalidateQueries({
        queryKey: queryKeys.bids.questions(procurementId),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.bids.detail(procurementId) });
    }
  }, [state.phase, procurementId, queryClient]);

  const startDraft = useCallback(
    async (questionId: string, modelTier?: 'analysis' | 'drafting') => {
      // Abort any in-flight stream
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setState({ ...INITIAL_STATE, phase: 'analysing' });

      try {
        const response = await fetch(
          `/api/procurement/${procurementId}/responses/draft-stream`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              question_id: questionId,
              model_tier: modelTier ?? 'drafting',
            }),
            signal: controller.signal,
          },
        );

        if (!response.ok) {
          const err = await response
            .json()
            .catch(() => ({ error: 'Request failed' }));
          setState((s) => ({
            ...s,
            phase: 'error',
            error: err.error ?? 'Request failed',
          }));
          return;
        }

        if (!response.body) {
          setState((s) => ({
            ...s,
            phase: 'error',
            error: 'No response body',
          }));
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // Parse SSE events from buffer
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? ''; // Keep incomplete line in buffer

          let eventType = '';
          let eventData = '';

          for (const line of lines) {
            if (line.startsWith('event: ')) {
              eventType = line.slice(7).trim();
            } else if (line.startsWith('data: ')) {
              eventData = line.slice(6);
            } else if (line === '' && eventType && eventData) {
              // End of event — process it
              try {
                const data = JSON.parse(eventData);
                handleEvent(eventType, data, setState);
              } catch {
                // Skip malformed events
              }
              eventType = '';
              eventData = '';
            }
          }
        }
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          setState((s) => ({
            ...s,
            phase: 'error',
            error: (err as Error).message ?? 'Stream failed',
          }));
        }
      }
    },
    [procurementId],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setState(INITIAL_STATE);
  }, []);

  return { ...state, startDraft, cancel };
}

function handleEvent(
  event: string,
  data: Record<string, unknown>,
  setState: React.Dispatch<React.SetStateAction<StreamState>>,
) {
  switch (event) {
    case 'pass1_complete':
      setState((s) => ({ ...s, phase: 'drafting' }));
      break;
    case 'token':
      setState((s) => ({ ...s, text: s.text + (data.text as string) }));
      break;
    case 'pass2_complete':
      setState((s) => ({
        ...s,
        phase: 'quality',
        citations: (data.citations as CitationEntry[]) ?? [],
      }));
      break;
    case 'pass3_complete': {
      const quality = data.quality as Record<string, unknown> | null;
      setState((s) => ({
        ...s,
        phase: 'saving',
        qualityScore: (quality?.overall_score as number) ?? null,
      }));
      break;
    }
    case 'done':
      setState((s) => ({
        ...s,
        phase: 'done',
        responseId: (data.response_id as string) ?? null,
        totalCost: (data.total_cost as number) ?? null,
      }));
      break;
    case 'error':
      setState((s) => ({
        ...s,
        phase: 'error',
        error: (data.error as string) ?? 'Unknown error',
      }));
      break;
  }
}
