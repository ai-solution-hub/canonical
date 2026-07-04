/**
 * bl-46 — ingestion_quality_log_flag_type_check accepts run_quality_scan's
 * flag_type values.
 *
 * `public.run_quality_scan()` INSERTs ingestion_quality_log rows with
 * flag_type 'classification_low' (missing-domain + low-confidence branches)
 * and 'missing_content' (empty-content branch). Before migration
 * 20260626125408_bl46_quality_scan_flag_type the CHECK constraint did NOT
 * permit either value, so the first invocation against a DB holding a
 * NULL-domain (or empty-content) content_items row would abort with SQLSTATE
 * 23514 (latent — the function has no callers yet).
 *
 * This test verifies the migration's effect against the live DB, mirroring the
 * publication-status-migration constraint-probe convention: write a row with
 * the previously-rejected flag_type through the service client and assert the
 * CHECK now ACCEPTS it (no 23514), with a negative control proving the CHECK
 * is still enforced for genuinely-unknown values. source_document_id is
 * nullable, so the probe rows need no source_documents FK and are fully
 * self-contained.
 *
 * Prerequisites:
 *   - .env with NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 *   - Migration 20260626125408 applied.
 *
 * Run via: bun run test:integration -- bl46-quality-scan-flag-type
 *
 * @vitest-environment node
 */

import { afterAll, describe, expect, it } from 'vitest';
import { serviceClient } from './helpers/service-client';
import type { Database } from '@/supabase/types/database.types';

type IngestionQualityLogInsert =
  Database['public']['Tables']['ingestion_quality_log']['Insert'];

// Unique marker so cleanup only ever touches rows this test created.
const TEST_BATCH = `bl46-flag-type-test-${Date.now()}`;

// The two flag_type values run_quality_scan emits that the pre-migration CHECK
// rejected. Both must now insert cleanly.
const SCAN_FLAG_TYPES = ['classification_low', 'missing_content'] as const;

afterAll(async () => {
  // Service role bypasses RLS — remove every row this test inserted.
  await serviceClient
    .from('ingestion_quality_log')
    .delete()
    .eq('ingestion_batch', TEST_BATCH);
});

describe('ingestion_quality_log flag_type CHECK — bl-46 (live DB)', () => {
  it.each(SCAN_FLAG_TYPES)(
    "accepts run_quality_scan's flag_type=%s (no 23514)",
    async (flagType) => {
      // Cast: source_document_id exists in the DB post-migration (ID-131
      // {131.13} G-GOV-FACET-B rename) but generated types are pending
      // regen until GO-apply.
      const { data, error } = await serviceClient
        .from('ingestion_quality_log')
        .insert({
          source_document_id: null,
          flag_type: flagType,
          severity: 'info',
          ingestion_batch: TEST_BATCH,
          details: { scan_source: 'run_quality_scan', test: 'bl-46' },
        } as unknown as IngestionQualityLogInsert)
        .select('id')
        .single();

      // Pre-migration this insert failed with check_violation (23514).
      expect(error).toBeNull();
      expect(data?.id).toBeTruthy();
    },
  );

  it('still rejects a genuinely-unknown flag_type with 23514 (CHECK intact)', async () => {
    const { error } = await serviceClient
      .from('ingestion_quality_log')
      .insert({
        source_document_id: null,
        // Not a member of the allowed set — the widened CHECK must still gate.
        flag_type:
          'totally_unknown_flag_type' as unknown as 'classification_low',
        severity: 'info',
        ingestion_batch: TEST_BATCH,
      } as unknown as IngestionQualityLogInsert)
      .select('id')
      .single();

    expect(error).not.toBeNull();
    expect((error as { code?: string } | null)?.code).toBe('23514');
  });
});
