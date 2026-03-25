/**
 * Tests for GovernanceConfigBodySchema validation.
 *
 * Verifies the schema accepts new auto-flag fields and enforces constraints.
 */
import { describe, it, expect } from 'vitest';
import { GovernanceConfigBodySchema } from '@/lib/validation/schemas';

describe('GovernanceConfigBodySchema', () => {
  it('accepts minimal valid input (domain + posture only)', () => {
    const result = GovernanceConfigBodySchema.safeParse({
      domain: 'Technology & Systems',
      posture: 'open',
    });
    expect(result.success).toBe(true);
  });

  it('accepts all fields including new auto-flag fields', () => {
    const result = GovernanceConfigBodySchema.safeParse({
      domain: 'Operations',
      posture: 'review_on_change',
      reviewer_id: '00000000-0000-4000-8000-000000000001',
      timeout_days: 14,
      quality_score_threshold: 50,
      auto_flag_on_quality_drop: true,
      auto_flag_on_freshness_transition: false,
      auto_flag_cooldown_days: 30,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.quality_score_threshold).toBe(50);
      expect(result.data.auto_flag_on_quality_drop).toBe(true);
      expect(result.data.auto_flag_on_freshness_transition).toBe(false);
      expect(result.data.auto_flag_cooldown_days).toBe(30);
    }
  });

  it('rejects empty domain', () => {
    const result = GovernanceConfigBodySchema.safeParse({
      domain: '',
      posture: 'open',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid posture', () => {
    const result = GovernanceConfigBodySchema.safeParse({
      domain: 'Test',
      posture: 'strict',
    });
    expect(result.success).toBe(false);
  });

  it('rejects quality_score_threshold above 100', () => {
    const result = GovernanceConfigBodySchema.safeParse({
      domain: 'Test',
      posture: 'open',
      quality_score_threshold: 101,
    });
    expect(result.success).toBe(false);
  });

  it('rejects quality_score_threshold below 0', () => {
    const result = GovernanceConfigBodySchema.safeParse({
      domain: 'Test',
      posture: 'open',
      quality_score_threshold: -1,
    });
    expect(result.success).toBe(false);
  });

  it('accepts quality_score_threshold = 0', () => {
    const result = GovernanceConfigBodySchema.safeParse({
      domain: 'Test',
      posture: 'open',
      quality_score_threshold: 0,
    });
    expect(result.success).toBe(true);
  });

  it('accepts quality_score_threshold = 100', () => {
    const result = GovernanceConfigBodySchema.safeParse({
      domain: 'Test',
      posture: 'open',
      quality_score_threshold: 100,
    });
    expect(result.success).toBe(true);
  });

  it('accepts null quality_score_threshold', () => {
    const result = GovernanceConfigBodySchema.safeParse({
      domain: 'Test',
      posture: 'open',
      quality_score_threshold: null,
    });
    expect(result.success).toBe(true);
  });

  it('rejects auto_flag_cooldown_days above 90', () => {
    const result = GovernanceConfigBodySchema.safeParse({
      domain: 'Test',
      posture: 'open',
      auto_flag_cooldown_days: 91,
    });
    expect(result.success).toBe(false);
  });

  it('rejects auto_flag_cooldown_days below 1', () => {
    const result = GovernanceConfigBodySchema.safeParse({
      domain: 'Test',
      posture: 'open',
      auto_flag_cooldown_days: 0,
    });
    expect(result.success).toBe(false);
  });

  it('accepts auto_flag_cooldown_days = 1', () => {
    const result = GovernanceConfigBodySchema.safeParse({
      domain: 'Test',
      posture: 'open',
      auto_flag_cooldown_days: 1,
    });
    expect(result.success).toBe(true);
  });

  it('accepts auto_flag_cooldown_days = 90', () => {
    const result = GovernanceConfigBodySchema.safeParse({
      domain: 'Test',
      posture: 'open',
      auto_flag_cooldown_days: 90,
    });
    expect(result.success).toBe(true);
  });

  it('rejects non-boolean auto_flag_on_quality_drop', () => {
    const result = GovernanceConfigBodySchema.safeParse({
      domain: 'Test',
      posture: 'open',
      auto_flag_on_quality_drop: 'yes',
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-boolean auto_flag_on_freshness_transition', () => {
    const result = GovernanceConfigBodySchema.safeParse({
      domain: 'Test',
      posture: 'open',
      auto_flag_on_freshness_transition: 1,
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-integer auto_flag_cooldown_days', () => {
    const result = GovernanceConfigBodySchema.safeParse({
      domain: 'Test',
      posture: 'open',
      auto_flag_cooldown_days: 7.5,
    });
    expect(result.success).toBe(false);
  });

  it('allows all new fields to be omitted (optional)', () => {
    const result = GovernanceConfigBodySchema.safeParse({
      domain: 'Test',
      posture: 'review_on_change',
      timeout_days: 14,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.auto_flag_on_quality_drop).toBeUndefined();
      expect(result.data.auto_flag_on_freshness_transition).toBeUndefined();
      expect(result.data.auto_flag_cooldown_days).toBeUndefined();
      expect(result.data.quality_score_threshold).toBeUndefined();
    }
  });
});
