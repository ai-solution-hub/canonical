/**
 * CoverageTargetEditor Component Tests
 *
 * Tests dialog interactions:
 *   - Renders domain names from taxonomy
 *   - Populates inputs from existing targets
 *   - Save All calls onSave with changed values
 *   - Cancel closes the dialog
 *   - Loading state during save
 *   - Save error display
 *   - Empty inputs are excluded from save payload
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CoverageTargetEditor } from '@/components/coverage-target-editor';
import type { CoverageTargetRow } from '@/hooks/use-coverage-targets';

// ---------------------------------------------------------------------------
// Mock taxonomy context
// ---------------------------------------------------------------------------

const mockDomains = [
  { id: '00000000-0000-4000-8000-000000000001', name: 'Compliance', display_order: 0, colour: 'corporate', is_active: true, provenance: 'baseline' as const },
  { id: '00000000-0000-4000-8000-000000000002', name: 'HR', display_order: 1, colour: 'hr', is_active: true, provenance: 'baseline' as const },
];

vi.mock('@/contexts/taxonomy-context', () => ({
  useTaxonomy: () => ({
    domains: mockDomains,
    subtopics: [],
    loading: false,
    error: null,
    getDomainNames: () => mockDomains.map(d => d.name),
    getSubtopics: () => [],
    getDomainColourKey: () => 'corporate',
    formatSubtopic: (s: string) => s,
    formatDomainName: (d: string) => d,
    refresh: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const DOMAIN_UUID = '00000000-0000-4000-8000-000000000001';

const existingTargets: CoverageTargetRow[] = [
  {
    id: '00000000-0000-4000-8000-000000000010',
    domain_id: DOMAIN_UUID,
    metric_name: 'item_count',
    target_value: 10,
    domain_name: 'Compliance',
  },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CoverageTargetEditor', () => {
  const mockOnSave = vi.fn();
  const mockOnOpenChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockOnSave.mockResolvedValue({ success: true });
  });

  function renderEditor(overrides: { targets?: CoverageTargetRow[]; open?: boolean } = {}) {
    return render(
      <CoverageTargetEditor
        open={overrides.open ?? true}
        onOpenChange={mockOnOpenChange}
        targets={overrides.targets ?? existingTargets}
        onSave={mockOnSave}
      />,
    );
  }

  it('renders domain names from taxonomy', () => {
    renderEditor();

    expect(screen.getByText('Compliance')).toBeInTheDocument();
    expect(screen.getByText('HR')).toBeInTheDocument();
  });

  it('renders dialog title and description', () => {
    renderEditor();

    expect(screen.getByText('Coverage Targets')).toBeInTheDocument();
    expect(screen.getByText(/Set coverage targets per domain/)).toBeInTheDocument();
  });

  it('populates inputs from existing targets', () => {
    renderEditor();

    const complianceItemInput = screen.getByLabelText('Compliance Min items') as HTMLInputElement;
    expect(complianceItemInput.value).toBe('10');
  });

  it('leaves empty inputs for domains without targets', () => {
    renderEditor();

    const hrItemInput = screen.getByLabelText('HR Min items') as HTMLInputElement;
    expect(hrItemInput.value).toBe('');
  });

  it('calls onSave with changed values on Save All', async () => {
    renderEditor();

    // Change the Compliance item_count
    const input = screen.getByLabelText('Compliance Min items') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '20' } });

    const saveButton = screen.getByRole('button', { name: /Save All/i });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(mockOnSave).toHaveBeenCalledTimes(1);
    });

    const savedEntries = mockOnSave.mock.calls[0][0];
    const complianceEntry = savedEntries.find(
      (e: { domain_id: string; metric_name: string }) =>
        e.domain_id === DOMAIN_UUID && e.metric_name === 'item_count',
    );
    expect(complianceEntry?.target_value).toBe(20);
  });

  it('excludes empty inputs from save payload', async () => {
    renderEditor({ targets: [] });

    // Set only one value
    const input = screen.getByLabelText('Compliance Min items') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '5' } });

    const saveButton = screen.getByRole('button', { name: /Save All/i });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(mockOnSave).toHaveBeenCalledTimes(1);
    });

    const savedEntries = mockOnSave.mock.calls[0][0];
    // Only the one we filled in should be saved
    expect(savedEntries).toHaveLength(1);
    expect(savedEntries[0].domain_id).toBe(DOMAIN_UUID);
  });

  it('calls onOpenChange(false) on Cancel', () => {
    renderEditor();

    const cancelButton = screen.getByRole('button', { name: /Cancel/i });
    fireEvent.click(cancelButton);

    expect(mockOnOpenChange).toHaveBeenCalledWith(false);
  });

  it('closes dialog on successful save', async () => {
    renderEditor();

    const saveButton = screen.getByRole('button', { name: /Save All/i });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(mockOnOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it('displays error on save failure', async () => {
    mockOnSave.mockResolvedValueOnce({ success: false, error: 'Permission denied' });

    renderEditor();

    const saveButton = screen.getByRole('button', { name: /Save All/i });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Permission denied');
    });
  });

  it('shows error for empty targets save when no values entered', async () => {
    renderEditor({ targets: [] });

    const saveButton = screen.getByRole('button', { name: /Save All/i });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('No valid targets to save');
    });
  });

  it('renders metric column headers', () => {
    renderEditor();

    expect(screen.getByText('Min items')).toBeInTheDocument();
    expect(screen.getByText('Fresh %')).toBeInTheDocument();
    expect(screen.getByText('Max expired')).toBeInTheDocument();
  });

  it('renders all 6 input fields (2 domains x 3 metrics)', () => {
    renderEditor();

    const inputs = screen.getAllByRole('spinbutton');
    expect(inputs).toHaveLength(6);
  });
});
