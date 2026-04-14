/**
 * ContentTabs integration tests — WP1-fix S169.
 *
 * Specifically exercises the Save-button path through `InlineContentEditor`
 * (the production path that ~all real saves go through — Cmd+S is not
 * documented in the shortcuts overlay). Verifies that the save-safety guard
 * now fires BEFORE `onSaveEdit` is invoked, protecting against silent data
 * loss even when a future schema gap drops content on round-trip.
 *
 * The `ContentEditor` is stubbed so the test focuses on the guard wiring,
 * not the Tiptap integration (which is covered in
 * `__tests__/components/item-detail/content-editor.test.tsx`).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks — declared BEFORE importing the component under test.
// ---------------------------------------------------------------------------

const { mockToastError, mockToastSuccess } = vi.hoisted(() => ({
  mockToastError: vi.fn(),
  mockToastSuccess: vi.fn(),
}));

// Plain JSX stub — mounted through both mocks below. Using JSX (not
// createElement) keeps this readable and avoids `require()` calls.
function ContentEditorStub(props: {
  content: string;
  baselineLength?: number;
}) {
  return (
    <div
      data-testid="content-editor-stub"
      data-baseline-length={props.baselineLength}
      data-content-length={props.content?.length ?? 0}
    />
  );
}

vi.mock('sonner', () => ({
  toast: {
    error: mockToastError,
    success: mockToastSuccess,
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

// Stub the dynamically imported ContentEditor. The production file uses
// `next/dynamic(() => import('.../content-editor').then(m => m.ContentEditor))`,
// so we mock both the `next/dynamic` entry and the content-editor module.
// Mocking next/dynamic alone is sufficient for Vitest, which returns the
// component produced by the loader synchronously.
vi.mock('@/components/item-detail/content-editor', () => ({
  ContentEditor: ContentEditorStub,
}));

vi.mock('next/dynamic', () => ({
  // `next/dynamic(loader)` → just return the stub directly so the dynamic
  // component resolves synchronously during render.
  default: () => ContentEditorStub,
}));

// Reader/ancillary components referenced by ContentTabs. Keep them minimal.
vi.mock('@/components/reader/reader-view', () => ({
  ReaderView: () => <div data-testid="reader-view" />,
}));
vi.mock('@/components/reader/iframe-viewer', () => ({
  IframeViewer: () => <div data-testid="iframe-viewer" />,
}));
vi.mock('@/components/reader-cards/newsletter-reader-card', () => ({
  NewsletterReaderCard: () => <div data-testid="newsletter-reader-card" />,
}));
vi.mock('@/components/reader-cards/transcript-reader-card', () => ({
  TranscriptReaderCard: () => <div data-testid="transcript-reader-card" />,
}));
vi.mock('@/components/item-detail/content-renderer', () => ({
  ContentRenderer: ({ content }: { content: string }) => (
    <div data-testid="content-renderer">{content}</div>
  ),
}));

// ---------------------------------------------------------------------------
// Imports (AFTER mocks are declared)
// ---------------------------------------------------------------------------

import {
  ContentTabs,
  type ContentTabsEditConfig,
} from '@/components/item-detail/content-tabs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEditConfig(
  overrides: Partial<ContentTabsEditConfig> = {},
): ContentTabsEditConfig {
  return {
    editingField: 'content',
    editValue: 'new content',
    isSaving: false,
    onStartEdit: vi.fn(),
    onEditValueChange: vi.fn(),
    onSaveEdit: vi.fn(),
    onCancelEdit: vi.fn(),
    changeReason: '',
    onChangeReasonChange: vi.fn(),
    ...overrides,
  };
}

function renderContentTabs(args: {
  content: string;
  editConfig: ContentTabsEditConfig;
}) {
  return render(
    <ContentTabs
      itemId="test-item"
      summaryData={null}
      content={args.content}
      contentType="text/markdown"
      canEdit
      editConfig={args.editConfig}
    />,
  );
}

// ---------------------------------------------------------------------------
// Tests — Save-button guard trip (the primary production path)
// ---------------------------------------------------------------------------

describe('ContentTabs InlineContentEditor — save-safety guard (Save button)', () => {
  beforeEach(() => {
    mockToastError.mockClear();
    mockToastSuccess.mockClear();
  });

  it('blocks save when edit buffer drops below 80% of baseline content', () => {
    const baseline = 'a'.repeat(1000);
    const shortened = 'a'.repeat(100); // 10% of baseline, well below 80%.
    const onSaveEdit = vi.fn();

    const editConfig = makeEditConfig({
      editValue: shortened,
      onSaveEdit,
    });

    renderContentTabs({ content: baseline, editConfig });

    const saveBtn = screen.getByRole('button', { name: /^Save$/ });
    fireEvent.click(saveBtn);

    // Guard must fire: onSaveEdit never invoked, error toast shown once.
    expect(onSaveEdit).not.toHaveBeenCalled();
    expect(mockToastError).toHaveBeenCalledTimes(1);
    expect(mockToastError).toHaveBeenCalledWith(
      expect.stringMatching(/^Save blocked/),
    );
    // Canonical copy must not recommend refresh (refresh destroys edits).
    const message = mockToastError.mock.calls[0]![0] as string;
    expect(message.toLowerCase()).not.toContain('refresh and try again');
    expect(message.toLowerCase()).toContain("don't refresh");
  });

  it('permits save when edit buffer shrinks by only 10%', () => {
    const baseline = 'a'.repeat(1000);
    const slightlyShorter = 'a'.repeat(900); // 90%, above threshold.
    const onSaveEdit = vi.fn();

    const editConfig = makeEditConfig({
      editValue: slightlyShorter,
      onSaveEdit,
    });

    renderContentTabs({ content: baseline, editConfig });

    const saveBtn = screen.getByRole('button', { name: /^Save$/ });
    fireEvent.click(saveBtn);

    expect(onSaveEdit).toHaveBeenCalledTimes(1);
    expect(onSaveEdit).toHaveBeenCalledWith('content');
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it('passes baselineLength derived from the last-persisted content prop to ContentEditor', () => {
    const baseline = 'a'.repeat(1234);
    const editConfig = makeEditConfig({ editValue: baseline });

    renderContentTabs({ content: baseline, editConfig });

    const stub = screen.getByTestId('content-editor-stub');
    expect(stub.getAttribute('data-baseline-length')).toBe('1234');
  });
});
