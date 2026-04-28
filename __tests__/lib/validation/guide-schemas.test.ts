import { describe, it, expect } from 'vitest';
import {
  guideCreateSchema,
  guideUpdateSchema,
  buildGuideSectionSchema,
  buildGuideSectionUpdateSchema,
  guideSectionsReorderSchema,
} from '@/lib/validation/guide-schemas';

const TEST_LAYER_KEYS = [
  'sales_brief',
  'bid_detail',
  'company_reference',
  'research',
];

describe('guideCreateSchema', () => {
  it('accepts valid guide input', () => {
    const result = guideCreateSchema.safeParse({
      name: 'SCP Sector Guide',
      slug: 'scp-sector',
      guide_type: 'sector',
      domain_filter: 'Safeguarding & Child Protection',
    });
    expect(result.success).toBe(true);
  });

  it('accepts all optional fields', () => {
    const result = guideCreateSchema.safeParse({
      name: 'Full Guide',
      slug: 'full-guide',
      guide_type: 'product',
      domain_filter: 'Technology',
      description: 'A complete product guide',
      icon: 'book',
      color: '#6366f1',
      display_order: 5,
      is_published: true,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.display_order).toBe(5);
      expect(result.data.is_published).toBe(true);
    }
  });

  it('applies defaults for display_order and is_published', () => {
    const result = guideCreateSchema.safeParse({
      name: 'Defaults Test',
      slug: 'defaults-test',
      guide_type: 'sector',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.display_order).toBe(0);
      expect(result.data.is_published).toBe(false);
    }
  });

  it('rejects invalid slug characters', () => {
    const result = guideCreateSchema.safeParse({
      name: 'Test',
      slug: 'Bad Slug!',
      guide_type: 'sector',
    });
    expect(result.success).toBe(false);
  });

  it('rejects uppercase slug', () => {
    const result = guideCreateSchema.safeParse({
      name: 'Test',
      slug: 'Bad-Slug',
      guide_type: 'sector',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid guide type', () => {
    const result = guideCreateSchema.safeParse({
      name: 'Test',
      slug: 'test',
      guide_type: 'invalid',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty name', () => {
    const result = guideCreateSchema.safeParse({
      name: '',
      slug: 'test',
      guide_type: 'sector',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty slug', () => {
    const result = guideCreateSchema.safeParse({
      name: 'Test',
      slug: '',
      guide_type: 'sector',
    });
    expect(result.success).toBe(false);
  });

  it('accepts all valid guide types', () => {
    for (const type of ['sector', 'product', 'company', 'research', 'custom']) {
      const result = guideCreateSchema.safeParse({
        name: 'Test',
        slug: 'test',
        guide_type: type,
      });
      expect(result.success).toBe(true);
    }
  });
});

describe('guideUpdateSchema', () => {
  it('accepts partial updates', () => {
    const result = guideUpdateSchema.safeParse({
      name: 'Updated Name',
    });
    expect(result.success).toBe(true);
  });

  it('accepts nullable fields', () => {
    const result = guideUpdateSchema.safeParse({
      description: null,
      domain_filter: null,
      icon: null,
    });
    expect(result.success).toBe(true);
  });

  it('accepts empty object', () => {
    const result = guideUpdateSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('rejects invalid slug in update', () => {
    const result = guideUpdateSchema.safeParse({
      slug: 'Invalid Slug',
    });
    expect(result.success).toBe(false);
  });
});

describe('buildGuideSectionSchema', () => {
  it('accepts valid section input with layer key in list', () => {
    const schema = buildGuideSectionSchema(TEST_LAYER_KEYS);
    const result = schema.safeParse({
      section_name: 'Sector Overview',
      expected_layer: 'sales_brief',
      display_order: 1,
    });
    expect(result.success).toBe(true);
  });

  it('rejects layer key not in list', () => {
    const schema = buildGuideSectionSchema(TEST_LAYER_KEYS);
    const result = schema.safeParse({
      section_name: 'Test',
      expected_layer: 'nonexistent_layer',
      display_order: 0,
    });
    expect(result.success).toBe(false);
  });

  it('accepts null expected_layer', () => {
    const schema = buildGuideSectionSchema(TEST_LAYER_KEYS);
    const result = schema.safeParse({
      section_name: 'Research Feed',
      expected_layer: null,
      subtopic_filter: null,
      display_order: 9,
    });
    expect(result.success).toBe(true);
  });

  it('accepts omitted expected_layer', () => {
    const schema = buildGuideSectionSchema(TEST_LAYER_KEYS);
    const result = schema.safeParse({
      section_name: 'No Layer',
      display_order: 0,
    });
    expect(result.success).toBe(true);
  });

  it('accepts all valid layer values', () => {
    const schema = buildGuideSectionSchema(TEST_LAYER_KEYS);
    for (const layer of TEST_LAYER_KEYS) {
      const result = schema.safeParse({
        section_name: 'Test',
        expected_layer: layer,
        display_order: 0,
      });
      expect(result.success).toBe(true);
    }
  });

  it('accepts a custom layer key added by admin', () => {
    const schema = buildGuideSectionSchema([
      ...TEST_LAYER_KEYS,
      'custom_new_layer',
    ]);
    const result = schema.safeParse({
      section_name: 'Custom Section',
      expected_layer: 'custom_new_layer',
      display_order: 0,
    });
    expect(result.success).toBe(true);
  });

  it('rejects negative display_order', () => {
    const schema = buildGuideSectionSchema(TEST_LAYER_KEYS);
    const result = schema.safeParse({
      section_name: 'Test',
      display_order: -1,
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty section_name', () => {
    const schema = buildGuideSectionSchema(TEST_LAYER_KEYS);
    const result = schema.safeParse({
      section_name: '',
      display_order: 0,
    });
    expect(result.success).toBe(false);
  });

  it('defaults is_required to true', () => {
    const schema = buildGuideSectionSchema(TEST_LAYER_KEYS);
    const result = schema.safeParse({
      section_name: 'Test',
      display_order: 0,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.is_required).toBe(true);
    }
  });
});

describe('buildGuideSectionUpdateSchema', () => {
  it('accepts partial section updates with layer key in list', () => {
    const schema = buildGuideSectionUpdateSchema(TEST_LAYER_KEYS);
    const result = schema.safeParse({
      expected_layer: 'bid_detail',
    });
    expect(result.success).toBe(true);
  });

  it('rejects layer key not in list', () => {
    const schema = buildGuideSectionUpdateSchema(TEST_LAYER_KEYS);
    const result = schema.safeParse({
      expected_layer: 'nonexistent_layer',
    });
    expect(result.success).toBe(false);
  });

  it('accepts null expected_layer', () => {
    const schema = buildGuideSectionUpdateSchema(TEST_LAYER_KEYS);
    const result = schema.safeParse({
      description: null,
      expected_layer: null,
      subtopic_filter: null,
      content_type_filter: null,
    });
    expect(result.success).toBe(true);
  });

  it('accepts partial update with section_name only', () => {
    const schema = buildGuideSectionUpdateSchema(TEST_LAYER_KEYS);
    const result = schema.safeParse({
      section_name: 'Updated Section',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a custom layer key added by admin', () => {
    const schema = buildGuideSectionUpdateSchema([
      ...TEST_LAYER_KEYS,
      'admin_added',
    ]);
    const result = schema.safeParse({
      expected_layer: 'admin_added',
    });
    expect(result.success).toBe(true);
  });
});

describe('guideSectionsReorderSchema', () => {
  it('accepts valid reorder input', () => {
    const result = guideSectionsReorderSchema.safeParse({
      sections: [
        { id: '550e8400-e29b-41d4-a716-446655440000', display_order: 0 },
        { id: '550e8400-e29b-41d4-a716-446655440001', display_order: 1 },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid UUID', () => {
    const result = guideSectionsReorderSchema.safeParse({
      sections: [{ id: 'not-a-uuid', display_order: 0 }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative display_order', () => {
    const result = guideSectionsReorderSchema.safeParse({
      sections: [
        { id: '550e8400-e29b-41d4-a716-446655440000', display_order: -1 },
      ],
    });
    expect(result.success).toBe(false);
  });
});
