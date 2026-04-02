import { z } from 'zod';
import { VALID_CONTENT_TYPES } from './schemas';

/**
 * Client-side Zod schema for the Create Content form.
 *
 * This mirrors ItemCreateBodySchema from schemas.ts but is tailored for
 * React Hook Form validation on the client. The API schema remains the
 * source of truth for server-side validation.
 *
 * All fields use concrete types (no optional) to match RHF's defaultValues.
 * Optional fields default to empty string / empty array / boolean false.
 */
export const CreateContentFormSchema = z.object({
  // Required fields
  title: z
    .string()
    .trim()
    .min(1, 'Title is required')
    .max(500, 'Title must be at most 500 characters'),
  content: z
    .string()
    .min(1, 'Content is required')
    .max(500_000, 'Content exceeds maximum length'),
  content_type: z
    .string()
    .min(1, 'Content type is required')
    .refine(
      (val) => (VALID_CONTENT_TYPES as readonly string[]).includes(val),
      'Invalid content type',
    ),

  // Optional classification — validated but allowed to be empty
  primary_domain: z.string().max(200),
  primary_subtopic: z.string().max(200),
  keywords_input: z.string(),

  // Optional provenance
  author_name: z.string().max(200),
  source_url: z
    .string()
    .max(2000)
    .refine(
      (val) => !val || val.startsWith('http://') || val.startsWith('https://'),
      'Must be a valid URL starting with http:// or https://',
    ),
  priority: z.enum(['', 'high', 'medium', 'low']),
  user_tags: z.array(z.string().max(100)).max(50),
  tags_input: z.string(),

  // Progressive depth
  brief: z.string().max(5000, 'Brief must be at most 5,000 characters'),
  detail: z.string().max(50_000, 'Detail must be at most 50,000 characters'),
  reference: z
    .string()
    .max(50_000, 'Reference must be at most 50,000 characters'),

  // AI options
  auto_classify: z.boolean(),
  auto_summarise: z.boolean(),

  // Governance
  save_as_draft: z.boolean(),
});

export type CreateContentFormValues = z.infer<typeof CreateContentFormSchema>;

/**
 * Default form values for a fresh create content form.
 */
export const CREATE_CONTENT_DEFAULTS: CreateContentFormValues = {
  title: '',
  content: '',
  content_type: '',
  primary_domain: '',
  primary_subtopic: '',
  keywords_input: '',
  author_name: '',
  source_url: '',
  priority: '',
  user_tags: [],
  tags_input: '',
  brief: '',
  detail: '',
  reference: '',
  auto_classify: true,
  auto_summarise: true,
  save_as_draft: false,
};
