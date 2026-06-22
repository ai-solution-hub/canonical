/**
 * Unit tests for `lib/users/self-display-name.ts`.
 *
 * The helper consolidates the previously-duplicated display-name
 * fallback chain that lived in both `lib/dashboard.ts` and
 * `lib/reorient.ts`. The tests below mirror the cases that used to
 * be exercised via `__tests__/lib/reorient.test.ts` (`describe
 * 'user_display_name'`) plus a handful of edge cases that were
 * previously implicit in the inline implementations.
 */

import { describe, it, expect } from 'vitest';
import { getUserDisplayName } from '@/lib/users/self-display-name';

describe('getUserDisplayName', () => {
  describe('user_metadata.display_name path', () => {
    it('returns the display_name when present', () => {
      const result = getUserDisplayName({
        user_metadata: { display_name: 'Liam' },
        email: 'liam@example.com',
      });
      expect(result).toEqual({
        display_name: 'Liam',
        has_display_name: true,
      });
    });

    it('takes the first token when display_name has spaces', () => {
      const result = getUserDisplayName({
        user_metadata: { display_name: 'Liam Jones' },
        email: 'liam@example.com',
      });
      expect(result.display_name).toBe('Liam');
      expect(result.has_display_name).toBe(true);
    });

    it('prefers display_name over full_name', () => {
      const result = getUserDisplayName({
        user_metadata: { display_name: 'Li', full_name: 'Liam Jones' },
        email: 'liam@example.com',
      });
      expect(result.display_name).toBe('Li');
      expect(result.has_display_name).toBe(true);
    });
  });

  describe('user_metadata.full_name fallback', () => {
    it('uses full_name when display_name is missing', () => {
      const result = getUserDisplayName({
        user_metadata: { full_name: 'Liam Jones' },
        email: 'liam@example.com',
      });
      expect(result.display_name).toBe('Liam');
      expect(result.has_display_name).toBe(true);
    });

    it('treats empty-string display_name as falsy and falls through to email-prefix', () => {
      // The helper uses `??` (matching the pre-refactor behaviour), so
      // an empty-string `display_name` does NOT fall through to
      // `full_name` — instead the truthy check below it fails and the
      // helper drops to the email-prefix path. This documents the
      // existing contract; if the product wants `||` semantics here,
      // that's a behaviour change requiring its own decision.
      const result = getUserDisplayName({
        user_metadata: { display_name: '', full_name: 'Liam Jones' },
        email: 'liam@example.com',
      });
      expect(result.display_name).toBe('Liam');
      expect(result.has_display_name).toBe(false);
    });
  });

  describe('email-prefix fallback', () => {
    it('derives a name from a simple email prefix', () => {
      const result = getUserDisplayName({
        user_metadata: {},
        email: 'sarah@company.co.uk',
      });
      expect(result.display_name).toBe('Sarah');
      expect(result.has_display_name).toBe(false);
    });

    it('strips dots and trailing digits, then title-cases', () => {
      const result = getUserDisplayName({
        user_metadata: {},
        email: 'test.user1@company.co.uk',
      });
      expect(result.display_name).toBe('Test user');
      expect(result.has_display_name).toBe(false);
    });

    it('strips underscores in the prefix', () => {
      const result = getUserDisplayName({
        user_metadata: {},
        email: 'jane_doe@company.com',
      });
      expect(result.display_name).toBe('Jane doe');
      expect(result.has_display_name).toBe(false);
    });

    it('handles a single-character prefix', () => {
      const result = getUserDisplayName({
        user_metadata: {},
        email: 'a@example.com',
      });
      expect(result.display_name).toBe('A');
      expect(result.has_display_name).toBe(false);
    });

    it('falls through to null when the prefix cleans to empty', () => {
      // Pure-digit prefix becomes '' after stripping trailing digits.
      const result = getUserDisplayName({
        user_metadata: {},
        email: '12345@example.com',
      });
      expect(result.display_name).toBeNull();
      expect(result.has_display_name).toBe(false);
    });

    it('takes the substring before the first @ on multi-@ inputs', () => {
      // `'a@b@c.com'.split('@')[0]` → 'a' — the helper does not throw on
      // pathological inputs, it just renders the first @-segment.
      const result = getUserDisplayName({
        user_metadata: {},
        email: 'a@b@c.com',
      });
      expect(result.display_name).toBe('A');
      expect(result.has_display_name).toBe(false);
    });
  });

  describe('null fallthrough', () => {
    it('returns null when authUser is undefined', () => {
      const result = getUserDisplayName(undefined);
      expect(result).toEqual({
        display_name: null,
        has_display_name: false,
      });
    });

    it('returns null when authUser is null', () => {
      const result = getUserDisplayName(null);
      expect(result).toEqual({
        display_name: null,
        has_display_name: false,
      });
    });

    it('returns null when both metadata names and email are missing', () => {
      const result = getUserDisplayName({
        user_metadata: {},
        email: null,
      });
      expect(result.display_name).toBeNull();
      expect(result.has_display_name).toBe(false);
    });

    it('returns null when user_metadata is null', () => {
      const result = getUserDisplayName({
        user_metadata: null,
        email: null,
      });
      expect(result.display_name).toBeNull();
      expect(result.has_display_name).toBe(false);
    });

    it('returns null when email is empty string', () => {
      const result = getUserDisplayName({
        user_metadata: {},
        email: '',
      });
      expect(result.display_name).toBeNull();
      expect(result.has_display_name).toBe(false);
    });
  });
});
