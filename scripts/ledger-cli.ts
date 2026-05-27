#!/usr/bin/env bun
/**
 * ledger-cli.ts — deterministic mutation CLI for the three KH workflow ledgers
 * (docs/reference/{task-list,product-roadmap,product-backlog}.json).
 *
 * Replaces the hand-written Python `/tmp/claude/*.py` ledger-splice scripts the
 * Orchestrator wrote per mutation. A thin dispatcher over the task-view v0.2.0
 * patch primitives vendored into lib/ledger/ (ID-35; spec docs/specs/ledger-cli/).
 *
 * Contract (PRODUCT inv 1–16):
 *   - structured JSON envelope: success → stdout {ok:true,…} exit 0; error →
 *     stderr {ok:false,error,detail} exit 1. `--pretty` swaps to human lines.
 *   - no silent corrupt write: every mutation re-parses via the vendored Zod
 *     schema BEFORE any byte is written (the primitives do this; a failure
 *     surfaces as {ok:false} and atomicWriteFile is never reached).
 *   - atomic writes via the vendored atomicWriteFile.
 *   - the CLI does NOT commit and does NOT generate mirrors — it mutates
 *     canonical JSON only and reminds the operator to run
 *     `bash scripts/regen-mirrors.sh` (CI ledger-mirror-parity gates on parity).
 *
 *   bun scripts/ledger-cli.ts <subcommand> [args] [--flags]
 *     show           <ledger> <id>
 *     flip-task      <taskId> <status>
 *     flip-subtask   <taskId> <subId> <status>
 *     append-journal <taskId> <subId> <text>
 *     add-subtask    <taskId> <subtaskJson>
 *     update-backlog <itemId> <fieldPath.dot> <value>
 *     open-task      <taskJson>
 *     create-backlog <itemJson>
 *     delete-backlog <itemId>
 *     promote        <backlogId> <taskJson>
 *   flags: --dry-run --pretty --regen-mirrors --scoped --ledger-dir <path>
 *
 * `--scoped` (ID-35.11): minimal-diff write for the field-edit subcommands
 * (flip-task | flip-subtask | append-journal). Scoped mode mutates the
 * JSON.parse of the ORIGINAL on-disk text in place and escape-serialises it
 * (lib/ledger/scoped-serialise.ts) — every untouched record stays byte-for-byte
 * identical, on-disk \\uXXXX escaping preserved. Zod still validates the mutated
 * document before any byte is written. After the OQ-LS-2 (S270) normalisation,
 * both the scoped path and the whole-file path emit the same escaped format, so
 * they are byte-compatible for ongoing single-field edits.
 */

import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { renameSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { ZodError } from 'zod';

import {
  detectSchema,
  type DetectSchemaResult,
} from '@/lib/ledger/detect-schema';
import { applyPatches, type FieldPatch } from '@/lib/ledger/patch-apply';
import {
  escapeSerialise,
  scopedSerialise,
} from '@/lib/ledger/scoped-serialise';
import { insertRecord, removeRecord } from '@/lib/ledger/record-mutate';
import {
  atomicWriteFile,
  stageAtomicWrite,
  commitStagedWrite,
  abortStagedWrite,
} from '@/lib/ledger/atomic-write';
import { parseTaskListWithWarnings } from '@/lib/validation/task-list-schema';

// ── ledger resolution ─────────────────────────────────────────────────────────

type LedgerName = 'task' | 'roadmap' | 'backlog';

const LEDGER_FILES: Record<LedgerName, string> = {
  task: 'task-list.json',
  roadmap: 'product-roadmap.json',
  backlog: 'product-backlog.json',
};

function ledgerPath(dir: string, name: LedgerName): string {
  return resolve(dir, LEDGER_FILES[name]);
}

// ── envelope ──────────────────────────────────────────────────────────────────

type ZodIssueLike = ZodError['issues'][number];

type CliResult =
  | {
      ok: true;
      subcommand: string;
      result: unknown;
      warnings?: string[];
      mirrorStale?: boolean;
    }
  | {
      ok: false;
      subcommand: string;
      error: string;
      detail?: string;
      issues?: ZodIssueLike[];
    };

interface ParsedArgs {
  subcommand: string | undefined;
  positionals: string[];
  flags: {
    dryRun: boolean;
    pretty: boolean;
    regenMirrors: boolean;
    /**
     * ID-35.11 scoped-write flag. Optional so pre-existing callers that build a
     * `ParsedArgs.flags` literal stay valid; absent reads as falsy → the
     * unchanged whole-file write path. `parseArgs` always sets it explicitly.
     */
    scoped?: boolean;
    /**
     * ID-35.18 mirror-regen opt-out. When set, the default-on regen
     * (`maybeRegenMirrors(true)`) is suppressed. Optional for back-compat with
     * pre-existing `ParsedArgs.flags` literals; absent reads as falsy.
     */
    noRegenMirrors?: boolean;
    /**
     * ID-35.15 escape hatch — downgrades the budget-exceeded rejection
     * ({35.17}) to the existing soft warning and proceeds. Optional for
     * back-compat.
     */
    force?: boolean;
    ledgerDir: string;
    /**
     * ID-35.15 named value-flags. Each consumes the next argv token. Absent
     * when not supplied; consumed by `readRecordInput` to build a record from
     * flags, and (for `--file`/`--id`) by the input/auto-id plumbing. Optional
     * so pre-existing `ParsedArgs.flags` literals stay valid.
     */
    file?: string;
    id?: string;
    title?: string;
    description?: string;
    status?: string;
    depends?: string;
    priority?: string;
    notes?: string;
    testStrategy?: string;
    statusNote?: string;
  };
}

/**
 * ID-35.15 value-flag registry. Each maps an argv `--flag` to the
 * `ParsedArgs.flags` key it populates with the NEXT argv token. Drives both
 * `parseArgs` (which token-pairs them) and `readRecordInput` (which assembles a
 * record from the named-flag subset).
 */
const VALUE_FLAGS: Record<string, keyof ParsedArgs['flags']> = {
  '--ledger-dir': 'ledgerDir',
  '--file': 'file',
  '--id': 'id',
  '--title': 'title',
  '--description': 'description',
  '--status': 'status',
  '--depends': 'depends',
  '--priority': 'priority',
  '--notes': 'notes',
  '--test-strategy': 'testStrategy',
  '--status-note': 'statusNote',
};

/** ID-35.15 boolean flags. Presence sets the corresponding `flags` key true. */
const BOOLEAN_FLAGS: Record<string, keyof ParsedArgs['flags']> = {
  '--dry-run': 'dryRun',
  '--pretty': 'pretty',
  '--regen-mirrors': 'regenMirrors',
  '--no-regen-mirrors': 'noRegenMirrors',
  '--scoped': 'scoped',
  '--force': 'force',
};

/** Sorted union of every known flag — surfaced in the reject-unknown error. */
const KNOWN_FLAGS = [
  ...Object.keys(BOOLEAN_FLAGS),
  ...Object.keys(VALUE_FLAGS),
].sort();

type ParseArgsResult =
  | { ok: true; parsed: ParsedArgs }
  | { ok: false; error: string };

/**
 * ID-35.15 hand-rolled parser (zero new deps; Node ≥22). Splits argv into
 * positionals, boolean flags, and named value-flags (each consuming the next
 * token). Unknown `--flags` are REJECTED (RESEARCH §5.3) — the old silent-drop
 * behaviour turned a `--titel` typo into a confusing downstream schema error.
 */
function parseArgs(argv: string[]): ParseArgsResult {
  const positionals: string[] = [];
  const flags: ParsedArgs['flags'] = {
    dryRun: false,
    pretty: false,
    regenMirrors: false,
    scoped: false,
    noRegenMirrors: false,
    force: false,
    ledgerDir: 'docs/reference',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a in BOOLEAN_FLAGS) {
      (flags as Record<string, unknown>)[BOOLEAN_FLAGS[a]] = true;
    } else if (a in VALUE_FLAGS) {
      const next = argv[++i];
      if (next === undefined) {
        return { ok: false, error: `flag ${a} requires a value` };
      }
      (flags as Record<string, unknown>)[VALUE_FLAGS[a]] = next;
    } else if (a.startsWith('--')) {
      return {
        ok: false,
        error: `unknown flag ${a}. Known flags: ${KNOWN_FLAGS.join(' ')}`,
      };
    } else {
      positionals.push(a);
    }
  }
  return {
    ok: true,
    parsed: { subcommand: positionals.shift(), positionals, flags },
  };
}

