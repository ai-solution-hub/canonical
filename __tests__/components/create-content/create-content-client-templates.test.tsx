/**
 * CreateContentClient — Template Integration Tests
 *
 * Tests template selector integration within the create content form,
 * including pre-filling form fields, domain validation against taxonomy,
 * and dirty form confirmation dialogs.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mockPush = vi.hoisted(() => vi.fn());
const mockToastSuccess = vi.hoisted(() => vi.fn());
const mockToastError = vi.hoisted(() => vi.fn());
const mockConfirm = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock('next/dynamic', () => ({
  default: () => {
    const ContentEditorStub = ({
      content,
      onChange,
      placeholder,
    }: {
      content: string;
      onChange: (val: string) => void;
      placeholder?: string;
    }) => (
      <textarea
        data-testid="content-editor"
        value={content}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    );
    ContentEditorStub.displayName = 'ContentEditor';
    return ContentEditorStub;
  },
}));

vi.mock('sonner', () => ({
  toast: {
    success: mockToastSuccess,
    error: mockToastError,
  },
}));

vi.mock('@/components/shell/breadcrumb-nav', () => ({
  BreadcrumbNav: ({ title }: { title: string }) => (
    <nav data-testid="breadcrumb">{title}</nav>
  ),
}));

vi.mock('@/contexts/taxonomy-context', () => ({
  useTaxonomy: () => ({
    getDomainNames: () => [
      'Governance & Compliance',
      'Track Record',
      'Company Overview',
      'Technical & Delivery',
    ],
    getSubtopics: () => [],
    formatSubtopic: (name: string) => name,
    formatDomainName: (name: string) => name,
  }),
}));

vi.mock('@/hooks/use-user-role', () => ({
  useUserRole: () => ({
    role: 'viewer',
    canEdit: false,
    canAdmin: false,
    loading: false,
  }),
}));

// Mock the Select component to avoid Radix pointer capture issues in jsdom
vi.mock('@/components/ui/select', () => ({
  Select: ({
    children,
    value,
    onValueChange: _onValueChange,
  }: {
    value: string;
    onValueChange: (val: string) => void;
    children: React.ReactNode;
  }) => (
    <div data-testid="select-wrapper" data-value={value}>
      {children}
    </div>
  ),
  SelectTrigger: ({
    id,
    children,
    className,
    ...props
  }: Record<string, unknown>) => (
    <button
      id={id as string}
      data-testid={`select-trigger-${id}`}
      className={className as string}
      {...props}
    >
      {children as React.ReactNode}
    </button>
  ),
  SelectValue: ({ placeholder }: { placeholder?: string }) => (
    <span>{placeholder}</span>
  ),
  SelectContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SelectItem: ({
    value,
    children,
  }: {
    value: string;
    children: React.ReactNode;
  }) => <div data-testid={`select-item-${value}`}>{children}</div>,
  SelectGroup: ({ children }: { children: React.ReactNode }) => (
    <div role="group">{children}</div>
  ),
  SelectLabel: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

import { CreateContentClient } from '@/app/item/new/create-content-client';
import { within } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function patchJsdom() {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => {};
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {};
  }
}

function renderForm() {
  patchJsdom();
  return render(<CreateContentClient />);
}

/**
 * Get the template selector radiogroup and query within it.
 * This avoids ambiguity with the content type Select dropdown
 * which also renders items like "Case Study", "Capability", etc.
 */
