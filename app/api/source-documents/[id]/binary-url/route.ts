/**
 * GET /api/source-documents/[id]/binary-url
 *
 * Mints a short-lived signed URL for the binary asset stored in the
 * `documents` bucket for the given source document.
 *
 * Auth gate (INV-8, TECH §2):
 * - getAuthorisedClient() gates the request — any authenticated role may read.
 * - The requesting user's RLS-scoped supabase client performs the
 *   source_documents row read. A row they cannot see (cross-workspace, or
 *   permission-denied) returns no data → 404 (no signed URL minted).
 * - The service client is used ONLY for the storage.createSignedUrl call,
 *   which requires service-level storage access.
 *
 * IMPORTANT: This route is intentionally NOT added to proxy.ts publicRoutes.
 * It is auth-gated; the publicRoutes allowlist is for unauthenticated routes
 * only. Adding an auth-gated route to publicRoutes would be the inverse
 * mistake noted in TECH §6 / PLAN §6.
 *
 * Signed URL TTL: 300s (matching the tender-download pattern at
 * app/api/procurement/[id]/tender/download/route.ts:72).
 *
 * Error contract (INV-6 fallback): all error paths return structured JSON.
 * The binary pane maps a non-200 response to the text fallback — never a
 * blank panel, never a bare 500.
 *
 * ID-117 {117.6}, cluster A→B.
 */

import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthorisedClient } from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { logger } from '@/lib/logger';
import { createServiceClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 30;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Signed-URL TTL in seconds — matches the tender-download pattern. */
const SIGNED_URL_TTL_SECONDS = 300;

/** Storage bucket for source document binary assets. */
const DOCUMENTS_BUCKET = 'documents';

// TODO(OPS-T1): author ResponseSchema
export const GET = defineRoute(
  z.unknown(),
  async (
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    try {
      // Step 1 — Authenticate + authorise the caller.
      const auth = await getAuthorisedClient();
      if (!auth.success) return authFailureResponse(auth);
      const { supabase } = auth;

      // Step 2 — Validate the document ID.
      const { id: documentId } = await params;
      if (!UUID_RE.test(documentId)) {
        return NextResponse.json(
          { error: 'Invalid document ID — must be a valid UUID' },
          { status: 400 },
        );
      }

      // Step 3 — Verify the requesting user can READ the source_documents row.
      // We use the user's RLS-scoped client (auth.supabase) so the database's
      // workspace-isolation policy is enforced at the row level. If the user
      // cannot see the row (cross-workspace, or insufficient privilege), RLS
      // returns no data → we return 404 without minting a URL (INV-19 / INV-8).
      const { data: doc, error: docError } = await supabase
        .from('source_documents')
        .select('id, storage_path, mime_type')
        .eq('id', documentId)
        .maybeSingle();

      if (docError) {
        logger.error(
          { err: docError, documentId },
          '[binary-url] source_documents row read failed',
        );
        return NextResponse.json(
          { error: 'Failed to verify document access' },
          { status: 500 },
        );
      }

      if (!doc) {
        // Either the document doesn't exist or RLS blocked access.
        // We intentionally return 404 in both cases — do not leak whether
        // the document exists in another workspace.
        return NextResponse.json(
          { error: 'Source document not found or not accessible' },
          { status: 404 },
        );
      }

      if (!doc.storage_path || !doc.mime_type) {
        return NextResponse.json(
          { error: 'Source document has no binary asset' },
          { status: 404 },
        );
      }

      // Step 4 — Mint a short-lived signed URL via the service client.
      // The service client bypasses RLS for storage — safe here because we
      // already verified row access under the user's RLS scope above.
      // Pattern mirrors app/api/procurement/[id]/tender/download/route.ts:69-72.
      const serviceClient = createServiceClient();
      const { data: signedUrlData, error: signError } =
        await serviceClient.storage
          .from(DOCUMENTS_BUCKET)
          .createSignedUrl(doc.storage_path, SIGNED_URL_TTL_SECONDS);

      if (signError || !signedUrlData?.signedUrl) {
        logger.error(
          { err: signError, documentId },
          '[binary-url] failed to create signed URL for source document',
        );
        // Return a structured error — the binary pane maps this to the INV-6
        // text-fallback path. Never return a blank body or unstructured error.
        return NextResponse.json(
          { error: 'Failed to generate binary access URL' },
          { status: 500 },
        );
      }

      return NextResponse.json({
        signed_url: signedUrlData.signedUrl,
        expires_in: SIGNED_URL_TTL_SECONDS,
        mime_type: doc.mime_type,
      });
    } catch (err) {
      return NextResponse.json(
        {
          error: safeErrorMessage(err, 'Failed to generate binary access URL'),
        },
        { status: 500 },
      );
    }
  },
);
