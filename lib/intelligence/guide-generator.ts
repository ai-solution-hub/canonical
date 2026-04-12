// lib/intelligence/guide-generator.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import { findParentSector } from '@/lib/intelligence/topic-mappings';

export interface CompanyProfile {
  id: string;
  name: string;
  sectors: string[];
  services: string[];
  key_topics: string[];
}

export interface GeneratedGuide {
  guideId: string;
  sectionCount: number;
}

/**
 * Auto-generate a hierarchical guide for an intelligence workspace.
 *
 * Creates a guide with a two-level content tree derived from the company
 * profile:
 *
 * Pass 1 — sector parent sections (top-level, parent_section_id = null)
 * Pass 2 — topic child sections nested under their parent sector where
 *           a mapping exists (via lib/intelligence/topic-mappings.ts).
 *           Topics with no matching sector remain top-level.
 * Catch-all — "Research Feed" section always at top level.
 *
 * The guide uses guide_type = 'research' and is published by default.
 */
export async function createIntelligenceGuide(
  supabase: SupabaseClient,
  workspaceId: string,
  workspaceName: string,
  profile: CompanyProfile,
  userId: string,
): Promise<GeneratedGuide | null> {
  // 1. Generate slug from workspace name
  const baseSlug = `intelligence-${workspaceName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')}`;

  // 2. Insert guide — try base slug first, then fallback with workspace ID fragment
  const guidePayload = {
    name: `${workspaceName} Intelligence Guide`,
    description: `Auto-generated intelligence coverage guide for ${profile.name}`,
    guide_type: 'research',
    display_order: 0,
    is_published: true,
    created_by: userId,
  };

  let guideId: string | null = null;

  const { data: firstAttempt, error: firstError } = await supabase
    .from('guides')
    .insert({ ...guidePayload, slug: baseSlug })
    .select('id')
    .single();

  if (!firstError && firstAttempt) {
    guideId = firstAttempt.id;
  } else {
    // Slug conflict — retry with workspace ID fragment appended
    const fallbackSlug = `${baseSlug}-${workspaceId.slice(0, 8)}`;
    const { data: retryAttempt, error: retryError } = await supabase
      .from('guides')
      .insert({ ...guidePayload, slug: fallbackSlug })
      .select('id')
      .single();

    if (retryError || !retryAttempt) {
      return null;
    }
    guideId = retryAttempt.id;
  }

  // 3. Build hierarchical sections — two-pass approach
  const sectors = profile.sectors ?? [];
  const topics = profile.key_topics ?? [];

  let order = 1;

  // Pass 1: Insert sector parent sections and capture their IDs
  const sectorIdMap = new Map<string, string>(); // sector name -> section UUID

  if (sectors.length > 0) {
    const sectorRows = sectors.map((sector) => ({
      guide_id: guideId!,
      section_name: sector,
      description: `Intelligence coverage for the ${sector} sector`,
      expected_layer: 'research',
      display_order: order++,
      is_required: true,
      content_type_filter: 'article',
      parent_section_id: null as string | null,
    }));

    const { data: insertedSectors, error: sectorError } = await supabase
      .from('guide_sections')
      .insert(sectorRows)
      .select('id, section_name');

    if (sectorError) {
      await supabase.from('guides').delete().eq('id', guideId);
      return null;
    }

    // Build lookup from sector name to its new section UUID
    for (const row of insertedSectors ?? []) {
      sectorIdMap.set(row.section_name, row.id);
    }
  }

  // Pass 2: Insert topic sections, nested under parent sector where mapped
  const topicAndCatchAllRows: Array<{
    guide_id: string;
    section_name: string;
    description: string;
    expected_layer: string;
    display_order: number;
    is_required: boolean;
    content_type_filter: string | null;
    parent_section_id: string | null;
  }> = [];

  for (const topic of topics) {
    const parentSector = findParentSector(topic, sectors);
    const parentSectionId = parentSector
      ? (sectorIdMap.get(parentSector) ?? null)
      : null;

    topicAndCatchAllRows.push({
      guide_id: guideId!,
      section_name: topic,
      description: `Articles and updates related to ${topic}`,
      expected_layer: 'research',
      display_order: order++,
      is_required: false,
      content_type_filter: 'article',
      parent_section_id: parentSectionId,
    });
  }

  // Catch-all: Research Feed at top level
  topicAndCatchAllRows.push({
    guide_id: guideId!,
    section_name: 'Research Feed',
    description:
      'General intelligence articles not matching a specific section',
    expected_layer: 'research',
    display_order: order,
    is_required: false,
    content_type_filter: null,
    parent_section_id: null,
  });

  if (topicAndCatchAllRows.length > 0) {
    const { error: topicError } = await supabase
      .from('guide_sections')
      .insert(topicAndCatchAllRows);

    if (topicError) {
      // Clean up guide and any sector sections already inserted (CASCADE handles children)
      await supabase.from('guides').delete().eq('id', guideId);
      return null;
    }
  }

  const totalSections = sectors.length + topicAndCatchAllRows.length;
  return { guideId: guideId!, sectionCount: totalSections };
}
