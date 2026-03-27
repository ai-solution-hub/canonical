import { formatSimilarity } from '@/lib/format';

interface SimilarityBadgeProps {
  score: number;
  className?: string;
}

function getQualityLabel(percentage: number): string {
  if (percentage >= 90) return 'Excellent match';
  if (percentage >= 80) return 'Strong match';
  if (percentage >= 70) return 'Good match';
  return 'Partial match';
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

  const qualityLabel = getQualityLabel(percentage);

  return (
    <span className={`inline-flex items-baseline gap-1 text-xs font-medium ${colorClass} ${className}`}>
      <span>{formatSimilarity(score)}</span>
      <span className="text-[10px] font-normal">{qualityLabel}</span>
    </span>
  );
}
