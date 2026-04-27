'use client';

import { useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { Info, Loader2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  BatchQAPreviewTable,
  parsePastedQA,
  type QAPair,
} from '@/components/qa/batch-qa-preview-table';
import { useBatchCreate, type DuplicateMatch } from '@/hooks/use-batch-create';
import { useTaxonomy } from '@/contexts/taxonomy-context';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_PAIRS = 100;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Batch Q&A creation content component.
 *
 * Provides a paste-from-spreadsheet interface for creating multiple Q&A pairs
 * at once. Supports tab-separated and pipe-separated formats.
 *
 * Embedded as a tab within NewItemTabs at /item/new?tab=batch.
 */
export function BatchCreateContent() {
  const { getDomainNames, getSubtopics, formatSubtopic, formatDomainName } =
    useTaxonomy();

  const {
    submit,
    checkDuplicates,
    isSubmitting,
    isCheckingDuplicates,
    progress,
    results,
    error,
  } = useBatchCreate();

  // Paste area state
  const [pasteText, setPasteText] = useState('');
  const [pairs, setPairs] = useState<QAPair[]>([]);
  const [hasParsed, setHasParsed] = useState(false);

  // Shared metadata
  const [domain, setDomain] = useState('');
  const [subtopic, setSubtopic] = useState('');

  // Duplicate warning dialog
  const [duplicateMatches, setDuplicateMatches] = useState<DuplicateMatch[]>(
    [],
  );
  const [showDuplicateDialog, setShowDuplicateDialog] = useState(false);

  // Item statuses after submission
  const [itemStatuses, setItemStatuses] = useState<
    Map<number, { status: 'created' | 'failed'; error?: string }>
  >(new Map());

  // Derived values
  const domainNames = getDomainNames();
  const subtopicNames = domain ? getSubtopics(domain) : [];

  // Filter out empty rows for submission
  const validPairs = useMemo(
    () => pairs.filter((p) => p.question.trim() && p.answer.trim()),
    [pairs],
  );

  const canSubmit =
    validPairs.length > 0 && validPairs.length <= MAX_PAIRS && !isSubmitting;

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const handleParse = useCallback(() => {
    const parsed = parsePastedQA(pasteText);
    if (parsed.length === 0) {
      toast.error(
        'No valid Q&A pairs found. Ensure each line has a question and answer separated by a tab or pipe character.',
      );
      return;
    }
    if (parsed.length > MAX_PAIRS) {
      toast.warning(
        `Only the first ${MAX_PAIRS} pairs will be used. ${parsed.length - MAX_PAIRS} pairs were trimmed.`,
      );
      setPairs(parsed.slice(0, MAX_PAIRS));
    } else {
      setPairs(parsed);
    }
    setHasParsed(true);
    setItemStatuses(new Map());
  }, [pasteText]);

  const handleReset = useCallback(() => {
    setPasteText('');
    setPairs([]);
    setHasParsed(false);
    setItemStatuses(new Map());
    setDuplicateMatches([]);
    setShowDuplicateDialog(false);
  }, []);

  const executeSubmission = useCallback(async () => {
    setShowDuplicateDialog(false);

    const result = await submit(validPairs, {
      domain: domain || undefined,
      subtopic: subtopic || undefined,
      sourceDocumentLink: undefined,
    });

    if (result) {
      // Build item status map from results
      const statusMap = new Map<
        number,
        { status: 'created' | 'failed'; error?: string }
      >();
      result.items.forEach((item, index) => {
        statusMap.set(index, {
          status: item.status,
          error: item.error,
        });
      });
      setItemStatuses(statusMap);

      if (result.failed === 0) {
        toast.success(`All ${result.created} items created successfully.`);
      } else {
        toast.warning(
          `${result.created} items created, ${result.failed} failed. Check the status column for details.`,
        );
      }
    }
  }, [validPairs, domain, subtopic, submit]);

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;

    // Run duplicate check first
    const dupes = await checkDuplicates(validPairs);
    if (dupes.length > 0) {
      setDuplicateMatches(dupes);
      setShowDuplicateDialog(true);
      return;
    }

    // No duplicates — proceed with submission
    await executeSubmission();
  }, [canSubmit, validPairs, checkDuplicates, executeSubmission]);

  const handleContinueWithDuplicates = useCallback(async () => {
    await executeSubmission();
  }, [executeSubmission]);

  // Reset subtopic when domain changes
  const handleDomainChange = useCallback((value: string) => {
    setDomain(value);
    setSubtopic('');
  }, []);

  // Progress percentage for the progress bar
  const progressPercentage =
    progress.total > 0
      ? Math.round((progress.current / progress.total) * 100)
      : 0;

  return (
    <section
      aria-label="Batch create Q&A pairs"
      className="mx-auto max-w-4xl px-4 py-6 sm:px-6"
    >
      <p className="mb-4 text-sm text-muted-foreground">
        Create multiple Q&A pairs at once by pasting from a spreadsheet.
      </p>

      <div className="space-y-6">
        {/* Informational note about pipeline */}
        <div className="flex items-start gap-3 rounded-md border bg-muted/30 p-4">
          <Info
            className="mt-0.5 size-4 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <p className="text-sm text-muted-foreground">
            Each item will be automatically classified, summarised, and scored
            after creation.
          </p>
        </div>

        {/* Paste area */}
        {!hasParsed && (
          <div className="space-y-3">
            <Label htmlFor="paste-area">Paste Q&A pairs</Label>
            <Textarea
              id="paste-area"
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder="Paste Q&A pairs from a spreadsheet. Each row should have a question in the first column and an answer in the second column, separated by a tab."
              rows={10}
              className="min-h-[200px] font-mono text-sm"
              aria-describedby="paste-instructions"
            />
            <p
              id="paste-instructions"
              className="text-xs text-muted-foreground"
            >
              Supported formats: tab-separated (from spreadsheets) or
              pipe-separated (question | answer). One pair per line.
            </p>
            <Button
              type="button"
              onClick={handleParse}
              disabled={!pasteText.trim()}
            >
              Parse Q&A pairs
            </Button>
          </div>
        )}

        {/* Preview table */}
        {hasParsed && (
          <>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">
                Preview ({validPairs.length} valid pair
                {validPairs.length !== 1 ? 's' : ''})
              </h2>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleReset}
                disabled={isSubmitting}
              >
                Start over
              </Button>
            </div>

            <BatchQAPreviewTable
              pairs={pairs}
              onPairsChange={setPairs}
              itemStatuses={itemStatuses.size > 0 ? itemStatuses : undefined}
              disabled={isSubmitting}
            />

            {/* Shared metadata — domain/subtopic are collected for future per-item
                  metadata support. Currently the batch API auto-classifies all items
                  via the pipeline, so these values are informational only. */}
            <fieldset
              className="space-y-4 rounded-md border p-4"
              disabled={isSubmitting}
            >
              <legend className="px-2 text-sm font-medium text-muted-foreground">
                Shared metadata (optional)
              </legend>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="batch-domain">Domain</Label>
                  <Select value={domain} onValueChange={handleDomainChange}>
                    <SelectTrigger id="batch-domain">
                      <SelectValue placeholder="Select domain..." />
                    </SelectTrigger>
                    <SelectContent>
                      {domainNames.map((d) => (
                        <SelectItem key={d} value={d}>
                          {formatDomainName(d)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="batch-subtopic">Subtopic</Label>
                  <Select
                    value={subtopic}
                    onValueChange={setSubtopic}
                    disabled={!domain}
                  >
                    <SelectTrigger id="batch-subtopic">
                      <SelectValue
                        placeholder={
                          domain
                            ? 'Select subtopic...'
                            : 'Select a domain first'
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {subtopicNames.map((s) => (
                        <SelectItem key={s} value={s}>
                          {formatSubtopic(s)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </fieldset>

            {/* Progress bar during submission */}
            {isSubmitting && (
              <div
                className="space-y-2"
                role="status"
                aria-label="Batch creation progress"
              >
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">
                    Creating items...
                  </span>
                  <span className="tabular-nums text-muted-foreground">
                    {progress.current} of {progress.total}
                  </span>
                </div>
                <Progress value={progressPercentage} />
              </div>
            )}

            {/* Error display */}
            {error && (
              <div
                className="flex items-start gap-3 rounded-md border border-destructive/50 bg-destructive/10 p-4"
                role="alert"
              >
                <AlertTriangle
                  className="mt-0.5 size-4 shrink-0 text-destructive"
                  aria-hidden="true"
                />
                <p className="text-sm text-destructive">{error}</p>
              </div>
            )}

            {/* Results summary */}
            {results && !isSubmitting && (
              <div className="rounded-md border bg-muted/30 p-4 space-y-2">
                <p className="text-sm font-medium">
                  Batch creation complete: {results.created} created,{' '}
                  {results.failed} failed.
                </p>
                <div className="flex gap-3">
                  <Link
                    href="/browse"
                    className="text-sm text-primary hover:underline"
                  >
                    View in Browse
                  </Link>
                  <button
                    type="button"
                    onClick={handleReset}
                    className="text-sm text-primary hover:underline"
                  >
                    Create another batch
                  </button>
                </div>
              </div>
            )}

            {/* Submit button */}
            {!results && (
              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  onClick={handleSubmit}
                  disabled={!canSubmit || isCheckingDuplicates}
                >
                  {isCheckingDuplicates ? (
                    <>
                      <Loader2
                        className="size-4 animate-spin"
                        aria-hidden="true"
                      />
                      Checking for duplicates...
                    </>
                  ) : isSubmitting ? (
                    <>
                      <Loader2
                        className="size-4 animate-spin"
                        aria-hidden="true"
                      />
                      Creating...
                    </>
                  ) : (
                    `Create ${validPairs.length} item${validPairs.length !== 1 ? 's' : ''}`
                  )}
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Duplicate warning dialog */}
      <AlertDialog
        open={showDuplicateDialog}
        onOpenChange={setShowDuplicateDialog}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Potential duplicates found</AlertDialogTitle>
            <AlertDialogDescription>
              The following pasted questions may already exist in the knowledge
              base. This is a best-effort title match — full semantic dedup runs
              after creation.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="max-h-[300px] overflow-y-auto space-y-3 my-2">
            {duplicateMatches.map((match) => (
              <div
                key={`${match.id}-${match.question}`}
                className="rounded-md border p-3 text-sm space-y-1"
              >
                <p className="font-medium">
                  Pasted: &ldquo;
                  {match.question.length > 80
                    ? `${match.question.slice(0, 80)}...`
                    : match.question}
                  &rdquo;
                </p>
                <p className="text-muted-foreground">
                  Existing: &ldquo;
                  {match.title.length > 80
                    ? `${match.title.slice(0, 80)}...`
                    : match.title}
                  &rdquo;
                </p>
              </div>
            ))}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleContinueWithDuplicates}>
              Continue anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
