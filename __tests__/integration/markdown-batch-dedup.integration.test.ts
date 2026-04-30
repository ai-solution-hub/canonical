/**
 * EP2 §1.11 — markdown-batch dedup pre-flight integration test (T7 / spec §10.2).
 *
 * Spec: docs/specs/ep2-markdown-ui-ingest-spec.md v1.3 §10.2.
 * Plan: docs/plans/§1.11-ep2-build-plan.md EP2-T7 row, AC (a):
 *
 *   "(a) Dedup pre-flight integration (spec §10.2) — seed `content_items`
 *   row with known `content_text_hash` → POST batch with 1 matching `.md`
 *   + 1 unique → assert `content_hash_match` populated for first, null for
 *   second; `source_file_match` populated when filename collides. Guarded
 *   behind `KH_RUN_INTEGRATION=1`."
 *
 * --------------------------------------------------------------------------
 * SPEC DRIFT D1 — gating env var (folded into T9 spec amendment in W5).
 *
 * The plan + spec text say "Guarded behind `KH_RUN_INTEGRATION=1`". That env
 * var is not present anywhere in the codebase. The canonical gating pattern
 * (used by `__tests__/integration/items-patch-publication-status.integration.test.ts:108-114`)
 * is `HAS_REQUIRED_ENV` — presence-of-Supabase-env detection — so the suite
 * gracefully skips on data-empty / missing-env staging (memory
 * `feedback_eval_scripts_assume_populated_db`). This file uses the canonical
 * pattern; T9 in W5 will fold the drift into the spec.
 *
 * --------------------------------------------------------------------------
 * SPEC DRIFT D2 — field naming.
 *
 * The plan AC (a) text says `content_hash_match` populated for first, null
 * for second — that field name does NOT exist on the
 * `MarkdownIngestAnalysis` shape (`types/ingest.ts`). The actual field is
 * `dedupVerdict: { isDuplicate, existingId, existingTitle }`. This test
 * uses the actual field names; T9 will fold the drift into the spec.
 *
 * --------------------------------------------------------------------------
 * SPEC DRIFT D3 — `content_text_hash` GENERATED ALWAYS (CLAUDE.md gotcha).
 *
 * `content_text_hash` is `GENERATED ALWAYS AS md5(...)` on `content_items`
 * (CLAUDE.md gotcha + memory `feedback_content_text_hash_generated_always`).
 * Cannot be inserted explicitly. Seed the row with `content` and let PG
 * compute the hash. The `find_exact_duplicates` RPC matches against the
 * generated column; the orchestrator's `checkExactDuplicate` computes the
 * same `md5(normaliseTextForHash(...))` client-side, so a seeded row whose
 * `content` (post-MDX-cleanup, post-normalisation) round-trips to the same
 * hash will surface as a duplicate.
 *
 * --------------------------------------------------------------------------
 * Surface under test:
 *   - Route POST `/api/ingest/markdown` (`app/api/ingest/markdown/route.ts`)
 *     in `phase=analyse` mode (READ-ONLY pre-flight; spec §4.2 + §5.4).
 *   - Orchestrator `runAnalysePhase` in `lib/ingest/markdown-orchestrator.ts`,
 *     specifically `analyseFile` returning the `dedupVerdict` +
 *     `sourceFileMatch` fields.
 *   - DB RPC `find_exact_duplicates` filtering on
 *     `archived_at IS NULL` + `content_text_hash`.
 *
 * Prerequisites:
 *   - `.env.local` with NEXT_PUBLIC_SUPABASE_URL,
 *     NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SUPABASE_SERVICE_ROLE_KEY,
 *     TEST_USER_1_PASSWORD.
 *   - `bun run seed:e2e-users` has been run against the target DB.
 *
 * Run via: `bun run test:integration -- markdown-batch-dedup`
 *
 * @vitest-environment node
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterAll,
  beforeEach,
} from 'vitest';
// service-client MUST be imported first — it loads dotenv for all env vars.
import { serviceClient } from './helpers/service-client';
import {
  cacheAllTestUserSessions,
  restoreSession,
  getTestUserId,
  type AuthCookieStore,
  type AuthCookieEntry,
  type CachedSessions,
} from './helpers/auth-session';

// ---------------------------------------------------------------------------
// Mock next/headers at file scope so the hoisted cookieStore is shared with
// the production createClient() code path. Same pattern as
// items-patch-publication-status.integration.test.ts.
// ---------------------------------------------------------------------------

const { authCookies, cachedSessions } = vi.hoisted(() => ({
  authCookies: new Map<
    string,
    { name: string; value: string }
  >() as AuthCookieStore,
  cachedSessions: {
    admin: new Map(),
    editor: new Map(),
    viewer: new Map(),
  } as unknown as CachedSessions,
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    getAll: () =>
      Array.from(authCookies.values()).map(
        ({ name, value }): AuthCookieEntry => ({ name, value }),
      ),
    get: (name: string) => authCookies.get(name),
    set: (name: string, value: string) => {
      authCookies.set(name, { name, value });
    },
  }),
}));

// Import handler AFTER the mock is registered.
const { POST: markdownIngestPost } =
  await import('@/app/api/ingest/markdown/route');

import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Per-file unique prefix — Date.now()+random suffix so concurrent runs of the
// integration suite (or repeated runs in the same file) don't collide on
// title/source_file values. Memory feedback_e2e_no_workarounds: stable seeds
// for stable assertions.
const TEST_PREFIX = `[MD-DEDUP-${Date.now()}-${Math.random().toString(36).slice(2, 8)}]`;
const seededIds: string[] = [];
let TEST_USER_1_ID = '';

const HAS_REQUIRED_ENV = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY &&
  process.env.SUPABASE_SERVICE_ROLE_KEY &&
  process.env.TEST_USER_1_PASSWORD,
);
const describeIfEnv = HAS_REQUIRED_ENV ? describe : describe.skip;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Direct service-role insert for a fresh content_items fixture. `content_text_hash`
 * is GENERATED ALWAYS (D3) so it MUST be omitted; we let PG compute the hash
 * from the `content` field. The DB-side normalisation expression is parity
 * with `lib/dedup.ts` `normaliseTextForHash` (lower + strip [^\w\s] + collapse
 * whitespace), so a markdown file whose post-cleanMdxTags body matches this
 * exact `content` (post-normalisation) will collide on the dedup gate.
 *
 * `source_file` is the filename — populated so the orchestrator's
 * `sourceFileMatch` lookup (analyseFile) can find this row by filename.
 */