// ── ID-35.15 record-input layer ─────────────────────────────────────────────

type RecordInputResult =
  | { ok: true; value: unknown }
  | { ok: false; result: CliResult };

/**
 * ID-35.15. Resolve a record-creating command's body in precedence order:
 *
 *   1. positional JSON   (back-compat — `create-backlog '{"…"}'`)
 *   2. `--file <path>`   (`-` reads stdin; the manual temp-file workaround,
 *                         made first-class for multi-line `details`)
 *   3. named flags       (`--title --description --status --depends 1,2 …`)
 *
 * Returns the parsed record object (NOT yet schema-validated — the vendored
 * `insertRecord`/`applyPatches` primitives own that). `--depends` is split on
 * commas into a numeric array (subtask `dependencies` are `number[]`). When no
 * input source is supplied at all, returns `missing-args`.
 */
function readRecordInput(args: ParsedArgs): RecordInputResult {
  const subcommand = args.subcommand ?? '<none>';
  const { flags } = args;

  // 1. positional JSON.
  const positional = args.positionals[0];
  if (positional !== undefined) {
    try {
      return { ok: true, value: JSON.parse(positional) };
    } catch (err) {
      return {
        ok: false,
        result: cliErr(subcommand, 'invalid-json-arg', msg(err)),
      };
    }
  }

  // 2. --file <path> (`-` = stdin).
  if (flags.file !== undefined) {
    let text: string;
    try {
      text = flags.file === '-' ? readFileSync(0, 'utf8') : readFileSync(flags.file, 'utf8');
    } catch (err) {
      return {
        ok: false,
        result: cliErr(subcommand, 'input-read-failed', `${flags.file}: ${msg(err)}`),
      };
    }
    try {
      return { ok: true, value: JSON.parse(text) };
    } catch (err) {
      return {
        ok: false,
        result: cliErr(subcommand, 'invalid-json-arg', `${flags.file}: ${msg(err)}`),
      };
    }
  }

  // 3. named flags → record object.
  const record: Record<string, unknown> = {};
  if (flags.id !== undefined) record.id = flags.id;
  if (flags.title !== undefined) record.title = flags.title;
  if (flags.description !== undefined) record.description = flags.description;
  if (flags.status !== undefined) record.status = flags.status;
  if (flags.priority !== undefined) record.priority = flags.priority;
  if (flags.notes !== undefined) record.notes = flags.notes;
  if (flags.testStrategy !== undefined) record.testStrategy = flags.testStrategy;
  if (flags.statusNote !== undefined) record.status_note = flags.statusNote;
  if (flags.depends !== undefined) {
    record.dependencies = flags.depends
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((s) => {
        const n = Number(s);
        return Number.isNaN(n) ? s : n;
      });
  }

  if (Object.keys(record).length === 0) {
    return {
      ok: false,
      result: cliErr(
        subcommand,
        'missing-args',
        `${subcommand} expects a positional JSON body, --file <path> (- = stdin), or named flags (--title …)`,
      ),
    };
  }
  return { ok: true, value: record };
}

/**
 * ID-35.15 CLI-layer auto-id (RESEARCH §2.2). Computes `max(existingIds) + 1`
 * for a collection, returning the correct primitive TYPE:
 *   - `tasks` / `themes` / `items` → bare-digit STRING (`"186"`)
 *   - `subtasks`                    → NUMBER (`13`), scoped to `taskId`
 *
 * `max+1` is the monotonic semantics (never reuses a freed id; does NOT fill
 * gaps). Lives in the CLI, NOT the vendored `insertRecord`, which must stay
 * byte-faithful to task-view (RESEARCH §2.2).
 */
