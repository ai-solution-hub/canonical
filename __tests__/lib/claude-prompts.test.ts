import { describe, expect, it } from 'vitest';

import {
  generateBulkIngestPrompt,
  generateIngestDocumentPrompt,
  generateIngestUrlPrompt,
  generateSummariseAndIngestPrompt,
} from '@/lib/claude-prompts';

// ---------------------------------------------------------------------------
// Ingestion prompts
// ---------------------------------------------------------------------------

describe('ingestion prompts', () => {
  describe('generateIngestUrlPrompt', () => {
    it('includes the URL in the prompt', () => {
      const result = generateIngestUrlPrompt('https://example.com/article');
      expect(result.prompt).toContain('https://example.com/article');
    });

    it('describes adding to KB without exposing tool names', () => {
      const result = generateIngestUrlPrompt('https://example.com/article');
      expect(result.prompt).toContain('add it to our Knowledge Base');
      expect(result.prompt).not.toContain('create_content_item');
    });

    it('has category ingestion', () => {
      const result = generateIngestUrlPrompt('https://example.com/article');
      expect(result.category).toBe('ingestion');
    });
  });

  describe('generateIngestDocumentPrompt', () => {
    it('includes the filename when provided', () => {
      const result = generateIngestDocumentPrompt('policy-v2.docx');
      expect(result.prompt).toContain('policy-v2.docx');
    });

    it('uses generic text when no filename is provided', () => {
      const result = generateIngestDocumentPrompt();
      expect(result.prompt).toContain('your document');
    });

    it('includes batch_tag instruction', () => {
      const result = generateIngestDocumentPrompt();
      expect(result.prompt).toContain('batch_tag');
      expect(result.prompt).toMatch(/manual-ingest-\d{4}-\d{2}-\d{2}/);
    });
  });

  describe('generateSummariseAndIngestPrompt', () => {
    it('includes the title in the prompt', () => {
      const result = generateSummariseAndIngestPrompt('Data Protection Policy');
      expect(result.prompt).toContain('Data Protection Policy');
    });

    it('includes content snippet when provided', () => {
      const result = generateSummariseAndIngestPrompt(
        'Data Protection Policy',
        'This policy outlines our approach to handling personal data...',
      );
      expect(result.prompt).toContain('This policy outlines our approach');
    });

    it('works without a snippet', () => {
      const result = generateSummariseAndIngestPrompt('Data Protection Policy');
      expect(result.prompt).toContain('Data Protection Policy');
      expect(result.category).toBe('ingestion');
    });
  });

  describe('generateBulkIngestPrompt', () => {
    it('lists content types including q_a_pair', () => {
      const result = generateBulkIngestPrompt();
      expect(result.prompt).toContain('q_a_pair');
    });

    it('includes context when provided', () => {
      const result = generateBulkIngestPrompt('From the Q3 review meeting');
      expect(result.prompt).toContain('From the Q3 review meeting');
    });
  });
});
