#!/usr/bin/env bun
/**
 * ledger-cli.ts — deterministic mutation CLI for the three KH workflow ledgers
 * (docs/reference/{task-list,product-roadmap,product-backlog}.json).
 *
 * Replaces the hand-written Python `/tmp/claude/*.py` ledger-splice scripts the
 * Orchestrator wrote per mutation. A thin dispatcher over the task-view v0.2.0
 * patch primitives vendored into lib/ledger/ (ID-35; spec docs/specs/id-35-ledger-cli/).
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
 *     delete-subtask <taskId> <subId>
 *   cross-ledger:
 *     promote        <backlogId> <taskJson | --file <path> (- = stdin) | --title …>
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
  scopedSpliceSerialise,
  type SpliceOp,
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
import { UmbrellasSchema } from '@/lib/validation/umbrellas-schema';
import { BARE_ID_REGEX } from '@/lib/validation/schemas';
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

/**
 * ID-35.32: discriminant for `mirrorStale`. When set on a success envelope,
 * `mirrorStaleReason` names WHY the mirrors are stale, so `emit()` can pick a
 * reminder text that confirms what actually happened instead of lecturing the
 * operator about a default they bypassed:
 *   - `'suppressed'`   — `--no-regen-mirrors` was passed; the skip was
 *                        intentional and the operator already knows.
 *   - `'regen-failed'` — regen attempted, child exit non-zero; the operator
 *                        must re-run `bash scripts/regen-mirrors.sh` manually
 *                        before committing.
 * Absent on `{ mirrorStale: false }` (fresh) and on error envelopes.
 */
type MirrorStaleReason = 'suppressed' | 'regen-failed';

