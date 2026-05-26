/**
 * Compile-time type assertions for the wave-1 domain-typed Supabase overrides
 * (ID-47.5).
 *
 * This is a `.test-d.ts` type-test: it carries NO runtime assertions and is
 * verified by the TypeScript compiler (`tsc --noEmit`) and the Next.js build's
 * type-check, NOT by the Vitest runtime (the `__tests__/**\/*.test.{ts,tsx}`
 * include glob deliberately excludes `.test-d.ts`). Hand-rolled `Equal` /
 * `Expect` helpers are used so the file is fully self-contained and forces
 * instantiation of the overridden `Database` — proving the structural override
 * is `tsc`-clean as the first/only instantiation site.
 *
 * Each `Expect<Equal<...>>` line errors at compile time if the column resolves
 * to anything other than its domain type — in particular it FAILS if a column
 * still resolves to `Json`.
 */

import type {
  Tables,
  FeedPromptPerformanceSnapshot,
} from '@/supabase/types/database-overrides';
import type { ProcurementMetadata } from '@/types/procurement';
import type { SummaryData } from '@/types/content';
import type { QueueJobPayload } from '@/lib/queue/envelope';
import type { Json } from '@/supabase/types/database.types';

// --- type-level assertion helpers (no runtime) --------------------------------

/** Exact type equality (invariant — distinguishes `T` from `T | Json`). */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;

/** Compiles only when the argument type is exactly `true`. */
type Expect<T extends true> = T;

// --- wave-1 column assertions -------------------------------------------------

// workspaces.Row.domain_metadata resolves to ProcurementMetadata | null (not Json).
type WorkspacesDomainMetadata = Tables<'workspaces'>['domain_metadata'];
type _AssertWorkspacesDomainMetadata = Expect<
  Equal<WorkspacesDomainMetadata, ProcurementMetadata | null>
>;

// content_items.Row.summary_data resolves to SummaryData | null (not Json).
type ContentItemsSummaryData = Tables<'content_items'>['summary_data'];
type _AssertContentItemsSummaryData = Expect<
  Equal<ContentItemsSummaryData, SummaryData | null>
>;

// feed_prompts.Row.performance_snapshot resolves to
// FeedPromptPerformanceSnapshot | null (not Json).
type FeedPromptsPerformanceSnapshot =
  Tables<'feed_prompts'>['performance_snapshot'];
type _AssertFeedPromptsPerformanceSnapshot = Expect<
  Equal<FeedPromptsPerformanceSnapshot, FeedPromptPerformanceSnapshot | null>
>;

// processing_queue.Row.payload resolves to QueueJobPayload<Record<string, unknown>>
// (not Json) — note: non-nullable, matching the generated column.
type ProcessingQueuePayload = Tables<'processing_queue'>['payload'];
type _AssertProcessingQueuePayload = Expect<
  Equal<ProcessingQueuePayload, QueueJobPayload<Record<string, unknown>>>
>;

// --- negative guards: prove the columns are NOT Json --------------------------

type _AssertWorkspacesNotJson = Expect<
  Equal<Equal<WorkspacesDomainMetadata, Json | null>, false>
>;
type _AssertContentItemsNotJson = Expect<
  Equal<Equal<ContentItemsSummaryData, Json | null>, false>
>;
type _AssertFeedPromptsNotJson = Expect<
  Equal<Equal<FeedPromptsPerformanceSnapshot, Json | null>, false>
>;
type _AssertProcessingQueueNotJson = Expect<
  Equal<Equal<ProcessingQueuePayload, Json>, false>
>;

// --- non-overridden column sanity: a plain scalar column is unchanged ---------

// workspaces.Row.id stays string (override is column-surgical, not table-wide).
type _AssertWorkspacesIdUnchanged = Expect<
  Equal<Tables<'workspaces'>['id'], string>
>;

// Reference the assertion aliases so `noUnusedLocals` (if enabled) stays happy
// and the file forces instantiation even under isolatedModules.
export type _DatabaseOverridesTypeTests = [
  _AssertWorkspacesDomainMetadata,
  _AssertContentItemsSummaryData,
  _AssertFeedPromptsPerformanceSnapshot,
  _AssertProcessingQueuePayload,
  _AssertWorkspacesNotJson,
  _AssertContentItemsNotJson,
  _AssertFeedPromptsNotJson,
  _AssertProcessingQueueNotJson,
  _AssertWorkspacesIdUnchanged,
];
