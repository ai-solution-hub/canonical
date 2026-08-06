import { describe, it, expect } from 'vitest';
import {
  TagDeleteBodySchema,
  TagRenameBodySchema,
  TagMergeBodySchema,
  TagSuggestParamsSchema,
} from '@/lib/validation/schemas';

// ═══════════════════════════════════════════════════════════════════════════
// Draft extension schema tests
// ═══════════════════════════════════════════════════════════════════════════

// (ItemCreateBodySchema tests removed — id-417: the schema was deleted with
// the retired /api/items routes.)

describe('TagDeleteBodySchema', () => {
  it('accepts valid delete body', () => {
    const result = TagDeleteBodySchema.safeParse({
      tag: 'security',
      type: 'user',
    });
    expect(result.success).toBe(true);
  });

  it('accepts ai type', () => {
    const result = TagDeleteBodySchema.safeParse({
      tag: 'ISO 27001',
      type: 'ai',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty tag', () => {
    const result = TagDeleteBodySchema.safeParse({
      tag: '',
      type: 'user',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid type', () => {
    const result = TagDeleteBodySchema.safeParse({
      tag: 'test',
      type: 'invalid',
    });
    expect(result.success).toBe(false);
  });
});

describe('TagRenameBodySchema', () => {
  it('accepts valid rename body', () => {
    const result = TagRenameBodySchema.safeParse({
      old: 'sec',
      new: 'security',
      type: 'user',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty old name', () => {
    const result = TagRenameBodySchema.safeParse({
      old: '',
      new: 'security',
      type: 'user',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty new name', () => {
    const result = TagRenameBodySchema.safeParse({
      old: 'sec',
      new: '',
      type: 'user',
    });
    expect(result.success).toBe(false);
  });
});

describe('TagMergeBodySchema', () => {
  it('accepts valid merge body', () => {
    const result = TagMergeBodySchema.safeParse({
      source: 'infosec',
      target: 'security',
      type: 'ai',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing source', () => {
    const result = TagMergeBodySchema.safeParse({
      target: 'security',
      type: 'ai',
    });
    expect(result.success).toBe(false);
  });
});

describe('TagSuggestParamsSchema', () => {
  it('accepts valid suggest params', () => {
    const result = TagSuggestParamsSchema.safeParse({
      prefix: 'sec',
      type: 'user',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty prefix', () => {
    const result = TagSuggestParamsSchema.safeParse({
      prefix: '',
      type: 'user',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid type', () => {
    const result = TagSuggestParamsSchema.safeParse({
      prefix: 'sec',
      type: 'both',
    });
    expect(result.success).toBe(false);
  });
});