type CliResult =
  | {
      ok: true;
      subcommand: string;
      result: unknown;
      warnings?: string[];
      mirrorStale?: boolean;
      mirrorStaleReason?: MirrorStaleReason;
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
     *
     * ID-65.5: scoped is now the GLOBAL DEFAULT (ratified default #4) — every
     * mutating command derives `scoped: !flags.wholeFile`, so `--scoped` is now
     * a now-redundant (default-on) no-op alias kept for back-compat: passing it
     * does NOT change the write path (scoped is already on unless `--whole-file`
     * is set). Do NOT remove it.
     */
    scoped?: boolean;
    /**
     * ID-65.5 escape hatch — opt OUT of the now-default scoped/minimal-diff
     * write and route the command through the legacy whole-file `serialise()`
     * path instead. Default false (absent reads as falsy → scoped). Every
     * mutating command computes `scoped: !flags.wholeFile`. The always-whole-file
     * deletes (`delete-subtask` / `delete-backlog`, no scoped path from
     * {65.2}/{65.3}) ignore it. Optional for back-compat with pre-existing
     * `ParsedArgs.flags` literals; absent reads as falsy.
     */
    wholeFile?: boolean;
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
    /**
     * ID-35.39 Item C — append-mode flag for `update-backlog notes` /
     * `update-roadmap notes`. When set AND the target field is `notes`, the
     * incoming value is concatenated onto the existing field value with a
     * single newline separator instead of overwriting. Absent (the default)
     * preserves the pre-{35.39} overwrite behaviour exactly. Optional for
     * back-compat with pre-existing `ParsedArgs.flags` literals.
     */
    append?: boolean;
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
    /**
     * ID-35.42 — `open-task --effort-estimate <str>` named value-flag. Seeds
     * `TaskSchema.effort_estimate` (a nullable string) so a single `open-task`
     * sets the estimate without a follow-up `update-task <id> effort_estimate
     * '…'`. `readRecordInput` maps this camelCase flag key onto the snake_case
     * schema field. Absent → the `withCreateDefaults('task', …)` null default
     * stands (back-compat preserved). Optional so pre-existing
     * `ParsedArgs.flags` literals stay valid.
     */
    effortEstimate?: string;
    /**
     * ID-35.39 Item A — bind a newly-promoted Task to a roadmap capability
     * theme. When set on `promote`, the new Task receives
     * `capability_theme: <themeId>` AND the named theme's `linked_tasks[]`
     * is appended with the new task id (idempotent push). The roadmap is
     * loaded + validated up-front; an unknown theme id rejects with
     * `unknown-theme` before any bytes are touched. Optional / undefined
     * preserves the pre-{35.39} promote behaviour exactly.
     */
    capabilityTheme?: string;
    /**
     * ID-35.41 — `update-umbrella` op-flags. Each is a comma-separated list of
     * bare-digit Task ids applied to a named umbrella's `task_ids[]` in
     * `docs/reference/umbrellas.json`:
     *   - `addTasks`    : idempotent append (present ids skipped; order kept).
     *   - `removeTasks` : remove named ids (absent ids = no-op).
     *   - `reorder`     : replace task_ids with a permutation of the set.
     * Mutually-exclusive rule: `reorder` may NOT combine with add/remove;
     * `addTasks` + `removeTasks` together apply add-then-remove. Optional /
     * undefined when the flag is not supplied. See the `update-umbrella` arm
     * of `run()`.
     */
    addTasks?: string;
    removeTasks?: string;
    reorder?: string;
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
  // ID-35.42 — `open-task --effort-estimate <str>` seeds TaskSchema's
  // effort_estimate in one invocation (consumes the next token). Maps the
  // camelCase flag key to the snake_case schema field in `readRecordInput`.
  '--effort-estimate': 'effortEstimate',
  // ID-35.39 Item A — `promote --capability-theme <id>` binds the new Task to
  // the named roadmap theme. Lives in VALUE_FLAGS (consumes the next token).
  '--capability-theme': 'capabilityTheme',
  // ID-35.41 — `update-umbrella` op-flags. Each consumes the next token (a
  // comma-separated bare-digit Task-id list).
  '--add-tasks': 'addTasks',
  '--remove-tasks': 'removeTasks',
  '--reorder': 'reorder',
};

/** ID-35.15 boolean flags. Presence sets the corresponding `flags` key true. */
const BOOLEAN_FLAGS: Record<string, keyof ParsedArgs['flags']> = {
  '--dry-run': 'dryRun',
  '--pretty': 'pretty',
  '--regen-mirrors': 'regenMirrors',
  '--no-regen-mirrors': 'noRegenMirrors',
  '--scoped': 'scoped',
  // ID-65.5 — opt OUT of the now-default scoped write into the legacy whole-file
  // `serialise()` path. Every mutating command reads `scoped: !flags.wholeFile`.
  '--whole-file': 'wholeFile',
  '--force': 'force',
  // ID-35.39 Item C — `update-backlog/update-roadmap notes --append` concatenates
  // the incoming value onto the existing notes value (newline-joined) instead of
  // overwriting. Restricted to the `notes` field at the call site; absent
  // (the default) preserves the pre-{35.39} overwrite behaviour exactly.
  '--append': 'append',
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
    // ID-65.5 — default false → scoped (`scoped: !flags.wholeFile`) is the
    // global default; `--whole-file` flips this to route the legacy
    // whole-file `serialise()` path.
    wholeFile: false,
    noRegenMirrors: false,
    force: false,
    append: false,
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
 * commas into a `string[]` always; per-record-kind coercion (e.g. `number[]`
 * for `subtask.dependencies`) happens at the call site (ID-35.29). When no
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
  // ID-35.42 — camelCase flag key → snake_case schema field. With the flag set
  // this overrides the `withCreateDefaults` null default; absent, the default
  // stands. A string value satisfies `TaskSchema.effort_estimate` (nullable
  // string) without bypassing the insert-time schema gate.
  if (flags.effortEstimate !== undefined)
    record.effort_estimate = flags.effortEstimate;
  if (flags.depends !== undefined) {
    // ID-35.29 — emit string[] always; coerce to number[] at the add-subtask
    // call site (the only record kind whose schema demands number[]). The old
    // here-coercion (`Number(s)` if digit-only, else keep string) was correct
    // for `subtask.dependencies: number[]` but wrong for the other three:
    //   - task.dependencies     : string[]   (open-task)
    //   - item.dependencies     : string[]   (create-backlog)
    //   - theme.dependencies    : (no field) (create-theme — schema-error on
    //                                          insert, as expected for an
    //                                          unsupported field)
    // A digit-only token like `--depends 6,7` previously landed as `[6, 7]` and
    // tripped `schema-error` ("expected string, received number") on open-task
    // and create-backlog. Mirror the {35.28} pattern: keep the parser
    // schema-agnostic, do the type discrimination at the call site.
    record.dependencies = flags.depends
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
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
    flags: '--whole-file --dry-run --pretty --no-regen-mirrors',
    kinds: ['task'],
  },
  'flip-subtask': {
    synopsis: 'flip-subtask <taskId> <subId> <status> — set a Subtask status',
    flags: '--whole-file --dry-run --pretty --no-regen-mirrors',
    kinds: ['subtask'],
  },
  'update-task': {
    synopsis: 'update-task <taskId> <field> <value> — edit a Task field',
    flags: '--whole-file --force --dry-run --pretty --no-regen-mirrors',
    kinds: ['task'],
  },
  'update-subtask': {
    synopsis:
      'update-subtask <taskId.subId> <field> <value> — edit a Subtask field',
    flags: '--whole-file --force --dry-run --pretty --no-regen-mirrors',
    kinds: ['subtask'],
  },
  'update-roadmap': {
    synopsis: 'update-roadmap <themeId> <field> <value> — edit a Theme field',
    flags:
      '--whole-file --force --dry-run --pretty --no-regen-mirrors ' +
      '--append (notes field only — concatenate newline-joined)',
    kinds: ['theme'],
  },
  'update-backlog': {
    synopsis: 'update-backlog <itemId> <field> <value> — edit a backlog field',
    flags:
      '--whole-file --force --dry-run --pretty --no-regen-mirrors ' +
      '--append (notes field only — concatenate newline-joined)',
    kinds: ['item'],
  },
  'append-journal': {
    synopsis: 'append-journal <taskId> <subId> <text> — append a journal block',
    flags: '--whole-file --dry-run --pretty --no-regen-mirrors',
    kinds: ['subtask'],
  },
  'add-subtask': {
    synopsis:
      'add-subtask <taskId> <subtaskJson | --title …> — insert a Subtask',
    flags:
      'input: positional JSON | --file <path> (- = stdin) | named flags ' +
      '(--title --description --status --depends 1,2 …); --id forces an id; ' +
      '--whole-file --force --dry-run --pretty --no-regen-mirrors',
    kinds: ['subtask'],
  },
  'add-subtasks': {
    synopsis:
      'add-subtasks <taskId> --file <json|-> — bulk-insert a JSON ARRAY of Subtasks (ONE scoped multi-splice)',
    flags:
      'input: JSON ARRAY via positional JSON | --file <path> (- = stdin); ' +
      'sequential auto-ids across the batch (records with an explicit id keep ' +
      'it); per-record budget enforced atomically (any over-budget record ' +
      'rejects the WHOLE batch unless --force); a non-array body is rejected ' +
      '(use `add-subtask` for a single Subtask); ' +
      '--whole-file --force --dry-run --pretty --no-regen-mirrors',
    kinds: ['subtask'],
  },
  'open-task': {
    synopsis: 'open-task <taskJson | --title …> — insert a Task',
    flags:
      'input: positional JSON | --file <path> (- = stdin) | named flags ' +
      '(--title --description --status --depends --priority --effort-estimate …); ' +
      '--id forces an id; --whole-file --force --dry-run --pretty --no-regen-mirrors',
    kinds: ['task'],
  },
  'create-theme': {
    synopsis: 'create-theme <themeJson | --title …> — insert a roadmap Theme',
    flags:
      'input: positional JSON | --file <path> (- = stdin) | named flags; ' +
      '--id forces an id; --whole-file --force --dry-run --pretty --no-regen-mirrors',
    kinds: ['theme'],
  },
  'create-backlog': {
    synopsis: 'create-backlog <itemJson | --title …> — insert a backlog item',
    flags:
      'input: positional JSON | --file <path> (- = stdin) | named flags ' +
      '(--title --description --type --track …); --id forces an id; ' +
      '--whole-file --force --dry-run --pretty --no-regen-mirrors',
    kinds: ['item'],
  },
  'delete-backlog': {
    synopsis: 'delete-backlog <itemId> — remove a backlog item',
    flags: '--dry-run --pretty --no-regen-mirrors',
    kinds: ['item'],
  },
  'delete-subtask': {
    synopsis: 'delete-subtask <taskId> <subId> — remove a Subtask',
    flags: '--dry-run --pretty --no-regen-mirrors',
    kinds: ['subtask'],
  },
  promote: {
    synopsis:
      'promote <backlogId> <taskJson | --file …> — atomically promote a backlog item to a Task',
    flags:
      'input (task body): positional JSON | --file <path> (- = stdin) | named ' +
      'flags (--title --description --status --priority …); the caller supplies ' +
      'a COMPLETE task record (no auto-id — task.id comes from the body). ' +
      '--whole-file --force --dry-run --pretty --no-regen-mirrors ' +
      '--capability-theme <themeId> (bind the new Task to a roadmap theme — ' +
      'sets task.capability_theme + appends task id to theme.linked_tasks[])',
    kinds: ['task', 'item'],
  },
  // ID-35.41 — umbrellas.json task_ids[] maintenance. No `kinds` slice: the
  // umbrella shape is not in the SchemaRecordKind set (self-contained handler,
  // not detectSchema-routed).
  'update-umbrella': {
    synopsis:
      'update-umbrella <umbrellaId> — maintain an umbrella task_ids[] in umbrellas.json',
    flags:
      '--add-tasks <csv> (idempotent append) | --remove-tasks <csv> (absent = no-op) | ' +
      '--reorder <csv> (must be a permutation — no adds/drops); ' +
      '--add-tasks + --remove-tasks combine (add-then-remove); --reorder is exclusive. ' +
      '--dry-run --pretty. NOTE: umbrellas.json is NOT mirrored (no regen) and has ' +
      'no budgeted fields (no budget gate).',
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
  add-subtasks   <taskId> --file <json|->        (bulk — JSON array of subtasks)
  update-backlog <itemId> <field> <value>
  open-task      <taskJson | --title … [--effort-estimate <str>]>
  create-backlog <itemJson>
  create-theme   <themeJson>
  delete-backlog <itemId>
  delete-subtask <taskId> <subId>
  promote        <backlogId> <taskJson | --file <path> (- = stdin) | --title …>
  update-umbrella <umbrellaId> --add-tasks|--remove-tasks|--reorder <csv>
flags: --dry-run --pretty --whole-file --scoped --force --append --no-regen-mirrors --ledger-dir <path>
  --whole-file : opt OUT of the now-default minimal-diff (scoped) write and
             re-emit the WHOLE ledger via serialise() (Zod-canonical key order +
             escaped non-ASCII). The legacy escape hatch — needed only when a
             deliberate whole-file rewrite is wanted; routes every mutating
             command (field edits, creates, promote) through the wide path.
             (The always-whole-file deletes ignore it — they have no scoped path.)
  --scoped : DEPRECATED no-op alias — scoped/minimal-diff is now the GLOBAL
             DEFAULT for every mutating command (ratified default #4), so
             passing --scoped changes nothing. Kept for back-compat. Use
             --whole-file to opt OUT into the wide write.
  --force  : downgrade a budget-exceeded rejection to a soft warning and write
             anyway (escape hatch for the rare legitimate over-budget field).
  --append : update-backlog / update-roadmap notes-only — concatenate the
             incoming value onto the existing notes value (newline-joined)
             instead of overwriting. Rejected on non-notes fields.
  --capability-theme <id> : promote-only — bind the new Task to a roadmap
             theme (writes task.capability_theme + appends to
             theme.linked_tasks[]). Atomic with the task-list and backlog
             writes; unknown theme id rejects with \`unknown-theme\` before
             any bytes are touched.
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
      if (result.mirrorStale && result.mirrorStaleReason)
        process.stderr.write(mirrorReminderFor(result.mirrorStaleReason));
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
    if (result.ok && result.mirrorStale && result.mirrorStaleReason)
      process.stderr.write(mirrorReminderFor(result.mirrorStaleReason));
  }
  process.exit(result.ok ? 0 : 1);
}

/**
 * ID-35.32: pick the operator-facing reminder text for a stale-mirrors result,
 * discriminated by `mirrorStaleReason`. Previously a single MIRROR_REMINDER
 * constant printed "mirror regen runs by default after a write; if you passed
 * --no-regen-mirrors, run …" UNCONDITIONALLY whenever mirrors were stale —
 * lecturing operators about a default they had just bypassed. The two paths
 * now diverge:
 *
 *   - `'suppressed'`   → CONFIRM the skip ("mirror regen suppressed
 *                        (--no-regen-mirrors)") and remind the operator to run
 *                        the regen script before committing.
 *   - `'regen-failed'` → FLAG the failure ("mirror regen FAILED") and prompt a
 *                        manual rerun (the loud `MIRROR REGEN FAILED` line in
 *                        `maybeRegenMirrors` already named the exit status; this
 *                        is the post-result reminder that pairs with it).
 *
 * Returned text always ends with a trailing newline so stderr stays tidy.
 */
function mirrorReminderFor(reason: MirrorStaleReason): string {
  if (reason === 'suppressed') {
    return (
      'ℹ mirror regen suppressed (--no-regen-mirrors). ' +
      'Run `bash scripts/regen-mirrors.sh` before committing — ' +
      'CI ledger-mirror-parity gates on parity.\n'
    );
  }
  return (
    '⚠ mirror regen FAILED — run `bash scripts/regen-mirrors.sh` manually ' +
    'before committing (CI ledger-mirror-parity will otherwise fail).\n'
  );
}

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

/** Intended change to a collection's id-set across a single write.
 *
 * ID-65.6: `add-many` covers the bulk `add-subtasks` write — N ids added in ONE
 * scoped multi-splice. The gate adds EVERY id in `ids` to the expected post-write
 * set, so a serialise-side drop/duplicate anywhere in the batch is caught before
 * the single write lands (same one-step-ahead guarantee as the single `add`). */
type RecordSetDelta =
  | { kind: 'none' }
  | { kind: 'add'; id: string | number }
  | { kind: 'add-many'; ids: IdValue[] }
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
  else if (expectedDelta.kind === 'add-many')
    for (const id of expectedDelta.ids) expected.add(id);
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
  /**
   * ID-35.27: parent task id for subtask records — used to label the
   * budget-exceeded message as `subtask <parentId>.<recordId>` (e.g.
   * `subtask 49.6`) instead of the misleading `task <recordId>` that
   * previously confused operators (gate.ledger is `"task"` for the
   * task-list ledger; the subtask id alone was rendered as the task id).
   * Ignored for non-subtask kinds.
   */
  parentId?: string | number;
}

/**
 * ID-35.27: format the subject suffix of the budget-exceeded detail line so
 * the operator sees the RIGHT record-kind label and identifier — never the
 * misleading `<gate.ledger> <gate.recordId>` (which rendered subtasks as
 * `task <subId>`). Discriminates on `recordKind`:
 *
 *   - `task`    → `task <recordId>`         (e.g. `task 49`)
 *   - `subtask` → `subtask <parentId>.<recordId>`  (e.g. `subtask 49.6`)
 *                 — falls back to `subtask <recordId>` if parentId is missing
 *                   (callers should always pass it; defensive only).
 *   - `theme`   → `theme <recordId>`        (e.g. `theme 3`)
 *   - `item`    → `item <recordId>`         (e.g. `item 100`)
 */
function budgetSubject(gate: BudgetGate): string {
  switch (gate.recordKind) {
    case 'subtask':
      return gate.parentId !== undefined
        ? `subtask ${gate.parentId}.${gate.recordId}`
        : `subtask ${gate.recordId}`;
    case 'task':
      return `task ${gate.recordId}`;
    case 'theme':
      return `theme ${gate.recordId}`;
    case 'item':
      return `item ${gate.recordId}`;
    default: {
      // ID-35.27 fix-up: exhaustiveness guard. `scripts/` is excluded from
      // tsconfig so a future addition to `LedgerRecordKind` would NOT be
      // flagged at build time and the switch would silently return
      // undefined — corrupting every budget-exceeded detail line. The
      // `never` assertion makes a missing arm a compile-time error inside
      // the IDE / `tsc` runs that DO see this file, and the runtime
      // fallback keeps the message intelligible if the assertion is ever
      // bypassed.
      const _exhaustive: never = gate.recordKind;
      return `${String(_exhaustive)} ${gate.recordId}`;
    }
  }
}

/**
 * ID-35.31: count user-perceived characters (graphemes), not UTF-16 code units.
 *
 * Defect (S275): `value.length` returns the UTF-16 code-unit count, which
 * diverges from what the operator sees for any non-BMP glyph. A single emoji
 * like `🎯` is 1 grapheme but 2 code units (surrogate pair); a 130-emoji
 * description measures 260 by `.length` and trips a 250 budget the operator
 * thinks is comfortably under. Even for BMP arrows (`→`, U+2192) and section
 * marks (`§`, U+00A7) the counts agree, but the operator's intuition is
 * "graphemes", so we standardise on `Intl.Segmenter`.
 *
 * `Intl.Segmenter` is available in every Node ≥ 16 build the repo targets;
 * the wrapper exists so all budget-gate sites use a single counter. The
 * underlying `Intl.Segmenter` is module-hoisted (`GRAPHEME_SEGMENTER`) so
 * each call reuses one instance instead of allocating per-invocation.
 */
const GRAPHEME_SEGMENTER = new Intl.Segmenter('en', {
  granularity: 'grapheme',
});
function graphemeLength(value: string): number {
  return [...GRAPHEME_SEGMENTER.segment(value)].length;
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
    // ID-35.31: grapheme count (what the operator sees), not UTF-16 code units.
    const length = graphemeLength(value);
    if (length <= budget) continue;
    // ID-35.31: surface the `(over by N)` delta so the operator can trim with
    // precision instead of running the arithmetic themselves.
    const overBy = length - budget;
    const line = `${field} is ${length} chars (budget ${budget}, over by ${overBy}) on ${budgetSubject(gate)}`;
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
 * ID-35.30: the scope a {@link disciplineWarnings} call is restricted to. The
 * caller names the SINGLE record the mutation touched — `parseTaskListWithWarnings`
 * still scans the WHOLE task-list (it has to: schema-validity is whole-ledger),
 * but we filter its emitted entries down to those that pertain to this record.
 *
 * Why: without scoping, every successful add-subtask / flip-* / update-* /
 * promote emits 34-67 KB of unrelated soft warnings (every over-budget field
 * across hundreds of historical records) on its success envelope's `warnings`
 * field, which `emit()` dumps to stderr. Buffer-parsing orchestrators that
 * stream-consume the JSON-stdout envelope from the CLI choke on the unrelated
 * volume. RESEARCH §2.3 ("scoped to the changed record") applies to the soft
 * discipline warnings too, not just the budget-exceeded rejection message.
 *
 * - `taskId` set, `subId` undefined: keep only warnings whose `taskId` field
 *   matches AND whose message body is task-level (the parent task's
 *   description / status_note lines, NOT the per-subtask
 *   description / testStrategy lines for sibling subtasks under the same task).
 * - `taskId` AND `subId` set: keep only warnings whose `taskId` field matches
 *   AND whose message body references this specific `taskId.subId` subtask.
 * - No scope passed: legacy behaviour — return every warning the parse
 *   produced (preserved as a fallback for callers that intentionally want the
 *   whole-ledger sweep; no CLI call site uses this any more).
 */
interface WarningScope {
  taskId: string;
  subId?: number | string;
}

/**
 * Surface ID-34 field-discipline warnings for a task-list mutation, optionally
 * SCOPED to the single record the mutation touched (ID-35.30). Non-fatal: the
 * warnings flow to stderr; the command still succeeds. (Only task-list has a
 * warnings helper; roadmap/backlog mutations return [].)
 */
function disciplineWarnings(
  detected: KnownDetected,
  scope?: WarningScope,
): string[] {
  if (detected.kind !== 'task-list') return [];
  try {
    const { warnings } = parseTaskListWithWarnings(detected.data);
    if (!scope) return warnings.map((w) => w.message);
    // ID-35.30 scope filter.
    // `parseTaskListWithWarnings` emits at most three message shapes (see
    // lib/validation/task-list-schema.ts §parseTaskListWithWarnings):
    //   - Task "{taskId}" description ... — task-level
    //   - Task "{taskId}" status_note ... — task-level
    //   - Subtask {taskId}.{subId} description / testStrategy ... — subtask-level
    // Each carries `taskId` (the parent task id) on the warning struct.
    // Subtask-level messages embed the compound `{taskId}.{subId}` literally
    // in the message body, so a substring match pins the right subtask
    // without re-parsing.
    return warnings
      .filter((w) => {
        if (w.taskId !== scope.taskId) return false;
        const isSubtaskLine = w.message.startsWith(`Subtask `);
        if (scope.subId === undefined) {
          // Task-scope: drop sibling-subtask noise; keep only parent task lines.
          return !isSubtaskLine;
        }
        // Subtask-scope: keep only entries that name THIS subtask.
        return (
          isSubtaskLine &&
          w.message.startsWith(`Subtask ${scope.taskId}.${scope.subId} `)
        );
      })
      .map((w) => w.message);
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
  // ID-35.44 stdout-purity: `regen-mirrors.sh` echoes human/advisory lines to
  // its stdout. With `stdio: 'inherit'` those bytes land on THIS process's
  // stdout (fd1) and interleave with the JSON envelope `emit()` writes,
  // breaking `ledger-cli … | jq`. Route the child's stdout to the parent's
  // stderr (fd2) so every regen diagnostic stays visible but fd1 carries the
  // pure single-line JSON envelope only. stdin is ignored; child stderr→fd2.
  const r = spawnSync('bash', ['scripts/regen-mirrors.sh'], {
    stdio: ['ignore', 2, 2],
  });
  return r.status;
};

/** Test seam (ID-35.18): override the regen runner; pass `null` to restore. */
function __setRegenRunnerForTest(runner: RegenRunner | null): void {
  regenRunner = runner ?? defaultRegenRunner;
}
const defaultRegenRunner = regenRunner;

/**
 * Run the default-on mirror regen and report the post-write mirror status as a
 * discriminated tag (ID-35.32). The three outcomes:
 *   - `'fresh'`        — regen ran and succeeded; mirrors are in sync.
 *   - `'suppressed'`   — `--no-regen-mirrors` was passed; the skip was
 *                        intentional. The operator already knows; the
 *                        envelope-level reminder confirms the skip.
 *   - `'regen-failed'` — regen ran and exited non-zero; the loud
 *                        `MIRROR REGEN FAILED` stderr line is emitted here
 *                        (post-write alert, not a rollback) and the envelope
 *                        reminder prompts a manual rerun.
 *
 * Callers map a non-`'fresh'` status into the success envelope's
 * `{ mirrorStale: true, mirrorStaleReason }` pair; `emit()` then picks the
 * discriminated reminder text via {@link mirrorReminderFor}.
 */
type MirrorStatus = 'fresh' | MirrorStaleReason;

function maybeRegenMirrors(regen: boolean): MirrorStatus {
  if (!regen) return 'suppressed'; // → mirrors left stale by design.
  const status = regenRunner();
  if (status !== 0) {
    process.stderr.write(
      `⚠ MIRROR REGEN FAILED: regen-mirrors.sh exited ${status ?? 'signal'}. ` +
        `The write already committed — mirrors are now STALE. ` +
        `Re-run \`bash scripts/regen-mirrors.sh\` manually before committing ` +
        `(CI ledger-mirror-parity will otherwise fail).\n`,
    );
    return 'regen-failed';
  }
  return 'fresh';
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
 * A scoped record-INSERT descriptor (ID-65.3): the ORIGINAL on-disk text (as read
 * by loadLedger) plus a single record-level {@link SpliceOp}. When passed to
 * {@link commitMutation} with `scoped: true`, the written bytes come from
 * re-emitting the original text with exactly one record spliced in
 * (lib/ledger/scoped-serialise.ts `scopedSpliceSerialise`), so untouched records
 * stay byte-identical — a create produces a minimal record-sized diff instead of
 * a whole-file re-emit of the parent array.
 *
 * This is an ADDITIVE sibling to {@link ScopedWrite} (the field-edit scoped path):
 * the four single-record create commands (add-subtask, open-task, create-theme,
 * create-backlog) thread this instead of a `scopedWrite` field-patch. The
 * schema+uniqueness oracle still runs at the call site BEFORE the splice
 * (`fieldPatchMutation` / `insertRecord`) — the splice primitive intentionally
 * does not re-enforce duplicate-id. The whole-file `serialise()` stays the
 * fallback when `scoped` is false (the future {65.5} `--whole-file` opt-out).
 *
 * ID-65.6: `ops` is an ARRAY of splice ops, folded LEFT over the accumulating
 * text inside {@link commitMutation} (text0 → op1 → text1 → op2 → … → textN),
 * so N inserts produce ONE final text written ONCE — the bulk `add-subtasks`
 * path. The single-record create commands ({65.3}) wrap their one op as a
 * one-element array (`ops: [op]`), so content derivation stays centralised in
 * `commitMutation` for both single and bulk paths. No silent fallback: if ANY
 * fold step returns `{ok:false}`, the error surfaces and nothing is written.
 */
interface ScopedSplice {
  originalText: string;
  ops: SpliceOp[];
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
 * - `scoped` + `scopedSplice`: ID-65.3 minimal-diff record INSERT (create
 *   commands). At most one of `scopedWrite` / `scopedSplice` is supplied per call.
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
  scopedSplice?: ScopedSplice;
  gate?: RecordSetGate;
  budgetGate?: BudgetGate;
  force?: boolean;
  /**
   * ID-35.30: scope the soft discipline-warnings sweep to the single record
   * this mutation touched, so the success envelope's `warnings` field carries
   * at most a handful of entries (the touched record's own untouched-budget
   * lines) instead of the whole 34-67 KB whole-ledger dump. Task-list call
   * sites should ALWAYS set this; roadmap/backlog mutations may omit it
   * (disciplineWarnings short-circuits on non-task-list detected anyway).
   */
  warningScope?: WarningScope;
  /**
   * ID-65.6: extra warnings the CALLER computed and wants surfaced on the
   * success envelope alongside the discipline/budget warnings. The bulk
   * `add-subtasks` path enforces budgets PER-RECORD in the handler (the generic
   * `budgetGate` only checks one record), then threads the resulting
   * soft/forced budget warnings here so they reach the operator. Prepended to
   * the warnings list; absent for every single-record caller.
   */
  extraWarnings?: string[];
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
 * ID-65.3: when `scoped` is true AND a {@link ScopedSplice} descriptor is supplied
 * (record INSERT — the four create commands), the bytes come from
 * {@link scopedSpliceSerialise} instead, so the create appends ONE record to the
 * original text rather than whole-file re-emitting the collection. Same fail-fast
 * contract: a splice rejection surfaces as `{ok:false}` and nothing is written —
 * never a silent wide whole-file fallback. The call site's `insertRecord` /
 * `fieldPatchMutation` already ran the schema + duplicate-id oracle.
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
    scopedSplice,
    gate,
    budgetGate,
    force = false,
    warningScope,
    extraWarnings,
  } = opts;
  const warnings = disciplineWarnings(detected, warningScope);
  // ID-65.6: caller-computed warnings (e.g. bulk add-subtasks per-record budget
  // soft/forced warnings) prepended so they reach the success envelope.
  if (extraWarnings?.length) warnings.unshift(...extraWarnings);

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
    // ID-35.44 stdout-purity: previously dumped the WHOLE 34-67 KB ledger
    // document (`detected.data`). {35.30} bounded the WARNINGS to the touched
    // record but left this dump. Mirror the already-bounded success envelope —
    // return the caller's bounded `resultPayload` (the same shape the live
    // write emits) tagged `dryRun: true`, never the full document. `promote`'s
    // dry-run was already bounded; this brings the generic path into line.
    return {
      ok: true,
      subcommand,
      result: { dryRun: true, ...(resultPayload as object) },
      warnings: warnings.length ? warnings : undefined,
    };
  }

  let content: string;
  if (scoped && scopedSplice) {
    // ID-65.3 / ID-65.6 record-INSERT scoped path: splice each op into the
    // accumulating text (minimal record-sized diff per op) instead of whole-file
    // re-emitting the parent collection. {65.3}'s single-record creates pass a
    // one-element `ops` array; {65.6}'s bulk `add-subtasks` passes N ops folded
    // LEFT over the text (text0 → op1 → text1 → … → textN) so N inserts yield ONE
    // final text written ONCE. The call site's insertRecord / fieldPatchMutation
    // already ran the schema + duplicate-id oracle on the merged collection, so a
    // splice failure here is unexpected — surface it rather than silently falling
    // back to a wide whole-file write (mirrors the scopedWrite handling below).
    // No silent fallback: ANY fold step failing aborts before any byte is
    // written (the gate + atomicWriteFile below never run).
    let text = scopedSplice.originalText;
    for (const op of scopedSplice.ops) {
      const r = scopedSpliceSerialise(text, op);
      if (!r.ok) {
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
      text = r.text;
    }
    content = text;
  } else if (scoped && scopedWrite) {
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
  const mirrorStatus = maybeRegenMirrors(regenMirrors);
  return {
    ok: true,
    subcommand,
    result: resultPayload,
    warnings: warnings.length ? warnings : undefined,
    mirrorStale: mirrorStatus !== 'fresh',
    mirrorStaleReason: mirrorStatus === 'fresh' ? undefined : mirrorStatus,
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

// ID-65.7 — `parseJsonArg` was promote's positional-JSON-only resolver. It is
// removed: promote now routes its task body through the {35.15}
// `readRecordInput` resolver (positional JSON | --file/stdin | named flags),
// the same path add-subtask / open-task / create-* already use. `readRecordInput`
// emits the identical `invalid-json-arg` envelope for malformed positional JSON,
// so back-compat on the error surface is preserved.

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

/**
 * ID-65.6: the per-record subtask coercion shared by single `add-subtask` and
 * bulk `add-subtasks`, factored out so both paths use byte-identical logic
 * (eliminates drift). Given a raw input object, applies:
 *   - {35.28} `--id`/body id coercion: a numeric string id ("27") → integer 27;
 *     a non-positive-integer / non-coercible string → `invalid-id` rejection.
 *     Body-supplied numeric ids retain their type; a missing id is left absent
 *     (the CALLER injects the auto-id — single uses `nextId`, bulk allocates a
 *     running counter so batch ids never collide).
 *   - {35.29} `dependencies` → number[] coercion: each token to a positive
 *     integer; non-positive-integer / non-coercible → `invalid-depends`.
 *
 * `withCreateDefaults('subtask', …)` is applied first (same as the single path).
 * `subcommand` labels the structured error envelope so the operator sees the
 * command they ran. Returns the coerced record or a CliResult rejection. NOTE:
 * this does NOT inject auto-id — the caller owns id allocation (single vs bulk
 * sequential), keeping `add-subtask`'s behaviour byte-identical.
 */
function coerceSubtaskRecord(
  subcommand: string,
  rawInput: Record<string, unknown>,
):
  | { ok: true; record: Record<string, unknown> }
  | { ok: false; result: CliResult } {
  let record = withCreateDefaults('subtask', rawInput);
  if (typeof record.id === 'string') {
    const n = Number(record.id);
    if (!Number.isInteger(n) || n <= 0 || record.id.trim() === '') {
      return {
        ok: false,
        result: cliErr(
          subcommand,
          'invalid-id',
          `--id ${JSON.stringify(record.id)} is not a positive integer; subtask.id must be a number (got non-coercible string)`,
        ),
      };
    }
    record = { ...record, id: n };
  }
  if (Array.isArray(record.dependencies)) {
    const coerced: number[] = [];
    for (const dep of record.dependencies) {
      if (typeof dep === 'number') {
        if (!Number.isInteger(dep) || dep <= 0) {
          return {
            ok: false,
            result: cliErr(
              subcommand,
              'invalid-depends',
              `--depends entry ${JSON.stringify(dep)} is not a positive integer; subtask.dependencies must be number[]`,
            ),
          };
        }
        coerced.push(dep);
        continue;
      }
      if (typeof dep === 'string') {
        const n = Number(dep);
        if (!Number.isInteger(n) || n <= 0 || dep.trim() === '') {
          return {
            ok: false,
            result: cliErr(
              subcommand,
              'invalid-depends',
              `--depends entry ${JSON.stringify(dep)} is not a positive integer; subtask.dependencies must be number[] (got non-coercible string)`,
            ),
          };
        }
        coerced.push(n);
        continue;
      }
      return {
        ok: false,
        result: cliErr(
          subcommand,
          'invalid-depends',
          `--depends entry ${JSON.stringify(dep)} is not a positive integer; subtask.dependencies must be number[]`,
        ),
      };
    }
    record = { ...record, dependencies: coerced };
  }
  return { ok: true, record };
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
        // ID-65.5 — scoped is the global default; `--whole-file` opts out into
        // the legacy whole-file `serialise()` path. `--scoped` is now a
        // redundant no-op alias (kept for back-compat).
        scoped: !flags.wholeFile,
        scopedWrite: { originalText: loaded.originalText, patch },
        gate: {
          ledger: 'task',
          descriptor,
          beforeIds,
          expectedDelta: { kind: 'none' },
        },
        // ID-35.30: scope discipline warnings to the touched task.
        warningScope: { taskId },
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
        // ID-65.5 — scoped is the global default; `--whole-file` opts out into
        // the legacy whole-file `serialise()` path. `--scoped` is now a
        // redundant no-op alias (kept for back-compat).
        scoped: !flags.wholeFile,
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
        // ID-35.30: scope discipline warnings to the touched task.
        warningScope: { taskId },
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
        // ID-65.5 — scoped is the global default; `--whole-file` opts out into
        // the legacy whole-file `serialise()` path. `--scoped` is now a
        // redundant no-op alias (kept for back-compat).
        scoped: !flags.wholeFile,
        scopedWrite: { originalText: loaded.originalText, patch },
        gate: {
          ledger: 'task',
          descriptor,
          beforeIds,
          expectedDelta: { kind: 'none' },
        },
        // ID-35.30: scope discipline warnings to the touched subtask.
        warningScope: { taskId, subId },
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
        // ID-65.5 — scoped is the global default; `--whole-file` opts out into
        // the legacy whole-file `serialise()` path. `--scoped` is now a
        // redundant no-op alias (kept for back-compat).
        scoped: !flags.wholeFile,
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
              // ID-35.27: pass the parent task id so the budget-exceeded
              // detail labels the record as `subtask <taskId>.<subId>`
              // (e.g. `subtask 49.6`), not `task <subId>`.
              parentId: taskId,
              record: changedSub as unknown as Record<string, unknown>,
              // ID-35.26: only the mutated field can REJECT — untouched
              // over-budget fields surface as soft warnings.
              mutatedField: field,
            }
          : undefined,
        force: flags.force,
        // ID-35.30: scope discipline warnings to the touched subtask.
        warningScope: { taskId, subId },
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
        // ID-65.5 — scoped is the global default; `--whole-file` opts out into
        // the legacy whole-file `serialise()` path. `--scoped` is now a
        // redundant no-op alias (kept for back-compat).
        scoped: !flags.wholeFile,
        scopedWrite: { originalText: loaded.originalText, patch },
        gate: {
          ledger: 'task',
          descriptor,
          beforeIds,
          expectedDelta: { kind: 'none' },
        },
        // ID-35.30: scope discipline warnings to the touched subtask.
        warningScope: { taskId, subId },
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
      // ID-65.6: the {35.28} `--id`/body-id coercion + {35.29} `dependencies` →
      // number[] coercion are factored into `coerceSubtaskRecord` (shared with
      // the bulk `add-subtasks` path so both stay byte-identical). It applies
      // `withCreateDefaults('subtask', …)` first and leaves a missing id absent.
      const coerce = coerceSubtaskRecord(
        'add-subtask',
        input.value as Record<string, unknown>,
      );
      if (!coerce.ok) return coerce.result;
      let record = coerce.record;
      // ID-35.21 auto-id: subtask ids are NUMBERS, scoped to the parent task.
      // Inject max+1 unless the body carried an id (explicit) — the coercion
      // helper preserves any supplied id and leaves a missing one absent.
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
        // ID-65.3: route through the {65.2} splice so the WRITTEN bytes are ONE
        // subtask appended to the parent task's subtasks[] in the original text,
        // not a whole-file serialise of the entire (possibly 40-deep) array. The
        // record spliced is the SAME coerced object pushed into nextSubtasks
        // above (its numeric id already injected). The {fieldPatchMutation} above
        // is kept as the schema oracle (Zod-validates the merged subtasks[]);
        // dup-subtask-id is NOT enforced — z.array(SubtaskSchema) has no
        // within-array uniqueness constraint (see OQ-65-1). The {35.16}
        // record-set gate below is what guards membership (drop/duplicate).
        // ID-65.5 — scoped is the global default; `--whole-file` opts out into
        // the legacy whole-file `serialise()` fallback (the `else` branch in
        // commitMutation re-emits ins.detected, which already carries the new
        // record). `scopedSplice` is ignored when `scoped` is false.
        scoped: !flags.wholeFile,
        scopedSplice: {
          originalText: loaded.originalText,
          // ID-65.6: single op wrapped as a one-element array (commitMutation
          // folds `ops` — single create == bulk-of-one).
          ops: [{ kind: 'insert', collection: 'subtasks', taskId, record }],
        },
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
          // ID-35.27: surface the parent task id so the budget-exceeded
          // detail reads `subtask <taskId>.<subId>` (e.g. `subtask 49.6`)
          // not the misleading `task <subId>` (gate.ledger is the
          // task-list ledger; subtask ids alone collide with task ids).
          parentId: taskId,
          record,
        },
        force: flags.force,
        // ID-35.30: scope discipline warnings to the just-added subtask. Without
        // this scope the success envelope dumps 34-67 KB of unrelated soft
        // warnings (every over-budget field across the WHOLE ledger), which
        // breaks JSON-stdout-parsing orchestrators.
        warningScope: { taskId, subId: newSubId },
      });
    }

    // ── ID-65.6 bulk subtask create (RESEARCH ratified input #3 = JSON-array) ──
    // `add-subtasks <taskId> --file <json|->` batch-inserts a JSON ARRAY of
    // TM-shape subtask records in ONE scoped multi-record splice: one {35.16}
    // record-set-gate check (add-many), one budget pass (per-record, atomic),
    // one mirror regen, ONE write. There is NO bulk path today — the {N.4} PLAN
    // flow hand-crafts N separate add-subtask writes; this folds them.
    case 'add-subtasks': {
      const taskId = p[0];
      if (!taskId)
        return cliErr(
          'add-subtasks',
          'missing-args',
          'add-subtasks <taskId> --file <json|-> (JSON array of subtask records)',
        );
      const loaded = await loadLedger(ledgerPath(dir, 'task'));
      if (!loaded.ok) return loaded.result;
      if (loaded.detected.kind !== 'task-list')
        return cliErr('add-subtasks', 'wrong-ledger', 'expected task-list');
      const task = loaded.detected.data.tasks.find((t) => t.id === taskId);
      if (!task)
        return cliErr('add-subtasks', 'record-not-found', `task ${taskId}`);
      // Resolve the body via the {35.15} resolver with the taskId dropped from
      // positionals (positional JSON | --file <path> | --file - = stdin).
      const bodyArgs: ParsedArgs = {
        ...args,
        positionals: p.slice(1),
      };
      const input = readRecordInput(bodyArgs);
      if (!input.ok) return input.result;
      // Ratified input #3 = JSON-ARRAY. A single object (or anything non-array)
      // is rejected with guidance pointing at the single `add-subtask` command.
      if (!Array.isArray(input.value)) {
        return cliErr(
          'add-subtasks',
          'expected-array',
          'body must be a JSON array of subtask records; for a single subtask use `add-subtask`',
        );
      }
      // {35.21} auto-id allocated SEQUENTIALLY across the batch: start a running
      // counter at nextId(...) and assign-then-increment to each record lacking
      // an id, so batch ids never collide. Records carrying an explicit id keep
      // it (after numeric coercion) and do NOT consume a counter slot.
      let counter = nextId(loaded.detected, 'subtasks', taskId) as number;
      const coercedRecords: Record<string, unknown>[] = [];
      for (const raw of input.value) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
          return cliErr(
            'add-subtasks',
            'expected-array',
            'each array element must be a subtask record object',
          );
        }
        const coerce = coerceSubtaskRecord(
          'add-subtasks',
          raw as Record<string, unknown>,
        );
        if (!coerce.ok) return coerce.result;
        let record = coerce.record;
        if (record.id === undefined) {
          record = { ...record, id: counter };
          counter += 1;
        }
        coercedRecords.push(record);
      }
      // Per-record BUDGET enforcement (atomic): reject the WHOLE batch on any
      // over-budget record unless --force (then soft warnings). Mirror the single
      // add-subtask budget semantics (subtask.description ≤250, testStrategy
      // ≤300). Runs BEFORE the scoped write so an over-budget batch does no I/O.
      const budgetWarnings: string[] = [];
      for (const record of coercedRecords) {
        const b = checkBudget({
          ledger: 'task',
          recordKind: 'subtask',
          recordId: record.id as string | number,
          parentId: taskId,
          record,
        });
        if (b.warnings.length) budgetWarnings.push(...b.warnings);
        if (!b.ok) {
          if (flags.force) {
            budgetWarnings.push(`(forced) budget-exceeded: ${b.detail}`);
          } else {
            return cliErr('add-subtasks', 'budget-exceeded', b.detail);
          }
        }
      }
      const descriptor: CollectionDescriptor = {
        collection: 'subtasks',
        taskId,
      };
      const beforeIds = beforeCollectionIds(loaded.detected, descriptor);
      // Validate the FULL batch via the schema oracle on the merged subtasks[]
      // BEFORE the scoped write (mirrors add-subtask's fieldPatchMutation). The
      // re-parsed document yields the VALIDATED new ids for the gate's add-many.
      const nextSubtasks = [...task.subtasks, ...coercedRecords];
      const m = fieldPatchMutation('add-subtasks', loaded.detected, {
        fieldPath: ['tasks', taskId, 'subtasks'],
        newValue: nextSubtasks,
      });
      if (!m.ok) return m.result;
      const validatedTask =
        loaded.detected.kind === 'task-list'
          ? loaded.detected.data.tasks.find((t) => t.id === taskId)
          : undefined;
      const validatedSubtasks = validatedTask?.subtasks ?? [];
      // The new ids are the last N of the validated subtasks[] (in append order).
      const newSubIds = validatedSubtasks
        .slice(validatedSubtasks.length - coercedRecords.length)
        .map((s) => s.id as IdValue);
      // ONE scoped multi-splice: N insert ops folded over the accumulating text
      // → ONE final text written ONCE. ONE {35.16} add-many gate covering all
      // +N ids; ONE mirror regen (commitMutation does it once). Budget already
      // enforced per-record above, so no budgetGate here (it only checks one
      // record — the per-record loop above is the bulk-correct enforcement).
      return commitMutation({
        subcommand: 'add-subtasks',
        path: ledgerPath(dir, 'task'),
        detected: loaded.detected,
        resultPayload: {
          taskId,
          subIds: newSubIds,
          added: coercedRecords.length,
          subtaskCount: nextSubtasks.length,
        },
        dryRun: flags.dryRun,
        regenMirrors: !flags.noRegenMirrors,
        // ID-65.5 — scoped is the global default; `--whole-file` opts out into
        // the legacy whole-file `serialise()` fallback (the `else` branch in
        // commitMutation re-emits ins.detected, which already carries the new
        // record). `scopedSplice` is ignored when `scoped` is false.
        scoped: !flags.wholeFile,
        scopedSplice: {
          originalText: loaded.originalText,
          ops: coercedRecords.map((record) => ({
            kind: 'insert' as const,
            collection: 'subtasks' as const,
            taskId,
            record,
          })),
        },
        gate: {
          ledger: 'task',
          descriptor,
          beforeIds,
          expectedDelta: { kind: 'add-many', ids: newSubIds },
        },
        force: flags.force,
        // ID-35.30: bound discipline warnings to this task. Per-record budget
        // warnings (incl. forced ones) are surfaced via the success envelope.
        warningScope: { taskId },
        extraWarnings: budgetWarnings,
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
      // ID-35.39 Item C: `--append` is only meaningful on the `notes` field
      // (the only nullable-string field on backlog items where concatenation
      // has well-defined semantics). Reject early on other fields so a misuse
      // doesn't silently overwrite — the operator clearly wanted append-mode.
      if (flags.append && field !== 'notes') {
        return cliErr(
          'update-backlog',
          'append-unsupported-field',
          `--append is only supported on the \`notes\` field (received \`${field}\`)`,
        );
      }
      const loaded = await loadLedger(ledgerPath(dir, 'backlog'));
      if (!loaded.ok) return loaded.result;
      const descriptor: CollectionDescriptor = { collection: 'items' };
      const beforeIds = beforeCollectionIds(loaded.detected, descriptor);
      // ID-35.21: field-type-aware coercion REPLACES the old silent
      // `JSON.parse(value)`-then-bare-string heuristic (RESEARCH §5.3). Driven
      // by BacklogItemSchema field type, so `update-backlog 100 description
      // "123"` keeps "123" a string while `dependencies "[…]"` parses to an
      // array.
      // ID-35.39 Item C: when `--append` is set on the notes field, read the
      // existing value off the loaded record and prepend it (newline-joined)
      // BEFORE coercion. The existing value may be null (schema-permitted —
      // see backlog-schema.ts `notes: z.string().nullable()`) → treat as
      // empty so the result is just the incoming string.
      let rawValue = value;
      if (flags.append && field === 'notes') {
        const existingItem =
          loaded.detected.kind === 'backlog'
            ? loaded.detected.data.items.find((it) => it.id === itemId)
            : undefined;
        const existingNotes =
          existingItem && typeof existingItem.notes === 'string'
            ? existingItem.notes
            : '';
        rawValue = existingNotes ? `${existingNotes}\n${value}` : value;
      }
      const newValue = coerceFieldValue('item', field, rawValue);
      // ID-65.5 — extract the patch so the now-default scoped write can thread
      // it as `scopedWrite`. (Pre-{65.5} update-backlog had no scoped path: it
      // fell through to the whole-file `serialise()` re-emit. Scoped is now the
      // global default for this field edit too, so untouched item records keep
      // their exact on-disk bytes; `--whole-file` restores the legacy re-emit.)
      const patch: FieldPatch = {
        fieldPath: ['items', itemId, field],
        newValue,
      };
      const m = fieldPatchMutation('update-backlog', loaded.detected, patch);
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
        scoped: !flags.wholeFile,
        scopedWrite: { originalText: loaded.originalText, patch },
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
      // ID-35.39 Item C: `--append` is only meaningful on `notes` (the only
      // nullable-string field on themes). Reject early on other fields.
      if (flags.append && field !== 'notes') {
        return cliErr(
          'update-roadmap',
          'append-unsupported-field',
          `--append is only supported on the \`notes\` field (received \`${field}\`)`,
        );
      }
      const loaded = await loadLedger(ledgerPath(dir, 'roadmap'));
      if (!loaded.ok) return loaded.result;
      const descriptor: CollectionDescriptor = { collection: 'themes' };
      const beforeIds = beforeCollectionIds(loaded.detected, descriptor);
      // ID-35.39 Item C: same notes-append semantics as update-backlog —
      // null/empty existing → just the new value; non-empty existing →
      // existing + '\n' + new (newline-joined).
      let rawValue = value;
      if (flags.append && field === 'notes') {
        const existingTheme =
          loaded.detected.kind === 'roadmap'
            ? loaded.detected.data.themes.find((t) => t.id === themeId)
            : undefined;
        const existingNotes =
          existingTheme && typeof existingTheme.notes === 'string'
            ? existingTheme.notes
            : '';
        rawValue = existingNotes ? `${existingNotes}\n${value}` : value;
      }
      const newValue = coerceFieldValue('theme', field, rawValue);
      // ID-65.5 — extract the patch so the now-default scoped write can thread
      // it as `scopedWrite`. (Pre-{65.5} update-roadmap had no scoped path: it
      // fell through to the whole-file `serialise()` re-emit. Scoped is now the
      // global default for this theme edit too; `--whole-file` restores the
      // legacy re-emit.)
      const patch: FieldPatch = {
        fieldPath: ['themes', themeId, field],
        newValue,
      };
      const m = fieldPatchMutation('update-roadmap', loaded.detected, patch);
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
        scoped: !flags.wholeFile,
        scopedWrite: { originalText: loaded.originalText, patch },
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
        // ID-65.3: route through the {65.2} splice so the WRITTEN bytes are ONE
        // record appended to the top-level collection in the original text, not a
        // whole-file re-emit. The record spliced is the post-defaults/post-auto-id
        // object built above (the SAME one insertRecord validated). insertRecord
        // remains the schema + duplicate-id oracle (rejects before this commits).
        // ID-65.5 — scoped is the global default; `--whole-file` opts out into
        // the legacy whole-file `serialise()` fallback (the `else` branch in
        // commitMutation re-emits ins.detected, which already carries the new
        // record). `scopedSplice` is ignored when `scoped` is false.
        scoped: !flags.wholeFile,
        scopedSplice: {
          originalText: loaded.originalText,
          // ID-65.6: single op wrapped as a one-element array (commitMutation
          // folds `ops` — single create == bulk-of-one).
          ops: [{ kind: 'insert', collection, record }],
        },
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
        // ID-35.30: scope discipline warnings to the just-created task. For
        // create-backlog / create-theme this is a no-op (disciplineWarnings
        // returns [] on non-task-list detected anyway).
        warningScope:
          ledger === 'task' ? { taskId: String(ins.recordId) } : undefined,
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

    // ── nested subtask delete (ID-35.43) ──────────────────────────────────────
    // The inverse of `add-subtask` (a −1 delta on one Task's nested
    // `subtasks[]`) and the sibling of `delete-backlog` (a −1 delta on a
    // top-level collection). There is NO `--force` / interactive confirmation:
    // the CLI is headless (cannot prompt) and the global `--force` is the
    // budget-override (irrelevant to a delete). The {35.16} record-set
    // drop-guard IS the safety mechanism — it asserts the post-write subtask
    // id-set equals the pre-write set minus the removed id, rejecting any
    // silently dropped/duplicated sibling with `record-set-violation` and
    // writing NOTHING. task-list IS mirrored, so regen applies (default-on,
    // `--no-regen-mirrors` to skip).
    case 'delete-subtask': {
      const [taskId, subIdRaw] = p;
      if (!taskId || subIdRaw == null)
        return cliErr(
          'delete-subtask',
          'missing-args',
          'delete-subtask <taskId> <subId>',
        );
      const loaded = await loadLedger(ledgerPath(dir, 'task'));
      if (!loaded.ok) return loaded.result;
      if (loaded.detected.kind !== 'task-list')
        return cliErr('delete-subtask', 'wrong-ledger', 'expected task-list');
      const task = loaded.detected.data.tasks.find((t) => t.id === taskId);
      if (!task)
        return cliErr('delete-subtask', 'record-not-found', `task ${taskId}`);
      // ID-35.43 subId coercion: positionals arrive as strings, but
      // `SubtaskSchema.id` is NUMBER. Mirror add-subtask's --id coercion — a
      // numeric string ("2") coerces to the integer 2; anything else (or a
      // non-positive integer) is rejected with a structured `invalid-id`
      // envelope rather than a confusing record-not-found.
      const n = Number(subIdRaw);
      if (!Number.isInteger(n) || n <= 0 || subIdRaw.trim() === '') {
        return cliErr(
          'delete-subtask',
          'invalid-id',
          `subId ${JSON.stringify(subIdRaw)} is not a positive integer; subtask.id must be a number`,
        );
      }
      const subtask = task.subtasks.find((s) => s.id === n);
      if (!subtask)
        return cliErr(
          'delete-subtask',
          'record-not-found',
          `subtask ${taskId}.${n}`,
        );
      const descriptor: CollectionDescriptor = {
        collection: 'subtasks',
        taskId,
      };
      const beforeIds = beforeCollectionIds(loaded.detected, descriptor);
      // Removing the last subtask leaves `subtasks: []` — TaskSchema.subtasks
      // is `z.array(SubtaskSchema)` with no `.min(1)`, so an empty array is a
      // legal atomic-Task state (see task-list-schema.ts inv 5).
      const nextSubtasks = task.subtasks.filter((s) => s.id !== n);
      const m = fieldPatchMutation('delete-subtask', loaded.detected, {
        fieldPath: ['tasks', taskId, 'subtasks'],
        newValue: nextSubtasks,
      });
      if (!m.ok) return m.result;
      return commitMutation({
        subcommand: 'delete-subtask',
        path: ledgerPath(dir, 'task'),
        detected: loaded.detected,
        resultPayload: {
          taskId,
          subId: n,
          subtaskCount: nextSubtasks.length,
        },
        dryRun: flags.dryRun,
        regenMirrors: !flags.noRegenMirrors,
        gate: {
          ledger: 'task',
          descriptor,
          beforeIds,
          // The removed id is the NUMERIC subtask id `n` (collectionIds maps
          // subtask ids as numbers), matching add-subtask's numeric `add`
          // delta — so beforeIds/afterIds compare by value.
          expectedDelta: { kind: 'remove', id: n },
        },
        // ID-35.30: scope discipline-warnings to the addressed task so the
        // success envelope never dumps the whole-ledger soft-warning set.
        warningScope: { taskId },
      });
    }

    // ── cross-ledger promote ─────────────────────────────────────────────────
    case 'promote': {
      const backlogId = p[0];
      if (!backlogId)
        return cliErr(
          'promote',
          'missing-args',
          'promote <backlogId> <taskJson | --file …>',
        );
      // ID-65.7 — friction #6: route the task body through the {35.15}
      // record-input resolver (positional JSON | --file <path> (- = stdin) |
      // named flags) instead of the old positional-JSON-only `parseJsonArg`.
      // `backlogId` stays positional; drop it from the positionals the resolver
      // sees so positionals[0] is the body, mirroring add-subtask's bodyArgs
      // pattern. promote's contract is unchanged: the caller still supplies a
      // COMPLETE task record (no withCreateDefaults / auto-id — insertRecord's
      // Zod parse remains the gate).
      const bodyArgs: ParsedArgs = {
        ...args,
        positionals: p.slice(1),
      };
      const input = readRecordInput(bodyArgs);
      if (!input.ok) return input.result;
      return promote(
        dir,
        backlogId,
        input.value,
        flags.dryRun,
        !flags.noRegenMirrors,
        flags.force,
        // ID-35.39 Item A — optional capability-theme binding (undefined →
        // pre-{35.39} two-ledger behaviour; defined → three-ledger atomic
        // write that also patches the named theme's `linked_tasks[]`).
        flags.capabilityTheme,
        // ID-65.4 — default to the scoped minimal-diff derivation. ID-65.5
        // threads `scoped: !flags.wholeFile` so `--whole-file` reaches the
        // {65.4} verbatim whole-file derivation (the `scoped:false` branch).
        !flags.wholeFile,
      );
    }

    case 'update-umbrella': {
      // ID-35.41 — self-contained load→mutate→write on umbrellas.json. NOT
      // routed through detectSchema/commitMutation (those are task-list/
      // roadmap/backlog only — extending the union ripples widely). umbrellas
      // is NOT mirrored (`scripts/regen-mirrors.sh` covers only the three core
      // ledgers), so there is no mirror regen here.
      const [umbrellaId] = p;
      if (!umbrellaId)
        return cliErr(
          'update-umbrella',
          'missing-args',
          'update-umbrella <umbrellaId> --add-tasks <csv> | --remove-tasks <csv> | --reorder <csv>',
        );
      return updateUmbrella(dir, umbrellaId, {
        addTasks: flags.addTasks,
        removeTasks: flags.removeTasks,
        reorder: flags.reorder,
        dryRun: flags.dryRun,
      });
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
  // ID-65.7 — the dispatch now resolves the task body via `readRecordInput`
  // (positional JSON | --file/stdin | named flags) and hands promote the
  // ALREADY-PARSED record object, instead of the raw `taskJson` string the
  // old positional-only path passed. Input resolution is orthogonal to write
  // serialisation; the contract (caller supplies a complete task record — no
  // withCreateDefaults / auto-id) is unchanged.
  taskRecord: unknown,
  dryRun: boolean,
  regenMirrors: boolean,
  force: boolean = false,
  capabilityTheme?: string,
  // ID-65.4: when true (the default), promote derives every staged-write content
  // string from the {65.2} scoped primitives (record-sized minimal diffs) instead
  // of the legacy whole-file `serialise()` re-emit. {65.5} wires the call site to
  // `scoped: !flags.wholeFile`; the `serialise()` branch remains the explicit
  // `scoped: false` opt-out so a wide whole-file write is still reachable.
  scoped: boolean = true,
): Promise<CliResult> {
  const taskListP = ledgerPath(dir, 'task');
  const backlogP = ledgerPath(dir, 'backlog');
  const roadmapP = ledgerPath(dir, 'roadmap');

  // Phase 1: validate everything (no bytes touched). ID-65.7 — the body is
  // already resolved + JSON-parsed by the dispatch via `readRecordInput`; no
  // `parseJsonArg` call here anymore. `taskRecord` is the parsed value.

  // ID-35.39 Item A: when `--capability-theme` is set we patch the task record
  // BEFORE schema-validation insert so the `capability_theme` back-link field
  // (TaskSchema z.string().nullable().optional() — see task-list-schema.ts)
  // round-trips through Zod just like any positional-JSON-supplied field.
  // Mutating a plain object the caller built locally is safe; this can't
  // surprise downstream readers since the resolved record is freshly-parsed.
  if (capabilityTheme !== undefined) {
    if (
      taskRecord === null ||
      typeof taskRecord !== 'object' ||
      Array.isArray(taskRecord)
    ) {
      return cliErr(
        'promote',
        'invalid-task-json',
        '<taskJson> must be a JSON object for --capability-theme binding',
      );
    }
    (taskRecord as Record<string, unknown>).capability_theme = capabilityTheme;
  }

  const tlLoad = await loadLedger(taskListP);
  if (!tlLoad.ok) return tlLoad.result;
  const blLoad = await loadLedger(backlogP);
  if (!blLoad.ok) return blLoad.result;
  if (tlLoad.detected.kind !== 'task-list')
    return cliErr('promote', 'wrong-ledger', 'task-list');
  if (blLoad.detected.kind !== 'backlog')
    return cliErr('promote', 'wrong-ledger', 'backlog');

  // ID-35.39 Item A: roadmap is only loaded + validated when the operator opts
  // into capability-theme binding (preserves the pre-{35.39} two-ledger
  // residual-window discipline when the flag is absent).
  let rmLoad: Awaited<ReturnType<typeof loadLedger>> | null = null;
  if (capabilityTheme !== undefined) {
    rmLoad = await loadLedger(roadmapP);
    if (!rmLoad.ok) return rmLoad.result;
    if (rmLoad.detected.kind !== 'roadmap')
      return cliErr('promote', 'wrong-ledger', 'roadmap');
    const themeExists = rmLoad.detected.data.themes.some(
      (t) => t.id === capabilityTheme,
    );
    if (!themeExists) {
      return cliErr(
        'promote',
        'unknown-theme',
        `--capability-theme ${capabilityTheme}: no theme with that id in roadmap`,
      );
    }
  }

  // ID-35.16 record-set gate: capture pre-write id-sets BEFORE both mutations.
  const taskDescriptor: CollectionDescriptor = { collection: 'tasks' };
  const backlogDescriptor: CollectionDescriptor = { collection: 'items' };
  const taskBeforeIds = beforeCollectionIds(tlLoad.detected, taskDescriptor);
  const backlogBeforeIds = beforeCollectionIds(
    blLoad.detected,
    backlogDescriptor,
  );
  // ID-35.39 Item A: capture roadmap pre-state when bound.
  const roadmapDescriptor: CollectionDescriptor = { collection: 'themes' };
  const roadmapBeforeIds =
    rmLoad && rmLoad.ok
      ? beforeCollectionIds(rmLoad.detected, roadmapDescriptor)
      : null;

  const ins = insertRecord(tlLoad.detected, taskRecord);
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

  // ID-35.39 Item A: apply the roadmap-side patch only when bound — push the
  // new task id onto the named theme's linked_tasks[] (idempotent). Uses the
  // vendored applyPatches primitive (fieldPatchMutation) so the resulting bytes
  // still pass Zod — this remains the schema-validation ORACLE regardless of
  // which content-derivation path (scoped vs whole-file) emits the final bytes.
  //
  // ID-65.4: we additionally record `roadmapAlreadyLinked` + the computed
  // `nextLinked` so the content-derivation block below can replicate the
  // pre-{65.4} idempotent behaviour byte-for-byte: already-linked → emit the
  // UNCHANGED original text (a no-op rewrite); else → emit the patched content.
  let roadmapAlreadyLinked = false;
  let roadmapNextLinked: string[] | null = null;
  if (
    capabilityTheme !== undefined &&
    rmLoad &&
    rmLoad.ok &&
    rmLoad.detected.kind === 'roadmap'
  ) {
    const theme = rmLoad.detected.data.themes.find(
      (t) => t.id === capabilityTheme,
    );
    // Theme presence was checked in Phase 1; this lookup re-finds the now-
    // post-validation reference. Idempotent push: skip if already present so
    // a re-run can't duplicate entries.
    const existingLinked = theme ? theme.linked_tasks : [];
    if (existingLinked.includes(String(ins.recordId))) {
      roadmapAlreadyLinked = true;
    } else {
      const nextLinked = [...existingLinked, String(ins.recordId)];
      roadmapNextLinked = nextLinked;
      const rmPatch = fieldPatchMutation('promote', rmLoad.detected, {
        fieldPath: ['themes', capabilityTheme, 'linked_tasks'],
        newValue: nextLinked,
      });
      if (!rmPatch.ok) return rmPatch.result;
    }
  }

  // ID-65.4: derive each staged-write content string. The DEFAULT (`scoped`)
  // path routes through the {65.2} scoped primitives so untouched records keep
  // their exact on-disk bytes — a promote then yields a task-list diff of only
  // the new Task's lines, a backlog diff of only the removed item's lines, and
  // (when bound) a roadmap diff of only the one theme's linked_tasks[] line. The
  // `scoped: false` branch preserves the legacy whole-file `serialise()` re-emit
  // (the explicit wide-write opt-out wired by {65.5}'s `--whole-file` flag).
  //
  // NO SILENT FALLBACK: a scoped function returning `{ ok: false }` returns a
  // `scoped-*` promote error envelope BEFORE anything is staged — we never fall
  // through to a wide whole-file write on a scoped failure.
  let newTaskContent: string;
  let newBacklogContent: string;
  let newRoadmapContent: string | null;
  if (scoped) {
    const tlSplice = scopedSpliceSerialise(tlLoad.originalText, {
      kind: 'insert',
      collection: 'tasks',
      record: taskRecord,
    });
    if (!tlSplice.ok)
      return cliErr(
        'promote',
        `scoped-${tlSplice.kind}`,
        'detail' in tlSplice ? tlSplice.detail : undefined,
      );
    newTaskContent = tlSplice.text;

    const blSplice = scopedSpliceSerialise(blLoad.originalText, {
      kind: 'remove',
      collection: 'items',
      recordId: rem.recordId,
    });
    if (!blSplice.ok)
      return cliErr(
        'promote',
        `scoped-${blSplice.kind}`,
        'detail' in blSplice ? blSplice.detail : undefined,
      );
    newBacklogContent = blSplice.text;

    // Roadmap: only when bound + loaded. The change is a FieldPatch on ONE
    // theme's linked_tasks[] (NOT a record splice) — use the scoped field-patch
    // path. Preserve the idempotent no-op EXACTLY: already-linked → emit the
    // unchanged original text (byte-identical); else → the field-patched text.
    if (capabilityTheme !== undefined && rmLoad && rmLoad.ok) {
      if (roadmapAlreadyLinked || roadmapNextLinked === null) {
        newRoadmapContent = rmLoad.originalText;
      } else {
        const rmScoped = scopedSerialise(rmLoad.originalText, {
          fieldPath: ['themes', capabilityTheme, 'linked_tasks'],
          newValue: roadmapNextLinked,
        });
        if (!rmScoped.ok)
          return cliErr(
            'promote',
            `scoped-${rmScoped.kind}`,
            'detail' in rmScoped ? rmScoped.detail : undefined,
          );
        newRoadmapContent = rmScoped.text;
      }
    } else {
      newRoadmapContent = null;
    }
  } else {
    newTaskContent = serialise(ins.detected);
    newBacklogContent = serialise(rem.detected);
    newRoadmapContent =
      capabilityTheme !== undefined && rmLoad && rmLoad.ok
        ? serialise(rmLoad.detected)
        : null;
  }

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
  // ID-35.39 Item A: roadmap gate — record-set delta is `none` (the theme
  // collection is unchanged; only one theme's linked_tasks[] grew by one).
  if (newRoadmapContent !== null && roadmapBeforeIds) {
    const roadmapGate = checkRecordSet(
      'promote',
      'roadmap',
      newRoadmapContent,
      roadmapBeforeIds,
      roadmapDescriptor,
      { kind: 'none' },
    );
    if (!roadmapGate.ok) return roadmapGate.result;
  }

  // ID-35.17 budget pre-check on the new Task record (the changed record). The
  // backlog item is removed, not authored, so only the Task is budgeted.
  // Over-budget → reject unless `--force` (then a soft warning). `promote`
  // authors every budgeted field (no `mutatedField` filter — same semantics
  // as create / add).
  const budgetCheck = checkBudget({
    ledger: 'task',
    recordKind: 'task',
    recordId: ins.recordId,
    record: taskRecord as Record<string, unknown>,
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
  // both the dry-run and the success return. ID-35.30: scope to the
  // just-promoted Task so the success envelope's `warnings` field stays a
  // handful of lines about the touched record, not the 34-67 KB whole-ledger
  // dump that broke buffer-parsing orchestrators.
  const warnings = [
    ...disciplineWarnings(ins.detected, { taskId: String(ins.recordId) }),
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
        // ID-35.39 Item A: surface the bound theme id when set so the dry-run
        // envelope tells the operator what would change on the roadmap side.
        ...(capabilityTheme !== undefined
          ? { boundCapabilityTheme: capabilityTheme }
          : {}),
      },
      warnings: warnings.length ? warnings : undefined,
    };
  }

  // Phase 2: stage all bound ledgers (durable temps; originals untouched).
  let stagedTask = null;
  let stagedBacklog = null;
  let stagedRoadmap = null;
  try {
    stagedTask = await stageAtomicWrite(taskListP, newTaskContent);
    stagedBacklog = await stageAtomicWrite(backlogP, newBacklogContent);
    if (newRoadmapContent !== null) {
      stagedRoadmap = await stageAtomicWrite(roadmapP, newRoadmapContent);
    }
  } catch (err) {
    if (stagedTask) await abortStagedWrite(stagedTask);
    if (stagedBacklog) await abortStagedWrite(stagedBacklog);
    if (stagedRoadmap) await abortStagedWrite(stagedRoadmap);
    return cliErr('promote', 'stage-failed', msg(err));
  }

  // Phase 3: commit all bound ledgers. ADD side first (async); REMOVE side
  // via a SYNC rename so no microtask/scheduler yield can stretch the
  // two-rename residual window after the first commit resolves — matches
  // ledger-transaction.ts's commitStagedWriteSync. A kill between the renames
  // then yields a benign transient duplicate (Task present + backlog item
  // present), never a lost update. ID-35.39 Item A: when a roadmap commit is
  // also pending, it runs as the third SYNC rename — the theme update is a
  // back-link enrichment, so a kill after the first two renames leaves the
  // theme un-updated (recoverable by a re-run with --capability-theme on the
  // already-promoted task) rather than blocking the primary promote.
  try {
    await commitStagedWrite(stagedTask);
    renameSync(stagedBacklog.tmpPath, stagedBacklog.targetPath);
    if (stagedRoadmap) {
      renameSync(stagedRoadmap.tmpPath, stagedRoadmap.targetPath);
    }
  } catch (err) {
    return cliErr('promote', 'commit-failed', msg(err));
  }

  const mirrorStatus = maybeRegenMirrors(regenMirrors);
  return {
    ok: true,
    subcommand: 'promote',
    result: {
      newTaskId: ins.recordId,
      removedBacklogId: rem.recordId,
      // ID-35.39 Item A: name the bound theme on success so callers can
      // confirm the roadmap-side mutation landed (or skipped — idempotent).
      ...(capabilityTheme !== undefined
        ? { boundCapabilityTheme: capabilityTheme }
        : {}),
    },
    warnings: warnings.length ? warnings : undefined,
    mirrorStale: mirrorStatus !== 'fresh',
    mirrorStaleReason: mirrorStatus === 'fresh' ? undefined : mirrorStatus,
  };
}

// ── ID-35.41 update-umbrella ──────────────────────────────────────────────────
//
// `docs/reference/umbrellas.json` had NO CLI write support (task_ids[]
// maintenance previously needed a hand-written escapeSerialise node script).
// This is a SELF-CONTAINED load→mutate→write path, deliberately NOT routed
// through detectSchema/commitMutation (which recognise task-list/roadmap/
// backlog only — widening that union ripples into KnownDetected, serialise,
// disciplineWarnings and the record-set machinery).
//
// Byte-format: umbrellas.json is plain `JSON.stringify(v, null, 2) + '\n'`
// with RAW UTF-8 — it was NOT part of the OQ-LS-2 (S270) `\uXXXX`-escaping
// normalisation, so the on-disk em-dash in `document_purpose` is raw. We must
// therefore NOT use `escapeSerialise` (verified byte-identical round-trip with
// plain stringify; escapeSerialise diverges on the em-dash).
//
// Budget gate: N/A. There is no budget config for umbrella fields (LEDGER_BUDGETS
// covers task/subtask/theme/item only); none is fabricated here.
//
// Mirror regen: N/A. `scripts/regen-mirrors.sh` regenerates only the three core
// ledgers; umbrellas.json has no per-record mirror, so no regen runs.

const UMBRELLAS_FILE = 'umbrellas.json';

/** Serialise an umbrellas document to the on-disk byte format (raw UTF-8,
 * 2-space indent, single trailing newline). NOT escapeSerialise. */
function serialiseUmbrellas(doc: unknown): string {
  return JSON.stringify(doc, null, 2) + '\n';
}

/** Split a comma-separated id list, trim, drop empties. */
function splitIds(csv: string): string[] {
  return csv
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Validate every id is a bare-digit Task id; return the first offender. */
function firstMalformedId(ids: string[]): string | undefined {
  return ids.find((id) => !BARE_ID_REGEX.test(id));
}

interface UpdateUmbrellaOps {
  addTasks?: string;
  removeTasks?: string;
  reorder?: string;
  dryRun?: boolean;
}

/**
 * ID-35.41 — apply one of three operations to a named umbrella's `task_ids[]`.
 *
 * Multi-flag rules:
 *   - `--reorder` is EXCLUSIVE: combining it with `--add-tasks`/`--remove-tasks`
 *     is rejected (`conflicting-ops`) — they are different intents.
 *   - `--add-tasks` + `--remove-tasks` together: ALLOWED, applied add-then-
 *     remove. An id present in BOTH lists is ambiguous → `conflicting-ops`.
 *   - At least one op-flag is required → else `missing-args`.
 *
 * Gates (mirroring the {35.16} record-set pattern, derived from the BYTES ABOUT
 * TO BE WRITTEN): (a) the umbrella id-set is unchanged (no umbrella dropped or
 * added), and (b) the edited umbrella's resulting `task_ids` SET equals the
 * pre-write set with the requested add/remove applied (for `--reorder`,
 * set-equality with the pre-write set). A mismatch rejects with
 * `record-set-violation` and writes NOTHING.
 */
async function updateUmbrella(
  dir: string,
  umbrellaId: string,
  ops: UpdateUmbrellaOps,
): Promise<CliResult> {
  const SUB = 'update-umbrella';
  const { addTasks, removeTasks, reorder, dryRun = false } = ops;

  // Op-flag presence + mutual-exclusion.
  const hasAdd = addTasks !== undefined;
  const hasRemove = removeTasks !== undefined;
  const hasReorder = reorder !== undefined;
  if (!hasAdd && !hasRemove && !hasReorder) {
    return cliErr(
      SUB,
      'missing-args',
      'update-umbrella <umbrellaId> requires --add-tasks <csv>, --remove-tasks <csv>, or --reorder <csv>',
    );
  }
  if (hasReorder && (hasAdd || hasRemove)) {
    return cliErr(
      SUB,
      'conflicting-ops',
      '--reorder cannot combine with --add-tasks/--remove-tasks (it replaces the whole order; use add/remove to change membership)',
    );
  }

  // Parse + validate id lists up-front (reject before any I/O mutation).
  const addIds = hasAdd ? splitIds(addTasks) : [];
  const removeIds = hasRemove ? splitIds(removeTasks) : [];
  const reorderIds = hasReorder ? splitIds(reorder) : [];
  const malformed = firstMalformedId([...addIds, ...removeIds, ...reorderIds]);
  if (malformed !== undefined) {
    return cliErr(
      SUB,
      'malformed-task-id',
      `task ids must be bare-digit (matches task-list.json#/tasks[].id); got "${malformed}"`,
    );
  }
  // An id in BOTH add + remove lists is ambiguous.
  const overlap = addIds.filter((id) => removeIds.includes(id));
  if (overlap.length > 0) {
    return cliErr(
      SUB,
      'conflicting-ops',
      `id(s) [${overlap.join(', ')}] appear in BOTH --add-tasks and --remove-tasks`,
    );
  }

  // Load + parse + validate the umbrellas document.
  const path = resolve(dir, UMBRELLAS_FILE);
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (err) {
    return cliErr(SUB, 'ledger-read-failed', `${path}: ${msg(err)}`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return cliErr(SUB, 'ledger-parse-failed', `${path}: ${msg(err)}`);
  }
  const parsed = UmbrellasSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      subcommand: SUB,
      error: 'ledger-schema-invalid',
      detail: path,
      issues: parsed.error.issues,
    };
  }
  const doc = parsed.data;

  const target = doc.umbrellas.find((u) => u.id === umbrellaId);
  if (!target) {
    return cliErr(
      SUB,
      'unknown-umbrella',
      `no umbrella with id "${umbrellaId}" — known: [${doc.umbrellas
        .map((u) => u.id)
        .join(', ')}]`,
    );
  }

  // Capture pre-write state (record-set gate inputs).
  const beforeUmbrellaIds = new Set(doc.umbrellas.map((u) => u.id));
  const beforeTaskIds = [...target.task_ids];
  const beforeTaskSet = new Set(beforeTaskIds);

  // Compute the new task_ids[] + the expected post-write set + a delta summary.
  let nextTaskIds: string[];
  const added: string[] = [];
  const removed: string[] = [];
  if (hasReorder) {
    // Must be a permutation of the existing set: no dupes, same membership.
    const reorderSet = new Set(reorderIds);
    const isPermutation =
      reorderIds.length === beforeTaskIds.length &&
      reorderSet.size === reorderIds.length &&
      reorderIds.every((id) => beforeTaskSet.has(id));
    if (!isPermutation) {
      return cliErr(
        SUB,
        'reorder-not-permutation',
        `--reorder must be a permutation of the existing task_ids [${beforeTaskIds.join(
          ', ',
        )}] (no adds/drops/dupes); got [${reorderIds.join(', ')}]`,
      );
    }
    nextTaskIds = [...reorderIds];
  } else {
    // add-then-remove. Idempotent append (skip present), then remove (no-op for
    // absent). Order: preserve existing, append new add ids in given order.
    const working = [...beforeTaskIds];
    for (const id of addIds) {
      if (!working.includes(id)) {
        working.push(id);
        added.push(id);
      }
    }
    const removeSet = new Set(removeIds);
    nextTaskIds = working.filter((id) => {
      if (removeSet.has(id)) {
        removed.push(id);
        return false;
      }
      return true;
    });
  }

  // The expected post-write task_ids SET (for the record-set gate b-clause).
  const expectedTaskSet = hasReorder
    ? new Set(beforeTaskSet)
    : (() => {
        const s = new Set(beforeTaskSet);
        for (const id of added) s.add(id);
        for (const id of removed) s.delete(id);
        return s;
      })();

  const deltaPayload = {
    umbrellaId,
    added,
    removed,
    reordered: hasReorder,
    before: beforeTaskIds,
    after: nextTaskIds,
  };

  // Dry-run: report the BOUNDED delta, write nothing (never a full-doc dump).
  if (dryRun) {
    return {
      ok: true,
      subcommand: SUB,
      result: { dryRun: true, ...deltaPayload },
    };
  }

  // Mutate in place (preserves object key order → byte fidelity for untouched
  // fields/umbrellas) and re-serialise to the on-disk byte format.
  target.task_ids = nextTaskIds;
  const content = serialiseUmbrellas(doc);

  // Record-set gate, derived from the BYTES ABOUT TO BE WRITTEN.
  const gate = checkUmbrellaRecordSet(
    content,
    umbrellaId,
    beforeUmbrellaIds,
    expectedTaskSet,
  );
  if (!gate.ok) return gate.result;

  // Idempotency: a no-op edit yields byte-identical content → skip the write
  // (exit 0, file unchanged), matching the {35.16}/{35.44} no-op discipline.
  if (content === text) {
    return {
      ok: true,
      subcommand: SUB,
      result: { ...deltaPayload, noop: true },
    };
  }

  await atomicWriteFile(path, content);
  return {
    ok: true,
    subcommand: SUB,
    result: deltaPayload,
  };
}

/**
 * ID-35.41 record-set-preservation gate for umbrellas (mirrors {35.16}
 * `checkRecordSet`, but self-contained for the umbrella shape). Parses the
 * bytes about to be written and asserts:
 *   (a) the umbrella id-set is unchanged (no umbrella dropped/added), and
 *   (b) the edited umbrella's resulting `task_ids` SET equals `expectedTaskSet`.
 * On mismatch returns `record-set-violation` (caller writes nothing).
 */
function checkUmbrellaRecordSet(
  content: string,
  umbrellaId: string,
  beforeUmbrellaIds: Set<string>,
  expectedTaskSet: Set<string>,
): { ok: true } | { ok: false; result: CliResult } {
  const SUB = 'update-umbrella';
  let after: unknown;
  try {
    after = JSON.parse(content);
  } catch (err) {
    return {
      ok: false,
      result: cliErr(
        SUB,
        'record-set-violation',
        `serialised output is not valid JSON (${msg(err)})`,
      ),
    };
  }
  const umbrellas = (after as { umbrellas?: unknown }).umbrellas;
  if (!Array.isArray(umbrellas)) {
    return {
      ok: false,
      result: cliErr(
        SUB,
        'record-set-violation',
        'could not locate the umbrellas collection in the serialised output',
      ),
    };
  }
  // (a) umbrella id-set unchanged.
  const afterUmbrellaIds = new Set(
    umbrellas.map((u) => (u as { id?: unknown }).id as string),
  );
  const missingU = [...beforeUmbrellaIds].filter(
    (id) => !afterUmbrellaIds.has(id),
  );
  const extraU = [...afterUmbrellaIds].filter(
    (id) => !beforeUmbrellaIds.has(id),
  );
  if (missingU.length || extraU.length) {
    const parts: string[] = [];
    if (missingU.length)
      parts.push(`umbrella missing [${missingU.join(', ')}]`);
    if (extraU.length) parts.push(`umbrella unexpected [${extraU.join(', ')}]`);
    return {
      ok: false,
      result: cliErr(SUB, 'record-set-violation', parts.join(' / ')),
    };
  }
  // (b) edited umbrella's task_ids set equals the expected set.
  const edited = umbrellas.find(
    (u) => (u as { id?: unknown }).id === umbrellaId,
  ) as { task_ids?: unknown } | undefined;
  if (!edited || !Array.isArray(edited.task_ids)) {
    return {
      ok: false,
      result: cliErr(
        SUB,
        'record-set-violation',
        `could not locate task_ids for umbrella "${umbrellaId}" in the serialised output`,
      ),
    };
  }
  const afterTaskSet = new Set(edited.task_ids as string[]);
  const missingT = [...expectedTaskSet].filter((id) => !afterTaskSet.has(id));
  const extraT = [...afterTaskSet].filter((id) => !expectedTaskSet.has(id));
  if (missingT.length || extraT.length) {
    const parts: string[] = [];
    if (missingT.length)
      parts.push(`task_ids missing [${missingT.join(', ')}]`);
    if (extraT.length) parts.push(`task_ids unexpected [${extraT.join(', ')}]`);
    return {
      ok: false,
      result: cliErr(SUB, 'record-set-violation', parts.join(' / ')),
    };
  }
  return { ok: true };
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
  mirrorReminderFor,
  run,
  journalBlock,
  ledgerPath,
  LEDGER_FILES,
  renderSchema,
  subcommandHelp,
};
export type { CliResult, MirrorStaleReason, ParsedArgs };
