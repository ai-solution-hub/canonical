/**
 * Tests for scripts/generate-purge-path-inventory.ts — ID-68.29 purge-prep
 * path-inventory generator (TECH PC-35 step 2).
 *
 * All fixtures use a SYNTHETIC client stem ('acme') — the real denylist token
 * values must never appear in this repo (PC-31 placement constraint). The
 * generator itself reads the canonical denylist at runtime from the private
 * docs-site checkout; these tests exercise the pure derivation/rendering
 * functions only.
 */
import { describe, expect, it } from 'vitest';

import {
  annotateHeadState,
  applyKeepPrefixes,
  buildStemDerivedPaths,
  dedupeGroups,
  deriveClientStem,
  renderPathsFromFile,
  type Denylist,
  type InventoryGroup,
} from '@/scripts/generate-purge-path-inventory';

const SYNTHETIC_DENYLIST: Denylist = {
  version: 1,
  updated: '2026-06-07',
  tokens: [
    {
      value: 'acme',
      case_insensitive: true,
      class: 'client-name stem + derived identifiers',
    },
    {
      value: 'Acme Widgets Limited',
      case_insensitive: true,
      class: 'legal name',
    },
    {
      value: 'datahall',
      case_insensitive: true,
      class: 'datacentre literal',
    },
  ],
};

describe('deriveClientStem', () => {
  it('returns the value of the client-name stem token', () => {
    expect(deriveClientStem(SYNTHETIC_DENYLIST)).toBe('acme');
  });

  it('fails loudly when no stem-class token exists', () => {
    const noStem: Denylist = {
      version: 1,
      updated: '2026-06-07',
      tokens: [
        {
          value: 'datahall',
          case_insensitive: true,
          class: 'datacentre literal',
        },
      ],
    };
    expect(() => deriveClientStem(noStem)).toThrow(/client-name stem/);
  });

  it('fails loudly when multiple stem-class tokens exist (ambiguous)', () => {
    const twoStems: Denylist = {
      version: 1,
      updated: '2026-06-07',
      tokens: [
        {
          value: 'acme',
          case_insensitive: true,
          class: 'client-name stem + derived identifiers',
        },
        {
          value: 'globex',
          case_insensitive: true,
          class: 'client-name stem + derived identifiers',
        },
      ],
    };
    expect(() => deriveClientStem(twoStems)).toThrow(/ambiguous/i);
  });
});

describe('buildStemDerivedPaths', () => {
  const derived = buildStemDerivedPaths('acme');

  it('templates the branding paths from the stem (Inv 33-A)', () => {
    expect(derived.brandingExact).toEqual(['lib/branding/clients/acme.json']);
    expect(derived.brandingDirs).toEqual(['public/clients/acme/']);
  });

  it('templates the 3 record-19 deleted client-named scripts', () => {
    expect(derived.deletedScripts).toEqual([
      'scripts/export-acme-articles.ts',
      'scripts/seed-acme-guides.ts',
      'scripts/split_acme_site_content.py',
    ]);
  });

  it('templates the conditional migration --path-rename pair (OQ-H/OQ-G(b))', () => {
    expect(derived.conditionalMigration.path).toBe(
      'supabase/migrations/20260424202806_capture_acme_domain_hook.sql',
    );
    expect(derived.conditionalMigration.renameTo).toBe(
      'supabase/migrations/20260424202806_capture_signup_domain_hook.sql',
    );
  });
});

describe('annotateHeadState', () => {
  const tracked = new Set([
    'docs/runbooks/ci.md',
    'public/clients/acme/logo.webp',
  ]);

  it('marks a HEAD-tracked file as pending-relocation', () => {
    const [a] = annotateHeadState(['docs/runbooks/ci.md'], tracked);
    expect(a).toEqual({
      path: 'docs/runbooks/ci.md',
      state: 'pending-relocation',
    });
  });

  it('marks an untracked file as already-removed-at-HEAD', () => {
    const [a] = annotateHeadState(['docs/client-personas.md'], tracked);
    expect(a).toEqual({
      path: 'docs/client-personas.md',
      state: 'already-removed-at-HEAD',
    });
  });

  it('marks a directory entry pending when any tracked path lives under it', () => {
    const [a] = annotateHeadState(['public/clients/acme/'], tracked);
    expect(a.state).toBe('pending-relocation');
  });

  it('marks a directory entry removed when nothing tracked lives under it', () => {
    const [a] = annotateHeadState(['public/clients/globex/'], tracked);
    expect(a.state).toBe('already-removed-at-HEAD');
  });
});

