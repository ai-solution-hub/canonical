/**
 * Schema-DB consistency tests.
 *
 * Verifies that TypeScript validation constants in lib/validation/schemas.ts
 * match the DB taxonomy snapshot. The DB is the single source of truth.
 *
 * Run: bun run test -- __tests__/validation/schema-db-consistency.test.ts
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  VALID_CONTENT_TYPES,
  VALID_PLATFORMS,
} from '../../lib/validation/schemas';

const PROJECT_ROOT = join(__dirname, '../..');
const SNAPSHOT_PATH = join(
  PROJECT_ROOT,
  'scripts/tests/fixtures/taxonomy_snapshot.json',
);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SnapshotDomain {
  id: string;
  name: string;
  display_order: number;
  colour: string | null;
  provenance: string;
}

interface SnapshotSubtopic {
  id: string;
  domain_id: string;
  name: string;
  display_order: number;
  provenance: string;
  description: string | null;
}

interface TaxonomySnapshot {
  generated_at: string;
  domains: SnapshotDomain[];
  subtopics: SnapshotSubtopic[];
  content_types?: string[];
  platforms?: string[];
}

const SNAPSHOT_EXISTS = existsSync(SNAPSHOT_PATH);
const snapshot: TaxonomySnapshot | null = SNAPSHOT_EXISTS
  ? JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'))
  : null;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Schema-DB Consistency', () => {
  describe.skipIf(!snapshot?.content_types)(
    'Content Types (from snapshot)',
    () => {
      it('VALID_CONTENT_TYPES should match DB CHECK constraint values', () => {
        const tsTypes = [...VALID_CONTENT_TYPES].sort();
        const dbTypes = [...snapshot!.content_types!].sort();
        expect(tsTypes).toEqual(dbTypes);
      });

      it('no content types should be in DB but missing from TypeScript', () => {
        const tsSet = new Set<string>(VALID_CONTENT_TYPES);
        const missing = snapshot!.content_types!.filter((t) => !tsSet.has(t));
        expect(
          missing,
          `Content types in DB but missing from schemas.ts: ${missing.join(', ')}`,
        ).toHaveLength(0);
      });

      it('no content types should be in TypeScript but missing from DB', () => {
        const dbSet = new Set(snapshot!.content_types!);
        const extra = VALID_CONTENT_TYPES.filter((t) => !dbSet.has(t));
        expect(
          extra,
          `Content types in schemas.ts but missing from DB: ${extra.join(', ')}`,
        ).toHaveLength(0);
      });
    },
  );

  describe.skipIf(!snapshot?.platforms)('Platforms (from snapshot)', () => {
    it('VALID_PLATFORMS should match DB CHECK constraint values', () => {
      const tsPlatforms = [...VALID_PLATFORMS].sort();
      const dbPlatforms = [...snapshot!.platforms!].sort();
      expect(tsPlatforms).toEqual(dbPlatforms);
    });

    it('no platforms should be in DB but missing from TypeScript', () => {
      const tsSet = new Set<string>(VALID_PLATFORMS);
      const missing = snapshot!.platforms!.filter((p) => !tsSet.has(p));
      expect(
        missing,
        `Platforms in DB but missing from schemas.ts: ${missing.join(', ')}`,
      ).toHaveLength(0);
    });

    it('no platforms should be in TypeScript but missing from DB', () => {
      const dbSet = new Set(snapshot!.platforms!);
      const extra = VALID_PLATFORMS.filter((p) => !dbSet.has(p));
      expect(
        extra,
        `Platforms in schemas.ts but missing from DB: ${extra.join(', ')}`,
      ).toHaveLength(0);
    });
  });

  describe.skipIf(!SNAPSHOT_EXISTS)('Taxonomy Domain Coverage', () => {
    it('every baseline domain should have a colour key assigned', () => {
      const baselineDomains = snapshot!.domains.filter(
        (d) => d.provenance === 'baseline',
      );
      for (const domain of baselineDomains) {
        expect(
          domain.colour,
          `Baseline domain "${domain.name}" has no colour key`,
        ).toBeTruthy();
      }
    });

    it('baseline domain names should be lowercase kebab-case', () => {
      const baselineDomains = snapshot!.domains.filter(
        (d) => d.provenance === 'baseline',
      );
      for (const domain of baselineDomains) {
        expect(
          domain.name,
          `Domain name "${domain.name}" is not lowercase kebab-case`,
        ).toMatch(/^[a-z][a-z0-9-]*$/);
      }
    });

    it('all subtopic names should be lowercase kebab-case', () => {
      for (const subtopic of snapshot!.subtopics) {
        expect(
          subtopic.name,
          `Subtopic name "${subtopic.name}" is not lowercase kebab-case`,
        ).toMatch(/^[a-z][a-z0-9-]*$/);
      }
    });

    it('no duplicate subtopic names within a domain', () => {
      const domainGroups = new Map<string, string[]>();
      for (const st of snapshot!.subtopics) {
        const group = domainGroups.get(st.domain_id) ?? [];
        group.push(st.name);
        domainGroups.set(st.domain_id, group);
      }

      for (const [domainId, names] of domainGroups) {
        const unique = new Set(names);
        const domain = snapshot!.domains.find((d) => d.id === domainId);
        expect(
          unique.size,
          `Domain "${domain?.name}" has duplicate subtopics: ${names.filter((n, i) => names.indexOf(n) !== i).join(', ')}`,
        ).toBe(names.length);
      }
    });
  });
});
