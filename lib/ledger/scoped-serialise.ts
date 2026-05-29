/**
 * scoped-serialise.ts — minimal-diff ("scoped") write mode for the KH workflow
 * ledgers (ID-35.11). NOT vendored from task-view — KH-specific, authored to
 * work around two defects in the whole-file `serialise()` used by the rest of
 * `scripts/ledger-cli.ts`.
 *
 * ── The problem ────────────────────────────────────────────────────────────────
 * The CLI's whole-file `serialise()` is `JSON.stringify(detected.data, null, 2)`
 * where `detected.data` is the **Zod-reparsed** document. That write has TWO
 * defects that make any single-field mutation touch thousands of unrelated lines
 * in the shared `docs/reference/task-list.json`:
 *
 *   1. Key-order normalisation — `detectSchema`/Zod `.parse()` returns objects in
 *      schema-declared key order, so EVERY record's keys get reordered, not just
 *      the mutated one.
 *   2. Unicode-escaping divergence (the larger defect) — the on-disk ledger
 *      escapes ALL non-ASCII to `\uXXXX` (em-dashes, section signs, arrows, …);
 *      plain `JSON.stringify` emits raw UTF-8. A whole-file write therefore
 *      reformats every record that contains those characters.
 *
 * Either defect alone turns a one-field edit into a ~1600-line diff, which
 * collides with sibling cmux terminals editing the same file.
 *
 * ── The fix ─────────────────────────────────────────────────────────────────────
 * Scoped write operates on the `JSON.parse` of the **ORIGINAL on-disk text**
 * (NOT the Zod-reparsed `detected.data`): it applies the field mutation to that
 * parsed-original in place (preserving every record's on-disk key order) and
 * serialises with non-ASCII escaping to match the on-disk convention. A no-op
 * `parse → escape-serialise` round-trip on the live `task-list.json` is
 * byte-identical, so applying ONE field mutation touches only that record's
 * lines; every untouched record stays byte-for-byte identical.
 *
 * Zod still validates: callers run `detectSchema` / `applyPatches` on the mutated
 * document to hard-fail schema violations and surface ID-34 discipline warnings.
 * But the bytes WRITTEN come from the parsed-original-mutated doc, not the
 * Zod-reparsed one.
 *
 * @see scripts/ledger-cli.ts — `serialise()` now delegates to `escapeSerialise()`
 *      (RESOLVED OQ-LS-2, S270). The whole-file path emits the same escaped
 *      non-ASCII + Zod-canonical key order as the scoped path, making both
 *      byte-compatible for ongoing writes. The on-disk ledgers were normalised
 *      by `scripts/ledger-normalise-oqls2.ts` to match this format.
 */

import { detectSchema, type DetectSchemaResult } from './detect-schema';
import type { FieldPatch } from './patch-apply';

// ── non-ASCII escaping ──────────────────────────────────────────────────────────
//
// Build the regex from an ASCII-ONLY string source, never a regex literal
// containing high characters: a heredoc/editor would mangle a literal `-￿`
// range. Per-UTF-16-code-unit `charCodeAt` matches Python `ensure_ascii=True`
// (astral chars are already surrogate pairs in the JS string, so each unit is
// escaped to its own `\uXXXX`).
const NON_ASCII = new RegExp('[\\u0080-\\uffff]', 'g');

/**
 * Escape every non-ASCII code unit in `s` to its `\uXXXX` form, matching the
 * on-disk ledger convention (`JSON.stringify` with `ensure_ascii` semantics).
 * ASCII bytes are left untouched.
 */
