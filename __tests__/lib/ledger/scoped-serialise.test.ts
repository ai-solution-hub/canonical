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
  scopedSpliceSerialise,
} from '@/lib/ledger/scoped-serialise';
import { detectSchema } from '@/lib/ledger/detect-schema';

const REPO = resolve(__dirname, '../../..');
const TASK_LIST_PATH = join(REPO, 'docs/reference/task-list.json');
const ROADMAP_PATH = join(REPO, 'docs/reference/product-roadmap.json');
const BACKLOG_PATH = join(REPO, 'docs/reference/product-backlog.json');

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
    const out = escapeSerialise({
      note: `a ${EM_DASH} b, ${SECTION}3, A ${ARROW} B`,
    });
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

// ── scopedSpliceSerialise — record insert/remove (ID-65.2) ───────────────────────
//
// Byte-minimal-diff proof discipline: we read the LIVE ledger text (read-only)
// and prove an insert/remove touches ONLY the spliced record's lines — every
// untouched record stays byte-identical. The strongest single proof is the
// insert→remove round-trip: removing the just-inserted record reproduces the
// original text byte-for-byte (so no untouched record was reformatted).

/** A schema-valid Task body the live ledger does not already contain. */
function newTaskRecord(id: string) {
  return {
    id,
    title: `Splice probe Task ${id} ${EM_DASH} ID-65.2`,
    description: `Synthetic Task ${EM_DASH} byte-stability probe, ${SECTION}65.2.`,
    status: 'pending',
    priority: 'should',
    dependencies: [],
    subtasks: [],
    updatedAt: '2026-05-29T00:00:00.000Z',
    effort_estimate: null,
    owner: null,
    priority_note: null,
    status_note: null,
    cross_doc_links: [],
    session_refs: [],
    commit_refs: [],
  };
}

/** A schema-valid Subtask body (numeric id) with an arrow glyph in details. */
function newSubtaskRecord(id: number) {
  return {
    id,
    title: `Splice probe subtask ${id} ${EM_DASH} uno`,
    description: `Synthetic subtask ${EM_DASH} byte-stability probe.`,
    details: `Details with an arrow ${ARROW} and a section ${SECTION}65.2.`,
    status: 'pending',
    dependencies: [],
    testStrategy: `verify ${EM_DASH} n/a`,
  };
}

