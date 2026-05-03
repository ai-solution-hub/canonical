/**
 * WP-CI.RES.7 §4.5 — Reference-data validator.
 *
 * Pre-flight: confirms reference tables are populated before fixture
 * generation. If any check fails, exits with a clear error message and
 * the CI job fails before test execution — no silent false-pass.
 *
 * Spec: wp-ci-res7-staging-data-strategy-spec.md §4.5.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/supabase/types/database.types';

interface ValidationCheck {
  table: string;
  minRows: number;
  description: string;
}

const CHECKS: ValidationCheck[] = [
  {
    table: 'taxonomy_domains',
    minRows: 5,
    description: 'minimum for fixture distribution across domains',
  },
  {
    table: 'taxonomy_subtopics',
    minRows: 10,
    description: 'minimum for fixture subtopic assignment',
  },
  {
    table: 'layer_vocabulary',
    minRows: 1,
    description: 'at least one layer key for validate_layer_key()',
  },
  {
    table: 'guides',
    minRows: 1,
    description: 'at least one guide for guide-matching tests',
  },
  {
    table: 'user_roles',
    minRows: 3,
    description: 'TEST_USER_{1,2,3} role assignments',
  },
];

export interface ValidationResult {
  ok: boolean;
  failures: string[];
}

/**
 * Validate that reference tables are sufficiently populated for fixture
 * generation. Returns a result object; the caller decides whether to
 * throw or exit.
 */
export async function validateReferenceData(
  client: SupabaseClient<Database>,
): Promise<ValidationResult> {
  const failures: string[] = [];

  for (const check of CHECKS) {
    const { count, error } = await client
      .from(check.table as keyof Database['public']['Tables'])
      .select('*', { count: 'exact', head: true });

    if (error) {
      failures.push(`${check.table}: query failed — ${error.message}`);
      continue;
    }

    if ((count ?? 0) < check.minRows) {
      failures.push(
        `${check.table}: expected >= ${check.minRows} rows, got ${count ?? 0} (${check.description})`,
      );
    }
  }

  return { ok: failures.length === 0, failures };
}
