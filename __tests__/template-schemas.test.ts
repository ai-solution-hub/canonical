import { describe, it, expect } from 'vitest';
import {
  TemplateUploadBodySchema,
  FieldMappingUpdateSchema,
  BulkFieldMappingSchema,
  TemplateFillBodySchema,
  AutoMapBodySchema,
  TEMPLATE_STATUSES,
  FIELD_TYPES,
  MAPPING_STATUSES,
  FILL_STATUSES,
} from '@/lib/validation/template-schemas';

// ---------------------------------------------------------------------------
// TemplateUploadBodySchema
// ---------------------------------------------------------------------------

describe('TemplateUploadBodySchema', () => {
  it('validates a valid upload body', () => {
    const result = TemplateUploadBodySchema.safeParse({
      project_id: '550e8400-e29b-41d4-a716-446655440000',
      name: 'LA Tender Response Template',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('LA Tender Response Template');
      expect(result.data.project_id).toBe('550e8400-e29b-41d4-a716-446655440000');
    }
  });

  it('validates with optional description', () => {
    const result = TemplateUploadBodySchema.safeParse({
      project_id: '550e8400-e29b-41d4-a716-446655440000',
      name: 'Template',
      description: 'A test template for the LA tender questionnaire.',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.description).toBe('A test template for the LA tender questionnaire.');
    }
  });

  it('rejects missing project_id', () => {
    const result = TemplateUploadBodySchema.safeParse({
      name: 'Template',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid project_id (not a UUID)', () => {
    const result = TemplateUploadBodySchema.safeParse({
      project_id: 'not-a-uuid',
      name: 'Template',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty template name', () => {
    const result = TemplateUploadBodySchema.safeParse({
      project_id: '550e8400-e29b-41d4-a716-446655440000',
      name: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects template name exceeding 200 characters', () => {
    const result = TemplateUploadBodySchema.safeParse({
      project_id: '550e8400-e29b-41d4-a716-446655440000',
      name: 'A'.repeat(201),
    });
    expect(result.success).toBe(false);
  });

  it('rejects description exceeding 1000 characters', () => {
    const result = TemplateUploadBodySchema.safeParse({
      project_id: '550e8400-e29b-41d4-a716-446655440000',
      name: 'Template',
      description: 'X'.repeat(1001),
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// FieldMappingUpdateSchema
// ---------------------------------------------------------------------------

describe('FieldMappingUpdateSchema', () => {
  it('validates confirmed mapping with question_id', () => {
    const result = FieldMappingUpdateSchema.safeParse({
      question_id: '550e8400-e29b-41d4-a716-446655440000',
      mapping_status: 'confirmed',
    });
    expect(result.success).toBe(true);
  });

  it('validates rejected mapping with null question_id', () => {
    const result = FieldMappingUpdateSchema.safeParse({
      question_id: null,
      mapping_status: 'rejected',
    });
    expect(result.success).toBe(true);
  });

  it('validates manual mapping', () => {
    const result = FieldMappingUpdateSchema.safeParse({
      question_id: '550e8400-e29b-41d4-a716-446655440000',
      mapping_status: 'manual',
    });
    expect(result.success).toBe(true);
  });

  it('validates unmapped status with null question_id', () => {
    const result = FieldMappingUpdateSchema.safeParse({
      question_id: null,
      mapping_status: 'unmapped',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid mapping_status', () => {
    const result = FieldMappingUpdateSchema.safeParse({
      question_id: null,
      mapping_status: 'invalid_status',
    });
    expect(result.success).toBe(false);
  });

  it('rejects unreviewed as a user-settable status', () => {
    const result = FieldMappingUpdateSchema.safeParse({
      question_id: null,
      mapping_status: 'unreviewed',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid question_id format', () => {
    const result = FieldMappingUpdateSchema.safeParse({
      question_id: 'not-a-uuid',
      mapping_status: 'confirmed',
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// BulkFieldMappingSchema
// ---------------------------------------------------------------------------

describe('BulkFieldMappingSchema', () => {
  it('validates a single mapping', () => {
    const result = BulkFieldMappingSchema.safeParse({
      mappings: [
        {
          field_id: '550e8400-e29b-41d4-a716-446655440000',
          question_id: '550e8400-e29b-41d4-a716-446655440001',
          mapping_status: 'confirmed',
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('validates multiple mappings', () => {
    const result = BulkFieldMappingSchema.safeParse({
      mappings: [
        {
          field_id: '550e8400-e29b-41d4-a716-446655440000',
          question_id: '550e8400-e29b-41d4-a716-446655440001',
          mapping_status: 'confirmed',
        },
        {
          field_id: '550e8400-e29b-41d4-a716-446655440002',
          question_id: null,
          mapping_status: 'rejected',
        },
        {
          field_id: '550e8400-e29b-41d4-a716-446655440003',
          question_id: '550e8400-e29b-41d4-a716-446655440004',
          mapping_status: 'manual',
        },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.mappings).toHaveLength(3);
    }
  });

  it('rejects empty mappings array', () => {
    const result = BulkFieldMappingSchema.safeParse({
      mappings: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects mapping with invalid field_id', () => {
    const result = BulkFieldMappingSchema.safeParse({
      mappings: [
        {
          field_id: 'not-a-uuid',
          question_id: null,
          mapping_status: 'rejected',
        },
      ],
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// TemplateFillBodySchema
// ---------------------------------------------------------------------------

describe('TemplateFillBodySchema', () => {
  it('validates with all defaults', () => {
    const result = TemplateFillBodySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.skip_unmapped).toBe(true);
      expect(result.data.skip_unapproved).toBe(false);
      expect(result.data.fallback_to_draft).toBe(true);
      expect(result.data.response_variant).toBe('standard');
    }
  });

  it('validates with custom options', () => {
    const result = TemplateFillBodySchema.safeParse({
      skip_unmapped: false,
      skip_unapproved: true,
      fallback_to_draft: false,
      response_variant: 'advanced',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.skip_unmapped).toBe(false);
      expect(result.data.skip_unapproved).toBe(true);
      expect(result.data.fallback_to_draft).toBe(false);
      expect(result.data.response_variant).toBe('advanced');
    }
  });

  it('rejects invalid response_variant', () => {
    const result = TemplateFillBodySchema.safeParse({
      response_variant: 'premium',
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AutoMapBodySchema
// ---------------------------------------------------------------------------

describe('AutoMapBodySchema', () => {
  it('validates with default threshold', () => {
    const result = AutoMapBodySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.threshold).toBe(0.7);
    }
  });

  it('validates with custom threshold', () => {
    const result = AutoMapBodySchema.safeParse({ threshold: 0.5 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.threshold).toBe(0.5);
    }
  });

  it('validates threshold at boundaries', () => {
    expect(AutoMapBodySchema.safeParse({ threshold: 0 }).success).toBe(true);
    expect(AutoMapBodySchema.safeParse({ threshold: 1 }).success).toBe(true);
  });

  it('rejects threshold above 1.0', () => {
    const result = AutoMapBodySchema.safeParse({ threshold: 1.1 });
    expect(result.success).toBe(false);
  });

  it('rejects threshold below 0.0', () => {
    const result = AutoMapBodySchema.safeParse({ threshold: -0.1 });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('Template constants', () => {
  it('TEMPLATE_STATUSES contains all expected values', () => {
    expect(TEMPLATE_STATUSES).toEqual([
      'uploaded', 'analysing', 'analysed', 'analysis_failed',
      'filling', 'completed', 'fill_failed',
    ]);
  });

  it('FIELD_TYPES contains all expected values', () => {
    expect(FIELD_TYPES).toEqual(['empty_cell', 'placeholder', 'highlighted']);
  });

  it('MAPPING_STATUSES contains all expected values', () => {
    expect(MAPPING_STATUSES).toEqual([
      'unreviewed', 'confirmed', 'rejected', 'manual', 'unmapped',
    ]);
  });

  it('FILL_STATUSES contains all expected values', () => {
    expect(FILL_STATUSES).toEqual(['pending', 'filled', 'skipped', 'failed']);
  });
});
