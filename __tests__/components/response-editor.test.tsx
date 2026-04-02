/**
 * ResponseEditor Component Tests
 *
 * Tests the rich text editor wrapper — rendering, word count display,
 * save button, read-only mode, and word limit indicators.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// vi.hoisted() — mocks referenced in vi.mock() factories
// ---------------------------------------------------------------------------

const { mockEditor, mockUseEditor } = vi.hoisted(() => {
  const editor = {
    getHTML: vi.fn(() => '<p>Test content</p>'),
    setEditable: vi.fn(),
    isEditable: true,
    commands: {
      setContent: vi.fn(),
    },
    storage: {
      characterCount: {
        words: vi.fn(() => 42),
      },
    },
  };

  return {
    mockEditor: editor,
    mockUseEditor: vi.fn(() => editor),
  };
});

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('@tiptap/react', () => ({
  useEditor: (...args: unknown[]) => mockUseEditor(...args),
  EditorContent: ({ editor }: { editor: unknown }) => (
    <div data-testid="editor-content">
      {editor ? 'Editor loaded' : 'No editor'}
    </div>
  ),
}));

vi.mock('@tiptap/starter-kit', () => ({
  default: { configure: vi.fn(() => 'StarterKit') },
}));

vi.mock('@tiptap/extension-character-count', () => ({
  default: { configure: vi.fn(() => 'CharacterCount') },
}));

vi.mock('@tiptap/extension-placeholder', () => ({
  default: { configure: vi.fn(() => 'Placeholder') },
}));

vi.mock('@tiptap/extension-underline', () => ({
  default: 'UnderlineExt',
}));

vi.mock('@tiptap/extension-link', () => ({
  default: { configure: vi.fn(() => 'LinkExt') },
}));

vi.mock('@/components/item-detail/editor-toolbar', () => ({
  EditorToolbar: ({ editor }: { editor: unknown }) => (
    <div data-testid="editor-toolbar">{editor ? 'Toolbar' : 'No toolbar'}</div>
  ),
}));

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

// Import AFTER mocks
import { ResponseEditor } from '@/components/bid/response-editor';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function defaultProps(
  overrides: Partial<Parameters<typeof ResponseEditor>[0]> = {},
) {
  return {
    content: '<p>Test content</p>',
    onChange: vi.fn(),
    onSave: vi.fn(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ResponseEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEditor.storage.characterCount.words.mockReturnValue(42);
    mockEditor.getHTML.mockReturnValue('<p>Test content</p>');
    mockEditor.isEditable = true;
    mockUseEditor.mockReturnValue(mockEditor);
  });

  // ---- Basic rendering ----

  it('renders the editor content area', () => {
    render(<ResponseEditor {...defaultProps()} />);
    expect(screen.getByTestId('editor-content')).toBeInTheDocument();
  });

  it('renders the toolbar when not read-only', () => {
    render(<ResponseEditor {...defaultProps()} />);
    expect(screen.getByTestId('editor-toolbar')).toBeInTheDocument();
  });

  it('hides the toolbar when read-only', () => {
    render(<ResponseEditor {...defaultProps({ readOnly: true })} />);
    expect(screen.queryByTestId('editor-toolbar')).not.toBeInTheDocument();
  });

  it('renders the save button when not read-only', () => {
    render(<ResponseEditor {...defaultProps()} />);
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  it('hides the save button when read-only', () => {
    render(<ResponseEditor {...defaultProps({ readOnly: true })} />);
    expect(
      screen.queryByRole('button', { name: 'Save' }),
    ).not.toBeInTheDocument();
  });

  // ---- Word count display ----

  it('displays the current word count', () => {
    render(<ResponseEditor {...defaultProps()} />);
    expect(screen.getByRole('status')).toHaveTextContent('42');
  });

  it('displays word count with limit when wordLimit is provided', () => {
    render(<ResponseEditor {...defaultProps({ wordLimit: 100 })} />);
    expect(screen.getByRole('status')).toHaveTextContent('42 / 100 words');
  });

  it('displays word count without limit format when wordLimit is null', () => {
    render(<ResponseEditor {...defaultProps({ wordLimit: null })} />);
    expect(screen.getByRole('status')).toHaveTextContent('42 words');
  });

  it('shows "over limit" when word count exceeds limit', () => {
    mockEditor.storage.characterCount.words.mockReturnValue(150);
    render(<ResponseEditor {...defaultProps({ wordLimit: 100 })} />);
    expect(screen.getByRole('status')).toHaveTextContent('over limit');
  });

  it('shows percentage when word count is under 70% of target', () => {
    mockEditor.storage.characterCount.words.mockReturnValue(50);
    render(<ResponseEditor {...defaultProps({ wordLimit: 100 })} />);
    expect(screen.getByRole('status')).toHaveTextContent('50% of target');
  });

  it('does not show percentage or over-limit when within normal range', () => {
    mockEditor.storage.characterCount.words.mockReturnValue(80);
    render(<ResponseEditor {...defaultProps({ wordLimit: 100 })} />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('80 / 100 words');
    expect(status).not.toHaveTextContent('over limit');
    expect(status).not.toHaveTextContent('of target');
  });

  // ---- Zero word count ----

  it('displays zero word count when editor has no content', () => {
    mockEditor.storage.characterCount.words.mockReturnValue(0);
    render(<ResponseEditor {...defaultProps()} />);
    expect(screen.getByRole('status')).toHaveTextContent('0');
  });

  // ---- Save interaction ----

  it('calls onSave with editor HTML when save button is clicked', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<ResponseEditor {...defaultProps({ onSave })} />);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith('<p>Test content</p>');
  });

  it('calls onSave with empty string when editor is null', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    mockUseEditor.mockReturnValue(null);
    render(<ResponseEditor {...defaultProps({ onSave })} />);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith('');
  });

  // ---- Null editor state ----

  it('renders gracefully when editor is null', () => {
    mockUseEditor.mockReturnValue(null);
    render(<ResponseEditor {...defaultProps()} />);
    expect(screen.getByTestId('editor-content')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('0 words');
  });

  // ---- Custom className ----

  it('applies custom className to the container', () => {
    const { container } = render(
      <ResponseEditor {...defaultProps({ className: 'my-custom-class' })} />,
    );
    expect(container.firstChild).toHaveClass('my-custom-class');
  });

  // ---- Accessibility ----

  it('has an aria-live polite status for word count', () => {
    render(<ResponseEditor {...defaultProps()} />);
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
  });

  // ---- useEditor configuration ----

  it('calls useEditor with readOnly false by default', () => {
    render(<ResponseEditor {...defaultProps()} />);
    expect(mockUseEditor).toHaveBeenCalled();
    const callArgs = mockUseEditor.mock.calls[0][0] as { editable: boolean };
    expect(callArgs.editable).toBe(true);
  });

  it('calls useEditor with readOnly true when readOnly prop is set', () => {
    render(<ResponseEditor {...defaultProps({ readOnly: true })} />);
    expect(mockUseEditor).toHaveBeenCalled();
    const callArgs = mockUseEditor.mock.calls[0][0] as { editable: boolean };
    expect(callArgs.editable).toBe(false);
  });

  // ---- onEditorReady callback ----

  it('calls onEditorReady with editor instance on mount', () => {
    const onEditorReady = vi.fn();
    render(<ResponseEditor {...defaultProps({ onEditorReady })} />);
    expect(onEditorReady).toHaveBeenCalledWith(mockEditor);
  });

  it('does not call onEditorReady when prop is not provided', () => {
    // Should render without error when onEditorReady is omitted
    expect(() => render(<ResponseEditor {...defaultProps()} />)).not.toThrow();
    expect(screen.getByTestId('editor-content')).toBeInTheDocument();
  });

  it('does not call onEditorReady when editor is null', () => {
    mockUseEditor.mockReturnValue(null);
    const onEditorReady = vi.fn();
    render(<ResponseEditor {...defaultProps({ onEditorReady })} />);
    expect(onEditorReady).not.toHaveBeenCalled();
  });

  // ---- Ctrl+S / Cmd+S save shortcut ----

  it('triggers save on Ctrl+S keydown', () => {
    const onSave = vi.fn();
    render(<ResponseEditor {...defaultProps({ onSave })} />);
    fireEvent.keyDown(document, { key: 's', ctrlKey: true });
    expect(onSave).toHaveBeenCalledWith('<p>Test content</p>');
  });

  it('triggers save on Cmd+S (metaKey) keydown', () => {
    const onSave = vi.fn();
    render(<ResponseEditor {...defaultProps({ onSave })} />);
    fireEvent.keyDown(document, { key: 's', metaKey: true });
    expect(onSave).toHaveBeenCalledWith('<p>Test content</p>');
  });

  it('does not trigger save on Ctrl+S when readOnly', () => {
    const onSave = vi.fn();
    render(<ResponseEditor {...defaultProps({ onSave, readOnly: true })} />);
    fireEvent.keyDown(document, { key: 's', ctrlKey: true });
    expect(onSave).not.toHaveBeenCalled();
  });

  it('does not trigger save on Ctrl+S when editor is null', () => {
    mockUseEditor.mockReturnValue(null);
    const onSave = vi.fn();
    render(<ResponseEditor {...defaultProps({ onSave })} />);
    fireEvent.keyDown(document, { key: 's', ctrlKey: true });
    expect(onSave).not.toHaveBeenCalled();
  });

  // ---- Content sync from parent ----

  it('syncs content from parent when content prop changes', () => {
    mockEditor.getHTML.mockReturnValue('<p>Old content</p>');
    const { rerender } = render(
      <ResponseEditor {...defaultProps({ content: '<p>Old content</p>' })} />,
    );
    vi.clearAllMocks();
    mockEditor.getHTML.mockReturnValue('<p>Old content</p>');
    rerender(
      <ResponseEditor {...defaultProps({ content: '<p>New content</p>' })} />,
    );
    expect(mockEditor.commands.setContent).toHaveBeenCalledWith(
      '<p>New content</p>',
    );
  });

  it('does not sync content when prop matches editor HTML', () => {
    mockEditor.getHTML.mockReturnValue('<p>Same content</p>');
    const { rerender } = render(
      <ResponseEditor {...defaultProps({ content: '<p>Same content</p>' })} />,
    );
    vi.clearAllMocks();
    mockEditor.getHTML.mockReturnValue('<p>Same content</p>');
    rerender(
      <ResponseEditor {...defaultProps({ content: '<p>Same content</p>' })} />,
    );
    expect(mockEditor.commands.setContent).not.toHaveBeenCalled();
  });

  // ---- Editable state sync ----

  it('syncs editable state when readOnly prop changes', () => {
    mockEditor.isEditable = true;
    const { rerender } = render(
      <ResponseEditor {...defaultProps({ readOnly: false })} />,
    );
    vi.clearAllMocks();
    // isEditable is still true but readOnly is now true, so editor.isEditable === readOnly (true === true)
    mockEditor.isEditable = true;
    rerender(<ResponseEditor {...defaultProps({ readOnly: true })} />);
    expect(mockEditor.setEditable).toHaveBeenCalledWith(false);
  });

  // ---- onChange via onUpdate ----

  it('fires onChange callback via onUpdate', () => {
    const onChange = vi.fn();
    render(<ResponseEditor {...defaultProps({ onChange })} />);
    const config = mockUseEditor.mock.calls[0][0] as {
      onUpdate: (args: { editor: { getHTML: () => string } }) => void;
    };
    config.onUpdate({ editor: { getHTML: () => '<p>Updated</p>' } });
    expect(onChange).toHaveBeenCalledWith('<p>Updated</p>');
  });

  // ---- Placeholder extension ----

  it('passes placeholder to useEditor extensions', async () => {
    const PlaceholderMock = await import('@tiptap/extension-placeholder');
    vi.clearAllMocks();
    render(
      <ResponseEditor
        {...defaultProps({ placeholder: 'Custom placeholder text' })}
      />,
    );
    expect(PlaceholderMock.default.configure).toHaveBeenCalledWith({
      placeholder: 'Custom placeholder text',
    });
  });
});
