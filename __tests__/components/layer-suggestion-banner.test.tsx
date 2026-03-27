import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LayerSuggestionBanner } from '@/components/content/layer-suggestion-banner';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockLayers = [
  { id: '1', key: 'sales_brief', label: 'Sales Brief', description: null, display_order: 1, is_active: true },
  { id: '2', key: 'bid_detail', label: 'Bid Detail', description: null, display_order: 2, is_active: true },
  { id: '3', key: 'company_reference', label: 'Company Reference', description: null, display_order: 3, is_active: true },
  { id: '4', key: 'research', label: 'Research', description: null, display_order: 4, is_active: true },
];

const mockGetLayerLabel = vi.fn((key: string) => {
  const layer = mockLayers.find((l) => l.key === key);
  return layer?.label ?? key;
});

vi.mock('@/contexts/layer-vocabulary-context', () => ({
  useLayerVocabulary: () => ({
    layers: mockLayers,
    loading: false,
    error: null,
    getLayerKeys: () => mockLayers.map((l) => l.key),
    getLayerLabel: mockGetLayerLabel,
    getLayerDescription: () => null,
    refresh: vi.fn(),
  }),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Default props
// ---------------------------------------------------------------------------

const defaultProps = {
  itemId: 'test-uuid-123',
  suggestedLayer: {
    suggestedLayer: 'bid_detail',
    reason: 'Content discovered through a bid workspace',
    confidence: 'high',
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LayerSuggestionBanner', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Re-apply the mock since restoreAllMocks clears mockImplementation
    mockGetLayerLabel.mockImplementation((key: string) => {
      const layer = mockLayers.find((l) => l.key === key);
      return layer?.label ?? key;
    });
    global.fetch = vi.fn();
  });

  it('renders the suggested layer name and reason', () => {
    render(<LayerSuggestionBanner {...defaultProps} />);

    expect(screen.getByText('Bid Detail')).toBeInTheDocument();
    expect(
      screen.getByText('Content discovered through a bid workspace'),
    ).toBeInTheDocument();
  });

  it('renders the confidence badge', () => {
    render(<LayerSuggestionBanner {...defaultProps} />);

    expect(screen.getByText('High confidence')).toBeInTheDocument();
  });

  it('renders low confidence badge correctly', () => {
    render(
      <LayerSuggestionBanner
        {...defaultProps}
        suggestedLayer={{
          suggestedLayer: 'research',
          reason: 'Default suggestion',
          confidence: 'low',
        }}
      />,
    );

    expect(screen.getByText('Low confidence')).toBeInTheDocument();
  });

  it('Accept button calls PATCH API with the suggested layer', async () => {
    const user = userEvent.setup();
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ metadata: { layer: 'bid_detail' } }),
    });
    global.fetch = mockFetch;

    render(<LayerSuggestionBanner {...defaultProps} />);

    const acceptButton = screen.getByRole('button', { name: /accept suggested layer/i });
    await user.click(acceptButton);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/items/test-uuid-123/metadata',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ layer: 'bid_detail' }),
        }),
      );
    });
  });

  it('Change button shows a layer dropdown', async () => {
    const user = userEvent.setup();
    render(<LayerSuggestionBanner {...defaultProps} />);

    const changeButton = screen.getByRole('button', { name: /change suggested layer/i });
    await user.click(changeButton);

    // Should now be in change mode — look for the Apply button
    expect(screen.getByRole('button', { name: /apply layer/i })).toBeInTheDocument();
    // Cancel button should appear
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });

  it('Dismiss hides the banner via X button', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(<LayerSuggestionBanner {...defaultProps} onDismiss={onDismiss} />);

    // Use getAllBy and pick the first (X icon button)
    const dismissButtons = screen.getAllByRole('button', { name: /dismiss layer suggestion/i });
    await user.click(dismissButtons[0]);

    // The banner should be gone
    expect(screen.queryByText('Bid Detail')).not.toBeInTheDocument();
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('shows topic suggestion section when provided', () => {
    render(
      <LayerSuggestionBanner
        {...defaultProps}
        topicSuggestion={{
          topicId: 'compliance-kcsie',
          reason: 'Existing topic group has matching domain',
        }}
      />,
    );

    expect(screen.getByText('compliance-kcsie')).toBeInTheDocument();
    expect(
      screen.getByText(/existing topic group has matching domain/i),
    ).toBeInTheDocument();
  });

  it('does not show topic section when no suggestion provided', () => {
    render(<LayerSuggestionBanner {...defaultProps} />);

    expect(screen.queryByText('Topic group:')).not.toBeInTheDocument();
  });

  describe('accessibility', () => {
    it('has a region role with appropriate label', () => {
      render(<LayerSuggestionBanner {...defaultProps} />);

      expect(
        screen.getByRole('region', { name: 'Layer suggestion' }),
      ).toBeInTheDocument();
    });

    it('Accept button has an accessible label', () => {
      render(<LayerSuggestionBanner {...defaultProps} />);

      expect(
        screen.getByRole('button', { name: /accept suggested layer: bid detail/i }),
      ).toBeInTheDocument();
    });

    it('Dismiss button (X) has an accessible label', () => {
      render(<LayerSuggestionBanner {...defaultProps} />);

      // There are two dismiss buttons: the X icon and the text button
      const dismissButtons = screen.getAllByRole('button', {
        name: /dismiss layer suggestion/i,
      });
      expect(dismissButtons.length).toBeGreaterThanOrEqual(1);
    });

    it('Change button has an accessible label', () => {
      render(<LayerSuggestionBanner {...defaultProps} />);

      expect(
        screen.getByRole('button', { name: /change suggested layer/i }),
      ).toBeInTheDocument();
    });
  });

  it('hides banner after successful accept', async () => {
    const user = userEvent.setup();
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ metadata: { layer: 'bid_detail' } }),
    });

    render(<LayerSuggestionBanner {...defaultProps} />);

    const acceptButton = screen.getByRole('button', { name: /accept suggested layer/i });
    await user.click(acceptButton);

    await waitFor(() => {
      expect(screen.queryByText('Suggested layer:')).not.toBeInTheDocument();
    });
  });

  it('shows error toast when PATCH fails', async () => {
    const user = userEvent.setup();
    const { toast } = await import('sonner');
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ error: 'Item not found' }),
    });

    render(<LayerSuggestionBanner {...defaultProps} />);

    const acceptButton = screen.getByRole('button', { name: /accept suggested layer/i });
    await user.click(acceptButton);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Item not found');
    });
  });
});
