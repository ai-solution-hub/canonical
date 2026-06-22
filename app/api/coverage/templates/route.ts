import { defineRoute } from "@/lib/api/define-route";
import {
    authFailureResponse,
    getAuthenticatedClient,
} from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import {
    computeTemplateCoverage,
    fetchContentForMatching,
    fetchTemplateRequirements,
} from '@/lib/templates/template-coverage';
import { parseSearchParams } from '@/lib/validation';
import { CoverageTemplateParamsSchema } from '@/lib/validation/schemas';
import { NextRequest, NextResponse } from 'next/server';
import { z } from "zod";

export const maxDuration = 30;

const RequirementCoverageSchema = z.object({
  requirement_id: z.string(),
  section_ref: z.string(),
  section_name: z.string(),
  question_number: z.number().nullable(),
  requirement_text: z.string(),
  description: z.string().nullable(),
  requirement_type: z.enum([
    'policy',
    'statement',
    'evidence',
    'data',
    'narrative',
    'declaration',
    'reference',
  ]),
  coverage_status: z.enum(['strong', 'partial', 'gap', 'na']),
  matching_content_ids: z.array(z.string()),
  best_similarity_score: z.number(),
  content_length_met: z.boolean(),
});

const TemplateCoverageResultSchema = z.object({
  template_name: z.string(),
  template_version: z.string().nullable(),
  template_type: z.string(),
  total_requirements: z.number(),
  strong_count: z.number(),
  partial_count: z.number(),
  gap_count: z.number(),
  na_count: z.number(),
  score: z.number(),
  sections: z.array(
    z.object({
      section_ref: z.string(),
      section_name: z.string(),
      requirements: z.array(RequirementCoverageSchema),
    }),
  ),
});

export const GET = defineRoute(TemplateCoverageResultSchema, async (request: NextRequest) => {
  try {
    const auth = await getAuthenticatedClient();
    if (!auth.success) return authFailureResponse(auth);

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
});
