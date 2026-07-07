import { describe, it, expect } from 'vitest';
import {
  deriveProcurementMetadata,
  deriveProcurementStatus,
  getPrimaryForm,
  getProcurementForms,
  getProcurementRollup,
} from '@/lib/domains/procurement/procurement-detail-shape';

// ID-130 {130.13} — the umbrella detail GET ({130.11}) shape adapter. These
// helpers re-point consumers from the removed `bid.status`/`bid.domain_metadata`
// to the new `forms` + `rollup` read-shape, with a graceful legacy fallback.

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

const NEW_SHAPE = {
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

describe('procurement-detail-shape', () => {
  describe('getPrimaryForm', () => {
    it('returns the first (earliest-created) form', () => {
      expect(getPrimaryForm(NEW_SHAPE)?.id).toBe('form-a');
    });
    it('returns null for an umbrella with no forms', () => {
      expect(getPrimaryForm({ id: 'x', name: 'y', forms: [] })).toBeNull();
    });
    it('returns null for nullish input', () => {
      expect(getPrimaryForm(null)).toBeNull();
      expect(getPrimaryForm(undefined)).toBeNull();
    });
  });

  describe('deriveProcurementStatus', () => {
    it('derives the umbrella state from the primary form workflow_state (B-8)', () => {
      expect(deriveProcurementStatus(NEW_SHAPE)).toBe('submitted');
    });
    it('defaults to draft when an umbrella has no forms', () => {
      expect(deriveProcurementStatus({ id: 'x', name: 'y', forms: [] })).toBe(
        'draft',
      );
    });
    it('falls back to the legacy umbrella status when no forms key is present', () => {
      expect(
        deriveProcurementStatus({ id: 'x', name: 'y', status: 'drafting' }),
      ).toBe('drafting');
    });
    it('returns null for nullish input', () => {
      expect(deriveProcurementStatus(null)).toBeNull();
    });
  });

  describe('deriveProcurementMetadata', () => {
    it('derives engagement facts from the primary form + roll-up', () => {
      const meta = deriveProcurementMetadata(NEW_SHAPE);
      expect(meta).not.toBeNull();
      expect(meta?.buyer).toBe('Acme Council');
      expect(meta?.status).toBe('submitted');
      expect(meta?.deadline).toBe('2026-07-01T00:00:00.000Z');
      expect(meta?.submission_date).toBe('2026-06-20T00:00:00.000Z');
      expect(meta?.tender_document_ids).toEqual(['ws-1/doc.pdf']);
    });

    it('falls back to the roll-up nearest_deadline when the form has none', () => {
      const meta = deriveProcurementMetadata({
        ...NEW_SHAPE,
        forms: [{ ...FORM_A, deadline: null }],
      });
      expect(meta?.deadline).toBe('2026-07-01T00:00:00.000Z');
    });

    it('only surfaces won/lost/withdrawn as outcome (stage outcomes excluded)', () => {
      const shortlisted = deriveProcurementMetadata({
        ...NEW_SHAPE,
        forms: [{ ...FORM_A, outcome: 'shortlisted' }],
      });
      expect(shortlisted?.outcome).toBeNull();
      const won = deriveProcurementMetadata({
        ...NEW_SHAPE,
        forms: [{ ...FORM_A, outcome: 'won' }],
      });
      expect(won?.outcome).toBe('won');
    });

    it('surfaces the flattened residual fields (reference_number/estimated_value/notes, {130.21})', () => {
      const meta = deriveProcurementMetadata({
        ...NEW_SHAPE,
        reference_number: 'REF-123',
        estimated_value: '£50,000',
        notes: 'Follow up next week.',
      });
      expect(meta?.reference_number).toBe('REF-123');
      expect(meta?.estimated_value).toBe('£50,000');
      expect(meta?.notes).toBe('Follow up next week.');
    });

    it('defaults the residual fields to null when absent from the response', () => {
      const meta = deriveProcurementMetadata(NEW_SHAPE);
      expect(meta?.reference_number).toBeNull();
      expect(meta?.estimated_value).toBeNull();
      expect(meta?.notes).toBeNull();
    });

    it('returns the legacy domain_metadata verbatim when no forms present', () => {
      const legacy = deriveProcurementMetadata({
        id: 'x',
        name: 'y',
        domain_metadata: { buyer: 'Legacy Co', status: 'drafting' },
      });
      expect(legacy?.buyer).toBe('Legacy Co');
    });

    it('returns null for nullish input', () => {
      expect(deriveProcurementMetadata(null)).toBeNull();
    });
  });

  describe('getProcurementForms / getProcurementRollup', () => {
    it('returns the forms array and the roll-up', () => {
      expect(getProcurementForms(NEW_SHAPE)).toHaveLength(2);
      expect(getProcurementRollup(NEW_SHAPE)?.overall_outcome).toBe('won');
    });
    it('returns empty array / null for nullish input', () => {
      expect(getProcurementForms(null)).toEqual([]);
      expect(getProcurementRollup(null)).toBeNull();
    });
  });
});
