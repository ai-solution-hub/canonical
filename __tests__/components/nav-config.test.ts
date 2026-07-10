/**
 * nav-config Tests
 *
 * BI-18/BI-19 lockstep anchor: the single source of truth consumed by
 * site-header.tsx and command-palette.tsx. Table-driven, behaviour-first
 * (test-philosophy.md) — asserts the ratified zone membership (BI-4/9/11),
 * exact labels (BI-17), the isEntryVisible role-gating matrix (BI-20/21),
 * the Concepts reserved-slot filter (BI-8), and the isEntryActive /
 * isZoneActive path predicates (BI-23/24).
 */
import { describe, it, expect } from 'vitest';
import {
  NAV_ZONES,
  isEntryVisible,
  isEntryActive,
  isZoneActive,
  type NavVisibility,
} from '@/components/shell/nav-config';

const ALL_ENTRIES = NAV_ZONES.flatMap((zone) =>
  zone.entries.map((entry) => ({ zone: zone.id, ...entry })),
);

describe('NAV_ZONES membership', () => {
  it('groups zones in the ratified BI-2 order with exact header strings', () => {
    expect(NAV_ZONES.map((z) => z.id)).toEqual([
      'applications',
      'knowledge',
      'governance',
    ]);
    expect(NAV_ZONES.map((z) => z.header)).toEqual([
      'Applications',
      'Knowledge',
      'Governance',
    ]);
  });

  it.each([
    ['applications', 'Procurement', '/procurement', 'all'],
    ['applications', 'Intelligence', '/intelligence', 'edit'],
    ['knowledge', 'Search', '/search', 'all'],
    ['knowledge', 'Answers', '/library', 'all'],
    ['knowledge', 'External sources', '/reference', 'all'],
    ['knowledge', 'Concepts', '/okf', 'all'],
    ['governance', 'Review', '/review', 'edit'],
    ['governance', 'Coverage', '/coverage', 'edit'],
    ['governance', 'Change reports', '/change-reports', 'all'],
    ['governance', 'Activity', '/activity', 'all'],
    ['governance', 'Provenance', '/provenance', 'admin'],
  ] as const)(
    'encodes %s zone entry %s (%s) with visibility %s',
    (zoneId, label, href, visibility) => {
      const entry = ALL_ENTRIES.find((e) => e.href === href);
      expect(entry).toBeDefined();
      expect(entry?.zone).toBe(zoneId);
      expect(entry?.label).toBe(label);
      expect(entry?.visibility).toBe(visibility satisfies NavVisibility);
    },
  );

  it('has no duplicate hrefs across zones (BI-3 closed membership)', () => {
    const hrefs = ALL_ENTRIES.map((e) => e.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it('marks only Concepts as reserved (BI-8)', () => {
    const reserved = ALL_ENTRIES.filter((e) => e.reserved);
    expect(reserved.map((e) => e.href)).toEqual(['/okf']);
  });
});

describe('isEntryVisible role-gating (BI-20/BI-21)', () => {
  const viewer = { canEdit: false, canAdmin: false };
  const editor = { canEdit: true, canAdmin: false };
  const admin = { canEdit: true, canAdmin: true };

  it.each([
    ['all', viewer, true],
    ['all', editor, true],
    ['all', admin, true],
    ['edit', viewer, false],
    ['edit', editor, true],
    ['edit', admin, true],
    ['admin', viewer, false],
    ['admin', editor, false],
    ['admin', admin, true],
  ] as const)(
    'visibility=%s role=%o resolves to %s',
    (visibility, role, expected) => {
      expect(isEntryVisible(visibility, role)).toBe(expected);
    },
  );

  it('keeps every Knowledge entry visible to a viewer (BI-20 role-uniform zone)', () => {
    const knowledgeZone = NAV_ZONES.find((z) => z.id === 'knowledge')!;
    for (const entry of knowledgeZone.entries) {
      expect(isEntryVisible(entry.visibility, viewer)).toBe(true);
    }
  });

  it('hides only the edit/admin Governance entries from a viewer (BI-21 no silent audience change)', () => {
    const governanceZone = NAV_ZONES.find((z) => z.id === 'governance')!;
    const hiddenForViewer = governanceZone.entries.filter(
      (entry) => !isEntryVisible(entry.visibility, viewer),
    );
    expect(hiddenForViewer.map((e) => e.href).sort()).toEqual(
      ['/coverage', '/provenance', '/review'].sort(),
    );
  });
});

describe('reserved-entry render filter (BI-8)', () => {
  it('excludes the Concepts entry from a render-visible list until its route lands', () => {
    const renderable = ALL_ENTRIES.filter((e) => !e.reserved);
    expect(renderable.some((e) => e.href === '/okf')).toBe(false);
    expect(ALL_ENTRIES.some((e) => e.href === '/okf')).toBe(true);
  });
});

describe('isEntryActive / isZoneActive path predicates (BI-23/BI-24)', () => {
  it('matches an exact leaf path', () => {
    expect(isEntryActive('/reference', '/reference')).toBe(true);
  });

  it('matches a nested leaf path via the trailing-slash rule', () => {
    expect(isEntryActive('/reference', '/reference/abc-123')).toBe(true);
  });

  it('does not match an unrelated path', () => {
    expect(isEntryActive('/reference', '/documents/abc-123')).toBe(false);
  });

  it('does not match a prefix-sharing sibling route', () => {
    expect(isEntryActive('/review', '/reviewer-notes')).toBe(false);
  });

  it('handles a null pathname without throwing', () => {
    expect(isEntryActive('/reference', null)).toBe(false);
  });

  it('activates the Knowledge zone when a nested External sources path is current', () => {
    const knowledgeZone = NAV_ZONES.find((z) => z.id === 'knowledge')!;
    expect(isZoneActive(knowledgeZone, '/reference/abc-123')).toBe(true);
  });

  it('leaves every zone inactive for a path outside the nav config (/documents/[id])', () => {
    for (const zone of NAV_ZONES) {
      expect(isZoneActive(zone, '/documents/abc-123')).toBe(false);
    }
  });
});
