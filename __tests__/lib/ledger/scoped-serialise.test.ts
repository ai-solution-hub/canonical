/**
 * scoped-serialise.test.ts — unit tests for lib/ledger/scoped-serialise.ts
 * (ID-35.11). Proves the scoped-write primitive: a single-field mutation to one
 * record leaves all OTHER records byte-identical, preserves the on-disk
 * `\uXXXX` non-ASCII escaping, and re-parses via the vendored Zod schema.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import {
  escapeNonAscii,
  escapeSerialise,
  scopedSerialise,
} from '@/lib/ledger/scoped-serialise';
import { detectSchema } from '@/lib/ledger/detect-schema';

const REPO = resolve(__dirname, '../../..');
const TASK_LIST_PATH = join(REPO, 'docs/reference/task-list.json');

// Built from an ASCII-only source (never a regex literal containing high chars)
// to avoid heredoc/editor mangling of the high-range — same discipline the
// escaper uses. Matches any non-ASCII (raw UTF-8) code unit.
const RAW_NON_ASCII = new RegExp('[\\u0080-\\uffff]');

// Non-ASCII glyphs assembled from escape sequences so this source file stays
// pure-ASCII (sidesteps the same mangling risk the escaper guards against).
const EM_DASH = '—';
const SECTION = '§';
const ARROW = '→';

// ── escapeNonAscii ───────────────────────────────────────────────────────────────

describe('escapeNonAscii', () => {
  it('escapes em-dash, section sign, and arrow to their \\uXXXX forms', () => {
    expect(escapeNonAscii(`a ${EM_DASH} b`)).toBe('a \\u2014 b');
    expect(escapeNonAscii(`${SECTION}3.4`)).toBe('\\u00a73.4');
    expect(escapeNonAscii(`A ${ARROW} B`)).toBe('A \\u2192 B');
  });

  it('leaves pure ASCII untouched', () => {
    const ascii = 'plain ASCII: {"k": "v"}\n';
    expect(escapeNonAscii(ascii)).toBe(ascii);
  });

  it('escapes astral characters per UTF-16 code unit (surrogate pair)', () => {
    // U+1F600 grinning face = surrogate pair D83D DE00
    expect(escapeNonAscii('\u{1F600}')).toBe('\\ud83d\\ude00');
  });
});

// ── escapeSerialise round-trip (testStrategy #4) ─────────────────────────────────

describe('escapeSerialise — no-op round-trip', () => {
  it('round-trips the live task-list.json byte-identically', () => {
    const original = readFileSync(TASK_LIST_PATH, 'utf8');
    const roundTripped = escapeSerialise(JSON.parse(original));
    expect(roundTripped).toBe(original);
  });

  it('emits exactly one trailing newline', () => {
    const out = escapeSerialise({ a: 1 });
    expect(out.endsWith('}\n')).toBe(true);
    expect(out.endsWith('}\n\n')).toBe(false);
  });

  it('emits zero raw non-ASCII bytes for a doc containing an em-dash', () => {
    const out = escapeSerialise({ note: `a ${EM_DASH} b, ${SECTION}3, A ${ARROW} B` });
    expect(RAW_NON_ASCII.test(out)).toBe(false);
    expect(out).toContain('\\u2014');
  });
});

// ── scopedSerialise on a multi-record fixture ────────────────────────────────────

/** A two-Task task-list fixture; both Tasks carry em-dashes in their details. */
function fixtureDoc() {
  return {
    document_name: 'Knowledge Hub Task List',
    document_purpose: `Two-Task fixture ${EM_DASH} scoped-serialise byte-stability.`,
    related_documents: [],
    tasks: [
      {
        id: '900',
        title: `First task ${EM_DASH} alpha`,
        description: `Compact what+why ${EM_DASH} first.`,
        status: 'pending',
        priority: 'should',
        dependencies: [],
        subtasks: [
          {
            id: 1,
            title: `Sub one ${EM_DASH} uno`,
            description: `Subtask summary ${EM_DASH} one.`,
            details: `Details with an em-dash ${EM_DASH} and a section ${SECTION}1.`,
            status: 'pending',
            dependencies: [],
            testStrategy: `verify ${EM_DASH} n/a`,
          },
        ],
        updatedAt: '2026-05-26T00:00:00.000Z',
        effort_estimate: null,
        owner: null,
        priority_note: null,
        status_note: null,
        cross_doc_links: [],
        session_refs: [],
        commit_refs: [],
      },
      {
        id: '901',
        title: `Second task ${EM_DASH} beta`,
        description: `Compact what+why ${EM_DASH} second.`,
        status: 'pending',
        priority: 'should',
        dependencies: [],
        subtasks: [
          {
            id: 1,
            title: `Sub ${EM_DASH} solo`,
            description: `Untouched subtask ${EM_DASH} two.`,
            details: `Untouched details ${EM_DASH} arrow ${ARROW} here.`,
            status: 'pending',
            dependencies: [],
            testStrategy: `verify ${EM_DASH} n/a`,
          },
        ],
        updatedAt: '2026-05-26T00:00:00.000Z',
        effort_estimate: null,
        owner: null,
        priority_note: null,
        status_note: null,
        cross_doc_links: [],
        session_refs: [],
        commit_refs: [],
      },
    ],
  };
}

