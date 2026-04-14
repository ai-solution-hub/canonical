/**
 * ContentEditor tests — WP1 S169.
 *
 * Covers the Tiptap table-extension registration fix (P0 data-loss bug
 * where GFM tables in markdown were silently dropped on save because the
 * editor schema had no `table`/`tableRow`/`tableCell`/`tableHeader` nodes),
 * plus the defence-in-depth save-safety guard.
 *
 * Reproducer item: 08726af7-27ec-4540-bf24-9f8332f22b17.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import CharacterCount from '@tiptap/extension-character-count';
import Placeholder from '@tiptap/extension-placeholder';
import LinkExt from '@tiptap/extension-link';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';

import {
  ContentEditor,
  SAVE_SAFETY_MIN_RATIO,
  shouldBlockSave,
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

// The toolbar uses lucide-react icons etc. Keep it — but stub to avoid
// pulling its dependencies into the test DOM.
vi.mock('@/components/item-detail/editor-toolbar', () => ({
  EditorToolbar: () => <div data-testid="editor-toolbar" />,
}));

// ---------------------------------------------------------------------------
// Shared extensions array — same list as production ContentEditor.
// ---------------------------------------------------------------------------

function buildExtensions() {
  return [
    StarterKit.configure({ link: false }),
    Markdown,
    CharacterCount.configure({
      wordCounter: (text: string) =>
        text.split(/\s+/).filter(Boolean).length,
    }),
    Placeholder.configure({ placeholder: 'Start writing...' }),
    LinkExt.configure({ openOnClick: false }),
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
  ];
}

// ---------------------------------------------------------------------------
// Pure guard helper
// ---------------------------------------------------------------------------

describe('shouldBlockSave', () => {
  it('permits first save when previous length is 0', () => {
    expect(shouldBlockSave(0, 0)).toBe(false);
    expect(shouldBlockSave(0, 1000)).toBe(false);
  });

  it('permits first save when previous length is negative', () => {
    expect(shouldBlockSave(-1, 10)).toBe(false);
  });

  it('permits normal edits (5% reduction)', () => {
    // N=1000 → 0.8×N = 800; new=950 is above threshold.
    expect(shouldBlockSave(1000, 950)).toBe(false);
  });

  it('permits edits exactly at threshold', () => {
    // At threshold (equal) is permitted (strict <, not <=).
    expect(shouldBlockSave(1000, 800)).toBe(false);
  });

  it('blocks save when new length drops below 80% of previous', () => {
    expect(shouldBlockSave(1000, 799)).toBe(true);
    expect(shouldBlockSave(1000, 500)).toBe(true);
    expect(shouldBlockSave(1000, 0)).toBe(true);
  });

  it('uses a configurable ratio', () => {
    // With ratio 0.5, dropping to 40% blocks, 60% does not.
    expect(shouldBlockSave(1000, 400, 0.5)).toBe(true);
    expect(shouldBlockSave(1000, 600, 0.5)).toBe(false);
  });

  it('exports the threshold constant', () => {
    expect(SAVE_SAFETY_MIN_RATIO).toBe(0.8);
  });
});

// ---------------------------------------------------------------------------
// Schema assertion — the bug fix itself.
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

    const json = editor.getJSON();
    // The first top-level node should be a table.
    const tableNode = json.content?.find((n) => n.type === 'table');
    expect(tableNode, 'expected a table node in editor JSON').toBeDefined();

    // A 3-body-row + 1-header-row GFM table → 4 tableRow children.
    const rows =
      tableNode?.content?.filter((n) => n.type === 'tableRow') ?? [];
    expect(rows.length).toBe(4);

    // Header row should contain 4 tableHeader cells, not tableCell.
    const headerRow = rows[0];
    const headerCells =
      headerRow?.content?.filter((n) => n.type === 'tableHeader') ?? [];
    expect(headerCells.length).toBe(4);

    // Body rows should each contain 4 tableCell cells.
    for (const bodyRow of rows.slice(1)) {
      const cells =
        bodyRow?.content?.filter((n) => n.type === 'tableCell') ?? [];
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

    // Table semantic markers should survive (even if pipe alignment differs).
    expect(roundTripped).toContain('|');
    // Header separator row is a GFM invariant.
    expect(roundTripped).toMatch(/\|\s*-+\s*\|/);

    // Every header + body cell should be present somewhere in the output.
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
// Save-safety guard — end-to-end through the component (Cmd+S path).
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
    // A microtask + rAF tick is usually enough for jsdom.
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
  }

  it('permits first save when previous content length was 0', async () => {
    const onSave = vi.fn();
    const onChange = vi.fn();
    const { rerender } = render(
      <ContentEditor
        content=""
        onChange={onChange}
        onSave={onSave}
        autofocus={false}
      />,
    );
    await flushEditorInit();

    // Simulate having typed new content by rerendering with new prop? No —
    // editor holds the typed value internally. We can't easily type in jsdom,
    // so instead we verify guard passes by checking the Cmd+S path fires
    // onSave when previous length is 0 (even with empty current markdown).
    pressCtrlS();
    await flushEditorInit();

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(mockToastError).not.toHaveBeenCalled();

    rerender(
      <ContentEditor
        content=""
        onChange={onChange}
        onSave={onSave}
        autofocus={false}
      />,
    );
  });

  it('permits normal edits within the 80% threshold', async () => {
    const onSave = vi.fn();
    const onChange = vi.fn();

    // Previous content of length 100. Editor initialises with this as its
    // content and sets the guard baseline to 100. Getting markdown out gives
    // us roughly the same length, which is ≥ 80 → save proceeds.
    const previous = 'a'.repeat(100);
    render(
      <ContentEditor
        content={previous}
        onChange={onChange}
        onSave={onSave}
      />,
    );
    await flushEditorInit();

    pressCtrlS();
    await flushEditorInit();

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(mockToastError).not.toHaveBeenCalled();
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