describe('scopedSpliceSerialise — task-list insert/remove byte stability (testStrategy #1, #2)', () => {
  it('insert→remove round-trip on a real Task reproduces the original byte-for-byte', () => {
    const original = readFileSync(TASK_LIST_PATH, 'utf8');
    const probeId = '999000'; // not present in the live ledger

    const inserted = scopedSpliceSerialise(original, {
      kind: 'insert',
      collection: 'tasks',
      record: newTaskRecord(probeId),
    });
    expect(inserted.ok).toBe(true);
    if (!inserted.ok) return;

    // Removing the just-inserted record returns to the ORIGINAL text exactly.
    const removed = scopedSpliceSerialise(inserted.text, {
      kind: 'remove',
      collection: 'tasks',
      recordId: probeId,
    });
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(removed.text).toBe(original);
  });

  it('insert touches ONLY the new record lines + one comma on the prior last record', () => {
    const original = readFileSync(TASK_LIST_PATH, 'utf8');
    const probeId = '999001';
    const r = scopedSpliceSerialise(original, {
      kind: 'insert',
      collection: 'tasks',
      record: newTaskRecord(probeId),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const origLines = original.split('\n');
    const newLines = r.text.split('\n');
    // Net new lines = the inserted record's serialised line count.
    const recordLineCount =
      escapeSerialise(newTaskRecord(probeId)).split('\n').length - 1; // drop trailing-newline empty
    expect(newLines.length).toBe(origLines.length + recordLineCount);

    // Walk both line arrays; every original line must reappear verbatim in the
    // output EXCEPT exactly one (the prior last Task's `}` which gains a `,`).
    let perturbed = 0;
    let oi = 0;
    for (let ni = 0; ni < newLines.length && oi < origLines.length; ni++) {
      if (newLines[ni] === origLines[oi]) {
        oi++;
      } else if (newLines[ni] === origLines[oi] + ',') {
        perturbed++;
        oi++;
      }
      // else: an inserted (new-record) line — do not advance oi.
    }
    expect(oi).toBe(origLines.length); // every original line consumed
    expect(perturbed).toBe(1); // only the prior last record gained a comma
    // The new record id appears in the output; introduces no raw non-ASCII.
    expect(r.text).toContain(`"id": "${probeId}"`);
    expect(RAW_NON_ASCII.test(r.text)).toBe(false);
  });

  it('insert a subtask into a real Task: insert→remove round-trip is byte-identical', () => {
    const original = readFileSync(TASK_LIST_PATH, 'utf8');
    const doc = JSON.parse(original) as {
      tasks: { id: string; subtasks: { id: number }[] }[];
    };
    const host = doc.tasks[0];
    const newSubId = Math.max(0, ...host.subtasks.map((s) => s.id)) + 1000; // collision-free

    const inserted = scopedSpliceSerialise(original, {
      kind: 'insert',
      collection: 'subtasks',
      taskId: host.id,
      record: newSubtaskRecord(newSubId),
    });
    expect(inserted.ok).toBe(true);
    if (!inserted.ok) return;
    expect(inserted.text).toContain(`"id": ${newSubId}`);

    const removed = scopedSpliceSerialise(inserted.text, {
      kind: 'remove',
      collection: 'subtasks',
      taskId: host.id,
      recordId: newSubId,
    });
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(removed.text).toBe(original);
  });

  it('walk-error when the addressed taskId is not found for a subtask splice', () => {
    const original = readFileSync(TASK_LIST_PATH, 'utf8');
    const r = scopedSpliceSerialise(original, {
      kind: 'insert',
      collection: 'subtasks',
      taskId: 'does-not-exist',
      record: newSubtaskRecord(1),
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.kind).toBe('walk-error');
  });
});

describe('scopedSpliceSerialise — roadmap (themes) + backlog (items) (testStrategy: all four collections)', () => {
  it('roadmap themes insert→remove round-trips byte-identically', () => {
    const original = readFileSync(ROADMAP_PATH, 'utf8');
    const doc = JSON.parse(original) as { themes: { id: string }[] };
    const template = doc.themes[0];
    const probeId = '999900';
    const record = {
      ...structuredClone(template),
      id: probeId,
      title: `Splice probe theme ${EM_DASH} ID-65.2`,
    };

    const inserted = scopedSpliceSerialise(original, {
      kind: 'insert',
      collection: 'themes',
      record,
    });
    expect(inserted.ok).toBe(true);
    if (!inserted.ok) return;
    expect(inserted.kind).toBe('roadmap');

    const removed = scopedSpliceSerialise(inserted.text, {
      kind: 'remove',
      collection: 'themes',
      recordId: probeId,
    });
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(removed.text).toBe(original);
  });

  it('backlog items insert→remove round-trips byte-identically', () => {
    const original = readFileSync(BACKLOG_PATH, 'utf8');
    const doc = JSON.parse(original) as { items: { id: string }[] };
    const template = doc.items[0];
    const probeId = '999901';
    const record = {
      ...structuredClone(template),
      id: probeId,
      title: `Splice probe item ${EM_DASH} ID-65.2`,
    };

    const inserted = scopedSpliceSerialise(original, {
      kind: 'insert',
      collection: 'items',
      record,
    });
    expect(inserted.ok).toBe(true);
    if (!inserted.ok) return;
    expect(inserted.kind).toBe('backlog');

    const removed = scopedSpliceSerialise(inserted.text, {
      kind: 'remove',
      collection: 'items',
      recordId: probeId,
    });
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(removed.text).toBe(original);
  });
});

describe('scopedSpliceSerialise — validation + failure kinds (testStrategy #3)', () => {
  it('a schema-violating insert returns ok:false kind:schema-error and emits NO text', () => {
    const original = readFileSync(TASK_LIST_PATH, 'utf8');
    // Missing required fields (status, priority, subtasks, ...) — Task is .strict().
    const r = scopedSpliceSerialise(original, {
      kind: 'insert',
      collection: 'tasks',
      record: { id: '999002', title: 'incomplete' },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.kind).toBe('schema-error');
    // No `text` field exists on the failure shape — no bytes emitted.
    expect((r as { text?: string }).text).toBeUndefined();
  });

  it('a subtask insert with the wrong id type (string) fails schema-error', () => {
    const original = readFileSync(TASK_LIST_PATH, 'utf8');
    const hostId = (JSON.parse(original) as { tasks: { id: string }[] })
      .tasks[0].id;
    const r = scopedSpliceSerialise(original, {
      kind: 'insert',
      collection: 'subtasks',
      taskId: hostId,
      record: {
        ...newSubtaskRecord(1),
        id: 'not-a-number' as unknown as number,
      },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.kind).toBe('schema-error');
  });

  it('unknown-document when the text is not a recognised ledger', () => {
    const r = scopedSpliceSerialise(
      JSON.stringify({ document_name: 'Not A Ledger', tasks: [] }),
      { kind: 'insert', collection: 'tasks', record: newTaskRecord('1') },
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.kind).toBe('unknown-document');
  });

  it('a no-op remove (id absent) re-validates and round-trips byte-identically', () => {
    const original = readFileSync(TASK_LIST_PATH, 'utf8');
    const r = scopedSpliceSerialise(original, {
      kind: 'remove',
      collection: 'tasks',
      recordId: 'no-such-task-id',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.text).toBe(original);
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