describe('applyKeepPrefixes', () => {
  it('splits paths matching a keep prefix out of the removal set (OQ-E branch)', () => {
    const { kept, excluded } = applyKeepPrefixes(
      ['docs/ontology/entity-types.md', 'docs/runbooks/ci.md'],
      ['docs/ontology/'],
    );
    expect(kept).toEqual(['docs/runbooks/ci.md']);
    expect(excluded).toEqual(['docs/ontology/entity-types.md']);
  });

  it('returns everything kept when no keeps are supplied', () => {
    const { kept, excluded } = applyKeepPrefixes(['docs/a.md'], []);
    expect(kept).toEqual(['docs/a.md']);
    expect(excluded).toEqual([]);
  });
});

describe('dedupeGroups', () => {
  it('gives earlier groups precedence over later duplicates', () => {
    const groups: InventoryGroup[] = [
      {
        id: 'legacy-ac2',
        title: 'Legacy AC2 set',
        entries: [
          { path: 'docs/client-personas.md', state: 'already-removed-at-HEAD' },
        ],
      },
      {
        id: 'relocated-docs',
        title: 'Relocated docs/**',
        entries: [
          { path: 'docs/client-personas.md', state: 'already-removed-at-HEAD' },
          { path: 'docs/runbooks/ci.md', state: 'pending-relocation' },
        ],
      },
    ];
    const deduped = dedupeGroups(groups);
    expect(deduped[0].entries.map((e) => e.path)).toEqual([
      'docs/client-personas.md',
    ]);
    expect(deduped[1].entries.map((e) => e.path)).toEqual([
      'docs/runbooks/ci.md',
    ]);
  });
});

describe('renderPathsFromFile', () => {
  const groups: InventoryGroup[] = [
    {
      id: 'legacy-ac2',
      title: 'Legacy AC2 set',
      entries: [
        { path: 'docs/client-personas.md', state: 'already-removed-at-HEAD' },
        {
          path: 'docs/kh-client-feedback.md',
          state: 'already-removed-at-HEAD',
        },
      ],
    },
    {
      id: 'relocated-docs',
      title: 'Relocated docs/**',
      entries: [{ path: 'docs/runbooks/ci.md', state: 'pending-relocation' }],
    },
  ];

  const rendered = renderPathsFromFile({
    headSha: 'abc1234',
    generatedAt: '2026-06-07T12:00:00.000Z',
    groups,
    keepExcluded: ['docs/ontology/entity-types.md'],
    conditionalMigration: {
      path: 'supabase/migrations/20260424202806_capture_acme_domain_hook.sql',
      renameTo:
        'supabase/migrations/20260424202806_capture_signup_domain_hook.sql',
    },
  });
  const lines = rendered.split('\n');
  const pathLines = lines.filter((l) => l.trim() && !l.startsWith('#'));

  it('cites the HEAD SHA in the header (Phase-5 artefact rule)', () => {
    expect(rendered).toContain('abc1234');
  });

  it('emits every group path as a bare git-filter-repo line', () => {
    expect(pathLines).toContain('docs/client-personas.md');
    expect(pathLines).toContain('docs/kh-client-feedback.md');
    expect(pathLines).toContain('docs/runbooks/ci.md');
  });

  it('marks pending-relocation vs already-removed-at-HEAD via comment subsections', () => {
    expect(rendered).toMatch(/^# .*pending-relocation/m);
    expect(rendered).toMatch(/^# .*already-removed-at-HEAD/m);
  });

  it('keeps the conditional migration OUT of the removal set (comment-only)', () => {
    const migration =
      'supabase/migrations/20260424202806_capture_acme_domain_hook.sql';
    expect(pathLines).not.toContain(migration);
    expect(rendered).toContain(`# ${migration}`);
  });

  it('lists keep-excluded paths as comments only (OQ-E branch visibility)', () => {
    expect(pathLines).not.toContain('docs/ontology/entity-types.md');
    expect(rendered).toContain('# docs/ontology/entity-types.md');
  });

  it('never emits a harness/CI floor file (Inv 18/19 guard)', () => {
    for (const floor of ['README.md', 'AGENTS.md', 'CLAUDE.md']) {
      expect(pathLines).not.toContain(floor);
    }
  });

  it('emits no duplicate path lines', () => {
    expect(new Set(pathLines).size).toBe(pathLines.length);
  });
});
