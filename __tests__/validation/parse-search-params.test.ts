import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { parseSearchParams } from '@/lib/validation';

// Simple schema for testing coercion/defaults
const TestSchema = z.object({
  limit: z
    .number()
    .int()
    .default(20)
    .transform((v) => Math.max(1, Math.min(100, v))),
  offset: z
    .number()
    .int()
    .default(0)
    .transform((v) => Math.max(0, v)),
  query: z.string().optional(),
  flag: z.preprocess((v) => v === 'true' || v === true, z.boolean()).optional(),
});

describe('parseSearchParams', () => {
  describe('numeric coercion', () => {
    it('should coerce numeric string to number', () => {
      const params = new URLSearchParams('limit=20');
      const result = parseSearchParams(TestSchema, params);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.limit).toBe(20);
        expect(typeof result.data.limit).toBe('number');
      }
    });

    it('should coerce "50" to number 50', () => {
      const params = new URLSearchParams('limit=50&offset=10');
      const result = parseSearchParams(TestSchema, params);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.limit).toBe(50);
        expect(result.data.offset).toBe(10);
      }
    });

    it('should coerce "0" to number 0', () => {
      const params = new URLSearchParams('offset=0');
      const result = parseSearchParams(TestSchema, params);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.offset).toBe(0);
      }
    });
  });

  describe('default values', () => {
    it('should apply defaults when params are absent', () => {
      const params = new URLSearchParams();
      const result = parseSearchParams(TestSchema, params);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.limit).toBe(20);
        expect(result.data.offset).toBe(0);
      }
    });

    it('should apply defaults for missing params alongside present ones', () => {
      const params = new URLSearchParams('query=hello');
      const result = parseSearchParams(TestSchema, params);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.limit).toBe(20);
        expect(result.data.offset).toBe(0);
        expect(result.data.query).toBe('hello');
      }
    });
  });

  describe('boolean param handling', () => {
    it('should keep string "true" as string (not coerced by parseSearchParams)', () => {
      // parseSearchParams does NOT auto-coerce booleans -- they stay as strings.
      // The schema's z.preprocess handles the string-to-boolean conversion.
      const params = new URLSearchParams('flag=true');
      const result = parseSearchParams(TestSchema, params);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.flag).toBe(true);
      }
    });

    it('should handle string "false" via preprocess (becomes false)', () => {
      const params = new URLSearchParams('flag=false');
      const result = parseSearchParams(TestSchema, params);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.flag).toBe(false);
      }
    });

    it('should handle absent boolean param as undefined', () => {
      const params = new URLSearchParams('limit=10');
      const result = parseSearchParams(TestSchema, params);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.flag).toBeUndefined();
      }
    });
  });

  describe('comma-separated arrays', () => {
    const ArraySchema = z.object({
      ids: z.array(z.string()).optional(),
    });

    it('should split comma-separated values into an array', () => {
      const params = new URLSearchParams('ids=a,b,c');
      const result = parseSearchParams(ArraySchema, params);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.ids).toEqual(['a', 'b', 'c']);
      }
    });

    it('should handle single value (no commas) as a scalar', () => {
      const ScalarOrArraySchema = z.object({
        status: z.string().optional(),
      });
      const params = new URLSearchParams('status=active');
      const result = parseSearchParams(ScalarOrArraySchema, params);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.status).toBe('active');
      }
    });
  });

  describe('repeated params', () => {
    const ArraySchema = z.object({
      domain: z.array(z.string()).optional(),
    });

    it('should handle repeated params as an array', () => {
      const params = new URLSearchParams();
      params.append('domain', 'AI');
      params.append('domain', 'Security');
      const result = parseSearchParams(ArraySchema, params);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.domain).toEqual(['AI', 'Security']);
      }
    });
  });

  describe('validation failure', () => {
    it('should clamp negative limit to 1 instead of returning 400', () => {
      const params = new URLSearchParams('limit=-5');
      const result = parseSearchParams(TestSchema, params);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.limit).toBe(1);
      }
    });

    it('should clamp limit exceeding max to 100 instead of returning 400', () => {
      const params = new URLSearchParams('limit=200');
      const result = parseSearchParams(TestSchema, params);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.limit).toBe(100);
      }
    });

    it('should return 400 with field-level detail for multiple errors', async () => {
      const StrictSchema = z.object({
        name: z.string().min(1),
        count: z.number().int().min(0),
      });
      // Pass nothing -- both fields are required
      const params = new URLSearchParams();
      const result = parseSearchParams(StrictSchema, params);
      expect(result.success).toBe(false);
      if (!result.success) {
        const body = await result.response.json();
        expect(body.details.length).toBeGreaterThanOrEqual(2);
      }
    });
  });

  describe('pagination parameter coercion', () => {
    it('should coerce string pagination params to numbers', () => {
      // URLSearchParams always stores strings; parseSearchParams coerces numeric ones
      const params = new URLSearchParams('limit=25&offset=5');
      const result = parseSearchParams(TestSchema, params);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.limit).toBe(25);
        expect(typeof result.data.limit).toBe('number');
        expect(result.data.offset).toBe(5);
        expect(typeof result.data.offset).toBe('number');
      }
    });

    it('should use default pagination when no params provided', () => {
      const params = new URLSearchParams();
      const result = parseSearchParams(TestSchema, params);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.limit).toBe(20);
        expect(result.data.offset).toBe(0);
      }
    });
  });
});