async function seedItem(opts: {
  content: string;
  sourceFile?: string | null;
  label: string;
}): Promise<{ id: string; content_text_hash: string }> {
  const { data, error } = await serviceClient
    .from('content_items')
    .insert({
      title: `${TEST_PREFIX} ${opts.label}`,
      content: opts.content,
      content_type: 'article',
      created_by: TEST_USER_1_ID,
      ...(opts.sourceFile !== undefined
        ? { source_file: opts.sourceFile }
        : {}),
    })
    .select('id, content_text_hash')
    .single();

  if (error || !data) {
    throw new Error(
      `Seed item "${opts.label}" failed: ${error?.message ?? 'no data'}`,
    );
  }
  seededIds.push(data.id);
  return {
    id: data.id,
    content_text_hash: (data.content_text_hash as string) ?? '',
  };
}

/**
 * Build the analyse-phase request: multipart form-data with `phase=analyse`
 * and the supplied files. Mirrors EP3 jsdom/node FormData construction.
 */
async function postAnalyseBatch(
  files: { name: string; body: string }[],
): Promise<Response> {
  const fd = new FormData();
  fd.append('phase', 'analyse');
  for (const f of files) {
    fd.append('files[]', new File([f.body], f.name, { type: 'text/markdown' }));
  }
  const req = new NextRequest('http://localhost/api/ingest/markdown', {
    method: 'POST',
    body: fd,
  });
  return markdownIngestPost(req);
}

// ---------------------------------------------------------------------------
// Lifecycle hooks
// ---------------------------------------------------------------------------

