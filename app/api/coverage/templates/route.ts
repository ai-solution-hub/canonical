import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedClient, unauthorisedResponse } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import {
  fetchTemplateRequirements,
  fetchContentForMatching,
  computeTemplateCoverage,
} from '@/lib/template-coverage';

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedClient();
    if (!auth) return unauthorisedResponse();

    const templateName = request.nextUrl.searchParams.get('template_name');
    if (!templateName) {
      return NextResponse.json(
        { error: 'template_name query parameter is required' },
        { status: 400 },
      );
    }

    const templateVersion =
      request.nextUrl.searchParams.get('template_version') || undefined;

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
