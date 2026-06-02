/**
 * Q&A editor (§1.5) WP7 — AC9b integration coverage.
 *
 * PATCH again with `regenerate_embedding: true` and assert the
 * item-level `content_items.embedding` vector changed (AC9b). The
 * pre-change vector is read BEFORE the PATCH so the comparison is
 * race-free.
 *
 * Spec: docs/specs/qa-contenteditor-upgrade-spec.md AC9b
 * Plan: docs/plans/qa-contenteditor-upgrade-plan.md WP7 (Wave 3)
 *
 * Prereqs:
 *   - .env with NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
 *     SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY, TEST_USER_{1,2,3}_PASSWORD
 *   - `bun run seed:e2e-users` has been run against the target DB
 *
 * Run: `bun run test:integration __tests__/integration/qa-editor-chunk-parity-and-regen`
 *
 * @vitest-environment node
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  beforeEach,
  afterAll,
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
import { generateEmbedding } from '@/lib/ai/embed';
import { cleanupItem, seedQaPairItem } from './helpers/qa-editor-fixtures';

// ---------------------------------------------------------------------------
// Mock next/headers (see admin-users.integration.test.ts for the pattern).
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

const { PATCH: patchItem } = await import('@/app/api/items/[id]/route');
import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Constants & fixtures
// ---------------------------------------------------------------------------

const TEST_PREFIX = `[QA-WP7-CHUNK-${Date.now()}]`;

const QUESTION_TEXT = 'What is your incident response process?';

// Rich markdown answer used as the regen-PATCH baseline body. Layout:
//   - Lead paragraph
//   - H2 "Severity matrix" + GFM table (2 columns × 3 data rows)
//   - H2 "Escalation steps" + bold + bullet list
const RICH_STANDARD = `Our incident response process is documented end-to-end and rehearsed quarterly. The full runbook lives in the SOC wiki and is referenced from the on-call handbook. The summary below extracts the operational shape.

## Severity matrix

| Severity | Response time |
| --- | --- |
| P1 | 15 minutes |
| P2 | 1 hour |
| P3 | 4 hours |

## Escalation steps

The on-call engineer triages **first**, then the following sequence runs:

- Page the incident commander
- Open the war-room channel
- Notify the customer-comms lead
`;

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
// Test
// ---------------------------------------------------------------------------

describe('Q&A editor — regenerate_embedding flag (AC9b)', () => {
  it('second PATCH with regenerate_embedding=true changes content_items.embedding', async () => {
    // Seed with content rich enough that an embedding is meaningful.
    const seedContent = `Q: ${QUESTION_TEXT}\n\n${RICH_STANDARD}`;
    const seeded = await seedQaPairItem({
      title: `${TEST_PREFIX} regen-${Date.now()} ${QUESTION_TEXT}`,
      content: seedContent,
      answer_standard: RICH_STANDARD,
      answer_advanced: null,
      created_by: TEST_USER_1_ID,
    });
    createdItemIds.push(seeded.id);

    // Pre-flight: write a known baseline embedding via the same
    // generateEmbedding() helper the route uses. This is the safest
    // way to capture a baseline without racing the route — we read
    // the value BEFORE the PATCH that is supposed to overwrite it.
    const baselineEmbedding = await generateEmbedding(
      `${seeded.title}\n\n${RICH_STANDARD}`,
    );
    const { error: baselineErr } = await serviceClient
      .from('content_items')
      .update({ embedding: JSON.stringify(baselineEmbedding) })
      .eq('id', seeded.id);
    expect(baselineErr).toBeNull();

    const { data: pre, error: preErr } = await serviceClient
      .from('content_items')
      .select('embedding')
      .eq('id', seeded.id)
      .single();
    expect(preErr).toBeNull();
    expect(pre!.embedding).toBeTruthy();
    const preEmbeddingString = pre!.embedding as unknown as string;

    // Now PATCH with a different answer_standard AND
    // regenerate_embedding=true. The route's regen branch fetches
    // the post-update content, calls generateEmbedding(title + body),
    // and overwrites the column. Use a substantially different body
    // so the regenerated vector cannot coincide with the baseline.
    const newStandard =
      RICH_STANDARD +
      '\n\n## Post-mortem cadence\n\nWe run blameless post-mortems within five business days of every P1 or P2 incident, with a Friday review for P3s rolled together. The action-tracker integrates with our weekly all-hands.';
    const patchReq = new NextRequest(
      `http://localhost/api/items/${seeded.id}`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          field: 'answer_standard',
          value: newStandard,
          regenerate_embedding: true,
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
      .select('embedding, answer_standard, content')
      .eq('id', seeded.id)
      .single();
    expect(postErr).toBeNull();
    expect(post).toBeTruthy();
    expect(post!.embedding).toBeTruthy();
    expect(post!.answer_standard).toBe(newStandard);
    // Sanity: rebuild took the new body.
    expect(post!.content).toContain('Post-mortem cadence');

    // AC9b hard assertion: the embedding string CHANGED. We compare
    // string-form rather than parsing back to vectors because
    // pgvector returns a stable canonical text form per row — equal
    // strings ⇔ equal vectors for our purposes.
    const postEmbeddingString = post!.embedding as unknown as string;
    expect(
      postEmbeddingString,
      'regenerate_embedding=true must change content_items.embedding (AC9b). ' +
        'If this asserts equal, either the regen branch did not fire or the ' +
        'post-PATCH embedding text was identical to the baseline.',
    ).not.toBe(preEmbeddingString);
  }, 240_000); // baseline embed + regenerate cycle calls the embedding API multiple times
});
