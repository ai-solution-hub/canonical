import { describe, it, expect } from 'vitest';
import {
  VALID_CONTENT_TYPES,
  VALID_REVIEW_ACTIONS,
} from '@/lib/validation/schemas';

// (validateEditableField / EDITABLE_FIELDS tests removed — id-417: the
// inline-editing allowlist was deleted with its content_items-era editor.)

describe('constant arrays', () => {
  // ID-133 BI-3 (UNRATIFIED — see scripts/cocoindex_pipeline/extraction.py):
  // content_type trimmed from 15 to 7. q_a_pair migrated
  // out to its own Layer-5 class (32-q-a-pair.md); case_study/policy/
  // certification/compliance/methodology/capability/product_description
  // moved to the L-concept type discriminators (37-concept-type.md).
  it('VALID_CONTENT_TYPES should contain 7 KB types (BI-3 stay-set)', () => {
    expect(VALID_CONTENT_TYPES).toHaveLength(7);
  });

  it('VALID_CONTENT_TYPES should include key types', () => {
    expect(VALID_CONTENT_TYPES).toContain('article');
    expect(VALID_CONTENT_TYPES).toContain('blog');
    expect(VALID_CONTENT_TYPES).toContain('pdf');
    expect(VALID_CONTENT_TYPES).toContain('note');
    expect(VALID_CONTENT_TYPES).toContain('research');
    expect(VALID_CONTENT_TYPES).toContain('document');
    expect(VALID_CONTENT_TYPES).toContain('other');
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

  it('VALID_CONTENT_TYPES should not include the BI-3 migrated-out values (ID-133 BI-3)', () => {
    // q_a_pair -> own Layer-5 class; the rest -> L-concept type
    // discriminators (37-concept-type.md).
    expect(VALID_CONTENT_TYPES).not.toContain('q_a_pair');
    expect(VALID_CONTENT_TYPES).not.toContain('case_study');
    expect(VALID_CONTENT_TYPES).not.toContain('policy');
    expect(VALID_CONTENT_TYPES).not.toContain('certification');
    expect(VALID_CONTENT_TYPES).not.toContain('compliance');
    expect(VALID_CONTENT_TYPES).not.toContain('methodology');
    expect(VALID_CONTENT_TYPES).not.toContain('capability');
    expect(VALID_CONTENT_TYPES).not.toContain('product_description');
  });

  it('VALID_REVIEW_ACTIONS should contain 6 actions', () => {
    // ID-131 endgame B3-ext (S447) added 'publish' — the linear review-queue
    // quick-publish action, re-pointed off the doomed PATCH /api/items/[id]
    // route onto POST /api/review/action.
    expect(VALID_REVIEW_ACTIONS).toHaveLength(6);
  });

  it('VALID_REVIEW_ACTIONS should include verify, flag, skip, unverify, unflag and publish', () => {
    expect(VALID_REVIEW_ACTIONS).toContain('verify');
    expect(VALID_REVIEW_ACTIONS).toContain('flag');
    expect(VALID_REVIEW_ACTIONS).toContain('skip');
    expect(VALID_REVIEW_ACTIONS).toContain('unverify');
    expect(VALID_REVIEW_ACTIONS).toContain('unflag');
    expect(VALID_REVIEW_ACTIONS).toContain('publish');
  });
});
