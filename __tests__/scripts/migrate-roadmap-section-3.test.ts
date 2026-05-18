/**
 * Tests for scripts/migrate-roadmap-section-3.ts — WP4 Subtask 1 TDD.
 *
 * The migration script flattens Roadmap §3 (AI Evaluation Pathway parent)
 * so its sub-sections become top-level sections per the mapping table:
 *
 *   "3.1" → "3", "3.2" → "4", "3.3" → "5", "3.4" → "6",
 *   "3.5" → "7", "3.7" → "8",
 *   "4" → "9", "5" → "10", "8" → "11", "9" → "12", "11" → "13"
 *
 * Key invariants:
 *   1. The umbrella §3 section (parent_id: null, id: "3") is removed.
 *   2. Former sub-sections become top-level (parent_id: null).
 *   3. Per-item id and section_id cascade correctly.
 *   4. Sections not in the mapping table remain unchanged.
 *   5. Running the script twice produces no further diff (idempotent).
 */

import { describe, it, expect } from 'vitest';
import { applyRoadmapSection3Migration } from '@/scripts/migrate-roadmap-section-3';

// Minimal fixture that captures the key structural features
const FIXTURE_ROADMAP = {
  document_name: 'Knowledge Hub Roadmap',
  document_purpose: 'Test fixture',
  date: '2026-05-18',
  status: 'Active',
  forward_looking_only: true,
  related_documents: [],
  last_updated: 'test',
  sections: [
    // §1 — unchanged
    {
      id: '1',
      parent_id: null,
      number: '1',
      title: 'Pre-Launch Items',
      narrative: null,
      spec_links: [],
      owner: null,
      table_columns: 'item_desc_owner_effort_status',
      items: [
        {
          id: '1.4',
          section_id: '1',
          title: 'Item 1.4',
          phase_label: null,
          description: 'desc',
          effort_estimate: '1h',
          priority: null,
          priority_note: null,
          severity: null,
          status: 'pending',
          status_note: null,
          owner: null,
          depends_on: [],
          blocks: [],
          coordinates_with: [],
          cross_doc_links: [],
          session_refs: [],
          commit_refs: [],
        },
      ],
    },
    // §3 umbrella (parent_id: null) — to be REMOVED
    {
      id: '3',
      parent_id: null,
      number: '3',
      title: 'AI Evaluation Pathway (active development)',
      narrative: 'Strategy doc link',
      spec_links: [],
      owner: null,
      table_columns: 'item_desc_effort_priority',
      items: [],
    },
    // §3.1 sub-section → new §3
    {
      id: '3.1',
      parent_id: '3',
      number: '3.1',
      title: 'Pass 2 improvements',
      narrative: 'narrative text',
      spec_links: [],
      owner: null,
      table_columns: 'item_desc_effort_priority',
      items: [
        {
          id: '3.1.2',
          section_id: '3.1',
          title: 'Item 3.1.2',
          phase_label: null,
          description: 'desc',
          effort_estimate: '1h',
          priority: 'should',
          priority_note: null,
          severity: null,
          status: null,
          status_note: null,
          owner: null,
          depends_on: [],
          blocks: [],
          coordinates_with: [],
          cross_doc_links: [],
          session_refs: [],
          commit_refs: [],
        },
        {
          id: '3.1.8',
          section_id: '3.1',
          title: 'Item 3.1.8',
          phase_label: null,
          description: 'desc',
          effort_estimate: '6h',
          priority: 'must',
          priority_note: null,
          severity: null,
          status: null,
          status_note: null,
          owner: null,
          depends_on: [],
          blocks: [],
          coordinates_with: [],
          cross_doc_links: [],
          session_refs: [],
          commit_refs: [],
        },
      ],
    },
    // §3.2 sub-section → new §4
    {
      id: '3.2',
      parent_id: '3',
      number: '3.2',
      title: 'Phase 2 outstanding items',
      narrative: null,
      spec_links: [],
      owner: null,
      table_columns: 'item_desc_effort_priority',
      items: [],
    },
    // §3.7 sub-section → new §8 (§3.6 is vacant in the real JSON)
    {
      id: '3.7',
      parent_id: '3',
      number: '3.7',
      title: 'AI Telemetry Instrumentation',
      narrative: null,
      spec_links: [],
      owner: null,
      table_columns: 'phase_desc_effort_priority',
      items: [
        {
          id: '3.7.1',
          section_id: '3.7',
          title: 'Phase 1 — Wire telemetry',
          phase_label: 'Phase 1 — Wire telemetry',
          description: 'desc',
          effort_estimate: '6-8h',
          priority: 'must',
          priority_note: null,
          severity: null,
          status: null,
          status_note: null,
          owner: null,
          depends_on: [],
          blocks: [],
          coordinates_with: [],
          cross_doc_links: [],
          session_refs: [],
          commit_refs: [],
        },
      ],
    },
    // §4 (old) → new §9
    {
      id: '4',
      parent_id: null,
      number: '4',
      title: 'Bid Workflow & Templates',
      narrative: null,
      spec_links: [],
      owner: null,
      table_columns: 'item_desc_effort_priority',
      items: [],
    },
    // §4.1 sub-section of old §4 → new §9.1
    {
      id: '4.1',
      parent_id: '4',
      number: '4.1',
      title: 'Template-Driven Completeness',
      narrative: null,
      spec_links: [],
      owner: null,
      table_columns: 'phase_desc_effort_priority',
      items: [
        {
          id: '4.1.1',
          section_id: '4.1',
          title: 'Phase 5',
          phase_label: 'Phase 5',
          description: 'desc',
          effort_estimate: '1-2 sessions',
          priority: 'should',
          priority_note: null,
          severity: null,
          status: null,
          status_note: null,
          owner: null,
          depends_on: [],
          blocks: [],
          coordinates_with: [],
          cross_doc_links: [],
          session_refs: [],
          commit_refs: [],
        },
      ],
    },
    // §8 (old, E2E Test Expansion) → new §11
    {
      id: '8',
      parent_id: null,
      number: '8',
      title: 'E2E Test Expansion',
      narrative: null,
      spec_links: [],
      owner: null,
      table_columns: 'item_desc_effort_priority',
      items: [
        {
          id: '8.1',
          section_id: '8',
          title: 'Programmatic test audit',
          phase_label: null,
          description: 'desc',
          effort_estimate: '1-2 sessions',
          priority: 'must',
          priority_note: null,
          severity: null,
          status: null,
          status_note: null,
          owner: null,
          depends_on: [],
          blocks: [],
          coordinates_with: [],
          cross_doc_links: [],
          session_refs: [],
          commit_refs: [],
        },
      ],
    },
    // §11 (old, Context Graph Phase 5) → new §13
    {
      id: '11',
      parent_id: null,
      number: '11',
      title: 'Context Graph Phase 5',
      narrative: null,
      spec_links: [],
      owner: null,
      table_columns: 'item_desc_priority_status',
      items: [
        {
          id: '11.1',
          section_id: '11',
          title: 'Q&A copy tracking',
          phase_label: null,
          description: 'desc',
          effort_estimate: null,
          priority: 'medium',
          priority_note: null,
          severity: null,
          status: 'pending',
          status_note: null,
          owner: null,
          depends_on: [],
          blocks: [],
          coordinates_with: [],
          cross_doc_links: [],
          session_refs: [],
          commit_refs: [],
        },
      ],
    },
  ],
} as const;

