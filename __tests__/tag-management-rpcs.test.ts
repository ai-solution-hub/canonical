/**
 * Tag Management — Sprint B: New RPC validation schemas and API route tests.
 *
 * Tests the new tag management schemas and RPC-backed endpoints:
 *   - find_duplicate_tags (via GET /api/tags/duplicates)
 *   - get_tags_by_domain (via GET /api/tags/by-domain)
 *   - get_tag_counts_filtered (via GET /api/tags with query params)
 *   - bulk_delete_tags (via POST /api/tags/bulk-delete)
 *   - bulk_merge_tags (via POST /api/tags/bulk-merge)
 *
 * Note: API routes for these RPCs will be added in Sprint C/D.
 * This file tests the validation schemas and RPC contract expectations.
 */
import { describe, it, expect } from 'vitest';
import {
  TagDuplicatesParamsSchema,
  TagByDomainParamsSchema,
  TagFilteredParamsSchema,
  TagBulkDeleteBodySchema,
  TagBulkMergeBodySchema,
} from '@/lib/validation/schemas';

// ═══════════════════════════════════════════════════════════════════════════
// TagDuplicatesParamsSchema
// ═══════════════════════════════════════════════════════════════════════════

describe('TagDuplicatesParamsSchema', () => {
  it('accepts valid ai type', () => {
    const result = TagDuplicatesParamsSchema.safeParse({ type: 'ai' });
    expect(result.success).toBe(true);
  });

  it('accepts valid user type', () => {
    const result = TagDuplicatesParamsSchema.safeParse({ type: 'user' });
    expect(result.success).toBe(true);
  });

  it('rejects invalid type', () => {
    const result = TagDuplicatesParamsSchema.safeParse({ type: 'both' });
    expect(result.success).toBe(false);
  });

  it('rejects missing type', () => {
    const result = TagDuplicatesParamsSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TagByDomainParamsSchema
// ═══════════════════════════════════════════════════════════════════════════

describe('TagByDomainParamsSchema', () => {
  it('accepts valid ai type', () => {
    const result = TagByDomainParamsSchema.safeParse({ type: 'ai' });
    expect(result.success).toBe(true);
  });

  it('accepts valid user type', () => {
    const result = TagByDomainParamsSchema.safeParse({ type: 'user' });
    expect(result.success).toBe(true);
  });

  it('rejects invalid type', () => {
    const result = TagByDomainParamsSchema.safeParse({ type: 'system' });
    expect(result.success).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TagFilteredParamsSchema
// ═══════════════════════════════════════════════════════════════════════════

describe('TagFilteredParamsSchema', () => {
  it('accepts empty object (all params optional)', () => {
    const result = TagFilteredParamsSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('accepts all params together', () => {
    const result = TagFilteredParamsSchema.safeParse({
      type: 'ai',
      min_count: '2',
      search: 'security',
      limit: '50',
      offset: '0',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe('ai');
      expect(result.data.min_count).toBe(2);
      expect(result.data.search).toBe('security');
      expect(result.data.limit).toBe(50);
      expect(result.data.offset).toBe(0);
    }
  });

  it('coerces string numbers to integers', () => {
    const result = TagFilteredParamsSchema.safeParse({
      min_count: '5',
      limit: '100',
      offset: '10',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.min_count).toBe(5);
      expect(result.data.limit).toBe(100);
      expect(result.data.offset).toBe(10);
    }
  });

  it('rejects negative offset', () => {
    const result = TagFilteredParamsSchema.safeParse({ offset: '-1' });
    expect(result.success).toBe(false);
  });

  it('rejects limit over 500', () => {
    const result = TagFilteredParamsSchema.safeParse({ limit: '501' });
    expect(result.success).toBe(false);
  });

  it('rejects min_count of 0', () => {
    const result = TagFilteredParamsSchema.safeParse({ min_count: '0' });
    expect(result.success).toBe(false);
  });

  it('rejects search over 100 characters', () => {
    const result = TagFilteredParamsSchema.safeParse({
      search: 'a'.repeat(101),
    });
    expect(result.success).toBe(false);
  });

  it('accepts type only', () => {
    const result = TagFilteredParamsSchema.safeParse({ type: 'user' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe('user');
    }
  });

  it('rejects invalid type', () => {
    const result = TagFilteredParamsSchema.safeParse({ type: 'both' });
    expect(result.success).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TagBulkDeleteBodySchema
// ═══════════════════════════════════════════════════════════════════════════

describe('TagBulkDeleteBodySchema', () => {
  it('accepts valid bulk delete body', () => {
    const result = TagBulkDeleteBodySchema.safeParse({
      tags: ['tag1', 'tag2', 'tag3'],
      type: 'ai',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tags).toEqual(['tag1', 'tag2', 'tag3']);
      expect(result.data.type).toBe('ai');
    }
  });

  it('accepts user type', () => {
    const result = TagBulkDeleteBodySchema.safeParse({
      tags: ['compliance'],
      type: 'user',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty tags array', () => {
    const result = TagBulkDeleteBodySchema.safeParse({
      tags: [],
      type: 'ai',
    });
    expect(result.success).toBe(false);
  });

  it('rejects tags with empty strings', () => {
    const result = TagBulkDeleteBodySchema.safeParse({
      tags: ['valid', ''],
      type: 'ai',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing type', () => {
    const result = TagBulkDeleteBodySchema.safeParse({
      tags: ['tag1'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid type', () => {
    const result = TagBulkDeleteBodySchema.safeParse({
      tags: ['tag1'],
      type: 'system',
    });
    expect(result.success).toBe(false);
  });

  it('rejects tags over 100 characters', () => {
    const result = TagBulkDeleteBodySchema.safeParse({
      tags: ['a'.repeat(101)],
      type: 'ai',
    });
    expect(result.success).toBe(false);
  });

  it('rejects more than 200 tags', () => {
    const tags = Array.from({ length: 201 }, (_, i) => `tag-${i}`);
    const result = TagBulkDeleteBodySchema.safeParse({
      tags,
      type: 'ai',
    });
    expect(result.success).toBe(false);
  });

  it('accepts exactly 200 tags', () => {
    const tags = Array.from({ length: 200 }, (_, i) => `tag-${i}`);
    const result = TagBulkDeleteBodySchema.safeParse({
      tags,
      type: 'ai',
    });
    expect(result.success).toBe(true);
  });

  it('trims whitespace from tag names', () => {
    const result = TagBulkDeleteBodySchema.safeParse({
      tags: ['  security  ', '  compliance '],
      type: 'ai',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tags).toEqual(['security', 'compliance']);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TagBulkMergeBodySchema
// ═══════════════════════════════════════════════════════════════════════════

describe('TagBulkMergeBodySchema', () => {
  it('accepts valid bulk merge body', () => {
    const result = TagBulkMergeBodySchema.safeParse({
      sources: ['Audit System', 'Audit system', 'audit system'],
      target: 'audit system',
      type: 'ai',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sources).toHaveLength(3);
      expect(result.data.target).toBe('audit system');
      expect(result.data.type).toBe('ai');
    }
  });

  it('accepts single source tag', () => {
    const result = TagBulkMergeBodySchema.safeParse({
      sources: ['old-tag'],
      target: 'new-tag',
      type: 'user',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty sources array', () => {
    const result = TagBulkMergeBodySchema.safeParse({
      sources: [],
      target: 'target-tag',
      type: 'ai',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing target', () => {
    const result = TagBulkMergeBodySchema.safeParse({
      sources: ['tag1', 'tag2'],
      type: 'ai',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty target string', () => {
    const result = TagBulkMergeBodySchema.safeParse({
      sources: ['tag1'],
      target: '',
      type: 'ai',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing type', () => {
    const result = TagBulkMergeBodySchema.safeParse({
      sources: ['tag1'],
      target: 'tag2',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid type', () => {
    const result = TagBulkMergeBodySchema.safeParse({
      sources: ['tag1'],
      target: 'tag2',
      type: 'both',
    });
    expect(result.success).toBe(false);
  });

  it('rejects sources with empty strings', () => {
    const result = TagBulkMergeBodySchema.safeParse({
      sources: ['valid', ''],
      target: 'target',
      type: 'ai',
    });
    expect(result.success).toBe(false);
  });

  it('rejects more than 200 source tags', () => {
    const sources = Array.from({ length: 201 }, (_, i) => `tag-${i}`);
    const result = TagBulkMergeBodySchema.safeParse({
      sources,
      target: 'merged',
      type: 'ai',
    });
    expect(result.success).toBe(false);
  });

  it('trims whitespace from sources and target', () => {
    const result = TagBulkMergeBodySchema.safeParse({
      sources: ['  source1  ', '  source2  '],
      target: '  target  ',
      type: 'ai',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sources).toEqual(['source1', 'source2']);
      expect(result.data.target).toBe('target');
    }
  });

  it('rejects target over 100 characters', () => {
    const result = TagBulkMergeBodySchema.safeParse({
      sources: ['tag1'],
      target: 'a'.repeat(101),
      type: 'ai',
    });
    expect(result.success).toBe(false);
  });
});
