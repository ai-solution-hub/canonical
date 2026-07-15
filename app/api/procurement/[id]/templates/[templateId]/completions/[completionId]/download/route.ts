import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthenticatedClient } from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { logger } from '@/lib/logger';
import { createServiceClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 30;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// {145.15} moved the fill lane's storage writes 'templates' -> 'tender-documents'
// (commit 4f587750), but `template_completions.storage_path` is bucket-relative
// with no bucket column -- completions written before that cutover still have
// their bytes in the old 'templates' bucket. Try the new bucket first, fall
// back to the legacy one so pre-cutover completions keep downloading (DR-075,
// gate-145-15 finding surfaced via the {145.19} S474 journal).
const COMPLETION_BUCKET_CANDIDATES = ['tender-documents', 'templates'] as const;

export const GET = defineRoute(
  z.unknown(),
  async (
    _request: NextRequest,
    {
      params,
    }: {
      params: Promise<{
        id: string;
        templateId: string;
        completionId: string;
      }>;
    },
  ) => {
    try {
      const auth = await getAuthenticatedClient();
      if (!auth.success) return authFailureResponse(auth);
      const { supabase } = auth;

      const { id: procurementId, templateId, completionId } = await params;
      if (
        !UUID_RE.test(procurementId) ||
        !UUID_RE.test(templateId) ||
        !UUID_RE.test(completionId)
      ) {
        return NextResponse.json(
          { error: 'Invalid ID format -- must be a valid UUID' },
          { status: 400 },
        );
      }

      // Verify the form exists. DR-075 re-key: `form_templates` ->
      // `form_instances`; `workspace_id` dropped ({145.6} W1c STEP 1, BI-1 --
      // the item IS the form, no workspace mediation). `procurementId` stays
      // format-validated for the route's URL shape but is not a query
      // predicate (matches the fill/auto-map convention).
      const { data: template, error: templateError } = await supabase
        .from('form_instances')
        .select('id')
        .eq('id', templateId)
        .single();

      if (templateError || !template) {
        return NextResponse.json(
          { error: 'Template not found' },
          { status: 404 },
        );
      }

      // Fetch completion record. DR-075 re-key: `template_id` ->
      // `form_instance_id` ({145.6} W1c STEP 5).
      const { data: completion, error: completionError } = await supabase
        .from('template_completions')
        .select('id, storage_path, fields_filled')
        .eq('id', completionId)
        .eq('form_instance_id', templateId)
        .single();

      if (completionError || !completion) {
        return NextResponse.json(
          { error: 'Completion not found' },
          { status: 404 },
        );
      }

      // Generate signed URL (5-minute expiry) -- bucket-fallback read, see
      // COMPLETION_BUCKET_CANDIDATES above.
      const serviceClient = createServiceClient();
      let signedUrl: string | null = null;
      let signError: unknown = null;

      for (const bucket of COMPLETION_BUCKET_CANDIDATES) {
        const { data, error } = await serviceClient.storage
          .from(bucket)
          .createSignedUrl(completion.storage_path, 300);
        if (!error && data?.signedUrl) {
          signedUrl = data.signedUrl;
          break;
        }
        signError = error;
      }

      if (!signedUrl) {
        logger.error({ err: signError }, 'Failed to create signed URL');
        return NextResponse.json(
          { error: 'Failed to generate download link' },
          { status: 500 },
        );
      }

      return NextResponse.json({
        download_url: signedUrl,
        expires_in: 300,
      });
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to generate download link') },
        { status: 500 },
      );
    }
  },
);
