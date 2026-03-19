'use client';

import { useState, type FormEvent, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Check, Loader2 } from 'lucide-react';
import { TenderUpload } from '@/components/tender-upload';
import { TenderMetadataPrompt } from '@/components/tender-metadata-prompt';
import { QuestionReview } from '@/components/question-review';
import { cn } from '@/lib/utils';
import type { ExtractionResult, ExtractedSection } from '@/types/bid';
import type { TenderExtractedMetadata } from '@/types/bid-metadata';

type WizardStep = 1 | 2 | 3;

interface BidCreationWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (bid: { id: string; name: string }) => void;
}

interface ExtractedQuestionEntry {
  section_name: string;
  section_sequence: number;
  question_sequence: number;
  question_text: string;
  word_limit?: number;
  category?: string;
}

/** Flatten ExtractionResult sections into a flat array for QuestionReview */
function flattenSections(sections: ExtractedSection[]): ExtractedQuestionEntry[] {
  return sections.flatMap((section) =>
    section.questions.map((q) => ({
      section_name: section.section_name,
      section_sequence: section.section_sequence,
      question_sequence: q.question_sequence,
      question_text: q.question_text,
      word_limit: q.word_limit ?? undefined,
      category: q.category ?? undefined,
    })),
  );
}

const STEP_LABELS = ['Bid Details', 'Upload Document', 'Review Questions'] as const;

