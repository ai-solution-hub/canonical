'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, FileText, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { TemplateFieldReview } from '@/components/procurement/template-field-review';
import { TemplateFillProgress } from '@/components/procurement/template-fill-progress';
import { TemplateCompletionSummary } from '@/components/procurement/template-completion-summary';
import { ErrorBoundary } from '@/components/shared/error-boundary';
import type {
  FillResult,
  TemplateWithDetail,
  TemplateCompletion,
} from '@/types/template';
import { logger } from '@/lib/logger/client';

interface ProcurementQuestion {
  id: string;
  question_text: string;
  status: string;
}

type WorkflowStep = 'upload' | 'analyse' | 'review' | 'fill' | 'complete';

// ID-145 {145.15} BI-23 ANCHOR: fill/auto-map/complete key on the form's
// own id (`selectedTemplate.id`, passed as `templateId` to every mutating
// fetch below) — `form_instances` has no `workspace_id` post-{145.6} W1c
// (BI-1: the item IS the form). `procurementId` (this page's `[id]` param)
// is URL-namespacing only; it is never used as a scoping filter on a
// read/write. DR-064 spatial fill-slot review lands later via the ID-147
// spec chain — this page's workflow-step shell is otherwise unchanged.
export default function TemplateCompletionPage() {
  const params = useParams<{ id: string }>();
  const procurementId = params.id;

  const [selectedTemplate, setSelectedTemplate] =
    useState<TemplateWithDetail | null>(null);
  const [procurementQuestions, setProcurementQuestions] = useState<
    ProcurementQuestion[]
  >([]);
  const [step, setStep] = useState<WorkflowStep>('upload');
  const [loading, setLoading] = useState(true);
  const [fillJobId, setFillJobId] = useState<string | null>(null);
  const [latestCompletion, setLatestCompletion] =
    useState<TemplateCompletion | null>(null);
  const [fillResult, setFillResult] = useState<FillResult | null>(null);

  // Load bid questions. (ID-145 {145.41}: the sibling `GET .../templates`
  // list-fetch was removed here — that route was retired list/create in
  // {145.19} (DR-075), so it always 404'd and the "Existing Templates"
  // selector it fed could never render. See BI-4/DR-068 — no form-first
  // successor for the workspace-era "add another template" affordance.)
  useEffect(() => {
    async function load() {
      try {
        const questionsRes = await fetch(
          `/api/procurement/${procurementId}/questions`,
        );

        if (questionsRes.ok) {
          const data = await questionsRes.json();
          setProcurementQuestions(data.questions ?? []);
        }
      } catch (err) {
        logger.error({ err }, 'Failed to load template data');
        toast.error('Failed to load template data');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [procurementId]);

  const loadTemplateDetail = useCallback(
    async (templateId: string) => {
      try {
        // DR-075 re-path: `[id]/templates/[templateId]` retired -> the
        // field/§C surface now lives at `[id]/fields`, where `id` IS the
        // form's own PK (templateId here), matching the BI-23 fill/auto-map
        // anchor above.
        const res = await fetch(`/api/procurement/${templateId}/fields`);
        if (!res.ok) throw new Error('Failed to load template');
        const raw = await res.json();
        // Shape-sync: the response now selects `form_instances.processing_status`
        // (the dropped `form_templates.status` this page's TemplateWithDetail
        // type still expects) — map it onto the legacy `status` field the rest
        // of this workflow-step shell reads. `workspace_id` no longer exists
        // on the response either (form_instances has none post-{145.6}); this
        // page never reads it, kept here only to satisfy the Template shape.
        const detail: TemplateWithDetail = {
          ...raw,
          workspace_id: procurementId,
          status: raw.processing_status,
        };
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
      }
    },
    [procurementId],
  );

  const handleRefreshStatus = useCallback(async () => {
    if (!selectedTemplate) return;
    // Uploaded forms are processed automatically by the ingestion pipeline on
    // its next walk tick — there is no client-initiated step. Refresh to pick
    // up any fields already extracted for this template.
    toast.info(
      'This template is processed automatically. Refreshing to check for results.',
    );
    await loadTemplateDetail(selectedTemplate.id);
  }, [selectedTemplate, loadTemplateDetail]);

  const handleAutoMap = useCallback(async () => {
    if (!selectedTemplate) return;
    try {
      const res = await fetch(
        `/api/procurement/${procurementId}/templates/${selectedTemplate.id}/auto-map`,
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
  }, [procurementId, selectedTemplate, loadTemplateDetail]);

  const handleMappingUpdate = useCallback(
    async (fieldId: string, questionId: string | null, status: string) => {
      if (!selectedTemplate) return;
      try {
        // DR-075 re-path: `[id]/templates/[templateId]/fields/[fieldId]` ->
        // `[id]/fields/[fieldId]` (id = the form's own PK).
        const res = await fetch(
          `/api/procurement/${selectedTemplate.id}/fields/${fieldId}`,
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
    [selectedTemplate, loadTemplateDetail],
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
      // DR-075 re-path: `[id]/templates/[templateId]/fields/bulk-update` ->
      // `[id]/fields/bulk-update` (id = the form's own PK).
      const res = await fetch(
        `/api/procurement/${selectedTemplate.id}/fields/bulk-update`,
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
  }, [selectedTemplate, loadTemplateDetail]);

  const handleBulkReject = useCallback(
    async (fieldIds: string[]) => {
      if (!selectedTemplate || fieldIds.length === 0) return;

      const mappings = fieldIds.map((id) => ({
        field_id: id,
        question_id: null,
        mapping_status: 'rejected' as const,
      }));

      try {
        // DR-075 re-path: `[id]/templates/[templateId]/fields/bulk-update` ->
        // `[id]/fields/bulk-update` (id = the form's own PK).
        const res = await fetch(
          `/api/procurement/${selectedTemplate.id}/fields/bulk-update`,
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
    [selectedTemplate, loadTemplateDetail],
  );

  const handleFill = useCallback(async () => {
    if (!selectedTemplate) return;
    setStep('fill');
    try {
      const res = await fetch(
        `/api/procurement/${procurementId}/templates/${selectedTemplate.id}/fill`,
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
  }, [procurementId, selectedTemplate]);

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
        `/api/procurement/${procurementId}/templates/${selectedTemplate.id}/completions/${latestCompletion.id}/download`,
      );
      if (!res.ok) throw new Error('Failed to get download link');
      const { download_url } = await res.json();
      window.open(download_url, '_blank');
    } catch (err) {
      logger.error({ err }, 'Failed to download completed template');
      toast.error('Failed to download completed template');
    }
  }, [procurementId, selectedTemplate, latestCompletion]);

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
            <Link href={`/procurement/${procurementId}`}>
              <Button variant="ghost" size="sm">
                <ArrowLeft className="mr-1 size-4" aria-hidden="true" />
                Back to Procurement
              </Button>
            </Link>
            <h1 className="text-lg font-semibold">Template Completion</h1>
          </div>
        </div>

        {/* Upload step — retired (ID-145 {145.41}): the template list/create
            routes were retired in {145.19} (DR-075) with no form-first
            successor (BI-1/BI-4, DR-068). Clean empty state rather than a
            selector wired to fetches that can only ever 404. */}
        {(!selectedTemplate || step === 'upload') && (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-8 text-center">
            <FileText
              className="size-8 text-muted-foreground/50"
              aria-hidden="true"
            />
            <p className="text-sm text-muted-foreground">
              Template upload is not available for this item.
            </p>
          </div>
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
                  Template uploaded. It is processed automatically — fields
                  appear here once ready.
                </p>
              </div>
              <Button onClick={handleRefreshStatus}>Check for results</Button>
            </div>
          )}

        {/* Field review step */}
        {selectedTemplate && step === 'review' && selectedTemplate.fields && (
          <TemplateFieldReview
            templateId={selectedTemplate.id}
            procurementId={procurementId}
            fields={selectedTemplate.fields}
            procurementQuestions={procurementQuestions}
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
          />
        )}
      </div>
    </ErrorBoundary>
  );
}
