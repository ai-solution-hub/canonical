/**
 * change-reports-helpers unit tests
 *
 * Tests the changeReportFrequencyLabel function with the "Change Report" vocabulary.
 */
import { describe, it, expect } from 'vitest';
import { changeReportFrequencyLabel } from '@/lib/change-reports/change-reports-helpers';

describe('changeReportFrequencyLabel', () => {
  it('returns "Weekly Change Report" for weekly type', () => {
    expect(changeReportFrequencyLabel('weekly')).toBe('Weekly Change Report');
  });

  it('returns "Daily Change Report" for daily type', () => {
    expect(changeReportFrequencyLabel('daily')).toBe('Daily Change Report');
  });

  it('returns "Custom Change Report" for custom type', () => {
    expect(changeReportFrequencyLabel('custom')).toBe('Custom Change Report');
  });

  it('returns "Change Report" for unknown type', () => {
    expect(changeReportFrequencyLabel('monthly')).toBe('Change Report');
  });

  it('returns "Change Report" for empty string', () => {
    expect(changeReportFrequencyLabel('')).toBe('Change Report');
  });
});
