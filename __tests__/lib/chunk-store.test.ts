import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MAX_EMBEDDING_CHARS } from '@/lib/ai/embed';
import type { ContentChunk } from '@/lib/content/chunking';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mockGenerateEmbedding = vi.hoisted(() => vi.fn());
const mockLogBestEffortWarn = vi.hoisted(() => vi.fn());

vi.mock('@/lib/ai/embed', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/embed')>();
  return {
    ...actual,
    generateEmbedding: (...args: unknown[]) => mockGenerateEmbedding(...args),
  };
});

vi.mock('@/lib/supabase/telemetry', () => ({
  logBestEffortWarn: (...args: unknown[]) => mockLogBestEffortWarn(...args),
  logSwallowedError: vi.fn(),
}));

// Import AFTER mocks are declared so the SUT picks up the mocked module.
const {
  buildChunkEmbeddingText,
  generateChunkEmbeddings,
  storeChunks,
  regenerateChunks,
} = await import('@/lib/content/chunk-store');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function chunk(overrides: Partial<ContentChunk> = {}): ContentChunk {
  return {
    heading_text: 'Risk Assessment',
    heading_level: 2,
    heading_path: ['H&S', 'Risk Assessment'],
    content: '## Risk Assessment\n\nSome body text goes here.',
    position: 0,
    parent_position: null,
    char_count: 0,
    word_count: 0,
    ...overrides,
  };
}

const FAKE_EMBEDDING = Array.from({ length: 1024 }, (_, i) => i / 1024);
const CONTENT_ITEM_ID = '11111111-1111-4111-8111-111111111111';

// ---------------------------------------------------------------------------
// buildChunkEmbeddingText
// ---------------------------------------------------------------------------

describe('buildChunkEmbeddingText', () => {
  it('prefixes heading_path joined by " > " with double newline', () => {
    const c = chunk({
      heading_path: ['H&S', 'Risk'],
      content: '## Risk\n\nBody.',
    });
    expect(buildChunkEmbeddingText(c)).toBe('H&S > Risk\n\n## Risk\n\nBody.');
  });

  it('omits prefix when heading_path is empty', () => {
    const c = chunk({ heading_path: [], content: 'Bare content.' });
    expect(buildChunkEmbeddingText(c)).toBe('Bare content.');
  });

  it('truncates content longer than MAX_EMBEDDING_CHARS', () => {
    const longBody = 'x'.repeat(MAX_EMBEDDING_CHARS + 500);
    const c = chunk({ heading_path: ['A'], content: longBody });
    const result = buildChunkEmbeddingText(c);
    expect(result.length).toBe(MAX_EMBEDDING_CHARS);
    expect(result.startsWith('A\n\n')).toBe(true);
  });

  it('does not pad short content', () => {
    const c = chunk({ heading_path: ['A'], content: 'short' });
    const result = buildChunkEmbeddingText(c);
    expect(result).toBe('A\n\nshort');
    expect(result.length).toBeLessThan(MAX_EMBEDDING_CHARS);
  });
});

// ---------------------------------------------------------------------------
// generateChunkEmbeddings — per-chunk failure isolation
// ---------------------------------------------------------------------------

