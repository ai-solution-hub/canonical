/**
 * Domain-typed override of the generated Supabase `Database` type.
 *
 * The generated `supabase/types/database.types.ts` types every JSONB column
 * as `Json`, which erases the real domain shape stored in those columns. This
 * module re-types the wave-1 HIGH-value JSONB base-table columns to their
 * authored TypeScript domain types, so consumers that opt in get compile-time
 * safety instead of `Json` casts.
 *
 * Mechanism: a PLAIN STRUCTURAL OVERRIDE (no `type-fest`, no `MergeDeep`). The
 * spec originally mandated `MergeDeep<Gen, Overrides>`, but a prior executor
 * established that `type-fest@^4` `MergeDeep` over the generated `Database`
 * fails `tsc --noEmit` (order-dependent instantiation blow-up). This file
 * therefore composes the override with `Omit` + intersection, which is
 * deterministic and self-contained.
 *
 * Adoption is SELECTIVE: existing `@/supabase/types/database.types` imports are
 * untouched. Consumers that want the domain-typed columns import `Database`,
 * `Tables`, `TablesInsert`, or `TablesUpdate` from THIS module instead.
 *
 * Scope (ID-47.5, wave-1 HIGH base-table Row columns ONLY):
 *   - workspaces.Row.domain_metadata       -> ProcurementMetadata | null
 *   - content_items.Row.summary_data       -> SummaryData | null
 *   - feed_prompts.Row.performance_snapshot -> FeedPromptPerformanceSnapshot | null
 *   - processing_queue.Row.payload          -> QueueJobPayload<Record<string, unknown>>
 *
 * ID-130 {130.9} adds the form-engagement column overrides (text columns the
 * generator types as `string | null`, narrowed to their domain unions):
 *   - form_templates.Row.workflow_state    -> ProcurementWorkflowState | null
 *   - form_templates.Row.outcome           -> FormOutcomeValue | null
 *
 * Out of scope (later subtasks 47.6–47.9): RPC `Returns` overrides, Insert /
 * Update column overrides, DB migrations, consumer migration.
 */

import type { Database as Gen } from '@/supabase/types/database.types';
import type {
  ProcurementMetadata,
  ProcurementWorkflowState,
} from '@/types/procurement';
import type { SummaryData } from '@/types/content';
import type { QueueJobPayload } from '@/lib/queue/envelope';
import type { FormOutcomeValue } from '@/lib/validation/schemas';

/**
 * Performance snapshot stored as JSONB on `feed_prompts.performance_snapshot`.
 *
 * Authored from the REAL installed shape — verified against three sites:
 *   - producer `capturePerformanceSnapshot()`
 *     (app/api/intelligence/workspaces/[id]/prompts/route.ts:238-245)
 *   - Zod validator `FeedPromptSchema` (lib/validation/schemas.ts:3032-3042)
 *   - consumer hook type `FeedPrompt` (hooks/intelligence/use-feed-prompts.ts:14-21)
 *
 * The spec's earlier `{ pass_rate, flag_rate, articles_scored }` is STALE and
 * does not match any of those sites.
 */
export interface FeedPromptPerformanceSnapshot {
  /** Total articles ingested in the snapshot period. */
  total_articles: number;
  /** Articles that passed the prompt filter. */
  passed_articles: number;
  /** Articles filtered out (total - passed). */
  filtered_articles: number;
  /** Pass rate as an integer percentage (0-100). */
  pass_rate: number;
  /** ISO 8601 timestamp the snapshot was captured. */
  captured_at: string;
  /** Snapshot window label, e.g. `'30d'`. */
  period: string;
}

type GenTables = Gen['public']['Tables'];

/**
 * Replace the `Row` of a single generated table with `RowPatch` columns
 * overriding (or adding to) the generated `Row` columns. `Insert` / `Update`
 * and `Relationships` for the table are preserved unchanged — only `Row` is
 * re-typed (wave-1 scope is read-side only).
 */
type OverrideRow<T extends keyof GenTables, RowPatch> = Omit<
  GenTables[T],
  'Row'
> & {
  Row: Omit<GenTables[T]['Row'], keyof RowPatch> & RowPatch;
};

type MergedTables = Omit<
  GenTables,
  | 'workspaces'
  | 'content_items'
  | 'feed_prompts'
  | 'processing_queue'
  | 'form_templates'
> & {
  workspaces: OverrideRow<
    'workspaces',
    { domain_metadata: ProcurementMetadata | null }
  >;
  content_items: OverrideRow<
    'content_items',
    { summary_data: SummaryData | null }
  >;
  feed_prompts: OverrideRow<
    'feed_prompts',
    { performance_snapshot: FeedPromptPerformanceSnapshot | null }
  >;
  processing_queue: OverrideRow<
    'processing_queue',
    { payload: QueueJobPayload<Record<string, unknown>> }
  >;
  // ID-130 {130.9}: narrow the form-engagement text columns to their domain
  // unions. `outcome` is FK-validated against the `form_outcome_types` CV and
  // app-validated by `FormOutcomeSchema` (stage-appropriate subset); the column
  // itself is NULLable (NULL until a terminal outcome is recorded).
  form_templates: OverrideRow<
    'form_templates',
    {
      workflow_state: ProcurementWorkflowState | null;
      outcome: FormOutcomeValue | null;
    }
  >;
};

/**
 * Domain-typed `Database`. Structurally identical to the generated `Database`
 * except the wave-1 JSONB columns above carry their domain types.
 */
export type Database = Omit<Gen, 'public'> & {
  public: Omit<Gen['public'], 'Tables'> & { Tables: MergedTables };
};

type DefaultSchema = Database['public'];

/**
 * Row type for a public table, bound to the overridden `Database`. Mirrors the
 * generated `Tables<>` helper but resolves domain-typed columns for the wave-1
 * tables. Import from this module instead of `@/supabase/types/database.types`
 * to opt into the domain types.
 */
export type Tables<TableName extends keyof DefaultSchema['Tables']> =
  DefaultSchema['Tables'][TableName] extends { Row: infer R } ? R : never;

/** Insert type for a public table, bound to the overridden `Database`. */
export type TablesInsert<TableName extends keyof DefaultSchema['Tables']> =
  DefaultSchema['Tables'][TableName] extends { Insert: infer I } ? I : never;

/** Update type for a public table, bound to the overridden `Database`. */
export type TablesUpdate<TableName extends keyof DefaultSchema['Tables']> =
  DefaultSchema['Tables'][TableName] extends { Update: infer U } ? U : never;
