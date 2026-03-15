/**
 * QARow Component Tests
 *
 * Tests the QARow component — question display, expand/collapse,
 * answer rendering, copy functionality, metadata badges, and freshness.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ContentListItem } from '@/types/content';

// ---------------------------------------------------------------------------
// vi.hoisted() — mocks referenced in vi.mock() factories
// ---------------------------------------------------------------------------

const { mockToast } = vi.hoisted(() => ({
  mockToast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('sonner', () => ({ toast: mockToast }));

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: Record<string, unknown>) => (
    <a href={href as string} {...props}>{children as React.ReactNode}</a>
  ),
}));

import { QARow } from '@/components/qa-row';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createQAItem(overrides: Partial<ContentListItem> = {}): ContentListItem {
  return {
    id: 'qa-1',
    title: 'How does your organisation handle data security?',
    suggested_title: null,
    ai_summary: null,
    primary_domain: 'Technical',
    primary_subtopic: 'Information Security',
    content_type: 'qa_pair',
    platform: 'web',
    author_name: null,
    source_domain: null,
    thumbnail_url: null,
    captured_date: '2026-01-15',
    ai_keywords: [],
    classification_confidence: null,
    priority: null,
    freshness: null,
    user_tags: [],
    governance_review_status: null,
    metadata: null,
    answer_standard: null,
    answer_advanced: null,
    content: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('QARow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders question title', () => {
    const item = createQAItem();
    render(<QARow item={item} />);
    expect(screen.getByText('How does your organisation handle data security?')).toBeInTheDocument();
  });

  it('shows domain and subtopic', () => {
    const item = createQAItem();
    render(<QARow item={item} />);
    expect(screen.getByText('Technical > Information Security')).toBeInTheDocument();
  });

  it('shows source file from metadata', () => {
    const item = createQAItem({
      metadata: { source_file: 'bid-answers-2026.docx' },
    });
    render(<QARow item={item} />);
    expect(screen.getByText('bid-answers-2026.docx')).toBeInTheDocument();
  });

  it('shows freshness badge', () => {
    const item = createQAItem({ freshness: 'fresh' });
    render(<QARow item={item} />);
    expect(screen.getByText('fresh')).toBeInTheDocument();
  });

  it('shows "Standard + Advanced" badge when both answers exist', () => {
    const item = createQAItem({
      answer_standard: 'Short answer',
      answer_advanced: 'Long detailed answer',
    });
    render(<QARow item={item} />);
    expect(screen.getByText('Standard + Advanced')).toBeInTheDocument();
  });

  it('expands on click to show answer content', async () => {
    const user = userEvent.setup();
    const item = createQAItem({
      answer_standard: 'We use AES-256 encryption.',
    });
    render(<QARow item={item} />);
    // Find the expand/collapse button via aria-expanded attribute
    const toggleBtn = screen.getByRole('button', { expanded: false });
    await user.click(toggleBtn);
    expect(screen.getByText('We use AES-256 encryption.')).toBeInTheDocument();
  });

  it('collapses on second click', async () => {
    const user = userEvent.setup();
    const item = createQAItem({
      answer_standard: 'We use AES-256 encryption.',
    });
    render(<QARow item={item} />);
    const toggleBtn = screen.getByRole('button', { expanded: false });
    await user.click(toggleBtn);
    expect(toggleBtn).toHaveAttribute('aria-expanded', 'true');
    await user.click(toggleBtn);
    expect(toggleBtn).toHaveAttribute('aria-expanded', 'false');
  });

  it('shows standard answer with copy button when expanded', async () => {
    const user = userEvent.setup();

    const item = createQAItem({
      answer_standard: 'We use AES-256 encryption.',
    });
    render(<QARow item={item} />);
    const toggleBtn = screen.getByRole('button', { expanded: false });
    await user.click(toggleBtn);

    expect(screen.getByText('Standard')).toBeInTheDocument();
    // Find copy buttons by text content
    const copyButtons = screen.getAllByRole('button', { name: /copy/i });
    expect(copyButtons.length).toBeGreaterThan(0);
  });

  it('shows advanced answer when expanded', async () => {
    const user = userEvent.setup();
    const item = createQAItem({
      answer_advanced: 'Detailed cryptographic implementation.',
    });
    render(<QARow item={item} />);
    const toggleBtn = screen.getByRole('button', { expanded: false });
    await user.click(toggleBtn);
    expect(screen.getByText('Detailed cryptographic implementation.')).toBeInTheDocument();
    expect(screen.getByText('Advanced')).toBeInTheDocument();
  });

  it('shows "No answer recorded yet." when no answers exist', async () => {
    const user = userEvent.setup();
    const item = createQAItem({
      answer_standard: null,
      answer_advanced: null,
      content: null,
    });
    render(<QARow item={item} />);
    const toggleBtn = screen.getByRole('button', { expanded: false });
    await user.click(toggleBtn);
    expect(screen.getByText('No answer recorded yet.')).toBeInTheDocument();
  });
});
