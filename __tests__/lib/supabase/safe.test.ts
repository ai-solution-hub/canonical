import { describe, it, expect, expectTypeOf } from 'vitest';
import {
  sb,
  tryQuery,
  isOk,
  SupabaseError,
  asChecked,
} from '@/lib/supabase/safe';
import type { Checked } from '@/lib/supabase/safe';

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
    // Cast through unknown — narrow literal error shape lacks PostgrestError's
    // exact discriminant; semantically valid for the wrapper under test.
    const q = query as unknown as Parameters<typeof sb<null>>[0];
    await expect(sb(q, 'test.nope')).rejects.toBeInstanceOf(SupabaseError);
    await expect(sb(q, 'test.nope')).rejects.toMatchObject({
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
      await sb(query as unknown as Parameters<typeof sb<null>>[0]);
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
    const result = await tryQuery(
      query as unknown as Parameters<typeof tryQuery<null>>[0],
      'test',
    );
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

describe('Checked<T> brand', () => {
  it('asChecked brands a value', () => {
    const raw: number[] = [1, 2, 3];
    const branded = asChecked(raw);
    expectTypeOf(branded).toEqualTypeOf<Checked<number[]>>();
  });

  it('a function accepting Checked<T> rejects unbranded T', () => {
    function acceptBranded(_: Checked<number[]>): void {}
    const raw: number[] = [1];
    // @ts-expect-error — raw array is not branded
    acceptBranded(raw);
    acceptBranded(asChecked(raw)); // OK
  });
});
