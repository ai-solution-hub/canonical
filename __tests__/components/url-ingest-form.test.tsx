/**
 * UrlIngestForm Component Tests
 *
 * Tests the URL ingestion form — input validation, submission flow,
 * progress display, success/error states, and accessibility.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// vi.hoisted() — mocks referenced in vi.mock() factories
// ---------------------------------------------------------------------------

const { mockFetch } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: Record<string, unknown>) => (
    <a href={href as string} {...props}>
      {children as React.ReactNode}
    </a>
  ),
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    onClick,
    disabled,
    asChild,
    variant,
    size,
    className,
    ...props
  }: Record<string, unknown>) => {
    if (asChild) return children as React.ReactNode;
    return (
      <button
        onClick={onClick as React.MouseEventHandler}
        disabled={disabled as boolean}
        className={className as string}
        data-variant={variant as string}
        data-size={size as string}
        {...props}
      >
        {children as React.ReactNode}
      </button>
    );
  },
}));

vi.mock('@/components/ui/input', () => ({
  Input: (props: Record<string, unknown>) => (
    <input
      {...props}
      onChange={props.onChange as React.ChangeEventHandler<HTMLInputElement>}
      onKeyDown={props.onKeyDown as React.KeyboardEventHandler<HTMLInputElement>}
    />
  ),
}));

vi.mock('@/components/ui/label', () => ({
  Label: ({ children, ...props }: Record<string, unknown>) => (
    <label {...props}>{children as React.ReactNode}</label>
  ),
}));

vi.mock('lucide-react', () => ({
  Globe: (props: Record<string, unknown>) => (
    <span data-testid="globe-icon" aria-hidden={props['aria-hidden'] as string} />
  ),
  Loader2: (props: Record<string, unknown>) => (
    <span data-testid="loader-icon" aria-hidden={props['aria-hidden'] as string} />
  ),
  AlertCircle: (props: Record<string, unknown>) => (
    <span data-testid="alert-icon" aria-hidden={props['aria-hidden'] as string} />
  ),
  Link2: (props: Record<string, unknown>) => (
    <span data-testid="link-icon" aria-hidden={props['aria-hidden'] as string} />
  ),
  Copy: (props: Record<string, unknown>) => (
    <span data-testid="copy-icon" aria-hidden={props['aria-hidden'] as string} />
  ),
  ExternalLink: (props: Record<string, unknown>) => (
    <span data-testid="external-link-icon" aria-hidden={props['aria-hidden'] as string} />
  ),
  AlertTriangle: (props: Record<string, unknown>) => (
    <span data-testid="alert-triangle-icon" aria-hidden={props['aria-hidden'] as string} />
  ),
  X: (props: Record<string, unknown>) => (
    <span data-testid="x-icon" aria-hidden={props['aria-hidden'] as string} />
  ),
  Check: (props: Record<string, unknown>) => (
    <span data-testid="check-icon" aria-hidden={props['aria-hidden'] as string} />
  ),
  Minus: (props: Record<string, unknown>) => (
    <span data-testid="minus-icon" aria-hidden={props['aria-hidden'] as string} />
  ),
  SkipForward: (props: Record<string, unknown>) => (
    <span data-testid="skip-icon" aria-hidden={props['aria-hidden'] as string} />
  ),
}));

vi.mock('@/components/content/claude-prompt-button', () => ({
  ClaudePromptButton: ({ prompt }: { prompt: { label: string } }) => (
    <button data-testid="claude-prompt-button">{prompt.label}</button>
  ),
}));

vi.mock('@/lib/claude-prompts', () => ({
  generateIngestDocumentPrompt: () => ({
    label: 'Use automatic extraction',
    prompt: 'test prompt',
    description: 'test',
    category: 'ingestion',
  }),
}));

vi.mock('@/components/create-content/ingestion-progress', () => ({
  IngestionProgress: ({ steps }: { steps: Array<{ label: string; status: string }> }) => (
    <div data-testid="ingestion-progress">
      {steps.map((s, i) => (
        <span key={i} data-status={s.status}>
          {s.label}
        </span>
      ))}
    </div>
  ),
}));

vi.mock('@/components/create-content/ingestion-success-card', () => ({
  IngestionSuccessCard: ({ itemId, title }: { itemId: string; title: string }) => (
    <div data-testid="success-card" data-item-id={itemId}>
      {title}
    </div>
  ),
}));

vi.mock('@/components/shared/dedup-warning', () => ({
  DedupWarning: ({
    matches,
    onDismiss,
  }: {
    matches: Array<{ id: string; title: string }>;
    onDismiss: () => void;
  }) => (
    <div data-testid="dedup-warning">
      {matches.map((m) => (
        <span key={m.id}>{m.title}</span>
      ))}
      <button onClick={onDismiss}>Dismiss</button>
    </div>
  ),
}));

// Import AFTER mocks
import { UrlIngestForm } from '@/components/create-content/url-ingest-form';

// ---------------------------------------------------------------------------
// Setup and teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  globalThis.fetch = mockFetch;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('UrlIngestForm', () => {
  it('renders URL input and Import button', () => {
    render(<UrlIngestForm />);
    expect(screen.getByLabelText(/web page url/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /import/i })).toBeInTheDocument();
  });

  it('Import button is disabled when input is empty', () => {
    render(<UrlIngestForm />);
    const button = screen.getByRole('button', { name: /import/i });
    expect(button).toBeDisabled();
  });

  it('shows validation error for invalid URL', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<UrlIngestForm />);

    const input = screen.getByLabelText(/web page url/i);
    await user.type(input, 'not-a-valid-url');

    expect(screen.getByText(/please enter a valid url/i)).toBeInTheDocument();
  });

  it('shows progress during processing', async () => {
    // Set up a fetch that never resolves (simulates processing)
    mockFetch.mockReturnValue(new Promise(() => {}));

    render(<UrlIngestForm />);

    const input = screen.getByLabelText(/web page url/i);

    await act(async () => {
      fireEvent.change(input, { target: { value: 'https://example.com/article' } });
    });

    const button = screen.getByRole('button', { name: /import/i });

    await act(async () => {
      fireEvent.click(button);
    });

    expect(screen.getByTestId('ingestion-progress')).toBeInTheDocument();
    expect(screen.getByText(/importing/i)).toBeInTheDocument();
  });

  it('shows success result on completion', async () => {
    const successResponse = {
      id: 'new-item-123',
      title: 'Test Article',
      source_url: 'https://example.com/article',
      content_type: 'article',
      primary_domain: 'General Business',
      content_length: 500,
      warnings: [],
      duplicate_matches: [],
    };

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => successResponse,
    });

    render(<UrlIngestForm />);

    const input = screen.getByLabelText(/web page url/i);

    await act(async () => {
      fireEvent.change(input, { target: { value: 'https://example.com/article' } });
    });

    const button = screen.getByRole('button', { name: /import/i });

    await act(async () => {
      fireEvent.click(button);
    });

    await waitFor(() => {
      expect(screen.getByTestId('success-card')).toBeInTheDocument();
    });

    expect(screen.getByText('Test Article')).toBeInTheDocument();
  });

  it('shows error state on failure', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Could not extract content' }),
    });

    render(<UrlIngestForm />);

    const input = screen.getByLabelText(/web page url/i);

    await act(async () => {
      fireEvent.change(input, { target: { value: 'https://example.com/article' } });
    });

    const button = screen.getByRole('button', { name: /import/i });

    await act(async () => {
      fireEvent.click(button);
    });

    await waitFor(() => {
      expect(screen.getByText('Could not extract content')).toBeInTheDocument();
    });
  });

  it('shows "Import another URL" after success', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'new-item-123',
        title: 'Test Article',
        content_type: 'article',
        warnings: [],
        duplicate_matches: [],
      }),
    });

    render(<UrlIngestForm />);

    const input = screen.getByLabelText(/web page url/i);

    await act(async () => {
      fireEvent.change(input, { target: { value: 'https://example.com/article' } });
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /import/i }));
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /import another url/i })).toBeInTheDocument();
    });
  });

  it('has accessible labels and aria attributes', () => {
    render(<UrlIngestForm />);

    const input = screen.getByLabelText(/web page url/i);
    expect(input).toHaveAttribute('type', 'url');
    expect(input).toHaveAttribute('id', 'ingest-url');
    expect(input).toHaveAttribute('autocomplete', 'url');
  });

  describe('onSuggestManual callback', () => {
    it('shows manual suggestion when content_length < 500 and onSuggestManual provided', async () => {
      const onSuggestManual = vi.fn();

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 'new-item-456',
          title: 'Brief Article',
          source_url: 'https://example.com/brief',
          content_type: 'article',
          content_length: 200,
          warnings: ['Limited text extracted'],
          duplicate_matches: [],
        }),
      });

      render(<UrlIngestForm onSuggestManual={onSuggestManual} />);

      const input = screen.getByLabelText(/web page url/i);

      await act(async () => {
        fireEvent.change(input, { target: { value: 'https://example.com/brief' } });
      });

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /import/i }));
      });

      await waitFor(() => {
        expect(screen.getByText(/Limited text extracted/)).toBeInTheDocument();
      });

      // The manual suggestion link should be present
      const manualButton = screen.getByRole('button', { name: /pasting the content manually/i });
      expect(manualButton).toBeInTheDocument();

      await act(async () => {
        fireEvent.click(manualButton);
      });

      expect(onSuggestManual).toHaveBeenCalledOnce();
    });

    it('does not show manual suggestion when content_length >= 500', async () => {
      const onSuggestManual = vi.fn();

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 'new-item-789',
          title: 'Long Article',
          source_url: 'https://example.com/long',
          content_type: 'article',
          content_length: 5000,
          warnings: [],
          duplicate_matches: [],
        }),
      });

      render(<UrlIngestForm onSuggestManual={onSuggestManual} />);

      const input = screen.getByLabelText(/web page url/i);

      await act(async () => {
        fireEvent.change(input, { target: { value: 'https://example.com/long' } });
      });

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /import/i }));
      });

      await waitFor(() => {
        expect(screen.getByTestId('success-card')).toBeInTheDocument();
      });

      expect(screen.queryByRole('button', { name: /pasting the content manually/i })).not.toBeInTheDocument();
    });

    it('does not show manual suggestion when onSuggestManual not provided', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 'new-item-abc',
          title: 'Short Article',
          source_url: 'https://example.com/short',
          content_type: 'article',
          content_length: 100,
          warnings: [],
          duplicate_matches: [],
        }),
      });

      render(<UrlIngestForm />);

      const input = screen.getByLabelText(/web page url/i);

      await act(async () => {
        fireEvent.change(input, { target: { value: 'https://example.com/short' } });
      });

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /import/i }));
      });

      await waitFor(() => {
        expect(screen.getByTestId('success-card')).toBeInTheDocument();
      });

      expect(screen.queryByRole('button', { name: /pasting the content manually/i })).not.toBeInTheDocument();
    });
  });
});
