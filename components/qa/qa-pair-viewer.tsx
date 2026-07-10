'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { QAAnswerDisplay } from '@/components/qa/qa-answer-display';
import { QARevisionHistory } from '@/components/qa/qa-revision-history';
import { useQAPairEdit } from '@/hooks/qa/use-qa-pair-edit';
import type { Tables } from '@/supabase/types/database.types';

type QAPairRow = Tables<'q_a_pairs'>;

/**
 * QAPairViewer — the `/library/[id]` single-pair read/edit presenter (ID-135
 * {135.22}).
 *
 * REUSES the mature `components/qa` family rather than rebuilding a viewer
 * from scratch (S440 owner ruling design note; DR-013's id-111/id-117
 * "link-out only" rule does NOT apply here — the qa component family is
 * explicitly exempted for id-135 surfaces):
 *
 * - `QAAnswerDisplay` — was a fully-built, zero-caller orphan (its IMS
 *   item-detail caller was deleted at {131.17}). This viewer is its first
 *   live caller, wired to the ALSO-previously-uncalled
 *   `PATCH /api/q-a-pairs/[id]` route via `useQAPairEdit`.
 * - `QARevisionHistory` — already had a live caller elsewhere reference; used
 *   here unmodified.
 *
 * Read-first: renders in read mode for any authenticated role; `canEdit`
 * (resolved server-side from the caller's role in `app/library/[id]/page.tsx`)
 * gates whether the `QAAnswerDisplay` inline-edit affordance is wired at all.
 *
 * Verification status is NOT shown in this v1 (a real per-pair status would
 * require reading the `record_lifecycle` governance facet, `owner_kind =
 * 'q_a_pair'`, which the current `/api/review/action` route does not support
 * — that route hardcodes `owner_kind = 'source_document'`. Wiring a working
 * per-pair Verify affordance is out of this Subtask's scope; see the
 * ID-135.22 journal for the flagged follow-up).
 */
export interface QAPairViewerProps {
  pair: QAPairRow;
  canEdit: boolean;
}

const EMPTY_TAGS: string[] = [];

export function QAPairViewer({
  pair: initialPair,
  canEdit,
}: QAPairViewerProps) {
  const [pair, setPair] = useState(initialPair);

  const handleSaved = useCallback((updated: QAPairRow) => {
    setPair((prev) => ({ ...prev, ...updated }));
  }, []);
  const inlineEdit = useQAPairEdit(pair.id, handleSaved);

  const handleCopyAnswer = useCallback(
    (variant?: 'standard' | 'advanced') => {
      const text =
        variant === 'advanced' ? pair.answer_advanced : pair.answer_standard;
      if (!text) return;
      void navigator.clipboard.writeText(text);
      toast.success(
        `${variant === 'advanced' ? 'Advanced' : 'Standard'} answer copied`,
      );
    },
    [pair.answer_advanced, pair.answer_standard],
  );

  const scopeTags = pair.scope_tag ?? EMPTY_TAGS;

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <Link
        href="/library"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to Library
      </Link>

      <div className="space-y-2">
        <h1 className="text-lg font-medium leading-snug text-foreground">
          {pair.question_text}
        </h1>
        {scopeTags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {scopeTags.map((tag) => (
              <Badge key={tag} variant="outline" className="text-[10px]">
                {tag}
              </Badge>
            ))}
          </div>
        )}
      </div>

      <QAAnswerDisplay
        item={{
          content: null,
          answer_standard: pair.answer_standard,
          answer_advanced: pair.answer_advanced,
          verified_at: null,
        }}
        canEdit={canEdit}
        inlineEdit={canEdit ? inlineEdit : undefined}
        handleCopyAnswer={handleCopyAnswer}
      />

      <QARevisionHistory qaPairId={pair.id} />
    </div>
  );
}

/** Rendered by `app/library/[id]/page.tsx` on a genuine primary-read failure
 * (RLS/transport/DB error) — never a blank page, never conflated with 404. */
export function QAPairViewerError() {
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6 text-center">
      <p className="text-sm text-muted-foreground">
        Something went wrong while loading this Q&amp;A pair. This is usually
        temporary — please try again.
      </p>
      <Link href="/library" className="text-sm text-primary underline">
        Back to Library
      </Link>
    </div>
  );
}
