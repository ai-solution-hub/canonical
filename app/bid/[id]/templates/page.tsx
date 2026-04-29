'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, FileText, Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { TemplateUpload } from '@/components/coverage/template-upload';
import { TemplateFieldReview } from '@/components/bid/template-field-review';
import { TemplateFillProgress } from '@/components/bid/template-fill-progress';
import { TemplateCompletionSummary } from '@/components/bid/template-completion-summary';
import { ErrorBoundary } from '@/components/shared/error-boundary';
import type {
  FillResult,
  Template,
  TemplateWithDetail,
  TemplateCompletion,
} from '@/types/template';
import { logger } from '@/lib/logger';

interface BidQuestion {
  id: string;
  question_text: string;
  status: string;
}

type WorkflowStep = 'upload' | 'analyse' | 'review' | 'fill' | 'complete';

/** Maximum number of poll retries before timeout (150 x 2s = 5 minutes) */
const MAX_POLL_RETRIES = 150;

export default function TemplateCompletionPage() {
  const params = useParams<{ id: string }>();
  const bidId = params.id;

  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedTemplate, setSelectedTemplate] =
    useState<TemplateWithDetail | null>(null);
  const [bidQuestions, setBidQuestions] = useState<BidQuestion[]>([]);
  const [step, setStep] = useState<WorkflowStep>('upload');
  const [loading, setLoading] = useState(true);
  const [fillJobId, setFillJobId] = useState<string | null>(null);
  const [latestCompletion, setLatestCompletion] =
    useState<TemplateCompletion | null>(null);
  const [fillResult, setFillResult] = useState<FillResult | null>(null);
  const [loadingTemplateId, setLoadingTemplateId] = useState<string | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollRetryCountRef = useRef(0);

  // Clear polling interval on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, []);

  // Load existing templates and bid questions
  useEffect(() => {
    async function load() {
      try {
        const [templatesRes, questionsRes] = await Promise.all([
          fetch(`/api/bids/${bidId}/templates`),
          fetch(`/api/bids/${bidId}/questions`),
        ]);

        if (templatesRes.ok) {
          const data = await templatesRes.json();
          setTemplates(data.templates ?? []);
        }

        if (questionsRes.ok) {
          const data = await questionsRes.json();
          setBidQuestions(data.questions ?? []);
        }
      } catch (err) {
        logger.error({ err }, 'Failed to load template data');
        toast.error('Failed to load template data');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [bidId]);

  const loadTemplateDetail = useCallback(
    async (templateId: string) => {
      setLoadingTemplateId(templateId);
      try {
        const res = await fetch(`/api/bids/${bidId}/templates/${templateId}`);
        if (!res.ok) throw new Error('Failed to load template');
        const detail: TemplateWithDetail = await res.json();
        setSelectedTemplate(detail);

        // Determine step based on template status
        if (detail.status === 'uploaded') setStep('upload');
        else if (detail.status === 'analysing') setStep('analyse');
        else if (detail.status === 'analysed') setStep('review');
        else if (detail.status === 'filling') setStep('fill');
        else if (detail.status === 'completed') {
          setStep('complete');
          if (detail.completions.length > 0) {
            setLatestCompletion(detail.completions[0]);
          }
        } else if (
          detail.status === 'analysis_failed' ||
          detail.status === 'fill_failed'
        ) {
          setStep('review');
        } else {
          setStep('review');
        }
      } catch (err) {
        logger.error({ err }, 'Failed to load template details');
        toast.error('Failed to load template details');
      } finally {
        setLoadingTemplateId(null);
      }
    },
    [bidId],
  );

  const handleUploadComplete = useCallback(
    async (template: Template) => {
      setTemplates((prev) => [template, ...prev]);
      await loadTemplateDetail(template.id);
    },
    [loadTemplateDetail],
  );

  const handleAnalyse = useCallback(async () => {
    if (!selectedTemplate) return;
    setStep('analyse');
    try {
      const res = await fetch(
        `/api/bids/${bidId}/templates/${selectedTemplate.id}/analyse`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        },
      );

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? 'Analysis failed');
      }

      const { job_id } = await res.json();

      // Poll for analysis completion with retry bounds
      pollRetryCountRef.current = 0;
      setError(null);
      const poll = setInterval(async () => {
        try {
          pollRetryCountRef.current += 1;
          if (pollRetryCountRef.current >= MAX_POLL_RETRIES) {
            clearInterval(poll);
            pollIntervalRef.current = null;
            setError('Analysis timed out after 5 minutes. Please try again.');
            setStep('upload');
            return;
          }

          const statusRes = await fetch(`/api/jobs/${job_id}/status`);
          if (!statusRes.ok) return;
          const job = await statusRes.json();

          if (job.status === 'completed') {
            clearInterval(poll);
            pollIntervalRef.current = null;
            await loadTemplateDetail(selectedTemplate.id);
            toast.success(
              `Analysis complete: ${job.result?.fields_found ?? 0} fields found`,
            );
          } else if (job.status === 'failed') {
            clearInterval(poll);
            pollIntervalRef.current = null;
            toast.error(job.error_message ?? 'Analysis failed');
            await loadTemplateDetail(selectedTemplate.id);
          }
        } catch (err) {
          logger.error({ err }, 'Failed to poll analysis status');
          // Polling errors are non-fatal — keep retrying
        }
      }, 2000);
      pollIntervalRef.current = poll;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Analysis failed';
      toast.error(msg);
      await loadTemplateDetail(selectedTemplate.id);
    }
  }, [bidId, selectedTemplate, loadTemplateDetail]);

  const handleAutoMap = useCallback(async () => {
    if (!selectedTemplate) return;
    try {
      const res = await fetch(
        `/api/bids/${bidId}/templates/${selectedTemplate.id}/auto-map`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ threshold: 0.7 }),
        },
      );
      if (!res.ok) throw new Error('Auto-mapping failed');
      await loadTemplateDetail(selectedTemplate.id);
    } catch (err) {
      logger.error({ err }, 'Failed to auto-map template fields');
      toast.error('Failed to auto-map template fields');
    }
  }, [bidId, selectedTemplate, loadTemplateDetail]);

  const handleMappingUpdate = useCallback(
    async (fieldId: string, questionId: string | null, status: string) => {
      if (!selectedTemplate) return;
      try {
        const res = await fetch(
          `/api/bids/${bidId}/templates/${selectedTemplate.id}/fields/${fieldId}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              question_id: questionId,
              mapping_status: status,
            }),
          },
        );
        if (!res.ok) throw new Error('Update failed');
        await loadTemplateDetail(selectedTemplate.id);
      } catch (err) {
        logger.error({ err }, 'Failed to update field mapping');
        toast.error('Failed to update field mapping');
      }
    },
    [bidId, selectedTemplate, loadTemplateDetail],
  );

  const handleBulkAccept = useCallback(async () => {
    if (!selectedTemplate) return;
    const unreviewedFields = selectedTemplate.fields
      .filter((f) => f.mapping_status === 'unreviewed' && f.question_id)
      .map((f) => ({
        field_id: f.id,
        question_id: f.question_id,
        mapping_status: 'confirmed' as const,
      }));

    if (unreviewedFields.length === 0) return;

    try {
      const res = await fetch(
        `/api/bids/${bidId}/templates/${selectedTemplate.id}/fields/bulk-update`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mappings: unreviewedFields }),
        },
      );
      if (!res.ok) throw new Error('Bulk accept failed');
      await loadTemplateDetail(selectedTemplate.id);
    } catch (err) {
      logger.error({ err }, 'Failed to bulk accept mappings');
      toast.error('Failed to bulk accept mappings');
    }
  }, [bidId, selectedTemplate, loadTemplateDetail]);

  const handleBulkReject = useCallback(
    async (fieldIds: string[]) => {
      if (!selectedTemplate || fieldIds.length === 0) return;

      const mappings = fieldIds.map((id) => ({
        field_id: id,
        question_id: null,
        mapping_status: 'rejected' as const,
      }));

      try {
        const res = await fetch(
          `/api/bids/${bidId}/templates/${selectedTemplate.id}/fields/bulk-update`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mappings }),
          },
        );
        if (!res.ok) throw new Error('Bulk reject failed');
        await loadTemplateDetail(selectedTemplate.id);
      } catch (err) {
        logger.error({ err }, 'Failed to bulk reject mappings');
        toast.error('Failed to bulk reject mappings');
      }
    },
    [bidId, selectedTemplate, loadTemplateDetail],
  );

  const handleFill = useCallback(async () => {
    if (!selectedTemplate) return;
    setStep('fill');
    try {
      const res = await fetch(
        `/api/bids/${bidId}/templates/${selectedTemplate.id}/fill`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        },
      );

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? 'Fill failed');
      }

      const { job_id } = await res.json();
      setFillJobId(job_id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Fill failed';
      toast.error(msg);
      setStep('review');
    }
  }, [bidId, selectedTemplate]);

  const handleFillComplete = useCallback(
    async (result: Record<string, unknown>) => {
      if (!selectedTemplate) return;
      // Store fill result for truncation/error display in summary
      setFillResult(result as unknown as FillResult);
      // Reload to get fresh completion data
      await loadTemplateDetail(selectedTemplate.id);
      setStep('complete');
    },
    [selectedTemplate, loadTemplateDetail],
  );

  const handleDownload = useCallback(async () => {
    if (!selectedTemplate || !latestCompletion) return;
    try {
      const res = await fetch(
        `/api/bids/${bidId}/templates/${selectedTemplate.id}/completions/${latestCompletion.id}/download`,
      );
      if (!res.ok) throw new Error('Failed to get download link');
      const { download_url } = await res.json();
      window.open(download_url, '_blank');
    } catch (err) {
      logger.error({ err }, 'Failed to download completed template');
      toast.error('Failed to download completed template');
    }
  }, [bidId, selectedTemplate, latestCompletion]);

  const handleDownloadOriginal = useCallback(async () => {
    if (!selectedTemplate) return;
    try {
      const res = await fetch(
        `/api/bids/${bidId}/templates/${selectedTemplate.id}/download`,
      );
      if (!res.ok) throw new Error('Failed to get download link');
      const { download_url } = await res.json();
      window.open(download_url, '_blank');
    } catch (err) {
      logger.error({ err }, 'Failed to download original template');
      toast.error('Failed to download original template');
    }
  }, [bidId, selectedTemplate]);

  const handleRetry = useCallback(() => {
    setError(null);
    pollRetryCountRef.current = 0;
    if (selectedTemplate) {
      // Re-load template to determine correct step
      loadTemplateDetail(selectedTemplate.id);
    } else {
      setStep('upload');
    }
  }, [selectedTemplate, loadTemplateDetail]);

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <div className="flex items-center justify-center p-12">
          <Loader2
            className="size-8 animate-spin text-muted-foreground"
            aria-hidden="true"
          />
          <span className="sr-only">Loading template data</span>
        </div>
      </div>
    );
  }

  return (
    <ErrorBoundary label="Error loading templates">
      <div className="mx-auto max-w-5xl space-y-6 p-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href={`/bid/${bidId}`}>
              <Button variant="ghost" size="sm">
                <ArrowLeft className="mr-1 size-4" aria-hidden="true" />
                Back to Bid
              </Button>
            </Link>
            <h1 className="text-lg font-semibold">Template Completion</h1>
          </div>
        </div>

        {/* Template selector (if templates exist and none selected) */}
        {templates.length > 0 && !selectedTemplate && (
          <div className="space-y-3">
            <h2 className="text-sm font-medium">Existing Templates</h2>
            <div className="grid gap-2">
              {templates.map((t) => (
                <button
                  key={t.id}
                  className="flex items-center gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-muted/50 disabled:opacity-60"
                  onClick={() => loadTemplateDetail(t.id)}
                  aria-label={`Select template: ${t.name}`}
                  disabled={loadingTemplateId === t.id}
                >
                  {loadingTemplateId === t.id ? (
                    <Loader2
                      className="size-5 shrink-0 animate-spin text-muted-foreground"
                      aria-hidden="true"
                    />
                  ) : (
                    <FileText
                      className="size-5 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{t.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {t.status} · {t.field_count ?? 0} fields ·{' '}
                      {t.mapped_count} mapped
                    </p>
                  </div>
                </button>
              ))}
            </div>
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background px-2 text-muted-foreground">
                  or upload a new template
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Error banner — shown when polling times out */}
        {error && (
          <div
            className="flex items-center gap-3 rounded-lg border border-destructive/50 bg-destructive/10 p-4"
            role="alert"
          >
            <p className="flex-1 text-sm text-destructive">{error}</p>
            <Button variant="outline" size="sm" onClick={handleRetry}>
              <RefreshCw className="mr-1.5 size-3.5" aria-hidden="true" />
              Retry
            </Button>
          </div>
        )}

        {/* Upload step */}
        {(!selectedTemplate || step === 'upload') && (
          <TemplateUpload
            bidId={bidId}
            onUploadComplete={handleUploadComplete}
          />
        )}

        {/* Analyse step — spinner while analysis runs */}
        {selectedTemplate && step === 'analyse' && (
          <div className="flex flex-col items-center gap-3 rounded-lg border p-6 text-center">
            <Loader2
              className="size-8 animate-spin text-primary"
              aria-hidden="true"
            />
            <p className="text-sm font-medium">Analysing template...</p>
            <p className="text-xs text-muted-foreground">
              Identifying fields that need completing.
            </p>
          </div>
        )}

        {/* Template uploaded but not yet analysed — show analyse button */}
        {selectedTemplate &&
          selectedTemplate.status === 'uploaded' &&
          step !== 'analyse' && (
            <div className="flex flex-col items-center gap-3 rounded-lg border p-6 text-center">
              <FileText
                className="size-8 text-muted-foreground"
                aria-hidden="true"
              />
              <div>
                <p className="text-sm font-medium">{selectedTemplate.name}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Template uploaded. Ready for analysis.
                </p>
              </div>
              <Button onClick={handleAnalyse}>Analyse Template</Button>
            </div>
          )}

        {/* Field review step */}
        {selectedTemplate && step === 'review' && selectedTemplate.fields && (
          <TemplateFieldReview
            templateId={selectedTemplate.id}
            bidId={bidId}
            fields={selectedTemplate.fields}
            bidQuestions={bidQuestions}
            summary={selectedTemplate.summary}
            onMappingUpdate={handleMappingUpdate}
            onAutoMap={handleAutoMap}
            onFill={handleFill}
            onBulkAccept={handleBulkAccept}
            onBulkReject={handleBulkReject}
          />
        )}

        {/* Fill step — progress tracker */}
        {step === 'fill' && fillJobId && (
          <TemplateFillProgress
            jobId={fillJobId}
            onComplete={handleFillComplete}
            onError={(err) => {
              toast.error(err);
              setStep('review');
            }}
            onRetry={handleFill}
          />
        )}

        {/* Complete step — summary + download */}
        {step === 'complete' && selectedTemplate && latestCompletion && (
          <TemplateCompletionSummary
            completion={latestCompletion}
            templateName={selectedTemplate.name}
            onDownload={handleDownload}
            onRefill={() => setStep('review')}
            truncatedCount={fillResult?.truncated?.length}
            errors={fillResult?.errors}
            originalStoragePath={selectedTemplate.storage_path}
            onDownloadOriginal={handleDownloadOriginal}
          />
        )}
      </div>
    </ErrorBoundary>
  );
}
