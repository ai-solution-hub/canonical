/**
 * TemplateFillProgress Component Tests
 *
 * Tests the template fill progress indicator — polling behaviour,
 * status phases (pending, processing, completed, failed), error display,
 * retry button, and cleanup on unmount.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, act } from '@testing-library/react';
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

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, ...props }: Record<string, unknown>) => (
    <button onClick={onClick as React.MouseEventHandler} {...props}>
      {children as React.ReactNode}
    </button>
  ),
}));

vi.mock('@/components/ui/progress', () => ({
  Progress: (props: Record<string, unknown>) => (
    <div
      role="progressbar"
      aria-label={props['aria-label'] as string}
      data-testid="progress-bar"
    />
  ),
}));

vi.mock('lucide-react', () => ({
  Loader2: (props: Record<string, unknown>) => (
    <span
      data-testid="loader-icon"
      aria-hidden={
        props['aria-hidden'] as boolean | 'true' | 'false' | undefined
      }
    />
  ),
  CheckCircle: (props: Record<string, unknown>) => (
    <span
      data-testid="check-icon"
      aria-hidden={
        props['aria-hidden'] as boolean | 'true' | 'false' | undefined
      }
    />
  ),
  AlertTriangle: (props: Record<string, unknown>) => (
    <span
      data-testid="alert-icon"
      aria-hidden={
        props['aria-hidden'] as boolean | 'true' | 'false' | undefined
      }
    />
  ),
  RefreshCw: (props: Record<string, unknown>) => (
    <span
      data-testid="refresh-icon"
      aria-hidden={
        props['aria-hidden'] as boolean | 'true' | 'false' | undefined
      }
    />
  ),
}));

// Import AFTER mocks
import { TemplateFillProgress } from '@/components/procurement/template-fill-progress';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeJobStatus(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job-1',
    job_type: 'template_fill',
    status: 'pending',
    payload: {},
    result: null,
    error_message: null,
    created_at: '2026-03-01T10:00:00Z',
    started_at: null,
    completed_at: null,
    ...overrides,
  };
}

function mockFetchResponse(data: unknown, ok = true, status = 200) {
  return Promise.resolve({
    ok,
    status,
    json: () => Promise.resolve(data),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TemplateFillProgress', () => {
  const defaultProps = {
    jobId: 'job-1',
    onComplete: vi.fn(),
    onError: vi.fn(),
    onRetry: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  // ---- Pending/processing states ----

  it('renders loading spinner in pending state', async () => {
    mockFetch.mockReturnValue(
      mockFetchResponse(makeJobStatus({ status: 'pending' })),
    );
    await act(async () => {
      render(<TemplateFillProgress {...defaultProps} />);
    });
    expect(screen.getByTestId('loader-icon')).toBeInTheDocument();
    expect(screen.getByText('Preparing document...')).toBeInTheDocument();
  });

  it('renders progress bar with aria label', async () => {
    mockFetch.mockReturnValue(
      mockFetchResponse(makeJobStatus({ status: 'pending' })),
    );
    await act(async () => {
      render(<TemplateFillProgress {...defaultProps} />);
    });
    expect(
      screen.getByRole('progressbar', { name: 'Fill in progress' }),
    ).toBeInTheDocument();
  });

  it('shows processing phase label when status is processing', async () => {
    mockFetch.mockReturnValue(
      mockFetchResponse(makeJobStatus({ status: 'processing' })),
    );
    await act(async () => {
      render(<TemplateFillProgress {...defaultProps} />);
    });
    expect(
      screen.getByText('Writing responses into template...'),
    ).toBeInTheDocument();
  });

  // ---- Completed state ----

  it('renders success state when job completes', async () => {
    const result = { completion_id: 'c-1' };
    mockFetch.mockReturnValue(
      mockFetchResponse(makeJobStatus({ status: 'completed', result })),
    );
    await act(async () => {
      render(<TemplateFillProgress {...defaultProps} />);
    });
    expect(screen.getByTestId('check-icon')).toBeInTheDocument();
    expect(
      screen.getByText('Template filled successfully'),
    ).toBeInTheDocument();
  });

  it('calls onComplete with result when job completes', async () => {
    const result = { completion_id: 'c-1' };
    mockFetch.mockReturnValue(
      mockFetchResponse(makeJobStatus({ status: 'completed', result })),
    );
    await act(async () => {
      render(<TemplateFillProgress {...defaultProps} />);
    });
    expect(defaultProps.onComplete).toHaveBeenCalledWith(result);
  });

  it('calls onComplete with empty object when result is null', async () => {
    mockFetch.mockReturnValue(
      mockFetchResponse(makeJobStatus({ status: 'completed', result: null })),
    );
    await act(async () => {
      render(<TemplateFillProgress {...defaultProps} />);
    });
    expect(defaultProps.onComplete).toHaveBeenCalledWith({});
  });

  // ---- Failed state ----

  it('renders error state when job fails', async () => {
    mockFetch.mockReturnValue(
      mockFetchResponse(
        makeJobStatus({
          status: 'failed',
          error_message: 'Docx corruption detected',
        }),
      ),
    );
    await act(async () => {
      render(<TemplateFillProgress {...defaultProps} />);
    });
    expect(screen.getByTestId('alert-icon')).toBeInTheDocument();
    expect(
      screen.getByText("Template fill didn't complete"),
    ).toBeInTheDocument();
    expect(screen.getByText('Docx corruption detected')).toBeInTheDocument();
  });

  it('calls onError with error message when job fails', async () => {
    mockFetch.mockReturnValue(
      mockFetchResponse(
        makeJobStatus({
          status: 'failed',
          error_message: 'Docx corruption detected',
        }),
      ),
    );
    await act(async () => {
      render(<TemplateFillProgress {...defaultProps} />);
    });
    expect(defaultProps.onError).toHaveBeenCalledWith(
      'Docx corruption detected',
    );
  });

  it('uses default error message when error_message is null', async () => {
    mockFetch.mockReturnValue(
      mockFetchResponse(
        makeJobStatus({
          status: 'failed',
          error_message: null,
        }),
      ),
    );
    await act(async () => {
      render(<TemplateFillProgress {...defaultProps} />);
    });
    expect(defaultProps.onError).toHaveBeenCalledWith('Template fill failed');
  });

  // ---- Retry button ----

  it('shows retry button when onRetry is provided and error occurs', async () => {
    mockFetch.mockReturnValue(
      mockFetchResponse(
        makeJobStatus({
          status: 'failed',
          error_message: 'Error',
        }),
      ),
    );
    await act(async () => {
      render(<TemplateFillProgress {...defaultProps} />);
    });
    expect(screen.getByText('Retry')).toBeInTheDocument();
  });

  it('calls onRetry when retry button is clicked', async () => {
    vi.useRealTimers();
    const user = userEvent.setup();
    mockFetch.mockReturnValue(
      mockFetchResponse(
        makeJobStatus({
          status: 'failed',
          error_message: 'Error',
        }),
      ),
    );
    await act(async () => {
      render(<TemplateFillProgress {...defaultProps} />);
    });
    await user.click(screen.getByText('Retry'));
    expect(defaultProps.onRetry).toHaveBeenCalled();
  });

  it('does not show retry button when onRetry is not provided', async () => {
    mockFetch.mockReturnValue(
      mockFetchResponse(
        makeJobStatus({
          status: 'failed',
          error_message: 'Error',
        }),
      ),
    );
    const { onRetry: _unused, ...propsWithoutRetry } = defaultProps;
    await act(async () => {
      render(<TemplateFillProgress {...propsWithoutRetry} />);
    });
    expect(screen.queryByText('Retry')).not.toBeInTheDocument();
  });

  // ---- Fetch error handling ----

  it('shows error when fetch fails with non-ok response', async () => {
    mockFetch.mockReturnValue(mockFetchResponse(null, false, 500));
    await act(async () => {
      render(<TemplateFillProgress {...defaultProps} />);
    });
    expect(screen.getByText('Failed to fetch job status')).toBeInTheDocument();
  });

  it('shows error when fetch throws', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));
    await act(async () => {
      render(<TemplateFillProgress {...defaultProps} />);
    });
    expect(screen.getByText('Network error')).toBeInTheDocument();
  });

  it('shows fallback error message for non-Error throws', async () => {
    mockFetch.mockRejectedValue('string error');
    await act(async () => {
      render(<TemplateFillProgress {...defaultProps} />);
    });
    expect(screen.getByText('Failed to check job status')).toBeInTheDocument();
  });

  // ---- Polling behaviour ----

  it('polls the correct API endpoint', async () => {
    mockFetch.mockReturnValue(
      mockFetchResponse(makeJobStatus({ status: 'pending' })),
    );
    await act(async () => {
      render(<TemplateFillProgress {...defaultProps} />);
    });
    expect(mockFetch).toHaveBeenCalledWith('/api/jobs/job-1/status');
  });

  it('polls at 2-second intervals', async () => {
    mockFetch.mockReturnValue(
      mockFetchResponse(makeJobStatus({ status: 'pending' })),
    );
    await act(async () => {
      render(<TemplateFillProgress {...defaultProps} />);
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(mockFetch).toHaveBeenCalledTimes(2);

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('stops polling when job completes', async () => {
    mockFetch.mockReturnValue(
      mockFetchResponse(makeJobStatus({ status: 'completed', result: {} })),
    );
    await act(async () => {
      render(<TemplateFillProgress {...defaultProps} />);
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(4000);
    });
    // Should not have polled again after completed
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('stops polling when job fails', async () => {
    mockFetch.mockReturnValue(
      mockFetchResponse(
        makeJobStatus({ status: 'failed', error_message: 'err' }),
      ),
    );
    await act(async () => {
      render(<TemplateFillProgress {...defaultProps} />);
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(4000);
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  // ---- Cleanup on unmount ----

  it('cleans up interval on unmount', async () => {
    mockFetch.mockReturnValue(
      mockFetchResponse(makeJobStatus({ status: 'pending' })),
    );
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
    let unmount: () => void;
    await act(async () => {
      const result = render(<TemplateFillProgress {...defaultProps} />);
      unmount = result.unmount;
    });
    act(() => {
      unmount!();
    });
    expect(clearIntervalSpy).toHaveBeenCalled();
    clearIntervalSpy.mockRestore();
  });
});