function nextId(
  detected: KnownDetected,
  collectionKey: 'tasks' | 'themes' | 'items' | 'subtasks',
  taskId?: string,
): string | number {
  if (collectionKey === 'subtasks') {
    if (detected.kind !== 'task-list') {
      throw new Error('nextId(subtasks) requires a task-list ledger');
    }
    if (taskId === undefined) {
      throw new Error('nextId(subtasks) requires a taskId');
    }
    const task = detected.data.tasks.find((t) => t.id === taskId);
    const ids = (task?.subtasks ?? []).map((s) => s.id);
    return ids.length === 0 ? 1 : Math.max(...ids) + 1;
  }
  let ids: string[] = [];
  if (collectionKey === 'tasks' && detected.kind === 'task-list') {
    ids = detected.data.tasks.map((t) => t.id);
  } else if (collectionKey === 'themes' && detected.kind === 'roadmap') {
    ids = detected.data.themes.map((t) => t.id);
  } else if (collectionKey === 'items' && detected.kind === 'backlog') {
    ids = detected.data.items.map((it) => it.id);
  } else {
    throw new Error(
      `nextId(${collectionKey}) does not match detected ledger kind ${detected.kind}`,
    );
  }
  const nums = ids.map((id) => Number(id)).filter((n) => !Number.isNaN(n));
  return String(nums.length === 0 ? 1 : Math.max(...nums) + 1);
}

const USAGE = `ledger-cli — mutate the KH workflow ledgers
  show           <ledger> <id>                 (ledger: task|roadmap|backlog)
  flip-task      <taskId> <status>
  flip-subtask   <taskId> <subId> <status>
  append-journal <taskId> <subId> <text>
  add-subtask    <taskId> <subtaskJson>
  update-backlog <itemId> <field> <value>
  open-task      <taskJson>
  create-backlog <itemJson>
  delete-backlog <itemId>
  promote        <backlogId> <taskJson>
flags: --dry-run --pretty --regen-mirrors --scoped --ledger-dir <path>
  --scoped : minimal-diff write — re-emit only the mutated record, preserving
             untouched-record bytes + on-disk \\uXXXX escaping (field edits only:
             flip-task | flip-subtask | append-journal).
errors (exit 1, nothing written): schema-error, walk-error, duplicate-id,
  record-not-found, record-set-violation (a write that would silently drop or
  duplicate a record — the post-write id-set did not match the intended delta).`;

function emit(result: CliResult, pretty: boolean): never {
  const stream = result.ok ? process.stdout : process.stderr;
  if (pretty) {
    if (result.ok) {
      stream.write(`✓ ${result.subcommand}\n`);
      if (result.result !== undefined) {
        stream.write(`${JSON.stringify(result.result, null, 2)}\n`);
      }
      if (result.warnings?.length) {
        process.stderr.write(
          `\n⚠ field-discipline warnings:\n` +
            result.warnings.map((w) => `  - ${w}`).join('\n') +
            '\n',
        );
      }
      if (result.mirrorStale) process.stderr.write(MIRROR_REMINDER);
    } else {
      stream.write(`✗ ${result.subcommand}: ${result.error}\n`);
      if (result.detail) stream.write(`  ${result.detail}\n`);
      if (result.issues) {
        stream.write(`${JSON.stringify(result.issues, null, 2)}\n`);
      }
    }
  } else {
    stream.write(`${JSON.stringify(result)}\n`);
    // warnings + mirror reminder always go to stderr so stdout stays a clean
    // single-line JSON envelope the Orchestrator can parse.
    if (result.ok && result.warnings?.length) {
      process.stderr.write(
        `${JSON.stringify({ warnings: result.warnings })}\n`,
      );
    }
    if (result.ok && result.mirrorStale) process.stderr.write(MIRROR_REMINDER);
  }
  process.exit(result.ok ? 0 : 1);
}

const MIRROR_REMINDER =
  'ℹ mirrors are now stale — run `bash scripts/regen-mirrors.sh` before committing ' +
  '(CI ledger-mirror-parity gates on parity).\n';

// ── shared IO ───────────────────────────────────────────────────────────────

type KnownDetected = Exclude<DetectSchemaResult, { kind: 'unknown' }>;

async function loadLedger(
  path: string,
): Promise<
  | { ok: true; detected: KnownDetected; originalText: string }
  | { ok: false; result: CliResult }
> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (err) {
    return {
      ok: false,
      result: cliErr('load', 'ledger-read-failed', `${path}: ${msg(err)}`),
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return {
      ok: false,
      result: cliErr('load', 'ledger-parse-failed', `${path}: ${msg(err)}`),
    };
  }
  let detected: DetectSchemaResult;
  try {
    detected = detectSchema(parsed);
  } catch (err) {
    // detectSchema throws ZodError if the on-disk ledger fails its own schema.
    if (err instanceof ZodError) {
      return {
        ok: false,
        result: {
          ok: false,
          subcommand: 'load',
          error: 'ledger-schema-invalid',
          detail: path,
          issues: err.issues,
        },
      };
    }
    return { ok: false, result: cliErr('load', 'internal', msg(err)) };
  }
  if (detected.kind === 'unknown') {
    return {
      ok: false,
      result: cliErr(
        'load',
        'unknown-document-name',
        `${path}: document_name ${detected.documentName ?? 'null'}`,
      ),
    };
  }
  return { ok: true, detected, originalText: text };
}

/**
 * Whole-file serialiser. Emits **escaped non-ASCII (`\uXXXX`) + Zod-canonical
 * key order** — the conforming sole-writer format after the OQ-LS-2 (S270)
 * one-time normalisation pass (`scripts/ledger-normalise-oqls2.ts`).
 *
 * Implementation: delegates to `escapeSerialise(detected.data)` from
 * `lib/ledger/scoped-serialise.ts`, which applies 2-space indent, escapes all
 * non-ASCII code units to `\uXXXX` (matching the on-disk ledger convention),
 * and appends a single trailing newline.
 *
 * The scoped path (`lib/ledger/scoped-serialise.ts` / `--scoped` flag) remains
 * available for minimal-diff single-field edits. Both paths now emit the same
 * escaping convention, so the whole-file path is byte-compatible with the
 * scoped path and with `scripts/ledger-sweep-s269.ts`.
 */
