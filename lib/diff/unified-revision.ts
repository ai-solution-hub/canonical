/**
 * UnifiedRevision — the common revision abstraction for the unified diff surface
 * (ID-117 {117.5}, cluster A spine). Generalises the landed RevisionBlob
 * (components/item-detail/revision-diff-view.tsx:31) across all three view-depths
 * and two physical substrates (content_history / q_a_pair_history and the
 * source_documents version chain).
 *
 * This module is PURE TYPES + a pure helper. It performs no DB access, no fetch,
 * and no diff-storage write. Diffs are computed on demand in the render engine
 * (inherits ID-59 INV-14 / ID-117 INV-3).
 *
 * Type-design note (PLAN §2, REV S391): renderMode is NOT stored as a free
 * independent field alongside viewDepth — that would admit illegal combinations
 * (e.g. binary + word-inline). Instead, callers derive the render mode via
 * deriveRenderMode(viewDepth, optionalOverride). The binary depth is pinned to
 * binary-split and cannot be overridden; the content-item depths default to
 * unified-line but may be overridden to side-by-side or word-inline.
 */

// ---------------------------------------------------------------------------
// Union types
// ---------------------------------------------------------------------------

/** The logical kind of record a revision belongs to. */
export type RecordKind = 'content_item' | 'qa_pair' | 'source_document';

/**
 * The view-depth at which a diff is rendered.
 *
 * - `binary`             — side-by-side rendered file viewers (PDF/DOCX/XLSX via extend-ui)
 * - `canonical-markdown` — post-Docling markdown projection of content_history
 * - `user-edit`          — in-platform content_history / q_a_pair_history edit diff
 */
export type ViewDepth = 'user-edit' | 'canonical-markdown' | 'binary';

/**
 * The render strategy for the diff pane.
 *
 * - `unified-line`  — default for user-edit and canonical-markdown depths
 * - `side-by-side`  — optional override for content-item depths (v1.1 candidate)
 * - `word-inline`   — optional override for content-item depths (v1.1 candidate)
 * - `binary-split`  — enforced for the binary depth; extend-ui viewer pair
 */
export type RenderMode =
  | 'unified-line'
  | 'side-by-side'
  | 'word-inline'
  | 'binary-split';

// ---------------------------------------------------------------------------
// Derive render mode — no illegal combos (PLAN §2 type-design nit)
// ---------------------------------------------------------------------------

/**
 * Derive the render mode from a view depth with an optional explicit override.
 *
 * Rules:
 * - `binary` → always `binary-split`, regardless of any override. No other
 *   mode is legal for the binary viewer-pair pane.
 * - `canonical-markdown` or `user-edit` → default `unified-line`, but may be
 *   explicitly overridden to `side-by-side` or `word-inline` for v1.1 callers.
 *
 * This function is the single source of truth for render-mode derivation.
 * Callers that need a non-default mode for content-item depths pass the override;
 * callers that need the binary depth must accept `binary-split`.
 */
export function deriveRenderMode(
  viewDepth: ViewDepth,
  override?: RenderMode,
): RenderMode {
  // Binary depth is pinned: no override is legal.
  if (viewDepth === 'binary') {
    return 'binary-split';
  }

  // Content-item depths: honour an explicit override, else default to unified-line.
  return override ?? 'unified-line';
}

// ---------------------------------------------------------------------------
// Core type
// ---------------------------------------------------------------------------

/**
 * A single revision in the unified diff surface, normalised from whichever
 * substrate it originates from (content_history, q_a_pair_history, or the
 * source_documents version chain).
 *
 * This is the SUPERSET of RevisionBlob
 * (components/item-detail/revision-diff-view.tsx:31). RevisionBlob is a
 * structural subset — it omits `recordKind`, `recordId`, and `binary`, all of
 * which are additive optionals on this type. The two existing callers of
 * RevisionDiffView continue to pass blob-shaped objects unchanged (INV-12).
 * The wave-2 widen (117.3 / 117.7) that makes RevisionDiffView accept
 * UnifiedRevision directly is non-breaking because these fields are optional.
 *
 * NOTE: Do NOT edit `components/item-detail/revision-diff-view.tsx` here;
 * that widen is Subtask 117.7.
 */
export interface UnifiedRevision {
  /** Which kind of record this revision belongs to. */
  recordKind: RecordKind;
  /**
   * The UUID of the parent record (content_items.id / q_a_pairs.id /
   * source_documents.id). Both blobs in a UnifiedDiff must share this value —
   * adapters enforce same-record by construction (INV-1).
   */
  recordId: string;
  /** Monotonic version number for this revision. */
  version: number;
  /**
   * The diffable text projection:
   * - content_item   → content_history.content
   * - qa_pair        → q_a_pair_history.answer_standard
   * - source_document → source_documents.extracted_text (binary-leg text fallback)
   */
  text: string;
  /**
   * Provenance kind:
   * - content_item   → content_history.change_type (e.g. 'edit', 'ai_update')
   * - qa_pair        → q_a_pair_history.origin_kind (e.g. 'human', 'ai_generated')
   * - source_document → synthesised 'reingest' or 'initial_ingest' (OQ-117-4 resolved)
   */
  changeType: string;
  /** Human-authored change summary; null for substrates with no such column. */
  changeSummary: string | null;
  /** ISO 8601 timestamp the revision was created. Rendered as DD/MM/YYYY HH:mm. */
  createdAt: string;
  /** Resolved display name of the author (e.g. 'Alice', 'System', 'Unknown'). */
  createdByLabel: string;
  /**
   * Structured edit-intent classification ({59.5}).
   * - content_item   → content_history.edit_intent (null for pre-feature rows)
   * - qa_pair        → q_a_pair_history.edit_intent (null for pre-feature rows)
   * - source_document → always null (no edit_intent column on source_documents)
   */
  editIntent: string | null;
  /**
   * Binary-leg metadata. Present only for source_document revisions.
   * Absent for content_item and qa_pair (text-only substrates).
   */
  binary?: {
    /** Storage path within the `documents` bucket (e.g. `{itemId}/{filename}`). */
    storagePath: string;
    /** MIME type of the stored binary (e.g. 'application/pdf'). */
    mimeType: string;
  };
}

// ---------------------------------------------------------------------------
// UnifiedDiff — exactly two revisions of one record (INV-1)
// ---------------------------------------------------------------------------

/**
 * The unit of comparison for the unified diff surface.
 *
 * Always exactly two revisions (`older`, `newer`) of the SAME logical record
 * (`recordId`). No code path accepts more than two revisions or mixes
 * `recordId`s — adapters enforce this by construction (both blobs derived from
 * one record's history fetch). The type carries only `older` and `newer` —
 * there is no third field.
 */
export interface UnifiedDiff {
  /** The earlier of the two revisions (rendered as removals / old side). */
  older: UnifiedRevision;
  /** The later of the two revisions (rendered as additions / new side). */
  newer: UnifiedRevision;
}
