import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProcurementCreationWizard } from '@/components/procurement/procurement-creation-wizard';

// Mock next/navigation
const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

// Mock child components that are reused (not owned by this wizard)
vi.mock('@/components/procurement/tender-upload', () => ({
  TenderUpload: ({
    procurementId,
    onUploadComplete,
  }: {
    procurementId: string;
    onUploadComplete: (result?: unknown) => void;
  }) => (
    <div data-testid="tender-upload" data-bid-id={procurementId}>
      <button
        onClick={() =>
          onUploadComplete({
            sections: [
              {
                section_name: 'General',
                section_sequence: 1,
                questions: [
                  {
                    question_text: 'Describe your approach',
                    question_sequence: 1,
                    word_limit: 500,
                    category: 'mandatory',
                  },
                ],
              },
            ],
            total_questions: 1,
            total_sections: 1,
            format: 'docx',
            extraction_method: 'programmatic',
            extracted_metadata: {
              buyer_name: 'NHS Digital',
              deadline: '2026-06-01',
              reference_number: 'REF-001',
              estimated_value: null,
              title: 'Test Tender',
              confidence: 0.85,
            },
          })
        }
      >
        Simulate Upload Complete
      </button>
      <button onClick={() => onUploadComplete()}>Simulate Empty Upload</button>
    </div>
  ),
}));

vi.mock('@/components/procurement/tender-metadata-prompt', () => ({
  TenderMetadataPrompt: ({ procurementId }: { metadata: unknown; procurementId: string }) => (
    <div data-testid="tender-metadata-prompt" data-bid-id={procurementId}>
      Metadata Prompt
    </div>
  ),
}));

vi.mock('@/components/procurement/question-review', () => ({
  QuestionReview: ({
    procurementId,
    questions,
    onConfirmed,
    onCancelled,
  }: {
    procurementId: string;
    questions: unknown[];
    onConfirmed: () => void;
    onCancelled: () => void;
  }) => (
    <div
      data-testid="question-review"
      data-bid-id={procurementId}
      data-count={questions.length}
    >
      <button onClick={onConfirmed}>Confirm Questions</button>
      <button onClick={onCancelled}>Cancel Review</button>
    </div>
  ),
}));