export function escapeNonAscii(s: string): string {
  return s.replace(
    NON_ASCII,
    (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'),
  );
}

/**
 * Serialise a parsed-JSON value the way the on-disk ledgers are formatted:
 * 2-space indent, all non-ASCII escaped to `\uXXXX`, single trailing newline.
 * A no-op `parsedValue = JSON.parse(originalText)` round-trip through this
 * function is byte-identical to the original file.
 */
export function escapeSerialise(parsedValue: unknown): string {
  return escapeNonAscii(JSON.stringify(parsedValue, null, 2)) + '\n';
}

// ── id-aware leaf walk on the PARSED-ORIGINAL (plain objects) ────────────────────
//
// Mirrors patch-apply.ts's FieldPath semantics, but operates on the plain
// `JSON.parse(originalText)` object (preserving on-disk key order) rather than
// the Zod-reparsed `detected.data`. Only resolves to the leaf container + key;
// schema validation is delegated to `detectSchema` on the mutated document.

interface LeafTarget {
  container: Record<string, unknown>;
  key: string;
}

type WalkResult =
  | { ok: true; target: LeafTarget }
  | { ok: false; detail: string };

function asArray(value: unknown): Record<string, unknown>[] | null {
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : null;
}

function walkTaskList(
  doc: Record<string, unknown>,
  path: string[],
): WalkResult {
  const [head, taskId, ...afterTask] = path;
  if (head !== 'tasks') {
    return { ok: false, detail: `Task-list patches must start with 'tasks'.` };
  }
  if (taskId == null || taskId === '') {
    return { ok: false, detail: 'Missing task id at fieldPath[1].' };
  }
  const tasks = asArray(doc.tasks);
  const task = tasks?.find((t) => t.id === taskId);
  if (!task) {
    return { ok: false, detail: `Task id "${taskId}" not found.` };
  }
  if (afterTask.length === 1) {
    return { ok: true, target: { container: task, key: afterTask[0] } };
  }
  if (afterTask.length >= 2 && afterTask[0] === 'subtasks') {
    const subIdNum = Number(afterTask[1]);
    if (!Number.isInteger(subIdNum)) {
      return {
        ok: false,
        detail: `Subtask id "${afterTask[1]}" is not an integer.`,
      };
    }
    const subtasks = asArray(task.subtasks);
    const sub = subtasks?.find((s) => s.id === subIdNum);
    if (!sub) {
      return {
        ok: false,
        detail: `Subtask id ${subIdNum} not found in Task ${taskId}.`,
      };
    }
    const rest = afterTask.slice(2);
    if (rest.length !== 1) {
      return { ok: false, detail: `Subtask fieldPath must address one field.` };
    }
    return { ok: true, target: { container: sub, key: rest[0] } };
  }
  return { ok: false, detail: `Unsupported task-list fieldPath shape.` };
}

function walkRecordCollection(
  doc: Record<string, unknown>,
  collectionKey: 'themes' | 'items',
  path: string[],
): WalkResult {
  const [head, recordId, ...rest] = path;
  if (head !== collectionKey) {
    return { ok: false, detail: `Patches must start with '${collectionKey}'.` };
  }
  if (recordId == null || recordId === '') {
    return { ok: false, detail: 'Missing record id at fieldPath[1].' };
  }
  const records = asArray(doc[collectionKey]);
  const record = records?.find((r) => r.id === recordId);
  if (!record) {
    return { ok: false, detail: `Record id "${recordId}" not found.` };
  }
  if (rest.length !== 1) {
    return {
      ok: false,
      detail: `fieldPath must address one field after the id.`,
    };
  }
  return { ok: true, target: { container: record, key: rest[0] } };
}

function resolveLeaf(
  kind: Exclude<DetectSchemaResult['kind'], 'unknown'>,
  doc: Record<string, unknown>,
  path: string[],
): WalkResult {
  if (kind === 'task-list') return walkTaskList(doc, path);
  if (kind === 'roadmap') return walkRecordCollection(doc, 'themes', path);
  return walkRecordCollection(doc, 'items', path);
}

// ── public scoped-serialise API ──────────────────────────────────────────────────

export type ScopedSerialiseResult =
  | {
      ok: true;
      text: string;
      kind: Exclude<DetectSchemaResult['kind'], 'unknown'>;
    }
  | { ok: false; kind: 'unknown-document'; detail?: string }
  | { ok: false; kind: 'walk-error'; detail: string }
  | { ok: false; kind: 'schema-error'; error: unknown };

/**
 * Given the ORIGINAL on-disk ledger text and a single {@link FieldPatch}, return
 * the scoped-write output text:
 *
 *   - byte-identical for every record NOT addressed by the patch (preserving each
 *     record's on-disk key order),
 *   - non-ASCII escaped to `\uXXXX` (on-disk convention preserved),
 *   - exactly one trailing newline.
 *
 * Validation: the mutated parsed-original is run through `detectSchema` (which
 * `.parse()`s via the matching Zod schema) BEFORE the text is returned, so a
 * schema-violating mutation fails with `{ ok: false, kind: 'schema-error' }` and
 * no caller ever writes invalid bytes. The original text is parsed fresh inside
 * this function — never re-read from disk after a mutation.
 */
export function scopedSerialise(
  originalText: string,
  patch: FieldPatch,
): ScopedSerialiseResult {
  const parsed = JSON.parse(originalText) as Record<string, unknown>;

  // Discriminate against the parsed-original (does NOT mutate it).
  const detected = detectSchema(parsed);
  if (detected.kind === 'unknown') {
    return {
      ok: false,
      kind: 'unknown-document',
      detail: detected.documentName ?? undefined,
    };
  }

  const walked = resolveLeaf(detected.kind, parsed, patch.fieldPath);
  if (!walked.ok) {
    return { ok: false, kind: 'walk-error', detail: walked.detail };
  }

  // Apply the leaf mutation to the parsed-ORIGINAL in place (on-disk key order
  // preserved); untouched records keep their exact bytes.
  walked.target.container[walked.target.key] = patch.newValue;

  // Hard-fail schema violations before emitting any bytes. detectSchema runs the
  // matching Zod `.parse()` and throws ZodError on violation.
  try {
    detectSchema(parsed);
  } catch (error) {
    return { ok: false, kind: 'schema-error', error };
  }

  return { ok: true, text: escapeSerialise(parsed), kind: detected.kind };
}