describe('generateChunkEmbeddings', () => {
  beforeEach(() => {
    mockGenerateEmbedding.mockReset();
    mockLogBestEffortWarn.mockReset();
  });

  it('attaches embeddings to all chunks on success', async () => {
    mockGenerateEmbedding.mockResolvedValue(FAKE_EMBEDDING);

    const chunks = [
      chunk({ position: 0, heading_text: 'A' }),
      chunk({ position: 1, heading_text: 'B' }),
    ];
    const result = await generateChunkEmbeddings(chunks);

    expect(result).toHaveLength(2);
    expect(result[0].embedding).toEqual(FAKE_EMBEDDING);
    expect(result[1].embedding).toEqual(FAKE_EMBEDDING);
    expect(mockGenerateEmbedding).toHaveBeenCalledTimes(2);
    expect(mockLogBestEffortWarn).not.toHaveBeenCalled();
  });

  it('isolates per-chunk failures: one fails, others succeed', async () => {
    // First call rejects, second and third resolve.
    mockGenerateEmbedding
      .mockRejectedValueOnce(new Error('rate limited'))
      .mockResolvedValueOnce(FAKE_EMBEDDING)
      .mockResolvedValueOnce(FAKE_EMBEDDING);

    const chunks = [
      chunk({ position: 0, heading_text: 'Fails' }),
      chunk({ position: 1, heading_text: 'OK1' }),
      chunk({ position: 2, heading_text: 'OK2' }),
    ];
    const result = await generateChunkEmbeddings(chunks);

    expect(result).toHaveLength(3);
    expect(result[0].embedding).toBeNull();
    expect(result[1].embedding).toEqual(FAKE_EMBEDDING);
    expect(result[2].embedding).toEqual(FAKE_EMBEDDING);

    // Best-effort warning must fire for the failed chunk and only that one.
    expect(mockLogBestEffortWarn).toHaveBeenCalledTimes(1);
    const [category, message, context] = mockLogBestEffortWarn.mock.calls[0];
    expect(category).toBe('content.chunks.embedding');
    expect(message).toMatch(/Failed to generate embedding/);
    expect(context).toMatchObject({ position: 0, heading_text: 'Fails' });
  });

  it('returns empty array for empty input without calling embed', async () => {
    const result = await generateChunkEmbeddings([]);
    expect(result).toEqual([]);
    expect(mockGenerateEmbedding).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// storeChunks — inserts with vector serialisation + parent resolution
// ---------------------------------------------------------------------------

/**
 * Build a controllable Supabase stand-in for the chunk-store tests.
 *
 * `createMockSupabaseClient` from the shared helper is optimised for single
 * chained awaits with a pre-configured terminator. The chunk-store makes
 * several distinct round-trips (insert+select, update+eq+select, delete+eq
 * +select, etc.) and we want to assert against each one individually, so we
 * build a bespoke recording stub here.
 */
interface CallRecord {
  table: string;
  op: 'insert' | 'update' | 'delete' | 'select';
  payload?: unknown;
  filters?: Record<string, unknown>;
}

function makeRecordingSupabase(
  options: {
    insertResponse?: { data: unknown; error: unknown };
    updateResponse?: { data: unknown; error: unknown };
    deleteResponse?: { data: unknown; error: unknown };
  } = {},
) {
  const calls: CallRecord[] = [];
  const insertResponse = options.insertResponse ?? {
    data: [{ id: 'uuid-0', position: 0 }],
    error: null,
  };
  const updateResponse = options.updateResponse ?? {
    data: [{ id: 'uuid-0' }],
    error: null,
  };
  const deleteResponse = options.deleteResponse ?? {
    data: [],
    error: null,
  };

  function builder(table: string) {
    const chain: Record<string, unknown> & {
      then: (resolve: (v: unknown) => void) => void;
    } = {
      _table: table,
      _op: null as CallRecord['op'] | null,
      _payload: undefined as unknown,
      _filters: {} as Record<string, unknown>,
      _response: { data: null, error: null } as {
        data: unknown;
        error: unknown;
      },
      insert(payload: unknown) {
        this._op = 'insert';
        this._payload = payload;
        this._response = insertResponse;
        return this;
      },
      update(payload: unknown) {
        this._op = 'update';
        this._payload = payload;
        this._response = updateResponse;
        return this;
      },
      delete() {
        this._op = 'delete';
        this._response = deleteResponse;
        return this;
      },
      select() {
        // .select() after insert/update/delete is a no-op for mocks; we
        // already have the response attached. Behaviour matches PostgREST:
        // the chain stays awaitable.
        return this;
      },
      eq(column: string, value: unknown) {
        (this._filters as Record<string, unknown>)[column] = value;
        return this;
      },
      then(resolve: (v: unknown) => void) {
        calls.push({
          table: this._table as string,
          op: this._op as CallRecord['op'],
          payload: this._payload,
          filters: { ...(this._filters as Record<string, unknown>) },
        });
        resolve(this._response);
      },
    };
    return chain;
  }

  return {
    from: vi.fn((table: string) => builder(table)),
    rpc: vi.fn(),
    calls,
  };
}

describe('storeChunks', () => {
  beforeEach(() => {
    mockGenerateEmbedding.mockReset();
    mockLogBestEffortWarn.mockReset();
  });

  it('returns early for empty input without hitting the database', async () => {
    const sb = makeRecordingSupabase();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await storeChunks(sb as any, CONTENT_ITEM_ID, []);
    expect(result).toEqual({ stored: 0, errors: [] });
    expect(sb.from).not.toHaveBeenCalled();
  });

  it('JSON-serialises embeddings for the vector column', async () => {
    const sb = makeRecordingSupabase({
      insertResponse: {
        data: [{ id: 'uuid-0', position: 0 }],
        error: null,
      },
    });
    const chunks = [
      {
        ...chunk({ position: 0, heading_path: ['A'] }),
        embedding: FAKE_EMBEDDING,
      },
    ];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await storeChunks(sb as any, CONTENT_ITEM_ID, chunks);
    expect(result.stored).toBe(1);
    expect(result.errors).toEqual([]);

    const insertCall = sb.calls.find((c) => c.op === 'insert');
    expect(insertCall).toBeDefined();
    const payload = insertCall!.payload as Array<{ embedding: string | null }>;
    expect(typeof payload[0].embedding).toBe('string');
    expect(JSON.parse(payload[0].embedding!)).toEqual(FAKE_EMBEDDING);
  });

  it('passes null embedding through when chunk has no vector', async () => {
    const sb = makeRecordingSupabase({
      insertResponse: {
        data: [{ id: 'uuid-0', position: 0 }],
        error: null,
      },
    });
    const chunks = [
      { ...chunk({ position: 0 }), embedding: null as number[] | null },
    ];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await storeChunks(sb as any, CONTENT_ITEM_ID, chunks);
    const insertCall = sb.calls.find((c) => c.op === 'insert');
    const payload = insertCall!.payload as Array<{ embedding: string | null }>;
    expect(payload[0].embedding).toBeNull();
  });

  it('resolves parent_chunk_id after insert via position-to-UUID map', async () => {
    // Two chunks: position 0 (parent) and position 1 (child pointing at 0).
    // Insert response maps them to real UUIDs, then the follow-up update
    // sets the child's parent_chunk_id.
    const sb = makeRecordingSupabase({
      insertResponse: {
        data: [
          { id: 'uuid-parent', position: 0 },
          { id: 'uuid-child', position: 1 },
        ],
        error: null,
      },
    });

    const chunks = [
      { ...chunk({ position: 0, parent_position: null }), embedding: null },
      { ...chunk({ position: 1, parent_position: 0 }), embedding: null },
    ];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await storeChunks(sb as any, CONTENT_ITEM_ID, chunks);
    expect(result.stored).toBe(2);
    expect(result.errors).toEqual([]);

    // Exactly one update must fire, targeting the child and setting
    // parent_chunk_id to the parent UUID.
    const updates = sb.calls.filter((c) => c.op === 'update');
    expect(updates).toHaveLength(1);
    const update = updates[0];
    expect(update.filters).toEqual({ id: 'uuid-child' });
    expect(update.payload).toEqual({ parent_chunk_id: 'uuid-parent' });
  });

  it('records an error and returns stored=0 when insert fails', async () => {
    const sb = makeRecordingSupabase({
      insertResponse: {
        data: null,
        error: { message: 'RLS denied', code: '42501', details: '', hint: '' },
      },
    });

    const chunks = [{ ...chunk({ position: 0 }), embedding: null }];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await storeChunks(sb as any, CONTENT_ITEM_ID, chunks);
    expect(result.stored).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/Chunk insert failed/);
    expect(result.errors[0]).toMatch(/RLS denied/);
  });
});

// ---------------------------------------------------------------------------
// regenerateChunks — delete then insert order
// ---------------------------------------------------------------------------

describe('regenerateChunks', () => {
  beforeEach(() => {
    mockGenerateEmbedding.mockReset();
    mockLogBestEffortWarn.mockReset();
    mockGenerateEmbedding.mockResolvedValue(FAKE_EMBEDDING);
  });

  it('deletes existing chunks before inserting new ones (order matters)', async () => {
    const sb = makeRecordingSupabase({
      insertResponse: {
        data: [{ id: 'uuid-0', position: 0 }],
        error: null,
      },
      deleteResponse: {
        data: [],
        error: null,
      },
    });

    // Short markdown => single chunk via chunkByHeadings => one insert.
    const md = 'Just a short body with no headings.';

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await regenerateChunks(sb as any, CONTENT_ITEM_ID, md);

    expect(result.errors).toEqual([]);
    expect(result.stored).toBe(1);

    // Assert delete came before any insert in the recorded call log.
    const opsInOrder = sb.calls.map((c) => c.op);
    const firstDelete = opsInOrder.indexOf('delete');
    const firstInsert = opsInOrder.indexOf('insert');
    expect(firstDelete).toBeGreaterThanOrEqual(0);
    expect(firstInsert).toBeGreaterThan(firstDelete);

    // Delete must be filtered by content_item_id.
    const deleteCall = sb.calls.find((c) => c.op === 'delete');
    expect(deleteCall!.filters).toEqual({
      content_item_id: CONTENT_ITEM_ID,
    });
  });

  it('returns early with an error when the delete step fails', async () => {
    const sb = makeRecordingSupabase({
      deleteResponse: {
        data: null,
        error: {
          message: 'permission denied',
          code: '42501',
          details: '',
          hint: '',
        },
      },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await regenerateChunks(sb as any, CONTENT_ITEM_ID, 'body');

    expect(result.stored).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/Failed to delete existing chunks/);
    expect(result.errors[0]).toMatch(/permission denied/);

    // Insert must not have been attempted.
    expect(sb.calls.some((c) => c.op === 'insert')).toBe(false);
  });

  it('returns stored=0 errors=[] when markdown produces no chunks', async () => {
    const sb = makeRecordingSupabase();

    // Whitespace-only markdown -> chunkByHeadings returns []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await regenerateChunks(sb as any, CONTENT_ITEM_ID, '   ');
    expect(result).toEqual({ stored: 0, errors: [] });

    // Delete ran (so stale chunks are cleared), but no insert.
    expect(sb.calls.some((c) => c.op === 'delete')).toBe(true);
    expect(sb.calls.some((c) => c.op === 'insert')).toBe(false);
  });
});
