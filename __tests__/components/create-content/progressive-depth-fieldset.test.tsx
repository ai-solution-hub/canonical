/**
 * ProgressiveDepthFieldset Component Tests
 *
 * Tests the progressive depth fieldset — brief, detail, and reference textareas,
 * character counts, maxLength, onChange handlers, and label associations.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ProgressiveDepthFieldset } from '@/components/create-content/progressive-depth-fieldset';
import type { ProgressiveDepthFieldsetProps } from '@/components/create-content/progressive-depth-fieldset';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createDefaultProps(overrides: Partial<ProgressiveDepthFieldsetProps> = {}): ProgressiveDepthFieldsetProps {
  return {
    brief: '',
    setBrief: vi.fn(),
    detail: '',
    setDetail: vi.fn(),
    reference: '',
    setReference: vi.fn(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ProgressiveDepthFieldset', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('renders brief, detail, and reference textareas', () => {
    render(<ProgressiveDepthFieldset {...createDefaultProps()} />);
    expect(screen.getByLabelText('Brief (executive summary)')).toBeInTheDocument();
    expect(screen.getByLabelText('Detail (expanded explanation)')).toBeInTheDocument();
    expect(screen.getByLabelText('Reference (technical/source detail)')).toBeInTheDocument();
  });

  it('shows character counts for each textarea', () => {
    render(
      <ProgressiveDepthFieldset
        {...createDefaultProps({
          brief: 'Hello',
          detail: 'World here',
          reference: '',
        })}
      />,
    );
    expect(screen.getByText('5 / 5,000')).toBeInTheDocument();
    expect(screen.getByText('10 / 50,000')).toBeInTheDocument();
    expect(screen.getByText('0 / 50,000')).toBeInTheDocument();
  });

  it('textareas have correct maxLength attributes', () => {
    render(<ProgressiveDepthFieldset {...createDefaultProps()} />);
    expect(screen.getByLabelText('Brief (executive summary)')).toHaveAttribute('maxlength', '5000');
    expect(screen.getByLabelText('Detail (expanded explanation)')).toHaveAttribute('maxlength', '50000');
    expect(screen.getByLabelText('Reference (technical/source detail)')).toHaveAttribute('maxlength', '50000');
  });

  it('onChange calls correct setter', async () => {
    const setBrief = vi.fn();
    const user = userEvent.setup();
    render(<ProgressiveDepthFieldset {...createDefaultProps({ setBrief })} />);
    const briefInput = screen.getByLabelText('Brief (executive summary)');
    await user.type(briefInput, 'A');
    expect(setBrief).toHaveBeenCalled();
  });

  it('labels match htmlFor attributes', () => {
    render(<ProgressiveDepthFieldset {...createDefaultProps()} />);
    // Check that clicking the label focuses the corresponding textarea
    const briefLabel = screen.getByText(/Brief \(executive summary\)/i);
    expect(briefLabel).toHaveAttribute('for', 'brief');

    const detailLabel = screen.getByText(/Detail \(expanded explanation\)/i);
    expect(detailLabel).toHaveAttribute('for', 'detail');

    const refLabel = screen.getByText(/Reference \(technical\/source detail\)/i);
    expect(refLabel).toHaveAttribute('for', 'reference');
  });
});
