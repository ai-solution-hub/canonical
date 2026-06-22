import { NextResponse } from 'next/server';
import {
  getAuthenticatedClient,
  rateLimitResponse,
  authFailureResponse,
} from '@/lib/auth/client';
import { checkRateLimit } from '@/lib/rate-limit';
import { safeErrorMessage } from '@/lib/error';
import { logger } from '@/lib/logger';

export const maxDuration = 30;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GuideSectionRow {
  guide_id: string;
  guide_name: string;
  guide_slug: string;
  guide_type: string;
  domain_filter: string;
  section_id: string;
  section_name: string;
  section_order: number;
  expected_layer: string | null;
  is_required: boolean;
  content_count: number;
  fresh_count: number;
  stale_count: number;
}

interface GuideSection {
  id: string;
  name: string;
  order: number;
  expected_layer: string | null;
  is_required: boolean;
  content_count: number;
  fresh_count: number;
  stale_count: number;
  status: 'populated' | 'stale' | 'empty';
}

interface GuideCoverage {
  id: string;
  name: string;
  slug: string;
  guide_type: string;
  domain_filter: string;
  total_sections: number;
  populated_sections: number;
  required_sections: number;
  populated_required: number;
  fresh_sections: number;
  stale_sections: number;
  sections: GuideSection[];
}

interface GuideCoverageResponse {
  guides: GuideCoverage[];
  summary: {
    total_guides: number;
    fully_populated: number;
    partially_populated: number;
    empty: number;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deriveSectionStatus(
  contentCount: number,
  freshCount: number,
  staleCount: number,
): 'populated' | 'stale' | 'empty' {
  if (contentCount === 0) return 'empty';
  if (freshCount > 0) return 'populated';
  if (staleCount > 0) return 'stale';
  // Content exists but is neither fresh nor stale (e.g. all "aging")
  return 'populated';
}

function groupByGuide(rows: GuideSectionRow[]): GuideCoverage[] {
  const guideMap = new Map<string, GuideCoverage>();

  for (const row of rows) {
    let guide = guideMap.get(row.guide_id);
    if (!guide) {
      guide = {
        id: row.guide_id,
        name: row.guide_name,
        slug: row.guide_slug,
        guide_type: row.guide_type,
        domain_filter: row.domain_filter,
        total_sections: 0,
        populated_sections: 0,
        required_sections: 0,
        populated_required: 0,
        fresh_sections: 0,
        stale_sections: 0,
        sections: [],
      };
      guideMap.set(row.guide_id, guide);
    }

    const status = deriveSectionStatus(
      row.content_count,
      row.fresh_count,
      row.stale_count,
    );

    guide.sections.push({
      id: row.section_id,
      name: row.section_name,
      order: row.section_order,
      expected_layer: row.expected_layer,
      is_required: row.is_required,
      content_count: row.content_count,
      fresh_count: row.fresh_count,
      stale_count: row.stale_count,
      status,
    });

    guide.total_sections += 1;
    if (status !== 'empty') guide.populated_sections += 1;
    if (row.is_required) guide.required_sections += 1;
    if (row.is_required && status !== 'empty') guide.populated_required += 1;
    if (row.fresh_count > 0) guide.fresh_sections += 1;
    if (row.stale_count > 0 && row.fresh_count === 0) guide.stale_sections += 1;
  }

  return Array.from(guideMap.values());
}

// ---------------------------------------------------------------------------
// GET /api/coverage/guides
// ---------------------------------------------------------------------------

/**
 * Returns guide coverage data — per-guide section checklists with content
 * counts and freshness summaries.
 */
export async function GET() {
  try {
    const auth = await getAuthenticatedClient();
    if (!auth.success) return authFailureResponse(auth);

    const { allowed } = checkRateLimit(
      `coverage-guides:${auth.user.id}`,
      30,
      60_000,
    );
    if (!allowed) return rateLimitResponse();

    const { supabase } = auth;

    const { data, error } = await supabase.rpc('get_guide_coverage');

    if (error) {
      logger.error({ err: error }, 'get_guide_coverage RPC error');
      return NextResponse.json(
        { error: 'Failed to load guide coverage data' },
        { status: 500 },
      );
    }

    const rows = (data ?? []) as unknown as GuideSectionRow[];
    const guides = groupByGuide(rows);

    // Compute summary
    const fullyPopulated = guides.filter(
      (g) => g.populated_sections === g.total_sections,
    ).length;
    const empty = guides.filter((g) => g.populated_sections === 0).length;
    const partiallyPopulated = guides.length - fullyPopulated - empty;

    const response: GuideCoverageResponse = {
      guides,
      summary: {
        total_guides: guides.length,
        fully_populated: fullyPopulated,
        partially_populated: partiallyPopulated,
        empty,
      },
    };

    return NextResponse.json(response);
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to load guide coverage') },
      { status: 500 },
    );
  }
}
