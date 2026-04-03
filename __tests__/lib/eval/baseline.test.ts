import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import type { EvalBaseline, EvalResult } from '@/lib/eval/types';

// Mock fs module before imports
const mockFs = vi.hoisted(() => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock('fs', () => ({
  default: {
    existsSync: mockFs.existsSync,
    readFileSync: mockFs.readFileSync,
    writeFileSync: mockFs.writeFileSync,
    mkdirSync: mockFs.mkdirSync,
  },
  existsSync: mockFs.existsSync,
  readFileSync: mockFs.readFileSync,
  writeFileSync: mockFs.writeFileSync,
  mkdirSync: mockFs.mkdirSync,
}));

import {
  loadBaseline,
  saveBaseline,
  checkRegression,
  evalPassed,
} from '@/lib/eval/baseline';

describe('eval baseline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('saveBaseline', () => {
    it('creates JSON file in correct location', () => {
      mockFs.existsSync.mockReturnValue(false);

      saveBaseline(
        'test-suite',
        { accuracy: 0.95, precision: 0.9 },
        { accuracy: { min: 0.9 }, precision: { max_drop: 0.05 } }
      );

      expect(mockFs.mkdirSync).toHaveBeenCalledWith(
        expect.stringContaining('eval-baselines'),
        { recursive: true }
      );
      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('test-suite.baseline.json'),
        expect.stringContaining('"suite_name": "test-suite"'),
        'utf-8'
      );
    });

    it('skips directory creation if it already exists', () => {
      mockFs.existsSync.mockReturnValue(true);

      saveBaseline('test-suite', { accuracy: 0.95 }, { accuracy: { min: 0.9 } });

      expect(mockFs.mkdirSync).not.toHaveBeenCalled();
      expect(mockFs.writeFileSync).toHaveBeenCalled();
    });
  });

  describe('loadBaseline', () => {
    it('returns null for non-existent suite', () => {
      mockFs.existsSync.mockReturnValue(false);

      const result = loadBaseline('nonexistent-suite');
      expect(result).toBeNull();
    });

    it('correctly parses a saved baseline', () => {
      const baseline: EvalBaseline = {
        suite_name: 'classification',
        created_at: '2026-04-01T00:00:00.000Z',
        metrics: { accuracy: 0.95, precision: 0.9 },
        thresholds: {
          accuracy: { min: 0.9 },
          precision: { max_drop: 0.05 },
        },
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(baseline));

      const result = loadBaseline('classification');
      expect(result).toEqual(baseline);
      expect(result?.suite_name).toBe('classification');
      expect(result?.metrics.accuracy).toBe(0.95);
    });
  });

  describe('checkRegression', () => {
    const baseline: EvalBaseline = {
      suite_name: 'test',
      created_at: '2026-04-01T00:00:00.000Z',
      metrics: { accuracy: 0.95, recall: 0.85 },
      thresholds: {
        accuracy: { min: 0.9 },
        recall: { max_drop: 0.05 },
      },
    };

    it('passes when metrics are above minimum threshold', () => {
      const results = checkRegression(baseline, { accuracy: 0.93, recall: 0.85 });
      const accuracyResult = results.find(
        (r) => r.metric_name === 'accuracy'
      );
      expect(accuracyResult?.passed).toBe(true);
    });

    it('fails when metrics drop below minimum threshold', () => {
      const results = checkRegression(baseline, { accuracy: 0.85, recall: 0.85 });
      const accuracyResult = results.find(
        (r) => r.metric_name === 'accuracy'
      );
      expect(accuracyResult?.passed).toBe(false);
      expect(accuracyResult?.current_value).toBe(0.85);
    });

    it('passes when drop is within max_drop tolerance', () => {
      // Baseline recall = 0.85, current = 0.82, drop = 0.03, max_drop = 0.05
      const results = checkRegression(baseline, { accuracy: 0.95, recall: 0.82 });
      const recallResult = results.find(
        (r) => r.metric_name === 'recall' && r.threshold === 0.05
      );
      expect(recallResult?.passed).toBe(true);
    });

    it('fails when drop exceeds max_drop tolerance', () => {
      // Baseline recall = 0.85, current = 0.75, drop = 0.10, max_drop = 0.05
      const results = checkRegression(baseline, { accuracy: 0.95, recall: 0.75 });
      const recallResult = results.find(
        (r) => r.metric_name === 'recall' && r.threshold === 0.05
      );
      expect(recallResult?.passed).toBe(false);
      expect(recallResult?.delta).toBeCloseTo(-0.1);
    });
  });

  describe('evalPassed', () => {
    const makeResult = (metrics: Record<string, number>): EvalResult => ({
      suite_name: 'test',
      timestamp: '2026-04-01T00:00:00.000Z',
      total_items: 10,
      metrics,
      passed: true,
      failures: [],
    });

    it('returns true when no baseline exists (first run)', () => {
      const result = makeResult({ accuracy: 0.5 });
      expect(evalPassed(result, null)).toBe(true);
    });

    it('returns false when regressions are detected', () => {
      const baseline: EvalBaseline = {
        suite_name: 'test',
        created_at: '2026-04-01T00:00:00.000Z',
        metrics: { accuracy: 0.95 },
        thresholds: { accuracy: { min: 0.9 } },
      };

      // Accuracy dropped to 0.80, below min of 0.9
      const result = makeResult({ accuracy: 0.80 });
      expect(evalPassed(result, baseline)).toBe(false);
    });

    it('returns true when all metrics pass thresholds', () => {
      const baseline: EvalBaseline = {
        suite_name: 'test',
        created_at: '2026-04-01T00:00:00.000Z',
        metrics: { accuracy: 0.95 },
        thresholds: { accuracy: { min: 0.9 } },
      };

      const result = makeResult({ accuracy: 0.92 });
      expect(evalPassed(result, baseline)).toBe(true);
    });
  });
});
