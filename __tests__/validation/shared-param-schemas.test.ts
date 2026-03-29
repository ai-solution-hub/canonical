import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  PaginationParamsSchema,
  paginationParams,
  booleanParam,
} from '@/lib/validation/schemas';

describe('PaginationParamsSchema', () => {
  it('should apply default limit=20 and offset=0', () => {
    const result = PaginationParamsSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(20);
      expect(result.data.offset).toBe(0);
    }
  });

  it('should accept valid limit and offset', () => {
    const result = PaginationParamsSchema.safeParse({ limit: 50, offset: 10 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(50);
      expect(result.data.offset).toBe(10);
    }
  });

  it('should accept limit=1 (minimum)', () => {
    const result = PaginationParamsSchema.safeParse({ limit: 1 });
    expect(result.success).toBe(true);
  });

  it('should accept limit=100 (maximum)', () => {
    const result = PaginationParamsSchema.safeParse({ limit: 100 });
    expect(result.success).toBe(true);
  });

  it('should reject limit=0 (below minimum)', () => {
    const result = PaginationParamsSchema.safeParse({ limit: 0 });
    expect(result.success).toBe(false);
  });

  it('should reject limit=101 (above maximum)', () => {
    const result = PaginationParamsSchema.safeParse({ limit: 101 });
    expect(result.success).toBe(false);
  });

  it('should reject negative offset', () => {
    const result = PaginationParamsSchema.safeParse({ offset: -1 });
    expect(result.success).toBe(false);
  });

  it('should reject non-integer limit', () => {
    const result = PaginationParamsSchema.safeParse({ limit: 10.5 });
    expect(result.success).toBe(false);
  });
});

describe('paginationParams factory', () => {
  it('should use default limit=20 and maxLimit=100 when no arguments', () => {
    const schema = paginationParams();
    const result = schema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(20);
      expect(result.data.offset).toBe(0);
    }
  });

  it('should use custom default limit', () => {
    const schema = paginationParams({ limit: 50 });
    const result = schema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(50);
    }
  });

  it('should use custom maxLimit', () => {
    const schema = paginationParams({ maxLimit: 200 });
    const result = schema.safeParse({ limit: 150 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(150);
    }
  });

  it('should clamp limit to maxLimit via transform (not reject)', () => {
    const schema = paginationParams({ maxLimit: 50 });
    // limit=500 exceeds max -- should be clamped to 50, not rejected
    const result = schema.safeParse({ limit: 500 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(50);
    }
  });

  it('should clamp limit to minimum 1 via transform', () => {
    const schema = paginationParams();
    // limit=0 is below minimum -- should be clamped to 1
    const result = schema.safeParse({ limit: 0 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(1);
    }
  });

  it('should clamp negative limit to 1 via transform', () => {
    const schema = paginationParams();
    const result = schema.safeParse({ limit: -10 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(1);
    }
  });

  it('should reject negative offset (not clamped)', () => {
    const schema = paginationParams();
    const result = schema.safeParse({ offset: -1 });
    expect(result.success).toBe(false);
  });

  it('should pass through valid limit unchanged', () => {
    const schema = paginationParams({ limit: 20, maxLimit: 100 });
    const result = schema.safeParse({ limit: 75 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(75);
    }
  });
});

describe('booleanParam', () => {
  it('should convert string "true" to boolean true', () => {
    const result = booleanParam.safeParse('true');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe(true);
    }
  });

  it('should convert string "false" to boolean false', () => {
    // "false" is not === "true" and not === true, so preprocess yields false
    const result = booleanParam.safeParse('false');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe(false);
    }
  });

  it('should convert boolean true to boolean true', () => {
    const result = booleanParam.safeParse(true);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe(true);
    }
  });

  it('should convert boolean false to boolean false', () => {
    const result = booleanParam.safeParse(false);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe(false);
    }
  });

  it('should convert string "1" to boolean false (not a recognised truthy value)', () => {
    // booleanParam only recognises "true" and true -- "1" becomes false
    const result = booleanParam.safeParse('1');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe(false);
    }
  });

  it('should convert string "0" to boolean false', () => {
    const result = booleanParam.safeParse('0');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe(false);
    }
  });

  it('should convert undefined to boolean false', () => {
    const result = booleanParam.safeParse(undefined);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe(false);
    }
  });

  it('should work as optional in a schema', () => {
    const schema = z.object({
      flag: booleanParam.optional(),
    });

    // When absent
    const absent = schema.safeParse({});
    expect(absent.success).toBe(true);
    if (absent.success) {
      expect(absent.data.flag).toBeUndefined();
    }

    // When present as "true"
    const present = schema.safeParse({ flag: 'true' });
    expect(present.success).toBe(true);
    if (present.success) {
      expect(present.data.flag).toBe(true);
    }
  });
});