function serialise(detected: KnownDetected): string {
  return escapeSerialise(detected.data);
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function cliErr(subcommand: string, error: string, detail?: string): CliResult {
  return { ok: false, subcommand, error, detail };
}

// ── ID-35.16 record-set-preservation write gate (RESEARCH §2.6) ──────────────
//
// The single most severe wrong-shape write is a SILENTLY DROPPED (or
// duplicated) record: Zod re-validates the survivors and passes, the mirror
// regen renders the smaller set, and the only trace is a record that ceased to
// exist. The §2.3 budget gate cannot catch this — it inspects the changed
// record's fields, not the collection's membership. This gate asserts the
// post-write id-set + count equal the pre-write set under the intended delta,
// and CRUCIALLY derives the post-write ids from the BYTES ABOUT TO BE WRITTEN
// (parsing the serialiser output string), so a serialise-side defect
// (key-reorder / escaping / clone bug) is caught one step before it lands.

/** Intended change to a collection's id-set across a single write. */
type RecordSetDelta =
  | { kind: 'none' }
  | { kind: 'add'; id: string | number }
  | { kind: 'remove'; id: string | number };

type IdValue = string | number;

/**
 * A collection descriptor: which id-set inside a parsed ledger document the
 * gate guards. Top-level collections (`tasks` / `themes` / `items`) guard the
 * record-level id-set; `subtasks` guards one task's subtask id-set (for
 * `add-subtask`, a +1 on the addressed task's subtasks).
 */
type CollectionDescriptor =
  | { collection: 'tasks' | 'themes' | 'items' }
  | { collection: 'subtasks'; taskId: string };

/**
 * Extract the id-set of the descriptor's collection from an arbitrary parsed
 * ledger document (plain JSON — the parse of the bytes about to be written, NOT
 * the Zod-reparsed `detected.data`). Returns null when the collection cannot be
 * located (itself a violation the gate surfaces).
 */
function collectionIds(
  parsed: unknown,
  descriptor: CollectionDescriptor,
): Set<IdValue> | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const doc = parsed as Record<string, unknown>;
  if (descriptor.collection === 'subtasks') {
    const tasks = doc.tasks;
    if (!Array.isArray(tasks)) return null;
    const task = tasks.find(
      (t) => (t as { id?: unknown }).id === descriptor.taskId,
    ) as { subtasks?: unknown } | undefined;
    if (!task || !Array.isArray(task.subtasks)) return null;
    return new Set(
      task.subtasks.map((s) => (s as { id: IdValue }).id),
    );
  }
  const arr = doc[descriptor.collection];
  if (!Array.isArray(arr)) return null;
  return new Set(arr.map((r) => (r as { id: IdValue }).id));
}

/**
 * Capture the pre-write id-set from the typed `detected` document at
 * `loadLedger` time. Must be called BEFORE the in-memory mutation for
 * collections whose membership changes (e.g. `add-subtask` replaces the
 * `subtasks` array); for field-edits the id-set is unchanged either way, but
 * capturing before is the safe discipline.
 */
function beforeCollectionIds(
  detected: KnownDetected,
  descriptor: CollectionDescriptor,
): Set<IdValue> {
  if (descriptor.collection === 'subtasks') {
    if (detected.kind !== 'task-list') return new Set();
    const task = detected.data.tasks.find((t) => t.id === descriptor.taskId);
    return new Set((task?.subtasks ?? []).map((s) => s.id));
  }
  if (descriptor.collection === 'tasks' && detected.kind === 'task-list') {
    return new Set(detected.data.tasks.map((t) => t.id));
  }
  if (descriptor.collection === 'themes' && detected.kind === 'roadmap') {
    return new Set(detected.data.themes.map((t) => t.id));
  }
  if (descriptor.collection === 'items' && detected.kind === 'backlog') {
    return new Set(detected.data.items.map((it) => it.id));
  }
  return new Set();
}

type RecordSetCheck = { ok: true } | { ok: false; detail: string };

/**
 * The core gate (ID-35.16). Assert `afterIds` equals `beforeIds` transformed by
 * `expectedDelta`. Reports the unexpectedly-missing and unexpectedly-present
 * ids on violation, so the operator sees exactly which record was dropped or
 * inserted.
 */
function assertRecordSet(
  beforeIds: Set<IdValue>,
  afterIds: Set<IdValue>,
  expectedDelta: RecordSetDelta,
): RecordSetCheck {
  // The expected post-write id-set, derived from beforeIds + the intended delta.
  const expected = new Set<IdValue>(beforeIds);
  if (expectedDelta.kind === 'add') expected.add(expectedDelta.id);
  else if (expectedDelta.kind === 'remove') expected.delete(expectedDelta.id);

  const missing = [...expected].filter((id) => !afterIds.has(id));
  const unexpected = [...afterIds].filter((id) => !expected.has(id));

  if (missing.length === 0 && unexpected.length === 0) return { ok: true };

  const parts: string[] = [];
  if (missing.length) parts.push(`missing [${missing.join(', ')}]`);
  if (unexpected.length) parts.push(`unexpected [${unexpected.join(', ')}]`);
  return { ok: false, detail: parts.join(' / ') };
}

/**
 * Run the record-set gate for one ledger write at the write gate: parse the
 * `content` about to be written, extract the descriptor's id-set, and assert it
 * against `beforeIds` under `expectedDelta`. Returns a `record-set-violation`
 * CliResult on mismatch (caller writes nothing) or `{ ok: true }` to proceed.
 */
function checkRecordSet(
  subcommand: string,
  ledger: LedgerName,
  content: string,
  beforeIds: Set<IdValue>,
  descriptor: CollectionDescriptor,
  expectedDelta: RecordSetDelta,
): { ok: true } | { ok: false; result: CliResult } {
  let afterParsed: unknown;
  try {
    afterParsed = JSON.parse(content);
  } catch (err) {
    return {
      ok: false,
      result: cliErr(
        subcommand,
        'record-set-violation',
        `${ledger}: serialised output is not valid JSON (${msg(err)})`,
      ),
    };
  }
  const afterIds = collectionIds(afterParsed, descriptor);
  if (afterIds === null) {
    return {
      ok: false,
      result: cliErr(
        subcommand,
        'record-set-violation',
        `${ledger}: could not locate the ${descriptor.collection} collection in the serialised output`,
      ),
    };
  }
  const check = assertRecordSet(beforeIds, afterIds, expectedDelta);
  if (!check.ok) {
    return {
      ok: false,
      result: cliErr(
        subcommand,
        'record-set-violation',
        `${ledger}: ${check.detail}`,
      ),
    };
  }
  return { ok: true };
}

