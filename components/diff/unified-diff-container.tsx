'use client';

/**
 * UnifiedDiffContainer — the depth-dispatching shell that backs all three
 * view-depths onto the one shared engine (ID-117 {117.10}, cluster F+A).
 *
 * INV-1: takes exactly one UnifiedDiff ({ older, newer }) for ONE record.
 *
 * Dispatch:
 * - viewDepth 'binary'             → <BinaryDiffPane/> (visual compare + text
 *   summary alongside; requires the two source_documents ids for the binary leg).
 * - viewDepth 'canonical-markdown' | 'user-edit' → <RevisionDiffView/> with the
 *   render mode derived via deriveRenderMode(viewDepth, override). The binary
 *   depth is pinned to binary-split by deriveRenderMode and cannot be overridden;
 *   content depths default to unified-line and may be overridden to side-by-side
 *   / word-inline.
 *
 * Read-only (INV-17/18): the surface presents NO apply / dismiss / accept
 * affordances — the legacy re-ingest review workflow is RETIRED, not re-homed.
 * No AI labelling of changes (INV-20). Workspace scoping (INV-19) is enforced
 * upstream by the RLS-scoped page client and the binary-url route's RLS check;
 * this component adds no client-side trust.
 *
 * INV-12: the content depths route through the unchanged RevisionDiffView engine
 * via its RevisionBlob structural subset — the two existing callers are untouched.
 */

import {
  RevisionDiffView,
  type RevisionBlob,
} from '@/components/item-detail/revision-diff-view';
import { BinaryDiffPane } from '@/components/diff/binary-diff-pane';
import {
  deriveRenderMode,
  type RenderMode,
  type UnifiedDiff,
  type UnifiedRevision,
  type ViewDepth,
} from '@/lib/diff/unified-revision';

export interface UnifiedDiffContainerProps {
  /** The unit of comparison — exactly two revisions of one record (INV-1). */
  diff: UnifiedDiff;
  /** Which view-depth to render. */
  viewDepth: ViewDepth;
  /**
   * Optional render-mode override for the CONTENT depths only
   * (canonical-markdown / user-edit). Ignored for the binary depth, which is
   * pinned to binary-split by deriveRenderMode.
   */
  renderModeOverride?: RenderMode;
  /**
   * The older side's source_documents.id. Required for the binary depth (it
   * mints the side's signed URL); unused for content depths.
   */
  olderDocId?: string;
  /** The newer side's source_documents.id. Required for the binary depth. */
  newerDocId?: string;
  className?: string;
}

/** UnifiedRevision → RevisionBlob (structural subset for the text engine). */
function toRevisionBlob(rev: UnifiedRevision): RevisionBlob {
  return {
    version: rev.version,
    text: rev.text,
    changeType: rev.changeType,
    changeSummary: rev.changeSummary,
    createdAt: rev.createdAt,
    createdByLabel: rev.createdByLabel,
    editIntent: rev.editIntent,
  };
}

export function UnifiedDiffContainer({
  diff,
  viewDepth,
  renderModeOverride,
  olderDocId,
  newerDocId,
  className,
}: UnifiedDiffContainerProps) {
  if (viewDepth === 'binary') {
    return (
      <BinaryDiffPane
        diff={diff}
        olderDocId={olderDocId ?? diff.older.recordId}
        newerDocId={newerDocId ?? diff.newer.recordId}
        className={className}
      />
    );
  }

  // Content depths (canonical-markdown / user-edit) route through the shared
  // RevisionDiffView engine with the derived render mode (INV-12 preserved).
  const renderMode = deriveRenderMode(viewDepth, renderModeOverride);

  return (
    <RevisionDiffView
      older={toRevisionBlob(diff.older)}
      newer={toRevisionBlob(diff.newer)}
      renderMode={renderMode}
      className={className}
    />
  );
}
