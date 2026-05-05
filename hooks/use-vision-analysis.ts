'use client';

import { useMutation } from '@tanstack/react-query';
import { mutationFetchJson } from '@/lib/query/fetchers';
import { toast } from 'sonner';

export interface VisionAnalysisResult {
  analysis: string;
  analysed_at: string;
  model: string;
  tokens_used: number;
}

/** @public */
export interface UseVisionAnalysisParams {
  itemId: string;
  onAnalysisComplete: (result: VisionAnalysisResult) => void;
}

/** @public */
export interface UseVisionAnalysisReturn {
  isAnalysing: boolean;
  handleVisionAnalysis: () => void;
}

/**
 * Triggers visual analysis of a content item via the vision API endpoint.
 *
 * Migrated from useState+useCallback to useMutation. The mutation handles
 * loading state, error toasts, and success callbacks automatically.
 */
export function useVisionAnalysis({
  itemId,
  onAnalysisComplete,
}: UseVisionAnalysisParams): UseVisionAnalysisReturn {
  const mutation = useMutation({
    mutationFn: () =>
      mutationFetchJson<{
        analysis: string;
        model: string;
        tokens_used: number;
      }>(`/api/items/${itemId}/vision`, {}),
    onSuccess: (data) => {
      onAnalysisComplete({
        analysis: data.analysis,
        analysed_at: new Date().toISOString(),
        model: data.model,
        tokens_used: data.tokens_used,
      });
      toast.success('Visual analysis complete');
    },
    onError: (error) => {
      console.error('Failed to perform visual analysis:', error);
      toast.error(
        error instanceof Error && error.message !== 'Request failed: 500'
          ? error.message
          : 'Failed to perform visual analysis',
      );
    },
  });

  return {
    isAnalysing: mutation.isPending,
    handleVisionAnalysis: () => mutation.mutate(),
  };
}
