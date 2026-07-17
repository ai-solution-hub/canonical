/**
 * QuestionAnswerEditor Component Tests (ID-147 {147.17})
 *
 * Behaviour-first: covers §H2 (custom editor exposing question_text,
 * word_limit, evaluation_weight, assignee, review_status, and version for
 * one form_questions/form_responses answer slot — Schema Builder not used),
 * §H3 (writes admin/editor-gated; reviewer/viewer read-only), and §H4
 * (Schema Builder never presented in this surface).
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
// Module mocks — keep the Select primitive deterministic in jsdom (Radix
// portals/pointer-capture do not render predictably; the shared-project
// pattern is to mock ui/select as a native <select>, see
// __tests__/components/feed-source-form.test.tsx).
// ---------------------------------------------------------------------------

vi.mock('sonner', () => ({
  toast: mockToast,
}));

vi.mock('@/components/ui/select', () => ({
  Select: ({
    children,
    value,
    onValueChange,
    disabled,
  }: {
    children: React.ReactNode;
    value?: string;
    onValueChange?: (v: string) => void;
    disabled?: boolean;
  }) => (
    <select
      aria-label="Review status"
      data-testid="review-status-select"
      value={value ?? ''}
      disabled={disabled}
      onChange={(e) => onValueChange?.(e.target.value)}
    >
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  SelectItem: ({
    children,
    value,
  }: {
    children: React.ReactNode;
    value: string;
  }) => <option value={value}>{children}</option>,
}));

// Import AFTER mocks
import { QuestionAnswerEditor } from '@/components/procurement/question-answer-editor';
import type { QuestionAnswerEditorProps } from '@/components/procurement/question-answer-editor';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PROCUREMENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const QUESTION_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const RESPONSE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function renderEditor(overrides: Partial<QuestionAnswerEditorProps> = {}) {
  const props: QuestionAnswerEditorProps = {
    procurementId: PROCUREMENT_ID,
    question: {
      id: QUESTION_ID,
      question_text: 'Describe your approach to service continuity.',
      word_limit: 500,
      evaluation_weight: 20,
      assigned_to: null,
    },
    response: null,
    canEdit: true,
    ...overrides,
  };
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <QuestionAnswerEditor {...props} />
    </QueryClientProvider>,
  );
}

function mockFetchJson(body: unknown, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    json: () => Promise.resolve(body),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('QuestionAnswerEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ---- §H2: slot fields exposed ----

  it('renders the question text, word limit, evaluation weight, and assignee read-only', () => {
    renderEditor();

    expect(
      screen.getByText('Describe your approach to service continuity.'),
    ).toBeInTheDocument();
    expect(screen.getByText('500')).toBeInTheDocument();
    expect(screen.getByText('20')).toBeInTheDocument();
    expect(screen.getByText('Unassigned')).toBeInTheDocument();
  });

  it('shows a placeholder for a null word limit and evaluation weight', () => {
    renderEditor({
      question: {
        id: QUESTION_ID,
        question_text: 'Open question with no limits.',
        word_limit: null,
        evaluation_weight: null,
        assigned_to: null,
      },
    });

    // Word limit + evaluation weight both render the same "—" placeholder.
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
  });

  it('shows an honest "not yet answered" state for review status and version when the slot has no response', () => {
    renderEditor({ response: null });

    expect(screen.getByText('Not yet answered')).toBeInTheDocument();
  });

  it('fetches and displays the live review status and version once a response exists', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchJson({
        id: RESPONSE_ID,
        review_status: 'approved',
        version: 3,
      }),
    );

    renderEditor({ response: { id: RESPONSE_ID } });

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        `/api/procurement/${PROCUREMENT_ID}/responses/${RESPONSE_ID}`,
      );
    });

    expect(await screen.findByText('v3')).toBeInTheDocument();
    expect(await screen.findByText('Approved')).toBeInTheDocument();
  });

  // ---- §H4: Schema Builder never presented ----

  it('never renders or references Schema Builder', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchJson({ id: RESPONSE_ID, review_status: 'draft', version: 1 }),
    );
    renderEditor({ response: { id: RESPONSE_ID } });

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalled();
    });
    expect(screen.queryByText(/Schema Builder/i)).not.toBeInTheDocument();
  });

  // ---- §H3: reviewer/viewer is read-only ----

  it('renders no edit affordance for a reviewer/viewer caller (canEdit=false)', () => {
    renderEditor({ canEdit: false, response: { id: RESPONSE_ID } });

    expect(
      screen.queryByRole('button', { name: /Edit/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Save/ }),
    ).not.toBeInTheDocument();
  });

  // ---- §H3: admin/editor can edit ----

  it('enters edit mode with inputs for every editable slot field plus the review-status control', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      mockFetchJson({ id: RESPONSE_ID, review_status: 'draft', version: 1 }),
    );

    renderEditor({ response: { id: RESPONSE_ID } });
    await screen.findByText('v1');

    await user.click(screen.getByRole('button', { name: 'Edit' }));

    expect(
      screen.getByDisplayValue('Describe your approach to service continuity.'),
    ).toBeInTheDocument();
    expect(screen.getByDisplayValue('500')).toBeInTheDocument();
    expect(screen.getByDisplayValue('20')).toBeInTheDocument();
    expect(screen.getByTestId('review-status-select')).toBeInTheDocument();
  });

  it('saves edited question fields via PATCH to the questions route', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', mockFetchJson({ id: QUESTION_ID }));

    renderEditor({ response: null });

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const wordLimitInput = screen.getByDisplayValue('500');
    await user.clear(wordLimitInput);
    await user.type(wordLimitInput, '750');

    await user.click(screen.getByRole('button', { name: /Save/ }));

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        `/api/procurement/${PROCUREMENT_ID}/questions/${QUESTION_ID}`,
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({
            question_text: 'Describe your approach to service continuity.',
            word_limit: 750,
            evaluation_weight: 20,
            assigned_to: null,
          }),
        }),
      );
    });

    expect(mockToast.success).toHaveBeenCalledWith(
      'Question/answer slot updated',
    );
    // Edit mode exited — the Edit affordance is back.
    expect(
      await screen.findByRole('button', { name: 'Edit' }),
    ).toBeInTheDocument();
  });

  it('also persists a changed review status via PATCH to the responses route', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (!init) {
        // Initial GET response-detail fetch
        return {
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              id: RESPONSE_ID,
              review_status: 'draft',
              version: 1,
            }),
        };
      }
      return { ok: true, status: 200, json: () => Promise.resolve({}) };
    });
    vi.stubGlobal('fetch', fetchMock);

    renderEditor({ response: { id: RESPONSE_ID } });
    await screen.findByText('v1');

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.selectOptions(
      screen.getByTestId('review-status-select'),
      'approved',
    );
    await user.click(screen.getByRole('button', { name: /Save/ }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/procurement/${PROCUREMENT_ID}/responses/${RESPONSE_ID}`,
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ review_status: 'approved' }),
        }),
      );
    });
  });

  it('does not PATCH the responses route when review status is left unchanged', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (!init) {
        return {
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              id: RESPONSE_ID,
              review_status: 'draft',
              version: 1,
            }),
        };
      }
      return { ok: true, status: 200, json: () => Promise.resolve({}) };
    });
    vi.stubGlobal('fetch', fetchMock);

    renderEditor({ response: { id: RESPONSE_ID } });
    await screen.findByText('v1');

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.click(screen.getByRole('button', { name: /Save/ }));

    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalled();
    });

    const responsePatchCalls = fetchMock.mock.calls.filter(
      ([url, init]) =>
        typeof url === 'string' &&
        url.includes('/responses/') &&
        (init as RequestInit | undefined)?.method === 'PATCH',
    );
    expect(responsePatchCalls).toHaveLength(0);
  });

  it('rejects an empty question text with a toast and stays in edit mode without saving', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    renderEditor({ response: null });

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const textArea = screen.getByDisplayValue(
      'Describe your approach to service continuity.',
    );
    await user.clear(textArea);
    await user.click(screen.getByRole('button', { name: /Save/ }));

    expect(mockToast.error).toHaveBeenCalledWith(
      'Question text cannot be empty',
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Cancel/ })).toBeInTheDocument();
  });

  it('surfaces a failed save via a toast and keeps the editor in edit mode', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: 'Server overloaded' }),
      }),
    );

    renderEditor({ response: null });

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.click(screen.getByRole('button', { name: /Save/ }));

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith('Server overloaded');
    });
    expect(screen.getByRole('button', { name: /Cancel/ })).toBeInTheDocument();
  });

  it('discards edits and exits edit mode without persisting when Cancel is clicked', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    renderEditor({ response: null });

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const wordLimitInput = screen.getByDisplayValue('500');
    await user.clear(wordLimitInput);
    await user.type(wordLimitInput, '999');

    await user.click(screen.getByRole('button', { name: /Cancel/ }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText('500')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
  });
});
