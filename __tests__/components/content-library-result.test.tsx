/**
 * ContentLibraryResult Component Tests
 *
 * Tests generic and Q&A result rendering, badges, similarity score,
 * copy/insert/view actions, and source document display.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('@/components/shared/domain-badge', () => ({
  DomainBadge: ({ domain }: { domain: string }) => (
    <span data-testid="domain-badge">{domain}</span>
  ),
}));

vi.mock('@/components/shared/similarity-badge', () => ({
  SimilarityBadge: ({ score }: { score: number }) => (
    <span data-testid="similarity-badge">{Math.round(score * 100)}%</span>
  ),
}));

vi.mock('@/lib/format', () => ({
  getDisplayTitle: (item: { suggested_title?: string | null; title?: string | null }) =>
    item.suggested_title || item.title || 'Untitled',
  formatContentType: (type: string) =>
    type.split(/[-_]/).map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
}));

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

import { ContentLibraryResult } from '@/components/content/content-library-result';
import { toast } from 'sonner';
import type { SearchResult } from '@/types/content';

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function createResult(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    id: 'item-1',
    title: 'Test Article',
    suggested_title: null,
    ai_summary: 'A summary of the article.',
    primary_domain: 'Corporate',
    primary_subtopic: 'Company History',
    content_type: 'article',
    platform: 'web',
    author_name: 'Author',
    source_domain: 'example.com',
    thumbnail_url: null,
    captured_date: '2026-01-01',
    ai_keywords: ['test'],
    classification_confidence: 0.9,
    priority: 'medium',
    freshness: 'fresh',
    governance_review_status: null,
    metadata: null,
    similarity: 0.85,
    snippet: 'A snippet',
    ...overrides,
  } as SearchResult;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ContentLibraryResult', () => {
  const mockOnCopy = vi.fn();
  const mockOnInsert = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('open', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders title for a generic result', () => {
    render(
      <ContentLibraryResult result={createResult()} onCopy={mockOnCopy} />,
    );

    expect(screen.getByText('Test Article')).toBeInTheDocument();
  });

  it('shows Q&A pair layout with question and answer sections', () => {
    render(
      <ContentLibraryResult
        result={createResult({
          content_type: 'q_a_pair',
          content: 'The answer text',
          metadata: { question: 'What is the policy?' },
        })}
        onCopy={mockOnCopy}
      />,
    );

    expect(screen.getByText('Question')).toBeInTheDocument();
    expect(screen.getByText('Answer')).toBeInTheDocument();
    expect(screen.getByText('What is the policy?')).toBeInTheDocument();
  });

  it('shows content type and domain badges', () => {
    render(
      <ContentLibraryResult
        result={createResult({ content_type: 'case_study', primary_domain: 'Technical' })}
        onCopy={mockOnCopy}
      />,
    );

    expect(screen.getByText('Case Study')).toBeInTheDocument();
    expect(screen.getByTestId('domain-badge')).toHaveTextContent('Technical');
  });

  it('shows similarity score', () => {
    render(
      <ContentLibraryResult
        result={createResult({ similarity: 0.93 })}
        onCopy={mockOnCopy}
      />,
    );

    expect(screen.getByTestId('similarity-badge')).toHaveTextContent('93%');
  });

  it('copy button copies text to clipboard', async () => {
    const user = userEvent.setup();
    const mockClipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
    vi.stubGlobal('navigator', { clipboard: mockClipboard });

    render(
      <ContentLibraryResult result={createResult()} onCopy={mockOnCopy} />,
    );

    await user.click(screen.getByRole('button', { name: /copy/i }));

    await waitFor(() => {
      expect(mockClipboard.writeText).toHaveBeenCalled();
      expect(toast.success).toHaveBeenCalledWith('Copied to clipboard');
    });
  });

  it('insert button calls onInsert with answer text for Q&A pairs', async () => {
    const user = userEvent.setup();

    render(
      <ContentLibraryResult
        result={createResult({
          content_type: 'q_a_pair',
          content: 'The answer',
          metadata: { question: 'Q?' },
        })}
        onCopy={mockOnCopy}
        onInsert={mockOnInsert}
      />,
    );

    await user.click(screen.getByRole('button', { name: /insert answer/i }));

    expect(mockOnInsert).toHaveBeenCalledWith('The answer', 'item-1', 'Test Article');
  });

  it('view button opens item page', async () => {
    const user = userEvent.setup();
    const mockOpen = vi.fn();
    vi.stubGlobal('open', mockOpen);

    render(
      <ContentLibraryResult result={createResult()} onCopy={mockOnCopy} />,
    );

    await user.click(screen.getByRole('button', { name: /view/i }));

    expect(mockOpen).toHaveBeenCalledWith('/item/item-1', '_blank');
  });

  it('shows source document for Q&A pairs', () => {
    render(
      <ContentLibraryResult
        result={createResult({
          content_type: 'q_a_pair',
          content: 'Answer text',
          source_file: 'tender-2026.docx',
          metadata: { question: 'Q?', source_file: 'tender-2026.docx' },
        })}
        onCopy={mockOnCopy}
      />,
    );

    expect(screen.getByText('tender-2026.docx')).toBeInTheDocument();
  });
});
