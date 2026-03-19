/**
 * CreateContentFormSchema Tests
 *
 * Validates the Zod schema used for client-side form validation
 * of the create content form (React Hook Form + Zod).
 */
import { describe, it, expect } from 'vitest';
import {
  CreateContentFormSchema,
  CREATE_CONTENT_DEFAULTS,
} from '@/lib/validation/create-content-schema';
import type { CreateContentFormValues } from '@/lib/validation/create-content-schema';

function validData(overrides: Partial<CreateContentFormValues> = {}): CreateContentFormValues {
  return {
    ...CREATE_CONTENT_DEFAULTS,
    title: 'Test Title',
    content: '<p>Some content</p>',
    content_type: 'article',
    ...overrides,
  };
}

describe('CreateContentFormSchema', () => {
  describe('required fields', () => {
    it('accepts valid data with all required fields', () => {
      const result = CreateContentFormSchema.safeParse(validData());
      expect(result.success).toBe(true);
    });

    it('rejects empty title', () => {
      const result = CreateContentFormSchema.safeParse(validData({ title: '' }));
      expect(result.success).toBe(false);
      if (!result.success) {
        const titleError = result.error.issues.find((i) => i.path.includes('title'));
        expect(titleError).toBeDefined();
        expect(titleError?.message).toContain('Title is required');
      }
    });

    it('rejects whitespace-only title', () => {
      const result = CreateContentFormSchema.safeParse(validData({ title: '   ' }));
      expect(result.success).toBe(false);
    });

    it('rejects empty content', () => {
      const result = CreateContentFormSchema.safeParse(validData({ content: '' }));
      expect(result.success).toBe(false);
    });

    it('rejects empty content_type', () => {
      const result = CreateContentFormSchema.safeParse(validData({ content_type: '' }));
      expect(result.success).toBe(false);
    });

    it('rejects invalid content_type', () => {
      const result = CreateContentFormSchema.safeParse(validData({ content_type: 'not_a_type' }));
      expect(result.success).toBe(false);
    });
  });

  describe('content types', () => {
    const validTypes = [
      'article', 'blog', 'pdf', 'note', 'research', 'other',
      'q_a_pair', 'case_study', 'policy', 'certification',
      'compliance', 'methodology', 'capability', 'product_description',
    ];

    it.each(validTypes)('accepts content type: %s', (type) => {
      const result = CreateContentFormSchema.safeParse(validData({ content_type: type }));
      expect(result.success).toBe(true);
    });
  });

  describe('optional fields', () => {
    it('accepts empty optional fields', () => {
      const result = CreateContentFormSchema.safeParse(validData());
      expect(result.success).toBe(true);
    });

    it('accepts all optional fields filled', () => {
      const result = CreateContentFormSchema.safeParse(
        validData({
          primary_domain: 'Corporate',
          primary_subtopic: 'Company History',
          keywords_input: 'test, keyword',
          author_name: 'Test Author',
          source_url: 'https://example.com',
          priority: 'high',
          user_tags: ['tag1', 'tag2'],
          brief: 'A brief summary',
          detail: 'Detailed explanation',
          reference: 'Technical reference',
        }),
      );
      expect(result.success).toBe(true);
    });
  });

  describe('source URL validation', () => {
    it('accepts valid https URL', () => {
      const result = CreateContentFormSchema.safeParse(
        validData({ source_url: 'https://example.com/page' }),
      );
      expect(result.success).toBe(true);
    });

    it('accepts valid http URL', () => {
      const result = CreateContentFormSchema.safeParse(
        validData({ source_url: 'http://example.com' }),
      );
      expect(result.success).toBe(true);
    });

    it('accepts empty source URL', () => {
      const result = CreateContentFormSchema.safeParse(validData({ source_url: '' }));
      expect(result.success).toBe(true);
    });

    it('rejects non-URL string', () => {
      const result = CreateContentFormSchema.safeParse(
        validData({ source_url: 'not-a-url' }),
      );
      expect(result.success).toBe(false);
    });
  });

  describe('max lengths', () => {
    it('rejects title over 500 characters', () => {
      const result = CreateContentFormSchema.safeParse(
        validData({ title: 'a'.repeat(501) }),
      );
      expect(result.success).toBe(false);
    });

    it('rejects brief over 5000 characters', () => {
      const result = CreateContentFormSchema.safeParse(
        validData({ brief: 'a'.repeat(5001) }),
      );
      expect(result.success).toBe(false);
    });

    it('rejects detail over 50000 characters', () => {
      const result = CreateContentFormSchema.safeParse(
        validData({ detail: 'a'.repeat(50001) }),
      );
      expect(result.success).toBe(false);
    });
  });

  describe('priority enum', () => {
    it.each(['', 'high', 'medium', 'low'])('accepts priority: "%s"', (p) => {
      const result = CreateContentFormSchema.safeParse(
        validData({ priority: p as '' | 'high' | 'medium' | 'low' }),
      );
      expect(result.success).toBe(true);
    });

    it('rejects invalid priority', () => {
      const result = CreateContentFormSchema.safeParse(
        validData({ priority: 'critical' as 'high' }),
      );
      expect(result.success).toBe(false);
    });
  });

  describe('defaults', () => {
    it('CREATE_CONTENT_DEFAULTS has correct boolean defaults', () => {
      expect(CREATE_CONTENT_DEFAULTS.auto_classify).toBe(true);
      expect(CREATE_CONTENT_DEFAULTS.auto_summarise).toBe(true);
      expect(CREATE_CONTENT_DEFAULTS.save_as_draft).toBe(false);
    });

    it('CREATE_CONTENT_DEFAULTS has empty arrays and strings', () => {
      expect(CREATE_CONTENT_DEFAULTS.user_tags).toEqual([]);
      expect(CREATE_CONTENT_DEFAULTS.title).toBe('');
      expect(CREATE_CONTENT_DEFAULTS.content).toBe('');
      expect(CREATE_CONTENT_DEFAULTS.content_type).toBe('');
    });
  });
});
