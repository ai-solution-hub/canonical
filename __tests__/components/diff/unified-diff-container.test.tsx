/**
 * Tests for UnifiedDiffContainer (components/diff/unified-diff-container.tsx)
 *
 * ID-117.10 — the depth-dispatching shell that backs all three view-depths
 * onto the one shared engine.
 *
 * Behaviours under contract:
 *  - viewDepth 'binary'            → renders <BinaryDiffPane/>;
 *  - viewDepth 'canonical-markdown'/'user-edit' → renders <RevisionDiffView/>
 *    with the render mode derived from viewDepth (deriveRenderMode), honouring
 *    an explicit override for the content depths only;
 *  - read-only (INV-17/18): NO apply / dismiss / accept controls in the DOM;
 *  - no AI labelling of changes (INV-20).
 *
 * BinaryDiffPane is mocked to a sentinel — its own behaviour is covered in
 * binary-diff-pane.test.tsx. We assert the dispatch, not the leaf render.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { UnifiedDiffContainer } from '@/components/diff/unified-diff-container';
import type { UnifiedDiff } from '@/lib/diff/unified-revision';

vi.mock('@/components/diff/binary-diff-pane', () => ({
  BinaryDiffPane: ({
    olderDocId,
    newerDocId,
  }: {
    olderDocId: string;
    newerDocId: string;
  }) => (
    <div data-testid="binary-diff-pane">
      {olderDocId}|{newerDocId}
    </div>
  ),
}));

const OLDER_DOC_ID = '11111111-1111-4111-8111-111111111111';
const NEWER_DOC_ID = '22222222-2222-4222-8222-222222222222';

function makeContentDiff(): UnifiedDiff {
  return {
    older: {
      recordKind: 'content_item',
      recordId: OLDER_DOC_ID,
      version: 1,
      text: 'line one\nline two',
      changeType: 'edit',
      changeSummary: 'first',
      createdAt: '2026-01-01T10:00:00.000Z',
      createdByLabel: 'Alice',
      editIntent: null,
    },
    newer: {
      recordKind: 'content_item',
      recordId: OLDER_DOC_ID,
      version: 2,
      text: 'line one changed\nline two',
      changeType: 'edit',
      changeSummary: 'second',
      createdAt: '2026-02-01T10:00:00.000Z',
      createdByLabel: 'Bob',
      editIntent: null,
    },
  };
}

function makeBinaryDiff(): UnifiedDiff {
  return {
    older: {
      recordKind: 'source_document',
      recordId: OLDER_DOC_ID,
      version: 1,
      text: 'old text',
      changeType: 'initial_ingest',
      changeSummary: null,
      createdAt: '2026-01-01T10:00:00.000Z',
      createdByLabel: 'Alice',
      editIntent: null,
      binary: {
        storagePath: `${OLDER_DOC_ID}/old.pdf`,
        mimeType: 'application/pdf',
      },
    },
    newer: {
      recordKind: 'source_document',
      recordId: NEWER_DOC_ID,
      version: 2,
      text: 'new text',
      changeType: 'reingest',
      changeSummary: null,
      createdAt: '2026-02-01T10:00:00.000Z',
      createdByLabel: 'Bob',
      editIntent: null,
      binary: {
        storagePath: `${NEWER_DOC_ID}/new.pdf`,
        mimeType: 'application/pdf',
      },
    },
  };
}

describe('UnifiedDiffContainer', () => {
  describe('depth dispatch', () => {
    it('renders the BinaryDiffPane for the binary depth, passing both doc ids', () => {
      render(
        <UnifiedDiffContainer
          diff={makeBinaryDiff()}
          viewDepth="binary"
          olderDocId={OLDER_DOC_ID}
          newerDocId={NEWER_DOC_ID}
        />,
      );
      const pane = screen.getByTestId('binary-diff-pane');
      expect(pane).toBeInTheDocument();
      expect(pane).toHaveTextContent(`${OLDER_DOC_ID}|${NEWER_DOC_ID}`);
    });

    it('renders the text engine (RevisionDiffView) for the user-edit depth', () => {
      render(
        <UnifiedDiffContainer diff={makeContentDiff()} viewDepth="user-edit" />,
      );
      // RevisionDiffView's default unified-line mode renders a log region.
      expect(screen.getByLabelText('Revision text diff')).toBeInTheDocument();
      expect(screen.queryByTestId('binary-diff-pane')).not.toBeInTheDocument();
    });

    it('renders the text engine for the canonical-markdown depth', () => {
      render(
        <UnifiedDiffContainer
          diff={makeContentDiff()}
          viewDepth="canonical-markdown"
        />,
      );
      expect(screen.getByLabelText('Revision text diff')).toBeInTheDocument();
    });

    it('honours a side-by-side render-mode override for a content depth', () => {
      render(
        <UnifiedDiffContainer
          diff={makeContentDiff()}
          viewDepth="canonical-markdown"
          renderModeOverride="side-by-side"
        />,
      );
      // Side-by-side mode renders the two labelled columns.
      expect(screen.getByLabelText('Older revision text')).toBeInTheDocument();
      expect(screen.getByLabelText('Newer revision text')).toBeInTheDocument();
    });
  });

  describe('read-only — INV-17/18 (no retired review affordances)', () => {
    it('renders no apply / dismiss / accept controls for the binary depth', () => {
      render(
        <UnifiedDiffContainer
          diff={makeBinaryDiff()}
          viewDepth="binary"
          olderDocId={OLDER_DOC_ID}
          newerDocId={NEWER_DOC_ID}
        />,
      );
      expect(
        screen.queryByRole('button', { name: /apply/i }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /dismiss/i }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /accept/i }),
      ).not.toBeInTheDocument();
    });

    it('renders no apply / dismiss controls for a content depth', () => {
      render(
        <UnifiedDiffContainer diff={makeContentDiff()} viewDepth="user-edit" />,
      );
      expect(
        screen.queryByRole('button', { name: /apply/i }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /dismiss/i }),
      ).not.toBeInTheDocument();
    });
  });
});
