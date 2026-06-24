import { describe, it, expect } from 'vitest';
import {
  seedFeed,
  requireFeedWorkspaceId,
  FEED_WORKSPACE_NAME,
  FEED_ARTICLE_SEED,
  FEED_SOURCE_SEED,
  type FeedSeedResult,
} from '../../scripts/seed-platform-feed';
import type { SeedDbClient } from '../../scripts/seed-platform-workspaces';

/**
 * Behaviour tests for the ID-127.3 (BI-4) Platform feed seed.
 *
 * Asserts the seed's user-observable contract against a recording Supabase
 * double (no live DB): seeds in strict FK order (feed_sources before
 * feed_articles); the article is `passed = true` with NOT-NULL FKs satisfied
 * and a real public URL; re-seed converges; fails loud when the procurement
 * workspace (BI-8 dependency) is absent.
 *
 * Test philosophy: behaviour, not implementation.
 */

// ---------------------------------------------------------------------------
// Recording Supabase double. Supports the feed seed's verbs:
//   select().eq(...).eq(...).maybeSingle()  (workspace + feed lookups)
//   insert().select().single()              (feed_sources / feed_articles writes)
// Per-table read/insert queues let a re-run see prior "writes".
// ---------------------------------------------------------------------------
interface Recorded {
  table: string;
  verb: 'select' | 'insert';
  payload?: unknown;
}

type Resp = { data: unknown; error: unknown };

interface TableState {
  reads: Resp[];
  inserts: Resp[];
}

function makeClient(tables: Record<string, Partial<TableState>>): {
  client: SeedDbClient;
  recorded: Recorded[];
  inserted: Record<string, unknown[]>;
} {
  const recorded: Recorded[] = [];
  const inserted: Record<string, unknown[]> = {};
  const state: Record<string, TableState> = {};
  for (const [t, s] of Object.entries(tables)) {
    state[t] = { reads: [...(s.reads ?? [])], inserts: [...(s.inserts ?? [])] };
  }
  const nextRead = (t: string): Resp =>
    state[t]?.reads.shift() ?? { data: null, error: null };
  const nextInsert = (t: string): Resp =>
    state[t]?.inserts.shift() ?? { data: { id: `ins-${t}` }, error: null };

  function from(table: string) {
    return {
      select() {
        recorded.push({ table, verb: 'select' });
        const terminal = {
          in: () => Promise.resolve(nextRead(table)),
          eq: () => terminal,
          maybeSingle: () => Promise.resolve(nextRead(table)),
          then: (resolve: (v: Resp) => unknown) =>
            Promise.resolve(resolve(nextRead(table))),
        };
        return terminal;
      },
      insert(payload: unknown) {
        recorded.push({ table, verb: 'insert', payload });
        (inserted[table] ??= []).push(payload);
        return {
          select: () => ({
            single: () => Promise.resolve(nextInsert(table)),
          }),
        };
      },
    };
  }

  return { client: { from } as unknown as SeedDbClient, recorded, inserted };
}

const WORKSPACE_ID = 'ws-procurement';

/** Tables wired so the workspace exists and both feed rows are absent (fresh seed). */
function freshSeedTables(): Record<string, Partial<TableState>> {
  return {
    workspaces: { reads: [{ data: { id: WORKSPACE_ID }, error: null }] },
    feed_sources: {
      reads: [{ data: null, error: null }],
      inserts: [{ data: { id: 'fs-1' }, error: null }],
    },
    feed_articles: {
      reads: [{ data: null, error: null }],
      inserts: [{ data: { id: 'fa-1' }, error: null }],
    },
  };
}

// ---------------------------------------------------------------------------

