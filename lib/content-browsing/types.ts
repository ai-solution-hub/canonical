/**
 * Shared types for content browsing hooks.
 *
 * Used by both `/library` and `/browse` surfaces to avoid duplicating
 * selection state, bulk operation progress, and URL filter primitives.
 */

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

export interface SelectionState {
  selectedIds: Set<string>;
  toggleSelect: (id: string) => void;
  toggleSelectAll: (allIds: string[]) => void;
  clearSelection: () => void;
  isAllSelected: (totalCount: number) => boolean;
}

// ---------------------------------------------------------------------------
// Bulk operations
// ---------------------------------------------------------------------------

export interface BulkProgress {
  current: number;
  total: number;
  label: string;
}

export interface BulkRunnerReturn<TItem = unknown> {
  bulkOperating: boolean;
  bulkProgress: BulkProgress;
  /**
   * Run a labelled bulk operation over the given IDs.
   *
   * The optional `itemLookup` resolves an ID to an item for operations that
   * need item context (e.g. library tag merge reads `item.user_tags` to
   * compute a merged tag set). Callers that don't need item context omit
   * `itemLookup` and use the `(id) => Promise<boolean>` signature.
   *
   * Toast behaviour is **external** to the runner: callers own their own
   * success/failure toasts. The runner emits a generic partial-failure toast
   * only when `errorCount > 0`; otherwise the caller is responsible for user
   * feedback.
   *
   * Returns the success count.
   */
  runBulkOperation: (
    label: string,
    ids: string[],
    operation: (id: string, item?: TItem) => Promise<boolean>,
    itemLookup?: (id: string) => TItem | undefined,
  ) => Promise<number>;
}

// ---------------------------------------------------------------------------
// URL filters
// ---------------------------------------------------------------------------

export interface UrlFilterConfig<T extends Record<string, unknown>> {
  /** Map from filter key to URL param name (e.g. { source_file: 'source' }) */
  paramMap?: Partial<Record<keyof T, string>>;
  /** Default values for each filter key */
  defaults?: Partial<T>;
  /** Parser for each filter key (from URL string to typed value) */
  parsers?: Partial<Record<keyof T, (raw: string) => unknown>>;
  /** Serialiser for each filter key (from typed value to URL string or undefined to delete) */
  serialisers?: Partial<
    Record<keyof T, (value: unknown) => string | undefined>
  >;
}

export interface UrlFilterReturn<T extends Record<string, unknown>> {
  filters: T;
  setFilters: (updates: Partial<T>) => void;
  clearFilters: () => void;
  activeCount: number;
}
