'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import Link from 'next/link';
import { Globe, Loader2, AlertCircle, Link2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  IngestionProgress,
  type IngestionStep,
} from '@/components/create-content/ingestion-progress';
import { IngestionSuccessCard } from '@/components/create-content/ingestion-success-card';
import { ClaudePromptButton } from '@/components/content/claude-prompt-button';
import { generateIngestDocumentPrompt } from '@/lib/claude-prompts';

type FormState = 'idle' | 'processing' | 'success' | 'error';

interface ExistingItem {
  id: string;
  title: string;
}

/**
 * Reduced reference-ingest response from POST /api/ingest/url ({110.6}).
 * Manual URLs now land in reference_items; the response carries no
 * content_type / suggested_layer / duplicate_matches (OQ-D, OQ-N).
 */
interface IngestResult {
  id: string;
  title: string;
  source_url: string;
  summary?: string | null;
  primary_domain?: string;
  primary_subtopic?: string;
  warnings: string[];
  dedup_status: 'clean';
}

const INITIAL_STEPS: IngestionStep[] = [
  { label: 'Fetching page', status: 'pending' },
  { label: 'Extracting content', status: 'pending' },
  { label: 'Generating embedding', status: 'pending' },
  { label: 'Classifying content', status: 'pending' },
  { label: 'Generating summary', status: 'pending' },
];

/**
 * URL ingestion form — fetches a URL, extracts content, and creates a KB item.
 *
 * Progress display is cosmetic: client-side steps advance on a timer while
 * waiting for the single API response. Uses semantic colour tokens throughout
 * and includes full WCAG 2.1 AA accessibility (labels, aria, keyboard nav).
 */
interface UrlIngestFormProps {
  /** Optional callback to switch to the manual write tab */
  onSuggestManual?: () => void;
}

