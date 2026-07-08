/**
 * ID-130 {130.27} — `resolveOrMintFormTemplateId()` unit tests.
 *
 * This helper is the single write-time resolution point every
 * `form_questions` insert/upsert site calls to stamp `form_template_id`,
 * fixing the NULL-drift bug where extraction/manual-add rows kept
 * `form_template_id` NULL and were silently dropped from the win-rate RPCs'
 * and `outcome/route.ts`'s INNER JOIN on that column.
 *
 * Checker Finding 1 remediation: the resolver used to do a client-side
 * SELECT-then-INSERT (a race window for two concurrent calls against a
 * zero-form workspace). It now issues a SINGLE atomic `.rpc()` call
 * (`resolve_or_mint_form_template_id`, workspace-scoped
 * `pg_advisory_xact_lock` — see
 * `supabase/migrations/20260708120000_id130_form_template_id_backfill_guard.sql`
 * STEP 3) — these tests assert the resolver forwards the correct RPC name +
 * params and NEVER touches `supabase.from()` directly (i.e. the client-side
 * race window is gone). The actual concurrency guarantee (the advisory
 * lock) can only be exercised against a real Postgres backend — that is
 * covered by the "race-safety" describe block in
 * `__tests__/integration/id130-form-template-id-backfill.integration.test.ts`,
 * not here.
 */
import { describe, it, expect } from 'vitest';
import { createMockSupabaseTable } from '../../helpers/mock-supabase';
import { resolveOrMintFormTemplateId } from '@/lib/domains/procurement/resolve-form-template';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/supabase/types/database.types';

const WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';

const MINT_DEFAULTS = {
  name: 'Untitled form',
  filename: 'app-created-form.pdf',
  storagePath: `app-created/${WORKSPACE_ID}/fixed-uuid`,
  fileSize: 0,
  mimeType: 'application/pdf',
  createdBy: 'test-user-id',
};

describe('resolveOrMintFormTemplateId', () => {
  it('resolves via a single atomic RPC call, forwarding workspace + mint defaults as p_-prefixed params', async () => {
    const supabase = createMockSupabaseTable({
      data: 'ft-existing',
      error: null,
    });

    const result = await resolveOrMintFormTemplateId(
      supabase as unknown as SupabaseClient<Database>,
      WORKSPACE_ID,
      MINT_DEFAULTS,
    );

    expect(result).toBe('ft-existing');
    expect(supabase.rpc).toHaveBeenCalledTimes(1);
    expect(supabase.rpc).toHaveBeenCalledWith(
      'resolve_or_mint_form_template_id',
      {
        p_workspace_id: WORKSPACE_ID,
        p_name: MINT_DEFAULTS.name,
        p_filename: MINT_DEFAULTS.filename,
        p_storage_path: MINT_DEFAULTS.storagePath,
        p_file_size: MINT_DEFAULTS.fileSize,
        p_mime_type: MINT_DEFAULTS.mimeType,
        p_created_by: MINT_DEFAULTS.createdBy,
      },
    );
    // Race-safety regression guard: the resolver must NEVER fall back to a
    // client-side `.from('form_templates')` SELECT-then-INSERT — that
    // two-step shape is exactly the race Finding 1 closed. Everything must
    // go through the single atomic RPC call above.
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('returns the RPC-minted id when the workspace had no existing form_templates row (server-side mint, not observable client-side)', async () => {
    const supabase = createMockSupabaseTable({
      data: 'ft-minted',
      error: null,
    });

    const result = await resolveOrMintFormTemplateId(
      supabase as unknown as SupabaseClient<Database>,
      WORKSPACE_ID,
      MINT_DEFAULTS,
    );

    expect(result).toBe('ft-minted');
    expect(supabase.rpc).toHaveBeenCalledTimes(1);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('forwards a null p_created_by for script/system callers with no user context', async () => {
    const supabase = createMockSupabaseTable({
      data: 'ft-minted-script',
      error: null,
    });

    const result = await resolveOrMintFormTemplateId(
      supabase as unknown as SupabaseClient<Database>,
      WORKSPACE_ID,
      { ...MINT_DEFAULTS, createdBy: null },
    );

    expect(result).toBe('ft-minted-script');
    const rpcArgs = supabase.rpc.mock.calls[0][1];
    expect(rpcArgs.p_created_by).toBeNull();
  });

  it('throws when the RPC call fails', async () => {
    const supabase = createMockSupabaseTable({
      data: null,
      error: { message: 'connection reset' },
    });

    await expect(
      resolveOrMintFormTemplateId(
        supabase as unknown as SupabaseClient<Database>,
        WORKSPACE_ID,
        MINT_DEFAULTS,
      ),
    ).rejects.toThrow('connection reset');
  });

  it('two concurrent calls against the SAME mocked RPC each resolve independently (client issues no shared mutable state that could itself race)', async () => {
    // Not a substitute for the live-DB advisory-lock test (a mock cannot
    // simulate real Postgres concurrency) — this guards against a
    // regression where the resolver reintroduces client-side state (e.g. a
    // cached/memoized lookup) that could race across concurrent callers
    // sharing one client instance.
    const supabase = createMockSupabaseTable({ data: null, error: null });
    supabase.rpc
      .mockResolvedValueOnce({ data: 'ft-race-winner', error: null })
      .mockResolvedValueOnce({ data: 'ft-race-winner', error: null });

    const client = supabase as unknown as SupabaseClient<Database>;
    const [a, b] = await Promise.all([
      resolveOrMintFormTemplateId(client, WORKSPACE_ID, MINT_DEFAULTS),
      resolveOrMintFormTemplateId(client, WORKSPACE_ID, MINT_DEFAULTS),
    ]);

    expect(a).toBe('ft-race-winner');
    expect(b).toBe('ft-race-winner');
    expect(supabase.rpc).toHaveBeenCalledTimes(2);
  });
});