describe('requireFeedWorkspaceId — the BI-8 workspace is a prerequisite', () => {
  it('fails loud when the procurement workspace is absent', async () => {
    const { client } = makeClient({
      workspaces: { reads: [{ data: null, error: null }] },
    });
    await expect(requireFeedWorkspaceId(client)).rejects.toThrow(
      new RegExp(FEED_WORKSPACE_NAME),
    );
  });

  it('resolves the workspace id when present', async () => {
    const { client } = makeClient({
      workspaces: { reads: [{ data: { id: WORKSPACE_ID }, error: null }] },
    });
    await expect(requireFeedWorkspaceId(client)).resolves.toBe(WORKSPACE_ID);
  });
});

describe('seedFeed — seeds the feed slice in FK order', () => {
  it('inserts feed_sources before feed_articles', async () => {
    const { client, recorded } = makeClient(freshSeedTables());

    await seedFeed(client, false);

    const insertOrder = recorded
      .filter((r) => r.verb === 'insert')
      .map((r) => r.table);
    expect(insertOrder).toEqual(['feed_sources', 'feed_articles']);
  });

  it('marks the seeded article passed = true with NOT-NULL FKs satisfied', async () => {
    const { client, inserted } = makeClient(freshSeedTables());

    await seedFeed(client, false);

    const article = (inserted.feed_articles ?? [])[0] as Record<
      string,
      unknown
    >;
    expect(article.passed).toBe(true);
    expect(article.workspace_id).toBe(WORKSPACE_ID); // NOT NULL FK
    expect(article.feed_source_id).toBe('fs-1'); // NOT NULL FK → seeded source
    // a real public URL so a later /extract produces real content
    expect(String(article.external_url)).toMatch(/^https?:\/\//);
    expect(article.external_url).toBe(FEED_ARTICLE_SEED.externalUrl);
  });

  it('attaches the feed_source to the procurement workspace', async () => {
    const { client, inserted } = makeClient(freshSeedTables());

    await seedFeed(client, false);

    const source = (inserted.feed_sources ?? [])[0] as Record<string, unknown>;
    expect(source.workspace_id).toBe(WORKSPACE_ID);
    expect(source.url).toBe(FEED_SOURCE_SEED.url);
  });

  it('reports created actions for both rows on a fresh seed', async () => {
    const { client } = makeClient(freshSeedTables());

    const result: FeedSeedResult = await seedFeed(client, false);

    expect(result.workspaceId).toBe(WORKSPACE_ID);
    expect(result.rows.map((r) => r.table)).toEqual([
      'feed_sources',
      'feed_articles',
    ]);
    expect(result.rows.every((r) => r.action === 'created')).toBe(true);
  });

  it('re-seed converges: neither row is created twice', async () => {
    const { client, inserted } = makeClient({
      workspaces: { reads: [{ data: { id: WORKSPACE_ID }, error: null }] },
      feed_sources: { reads: [{ data: { id: 'fs-1' }, error: null }] },
      feed_articles: { reads: [{ data: { id: 'fa-1' }, error: null }] },
    });

    const result = await seedFeed(client, false);

    expect(result.rows.every((r) => r.action === 'already-exists')).toBe(true);
    expect(inserted.feed_sources).toBeUndefined();
    expect(inserted.feed_articles).toBeUndefined();
  });

  it('dry-run plans both rows but performs no write', async () => {
    const { client, inserted } = makeClient({
      workspaces: { reads: [{ data: { id: WORKSPACE_ID }, error: null }] },
      feed_sources: { reads: [{ data: null, error: null }] },
      feed_articles: { reads: [{ data: null, error: null }] },
    });

    const result = await seedFeed(client, true);

    expect(result.rows.every((r) => r.action === 'would-create')).toBe(true);
    expect(inserted.feed_sources).toBeUndefined();
    expect(inserted.feed_articles).toBeUndefined();
  });

  it('fails loud (no write) when the workspace dependency is absent', async () => {
    const { client, inserted } = makeClient({
      workspaces: { reads: [{ data: null, error: null }] },
    });

    await expect(seedFeed(client, false)).rejects.toThrow(
      new RegExp(FEED_WORKSPACE_NAME),
    );
    expect(inserted.feed_sources).toBeUndefined();
    expect(inserted.feed_articles).toBeUndefined();
  });
});