function getTemplateSelector() {
  return within(screen.getByRole('radiogroup'));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CreateContentClient — template integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
    // Default: confirm returns true
    mockConfirm.mockReturnValue(true);
    vi.stubGlobal('confirm', mockConfirm);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('template selector rendering', () => {
    it('renders the template selector on the create page', () => {
      renderForm();

      expect(screen.getByText('Start from a template')).toBeInTheDocument();
    });

    it('renders a Blank option', () => {
      renderForm();

      expect(screen.getByText('Blank')).toBeInTheDocument();
    });

    it('renders all 5 templates from CONTENT_TEMPLATES', () => {
      renderForm();
      const selector = getTemplateSelector();

      expect(selector.getByText('Policy Document')).toBeInTheDocument();
      expect(selector.getByText('Case Study')).toBeInTheDocument();
      expect(selector.getByText('Capability Statement')).toBeInTheDocument();
      expect(selector.getByText('Methodology')).toBeInTheDocument();
      expect(selector.getByText('Q&A Pair')).toBeInTheDocument();
    });

    it('Blank is selected by default', () => {
      renderForm();

      const blankButton = screen.getByText('Blank').closest('button');
      expect(blankButton).toHaveAttribute('aria-checked', 'true');
    });
  });

  describe('template pre-filling', () => {
    it('selecting Policy Document sets content_type to policy', async () => {
      const user = userEvent.setup();
      renderForm();
      const selector = getTemplateSelector();

      await user.click(selector.getByText('Policy Document'));

      // Content type should now be 'policy' — visible in the select wrapper
      await waitFor(() => {
        const selectTrigger = screen.getByTestId('select-trigger-content-type');
        const selectWrapper = selectTrigger.closest(
          '[data-testid="select-wrapper"]',
        );
        expect(selectWrapper).toHaveAttribute('data-value', 'policy');
      });
    });

    it('selecting a template sets content from contentTemplate', async () => {
      const user = userEvent.setup();
      renderForm();
      const selector = getTemplateSelector();

      await user.click(selector.getByText('Policy Document'));

      await waitFor(() => {
        const editor = screen.getByTestId(
          'content-editor',
        ) as HTMLTextAreaElement;
        expect(editor.value).toContain('Policy Statement');
      });
    });

    it('selecting Case Study sets content_type to case_study', async () => {
      const user = userEvent.setup();
      renderForm();
      const selector = getTemplateSelector();

      await user.click(selector.getByText('Case Study'));

      await waitFor(() => {
        const selectTrigger = screen.getByTestId('select-trigger-content-type');
        const selectWrapper = selectTrigger.closest(
          '[data-testid="select-wrapper"]',
        );
        expect(selectWrapper).toHaveAttribute('data-value', 'case_study');
      });
    });

    it('selecting Q&A Pair sets content_type to q_a_pair', async () => {
      const user = userEvent.setup();
      renderForm();
      const selector = getTemplateSelector();

      await user.click(selector.getByText('Q&A Pair'));

      await waitFor(() => {
        const selectTrigger = screen.getByTestId('select-trigger-content-type');
        const selectWrapper = selectTrigger.closest(
          '[data-testid="select-wrapper"]',
        );
        expect(selectWrapper).toHaveAttribute('data-value', 'q_a_pair');
      });
    });

    it('template highlights after selection', async () => {
      const user = userEvent.setup();
      renderForm();
      const selector = getTemplateSelector();

      await user.click(selector.getByText('Policy Document'));

      const policyButton = selector
        .getByText('Policy Document')
        .closest('button');
      expect(policyButton).toHaveAttribute('aria-checked', 'true');

      // Blank should no longer be selected
      const blankButton = selector.getByText('Blank').closest('button');
      expect(blankButton).toHaveAttribute('aria-checked', 'false');
    });
  });

  describe('domain suggestion validation against taxonomy', () => {
    it('sets primary_domain when suggestedDomain matches active taxonomy', async () => {
      const user = userEvent.setup();
      renderForm();
      const selector = getTemplateSelector();

      // Policy template has suggestedDomain: 'Governance & Compliance'
      // which is in our mock taxonomy
      await user.click(selector.getByText('Policy Document'));

      // The "More details" section should auto-expand when domain is set
      await waitFor(() => {
        const toggle = screen.getByText(
          'Classification, tags, and source info',
        );
        expect(toggle).toHaveAttribute('aria-expanded', 'true');
      });
    });

    it('auto-expands "More details" when template has a valid domain suggestion', async () => {
      const user = userEvent.setup();
      renderForm();
      const selector = getTemplateSelector();

      // Case Study has suggestedDomain: 'Track Record' — in our mock taxonomy
      await user.click(selector.getByText('Case Study'));

      await waitFor(() => {
        const toggle = screen.getByText(
          'Classification, tags, and source info',
        );
        expect(toggle).toHaveAttribute('aria-expanded', 'true');
      });
    });
  });

  describe('Blank selection resets', () => {
    it('selecting Blank after a template resets to CREATE_CONTENT_DEFAULTS', async () => {
      const user = userEvent.setup();
      renderForm();
      const selector = getTemplateSelector();

      // First select a template
      await user.click(selector.getByText('Policy Document'));

      await waitFor(() => {
        const editor = screen.getByTestId(
          'content-editor',
        ) as HTMLTextAreaElement;
        expect(editor.value).toContain('Policy Statement');
      });

      // Reset confirm for the dirty form
      mockConfirm.mockReturnValue(true);

      // Then select Blank
      await user.click(selector.getByText('Blank'));

      await waitFor(() => {
        const editor = screen.getByTestId(
          'content-editor',
        ) as HTMLTextAreaElement;
        expect(editor.value).toBe('');
      });
    });
  });

  describe('dirty form confirmation', () => {
    it('shows confirmation when form is dirty and user selects a template', async () => {
      const user = userEvent.setup();
      renderForm();

      // Make the form dirty by typing in the title
      const titleInput = screen.getByLabelText(/Title/i);
      await user.type(titleInput, 'Some title');

      // Now select a template
      const selector = getTemplateSelector();
      await user.click(selector.getByText('Policy Document'));

      expect(mockConfirm).toHaveBeenCalledWith(
        'Selecting a template will replace your current content. Continue?',
      );
    });

    it('does not apply template when user cancels the confirmation', async () => {
      const user = userEvent.setup();
      renderForm();
      const selector = getTemplateSelector();

      // Make the form dirty
      const titleInput = screen.getByLabelText(/Title/i);
      await user.type(titleInput, 'Some title');

      // User cancels
      mockConfirm.mockReturnValue(false);

      await user.click(selector.getByText('Policy Document'));

      // Content should not have been replaced
      await waitFor(() => {
        const editor = screen.getByTestId(
          'content-editor',
        ) as HTMLTextAreaElement;
        expect(editor.value).toBe('');
      });

      // Template should not be selected
      const policyButton = selector
        .getByText('Policy Document')
        .closest('button');
      expect(policyButton).toHaveAttribute('aria-checked', 'false');
    });

    it('applies template when user confirms', async () => {
      const user = userEvent.setup();
      renderForm();
      const selector = getTemplateSelector();

      // Make the form dirty
      const titleInput = screen.getByLabelText(/Title/i);
      await user.type(titleInput, 'Some title');

      // User confirms
      mockConfirm.mockReturnValue(true);

      await user.click(selector.getByText('Case Study'));

      await waitFor(() => {
        const editor = screen.getByTestId(
          'content-editor',
        ) as HTMLTextAreaElement;
        expect(editor.value).toContain('Client and Context');
      });
    });

    it('does not show confirmation when form is clean', async () => {
      const user = userEvent.setup();
      renderForm();
      const selector = getTemplateSelector();

      // Select a template on clean form
      await user.click(selector.getByText('Policy Document'));

      expect(mockConfirm).not.toHaveBeenCalled();
    });
  });

  describe('template selector position in form', () => {
    it('template selector appears before the title field', () => {
      renderForm();

      const templateLabel = screen.getByText('Start from a template');
      const titleLabel = screen.getByText(/Title/);

      // Template selector should appear before title in the DOM
      const allElements = document.querySelectorAll('[class]');
      let templateIndex = -1;
      let titleIndex = -1;

      allElements.forEach((el, idx) => {
        if (el.contains(templateLabel)) templateIndex = idx;
        if (el.contains(titleLabel) && !el.contains(templateLabel))
          titleIndex = idx;
      });

      // Template selector should come first
      expect(templateIndex).toBeLessThan(titleIndex);
    });
  });
});
