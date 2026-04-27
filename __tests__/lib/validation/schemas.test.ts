import { describe, it, expect } from 'vitest';
import { buildItemMetadataUpdateSchema } from '@/lib/validation/schemas';

const TEST_LAYER_KEYS = [
  'sales_brief',
  'bid_detail',
  'company_reference',
  'research',
];

describe('buildItemMetadataUpdateSchema', () => {
  it('accepts layer key in list', () => {
    const schema = buildItemMetadataUpdateSchema(TEST_LAYER_KEYS);
    const result = schema.safeParse({
      layer: 'sales_brief',
    });
    expect(result.success).toBe(true);
  });

  it('rejects layer key not in list', () => {
    const schema = buildItemMetadataUpdateSchema(TEST_LAYER_KEYS);
    const result = schema.safeParse({
      layer: 'nonexistent_layer',
    });
    expect(result.success).toBe(false);
  });

  it('accepts nullable layer', () => {
    const schema = buildItemMetadataUpdateSchema(TEST_LAYER_KEYS);
    const result = schema.safeParse({
      layer: null,
    });
    expect(result.success).toBe(true);
  });

  it('accepts topic_id update without layer', () => {
    const schema = buildItemMetadataUpdateSchema(TEST_LAYER_KEYS);
    const result = schema.safeParse({
      topic_id: 'some-topic',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty object (refine requires at least one field)', () => {
    const schema = buildItemMetadataUpdateSchema(TEST_LAYER_KEYS);
    const result = schema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(
        'At least one metadata field required',
      );
    }
  });

  it('accepts a custom layer key added by admin', () => {
    const schema = buildItemMetadataUpdateSchema([
      ...TEST_LAYER_KEYS,
      'custom_layer',
    ]);
    const result = schema.safeParse({
      layer: 'custom_layer',
    });
    expect(result.success).toBe(true);
  });

  it('accepts both layer and topic_id', () => {
    const schema = buildItemMetadataUpdateSchema(TEST_LAYER_KEYS);
    const result = schema.safeParse({
      layer: 'bid_detail',
      topic_id: 'some-topic-id',
    });
    expect(result.success).toBe(true);
  });
});
