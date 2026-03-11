import { NextResponse } from 'next/server';
import { getAuthenticatedClient, unauthorisedResponse } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import {
  fetchTemplateRequirements,
  fetchContentForMatching,
  computeTemplateCoverage,
  computeGapSummary,
  listAvailableTemplates,
} from '@/lib/template-coverage';

/**
 * GET /api/coverage/gap-summary
 *
 * Returns an aggregated gap summary across all current templates.
 * Used by the coverage dashboard to show "action required" visibility.
 */
export async function GET() {
  try {
    const auth = await getAuthenticatedClient();
    if (!auth) return unauthorisedResponse();

    // Fetch all current templates
    const templates = await listAvailableTemplates(auth.supabase);

    if (templates.length === 0) {
      return NextResponse.json({
        total_gaps: 0,
        total_partial: 0,
        templates_assessed: 0,
        gaps_by_type: {},
        partial_by_type: {},
        gaps_by_template: [],
        top_gaps: [],
      });
    }

    // Fetch content once (shared across all templates)
    const contentItems = await fetchContentForMatching(auth.supabase);

    // Compute coverage for each template
    const results = await Promise.all(
      templates.map(async (t) => {
        const requirements = await fetchTemplateRequirements(
          auth.supabase,
          t.template_name,
        );
        return computeTemplateCoverage(
          t.template_name,
          t.template_version,
          t.template_type,
          requirements,
          contentItems,
        );
      }),
    );

    const summary = computeGapSummary(results);

    return NextResponse.json(summary);
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to compute gap summary') },
      { status: 500 },
    );
  }
}
