/**
 * RequirementCatalogueEditor tests (ID-147 {147.16} — TECH §7/§H1,
 * PRODUCT §H1/§H3/§H4; ID-145 BI-24/BI-47).
 *
 * Acceptance (testStrategy): the editor exposes every form_requirement_templates
 * domain field and persists via TanStack mutation; Schema Builder is not
 * present in the surface; create/edit is admin/editor-gated (reviewer/viewer
 * read-only).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

// ---------------------------------------------------------------------------
// vi.hoisted() — mocks referenced in vi.mock() factories
// ---------------------------------------------------------------------------

const { mockUseUserRole, mockUseRequirementTemplates, mockMutateAsync } =
  vi.hoisted(() => ({
    mockUseUserRole: vi.fn(),
    mockUseRequirementTemplates: vi.fn(),
    mockMutateAsync: vi.fn(),
  }));

vi.mock('@/hooks/use-user-role', () => ({
  useUserRole: () => mockUseUserRole(),
}));

vi.mock('@/lib/query/requirement-catalogue', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/query/requirement-catalogue')
  >('@/lib/query/requirement-catalogue');
  return {
    ...actual,
    useRequirementTemplates: () => mockUseRequirementTemplates(),
    useSaveRequirementTemplate: () => ({
      mutateAsync: mockMutateAsync,
      isPending: false,
    }),
  };
});

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// Radix Select/Switch don't reliably support pointer-capture interactions in
// jsdom — stub them to plain, testable form controls (established pattern:
// __tests__/components/feed-source-form.test.tsx).
vi.mock('@/components/ui/select', () => ({
  Select: ({
    children,
    value,
    onValueChange,
  }: {
    children: React.ReactNode;
    value?: string;
    onValueChange?: (v: string) => void;
  }) => (
    <select
      aria-label="Requirement type"
      value={value}
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

vi.mock('@/components/ui/switch', () => ({
  Switch: ({
    checked,
    onCheckedChange,
    id,
  }: {
    checked?: boolean;
    onCheckedChange?: (v: boolean) => void;
    id?: string;
  }) => (
    <input
      type="checkbox"
      id={id}
      role="switch"
      checked={checked}
      onChange={(e) => onCheckedChange?.(e.target.checked)}
    />
  ),
}));

import { RequirementCatalogueEditor } from '@/components/procurement/requirement-catalogue-editor';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function configureRole(role: 'admin' | 'editor' | 'viewer') {
  mockUseUserRole.mockReturnValue({
    role,
    canEdit: role === 'admin' || role === 'editor',
    canAdmin: role === 'admin',
    loading: false,
  });
}

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'row-1',
    template_name: 'Standard PSQ',
    template_version: 'v1',
    template_type: 'PSQ',
    section_ref: '3.2',
    section_name: 'Health and Safety',
    question_number: 4,
    requirement_text: 'Describe your H&S policy.',
    description: null,
    requirement_type: 'policy',
    primary_domain: 'Health & Safety',
    primary_subtopic: 'Policy',
    secondary_domain: null,
    secondary_subtopic: null,
    matching_keywords: ['safety', 'RIDDOR'],
    matching_guidance: 'Match on policy documents',
    is_mandatory: true,
    is_current: true,
    sector_applicability: ['construction'],
    word_limit_guidance: 250,
    display_order: 0,
    created_at: '2026-07-01T08:00:00Z',
    updated_at: '2026-07-01T08:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseRequirementTemplates.mockReturnValue({
    data: [makeRow()],
    isLoading: false,
  });
});

describe('RequirementCatalogueEditor — role gate (BI-47/§H3)', () => {
  it('hides Add Requirement and per-row Edit for a viewer (read-only)', () => {
    configureRole('viewer');
    render(<RequirementCatalogueEditor />);

    expect(
      screen.queryByRole('button', { name: /add requirement/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /edit/i }),
    ).not.toBeInTheDocument();
    // The list itself is still visible read-only.
    expect(screen.getByText('Standard PSQ')).toBeInTheDocument();
  });

  it('shows Add Requirement and per-row Edit for an editor', () => {
    configureRole('editor');
    render(<RequirementCatalogueEditor />);

    expect(
      screen.getByRole('button', { name: /add requirement/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /edit standard psq/i }),
    ).toBeInTheDocument();
  });

  it('shows Add Requirement and per-row Edit for an admin', () => {
    configureRole('admin');
    render(<RequirementCatalogueEditor />);

    expect(
      screen.getByRole('button', { name: /add requirement/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /edit standard psq/i }),
    ).toBeInTheDocument();
  });
});

describe('RequirementCatalogueEditor — Schema Builder never presented (§H4/DR-065)', () => {
  it('does not render any Schema Builder affordance', () => {
    configureRole('admin');
    render(<RequirementCatalogueEditor />);

    expect(screen.queryByText(/schema builder/i)).not.toBeInTheDocument();
  });
});

describe('RequirementCatalogueEditor — list rendering', () => {
  it('shows the empty state when there are no catalogue rows', () => {
    configureRole('viewer');
    mockUseRequirementTemplates.mockReturnValue({ data: [], isLoading: false });
    render(<RequirementCatalogueEditor />);

    expect(
      screen.getByText(/no catalogue requirements yet/i),
    ).toBeInTheDocument();
  });

  it('shows a loading state while the list query is pending', () => {
    configureRole('viewer');
    mockUseRequirementTemplates.mockReturnValue({
      data: undefined,
      isLoading: true,
    });
    const { container } = render(<RequirementCatalogueEditor />);

    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('shows a distinct error state (not the empty state) and toasts when the fetch fails', async () => {
    configureRole('viewer');
    mockUseRequirementTemplates.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('network unreachable'),
    });
    render(<RequirementCatalogueEditor />);

    expect(
      screen.getByText(/failed to load the requirement catalogue/i),
    ).toBeInTheDocument();
    expect(screen.getByText('network unreachable')).toBeInTheDocument();
    // Must NOT be masked as the empty state.
    expect(
      screen.queryByText(/no catalogue requirements yet/i),
    ).not.toBeInTheDocument();

    const { toast } = await import('sonner');
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('network unreachable'),
    );
  });

  it('renders row fields: requirement text, type badge, domain/subtopic, mandatory flag', () => {
    configureRole('viewer');
    render(<RequirementCatalogueEditor />);

    expect(screen.getByText('Describe your H&S policy.')).toBeInTheDocument();
    expect(screen.getByText('policy')).toBeInTheDocument();
    expect(screen.getByText('Health & Safety / Policy')).toBeInTheDocument();
    // "Mandatory" also appears as the column header — scope to the row cell.
    expect(screen.getByText('Standard PSQ').closest('table')).toHaveTextContent(
      /Mandatory/,
    );
    expect(screen.getAllByText('Mandatory').length).toBeGreaterThanOrEqual(2);
  });
});

describe('RequirementCatalogueEditor — form exposes every domain field (§H1)', () => {
  it('renders the Add Requirement form with every domain + identification field', async () => {
    configureRole('admin');
    const user = userEvent.setup();
    render(<RequirementCatalogueEditor />);

    await user.click(screen.getByRole('button', { name: /add requirement/i }));

    // Identification
    expect(screen.getByLabelText(/template name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/template version/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/template type/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/question number/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/section ref/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/section name/i)).toBeInTheDocument();

    // Requirement
    expect(screen.getByLabelText(/requirement text/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^description$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/requirement type/i)).toBeInTheDocument();

    // Domain/subtopic classification
    expect(screen.getByLabelText(/primary domain/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/primary subtopic/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/secondary domain/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/secondary subtopic/i)).toBeInTheDocument();

    // Matching
    expect(screen.getByLabelText(/matching keywords/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/matching guidance/i)).toBeInTheDocument();

    // Constraints
    expect(screen.getByLabelText(/word limit guidance/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/display order/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/sector applicability/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^mandatory$/i)).toBeInTheDocument();
    expect(
      screen.getByLabelText(/current \(visible for matching\)/i),
    ).toBeInTheDocument();
  });

  it('pre-fills the form with the row values when editing', async () => {
    configureRole('editor');
    const user = userEvent.setup();
    render(<RequirementCatalogueEditor />);

    await user.click(
      screen.getByRole('button', { name: /edit standard psq/i }),
    );

    expect(screen.getByLabelText(/template name/i)).toHaveValue('Standard PSQ');
    expect(screen.getByLabelText(/requirement text/i)).toHaveValue(
      'Describe your H&S policy.',
    );
    expect(screen.getByLabelText(/matching keywords/i)).toHaveValue(
      'safety, RIDDOR',
    );
    expect(screen.getByLabelText(/^mandatory$/i)).toBeChecked();
  });
});

describe('RequirementCatalogueEditor — persists via TanStack mutation', () => {
  it('calls the save mutation with every field on create, then closes the form', async () => {
    configureRole('admin');
    mockMutateAsync.mockResolvedValue(makeRow());
    const user = userEvent.setup();
    render(<RequirementCatalogueEditor />);

    await user.click(screen.getByRole('button', { name: /add requirement/i }));

    await user.type(screen.getByLabelText(/template name/i), 'New Template');
    await user.type(screen.getByLabelText(/template type/i), 'ITT');
    await user.type(screen.getByLabelText(/section ref/i), '5.1');
    await user.type(screen.getByLabelText(/section name/i), 'Quality');
    await user.type(
      screen.getByLabelText(/requirement text/i),
      'Describe your quality management system.',
    );
    await user.type(
      screen.getByLabelText(/matching keywords/i),
      'quality, ISO 9001',
    );

    await user.click(
      screen.getByRole('button', { name: /^save requirement$/i }),
    );

    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledTimes(1));
    const call = mockMutateAsync.mock.calls[0][0];
    expect(call.id).toBeUndefined();
    expect(call.values).toMatchObject({
      template_name: 'New Template',
      template_type: 'ITT',
      section_ref: '5.1',
      section_name: 'Quality',
      requirement_text: 'Describe your quality management system.',
      matching_keywords: ['quality', 'ISO 9001'],
      is_mandatory: true,
      is_current: true,
    });

    await waitFor(() =>
      expect(
        screen.queryByRole('form', { name: /add requirement/i }),
      ).not.toBeInTheDocument(),
    );
  });

  it('calls the save mutation with the row id on update', async () => {
    configureRole('admin');
    mockMutateAsync.mockResolvedValue(makeRow());
    const user = userEvent.setup();
    render(<RequirementCatalogueEditor />);

    await user.click(
      screen.getByRole('button', { name: /edit standard psq/i }),
    );
    await user.click(
      screen.getByRole('button', { name: /update requirement/i }),
    );

    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledTimes(1));
    expect(mockMutateAsync.mock.calls[0][0].id).toBe('row-1');
  });

  it('disables the submit button until the required fields are filled', async () => {
    configureRole('admin');
    const user = userEvent.setup();
    render(<RequirementCatalogueEditor />);

    await user.click(screen.getByRole('button', { name: /add requirement/i }));

    expect(
      screen.getByRole('button', { name: /^save requirement$/i }),
    ).toBeDisabled();
  });
});
