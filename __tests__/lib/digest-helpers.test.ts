/**
 * digest-helpers unit tests
 *
 * Tests the digestTypeLabel function with the "Change Report" vocabulary.
 */
import { describe, it, expect } from 'vitest';
import { digestTypeLabel } from '@/lib/digest/digest-helpers';

describe('digestTypeLabel', () => {
  it('returns "Weekly Change Report" for weekly type', () => {
    expect(digestTypeLabel('weekly')).toBe('Weekly Change Report');
  });

  it('returns "Daily Change Report" for daily type', () => {
    expect(digestTypeLabel('daily')).toBe('Daily Change Report');
  });

  it('returns "Custom Change Report" for custom type', () => {
    expect(digestTypeLabel('custom')).toBe('Custom Change Report');
  });

  it('returns "Change Report" for unknown type', () => {
    expect(digestTypeLabel('monthly')).toBe('Change Report');
  });

  it('returns "Change Report" for empty string', () => {
    expect(digestTypeLabel('')).toBe('Change Report');
  });
});
