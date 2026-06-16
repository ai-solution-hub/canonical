/**
 * ID-71 contract-consumption + no-duplication verification (ID-104.20 / T25 / B-INV-25).
 *
 * B-INV-25 is a *no-code-change, satisfied-by-X* invariant: ID-104 PROVIDES the
 * single canonical `AgentEvalContract` (T1/T2) that ID-71's M38/M13/M14/M15/M40
 * guards consume — ID-71 imports it from `@/lib/eval/contract` and reads every
 * consumption field with NO adaptation, re-implementing no eval-engine internal.
 *
 * This guard holds the ID-104 side of that contract:
 *   (a) the contract is importable and exposes all seven consumption fields
 *       (+ optional `graduation_metric`), strict at the boundary; and
 *   (b) the contract is DECLARED in exactly one module — no duplicate or
 *       schedule-slip placeholder ships alongside it (incl. in ID-71's `lib/mcp`
 *       surface or the legacy `lib/eval/types.ts`).
 *
 * The ID-71 *import itself* lands in ID-71 Wave 2/3 (gated on this build). The
 * cross-Task acceptance criterion the Orchestrator carries (spec §X#1) is that
 * those guards import from `@/lib/eval/contract` and do NOT reintroduce a
 * provisional contract placeholder — this guard's (b) sweep fails the day one does.
 *
 * Spec: specs/id-104-eval-engine/{PRODUCT,TECH}.md §I (B-INV-25).
 */
import { join } from 'node:path';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  agentEvalContractSchema,
  outcomeSignalSchema,
  type AgentEvalContract,
} from '@/lib/eval/contract';

const PROJECT_ROOT = join(__dirname, '../../..');

/** The seven mandatory consumption fields ID-71 reads with no adaptation (S356-frozen). */
const MANDATORY_CONSUMPTION_FIELDS = [
  'touchpoint_id',
  'kind',
  'owner',
  'suite_name',
  'grounding_shape',
  'severity_on_fail',
  'variance_band',
] as const;

/** A structurally complete contract (all seven mandatory fields, no optional). */
const FULL_CONTRACT: AgentEvalContract = {
  touchpoint_id: 'mcp:search-documents',
  kind: 'tool',
  owner: 'platform',
  suite_name: 'l3',
  grounding_shape: 'forced_tool_strict',
  severity_on_fail: 'block',
  variance_band: 0.02,
};

describe('B-INV-25 (a) — ID-71 consumes the canonical contract with no adaptation', () => {
  it('exposes exactly the seven mandatory fields + optional graduation_metric', () => {
    expect(Object.keys(agentEvalContractSchema.shape).sort()).toEqual(
      [...MANDATORY_CONSUMPTION_FIELDS, 'graduation_metric'].sort(),
    );
  });

  it('validates a complete contract and treats graduation_metric as optional', () => {
    expect(agentEvalContractSchema.safeParse(FULL_CONTRACT).success).toBe(true);
    expect(
      agentEvalContractSchema.safeParse({
        ...FULL_CONTRACT,
        graduation_metric: 'tool_selection_accuracy',
      }).success,
    ).toBe(true);
  });

  it('rejects a contract missing any mandatory consumption field', () => {
    for (const field of MANDATORY_CONSUMPTION_FIELDS) {
      const partial: Record<string, unknown> = { ...FULL_CONTRACT };
      delete partial[field];
      expect(
        agentEvalContractSchema.safeParse(partial).success,
        `omitting ${field} must fail validation`,
      ).toBe(false);
    }
  });

  it('is strict at the boundary — rejects an unknown field (no silent adaptation)', () => {
    expect(
      agentEvalContractSchema.safeParse({ ...FULL_CONTRACT, extra: 1 }).success,
    ).toBe(false);
  });

  it('co-locates the OutcomeSignal enum so recordAiCall + ID-71 share one source', () => {
    expect([...outcomeSignalSchema.options].sort()).toEqual(
      ['fail', 'loop', 'refusal', 'win'].sort(),
    );
  });
});

// ---- (b) no-duplication grep-guard: exactly one declaration tree-wide ----

/**
 * Pure detector: returns `true` when `source` DECLARES the canonical contract
 * (the `AgentEvalContract` interface or the `agentEvalContractSchema` Zod value),
 * as opposed to merely importing or referencing it. A duplicate / placeholder is
 * exactly such a second declaration. Modelled on the `recordAiCall` grep-guard.
 */
export function declaresAgentEvalContract(source: string): boolean {
  return (
    /\binterface\s+AgentEvalContract\b/.test(source) ||
    /\b(?:const|let|var)\s+agentEvalContractSchema\b/.test(source)
  );
}

/**
 * Collect `.ts`/`.tsx` files under the AI-surface roots that DECLARE the
 * contract. Skips build output and tests; tolerates sandbox-denied files
 * (e.g. `lib/mcp/plugin-bundle.ts`) by skipping unreadable entries — the
 * sandbox-off full-suite gate reads them, so the invariant still holds in CI.
 */
function collectContractDeclaringFiles(): string[] {
  const roots = ['lib', 'app', 'scripts'].map((d) => join(PROJECT_ROOT, d));
  const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', '__tests__']);
  const matches: string[] = [];

  function walk(dir: string): void {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      let stats;
      try {
        stats = statSync(full);
      } catch {
        continue;
      }
      if (stats.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(entry)) continue;
      if (/\.(test|spec)\.tsx?$/.test(entry)) continue;
      let content: string;
      try {
        content = readFileSync(full, 'utf8');
      } catch {
        continue; // unreadable (e.g. sandbox-denied) — skip, do not crash the guard.
      }
      if (declaresAgentEvalContract(content)) matches.push(full);
    }
  }

  for (const root of roots) walk(root);
  return matches;
}

describe('B-INV-25 (b) — the contract is declared in exactly one module (no duplication)', () => {
  it('detector flags a declaration but not an import/reference', () => {
    expect(
      declaresAgentEvalContract(
        'export interface AgentEvalContract { id: string }',
      ),
    ).toBe(true);
    expect(
      declaresAgentEvalContract(
        'export const agentEvalContractSchema = z.object({});',
      ),
    ).toBe(true);
    expect(
      declaresAgentEvalContract(
        "import type { AgentEvalContract } from '@/lib/eval/contract';",
      ),
    ).toBe(false);
    expect(
      declaresAgentEvalContract(
        'const cols: (keyof AgentEvalContract)[] = [];',
      ),
    ).toBe(false);
  });

  it('exactly one production module declares AgentEvalContract — lib/eval/contract.ts', () => {
    const declaring = collectContractDeclaringFiles().map((f) =>
      f.replace(`${PROJECT_ROOT}/`, ''),
    );
    expect(declaring).toEqual(['lib/eval/contract.ts']);
  });

  it('the legacy lib/eval/types.ts ships no schedule-slip contract placeholder', () => {
    const types = readFileSync(join(PROJECT_ROOT, 'lib/eval/types.ts'), 'utf8');
    expect(declaresAgentEvalContract(types)).toBe(false);
  });
});
