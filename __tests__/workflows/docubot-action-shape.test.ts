/**
 * ID-9.11 — composite-action shape guard for `.github/actions/docubot/action.yml`.
 *
 * Spec: TECH §3.1 (six composite steps) + Inv-34 (upload-artifact with
 * if: always()) + Inv-33 (secrets contract; runner lives in the workflow,
 * action is runner-agnostic).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

const actionPath = join(process.cwd(), '.github/actions/docubot/action.yml');
const raw = readFileSync(actionPath, 'utf8');
const action = parse(raw) as {
  inputs?: Record<string, { required?: boolean; default?: string }>;
  runs: {
    using: string;
    steps: Array<{
      name?: string;
      uses?: string;
      if?: string;
      run?: string;
      with?: Record<string, unknown>;
    }>;
  };
};

describe('docubot composite action shape (ID-9.11 / TECH §3.1)', () => {
  it('is a composite action', () => {
    expect(action.runs.using).toBe('composite');
  });

  it('requires pr_number input', () => {
    expect(action.inputs?.pr_number?.required).toBe(true);
  });

  it('declares all six composite steps in order', () => {
    const names = action.runs.steps.map((s) => s.name ?? s.uses ?? '');
    const ordered = [
      /Checkout/i,
      /Setup Bun/i,
      /Install/i,
      /Gather PR context/i,
      /Render prompt/i,
      /Run Claude agent/i,
      /Upload run artefacts/i,
    ];
    let cursor = 0;
    for (const step of names) {
      if (cursor < ordered.length && ordered[cursor].test(step)) cursor++;
    }
    expect(cursor).toBe(ordered.length);
  });

  it('checks out with full history (fetch-depth: 0) for the source diff', () => {
    const checkout = action.runs.steps.find((s) =>
      (s.uses ?? '').startsWith('actions/checkout'),
    );
    expect(checkout?.with?.['fetch-depth']).toBe(0);
  });

  it('uses bun (oven-sh/setup-bun), not setup-node', () => {
    const usesList = action.runs.steps.map((s) => s.uses ?? '');
    expect(usesList.some((u) => u.startsWith('oven-sh/setup-bun'))).toBe(true);
    expect(usesList.some((u) => u.startsWith('actions/setup-node'))).toBe(
      false,
    );
  });

  it('invokes the SDK driver at scripts/docubot/run-agent.ts', () => {
    const runScript = action.runs.steps.map((s) => s.run ?? '').join('\n');
    expect(runScript).toContain('scripts/docubot/run-agent.ts');
  });

  it('uploads run artefacts with if: always() (Inv-34)', () => {
    const upload = action.runs.steps.find((s) =>
      (s.uses ?? '').startsWith('actions/upload-artifact'),
    );
    expect(upload).toBeDefined();
    expect(upload?.if).toBe('always()');
  });
});
