// lib/intelligence/guide-generator.ts
import type { SupabaseClient } from '@supabase/supabase-js';

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
 * Auto-generate a guide for an intelligence workspace.
 *
 * Creates a guide with sections derived from the company profile:
 * - One section per sector (e.g. "Education", "Health & Social Care")
 * - One section per key topic (e.g. "KCSIE", "Safeguarding")
 * - A "Research Feed" section for uncategorised articles
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

  // 2. Build section definitions from profile
  const sections: Array<{
    section_name: string;
    description: string;
    expected_layer: string;
    display_order: number;
    is_required: boolean;
    content_type_filter?: string;
  }> = [];

  let order = 1;

  // Sector-based sections
  for (const sector of profile.sectors ?? []) {
    sections.push({
      section_name: sector,
      description: `Intelligence coverage for the ${sector} sector`,
      expected_layer: 'research',
      display_order: order++,
      is_required: true,
      content_type_filter: 'article',
    });
  }

  // Key topic sections
  for (const topic of profile.key_topics ?? []) {
    sections.push({
      section_name: topic,
      description: `Articles and updates related to ${topic}`,
      expected_layer: 'research',
      display_order: order++,
      is_required: false,
      content_type_filter: 'article',
    });
  }

  // Research feed catch-all
  sections.push({
    section_name: 'Research Feed',
    description: 'General intelligence articles not matching a specific section',
    expected_layer: 'research',
    display_order: order,
    is_required: false,
  });

  // 3. Insert guide — try base slug first, then fallback with workspace ID fragment
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

  // 4. Insert guide sections
  const sectionRows = sections.map((s) => ({
    guide_id: guideId!,
    section_name: s.section_name,
    description: s.description,
    expected_layer: s.expected_layer,
    display_order: s.display_order,
    is_required: s.is_required,
    content_type_filter: s.content_type_filter ?? null,
  }));

  const { error: sectionError } = await supabase
    .from('guide_sections')
    .insert(sectionRows);

  if (sectionError) {
    // Clean up guide if sections failed
    await supabase.from('guides').delete().eq('id', guideId);
    return null;
  }

  return { guideId, sectionCount: sectionRows.length };
}