/**
 * Surface ID-34 field-discipline warnings for a task-list mutation. Non-fatal:
 * the warnings flow to stderr; the command still succeeds. (Only task-list has
 * a warnings helper; roadmap/backlog mutations return [].)
 */
function disciplineWarnings(detected: KnownDetected): string[] {
  if (detected.kind !== 'task-list') return [];
  try {
    const { warnings } = parseTaskListWithWarnings(detected.data);
    return warnings.map((w) => w.message);
  } catch {
    return [];
  }
}

function maybeRegenMirrors(regen: boolean): void {
  if (!regen) return;
  const r = spawnSync('bash', ['scripts/regen-mirrors.sh'], {
    stdio: 'inherit',
  });
  if (r.status !== 0) {
    process.stderr.write(
      `⚠ regen-mirrors.sh exited ${r.status ?? 'signal'} — regenerate manually.\n`,
    );
  }
}

/**
 * A scoped-write descriptor: the ORIGINAL on-disk text (as read by loadLedger)
 * plus the single FieldPatch applied. When passed to {@link commitMutation} with
 * `--scoped`, the written bytes come from re-emitting only the mutated record
 * into the original text (lib/ledger/scoped-serialise.ts), so untouched records
 * stay byte-identical. Available for field-edit subcommands only (those whose
 * mutation is a single FieldPatch).
 */
interface ScopedWrite {
  originalText: string;
  patch: FieldPatch;
}

/**
 * ID-35.16 record-set-preservation gate inputs for one ledger write: the
 * ledger name (for the error detail), the collection guarded, the pre-write
 * id-set (captured at `loadLedger` time, BEFORE the mutation), and the intended
 * delta. `commitMutation`/`promote` derive `afterIds` from the bytes about to
 * be written and assert the invariant before any byte lands.
 */
interface RecordSetGate {
  ledger: LedgerName;
  descriptor: CollectionDescriptor;
  beforeIds: Set<IdValue>;
  expectedDelta: RecordSetDelta;
}

/**
 * Commit a mutated single-ledger snapshot: serialise + atomicWriteFile, unless
 * `dryRun` (then print the post-mutation document + write nothing). Returns the
 * success envelope.
 *
 * When `scoped` is true AND a {@link ScopedWrite} descriptor is supplied, the
 * written bytes come from {@link scopedSerialise} (minimal diff, on-disk escaping
 * preserved) instead of the non-conforming whole-file {@link serialise}. The
 * scoped path re-derives its bytes from the original text threaded in by the
 * caller — it never re-reads the file after mutation. If the scoped serialiser
 * unexpectedly rejects (it re-validates), the error surfaces as `{ok:false}` and
 * nothing is written.
 *
 * ID-35.16: when a {@link RecordSetGate} is supplied, the record-set-
 * preservation gate runs on the SERIALISED OUTPUT (scoped or whole-file) before
 * `atomicWriteFile` — a serialise-side drop/duplicate is rejected with
 * `record-set-violation` and nothing is written.
 */
async function commitMutation(
  subcommand: string,
  path: string,
  detected: KnownDetected,
  resultPayload: unknown,
  dryRun: boolean,
  regenMirrors: boolean,
  scoped: boolean = false,
  scopedWrite?: ScopedWrite,
  gate?: RecordSetGate,
): Promise<CliResult> {
  const warnings = disciplineWarnings(detected);
  if (dryRun) {
    return {
      ok: true,
      subcommand,
      result: { dryRun: true, document: detected.data },
      warnings: warnings.length ? warnings : undefined,
    };
  }

  let content: string;
  if (scoped && scopedWrite) {
    const r = scopedSerialise(scopedWrite.originalText, scopedWrite.patch);
    if (!r.ok) {
      // The whole-file path already validated via applyPatches, so a scoped
      // failure here is unexpected — surface it rather than silently falling
      // back to a wide whole-file write.
      if (r.kind === 'schema-error') {
        return {
          ok: false,
          subcommand,
          error: 'scoped-schema-error',
          detail:
            r.error instanceof Error ? r.error.message : String(r.error),
        };
      }
      return cliErr(
        subcommand,
        `scoped-${r.kind}`,
        'detail' in r ? r.detail : undefined,
      );
    }
    content = r.text;
  } else {
    content = serialise(detected);
  }

  // ID-35.16 record-set-preservation gate — runs on the bytes ABOUT TO BE
  // WRITTEN (scoped or whole-file), so a serialise-side drop/duplicate is
  // caught one step before it lands. Composes with the §2.3 budget gate.
  if (gate) {
    const g = checkRecordSet(
      subcommand,
      gate.ledger,
      content,
      gate.beforeIds,
      gate.descriptor,
      gate.expectedDelta,
    );
    if (!g.ok) return g.result;
  }

  await atomicWriteFile(path, content);
  maybeRegenMirrors(regenMirrors);
  return {
    ok: true,
    subcommand,
    result: resultPayload,
    warnings: warnings.length ? warnings : undefined,
    mirrorStale: true,
  };
}

// ── subcommand handlers ───────────────────────────────────────────────────────

function fieldPatchMutation(
  subcommand: string,
  detected: KnownDetected,
  patch: FieldPatch,
): { ok: true } | { ok: false; result: CliResult } {
  const applied = applyPatches(detected, [patch]);
  if (!applied.ok) {
    if (applied.kind === 'schema-error') {
      return {
        ok: false,
        result: {
          ok: false,
          subcommand,
          error: 'schema-error',
          issues: applied.zodError.issues,
        },
      };
    }
    if (applied.kind === 'walk-error') {
      return {
        ok: false,
        result: cliErr(subcommand, 'walk-error', applied.detail),
      };
    }
    return { ok: false, result: cliErr(subcommand, applied.kind) };
  }
  // applyPatches mutated detected.data in place and returned the re-parsed
  // typed document; mutate-in-place keeps `detected` authoritative for write.
  return { ok: true };
}

function parseJsonArg(
  subcommand: string,
  raw: string,
): { ok: true; value: unknown } | { ok: false; result: CliResult } {
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch (err) {
    return {
      ok: false,
      result: cliErr(subcommand, 'invalid-json-arg', msg(err)),
    };
  }
}

function journalBlock(text: string): string {
  const ts = new Date().toISOString();
  return `<info added on ${ts}>\n${text}\n</info added on ${ts}>`;
}

