/**
 * ClassificationFieldset Component Tests
 *
 * Tests the classification fieldset — domain select, subtopic select,
 * keywords input, enter key prevention, and domain change handler.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ConceptHelp renders a Radix Tooltip which needs a TooltipProvider.
// Stub it to avoid wiring one up across every render call.
vi.mock('@/components/ui/concept-help', () => ({
  ConceptHelp: ({ concept }: { concept: string }) => (
    <span data-testid={`concept-help-${concept}`} />
  ),
}));

import { ClassificationFieldset } from '@/components/create-content/classification-fieldset';
import type { ClassificationFieldsetProps } from '@/components/create-content/classification-fieldset';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createDefaultProps(
  overrides: Partial<ClassificationFieldsetProps> = {},
): ClassificationFieldsetProps {
  return {
    primaryDomain: '',
    setPrimaryDomain: vi.fn(),
    primarySubtopic: '',
    setPrimarySubtopic: vi.fn(),
    keywordsInput: '',
    setKeywordsInput: vi.fn(),
    domainNames: ['Corporate', 'Technical', 'Commercial'],
    subtopicNames: ['Company History', 'Infrastructure'],
    formatDomainName: (name: string) => name,
    formatSubtopic: (name: string) => name,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ClassificationFieldset', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders domain select with trigger', () => {
    render(<ClassificationFieldset {...createDefaultProps()} />);
    expect(screen.getByLabelText('Domain')).toBeInTheDocument();
  });

  it('renders subtopic select (disabled when no domain)', () => {
    render(
      <ClassificationFieldset {...createDefaultProps({ primaryDomain: '' })} />,
    );
    // The subtopic trigger should be disabled when no domain is selected
    const subtopicTrigger = screen.getByLabelText('Subtopic');
    expect(subtopicTrigger).toBeDisabled();
  });

  it('renders keywords input', () => {
    render(<ClassificationFieldset {...createDefaultProps()} />);
    expect(screen.getByLabelText(/Keywords/i)).toBeInTheDocument();
  });

  it('enter key is prevented on keywords input', async () => {
    const user = userEvent.setup();
    const mockSubmit = vi.fn();

    render(
      <form onSubmit={mockSubmit}>
        <ClassificationFieldset {...createDefaultProps()} />
      </form>,
    );
    const input = screen.getByLabelText(/Keywords/i);
    await user.click(input);
    await user.keyboard('{Enter}');
    // Form should not submit because Enter is prevented
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it('subtopic select is enabled after domain selection', () => {
    render(
      <ClassificationFieldset
        {...createDefaultProps({ primaryDomain: 'Corporate' })}
      />,
    );
    const subtopicTrigger = screen.getByLabelText('Subtopic');
    expect(subtopicTrigger).not.toBeDisabled();
  });

  it('renders classification legend', () => {
    render(<ClassificationFieldset {...createDefaultProps()} />);
    expect(screen.getByText('Classification')).toBeInTheDocument();
  });
});
