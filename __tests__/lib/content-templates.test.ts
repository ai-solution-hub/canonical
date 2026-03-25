import { describe, it, expect } from 'vitest';
import {
  CONTENT_TEMPLATES,
  type ContentTemplate,
} from '@/lib/content-templates';
import { VALID_CONTENT_TYPES } from '@/lib/validation/schemas';

describe('CONTENT_TEMPLATES', () => {
  // -------------------------------------------------------------------------
  // Required fields
  // -------------------------------------------------------------------------

  it('all templates have required fields', () => {
    for (const template of CONTENT_TEMPLATES) {
      expect(template.id).toBeTruthy();
      expect(template.slug).toBeTruthy();
      expect(template.name).toBeTruthy();
      expect(template.description).toBeTruthy();
      expect(template.contentType).toBeTruthy();
      // titleTemplate and contentTemplate can be empty strings
      expect(typeof template.titleTemplate).toBe('string');
      expect(typeof template.contentTemplate).toBe('string');
    }
  });

  it('id is a non-empty string for every template', () => {
    for (const template of CONTENT_TEMPLATES) {
      expect(typeof template.id).toBe('string');
      expect(template.id.length).toBeGreaterThan(0);
    }
  });

  it('slug is a non-empty string for every template', () => {
    for (const template of CONTENT_TEMPLATES) {
      expect(typeof template.slug).toBe('string');
      expect(template.slug.length).toBeGreaterThan(0);
    }
  });

  it('name is a non-empty string for every template', () => {
    for (const template of CONTENT_TEMPLATES) {
      expect(typeof template.name).toBe('string');
      expect(template.name.length).toBeGreaterThan(0);
    }
  });

  it('description is a non-empty string for every template', () => {
    for (const template of CONTENT_TEMPLATES) {
      expect(typeof template.description).toBe('string');
      expect(template.description.length).toBeGreaterThan(0);
    }
  });

  // -------------------------------------------------------------------------
  // Uniqueness
  // -------------------------------------------------------------------------

  it('has no duplicate slugs', () => {
    const slugs = CONTENT_TEMPLATES.map((t) => t.slug);
    const uniqueSlugs = new Set(slugs);
    expect(uniqueSlugs.size).toBe(slugs.length);
  });

  it('has no duplicate ids', () => {
    const ids = CONTENT_TEMPLATES.map((t) => t.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  // -------------------------------------------------------------------------
  // Content type validity
  // -------------------------------------------------------------------------

  it('all contentType values are in VALID_CONTENT_TYPES', () => {
    const validTypes = VALID_CONTENT_TYPES as readonly string[];
    for (const template of CONTENT_TEMPLATES) {
      expect(validTypes).toContain(template.contentType);
    }
  });

  // -------------------------------------------------------------------------
  // Optional fields
  // -------------------------------------------------------------------------

  it('defaultTags is an array when present', () => {
    for (const template of CONTENT_TEMPLATES) {
      if (template.defaultTags !== undefined) {
        expect(Array.isArray(template.defaultTags)).toBe(true);
      }
    }
  });

  it('suggestedDomain is a string when present', () => {
    for (const template of CONTENT_TEMPLATES) {
      if (template.suggestedDomain !== undefined) {
        expect(typeof template.suggestedDomain).toBe('string');
      }
    }
  });

  it('briefTemplate is a string when present', () => {
    for (const template of CONTENT_TEMPLATES) {
      if (template.briefTemplate !== undefined) {
        expect(typeof template.briefTemplate).toBe('string');
      }
    }
  });

  // -------------------------------------------------------------------------
  // Specific templates exist
  // -------------------------------------------------------------------------

  it('contains at least 5 templates', () => {
    expect(CONTENT_TEMPLATES.length).toBeGreaterThanOrEqual(5);
  });

  it('has a policy template', () => {
    const policy = CONTENT_TEMPLATES.find((t) => t.slug === 'policy');
    expect(policy).toBeDefined();
    expect(policy!.contentType).toBe('policy');
  });

  it('has a case-study template', () => {
    const caseStudy = CONTENT_TEMPLATES.find((t) => t.slug === 'case-study');
    expect(caseStudy).toBeDefined();
    expect(caseStudy!.contentType).toBe('case_study');
  });

  it('has a capability template', () => {
    const capability = CONTENT_TEMPLATES.find((t) => t.slug === 'capability');
    expect(capability).toBeDefined();
    expect(capability!.contentType).toBe('capability');
  });

  it('has a methodology template', () => {
    const methodology = CONTENT_TEMPLATES.find((t) => t.slug === 'methodology');
    expect(methodology).toBeDefined();
    expect(methodology!.contentType).toBe('methodology');
  });

  it('has a qa-pair template', () => {
    const qaPair = CONTENT_TEMPLATES.find((t) => t.slug === 'qa-pair');
    expect(qaPair).toBeDefined();
    expect(qaPair!.contentType).toBe('q_a_pair');
  });

  // -------------------------------------------------------------------------
  // ContentTemplate interface compliance
  // -------------------------------------------------------------------------

  it('exports satisfy the ContentTemplate interface', () => {
    // Type-level check — if this compiles, the interface is satisfied
    const templates: ContentTemplate[] = CONTENT_TEMPLATES;
    expect(templates).toBeDefined();
  });
});
