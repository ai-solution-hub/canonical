/**
 * MarkdownAnalysisTable Component Tests
 *
 * Tests the EP2 §1.11 Phase 2 pre-flight analysis table — auto-exclude
 * triggers, role-gating (admin-only checkboxes + batch toggle),
 * draft/final dropdown, existing-match badge rendering.
 *
 * Spec: docs/specs/ep2-markdown-ui-ingest-spec.md §6.3 + §4.3
 * Plan:  docs/plans/§1.11-ep2-build-plan.md row EP2-T5
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { installRadixPointerShims } from '@/__tests__/helpers/radix-pointer-shims';
import { MarkdownAnalysisTable } from '@/components/ingest/markdown-analysis-table';
import type {
  MarkdownIngestAnalysis,
  MarkdownPerFileOverride,
} from '@/types/ingest';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeAnalysis(
  overrides: Partial<MarkdownIngestAnalysis> = {},
): MarkdownIngestAnalysis {
  return {
    filename: 'doc.md',
    sizeBytes: 12_345,
    encodingOk: true,
    empty: false,
    frontMatter: { present: true, parsedOk: true, fields: {} },
    title: 'Doc title',
    titleProvenance: 'front-matter',
    contentHash: 'a'.repeat(32),
    hasConflictMarkers: false,
    diffMarkers: { gitConflictCount: 0, plusMinusLineCount: 0, warning: false },
    draftOrFinalHeuristic: 'final',
    dedupVerdict: { isDuplicate: false },
    sourceFileMatch: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MarkdownAnalysisTable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installRadixPointerShims();
  });

  it('renders one row per analysis with title + provenance label', () => {
    const analyses = [
      makeAnalysis({ filename: 'foo.md', title: 'Foo title' }),
      makeAnalysis({
        filename: 'bar.md',
        title: 'Bar title',
        titleProvenance: 'h1',
        draftOrFinalHeuristic: 'draft',
      }),
    ];

    render(
      <MarkdownAnalysisTable
        analyses={analyses}
        overrides={[]}
        autoSupersede={false}
        role="editor"
        onChangeOverrides={vi.fn()}
        onChangeAutoSupersede={vi.fn()}
      />,
    );

    expect(screen.getByText('Foo title')).toBeInTheDocument();
    expect(screen.getByText('Bar title')).toBeInTheDocument();
    expect(screen.getByText(/from front-matter/)).toBeInTheDocument();
    expect(screen.getByText(/from H1/)).toBeInTheDocument();
    expect(screen.getByTestId('markdown-analysis-row-foo.md')).toBeInTheDocument();
    expect(screen.getByTestId('markdown-analysis-row-bar.md')).toBeInTheDocument();
  });

  it('auto-excludes rows with encodingOk=false', () => {
    const analyses = [
      makeAnalysis({ filename: 'bad.md', encodingOk: false }),
    ];

    render(
      <MarkdownAnalysisTable
        analyses={analyses}
        overrides={[]}
        autoSupersede={false}
        role="editor"
        onChangeOverrides={vi.fn()}
        onChangeAutoSupersede={vi.fn()}
      />,
    );

    const checkbox = screen.getByRole('checkbox', {
      name: /exclude bad\.md|^auto$/i,
    });
    expect(checkbox.getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText(/Not valid UTF-8/)).toBeInTheDocument();
  });

  it('auto-excludes rows with empty=true', () => {
    const analyses = [
      makeAnalysis({ filename: 'empty.md', empty: true }),
    ];

    render(
      <MarkdownAnalysisTable
        analyses={analyses}
        overrides={[]}
        autoSupersede={false}
        role="editor"
        onChangeOverrides={vi.fn()}
        onChangeAutoSupersede={vi.fn()}
      />,
    );

    const row = screen.getByTestId('markdown-analysis-row-empty.md');
    const checkbox = row.querySelector('[role="checkbox"]');
    expect(checkbox?.getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText(/File appears empty/)).toBeInTheDocument();
  });

  it('does NOT auto-exclude on front-matter parse error (warn-only)', () => {
    const analyses = [
      makeAnalysis({
        filename: 'fm-bad.md',
        frontMatter: {
          present: true,
          parsedOk: false,
          error: 'parse error',
          fields: {},
        },
      }),
    ];

    render(
      <MarkdownAnalysisTable
        analyses={analyses}
        overrides={[]}
        autoSupersede={false}
        role="editor"
        onChangeOverrides={vi.fn()}
        onChangeAutoSupersede={vi.fn()}
      />,
    );

    const row = screen.getByTestId('markdown-analysis-row-fm-bad.md');
    const checkbox = row.querySelector('[role="checkbox"]');
    expect(checkbox?.getAttribute('aria-checked')).toBe('false');
    expect(
      screen.getByText(/Front-matter could not be parsed/),
    ).toBeInTheDocument();
  });

  it('does NOT auto-exclude on diff-markers warning (warn-only)', () => {
    const analyses = [
      makeAnalysis({
        filename: 'conflict.md',
        diffMarkers: {
          gitConflictCount: 3,
          plusMinusLineCount: 0,
          warning: true,
        },
      }),
    ];

    render(
      <MarkdownAnalysisTable
        analyses={analyses}
        overrides={[]}
        autoSupersede={false}
        role="editor"
        onChangeOverrides={vi.fn()}
        onChangeAutoSupersede={vi.fn()}
      />,
    );

    const row = screen.getByTestId('markdown-analysis-row-conflict.md');
    const checkbox = row.querySelector('[role="checkbox"]');
    expect(checkbox?.getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText(/3 conflict lines/)).toBeInTheDocument();
  });

  it('hides admin-only controls (skip-dedup column + batch auto-supersede) for editor role', () => {
    const analyses = [makeAnalysis({ filename: 'doc.md' })];

    const { rerender } = render(
      <MarkdownAnalysisTable
        analyses={analyses}
        overrides={[]}
        autoSupersede={false}
        role="editor"
        onChangeOverrides={vi.fn()}
        onChangeAutoSupersede={vi.fn()}
      />,
    );

    expect(
      screen.queryByTestId('markdown-analysis-table-batch-controls'),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/Skip dedup/)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Auto-supersede on filename match/),
    ).not.toBeInTheDocument();

    rerender(
      <MarkdownAnalysisTable
        analyses={analyses}
        overrides={[]}
        autoSupersede={false}
        role="admin"
        onChangeOverrides={vi.fn()}
        onChangeAutoSupersede={vi.fn()}
      />,
    );

    expect(
      screen.getByTestId('markdown-analysis-table-batch-controls'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Skip dedup/)).toBeInTheDocument();
    expect(
      screen.getByText(/Auto-supersede on filename match/),
    ).toBeInTheDocument();
  });

  it('fires onChangeOverrides when user toggles exclude', () => {
    const onChangeOverrides = vi.fn();
    const analyses = [makeAnalysis({ filename: 'doc.md' })];

    render(
      <MarkdownAnalysisTable
        analyses={analyses}
        overrides={[]}
        autoSupersede={false}
        role="editor"
        onChangeOverrides={onChangeOverrides}
        onChangeAutoSupersede={vi.fn()}
      />,
    );

    const row = screen.getByTestId('markdown-analysis-row-doc.md');
    const checkbox = row.querySelector('[role="checkbox"]') as HTMLElement;
    fireEvent.click(checkbox);

    expect(onChangeOverrides).toHaveBeenCalledTimes(1);
    const call = onChangeOverrides.mock.calls[0][0] as MarkdownPerFileOverride[];
    expect(call).toHaveLength(1);
    expect(call[0]).toMatchObject({ filename: 'doc.md', excluded: true });
  });

  it('fires onChangeAutoSupersede when admin toggles batch auto-supersede', () => {
    const onChangeAutoSupersede = vi.fn();
    const analyses = [makeAnalysis({ filename: 'doc.md' })];

    render(
      <MarkdownAnalysisTable
        analyses={analyses}
        overrides={[]}
        autoSupersede={false}
        role="admin"
        onChangeOverrides={vi.fn()}
        onChangeAutoSupersede={onChangeAutoSupersede}
      />,
    );

    const checkbox = screen.getByLabelText(
      /Auto-supersede on filename match/,
    );
    fireEvent.click(checkbox);

    expect(onChangeAutoSupersede).toHaveBeenCalledWith(true);
  });

  it('renders existing-match badges (hash, filename, none)', () => {
    const analyses = [
      makeAnalysis({
        filename: 'hash.md',
        dedupVerdict: {
          isDuplicate: true,
          existingId: '11111111-1111-4111-8111-111111111111',
          existingTitle: 'Existing duplicate',
        },
      }),
      makeAnalysis({
        filename: 'fname.md',
        sourceFileMatch: {
          id: '22222222-2222-4222-8222-222222222222',
          title: 'Filename match item',
        },
      }),
      makeAnalysis({ filename: 'fresh.md' }),
    ];

    render(
      <MarkdownAnalysisTable
        analyses={analyses}
        overrides={[]}
        autoSupersede={false}
        role="editor"
        onChangeOverrides={vi.fn()}
        onChangeAutoSupersede={vi.fn()}
      />,
    );

    expect(screen.getByText(/Existing duplicate/)).toBeInTheDocument();
    expect(screen.getByText(/Filename match item/)).toBeInTheDocument();
    expect(screen.getByLabelText(/No match/)).toBeInTheDocument();

    const hashLink = screen
      .getByText(/Existing duplicate/)
      .closest('a');
    expect(hashLink?.getAttribute('href')).toBe(
      '/item/11111111-1111-4111-8111-111111111111',
    );
  });
});
