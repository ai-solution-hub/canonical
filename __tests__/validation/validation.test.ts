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
      'summary',
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
  it('should contain exactly 21 fields', () => {
    expect(EDITABLE_FIELDS.size).toBe(21);
  });

  it('should be a Set instance', () => {
    expect(EDITABLE_FIELDS).toBeInstanceOf(Set);
  });
});

describe('constant arrays', () => {
  it('VALID_CONTENT_TYPES should contain 15 KB types', () => {
    expect(VALID_CONTENT_TYPES).toHaveLength(15);
  });

  it('VALID_CONTENT_TYPES should include key types', () => {
    expect(VALID_CONTENT_TYPES).toContain('article');
    expect(VALID_CONTENT_TYPES).toContain('pdf');
    expect(VALID_CONTENT_TYPES).toContain('other');
    expect(VALID_CONTENT_TYPES).toContain('q_a_pair');
    expect(VALID_CONTENT_TYPES).toContain('case_study');
    expect(VALID_CONTENT_TYPES).toContain('policy');
    expect(VALID_CONTENT_TYPES).toContain('certification');
    expect(VALID_CONTENT_TYPES).toContain('compliance');
    expect(VALID_CONTENT_TYPES).toContain('methodology');
    expect(VALID_CONTENT_TYPES).toContain('capability');
    expect(VALID_CONTENT_TYPES).toContain('product_description');
  });

  it('VALID_CONTENT_TYPES should not include removed IMS types', () => {
    expect(VALID_CONTENT_TYPES).not.toContain('post');
    expect(VALID_CONTENT_TYPES).not.toContain('podcast');
    expect(VALID_CONTENT_TYPES).not.toContain('video');
    expect(VALID_CONTENT_TYPES).not.toContain('transcript');
    expect(VALID_CONTENT_TYPES).not.toContain('product-page');
    expect(VALID_CONTENT_TYPES).not.toContain('newsletter');
    expect(VALID_CONTENT_TYPES).not.toContain('bookmark');
    expect(VALID_CONTENT_TYPES).not.toContain('comment');
    expect(VALID_CONTENT_TYPES).not.toContain('course');
  });

  it('VALID_PLATFORMS should contain 6 platforms', () => {
    expect(VALID_PLATFORMS).toHaveLength(6);
  });

  it('VALID_PLATFORMS should include key platforms', () => {
    expect(VALID_PLATFORMS).toContain('web');
    expect(VALID_PLATFORMS).toContain('email');
    expect(VALID_PLATFORMS).toContain('manual');
    expect(VALID_PLATFORMS).toContain('upload');
    expect(VALID_PLATFORMS).toContain('extraction');
    expect(VALID_PLATFORMS).toContain('other');
  });

  it('VALID_REVIEW_ACTIONS should contain 5 actions', () => {
    expect(VALID_REVIEW_ACTIONS).toHaveLength(5);
  });

  it('VALID_REVIEW_ACTIONS should include verify, flag, skip, unverify and unflag', () => {
    expect(VALID_REVIEW_ACTIONS).toContain('verify');
    expect(VALID_REVIEW_ACTIONS).toContain('flag');
    expect(VALID_REVIEW_ACTIONS).toContain('skip');
    expect(VALID_REVIEW_ACTIONS).toContain('unverify');
    expect(VALID_REVIEW_ACTIONS).toContain('unflag');
  });
});
