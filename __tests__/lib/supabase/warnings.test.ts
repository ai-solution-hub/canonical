import { describe, it, expect } from 'vitest';
import {
  createWarningsCollector,
  warningsEnvelope,
} from '@/lib/supabase/warnings';

describe('createWarningsCollector', () => {
  it('starts empty', () => {
    const w = createWarningsCollector();
    expect(w.hasAny).toBe(false);
    expect(w.list).toEqual([]);
  });

  it('collects manual warnings', () => {
    const w = createWarningsCollector();
    w.add('gov config missing');
    expect(w.hasAny).toBe(true);
    expect(w.list).toEqual(['gov config missing']);
  });

  it('addFromResult returns data on ok', () => {
    const w = createWarningsCollector();
    const data = w.addFromResult({ ok: true, data: { id: 1 } }, 'gov');
    expect(data).toEqual({ id: 1 });
    expect(w.hasAny).toBe(false);
  });

  it('addFromResult pushes warning on error and returns null', () => {
    const w = createWarningsCollector();
    const data = w.addFromResult(
      { ok: false, error: { code: 'PGRST500', message: 'x' } as never },
      'gov config failed',
    );
    expect(data).toBeNull();
    expect(w.list).toEqual(['gov config failed (code: PGRST500)']);
  });
});

describe('warningsEnvelope', () => {
  it('returns a 200 JSON response with warnings as a sibling field when non-empty', async () => {
    const w = createWarningsCollector();
    w.add('partial failure');
    const res = warningsEnvelope({ success: true, count: 5 }, w);
    expect(res.status).toBe(200);
    const body = await res.json();
    // Sibling shape: matches canonical reference at app/api/items/[id]/route.ts:419-423
    expect(body).toEqual({
      success: true,
      count: 5,
      warnings: ['partial failure'],
    });
  });

  it('omits the warnings field entirely when the collector is empty', async () => {
    const w = createWarningsCollector();
    const res = warningsEnvelope({ success: true, count: 5 }, w);
    expect(res.status).toBe(200);
    const body = await res.json();
    // No `warnings` key in the serialised body — matches canonical reference.
    expect(body).toEqual({ success: true, count: 5 });
    // Phase 1 acceptance criterion: explicitly assert the key is absent,
    // not merely undefined.
    expect('warnings' in body).toBe(false);
  });

  it('also accepts a plain readonly string array for warnings', async () => {
    const res = warningsEnvelope({ success: true }, ['x', 'y']);
    const body = await res.json();
    expect(body).toEqual({ success: true, warnings: ['x', 'y'] });
  });
});
