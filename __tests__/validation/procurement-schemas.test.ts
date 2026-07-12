import { describe, it, expect } from 'vitest';
import {
  ProcurementCreateBodySchema,
  ProcurementUpdateBodySchema,
  QuestionExtractBodySchema,
  QuestionCreateBodySchema,
  QuestionUpdateBodySchema,
  QuestionMatchBodySchema,
} from '@/lib/validation/schemas';

describe('bid validation schemas', () => {
  describe('ProcurementCreateBodySchema', () => {
    it('accepts valid full input', () => {
      const result = ProcurementCreateBodySchema.safeParse({
        name: 'NHS Trust ITT 2026',
        buyer: 'NHS Digital',
        description: 'Security questionnaire',
        deadline: '2026-05-01T17:00:00Z',
        reference_number: 'ITT-2026-042',
        estimated_value: '£50,000',
        notes: 'Referred by existing client',
      });
      expect(result.success).toBe(true);
    });

    it('accepts minimal required fields', () => {
      const result = ProcurementCreateBodySchema.safeParse({
        name: 'Test Procurement',
        buyer: 'Test Buyer',
      });
      expect(result.success).toBe(true);
    });

    it('rejects missing name', () => {
      const result = ProcurementCreateBodySchema.safeParse({
        buyer: 'Test Buyer',
      });
      expect(result.success).toBe(false);
    });

    it('rejects missing buyer', () => {
      const result = ProcurementCreateBodySchema.safeParse({
        name: 'Test Procurement',
      });
      expect(result.success).toBe(false);
    });

    it('rejects empty name', () => {
      const result = ProcurementCreateBodySchema.safeParse({
        name: '   ',
        buyer: 'Test',
      });
      expect(result.success).toBe(false);
    });

    it('rejects empty buyer', () => {
      const result = ProcurementCreateBodySchema.safeParse({
        name: 'Test',
        buyer: '  ',
      });
      expect(result.success).toBe(false);
    });

    it('rejects name exceeding 200 characters', () => {
      const result = ProcurementCreateBodySchema.safeParse({
        name: 'A'.repeat(201),
        buyer: 'Test',
      });
      expect(result.success).toBe(false);
    });

    it('rejects invalid deadline format', () => {
      const result = ProcurementCreateBodySchema.safeParse({
        name: 'Test',
        buyer: 'Test',
        deadline: 'not-a-date',
      });
      expect(result.success).toBe(false);
    });

    it('accepts deadline with timezone offset', () => {
      const result = ProcurementCreateBodySchema.safeParse({
        name: 'Test',
        buyer: 'Test',
        deadline: '2026-05-01T17:00:00+01:00',
      });
      expect(result.success).toBe(true);
    });

    it('trims name whitespace', () => {
      const result = ProcurementCreateBodySchema.safeParse({
        name: '  Test Procurement  ',
        buyer: '  Test Buyer  ',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe('Test Procurement');
        expect(result.data.buyer).toBe('Test Buyer');
      }
    });
  });

  describe('ProcurementUpdateBodySchema', () => {
    it('accepts partial update with name only', () => {
      const result = ProcurementUpdateBodySchema.safeParse({
        name: 'Updated Name',
      });
      expect(result.success).toBe(true);
    });

    it('accepts status transition', () => {
      const result = ProcurementUpdateBodySchema.safeParse({
        status: 'drafting',
      });
      expect(result.success).toBe(true);
    });

    it('rejects invalid status', () => {
      const result = ProcurementUpdateBodySchema.safeParse({
        status: 'invalid_status',
      });
      expect(result.success).toBe(false);
    });

    it('accepts all valid status values', () => {
      const validStatuses = [
        'draft',
        'questions_extracted',
        'matching',
        'drafting',
        'in_review',
        'ready_for_export',
        'submitted',
        'won',
        'lost',
        'withdrawn',
      ];
      for (const status of validStatuses) {
        const result = ProcurementUpdateBodySchema.safeParse({ status });
        expect(result.success).toBe(true);
      }
    });

    it('accepts nullable fields set to null', () => {
      const result = ProcurementUpdateBodySchema.safeParse({
        deadline: null,
        reference_number: null,
        estimated_value: null,
        notes: null,
      });
      expect(result.success).toBe(true);
    });

    it('accepts outcome fields', () => {
      const result = ProcurementUpdateBodySchema.safeParse({
        outcome: 'won',
        outcome_notes: 'Great proposal',
      });
      expect(result.success).toBe(true);
    });

    it('rejects invalid outcome', () => {
      const result = ProcurementUpdateBodySchema.safeParse({ outcome: 'tied' });
      expect(result.success).toBe(false);
    });

    it('accepts empty object (no changes)', () => {
      const result = ProcurementUpdateBodySchema.safeParse({});
      expect(result.success).toBe(true);
    });
  });

  describe('QuestionExtractBodySchema', () => {
    it('accepts valid DOCX extraction', () => {
      const result = QuestionExtractBodySchema.safeParse({
        document_path: 'uuid/document.docx',
        format: 'docx',
      });
      expect(result.success).toBe(true);
    });

    it('accepts valid PDF extraction', () => {
      const result = QuestionExtractBodySchema.safeParse({
        document_path: 'uuid/document.pdf',
        format: 'pdf',
      });
      expect(result.success).toBe(true);
    });

    // ID-145 {145.12}: XLSX added — Plane-1 extraction covers all three mime
    // lanes (mime_type CHECK 3-valued: docx/xlsx/pdf).
    it('accepts valid XLSX extraction', () => {
      const result = QuestionExtractBodySchema.safeParse({
        document_path: 'uuid/document.xlsx',
        format: 'xlsx',
      });
      expect(result.success).toBe(true);
    });

    it('rejects missing document_path', () => {
      const result = QuestionExtractBodySchema.safeParse({
        format: 'docx',
      });
      expect(result.success).toBe(false);
    });

    it('rejects empty document_path', () => {
      const result = QuestionExtractBodySchema.safeParse({
        document_path: '',
        format: 'docx',
      });
      expect(result.success).toBe(false);
    });

    it('rejects invalid format', () => {
      const result = QuestionExtractBodySchema.safeParse({
        document_path: 'uuid/doc.txt',
        format: 'txt',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('QuestionCreateBodySchema', () => {
    it('accepts valid question with all fields', () => {
      const result = QuestionCreateBodySchema.safeParse({
        section_name: 'Security',
        question_text: 'Describe your data encryption approach.',
        word_limit: 500,
        evaluation_weight: 10,
      });
      expect(result.success).toBe(true);
    });

    it('accepts minimal question', () => {
      const result = QuestionCreateBodySchema.safeParse({
        question_text: 'What is your approach?',
      });
      expect(result.success).toBe(true);
    });

    it('rejects missing question_text', () => {
      const result = QuestionCreateBodySchema.safeParse({
        section_name: 'Test',
      });
      expect(result.success).toBe(false);
    });

    it('rejects empty question_text', () => {
      const result = QuestionCreateBodySchema.safeParse({
        question_text: '   ',
      });
      expect(result.success).toBe(false);
    });

    it('rejects word_limit below 1', () => {
      const result = QuestionCreateBodySchema.safeParse({
        question_text: 'Test',
        word_limit: 0,
      });
      expect(result.success).toBe(false);
    });

    it('rejects evaluation_weight above 100', () => {
      const result = QuestionCreateBodySchema.safeParse({
        question_text: 'Test',
        evaluation_weight: 101,
      });
      expect(result.success).toBe(false);
    });

    it('accepts evaluation_weight at boundaries', () => {
      expect(
        QuestionCreateBodySchema.safeParse({
          question_text: 'T',
          evaluation_weight: 0,
        }).success,
      ).toBe(true);
      expect(
        QuestionCreateBodySchema.safeParse({
          question_text: 'T',
          evaluation_weight: 100,
        }).success,
      ).toBe(true);
    });
  });

  describe('QuestionUpdateBodySchema', () => {
    it('accepts partial update', () => {
      const result = QuestionUpdateBodySchema.safeParse({
        question_text: 'Updated question text',
      });
      expect(result.success).toBe(true);
    });

    it('accepts sequence reordering', () => {
      const result = QuestionUpdateBodySchema.safeParse({
        section_sequence: 2,
        question_sequence: 5,
      });
      expect(result.success).toBe(true);
    });

    it('accepts assigned_to UUID', () => {
      const result = QuestionUpdateBodySchema.safeParse({
        assigned_to: '550e8400-e29b-41d4-a716-446655440000',
      });
      expect(result.success).toBe(true);
    });

    it('accepts assigned_to null (unassign)', () => {
      const result = QuestionUpdateBodySchema.safeParse({
        assigned_to: null,
      });
      expect(result.success).toBe(true);
    });

    it('rejects invalid UUID for assigned_to', () => {
      const result = QuestionUpdateBodySchema.safeParse({
        assigned_to: 'not-a-uuid',
      });
      expect(result.success).toBe(false);
    });

    it('accepts nullable fields set to null', () => {
      const result = QuestionUpdateBodySchema.safeParse({
        section_name: null,
        word_limit: null,
        evaluation_weight: null,
      });
      expect(result.success).toBe(true);
    });
  });

  describe('QuestionMatchBodySchema', () => {
    it('accepts empty body (match all unmatched)', () => {
      const result = QuestionMatchBodySchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('accepts specific question IDs', () => {
      const result = QuestionMatchBodySchema.safeParse({
        question_ids: [
          '550e8400-e29b-41d4-a716-446655440000',
          '550e8400-e29b-41d4-a716-446655440001',
        ],
      });
      expect(result.success).toBe(true);
    });

    it('accepts force flag', () => {
      const result = QuestionMatchBodySchema.safeParse({ force: true });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.force).toBe(true);
      }
    });

    it('defaults force to false', () => {
      const result = QuestionMatchBodySchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.force).toBe(false);
      }
    });

    it('rejects invalid UUIDs in question_ids', () => {
      const result = QuestionMatchBodySchema.safeParse({
        question_ids: ['not-a-uuid'],
      });
      expect(result.success).toBe(false);
    });
  });
});
