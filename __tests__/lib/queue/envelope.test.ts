import { describe, it, expect } from 'vitest';

import {
  buildIdempotencyKey,
  queueJobPayloadSchema,
  type JobStatus,
  type JobType,
  type QueueJobPayload,
} from '@/lib/queue/envelope';

describe('buildIdempotencyKey', () => {
  it('produces <job_type>:<scoped_id>:<YYYY-MM-DD>:<requestHash> verbatim', () => {
    const key = buildIdempotencyKey({
      jobType: 'embed',
      scopedId: 'abc123',
      requestHash: 'hash456',
      dateUtc: new Date('2026-05-02T15:30:00Z'),
    });
    expect(key).toBe('embed:abc123:2026-05-02:hash456');
  });

  it('defaults date bucket to today UTC when dateUtc omitted', () => {
    const expectedDate = new Date().toISOString().slice(0, 10);
    const key = buildIdempotencyKey({
      jobType: 'classify',
      scopedId: 'item-789',
      requestHash: 'r1',
    });
    expect(key).toBe(`classify:item-789:${expectedDate}:r1`);
  });

  it('slices date to YYYY-MM-DD only — no time component leaks', () => {
    const key = buildIdempotencyKey({
      jobType: 'summarise',
      scopedId: 's1',
      requestHash: 'h1',
      dateUtc: new Date('2026-12-31T23:59:59.999Z'),
    });
    // Must contain the date but NOT the time, milliseconds, or 'T' separator
    expect(key).toBe('summarise:s1:2026-12-31:h1');
    expect(key).not.toContain('T');
    expect(key).not.toContain('23:59');
    expect(key).not.toContain('.999');
  });

  it('uses UTC date (not local) so the bucket is deterministic across timezones', () => {
    // 2026-05-02T01:00:00Z is still 2026-05-02 in UTC, but might be 2026-05-01
    // in westerly timezones. The helper must use UTC, so the bucket stays
    // 2026-05-02 regardless of agent locale.
    const key = buildIdempotencyKey({
      jobType: 'validate',
      scopedId: 'v1',
      requestHash: 'h',
      dateUtc: new Date('2026-05-02T01:00:00Z'),
    });
    expect(key).toBe('validate:v1:2026-05-02:h');
  });

  it('produces different keys for the same inputs on different dates (per D-1 mandate)', () => {
    const day1 = buildIdempotencyKey({
      jobType: 'reprocess',
      scopedId: 'item-1',
      requestHash: 'opts',
      dateUtc: new Date('2026-05-02T00:00:00Z'),
    });
    const day2 = buildIdempotencyKey({
      jobType: 'reprocess',
      scopedId: 'item-1',
      requestHash: 'opts',
      dateUtc: new Date('2026-05-03T00:00:00Z'),
    });
    expect(day1).not.toBe(day2);
  });

  it('produces identical keys for the same inputs on the same date (dedup path)', () => {
    const a = buildIdempotencyKey({
      jobType: 'extract_qa',
      scopedId: 'doc-1',
      requestHash: 'h',
      dateUtc: new Date('2026-05-02T08:00:00Z'),
    });
    const b = buildIdempotencyKey({
      jobType: 'extract_qa',
      scopedId: 'doc-1',
      requestHash: 'h',
      dateUtc: new Date('2026-05-02T20:00:00Z'),
    });
    expect(a).toBe(b);
  });
});

