import { describe, it, expect, vi } from 'vitest';

// roles.ts imports createClient at module level — mock it to avoid server deps
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

import { canEdit, canAdmin } from '@/lib/roles';

// ---------------------------------------------------------------------------
// canEdit
// ---------------------------------------------------------------------------

describe('canEdit', () => {
  it('returns true for admin', () => {
    expect(canEdit('admin')).toBe(true);
  });

  it('returns true for editor', () => {
    expect(canEdit('editor')).toBe(true);
  });

  it('returns false for viewer', () => {
    expect(canEdit('viewer')).toBe(false);
  });

  it('returns false for null (unauthenticated)', () => {
    expect(canEdit(null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// canAdmin
// ---------------------------------------------------------------------------

describe('canAdmin', () => {
  it('returns true for admin', () => {
    expect(canAdmin('admin')).toBe(true);
  });

  it('returns false for editor', () => {
    expect(canAdmin('editor')).toBe(false);
  });

  it('returns false for viewer', () => {
    expect(canAdmin('viewer')).toBe(false);
  });

  it('returns false for null (unauthenticated)', () => {
    expect(canAdmin(null)).toBe(false);
  });
});
