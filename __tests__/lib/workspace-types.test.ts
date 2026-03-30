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
    it('returns config for "bid" type', () => {
      const config = getWorkspaceType('bid');
      expect(config).toBeDefined();
      expect(config!.type).toBe('bid');
      expect(config!.label).toBe('Bid');
      expect(config!.labelPlural).toBe('Bids');
      expect(config!.route).toBe('/bid');
      expect(config!.available).toBe(true);
      expect(config!.hasCustomCreation).toBe(true);
    });

    it('returns config for "kb_section" type', () => {
      const config = getWorkspaceType('kb_section');
      expect(config).toBeDefined();
      expect(config!.type).toBe('kb_section');
      expect(config!.label).toBe('KB Section');
      expect(config!.labelPlural).toBe('KB Sections');
      expect(config!.route).toBeNull();
      expect(config!.available).toBe(true);
      expect(config!.hasCustomCreation).toBe(false);
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
  });

  describe('getAllWorkspaceTypes', () => {
    it('returns all registered types', () => {
      const all = getAllWorkspaceTypes();
      expect(all.length).toBeGreaterThanOrEqual(3);
      const types = all.map((t) => t.type);
      expect(types).toContain('bid');
      expect(types).toContain('kb_section');
      expect(types).toContain('proposal');
    });

    it('returns an array (not a record)', () => {
      const all = getAllWorkspaceTypes();
      expect(Array.isArray(all)).toBe(true);
    });
  });

  describe('getLauncherTypes', () => {
    it('includes types with a route', () => {
      const launcher = getLauncherTypes();
      const types = launcher.map((t) => t.type);
      expect(types).toContain('bid');
    });

    it('includes unavailable types (shown as "coming soon")', () => {
      const launcher = getLauncherTypes();
      const types = launcher.map((t) => t.type);
      expect(types).toContain('proposal');
    });

    it('excludes available types with no route and no "coming soon" status', () => {
      const launcher = getLauncherTypes();
      const types = launcher.map((t) => t.type);
      // kb_section has route=null and available=true, so it should be excluded
      expect(types).not.toContain('kb_section');
    });
  });

  describe('getValidTypeValues', () => {
    it('returns a non-empty tuple', () => {
      const values = getValidTypeValues();
      expect(values.length).toBeGreaterThanOrEqual(1);
    });

    it('includes bid and kb_section', () => {
      const values = getValidTypeValues();
      expect(values).toContain('bid');
      expect(values).toContain('kb_section');
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
    it('formats singular bid count', () => {
      expect(formatTypeCount('bid', 1)).toBe('1 active bid');
    });

    it('formats plural bid count', () => {
      expect(formatTypeCount('bid', 5)).toBe('5 active bids');
    });

    it('formats zero bid count as plural', () => {
      expect(formatTypeCount('bid', 0)).toBe('0 active bids');
    });

    it('formats singular kb_section count', () => {
      expect(formatTypeCount('kb_section', 1)).toBe('1 active kb section');
    });

    it('formats plural kb_section count', () => {
      expect(formatTypeCount('kb_section', 3)).toBe('3 active kb sections');
    });

    it('falls back to "workspace(s)" for unknown type', () => {
      expect(formatTypeCount('unknown_type', 1)).toBe('1 active workspace');
      expect(formatTypeCount('unknown_type', 5)).toBe('5 active workspaces');
    });
  });
});
