import { notFound, redirect } from 'next/navigation';
import { getAuthorisedClient } from '@/lib/auth/client';
import { tryQuery } from '@/lib/supabase/safe';
import { logBestEffortWarn } from '@/lib/supabase/telemetry';
import {
  QAPairViewer,
  QAPairViewerError,
} from '@/components/qa/qa-pair-viewer';
import type { Tables } from '@/supabase/types/database.types';

/**
 * `/library/[id]` — consolidated single-`q_a_pairs`-pair read/edit viewer
 * (ID-135 {135.22}; S440 owner ruling — id-135 owns the consolidated Q&A
 * browsing surface).
 *
 * Replaces the deleted `app/item/[id]` (removed by {131.17}). Reuses the
 * `/documents/[id]` detail-shell pattern verbatim: UUID-format gate → role
 * check → primary read → `notFound()`/error branching → client presenter.
 * This is also the destination the id-135 Surface A `answer`-kind result
 * card, the Surface B derived-pairs list, and `components/qa/qa-row.tsx`'s
 * row-detail link all resolve to (`/library/${id}`) — closing NO-1.
 *
 * BI-1-equivalent (authenticated, role-aware): `getAuthorisedClient` (not
 * merely `getAuthenticatedClient`) so the page can resolve `canEdit` from the
 * caller's role server-side, rather than trusting a client-side flag — the
 * viewer's edit affordance (`QAAnswerDisplay` via `useQAPairEdit`) is gated on
 * this. Any authenticated role (admin/editor/viewer) may READ; only
 * admin/editor get `canEdit`.
 *
 * Not-found / invalid-id: the `UUID_RE` gate (reused verbatim from
 * `app/documents/[id]/page.tsx`) rejects a non-UUID `id` with `notFound()`
 * before any DB work; a well-formed id with no matching `q_a_pairs` row also
 * `notFound()`s. Never a 500, blank page, or partial shell.
 *
 * Partial-failure: a genuine primary-read failure (not a not-found —
 * RLS/transport/DB error) renders `QAPairViewerError` with retry framing,
 * never a blank page.
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function QAPairViewerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // An id that isn't shaped like a Postgres uuid can never match a row;
  // gate before any auth/DB work so a malformed id never reaches them.
  if (!UUID_RE.test(id)) {
    notFound();
  }

  // Any authenticated role may read; canEdit narrows to admin/editor below.
  const auth = await getAuthorisedClient(['admin', 'editor', 'viewer']);
  if (!auth.success) {
    redirect('/login');
  }

  const result = await tryQuery<Tables<'q_a_pairs'> | null>(
    auth.supabase.from('q_a_pairs').select('*').eq('id', id).maybeSingle(),
    'library.pairViewer.get',
  );

  if (!result.ok) {
    // Genuine failure (RLS/transport/DB error) — never blank, never 404.
    logBestEffortWarn(
      'library.pairViewer.get',
      'q_a_pairs primary read failed',
      { pairId: id, code: result.error.code },
    );
    return <QAPairViewerError />;
  }

  if (!result.data) {
    // No row (or RLS-invisible) — not-found, not an error.
    notFound();
  }

  return (
    <QAPairViewer
      pair={result.data}
      canEdit={auth.role === 'admin' || auth.role === 'editor'}
    />
  );
}