beforeAll(async () => {
  if (!HAS_REQUIRED_ENV) return;
  TEST_USER_1_ID = await getTestUserId('admin');
  await cacheAllTestUserSessions(cachedSessions);
}, 30_000);

beforeEach(() => {
  if (!HAS_REQUIRED_ENV) return;
  // Admin role exercises the full dedup-gate path (admin override flag is
  // out-of-scope for the analyse-phase test — we cover it in the import-phase
  // skip-dedup unit test, sibling W1-T7b).
  restoreSession(authCookies, cachedSessions, 'admin');
});

afterAll(async () => {
  if (seededIds.length === 0) return;
  // content_history rows are emitted by the
  // `trg_content_items_ensure_v1_history` deferred trigger — delete them
  // before the parent rows so the FK does not block.
  await serviceClient
    .from('content_history')
    .delete()
    .in('content_item_id', seededIds);
  await serviceClient.from('content_items').delete().in('id', seededIds);
}, 30_000);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// `MarkdownIngestAnalysis` shape from `types/ingest.ts` — used to narrow the
// JSON response so the test can assert against the actual orchestrator
// contract (memory `feedback_brief_quote_spec_verbatim`).
interface AnalysisRowAssertion {
  filename: string;
  dedupVerdict: {
    isDuplicate: boolean;
    existingId?: string;
    existingTitle?: string;
  };
  sourceFileMatch: { id: string; title: string } | null;
  contentHash: string;
  empty: boolean;
}

interface AnalyseResponseShape {
  analysis: AnalysisRowAssertion[];
}

