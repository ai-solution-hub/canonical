/**
 * Grounding-shape contract for lib/ai touchpoints (B-INV-35 / ID-71.17).
 *
 * Every AI touchpoint in lib/ai declares EXACTLY ONE grounding shape and the
 * API call it makes is consistent with that declaration:
 *   - `structured_output`   → uses `output_config.format`, no tools
 *   - `forced_tool_strict`  → forced `tool_choice` + a `strict: true` tool with
 *                             recursive `additionalProperties: false`
 *   - `citations`           → `search_result` blocks with `citations.enabled`,
 *                             never combined with `output_config.format`
 *   - `n/a`                 → no structured/citation grounding (prose or no AI call)
 *
 * The hard rule: citations and structured outputs are NEVER combined in one call.
 * draft.ts keeps its 3-pass split so Pass 2 (citations) stays separate from the
 * structured/forced passes.
 */

import { describe, it, expect } from 'vitest';
import {
  AI_TOUCHPOINT_GROUNDING,
  type AiTouchpointId,
} from '@/lib/ai/grounding';
import type { GroundingShape } from '@/lib/eval/contract';

const ALLOWED_SHAPES: GroundingShape[] = [
  'structured_output',
  'forced_tool_strict',
  'citations',
  'n/a',
];

/**
 * Recursively assert every `type: "object"` node in a JSON Schema sets
 * `additionalProperties: false` — the forced_tool_strict requirement.
 */
function assertRecursiveAdditionalPropertiesFalse(
  schema: unknown,
  path = 'input_schema',
): void {
  if (!schema || typeof schema !== 'object') return;
  const node = schema as Record<string, unknown>;

  if (node.type === 'object') {
    expect(
      node.additionalProperties,
      `${path} is type:object but does not set additionalProperties:false`,
    ).toBe(false);
    const props = node.properties as Record<string, unknown> | undefined;
    if (props) {
      for (const [key, child] of Object.entries(props)) {
        assertRecursiveAdditionalPropertiesFalse(
          child,
          `${path}.properties.${key}`,
        );
      }
    }
  }

  if (node.type === 'array' && node.items) {
    assertRecursiveAdditionalPropertiesFalse(node.items, `${path}.items`);
  }
}

describe('lib/ai grounding-shape contract (B-INV-35)', () => {
  it('declares a single valid grounding shape for every touchpoint', () => {
    for (const [id, shape] of Object.entries(AI_TOUCHPOINT_GROUNDING)) {
      expect(
        ALLOWED_SHAPES,
        `touchpoint "${id}" declares an out-of-union shape "${shape}"`,
      ).toContain(shape);
    }
  });

  it('covers all nine lib/ai touchpoints', () => {
    const expected: AiTouchpointId[] = [
      'classify.classifyContent',
      'classify.classifyText',
      'classify.validateEntities',
      'draft.analyseQuestion',
      'draft.draftResponse',
      'quality-check.runAIQualityCheck',
      'extract-questions.extractQuestions',
      'extract-questions.extractTenderMetadata',
      'extract-questions.generateSearchQueries',
      'summarise.callSummaryAI',
      'extract-content.extractStructuredContent',
      'match.assessConfidence',
      'vision.analyseVision',
      'change-reports.generateChangeReport',
    ];
    for (const id of expected) {
      expect(
        AI_TOUCHPOINT_GROUNDING,
        `missing grounding declaration for "${id}"`,
      ).toHaveProperty(id);
    }
  });

  it('declares the citation touchpoint (draft Pass 2) as citations, not structured', () => {
    expect(AI_TOUCHPOINT_GROUNDING['draft.draftResponse']).toBe('citations');
    // Pass 1 must stay a separate, non-citation shape — the 3-pass split.
    expect(AI_TOUCHPOINT_GROUNDING['draft.analyseQuestion']).toBe(
      'structured_output',
    );
  });

  // Re-export of helpers so behaviour tests in sibling files can reuse them.
  it('exposes a recursive additionalProperties:false assertion for forced_tool_strict tools', () => {
    const strictTool = {
      type: 'object',
      properties: {
        nested: {
          type: 'array',
          items: {
            type: 'object',
            properties: { name: { type: 'string' } },
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    };
    expect(() =>
      assertRecursiveAdditionalPropertiesFalse(strictTool),
    ).not.toThrow();

    const looseTool = {
      type: 'object',
      properties: { name: { type: 'string' } },
      // missing additionalProperties: false
    };
    expect(() => assertRecursiveAdditionalPropertiesFalse(looseTool)).toThrow();
  });
});

export { assertRecursiveAdditionalPropertiesFalse };
