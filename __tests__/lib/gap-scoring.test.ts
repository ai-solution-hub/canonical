/**
 * Unit tests for gap scoring logic.
 *
 * Tests the priority scoring functions from lib/gap-scoring.ts:
 * - Per-source scoring (taxonomy, template, guide)
 * - Priority tier derivation
 * - Template type weighting
 * - is_mandatory null handling
 * - Unified scoreGap wrapper
 *
 * Spec: .planning/specs/gaps-view-consolidation-spec.md §4
 */

import { describe, it, expect } from 'vitest';
import {
  scoreTaxonomyGap,
  scoreTemplateGap,
  scoreGuideGap,
  derivePriorityTier,
  getTemplateTypeWeight,
  scoreGap,
} from '@/lib/coverage/gap-scoring';
import type { TaxonomyGap, TemplateGap, GuideGap } from '@/types/unified-gap';

// ---------------------------------------------------------------------------
// derivePriorityTier
// ---------------------------------------------------------------------------

describe('derivePriorityTier', () => {
  it('returns critical for scores 75-100', () => {
    expect(derivePriorityTier(75)).toBe('critical');
    expect(derivePriorityTier(100)).toBe('critical');
    expect(derivePriorityTier(90)).toBe('critical');
  });

  it('returns high for scores 50-74', () => {
    expect(derivePriorityTier(50)).toBe('high');
    expect(derivePriorityTier(74)).toBe('high');
    expect(derivePriorityTier(60)).toBe('high');
  });

  it('returns medium for scores 25-49', () => {
    expect(derivePriorityTier(25)).toBe('medium');
    expect(derivePriorityTier(49)).toBe('medium');
    expect(derivePriorityTier(35)).toBe('medium');
  });

  it('returns low for scores 0-24', () => {
    expect(derivePriorityTier(0)).toBe('low');
    expect(derivePriorityTier(24)).toBe('low');
    expect(derivePriorityTier(10)).toBe('low');
  });
});

// ---------------------------------------------------------------------------
// getTemplateTypeWeight
// ---------------------------------------------------------------------------

