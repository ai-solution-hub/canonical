/**
 * ContentEditor tests — WP1 + WP1-fix S169.
 *
 * Covers:
 *   1. Tiptap table-extension registration (the P0 data-loss fix where GFM
 *      tables were silently dropped on save because the schema had no
 *      `table`/`tableRow`/`tableCell`/`tableHeader` nodes). Reproducer item:
 *      08726af7-27ec-4540-bf24-9f8332f22b17.
 *   2. Cmd+S save-safety guard integration (the guard helper itself is unit
 *      tested in `__tests__/lib/editor/save-safety.test.ts`).
 *
 * Schema + round-trip suites instantiate a real Tiptap `Editor` using the
 * exported `buildExtensions()` from the production component — a single
 * source of truth so the tests can't drift from what ships.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { Editor, type JSONContent } from '@tiptap/core';

import {
  ContentEditor,
  buildExtensions,
} from '@/components/item-detail/content-editor';

// ---------------------------------------------------------------------------
// Sonner toast mock — the guard calls toast.error() on block.
// ---------------------------------------------------------------------------

const { mockToastError } = vi.hoisted(() => ({
  mockToastError: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: {
    error: mockToastError,
    success: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

// The toolbar uses lucide-react icons etc. Stub it to keep this focused.
vi.mock('@/components/item-detail/editor-toolbar', () => ({
  EditorToolbar: () => <div data-testid="editor-toolbar" />,
}));

// ---------------------------------------------------------------------------
// Schema assertion — the bug fix itself. Uses the REAL buildExtensions()
// from the production module so the assertion can't drift.
// ---------------------------------------------------------------------------

describe('ContentEditor Tiptap schema — table nodes registered', () => {
  let editor: Editor;

  beforeEach(() => {
    editor = new Editor({
      extensions: buildExtensions(),
      content: '',
    });
  });

  afterEach(() => {
    editor.destroy();
  });

  it('has `table` node registered in schema', () => {
    expect(editor.schema.nodes.table).toBeDefined();
  });

  it('has `tableRow` node registered in schema', () => {
    expect(editor.schema.nodes.tableRow).toBeDefined();
  });

  it('has `tableHeader` node registered in schema', () => {
    expect(editor.schema.nodes.tableHeader).toBeDefined();
  });

  it('has `tableCell` node registered in schema', () => {
    expect(editor.schema.nodes.tableCell).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Round-trip: GFM markdown table → Tiptap → markdown preserves structure.
// ---------------------------------------------------------------------------

describe('ContentEditor markdown round-trip — GFM tables', () => {
  const GFM_TABLE = [
    '| Header 1 | Header 2 | Header 3 | Header 4 |',
    '| --- | --- | --- | --- |',
    '| a1 | b1 | c1 | d1 |',
    '| a2 | b2 | c2 | d2 |',
    '| a3 | b3 | c3 | d3 |',
  ].join('\n');

  it('parses a 3-row, 4-column GFM table into real table nodes', () => {
    const editor = new Editor({
      extensions: buildExtensions(),
      content: GFM_TABLE,
      contentType: 'markdown',
    });

    const json = editor.getJSON() as JSONContent;
    const tableNode = json.content?.find((n) => n.type === 'table');
    expect(tableNode, 'expected a table node in editor JSON').toBeDefined();

    const rows: JSONContent[] =
      tableNode?.content?.filter((n: JSONContent) => n.type === 'tableRow') ??
      [];
    expect(rows.length).toBe(4);

    const headerRow = rows[0];
    const headerCells =
      headerRow?.content?.filter(
        (n: JSONContent) => n.type === 'tableHeader',
      ) ?? [];
    expect(headerCells.length).toBe(4);

    for (const bodyRow of rows.slice(1)) {
      const cells =
        bodyRow?.content?.filter((n: JSONContent) => n.type === 'tableCell') ??
        [];
      expect(cells.length).toBe(4);
    }

    editor.destroy();
  });

  it('reserialises table back to markdown preserving headers and cell count', () => {
    const editor = new Editor({
      extensions: buildExtensions(),
      content: GFM_TABLE,
      contentType: 'markdown',
    });

    const roundTripped = editor.getMarkdown();

    expect(roundTripped).toContain('|');
    expect(roundTripped).toMatch(/\|\s*-+\s*\|/);

    for (const cell of [
      'Header 1',
      'Header 2',
      'Header 3',
      'Header 4',
      'a1',
      'b1',
      'c1',
      'd1',
      'a2',
      'b2',
      'c2',
      'd2',
      'a3',
      'b3',
      'c3',
      'd3',
    ]) {
      expect(roundTripped).toContain(cell);
    }

    editor.destroy();
  });
});

// ---------------------------------------------------------------------------
// Save-safety guard — Cmd+S path through the real component.
//
// We use the `onEditorReady` test-only hook to grab the editor instance and
// drive setContent directly, which is much more reliable in jsdom than
// trying to simulate keystrokes through ProseMirror.
// ---------------------------------------------------------------------------

describe('ContentEditor save-safety guard (Cmd+S path)', () => {
  beforeEach(() => {
    mockToastError.mockClear();
  });

  function pressCtrlS() {
    const event = new KeyboardEvent('keydown', {
      key: 's',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(event);
  }

  async function flushEditorInit() {
    // useEditor initialises asynchronously with immediatelyRender:false.
    // Two macrotasks is reliable in jsdom.
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
  }

  it('permits first save when baseline length is 0 (empty previous content)', async () => {
    const onSave = vi.fn();
    const onChange = vi.fn();

    render(
      <ContentEditor
        content=""
        onChange={onChange}
        onSave={onSave}
        baselineLength={0}
      />,
    );
    await flushEditorInit();

    pressCtrlS();
    await flushEditorInit();

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it('permits normal edits within the 80% threshold', async () => {
    const onSave = vi.fn();
    const onChange = vi.fn();

    const previous = 'a'.repeat(100);
    render(
      <ContentEditor
        content={previous}
        onChange={onChange}
        onSave={onSave}
        baselineLength={previous.length}
      />,
    );
    await flushEditorInit();

    pressCtrlS();
    await flushEditorInit();

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it('blocks save and toasts when new markdown is <80% of baseline', async () => {
    const onSave = vi.fn();
    const onChange = vi.fn();
    let capturedEditor: import('@tiptap/core').Editor | null = null;

    render(
      <ContentEditor
        content={'a'.repeat(500)}
        onChange={onChange}
        onSave={onSave}
        // Explicit baseline; we shrink the editor body below.
        baselineLength={1000}
        onEditorReady={(e) => {
          capturedEditor = e;
        }}
      />,
    );
    await flushEditorInit();

    expect(capturedEditor, 'onEditorReady should fire').not.toBeNull();

    // Drive the editor to dramatically shorter content (well below 80% of
    // the baseline of 1000).
    capturedEditor!.commands.setContent('short', { contentType: 'markdown' });
    await flushEditorInit();

    pressCtrlS();
    await flushEditorInit();

    expect(onSave).not.toHaveBeenCalled();
    expect(mockToastError).toHaveBeenCalledTimes(1);
    expect(mockToastError).toHaveBeenCalledWith(
      expect.stringMatching(/^Save blocked/),
    );
  });
});

// ---------------------------------------------------------------------------
// Render smoke test
// ---------------------------------------------------------------------------

describe('ContentEditor render smoke', () => {
  it('renders the editor toolbar when not read-only', () => {
    render(
      <ContentEditor content="hello" onChange={vi.fn()} readOnly={false} />,
    );
    expect(screen.getByTestId('editor-toolbar')).toBeInTheDocument();
  });

  it('does not render the editor toolbar when read-only', () => {
    render(
      <ContentEditor content="hello" onChange={vi.fn()} readOnly={true} />,
    );
    expect(screen.queryByTestId('editor-toolbar')).not.toBeInTheDocument();
  });
});
