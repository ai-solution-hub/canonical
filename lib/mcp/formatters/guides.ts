/**
 * Guide formatters for MCP tool responses.
 */
import { formatDateUK } from '@/lib/format';

// ---------------------------------------------------------------------------
// Guide detail
// ---------------------------------------------------------------------------

export interface GuideDetail {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  guide_type: string;
  domain_filter: string | null;
  icon: string | null;
  color: string | null;
  display_order: number;
  is_published: boolean;
  created_at: string | null;
  updated_at: string | null;
}

export interface GuideSectionDetail {
  id: string;
  section_name: string;
  description: string | null;
  expected_layer: string | null;
  subtopic_filter: string | null;
  content_type_filter: string | null;
  display_order: number;
  is_required: boolean;
}

export function formatGuideDetail(
  guide: GuideDetail,
  sections: GuideSectionDetail[],
): string {
  const lines: string[] = [`# ${guide.name}`, ''];

  lines.push(`**Type:** ${guide.guide_type}`);
  lines.push(`**Slug:** ${guide.slug}`);
  lines.push(`**Published:** ${guide.is_published ? 'Yes' : 'No'}`);

  if (guide.description) {
    lines.push(`**Description:** ${guide.description}`);
  }

  if (guide.domain_filter) {
    lines.push(`**Domain filter:** ${guide.domain_filter}`);
  }

  if (guide.icon) {
    lines.push(`**Icon:** ${guide.icon}`);
  }

  if (guide.color) {
    lines.push(`**Colour:** ${guide.color}`);
  }

  lines.push(`**Display order:** ${guide.display_order}`);

  if (guide.created_at) {
    lines.push(`**Created:** ${formatDateUK(guide.created_at)}`);
  }

  if (guide.updated_at) {
    lines.push(`**Updated:** ${formatDateUK(guide.updated_at)}`);
  }

  lines.push(`**ID:** ${guide.id}`);

  // Sections
  if (sections.length > 0) {
    lines.push('', `## Sections (${sections.length})`, '');
    lines.push('| # | Section | Required | Layer | Subtopic Filter |');
    lines.push('|---|---------|----------|-------|-----------------|');

    for (const section of sections) {
      const required = section.is_required ? 'Yes' : 'No';
      const layer = section.expected_layer ?? '-';
      const subtopic = section.subtopic_filter ?? '-';
      lines.push(
        `| ${section.display_order} | ${section.section_name} | ${required} | ${layer} | ${subtopic} |`,
      );
    }
  } else {
    lines.push('', '*No sections defined.*');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Guide list
// ---------------------------------------------------------------------------

export interface GuideListItem {
  id: string;
  name: string;
  slug: string;
  guide_type: string;
  domain_filter: string | null;
  is_published: boolean;
  display_order: number;
  section_count: number;
}

export function formatGuideList(guides: GuideListItem[]): string {
  if (guides.length === 0) {
    return 'No guides found.';
  }

  const lines: string[] = [
    `# Guides (${guides.length})`,
    '',
    '| Name | Type | Domain | Published | Sections | Slug |',
    '|------|------|--------|-----------|----------|------|',
  ];

  for (const guide of guides) {
    const domain = guide.domain_filter ?? '-';
    const published = guide.is_published ? 'Yes' : 'No';
    lines.push(
      `| ${guide.name} | ${guide.guide_type} | ${domain} | ${published} | ${guide.section_count} | ${guide.slug} |`,
    );
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Guide created
// ---------------------------------------------------------------------------

export interface CreatedGuideResult {
  id: string;
  name: string;
  slug: string;
  guide_type: string;
  is_published: boolean;
  section_count: number;
}

export function formatCreatedGuide(result: CreatedGuideResult): string {
  return [
    '# Guide Created',
    '',
    `**Name:** ${result.name}`,
    `**Slug:** ${result.slug}`,
    `**Type:** ${result.guide_type}`,
    `**Published:** ${result.is_published ? 'Yes' : 'No'}`,
    `**Sections:** ${result.section_count}`,
    `**ID:** ${result.id}`,
    '',
    'The guide has been created successfully.',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Guide updated
// ---------------------------------------------------------------------------

export interface UpdatedGuideResult {
  id: string;
  name: string;
  slug: string | null;
  updated_fields: string[];
  sections_added: number;
  sections_updated: number;
  reason: string | null;
}

export function formatUpdatedGuide(result: UpdatedGuideResult): string {
  const lines: string[] = [
    '# Guide Updated',
    '',
    `**Name:** ${result.name}`,
    `**Slug:** ${result.slug ?? 'unknown'}`,
    `**ID:** ${result.id}`,
    `**Fields updated:** ${result.updated_fields.length > 0 ? result.updated_fields.join(', ') : 'none'}`,
  ];

  if (result.sections_added > 0) {
    lines.push(`**Sections added:** ${result.sections_added}`);
  }

  if (result.sections_updated > 0) {
    lines.push(`**Sections updated:** ${result.sections_updated}`);
  }

  if (result.reason) {
    lines.push(`**Reason:** ${result.reason}`);
  }

  lines.push('', 'The guide has been updated successfully.');

  return lines.join('\n');
}
