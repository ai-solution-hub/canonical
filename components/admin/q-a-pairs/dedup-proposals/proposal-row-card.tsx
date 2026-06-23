import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { formatDateUK } from '@/lib/format';
import type { QaDedupPairMember } from '@/lib/query/fetchers';

interface QaDedupProposalRowCardProps {
  member: QaDedupPairMember;
  side: 'a' | 'b';
  /** True when this member is the nominated (or resolved) survivor. */
  isSurvivor: boolean;
}

/**
 * Single-member presentation card for the ID-120 {120.8} dedup-proposal
 * detail view (TECH P-4 / INV-10). Renders ONE Q&A pair's question text AND
 * answer text, plus its provenance (source workspace + form), publication
 * status, and last-updated date (DD/MM/YYYY).
 *
 * Two of these render side-by-side in the detail page so the curator compares
 * both questions and both answers at a glance — they review the organisation's
 * OWN corpus (intra-tenant), so showing both texts is correct.
 */
export function QaDedupProposalRowCard({
  member,
  side,
  isSurvivor,
}: QaDedupProposalRowCardProps) {
  const labelText = side === 'a' ? 'Pair A' : 'Pair B';

  return (
    <Card
      aria-label={labelText}
      className="flex flex-col"
      data-testid={`qa-dedup-member-card-${side}`}
    >
      <CardHeader className="border-b">
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant="outline"
            className="w-fit text-xs"
            data-testid={`qa-dedup-member-label-${side}`}
          >
            {labelText}
          </Badge>
          {isSurvivor ? (
            <Badge
              variant="secondary"
              className="w-fit text-xs"
              data-testid={`qa-dedup-member-survivor-${side}`}
            >
              Nominated survivor
            </Badge>
          ) : null}
        </div>
        <CardTitle className="mt-2 text-base">Question</CardTitle>
        <CardDescription className="mt-1 space-y-0.5 text-xs">
          <span className="block">
            <span className="font-medium text-foreground">Workspace:</span>{' '}
            <span data-testid={`qa-dedup-member-workspace-${side}`}>
              {member.sourceWorkspaceId ?? '—'}
            </span>
          </span>
          <span className="block">
            <span className="font-medium text-foreground">Form:</span>{' '}
            <span data-testid={`qa-dedup-member-form-${side}`}>
              {member.sourceFormResponseId ?? '—'}
            </span>
          </span>
          <span className="block">
            <span className="font-medium text-foreground">Last updated:</span>{' '}
            <span data-testid={`qa-dedup-member-updated-${side}`}>
              {member.updatedAt ? formatDateUK(member.updatedAt) : '—'}
            </span>
          </span>
          <span className="flex items-center gap-2 pt-1">
            <span className="font-medium text-foreground">Status:</span>
            <Badge variant="secondary" className="text-xs">
              {member.publicationStatus ?? 'unknown'}
            </Badge>
          </span>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 pt-4">
        <div
          className="rounded-md border border-border bg-muted/40 p-3 text-sm whitespace-pre-wrap"
          tabIndex={0}
          role="region"
          aria-label={`${labelText} question text`}
        >
          {member.questionText?.trim() ? member.questionText : '(no question)'}
        </div>
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">
            Answer
          </p>
          <div
            className="max-h-64 overflow-y-auto rounded-md border border-border bg-muted/40 p-3 text-sm whitespace-pre-wrap"
            tabIndex={0}
            role="region"
            aria-label={`${labelText} answer text`}
          >
            {member.answerText?.trim() ? member.answerText : '(no answer)'}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
