import { describe, it, expect } from 'vitest';
import {
  deriveProcessingStatus,
  deriveProcurementMetadata,
  deriveProcurementStatus,
  deriveEngagementGroupId,
  deriveFormSourceAttachments,
  deriveReferenceEvidenceAttachments,
  deriveEngagementSiblings,
} from '@/lib/domains/procurement/procurement-detail-shape';

// ID-145 {145.18} — REBUILD for the form-first re-architecture (BI-1..5,
// 13..19). Post-W1, `form_instances` IS the procurement item: every
// lifecycle fact is read directly off the flat GET response, and the
// processing/workflow axes are two independent signals that never collapse.
//
// ID-145 {145.42} orphan sweep: the pre-{145.18} LEGACY nested-shape getters
// (`getPrimaryForm`/`getProcurementForms`/`getProcurementRollup`) and their
// fixtures are RETIRED here — their only consumer, `procurement-forms-card.tsx`,
// was deleted in {145.41}.

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

  describe('deriveEngagementGroupId (§A3 rail gate)', () => {
    it('reads engagement_group_id directly off the flat response', () => {
      expect(
        deriveEngagementGroupId({ ...FLAT_ITEM, engagement_group_id: 'eg-1' }),
      ).toBe('eg-1');
    });
    it('returns null when unset', () => {
      expect(deriveEngagementGroupId(FLAT_ITEM)).toBeNull();
    });
    it('returns null for nullish input', () => {
      expect(deriveEngagementGroupId(null)).toBeNull();
    });
  });

  describe('deriveFormSourceAttachments / deriveReferenceEvidenceAttachments (§A5 role split)', () => {
    const FORM_SOURCE = {
      id: 'att-1',
      filename: 'signed.pdf',
      storage_path: 'form-1/attachments/att-1-signed.pdf',
      mime_type: 'application/pdf',
      file_size: 100,
      role: 'form_source' as const,
      form_instance_id: 'form-1',
      engagement_group_id: null,
      created_at: '2026-06-01T00:00:00.000Z',
    };
    const REFERENCE_EVIDENCE = {
      ...FORM_SOURCE,
      id: 'att-2',
      filename: 'cv.pdf',
      role: 'reference_evidence' as const,
    };

    it('returns the two role groups from the folded attachments response', () => {
      const item = {
        ...FLAT_ITEM,
        attachments: {
          form_source: [FORM_SOURCE],
          reference_evidence: [REFERENCE_EVIDENCE],
        },
      };
      expect(deriveFormSourceAttachments(item)).toEqual([FORM_SOURCE]);
      expect(deriveReferenceEvidenceAttachments(item)).toEqual([
        REFERENCE_EVIDENCE,
      ]);
    });

    it('returns empty arrays when attachments is absent (§A8 collapse input)', () => {
      expect(deriveFormSourceAttachments(FLAT_ITEM)).toEqual([]);
      expect(deriveReferenceEvidenceAttachments(FLAT_ITEM)).toEqual([]);
    });
  });

  describe('deriveEngagementSiblings (§A3/§A4 read-only lineage)', () => {
    it('returns the sibling list from the folded response', () => {
      const siblings = [
        {
          id: 'form-2',
          name: 'ITT',
          form_type: 'itt',
          workflow_state: 'drafting',
          reference_number: null,
        },
      ];
      expect(
        deriveEngagementSiblings({
          ...FLAT_ITEM,
          engagement_siblings: siblings,
        }),
      ).toEqual(siblings);
    });
    it('returns an empty array when ungrouped', () => {
      expect(deriveEngagementSiblings(FLAT_ITEM)).toEqual([]);
    });
  });
});
