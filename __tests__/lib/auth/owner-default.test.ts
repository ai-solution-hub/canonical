/**
 * Upload route — content_owner_id default + admin override.
 *
 * S206 WP-A Phase 2 (AC3.1, AC3.3, AC3.8).
 *
 * The upload route reads `content_owner_id` from multipart formData and
 * routes it through `resolveContentOwnerId()` before the inline
 * content_items insert at app/api/upload/route.ts (POST handler). This
 * file exercises the helper directly with the same input shape the route
 * uses, plus an end-to-end formData parse to confirm field handling.
 *
 * Rationale for not mocking the full upload route handler: the route has
 * ~50 collaborators (PDF/DOCX extraction, mammoth, dedup, pipeline_runs,
 * chunking, AI classify+summarise, layer/topic suggestion, quality score,
 * storage upload, etc.). The owner-default change is a 3-line addition;
 * the existing E2E suite covers the route-level happy path.
 */
import { describe, it, expect } from 'vitest';
import { resolveContentOwnerId } from '@/lib/auth/owner-default';

const CALLER_USER_ID = '00000000-0000-4000-8000-000000000aaa';
const OTHER_OWNER_UUID = '11111111-2222-4333-8444-555555555555';

describe('Upload route — content_owner_id resolution (S206 WP-A Phase 2)', () => {
  it('defaults to caller userId when form field is absent (editor)', () => {
    // Mirrors `formData.get('content_owner_id')` returning null
    const result = resolveContentOwnerId({
      explicit: null,
      role: 'editor',
      userId: CALLER_USER_ID,
    });
    expect(result).toBe(CALLER_USER_ID);
  });

  it('defaults to caller userId when form field is empty string (editor)', () => {
    const result = resolveContentOwnerId({
      explicit: '',
      role: 'editor',
      userId: CALLER_USER_ID,
    });
    expect(result).toBe(CALLER_USER_ID);
  });

  it('admin override: explicit content_owner_id is respected', () => {
    const result = resolveContentOwnerId({
      explicit: OTHER_OWNER_UUID,
      role: 'admin',
      userId: CALLER_USER_ID,
    });
    expect(result).toBe(OTHER_OWNER_UUID);
  });

  it('non-admin override is silent-forced: explicit value ignored for editor', () => {
    const result = resolveContentOwnerId({
      explicit: OTHER_OWNER_UUID,
      role: 'editor',
      userId: CALLER_USER_ID,
    });
    expect(result).toBe(CALLER_USER_ID);
  });

  it('admin without explicit override falls back to caller userId', () => {
    const result = resolveContentOwnerId({
      explicit: null,
      role: 'admin',
      userId: CALLER_USER_ID,
    });
    expect(result).toBe(CALLER_USER_ID);
  });

  it('viewer role (defensive) silent-forces to caller userId', () => {
    // Upload route gates to ['admin', 'editor'] so viewer can't reach
    // here in production, but the helper must remain defensive.
    const result = resolveContentOwnerId({
      explicit: OTHER_OWNER_UUID,
      role: 'viewer',
      userId: CALLER_USER_ID,
    });
    expect(result).toBe(CALLER_USER_ID);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// FormData round-trip: confirm the same shape the route consumes
// ─────────────────────────────────────────────────────────────────────────

describe('Upload route — formData content_owner_id field round-trip', () => {
  it('reads content_owner_id from FormData as a string', async () => {
    const fd = new FormData();
    fd.set('file', new Blob(['x'], { type: 'text/plain' }), 'x.txt');
    fd.set('content_owner_id', OTHER_OWNER_UUID);

    // Same accessor pattern the route uses
    const value = fd.get('content_owner_id') as string | null;
    expect(typeof value).toBe('string');
    expect(value).toBe(OTHER_OWNER_UUID);
  });

  it('returns null when content_owner_id is not provided', () => {
    const fd = new FormData();
    fd.set('file', new Blob(['x'], { type: 'text/plain' }), 'x.txt');

    const value = fd.get('content_owner_id') as string | null;
    expect(value).toBeNull();
  });
});
