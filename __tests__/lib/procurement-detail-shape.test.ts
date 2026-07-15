import { describe, it, expect } from 'vitest';
import {
  deriveProcessingStatus,
  deriveProcurementMetadata,
  deriveProcurementStatus,
  getPrimaryForm,
  getProcurementForms,
  getProcurementRollup,
} from '@/lib/domains/procurement/procurement-detail-shape';

// ID-145 {145.18} — REBUILD for the form-first re-architecture (BI-1..5,
// 13..19). Post-W1, `form_instances` IS the procurement item: every
// lifecycle fact is read directly off the flat GET response, and the
// processing/workflow axes are two independent signals that never collapse.
//
// The `getPrimaryForm` / `getProcurementForms` / `getProcurementRollup`
// LEGACY getters below are untouched — `procurement-forms-card.tsx` (outside
// this Subtask's file ownership; its removal is {145.19}'s) still imports
// them, so their pre-{145.18} nested-shape contract is preserved verbatim.

const FORM_A = {
  id: 'form-a',
  form_type: 'psq',
  name: 'PSQ',
  workflow_state: 'submitted',
  outcome: null,
  outcome_notes: null,
  deadline: '2026-07-01T00:00:00.000Z',
  submission_date: '2026-06-20T00:00:00.000Z',
  issuing_organisation: 'Acme Council',
  outcome_recorded_at: null,
  outcome_recorded_by: null,
  created_at: '2026-06-01T00:00:00.000Z',
  updated_at: '2026-06-20T00:00:00.000Z',
};

const FORM_B = {
  ...FORM_A,
  id: 'form-b',
  form_type: 'itt',
  workflow_state: 'won',
  outcome: 'won',
  deadline: '2026-08-01T00:00:00.000Z',
  created_at: '2026-06-10T00:00:00.000Z',
};

/** Pre-{145.18} nested workspace-umbrella shape — LEGACY getters only. */
const LEGACY_NESTED_SHAPE = {
  id: 'ws-1',
  name: 'Acme tender',
  description: null,
  forms: [FORM_A, FORM_B],
  rollup: {
    nearest_deadline: '2026-07-01T00:00:00.000Z',
    overall_outcome: 'won',
    counts_toward_win_rate: true,
    rollup_updated_at: '2026-06-21T00:00:00.000Z',
  },
  tender_documents: [
    {
      path: 'ws-1/doc.pdf',
      filename: 'doc.pdf',
      size: 1,
      mime_type: 'x',
      uploaded_at: 'x',
    },
  ],
};

/** Post-W1 flat form_instances response — the {145.18} derivations' input. */
const FLAT_ITEM = {
  id: 'form-1',
  name: 'Acme tender',
  description: null,
  form_type: 'psq',
  processing_status: 'analysed',
  workflow_state: 'submitted',
  deadline: '2026-07-01T00:00:00.000Z',
  submission_date: '2026-06-20T00:00:00.000Z',
  issuing_organisation: 'Acme Council',
  outcome: null,
  outcome_notes: null,
  outcome_recorded_at: null,
  outcome_recorded_by: null,
  reference_number: 'REF-123',
  estimated_value: 50000,
  tender_documents: [
    {
      path: 'form-1/doc.pdf',
      filename: 'doc.pdf',
      size: 1,
      mime_type: 'x',
      uploaded_at: 'x',
    },
  ],
};

