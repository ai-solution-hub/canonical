/**
 * Template coverage formatters for MCP tool responses.
 */
import { truncate } from './shared';

// ---------------------------------------------------------------------------
// Template coverage
// ---------------------------------------------------------------------------

export interface TemplateCoverageRequirement {
  requirement_id: string;
  section_ref: string;
  section_name: string;
  question_number: number | null;
  requirement_text: string;
  description: string | null;
  requirement_type: string;
  coverage_status: 'strong' | 'partial' | 'gap' | 'na';
  matching_content_ids: string[];
  best_similarity_score: number;
  content_length_met: boolean;
}

export interface TemplateCoverageSection {
  section_ref: string;
  section_name: string;
  requirements: TemplateCoverageRequirement[];
}

export interface TemplateCoverageData {
  template_name: string;
  template_version: string | null;
  template_type: string;
  total_requirements: number;
  strong_count: number;
  partial_count: number;
  gap_count: number;
  na_count: number;
  score: number;
  sections: TemplateCoverageSection[];
}

const STATUS_ICONS: Record<string, string> = {
  strong: '\u2705', // check mark
  partial: '\uD83D\uDFE1', // yellow circle
  gap: '\u274C', // cross mark
  na: '\u2796', // minus sign
};

export function formatTemplateCoverage(data: TemplateCoverageData): string {
  const pct = Math.round(data.score * 100);
  const lines: string[] = [
    `# Template Coverage: ${data.template_name}`,
    '',
    `**Version:** ${data.template_version ?? 'Current'}`,
    `**Type:** ${data.template_type}`,
    `**Overall Score:** ${pct}%`,
    `**Requirements:** ${data.total_requirements} total — ${data.strong_count} strong, ${data.partial_count} partial, ${data.gap_count} gaps, ${data.na_count} N/A`,
    '',
  ];

  for (const section of data.sections) {
    const sectionStrong = section.requirements.filter(
      (r) => r.coverage_status === 'strong',
    ).length;
    const sectionTotal = section.requirements.filter(
      (r) => r.coverage_status !== 'na',
    ).length;
    const sectionPct =
      sectionTotal > 0 ? Math.round((sectionStrong / sectionTotal) * 100) : 0;

    lines.push(
      `## ${section.section_ref}: ${section.section_name} (${sectionPct}% strong)`,
    );
    lines.push('');

    for (const req of section.requirements) {
      const icon = STATUS_ICONS[req.coverage_status] ?? '?';
      const qNum =
        req.question_number !== null ? `Q${req.question_number}: ` : '';
      const desc = req.description ?? truncate(req.requirement_text, 80);
      lines.push(`- ${icon} ${qNum}${desc}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Template list
// ---------------------------------------------------------------------------

export interface TemplateListItem {
  template_name: string;
  template_version: string | null;
  template_type: string;
  requirement_count: number;
  is_current: boolean;
}

export interface TemplateListData {
  templates: TemplateListItem[];
}

export function formatTemplateList(data: TemplateListData): string {
  if (data.templates.length === 0) {
    return '# Available Templates\n\nNo templates found.';
  }

  const lines: string[] = [
    '# Available Templates',
    '',
    `Found ${data.templates.length} template${data.templates.length === 1 ? '' : 's'}:`,
    '',
  ];

  for (const t of data.templates) {
    const version = t.template_version ? ` (${t.template_version})` : '';
    lines.push(
      `- **${t.template_name}**${version} — ${t.template_type}, ${t.requirement_count} requirement${t.requirement_count === 1 ? '' : 's'}`,
    );
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Template gaps
// ---------------------------------------------------------------------------

export interface TemplateGapsData {
  template_name: string;
  template_version: string | null;
  template_type: string;
  total_requirements: number;
  gap_count: number;
  partial_count: number;
  gaps: TemplateCoverageRequirement[];
}

export function formatTemplateGaps(data: TemplateGapsData): string {
  const totalActionable = data.gaps.length;

  const lines: string[] = [
    `# Template Gaps: ${data.template_name}`,
    '',
    `**Version:** ${data.template_version ?? 'Current'}`,
    `**Actionable items:** ${totalActionable} (${data.gap_count} gaps, ${data.partial_count} partial)`,
    '',
  ];

  if (totalActionable === 0) {
    lines.push(
      'No gaps or partial matches found — the knowledge base covers all requirements.',
    );
    return lines.join('\n');
  }

  // Group by section for readability
  const sectionMap = new Map<string, TemplateCoverageRequirement[]>();
  for (const gap of data.gaps) {
    const key = `${gap.section_ref}: ${gap.section_name}`;
    if (!sectionMap.has(key)) sectionMap.set(key, []);
    sectionMap.get(key)!.push(gap);
  }

  for (const [sectionLabel, reqs] of sectionMap) {
    lines.push(`## ${sectionLabel}`);
    lines.push('');

    for (const req of reqs) {
      const icon = STATUS_ICONS[req.coverage_status] ?? '?';
      const qNum =
        req.question_number !== null ? `Q${req.question_number}: ` : '';
      const desc = req.description ?? truncate(req.requirement_text, 100);
      lines.push(`- ${icon} **${qNum}${desc}** (${req.requirement_type})`);

      if (req.coverage_status === 'gap') {
        lines.push(
          `  *Create ${req.requirement_type} content to fill this gap.*`,
        );
      } else {
        lines.push(
          `  *Existing content is insufficient — expand or add more detail.*`,
        );
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}
