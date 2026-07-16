'use client';

/**
 * TanStack Query glue for the reusable requirement-catalogue editor (ID-147
 * {147.16}, TECH §7/§H1, PRODUCT §H1/§H3; ID-145 BI-24/BI-47).
 *
 * Owns its OWN query-key namespace deliberately — NOT added to the shared
 * `lib/query/query-keys.ts` registry. {147.16} (this file) and the sibling
 * {147.17} question/answer-slot editor both touch the `form_questions` /
 * `form_requirement_templates` table family but are dispatched as disjoint
 * Subtasks; keeping this namespace local avoids a shared-file merge conflict
 * between the two (per the {147.16} dispatch brief's file-ownership note).
 *
 * Reads go straight through the browser Supabase client (`.from(...)`
 * resolves to the `api.form_requirement_templates` security_invoker view at
 * runtime — see `lib/supabase/schema.ts`), mirroring the established
 * direct-read precedent in `hooks/use-taxonomy-admin.ts`
 * (`fetchSubtopicsForDomain`). Writes do the same rather than routing through
 * a bespoke API route: this Subtask's file-ownership boundary is this file +
 * `components/procurement/requirement-catalogue-editor.tsx` only (no
 * `app/api/**` route), and the catalogue's own RLS policies already gate
 * INSERT/UPDATE to admin/editor and DELETE to admin
 * (`template_requirements_insert` / `_update` / `_delete`, defined against
 * the table's pre-{145.16} name `form_template_requirements` — a plain
 * `ALTER TABLE … RENAME TO` does not rename policies, so these are still the
 * live policy names on the renamed `form_requirement_templates` table). BI-47
 * ("catalogue writes are admin/editor-gated") is therefore enforced at the
 * database layer regardless of what the UI does; the component additionally
 * hides create/edit affordances from non-editors via `useUserRole()` so
 * reviewer/viewer roles see a read-only surface (belt + braces, not the sole
 * gate).
 *
 * Columns cited against the {145.16} W1c migration
 * (`supabase/migrations/20260712062000_id145_w1c_rename_reshape.sql` STEP 3 —
 * pure rename, no column reshape) and the current `api.form_requirement_templates`
 * view definition (`supabase/migrations/20260712063000_id145_w1d_api_regen.sql`)
 * — `supabase/types/database.types.ts` is out of bounds for this Subtask
 * (Read-denied in this worktree), so the shape below is authored from the SQL,
 * not the generated types file.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import type {
  Tables,
  TablesInsert,
  TablesUpdate,
} from '@/supabase/types/database-overrides';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RequirementTemplateRow = Tables<'form_requirement_templates'>;
export type RequirementTemplateInsert =
  TablesInsert<'form_requirement_templates'>;
export type RequirementTemplateUpdate =
  TablesUpdate<'form_requirement_templates'>;

/**
 * `form_requirement_templates.requirement_type` CHECK-constrained value set
 * (`form_template_requirements_requirement_type_check`,
 * `supabase/migrations/20260617130000_squash_baseline.sql`). Defined locally
 * rather than imported from
 * `lib/domains/procurement/form-templating/catalogue/from-instance.ts` (which
 * exports the same list) to keep this editor's dependency graph
 * self-contained — that module pulls in the Anthropic SDK + embedding
 * plumbing for the separate Path-C cataloguing flow, which this manual
 * editor has no need of.
 */
export const REQUIREMENT_TYPES = [
  'policy',
  'statement',
  'evidence',
  'data',
  'narrative',
  'declaration',
  'reference',
] as const;

export type RequirementType = (typeof REQUIREMENT_TYPES)[number];

// ---------------------------------------------------------------------------
// Query keys (local namespace — see module doc)
// ---------------------------------------------------------------------------

export const requirementCatalogueKeys = {
  all: ['requirement-catalogue-templates'] as const,
  list: ['requirement-catalogue-templates', 'list'] as const,
};

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/**
 * Plain async fetcher, exported separately from the `useQuery` wrapper below
 * so it can be unit-tested directly against the shared Supabase mock without
 * any React/QueryClient scaffolding (mirrors the `lib/query/fetchers.ts`
 * convention).
 */
export async function fetchRequirementTemplates(): Promise<
  RequirementTemplateRow[]
> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('form_requirement_templates')
    .select('*')
    .order('template_name', { ascending: true })
    .order('display_order', { ascending: true });

  if (error) throw error;
  return data ?? [];
}

/** The full catalogue list, ordered by template name then display order. */
export function useRequirementTemplates() {
  return useQuery({
    queryKey: requirementCatalogueKeys.list,
    queryFn: fetchRequirementTemplates,
  });
}

// ---------------------------------------------------------------------------
// Write (create + update — admin/editor-gated by RLS, BI-47)
// ---------------------------------------------------------------------------

export interface SaveRequirementTemplateParams {
  /** Present for an update; absent for a create. */
  id?: string;
  values: RequirementTemplateInsert | RequirementTemplateUpdate;
}

/**
 * Plain async create/update, exported separately from the `useMutation`
 * wrapper below for the same direct-testability reason as
 * `fetchRequirementTemplates` above. Keyed off whether `id` is supplied.
 */
export async function saveRequirementTemplate({
  id,
  values,
}: SaveRequirementTemplateParams): Promise<RequirementTemplateRow> {
  const supabase = createClient();

  if (id) {
    const { data, error } = await supabase
      .from('form_requirement_templates')
      .update(values)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  const { data, error } = await supabase
    .from('form_requirement_templates')
    .insert(values as RequirementTemplateInsert)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * Creates or updates a single catalogue row. On success, invalidates the
 * list query so the editor reflects the persisted row (including any
 * server-side defaults, e.g. `id` / `created_at` on insert).
 */
export function useSaveRequirementTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: saveRequirementTemplate,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: requirementCatalogueKeys.all });
    },
  });
}
