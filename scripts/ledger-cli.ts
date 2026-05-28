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
 *   read (no write gate):
 *     show           <ledger> <id>                 (ledger: task|roadmap|backlog)
 *     get            <ledger> <id> [field]         (single-field read; no field = show)
 *     schema         [ledger|recordKind]           (field names + types + budgets)
 *   status flips / field edits:
 *     flip-task      <taskId> <status>
 *     flip-subtask   <taskId> <subId> <status>
 *     update-task    <taskId> <field> <value>
 *     update-subtask <taskId.subId> <field> <value>
 *     update-roadmap <themeId> <field> <value>
 *     update-backlog <itemId> <field> <value>
 *     append-journal <taskId> <subId> <text>
 *   record create / delete:
 *     add-subtask    <taskId> <subtaskJson | --title …>
 *     open-task      <taskJson | --title …>
 *     create-theme   <themeJson | --title …>
 *     create-backlog <itemJson | --title …>
 *     delete-backlog <itemId>
 *   cross-ledger:
 *     promote        <backlogId> <taskJson>
 *   flags: --dry-run --pretty --scoped --force --no-regen-mirrors --ledger-dir <path>
 *
 * Write gates (RESEARCH §2.3/§2.6 — prevent-at-source; both reject at WRITE TIME,
 * exit 1, nothing written):
 *   - record-set ({35.16}): the post-write id-set must equal the pre-write set
 *     under the intended delta (∅ / +1 / −1) — catches a silently dropped or
 *     duplicated record on BOTH the scoped and whole-file paths.
 *   - budget ({35.17}): the CHANGED record's budgeted fields are checked against
 *     `LEDGER_BUDGETS` before any byte is written; over-budget → `budget-exceeded`.
 *     `--force` downgrades it to the existing soft warning and writes anyway.
 *     (`subtask.details` is unbudgeted — the append-only journal home.)
 *
 * Input (record-creating commands): positional JSON | `--file <path>` (- = stdin)
 * | named flags (`--title --description --status --depends 1,2 …`). When `--id`
 * is absent and the body carries no id, an auto-id (`max(existingIds)+1`) is
 * injected — a STRING for task/theme/backlog ids, a NUMBER for subtask ids.
 *
 * Mirror regen ({35.18}) runs by DEFAULT after every write; `--no-regen-mirrors`
 * opts out (batch edits run `bash scripts/regen-mirrors.sh` once at the end).
 * `--regen-mirrors` is a DEPRECATED no-op alias.
 *
 * Discoverability ({35.22}): `schema [ledger|recordKind]` prints each field's
 * name + type + budget so the deps-type asymmetry (subtask.dependencies:number[]
 * vs task.dependencies:string[]) is explicit; `<command> --help` prints that
 * command's flags + its target record's schema slice.
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
import {
  parseTaskListWithWarnings,
  SubtaskSchema,
  TaskSchema,
} from '@/lib/validation/task-list-schema';
import { RoadmapThemeSchema } from '@/lib/validation/roadmap-schema';
import { BacklogItemSchema } from '@/lib/validation/backlog-schema';
import {
  LEDGER_BUDGETS,
  type LedgerRecordKind,
} from '@/lib/validation/ledger-budgets';
import type { ZodTypeAny } from 'zod';

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
    /**
     * ID-35.21 backlog-item structural value-flags. `create-backlog`'s
     * required scalar fields `type` / `track` are not expressible by the
     * {35.15} flag set; adding them lets `create-backlog --title … --type …
     * --track …` build a complete item from flags. Absent → structural
     * defaults apply (`withCreateDefaults`).
     */
    type?: string;
    track?: string;
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
  '--type': 'type',
  '--track': 'track',
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
  const rawSubcommand = positionals.shift();
  // ID-35.34 — alias normalisation. `show-task` was a common dogfood typo
  // (mirrors `flip-task` / `update-task`); resolve it once here so BOTH the
  // dispatch switch in run() AND the per-subcommand --help registry observe
  // the canonical name.
  const subcommand =
    rawSubcommand !== undefined
      ? (SUBCOMMAND_ALIASES[rawSubcommand] ?? rawSubcommand)
      : undefined;
  return {
    ok: true,
    parsed: { subcommand, positionals, flags },
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
      text =
        flags.file === '-'
          ? readFileSync(0, 'utf8')
          : readFileSync(flags.file, 'utf8');
    } catch (err) {
      return {
        ok: false,
        result: cliErr(
          subcommand,
          'input-read-failed',
          `${flags.file}: ${msg(err)}`,
        ),
      };
    }
    try {
      return { ok: true, value: JSON.parse(text) };
    } catch (err) {
      return {
        ok: false,
        result: cliErr(
          subcommand,
          'invalid-json-arg',
          `${flags.file}: ${msg(err)}`,
        ),
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
  if (flags.testStrategy !== undefined)
    record.testStrategy = flags.testStrategy;
  if (flags.statusNote !== undefined) record.status_note = flags.statusNote;
  if (flags.type !== undefined) record.type = flags.type;
  if (flags.track !== undefined) record.track = flags.track;
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

// ── ID-35.22 discoverability: schema / per-subcommand --help / get ────────────
//
// The "prevent guessing" fix (RESEARCH §5.2 + §3). Agents kept guessing the
// id/deps TYPES every session — `subtask.id` is a NUMBER but `task.id` is a
// STRING (a Taskmaster mandate, NOT a KH oversight — RESEARCH §3), so
// `subtask.dependencies` is `number[]` and `task.dependencies` is `string[]`.
// Nothing documented this at the point of use. `schema` / `--help` now print,
// per record kind, every field's name + type + budget + required/optional +
// enum values, DERIVED FROM `Schema.shape` so the surface can never drift from
// the schema. No type change; no migration (RESEARCH §3 — functional-keep).

/** The four documented record kinds, each backed by a Zod object schema. */
type SchemaRecordKind = 'task' | 'subtask' | 'theme' | 'item';

/** Schemas keyed by record kind. Zod v4 exposes `.shape` directly even with a
 * trailing `.superRefine` (TaskSchema) — so all four shapes are introspectable. */
const SCHEMA_SHAPES: Record<
  SchemaRecordKind,
  { shape: Record<string, ZodTypeAny> }
> = {
  task: TaskSchema,
  subtask: SubtaskSchema,
  theme: RoadmapThemeSchema,
  item: BacklogItemSchema,
};

/** The label each record kind reads as at the point of use (RESEARCH §5.2):
 * a backlog item field is documented as `backlog.title`, not `item.title`. */
const KIND_LABEL: Record<SchemaRecordKind, string> = {
  task: 'task',
  subtask: 'subtask',
  theme: 'theme',
  item: 'backlog',
};

/** Budget registry key per record kind (the registry is keyed by record kind,
 * not by the `backlog` display label). */
const KIND_BUDGET_KEY: Record<SchemaRecordKind, LedgerRecordKind> = {
  task: 'task',
  subtask: 'subtask',
  theme: 'theme',
  item: 'item',
};

/** Per-field human annotations layered on top of the derived type label. */
const FIELD_NOTES: Partial<Record<SchemaRecordKind, Record<string, string>>> = {
  subtask: {
    dependencies: 'sibling-only',
  },
};

/** Read a Zod v4 schema's internal def (the `_zod.def` discriminated record). */
interface ZodDef {
  type?: string;
  innerType?: ZodTypeAny;
  element?: ZodTypeAny;
  entries?: Record<string, unknown>;
}
function zodDef(schema: ZodTypeAny): ZodDef {
  // Zod v4 stores the def under `_zod.def`; fall back to the legacy `_def`.
  const s = schema as unknown as {
    _zod?: { def?: ZodDef };
    _def?: ZodDef;
  };
  return s._zod?.def ?? s._def ?? {};
}

/**
 * Map a Zod field schema to a readable type label, recursing through the v4
 * wrapper types (`optional` / `nullable` → `innerType`, `array` → `element`,
 * `enum` → its values). Falls back to the raw Zod `type` discriminator for any
 * unmapped shape so the renderer never crashes on a novel field (watch-out).
 * Returns the base type label; the `(optional)` / `(nullable)` markers are
 * appended by the caller (which tracks them separately).
 */
function zodTypeLabel(schema: ZodTypeAny): string {
  const def = zodDef(schema);
  switch (def.type) {
    case 'optional':
    case 'nullable':
      // Unwrap — the marker is recorded by labelField, not embedded here.
      return def.innerType ? zodTypeLabel(def.innerType) : (def.type ?? '?');
    case 'array': {
      const el = def.element ? zodTypeLabel(def.element) : 'unknown';
      return `${el}[]`;
    }
    case 'enum': {
      const values = def.entries ? Object.keys(def.entries) : [];
      return `enum(${values.join(' | ')})`;
    }
    case 'string':
    case 'number':
    case 'boolean':
    case 'object':
    case 'literal':
      return def.type;
    default:
      // Unmapped — fall back to the raw typeName rather than crashing.
      return def.type ?? 'unknown';
  }
}

/** Walk a field schema's wrappers to record whether it is optional / nullable. */
function fieldModifiers(schema: ZodTypeAny): {
  optional: boolean;
  nullable: boolean;
} {
  let optional = false;
  let nullable = false;
  let cur: ZodTypeAny | undefined = schema;
  while (cur) {
    const def = zodDef(cur);
    if (def.type === 'optional') optional = true;
    else if (def.type === 'nullable') nullable = true;
    else break;
    cur = def.innerType;
  }
  return { optional, nullable };
}

/** Render one field's documentation line, e.g.
 * `  subtask.dependencies: number[] (sibling-only)` or
 * `  backlog.title: string ≤80 (optional)`. */
function labelField(
  kind: SchemaRecordKind,
  field: string,
  schema: ZodTypeAny,
): string {
  const base = zodTypeLabel(schema);
  const { optional, nullable } = fieldModifiers(schema);
  const budgets = LEDGER_BUDGETS[KIND_BUDGET_KEY[kind]] as Record<
    string,
    number
  >;
  const budget = budgets[field];

  const parts = [`${base}`];
  if (budget !== undefined) parts.push(`≤${budget}`);
  const suffixes: string[] = [];
  const note = FIELD_NOTES[kind]?.[field];
  if (note) suffixes.push(note);
  if (optional) suffixes.push('optional');
  if (nullable) suffixes.push('nullable');

  let line = `  ${KIND_LABEL[kind]}.${field}: ${parts.join(' ')}`;
  if (suffixes.length) line += ` (${suffixes.join(', ')})`;
  return line;
}

/** Render a full record-kind schema slice (header + every field line). */
function renderKind(kind: SchemaRecordKind): string {
  const { shape } = SCHEMA_SHAPES[kind];
  const lines = [`${KIND_LABEL[kind]} record (${kind}):`];
  for (const [field, fieldSchema] of Object.entries(shape)) {
    lines.push(labelField(kind, field, fieldSchema as ZodTypeAny));
  }
  return lines.join('\n');
}

/** Map a `schema`/help target token to the record kind(s) it documents.
 * A ledger name resolves to ALL its record kinds (task → task + subtask). */
const SCHEMA_TARGETS: Record<string, SchemaRecordKind[]> = {
  // ledger names
  task: ['task', 'subtask'],
  roadmap: ['theme'],
  backlog: ['item'],
  // record-kind aliases
  subtask: ['subtask'],
  theme: ['theme'],
  item: ['item'],
};

/**
 * Render the `schema [target]` output. No target → every record kind. A ledger
 * name (`task`) → its record kinds (task + subtask, so the deps-type asymmetry
 * is visible side-by-side). A record kind (`subtask`) → that kind only. Returns
 * null for an unknown target so the caller can emit `bad-schema-target`.
 */
function renderSchema(target?: string): string | null {
  let kinds: SchemaRecordKind[];
  if (target === undefined) {
    kinds = ['task', 'subtask', 'theme', 'item'];
  } else {
    const resolved = SCHEMA_TARGETS[target];
    if (!resolved) return null;
    kinds = resolved;
  }
  return kinds.map(renderKind).join('\n\n');
}

/**
 * Per-subcommand `--help` (RESEARCH §5.2). Returns the command's argv shape +
 * flags + its target record's schema slice, or null for an unknown command
 * (caller falls back to the global USAGE). Replaces the old bare-USAGE
 * fall-through where `add-subtask --help` returned only the global usage line.
 */
function subcommandHelp(command: string): string | null {
  // ID-35.34 — resolve aliases so `show-task --help` returns the same payload
  // as `show --help`.
  const canonical = SUBCOMMAND_ALIASES[command] ?? command;
  const spec = SUBCOMMAND_HELP[canonical];
  if (!spec) return null;
  const lines = [`${canonical} — ${spec.synopsis}`];
  if (spec.flags) lines.push(`  flags: ${spec.flags}`);
  if (spec.kinds && spec.kinds.length) {
    lines.push('', 'schema:');
    lines.push(...spec.kinds.map(renderKind));
  }
  return lines.join('\n');
}

/**
 * ID-35.34 — subcommand aliases. Operators frequently type `show-task` by
 * analogy with `flip-task` / `update-task`; we accept it and dispatch the
 * canonical `show` instead of failing with `unknown-subcommand`. The alias is
 * applied at parseArgs() time so the entire downstream pipeline (run dispatch
 * + per-subcommand --help) sees the canonical name only.
 */
const SUBCOMMAND_ALIASES: Record<string, string> = {
  'show-task': 'show',
};

/** Per-subcommand help registry: argv synopsis, command-relevant flags, and
 * the record kind(s) whose schema slice the command operates on. */
const SUBCOMMAND_HELP: Record<
  string,
  { synopsis: string; flags?: string; kinds?: SchemaRecordKind[] }
> = {
  show: { synopsis: 'show <ledger> <id> — print a full record (read-only)' },
  get: {
    synopsis:
      'get <ledger> <id> [field] — read one field (or the whole record)',
  },
  schema: {
    synopsis:
      'schema [ledger|recordKind] — print field names + types + budgets',
  },
  'flip-task': {
    synopsis: 'flip-task <taskId> <status> — set a Task status',
    flags: '--scoped --dry-run --pretty --no-regen-mirrors',
    kinds: ['task'],
  },
  'flip-subtask': {
    synopsis: 'flip-subtask <taskId> <subId> <status> — set a Subtask status',
    flags: '--scoped --dry-run --pretty --no-regen-mirrors',
    kinds: ['subtask'],
  },
  'update-task': {
    synopsis: 'update-task <taskId> <field> <value> — edit a Task field',
    flags: '--force --dry-run --pretty --no-regen-mirrors',
    kinds: ['task'],
  },
  'update-subtask': {
    synopsis:
      'update-subtask <taskId.subId> <field> <value> — edit a Subtask field',
    flags: '--force --dry-run --pretty --no-regen-mirrors',
    kinds: ['subtask'],
  },
  'update-roadmap': {
    synopsis: 'update-roadmap <themeId> <field> <value> — edit a Theme field',
    flags: '--force --dry-run --pretty --no-regen-mirrors',
    kinds: ['theme'],
  },
  'update-backlog': {
    synopsis: 'update-backlog <itemId> <field> <value> — edit a backlog field',
    flags: '--force --dry-run --pretty --no-regen-mirrors',
    kinds: ['item'],
  },
  'append-journal': {
    synopsis: 'append-journal <taskId> <subId> <text> — append a journal block',
    flags: '--scoped --dry-run --pretty --no-regen-mirrors',
    kinds: ['subtask'],
  },
  'add-subtask': {
    synopsis:
      'add-subtask <taskId> <subtaskJson | --title …> — insert a Subtask',
    flags:
      'input: positional JSON | --file <path> (- = stdin) | named flags ' +
      '(--title --description --status --depends 1,2 …); --id forces an id; ' +
      '--force --dry-run --pretty --no-regen-mirrors',
    kinds: ['subtask'],
  },
  'open-task': {
    synopsis: 'open-task <taskJson | --title …> — insert a Task',
    flags:
      'input: positional JSON | --file <path> (- = stdin) | named flags; ' +
      '--id forces an id; --force --dry-run --pretty --no-regen-mirrors',
    kinds: ['task'],
  },
  'create-theme': {
    synopsis: 'create-theme <themeJson | --title …> — insert a roadmap Theme',
    flags:
      'input: positional JSON | --file <path> (- = stdin) | named flags; ' +
      '--id forces an id; --force --dry-run --pretty --no-regen-mirrors',
    kinds: ['theme'],
  },
  'create-backlog': {
    synopsis: 'create-backlog <itemJson | --title …> — insert a backlog item',
    flags:
      'input: positional JSON | --file <path> (- = stdin) | named flags ' +
      '(--title --description --type --track …); --id forces an id; ' +
      '--force --dry-run --pretty --no-regen-mirrors',
    kinds: ['item'],
  },
  'delete-backlog': {
    synopsis: 'delete-backlog <itemId> — remove a backlog item',
    flags: '--dry-run --pretty --no-regen-mirrors',
    kinds: ['item'],
  },
  promote: {
    synopsis:
      'promote <backlogId> <taskJson> — atomically promote a backlog item to a Task',
    flags: '--force --dry-run --pretty --no-regen-mirrors',
    kinds: ['task', 'item'],
  },
};

const USAGE = `ledger-cli — mutate the KH workflow ledgers
  show           <ledger> <id>                 (ledger: task|roadmap|backlog)
  get            <ledger> <id> [field]         (single-field read; no field = show)
  schema         [ledger|recordKind]           (print field names + types + budgets)
  flip-task      <taskId> <status>
  flip-subtask   <taskId> <subId> <status>
  update-subtask <taskId.subId> <field> <value>
  update-task    <taskId> <field> <value>
  update-roadmap <themeId> <field> <value>
  append-journal <taskId> <subId> <text>
  add-subtask    <taskId> <subtaskJson>
  update-backlog <itemId> <field> <value>
  open-task      <taskJson>
  create-backlog <itemJson>
  create-theme   <themeJson>
  delete-backlog <itemId>
  promote        <backlogId> <taskJson>
flags: --dry-run --pretty --scoped --force --no-regen-mirrors --ledger-dir <path>
  --scoped : minimal-diff write — re-emit only the mutated record, preserving
             untouched-record bytes + on-disk \\uXXXX escaping (field edits only:
             flip-task | flip-subtask | append-journal).
  --force  : downgrade a budget-exceeded rejection to a soft warning and write
             anyway (escape hatch for the rare legitimate over-budget field).
  --no-regen-mirrors : skip the default-on mirror regen (e.g. batch edits — run
             \`bash scripts/regen-mirrors.sh\` once at the end).
  --regen-mirrors : DEPRECATED no-op alias — regen is now the default.
discoverability: \`schema [ledger|recordKind]\` prints each field's name + type +
  budget (so subtask.dependencies:number[] vs task.dependencies:string[] is
  explicit — never guess). \`<command> --help\` prints that command's flags + its
  target record's schema slice.
input (record-creating commands): positional JSON | --file <path> (- = stdin) |
  named flags (--title --description --status --depends 1,2 --priority --id …).
errors (exit 1, nothing written): schema-error, walk-error, duplicate-id,
  record-not-found, budget-exceeded (a budgeted field over its char budget —
  override with --force), record-set-violation (a write that would silently
  drop or duplicate a record — the post-write id-set did not match the
  intended delta).`;

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
  'ℹ mirror regen runs by default after a write; if you passed --no-regen-mirrors, ' +
  'run `bash scripts/regen-mirrors.sh` before committing ' +
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
    return new Set(task.subtasks.map((s) => (s as { id: IdValue }).id));
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

// ── ID-35.17 write-time budget pre-check (RESEARCH §2.3 — the north star) ─────
//
// PREVENT-AT-SOURCE: the CLI refuses to AUTHOR an over-budget record. After the
// in-memory mutation but BEFORE any byte is written, the CHANGED record's
// budgeted fields are checked against `LEDGER_BUDGETS`. Over-budget → reject
// (exit 1, write nothing); `--force` downgrades to the existing soft warning
// and proceeds (escape hatch). The message is SCOPED to the changed record —
// one line naming field + actual length + budget — NEVER the ~135 KB
// whole-ledger `parseTaskListWithWarnings` dump.
//
// Budgets are PLAIN DATA, never a Zod `.max()` (RESEARCH §2.3/§7): the schema
// stays cap-free so the live over-budget ledger keeps parsing and a `--force`
// write still validates. `subtask.details` is intentionally absent from the
// registry → automatically EXEMPT (the append-only journal home).

/**
 * Budget-gate inputs for the single CHANGED record of a write: which registry
 * record-kind to budget against, the record id (for the message), and the
 * post-mutation record object whose budgeted fields are measured.
 *
 * ID-35.26: `mutatedField` (when set) names the single field this write
 * touches — `checkBudget` then REJECTS only on that field and surfaces any
 * over-budget UNTOUCHED budgeted fields as soft warnings (the operator never
 * touched them, so a rejection is wrong). When `mutatedField` is undefined
 * (create / add / promote — every budgeted field is freshly authored), the
 * gate keeps the original "reject on the first over-budget field" semantics.
 */
interface BudgetGate {
  ledger: LedgerName;
  recordKind: LedgerRecordKind;
  recordId: string | number;
  record: Record<string, unknown>;
  /** When set, only this field can REJECT; other over-budget fields warn. */
  mutatedField?: string;
}

/**
 * Check the changed record's budgeted fields against `LEDGER_BUDGETS`.
 *
 * Behaviour by mode:
 *   - `mutatedField` undefined (create / add / promote — authoring every
 *     field): returns the FIRST over-budget violation as a rejection. Matches
 *     the original ID-35.17 semantics.
 *   - `mutatedField` set (update-* — only one field changes): returns a
 *     rejection ONLY when that mutated field is over-budget. Any other
 *     over-budget budgeted fields are returned as `warnings` so the operator
 *     sees them without the write being rejected (untouched-field discipline
 *     escape, ID-35.26).
 *
 * Fields absent from the registry for the kind (e.g. `subtask.details`) are
 * not budgeted, so they never flag. Non-string field values are skipped
 * (budgets are char-length on text fields).
 */
function checkBudget(
  gate: BudgetGate,
):
  | { ok: true; warnings: string[] }
  | { ok: false; detail: string; warnings: string[] } {
  if (!gate.record || typeof gate.record !== 'object')
    return { ok: true, warnings: [] };
  const budgets = LEDGER_BUDGETS[gate.recordKind] as Record<string, number>;
  const warnings: string[] = [];
  let mutatedViolation: { detail: string } | null = null;
  for (const [field, budget] of Object.entries(budgets)) {
    const value = gate.record[field];
    if (typeof value !== 'string') continue;
    if (value.length <= budget) continue;
    const line = `${field} is ${value.length} chars (budget ${budget}) on ${gate.ledger} ${gate.recordId}`;
    if (gate.mutatedField === undefined) {
      // Create / add / promote — first over-budget field is fatal.
      return { ok: false, detail: line, warnings: [] };
    }
    if (field === gate.mutatedField) {
      mutatedViolation = { detail: line };
    } else {
      // Untouched over-budget field — surface as a soft warning (not a
      // rejection). The operator never edited it; rejecting blocks legitimate
      // edits to unrelated fields (the ID-35.26 defect).
      warnings.push(`budget (untouched): ${line}`);
    }
  }
  if (mutatedViolation)
    return { ok: false, detail: mutatedViolation.detail, warnings };
  return { ok: true, warnings };
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

/**
 * ID-35.18: mirror regeneration is DEFAULT-ON after every write (RESEARCH §2.5)
 * — callers pass `!flags.noRegenMirrors`, so a mutation keeps
 * `docs/reference/{tasks,roadmap,backlog}/` in sync and `ledger-mirror-parity`
 * stays green. `--no-regen-mirrors` opts out (batch edits run it once at the
 * end). FAIL-LOUD: a non-zero `regen-mirrors.sh` exit surfaces a loud stderr
 * warning — the write has ALREADY committed, so this is a post-write alert, NOT
 * a rollback.
 */
/**
 * The regen invocation, behind a module-level seam so tests can replace it
 * without shelling out to the real `regen-mirrors.sh` (which clones task-view).
 * Returns the child exit status (`null` on signal). Production default invokes
 * the script synchronously.
 */
type RegenRunner = () => number | null;

let regenRunner: RegenRunner = () => {
  const r = spawnSync('bash', ['scripts/regen-mirrors.sh'], {
    stdio: 'inherit',
  });
  return r.status;
};

/** Test seam (ID-35.18): override the regen runner; pass `null` to restore. */
function __setRegenRunnerForTest(runner: RegenRunner | null): void {
  regenRunner = runner ?? defaultRegenRunner;
}
const defaultRegenRunner = regenRunner;

/**
 * Run the default-on mirror regen and report whether mirrors are now STALE.
 * Returns true when the operator must regen before committing — i.e. regen was
 * suppressed (`--no-regen-mirrors`) OR it ran but exited non-zero. Returns false
 * when regen ran and succeeded (mirrors are fresh). The success envelope's
 * `mirrorStale` field reflects this, so it is only set when a manual regen is
 * actually outstanding (not unconditionally true).
 */
function maybeRegenMirrors(regen: boolean): boolean {
  if (!regen) return true; // suppressed → mirrors left stale by design.
  const status = regenRunner();
  if (status !== 0) {
    process.stderr.write(
      `⚠ MIRROR REGEN FAILED: regen-mirrors.sh exited ${status ?? 'signal'}. ` +
        `The write already committed — mirrors are now STALE. ` +
        `Re-run \`bash scripts/regen-mirrors.sh\` manually before committing ` +
        `(CI ledger-mirror-parity will otherwise fail).\n`,
    );
    return true; // regen failed → still stale.
  }
  return false; // regen succeeded → mirrors fresh.
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
 * Options for a single-ledger {@link commitMutation}. Only `subcommand`, `path`,
 * `detected`, and `resultPayload` are required (the write identity + success
 * payload); the rest are named so call sites are self-documenting and adding a
 * future gate can never cause a positional-argument-order mistake.
 *
 * - `dryRun` / `regenMirrors` / `force`: the flag-derived write modifiers.
 * - `scoped` + `scopedWrite`: ID-35.11 minimal-diff write (field edits only).
 * - `gate`: ID-35.16 record-set-preservation gate.
 * - `budgetGate`: ID-35.17 write-time budget pre-check.
 */
interface CommitMutationOptions {
  subcommand: string;
  path: string;
  detected: KnownDetected;
  resultPayload: unknown;
  dryRun: boolean;
  regenMirrors: boolean;
  scoped?: boolean;
  scopedWrite?: ScopedWrite;
  gate?: RecordSetGate;
  budgetGate?: BudgetGate;
  force?: boolean;
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
async function commitMutation(opts: CommitMutationOptions): Promise<CliResult> {
  const {
    subcommand,
    path,
    detected,
    resultPayload,
    dryRun,
    regenMirrors,
    scoped = false,
    scopedWrite,
    gate,
    budgetGate,
    force = false,
  } = opts;
  const warnings = disciplineWarnings(detected);

  // ID-35.17 budget pre-check — on the CHANGED record's budgeted fields, after
  // the in-memory mutation, BEFORE any byte is written. Over-budget → reject
  // (scoped one-line message); `--force` downgrades to a soft warning and
  // proceeds. Runs ahead of serialisation so an over-budget write does no I/O.
  //
  // ID-35.26: update-* call sites set `budgetGate.mutatedField` so only that
  // field can REJECT. Over-budget UNTOUCHED fields surface as `b.warnings` —
  // the operator never touched them, so a rejection would block legitimate
  // edits to unrelated fields. Create / add / promote leave `mutatedField`
  // undefined and keep the original "every budgeted field can reject" gate.
  if (budgetGate) {
    const b = checkBudget(budgetGate);
    if (b.warnings.length) warnings.push(...b.warnings);
    if (!b.ok) {
      if (force) {
        warnings.push(`(forced) budget-exceeded: ${b.detail}`);
      } else {
        return cliErr(subcommand, 'budget-exceeded', b.detail);
      }
    }
  }

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
          detail: r.error instanceof Error ? r.error.message : String(r.error),
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
  const mirrorStale = maybeRegenMirrors(regenMirrors);
  return {
    ok: true,
    subcommand,
    result: resultPayload,
    warnings: warnings.length ? warnings : undefined,
    mirrorStale,
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

// ── ID-35.21 field-type-aware value coercion (RESEARCH §5.3) ─────────────────
//
// The old `update-backlog` heuristic — try `JSON.parse(value)`, else bare
// string — is a SILENT BUG: a string value that happens to be valid JSON
// (`"123"`, `"true"`, `"[1]"`) was coerced to a non-string, so
// `update-backlog 100 description "123"` wrote the number 123. The fix drives
// the parse by the field's Zod type rather than by "does it parse as JSON".
//
// Rule (single shared helper for update-subtask / update-task / update-roadmap
// / update-backlog): if the field's schema ACCEPTS the raw string as-is
// (string fields + string enums — `safeParse(raw)` succeeds), keep the raw
// string. Otherwise (array / number / boolean fields) the schema rejects the
// raw string, so `JSON.parse` the value to obtain the structured type. An
// unknown field has no schema entry → keep the raw string (the keyset guard
// inside `fieldPatchMutation` then rejects the unknown field downstream).

/** The four editable record schemas keyed by CLI command's record kind. */
const EDIT_SCHEMAS: Record<
  'subtask' | 'task' | 'theme' | 'item',
  { shape: Record<string, ZodTypeAny> }
> = {
  subtask: SubtaskSchema,
  // Zod v4 exposes `.shape` directly on the object schema even with a trailing
  // `.superRefine` (the sibling-dep check), so `TaskSchema.shape` is available.
  task: TaskSchema,
  theme: RoadmapThemeSchema,
  item: BacklogItemSchema,
};

/**
 * Field-type-aware coercion (ID-35.21 / RESEARCH §5.3). Returns the value to
 * patch into `field` from a raw argv string, driven by the record kind's Zod
 * field schema:
 *   - field schema accepts the raw string  → keep the string verbatim
 *     (so `description "123"` stays `"123"`, `status "done"` stays `"done"`).
 *   - field schema rejects the raw string   → `JSON.parse` it (so
 *     `dependencies "[1,2]"` becomes `[1, 2]`); a JSON-parse failure falls back
 *     to the raw string (a genuinely-string value the schema happened to
 *     reject, e.g. an enum typo — let the keyset/schema gate report it).
 *   - unknown field (no schema entry)        → keep the raw string (the
 *     keyset guard rejects the unknown field downstream).
 */
function coerceFieldValue(
  recordKind: 'subtask' | 'task' | 'theme' | 'item',
  field: string,
  raw: string,
): unknown {
  const fieldSchema = EDIT_SCHEMAS[recordKind].shape[field];
  if (fieldSchema === undefined) return raw; // unknown field → keyset rejects later.
  if (fieldSchema.safeParse(raw).success) return raw; // string / enum field.
  try {
    return JSON.parse(raw); // array / number / boolean field.
  } catch {
    return raw; // not JSON either — surface the raw value for the schema gate.
  }
}

// ── ID-35.21 record-create plumbing: structural defaults + auto-id ───────────
//
// The named-flag input path ({35.15} `readRecordInput`) builds a record from
// only the supplied flags. To make `create-backlog --title X` / `add-subtask 35
// --title Y` schema-valid (RESEARCH §2.4 — "sensible defaults fill required
// structural fields"), the record-creating commands fill the always-present
// empty-shape fields per record kind before insert. Scalar required fields
// (title / description / priority / type / track) are NOT defaulted — they come
// from flags/JSON, and the schema rightly rejects their absence.

/** Per-record-kind structural defaults — empty arrays, nulls, empty strings. */
const CREATE_DEFAULTS: Record<
  'subtask' | 'task' | 'theme' | 'item',
  Record<string, unknown>
> = {
  subtask: {
    details: '',
    status: 'pending',
    dependencies: [],
    testStrategy: null,
  },
  task: {
    status: 'pending',
    dependencies: [],
    subtasks: [],
    effort_estimate: null,
    owner: null,
    priority_note: null,
    status_note: null,
    cross_doc_links: [],
    session_refs: [],
    commit_refs: [],
    updatedAt: '',
  },
  theme: {
    status: 'pending',
    time_horizon: 'later',
    linked_tasks: [],
    linked_backlog: [],
    session_refs: [],
    commit_refs: [],
    cross_doc_links: [],
    notes: null,
  },
  item: {
    // `type` / `track` are required scalars with no inherent empty value;
    // these structural defaults keep a bare `create-backlog --title X` valid
    // (RESEARCH §2.4) and signal an untriaged item (override via --type/--track
    // or the positional/JSON body).
    type: 'feature',
    track: 'unsorted',
    status: 'parked',
    dependencies: [],
    effort_estimate: null,
    session_refs: [],
    commit_refs: [],
    cross_doc_links: [],
    notes: null,
  },
};

/**
 * Merge structural defaults UNDER the supplied record (supplied fields win).
 * Defaults only apply for absent keys, so a positional-JSON body that already
 * carries (e.g.) `status` keeps its value. `task.updatedAt` defaults to the
 * write timestamp when absent.
 */
function withCreateDefaults(
  recordKind: 'subtask' | 'task' | 'theme' | 'item',
  record: Record<string, unknown>,
): Record<string, unknown> {
  const defaults = { ...CREATE_DEFAULTS[recordKind] };
  if (recordKind === 'task' && record.updatedAt === undefined) {
    defaults.updatedAt = new Date().toISOString();
  }
  return { ...defaults, ...record };
}

async function run(args: ParsedArgs): Promise<CliResult> {
  const { subcommand: rawSubcommand, positionals: p, flags } = args;
  // ID-35.34 — resolve subcommand aliases at the dispatch boundary. parseArgs()
  // also normalises, but run() is exported and called directly by tests with
  // hand-built ParsedArgs values that skip parseArgs entirely; normalising
  // here makes the alias contract uniform across BOTH entry paths.
  const subcommand =
    rawSubcommand !== undefined
      ? (SUBCOMMAND_ALIASES[rawSubcommand] ?? rawSubcommand)
      : undefined;
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

    // ── ID-35.22 single-field read (RESEARCH §5.1) ──────────────────────────
    // `get <ledger> <id> [field]` extends `show` with single-field reads:
    // `get backlog 100 status` prints just the status value; no field behaves
    // exactly like `show`. Read-only — no write gate.
    case 'get': {
      const [ledger, id, field] = p;
      if (!ledger || !id)
        return cliErr('get', 'missing-args', 'get <ledger> <id> [field]');
      if (!(ledger in LEDGER_FILES))
        return cliErr(
          'get',
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
        return cliErr('get', 'record-not-found', `${ledger} id ${id}`);
      // No field → whole record (parity with `show`).
      if (field == null) return { ok: true, subcommand: 'get', result: record };
      const rec = record as Record<string, unknown>;
      if (!(field in rec))
        return cliErr(
          'get',
          'field-not-found',
          `${ledger} ${id} has no field "${field}"`,
        );
      return { ok: true, subcommand: 'get', result: rec[field] };
    }

    // ── ID-35.22 schema discoverability (RESEARCH §5.2 — prevent guessing) ───
    // `schema [ledger|recordKind]` prints, per record kind, every field's
    // name + type + budget + required/optional + enum values — derived from
    // `Schema.shape` so it cannot drift. Read-only; touches no ledger file.
    case 'schema': {
      const target = p[0];
      const out = renderSchema(target);
      if (out === null)
        return cliErr(
          'schema',
          'bad-schema-target',
          `target must be one of: task|roadmap|backlog|subtask|theme|item (got "${target}")`,
        );
      return { ok: true, subcommand: 'schema', result: out };
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
      return commitMutation({
        subcommand: 'flip-task',
        path: ledgerPath(dir, 'task'),
        detected: loaded.detected,
        resultPayload: { taskId, status },
        dryRun: flags.dryRun,
        regenMirrors: !flags.noRegenMirrors,
        scoped: flags.scoped,
        scopedWrite: { originalText: loaded.originalText, patch },
        gate: {
          ledger: 'task',
          descriptor,
          beforeIds,
          expectedDelta: { kind: 'none' },
        },
      });
    }

    // ── ID-35.20 task field editor (RESEARCH §4) ────────────────────────────
    case 'update-task': {
      const [taskId, field, value] = p;
      if (!taskId || !field || value == null)
        return cliErr(
          'update-task',
          'missing-args',
          'update-task <taskId> <field> <value>',
        );
      const loaded = await loadLedger(ledgerPath(dir, 'task'));
      if (!loaded.ok) return loaded.result;
      const descriptor: CollectionDescriptor = { collection: 'tasks' };
      const beforeIds = beforeCollectionIds(loaded.detected, descriptor);
      const newValue = coerceFieldValue('task', field, value);
      const patch: FieldPatch = {
        fieldPath: ['tasks', taskId, field],
        newValue,
      };
      const m = fieldPatchMutation('update-task', loaded.detected, patch);
      if (!m.ok) return m.result;
      const changedTask =
        loaded.detected.kind === 'task-list'
          ? loaded.detected.data.tasks.find((t) => t.id === taskId)
          : undefined;
      return commitMutation({
        subcommand: 'update-task',
        path: ledgerPath(dir, 'task'),
        detected: loaded.detected,
        resultPayload: { taskId, field },
        dryRun: flags.dryRun,
        regenMirrors: !flags.noRegenMirrors,
        scoped: flags.scoped,
        scopedWrite: { originalText: loaded.originalText, patch },
        gate: {
          ledger: 'task',
          descriptor,
          beforeIds,
          expectedDelta: { kind: 'none' },
        },
        budgetGate: changedTask
          ? {
              ledger: 'task',
              recordKind: 'task',
              recordId: taskId,
              record: changedTask as unknown as Record<string, unknown>,
              // ID-35.26: scope rejection to the mutated field.
              mutatedField: field,
            }
          : undefined,
        force: flags.force,
      });
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
      return commitMutation({
        subcommand: 'flip-subtask',
        path: ledgerPath(dir, 'task'),
        detected: loaded.detected,
        resultPayload: { taskId, subId, status },
        dryRun: flags.dryRun,
        regenMirrors: !flags.noRegenMirrors,
        scoped: flags.scoped,
        scopedWrite: { originalText: loaded.originalText, patch },
        gate: {
          ledger: 'task',
          descriptor,
          beforeIds,
          expectedDelta: { kind: 'none' },
        },
      });
    }

    // ── ID-35.19 subtask field editor (RESEARCH §2.1) ───────────────────────
    case 'update-subtask': {
      const [dottedId, field, value] = p;
      if (!dottedId || !field || value == null)
        return cliErr(
          'update-subtask',
          'missing-args',
          'update-subtask <taskId.subId> <field> <value>',
        );
      const dot = dottedId.indexOf('.');
      if (dot <= 0 || dot === dottedId.length - 1)
        return cliErr(
          'update-subtask',
          'bad-id',
          `id must be dotted taskId.subId (e.g. 35.1); got "${dottedId}"`,
        );
      const taskId = dottedId.slice(0, dot);
      const subId = dottedId.slice(dot + 1);
      const loaded = await loadLedger(ledgerPath(dir, 'task'));
      if (!loaded.ok) return loaded.result;
      // Field-edit on a subtask: the addressed task's subtask id-set is
      // unchanged (∅), so guard that task's subtasks collection.
      const descriptor: CollectionDescriptor = {
        collection: 'subtasks',
        taskId,
      };
      const beforeIds = beforeCollectionIds(loaded.detected, descriptor);
      // ID-35.21 field-type-aware coercion (drives parse by SubtaskSchema field
      // type — dependencies → number[], description stays a string).
      const newValue = coerceFieldValue('subtask', field, value);
      const patch: FieldPatch = {
        fieldPath: ['tasks', taskId, 'subtasks', String(subId), field],
        newValue,
      };
      const m = fieldPatchMutation('update-subtask', loaded.detected, patch);
      if (!m.ok) return m.result;
      // Budget pre-check on the changed subtask (description / testStrategy).
      const changedSub =
        loaded.detected.kind === 'task-list'
          ? loaded.detected.data.tasks
              .find((t) => t.id === taskId)
              ?.subtasks.find((s) => s.id === Number(subId))
          : undefined;
      return commitMutation({
        subcommand: 'update-subtask',
        path: ledgerPath(dir, 'task'),
        detected: loaded.detected,
        resultPayload: { taskId, subId: Number(subId), field },
        dryRun: flags.dryRun,
        regenMirrors: !flags.noRegenMirrors,
        scoped: flags.scoped,
        scopedWrite: { originalText: loaded.originalText, patch },
        gate: {
          ledger: 'task',
          descriptor,
          beforeIds,
          expectedDelta: { kind: 'none' },
        },
        budgetGate: changedSub
          ? {
              ledger: 'task',
              recordKind: 'subtask',
              recordId: Number(subId),
              record: changedSub as unknown as Record<string, unknown>,
              // ID-35.26: only the mutated field can REJECT — untouched
              // over-budget fields surface as soft warnings.
              mutatedField: field,
            }
          : undefined,
        force: flags.force,
      });
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
      return commitMutation({
        subcommand: 'append-journal',
        path: ledgerPath(dir, 'task'),
        detected: loaded.detected,
        resultPayload: { taskId, subId, appended: true },
        dryRun: flags.dryRun,
        regenMirrors: !flags.noRegenMirrors,
        scoped: flags.scoped,
        scopedWrite: { originalText: loaded.originalText, patch },
        gate: {
          ledger: 'task',
          descriptor,
          beforeIds,
          expectedDelta: { kind: 'none' },
        },
      });
    }

    case 'add-subtask': {
      const taskId = p[0];
      if (!taskId)
        return cliErr(
          'add-subtask',
          'missing-args',
          'add-subtask <taskId> <subtaskJson | --title …>',
        );
      const loaded = await loadLedger(ledgerPath(dir, 'task'));
      if (!loaded.ok) return loaded.result;
      if (loaded.detected.kind !== 'task-list')
        return cliErr('add-subtask', 'wrong-ledger', 'expected task-list');
      const task = loaded.detected.data.tasks.find((t) => t.id === taskId);
      if (!task)
        return cliErr('add-subtask', 'record-not-found', `task ${taskId}`);
      // The body is positionals[1] (JSON) OR --file / named flags. Reuse the
      // {35.15} record-input resolver with the taskId dropped from positionals.
      const bodyArgs: ParsedArgs = {
        ...args,
        positionals: p.slice(1),
      };
      const input = readRecordInput(bodyArgs);
      if (!input.ok) return input.result;
      // ID-35.21 auto-id: subtask ids are NUMBERS, scoped to the parent task.
      // Inject max+1 unless --id forces an explicit id or the body carries one.
      let record = withCreateDefaults(
        'subtask',
        input.value as Record<string, unknown>,
      );
      // ID-35.28 --id type coercion: the named-flag parser stores `--id` as a
      // string (every value-flag does), but `SubtaskSchema.id` is NUMBER (per
      // RESEARCH §3 — Taskmaster mandate). The old passthrough left subtask.id
      // as a string and tripped a confusing downstream schema-error
      // ("expected number, received string"); the workaround was to omit --id
      // and rely on auto-id. Mirror `nextId(subtasks)` policy at the --id site:
      // a numeric string ("27") coerces to the integer 27; anything else is
      // rejected with a structured `invalid-id` envelope rather than passed to
      // the schema. Body-supplied (positional JSON / --file) ids retain their
      // primitive type from JSON.parse and bypass this coercion.
      if (typeof record.id === 'string') {
        const n = Number(record.id);
        if (!Number.isInteger(n) || record.id.trim() === '') {
          return cliErr(
            'add-subtask',
            'invalid-id',
            `--id ${JSON.stringify(record.id)} is not a positive integer; subtask.id must be a number (got non-coercible string)`,
          );
        }
        record = { ...record, id: n };
      }
      if (record.id === undefined) {
        record = { ...record, id: nextId(loaded.detected, 'subtasks', taskId) };
      }
      const descriptor: CollectionDescriptor = {
        collection: 'subtasks',
        taskId,
      };
      const beforeIds = beforeCollectionIds(loaded.detected, descriptor);
      const nextSubtasks = [...task.subtasks, record];
      const m = fieldPatchMutation('add-subtask', loaded.detected, {
        fieldPath: ['tasks', taskId, 'subtasks'],
        newValue: nextSubtasks,
      });
      if (!m.ok) return m.result;
      // Derive the new subtask id from the VALIDATED post-mutation record (the
      // last subtask of the addressed task in the re-parsed document), not the
      // pre-validation `record.id`. `SubtaskSchema.id` is required, so a
      // missing/ill-typed id fails the mutation above and never reaches here —
      // so the record-set gate is ALWAYS passed with a concrete `add` delta.
      const validatedTask =
        loaded.detected.kind === 'task-list'
          ? loaded.detected.data.tasks.find((t) => t.id === taskId)
          : undefined;
      const validatedSubtasks = validatedTask?.subtasks ?? [];
      const newSubId = validatedSubtasks[validatedSubtasks.length - 1]
        .id as IdValue;
      return commitMutation({
        subcommand: 'add-subtask',
        path: ledgerPath(dir, 'task'),
        detected: loaded.detected,
        resultPayload: {
          taskId,
          subId: newSubId,
          subtaskCount: nextSubtasks.length,
        },
        dryRun: flags.dryRun,
        regenMirrors: !flags.noRegenMirrors,
        gate: {
          ledger: 'task',
          descriptor,
          beforeIds,
          expectedDelta: { kind: 'add', id: newSubId },
        },
        budgetGate: {
          ledger: 'task',
          recordKind: 'subtask',
          recordId: newSubId,
          record,
        },
        force: flags.force,
      });
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
      // ID-35.21: field-type-aware coercion REPLACES the old silent
      // `JSON.parse(value)`-then-bare-string heuristic (RESEARCH §5.3). Driven
      // by BacklogItemSchema field type, so `update-backlog 100 description
      // "123"` keeps "123" a string while `dependencies "[…]"` parses to an
      // array.
      const newValue = coerceFieldValue('item', field, value);
      const m = fieldPatchMutation('update-backlog', loaded.detected, {
        fieldPath: ['items', itemId, field],
        newValue,
      });
      if (!m.ok) return m.result;
      const changedItem =
        loaded.detected.kind === 'backlog'
          ? loaded.detected.data.items.find((it) => it.id === itemId)
          : undefined;
      return commitMutation({
        subcommand: 'update-backlog',
        path: ledgerPath(dir, 'backlog'),
        detected: loaded.detected,
        resultPayload: { itemId, field },
        dryRun: flags.dryRun,
        regenMirrors: !flags.noRegenMirrors,
        gate: {
          ledger: 'backlog',
          descriptor,
          beforeIds,
          expectedDelta: { kind: 'none' },
        },
        budgetGate: changedItem
          ? {
              ledger: 'backlog',
              recordKind: 'item',
              recordId: itemId,
              record: changedItem as unknown as Record<string, unknown>,
              // ID-35.26: scope rejection to the mutated field.
              mutatedField: field,
            }
          : undefined,
        force: flags.force,
      });
    }

    // ── ID-35.20 roadmap field editor (RESEARCH §4 — no editor existed) ──────
    case 'update-roadmap': {
      const [themeId, field, value] = p;
      if (!themeId || !field || value == null)
        return cliErr(
          'update-roadmap',
          'missing-args',
          'update-roadmap <themeId> <field> <value>',
        );
      const loaded = await loadLedger(ledgerPath(dir, 'roadmap'));
      if (!loaded.ok) return loaded.result;
      const descriptor: CollectionDescriptor = { collection: 'themes' };
      const beforeIds = beforeCollectionIds(loaded.detected, descriptor);
      const newValue = coerceFieldValue('theme', field, value);
      const m = fieldPatchMutation('update-roadmap', loaded.detected, {
        fieldPath: ['themes', themeId, field],
        newValue,
      });
      if (!m.ok) return m.result;
      const changedTheme =
        loaded.detected.kind === 'roadmap'
          ? loaded.detected.data.themes.find((t) => t.id === themeId)
          : undefined;
      return commitMutation({
        subcommand: 'update-roadmap',
        path: ledgerPath(dir, 'roadmap'),
        detected: loaded.detected,
        resultPayload: { themeId, field },
        dryRun: flags.dryRun,
        regenMirrors: !flags.noRegenMirrors,
        gate: {
          ledger: 'roadmap',
          descriptor,
          beforeIds,
          expectedDelta: { kind: 'none' },
        },
        budgetGate: changedTheme
          ? {
              ledger: 'roadmap',
              recordKind: 'theme',
              recordId: themeId,
              record: changedTheme as unknown as Record<string, unknown>,
              // ID-35.26: scope rejection to the mutated field.
              mutatedField: field,
            }
          : undefined,
        force: flags.force,
      });
    }

    // ── record CREATE / DELETE ───────────────────────────────────────────────
    case 'open-task':
    case 'create-backlog':
    case 'create-theme': {
      // ID-35.20 adds `create-theme` alongside the existing open-task /
      // create-backlog creators (RESEARCH §4 — roadmap had no creator).
      const ledger: LedgerName =
        subcommand === 'open-task'
          ? 'task'
          : subcommand === 'create-theme'
            ? 'roadmap'
            : 'backlog';
      const collection: 'tasks' | 'themes' | 'items' =
        ledger === 'task' ? 'tasks' : ledger === 'roadmap' ? 'themes' : 'items';
      const recordKind: LedgerRecordKind =
        ledger === 'task' ? 'task' : ledger === 'roadmap' ? 'theme' : 'item';
      const loaded = await loadLedger(ledgerPath(dir, ledger));
      if (!loaded.ok) return loaded.result;
      const descriptor: CollectionDescriptor = { collection };
      const beforeIds = beforeCollectionIds(loaded.detected, descriptor);
      // {35.15} record-input resolution (positional JSON | --file | named
      // flags) + {35.21} structural defaults + auto-id.
      const input = readRecordInput(args);
      if (!input.ok) return input.result;
      let record = withCreateDefaults(
        recordKind,
        input.value as Record<string, unknown>,
      );
      // ID-35.21 auto-id: task/theme/item ids are bare-digit STRINGS. Inject
      // max+1 unless --id forces an explicit id or the body already carries one.
      if (record.id === undefined) {
        record = { ...record, id: nextId(loaded.detected, collection) };
      }
      const ins = insertRecord(loaded.detected, record);
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
      return commitMutation({
        subcommand,
        path: ledgerPath(dir, ledger),
        detected: ins.detected,
        resultPayload: { recordId: ins.recordId },
        dryRun: flags.dryRun,
        regenMirrors: !flags.noRegenMirrors,
        gate: {
          ledger,
          descriptor,
          beforeIds,
          expectedDelta: { kind: 'add', id: ins.recordId },
        },
        budgetGate: {
          ledger,
          recordKind,
          recordId: ins.recordId,
          record,
        },
        force: flags.force,
      });
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
      return commitMutation({
        subcommand: 'delete-backlog',
        path: ledgerPath(dir, 'backlog'),
        detected: rem.detected,
        resultPayload: { recordId: rem.recordId },
        dryRun: flags.dryRun,
        regenMirrors: !flags.noRegenMirrors,
        gate: {
          ledger: 'backlog',
          descriptor,
          beforeIds,
          expectedDelta: { kind: 'remove', id: rem.recordId },
        },
      });
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
        !flags.noRegenMirrors,
        flags.force,
      );
    }

    default:
      // ID-35.34 — lead with a --help callout so the operator's first line of
      // context tells them how to self-serve, before the embedded USAGE dump.
      return cliErr(
        subcommand ?? '<none>',
        'unknown-subcommand',
        `unknown subcommand "${subcommand ?? '<none>'}" — run \`bun scripts/ledger-cli.ts --help\` for the command list, or \`bun scripts/ledger-cli.ts <command> --help\` for per-command flags.\n${USAGE}`,
      );
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
  force: boolean = false,
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
  const backlogBeforeIds = beforeCollectionIds(
    blLoad.detected,
    backlogDescriptor,
  );

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

  // ID-35.17 budget pre-check on the new Task record (the changed record). The
  // backlog item is removed, not authored, so only the Task is budgeted.
  // Over-budget → reject unless `--force` (then a soft warning). `promote`
  // authors every budgeted field (no `mutatedField` filter — same semantics
  // as create / add).
  const budgetCheck = checkBudget({
    ledger: 'task',
    recordKind: 'task',
    recordId: ins.recordId,
    record: taskRecord.value as Record<string, unknown>,
  });
  const forcedBudgetWarnings: string[] = [];
  if (!budgetCheck.ok) {
    if (force) {
      forcedBudgetWarnings.push(
        `(forced) budget-exceeded: ${budgetCheck.detail}`,
      );
    } else {
      return cliErr('promote', 'budget-exceeded', budgetCheck.detail);
    }
  }

  // Hoist the discipline scan once (it re-parses the task-list) — reused by
  // both the dry-run and the success return.
  const warnings = [
    ...disciplineWarnings(ins.detected),
    ...forcedBudgetWarnings,
  ];

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

  const mirrorStale = maybeRegenMirrors(regenMirrors);
  return {
    ok: true,
    subcommand: 'promote',
    result: { newTaskId: ins.recordId, removedBacklogId: rem.recordId },
    warnings: warnings.length ? warnings : undefined,
    mirrorStale,
  };
}

// ── entry ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const rawArgv = process.argv.slice(2);

  // ID-35.22 per-subcommand --help dispatch (RESEARCH §5.2). Intercept BEFORE
  // parseArgs, which rejects `--help` as an unknown value-flag. If `--help`/`-h`
  // is present, the first non-flag token is the subcommand: print that
  // command's flags + target-record schema slice (or the global USAGE for a
  // bare/unknown `--help`). This replaces the old bare-USAGE fall-through where
  // `add-subtask --help` returned only the global usage line.
  if (rawArgv.includes('--help') || rawArgv.includes('-h')) {
    const subcommand = rawArgv.find((a) => !a.startsWith('-'));
    if (subcommand) {
      const help = subcommandHelp(subcommand);
      process.stdout.write(`${help ?? USAGE}\n`);
      process.exit(0);
    }
    process.stdout.write(`${USAGE}\n`);
    process.exit(0);
  }

  const parsedResult = parseArgs(rawArgv);
  if (!parsedResult.ok) {
    // ID-35.15 reject-unknown-flags: structured envelope to stderr, exit 1.
    process.stderr.write(
      `${JSON.stringify({ ok: false, subcommand: '<parse>', error: 'unknown-flag', detail: parsedResult.error })}\n`,
    );
    process.exit(1);
  }
  const args = parsedResult.parsed;
  if (!args.subcommand) {
    process.stdout.write(`${USAGE}\n`);
    process.exit(1);
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
  __setRegenRunnerForTest,
  run,
  journalBlock,
  ledgerPath,
  LEDGER_FILES,
  renderSchema,
  subcommandHelp,
};
export type { CliResult, ParsedArgs };
