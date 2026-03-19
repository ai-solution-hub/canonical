import { CheckCircle2, ShieldAlert, Eye, Clock, Flag } from 'lucide-react';
import { AttentionCard } from './attention-card';
import {
  generateGovernancePrompt,
  generateUnverifiedPrompt,
  generateStaleContentPrompt,
  generateQualityFlagPrompt,
} from '@/lib/claude-prompts';

interface NeedsAttentionSectionProps {
  governance_review_count: number | null;
  unverified_count: number | null;
  quality_flag_count: number | null;
  stale_content_count: number | null;
  expired_content_count: number | null;
  userRole?: string;
}

export function NeedsAttentionSection({
  governance_review_count,
  unverified_count,
  quality_flag_count,
  stale_content_count,
  expired_content_count,
  userRole = 'viewer',
}: NeedsAttentionSectionProps) {
  const isViewer = userRole === 'viewer';

  const totalAttention = isViewer
    ? (stale_content_count ?? 0) + (expired_content_count ?? 0)
    : (governance_review_count ?? 0) +
      (unverified_count ?? 0) +
      (quality_flag_count ?? 0) +
      (stale_content_count ?? 0) +
      (expired_content_count ?? 0);

  const staleTotal = (stale_content_count ?? 0) + (expired_content_count ?? 0);

  return (
    <section aria-label="Items needing attention" className="rounded-lg border border-border bg-card p-4">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        Needs Attention{totalAttention > 0 && ` (${totalAttention})`}
      </h2>

      {totalAttention === 0 ? (
        <div className="rounded-lg border border-border bg-card p-6 text-center">
          <CheckCircle2
            className="mx-auto mb-2 size-8 text-quality-good"
            aria-hidden="true"
          />
          <p className="text-sm font-medium text-foreground">
            All clear — your knowledge base is in good shape.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            All content is verified, governance reviews are complete, and no
            bids have imminent deadlines.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {!isViewer && (
            <AttentionCard
              icon={ShieldAlert}
              count={governance_review_count}
              label={`governance ${(governance_review_count ?? 0) === 1 ? 'review' : 'reviews'} pending`}
              href="/review?status=all"
              actionLabel="Review"
              claudePrompt={
                governance_review_count && governance_review_count > 0
                  ? generateGovernancePrompt(governance_review_count).prompt
                  : undefined
              }
            />
          )}
          {!isViewer && (
            <AttentionCard
              icon={Eye}
              count={unverified_count}
              label={`unverified ${(unverified_count ?? 0) === 1 ? 'item' : 'items'}`}
              href="/review"
              actionLabel="Review"
              claudePrompt={
                unverified_count && unverified_count > 0
                  ? generateUnverifiedPrompt(unverified_count).prompt
                  : undefined
              }
            />
          )}
          <AttentionCard
            icon={Clock}
            count={staleTotal > 0 ? staleTotal : null}
            label={`content ${staleTotal === 1 ? 'item' : 'items'} need refreshing`}
            href="/browse?freshness=stale"
            actionLabel="Browse stale"
            claudePrompt={
              staleTotal > 0
                ? generateStaleContentPrompt(staleTotal).prompt
                : undefined
            }
          />
          {!isViewer && (
            <AttentionCard
              icon={Flag}
              count={quality_flag_count}
              label={`${(quality_flag_count ?? 0) === 1 ? 'item has' : 'items have'} quality issues`}
              href="/browse?quality_issues=true"
              actionLabel="Browse flagged"
              claudePrompt={
                quality_flag_count && quality_flag_count > 0
                  ? generateQualityFlagPrompt(quality_flag_count).prompt
                  : undefined
              }
            />
          )}
        </div>
      )}
    </section>
  );
}
