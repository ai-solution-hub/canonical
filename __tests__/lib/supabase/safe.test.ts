import { describe, it, expect } from 'vitest';
import { sb, tryQuery, isOk, SupabaseError } from '@/lib/supabase/safe';

describe('sb()', () => {
  it('returns data on success', async () => {
    const query = Promise.resolve({
      data: [{ id: 1 }, { id: 2 }],
      error: null,
      count: null,
      status: 200,
      statusText: 'OK',
    });
    const rows = await sb(query);
    expect(rows).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it('throws SupabaseError on error', async () => {
    const query = Promise.resolve({
      data: null,
      error: {
        message: 'relation "nope" does not exist',
        code: '42P01',
        details: '',
        hint: '',
      },
      count: null,
      status: 500,
      statusText: 'Error',
    });
    await expect(sb(query, 'test.nope')).rejects.toBeInstanceOf(SupabaseError);
    await expect(sb(query, 'test.nope')).rejects.toMatchObject({
      code: '42P01',
      message: expect.stringContaining('[test.nope]'),
    });
  });

  it('preserves the PostgrestError via cause', async () => {
    const pgError = {
      message: 'x',
      code: 'PGRST116',
      details: '',
      hint: '',
    };
    const query = Promise.resolve({
      data: null,
      error: pgError,
      count: null,
      status: 406,
      statusText: '',
    });
    try {
      await sb(query);
    } catch (err) {
      expect((err as SupabaseError).cause).toBe(pgError);
    }
  });

  it('returns null for count-only queries (head: true) without throwing', async () => {
    // .select('*', { count: 'exact', head: true }) returns data: null on success.
    // The wrapper must NOT throw — null is the legitimate success value here.
    const query = Promise.resolve({
      data: null,
      error: null,
      count: 42,
      status: 200,
      statusText: 'OK',
    });
    const result = await sb(query);
    expect(result).toBeNull();
  });
});

describe('tryQuery()', () => {
  it('returns { ok: true, data } on success', async () => {
    const query = Promise.resolve({
      data: [{ id: 1 }],
      error: null,
      count: null,
      status: 200,
      statusText: 'OK',
    });
    const result = await tryQuery(query);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data).toEqual([{ id: 1 }]);
    }
  });

  it('returns { ok: false, error } on error', async () => {
    const query = Promise.resolve({
      data: null,
      error: { message: 'boom', code: '', details: '', hint: '' },
      count: null,
      status: 500,
      statusText: '',
    });
    const result = await tryQuery(query, 'test');
    expect(isOk(result)).toBe(false);
    if (!isOk(result)) {
      expect(result.error).toBeInstanceOf(SupabaseError);
    }
  });

  it('wraps thrown network errors as SupabaseError', async () => {
    const query = Promise.reject(new Error('fetch failed'));
    const result = await tryQuery(
      query as unknown as Promise<{
        data: null;
        error: null;
        count: null;
        status: number;
        statusText: string;
      }>,
      'test',
    );
    if (!isOk(result)) {
      expect(result.error.code).toBe('NETWORK_ERROR');
      expect(result.error.message).toContain('fetch failed');
    }
  });
});
