import { describe, expect, it } from 'vitest';

import {
  generateBulkIngestPrompt,
  generateIngestDocumentPrompt,
  generateIngestUrlPrompt,
  generateSuggestedActions,
  generateSummariseAndIngestPrompt,
} from '@/lib/claude-prompts';
import type { DashboardData } from '@/lib/dashboard';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emptyDashboardData(): DashboardData {
  return {
    needs_attention: {
      governance_review_count: 0,
      unverified_count: 0,
      quality_flag_count: 0,
      stale_content_count: 0,
      expired_content_count: 0,
    },
    active_bids: [],
    freshness_summary: { fresh: 0, aging: 0, stale: 0, expired: 0 },
    unread_notification_count: 0,
    recent_activity: [],
    user_role: 'admin',
    errors: [],
  };
}

// ---------------------------------------------------------------------------
// Ingestion prompts
// ---------------------------------------------------------------------------

describe('ingestion prompts', () => {
  describe('generateIngestUrlPrompt', () => {
    it('includes the URL in the prompt', () => {
      const result = generateIngestUrlPrompt('https://example.com/article');
      expect(result.prompt).toContain('https://example.com/article');
    });

    it('mentions create_content_item', () => {
      const result = generateIngestUrlPrompt('https://example.com/article');
      expect(result.prompt).toContain('create_content_item');
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

  describe('generateSuggestedActions includes bulk ingest', () => {
    it('includes bulk ingest when few other actions are present', () => {
      const data = emptyDashboardData();
      const actions = generateSuggestedActions(data);

      const ingestAction = actions.find((a) => a.category === 'ingestion');
      expect(ingestAction).toBeDefined();
      expect(ingestAction!.label).toBe('Add content to KB');
    });
  });
});
