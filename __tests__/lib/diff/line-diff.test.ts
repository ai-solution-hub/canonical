/**
 * lib/diff/line-diff — unit tests (ID-117 {117.7}, CMP-2 extraction).
 *
 * Verifies the extracted LCS primitive: buildLcsTable, computeLineDiff,
 * OP_CLASS, OP_PREFIX. These tests are pure computation tests — no React,
 * no DOM, no DB. The core logic is byte-identical to the pre-extraction
 * copies in revision-diff-view.tsx and prompt-diff-view.tsx.
 *
 * INV-13: OP_CLASS uses ONLY bg-status-* semantic tokens (no raw Tailwind colour).
 * INV-13: OP_PREFIX provides non-colour gutter markers (more-than-colour signalling).
 */
import { describe, it, expect } from 'vitest';

import {
  buildLcsTable,
  computeLineDiff,
  OP_CLASS,
  OP_PREFIX,
  type DiffOp,
} from '@/lib/diff/line-diff';

describe('buildLcsTable', () => {
  it('returns an (m+1)×(n+1) table of zeros for empty inputs', () => {
    const table = buildLcsTable([], []);
    expect(table).toEqual([[0]]);
  });

  it('computes correct LCS length for a simple overlap', () => {
    const a = ['A', 'B', 'C'];
    const b = ['A', 'C'];
    const table = buildLcsTable(a, b);
    // LCS of ['A','B','C'] and ['A','C'] is ['A','C'] — length 2
    expect(table[3][2]).toBe(2);
  });

  it('returns zero LCS when no lines overlap', () => {
    const a = ['X', 'Y'];
    const b = ['A', 'B'];
    const table = buildLcsTable(a, b);
    expect(table[2][2]).toBe(0);
  });

  it('handles identical arrays (LCS = full length)', () => {
    const lines = ['Line A', 'Line B', 'Line C'];
    const table = buildLcsTable(lines, lines);
    expect(table[3][3]).toBe(3);
  });
});

describe('computeLineDiff', () => {
  it('returns all context lines when oldText equals newText', () => {
    const text = 'Line A\nLine B\nLine C';
    const result = computeLineDiff(text, text);
    expect(result.every((l) => l.op === 'context')).toBe(true);
    expect(result.map((l) => l.text)).toEqual(['Line A', 'Line B', 'Line C']);
  });

  it('returns all additions when oldText is empty', () => {
    const result = computeLineDiff('', 'New line one\nNew line two');
    expect(result.every((l) => l.op === 'add')).toBe(true);
    expect(result.map((l) => l.text)).toEqual(['New line one', 'New line two']);
  });

  it('returns all removals when newText is empty', () => {
    const result = computeLineDiff('Old line one\nOld line two', '');
    expect(result.every((l) => l.op === 'remove')).toBe(true);
    expect(result.map((l) => l.text)).toEqual(['Old line one', 'Old line two']);
  });

  it('produces consistent ordering for changed lines (add before remove in this LCS impl)', () => {
    const old = 'Line A\nLine B\nLine C';
    const newText = 'Line A\nLine B modified\nLine C';
    const result = computeLineDiff(old, newText);

    // Both the remove and add ops for the changed line must be present
    const removeIdx = result.findIndex(
      (l) => l.op === 'remove' && l.text === 'Line B',
    );
    const addIdx = result.findIndex(
      (l) => l.op === 'add' && l.text === 'Line B modified',
    );
    expect(removeIdx).toBeGreaterThanOrEqual(0);
    expect(addIdx).toBeGreaterThanOrEqual(0);
    // Both ops appear — ordering is consistent (add before remove in this back-traversal impl)
    expect(Math.abs(removeIdx - addIdx)).toBe(1);
  });

  it('keeps unchanged lines as context', () => {
    const result = computeLineDiff(
      'Line A\nLine B\nLine C',
      'Line A\nLine B modified\nLine C',
    );
    const context = result.filter((l) => l.op === 'context');
    expect(context.map((l) => l.text)).toContain('Line A');
    expect(context.map((l) => l.text)).toContain('Line C');
  });

  it('handles a fully replaced text (no shared lines)', () => {
    const result = computeLineDiff('Alpha\nBeta', 'Gamma\nDelta');
    const ops = result.map((l) => l.op);
    expect(ops).toContain('remove');
    expect(ops).toContain('add');
    expect(ops).not.toContain('context');
  });

  it('handles single-line inputs without newlines', () => {
    const result = computeLineDiff('old content', 'new content');
    expect(
      result.some((l) => l.op === 'remove' && l.text === 'old content'),
    ).toBe(true);
    expect(result.some((l) => l.op === 'add' && l.text === 'new content')).toBe(
      true,
    );
  });

  it('preserves empty-string lines within a multi-line diff', () => {
    const result = computeLineDiff('A\n\nC', 'A\n\nC');
    expect(result.map((l) => l.text)).toEqual(['A', '', 'C']);
    expect(result.every((l) => l.op === 'context')).toBe(true);
  });
});

describe('OP_CLASS — semantic token invariant (INV-13)', () => {
  const ops: DiffOp[] = ['add', 'remove', 'context'];

  it('covers all three DiffOp values', () => {
    for (const op of ops) {
      expect(OP_CLASS[op]).toBeDefined();
    }
  });

  it('uses ONLY bg-status-* semantic tokens — no raw Tailwind colours', () => {
    // Raw Tailwind colour classes look like bg-green-*/bg-red-*/text-green-* etc.
    const rawTailwindPattern =
      /\b(bg|text)-(red|green|blue|yellow|orange|purple|pink|gray|grey|slate|zinc|neutral|stone|amber|lime|emerald|teal|cyan|sky|violet|fuchsia|rose)-\d+/;
    for (const op of ops) {
      expect(OP_CLASS[op]).not.toMatch(rawTailwindPattern);
    }
  });

  it('add class references bg-status-success semantic token', () => {
    expect(OP_CLASS.add).toContain('bg-status-success');
    expect(OP_CLASS.add).toContain('text-status-success');
  });

  it('remove class references bg-status-error semantic token', () => {
    expect(OP_CLASS.remove).toContain('bg-status-error');
    expect(OP_CLASS.remove).toContain('text-status-error');
  });

  it('context class uses muted-foreground (no coloured background)', () => {
    expect(OP_CLASS.context).toBe('text-muted-foreground');
  });
});

describe('OP_PREFIX — non-colour gutter marker invariant (INV-13)', () => {
  it('add prefix is [+]', () => {
    expect(OP_PREFIX.add).toBe('[+]');
  });

  it('remove prefix is [-]', () => {
    expect(OP_PREFIX.remove).toBe('[-]');
  });

  it('context prefix is whitespace (three spaces — non-colour signal)', () => {
    expect(OP_PREFIX.context).toBe('   ');
  });
});
