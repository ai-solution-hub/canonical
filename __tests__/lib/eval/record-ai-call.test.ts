/**
 * Behaviour tests for `recordAiCall()` (ID-104.10 / T14, B-INV-14/16).
 *
 * Asserts the single AI-call capture point writes an `ai_call_events` row
 * keyed by `touchpoint_id`, carrying a ratified `outcome_signal`, the model +
 * tier, the token/cache counts off the Anthropic `usage` surface, and a
 * `cost_usd` derived via the EXISTING `estimateCost` path (not reimplemented).
 *
 * Mock discipline: shared `createMockSupabaseClient()` — no live DB.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { recordAiCall } from '@/lib/eval/record-ai-call';
import { estimateCost, type TokenUsage } from '@/lib/anthropic';
import {
  createMockSupabaseClient,
  type MockSupabaseClient,
} from '@/__tests__/helpers/mock-supabase';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/supabase/types/database.types';

const ROW_ID = '11111111-1111-4111-8111-111111111111';

function asClient(mock: MockSupabaseClient): SupabaseClient<Database> {
  // The shared mock is structurally a SupabaseClient for the surface used here
  // (`from(...).insert(...).select(...).single()`); cast at the test boundary.
  return mock as unknown as SupabaseClient<Database>;
}

describe('recordAiCall — single AI-call cost/signal capture (T14)', () => {
  let supabase: MockSupabaseClient;

  beforeEach(() => {
    supabase = createMockSupabaseClient();
    supabase._chain.single.mockResolvedValue({
      data: { id: ROW_ID },
      error: null,
    });
  });

  const baseUsage: TokenUsage = {
    input_tokens: 1_000,
    output_tokens: 500,
    cache_creation_input_tokens: 200,
    cache_read_input_tokens: 100,
  };

  it('writes one ai_call_events row keyed by touchpoint_id', async () => {
    const result = await recordAiCall({
      supabase: asClient(supabase),
      touchpointId: 'find_duplicates',
      model: 'claude-sonnet-4-6',
      tier: 'analysis',
      usage: baseUsage,
      outcomeSignal: 'win',
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.id).toBe(ROW_ID);

    // Targets the persisted store (M4).
    expect(supabase.from).toHaveBeenCalledWith('ai_call_events');
    expect(supabase._chain.insert).toHaveBeenCalledTimes(1);

    const payload = supabase._chain.insert.mock.calls[0][0];
    expect(payload.touchpoint_id).toBe('find_duplicates');
    expect(payload.outcome_signal).toBe('win');
  });

  it('maps Anthropic usage fields onto the DB cache column names', async () => {
    await recordAiCall({
      supabase: asClient(supabase),
      touchpointId: 'classify_content',
      model: 'claude-sonnet-4-6',
      tier: 'analysis',
      usage: baseUsage,
      outcomeSignal: 'fail',
    });

    const payload = supabase._chain.insert.mock.calls[0][0];
    expect(payload.input_tokens).toBe(1_000);
    expect(payload.output_tokens).toBe(500);
    // Anthropic cache_creation_input_tokens -> DB cache_write_tokens
    expect(payload.cache_write_tokens).toBe(200);
    // Anthropic cache_read_input_tokens -> DB cache_read_tokens
    expect(payload.cache_read_tokens).toBe(100);
    expect(payload.model).toBe('claude-sonnet-4-6');
    expect(payload.tier).toBe('analysis');
  });

  it('derives cost_usd via the existing estimateCost path (not reimplemented)', async () => {
    const model = 'claude-sonnet-4-6';
    await recordAiCall({
      supabase: asClient(supabase),
      touchpointId: 'draft_response',
      model,
      tier: 'drafting',
      usage: baseUsage,
      outcomeSignal: 'win',
    });

    const payload = supabase._chain.insert.mock.calls[0][0];
    // The exact value must equal estimateCost — proves we reuse, not reimplement.
    expect(payload.cost_usd).toBeCloseTo(estimateCost(model, baseUsage), 12);
  });

  it('defaults absent cache token counts to zero', async () => {
    await recordAiCall({
      supabase: asClient(supabase),
      touchpointId: 'summarise',
      model: 'claude-haiku-4-5',
      tier: 'quality',
      usage: { input_tokens: 10, output_tokens: 5 },
      outcomeSignal: 'loop',
    });

    const payload = supabase._chain.insert.mock.calls[0][0];
    expect(payload.cache_read_tokens).toBe(0);
    expect(payload.cache_write_tokens).toBe(0);
  });

  it('accepts every ratified outcome signal (win|fail|loop|refusal)', async () => {
    for (const signal of ['win', 'fail', 'loop', 'refusal'] as const) {
      supabase = createMockSupabaseClient();
      supabase._chain.single.mockResolvedValue({
        data: { id: ROW_ID },
        error: null,
      });
      const result = await recordAiCall({
        supabase: asClient(supabase),
        touchpointId: 'tp',
        model: 'claude-sonnet-4-6',
        tier: 'analysis',
        usage: { input_tokens: 1, output_tokens: 1 },
        outcomeSignal: signal,
      });
      expect(result.ok).toBe(true);
      expect(supabase._chain.insert.mock.calls[0][0].outcome_signal).toBe(
        signal,
      );
    }
  });

  it('rejects an unratified outcome signal before touching the DB', async () => {
    const result = await recordAiCall({
      supabase: asClient(supabase),
      touchpointId: 'tp',
      model: 'claude-sonnet-4-6',
      tier: 'analysis',
      usage: { input_tokens: 1, output_tokens: 1 },
      // @ts-expect-error — exercising the runtime guard with an invalid value.
      outcomeSignal: 'success',
    });

    expect(result.ok).toBe(false);
    // No row is written when the signal is not ratified.
    expect(supabase._chain.insert).not.toHaveBeenCalled();
  });

  it('returns a partial-failure Result (does not throw) when the insert fails', async () => {
    supabase._chain.single.mockResolvedValue({
      data: null,
      error: {
        message: 'insert failed',
        code: 'XX000',
        details: '',
        hint: '',
      },
    });

    const result = await recordAiCall({
      supabase: asClient(supabase),
      touchpointId: 'tp',
      model: 'claude-sonnet-4-6',
      tier: 'analysis',
      usage: { input_tokens: 1, output_tokens: 1 },
      outcomeSignal: 'refusal',
    });

    // Recording must never crash the calling AI flow — surfaced as Result, not a throw.
    expect(result.ok).toBe(false);
  });
});