describe('getTemplateTypeWeight', () => {
  it('returns 10 for SQ templates', () => {
    expect(getTemplateTypeWeight('SQ')).toBe(10);
    expect(getTemplateTypeWeight('sq')).toBe(10);
  });

  it('returns 10 for PQQ templates', () => {
    expect(getTemplateTypeWeight('PQQ')).toBe(10);
    expect(getTemplateTypeWeight('pqq')).toBe(10);
  });

  it('returns 7 for ITT templates', () => {
    expect(getTemplateTypeWeight('ITT')).toBe(7);
    expect(getTemplateTypeWeight('itt')).toBe(7);
  });

  it('returns 7 for RFP templates', () => {
    expect(getTemplateTypeWeight('RFP')).toBe(7);
    expect(getTemplateTypeWeight('rfp')).toBe(7);
  });

  it('returns 3 for unknown template types', () => {
    expect(getTemplateTypeWeight('other')).toBe(3);
    expect(getTemplateTypeWeight('custom')).toBe(3);
    expect(getTemplateTypeWeight('')).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// scoreTaxonomyGap
// ---------------------------------------------------------------------------

describe('scoreTaxonomyGap', () => {
  it('returns base score of 25 with no signals', () => {
    expect(
      scoreTaxonomyGap({ target_unmet: false, domain_has_zero_items: false }),
    ).toBe(25);
  });

  it('adds 15 when coverage target is unmet', () => {
    expect(
      scoreTaxonomyGap({ target_unmet: true, domain_has_zero_items: false }),
    ).toBe(40);
  });

  it('adds 10 when entire domain has zero items', () => {
    expect(
      scoreTaxonomyGap({ target_unmet: false, domain_has_zero_items: true }),
    ).toBe(35);
  });

  it('adds both signals for maximum score of 50', () => {
    expect(
      scoreTaxonomyGap({ target_unmet: true, domain_has_zero_items: true }),
    ).toBe(50);
  });

  it('produces medium tier for base score', () => {
    const score = scoreTaxonomyGap({ target_unmet: false, domain_has_zero_items: false });
    expect(derivePriorityTier(score)).toBe('medium');
  });

  it('produces high tier for maximum score', () => {
    const score = scoreTaxonomyGap({ target_unmet: true, domain_has_zero_items: true });
    expect(derivePriorityTier(score)).toBe('high');
  });
});

// ---------------------------------------------------------------------------
// scoreTemplateGap
// ---------------------------------------------------------------------------

describe('scoreTemplateGap', () => {
  it('returns base score of 20 + default type weight (3) = 23 with no signals', () => {
    expect(
      scoreTemplateGap({
        is_mandatory: false,
        template_type: 'other',
        is_persistent_gap: false,
      }),
    ).toBe(23);
  });

  it('adds 15 for mandatory requirements', () => {
    expect(
      scoreTemplateGap({
        is_mandatory: true,
        template_type: 'other',
        is_persistent_gap: false,
      }),
    ).toBe(38);
  });

  it('treats is_mandatory null as false', () => {
    expect(
      scoreTemplateGap({
        is_mandatory: null,
        template_type: 'other',
        is_persistent_gap: false,
      }),
    ).toBe(23);
  });

  it('adds template type weight for SQ (10)', () => {
    expect(
      scoreTemplateGap({
        is_mandatory: false,
        template_type: 'SQ',
        is_persistent_gap: false,
      }),
    ).toBe(30);
  });

  it('adds template type weight for ITT (7)', () => {
    expect(
      scoreTemplateGap({
        is_mandatory: false,
        template_type: 'ITT',
        is_persistent_gap: false,
      }),
    ).toBe(27);
  });

  it('adds 10 for persistent gaps', () => {
    expect(
      scoreTemplateGap({
        is_mandatory: false,
        template_type: 'other',
        is_persistent_gap: true,
      }),
    ).toBe(33);
  });

  it('produces maximum score of 55 with all signals (mandatory + SQ + persistent)', () => {
    expect(
      scoreTemplateGap({
        is_mandatory: true,
        template_type: 'SQ',
        is_persistent_gap: true,
      }),
    ).toBe(55);
  });

  it('maximum score falls in high tier', () => {
    const score = scoreTemplateGap({
      is_mandatory: true,
      template_type: 'SQ',
      is_persistent_gap: true,
    });
    expect(derivePriorityTier(score)).toBe('high');
  });

  it('base score with default template type falls in low tier', () => {
    const score = scoreTemplateGap({
      is_mandatory: false,
      template_type: 'other',
      is_persistent_gap: false,
    });
    expect(derivePriorityTier(score)).toBe('low');
  });
});

// ---------------------------------------------------------------------------
// scoreGuideGap
// ---------------------------------------------------------------------------

describe('scoreGuideGap', () => {
  it('returns base score of 15 for non-required empty section', () => {
    expect(
      scoreGuideGap({ is_required: false, section_status: 'empty' }),
    ).toBe(15);
  });

  it('adds 15 for required sections', () => {
    expect(
      scoreGuideGap({ is_required: true, section_status: 'empty' }),
    ).toBe(30);
  });

  it('adds 5 for stale sections', () => {
    expect(
      scoreGuideGap({ is_required: false, section_status: 'stale' }),
    ).toBe(20);
  });

  it('produces maximum score of 35 for required + stale', () => {
    expect(
      scoreGuideGap({ is_required: true, section_status: 'stale' }),
    ).toBe(35);
  });

  it('base score falls in low tier', () => {
    const score = scoreGuideGap({ is_required: false, section_status: 'empty' });
    expect(derivePriorityTier(score)).toBe('low');
  });

  it('required section score falls in medium tier', () => {
    const score = scoreGuideGap({ is_required: true, section_status: 'empty' });
    expect(derivePriorityTier(score)).toBe('medium');
  });
});

// ---------------------------------------------------------------------------
// scoreGap (unified wrapper)
// ---------------------------------------------------------------------------

describe('scoreGap', () => {
  const baseTaxonomyGap: TaxonomyGap = {
    source: 'taxonomy',
    gap_key: 'taxonomy:Engineering:DevOps',
    title: 'DevOps (Engineering)',
    description: 'No content items in the DevOps subtopic',
    priority_score: 0,
    priority_tier: 'low',
    domain: 'Engineering',
    subtopic: 'DevOps',
    action_href: '/browse?domain=Engineering&subtopic=DevOps',
    action_label: 'Add content',
    domain_name: 'Engineering',
    subtopic_name: 'DevOps',
    target_unmet: false,
  };

  const baseTemplateGap: TemplateGap = {
    source: 'template',
    gap_key: 'template:SQ:1.1:req-1',
    title: 'Health and safety policy',
    description: null,
    priority_score: 0,
    priority_tier: 'low',
    domain: null,
    subtopic: null,
    action_href: '/coverage?tab=templates&template=SQ&section=1.1',
    action_label: 'View requirement',
    template_name: 'SQ',
    template_type: 'SQ',
    section_ref: '1.1',
    section_name: 'Health & Safety',
    requirement_text: 'Health and safety policy',
    requirement_type: 'policy',
    is_mandatory: true,
  };

  const baseGuideGap: GuideGap = {
    source: 'guide',
    gap_key: 'guide:g1:s1',
    title: 'Introduction (ISO Guide)',
    description: 'No content in the "Introduction" section',
    priority_score: 0,
    priority_tier: 'low',
    domain: null,
    subtopic: null,
    action_href: '/guide/iso-guide',
    action_label: 'Open guide',
    guide_id: 'g1',
    guide_name: 'ISO Guide',
    guide_slug: 'iso-guide',
    section_id: 's1',
    section_name: 'Introduction',
    is_required: true,
    section_status: 'empty',
  };

  it('scores a taxonomy gap and assigns correct tier', () => {
    const result = scoreGap(baseTaxonomyGap);
    expect(result.priority_score).toBe(25);
    expect(result.priority_tier).toBe('medium');
  });

  it('scores a taxonomy gap with domain_has_zero_items context', () => {
    const result = scoreGap(baseTaxonomyGap, { domain_has_zero_items: true });
    expect(result.priority_score).toBe(35);
    expect(result.priority_tier).toBe('medium');
  });

  it('scores a taxonomy gap with target_unmet', () => {
    const gap = { ...baseTaxonomyGap, target_unmet: true };
    const result = scoreGap(gap);
    expect(result.priority_score).toBe(40);
    expect(result.priority_tier).toBe('medium');
  });

  it('scores a template gap with mandatory flag', () => {
    const result = scoreGap(baseTemplateGap);
    // 20 base + 15 mandatory + 10 SQ = 45
    expect(result.priority_score).toBe(45);
    expect(result.priority_tier).toBe('medium');
  });

  it('scores a template gap with null is_mandatory', () => {
    const gap = { ...baseTemplateGap, is_mandatory: null as boolean | null };
    const result = scoreGap(gap);
    // 20 base + 0 mandatory + 10 SQ = 30
    expect(result.priority_score).toBe(30);
    expect(result.priority_tier).toBe('medium');
  });

  it('scores a guide gap with required section', () => {
    const result = scoreGap(baseGuideGap);
    // 15 base + 15 required = 30
    expect(result.priority_score).toBe(30);
    expect(result.priority_tier).toBe('medium');
  });

  it('scores a guide gap with stale status', () => {
    const gap: GuideGap = { ...baseGuideGap, section_status: 'stale' };
    const result = scoreGap(gap);
    // 15 base + 15 required + 5 stale = 35
    expect(result.priority_score).toBe(35);
    expect(result.priority_tier).toBe('medium');
  });

  it('preserves all other gap fields', () => {
    const result = scoreGap(baseTaxonomyGap) as TaxonomyGap;
    expect(result.source).toBe('taxonomy');
    expect(result.gap_key).toBe('taxonomy:Engineering:DevOps');
    expect(result.domain_name).toBe('Engineering');
    expect(result.subtopic_name).toBe('DevOps');
    expect(result.action_href).toBe('/browse?domain=Engineering&subtopic=DevOps');
  });
});

// ---------------------------------------------------------------------------
// Score range validation
// ---------------------------------------------------------------------------

describe('score ranges', () => {
  it('taxonomy gaps range from 25 to 50', () => {
    const min = scoreTaxonomyGap({ target_unmet: false, domain_has_zero_items: false });
    const max = scoreTaxonomyGap({ target_unmet: true, domain_has_zero_items: true });
    expect(min).toBe(25);
    expect(max).toBe(50);
  });

  it('template gaps range from 23 to 55', () => {
    const min = scoreTemplateGap({
      is_mandatory: false,
      template_type: 'other',
      is_persistent_gap: false,
    });
    const max = scoreTemplateGap({
      is_mandatory: true,
      template_type: 'SQ',
      is_persistent_gap: true,
    });
    expect(min).toBe(23);
    expect(max).toBe(55);
  });

  it('guide gaps range from 15 to 35', () => {
    const min = scoreGuideGap({ is_required: false, section_status: 'empty' });
    const max = scoreGuideGap({ is_required: true, section_status: 'stale' });
    expect(min).toBe(15);
    expect(max).toBe(35);
  });

  it('no Phase 1 gap can reach the critical tier (75+)', () => {
    // Max taxonomy: 50, max template: 55, max guide: 35
    const maxScores = [50, 55, 35];
    for (const score of maxScores) {
      expect(derivePriorityTier(score)).not.toBe('critical');
    }
  });
});
