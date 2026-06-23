/**
 * Per-touchpoint grounding-shape conformance (B-INV-35 / ID-71.17).
 *
 * Drives each lib/ai touchpoint with a mocked Anthropic client and asserts the
 * request shape sent to the provider matches the grounding shape declared in
 * `lib/ai/grounding.ts`:
 *   - forced_tool_strict → forced `tool_choice` + every tool has `strict: true`
 *     and a recursively closed (`additionalProperties: false`) `input_schema`
 *   - structured_output  → `output_config.format`, no `tools`
 *   - the hard rule: NO call combines `citations` (search_result) with
 *     `output_config.format`
 *
 * The request shape is the observable contract with the Anthropic API, so these
 * are behaviour assertions, not implementation-coupling.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock('@/lib/anthropic', () => ({
  getAnthropicClient: vi.fn(() => ({
    messages: { create: mockCreate, stream: vi.fn() },
  })),
  getAIModel: vi.fn(() => 'claude-sonnet-4-6'),
  getModelForTier: vi.fn(() => 'claude-sonnet-4-6'),
  estimateCost: vi.fn(() => 0.001),
}));

import {
  generateSearchQueries,
  extractTenderMetadata,
} from '@/lib/domains/procurement/ai/extract-questions';
import { callSummaryAI } from '@/lib/ai/summarise';

/** Recursively assert every object node closes additionalProperties. */
function assertClosed(schema: unknown, path = 'input_schema'): void {
  if (!schema || typeof schema !== 'object') return;
  const node = schema as Record<string, unknown>;
  if (node.type === 'object') {
    expect(
      node.additionalProperties,
      `${path} object node does not set additionalProperties:false`,
    ).toBe(false);
    const props = node.properties as Record<string, unknown> | undefined;
    if (props) {
      for (const [k, child] of Object.entries(props)) {
        assertClosed(child, `${path}.properties.${k}`);
      }
    }
  }
  if (node.type === 'array' && node.items)
    assertClosed(node.items, `${path}.items`);
}

/** Assert a captured request honours the forced_tool_strict contract. */
function assertForcedToolStrict(call: Record<string, unknown>): void {
  expect(
    call.tool_choice,
    'forced_tool_strict requires a forced tool_choice',
  ).toMatchObject({
    type: 'tool',
  });
  expect(
    call.output_config,
    'forced_tool_strict must not set output_config',
  ).toBeUndefined();
  const tools = call.tools as Array<Record<string, unknown>>;
  expect(Array.isArray(tools) && tools.length > 0).toBe(true);
  for (const tool of tools) {
    expect(tool.strict, `tool ${String(tool.name)} must set strict:true`).toBe(
      true,
    );
    assertClosed(tool.input_schema, `${String(tool.name)}.input_schema`);
  }
}

/** The hard rule that applies to every touchpoint. */
function assertNoCitationStructuredCombo(call: Record<string, unknown>): void {
  const hasStructured = call.output_config !== undefined;
  const content = call.messages
    ? (call.messages as Array<{ content: unknown }>).flatMap((m) =>
        Array.isArray(m.content) ? m.content : [],
      )
    : [];
  const hasCitations = (content as Array<Record<string, unknown>>).some(
    (b) => b.type === 'search_result',
  );
  expect(
    hasStructured && hasCitations,
    'citations and output_config.format must never be combined',
  ).toBe(false);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('forced_tool_strict touchpoints', () => {
  it('generateSearchQueries forces a strict, closed tool', async () => {
    mockCreate.mockResolvedValueOnce({
      stop_reason: 'tool_use',
      content: [
        {
          type: 'tool_use',
          name: 'search_queries',
          input: {
            queries: ['a', 'b', 'c'],
            primary_topic: 'security',
            content_types_needed: ['policy'],
          },
        },
      ],
      usage: { input_tokens: 10, output_tokens: 10 },
    });

    await generateSearchQueries('Describe your security approach');

    const call = mockCreate.mock.calls[0][0];
    assertForcedToolStrict(call);
    assertNoCitationStructuredCombo(call);
  });

  it('extractTenderMetadata forces a strict, closed tool', async () => {
    mockCreate.mockResolvedValueOnce({
      stop_reason: 'tool_use',
      content: [
        {
          type: 'tool_use',
          name: 'extract_tender_metadata',
          input: {
            buyer_name: 'Council',
            deadline: null,
            reference_number: null,
            estimated_value: null,
            title: null,
            confidence: 0.5,
          },
        },
      ],
      usage: { input_tokens: 10, output_tokens: 10 },
    });

    await extractTenderMetadata('<p>Tender doc</p>', 'html');

    const call = mockCreate.mock.calls[0][0];
    assertForcedToolStrict(call);
    assertNoCitationStructuredCombo(call);
  });

  it('callSummaryAI forces a strict, closed tool', async () => {
    mockCreate.mockResolvedValueOnce({
      stop_reason: 'tool_use',
      content: [
        {
          type: 'tool_use',
          name: 'return_summary',
          input: {
            executive: 'A short summary.',
            detailed: 'A longer summary across a couple of sentences.',
            takeaways: ['one', 'two', 'three'],
          },
        },
      ],
      usage: { input_tokens: 10, output_tokens: 10 },
    });

    await callSummaryAI({
      content: 'Some content to summarise that is long enough to be useful.',
      title: 'Doc',
      contentType: 'article',
      domain: 'tech',
    });

    const call = mockCreate.mock.calls[0][0];
    assertForcedToolStrict(call);
    assertNoCitationStructuredCombo(call);
  });
});