describe('procurement-detail-shape', () => {
  describe('LEGACY nested-shape getters (pre-{145.18}, forms-card only)', () => {
    describe('getPrimaryForm', () => {
      it('returns the first (earliest-created) form', () => {
        expect(getPrimaryForm(LEGACY_NESTED_SHAPE)?.id).toBe('form-a');
      });
      it('returns null for an umbrella with no forms', () => {
        expect(getPrimaryForm({ id: 'x', name: 'y', forms: [] })).toBeNull();
      });
      it('returns null for nullish input', () => {
        expect(getPrimaryForm(null)).toBeNull();
        expect(getPrimaryForm(undefined)).toBeNull();
      });
    });

    describe('getProcurementForms / getProcurementRollup', () => {
      it('returns the forms array and the roll-up', () => {
        expect(getProcurementForms(LEGACY_NESTED_SHAPE)).toHaveLength(2);
        expect(getProcurementRollup(LEGACY_NESTED_SHAPE)?.overall_outcome).toBe(
          'won',
        );
      });
      it('returns empty array / null for nullish input', () => {
        expect(getProcurementForms(null)).toEqual([]);
        expect(getProcurementRollup(null)).toBeNull();
      });
      it('returns empty array / null for the flat {145.18} response (no forms/rollup keys)', () => {
        // Graceful degrade: the LEGACY getters never throw against the new
        // flat shape, they just correctly report "nothing nested here".
        expect(getProcurementForms(FLAT_ITEM)).toEqual([]);
        expect(getProcurementRollup(FLAT_ITEM)).toBeNull();
      });
    });
  });

  describe('deriveProcessingStatus (BI-1 — document-processing axis)', () => {
    it('reads processing_status directly off the flat form_instances response', () => {
      expect(deriveProcessingStatus(FLAT_ITEM)).toBe('analysed');
    });
    it('returns null when processing_status is absent', () => {
      expect(deriveProcessingStatus({ id: 'x', name: 'y' })).toBeNull();
    });
    it('returns null for nullish input', () => {
      expect(deriveProcessingStatus(null)).toBeNull();
      expect(deriveProcessingStatus(undefined)).toBeNull();
    });
  });

  describe('deriveProcurementStatus (BI-1/BI-18 — workflow axis)', () => {
    it('reads workflow_state directly off the flat form_instances response', () => {
      expect(deriveProcurementStatus(FLAT_ITEM)).toBe('submitted');
    });
    it('defaults to draft when workflow_state is absent', () => {
      expect(deriveProcurementStatus({ id: 'x', name: 'y' })).toBe('draft');
    });
    it('returns null for nullish input', () => {
      expect(deriveProcurementStatus(null)).toBeNull();
    });
  });

  describe('two-axis independence (BI-1 — never collapsed into one "status")', () => {
    it('processing_status and workflow_state read as two distinct signals', () => {
      const item = {
        ...FLAT_ITEM,
        processing_status: 'filling',
        workflow_state: 'drafting',
      };
      expect(deriveProcessingStatus(item)).toBe('filling');
      expect(deriveProcurementStatus(item)).toBe('drafting');
      expect(deriveProcessingStatus(item)).not.toBe(
        deriveProcurementStatus(item),
      );
    });
  });

  describe('deriveProcurementMetadata (BI-1,5,13,16 — sourced from the flat form_instances response)', () => {
    it('derives engagement facts directly off the form (no forms[]/rollup indirection)', () => {
      const meta = deriveProcurementMetadata(FLAT_ITEM);
      expect(meta).not.toBeNull();
      expect(meta?.buyer).toBe('Acme Council');
      expect(meta?.status).toBe('submitted');
      expect(meta?.deadline).toBe('2026-07-01T00:00:00.000Z');
      expect(meta?.submission_date).toBe('2026-06-20T00:00:00.000Z');
      expect(meta?.tender_document_ids).toEqual(['form-1/doc.pdf']);
    });

    it('never reads domain_metadata, even when present on the raw payload', () => {
      const meta = deriveProcurementMetadata({
        ...FLAT_ITEM,
        buyer: 'wrong',
        // A stray legacy domain_metadata blob must have zero influence.
        domain_metadata: {
          buyer: 'Legacy Co',
          status: 'won',
          deadline: '2020-01-01T00:00:00.000Z',
        },
      });
      expect(meta?.buyer).toBe('Acme Council');
      expect(meta?.status).toBe('submitted');
      expect(meta?.deadline).toBe('2026-07-01T00:00:00.000Z');
    });

    it('only surfaces won/lost/withdrawn as outcome (stage outcomes excluded)', () => {
      const shortlisted = deriveProcurementMetadata({
        ...FLAT_ITEM,
        outcome: 'shortlisted',
      });
      expect(shortlisted?.outcome).toBeNull();
      const won = deriveProcurementMetadata({ ...FLAT_ITEM, outcome: 'won' });
      expect(won?.outcome).toBe('won');
    });

    it('round-trips reference_number and estimated_value (BI-5), coercing a numeric estimated_value to a string', () => {
      const meta = deriveProcurementMetadata(FLAT_ITEM);
      expect(meta?.reference_number).toBe('REF-123');
      expect(meta?.estimated_value).toBe('50000');
    });

    it('drops the free-text notes field (BI-5 — no form_instances column, no live reader)', () => {
      const meta = deriveProcurementMetadata({
        ...FLAT_ITEM,
        notes: 'this must never surface',
      });
      expect(meta?.notes).toBeNull();
    });

    it('surfaces outcome_notes from the form column (distinct from the dropped notes field)', () => {
      const meta = deriveProcurementMetadata({
        ...FLAT_ITEM,
        outcome: 'won',
        outcome_notes: 'Strong technical score.',
      });
      expect(meta?.outcome_notes).toBe('Strong technical score.');
    });

    it('defaults reference_number/estimated_value to null when absent', () => {
      const meta = deriveProcurementMetadata({
        id: 'x',
        name: 'y',
        description: null,
      });
      expect(meta?.reference_number).toBeNull();
      expect(meta?.estimated_value).toBeNull();
      expect(meta?.notes).toBeNull();
    });

    it('returns null for nullish input', () => {
      expect(deriveProcurementMetadata(null)).toBeNull();
    });
  });
});
