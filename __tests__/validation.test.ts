import { describe, it, expect } from 'vitest';
import {
  validateEditableField,
  EDITABLE_FIELDS,
  VALID_CONTENT_TYPES,
  VALID_PLATFORMS,
  VALID_REVIEW_ACTIONS,
} from '@/lib/validation/schemas';

describe('validateEditableField', () => {
  it('should return true for all fields in EDITABLE_FIELDS set', () => {
    const editableFields = [
      'suggested_title',
      'ai_keywords',
      'primary_domain',
      'primary_subtopic',
      'secondary_domain',
      'secondary_subtopic',
      'ai_summary',
      'author_name',
      'content_type',
      'platform',
    ];
    for (const field of editableFields) {
      expect(validateEditableField(field)).toBe(true);
    }
  });

  it('should return false for non-editable fields', () => {
    const nonEditableFields = [
      'id',
      'created_at',
      'embedding',
      'url',
      'content',
      'metadata',
      'captured_date',
      'classification_confidence',
    ];
    for (const field of nonEditableFields) {
      expect(validateEditableField(field)).toBe(false);
    }
  });

  it('should return false for empty string', () => {
    expect(validateEditableField('')).toBe(false);
  });

  it('should return false for fields with wrong casing', () => {
    expect(validateEditableField('Suggested_Title')).toBe(false);
    expect(validateEditableField('AI_KEYWORDS')).toBe(false);
  });
});

describe('EDITABLE_FIELDS set', () => {
  it('should contain exactly 12 fields', () => {
    expect(EDITABLE_FIELDS.size).toBe(12);
  });

  it('should be a Set instance', () => {
    expect(EDITABLE_FIELDS).toBeInstanceOf(Set);
  });
});

describe('constant arrays', () => {
  it('VALID_CONTENT_TYPES should contain 15 types', () => {
    expect(VALID_CONTENT_TYPES).toHaveLength(15);
  });

  it('VALID_CONTENT_TYPES should include key types', () => {
    expect(VALID_CONTENT_TYPES).toContain('post');
    expect(VALID_CONTENT_TYPES).toContain('article');
    expect(VALID_CONTENT_TYPES).toContain('transcript');
    expect(VALID_CONTENT_TYPES).toContain('product-page');
    expect(VALID_CONTENT_TYPES).toContain('other');
  });

  it('VALID_PLATFORMS should contain 7 platforms', () => {
    expect(VALID_PLATFORMS).toHaveLength(7);
  });

  it('VALID_PLATFORMS should include key platforms', () => {
    expect(VALID_PLATFORMS).toContain('linkedin');
    expect(VALID_PLATFORMS).toContain('youtube');
    expect(VALID_PLATFORMS).toContain('web');
    expect(VALID_PLATFORMS).toContain('email');
  });

  it('VALID_REVIEW_ACTIONS should contain 5 actions', () => {
    expect(VALID_REVIEW_ACTIONS).toHaveLength(5);
  });

  it('VALID_REVIEW_ACTIONS should include read, skip, star and undos', () => {
    expect(VALID_REVIEW_ACTIONS).toContain('read');
    expect(VALID_REVIEW_ACTIONS).toContain('skip');
    expect(VALID_REVIEW_ACTIONS).toContain('star');
    expect(VALID_REVIEW_ACTIONS).toContain('undo_read');
    expect(VALID_REVIEW_ACTIONS).toContain('undo_star');
  });
});