describeIfEnv(
  'POST /api/ingest/markdown phase=analyse — dedup pre-flight (T7 / spec §10.2)',
  () => {
    it('flags content-hash matches and surfaces source_file matches', async () => {
      // ─────────────────────────────────────────────────────────────────
      // Seed 1: content-hash collision target.
      //
      // The orchestrator runs `cleanMdxTags()` on the POSTed file body
      // BEFORE hashing. cleanMdxTags is largely identity for plain
      // markdown without PascalCase tags — the body we POST will pass
      // through unchanged. The seed `content` and the POSTed body must
      // therefore agree post-normalisation (lower + [^\w\s] strip +
      // whitespace collapse). We use a deterministic >50-char string to
      // clear the `DEDUP_MIN_CONTENT_LENGTH` gate in `lib/dedup.ts`.
      // ─────────────────────────────────────────────────────────────────
      const collidingBody =
        'This is the canonical content for dedup pre-flight integration test ' +
        `${TEST_PREFIX} content-hash collision body — deterministic across runs.`;
      const seedHashMatch = await seedItem({
        content: collidingBody,
        // Use a DIFFERENT filename than the POSTed file so the `sourceFileMatch`
        // signal is distinct from the dedupVerdict signal in this test row.
        sourceFile: `${TEST_PREFIX}-seed-hash.md`,
        label: 'hash-match seed',
      });

      // ─────────────────────────────────────────────────────────────────
      // Seed 2: source_file collision target.
      //
      // Distinct content (no hash collision) but same filename as a POSTed
      // file. The orchestrator's `sourceFileMatch` lookup is filename-only.
      // ─────────────────────────────────────────────────────────────────
      const distinctSeedBody =
        'Completely different content for the source_file collision seed — ' +
        `${TEST_PREFIX} unique body length over fifty characters guaranteed.`;
      const collidingFilename = `${TEST_PREFIX}-collide.md`;
      const seedFilenameMatch = await seedItem({
        content: distinctSeedBody,
        sourceFile: collidingFilename,
        label: 'filename-match seed',
      });

      // Sanity: the GENERATED hash on the seed should match what
      // `find_exact_duplicates` will look for. Capture the value for
      // assertion clarity.
      expect(seedHashMatch.content_text_hash).toMatch(/^[0-9a-f]{32}$/);

      // The analyse phase is read-only by code-level invariant: the
      // orchestrator's `runAnalysePhase` (`lib/ingest/markdown-orchestrator.ts:182-195`)
      // does NOT call `startPipelineRun`. Asserting this end-to-end via
      // pipeline_runs count delta is brittle when sibling integration files
      // run concurrently (vitest 4 `poolOptions.forks.singleFork` is
      // deprecated — config update out of scope for this WP). The unit
      // tests on `runAnalysePhase` cover the no-write contract directly.

      // ─────────────────────────────────────────────────────────────────
      // POST: 3 files —
      //   1. Hash-collision file: same content as seed 1, distinct filename.
      //   2. Unique file: distinct content + distinct filename — NO match.
      //   3. Filename-collision file: distinct content, same filename as seed 2.
      // ─────────────────────────────────────────────────────────────────
      const hashCollisionFilename = `${TEST_PREFIX}-hash.md`;
      const uniqueFilename = `${TEST_PREFIX}-unique.md`;
      const uniqueBody =
        'Unique never-seen-before body for the dedup negative case — ' +
        `${TEST_PREFIX} no row collides with this on either gate, length over fifty.`;
      const filenameCollisionBody =
        'A different body that should NOT match seed 2 on hash but the ' +
        `filename ${collidingFilename} matches the seed 2 source_file column. ` +
        `${TEST_PREFIX} length-padding to clear the dedup minimum.`;

      const res = await postAnalyseBatch([
        { name: hashCollisionFilename, body: collidingBody },
        { name: uniqueFilename, body: uniqueBody },
        { name: collidingFilename, body: filenameCollisionBody },
      ]);

      const bodyText = await res.clone().text();
      expect(res.status, bodyText).toBe(200);
      const json = (await res.json()) as AnalyseResponseShape;
      expect(json.analysis).toBeTruthy();
      expect(json.analysis.length).toBe(3);

      const byFilename = new Map(
        json.analysis.map((a) => [a.filename, a] as const),
      );

      // ─────────────────────────────────────────────────────────────────
      // Row 1 — hash collision: dedupVerdict.isDuplicate=true,
      // existingId=seed1.id; sourceFileMatch=null (filename doesn't match
      // any seeded source_file).
      // ─────────────────────────────────────────────────────────────────
      const row1 = byFilename.get(hashCollisionFilename);
      expect(row1, 'hash-collision row missing from analysis').toBeTruthy();
      expect(row1!.dedupVerdict.isDuplicate).toBe(true);
      expect(row1!.dedupVerdict.existingId).toBe(seedHashMatch.id);
      // `existingTitle` is the seeded item's title (with the test prefix).
      expect(row1!.dedupVerdict.existingTitle).toContain(TEST_PREFIX);
      expect(row1!.sourceFileMatch).toBeNull();
      expect(row1!.empty).toBe(false);
      expect(row1!.contentHash).toMatch(/^[0-9a-f]{32}$/);

      // ─────────────────────────────────────────────────────────────────
      // Row 2 — unique: dedupVerdict.isDuplicate=false (no existing*);
      // sourceFileMatch=null.
      // ─────────────────────────────────────────────────────────────────
      const row2 = byFilename.get(uniqueFilename);
      expect(row2, 'unique row missing from analysis').toBeTruthy();
      expect(row2!.dedupVerdict.isDuplicate).toBe(false);
      expect(row2!.dedupVerdict.existingId).toBeUndefined();
      expect(row2!.dedupVerdict.existingTitle).toBeUndefined();
      expect(row2!.sourceFileMatch).toBeNull();
      expect(row2!.empty).toBe(false);

      // ─────────────────────────────────────────────────────────────────
      // Row 3 — filename collision: dedupVerdict.isDuplicate=false (different
      // hash from seed 2); sourceFileMatch.id=seed2.id (filename match
      // surfaces independently of content match).
      // ─────────────────────────────────────────────────────────────────
      const row3 = byFilename.get(collidingFilename);
      expect(row3, 'filename-collision row missing from analysis').toBeTruthy();
      expect(row3!.dedupVerdict.isDuplicate).toBe(false);
      expect(row3!.sourceFileMatch).not.toBeNull();
      expect(row3!.sourceFileMatch!.id).toBe(seedFilenameMatch.id);
      expect(row3!.sourceFileMatch!.title).toContain(TEST_PREFIX);
    }, 60_000);
  },
);