async function run(args: ParsedArgs): Promise<CliResult> {
  const { subcommand, positionals: p, flags } = args;
  const dir = flags.ledgerDir;

  switch (subcommand) {
    // ── read ──────────────────────────────────────────────────────────────
    case 'show': {
      const [ledger, id] = p;
      if (!ledger || !id)
        return cliErr('show', 'missing-args', 'show <ledger> <id>');
      if (!(ledger in LEDGER_FILES))
        return cliErr(
          'show',
          'bad-ledger',
          `ledger must be task|roadmap|backlog`,
        );
      const loaded = await loadLedger(ledgerPath(dir, ledger as LedgerName));
      if (!loaded.ok) return loaded.result;
      const d = loaded.detected;
      const record =
        d.kind === 'task-list'
          ? d.data.tasks.find((t) => t.id === id)
          : d.kind === 'roadmap'
            ? d.data.themes.find((t) => t.id === id)
            : d.data.items.find((it) => it.id === id);
      if (!record)
        return cliErr('show', 'record-not-found', `${ledger} id ${id}`);
      return { ok: true, subcommand: 'show', result: record };
    }

    // ── task-list field edits ───────────────────────────────────────────────
    case 'flip-task': {
      const [taskId, status] = p;
      if (!taskId || !status)
        return cliErr(
          'flip-task',
          'missing-args',
          'flip-task <taskId> <status>',
        );
      const loaded = await loadLedger(ledgerPath(dir, 'task'));
      if (!loaded.ok) return loaded.result;
      const descriptor: CollectionDescriptor = { collection: 'tasks' };
      const beforeIds = beforeCollectionIds(loaded.detected, descriptor);
      const patch: FieldPatch = {
        fieldPath: ['tasks', taskId, 'status'],
        newValue: status,
      };
      const m = fieldPatchMutation('flip-task', loaded.detected, patch);
      if (!m.ok) return m.result;
      return commitMutation(
        'flip-task',
        ledgerPath(dir, 'task'),
        loaded.detected,
        { taskId, status },
        flags.dryRun,
        flags.regenMirrors,
        flags.scoped,
        { originalText: loaded.originalText, patch },
        {
          ledger: 'task',
          descriptor,
          beforeIds,
          expectedDelta: { kind: 'none' },
        },
      );
    }

    case 'flip-subtask': {
      const [taskId, subId, status] = p;
      if (!taskId || !subId || !status)
        return cliErr(
          'flip-subtask',
          'missing-args',
          'flip-subtask <taskId> <subId> <status>',
        );
      const loaded = await loadLedger(ledgerPath(dir, 'task'));
      if (!loaded.ok) return loaded.result;
      // The flip is a subtask-field edit; the addressed task's subtask id-set
      // is unchanged (∅), so guard that task's subtasks collection.
      const descriptor: CollectionDescriptor = {
        collection: 'subtasks',
        taskId,
      };
      const beforeIds = beforeCollectionIds(loaded.detected, descriptor);
      const patch: FieldPatch = {
        fieldPath: ['tasks', taskId, 'subtasks', subId, 'status'],
        newValue: status,
      };
      const m = fieldPatchMutation('flip-subtask', loaded.detected, patch);
      if (!m.ok) return m.result;
      return commitMutation(
        'flip-subtask',
        ledgerPath(dir, 'task'),
        loaded.detected,
        { taskId, subId, status },
        flags.dryRun,
        flags.regenMirrors,
        flags.scoped,
        { originalText: loaded.originalText, patch },
        {
          ledger: 'task',
          descriptor,
          beforeIds,
          expectedDelta: { kind: 'none' },
        },
      );
    }

    case 'append-journal': {
      const [taskId, subId, text] = p;
      if (!taskId || !subId || text == null)
        return cliErr(
          'append-journal',
          'missing-args',
          'append-journal <taskId> <subId> <text>',
        );
      const loaded = await loadLedger(ledgerPath(dir, 'task'));
      if (!loaded.ok) return loaded.result;
      if (loaded.detected.kind !== 'task-list')
        return cliErr('append-journal', 'wrong-ledger', 'expected task-list');
      const task = loaded.detected.data.tasks.find((t) => t.id === taskId);
      const sub = task?.subtasks.find((s) => s.id === Number(subId));
      if (!sub)
        return cliErr(
          'append-journal',
          'record-not-found',
          `subtask ${taskId}.${subId}`,
        );
      const descriptor: CollectionDescriptor = {
        collection: 'subtasks',
        taskId,
      };
      const beforeIds = beforeCollectionIds(loaded.detected, descriptor);
      const existing = sub.details ?? '';
      const next = existing
        ? `${existing}\n\n${journalBlock(text)}`
        : journalBlock(text);
      const patch: FieldPatch = {
        fieldPath: ['tasks', taskId, 'subtasks', subId, 'details'],
        newValue: next,
      };
      const m = fieldPatchMutation('append-journal', loaded.detected, patch);
      if (!m.ok) return m.result;
      return commitMutation(
        'append-journal',
        ledgerPath(dir, 'task'),
        loaded.detected,
        { taskId, subId, appended: true },
        flags.dryRun,
        flags.regenMirrors,
        flags.scoped,
        { originalText: loaded.originalText, patch },
        {
          ledger: 'task',
          descriptor,
          beforeIds,
          expectedDelta: { kind: 'none' },
        },
      );
    }

    case 'add-subtask': {
      const [taskId, subtaskJson] = p;
      if (!taskId || !subtaskJson)
        return cliErr(
          'add-subtask',
          'missing-args',
          'add-subtask <taskId> <subtaskJson>',
        );
      const loaded = await loadLedger(ledgerPath(dir, 'task'));
      if (!loaded.ok) return loaded.result;
      if (loaded.detected.kind !== 'task-list')
        return cliErr('add-subtask', 'wrong-ledger', 'expected task-list');
      const parsedArg = parseJsonArg('add-subtask', subtaskJson);
      if (!parsedArg.ok) return parsedArg.result;
      const task = loaded.detected.data.tasks.find((t) => t.id === taskId);
      if (!task)
        return cliErr('add-subtask', 'record-not-found', `task ${taskId}`);
      const descriptor: CollectionDescriptor = {
        collection: 'subtasks',
        taskId,
      };
      const beforeIds = beforeCollectionIds(loaded.detected, descriptor);
      const newSubId = (parsedArg.value as { id?: IdValue }).id;
      const nextSubtasks = [...task.subtasks, parsedArg.value];
      const m = fieldPatchMutation('add-subtask', loaded.detected, {
        fieldPath: ['tasks', taskId, 'subtasks'],
        newValue: nextSubtasks,
      });
      if (!m.ok) return m.result;
      return commitMutation(
        'add-subtask',
        ledgerPath(dir, 'task'),
        loaded.detected,
        { taskId, subtaskCount: nextSubtasks.length },
        flags.dryRun,
        flags.regenMirrors,
        false,
        undefined,
        newSubId !== undefined
          ? {
              ledger: 'task',
              descriptor,
              beforeIds,
              expectedDelta: { kind: 'add', id: newSubId },
            }
          : undefined,
      );
    }

    // ── backlog field edit ───────────────────────────────────────────────────
    case 'update-backlog': {
      const [itemId, field, value] = p;
      if (!itemId || !field || value == null)
        return cliErr(
          'update-backlog',
          'missing-args',
          'update-backlog <itemId> <field> <value>',
        );
      const loaded = await loadLedger(ledgerPath(dir, 'backlog'));
      if (!loaded.ok) return loaded.result;
      const descriptor: CollectionDescriptor = { collection: 'items' };
      const beforeIds = beforeCollectionIds(loaded.detected, descriptor);
      // value may be JSON (for non-string fields) or a bare string.
      let newValue: unknown = value;
      try {
        newValue = JSON.parse(value);
      } catch {
        newValue = value; // bare string
      }
      const m = fieldPatchMutation('update-backlog', loaded.detected, {
        fieldPath: ['items', itemId, field],
        newValue,
      });
      if (!m.ok) return m.result;
      return commitMutation(
        'update-backlog',
        ledgerPath(dir, 'backlog'),
        loaded.detected,
        { itemId, field },
        flags.dryRun,
        flags.regenMirrors,
        false,
        undefined,
        {
          ledger: 'backlog',
          descriptor,
          beforeIds,
          expectedDelta: { kind: 'none' },
        },
      );
    }

    // ── record CREATE / DELETE ───────────────────────────────────────────────
    case 'open-task':
    case 'create-backlog': {
      const ledger: LedgerName =
        subcommand === 'open-task' ? 'task' : 'backlog';
      const [recordJson] = p;
      if (!recordJson)
        return cliErr(subcommand, 'missing-args', `${subcommand} <json>`);
      const loaded = await loadLedger(ledgerPath(dir, ledger));
      if (!loaded.ok) return loaded.result;
      const descriptor: CollectionDescriptor = {
        collection: ledger === 'task' ? 'tasks' : 'items',
      };
      const beforeIds = beforeCollectionIds(loaded.detected, descriptor);
      const parsedArg = parseJsonArg(subcommand, recordJson);
      if (!parsedArg.ok) return parsedArg.result;
      const ins = insertRecord(loaded.detected, parsedArg.value);
      if (!ins.ok) {
        if (ins.kind === 'schema-error')
          return {
            ok: false,
            subcommand,
            error: 'schema-error',
            issues: ins.zodError.issues,
          };
        if (ins.kind === 'duplicate-id')
          return cliErr(subcommand, 'duplicate-id', ins.recordId);
        return cliErr(
          subcommand,
          ins.kind,
          'detail' in ins ? ins.detail : undefined,
        );
      }
      return commitMutation(
        subcommand,
        ledgerPath(dir, ledger),
        ins.detected,
        { recordId: ins.recordId },
        flags.dryRun,
        flags.regenMirrors,
        false,
        undefined,
        {
          ledger,
          descriptor,
          beforeIds,
          expectedDelta: { kind: 'add', id: ins.recordId },
        },
      );
    }

    case 'delete-backlog': {
      const [itemId] = p;
      if (!itemId)
        return cliErr(
          'delete-backlog',
          'missing-args',
          'delete-backlog <itemId>',
        );
      const loaded = await loadLedger(ledgerPath(dir, 'backlog'));
      if (!loaded.ok) return loaded.result;
      const descriptor: CollectionDescriptor = { collection: 'items' };
      const beforeIds = beforeCollectionIds(loaded.detected, descriptor);
      const rem = removeRecord(loaded.detected, itemId);
      if (!rem.ok) {
        if (rem.kind === 'schema-error')
          return {
            ok: false,
            subcommand: 'delete-backlog',
            error: 'schema-error',
            issues: rem.zodError.issues,
          };
        if (rem.kind === 'record-not-found')
          return cliErr('delete-backlog', 'record-not-found', rem.recordId);
        return cliErr('delete-backlog', rem.kind);
      }
      return commitMutation(
        'delete-backlog',
        ledgerPath(dir, 'backlog'),
        rem.detected,
        { recordId: rem.recordId },
        flags.dryRun,
        flags.regenMirrors,
        false,
        undefined,
        {
          ledger: 'backlog',
          descriptor,
          beforeIds,
          expectedDelta: { kind: 'remove', id: rem.recordId },
        },
      );
    }

    // ── cross-ledger promote ─────────────────────────────────────────────────
    case 'promote': {
      const [backlogId, taskJson] = p;
      if (!backlogId || !taskJson)
        return cliErr(
          'promote',
          'missing-args',
          'promote <backlogId> <taskJson>',
        );
      return promote(
        dir,
        backlogId,
        taskJson,
        flags.dryRun,
        flags.regenMirrors,
      );
    }

    default:
      return cliErr(subcommand ?? '<none>', 'unknown-subcommand', USAGE);
  }
}

