/**
 * AI summary formatter for MCP tool responses. (The classification
 * formatter retired S531 with the classify_content tool — id-419.)
 */
import type { SummariseResult } from '@/lib/ai/summarise';

export function formatSummaryResult(result: SummariseResult): string {
  const data = result.summary_data;
  const lines: string[] = [
    '# Generated Summary',
    '',
    '## Executive Summary',
    '',
    data.executive,
    '',
    '## Detailed Summary',
    '',
    data.detailed,
  ];

  if (data.takeaways.length > 0) {
    lines.push('', '## Key Takeaways', '');
    for (const t of data.takeaways) {
      lines.push(`- ${t}`);
    }
  }

  lines.push('', `*Generated at ${data.generated_at} using ${data.model}*`);

  return lines.join('\n');
}
