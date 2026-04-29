/**
 * Unit tests for `draftFinalToPublicationStatus`.
 *
 * Spec: docs/specs/ep2-markdown-ui-ingest-spec.md v1.3 §9.2.
 * Plan: docs/plans/§1.11-ep2-build-plan.md (EP2-T2 helpers).
 *
 * Decision-A (D-A) is baked in:
 *   'draft'   → 'draft'
 *   'final'   → 'in_review'   (NOT 'published' — admin approval required)
 *   'unknown' → 'draft'        (conservative)
 */

import { describe, it, expect } from 'vitest';
import { draftFinalToPublicationStatus } from '@/lib/ingest/draft-final-to-publication-status';

describe('draftFinalToPublicationStatus', () => {
  it('maps "draft" to "draft"', () => {
    expect(draftFinalToPublicationStatus('draft')).toBe('draft');
  });

  it('maps "final" to "in_review" (D-A — admin approval still required)', () => {
    expect(draftFinalToPublicationStatus('final')).toBe('in_review');
  });

  it('maps "unknown" to "draft" (conservative default)', () => {
    expect(draftFinalToPublicationStatus('unknown')).toBe('draft');
  });

  it('narrows the return type to the publication-status union', () => {
    const result = draftFinalToPublicationStatus('final');
    // Compile-time narrowing — must be assignable to the literal union and
    // NEVER include 'published'.
    const narrowed: 'draft' | 'in_review' = result;
    expect(narrowed).toBe('in_review');
  });
});
