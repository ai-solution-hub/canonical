// app/api/cron/attachment-orphan-sweep/route.ts
//
// ID-147 {147.8} — the orphan-sweep BACKSTOP for the `form_attachments`
// store (TECH.md §2 "Storage-object cleanup owner"). The FK `ON DELETE
// CASCADE` on both `form_instance_id` and `engagement_group_id` removes a
// `form_attachments` ROW when its parent (a form, or an engagement group)
// is deleted through ANY path other than this route's own DELETE handler
// (`[id]/attachments/route.ts`) — a Postgres cascade cannot reach the
// Supabase Storage object, so the `tender-documents` bucket object is left
// behind with no DB row pointing at it. This cron reconciles the bucket
// listing against the live `form_attachments` rows and best-effort removes
// anything unreferenced.
//
// Two independent sweeps, matching the two storage-path shapes ({147.8}
// `[id]/attachments/route.ts`):
//   - ENGAGEMENT-scoped (`engagement/<engagement_group_id>/...`): the
//     `engagement/` prefix is used ONLY by engagement-scoped attachments,
//     so a single top-level list is a complete, cheap census — no
//     form-by-form fan-out needed.
//   - FORM-scoped (`<form_id>/attachments/...`): nested one level under
//     EVERY form's own top-level storage folder (which also holds that
//     form's zero-schema primary document, §A5 FORM SOURCE — never
//     touched here). There is no single shared prefix to list, so this
//     sweep pages through `form_instances` (bounded per run via `?limit=`,
//     default below) and lists each form's `attachments/` subfolder.
//     A backstop cron re-running periodically covers the full form corpus
//     incrementally across runs — this is a best-effort reconciliation,
//     not a synchronous cleanup path.
//
// CRON_SECRET-gated (`verifyCronAuth`, same as every other `/api/cron/*`
// route) — register the schedule in `vercel.json` `crons`.

import { NextRequest, NextResponse } from 'next/server';
import { verifyCronAuth } from '@/lib/cron-auth';
import { createServiceClient } from '@/lib/supabase/server';
import { tryQuery } from '@/lib/supabase/safe';
import { safeErrorMessage } from '@/lib/error';
import { logger } from '@/lib/logger';

export const maxDuration = 60;

/** Default page size for the form-scoped sweep's `form_instances` scan. */
const DEFAULT_FORM_SWEEP_LIMIT = 200;

/** Minimal shape of a Supabase Storage `list()` entry this sweep cares about. */
interface StorageListEntry {
  name: string;
  /** Supabase storage: `null` for a folder pseudo-entry, set for a real file. */
  id: string | null;
}

interface StorageLister {
  list(
    path: string,
    options?: { limit?: number },
  ): Promise<{
    data: StorageListEntry[] | null;
    error: { message: string } | null;
  }>;
  remove(
    paths: string[],
  ): Promise<{ data: unknown; error: { message: string } | null }>;
}

interface SweepResult {
  removed: string[];
  failed: string[];
}

/**
 * Pure reconciliation: which LISTED storage paths have no matching
 * `form_attachments` row. Kept dependency-free (no Supabase client) so the
 * core "what is an orphan" logic is directly unit-testable.
 */
export function findOrphanPaths(
  listedPaths: string[],
  expectedPaths: ReadonlySet<string>,
): string[] {
  return listedPaths.filter((path) => !expectedPaths.has(path));
}

/** Best-effort remove of every path in `orphanPaths`, one at a time is avoided (batched). */
async function removeOrphans(
  bucket: StorageLister,
  orphanPaths: string[],
): Promise<SweepResult> {
  if (orphanPaths.length === 0) return { removed: [], failed: [] };
  const { error } = await bucket.remove(orphanPaths);
  if (error) {
    logger.error(
      { err: error, paths: orphanPaths },
      'attachment-orphan-sweep: best-effort remove() failed for a batch',
    );
    return { removed: [], failed: orphanPaths };
  }
  return { removed: orphanPaths, failed: [] };
}

/**
 * Engagement-scoped sweep — `engagement/<engagement_group_id>/...` is used
 * ONLY by `form_attachments` (never the primary-document upload path), so
 * this is a complete reconciliation, not a sampled one.
 */