export function BidCreationWizard({ open, onOpenChange, onCreated }: BidCreationWizardProps) {
  const router = useRouter();

  // Step state
  const [currentStep, setCurrentStep] = useState<WizardStep>(1);

  // Step 1: Bid details
  const [name, setName] = useState('');
  const [buyer, setBuyer] = useState('');
  const [deadline, setDeadline] = useState('');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [estimatedValue, setEstimatedValue] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Created bid reference
  const [createdBid, setCreatedBid] = useState<{ id: string; name: string } | null>(null);

  // Step 2-3: Extraction results
  const [extractionResult, setExtractionResult] = useState<ExtractionResult | null>(null);
  const [extractedMetadata, setExtractedMetadata] = useState<TenderExtractedMetadata | null>(null);
  const [flatQuestions, setFlatQuestions] = useState<ExtractedQuestionEntry[]>([]);

  function resetWizard() {
    setCurrentStep(1);
    setName('');
    setBuyer('');
    setDeadline('');
    setReferenceNumber('');
    setEstimatedValue('');
    setNotes('');
    setSaving(false);
    setError(null);
    setCreatedBid(null);
    setExtractionResult(null);
    setExtractedMetadata(null);
    setFlatQuestions([]);
  }

  function navigateToBid() {
    if (createdBid) {
      onOpenChange(false);
      onCreated(createdBid);
    }
  }

  // ── Step 1: Create the bid ──────────────────────────

  async function handleCreateBid(e: FormEvent, advanceToUpload: boolean) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    try {
      const body: Record<string, string | undefined> = {
        name: name.trim(),
        buyer: buyer.trim(),
      };
      if (deadline) {
        body.deadline = `${deadline}T17:00:00Z`;
      }
      if (referenceNumber.trim()) body.reference_number = referenceNumber.trim();
      if (estimatedValue.trim()) body.estimated_value = estimatedValue.trim();
      if (notes.trim()) body.notes = notes.trim();

      const response = await fetch('/api/bids', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `Failed to create bid (${response.status})`);
      }

      const created = await response.json();
      setCreatedBid(created);

      if (advanceToUpload) {
        setCurrentStep(2);
      } else {
        onOpenChange(false);
        onCreated(created);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create bid');
    } finally {
      setSaving(false);
    }
  }

  // ── Step 2: Handle upload completion ──────────────────

  const handleUploadComplete = useCallback(
    (result?: ExtractionResult) => {
      if (result && result.sections.length > 0) {
        setExtractionResult(result);
        setFlatQuestions(flattenSections(result.sections));

        // Check for extracted_metadata on the result object (present at runtime
        // from the API response even though the ExtractionResult type doesn't declare it)
        const resultAny = result as unknown as Record<string, unknown>;
        if (resultAny?.extracted_metadata) {
          setExtractedMetadata(resultAny.extracted_metadata as TenderExtractedMetadata);
        }

        setCurrentStep(3);
      } else {
        // No questions extracted — go directly to bid page
        navigateToBid();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [createdBid],
  );

  // ── Step 3: Question review callbacks ─────────────────

  function handleQuestionsConfirmed() {
    navigateToBid();
  }

  function handleQuestionsCancelled() {
    navigateToBid();
  }

  // ── Dialog size varies by step ────────────────────────

  const dialogSizeClass = currentStep === 3 ? 'sm:max-w-4xl' : 'sm:max-w-2xl';

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) resetWizard();
        onOpenChange(isOpen);
      }}
    >
      <DialogContent className={cn(dialogSizeClass, 'max-h-[90vh] overflow-y-auto')}>
        <DialogHeader>
          <DialogTitle>
            {currentStep === 1 && 'Create New Bid'}
            {currentStep === 2 && 'Upload Tender Document'}
            {currentStep === 3 && 'Review Extracted Questions'}
          </DialogTitle>
          <DialogDescription>
            {currentStep === 1 && 'Set up a new bid workspace with your bid details.'}
            {currentStep === 2 && 'Upload a tender document to extract questions automatically.'}
            {currentStep === 3 && 'Review and confirm the questions extracted from the tender document.'}
          </DialogDescription>
        </DialogHeader>

        {/* Step indicator */}
        <StepIndicator currentStep={currentStep} />

        {/* Step 1: Bid details form */}
        {currentStep === 1 && (
          <form
            onSubmit={(e) => handleCreateBid(e, true)}
            className="space-y-4"
          >
            <div className="space-y-1.5">
              <Label htmlFor="wizard-bid-name">
                Bid Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="wizard-bid-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. NHS Trust ITT 2026"
                required
                maxLength={200}
                disabled={saving}
                autoFocus
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="wizard-bid-buyer">
                Buyer / Issuing Organisation <span className="text-destructive">*</span>
              </Label>
              <Input
                id="wizard-bid-buyer"
                value={buyer}
                onChange={(e) => setBuyer(e.target.value)}
                placeholder="e.g. NHS Digital"
                required
                maxLength={200}
                disabled={saving}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="wizard-bid-deadline">Submission Deadline</Label>
              <Input
                id="wizard-bid-deadline"
                type="date"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
                disabled={saving}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="wizard-bid-reference">Reference Number</Label>
              <Input
                id="wizard-bid-reference"
                value={referenceNumber}
                onChange={(e) => setReferenceNumber(e.target.value)}
                placeholder="e.g. ITT-2026-042"
                maxLength={100}
                disabled={saving}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="wizard-bid-value">Estimated Value</Label>
              <Input
                id="wizard-bid-value"
                value={estimatedValue}
                onChange={(e) => setEstimatedValue(e.target.value)}
                placeholder="e.g. £50,000"
                maxLength={100}
                disabled={saving}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="wizard-bid-notes">Notes</Label>
              <Textarea
                id="wizard-bid-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Any additional notes about this bid"
                maxLength={5000}
                rows={3}
                disabled={saving}
              />
            </div>

            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}

            <div className="flex items-center justify-between pt-2">
              <Button
                type="button"
                variant="link"
                size="sm"
                className="text-muted-foreground"
                disabled={saving || !name.trim() || !buyer.trim()}
                onClick={(e) => handleCreateBid(e as unknown as FormEvent, false)}
              >
                Create Without Document
              </Button>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    resetWizard();
                    onOpenChange(false);
                  }}
                  disabled={saving}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={saving || !name.trim() || !buyer.trim()}>
                  {saving ? (
                    <>
                      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                      Creating...
                    </>
                  ) : (
                    'Next: Upload Tender'
                  )}
                </Button>
              </div>
            </div>
          </form>
        )}

        {/* Step 2: Upload tender document */}
        {currentStep === 2 && createdBid && (
          <div className="space-y-4">
            <TenderUpload
              bidId={createdBid.id}
              onUploadComplete={handleUploadComplete}
            />
            <div className="flex justify-end">
              <Button
                variant="outline"
                onClick={navigateToBid}
              >
                Skip
              </Button>
            </div>
          </div>
        )}

        {/* Step 3: Review extracted questions */}
        {currentStep === 3 && createdBid && (
          <div className="space-y-4">
            {extractedMetadata && (
              <TenderMetadataPrompt
                metadata={extractedMetadata}
                bidId={createdBid.id}
              />
            )}
            {flatQuestions.length > 0 && (
              <QuestionReview
                bidId={createdBid.id}
                questions={flatQuestions}
                onConfirmed={handleQuestionsConfirmed}
                onCancelled={handleQuestionsCancelled}
              />
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Step Indicator ────────────────────────────────────────

function StepIndicator({ currentStep }: { currentStep: WizardStep }) {
  return (
    <nav aria-label="Wizard progress" className="mb-2">
      <ol className="flex items-center gap-2">
        {STEP_LABELS.map((label, index) => {
          const stepNumber = (index + 1) as WizardStep;
          const isComplete = currentStep > stepNumber;
          const isCurrent = currentStep === stepNumber;

          return (
            <li key={label} className="flex items-center gap-2">
              {index > 0 && (
                <div
                  className={cn(
                    'h-px w-6 sm:w-10',
                    isComplete ? 'bg-primary' : 'bg-border',
                  )}
                  aria-hidden="true"
                />
              )}
              <div className="flex items-center gap-1.5">
                <span
                  className={cn(
                    'flex size-6 items-center justify-center rounded-full text-xs font-medium',
                    isComplete && 'bg-primary text-primary-foreground',
                    isCurrent && 'border-2 border-primary text-primary',
                    !isComplete && !isCurrent && 'border border-border text-muted-foreground',
                  )}
                  aria-current={isCurrent ? 'step' : undefined}
                >
                  {isComplete ? (
                    <Check className="size-3.5" aria-hidden="true" />
                  ) : (
                    stepNumber
                  )}
                </span>
                <span
                  className={cn(
                    'hidden text-xs font-medium sm:inline',
                    isCurrent ? 'text-foreground' : 'text-muted-foreground',
                  )}
                >
                  {label}
                </span>
              </div>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
