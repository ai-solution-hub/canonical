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

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
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
    source_file: null,
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

  it('shows source file from direct column', () => {
    const item = createQAItem({
      source_file: 'bid-answers-2026.docx',
      metadata: { source_file: 'bid-answers-2026.docx' },
    });
    render(<QARow item={item} />);
    expect(screen.getByText('bid-answers-2026.docx')).toBeInTheDocument();
  });

  it('shows freshness badge with icon via FreshnessBadge', () => {
    const item = createQAItem({ freshness: 'fresh' });
    render(<QARow item={item} />);
    // FreshnessBadge renders capitalised label with aria-label
    expect(screen.getByText('Fresh')).toBeInTheDocument();
    expect(screen.getByLabelText('Freshness: Fresh')).toBeInTheDocument();
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

  // -------------------------------------------------------------------------
  // Collapsed copy button (Item 1)
  // -------------------------------------------------------------------------

  it('shows copy button on collapsed row when answer exists', () => {
    const item = createQAItem({
      answer_standard: 'We follow ISO 27001.',
    });
    render(<QARow item={item} />);
    expect(
      screen.getByRole('button', {
        name: `Copy answer for "${item.title}"`,
      }),
    ).toBeInTheDocument();
  });

  it('does not show collapsed copy button when no answer or content', () => {
    const item = createQAItem({
      answer_standard: null,
      answer_advanced: null,
      content: null,
    });
    render(<QARow item={item} />);
    expect(
      screen.queryByRole('button', {
        name: `Copy answer for "${item.title}"`,
      }),
    ).not.toBeInTheDocument();
  });

  it('copies standard answer from collapsed copy button', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });

    const item = createQAItem({
      answer_standard: 'We follow ISO 27001.',
      answer_advanced: 'Detailed compliance info.',
    });
    render(<QARow item={item} />);

    const copyBtn = screen.getByRole('button', {
      name: `Copy answer for "${item.title}"`,
    });
    await user.click(copyBtn);

    expect(writeText).toHaveBeenCalledWith('We follow ISO 27001.');
    expect(mockToast.success).toHaveBeenCalledWith('Answer copied');
  });

  it('copies advanced answer when no standard answer exists', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });

    const item = createQAItem({
      answer_standard: null,
      answer_advanced: 'Detailed only.',
    });
    render(<QARow item={item} />);

    const copyBtn = screen.getByRole('button', {
      name: `Copy answer for "${item.title}"`,
    });
    await user.click(copyBtn);

    expect(writeText).toHaveBeenCalledWith('Detailed only.');
  });

  it('copies content as fallback when no standard or advanced answer', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });

    const item = createQAItem({
      answer_standard: null,
      answer_advanced: null,
      content: 'Fallback content.',
    });
    render(<QARow item={item} />);

    const copyBtn = screen.getByRole('button', {
      name: `Copy answer for "${item.title}"`,
    });
    await user.click(copyBtn);

    expect(writeText).toHaveBeenCalledWith('Fallback content.');
  });

  it('hides collapsed copy button when row is expanded', async () => {
    const user = userEvent.setup();
    const item = createQAItem({
      answer_standard: 'Some answer.',
    });
    render(<QARow item={item} />);

    // Button is visible when collapsed
    expect(
      screen.getByRole('button', {
        name: `Copy answer for "${item.title}"`,
      }),
    ).toBeInTheDocument();

    // Expand the row
    const toggleBtn = screen.getByRole('button', { expanded: false });
    await user.click(toggleBtn);

    // Collapsed copy button should be hidden
    expect(
      screen.queryByRole('button', {
        name: `Copy answer for "${item.title}"`,
      }),
    ).not.toBeInTheDocument();
  });
});
