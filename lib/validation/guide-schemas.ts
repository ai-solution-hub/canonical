import { z } from 'zod';
import { getLayerSchema } from './layer-schemas';

export const VALID_GUIDE_TYPES = [
  'sector',
  'product',
  'company',
  'research',
  'custom',
] as const;

export const guideCreateSchema = z.object({
  name: z.string().min(1).max(200),
  slug: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9-]+$/),
  description: z.string().max(1000).optional(),
  guide_type: z.enum(VALID_GUIDE_TYPES),
  domain_filter: z.string().optional(),
  icon: z.string().max(50).optional(),
  color: z.string().max(20).optional(),
  display_order: z.number().int().min(0).default(0),
  is_published: z.boolean().default(false),
});

export const guideUpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  slug: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9-]+$/)
    .optional(),
  description: z.string().max(1000).nullable().optional(),
  guide_type: z.enum(VALID_GUIDE_TYPES).optional(),
  domain_filter: z.string().nullable().optional(),
  icon: z.string().max(50).nullable().optional(),
  color: z.string().max(20).nullable().optional(),
  display_order: z.number().int().min(0).optional(),
  is_published: z.boolean().optional(),
});

export const guideSectionSchema = z.object({
  section_name: z.string().min(1).max(200),
  description: z.string().max(1000).optional().nullable(),
  expected_layer: getLayerSchema().optional().nullable(),
  subtopic_filter: z.string().optional().nullable(),
  content_type_filter: z.string().optional().nullable(),
  display_order: z.number().int().min(0),
  is_required: z.boolean().default(true),
});

export const guideSectionUpdateSchema = z.object({
  section_name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).nullable().optional(),
  expected_layer: getLayerSchema().nullable().optional(),
  subtopic_filter: z.string().nullable().optional(),
  content_type_filter: z.string().nullable().optional(),
  display_order: z.number().int().min(0).optional(),
  is_required: z.boolean().optional(),
});

export const guideSectionsReorderSchema = z.object({
  sections: z.array(
    z.object({
      id: z.string().uuid(),
      display_order: z.number().int().min(0),
    }),
  ),
});
