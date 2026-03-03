import { formatSimilarity } from '@/lib/format';

interface SimilarityBadgeProps {
  score: number;
  className?: string;
}

export function SimilarityBadge({
  score,
  className = '',
}: SimilarityBadgeProps) {
  const percentage = Math.round(score * 100);
  let colorClass = 'text-muted-foreground';

  if (percentage >= 85) {
    colorClass = 'text-[var(--success)]';
  } else if (percentage >= 70) {
    colorClass = 'text-foreground';
  }

  return (
    <span className={`text-xs font-medium ${colorClass} ${className}`}>
      {formatSimilarity(score)} match
    </span>
  );
}
