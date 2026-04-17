/**
 * Batch route redirect test
 *
 * Verifies that /item/new/batch permanently redirects to /item/new?tab=batch.
 */
import { describe, it, expect, vi } from 'vitest';

const { mockPermanentRedirect } = vi.hoisted(() => ({
  mockPermanentRedirect: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  permanentRedirect: mockPermanentRedirect,
}));

import BatchCreatePage from '@/app/item/new/batch/page';

describe('/item/new/batch redirect', () => {
  it('calls permanentRedirect with /item/new?tab=batch (HTTP 308)', () => {
    BatchCreatePage();

    expect(mockPermanentRedirect).toHaveBeenCalledWith('/item/new?tab=batch');
    expect(mockPermanentRedirect).toHaveBeenCalledTimes(1);
  });
});
