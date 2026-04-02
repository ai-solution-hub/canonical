import { describe, it, expect } from 'vitest';
import {
  generateChangeSummary,
  generateSingleFieldChangeSummary,
} from '@/lib/change-summary';

describe('generateSingleFieldChangeSummary', () => {
  it('summarises title change', () => {
    const result = generateSingleFieldChangeSummary(
      'suggested_title',
      'Old Title',
      'New Title',
    );
    expect(result).toBe("Title updated from 'Old Title' to 'New Title'");
  });

  it('summarises title being set from empty', () => {
    const result = generateSingleFieldChangeSummary(
      'suggested_title',
      '',
      'New Title',
    );
    expect(result).toBe("Title set to 'New Title'");
  });

  it('summarises title being cleared', () => {
    const result = generateSingleFieldChangeSummary(
      'suggested_title',
      'Old Title',
      null,
    );
    expect(result).toBe('Title cleared');
  });

  it('summarises content change with word count', () => {
    const result = generateSingleFieldChangeSummary(
      'content',
      'The quick brown fox jumps',
      'The slow brown fox leaps high',
    );
    // The diff should detect changed/added words
    expect(result).toMatch(/^Content updated \(\d+ words? changed\)$/);
  });

  it('summarises keyword additions', () => {
    const result = generateSingleFieldChangeSummary(
      'ai_keywords',
      ['react', 'javascript'],
      ['react', 'javascript', 'typescript'],
    );
    expect(result).toBe('Keywords updated: added [typescript]');
  });

  it('summarises keyword removals', () => {
    const result = generateSingleFieldChangeSummary(
      'ai_keywords',
      ['react', 'javascript', 'python'],
      ['react', 'javascript'],
    );
    expect(result).toBe('Keywords updated: removed [python]');
  });

  it('summarises keyword additions and removals', () => {
    const result = generateSingleFieldChangeSummary(
      'ai_keywords',
      ['react', 'python'],
      ['react', 'typescript'],
    );
    expect(result).toBe(
      'Keywords updated: added [typescript], removed [python]',
    );
  });

  it('summarises user tag changes', () => {
    const result = generateSingleFieldChangeSummary(
      'user_tags',
      ['important'],
      ['important', 'reviewed'],
    );
    expect(result).toBe('User tags updated: added [reviewed]');
  });

  it('summarises domain reclassification', () => {
    const result = generateSingleFieldChangeSummary(
      'primary_domain',
      'Technology & Systems',
      'Standards & Compliance',
    );
    expect(result).toBe(
      'Reclassified domain from Technology & Systems to Standards & Compliance',
    );
  });

  it('summarises subtopic reclassification', () => {
    const result = generateSingleFieldChangeSummary(
      'primary_subtopic',
      'cloud_infrastructure',
      'data_management',
    );
    expect(result).toBe(
      'Reclassified subtopic from cloud_infrastructure to data_management',
    );
  });

  it('summarises priority change', () => {
    const result = generateSingleFieldChangeSummary(
      'priority',
      'medium',
      'high',
    );
    expect(result).toBe('Priority changed from medium to high');
  });

  it('summarises priority being set from null', () => {
    const result = generateSingleFieldChangeSummary('priority', null, 'high');
    expect(result).toBe('Priority changed from unset to high');
  });

  it('summarises priority being cleared', () => {
    const result = generateSingleFieldChangeSummary('priority', 'low', null);
    expect(result).toBe('Priority changed from low to unset');
  });

  it('summarises AI summary update', () => {
    const result = generateSingleFieldChangeSummary(
      'ai_summary',
      'Old summary',
      'New summary',
    );
    expect(result).toBe('AI summary updated');
  });

  it('summarises content type change', () => {
    const result = generateSingleFieldChangeSummary(
      'content_type',
      'article',
      'blog',
    );
    expect(result).toBe('Content type changed from article to blog');
  });

  it('summarises platform change', () => {
    const result = generateSingleFieldChangeSummary(
      'platform',
      'web',
      'manual',
    );
    expect(result).toBe('Platform changed from web to manual');
  });

  it('summarises author name change', () => {
    const result = generateSingleFieldChangeSummary(
      'author_name',
      'John Doe',
      'Jane Smith',
    );
    expect(result).toBe("Author changed from 'John Doe' to 'Jane Smith'");
  });

  it('handles unknown fields gracefully', () => {
    const result = generateSingleFieldChangeSummary(
      'some_other_field',
      'old',
      'new',
    );
    expect(result).toBe('some_other_field updated');
  });
});

describe('generateChangeSummary', () => {
  it('returns "No changes detected" for empty changes', () => {
    expect(generateChangeSummary([])).toBe('No changes detected');
  });

  it('generates comma-separated summary for multiple fields', () => {
    const result = generateChangeSummary([
      { field: 'suggested_title', oldValue: 'Old', newValue: 'New' },
      { field: 'priority', oldValue: 'low', newValue: 'high' },
    ]);
    expect(result).toBe(
      "Title updated from 'Old' to 'New', Priority changed from low to high",
    );
  });

  it('handles a single change', () => {
    const result = generateChangeSummary([
      { field: 'primary_domain', oldValue: 'Domain A', newValue: 'Domain B' },
    ]);
    expect(result).toBe('Reclassified domain from Domain A to Domain B');
  });
});
