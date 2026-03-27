/**
 * TemplateFieldReview Component Tests
 *
 * Tests the template field review table — rendering summary, filter tabs,
 * field rows, sorting, confirm/reject actions, auto-map, bulk actions,
 * manual mapping, empty states, and keyboard shortcuts hint.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, within, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// vi.hoisted() — mocks referenced in vi.mock() factories
// ---------------------------------------------------------------------------

const { mockToast } = vi.hoisted(() => ({
  mockToast: { success: vi.fn(), error: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

vi.mock('sonner', () => ({
  toast: mockToast,
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, disabled, ...props }: Record<string, unknown>) => (
    <button
      onClick={onClick as React.MouseEventHandler}
      disabled={disabled as boolean}
      {...props}
    >
      {children as React.ReactNode}
    </button>
  ),
}));

vi.mock('@/components/ui/checkbox', () => ({
  Checkbox: ({ checked, onCheckedChange, ...props }: Record<string, unknown>) => (
    <input
      type="checkbox"
      checked={checked as boolean}
      onChange={() => (onCheckedChange as () => void)?.()}
      aria-label={props['aria-label'] as string}
      data-testid="checkbox"
    />
  ),
}));

vi.mock('@/components/ui/progress', () => ({
  Progress: (props: Record<string, unknown>) => (
    <div role="progressbar" aria-label={props['aria-label'] as string} data-testid="progress-bar" />
  ),
}));

vi.mock('lucide-react', () => ({
  CheckCircle: ({ className, ...props }: Record<string, unknown>) => <span data-testid="check-icon" className={className as string} {...props} />,
  XCircle: ({ className, ...props }: Record<string, unknown>) => <span data-testid="x-icon" className={className as string} {...props} />,
  CircleDot: ({ className, ...props }: Record<string, unknown>) => <span data-testid="circle-dot-icon" className={className as string} {...props} />,
  AlertCircle: ({ className, ...props }: Record<string, unknown>) => <span data-testid="alert-icon" className={className as string} {...props} />,
  UserPen: ({ className, ...props }: Record<string, unknown>) => <span data-testid="user-pen-icon" className={className as string} {...props} />,
  ArrowUpDown: () => <span data-testid="sort-neutral" />,
  ArrowUp: () => <span data-testid="sort-asc" />,
  ArrowDown: () => <span data-testid="sort-desc" />,
}));

// Import AFTER mocks
import { TemplateFieldReview } from '@/components/bid/template-field-review';
import type { TemplateField, TemplateSummary } from '@/types/template';

// ---------------------------------------------------------------------------
// Data factories
// ---------------------------------------------------------------------------

function makeField(overrides: Partial<TemplateField> = {}): TemplateField {
  return {
    id: 'f-1',
    template_id: 't-1',
    field_type: 'question',
    table_index: 0,
    row_index: 0,
    col_index: 0,
    question_text: 'Describe your approach',
    section_name: 'Technical',
    word_limit: 500,
    placeholder_text: null,
    question_id: 'q-1',
    mapping_status: 'unreviewed',
    mapping_confidence: 0.85,
    fill_status: 'pending',
    fill_error: null,
    sequence: 0,
    created_at: '2026-03-01T10:00:00Z',
    updated_at: '2026-03-01T10:00:00Z',
    matched_question: {
      id: 'q-1',
      question_text: 'Describe your technical approach',
      status: 'drafted',
      response_preview: null,
    },
    ...overrides,
  };
}

function makeSummary(overrides: Partial<TemplateSummary> = {}): TemplateSummary {
  return {
    total_fields: 10,
    confirmed_fields: 3,
    rejected_fields: 1,
    unmapped_fields: 2,
    unreviewed_fields: 4,
    filled_fields: 0,
    pending_fields: 10,
    skipped_fields: 0,
    failed_fields: 0,
    ...overrides,
  };
}

function defaultProps(overrides: Record<string, unknown> = {}) {
  return {
    templateId: 't-1',
    bidId: 'bid-1',
    fields: [
      makeField({ id: 'f-1', sequence: 0, mapping_status: 'unreviewed', question_id: 'q-1' }),
      makeField({ id: 'f-2', sequence: 1, mapping_status: 'confirmed', question_id: 'q-2', question_text: 'Team structure' }),
      makeField({ id: 'f-3', sequence: 2, mapping_status: 'unmapped', question_id: null, question_text: 'Risk management', matched_question: undefined }),
    ],
    bidQuestions: [
      { id: 'q-1', question_text: 'Describe your technical approach', status: 'drafted' },
      { id: 'q-2', question_text: 'Team structure overview', status: 'drafted' },
    ],
    summary: makeSummary(),
    onMappingUpdate: vi.fn().mockResolvedValue(undefined),
    onAutoMap: vi.fn().mockResolvedValue(undefined),
    onFill: vi.fn(),
    onBulkAccept: vi.fn().mockResolvedValue(undefined),
    onBulkReject: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TemplateFieldReview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  // ---- Summary header ----

  it('renders field summary text', () => {
    render(<TemplateFieldReview {...defaultProps()} />);
    expect(screen.getByText(/10 fields found/)).toBeInTheDocument();
    expect(screen.getByText(/3 confirmed/)).toBeInTheDocument();
    expect(screen.getByText(/1 rejected/)).toBeInTheDocument();
    expect(screen.getByText(/2 unmapped/)).toBeInTheDocument();
  });

  it('renders progress bar with correct aria label', () => {
    render(<TemplateFieldReview {...defaultProps()} />);
    // totalMappable = 10 - 1 = 9, confirmedCount = 3
    expect(screen.getByRole('progressbar', { name: '3 of 9 fields mapped' })).toBeInTheDocument();
  });

  // ---- Action buttons ----

  it('renders Auto-Map button', () => {
    render(<TemplateFieldReview {...defaultProps()} />);
    expect(screen.getByText('Auto-Map')).toBeInTheDocument();
  });

  it('renders Fill Template button', () => {
    render(<TemplateFieldReview {...defaultProps()} />);
    expect(screen.getByText('Fill Template')).toBeInTheDocument();
  });

  it('disables Fill Template when no confirmed fields', () => {
    const props = defaultProps({ summary: makeSummary({ confirmed_fields: 0 }) });
    render(<TemplateFieldReview {...props} />);
    expect(screen.getByText('Fill Template')).toBeDisabled();
  });

  it('enables Fill Template when confirmed fields exist', () => {
    render(<TemplateFieldReview {...defaultProps()} />);
    expect(screen.getByText('Fill Template')).not.toBeDisabled();
  });

  it('calls onFill when Fill Template is clicked', async () => {
    const user = userEvent.setup();
    const props = defaultProps();
    render(<TemplateFieldReview {...props} />);
    await user.click(screen.getByText('Fill Template'));
    expect(props.onFill).toHaveBeenCalled();
  });

  it('renders Accept All Unreviewed when unreviewed fields exist', () => {
    render(<TemplateFieldReview {...defaultProps()} />);
    expect(screen.getByText('Accept All Unreviewed')).toBeInTheDocument();
  });

  it('does not render Accept All Unreviewed when no unreviewed fields', () => {
    const props = defaultProps({ summary: makeSummary({ unreviewed_fields: 0 }) });
    render(<TemplateFieldReview {...props} />);
    expect(screen.queryByText('Accept All Unreviewed')).not.toBeInTheDocument();
  });

  // ---- Filter tabs ----

  it('renders all filter tabs', () => {
    render(<TemplateFieldReview {...defaultProps()} />);
    const tablist = screen.getByRole('tablist', { name: 'Filter fields by status' });
    expect(within(tablist).getByText('All')).toBeInTheDocument();
    expect(within(tablist).getByText('Unreviewed')).toBeInTheDocument();
    expect(within(tablist).getByText('Confirmed')).toBeInTheDocument();
    expect(within(tablist).getByText('Unmapped')).toBeInTheDocument();
    expect(within(tablist).getByText('Rejected')).toBeInTheDocument();
  });

  it('shows counts on filter tabs', () => {
    render(<TemplateFieldReview {...defaultProps()} />);
    const tablist = screen.getByRole('tablist');
    expect(within(tablist).getByText('(4)')).toBeInTheDocument(); // unreviewed
    expect(within(tablist).getByText('(3)')).toBeInTheDocument(); // confirmed
    expect(within(tablist).getByText('(2)')).toBeInTheDocument(); // unmapped
    expect(within(tablist).getByText('(1)')).toBeInTheDocument(); // rejected
  });

  it('marks All tab as selected by default', () => {
    render(<TemplateFieldReview {...defaultProps()} />);
    const allTab = screen.getByRole('tab', { selected: true });
    expect(allTab).toHaveTextContent('All');
  });

  it('switches filter when tab is clicked', async () => {
    const user = userEvent.setup();
    render(<TemplateFieldReview {...defaultProps()} />);
    const tablist = screen.getByRole('tablist');
    await user.click(within(tablist).getByText('Confirmed'));
    // After clicking Confirmed, it should be selected
    const selectedTabs = screen.getAllByRole('tab', { selected: true });
    const confirmedTab = selectedTabs.find((t) => t.textContent?.includes('Confirmed'));
    expect(confirmedTab).toBeTruthy();
  });

  // ---- Field table rendering ----

  it('renders field rows', () => {
    render(<TemplateFieldReview {...defaultProps()} />);
    expect(screen.getByText('Describe your approach')).toBeInTheDocument();
    expect(screen.getByText('Team structure')).toBeInTheDocument();
    expect(screen.getByText('Risk management')).toBeInTheDocument();
  });

  it('renders sequence numbers (1-based)', () => {
    render(<TemplateFieldReview {...defaultProps()} />);
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('renders section names', () => {
    render(<TemplateFieldReview {...defaultProps()} />);
    expect(screen.getAllByText('Technical').length).toBeGreaterThanOrEqual(1);
  });

  it('renders word limit when present', () => {
    render(<TemplateFieldReview {...defaultProps()} />);
    expect(screen.getAllByText('500 words').length).toBeGreaterThanOrEqual(1);
  });

  it('renders matched question text', () => {
    render(<TemplateFieldReview {...defaultProps()} />);
    // Text appears in both rows (f-1 and f-2 share same matched_question default),
    // so use getAllByText
    const matches = screen.getAllByText('Describe your technical approach');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('renders status badges in table rows', () => {
    render(<TemplateFieldReview {...defaultProps()} />);
    // Status labels appear in both filter tabs and table rows — verify via badges
    const badges = screen.getAllByText('Unreviewed');
    // At least 2: one from the tab, one from the row badge
    expect(badges.length).toBeGreaterThanOrEqual(2);
    const confirmedBadges = screen.getAllByText('Confirmed');
    expect(confirmedBadges.length).toBeGreaterThanOrEqual(2);
    const unmappedBadges = screen.getAllByText('Unmapped');
    expect(unmappedBadges.length).toBeGreaterThanOrEqual(2);
  });

  it('renders confidence percentage', () => {
    render(<TemplateFieldReview {...defaultProps()} />);
    // 0.85 => 85%
    expect(screen.getAllByText('85%').length).toBeGreaterThanOrEqual(1);
  });

  it('does not render confidence when null', () => {
    const fields = [makeField({ id: 'f-1', mapping_confidence: null })];
    render(<TemplateFieldReview {...defaultProps({ fields })} />);
    expect(screen.queryByText('%')).not.toBeInTheDocument();
  });

  // ---- Confirm/reject actions ----

  it('shows Confirm button for unreviewed fields with question_id', () => {
    render(<TemplateFieldReview {...defaultProps()} />);
    expect(screen.getByText('Confirm')).toBeInTheDocument();
  });

  it('calls onMappingUpdate when Confirm is clicked', async () => {
    const user = userEvent.setup();
    const props = defaultProps();
    render(<TemplateFieldReview {...props} />);
    await user.click(screen.getByText('Confirm'));
    expect(props.onMappingUpdate).toHaveBeenCalledWith('f-1', 'q-1', 'confirmed');
  });

  it('shows toast on successful confirm', async () => {
    const user = userEvent.setup();
    render(<TemplateFieldReview {...defaultProps()} />);
    await user.click(screen.getByText('Confirm'));
    expect(mockToast.success).toHaveBeenCalledWith('Mapping confirmed');
  });

  it('shows error toast when confirm fails', async () => {
    const user = userEvent.setup();
    const props = defaultProps({ onMappingUpdate: vi.fn().mockRejectedValue(new Error('fail')) });
    render(<TemplateFieldReview {...props} />);
    await user.click(screen.getByText('Confirm'));
    expect(mockToast.error).toHaveBeenCalledWith('Failed to confirm mapping');
  });

  it('shows Reject button for non-rejected fields', () => {
    render(<TemplateFieldReview {...defaultProps()} />);
    // Multiple reject buttons (one per non-rejected field)
    const rejectButtons = screen.getAllByText('Reject');
    expect(rejectButtons.length).toBeGreaterThanOrEqual(1);
  });

  it('calls onMappingUpdate when Reject is clicked', async () => {
    const user = userEvent.setup();
    const props = defaultProps();
    render(<TemplateFieldReview {...props} />);
    const rejectButtons = screen.getAllByText('Reject');
    await user.click(rejectButtons[0]);
    expect(props.onMappingUpdate).toHaveBeenCalledWith('f-1', null, 'rejected');
  });

  // ---- Auto-map ----

  it('calls onAutoMap when Auto-Map is clicked', async () => {
    const user = userEvent.setup();
    const props = defaultProps();
    render(<TemplateFieldReview {...props} />);
    await user.click(screen.getByText('Auto-Map'));
    expect(props.onAutoMap).toHaveBeenCalled();
  });

  it('shows toast on successful auto-map', async () => {
    const user = userEvent.setup();
    render(<TemplateFieldReview {...defaultProps()} />);
    await user.click(screen.getByText('Auto-Map'));
    expect(mockToast.success).toHaveBeenCalledWith('Auto-mapping complete');
  });

  it('shows error toast when auto-map fails', async () => {
    const user = userEvent.setup();
    const props = defaultProps({ onAutoMap: vi.fn().mockRejectedValue(new Error('fail')) });
    render(<TemplateFieldReview {...props} />);
    await user.click(screen.getByText('Auto-Map'));
    expect(mockToast.error).toHaveBeenCalledWith('Auto-mapping failed');
  });

  // ---- Bulk accept ----

  it('calls onBulkAccept when Accept All Unreviewed is clicked', async () => {
    const user = userEvent.setup();
    const props = defaultProps();
    render(<TemplateFieldReview {...props} />);
    await user.click(screen.getByText('Accept All Unreviewed'));
    expect(props.onBulkAccept).toHaveBeenCalled();
  });

  // ---- Manual mapping ----

  it('shows assign question link for unmapped fields', () => {
    render(<TemplateFieldReview {...defaultProps()} />);
    expect(screen.getByText('Assign question...')).toBeInTheDocument();
  });

  it('shows question select dropdown when assign is clicked', async () => {
    const user = userEvent.setup();
    render(<TemplateFieldReview {...defaultProps()} />);
    await user.click(screen.getByText('Assign question...'));
    expect(screen.getByText('Select a question...')).toBeInTheDocument();
  });

  // ---- Empty state ----

  it('shows empty message when no fields match filter', async () => {
    const user = userEvent.setup();
    const fields = [makeField({ id: 'f-1', mapping_status: 'unreviewed' })];
    const summary = makeSummary({ confirmed_fields: 0 });
    render(<TemplateFieldReview {...defaultProps({ fields, summary })} />);
    await user.click(screen.getByText('Confirmed'));
    expect(screen.getByText(/No fields match the current filter/)).toBeInTheDocument();
  });

  // ---- Table headers ----

  it('renders sortable column headers', () => {
    render(<TemplateFieldReview {...defaultProps()} />);
    expect(screen.getByText('Question (from template)')).toBeInTheDocument();
    expect(screen.getByText('Mapped To')).toBeInTheDocument();
    expect(screen.getByText('Actions')).toBeInTheDocument();
  });

  // ---- Keyboard shortcuts hint ----

  it('renders keyboard shortcuts hint', () => {
    render(<TemplateFieldReview {...defaultProps()} />);
    expect(screen.getByText(/Keyboard:/)).toBeInTheDocument();
    expect(screen.getByText('j')).toBeInTheDocument();
    expect(screen.getByText('k')).toBeInTheDocument();
    expect(screen.getByText('Enter')).toBeInTheDocument();
    expect(screen.getByText('r')).toBeInTheDocument();
    expect(screen.getByText('n')).toBeInTheDocument();
  });

  // ---- Bulk selection ----

  it('renders select-all checkbox when onBulkReject is provided', () => {
    render(<TemplateFieldReview {...defaultProps()} />);
    expect(screen.getByLabelText('Select all fields')).toBeInTheDocument();
  });

  it('does not render checkboxes when onBulkReject is undefined', () => {
    const props = defaultProps({ onBulkReject: undefined });
    render(<TemplateFieldReview {...props} />);
    expect(screen.queryByLabelText('Select all fields')).not.toBeInTheDocument();
  });

  // ---- Sorting ----

  it('shows sort indicators in column headers', () => {
    render(<TemplateFieldReview {...defaultProps()} />);
    // Default sort is by sequence ascending — should show asc icon for # header
    expect(screen.getByTestId('sort-asc')).toBeInTheDocument();
  });

  // ---- Unknown status fallback ----

  it('renders raw status text for unknown statuses', () => {
    const fields = [makeField({ id: 'f-1', mapping_status: 'custom_status' as never })];
    render(<TemplateFieldReview {...defaultProps({ fields })} />);
    expect(screen.getByText('custom_status')).toBeInTheDocument();
  });

  // ---- Section name fallback ----

  it('renders -- for missing section name', () => {
    const fields = [makeField({ id: 'f-1', section_name: null })];
    render(<TemplateFieldReview {...defaultProps({ fields })} />);
    expect(screen.getByText('--')).toBeInTheDocument();
  });

  it('renders -- for missing question text', () => {
    const fields = [makeField({ id: 'f-1', question_text: null })];
    render(<TemplateFieldReview {...defaultProps({ fields })} />);
    expect(screen.getAllByText('--').length).toBeGreaterThanOrEqual(1);
  });

  // ---- Keyboard navigation ----

  it('navigates down with j key', () => {
    render(<TemplateFieldReview {...defaultProps()} />);
    fireEvent.keyDown(document, { key: 'j' });
    const rows = screen.getAllByRole('row');
    // First tbody row (index 1, after header row) should have focused class
    const tbodyRows = rows.slice(1);
    expect(tbodyRows[0].className).toContain('bg-accent/50');
  });

  it('navigates up with k key', () => {
    render(<TemplateFieldReview {...defaultProps()} />);
    // Move down twice
    fireEvent.keyDown(document, { key: 'j' });
    fireEvent.keyDown(document, { key: 'j' });
    // Move back up
    fireEvent.keyDown(document, { key: 'k' });
    const rows = screen.getAllByRole('row');
    const tbodyRows = rows.slice(1);
    expect(tbodyRows[0].className).toContain('bg-accent/50');
    expect(tbodyRows[1].className).not.toContain('bg-accent/50');
  });

  it('j key does not go past the last field', () => {
    const fields = [
      makeField({ id: 'f-1', sequence: 0 }),
      makeField({ id: 'f-2', sequence: 1 }),
    ];
    render(<TemplateFieldReview {...defaultProps({ fields })} />);
    // Press j more times than fields
    fireEvent.keyDown(document, { key: 'j' });
    fireEvent.keyDown(document, { key: 'j' });
    fireEvent.keyDown(document, { key: 'j' });
    fireEvent.keyDown(document, { key: 'j' });
    const rows = screen.getAllByRole('row');
    const tbodyRows = rows.slice(1);
    // Last row should be focused
    expect(tbodyRows[1].className).toContain('bg-accent/50');
    expect(tbodyRows[0].className).not.toContain('bg-accent/50');
  });

  it('k key does not go below zero', () => {
    render(<TemplateFieldReview {...defaultProps()} />);
    // Press k without pressing j first — should stay at index 0
    fireEvent.keyDown(document, { key: 'k' });
    const rows = screen.getAllByRole('row');
    const tbodyRows = rows.slice(1);
    expect(tbodyRows[0].className).toContain('bg-accent/50');
  });

  it('n key jumps to next unreviewed field', () => {
    const fields = [
      makeField({ id: 'f-1', sequence: 0, mapping_status: 'confirmed', question_id: 'q-1' }),
      makeField({ id: 'f-2', sequence: 1, mapping_status: 'unreviewed', question_id: 'q-2', question_text: 'Unreviewed Q' }),
      makeField({ id: 'f-3', sequence: 2, mapping_status: 'confirmed', question_id: 'q-3', question_text: 'Another confirmed' }),
    ];
    render(<TemplateFieldReview {...defaultProps({ fields })} />);
    fireEvent.keyDown(document, { key: 'n' });
    const rows = screen.getAllByRole('row');
    const tbodyRows = rows.slice(1);
    // Index 1 (the unreviewed one) should be focused
    expect(tbodyRows[1].className).toContain('bg-accent/50');
  });

  it('Enter key confirms the focused unreviewed field', async () => {
    const props = defaultProps();
    render(<TemplateFieldReview {...props} />);
    // Focus first row (unreviewed with question_id)
    fireEvent.keyDown(document, { key: 'j' });
    await act(async () => {
      fireEvent.keyDown(document, { key: 'Enter' });
    });
    expect(props.onMappingUpdate).toHaveBeenCalledWith('f-1', 'q-1', 'confirmed');
  });

  // ---- Keyboard guards ----

  it('Enter key does not confirm a confirmed field', async () => {
    const fields = [
      makeField({ id: 'f-1', sequence: 0, mapping_status: 'confirmed', question_id: 'q-1' }),
    ];
    const props = defaultProps({ fields });
    render(<TemplateFieldReview {...props} />);
    fireEvent.keyDown(document, { key: 'j' });
    await act(async () => {
      fireEvent.keyDown(document, { key: 'Enter' });
    });
    expect(props.onMappingUpdate).not.toHaveBeenCalled();
  });

  it('r key rejects the focused field', async () => {
    const props = defaultProps();
    render(<TemplateFieldReview {...props} />);
    // Focus first row (unreviewed)
    fireEvent.keyDown(document, { key: 'j' });
    await act(async () => {
      fireEvent.keyDown(document, { key: 'r' });
    });
    expect(props.onMappingUpdate).toHaveBeenCalledWith('f-1', null, 'rejected');
  });

  it('r key does not reject an already-rejected field', async () => {
    const fields = [
      makeField({ id: 'f-1', sequence: 0, mapping_status: 'rejected', question_id: null }),
    ];
    const props = defaultProps({ fields });
    render(<TemplateFieldReview {...props} />);
    fireEvent.keyDown(document, { key: 'j' });
    await act(async () => {
      fireEvent.keyDown(document, { key: 'r' });
    });
    expect(props.onMappingUpdate).not.toHaveBeenCalled();
  });

  // ---- Sorting ----

  it('clicking a sort header changes row order', async () => {
    const user = userEvent.setup();
    const fields = [
      makeField({ id: 'f-1', sequence: 0, mapping_confidence: 0.5, question_text: 'Low confidence' }),
      makeField({ id: 'f-2', sequence: 1, mapping_confidence: 0.95, question_text: 'High confidence' }),
    ];
    render(<TemplateFieldReview {...defaultProps({ fields })} />);
    // Default order is by sequence: f-1 first
    let rows = screen.getAllByRole('row');
    let tbodyRows = rows.slice(1);
    expect(tbodyRows[0]).toHaveTextContent('Low confidence');
    // Click Confidence header
    await user.click(screen.getByText('Confidence'));
    rows = screen.getAllByRole('row');
    tbodyRows = rows.slice(1);
    // Ascending confidence: 0.5 still first
    expect(tbodyRows[0]).toHaveTextContent('Low confidence');
    expect(tbodyRows[1]).toHaveTextContent('High confidence');
  });

  it('clicking same sort header toggles direction', async () => {
    const user = userEvent.setup();
    render(<TemplateFieldReview {...defaultProps()} />);
    // # header is default (sequence, asc) — should show asc icon
    expect(screen.getByTestId('sort-asc')).toBeInTheDocument();
    // Click # header again to toggle to desc
    await user.click(screen.getByText('#'));
    expect(screen.getByTestId('sort-desc')).toBeInTheDocument();
  });

  it('clicking different sort header resets to ascending', async () => {
    const user = userEvent.setup();
    render(<TemplateFieldReview {...defaultProps()} />);
    // Toggle sequence to desc first
    await user.click(screen.getByText('#'));
    expect(screen.getByTestId('sort-desc')).toBeInTheDocument();
    // Click a different header (Confidence)
    await user.click(screen.getByText('Confidence'));
    // Should reset to ascending for the new column
    expect(screen.getByTestId('sort-asc')).toBeInTheDocument();
  });

  // ---- Bulk reject flow ----

  it('bulk reject: select fields then click Reject Selected', async () => {
    const user = userEvent.setup();
    const fields = [
      makeField({ id: 'f-1', sequence: 0, mapping_status: 'unreviewed' }),
      makeField({ id: 'f-2', sequence: 1, mapping_status: 'unreviewed', question_text: 'Second field' }),
      makeField({ id: 'f-3', sequence: 2, mapping_status: 'confirmed', question_text: 'Third field' }),
    ];
    const mockBulkReject = vi.fn().mockResolvedValue(undefined);
    render(<TemplateFieldReview {...defaultProps({ fields, onBulkReject: mockBulkReject })} />);
    // Click first two field checkboxes (skip select-all which is first checkbox)
    const checkboxes = screen.getAllByTestId('checkbox');
    // checkboxes[0] = select-all, checkboxes[1..3] = per-field
    await user.click(checkboxes[1]);
    await user.click(checkboxes[2]);
    // "Reject Selected (2)" button should now appear
    const rejectSelectedBtn = screen.getByText(/Reject Selected \(2\)/);
    await user.click(rejectSelectedBtn);
    expect(mockBulkReject).toHaveBeenCalledWith(expect.arrayContaining(['f-1', 'f-2']));
  });

  it('bulk reject error shows toast', async () => {
    const user = userEvent.setup();
    const fields = [
      makeField({ id: 'f-1', sequence: 0, mapping_status: 'unreviewed' }),
    ];
    const mockBulkReject = vi.fn().mockRejectedValue(new Error('fail'));
    render(<TemplateFieldReview {...defaultProps({ fields, onBulkReject: mockBulkReject })} />);
    const checkboxes = screen.getAllByTestId('checkbox');
    await user.click(checkboxes[1]); // select the field
    const rejectSelectedBtn = screen.getByText(/Reject Selected \(1\)/);
    await user.click(rejectSelectedBtn);
    expect(mockToast.error).toHaveBeenCalledWith('Bulk reject failed');
  });

  // ---- Manual mapping ----

  it('manual mapping: selecting question from dropdown calls onMappingUpdate with manual', async () => {
    const user = userEvent.setup();
    const props = defaultProps();
    render(<TemplateFieldReview {...props} />);
    // Click "Assign question..." on the unmapped field (f-3)
    await user.click(screen.getByText('Assign question...'));
    // Now a native <select> should appear
    const selectEl = screen.getByRole('combobox');
    fireEvent.change(selectEl, { target: { value: 'q-1' } });
    await act(async () => {});
    expect(props.onMappingUpdate).toHaveBeenCalledWith('f-3', 'q-1', 'manual');
  });

  it('manual mapping error shows toast', async () => {
    const user = userEvent.setup();
    const props = defaultProps({
      onMappingUpdate: vi.fn().mockRejectedValue(new Error('fail')),
    });
    render(<TemplateFieldReview {...props} />);
    await user.click(screen.getByText('Assign question...'));
    const selectEl = screen.getByRole('combobox');
    fireEvent.change(selectEl, { target: { value: 'q-1' } });
    await act(async () => {});
    expect(mockToast.error).toHaveBeenCalledWith('Failed to set mapping');
  });

  // ---- Focus/selection reset ----

  it('focus index resets when filter changes', async () => {
    const user = userEvent.setup();
    render(<TemplateFieldReview {...defaultProps()} />);
    // Focus a row
    fireEvent.keyDown(document, { key: 'j' });
    let rows = screen.getAllByRole('row');
    let tbodyRows = rows.slice(1);
    expect(tbodyRows[0].className).toContain('bg-accent/50');
    // Click a different filter tab to trigger reset
    const tablist = screen.getByRole('tablist');
    await user.click(within(tablist).getByText('Confirmed'));
    // Re-query rows — no row should have focus class
    rows = screen.getAllByRole('row');
    tbodyRows = rows.slice(1);
    const focusedRows = tbodyRows.filter((r) => r.className.includes('bg-accent/50'));
    expect(focusedRows.length).toBe(0);
  });

  it('selection clears when filter changes', async () => {
    const user = userEvent.setup();
    const fields = [
      makeField({ id: 'f-1', sequence: 0, mapping_status: 'unreviewed' }),
      makeField({ id: 'f-2', sequence: 1, mapping_status: 'confirmed', question_text: 'Confirmed Q' }),
    ];
    const mockBulkReject = vi.fn().mockResolvedValue(undefined);
    render(<TemplateFieldReview {...defaultProps({ fields, onBulkReject: mockBulkReject })} />);
    // Select a checkbox
    const checkboxes = screen.getAllByTestId('checkbox');
    await user.click(checkboxes[1]);
    // Verify selection exists — Reject Selected button shows
    expect(screen.getByText(/Reject Selected \(1\)/)).toBeInTheDocument();
    // Change filter to a different tab to trigger reset
    const tablist = screen.getByRole('tablist');
    await user.click(within(tablist).getByText('Confirmed'));
    // Reject Selected button should be gone (selection cleared)
    expect(screen.queryByText(/Reject Selected/)).not.toBeInTheDocument();
  });

  it('toggleSelectAll selects all non-rejected fields', async () => {
    const user = userEvent.setup();
    const fields = [
      makeField({ id: 'f-1', sequence: 0, mapping_status: 'unreviewed' }),
      makeField({ id: 'f-2', sequence: 1, mapping_status: 'confirmed', question_text: 'Confirmed Q' }),
      makeField({ id: 'f-3', sequence: 2, mapping_status: 'rejected', question_text: 'Rejected Q' }),
    ];
    const mockBulkReject = vi.fn().mockResolvedValue(undefined);
    render(<TemplateFieldReview {...defaultProps({ fields, onBulkReject: mockBulkReject })} />);
    // Click select-all checkbox
    const selectAll = screen.getByLabelText('Select all fields');
    await user.click(selectAll);
    // Should show Reject Selected with count 2 (excluding rejected field)
    expect(screen.getByText(/Reject Selected \(2\)/)).toBeInTheDocument();
  });

  // ---- Loading states ----

  it('Auto-Map button shows Mapping text while in progress', async () => {
    const user = userEvent.setup();
    let resolvePromise: () => void;
    const promise = new Promise<void>((r) => { resolvePromise = r; });
    const mockOnAutoMap = vi.fn().mockReturnValue(promise);
    render(<TemplateFieldReview {...defaultProps({ onAutoMap: mockOnAutoMap })} />);
    await user.click(screen.getByText('Auto-Map'));
    expect(screen.getByText('Mapping...')).toBeInTheDocument();
    // Clean up
    resolvePromise!();
    await act(async () => {});
  });

  it('bulk accept error shows toast', async () => {
    const user = userEvent.setup();
    const props = defaultProps({
      onBulkAccept: vi.fn().mockRejectedValue(new Error('fail')),
    });
    render(<TemplateFieldReview {...props} />);
    await user.click(screen.getByText('Accept All Unreviewed'));
    expect(mockToast.error).toHaveBeenCalledWith('Bulk accept failed');
  });

  // ---- Confidence badge thresholds ----

  it('renders high confidence with strong colour class', () => {
    const fields = [makeField({ id: 'f-1', mapping_confidence: 0.95 })];
    render(<TemplateFieldReview {...defaultProps({ fields })} />);
    const badge = screen.getByText('95%');
    expect(badge.className).toContain('text-confidence-strong');
  });

  it('renders medium confidence with partial colour class', () => {
    const fields = [makeField({ id: 'f-1', mapping_confidence: 0.75 })];
    render(<TemplateFieldReview {...defaultProps({ fields })} />);
    const badge = screen.getByText('75%');
    expect(badge.className).toContain('text-confidence-partial');
  });

  it('renders low confidence with stale colour class', () => {
    const fields = [makeField({ id: 'f-1', mapping_confidence: 0.5 })];
    render(<TemplateFieldReview {...defaultProps({ fields })} />);
    const badge = screen.getByText('50%');
    expect(badge.className).toContain('text-freshness-stale');
  });
});