describe('ProcurementCreationWizard', () => {
  const onOpenChange = vi.fn();
  const onCreated = vi.fn();
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function renderWizard(open = true) {
    return render(
      <ProcurementCreationWizard
        open={open}
        onOpenChange={onOpenChange}
        onCreated={onCreated}
      />,
    );
  }

  // ----------------------------------------------------------
  // Step 1: Rendering
  // ----------------------------------------------------------

  it('renders step 1 with bid detail fields when open', () => {
    renderWizard();
    expect(screen.getByLabelText(/Procurement Name/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Buyer/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Submission Deadline/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Reference Number/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Estimated Value/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Notes/)).toBeInTheDocument();
  });

  it('shows step indicator with 3 steps', () => {
    renderWizard();
    expect(screen.getByText('Procurement Details')).toBeInTheDocument();
    expect(screen.getByText('Upload Document')).toBeInTheDocument();
    expect(screen.getByText('Review Questions')).toBeInTheDocument();
  });

  it('shows both creation paths as equal-weight choices on wizard entry', () => {
    renderWizard();
    const uploadBtn = screen.getByRole('button', {
      name: /Create & Upload Tender/,
    });
    const blankBtn = screen.getByRole('button', {
      name: /Start Blank Procurement/,
    });

    expect(uploadBtn).toBeInTheDocument();
    expect(blankBtn).toBeInTheDocument();
  });

  it('shows "Start Blank Procurement" visibly on step 1 — not nested behind another option', () => {
    renderWizard();
    const blankBtn = screen.getByRole('button', {
      name: /Start Blank Procurement/,
    });
    expect(blankBtn).toBeVisible();
  });

  // ----------------------------------------------------------
  // Step 1: Validation
  // ----------------------------------------------------------

  it('disables both creation paths when required fields are empty', () => {
    renderWizard();
    const uploadBtn = screen.getByRole('button', {
      name: /Create & Upload Tender/,
    });
    const blankBtn = screen.getByRole('button', {
      name: /Start Blank Procurement/,
    });
    expect(uploadBtn).toBeDisabled();
    expect(blankBtn).toBeDisabled();
  });

  it('enables both creation paths when name and buyer are filled', async () => {
    const user = userEvent.setup();
    renderWizard();

    await user.type(screen.getByLabelText(/Procurement Name/), 'NHS Trust ITT');
    await user.type(screen.getByLabelText(/Buyer/), 'NHS Digital');

    expect(
      screen.getByRole('button', { name: /Create & Upload Tender/ }),
    ).toBeEnabled();
    expect(
      screen.getByRole('button', { name: /Start Blank Procurement/ }),
    ).toBeEnabled();
  });

  // ----------------------------------------------------------
  // Step 1 → Step 2: Advance to upload
  // ----------------------------------------------------------

  it('advances to step 2 after successful bid creation', async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'bid-123', name: 'NHS Trust ITT' }),
    });

    renderWizard();

    await user.type(screen.getByLabelText(/Procurement Name/), 'NHS Trust ITT');
    await user.type(screen.getByLabelText(/Buyer/), 'NHS Digital');
    await user.click(
      screen.getByRole('button', { name: /Create & Upload Tender/ }),
    );

    await waitFor(() => {
      expect(screen.getByTestId('tender-upload')).toBeInTheDocument();
    });

    // Verify the tender upload gets the correct bid ID
    expect(screen.getByTestId('tender-upload')).toHaveAttribute(
      'data-bid-id',
      'bid-123',
    );
  });

  // ----------------------------------------------------------
  // Step 1: Start Blank Procurement
  // ----------------------------------------------------------

  it('calls onCreated and closes when "Start Blank Procurement" is clicked', async () => {
    const user = userEvent.setup();
    const created = { id: 'bid-456', name: 'Quick Procurement' };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => created,
    });

    renderWizard();

    await user.type(screen.getByLabelText(/Procurement Name/), 'Quick Procurement');
    await user.type(screen.getByLabelText(/Buyer/), 'HMRC');
    await user.click(screen.getByRole('button', { name: /Start Blank Procurement/ }));

    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledWith(created);
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('sends the same API request body regardless of which creation path is chosen', async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'bid-blank', name: 'Blank Path' }),
    });

    renderWizard();

    await user.type(screen.getByLabelText(/Procurement Name/), 'Blank Path');
    await user.type(screen.getByLabelText(/Buyer/), 'MOD');

    await user.click(screen.getByRole('button', { name: /Start Blank Procurement/ }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledOnce();
    });

    const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(requestBody.name).toBe('Blank Path');
    expect(requestBody.buyer).toBe('MOD');
  });

  // ----------------------------------------------------------
  // Step 1: Error handling
  // ----------------------------------------------------------

  it('displays an error on failed bid creation', async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Server error occurred' }),
    });

    renderWizard();

    await user.type(screen.getByLabelText(/Procurement Name/), 'Test Procurement');
    await user.type(screen.getByLabelText(/Buyer/), 'Test Org');
    await user.click(
      screen.getByRole('button', { name: /Create & Upload Tender/ }),
    );

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Server error occurred',
      );
    });
  });

  // ----------------------------------------------------------
  // Step 2: Skip button
  // ----------------------------------------------------------

  it('navigates to bid page when Skip is clicked on step 2', async () => {
    const user = userEvent.setup();
    const created = { id: 'bid-789', name: 'Skip Test' };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => created,
    });

    renderWizard();

    await user.type(screen.getByLabelText(/Procurement Name/), 'Skip Test');
    await user.type(screen.getByLabelText(/Buyer/), 'Test Org');
    await user.click(
      screen.getByRole('button', { name: /Create & Upload Tender/ }),
    );

    await waitFor(() => {
      expect(screen.getByTestId('tender-upload')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /Skip/ }));

    expect(onCreated).toHaveBeenCalledWith(created);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  // ----------------------------------------------------------
  // Step 2 → Step 3: Upload with results advances to review
  // ----------------------------------------------------------

  it('advances to step 3 after upload with extraction results', async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'bid-abc', name: 'Upload Test' }),
    });

    renderWizard();

    await user.type(screen.getByLabelText(/Procurement Name/), 'Upload Test');
    await user.type(screen.getByLabelText(/Buyer/), 'Test Org');
    await user.click(
      screen.getByRole('button', { name: /Create & Upload Tender/ }),
    );

    await waitFor(() => {
      expect(screen.getByTestId('tender-upload')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Simulate Upload Complete'));

    await waitFor(() => {
      expect(screen.getByTestId('question-review')).toBeInTheDocument();
    });

    // Should show metadata prompt
    expect(screen.getByTestId('tender-metadata-prompt')).toBeInTheDocument();

    // QuestionReview should receive 1 flattened question
    expect(screen.getByTestId('question-review')).toHaveAttribute(
      'data-count',
      '1',
    );
  });

  // ----------------------------------------------------------
  // Step 2: Empty upload navigates to bid
  // ----------------------------------------------------------

  it('navigates to bid page when upload returns no results', async () => {
    const user = userEvent.setup();
    const created = { id: 'bid-empty', name: 'Empty Upload' };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => created,
    });

    renderWizard();

    await user.type(screen.getByLabelText(/Procurement Name/), 'Empty Upload');
    await user.type(screen.getByLabelText(/Buyer/), 'Test Org');
    await user.click(
      screen.getByRole('button', { name: /Create & Upload Tender/ }),
    );

    await waitFor(() => {
      expect(screen.getByTestId('tender-upload')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Simulate Empty Upload'));

    expect(onCreated).toHaveBeenCalledWith(created);
  });

  // ----------------------------------------------------------
  // Step 3: Confirm questions navigates to bid
  // ----------------------------------------------------------

  it('navigates to bid page when questions are confirmed', async () => {
    const user = userEvent.setup();
    const created = { id: 'bid-confirm', name: 'Confirm Test' };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => created,
    });

    renderWizard();

    // Step 1
    await user.type(screen.getByLabelText(/Procurement Name/), 'Confirm Test');
    await user.type(screen.getByLabelText(/Buyer/), 'Test Org');
    await user.click(
      screen.getByRole('button', { name: /Create & Upload Tender/ }),
    );

    // Step 2
    await waitFor(() => {
      expect(screen.getByTestId('tender-upload')).toBeInTheDocument();
    });
    await user.click(screen.getByText('Simulate Upload Complete'));

    // Step 3
    await waitFor(() => {
      expect(screen.getByTestId('question-review')).toBeInTheDocument();
    });
    await user.click(screen.getByText('Confirm Questions'));

    expect(onCreated).toHaveBeenCalledWith(created);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  // ----------------------------------------------------------
  // Step 3: Cancel review navigates to bid
  // ----------------------------------------------------------

  it('navigates to bid page when review is cancelled', async () => {
    const user = userEvent.setup();
    const created = { id: 'bid-cancel', name: 'Cancel Test' };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => created,
    });

    renderWizard();

    await user.type(screen.getByLabelText(/Procurement Name/), 'Cancel Test');
    await user.type(screen.getByLabelText(/Buyer/), 'Test Org');
    await user.click(
      screen.getByRole('button', { name: /Create & Upload Tender/ }),
    );

    await waitFor(() => {
      expect(screen.getByTestId('tender-upload')).toBeInTheDocument();
    });
    await user.click(screen.getByText('Simulate Upload Complete'));

    await waitFor(() => {
      expect(screen.getByTestId('question-review')).toBeInTheDocument();
    });
    await user.click(screen.getByText('Cancel Review'));

    expect(onCreated).toHaveBeenCalledWith(created);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  // ----------------------------------------------------------
  // Cancel from step 1
  // ----------------------------------------------------------

  it('calls onOpenChange(false) when Cancel is clicked on step 1', async () => {
    const user = userEvent.setup();
    renderWizard();

    await user.click(screen.getByRole('button', { name: /Cancel/ }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  // ----------------------------------------------------------
  // API request body
  // ----------------------------------------------------------

  it('includes optional fields in the API request', async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'bid-full', name: 'Full Procurement' }),
    });

    renderWizard();

    await user.type(screen.getByLabelText(/Procurement Name/), 'Full Procurement');
    await user.type(screen.getByLabelText(/Buyer/), 'HMRC');
    await user.type(screen.getByLabelText(/Reference Number/), 'ITT-2026-042');
    await user.type(screen.getByLabelText(/Estimated Value/), '£50,000');

    await user.click(
      screen.getByRole('button', { name: /Create & Upload Tender/ }),
    );

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledOnce();
    });

    const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(requestBody.name).toBe('Full Procurement');
    expect(requestBody.buyer).toBe('HMRC');
    expect(requestBody.reference_number).toBe('ITT-2026-042');
    expect(requestBody.estimated_value).toBe('£50,000');
  });
});
