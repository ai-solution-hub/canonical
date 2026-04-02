'use client';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { PromptPerformanceRow } from '@/hooks/intelligence/use-prompt-performance';

interface PromptPerformanceTableProps {
  data: PromptPerformanceRow[];
  className?: string;
}

export function PromptPerformanceTable({
  data,
  className,
}: PromptPerformanceTableProps) {
  if (data.length === 0) {
    return (
      <div
        className={cn(
          'flex items-center justify-center rounded-lg border bg-card p-8',
          className,
        )}
      >
        <p className="text-sm text-muted-foreground">
          No prompt versions recorded yet.
        </p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'overflow-x-auto rounded-lg border bg-card shadow-sm',
        className,
      )}
    >
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
            <th className="px-3 py-2 font-medium">Version</th>
            <th className="px-3 py-2 font-medium">Change Notes</th>
            <th className="px-3 py-2 text-right font-medium">Articles</th>
            <th className="px-3 py-2 text-right font-medium">Pass Rate</th>
            <th className="px-3 py-2 text-right font-medium">Flags</th>
            <th className="px-3 py-2 text-right font-medium">Flag Rate</th>
            <th className="px-3 py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row) => (
            <tr
              key={row.prompt_id}
              className={cn(
                'border-b transition-colors last:border-0',
                row.is_active && 'bg-muted/30',
              )}
            >
              <td className="px-3 py-2 font-medium text-foreground">
                <span className={cn(row.is_active && 'border-l-2 border-foreground pl-2')}>
                  v{row.version}
                </span>
              </td>
              <td className="max-w-[200px] truncate px-3 py-2 text-muted-foreground">
                {row.change_notes ?? '\u2014'}
              </td>
              <td className="px-3 py-2 text-right text-foreground">
                {row.articles_scored}
              </td>
              <td className="px-3 py-2 text-right">
                <span
                  className={cn(
                    'font-medium',
                    getPassRateColour(row.pass_rate),
                  )}
                >
                  {row.pass_rate}%
                </span>
              </td>
              <td className="px-3 py-2 text-right text-muted-foreground">
                {row.total_flags > 0 ? (
                  <span>
                    {row.false_positive_flags} FP / {row.false_negative_flags} FN
                  </span>
                ) : (
                  '\u2014'
                )}
              </td>
              <td className="px-3 py-2 text-right">
                <span
                  className={cn(
                    'font-medium',
                    row.flag_rate > 10
                      ? 'text-warning'
                      : 'text-muted-foreground',
                  )}
                >
                  {row.flag_rate}%
                </span>
              </td>
              <td className="px-3 py-2">
                {row.is_active ? (
                  <Badge
                    variant="outline"
                    className="border-success/30 bg-success/10 text-[10px] text-success"
                  >
                    Active
                  </Badge>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    v{row.version}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Return a semantic colour class for the pass rate.
 * Target range is 6-12% (30-60 out of 500+ articles/week).
 * Colour coding is informational, not prescriptive.
 */
function getPassRateColour(rate: number): string {
  if (rate <= 5) return 'text-success';
  if (rate <= 15) return 'text-info';
  return 'text-warning';
}
