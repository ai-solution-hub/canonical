/**
 * URL landing-set seed — the ledger-row half of the ID-75 TECH §5 proof.
 *
 * The URL parameterisation of the verify sequence needs a gate-passed
 * `feed_articles` row to exist before a walk runs: the pipeline's UrlItem
 * source reads the ledger, fetches `external_url`, and lands the
 * source_documents / reference_items evidence pair.
 *
 * This used to live in `deploy/onprem/verify/verify_driver.py` — a 626-line
 * host-side Python tool with no automated caller, run manually once on the B1
 * host at S319 and carried by sweeps ever since. Its seed step is ~40 lines of
 * PostgREST calls; its walk step is `runWalk()`; its landing poll and
 * idempotency assertions were always the Vitest file's job (ID-62 Inv-22).
 * Folding the seed here lets the whole proof run in the nightly instead of
 * depending on an operator remembering to run a script first (S524, id-46
 * {46.12} — owner finding S521).
 *
 * Idempotent across runs, exactly as the Python was: an existing verify row is
 * PATCHed rather than duplicated — `passed` re-asserted and `ingested_at`
 * bumped so the D-4 memo token forces a fresh fetch + extraction on the next
 * walk.
 */

import type { createLiveServiceClient } from '../../helpers/supabase-client';

type LiveClient = Awaited<ReturnType<typeof createLiveServiceClient>>;

/** Default proof URL — tiny, stable, and safe to fetch from CI. */
export const DEFAULT_PROOF_URL = 'https://example.com/';

/**
 * Names carried over verbatim from the retired Python driver so a re-run
 * against a database it previously seeded re-asserts the SAME rows rather
 * than minting parallel ones.
 */
const VERIFY_FEED_SOURCE_NAME = 'kh-url-landing-set-verify (ID-62.10)';
const VERIFY_ARTICLE_TITLE = 'KH URL landing-set verify (ID-62.10)';
const VERIFY_PUBLISHED_AT = '2026-01-01T00:00:00+00:00';

/**
 * Seed (or re-assert) the gate-passed ledger row for `normalisedUrl`.
 *
 * Throws on any failure — a seed that half-lands would surface downstream as
 * a confusing landing-set assertion failure rather than as what it is.
 */
export async function seedUrlLandingLedgerRow(
  client: LiveClient,
  normalisedUrl: string,
): Promise<void> {
  // (1) workspace — reuse any existing row; workspace_id is a NOT NULL FK on
  //     both tables below and this proof does not care which workspace.
  const { data: workspaces, error: wsError } = await client
    .from('workspaces')
    .select('id')
    .limit(1);
  if (wsError) {
    throw new Error(
      `url-landing seed: workspaces read failed — ${wsError.message}`,
    );
  }
  const workspaceId = workspaces?.[0]?.id;
  if (!workspaceId) {
    throw new Error(
      'url-landing seed: no workspace row available to anchor the seed',
    );
  }

  // (2) feed_source — reuse the verify source if present, else insert an
  //     INACTIVE one. is_active=false is load-bearing: the TS feed poller
  //     must never treat this synthetic source as real work.
  const { data: existingSources, error: srcReadError } = await client
    .from('feed_sources')
    .select('id')
    .eq('name', VERIFY_FEED_SOURCE_NAME)
    .limit(1);
  if (srcReadError) {
    throw new Error(
      `url-landing seed: feed_sources read failed — ${srcReadError.message}`,
    );
  }

  let feedSourceId = existingSources?.[0]?.id;
  if (!feedSourceId) {
    const { data: created, error: srcInsertError } = await client
      .from('feed_sources')
      .insert({
        workspace_id: workspaceId,
        name: VERIFY_FEED_SOURCE_NAME,
        url: normalisedUrl,
        source_type: 'web',
        is_active: false,
      })
      .select('id')
      .single();
    if (srcInsertError || !created) {
      throw new Error(
        `url-landing seed: feed_sources insert failed — ${srcInsertError?.message ?? 'no row returned'}`,
      );
    }
    feedSourceId = created.id;
  }

  // (3) feed_articles — the gate-passed ledger row (TECH §5 step 1).
  const nowIso = new Date().toISOString();
  const { data: existingArticles, error: artReadError } = await client
    .from('feed_articles')
    .select('id')
    .eq('external_url', normalisedUrl)
    .eq('feed_source_id', feedSourceId)
    .limit(1);
  if (artReadError) {
    throw new Error(
      `url-landing seed: feed_articles read failed — ${artReadError.message}`,
    );
  }

  const existingArticleId = existingArticles?.[0]?.id;
  if (existingArticleId) {
    const { error: patchError } = await client
      .from('feed_articles')
      .update({
        passed: true,
        published_at: VERIFY_PUBLISHED_AT,
        ingested_at: nowIso,
      })
      .eq('id', existingArticleId);
    if (patchError) {
      throw new Error(
        `url-landing seed: feed_articles re-assert failed — ${patchError.message}`,
      );
    }
    return;
  }

  const { error: insertError } = await client.from('feed_articles').insert({
    workspace_id: workspaceId,
    feed_source_id: feedSourceId,
    external_url: normalisedUrl,
    title: VERIFY_ARTICLE_TITLE,
    passed: true,
    published_at: VERIFY_PUBLISHED_AT,
    ingested_at: nowIso,
  });
  if (insertError) {
    throw new Error(
      `url-landing seed: feed_articles insert failed — ${insertError.message}`,
    );
  }
}
