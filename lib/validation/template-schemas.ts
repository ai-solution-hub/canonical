import { z } from 'zod';

// ──────────────────────────────────────────
// Template Status Constants
// ──────────────────────────────────────────

export const TEMPLATE_STATUSES = [
  'uploaded', 'analysing', 'analysed', 'analysis_failed',
  'filling', 'completed', 'fill_failed',
] as const;

export type TemplateStatus = typeof TEMPLATE_STATUSES[number];

export const FIELD_TYPES = ['empty_cell', 'placeholder', 'highlighted'] as const;
export type FieldType = typeof FIELD_TYPES[number];

export const MAPPING_STATUSES = [
  'unreviewed', 'confirmed', 'rejected', 'manual', 'unmapped',
] as const;
export type MappingStatus = typeof MAPPING_STATUSES[number];

export const FILL_STATUSES = ['pending', 'filled', 'skipped', 'failed'] as const;
export type FillStatus = typeof FILL_STATUSES[number];

// ──────────────────────────────────────────
// Template Upload
// ──────────────────────────────────────────

export const TemplateUploadBodySchema = z.object({
  project_id: z.string().uuid('Invalid workspace ID'),
  name: z.string().min(1, 'Template name is required').max(200),
  description: z.string().max(1000).optional(),
});

export type TemplateUploadBody = z.infer<typeof TemplateUploadBodySchema>;

// ──────────────────────────────────────────
// Field Mapping Update (Single)
// ──────────────────────────────────────────

export const FieldMappingUpdateSchema = z.object({
  question_id: z.string().uuid().nullable(),
  mapping_status: z.enum(['confirmed', 'rejected', 'manual', 'unmapped']),
});

export type FieldMappingUpdate = z.infer<typeof FieldMappingUpdateSchema>;

// ──────────────────────────────────────────
// Bulk Field Mapping
// ──────────────────────────────────────────

export const BulkFieldMappingSchema = z.object({
  mappings: z.array(z.object({
    field_id: z.string().uuid(),
    question_id: z.string().uuid().nullable(),
    mapping_status: z.enum(['confirmed', 'rejected', 'manual', 'unmapped']),
  })).min(1, 'At least one mapping required'),
});

export type BulkFieldMapping = z.infer<typeof BulkFieldMappingSchema>;

// ──────────────────────────────────────────
// Template Fill Request
// ──────────────────────────────────────────

export const TemplateFillBodySchema = z.object({
  skip_unmapped: z.boolean().default(true),
  skip_unapproved: z.boolean().default(false),
  fallback_to_draft: z.boolean().default(true),
  response_variant: z.enum(['standard', 'advanced']).default('standard'),
});

export type TemplateFillBody = z.infer<typeof TemplateFillBodySchema>;

// ──────────────────────────────────────────
// Auto-Map Request
// ──────────────────────────────────────────

export const AutoMapBodySchema = z.object({
  threshold: z.number().min(0).max(1).default(0.7),
});

export type AutoMapBody = z.infer<typeof AutoMapBodySchema>;
