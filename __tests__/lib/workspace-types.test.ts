/**
 * Workspace Type Registry Tests
 *
 * Unit tests for the workspace type registry public API: getWorkspaceType,
 * getAllWorkspaceTypes, getLauncherTypes, getValidTypeValues, formatTypeCount.
 */
import { describe, it, expect } from 'vitest';
import {
  getWorkspaceType,
  getAllWorkspaceTypes,
  getLauncherTypes,
  getValidTypeValues,
  formatTypeCount,
} from '@/lib/workspace-types';

describe('workspace-types registry', () => {
  describe('getWorkspaceType', () => {
    // Post-T2 (S246): 'bid' renamed to 'procurement' per application_types.key
    // mapping. Tests updated to match current registry shape (TODO(T4) shim).
    it('returns config for "procurement" application type (bid management)', () => {
      const config = getWorkspaceType('procurement');
      expect(config).toBeDefined();
      expect(config!.type).toBe('procurement');
      expect(config!.label).toBe('Procurement');
      expect(config!.labelPlural).toBe('Bids');
      expect(config!.route).toBe('/procurement');
      expect(config!.available).toBe(true);
      expect(config!.hasCustomCreation).toBe(true);
    });

    // Post-T2: 'kb_section' retired (no prod rows, not in application_types).
    // The type no longer exists in the registry.
    it('returns undefined for retired "kb_section" type', () => {
      expect(getWorkspaceType('kb_section')).toBeUndefined();
    });

    it('returns config for "proposal" type (unavailable placeholder)', () => {
      const config = getWorkspaceType('proposal');
      expect(config).toBeDefined();
      expect(config!.available).toBe(false);
    });

    it('returns undefined for unknown type', () => {
      expect(getWorkspaceType('nonexistent')).toBeUndefined();
    });

    it('returns undefined for empty string', () => {
      expect(getWorkspaceType('')).toBeUndefined();
    });

    it('intelligence description is free of AI branding and prompt language', () => {
      const config = getWorkspaceType('intelligence');
      expect(config).toBeDefined();
      // Guards S157 WP1 C4 regression — no "AI" or "prompt" words in the
      // user-visible workspace type description.
      expect(config!.description).not.toMatch(/\bAI\b/i);
      expect(config!.description).not.toMatch(/prompt/i);
    });
  });

  describe('getAllWorkspaceTypes', () => {
    it('returns all registered types', () => {
      const all = getAllWorkspaceTypes();
      expect(all.length).toBeGreaterThanOrEqual(3);
      const types = all.map((t) => t.type);
      // Post-T2: 'bid' renamed to 'procurement'; 'kb_section' retired.
      expect(types).toContain('procurement');
      expect(types).toContain('intelligence');
      expect(types).toContain('proposal');
    });

    it('returns an array (not a record)', () => {
      const all = getAllWorkspaceTypes();
      expect(Array.isArray(all)).toBe(true);
    });
  });

  describe('getLauncherTypes', () => {
    it('includes bid management type (procurement) in the launcher', () => {
      const launcher = getLauncherTypes();
      const types = launcher.map((t) => t.type);
      expect(types).toContain('procurement');
    });

    it('includes unavailable types (shown as "coming soon")', () => {
      const launcher = getLauncherTypes();
      const types = launcher.map((t) => t.type);
      expect(types).toContain('proposal');
    });

    it('excludes retired kb_section type from the launcher', () => {
      const launcher = getLauncherTypes();
      const types = launcher.map((t) => t.type);
      // kb_section retired post-T2 — must not appear
      expect(types).not.toContain('kb_section');
    });
  });

  describe('getValidTypeValues', () => {
    it('returns a non-empty tuple', () => {
      const values = getValidTypeValues();
      expect(values.length).toBeGreaterThanOrEqual(1);
    });

    it('includes procurement and intelligence (active DB application types)', () => {
      // Post-T2: 'bid' renamed to 'procurement'; 'kb_section' retired.
      const values = getValidTypeValues();
      expect(values).toContain('procurement');
      expect(values).toContain('intelligence');
    });

    it('excludes unavailable types (not in DB CHECK constraint)', () => {
      const values = getValidTypeValues();
      expect(values).not.toContain('proposal');
    });

    it('first element is a string (tuple shape)', () => {
      const values = getValidTypeValues();
      expect(typeof values[0]).toBe('string');
    });
  });

  describe('formatTypeCount', () => {
    it('formats singular procurement count using bid label', () => {
      // The registry maps 'procurement' key to label 'Procurement'
      expect(formatTypeCount('procurement', 1)).toBe('1 active bid');
    });

    it('formats plural procurement count using bids label', () => {
      expect(formatTypeCount('procurement', 5)).toBe('5 active bids');
    });

    it('formats zero procurement count as plural', () => {
      expect(formatTypeCount('procurement', 0)).toBe('0 active bids');
    });

    it('formats singular intelligence count', () => {
      expect(formatTypeCount('intelligence', 1)).toBe('1 active intelligence stream');
    });

    it('formats plural intelligence count', () => {
      expect(formatTypeCount('intelligence', 3)).toBe('3 active intelligence streams');
    });

    it('falls back to "workspace(s)" for unknown type', () => {
      expect(formatTypeCount('unknown_type', 1)).toBe('1 active workspace');
      expect(formatTypeCount('unknown_type', 5)).toBe('5 active workspaces');
    });
  });
});
