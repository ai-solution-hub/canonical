/**
 * Structural tests for starter pack definitions.
 *
 * These guard against drift in the starter pack data — every pack must have
 * a unique ID, at least one feed, well-formed URLs, and all feeds must use
 * source_type 'rss' (per the DB CHECK constraint and spec F1 correction).
 */
import { describe, it, expect } from 'vitest';
import {
  STARTER_PACKS,
  getStarterPack,
} from '@/lib/intelligence/starter-packs';

describe('STARTER_PACKS', () => {
  it('has at least 4 packs', () => {
    expect(STARTER_PACKS.length).toBeGreaterThanOrEqual(4);
  });

  it('has unique pack IDs', () => {
    const ids = STARTER_PACKS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  describe.each(STARTER_PACKS)('pack "$id"', (pack) => {
    it('has a non-empty name', () => {
      expect(pack.name.trim().length).toBeGreaterThan(0);
    });

    it('has a non-empty description', () => {
      expect(pack.description.trim().length).toBeGreaterThan(0);
    });

    it('has at least one sector', () => {
      expect(pack.sectors.length).toBeGreaterThanOrEqual(1);
    });

    it('has at least one feed', () => {
      expect(pack.feeds.length).toBeGreaterThanOrEqual(1);
    });

    it('every feed has a non-empty name', () => {
      for (const feed of pack.feeds) {
        expect(feed.name.trim().length).toBeGreaterThan(0);
      }
    });

    it('every feed has a non-empty URL', () => {
      for (const feed of pack.feeds) {
        expect(feed.url.trim().length).toBeGreaterThan(0);
      }
    });

    it('every feed URL starts with https://', () => {
      for (const feed of pack.feeds) {
        expect(feed.url).toMatch(/^https:\/\//);
      }
    });

    it('every feed uses source_type "rss" (per DB CHECK constraint)', () => {
      for (const feed of pack.feeds) {
        expect(feed.source_type).toBe('rss');
      }
    });
  });
});

describe('getStarterPack', () => {
  it('returns the pack for a valid ID', () => {
    const pack = getStarterPack('education');
    expect(pack).toBeDefined();
    expect(pack!.id).toBe('education');
  });

  it('returns undefined for an unknown ID', () => {
    expect(getStarterPack('nonexistent')).toBeUndefined();
  });
});
