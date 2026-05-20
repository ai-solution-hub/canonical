/**
 * KBIntegrationReview Component Tests
 *
 * Tests the knowledge base integration review dialog — candidate rendering,
 * action selectors, Integrate All/Skip All bulk actions, submission,
 * error handling, empty state, and counter display.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// vi.hoisted() — mocks referenced in vi.mock() factories
// ---------------------------------------------------------------------------

const { mockToast, mockStripMarkdown } = vi.hoisted(() => ({
  mockToast: {
    success: vi.fn(),
    error: vi.fn(),
  },
  mockStripMarkdown: vi.fn((text: string) => text),
}));

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('sonner', () => ({
  toast: mockToast,
}));

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

vi.mock('@/lib/content/strip-markdown', () => ({
  stripMarkdown: (text: string) => mockStripMarkdown(text),
}));

// Import AFTER mocks
import { KBIntegrationReview } from '@/components/procurement/kb-integration-review';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface Candidate {
  question_id: string;
  question_text: string;
  response_text: string | null;
  source_content_ids: string[] | null;
  recommendation: 'new_entry' | 'update_existing' | 'skip';
}

function makeCandidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    question_id: 'q-1',
    question_text: 'What is your experience?',
    response_text: '<p>We have 10 years of experience.</p>',
    source_content_ids: null,
    recommendation: 'new_entry',
    ...overrides,
  };
}

const defaultProps = {
  open: true,
  onOpenChange: vi.fn(),
  procurementId: 'bid-789',
  procurementName: 'Council Services Procurement',
  candidates: [makeCandidate()],
  onIntegrationComplete: vi.fn(),
};

function renderReview(overrides: Partial<typeof defaultProps> = {}) {
  const props = { ...defaultProps, ...overrides };
  return render(<KBIntegrationReview {...props} />);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('KBIntegrationReview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
    // Mock stripMarkdown: strip both HTML tags (for legacy fixture data) and
    // common markdown syntax (`*`, `_`, `#`) for assertion stability.
    mockStripMarkdown.mockImplementation((text: string) =>
      text.replace(/<[^>]*>/g, '').replace(/[*_`#]/g, ''),
    );
  });

  // ---- Rendering ----

  it('renders the dialog when open is true', () => {
    renderReview();
    expect(screen.getByText('Knowledge Base Integration')).toBeInTheDocument();
  });

  it('does not render content when open is false', () => {
    renderReview({ open: false });
    expect(
      screen.queryByText('Knowledge Base Integration'),
    ).not.toBeInTheDocument();
  });

  it('shows the bid name in the description', () => {
    renderReview();
    expect(
      screen.getByText('Council Services Procurement'),
    ).toBeInTheDocument();
  });

  it('renders candidate question text', () => {
    renderReview();
    expect(screen.getByText('What is your experience?')).toBeInTheDocument();
  });

  it('shows response preview text', () => {
    renderReview();
    expect(
      screen.getByText('We have 10 years of experience.'),
    ).toBeInTheDocument();
  });

  it('shows responses available count', () => {
    renderReview({
      candidates: [
        makeCandidate({ question_id: 'q-1' }),
        makeCandidate({
          question_id: 'q-2',
          question_text: 'Another question',
        }),
      ],
    });
    expect(screen.getByText('2 responses available')).toBeInTheDocument();
  });

  it('shows singular "response" for single candidate', () => {
    renderReview({ candidates: [makeCandidate()] });
    expect(screen.getByText('1 response available')).toBeInTheDocument();
  });

  // ---- Integration counter ----

  it('shows integration counter in the footer', () => {
    renderReview({
      candidates: [
        makeCandidate({ question_id: 'q-1', recommendation: 'new_entry' }),
        makeCandidate({ question_id: 'q-2', recommendation: 'skip' }),
      ],
    });
    expect(screen.getByText('1 of 2 will be integrated')).toBeInTheDocument();
  });

  // ---- Bulk actions ----

  it('renders Integrate All and Skip All buttons', () => {
    renderReview();
    expect(
      screen.getByRole('button', { name: /Integrate All/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Skip All/ }),
    ).toBeInTheDocument();
  });

  // ---- "Has KB source" badge ----

  it('shows "Has KB source" badge when candidate has source_content_ids', () => {
    renderReview({
      candidates: [makeCandidate({ source_content_ids: ['ci-1'] })],
    });
    expect(screen.getByText('Has KB source')).toBeInTheDocument();
  });

  it('does not show "Has KB source" badge when no source_content_ids', () => {
    renderReview({
      candidates: [makeCandidate({ source_content_ids: null })],
    });
    expect(screen.queryByText('Has KB source')).not.toBeInTheDocument();
  });

  // ---- "No response" badge ----

  it('shows "No response" badge when candidate has no response_text', () => {
    renderReview({
      candidates: [makeCandidate({ response_text: null })],
    });
    expect(screen.getByText('No response')).toBeInTheDocument();
  });

  // ---- Empty candidates ----

  it('shows empty state when no candidates are provided', () => {
    renderReview({ candidates: [] });
    expect(
      screen.getByText(/No responses available for integration/),
    ).toBeInTheDocument();
  });

  it('disables submit button when candidates array is empty', () => {
    renderReview({ candidates: [] });
    expect(
      screen.getByRole('button', { name: 'Skip All Responses' }),
    ).toBeDisabled();
  });

  // ---- Submit button text ----

  it('shows "Integrate N Responses" when items are selected', () => {
    renderReview({
      candidates: [
        makeCandidate({ question_id: 'q-1', recommendation: 'new_entry' }),
        makeCandidate({ question_id: 'q-2', recommendation: 'new_entry' }),
      ],
    });
    expect(
      screen.getByRole('button', { name: 'Integrate 2 Responses' }),
    ).toBeInTheDocument();
  });

  it('shows "Integrate 1 Response" for singular', () => {
    renderReview({
      candidates: [makeCandidate({ recommendation: 'new_entry' })],
    });
    expect(
      screen.getByRole('button', { name: 'Integrate 1 Response' }),
    ).toBeInTheDocument();
  });

  it('shows "Skip All Responses" when all candidates are set to skip', () => {
    renderReview({
      candidates: [makeCandidate({ recommendation: 'skip' })],
    });
    expect(
      screen.getByRole('button', { name: 'Skip All Responses' }),
    ).toBeInTheDocument();
  });

  // ---- Candidate list accessibility ----

  it('renders candidate list with role="list"', () => {
    renderReview();
    expect(
      screen.getByRole('list', { name: 'Integration candidates' }),
    ).toBeInTheDocument();
  });

  it('renders candidates as listitems', () => {
    renderReview({
      candidates: [
        makeCandidate({ question_id: 'q-1' }),
        makeCandidate({ question_id: 'q-2', question_text: 'Second question' }),
      ],
    });
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  // ---- Recommendation defaults ----

  it('falls back to new_entry when update_existing is recommended but no source_content_ids', () => {
    // This is an internal behaviour — the select value should default to new_entry
    renderReview({
      candidates: [
        makeCandidate({
          recommendation: 'update_existing',
          source_content_ids: null,
        }),
      ],
    });
    // The submit button should say "Integrate" not "Skip"
    expect(
      screen.getByRole('button', { name: 'Integrate 1 Response' }),
    ).toBeInTheDocument();
  });

  // ---- Successful submission ----

  it('submits integration actions and calls onIntegrationComplete on success', async () => {
    const user = userEvent.setup();
    const onIntegrationComplete = vi.fn();
    const onOpenChange = vi.fn();

    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ created: 1, updated: 0, skipped: 0 }),
    });

    renderReview({
      onIntegrationComplete,
      onOpenChange,
      candidates: [
        makeCandidate({ question_id: 'q-1', recommendation: 'new_entry' }),
      ],
    });

    await user.click(
      screen.getByRole('button', { name: 'Integrate 1 Response' }),
    );

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/procurement/bid-789/outcome/integrate',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            integrations: [{ question_id: 'q-1', action: 'new_entry' }],
          }),
        }),
      );
    });

    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalledWith(
        'KB integration complete: 1 entry created',
      );
      expect(onIntegrationComplete).toHaveBeenCalledWith({
        created: 1,
        updated: 0,
        skipped: 0,
      });
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it('includes target_content_id for update_existing actions', async () => {
    const user = userEvent.setup();

    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ created: 0, updated: 1, skipped: 0 }),
    });

    renderReview({
      candidates: [
        makeCandidate({
          question_id: 'q-1',
          recommendation: 'update_existing',
          source_content_ids: ['ci-100'],
        }),
      ],
    });

    await user.click(
      screen.getByRole('button', { name: 'Integrate 1 Response' }),
    );

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/procurement/bid-789/outcome/integrate',
        expect.objectContaining({
          body: JSON.stringify({
            integrations: [
              {
                question_id: 'q-1',
                action: 'update_existing',
                target_content_id: 'ci-100',
              },
            ],
          }),
        }),
      );
    });
  });

  it('shows plural entries in success message', async () => {
    const user = userEvent.setup();

    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ created: 3, updated: 2, skipped: 1 }),
    });

    renderReview({
      candidates: [
        makeCandidate({ question_id: 'q-1' }),
        makeCandidate({ question_id: 'q-2' }),
        makeCandidate({ question_id: 'q-3' }),
      ],
    });

    await user.click(
      screen.getByRole('button', { name: 'Integrate 3 Responses' }),
    );

    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalledWith(
        'KB integration complete: 3 entries created, 2 entries updated, 1 skipped',
      );
    });
  });

  // ---- Error handling ----

  it('shows error toast when API returns an error', async () => {
    const user = userEvent.setup();

    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: 'Integration failed' }),
    });

    renderReview();

    await user.click(
      screen.getByRole('button', { name: 'Integrate 1 Response' }),
    );

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith('Integration failed');
    });
  });

  it('shows fallback error when API returns no JSON', async () => {
    const user = userEvent.setup();

    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.reject(new Error('no json')),
    });

    renderReview();

    await user.click(
      screen.getByRole('button', { name: 'Integrate 1 Response' }),
    );

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith('Integration failed (500)');
    });
  });

  it('shows error toast when fetch throws a network error', async () => {
    const user = userEvent.setup();

    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Network failure'),
    );

    renderReview();

    await user.click(
      screen.getByRole('button', { name: 'Integrate 1 Response' }),
    );

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith('Network failure');
    });
  });

  // ---- Cancel ----

  it('calls onOpenChange(false) when Cancel is clicked', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    renderReview({ onOpenChange });

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  // ---- Long response text truncation ----

  it('truncates long response text in preview', () => {
    const longText = 'A'.repeat(200);
    mockStripMarkdown.mockReturnValue(longText);

    renderReview({
      candidates: [makeCandidate({ response_text: longText })],
    });

    // The truncated text should end with "..."
    const preview = screen.getByText(/\.\.\.$/);
    expect(preview).toBeInTheDocument();
  });
});
