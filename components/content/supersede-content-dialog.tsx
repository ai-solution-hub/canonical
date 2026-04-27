'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Archive, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';

/**
 * Admin UI surface for the supersession model (S186 WP-B.5).
 *
 * Minimum-viable selector: admin pastes the newer item's UUID and the
 * route calls `setSupersession`. A richer typeahead selector comes in a
 * follow-up wave once the UI simp provenance surface lands.
 *
 * Spec: docs/specs/supersession-model-spec.md §5.1
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface SupersedeContentDialogProps {
  itemId: string;
  itemTitle: string;
}

export function SupersedeContentDialog({
  itemId,
  itemTitle,
}: SupersedeContentDialogProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [open, setOpen] = useState(false);
  const [newId, setNewId] = useState('');
  const [inlineError, setInlineError] = useState<string | null>(null);

  const reset = () => {
    setNewId('');
    setInlineError(null);
    setIsSubmitting(false);
  };

  const handleSubmit = async () => {
    const trimmed = newId.trim();
    if (!UUID_RE.test(trimmed)) {
      setInlineError('Paste a valid UUID (36 characters, dashed).');
      return;
    }
    if (trimmed === itemId) {
      setInlineError(
        'Cannot supersede this item with itself. Paste the NEW item’s ID.',
      );
      return;
    }

    setInlineError(null);
    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/items/${itemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          field: 'superseded_by',
          value: trimmed,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        // error_code is a technical enum (SAME_ID, OLD_NOT_FOUND,
        // NEW_ALREADY_SUPERSEDED, etc.) surfaced alongside the human
        // message so admin operators can cite it in bug reports or
        // correlate with server logs. This surface is admin-only per
        // spec §5 Q1 (verifier L2 — intentional exposure).
        const codeSuffix = data.error_code ? ` [${data.error_code}]` : '';
        throw new Error(`${data.error ?? 'Supersession failed'}${codeSuffix}`);
      }

      toast.success('Item marked as superseded');
      setOpen(false);
      reset();
      router.refresh();
    } catch (err) {
      setInlineError(
        err instanceof Error ? err.message : 'Supersession failed',
      );
      setIsSubmitting(false);
    }
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <AlertDialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          data-supersede-trigger
        >
          <Archive className="size-3.5" />
          Mark as superseded…
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Mark item as superseded</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              <p>
                This item will be hidden from default search results. Direct
                links still resolve. Paste the UUID of the newer item that
                replaces it.
              </p>
              <p className="text-sm font-medium text-foreground">
                &ldquo;{itemTitle}&rdquo;
              </p>
              <label className="block text-sm">
                <span className="mb-1 block font-medium">
                  Replacement item UUID
                </span>
                <input
                  type="text"
                  value={newId}
                  onChange={(e) => {
                    setNewId(e.target.value);
                    setInlineError(null);
                  }}
                  placeholder="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
                  disabled={isSubmitting}
                  className="w-full rounded border border-input bg-background px-3 py-2 font-mono text-xs"
                  aria-invalid={inlineError !== null}
                  aria-describedby={inlineError ? 'supersede-error' : undefined}
                  data-testid="supersede-new-id-input"
                />
              </label>
              {inlineError && (
                <p
                  id="supersede-error"
                  role="alert"
                  className="text-sm text-destructive"
                >
                  {inlineError}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Requires admin role. Chains are rejected: if the replacement
                already has its own successor, pick that successor directly.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isSubmitting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              // Prevent AlertDialogAction's default close-on-click so we can
              // await the PATCH and leave the dialog open on failure.
              e.preventDefault();
              handleSubmit();
            }}
            disabled={isSubmitting || newId.trim().length === 0}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                Marking…
              </>
            ) : (
              'Confirm supersession'
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
