/**
 * AI classification and summary formatters for MCP tool responses.
 */
import type { ClassificationResult } from '@/lib/ai/classify';
import type { SummariseResult } from '@/lib/ai/summarise';

// ---------------------------------------------------------------------------
// Classification result
// ---------------------------------------------------------------------------

export function formatClassification(result: ClassificationResult): string {
  const lines: string[] = [
    '# Classification Result',
    '',
    `**Title:** ${result.suggested_title}`,
    `**Domain:** ${result.primary_domain}`,
    `**Subtopic:** ${result.primary_subtopic}`,
    `**Confidence:** ${Math.round(result.classification_confidence * 100)}%`,
  ];

  if (result.secondary_domain) {
    lines.push(`**Secondary domain:** ${result.secondary_domain}`);
  }

  if (result.ai_keywords.length > 0) {
    lines.push(`**Keywords:** ${result.ai_keywords.join(', ')}`);
  }

  if (result.ai_summary) {
    lines.push('', '## Summary', '', result.ai_summary);
  }

  if (result.classification_reasoning) {
    lines.push('', '## Reasoning', '', result.classification_reasoning);
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Summary result
// ---------------------------------------------------------------------------

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
