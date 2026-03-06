'use client';

import { useState, useCallback } from 'react';
import { toast } from 'sonner';

export interface VisionAnalysisResult {
  analysis: string;
  analysed_at: string;
  model: string;
  tokens_used: number;
}

export interface UseVisionAnalysisParams {
  itemId: string;
  onAnalysisComplete: (result: VisionAnalysisResult) => void;
}

export interface UseVisionAnalysisReturn {
  isAnalysing: boolean;
  handleVisionAnalysis: () => Promise<void>;
}

export function useVisionAnalysis({
  itemId,
  onAnalysisComplete,
}: UseVisionAnalysisParams): UseVisionAnalysisReturn {
  const [isAnalysing, setIsAnalysing] = useState(false);

  const handleVisionAnalysis = useCallback(async () => {
    setIsAnalysing(true);
    try {
      const res = await fetch(`/api/items/${itemId}/vision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Vision analysis failed');
        return;
      }
      // Notify caller of the completed analysis
      onAnalysisComplete({
        analysis: data.analysis,
        analysed_at: new Date().toISOString(),
        model: data.model,
        tokens_used: data.tokens_used,
      });
      toast.success('Visual analysis complete');
    } catch (err) {
      console.error('Failed to perform visual analysis:', err);
      toast.error('Failed to perform visual analysis');
    } finally {
      setIsAnalysing(false);
    }
  }, [itemId, onAnalysisComplete]);

  return {
    isAnalysing,
    handleVisionAnalysis,
  };
}