function fixtureText(): string {
  // The on-disk convention: escaped non-ASCII + trailing newline.
  return escapeSerialise(fixtureDoc());
}

function changedLineIndices(original: string, next: string): number[] {
  const origLines = original.split('\n');
  const newLines = next.split('\n');
  expect(newLines.length).toBe(origLines.length);
  return origLines
    .map((line, i) => (line === newLines[i] ? null : i))
    .filter((i): i is number => i !== null);
}

describe('scopedSerialise — multi-record byte-stability (testStrategy #1, #2)', () => {
  it('flip-task: the ONLY changed line is the mutated record status line', () => {
    const original = fixtureText();
    const r = scopedSerialise(original, {
      fieldPath: ['tasks', '900', 'status'],
      newValue: 'in_progress',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const changed = changedLineIndices(original, r.text);
    expect(changed).toHaveLength(1);
    const origLines = original.split('\n');
    const newLines = r.text.split('\n');
    expect(origLines[changed[0]]).toContain('"status": "pending"');
    expect(newLines[changed[0]]).toContain('"status": "in_progress"');
  });

  it('flip-subtask: untouched Task 901 record stays byte-identical', () => {
    const original = fixtureText();
    const r = scopedSerialise(original, {
      fieldPath: ['tasks', '900', 'subtasks', '1', 'status'],
      newValue: 'done',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    // Task 901's full block (from its id line to EOF) must appear verbatim.
    const block901Start = original.indexOf('"id": "901"');
    const block901 = original.slice(block901Start);
    expect(r.text).toContain(block901);

    // And exactly one line changed overall.
    expect(changedLineIndices(original, r.text)).toHaveLength(1);
  });

  it('introduces NO raw non-ASCII anywhere; untouched escapes survive', () => {
    const original = fixtureText();
    const r = scopedSerialise(original, {
      fieldPath: ['tasks', '900', 'status'],
      newValue: 'in_progress',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(RAW_NON_ASCII.test(r.text)).toBe(false);
    // Untouched records keep their \uXXXX escapes.
    expect(r.text).toContain('\\u2014'); // em-dash
    expect(r.text).toContain('\\u2192'); // arrow (Task 901 details)
    expect(r.text).toContain('\\u00a7'); // section sign (Task 900 subtask details)
  });
});

describe('scopedSerialise — validation + re-parse (testStrategy #3)', () => {
  it('result re-parses via detectSchema (task-list)', () => {
    const original = fixtureText();
    const r = scopedSerialise(original, {
      fieldPath: ['tasks', '900', 'status'],
      newValue: 'in_progress',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const detected = detectSchema(JSON.parse(r.text));
    expect(detected.kind).toBe('task-list');
  });

  it('rejects a schema-invalid status WITHOUT emitting text', () => {
    const original = fixtureText();
    const r = scopedSerialise(original, {
      fieldPath: ['tasks', '900', 'status'],
      newValue: 'not-a-real-status',
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.kind).toBe('schema-error');
  });

  it('walk-error for a non-existent task id', () => {
    const original = fixtureText();
    const r = scopedSerialise(original, {
      fieldPath: ['tasks', 'does-not-exist', 'status'],
      newValue: 'done',
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.kind).toBe('walk-error');
  });
});

describe('scopedSerialise — live ledger single-record diff', () => {
  it('flipping one real Task status leaves all other lines byte-identical', () => {
    const original = readFileSync(TASK_LIST_PATH, 'utf8');
    const doc = JSON.parse(original) as {
      tasks: { id: string; status: string }[];
    };
    const target = doc.tasks[0];
    const newStatus = target.status === 'done' ? 'pending' : 'done';
    const r = scopedSerialise(original, {
      fieldPath: ['tasks', target.id, 'status'],
      newValue: newStatus,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // A single field flip touches exactly one line in the whole 1.4MB file.
    expect(changedLineIndices(original, r.text)).toHaveLength(1);
  });
});
