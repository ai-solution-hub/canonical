import { NextRequest, NextResponse } from 'next/server';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { parseBody } from '@/lib/validation';
import { DedupSupersedeBodySchema } from '@/lib/validation/schemas';
import { setSupersession, SupersessionError } from '@/lib/supersession/set';

export const maxDuration = 30;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/admin/content-dedup/[id]/supersede
 *
 * Admin resolves a suspected-duplicate by marking the subject row
 * superseded by a canonical row. Invokes the shared
 * `setSupersession()` helper, which sets `superseded_by` on the OLD
 * (subject) row AND flips its `dedup_status` to `'superseded'` in one
 * UPDATE — DO NOT double-write the dedup_status from this route.
 *
 * Idempotency: rejects with 409 when the subject is no longer in
 * `suspected_duplicate` (concurrent admin already resolved it). The
 * helper itself rejects with `OLD_ALREADY_SUPERSEDED` /
 * `NEW_ALREADY_SUPERSEDED` for chain prevention.
 *
 * Body: { canonicalId: string (uuid), note?: string (max 500) }
 *
 * Auth: admin role only. SupersessionError messages contain raw UUIDs;
 * leaking them is admin-safe per `lib/supersession/set.ts:24-26`.
 *
 * Spec: docs/specs/§1.7-admin-dedup-review-spec.md §5.1, §4.2, §4.3
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await getAuthorisedClient(['admin']);
    if (!auth.success) return authFailureResponse(auth);
    const { user, supabase } = auth;

    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json(
        { error: 'Invalid item ID — must be a valid UUID' },
        { status: 400 },
      );
    }

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const parsed = parseBody(DedupSupersedeBodySchema, raw ?? {});
    if (!parsed.success) return parsed.response;
    const { canonicalId, note } = parsed.data;

    // 1. Idempotency guard on subject (the helper does its own checks but
    //    this route is gated on the suspected_duplicate flow specifically).
    const { data: subject, error: subjectErr } = await supabase
      .from('content_items')
      .select(
        'id, title, suggested_title, content, brief, detail, reference, metadata, dedup_status, archived_at, superseded_by',
      )
      .eq('id', id)
      .single();

    if (subjectErr && subjectErr.code !== 'PGRST116') {
      console.error('Failed to load dedup subject:', subjectErr);
      return NextResponse.json(
        { error: 'Failed to load dedup subject' },
        { status: 500 },
      );
    }
    if (!subject) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }

    if (subject.dedup_status !== 'suspected_duplicate') {
      return NextResponse.json(
        {
          error: 'row already resolved',
          current_status: subject.dedup_status,
        },
        { status: 409 },
      );
    }

    // 2. Invoke the shared helper. The default direction is "canonical
    //    supersedes subject" (i.e. the new file replaces the older
    //    canonical). Spec §6.2: subject (the suspected) is the OLD row.
    try {
      await setSupersession(
        { oldId: id, newId: canonicalId, actorUserId: user.id },
        supabase,
      );
    } catch (helperErr) {
      if (helperErr instanceof SupersessionError) {
        if (
          helperErr.code === 'OLD_NOT_FOUND' ||
          helperErr.code === 'NEW_NOT_FOUND'
        ) {
          return NextResponse.json(
            { error: helperErr.message, code: helperErr.code },
            { status: 404 },
          );
        }
        if (
          helperErr.code === 'SAME_ID' ||
          helperErr.code === 'OLD_ALREADY_SUPERSEDED' ||
          helperErr.code === 'NEW_ALREADY_SUPERSEDED'
        ) {
          return NextResponse.json(
            { error: helperErr.message, code: helperErr.code },
            { status: 409 },
          );
        }
        // Any unmapped SupersessionError → 500 (defensive — keep route
        // response shape stable if new codes are added later).
        return NextResponse.json(
          { error: helperErr.message, code: helperErr.code },
          { status: 500 },
        );
      }
      // Non-SupersessionError surfaces from the helper (e.g. SupabaseError)
      // → 500 with a generic message. Real cause is captured to Sentry by
      // safeErrorMessage().
      return NextResponse.json(
        { error: safeErrorMessage(helperErr, 'Failed to supersede item') },
        { status: 500 },
      );
    }

    // 3. content_history snapshot — change_type='merge'. The supersession
    //    helper does not write history itself (per its docstring: "callers
    //    that need a content_history entry write their own snapshot").
    const { data: latestHistory, error: latestHistoryErr } = await supabase
      .from('content_history')
      .select('version')
      .eq('content_item_id', id)
      .order('version', { ascending: false })
      .limit(1);

    if (latestHistoryErr) {
      console.error('Failed to read latest content_history version:', latestHistoryErr);
    }

    const nextVersion = (latestHistory?.[0]?.version ?? 0) + 1;
    const baseSummary = `Superseded by ${canonicalId} via admin dedup review`;
    const summary = note ? `${baseSummary}: ${note}` : baseSummary;

    // Merge canonicalId into a metadata patch so audit queries can find
    // the linked row without joining. Subject's existing metadata may be
    // null/array/scalar; coerce to object spread safely.
    const baseMeta =
      subject.metadata &&
      typeof subject.metadata === 'object' &&
      !Array.isArray(subject.metadata)
        ? (subject.metadata as Record<string, unknown>)
        : {};
    const historyMetadata = {
      ...baseMeta,
      superseded_by: canonicalId,
      dedup_review_action: 'supersede',
    };

    const { error: historyErr } = await supabase
      .from('content_history')
      .insert({
        content_item_id: id,
        version: nextVersion,
        title: subject.title || subject.suggested_title || 'Untitled',
        content: subject.content || '',
        brief: subject.brief,
        detail: subject.detail,
        reference: subject.reference,
        metadata: historyMetadata,
        change_type: 'merge',
        change_summary: summary,
        change_reason: 'dedup_admin_review_superseded',
        created_by: user.id,
      });

    if (historyErr) {
      console.error('Failed to insert dedup audit history:', historyErr);
    }

    return NextResponse.json({
      id,
      superseded_by: canonicalId,
      dedup_status: 'superseded',
    });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to supersede item') },
      { status: 500 },
    );
  }
}
