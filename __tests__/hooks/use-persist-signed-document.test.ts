/**
 * usePersistSignedDocument hook tests — ID-147 {147.14} E-Signature fork
 * persistence glue (TECH.md §5 "onSigned persistence callback"; PRODUCT.md
 * §F3). Binds to the EXISTING hardened attachment-upload path
 * (`POST /api/procurement/[id]/attachments`, ID-147.8 — TECH.md §1 step 5
 * "e-signature persist binds to our existing hardened path") rather than
 * writing to Supabase directly from the client, matching the house
 * convention proven by `hooks/use-file-upload-pipeline.ts`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { createQueryWrapper } from '../helpers/query-wrapper';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();
global.fetch = mockFetch;

// ---------------------------------------------------------------------------
// Import under test — after global mocks are in place
// ---------------------------------------------------------------------------

import { usePersistSignedDocument } from '@/components/procurement/extend/use-persist-signed-document';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderPersistHook() {
  const { Wrapper } = createQueryWrapper();
  return renderHook(() => usePersistSignedDocument(), { wrapper: Wrapper });
}

const FORM_ID = 'a1b2c3d4-0000-4000-8000-000000000001';

function attachmentRowResponse(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    status: 201,
    json: vi.fn().mockResolvedValue({
      id: 'att-uuid-1',
      form_instance_id: FORM_ID,
      engagement_group_id: null,
      role: 'form_source',
      filename: 'signed-document.pdf',
      storage_path: `${FORM_ID}/attachments/att-uuid-1-signed-document.pdf`,
      mime_type: 'application/pdf',
      file_size: 4,
      created_by: 'user-1',
      created_at: '2026-07-16T00:00:00.000Z',
      ...overrides,
    }),
  };
}

function forbiddenResponse() {
  return {
    ok: false,
    status: 403,
    json: vi
      .fn()
      .mockResolvedValue({ error: 'Insufficient role for this action.' }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFetch.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('usePersistSignedDocument', () => {
  it('POSTs the signed PDF as a form-scoped, role=form_source attachment', async () => {
    mockFetch.mockResolvedValueOnce(attachmentRowResponse());
    const { result } = renderPersistHook();

    result.current.mutate({
      formId: FORM_ID,
      pdfBytes: new Uint8Array([1, 2, 3, 4]),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/procurement/${FORM_ID}/attachments`);
    expect(init.method).toBe('POST');

    const body = init.body as FormData;
    expect(body.get('role')).toBe('form_source');
    // No engagement_group_id -- the route treats an omitted body param as
    // form-scoped (form_instance_id = [id]), satisfying the
    // form_attachments_form_source_scoped CHECK.
    expect(body.get('engagement_group_id')).toBeNull();
    const filePart = body.get('file');
    expect(filePart).toBeInstanceOf(Blob);
    expect((filePart as Blob).type).toBe('application/pdf');
  });

  it('resolves with the persisted form_attachments row (role=form_source, form_instance_id set)', async () => {
    mockFetch.mockResolvedValueOnce(attachmentRowResponse());
    const { result } = renderPersistHook();

    result.current.mutate({
      formId: FORM_ID,
      pdfBytes: new Uint8Array([1, 2, 3, 4]),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toMatchObject({
      role: 'form_source',
      form_instance_id: FORM_ID,
      storage_path: expect.stringContaining(FORM_ID),
    });
  });

  it('surfaces the server error message on a gated (403) rejection', async () => {
    mockFetch.mockResolvedValueOnce(forbiddenResponse());
    const { result } = renderPersistHook();

    result.current.mutate({
      formId: FORM_ID,
      pdfBytes: new Uint8Array([1, 2, 3, 4]),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe(
      'Insufficient role for this action.',
    );
  });

  it('uses a stable default filename when none is provided', async () => {
    mockFetch.mockResolvedValueOnce(attachmentRowResponse());
    const { result } = renderPersistHook();

    result.current.mutate({
      formId: FORM_ID,
      pdfBytes: new Uint8Array([1, 2, 3, 4]),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = init.body as FormData;
    const filePart = body.get('file') as File;
    expect(filePart.name).toBe('signed-document.pdf');
  });
});
