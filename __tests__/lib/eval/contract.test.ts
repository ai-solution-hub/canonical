import { describe, it, expect } from 'vitest';

import {
  agentEvalContractSchema,
  type AgentEvalContract,
  type TouchpointKind,
  type GroundingShape,
  type SeverityTier,
  type OutcomeSignal,
} from '@/lib/eval/contract';

// ──────────────────────────────────────────
// Canonical AgentEvalContract (S356-frozen) — ID-104 §Contract / T1, T2
// HARD-UPSTREAM gate for ID-71 Wave 2/3: ID-71's M38 guard imports this shape.
// Behaviour-first: we assert the schema's accept/reject behaviour at the
// registry-write boundary, plus type-level conformance via assignment.
// ──────────────────────────────────────────

/** A fully-populated, valid contract used across the accept/reject cases. */
const validContract: AgentEvalContract = {
  touchpoint_id: 'classify-content',
  kind: 'tool',
  owner: 'kh-platform',
  suite_name: 'l1',
  grounding_shape: 'structured_output',
  severity_on_fail: 'block',
  variance_band: 0.02,
  graduation_metric: 'precision_at_5',
};

describe('agentEvalContractSchema', () => {
  it('accepts a valid contract with all seven mandatory fields plus optional graduation_metric', () => {
    const parsed = agentEvalContractSchema.parse(validContract);
    expect(parsed).toEqual(validContract);
  });

  it('accepts a valid contract WITHOUT the optional graduation_metric', () => {
    const { graduation_metric: _omit, ...withoutOptional } = validContract;
    const parsed = agentEvalContractSchema.parse(withoutOptional);
    expect(parsed.graduation_metric).toBeUndefined();
    expect(parsed.touchpoint_id).toBe('classify-content');
  });

  it.each([
    'touchpoint_id',
    'kind',
    'owner',
    'suite_name',
    'grounding_shape',
    'severity_on_fail',
    'variance_band',
  ] as const)('REJECTS a contract missing the mandatory field %s', (field) => {
    const broken: Record<string, unknown> = { ...validContract };
    delete broken[field];
    const result = agentEvalContractSchema.safeParse(broken);
    expect(result.success).toBe(false);
  });

  it('REJECTS a contract whose mandatory field has been renamed', () => {
    const { touchpoint_id: _id, ...rest } = validContract;
    const renamed = { ...rest, touchpointId: 'classify-content' };
    const result = agentEvalContractSchema.safeParse(renamed);
    expect(result.success).toBe(false);
  });

  it('REJECTS an out-of-union kind value', () => {
    const result = agentEvalContractSchema.safeParse({
      ...validContract,
      kind: 'webhook',
    });
    expect(result.success).toBe(false);
  });

  it('REJECTS an out-of-union severity_on_fail value', () => {
    const result = agentEvalContractSchema.safeParse({
      ...validContract,
      severity_on_fail: 'critical',
    });
    expect(result.success).toBe(false);
  });

  it('REJECTS a non-numeric variance_band', () => {
    const result = agentEvalContractSchema.safeParse({
      ...validContract,
      variance_band: '0.02',
    });
    expect(result.success).toBe(false);
  });

  it('accepts every ratified union member for each enum field', () => {
    const kinds: TouchpointKind[] = [
      'tool',
      'prompt',
      'skill',
      'inline',
      'agent_recipe',
    ];
    const groundings: GroundingShape[] = [
      'structured_output',
      'forced_tool_strict',
      'citations',
      'n/a',
    ];
    const severities: SeverityTier[] = ['block', 'warn', 'info', 'infra'];

    for (const kind of kinds) {
      expect(
        agentEvalContractSchema.safeParse({ ...validContract, kind }).success,
      ).toBe(true);
    }
    for (const grounding_shape of groundings) {
      expect(
        agentEvalContractSchema.safeParse({ ...validContract, grounding_shape })
          .success,
      ).toBe(true);
    }
    for (const severity_on_fail of severities) {
      expect(
        agentEvalContractSchema.safeParse({
          ...validContract,
          severity_on_fail,
        }).success,
      ).toBe(true);
    }
  });
});

describe('OutcomeSignal — co-located ratified enum (recordAiCall T14 consumer)', () => {
  it('exposes exactly the four ratified outcome signals as assignable values', () => {
    const signals: OutcomeSignal[] = ['win', 'fail', 'loop', 'refusal'];
    expect(new Set(signals).size).toBe(4);
  });
});

describe('AgentEvalContract type ≡ z.infer of the schema', () => {
  it('schema-inferred output is assignable to the hand-written interface and vice versa', () => {
    // Type-level conformance: if these assignments compile, the structures match.
    const fromSchema: AgentEvalContract =
      agentEvalContractSchema.parse(validContract);
    const inferred: import('zod').infer<typeof agentEvalContractSchema> =
      validContract;
    expect(fromSchema).toEqual(inferred);
  });
});