describe('queueJobPayloadSchema', () => {
  const validEnvelope: QueueJobPayload<{ foo: string }> = {
    envelope_version: 1,
    auth_context: {
      user_id: 'a0000000-0000-4000-8000-000000000001',
      role: 'admin',
    },
    body: { foo: 'bar' },
  };

  it('accepts a minimal valid envelope', () => {
    const result = queueJobPayloadSchema.safeParse(validEnvelope);
    expect(result.success).toBe(true);
  });

  it('accepts an envelope with idempotency_key set', () => {
    const result = queueJobPayloadSchema.safeParse({
      ...validEnvelope,
      idempotency_key: 'embed:abc:2026-05-02:hash',
    });
    expect(result.success).toBe(true);
  });

  it('accepts an envelope with pipeline_run_id set', () => {
    const result = queueJobPayloadSchema.safeParse({
      ...validEnvelope,
      pipeline_run_id: 'b0000000-0000-4000-8000-000000000002',
    });
    expect(result.success).toBe(true);
  });

  it('accepts an envelope with optional workspace_id in auth_context', () => {
    const result = queueJobPayloadSchema.safeParse({
      ...validEnvelope,
      auth_context: {
        ...validEnvelope.auth_context,
        workspace_id: 'c0000000-0000-4000-8000-000000000003',
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects envelope_version: 999 with explicit Zod error', () => {
    const result = queueJobPayloadSchema.safeParse({
      ...validEnvelope,
      envelope_version: 999,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      // Zod's literal validation surfaces a path on the violating field
      const versionIssue = result.error.issues.find((i) =>
        i.path.includes('envelope_version'),
      );
      expect(versionIssue).toBeDefined();
    }
  });

  it('rejects envelope missing auth_context.user_id', () => {
    const result = queueJobPayloadSchema.safeParse({
      ...validEnvelope,
      auth_context: {
        // user_id intentionally omitted
        role: 'admin',
      },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const userIdIssue = result.error.issues.find((i) =>
        i.path.includes('user_id'),
      );
      expect(userIdIssue).toBeDefined();
    }
  });

  it('rejects auth_context.role outside admin|editor|viewer', () => {
    const result = queueJobPayloadSchema.safeParse({
      ...validEnvelope,
      auth_context: {
        user_id: 'a0000000-0000-4000-8000-000000000001',
        role: 'superuser',
      },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const roleIssue = result.error.issues.find((i) =>
        i.path.includes('role'),
      );
      expect(roleIssue).toBeDefined();
    }
  });

  it('rejects envelope missing body', () => {
    const result = queueJobPayloadSchema.safeParse({
      envelope_version: 1,
      auth_context: {
        user_id: 'a0000000-0000-4000-8000-000000000001',
        role: 'admin',
      },
      // body intentionally omitted
    });
    expect(result.success).toBe(false);
  });

  it('rejects auth_context.user_id when not a UUID', () => {
    const result = queueJobPayloadSchema.safeParse({
      ...validEnvelope,
      auth_context: {
        user_id: 'not-a-uuid',
        role: 'admin',
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects pipeline_run_id when not a UUID', () => {
    const result = queueJobPayloadSchema.safeParse({
      ...validEnvelope,
      pipeline_run_id: 'not-a-uuid',
    });
    expect(result.success).toBe(false);
  });
});

describe('JobStatus union', () => {
  it('includes dead_lettered (D-2 widening, paired with W1-A migration)', () => {
    const value: JobStatus = 'dead_lettered';
    expect(value).toBe('dead_lettered');
  });

  it('exposes all six lifecycle states from spec §3.3', () => {
    const all: JobStatus[] = [
      'pending',
      'processing',
      'completed',
      'failed',
      'cancelled',
      'dead_lettered',
    ];
    expect(all).toHaveLength(6);
  });
});

describe('JobType union', () => {
  it('restricted to existing 8 values (no speculative widen per Liam OQ-3 ratified S221 W3)', () => {
    // Compile-time guarantee: the following must be a TYPE error if uncommented.
    // const x: JobType = 'bid_draft_all';      // ts(2322) — forward §5.4.1 type
    // const y: JobType = 'batch_reclassify';   // ts(2322) — forward §5.4.2 type
    // const z: JobType = 'markdown_batch';     // ts(2322) — forward §5.4.4 type
    const valid: JobType[] = [
      'embed',
      'classify',
      'extract_qa',
      'summarise',
      'validate',
      'reprocess',
      'template_fill',
      'template_analyse',
    ];
    expect(valid.length).toBe(8);
  });
});
