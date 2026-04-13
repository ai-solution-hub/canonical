/**
 * CollapsibleGroup Component Tests
 *
 * Tests the CollapsibleGroup component and the groupItems utility function.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ContentListItem } from '@/types/content';

import {
  CollapsibleGroup,
  groupItems,
} from '@/components/shell/collapsible-group';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createQAItem(
  overrides: Partial<ContentListItem> = {},
): ContentListItem {
  return {
    id: overrides.id ?? 'item-1',
    title: overrides.title ?? 'Test Q&A',
    suggested_title: null,
    summary: null,
    primary_domain: overrides.primary_domain ?? 'Corporate',
    primary_subtopic: null,
    content_type: 'qa_pair',
    platform: 'web',
    author_name: null,
    source_domain: null,
    thumbnail_url: null,
    captured_date: '2026-01-01',
    ai_keywords: [],
    classification_confidence: null,
    priority: null,
    freshness: null,
    user_tags: [],
    governance_review_status: null,
    metadata: overrides.metadata ?? null,
    source_file: overrides.source_file ?? null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CollapsibleGroup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders label and count badge', () => {
    render(
      <CollapsibleGroup label="Security Questions" count={5}>
        <div>Children</div>
      </CollapsibleGroup>,
    );
    expect(screen.getByText('Security Questions')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('starts expanded by default', () => {
    render(
      <CollapsibleGroup label="Group" count={3}>
        <div>Visible content</div>
      </CollapsibleGroup>,
    );
    expect(screen.getByText('Visible content')).toBeInTheDocument();
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'true');
  });

  it('collapses on button click', async () => {
    const user = userEvent.setup();
    render(
      <CollapsibleGroup label="Group" count={3}>
        <div>Visible content</div>
      </CollapsibleGroup>,
    );
    const toggleBtn = screen.getByRole('button');
    await user.click(toggleBtn);
    expect(toggleBtn).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Visible content')).not.toBeInTheDocument();
  });

  it('renders children when expanded', () => {
    render(
      <CollapsibleGroup label="Group" count={2}>
        <p>Child paragraph</p>
      </CollapsibleGroup>,
    );
    expect(screen.getByText('Child paragraph')).toBeInTheDocument();
  });
});

describe('groupItems', () => {
  it('groups by source (source_file column)', () => {
    const items = [
      createQAItem({
        id: '1',
        source_file: 'doc-a.docx',
        metadata: { source_file: 'doc-a.docx' },
      }),
      createQAItem({
        id: '2',
        source_file: 'doc-a.docx',
        metadata: { source_file: 'doc-a.docx' },
      }),
      createQAItem({
        id: '3',
        source_file: 'doc-b.docx',
        metadata: { source_file: 'doc-b.docx' },
      }),
    ];
    const groups = groupItems(items, 'source');
    expect(groups.get('doc-a.docx')).toHaveLength(2);
    expect(groups.get('doc-b.docx')).toHaveLength(1);
  });

  it('groups by domain (primary_domain)', () => {
    const items = [
      createQAItem({ id: '1', primary_domain: 'Technical' }),
      createQAItem({ id: '2', primary_domain: 'Corporate' }),
      createQAItem({ id: '3', primary_domain: 'Technical' }),
    ];
    const groups = groupItems(items, 'domain');
    expect(groups.get('Technical')).toHaveLength(2);
    expect(groups.get('Corporate')).toHaveLength(1);
  });

  it('handles missing source with "No source" key', () => {
    const items = [
      createQAItem({ id: '1', metadata: null }),
      createQAItem({ id: '2', metadata: {} }),
    ];
    const groups = groupItems(items, 'source');
    expect(groups.get('No source')).toHaveLength(2);
  });
});