describe('migrate-roadmap-section-3', () => {
  describe('applyRoadmapSection3Migration', () => {
    it('removes the §3 umbrella section (parent_id: null, title "AI Evaluation Pathway")', () => {
      const result = applyRoadmapSection3Migration(
        JSON.parse(JSON.stringify(FIXTURE_ROADMAP)),
      );
      // The umbrella "AI Evaluation Pathway" section is gone
      const umbrella = result.sections.find(
        (s) =>
          s.title === 'AI Evaluation Pathway (active development)' &&
          s.parent_id === null,
      );
      expect(umbrella).toBeUndefined();
    });

    it('promotes §3.1 to top-level section id "3"', () => {
      const result = applyRoadmapSection3Migration(
        JSON.parse(JSON.stringify(FIXTURE_ROADMAP)),
      );
      const sec = result.sections.find((s) => s.title === 'Pass 2 improvements');
      expect(sec).toBeDefined();
      expect(sec!.id).toBe('3');
      expect(sec!.parent_id).toBeNull();
      expect(sec!.number).toBe('3');
    });

    it('promotes §3.2 to top-level section id "4"', () => {
      const result = applyRoadmapSection3Migration(
        JSON.parse(JSON.stringify(FIXTURE_ROADMAP)),
      );
      const sec = result.sections.find(
        (s) => s.title === 'Phase 2 outstanding items',
      );
      expect(sec).toBeDefined();
      expect(sec!.id).toBe('4');
      expect(sec!.parent_id).toBeNull();
    });

    it('promotes §3.7 to top-level section id "8"', () => {
      const result = applyRoadmapSection3Migration(
        JSON.parse(JSON.stringify(FIXTURE_ROADMAP)),
      );
      const sec = result.sections.find(
        (s) => s.title === 'AI Telemetry Instrumentation',
      );
      expect(sec).toBeDefined();
      expect(sec!.id).toBe('8');
      expect(sec!.parent_id).toBeNull();
      expect(sec!.number).toBe('8');
    });

    it('renumbers old §4 to "9"', () => {
      const result = applyRoadmapSection3Migration(
        JSON.parse(JSON.stringify(FIXTURE_ROADMAP)),
      );
      const sec = result.sections.find(
        (s) => s.title === 'Bid Workflow & Templates',
      );
      expect(sec).toBeDefined();
      expect(sec!.id).toBe('9');
      expect(sec!.number).toBe('9');
    });

    it('renumbers old §8 (E2E) to "11"', () => {
      const result = applyRoadmapSection3Migration(
        JSON.parse(JSON.stringify(FIXTURE_ROADMAP)),
      );
      const sec = result.sections.find((s) => s.title === 'E2E Test Expansion');
      expect(sec).toBeDefined();
      expect(sec!.id).toBe('11');
    });

    it('renumbers old §11 (Context Graph) to "13"', () => {
      const result = applyRoadmapSection3Migration(
        JSON.parse(JSON.stringify(FIXTURE_ROADMAP)),
      );
      const sec = result.sections.find(
        (s) => s.title === 'Context Graph Phase 5',
      );
      expect(sec).toBeDefined();
      expect(sec!.id).toBe('13');
    });

    it('cascades item ids: §3.1 items get new section prefix "3"', () => {
      const result = applyRoadmapSection3Migration(
        JSON.parse(JSON.stringify(FIXTURE_ROADMAP)),
      );
      const sec = result.sections.find((s) => s.id === '3');
      expect(sec).toBeDefined();
      const ids = sec!.items.map((it) => it.id);
      expect(ids).toContain('3.2');
      expect(ids).toContain('3.8');
      expect(ids).not.toContain('3.1.2');
      expect(ids).not.toContain('3.1.8');
    });

    it('updates section_id on items within promoted §3.1', () => {
      const result = applyRoadmapSection3Migration(
        JSON.parse(JSON.stringify(FIXTURE_ROADMAP)),
      );
      const sec = result.sections.find((s) => s.id === '3');
      for (const item of sec!.items) {
        expect(item.section_id).toBe('3');
      }
    });

    it('cascades item ids: §3.7 items get new section prefix "8"', () => {
      const result = applyRoadmapSection3Migration(
        JSON.parse(JSON.stringify(FIXTURE_ROADMAP)),
      );
      const sec = result.sections.find((s) => s.id === '8');
      expect(sec).toBeDefined();
      const ids = sec!.items.map((it) => it.id);
      expect(ids).toContain('8.1');
      expect(ids).not.toContain('3.7.1');
    });

    it('cascades sub-section ids: old §4.1 becomes §9.1 with parent_id "9"', () => {
      const result = applyRoadmapSection3Migration(
        JSON.parse(JSON.stringify(FIXTURE_ROADMAP)),
      );
      const sec = result.sections.find((s) => s.title === 'Template-Driven Completeness');
      expect(sec).toBeDefined();
      expect(sec!.id).toBe('9.1');
      expect(sec!.parent_id).toBe('9');
      expect(sec!.number).toBe('9.1');
    });

    it('cascades item ids within §4.1 → §9.1', () => {
      const result = applyRoadmapSection3Migration(
        JSON.parse(JSON.stringify(FIXTURE_ROADMAP)),
      );
      const sec = result.sections.find((s) => s.id === '9.1');
      expect(sec).toBeDefined();
      const ids = sec!.items.map((it) => it.id);
      expect(ids).toContain('9.1.1');
      expect(ids).not.toContain('4.1.1');
      for (const item of sec!.items) {
        expect(item.section_id).toBe('9.1');
      }
    });

    it('cascades item ids for old §8 → §11 (leaf numbers preserved)', () => {
      const result = applyRoadmapSection3Migration(
        JSON.parse(JSON.stringify(FIXTURE_ROADMAP)),
      );
      const sec = result.sections.find((s) => s.id === '11');
      expect(sec).toBeDefined();
      const ids = sec!.items.map((it) => it.id);
      expect(ids).toContain('11.1');
      expect(ids).not.toContain('8.1');
      for (const item of sec!.items) {
        expect(item.section_id).toBe('11');
      }
    });

    it('cascades item ids for old §11 → §13 (leaf numbers preserved)', () => {
      const result = applyRoadmapSection3Migration(
        JSON.parse(JSON.stringify(FIXTURE_ROADMAP)),
      );
      const sec = result.sections.find((s) => s.id === '13');
      expect(sec).toBeDefined();
      const ids = sec!.items.map((it) => it.id);
      expect(ids).toContain('13.1');
      expect(ids).not.toContain('11.1');
    });

    it('leaves §1 unchanged', () => {
      const result = applyRoadmapSection3Migration(
        JSON.parse(JSON.stringify(FIXTURE_ROADMAP)),
      );
      const sec = result.sections.find((s) => s.id === '1');
      expect(sec).toBeDefined();
      expect(sec!.items[0].id).toBe('1.4');
      expect(sec!.items[0].section_id).toBe('1');
    });

    it('is idempotent: running twice produces no further change', () => {
      const first = applyRoadmapSection3Migration(
        JSON.parse(JSON.stringify(FIXTURE_ROADMAP)),
      );
      const second = applyRoadmapSection3Migration(
        JSON.parse(JSON.stringify(first)),
      );
      expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    });

    it('produces a valid section count (umbrella removed, ex-subsections promoted)', () => {
      const result = applyRoadmapSection3Migration(
        JSON.parse(JSON.stringify(FIXTURE_ROADMAP)),
      );
      // Original: §1, §3(umbrella), §3.1, §3.2, §3.7, §4, §4.1, §8, §11 = 9 sections
      // After: §1, §3(was 3.1), §4(was 3.2), §8(was 3.7), §9(was 4), §9.1(was 4.1), §11(was 8), §13(was 11) = 8 sections
      // (umbrella §3 removed → -1; ex-subsections stay same count)
      expect(result.sections.length).toBe(8);
    });

    it('sections are in ascending numeric order by id', () => {
      const result = applyRoadmapSection3Migration(
        JSON.parse(JSON.stringify(FIXTURE_ROADMAP)),
      );
      const topLevel = result.sections.filter((s) => s.parent_id === null);
      const ids = topLevel.map((s) => s.id);
      // top-level ids should be strictly ascending numeric
      for (let i = 1; i < ids.length; i++) {
        expect(parseFloat(ids[i])).toBeGreaterThan(parseFloat(ids[i - 1]));
      }
    });
  });
});
