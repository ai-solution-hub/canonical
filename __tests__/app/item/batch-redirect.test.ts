/**
 * Batch route redirect test
 *
 * Verifies that /item/new/batch redirects to /item/new?tab=batch.
 */
import { describe, it, expect, vi } from 'vitest';

const { mockRedirect } = vi.hoisted(() => ({
  mockRedirect: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: mockRedirect,
}));

import BatchCreatePage from '@/app/item/new/batch/page';

describe('/item/new/batch redirect', () => {
  it('calls redirect with /item/new?tab=batch', () => {
    BatchCreatePage();

    expect(mockRedirect).toHaveBeenCalledWith('/item/new?tab=batch');
    expect(mockRedirect).toHaveBeenCalledTimes(1);
  });
});
