/**
 * Taxonomy consistency tests.
 *
 * Verifies that the classification prompt (docs-site ops/classification-prompt.md,
 * resolved via the KH_PRIVATE_DOCS_DIR bridge), the DB taxonomy snapshot
 * (scripts/tests/fixtures/taxonomy_snapshot.json), and the code constants
 * (lib/validation/schemas.ts) all agree.
 *
 * The DB is the single source of truth. The classification prompt must reflect
 * the baseline taxonomy. The snapshot is refreshed via:
 *   bun run scripts/generate-taxonomy-snapshot.ts
 *
 * The snapshot-only blocks (DB Snapshot Integrity, Snapshot Freshness) run on
 * the committed fixture and stay live in the default `bun run test`. The
 * Classification-Prompt-vs-DB-Snapshot block depends on the private docs-site
 * checkout (classification-prompt.md relocated private under {68.23}); per
 * Inv 30 it is a deliberate opt-in lane — run with `bun run test:private-docs`
 * (sets VITEST_PRIVATE_DOCS=1) against a resolvable docs-site checkout. With the
 * env unset it SKIPS loudly via describe.skip, never silently.
 *
 * Run: bun run test -- __tests__/validation/taxonomy-consistency.test.ts
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeAll } from 'vitest';
import { resolvePrivateDocsDir } from '../../lib/private-docs';
import { parseCanonicalTaxonomy } from '../../scripts/lib/taxonomy-parser';

const PROJECT_ROOT = join(__dirname, '../..');

// classification-prompt.md relocated private ({68.23}); resolve via the
// KH_PRIVATE_DOCS_DIR bridge. resolvePrivateDocsDir() is fail-LOUD (Inv 29):
// wrap so an unresolvable private-docs dir yields a null path (and
// PROMPT_EXISTS = false), NOT a thrown error at collection.
function resolveCanonicalPath(): string | null {
  try {
    return join(resolvePrivateDocsDir(), 'ops', 'classification-prompt.md');
  } catch {
    return null;
  }
}
const CANONICAL_PATH = resolveCanonicalPath();
const SNAPSHOT_PATH = join(
  PROJECT_ROOT,
  'scripts/tests/fixtures/taxonomy_snapshot.json',
);

// ---------------------------------------------------------------------------
// Load fixtures
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
}

const SNAPSHOT_EXISTS = existsSync(SNAPSHOT_PATH);
const PROMPT_EXISTS = CANONICAL_PATH !== null && existsSync(CANONICAL_PATH);

// Deliberate opt-in lane ({98.1}): the prompt-vs-snapshot parity check needs the
// private docs-site checkout. Inv 30 forbids any PR-blocking Vitest from hard-
// requiring KH_PRIVATE_DOCS_DIR, so the default `bun run test` (env unset) must
// SKIP — but LOUDLY (describe.skip), not silently. Run the lane with
// `bun run test:private-docs` (sets VITEST_PRIVATE_DOCS=1).
const PRIVATE_DOCS_LANE = process.env.VITEST_PRIVATE_DOCS === '1';
const RUN_PROMPT_PARITY = PRIVATE_DOCS_LANE && SNAPSHOT_EXISTS && PROMPT_EXISTS;
const describePromptParity = RUN_PROMPT_PARITY ? describe : describe.skip;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Taxonomy Consistency', () => {
  describe.skipIf(!SNAPSHOT_EXISTS)('DB Snapshot Integrity', () => {
    let snapshot: TaxonomySnapshot;

    beforeAll(() => {
      snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'));
    });

    it('snapshot should contain at least 7 baseline domains', () => {
      const baseline = snapshot.domains.filter(
        (d) => d.provenance === 'baseline',
      );
      expect(baseline.length).toBeGreaterThanOrEqual(7);
    });

    it('snapshot should contain at least 30 subtopics', () => {
      expect(snapshot.subtopics.length).toBeGreaterThanOrEqual(30);
    });

    it('every subtopic should reference a valid domain_id', () => {
      const domainIds = new Set(snapshot.domains.map((d) => d.id));
      for (const st of snapshot.subtopics) {
        expect(
          domainIds.has(st.domain_id),
          `Subtopic "${st.name}" references missing domain_id ${st.domain_id}`,
        ).toBe(true);
      }
    });

    it('domain display_order values should be unique', () => {
      const orders = snapshot.domains.map((d) => d.display_order);
      expect(new Set(orders).size).toBe(orders.length);
    });

    it('baseline domains should have expected names', () => {
      const baselineNames = snapshot.domains
        .filter((d) => d.provenance === 'baseline')
        .map((d) => d.name)
        .sort();
      expect(baselineNames).toEqual([
        'compliance',
        'corporate',
        'implementation',
        'methodology',
        'product-feature',
        'security',
        'support',
      ]);
    });

    it('every baseline domain should have at least one subtopic', () => {
      const baselineDomains = snapshot.domains.filter(
        (d) => d.provenance === 'baseline',
      );
      for (const domain of baselineDomains) {
        const subs = snapshot.subtopics.filter(
          (s) => s.domain_id === domain.id,
        );
        expect(
          subs.length,
          `Domain "${domain.name}" has no subtopics`,
        ).toBeGreaterThan(0);
      }
    });
  });

  describePromptParity(
    'Classification Prompt vs DB Snapshot (opt-in: VITEST_PRIVATE_DOCS=1 + docs-site checkout)',
    () => {
      let snapshot: TaxonomySnapshot;
      let promptMap: Map<string, { slug: string; desc: string }[]>;

      beforeAll(() => {
        snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'));
        // CANONICAL_PATH is non-null here: the RUN_PROMPT_PARITY gate guarantees
        // PROMPT_EXISTS, which implies CANONICAL_PATH !== null.
        promptMap = parseCanonicalTaxonomy(CANONICAL_PATH as string);
      });

      it('prompt domains should match all active DB domains (case-insensitive)', () => {
        const promptDomains = [...promptMap.keys()].sort();
        const allDbDomains = snapshot.domains
          .map((d) => d.name.toLowerCase())
          .sort();

        expect(promptDomains).toEqual(allDbDomains);
      });

      it('prompt subtopics should be a subset of DB subtopics for each baseline domain', () => {
        const baselineDomains = snapshot.domains.filter(
          (d) => d.provenance === 'baseline',
        );

        for (const domain of baselineDomains) {
          const domainKey = domain.name.toLowerCase();
          const promptSubtopics = promptMap.get(domainKey);
          if (!promptSubtopics) {
            // Already caught by the domain-level test
            continue;
          }

          const dbSubtopicNames = new Set(
            snapshot.subtopics
              .filter((s) => s.domain_id === domain.id)
              .map((s) => s.name),
          );

          const promptSlugs = promptSubtopics.map((s) => s.slug);

          for (const slug of promptSlugs) {
            expect(
              dbSubtopicNames.has(slug),
              `Prompt subtopic "${slug}" in domain "${domainKey}" not found in DB snapshot. DB has: [${[...dbSubtopicNames].join(', ')}]`,
            ).toBe(true);
          }
        }
      });

      it('DB baseline subtopics not in prompt should be flagged (recommended or client additions)', () => {
        // This test documents drift — DB may have subtopics the prompt doesn't.
        // Baseline subtopics missing from the prompt suggest the prompt needs updating.
        const baselineDomains = snapshot.domains.filter(
          (d) => d.provenance === 'baseline',
        );
        const missingFromPrompt: string[] = [];

        for (const domain of baselineDomains) {
          const domainKey = domain.name.toLowerCase();
          const promptSubtopics = promptMap.get(domainKey);
          const promptSlugs = new Set(
            promptSubtopics?.map((s) => s.slug) ?? [],
          );

          const dbSubtopics = snapshot.subtopics.filter(
            (s) => s.domain_id === domain.id && s.provenance === 'baseline',
          );

          for (const sub of dbSubtopics) {
            if (!promptSlugs.has(sub.name)) {
              missingFromPrompt.push(`${domainKey}/${sub.name}`);
            }
          }
        }

        // This is informational — baseline subtopics SHOULD be in the prompt
        expect(
          missingFromPrompt,
          `Baseline subtopics in DB but missing from classification prompt: ${missingFromPrompt.join(', ')}. Run sync:taxonomy to update the prompt.`,
        ).toHaveLength(0);
      });
    },
  );

  describe.skipIf(!SNAPSHOT_EXISTS)('Snapshot Freshness', () => {
    let snapshot: TaxonomySnapshot;

    beforeAll(() => {
      snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'));
    });

    it('snapshot should have a valid generated_at timestamp', () => {
      expect(snapshot.generated_at).toBeDefined();
      const date = new Date(snapshot.generated_at);
      expect(date.getTime()).not.toBeNaN();
    });

    it('snapshot should not be older than 30 days', () => {
      const generated = new Date(snapshot.generated_at);
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      expect(
        generated >= thirtyDaysAgo,
        `Snapshot is stale (generated ${snapshot.generated_at}). Run: bun run scripts/generate-taxonomy-snapshot.ts`,
      ).toBe(true);
    });
  });
});
