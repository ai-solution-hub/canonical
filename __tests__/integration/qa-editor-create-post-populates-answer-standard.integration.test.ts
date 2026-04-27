/**
 * Q&A editor (§1.5) WP7 — AC4b integration coverage.
 *
 * Asserts the create-content path alignment fixed in S192 / WP1 of this
 * spec: a Q&A item POSTed via `app/api/items/route.ts` populates
 * `answer_standard` so the first round-trip through the Q&A edit flow
 * cannot silently destroy the original content.
 *
 * Wave-3 brief: "POST a new q_a_pair item via the actual handler …
 * assert the persisted row has `answer_standard === content`. Then
 * trigger a PATCH with a non-empty edit and assert the item's `content`
 * is non-empty post-save (no silent destruction)."
 *
 * Spec: docs/specs/qa-contenteditor-upgrade-spec.md §4.1 (AC4b)
 * Plan:  docs/plans/qa-contenteditor-upgrade-plan.md WP7 (Wave 3)
 *
 * Prereqs:
 *   - .env with NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
 *     SUPABASE_SECRET_KEY, OPENAI_API_KEY, TEST_USER_{1,2,3}_PASSWORD
 *   - `bun run seed:e2e-users` has been run against the target DB
 *
 * Run: `bun run test:integration __tests__/integration/qa-editor-create-post-populates-answer-standard`
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';
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
import { cleanupItem } from './helpers/qa-editor-fixtures';

// ---------------------------------------------------------------------------
// Mock `next/headers` at file scope so the production `createClient()`
// path in the API route reads from the same in-memory cookie store the
// integration auth helper writes to. Per-role sessions cached in
// `cachedSessions` at `beforeAll` (3 sign-ins / file) to stay under the
// Supabase rate limit (see helpers/auth-session.ts).
// ---------------------------------------------------------------------------

const { authCookies, cachedSessions } = vi.hoisted(() => ({
  authCookies: new Map<string, { name: string; value: string }>() as AuthCookieStore,
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

// ---------------------------------------------------------------------------
// Import routes AFTER the mock is registered.
// ---------------------------------------------------------------------------

const { POST: createItemPost } = await import('@/app/api/items/route');
const { PATCH: patchItem } = await import('@/app/api/items/[id]/route');

import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEST_PREFIX = `[QA-WP7-AC4b-${Date.now()}]`;

// Items the test creates — tracked for guaranteed afterAll cleanup
// even when individual assertions fail.
const createdItemIds: string[] = [];

let TEST_USER_1_ID = '';

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeAll(async () => {
  TEST_USER_1_ID = await getTestUserId('admin');
  await cacheAllTestUserSessions(cachedSessions);
}, 30_000);

beforeEach(() => {
  // Both routes accept admin + editor — admin keeps the test
  // deterministic and matches the existing integration-test convention.
  restoreSession(authCookies, cachedSessions, 'admin');
});

afterAll(async () => {
  for (const id of createdItemIds) {
    await cleanupItem(id);
  }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Q&A editor — POST /api/items populates answer_standard (AC4b)', () => {
  it(
    'POST creates a q_a_pair with answer_standard === content; subsequent PATCH does not destroy content',
    async () => {
      // -------- Step 1: POST a new q_a_pair item -----------------------
      const createBody = {
        title: `${TEST_PREFIX} Sample question?`,
        content:
          'Q: Sample question?\n\nThe original creation answer is at least ' +
          'two hundred characters long so the WP1 length-ratio guard does ' +
          'not block the subsequent PATCH edit. This sentence pads the ' +
          'body comfortably above the 0.8 baseline-ratio threshold.',
        content_type: 'q_a_pair' as const,
        // Disable AI side-effects so the test is fast and deterministic
        // (the Q&A path under test is the storage shape of
        // answer_standard, not the AI pipeline).
        auto_classify: false,
        auto_summarise: false,
        auto_embed: false,
      };
      const createReq = new NextRequest('http://localhost/api/items', {
        method: 'POST',
        body: JSON.stringify(createBody),
        headers: { 'content-type': 'application/json' },
      });
      const createRes = await createItemPost(createReq);
      expect(createRes.status, await createRes.clone().text()).toBe(201);
      const createBodyJson = (await createRes.json()) as { id: string };
      expect(createBodyJson.id).toBeTruthy();
      createdItemIds.push(createBodyJson.id);
      const itemId = createBodyJson.id;

      // -------- Step 2: assert answer_standard === content -------------
      const { data: persisted, error: persistedErr } = await serviceClient
        .from('content_items')
        .select('content, answer_standard, answer_advanced, content_type')
        .eq('id', itemId)
        .single();
      expect(persistedErr).toBeNull();
      expect(persisted).toBeTruthy();
      expect(persisted!.content_type).toBe('q_a_pair');
      // Load-bearing AC4b assertion: the create-path alignment fix means
      // the freshly-created Q&A item has `answer_standard` populated to
      // exactly the same string as `content`. If this fails, the S192
      // creation-path bug has regressed and the next PATCH would silently
      // destroy the content body.
      expect(persisted!.answer_standard).toBe(persisted!.content);
      expect(persisted!.answer_standard).toBe(createBody.content);
      // Advanced is opt-in only; should be null on a fresh create.
      expect(persisted!.answer_advanced).toBeNull();

      // -------- Step 3: PATCH a non-empty edit to answer_standard -----
      const newAnswerStandard =
        'The edited answer is also intentionally long to stay above the ' +
        '0.8 baseline-ratio guard. A second sentence makes sure no save-' +
        'safety guard fires on this clean round-trip test.';
      const patchReq = new NextRequest(`http://localhost/api/items/${itemId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          field: 'answer_standard',
          value: newAnswerStandard,
        }),
        headers: { 'content-type': 'application/json' },
      });
      const patchRes = await patchItem(patchReq, {
        params: Promise.resolve({ id: itemId }),
      });
      expect(patchRes.status, await patchRes.clone().text()).toBe(200);

      // -------- Step 4: re-read & assert content is non-empty ----------
      const { data: postPatch, error: postPatchErr } = await serviceClient
        .from('content_items')
        .select('content, answer_standard, answer_advanced')
        .eq('id', itemId)
        .single();
      expect(postPatchErr).toBeNull();
      expect(postPatch).toBeTruthy();
      // Hard assertion: content must NOT be empty post-save. A regression
      // of the create-path alignment fix would leave answer_standard NULL
      // before the PATCH; the rebuild then writes
      // `Q: ...\n\n<new>\n\n<NULL>` filtered through `if (advanced)` —
      // which evaluates falsy and the join would produce just the new
      // text, NOT empty. But if the rebuild itself were bypassed, content
      // would still hold the OLD body. The strongest guard: assert
      // content includes the new edit AND is not empty.
      expect(postPatch!.content).toBeTruthy();
      expect(postPatch!.content.length).toBeGreaterThan(0);
      expect(postPatch!.content).toContain(newAnswerStandard);
      // answer_standard should reflect the new value.
      expect(postPatch!.answer_standard).toBe(newAnswerStandard);
      // Sanity: the rebuild kept the leading `Q: ` prefix because the
      // pre-edit content started with `Q: Sample question?`.
      expect(postPatch!.content.startsWith('Q: Sample question?')).toBe(true);
    },
    60_000,
  );

  it('refuses anonymous requests (regression guard for the auth wrapper)', async () => {
    authCookies.clear();
    const req = new NextRequest('http://localhost/api/items', {
      method: 'POST',
      body: JSON.stringify({
        title: `${TEST_PREFIX} Should never be created`,
        content: 'Q: x?\n\nbody body body body body body body body body body',
        content_type: 'q_a_pair',
      }),
      headers: { 'content-type': 'application/json' },
    });
    const res = await createItemPost(req);
    // The unauthenticated path returns 401 via authFailureResponse —
    // proves we are exercising the real auth wrapper (sweep-4 lesson:
    // mocked auth would silently succeed here).
    expect(res.status).toBe(401);
    // Belt-and-braces: TEST_USER_1_ID was resolved at beforeAll, so if
    // the test below fails in CI we know the issue is the auth helper,
    // not a missing seed.
    expect(TEST_USER_1_ID).not.toBe('');
  });
});
