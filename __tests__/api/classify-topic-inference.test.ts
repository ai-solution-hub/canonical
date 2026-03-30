/**
 * Tests for topic inference wiring in the classify route.
 * Suite 3 of the data flow integration test Phase 2.
 *
 * Verifies that the POST /api/items/:id/classify route correctly
 * calls suggestTopic after classification and merges the topic_id
 * into item metadata.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import {
  createMockSupabaseClient,
  type MockSupabaseClient,
} from '../helpers/mock-supabase';

// ── Mock setup ──────────────────────────────────────────────────────

const mockSuggestTopic = vi.fn();

const { mockClassifyContent } = vi.hoisted(() => ({
  mockClassifyContent: vi.fn(),
}));

vi.mock('@/lib/ai/classify', () => ({
  classifyContent: mockClassifyContent,
}));

vi.mock('@/lib/ai/errors', () => ({
  AIServiceError: class AIServiceError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));

vi.mock('@/lib/topic-inference', () => ({
  suggestTopic: (...args: unknown[]) => mockSuggestTopic(...args),
}));

let mockClient: MockSupabaseClient;

vi.mock('@/lib/auth', () => ({
  getAuthorisedClient: vi.fn(async () => ({
    success: true,
    user: { id: 'user-1234-5678-9abc-def012345678' },
    supabase: null as unknown, // replaced per test
  })),
  authFailureResponse: vi.fn(),
  rateLimitResponse: vi.fn(),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(() => ({ allowed: true })),
}));

vi.mock('@/lib/validation', () => ({
  parseBody: vi.fn((_schema: unknown, data: unknown) => ({
    success: true,
    data: data as { force: boolean },
  })),
}));

vi.mock('@/lib/error', () => ({
  safeErrorMessage: (_err: unknown, fallback: string) => fallback,
}));

import { getAuthorisedClient } from '@/lib/auth';

const itemId = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';

function buildRequest(body: Record<string, unknown> = { force: true }) {
  return new NextRequest(`http://localhost:3000/api/items/${itemId}/classify`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

describe('classify route — topic inference wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = createMockSupabaseClient();

    // Wire mock client into auth
    vi.mocked(getAuthorisedClient).mockResolvedValue({
      success: true,
      user: { id: 'user-1234-5678-9abc-def012345678' } as never,
      supabase: mockClient as never,
    } as never);

    // Default classification result with domain/subtopic
    mockClassifyContent.mockResolvedValue({
      primary_domain: 'security',
      primary_subtopic: 'certifications',
      ai_keywords: ['ISO 27001'],
      ai_summary: 'Test summary',
      suggested_title: 'Test title',
      classification_confidence: 0.95,
      classification_reasoning: 'Test reasoning',
    });

    // The route handler calls .single() to fetch the content item for topic inference
    // This needs to be a persistent default since the mock chain is shared
    mockClient._chain.single.mockResolvedValue({
      data: { title: 'Test Item', layer: 'reference' },
      error: null,
    });
  });

  // Dynamically import route handler to pick up mocks
  async function callRoute() {
    const { POST } = await import('@/app/api/items/[id]/classify/route');
    return POST(buildRequest(), { params: Promise.resolve({ id: itemId }) });
  }

  it('T3.1: classification route calls suggestTopic after classify', async () => {
    mockSuggestTopic.mockResolvedValue({ topicId: 'topic-abc' });

    await callRoute();

    expect(mockSuggestTopic).toHaveBeenCalledWith(
      mockClient,
      expect.objectContaining({
        primaryDomain: 'security',
        primarySubtopic: 'certifications',
        title: 'Test Item',
      }),
    );
  });

  it('T3.2: classification route merges topic_id into metadata via RPC', async () => {
    mockSuggestTopic.mockResolvedValue({ topicId: 'topic-xyz' });

    await callRoute();

    expect(mockClient.rpc).toHaveBeenCalledWith('merge_item_metadata', {
      p_item_id: itemId,
      p_new_data: { topic_id: 'topic-xyz' },
    });
  });

  it('T3.3: suggestTopic returning null skips metadata merge', async () => {
    mockSuggestTopic.mockResolvedValue(null);

    const response = await callRoute();

    // Should still return 200 — classification succeeded
    expect(response.status).toBe(200);
    expect(mockClient.rpc).not.toHaveBeenCalledWith(
      'merge_item_metadata',
      expect.anything(),
    );
  });

  it('T3.4: suggestTopic failure is non-fatal', async () => {
    mockSuggestTopic.mockRejectedValue(new Error('Topic inference exploded'));

    const response = await callRoute();

    // Should still return 200 — classification itself succeeded
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.primary_domain).toBe('security');
  });
});