export function UrlIngestForm({ onSuggestManual }: UrlIngestFormProps = {}) {
  const [url, setUrl] = useState('');
  const [formState, setFormState] = useState<FormState>('idle');
  const [steps, setSteps] = useState<IngestionStep[]>(INITIAL_STEPS);
  const [result, setResult] = useState<IngestResult | null>(null);
  const [existingItem, setExistingItem] = useState<ExistingItem | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const stepTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (stepTimerRef.current) clearInterval(stepTimerRef.current);
    };
  }, []);

  const isValidUrl = useCallback((value: string): boolean => {
    if (!value) return false;
    try {
      const parsed = new URL(value);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }, []);

  const advanceSteps = useCallback(() => {
    setSteps((prev) => {
      const activeIdx = prev.findIndex((s) => s.status === 'active');
      if (activeIdx === -1) {
        // Start first step
        return prev.map((s, i) =>
          i === 0 ? { ...s, status: 'active' as const } : s,
        );
      }
      if (activeIdx >= prev.length - 1) {
        // All done cosmetically
        return prev;
      }
      return prev.map((s, i) => {
        if (i === activeIdx) return { ...s, status: 'done' as const };
        if (i === activeIdx + 1) return { ...s, status: 'active' as const };
        return s;
      });
    });
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!isValidUrl(url)) return;

    // Reset state
    setFormState('processing');
    setResult(null);
    setExistingItem(null);
    setErrorMessage('');
    setSteps(
      INITIAL_STEPS.map((s, i) =>
        i === 0 ? { ...s, status: 'active' as const } : s,
      ),
    );

    // Start cosmetic step advancement (every 3 seconds)
    stepTimerRef.current = setInterval(advanceSteps, 3000);

    try {
      const response = await fetch('/api/ingest/url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });

      // Stop cosmetic timer
      if (stepTimerRef.current) {
        clearInterval(stepTimerRef.current);
        stepTimerRef.current = null;
      }

      const data = await response.json();

      // URL already exists in KB
      if (data.url_already_exists) {
        setExistingItem(data.existing_item);
        setFormState('idle');
        setSteps(INITIAL_STEPS);
        return;
      }

      if (!response.ok) {
        setErrorMessage(data.error || 'Failed to ingest URL');
        setFormState('error');
        setSteps((prev) =>
          prev.map((s) =>
            s.status === 'active'
              ? { ...s, status: 'error' as const }
              : s.status === 'pending'
                ? s
                : s,
          ),
        );
        return;
      }

      // Success — reference landing (no dedup matches for the URL path; OQ-D)
      setResult(data);
      setFormState('success');
      setSteps((prev) => prev.map((s) => ({ ...s, status: 'done' as const })));
    } catch {
      if (stepTimerRef.current) {
        clearInterval(stepTimerRef.current);
        stepTimerRef.current = null;
      }
      setErrorMessage(
        'Network error. Please check your connection and try again.',
      );
      setFormState('error');
      setSteps((prev) =>
        prev.map((s) =>
          s.status === 'active' ? { ...s, status: 'error' as const } : s,
        ),
      );
    }
  }, [url, isValidUrl, advanceSteps]);

  const handleReset = useCallback(() => {
    setUrl('');
    setFormState('idle');
    setSteps(INITIAL_STEPS);
    setResult(null);
    setExistingItem(null);
    setErrorMessage('');
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && isValidUrl(url) && formState === 'idle') {
        e.preventDefault();
        handleSubmit();
      }
    },
    [url, formState, isValidUrl, handleSubmit],
  );

  const urlIsValid = isValidUrl(url);
  const showUrlError = url.length > 0 && !urlIsValid;

  return (
    <div className="space-y-6">
      {/* URL input section */}
      <div className="space-y-2">
        <Label htmlFor="ingest-url" className="text-sm font-medium">
          Web page URL
        </Label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Globe
              className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              id="ingest-url"
              type="url"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setExistingItem(null);
              }}
              onKeyDown={handleKeyDown}
              placeholder="https://example.com/article"
              className="pl-9"
              disabled={formState === 'processing'}
              aria-describedby={showUrlError ? 'url-error' : undefined}
              aria-invalid={showUrlError}
              autoComplete="url"
            />
          </div>
          <Button
            onClick={handleSubmit}
            disabled={!urlIsValid || formState === 'processing'}
            className="gap-2 sm:w-auto"
          >
            {formState === 'processing' ? (
              <>
                <Loader2
                  className="size-4 animate-spin motion-reduce:animate-none"
                  aria-hidden="true"
                />
                Importing...
              </>
            ) : (
              <>
                <Link2 className="size-4" aria-hidden="true" />
                Import
              </>
            )}
          </Button>
        </div>

        {showUrlError && (
          <p id="url-error" className="text-sm text-destructive" role="alert">
            Please enter a valid URL starting with https:// or http://
          </p>
        )}
      </div>

      {/* URL already exists warning */}
      {existingItem && (
        <div
          role="alert"
          className="rounded-md border border-status-warning/30 bg-status-warning/10 p-4"
        >
          <div className="flex items-start gap-2">
            <AlertCircle
              className="mt-0.5 size-4 shrink-0 text-status-warning"
              aria-hidden="true"
            />
            <div>
              <p className="text-sm font-medium text-status-warning">
                This URL is already in the knowledge base
              </p>
              <Link
                href={`/item/${existingItem.id}`}
                className="mt-1 block text-sm text-primary hover:underline"
              >
                {existingItem.title} — View existing item
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Progress display */}
      {formState === 'processing' && <IngestionProgress steps={steps} />}

      {/* Error display */}
      {formState === 'error' && (
        <div role="alert" className="space-y-3">
          <IngestionProgress steps={steps} />
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4">
            <div className="flex items-start gap-2">
              <AlertCircle
                className="mt-0.5 size-4 shrink-0 text-destructive"
                aria-hidden="true"
              />
              <div>
                <p className="text-sm font-medium text-destructive">
                  {errorMessage}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleReset}
                  className="mt-2"
                >
                  Try again
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Success display — manual URLs land in reference_items ({110.7}). */}
      {formState === 'success' && result && (
        <div className="space-y-4">
          <IngestionSuccessCard
            kind="reference"
            referenceId={result.id}
            title={result.title}
            summary={result.summary}
            domain={result.primary_domain}
            subtopic={result.primary_subtopic}
            warnings={result.warnings}
          />

          {/* Low-quality extraction suggestion */}
          {onSuggestManual && (result.summary?.length ?? 0) < 200 && (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Limited text extracted from this page. Try{' '}
                <button
                  type="button"
                  onClick={onSuggestManual}
                  className="font-medium text-primary underline-offset-2 hover:underline"
                >
                  pasting the content manually
                </button>
                , or use automatic extraction:
              </p>
              <ClaudePromptButton
                prompt={generateIngestDocumentPrompt().prompt}
                label="Extract with Claude"
                size="sm"
              />
            </div>
          )}

          <Button variant="outline" onClick={handleReset}>
            Import another URL
          </Button>
        </div>
      )}
    </div>
  );
}
