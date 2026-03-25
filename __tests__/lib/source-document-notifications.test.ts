import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  type MockSupabaseClient,
} from '../helpers/mock-supabase';
import { sendSourceDocumentUpdateNotifications } from '@/lib/source-document-notifications';
import type { ImpactAnalysis } from '@/lib/source-document-impact';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/supabase/types/database.types';

// Mock the notifications module
const mockCreateNotification = vi.fn().mockResolvedValue({ error: null });

vi.mock('@/lib/notifications', () => ({
  createNotification: (...args: unknown[]) => mockCreateNotification(...args),
}));

describe('sendSourceDocumentUpdateNotifications', () => {
  let mockClient: MockSupabaseClient;
  let supabase: SupabaseClient<Database>;

  const baseImpact: ImpactAnalysis = {
    document_id: 'new-doc-1',
    document_filename: 'bid-library-v2.docx',
    previous_version_id: 'old-doc-1',
    total_affected_items: 2,
    items: [
      {
        content_item_id: 'item-1',
        content_item_title: 'ISO certification',
        impact_type: 'needs_update',
        diff_detail: 'Q&A pair modified: "What is our ISO certification?"',
      },
      {
        content_item_id: 'item-2',
        content_item_title: 'Health and safety policy',
        impact_type: 'source_removed',
        diff_detail: 'Q&A pair removed: "What is our H&S policy?"',
      },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = createMockSupabaseClient();
    supabase = mockClient as unknown as SupabaseClient<Database>;
  });

  it('sends notifications to content owners of affected items', async () => {
    // Query for content items with owners
    mockClient._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: [
            { id: 'item-1', content_owner_id: 'owner-1' },
            { id: 'item-2', content_owner_id: 'owner-1' },
          ],
          error: null,
        }),
    );

    await sendSourceDocumentUpdateNotifications(
      supabase,
      baseImpact,
      'new-doc-1',
    );

    expect(mockCreateNotification).toHaveBeenCalledTimes(1);
    expect(mockCreateNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'owner-1',
        type: 'source_document_updated',
        entityType: 'source_document',
        entityId: 'new-doc-1',
        title: 'Source document updated \u2014 diff available',
        message: expect.stringContaining('bid-library-v2.docx was updated'),
      }),
    );
  });

  it('sends separate notifications to different owners', async () => {
    // Two items owned by different people
    mockClient._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: [
            { id: 'item-1', content_owner_id: 'owner-1' },
            { id: 'item-2', content_owner_id: 'owner-2' },
          ],
          error: null,
        }),
    );

    await sendSourceDocumentUpdateNotifications(
      supabase,
      baseImpact,
      'new-doc-1',
    );

    expect(mockCreateNotification).toHaveBeenCalledTimes(2);

    // First owner gets notification about 1 item
    expect(mockCreateNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'owner-1',
        message: expect.stringContaining('1 of your KB item may need reviewing.'),
      }),
    );

    // Second owner gets notification about 1 item
    expect(mockCreateNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'owner-2',
        message: expect.stringContaining('1 of your KB item may need reviewing.'),
      }),
    );
  });

  it('falls back to admin notifications when no owners exist', async () => {
    // Content items with no owners
    mockClient._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: [
            { id: 'item-1', content_owner_id: null },
            { id: 'item-2', content_owner_id: null },
          ],
          error: null,
        }),
    );

    // Admin lookup
    mockClient._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: [
            { user_id: 'admin-1' },
            { user_id: 'admin-2' },
          ],
          error: null,
        }),
    );

    await sendSourceDocumentUpdateNotifications(
      supabase,
      baseImpact,
      'new-doc-1',
    );

    expect(mockCreateNotification).toHaveBeenCalledTimes(2);
    expect(mockCreateNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'admin-1',
        type: 'source_document_updated',
        title: 'Source document updated \u2014 diff available',
        message: expect.stringContaining('2 KB items may need reviewing.'),
      }),
    );
    expect(mockCreateNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'admin-2',
      }),
    );
  });

  it('does not send notifications when there are no affected items', async () => {
    const emptyImpact: ImpactAnalysis = {
      ...baseImpact,
      total_affected_items: 0,
      items: [],
    };

    await sendSourceDocumentUpdateNotifications(
      supabase,
      emptyImpact,
      'new-doc-1',
    );

    expect(mockCreateNotification).not.toHaveBeenCalled();
  });

  it('uses correct singular/plural in notification message', async () => {
    const singleItemImpact: ImpactAnalysis = {
      ...baseImpact,
      total_affected_items: 1,
      items: [baseImpact.items[0]],
    };

    // One item with an owner
    mockClient._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: [{ id: 'item-1', content_owner_id: 'owner-1' }],
          error: null,
        }),
    );

    await sendSourceDocumentUpdateNotifications(
      supabase,
      singleItemImpact,
      'new-doc-1',
    );

    expect(mockCreateNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('1 of your KB item may need reviewing.'),
      }),
    );
    // Should NOT contain "items" (plural) — note: "items" should not appear before the period
    const message = mockCreateNotification.mock.calls[0][0].message as string;
    expect(message).toContain('item may need reviewing.');
    expect(message).not.toContain('items may need reviewing.');
    // Message should end with "Click to review changes."
    expect(message).toMatch(/Click to review changes\.$/);
  });

  it('includes document filename in notification message', async () => {
    // One item with an owner
    mockClient._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: [{ id: 'item-1', content_owner_id: 'owner-1' }],
          error: null,
        }),
    );

    await sendSourceDocumentUpdateNotifications(
      supabase,
      {
        ...baseImpact,
        document_filename: 'company-qa-library.docx',
        total_affected_items: 1,
        items: [baseImpact.items[0]],
      },
      'new-doc-1',
    );

    const message = mockCreateNotification.mock.calls[0][0].message;
    expect(message).toContain('company-qa-library.docx');
  });

  it('notification title contains "diff available" (Phase 3.3)', async () => {
    mockClient._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: [{ id: 'item-1', content_owner_id: 'owner-1' }],
          error: null,
        }),
    );

    await sendSourceDocumentUpdateNotifications(
      supabase,
      {
        ...baseImpact,
        total_affected_items: 1,
        items: [baseImpact.items[0]],
      },
      'new-doc-1',
    );

    const call = mockCreateNotification.mock.calls[0][0];
    expect(call.title).toBe('Source document updated \u2014 diff available');
  });

  it('notification message ends with "Click to review changes." (Phase 3.3)', async () => {
    mockClient._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: [
            { id: 'item-1', content_owner_id: 'owner-1' },
            { id: 'item-2', content_owner_id: 'owner-1' },
          ],
          error: null,
        }),
    );

    await sendSourceDocumentUpdateNotifications(
      supabase,
      baseImpact,
      'new-doc-1',
    );

    const call = mockCreateNotification.mock.calls[0][0];
    expect(call.message).toMatch(/Click to review changes\.$/);
  });
});
