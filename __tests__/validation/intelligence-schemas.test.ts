/**
 * Zod schema tests for Sector Intelligence validation schemas.
 *
 * Schemas tested:
 *   CompanyProfileCreateSchema
 *   CompanyProfileUpdateSchema
 *   FeedSourceCreateSchema
 *   FeedSourceUpdateSchema
 *   FeedFlagCreateSchema
 *   FeedPromptCreateSchema
 *   IntelligenceWorkspaceCreateSchema
 */
import { describe, it, expect } from 'vitest';
import {
  CompanyProfileCreateSchema,
  CompanyProfileUpdateSchema,
  FeedSourceCreateSchema,
  FeedSourceUpdateSchema,
  FeedFlagCreateSchema,
  FeedPromptCreateSchema,
  IntelligenceWorkspaceCreateSchema,
} from '@/lib/validation/schemas';

// ---------------------------------------------------------------------------
// CompanyProfileCreateSchema
// ---------------------------------------------------------------------------

describe('CompanyProfileCreateSchema', () => {
  const VALID_INPUT = {
    name: 'example-client Design',
    slug: 'example-client-design',
    sectors: ['education'],
    key_topics: ['KCSIE'],
  };

  it('accepts valid minimal input', () => {
    const result = CompanyProfileCreateSchema.safeParse(VALID_INPUT);
    expect(result.success).toBe(true);
  });

  it('accepts valid full input', () => {
    const result = CompanyProfileCreateSchema.safeParse({
      ...VALID_INPUT,
      description: 'A consultancy',
      website_url: 'https://example.com',
      services: ['consultancy', 'training'],
      certifications: ['ISO 27001'],
      geographic_scope: ['UK'],
      competitors: [
        { name: 'Acme Corp', website: 'https://acme.com', notes: 'Main rival' },
      ],
      target_customers: 'Multi-academy trusts',
      value_proposition: 'Specialist safeguarding solutions',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing name', () => {
    const { name: _, ...rest } = VALID_INPUT;
    const result = CompanyProfileCreateSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects missing slug', () => {
    const { slug: _, ...rest } = VALID_INPUT;
    const result = CompanyProfileCreateSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects invalid slug format (uppercase)', () => {
    const result = CompanyProfileCreateSchema.safeParse({
      ...VALID_INPUT,
      slug: 'Invalid-Slug',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid slug format (spaces)', () => {
    const result = CompanyProfileCreateSchema.safeParse({
      ...VALID_INPUT,
      slug: 'has spaces',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty sectors array', () => {
    const result = CompanyProfileCreateSchema.safeParse({
      ...VALID_INPUT,
      sectors: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty key_topics array', () => {
    const result = CompanyProfileCreateSchema.safeParse({
      ...VALID_INPUT,
      key_topics: [],
    });
    expect(result.success).toBe(false);
  });

  it('defaults optional arrays to empty', () => {
    const result = CompanyProfileCreateSchema.safeParse(VALID_INPUT);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.services).toEqual([]);
      expect(result.data.certifications).toEqual([]);
      expect(result.data.geographic_scope).toEqual([]);
      expect(result.data.competitors).toEqual([]);
    }
  });

  it('accepts empty string for website_url', () => {
    const result = CompanyProfileCreateSchema.safeParse({
      ...VALID_INPUT,
      website_url: '',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid website_url', () => {
    const result = CompanyProfileCreateSchema.safeParse({
      ...VALID_INPUT,
      website_url: 'not-a-url',
    });
    expect(result.success).toBe(false);
  });

  it('rejects name exceeding max length', () => {
    const result = CompanyProfileCreateSchema.safeParse({
      ...VALID_INPUT,
      name: 'x'.repeat(201),
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// CompanyProfileUpdateSchema
// ---------------------------------------------------------------------------

describe('CompanyProfileUpdateSchema', () => {
  it('accepts partial updates', () => {
    const result = CompanyProfileUpdateSchema.safeParse({
      name: 'Updated Name',
    });
    expect(result.success).toBe(true);
  });

  it('accepts empty object (no changes)', () => {
    const result = CompanyProfileUpdateSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('still validates field constraints', () => {
    const result = CompanyProfileUpdateSchema.safeParse({
      slug: 'Invalid Slug!',
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// FeedSourceCreateSchema
// ---------------------------------------------------------------------------

describe('FeedSourceCreateSchema', () => {
  const VALID_SOURCE = {
    name: 'Gov UK RSS',
    url: 'https://www.gov.uk/feed',
  };

  it('accepts valid minimal input', () => {
    const result = FeedSourceCreateSchema.safeParse(VALID_SOURCE);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.source_type).toBe('rss');
      expect(result.data.polling_interval_minutes).toBe(30);
      expect(result.data.is_active).toBe(true);
    }
  });

  it('accepts valid full input', () => {
    const result = FeedSourceCreateSchema.safeParse({
      ...VALID_SOURCE,
      source_type: 'web',
      polling_interval_minutes: 60,
      is_active: false,
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing name', () => {
    const result = FeedSourceCreateSchema.safeParse({
      url: 'https://example.com/feed',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid URL', () => {
    const result = FeedSourceCreateSchema.safeParse({
      ...VALID_SOURCE,
      url: 'not-a-url',
    });
    expect(result.success).toBe(false);
  });

  it('rejects polling interval below minimum', () => {
    const result = FeedSourceCreateSchema.safeParse({
      ...VALID_SOURCE,
      polling_interval_minutes: 2,
    });
    expect(result.success).toBe(false);
  });

  it('rejects polling interval above maximum', () => {
    const result = FeedSourceCreateSchema.safeParse({
      ...VALID_SOURCE,
      polling_interval_minutes: 2000,
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid source_type', () => {
    const result = FeedSourceCreateSchema.safeParse({
      ...VALID_SOURCE,
      source_type: 'ftp',
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// FeedSourceUpdateSchema
// ---------------------------------------------------------------------------

describe('FeedSourceUpdateSchema', () => {
  it('accepts partial updates', () => {
    const result = FeedSourceUpdateSchema.safeParse({ name: 'Updated Source' });
    expect(result.success).toBe(true);
  });

  it('accepts empty object', () => {
    const result = FeedSourceUpdateSchema.safeParse({});
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// FeedFlagCreateSchema
// ---------------------------------------------------------------------------

describe('FeedFlagCreateSchema', () => {
  it('accepts false_positive flag', () => {
    const result = FeedFlagCreateSchema.safeParse({
      flag_type: 'false_positive',
    });
    expect(result.success).toBe(true);
  });

  it('accepts false_negative flag', () => {
    const result = FeedFlagCreateSchema.safeParse({
      flag_type: 'false_negative',
    });
    expect(result.success).toBe(true);
  });

  it('accepts flag with notes', () => {
    const result = FeedFlagCreateSchema.safeParse({
      flag_type: 'false_positive',
      notes: 'This article is about cooking, not education',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid flag type', () => {
    const result = FeedFlagCreateSchema.safeParse({ flag_type: 'invalid' });
    expect(result.success).toBe(false);
  });

  it('rejects notes exceeding max length', () => {
    const result = FeedFlagCreateSchema.safeParse({
      flag_type: 'false_positive',
      notes: 'x'.repeat(1001),
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// FeedPromptCreateSchema
// ---------------------------------------------------------------------------

describe('FeedPromptCreateSchema', () => {
  it('accepts valid prompt', () => {
    const result = FeedPromptCreateSchema.safeParse({
      prompt_text:
        'Score articles about education policy higher, especially those mentioning safeguarding.',
    });
    expect(result.success).toBe(true);
  });

  it('rejects prompt below minimum length', () => {
    const result = FeedPromptCreateSchema.safeParse({
      prompt_text: 'Too short',
    });
    expect(result.success).toBe(false);
  });

  it('rejects prompt exceeding max length', () => {
    const result = FeedPromptCreateSchema.safeParse({
      prompt_text: 'x'.repeat(10001),
    });
    expect(result.success).toBe(false);
  });

  it('accepts prompt with change notes', () => {
    const result = FeedPromptCreateSchema.safeParse({
      prompt_text:
        'Score articles about education policy higher, especially those mentioning safeguarding.',
      change_notes: 'Added safeguarding emphasis after false negatives.',
    });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// IntelligenceWorkspaceCreateSchema
// ---------------------------------------------------------------------------

describe('IntelligenceWorkspaceCreateSchema', () => {
  const VALID_UUID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

  it('accepts valid input', () => {
    const result = IntelligenceWorkspaceCreateSchema.safeParse({
      name: 'Education Monitor',
      company_profile_id: VALID_UUID,
    });
    expect(result.success).toBe(true);
  });

  it('accepts input with optional description', () => {
    const result = IntelligenceWorkspaceCreateSchema.safeParse({
      name: 'Education Monitor',
      description: 'Monitors education sector news',
      company_profile_id: VALID_UUID,
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing name', () => {
    const result = IntelligenceWorkspaceCreateSchema.safeParse({
      company_profile_id: VALID_UUID,
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing company_profile_id', () => {
    const result = IntelligenceWorkspaceCreateSchema.safeParse({
      name: 'Education Monitor',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid UUID for company_profile_id', () => {
    const result = IntelligenceWorkspaceCreateSchema.safeParse({
      name: 'Education Monitor',
      company_profile_id: 'not-a-uuid',
    });
    expect(result.success).toBe(false);
  });
});