/**
 * Promote: insert a Task into task-list AND remove the source item from
 * backlog, atomically. Thin CLI glue reusing the vendored insertRecord /
 * removeRecord + staged-write primitives, preserving the documented
 * `task-view/packages/server/ledger-transaction.ts` algorithm:
 * validate-everything-first → stage-both → commit-last (ADD side first, so a
 * kill between the two renames yields a benign transient duplicate, never a
 * lost update). On any pre-commit failure BOTH ledgers are left pristine.
 */
async function promote(
  dir: string,
  backlogId: string,
  taskJson: string,
  dryRun: boolean,
  regenMirrors: boolean,
): Promise<CliResult> {
  const taskListP = ledgerPath(dir, 'task');
  const backlogP = ledgerPath(dir, 'backlog');

  // Phase 1: validate everything (no bytes touched).
  const taskRecord = parseJsonArg('promote', taskJson);
  if (!taskRecord.ok) return taskRecord.result;

  const tlLoad = await loadLedger(taskListP);
  if (!tlLoad.ok) return tlLoad.result;
  const blLoad = await loadLedger(backlogP);
  if (!blLoad.ok) return blLoad.result;
  if (tlLoad.detected.kind !== 'task-list')
    return cliErr('promote', 'wrong-ledger', 'task-list');
  if (blLoad.detected.kind !== 'backlog')
    return cliErr('promote', 'wrong-ledger', 'backlog');

  // ID-35.16 record-set gate: capture pre-write id-sets BEFORE both mutations.
  const taskDescriptor: CollectionDescriptor = { collection: 'tasks' };
  const backlogDescriptor: CollectionDescriptor = { collection: 'items' };
  const taskBeforeIds = beforeCollectionIds(tlLoad.detected, taskDescriptor);
  const backlogBeforeIds = beforeCollectionIds(blLoad.detected, backlogDescriptor);

  const ins = insertRecord(tlLoad.detected, taskRecord.value);
  if (!ins.ok) {
    if (ins.kind === 'schema-error')
      return {
        ok: false,
        subcommand: 'promote',
        error: 'schema-error',
        issues: ins.zodError.issues,
      };
    if (ins.kind === 'duplicate-id')
      return cliErr('promote', 'duplicate-id', ins.recordId);
    return cliErr(
      'promote',
      ins.kind,
      'detail' in ins ? ins.detail : undefined,
    );
  }
  const rem = removeRecord(blLoad.detected, backlogId);
  if (!rem.ok) {
    if (rem.kind === 'schema-error')
      return {
        ok: false,
        subcommand: 'promote',
        error: 'schema-error',
        issues: rem.zodError.issues,
      };
    if (rem.kind === 'record-not-found')
      return cliErr('promote', 'backlog-item-not-found', backlogId);
    return cliErr('promote', rem.kind);
  }

  const newTaskContent = serialise(ins.detected);
  const newBacklogContent = serialise(rem.detected);

  // ID-35.16 record-set gate, run twice (once per ledger) on the bytes ABOUT
  // TO BE WRITTEN: task-list +1 (the new Task id) AND backlog −1 (the source
  // item id). A serialise-side drop/duplicate on either ledger is rejected with
  // `record-set-violation` before either staged write commits.
  const taskGate = checkRecordSet(
    'promote',
    'task',
    newTaskContent,
    taskBeforeIds,
    taskDescriptor,
    { kind: 'add', id: ins.recordId },
  );
  if (!taskGate.ok) return taskGate.result;
  const backlogGate = checkRecordSet(
    'promote',
    'backlog',
    newBacklogContent,
    backlogBeforeIds,
    backlogDescriptor,
    { kind: 'remove', id: rem.recordId },
  );
  if (!backlogGate.ok) return backlogGate.result;

  // Hoist the discipline scan once (it re-parses the task-list) — reused by
  // both the dry-run and the success return.
  const warnings = disciplineWarnings(ins.detected);

  if (dryRun) {
    return {
      ok: true,
      subcommand: 'promote',
      result: {
        dryRun: true,
        newTaskId: ins.recordId,
        removedBacklogId: rem.recordId,
      },
      warnings: warnings.length ? warnings : undefined,
    };
  }

  // Phase 2: stage both (durable temps; originals untouched).
  let stagedTask = null;
  let stagedBacklog = null;
  try {
    stagedTask = await stageAtomicWrite(taskListP, newTaskContent);
    stagedBacklog = await stageAtomicWrite(backlogP, newBacklogContent);
  } catch (err) {
    if (stagedTask) await abortStagedWrite(stagedTask);
    if (stagedBacklog) await abortStagedWrite(stagedBacklog);
    return cliErr('promote', 'stage-failed', msg(err));
  }

  // Phase 3: commit both. ADD side first (async); REMOVE side via a SYNC
  // rename so no microtask/scheduler yield can stretch the two-rename residual
  // window after the first commit resolves — matches ledger-transaction.ts's
  // commitStagedWriteSync. A kill between the two renames then yields a benign
  // transient duplicate (Task present + backlog item present), never a lost
  // update.
  try {
    await commitStagedWrite(stagedTask);
    renameSync(stagedBacklog.tmpPath, stagedBacklog.targetPath);
  } catch (err) {
    return cliErr('promote', 'commit-failed', msg(err));
  }

  maybeRegenMirrors(regenMirrors);
  return {
    ok: true,
    subcommand: 'promote',
    result: { newTaskId: ins.recordId, removedBacklogId: rem.recordId },
    warnings: warnings.length ? warnings : undefined,
    mirrorStale: true,
  };
}

