import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedClient, unauthorisedResponse } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { parseSearchParams } from '@/lib/validation';
import { CoverageTemplateParamsSchema } from '@/lib/validation/schemas';
import {
  fetchTemplateRequirements,
  fetchContentForMatching,
  computeTemplateCoverage,
} from '@/lib/templates/template-coverage';

export const maxDuration = 30;

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedClient();
    if (!auth) return unauthorisedResponse();

    const parsed = parseSearchParams(CoverageTemplateParamsSchema, request.nextUrl.searchParams);
    if (!parsed.success) return parsed.response;
    const { template_name: templateName, template_version: templateVersion } = parsed.data;

    const [requirements, contentItems] = await Promise.all([
      fetchTemplateRequirements(auth.supabase, templateName, templateVersion),
      fetchContentForMatching(auth.supabase),
    ]);

    if (requirements.length === 0) {
      return NextResponse.json(
        { error: `No requirements found for template '${templateName}'` },
        { status: 404 },
      );
    }

    const result = computeTemplateCoverage(
      templateName,
      requirements[0].template_version,
      requirements[0].template_type,
      requirements,
      contentItems,
    );

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to compute template coverage') },
      { status: 500 },
    );
  }
}
