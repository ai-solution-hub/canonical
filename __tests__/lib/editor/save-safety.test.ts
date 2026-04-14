/**
 * Unit tests for the editor save-safety helper (`lib/editor/save-safety.ts`).
 *
 * The helper is pure, but it's load-bearing for data-loss protection on the
 * ContentEditor save path, so the boundary cases (first-save, threshold,
 * configurable ratio) are exercised explicitly. WP1 fix S169.
 */
import { describe, it, expect } from 'vitest';

import {
  SAVE_SAFETY_BLOCK_MESSAGE,
  SAVE_SAFETY_MIN_RATIO,
  shouldBlockSave,
} from '@/lib/editor/save-safety';

describe('shouldBlockSave', () => {
  it('permits first save when baseline length is 0', () => {
    expect(shouldBlockSave(0, 0)).toBe(false);
    expect(shouldBlockSave(0, 1000)).toBe(false);
  });

  it('permits first save when baseline length is negative (defensive)', () => {
    expect(shouldBlockSave(-1, 10)).toBe(false);
  });

  it('permits normal edits (5% reduction)', () => {
    // baseline=1000, threshold = 0.8 × 1000 = 800. 950 is above threshold.
    expect(shouldBlockSave(1000, 950)).toBe(false);
  });

  it('permits edits at the threshold exactly', () => {
    // Uses strict `<`, so equality is permitted.
    expect(shouldBlockSave(1000, 800)).toBe(false);
  });

  it('blocks save when new length drops below 80% of baseline', () => {
    expect(shouldBlockSave(1000, 799)).toBe(true);
    expect(shouldBlockSave(1000, 500)).toBe(true);
    expect(shouldBlockSave(1000, 0)).toBe(true);
  });

  it('honours a custom minimum ratio', () => {
    // ratio=0.5 → block below 500, permit at/above 500.
    expect(shouldBlockSave(1000, 499, 0.5)).toBe(true);
    expect(shouldBlockSave(1000, 500, 0.5)).toBe(false);
    expect(shouldBlockSave(1000, 600, 0.5)).toBe(false);
  });

  it('permits growth regardless of ratio', () => {
    expect(shouldBlockSave(1000, 2000)).toBe(false);
    expect(shouldBlockSave(1000, 10_000, 0.5)).toBe(false);
  });
});

describe('SAVE_SAFETY_MIN_RATIO', () => {
  it('is pinned at 0.8 (20% loss threshold)', () => {
    expect(SAVE_SAFETY_MIN_RATIO).toBe(0.8);
  });
});

describe('SAVE_SAFETY_BLOCK_MESSAGE', () => {
  it('does not advise the user to refresh (refresh destroys unsaved edits)', () => {
    // The pre-fix copy read "Refresh and try again, or contact support…"
    // which destroys unsaved work. The new copy must not contain that
    // advice in any variant — only the explicit "don't refresh" warning.
    expect(SAVE_SAFETY_BLOCK_MESSAGE.toLowerCase()).not.toContain(
      'refresh and try again',
    );
    expect(SAVE_SAFETY_BLOCK_MESSAGE.toLowerCase()).not.toMatch(
      /please refresh/,
    );
  });

  it("explicitly warns against refreshing (since the user's instinct is to refresh)", () => {
    expect(SAVE_SAFETY_BLOCK_MESSAGE.toLowerCase()).toContain("don't refresh");
  });

  it('uses UK-English "Save blocked" framing and preserves user work', () => {
    expect(SAVE_SAFETY_BLOCK_MESSAGE).toMatch(/^Save blocked/);
    expect(SAVE_SAFETY_BLOCK_MESSAGE.toLowerCase()).toContain('copy your edits');
    expect(SAVE_SAFETY_BLOCK_MESSAGE.toLowerCase()).toContain('contact support');
  });
});