// ── entry ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const parsedResult = parseArgs(process.argv.slice(2));
  if (!parsedResult.ok) {
    // ID-35.15 reject-unknown-flags: structured envelope to stderr, exit 1.
    process.stderr.write(
      `${JSON.stringify({ ok: false, subcommand: '<parse>', error: 'unknown-flag', detail: parsedResult.error })}\n`,
    );
    process.exit(1);
  }
  const args = parsedResult.parsed;
  if (
    !args.subcommand ||
    args.subcommand === '--help' ||
    args.subcommand === '-h'
  ) {
    process.stdout.write(`${USAGE}\n`);
    process.exit(args.subcommand ? 0 : 1);
  }
  const result = await run(args);
  emit(result, args.flags.pretty);
}

// Allow import for tests without triggering the CLI dispatch.
if (import.meta.main) {
  main().catch((err) => {
    process.stderr.write(
      `${JSON.stringify({ ok: false, subcommand: 'internal', error: 'internal', detail: err instanceof Error ? err.message : String(err) })}\n`,
    );
    process.exit(1);
  });
}

export {
  parseArgs,
  readRecordInput,
  nextId,
  assertRecordSet,
  run,
  journalBlock,
  ledgerPath,
  LEDGER_FILES,
};
export type { CliResult, ParsedArgs };
