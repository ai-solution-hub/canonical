import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { formatDateUK } from '@/lib/format';
import {
  getDeadlineUrgency,
  type ActiveBidSummary,
  type DeadlineUrgency,
} from '@/lib/dashboard';

function urgencyConfig(urgency: DeadlineUrgency) {
  switch (urgency) {
    case 'overdue':
      return {
        badge: 'Overdue',
        badgeClass: 'bg-bid-lost-bg text-bid-lost',
        textClass: 'text-status-error',
      };
    case 'urgent':
      return {
        badge: 'Due soon',
        badgeClass: 'bg-bid-active-bg text-bid-active',
        textClass: 'text-status-warning',
      };
    case 'approaching':
      return { badge: null, badgeClass: '', textClass: '' };
    case 'normal':
      return { badge: null, badgeClass: '', textClass: '' };
    case 'unknown':
      return { badge: null, badgeClass: '', textClass: 'text-muted-foreground' };
  }
}

export function BidSummaryCard({ bid }: { bid: ActiveBidSummary }) {
  const urgency = getDeadlineUrgency(bid.deadline);
  const config = urgencyConfig(urgency);

  return (
    <Link
      href={`/bid/${bid.id}`}
      className="group block rounded-lg border border-border bg-card p-4 transition-colors hover:bg-accent/50"
    >
      <div className="mb-1 flex items-start justify-between gap-2">
        <h3 className="text-sm font-medium text-foreground line-clamp-1">
          {bid.name}
        </h3>
        <ArrowRight className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
      </div>

      {bid.buyer && (
        <p className="text-xs text-muted-foreground">
          {bid.buyer}
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Badge variant="secondary" className="text-xs capitalize">
          {bid.status.replace(/_/g, ' ')}
        </Badge>
        {config.badge && (
          <Badge variant="outline" className={`text-xs ${config.badgeClass}`}>
            {config.badge}
          </Badge>
        )}
      </div>

      <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
        {bid.deadline ? (
          <span className={config.textClass}>
            {urgency === 'overdue'
              ? `Overdue (${formatDateUK(bid.deadline)})`
              : bid.days_until_deadline !== null
                ? `${bid.days_until_deadline} ${bid.days_until_deadline === 1 ? 'day' : 'days'} remaining`
                : formatDateUK(bid.deadline)}
          </span>
        ) : (
          <span className="text-muted-foreground">No deadline</span>
        )}

        {bid.total_questions > 0 && (
          <span>
            {bid.answered_questions}/{bid.total_questions} questions
          </span>
        )}
      </div>
    </Link>
  );
}
