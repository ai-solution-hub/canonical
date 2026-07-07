/**
 * ID-130 {130.27} — `resolveOrMintFormTemplateId()` unit tests.
 *
 * This helper is the single write-time resolution point every
 * `form_questions` insert/upsert site calls to stamp `form_template_id`,
 * fixing the NULL-drift bug where extraction/manual-add rows kept
 * `form_template_id` NULL and were silently dropped from the win-rate RPCs'
 * and `outcome/route.ts`'s INNER JOIN on that column.
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
  it('returns the existing (earliest) form_templates id without minting when one is found', async () => {
    const supabase = createMockSupabaseTable({
      data: [{ id: 'ft-existing' }],
      error: null,
    });

    const result = await resolveOrMintFormTemplateId(
      supabase as unknown as SupabaseClient<Database>,
      WORKSPACE_ID,
      MINT_DEFAULTS,
    );

    expect(result).toBe('ft-existing');
    expect(supabase._chain.insert).not.toHaveBeenCalled();
    // Resolution reads the earliest-created row for the workspace.
    expect(supabase._chain.eq).toHaveBeenCalledWith(
      'workspace_id',
      WORKSPACE_ID,
    );
    expect(supabase._chain.order).toHaveBeenCalledWith('created_at', {
      ascending: true,
    });
  });

  it('mints a form_templates row when the workspace has none, and returns the minted id', async () => {
    const supabase = createMockSupabaseTable({ data: [], error: null });
    supabase._chain.single.mockResolvedValueOnce({
      data: { id: 'ft-minted' },
      error: null,
    });

    const result = await resolveOrMintFormTemplateId(
      supabase as unknown as SupabaseClient<Database>,
      WORKSPACE_ID,
      MINT_DEFAULTS,
    );

    expect(result).toBe('ft-minted');
    expect(supabase._chain.insert).toHaveBeenCalledTimes(1);
    const insertArg = supabase._chain.insert.mock.calls[0][0];
    expect(insertArg).toMatchObject({
      workspace_id: WORKSPACE_ID,
      name: MINT_DEFAULTS.name,
      filename: MINT_DEFAULTS.filename,
      storage_path: MINT_DEFAULTS.storagePath,
      file_size: MINT_DEFAULTS.fileSize,
      mime_type: MINT_DEFAULTS.mimeType,
      created_by: MINT_DEFAULTS.createdBy,
      // Documented mint convention (module doc): non-pipeline, UI-originated
      // rows use ingest_source='app_upload'; form_type defaults to 'bid' so a
      // later won/lost outcome record passes the cross-check trigger without
      // a separate type-picker step.
      form_type: 'bid',
      ingest_source: 'app_upload',
    });
  });

  it('mints with a null created_by for script/system callers with no user context', async () => {
    const supabase = createMockSupabaseTable({ data: [], error: null });
    supabase._chain.single.mockResolvedValueOnce({
      data: { id: 'ft-minted-script' },
      error: null,
    });

    const result = await resolveOrMintFormTemplateId(
      supabase as unknown as SupabaseClient<Database>,
      WORKSPACE_ID,
      { ...MINT_DEFAULTS, createdBy: null },
    );

    expect(result).toBe('ft-minted-script');
    const insertArg = supabase._chain.insert.mock.calls[0][0];
    expect(insertArg.created_by).toBeNull();
  });

  it('throws when the resolve (select) query fails', async () => {
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

  it('throws when the mint insert fails', async () => {
    const supabase = createMockSupabaseTable({ data: [], error: null });
    supabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { message: 'insert violates check constraint' },
    });

    await expect(
      resolveOrMintFormTemplateId(
        supabase as unknown as SupabaseClient<Database>,
        WORKSPACE_ID,
        MINT_DEFAULTS,
      ),
    ).rejects.toThrow('insert violates check constraint');
  });
});