async function sweepEngagementScoped(
  bucket: StorageLister,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
): Promise<SweepResult> {
  const removed: string[] = [];
  const failed: string[] = [];

  const { data: folders, error: listError } = await bucket.list('engagement', {
    limit: 1000,
  });
  if (listError) {
    logger.error(
      { err: listError },
      'attachment-orphan-sweep: failed to list engagement/ prefix',
    );
    return { removed, failed };
  }

  for (const folder of folders ?? []) {
    if (folder.id !== null) continue; // a stray file at bucket root, not a folder — skip
    const engagementGroupId = folder.name;

    const { data: files, error: filesError } = await bucket.list(
      `engagement/${engagementGroupId}`,
      { limit: 1000 },
    );
    if (filesError) {
      logger.error(
        { err: filesError, engagementGroupId },
        'attachment-orphan-sweep: failed to list an engagement folder',
      );
      continue;
    }

    const rowsResult = await tryQuery<Array<{ storage_path: string }>>(
      supabase
        .from('form_attachments')
        .select('storage_path')
        .eq('engagement_group_id', engagementGroupId),
      'attachment-orphan-sweep.engagementRows',
    );
    const expectedPaths = new Set(
      rowsResult.ok ? rowsResult.data.map((r) => r.storage_path) : [],
    );

    const listedPaths = (files ?? [])
      .filter((f) => f.id !== null)
      .map((f) => `engagement/${engagementGroupId}/${f.name}`);
    const orphanPaths = findOrphanPaths(listedPaths, expectedPaths);

    const batchResult = await removeOrphans(bucket, orphanPaths);
    removed.push(...batchResult.removed);
    failed.push(...batchResult.failed);
  }

  return { removed, failed };
}

/**
 * Form-scoped sweep — bounded to `limit` forms per run (most-recently
 * created first), each checked for an orphaned `<form_id>/attachments/`
 * entry. A periodic re-run covers the full corpus incrementally.
 */
async function sweepFormScoped(
  bucket: StorageLister,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  limit: number,
): Promise<SweepResult & { formsScanned: number }> {
  const removed: string[] = [];
  const failed: string[] = [];

  // ID-145 {145.6}/{145.7} type-regen-skip allowance: `form_instances` is
  // POST-W1 schema, not yet in the generated Database type. Expected
  // typecheck drift, journalled not chased — same allowance the sibling
  // procurement routes already take.
  const formsResult = await tryQuery<Array<{ id: string }>>(
    supabase
      .from('form_instances')
      .select('id')
      .order('created_at', { ascending: false })
      .limit(limit),
    'attachment-orphan-sweep.forms',
  );
  const forms = formsResult.ok ? formsResult.data : [];

  for (const form of forms) {
    const { data: files, error: filesError } = await bucket.list(
      `${form.id}/attachments`,
      { limit: 1000 },
    );
    if (filesError || !files || files.length === 0) continue;

    const rowsResult = await tryQuery<Array<{ storage_path: string }>>(
      supabase
        .from('form_attachments')
        .select('storage_path')
        .eq('form_instance_id', form.id),
      'attachment-orphan-sweep.formRows',
    );
    const expectedPaths = new Set(
      rowsResult.ok ? rowsResult.data.map((r) => r.storage_path) : [],
    );

    const listedPaths = files
      .filter((f) => f.id !== null)
      .map((f) => `${form.id}/attachments/${f.name}`);
    const orphanPaths = findOrphanPaths(listedPaths, expectedPaths);

    const batchResult = await removeOrphans(bucket, orphanPaths);
    removed.push(...batchResult.removed);
    failed.push(...batchResult.failed);
  }

  return { removed, failed, formsScanned: forms.length };
}

export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  try {
    const supabase = createServiceClient();
    const bucket = supabase.storage.from(
      'tender-documents',
    ) as unknown as StorageLister;

    const limitParam = request.nextUrl.searchParams.get('limit');
    const parsedLimit = limitParam ? Number.parseInt(limitParam, 10) : NaN;
    const formSweepLimit =
      Number.isFinite(parsedLimit) && parsedLimit > 0
        ? parsedLimit
        : DEFAULT_FORM_SWEEP_LIMIT;

    const engagementResult = await sweepEngagementScoped(bucket, supabase);
    const formResult = await sweepFormScoped(bucket, supabase, formSweepLimit);

    const summary = {
      success: true,
      engagement: {
        removed: engagementResult.removed.length,
        failed: engagementResult.failed.length,
      },
      form: {
        removed: formResult.removed.length,
        failed: formResult.failed.length,
        formsScanned: formResult.formsScanned,
      },
    };

    logger.info(summary, '[attachment-orphan-sweep] run complete');
    return NextResponse.json(summary);
  } catch (err) {
    const message = safeErrorMessage(err, 'attachment-orphan-sweep failed');
    logger.error({ err: message }, '[attachment-orphan-sweep] Error');
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
