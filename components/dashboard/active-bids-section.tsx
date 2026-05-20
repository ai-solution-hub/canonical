import Link from 'next/link';
import { Plus, Briefcase } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { BidListCard } from '@/components/procurement/procurement-list-card';
import {
  generateBidPrompt,
  generateBidDeadlinePrompt,
} from '@/lib/claude-prompts';
import type { ActiveBidSummary } from '@/lib/dashboard';
import type { Bid, BidMetadata } from '@/types/procurement';

/** Adapt the dashboard's flat ActiveBidSummary into the Bid shape expected by BidListCard. */
function toBid(summary: ActiveBidSummary): Bid {
  return {
    id: summary.id,
    name: summary.name,
    description: null,
    status: summary.status as BidMetadata['status'],
    domain_metadata: {
      buyer: summary.buyer ?? '',
      status: summary.status as BidMetadata['status'],
      deadline: summary.deadline,
      reference_number: null,
      estimated_value: null,
      tender_source: null,
      tender_document_ids: [],
      submission_date: null,
      outcome: null,
      outcome_notes: null,
      notes: null,
    },
    question_stats: {
      total_questions: summary.total_questions,
      drafted_count: summary.answered_questions - summary.approved_questions,
      complete_count: summary.approved_questions,
      strong_match_count: 0,
      partial_match_count: 0,
      needs_sme_count: 0,
      no_content_count: 0,
      unmatched_count: 0,
    },
    created_by: null,
    created_at: '',
    updated_at: '',
  };
}

interface ActiveBidsSectionProps {
  bids: ActiveBidSummary[];
}

export function ActiveBidsSection({ bids }: ActiveBidsSectionProps) {
  return (
    <section
      aria-label="Active bids"
      className="rounded-lg border bg-card p-4 shadow-sm"
    >
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        Active Bids
      </h2>

      {bids.length === 0 ? (
        <div className="rounded-lg border bg-card p-6 text-center">
          <Briefcase
            className="mx-auto size-8 text-muted-foreground/50"
            aria-hidden="true"
          />
          <p className="mt-3 text-sm font-medium text-foreground">
            No active bids
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Create a new bid to start managing tender responses.
          </p>
          <Button asChild size="sm" className="mt-3 gap-1.5">
            <Link href="/bid">
              <Plus className="size-3.5" aria-hidden="true" />
              New Bid
            </Link>
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {bids.map((bid) => {
            const isFullyDraftedApproachingDeadline =
              bid.answered_questions >= bid.total_questions &&
              bid.days_until_deadline !== null &&
              bid.days_until_deadline >= 0 &&
              bid.days_until_deadline <= 7;
            const prompt = isFullyDraftedApproachingDeadline
              ? generateBidDeadlinePrompt(bid).prompt
              : generateBidPrompt(bid).prompt;
            return (
              <BidListCard
                key={bid.id}
                bid={toBid(bid)}
                claudePrompt={prompt}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}
