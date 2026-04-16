/**
 * Tests for GovernanceConfigBodySchema validation.
 *
 * Validates the preset-based schema (P0-16): { domain, preset }.
 * Old field-level inputs (posture, timeout_days, etc.) are rejected
 * by the .strict() modifier.
 */
import { describe, it, expect } from 'vitest';
import { GovernanceConfigBodySchema } from '@/lib/validation/schemas';

describe('GovernanceConfigBodySchema', () => {
  it('accepts { domain, preset: "light_touch" }', () => {
    const result = GovernanceConfigBodySchema.safeParse({
      domain: 'Technology & Systems',
      preset: 'light_touch',
    });
    expect(result.success).toBe(true);
  });

  it('accepts { domain, preset: "strict" }', () => {
    const result = GovernanceConfigBodySchema.safeParse({
      domain: 'Operations',
      preset: 'strict',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty domain', () => {
    const result = GovernanceConfigBodySchema.safeParse({
      domain: '',
      preset: 'light_touch',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing domain', () => {
    const result = GovernanceConfigBodySchema.safeParse({
      preset: 'strict',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing preset', () => {
    const result = GovernanceConfigBodySchema.safeParse({
      domain: 'Test',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid preset value', () => {
    const result = GovernanceConfigBodySchema.safeParse({
      domain: 'Test',
      preset: 'relaxed',
    });
    expect(result.success).toBe(false);
  });

  it('rejects old-format body with posture field', () => {
    const result = GovernanceConfigBodySchema.safeParse({
      domain: 'Test',
      posture: 'open',
    });
    expect(result.success).toBe(false);
  });

  it('rejects mixed old + new format (preset AND posture)', () => {
    const result = GovernanceConfigBodySchema.safeParse({
      domain: 'Test',
      preset: 'strict',
      posture: 'review_on_change',
    });
    expect(result.success).toBe(false);
  });

  it('rejects extra unknown fields via .strict()', () => {
    const result = GovernanceConfigBodySchema.safeParse({
      domain: 'Test',
      preset: 'light_touch',
      quality_score_threshold: 40,
    });
    expect(result.success).toBe(false);
  });

  it('trims whitespace from domain', () => {
    const result = GovernanceConfigBodySchema.safeParse({
      domain: '  Technology & Systems  ',
      preset: 'strict',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.domain).toBe('Technology & Systems');
    }
  });

  it('rejects domain exceeding 200 characters', () => {
    const result = GovernanceConfigBodySchema.safeParse({
      domain: 'A'.repeat(201),
      preset: 'light_touch',
    });
    expect(result.success).toBe(false);
  });
});
