/**
 * ProvenanceFieldset Component Tests
 *
 * Tests the provenance fieldset — author/source URL inputs, tag management
 * (add, remove, duplicate prevention), and priority radio group.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ProvenanceFieldset } from '@/components/create-content/provenance-fieldset';
import type { ProvenanceFieldsetProps } from '@/components/create-content/provenance-fieldset';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createDefaultProps(
  overrides: Partial<ProvenanceFieldsetProps> = {},
): ProvenanceFieldsetProps {
  return {
    authorName: '',
    setAuthorName: vi.fn(),
    sourceUrl: '',
    setSourceUrl: vi.fn(),
    tags: [],
    setTags: vi.fn(),
    tagsInput: '',
    setTagsInput: vi.fn(),
    priority: '',
    setPriority: vi.fn(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ProvenanceFieldset', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders author and source URL inputs', () => {
    render(<ProvenanceFieldset {...createDefaultProps()} />);
    expect(screen.getByLabelText('Author')).toBeInTheDocument();
    expect(screen.getByLabelText('Source URL')).toBeInTheDocument();
  });

  it('renders tag badges for existing tags', () => {
    render(
      <ProvenanceFieldset
        {...createDefaultProps({ tags: ['compliance', 'security'] })}
      />,
    );
    expect(screen.getByText('compliance')).toBeInTheDocument();
    expect(screen.getByText('security')).toBeInTheDocument();
  });

  it('enter key adds new tag', async () => {
    const setTags = vi.fn();
    const setTagsInput = vi.fn();
    const user = userEvent.setup();
    render(
      <ProvenanceFieldset
        {...createDefaultProps({
          tags: ['existing'],
          setTags,
          setTagsInput,
          tagsInput: 'new-tag',
        })}
      />,
    );
    const tagsInput = screen.getByPlaceholderText('Add tag and press Enter...');
    await user.type(tagsInput, '{Enter}');
    expect(setTags).toHaveBeenCalledWith(['existing', 'new-tag']);
    expect(setTagsInput).toHaveBeenCalledWith('');
  });

  it('remove button removes tag', async () => {
    const setTags = vi.fn();
    const user = userEvent.setup();
    render(
      <ProvenanceFieldset
        {...createDefaultProps({
          tags: ['compliance', 'security'],
          setTags,
        })}
      />,
    );
    await user.click(screen.getByLabelText('Remove tag compliance'));
    expect(setTags).toHaveBeenCalledWith(['security']);
  });

  it('renders priority radio group', () => {
    render(<ProvenanceFieldset {...createDefaultProps()} />);
    expect(
      screen.getByRole('radiogroup', { name: 'Priority' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('None')).toBeInTheDocument();
    expect(screen.getByLabelText('High')).toBeInTheDocument();
    expect(screen.getByLabelText('Medium')).toBeInTheDocument();
    expect(screen.getByLabelText('Low')).toBeInTheDocument();
  });

  it('priority "None" option works', async () => {
    const setPriority = vi.fn();
    const user = userEvent.setup();
    render(
      <ProvenanceFieldset
        {...createDefaultProps({ priority: 'high', setPriority })}
      />,
    );
    await user.click(screen.getByLabelText('None'));
    expect(setPriority).toHaveBeenCalledWith('');
  });

  it('prevents duplicate tags', async () => {
    const setTags = vi.fn();
    const user = userEvent.setup();
    render(
      <ProvenanceFieldset
        {...createDefaultProps({
          tags: ['existing'],
          setTags,
          tagsInput: 'existing',
        })}
      />,
    );
    const tagsInput = screen.getByPlaceholderText('Add tag and press Enter...');
    await user.type(tagsInput, '{Enter}');
    expect(setTags).not.toHaveBeenCalled();
  });
});
