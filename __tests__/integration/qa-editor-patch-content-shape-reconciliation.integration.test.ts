/**
 * Q&A editor (§1.5) WP7 — AC4c + AC5 integration coverage.
 *
 * Verifies that the PATCH handler's Q&A content rebuild produces the
 * canonical shape `Q: {question}\n\n{answer_standard}\n\n{answer_advanced}`
 * for an importer-shaped item (Sub-case A), gracefully omits the leading
 * `Q: ` prefix when the existing content has no Q-line (Sub-case B), and
 * does not mutate non-targeted columns on a single-field PATCH (AC5
 * regression guard, Sub-case C).
 *
 * Spec: docs/specs/qa-contenteditor-upgrade-spec.md §4.1 (AC4c)
 * and §3.3 (AC5)
 * Plan: docs/plans/qa-contenteditor-upgrade-plan.md WP7 (Wave 3)
 *
 * Implementation reference for the rebuild semantics:
 *   - app/api/items/[id]/route.ts lines 289–322 (rebuilt content)
 *   - lib/bid-library-ingest/resolve-question.ts (Q-line vs title fallback)
 *
 * Prereqs:
 *   - .env with NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
 *     SUPABASE_SECRET_KEY, TEST_USER_{1,2,3}_PASSWORD
 *   - `bun run seed:e2e-users` has been run against the target DB
 *
 * Run: `bun run test:integration __tests__/integration/qa-editor-patch-content-shape-reconciliation`
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
import { cleanupItem, seedQaPairItem } from './helpers/qa-editor-fixtures';

// ---------------------------------------------------------------------------
// Mock next/headers (see admin-users.integration.test.ts for the pattern).
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

const { PATCH: patchItem } = await import('@/app/api/items/[id]/route');
import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEST_PREFIX = `[QA-WP7-AC4c-${Date.now()}]`;

const QUESTION_TEXT = 'How do you handle data subject access requests?';
const STANDARD_ANSWER =
  'We respond to DSARs within the statutory 30-day window, applying the ' +
  'identity-verification + redaction workflow documented in our DPA SOP. ' +
  'The intake form lives in our compliance portal and routes to the DPO.';
const ADVANCED_ANSWER =
  'Operationally we triage DSARs through Zendesk with macros for the ' +
  'standard tracks (verification request, scope clarification, third-party ' +
  'redaction notice). Each closed ticket is double-keyed against the GDPR ' +
  'Article 15 checklist before release. Average end-to-end time over the ' +
  'last 12 months is 18 calendar days.';

const CANONICAL_CONTENT = `Q: ${QUESTION_TEXT}\n\n${STANDARD_ANSWER}\n\n${ADVANCED_ANSWER}`;

// Sub-case B fixture: importer-shaped content with no leading `Q: `
// line. The PATCH rebuild's `resolveQuestionForRebuild` returns the
// title fallback; with an empty title the join omits the prefix.
const NO_QPREFIX_CONTENT = `${STANDARD_ANSWER}\n\n${ADVANCED_ANSWER}`;

// Tracked for guaranteed afterAll cleanup.
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
  restoreSession(authCookies, cachedSessions, 'admin');
});

afterAll(async () => {
  for (const id of createdItemIds) {
    await cleanupItem(id);
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Whitespace-normalised string compare per AC4c. Collapses internal
 * runs of whitespace and trims leading/trailing whitespace; preserves
 * the exact ordering of non-whitespace characters. Use this to assert
 * the canonical Q&A shape survives the PATCH rebuild.
 */
function normaliseWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Q&A editor — PATCH content-shape reconciliation (AC4c + AC5)', () => {
  it(
    'Sub-case A: importer-shaped item retains the `Q:` prefix and `\\n\\n` join after a no-op edit',
    async () => {
      const seeded = await seedQaPairItem({
        title: `${TEST_PREFIX} ${QUESTION_TEXT}`,
        content: CANONICAL_CONTENT,
        answer_standard: STANDARD_ANSWER,
        answer_advanced: ADVANCED_ANSWER,
        created_by: TEST_USER_1_ID,
      });
      createdItemIds.push(seeded.id);

      // PATCH with the same answer_standard value (no-op semantically).
      const patchReq = new NextRequest(
        `http://localhost/api/items/${seeded.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            field: 'answer_standard',
            value: STANDARD_ANSWER,
          }),
          headers: { 'content-type': 'application/json' },
        },
      );
      const patchRes = await patchItem(patchReq, {
        params: Promise.resolve({ id: seeded.id }),
      });
      expect(patchRes.status, await patchRes.clone().text()).toBe(200);

      const { data: refreshed, error } = await serviceClient
        .from('content_items')
        .select('content, answer_standard, answer_advanced')
        .eq('id', seeded.id)
        .single();
      expect(error).toBeNull();
      expect(refreshed).toBeTruthy();

      // AC4c hard assertion: rebuilt content matches the canonical
      // shape character-for-character (whitespace-normalised). If this
      // fails, the leading `Q:` prefix has been dropped or the
      // `\n\n` join has been replaced by a different separator.
      expect(normaliseWhitespace(refreshed!.content)).toBe(
        normaliseWhitespace(CANONICAL_CONTENT),
      );
      // Also assert raw equality to catch silent whitespace drift
      // (informational — the AC explicitly normalises whitespace, but
      // raw equality on a no-op edit means the rebuild is fully
      // round-trip stable).
      expect(refreshed!.content).toBe(CANONICAL_CONTENT);
      expect(refreshed!.answer_standard).toBe(STANDARD_ANSWER);
      expect(refreshed!.answer_advanced).toBe(ADVANCED_ANSWER);
    },
    60_000,
  );

  it(
    'Sub-case B: NULL question (no leading Q-line) — `Q:` prefix is omitted, no stray `Q: \\n\\n` stub',
    async () => {
      // Seed with content that does NOT begin with `Q: ` and a title
      // that should not be promoted to a fake question — the resolver
      // returns the title verbatim, but the spec says the join uses
      // `if (question) parts.push(...)` so an empty question omits the
      // prefix. To force the empty-question branch, we use a title
      // that is empty after trim — except the PATCH `currentItem.title`
      // is sourced from the row's `title` column. The cleanest way to
      // exercise the empty-question branch is to seed with `title: ''`.
      // The schema enforces title > 0 chars on the API write boundary
      // BUT the DB column accepts empty strings on direct INSERT. Use
      // the service client to seed.
      const seeded = await seedQaPairItem({
        title: '',
        content: NO_QPREFIX_CONTENT,
        answer_standard: STANDARD_ANSWER,
        answer_advanced: ADVANCED_ANSWER,
        created_by: TEST_USER_1_ID,
      });
      createdItemIds.push(seeded.id);

      const patchReq = new NextRequest(
        `http://localhost/api/items/${seeded.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            field: 'answer_standard',
            value: STANDARD_ANSWER,
          }),
          headers: { 'content-type': 'application/json' },
        },
      );
      const patchRes = await patchItem(patchReq, {
        params: Promise.resolve({ id: seeded.id }),
      });
      expect(patchRes.status, await patchRes.clone().text()).toBe(200);

      const { data: refreshed, error } = await serviceClient
        .from('content_items')
        .select('content')
        .eq('id', seeded.id)
        .single();
      expect(error).toBeNull();
      expect(refreshed).toBeTruthy();

      // The hard assertion: NO `Q: ` prefix in the rebuilt content,
      // because the leading-Q-line resolver returned `''` and the
      // route's `if (question) parts.push(`Q: ${question}`)` branch
      // skipped the prefix. Equivalently, the rebuilt content is the
      // pure `<standard>\n\n<advanced>` form.
      expect(refreshed!.content.startsWith('Q:')).toBe(false);
      // Crucially: no stray `Q: \n\n` stub at the head of the content.
      expect(refreshed!.content).not.toMatch(/^Q:\s*\n/);
      // Whitespace-normalised equality with the no-prefix canonical
      // form proves the join order + separator are correct.
      expect(normaliseWhitespace(refreshed!.content)).toBe(
        normaliseWhitespace(NO_QPREFIX_CONTENT),
      );
    },
    60_000,
  );

  it(
    'Sub-case C (AC5): saving updates only the targeted field — `title` and `priority` are unmodified',
    async () => {
      const originalTitle = `${TEST_PREFIX} Sub-case C — original title`;
      const originalPriority = 'high';
      const seeded = await seedQaPairItem({
        title: originalTitle,
        content: CANONICAL_CONTENT,
        answer_standard: STANDARD_ANSWER,
        answer_advanced: ADVANCED_ANSWER,
        created_by: TEST_USER_1_ID,
        priority: originalPriority,
      });
      createdItemIds.push(seeded.id);

      // Confirm the seed actually persisted the priority we asked for
      // before we exercise the PATCH (a stale fixture would hide the
      // regression we are guarding against).
      const { data: pre, error: preErr } = await serviceClient
        .from('content_items')
        .select('title, priority')
        .eq('id', seeded.id)
        .single();
      expect(preErr).toBeNull();
      expect(pre!.title).toBe(originalTitle);
      expect(pre!.priority).toBe(originalPriority);

      const updatedAdvanced = `${ADVANCED_ANSWER}\n\nAddendum: edited by test C.`;
      const patchReq = new NextRequest(
        `http://localhost/api/items/${seeded.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            field: 'answer_advanced',
            value: updatedAdvanced,
          }),
          headers: { 'content-type': 'application/json' },
        },
      );
      const patchRes = await patchItem(patchReq, {
        params: Promise.resolve({ id: seeded.id }),
      });
      expect(patchRes.status, await patchRes.clone().text()).toBe(200);

      const { data: post, error: postErr } = await serviceClient
        .from('content_items')
        .select('title, priority, answer_advanced, answer_standard, content')
        .eq('id', seeded.id)
        .single();
      expect(postErr).toBeNull();
      expect(post).toBeTruthy();

      // AC5 hard assertions: non-targeted columns are unmodified.
      expect(post!.title).toBe(originalTitle);
      expect(post!.priority).toBe(originalPriority);
      // The targeted column reflects the new value.
      expect(post!.answer_advanced).toBe(updatedAdvanced);
      // The other answer column was NOT touched (still the seed value).
      expect(post!.answer_standard).toBe(STANDARD_ANSWER);
      // The rebuilt content carries the new advanced answer.
      expect(post!.content).toContain('Addendum: edited by test C.');
      // And still starts with the canonical Q-prefix.
      expect(post!.content.startsWith(`Q: ${QUESTION_TEXT}`)).toBe(true);
    },
    60_000,
  );
});
