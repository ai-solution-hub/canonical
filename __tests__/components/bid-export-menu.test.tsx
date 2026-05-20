/**
 * BidExportMenu Component Tests
 *
 * Tests the export dropdown menu — rendering, disabled state when no questions,
 * export format options, fetch/download flow, error handling, and print action.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ---------------------------------------------------------------------------
// vi.hoisted() — mocks referenced in vi.mock() factories
// ---------------------------------------------------------------------------

const { mockToast } = vi.hoisted(() => ({
  mockToast: {
    success: vi.fn(),
    error: vi.fn(),
  },
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

// Import AFTER mocks
import { BidExportMenu } from '@/components/procurement/procurement-export-menu';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderMenu(
  overrides: Partial<{
    bidId: string;
    bidName: string;
    hasQuestions: boolean;
  }> = {},
) {
  const props = {
    bidId: 'bid-123',
    bidName: 'Test Bid',
    hasQuestions: true,
    ...overrides,
  };
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <BidExportMenu {...props} />
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BidExportMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // ---- Rendering ----

  it('renders the export trigger button', () => {
    renderMenu();
    expect(
      screen.getByRole('button', { name: 'Export bid responses' }),
    ).toBeInTheDocument();
  });

  it('displays "Export" text on the trigger button', () => {
    renderMenu();
    expect(
      screen.getByRole('button', { name: 'Export bid responses' }),
    ).toHaveTextContent('Export');
  });

  it('disables the trigger button when hasQuestions is false', () => {
    renderMenu({ hasQuestions: false });
    expect(
      screen.getByRole('button', { name: 'Export bid responses' }),
    ).toBeDisabled();
  });

  it('enables the trigger button when hasQuestions is true', () => {
    renderMenu({ hasQuestions: true });
    expect(
      screen.getByRole('button', { name: 'Export bid responses' }),
    ).not.toBeDisabled();
  });

  // ---- Dropdown menu items ----

  it('shows export options when dropdown is opened', async () => {
    const user = userEvent.setup();
    renderMenu();
    await user.click(
      screen.getByRole('button', { name: 'Export bid responses' }),
    );
    expect(screen.getByText('Word (.docx)')).toBeInTheDocument();
    expect(screen.getByText('Excel (.xlsx)')).toBeInTheDocument();
    expect(screen.getByText('Print / Save as PDF')).toBeInTheDocument();
  });

  // ---- Export: successful DOCX fetch and toast ----

  it('fetches DOCX export and shows success toast', async () => {
    const user = userEvent.setup();
    const mockBlob = new Blob(['test'], { type: 'application/octet-stream' });

    // Mock URL methods globally
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => 'blob:test-url');
    URL.revokeObjectURL = vi.fn();

    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(mockBlob),
    });

    renderMenu({ bidId: 'bid-42', bidName: 'Council Services Bid' });
    await user.click(
      screen.getByRole('button', { name: 'Export bid responses' }),
    );
    await user.click(screen.getByText('Word (.docx)'));

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/bids/bid-42/export/docx',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalledWith('Word export downloaded');
    });

    // Restore URL methods
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  });

  // ---- Export: successful XLSX fetch and toast ----

  it('fetches XLSX export and shows success toast', async () => {
    const user = userEvent.setup();
    const mockBlob = new Blob(['test'], { type: 'application/octet-stream' });

    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => 'blob:test-url');
    URL.revokeObjectURL = vi.fn();

    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(mockBlob),
    });

    renderMenu({ bidId: 'bid-42', bidName: 'Test Bid' });
    await user.click(
      screen.getByRole('button', { name: 'Export bid responses' }),
    );
    await user.click(screen.getByText('Excel (.xlsx)'));

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/bids/bid-42/export/xlsx',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalledWith('Excel export downloaded');
    });

    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  });

  // ---- Download filename sanitisation ----

  it('creates download link with sanitised filename', async () => {
    const user = userEvent.setup();
    const mockBlob = new Blob(['test']);

    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => 'blob:url');
    URL.revokeObjectURL = vi.fn();

    // Spy on createElement to observe the created anchor element
    const createdAnchors: HTMLAnchorElement[] = [];
    const origCreateElement = document.createElement.bind(document);
    const createSpy = vi
      .spyOn(document, 'createElement')
      .mockImplementation(function (
        this: Document,
        tagName: string,
        options?: ElementCreationOptions,
      ) {
        const el = origCreateElement(tagName, options);
        if (tagName === 'a') createdAnchors.push(el as HTMLAnchorElement);
        return el;
      });

    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(mockBlob),
    });

    renderMenu({ bidName: 'Council Services (2026)' });
    await user.click(
      screen.getByRole('button', { name: 'Export bid responses' }),
    );
    await user.click(screen.getByText('Word (.docx)'));

    await waitFor(() => {
      expect(createdAnchors.length).toBeGreaterThan(0);
      const anchor = createdAnchors[createdAnchors.length - 1];
      // Parentheses are stripped, spaces become dashes
      expect(anchor.download).toBe('council-services-2026-responses.docx');
    });

    createSpy.mockRestore();
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  });

  // ---- Export: error handling ----

  it('shows error toast when export fails with API error message', async () => {
    const user = userEvent.setup();
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: 'Server overloaded' }),
    });

    renderMenu();
    await user.click(
      screen.getByRole('button', { name: 'Export bid responses' }),
    );
    await user.click(screen.getByText('Word (.docx)'));

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith('Server overloaded');
    });
  });

  it('shows fallback error message when response has no JSON body', async () => {
    const user = userEvent.setup();
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 502,
      json: () => Promise.reject(new Error('no body')),
    });

    renderMenu();
    await user.click(
      screen.getByRole('button', { name: 'Export bid responses' }),
    );
    await user.click(screen.getByText('Word (.docx)'));

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith('Export failed (502)');
    });
  });

  it('shows error toast when fetch throws a network error', async () => {
    const user = userEvent.setup();
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Network failure'),
    );

    renderMenu();
    await user.click(
      screen.getByRole('button', { name: 'Export bid responses' }),
    );
    await user.click(screen.getByText('Word (.docx)'));

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith('Network failure');
    });
  });

  // ---- Print ----

  it('calls window.print when Print option is clicked', async () => {
    const user = userEvent.setup();
    const mockPrint = vi.fn();
    Object.defineProperty(window, 'print', {
      value: mockPrint,
      writable: true,
      configurable: true,
    });

    renderMenu();
    await user.click(
      screen.getByRole('button', { name: 'Export bid responses' }),
    );
    await user.click(screen.getByText('Print / Save as PDF'));

    expect(mockPrint).toHaveBeenCalled();
  });
});
