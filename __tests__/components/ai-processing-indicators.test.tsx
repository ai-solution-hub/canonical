/**
 * AiProcessingIndicators Component Tests
 *
 * Tests classification and summary prompts for content items missing
 * AI processing, including null rendering, pending messages, button
 * actions, API calls, and error handling.
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

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

import { AiProcessingIndicators } from '@/components/ai-processing-indicators';
import { toast } from 'sonner';

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function createItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 'item-1',
    title: 'Test Article',
    content: 'Some content',
    ai_summary: null as string | null,
    classified_at: null as string | null,
    primary_domain: null,
    primary_subtopic: null,
    secondary_domain: null,
    secondary_subtopic: null,
    ai_keywords: null,
    suggested_title: null,
    classification_confidence: null,
    classification_reasoning: null,
    summary_data: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AiProcessingIndicators', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns null when both classified and has summary', () => {
    const item = createItem({
      classified_at: '2026-01-01T00:00:00Z',
      ai_summary: 'A summary',
    });
    const { container } = render(
      <AiProcessingIndicators item={item as never} onItemUpdated={vi.fn()} />,
    );

    expect(container.innerHTML).toBe('');
  });

  it('shows "Classification pending" when not classified', () => {
    const item = createItem({ ai_summary: 'Has summary' });

    render(
      <AiProcessingIndicators item={item as never} onItemUpdated={vi.fn()} />,
    );

    expect(screen.getByText('Classification pending')).toBeInTheDocument();
  });

  it('shows "Summary not yet generated" when no summary', () => {
    const item = createItem({ classified_at: '2026-01-01T00:00:00Z' });

    render(
      <AiProcessingIndicators item={item as never} onItemUpdated={vi.fn()} />,
    );

    expect(screen.getByText('Summary not yet generated')).toBeInTheDocument();
  });

  it('classify button triggers API call', async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        primary_domain: 'Corporate',
        primary_subtopic: 'History',
        ai_keywords: ['test'],
      }),
    });

    const onItemUpdated = vi.fn();
    const item = createItem({ ai_summary: 'Has summary' });

    render(
      <AiProcessingIndicators item={item as never} onItemUpdated={onItemUpdated} />,
    );

    await user.click(screen.getByRole('button', { name: /classify now/i }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/items/item-1/classify',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  it('updates item on successful classification', async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        primary_domain: 'Technical',
        primary_subtopic: 'Infrastructure',
        ai_keywords: ['infra'],
        ai_summary: 'Tech summary',
      }),
    });

    const onItemUpdated = vi.fn();
    const item = createItem({ ai_summary: 'Has summary' });

    render(
      <AiProcessingIndicators item={item as never} onItemUpdated={onItemUpdated} />,
    );

    await user.click(screen.getByRole('button', { name: /classify now/i }));

    await waitFor(() => {
      expect(onItemUpdated).toHaveBeenCalled();
      expect(toast.success).toHaveBeenCalledWith('Classification complete');
    });
  });

  it('shows error toast on classification failure', async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ error: 'Rate limit exceeded' }),
    });

    const item = createItem({ ai_summary: 'Has summary' });

    render(
      <AiProcessingIndicators item={item as never} onItemUpdated={vi.fn()} />,
    );

    await user.click(screen.getByRole('button', { name: /classify now/i }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Rate limit exceeded');
    });
  });
});
