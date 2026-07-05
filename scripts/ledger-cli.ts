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
 *     show           <ledger> <id>                 (ledger: task|roadmap|backlog|retro)
 *                    [--full|--summary|--no-journals|--fields csv]  (S447 shaping;
 *                    default guaranteed ≤48KB — stub journals → degrade to summary)
 *     get            <ledger> <id> [field]         (single-field read; no field = show)
 *                    get task <taskId>.<subId> [field]  (S447 subtask path)
 *     journal        <taskId>                      (S447 per-subtask journal index)
 *     journal        <taskId.subId> [--last n]     (S447 chronological journal thread)
 *     schema         [ledger|recordKind]           (field names + types + budgets)
 *     list           <ledger> [filters]            (read-only filtered snapshot; default `list task`)
 *   status flips / field edits:
 *     flip-task      <taskId> <status>
 *     flip-subtask   <taskId.subId> <status>      (legacy <taskId> <subId> <status>)
 *     update-task    <taskId> <field> <value>
 *     update-subtask <taskId.subId> <field> <value>
 *     update-roadmap <themeId> <field> <value>
 *     update-backlog <itemId> <field> <value>
 *     append-journal <taskId.subId> <text>        (legacy <taskId> <subId> <text>)
 *   record create / delete:
 *     add-subtask    <taskId> <subtaskJson | --title …>
 *     open-task      <taskJson | --title …>
 *     create-theme   <themeJson | --title …>
 *     create-backlog <itemJson | --title …>
 *     create-retro   <retroJson | --file ->       (caller-supplied S<digits> id; no auto-id)
 *     delete-backlog <itemId>
 *     delete-subtask <taskId.subId>               (legacy <taskId> <subId>)
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
 * name + type + budget; post ID-102 every id + deps type is a digit-string /
 * string[] (the RC-1 subtask.dependencies:number[] asymmetry is gone), derived
 * from Schema.shape; `<command> --help` prints that command's flags + its
 * target record's schema slice.
 *
 * `--scoped` (ID-35.11): historically selected the minimal-diff write for the
 * field-edit subcommands (flip-task | flip-subtask | append-journal). As of
 * ID-90.22 R1b the CLI no longer owns the write path — the patch-server
 * substrate is the unconditional write enforcement point (it owns serialisation,
 * the gates and mirror regen). `--scoped` / `--whole-file` STILL PARSE on the
 * argv surface (invariant 8 — argv/envelope/exit-code stability) but are now a
 * NO-OP: they no longer change where or how bytes are written. The server emits
 * the same minimal-diff escaped bytes either way. The original scoped serialiser
 * (lib/ledger/scoped-serialise.ts) was deleted in R2; byte-shape coverage lives
 * upstream (task-view U11). After the OQ-LS-2 (S270) normalisation both shapes
 * already emitted the same escaped format, so the merge into a single server
 * write path is byte-compatible for ongoing single-field edits.
 */

import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { ZodError } from 'zod';

// ID-90.22 R1b: the in-process write path was removed — the server owns
// serialisation, the gates and mirror regen. The CLI keeps only the RETAINED
// validation oracle (esc-4): detectSchema (loadLedger), applyPatches/FieldPatch
// (fieldPatchMutation), insertRecord/removeRecord (create/delete/promote). The
// scoped-serialise + atomic-write imports were dropped with the write path.
import {
  detectSchema,
  type DetectSchemaResult,
} from '@/lib/ledger/detect-schema';
import { applyPatches, type FieldPatch } from '@/lib/ledger/patch-apply';
import { insertRecord, removeRecord } from '@/lib/ledger/record-mutate';
import {
  transportCommit,
  type TransportRequest,
  type MutationOptions as TransportMutationOptions,
} from '@/scripts/ledger-server-client';
import {
  ensureServer,
  resolveDefaultLedgerDir,
} from '@/scripts/ledger-server-lifecycle';
import { SubtaskSchema, TaskSchema } from '@/lib/validation/task-list-schema';
import { RoadmapThemeSchema } from '@/lib/validation/roadmap-schema';
import { BacklogItemSchema } from '@/lib/validation/backlog-schema';
import { RetroRecordSchema } from '@/lib/validation/retro-schema';
import { UmbrellasSchema } from '@/lib/validation/umbrellas-schema';
import { BARE_ID_REGEX } from '@/lib/validation/schemas';
import {
  LEDGER_BUDGETS,
  type LedgerRecordKind,
} from '@/lib/validation/ledger-budgets';
import type { ZodTypeAny } from 'zod';

// ── ID-90.19 server intent ────────────────────────────────────────────────────
//
// ID-90.22 R1b: the `serverEnabled()` flag is gone — the server transport is
// now UNCONDITIONAL (the in-process direct-write path was removed; there is no
// other path to flag-toggle). Rollback is `git revert` of the R-chain, not a
// runtime switch (PRODUCT inv 5 superseded by the single-source cutover). The
// `KH_LEDGER_SERVER` env var is no longer read.

/**
 * Slug used in the server's /api/ledger/:slug/... routes. ID-90.25 GAP 3: the
 * server's slug vocabulary is `task-list` / `roadmap` / `backlog` / `umbrellas`
 * (verified: `PATCH /api/ledger/backlog/record/270` -> 200;
 * `product-backlog` -> 404). This is the FLAG-ON ROUTING vocabulary only — the
 * flag-OFF write path uses LEDGER_FILES/ledgerPath() and the mirror filenames
 * stay `product-backlog.json` / `product-roadmap.json` (unchanged).
 */
type LedgerSlug = 'task-list' | 'roadmap' | 'backlog' | 'umbrellas' | 'retro';

const LEDGER_NAME_TO_SLUG: Record<LedgerName, LedgerSlug> = {
  task: 'task-list',
  roadmap: 'roadmap',
  backlog: 'backlog',
  // WS-C C2: the retro ledger routes through the server's `retro` slug.
  retro: 'retro',
};

function ledgerSlug(name: LedgerName): LedgerSlug {
  return LEDGER_NAME_TO_SLUG[name];
}

/**
 * Discriminated union describing the intended mutation — populated by each
 * commitMutation call site (K4) and consumed by the server transport path.
 * The flag-OFF path ignores this entirely (invariant 3).
 */
type ServerIntent =
  | {
      kind: 'field-patch';
      slug: LedgerSlug;
      recordId: string;
      patches: FieldPatch[];
    }
  | { kind: 'record-create'; slug: LedgerSlug; record: unknown }
  | {
      kind: 'subtask-create';
      slug: LedgerSlug;
      taskId: string;
      subtasks: unknown[];
    }
  | { kind: 'subtask-delete'; slug: LedgerSlug; taskId: string; subId: string }
  | { kind: 'record-delete'; slug: LedgerSlug; recordId: string }
  | { kind: 'umbrella-patch'; umbrellaId: string; patches: FieldPatch[] }
  | {
      // ID-90.22 R1b (invariant 49 / K4-deferred): cross-ledger atomic promote
      // routed through POST /api/ledger/transaction (NOT slug-routed — the
      // server resolves the task-list/backlog/[roadmap] siblings in the launch
      // dir and acquires every leg's mutation mutex). The CLI-side validation
      // oracle (withCreateDefaults, capability-theme patch, insertRecord/
      // removeRecord) still runs at the call site; the server re-validates and
      // commits all legs atomically. `taskRecord` is the fully-resolved record.
      kind: 'transaction';
      sourceBacklogId: string;
      taskRecord: unknown;
      /** Path to the backlog ledger (for its baseMtime stat). */
      backlogPath: string;
      /** Present only when --capability-theme binds a roadmap theme. */
      capabilityThemeId?: string;
      /** Path to the roadmap ledger (stat'd only when capabilityThemeId set). */
      roadmapPath?: string;
    };

// ── ledger resolution ─────────────────────────────────────────────────────────

type LedgerName = 'task' | 'roadmap' | 'backlog' | 'retro';

const LEDGER_FILES: Record<LedgerName, string> = {
  task: 'task-list.json',
  roadmap: 'product-roadmap.json',
  backlog: 'product-backlog.json',
  // WS-C C2: the session retro ledger — the 4th ledger surface.
  retro: 'product-retros.json',
};

function ledgerPath(dir: string, name: LedgerName): string {
  return resolve(dir, LEDGER_FILES[name]);
}

// ── envelope ──────────────────────────────────────────────────────────────────

type ZodIssueLike = ZodError['issues'][number];

// ── RC-2 better-errors companion (ID-102.5 P9, TECH §P9, PRODUCT inv 16, D3) ──
//
// `describeExpectedShape` is a pure helper that translates a ZodError into
// human-readable "this is the shape we expected" lines, echoed alongside the raw
// `issues` array on every `schema-error` / `ledger-schema-invalid` envelope. It
// closes the S334 datapoint: `flip-subtask 90.26 in-progress` (hyphen instead of
// underscore) returned a raw issues array with no hint of the accepted values.
//
// CRITICAL DESIGN CONSTRAINT (D3): labels are DERIVED from the ZodError itself
// (issue `code`, `path`, and the code-specific payload) — never hardcoded per
// command. This keeps the helper working unchanged when ID-102's flag-day flips
// subtask ids from numbers to digit-strings: a post-flag-day id regex failure
// surfaces as an `invalid_format` (format 'regex', pattern `/^\d+$/`) issue,
// which this helper renders as `string of digits` with no edit required.
//
// Issue shapes verified empirically against the pinned `zod@4.4.3` (NOT zod 3 —
// the codes differ: enum-mismatch is `invalid_value` carrying `values[]` (zod 3
// used `invalid_enum_value`/`options`), and a regex failure is `invalid_format`
// with `format: 'regex'` (zod 3 used `invalid_string`)). See TECH §Verification.

/** A digit-string regex (`/^\d+$/` or equivalent) — the post-flag-day id shape. */
function isDigitStringPattern(pattern: string | undefined): boolean {
  if (!pattern) return false;
  // zod serialises the source as e.g. "/^\\d+$/". Normalise away the slashes,
  // anchors, and quantifier so both `\d+` and `[0-9]+` digit patterns match.
  const core = pattern.replace(/^\/|\/$/g, '').replace(/^\^|\$$/g, '');
  return core === '\\d+' || core === '[0-9]+';
}

/** Render the dotted field path (e.g. `subtasks.0.status`) or '' for the root. */
function issuePathLabel(path: ReadonlyArray<PropertyKey>): string {
  return path.map((seg) => String(seg)).join('.');
}

/**
 * Map a ZodError to human-readable expected-shape lines — one line per issue.
 *
 * - enum-mismatch (`invalid_value` with `values[]`) → the accepted options,
 *   pipe-joined (e.g. `done | pending | in_progress | blocked | …`).
 * - regex/format failure (`invalid_format`) → `string of digits` for the
 *   digit-string id pattern, otherwise the named format / pattern.
 * - wrong type (`invalid_type`) → the expected type label (path-qualified).
 * - bounds (`too_small` / `too_big`) → the min/max constraint (path-qualified).
 * - any other code → a path-qualified fallback drawn from the issue message.
 *
 * Additive: callers append the returned array as an `expected` field on the
 * error envelope; the raw `issues` array is never removed or altered.
 */
export function describeExpectedShape(err: ZodError): string[] {
  const lines: string[] = [];
  for (const issue of err.issues) {
    const where = issuePathLabel(issue.path);
    const at = where ? `${where}: ` : '';
    switch (issue.code) {
      case 'invalid_value': {
        // Enum / literal mismatch — echo the accepted options verbatim.
        const values = (issue as { values?: ReadonlyArray<unknown> }).values;
        if (Array.isArray(values) && values.length > 0) {
          lines.push(`${at}${values.map((v) => String(v)).join(' | ')}`);
        } else {
          lines.push(`${at}${issue.message}`);
        }
        break;
      }
      case 'invalid_format': {
        const fmt = issue as {
          format?: string;
          pattern?: string;
        };
        if (fmt.format === 'regex' && isDigitStringPattern(fmt.pattern)) {
          // The post-flag-day id shape (ID-102): a bare digit-string.
          lines.push(`${at}string of digits`);
        } else if (fmt.pattern) {
          lines.push(`${at}string matching ${fmt.pattern}`);
        } else if (fmt.format) {
          lines.push(`${at}${fmt.format} string`);
        } else {
          lines.push(`${at}${issue.message}`);
        }
        break;
      }
      case 'invalid_type': {
        const expected = (issue as { expected?: string }).expected;
        lines.push(
          expected ? `${at}expected ${expected}` : `${at}${issue.message}`,
        );
        break;
      }
      case 'too_small': {
        const small = issue as { minimum?: number | bigint; origin?: string };
        const origin = small.origin ?? 'value';
        if (small.minimum !== undefined) {
          lines.push(`${at}${origin} of at least ${small.minimum}`);
        } else {
          lines.push(`${at}${issue.message}`);
        }
        break;
      }
      case 'too_big': {
        const big = issue as { maximum?: number | bigint; origin?: string };
        const origin = big.origin ?? 'value';
        if (big.maximum !== undefined) {
          lines.push(`${at}${origin} of at most ${big.maximum}`);
        } else {
          lines.push(`${at}${issue.message}`);
        }
        break;
      }
      case 'unrecognized_keys': {
        const keys = (issue as { keys?: ReadonlyArray<string> }).keys;
        if (Array.isArray(keys) && keys.length > 0) {
          lines.push(`${at}no extra keys (got: ${keys.join(', ')})`);
        } else {
          lines.push(`${at}${issue.message}`);
        }
        break;
      }
      default: {
        // Unknown / custom codes: fall back to the issue's own message, still
        // path-qualified so a multi-field record points at the offender.
        lines.push(`${at}${issue.message}`);
      }
    }
  }
  return lines;
}

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
      /**
       * RC-2 (ID-102.5 P9): additive human-readable expected-shape lines derived
       * from the ZodError that produced `issues`. Present on `schema-error` and
       * `ledger-schema-invalid` envelopes; never replaces `issues`.
       */
      expected?: string[];
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
    /**
     * `list --ids-only` — project each matched record to just its id (the result
     * `records` array becomes a bare id string[]). Read-only; list-subcommand
     * only. Overrides `--fields` when both are supplied. Optional for back-compat.
     */
    idsOnly?: boolean;
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
    /**
     * `list` read-only filter/projection value-flags. All consume the next argv
     * token and are stored as RAW STRING tokens (the integer ones, `recent` /
     * `limit`, are coerced + range-checked at the `list` call site, never here —
     * parseArgs stays a pure tokeniser). List-subcommand only; `--status`,
     * `--depends` etc. reuse their existing keys. Optional for back-compat.
     *   - `since`     : ISO date; keep records whose date field is on/after it.
     *   - `theme`     : theme-id filter (task.capability_theme / a roadmap id).
     *   - `dependsOn` : keep records whose dependency array contains this id.
     *   - `recent`    : last-N (raw string → Number() at the call site).
     *   - `limit`     : output cap (raw string → Number() at the call site).
     *   - `fields`    : csv output projection (default id,title,status).
     */
    since?: string;
    theme?: string;
    dependsOn?: string;
    recent?: string;
    limit?: string;
    fields?: string;
    /**
     * Read-path `show` / `journal` shaping flags (S447 read-path upgrade).
     * All optional / undefined-as-falsy for back-compat with pre-existing
     * `ParsedArgs.flags` literals; `show`/`journal` are read-only (no write gate).
     *   - `full`       : `show` — opt OUT of the 48KB journal-stub safety valve
     *                    and return the record verbatim.
     *   - `summary`    : `show` — top-level fields + a compact subtask table
     *                    ({id,title,status} only), regardless of size.
     *   - `noJournals` : `show` — strip every subtask's `<info added on …>`
     *                    journal blocks to a stub, regardless of size.
     *   - `last`       : `journal <taskId.subId>` — return only the last N
     *                    entries (raw string → Number() at the call site). The
     *                    output is prefixed with a supersession warning because
     *                    later journal entries may correct/supersede earlier ones.
     * (`--fields` above doubles as `show`'s top-level projection.)
     */
    full?: boolean;
    summary?: boolean;
    noJournals?: boolean;
    last?: string;
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
  // `list` read-only filter/projection flags (each consumes the next token).
  // `--status`/`--depends` are NOT re-listed — `list` reuses their VALUE_FLAGS
  // keys above. Registered here so the reject-unknown guard accepts them.
  '--since': 'since',
  '--theme': 'theme',
  '--depends-on': 'dependsOn',
  '--recent': 'recent',
  '--limit': 'limit',
  '--fields': 'fields',
  // S447 read-path — `journal <taskId.subId> --last <n>` bounds the thread to the
  // n most-recent entries (consumes the next token; coerced + range-checked at
  // the `journal` call site, never here — parseArgs stays a pure tokeniser).
  '--last': 'last',
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
  // `list --ids-only` — project matched records to a bare id string[].
  '--ids-only': 'idsOnly',
  // S447 read-path `show` shaping flags (read-only; see ParsedArgs.flags docs).
  //   --full       : opt OUT of the 48KB journal-stub safety valve (verbatim).
  //   --summary    : top-level fields + a compact {id,title,status} subtask table.
  //   --no-journals: strip subtask journal blocks to a stub regardless of size.
  '--full': 'full',
  '--summary': 'summary',
  '--no-journals': 'noJournals',
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
    // ID-68.35 — ledgers relocated out of the public repo to the docs-site
    // checkout. parseArgs stays PURE: an explicit `--ledger-dir` sets this; with
    // none, the `''` sentinel is left for run() to resolve at the consumption
    // chokepoint via resolveDefaultLedgerDir() (fail-closed). Resolving here
    // would couple pure arg-parsing to the docs-site env (KH CI under Inv 30 has
    // no sibling) and break the parseArgs unit tests.
    ledgerDir: '',
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
    // ID-35.29 — emit string[] always. Post ID-102 EVERY record kind's deps are
    // string[] (subtask.dependencies unified to string[] — `coerceSubtaskRecord`
    // validates positive-integer digit-strings, no number coercion). The old
    // here-coercion (`Number(s)` if digit-only) was the RC-1 workaround for the
    // number[] subtask asymmetry, now eliminated:
    //   - task.dependencies     : string[]   (open-task)
    //   - subtask.dependencies  : string[]   (add-subtask — ID-102)
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

// ── S299 F7 field-edit value-input layer ─────────────────────────────────────

type FieldValueResult =
  | { ok: true; raw: string }
  | { ok: false; result: CliResult };

/**
 * S299 friction F7 — resolve the RAW STRING value of a field-VALUE edit
 * (`update-task` / `update-subtask` / `update-roadmap` / `update-backlog`) from
 * either:
 *
 *   1. `--file <path>` (`-` = stdin)  — the body is read verbatim as the field
 *                                        value (NO JSON.parse — the caller's
 *                                        `coerceFieldValue` still applies the
 *                                        field-type-aware coercion downstream,
 *                                        so an array/number field passed via a
 *                                        file is parsed exactly as a positional
 *                                        value would be). A trailing newline
 *                                        from `cat`/heredoc/editor save is
 *                                        stripped so `--file body.md` and the
 *                                        equivalent inline value coerce
 *                                        identically.
 *   2. positional `<value>`           — the back-compat path (unchanged).
 *
 * `--file` WINS when both are present (an explicit file body is the deliberate
 * large-body path the friction asked for; a stray positional is ignored rather
 * than silently concatenated). A missing file / unreadable stdin surfaces
 * `input-read-failed` (exit non-zero) — NEVER a silent no-op (the F7 footgun).
 * When NEITHER source is supplied, returns `missing-args` so a malformed
 * invocation exits non-zero with a clear message instead of no-op'ing.
 *
 * The record-CREATING commands already accept `--file`/stdin for the whole
 * record; this brings the field-EDIT commands to parity for the field value,
 * so a long multi-clause description need not be inlined (where a shell
 * mis-parse silently dropped it this session).
 */
function readFieldValue(
  subcommand: string,
  file: string | undefined,
  positionalValue: string | undefined,
): FieldValueResult {
  if (file !== undefined) {
    let text: string;
    try {
      text =
        file === '-' ? readFileSync(0, 'utf8') : readFileSync(file, 'utf8');
    } catch (err) {
      return {
        ok: false,
        result: cliErr(subcommand, 'input-read-failed', `${file}: ${msg(err)}`),
      };
    }
    // Strip a single trailing newline (the universal artefact of `cat`, a
    // heredoc, or an editor save) so a file body coerces byte-identically to
    // the same value supplied inline. Internal newlines (multi-line bodies) are
    // preserved verbatim.
    const raw = text.endsWith('\n') ? text.slice(0, -1) : text;
    return { ok: true, raw };
  }
  if (positionalValue != null) {
    return { ok: true, raw: positionalValue };
  }
  return {
    ok: false,
    result: cliErr(
      subcommand,
      'missing-args',
      `${subcommand} <id> <field> <value> — supply the value positionally or via --file <path> (- = stdin)`,
    ),
  };
}

/**
 * S299 friction F7 — guard a field-edit invocation against a shell mis-parse.
 *
 * `update-*  <id> <field> <value>` accepts the value as a SINGLE positional. A
 * shell that mis-splits a long, multi-clause, double-quoted value (the ~1KB
 * description that silently dropped this session) lands EXTRA positionals after
 * `<value>`; the old code used only `p[2]` and IGNORED the rest, so the write
 * persisted a truncated value with NO error — the F7 footgun. This guard makes
 * the arity explicit:
 *
 *   - `--file` set  → the value comes from the file, so EXACTLY `<id> <field>`
 *     are positional (2). A positional value alongside `--file` is a mistake.
 *   - `--file` unset → EXACTLY `<id> <field> <value>` are positional (3).
 *
 * Anything longer is rejected with `unexpected-args` (exit non-zero) and a hint
 * to use `--file` for a large/multi-word body — never a silent truncated write.
 * `dottedExtra` lets the subtask editor (whose first positional already encodes
 * `taskId.subId`) reuse the same 2/3 arity (the dotted id is one positional).
 */
function checkFieldEditArity(
  subcommand: string,
  positionals: string[],
  file: string | undefined,
): { ok: true } | { ok: false; result: CliResult } {
  const max = file !== undefined ? 2 : 3;
  if (positionals.length > max) {
    const extra = positionals.slice(max);
    return {
      ok: false,
      result: cliErr(
        subcommand,
        'unexpected-args',
        `${positionals.length} positional args (expected ${max}); ` +
          `unexpected: [${extra.map((a) => JSON.stringify(a)).join(', ')}]. ` +
          `A multi-word or large value must be a single quoted arg OR supplied ` +
          `via --file <path> (- = stdin) — this usually means the shell ` +
          `mis-split an unquoted value.`,
      ),
    };
  }
  return { ok: true };
}

/**
 * ID-35.15 CLI-layer auto-id (RESEARCH §2.2). Computes `max(existingIds) + 1`
 * for a collection, returning a bare-digit STRING for EVERY collection:
 *   - `tasks` / `themes` / `items` → bare-digit STRING (`"186"`)
 *   - `subtasks`                    → bare-digit STRING (`"13"`), scoped to
 *     `taskId` (ID-102: subtask ids are digit-strings, unifying with the other
 *     three collections; the value is unchanged, only the type flips).
 *
 * WS-C C4 Bug3 — the allocator is a MONOTONIC HIGH-WATER allocator, NOT a bare
 * `max(survivors)+1`. The latter reuses an id freed by delete/promote (which
 * lowers the live max), so the next allocation re-hands-out the freed id (the
 * bl-287/288 / bl-300 collision class — a reused backlog id collides with the
 * promoted Task's provenance back-reference). The fix reads the document-root
 * `_idHighWater` field (the highest id ever ALLOCATED; only ever increases,
 * stamped server-side by the symlinked task-view `insertRecord`/`removeRecord`)
 * and allocates `max(liveMax, highWater) + 1`. Backward-compatible: a ledger
 * without `_idHighWater` falls back to the exact legacy `max(survivors)+1`.
 *
 * This is a READ-side fix only: the KH CLI pre-allocates the id CLIENT-SIDE and
 * POSTs it in the ServerIntent record; the symlinked server owns the
 * authoritative WRITE + the `_idHighWater` stamp (the local
 * `insertRecord`/`removeRecord` calls in this file are esc-4 validation oracles
 * whose results are discarded for the write). So reading the mark here is
 * sufficient to make the pre-allocated id honour the high-water — no local
 * stamping is required (and the vendored `lib/ledger/record-mutate` stays
 * byte-faithful to task-view, RESEARCH §2.2).
 *
 * `subtasks` keep the legacy `max(siblings)+1`: `_idHighWater` is a PER-DOCUMENT
 * root field, not per-Task, and subtasks are never promoted OUT of their parent
 * (no doc-level id is freed), so the reuse class does not apply to them — this
 * matches the task-view server `nextId` subtask branch.
 *
 * For the subtask branch the `string[]` ids are `map(Number)`-ed BEFORE
 * `Math.max` so the comparison is numeric (`Math.max("9","10")` over raw strings
 * is brittle and a lexical `String` sort would mis-order mixed-width ids), then
 * `String`-wrapped to preserve the digit-string contract (inv 8).
 */
function nextId(
  detected: KnownDetected,
  collectionKey: 'tasks' | 'themes' | 'items' | 'subtasks',
  taskId?: string,
): string {
  if (collectionKey === 'subtasks') {
    if (detected.kind !== 'task-list') {
      throw new Error('nextId(subtasks) requires a task-list ledger');
    }
    if (taskId === undefined) {
      throw new Error('nextId(subtasks) requires a taskId');
    }
    const task = detected.data.tasks.find((t) => t.id === taskId);
    const ids = (task?.subtasks ?? []).map((s) => s.id);
    return ids.length === 0 ? '1' : String(Math.max(...ids.map(Number)) + 1);
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
  const liveMax = nums.length === 0 ? 0 : Math.max(...nums);
  // WS-C C4 Bug3: never re-hand-out an id freed by delete/promote — allocate
  // above BOTH the live max AND the persisted monotonic high-water mark.
  const storedHighWater = (detected.data as { _idHighWater?: unknown })
    ._idHighWater;
  const highWater =
    typeof storedHighWater === 'number' &&
    Number.isFinite(storedHighWater) &&
    storedHighWater >= 0
      ? storedHighWater
      : 0;
  return String(Math.max(liveMax, highWater) + 1);
}

// ── ID-35.22 discoverability: schema / per-subcommand --help / get ────────────
//
// The "prevent guessing" fix (RESEARCH §5.2 + §3). Agents kept guessing the
// id/deps TYPES every session. The historical RC-1 asymmetry — `subtask.id` a
// NUMBER while `task.id` was a STRING (a Taskmaster mandate, NOT a KH oversight
// — RESEARCH §3), so `subtask.dependencies` was `number[]` vs `string[]` — is
// ELIMINATED by ID-102: every id (subtask included) is now a digit-STRING and
// `subtask.dependencies` is `string[]`, type-identical to a Task's. `schema` /
// `--help` print, per record kind, every field's name + type + budget +
// required/optional + enum values, DERIVED FROM `Schema.shape` so the surface
// can never drift from the schema — the labels flip to `string` automatically
// at the flag-day schema flip.

/** The documented record kinds, each backed by a Zod object schema. WS-C C2
 * adds `retro`. */
type SchemaRecordKind = 'task' | 'subtask' | 'theme' | 'item' | 'retro';

/** Schemas keyed by record kind. Zod v4 exposes `.shape` directly even with a
 * trailing `.superRefine` (TaskSchema) — so all shapes are introspectable. */
const SCHEMA_SHAPES: Record<
  SchemaRecordKind,
  { shape: Record<string, ZodTypeAny> }
> = {
  task: TaskSchema,
  subtask: SubtaskSchema,
  theme: RoadmapThemeSchema,
  item: BacklogItemSchema,
  retro: RetroRecordSchema,
};

/** The label each record kind reads as at the point of use (RESEARCH §5.2):
 * a backlog item field is documented as `backlog.title`, not `item.title`. */
const KIND_LABEL: Record<SchemaRecordKind, string> = {
  task: 'task',
  subtask: 'subtask',
  theme: 'theme',
  item: 'backlog',
  retro: 'retro',
};

/** Budget registry key per record kind (the registry is keyed by record kind,
 * not by the `backlog` display label). */
const KIND_BUDGET_KEY: Record<SchemaRecordKind, LedgerRecordKind> = {
  task: 'task',
  subtask: 'subtask',
  theme: 'theme',
  item: 'item',
  retro: 'retro',
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
 * `  subtask.dependencies: string[] (sibling-only)` or
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
  // WS-C C2: the retro ledger surfaces the single retro record kind.
  retro: ['retro'],
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
    kinds = ['task', 'subtask', 'theme', 'item', 'retro'];
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
  show: {
    synopsis: 'show <ledger> <id> — print a record (read-only)',
    flags:
      'S447 shaping (all read-only). DEFAULT output is GUARANTEED ≤48KB via an ' +
      'escalating valve (only --full may exceed): verbatim if it fits → else ' +
      'stub each subtask’s <info added on …> journal blocks (keep prose) → else ' +
      'degrade to the --summary shape → else identity fields only; every degraded ' +
      'stage adds a top-level `notice` naming the escape hatches. ' +
      '--full (verbatim, no valve) | --summary (top-level fields + a compact ' +
      '{id,title,status} subtask table) | --no-journals (stub journals, keep ' +
      'prose — a transform, NOT a size cap) | --fields <csv> (project top-level ' +
      'fields; wins over the others).',
  },
  get: {
    synopsis:
      'get <ledger> <id> [field] — read one field (or the whole record); ' +
      'S447: `get task <taskId>.<subId> [field]` reaches a single subtask',
  },
  journal: {
    synopsis:
      'journal <taskId> — per-subtask journal INDEX (block count / chars / ' +
      'latest timestamp, not content); `journal <taskId.subId>` — that ' +
      'subtask’s journal thread in chronological order (read-only)',
    flags:
      '--last <n> (thread only): return the n most-recent entries — PREFIXED ' +
      'with a supersession warning, since append-only journals correct/supersede ' +
      'earlier entries in place, so a partial thread can mislead (default = full ' +
      'thread). Archive-pointer stubs are resolved from {ledgerDir}/archive/ and ' +
      'merged chronologically BEFORE the live blocks, marked with provenance.',
    kinds: ['subtask'],
  },
  schema: {
    synopsis:
      'schema [ledger|recordKind] — print field names + types + budgets',
  },
  list: {
    synopsis:
      'list <ledger> [filters] — read-only filtered snapshot (ledger: task|roadmap|backlog|retro)',
    flags:
      'default `list task` = every non-cancelled Task as {id,title,status}; ' +
      '--status <csv> (overrides the cancelled-exclusion default) | ' +
      '--since <ISO> (task.updatedAt / retro.date) | ' +
      '--theme <id> (task.capability_theme / roadmap id) | ' +
      '--depends-on <id> (records whose dependency array contains id) | ' +
      '--recent <n> (most-recent-first; retro by session id) | ' +
      '--limit <n> (output cap; default 200) | ' +
      '--fields <csv> (projection; default id,title,status) | --ids-only. ' +
      'Result carries total vs shown + a truncated flag — never silently floods ' +
      'or truncates. deprecated records are always excluded.',
  },
  'flip-task': {
    synopsis:
      'flip-task <taskId> <status> — set a Task status (the CANONICAL verb ' +
      'for status; `update-task <id> status <value>` is the equivalent ' +
      'generic-editor path — S299 F5).',
    flags: '--whole-file --dry-run --pretty --no-regen-mirrors',
    kinds: ['task'],
  },
  'flip-subtask': {
    synopsis:
      'flip-subtask <taskId.subId> <status> — set a Subtask status ' +
      '(legacy <taskId> <subId> <status> still accepted)',
    flags: '--whole-file --dry-run --pretty --no-regen-mirrors',
    kinds: ['subtask'],
  },
  'update-task': {
    synopsis:
      'update-task <taskId> <field> <value | --file <path>> — edit a Task ' +
      'field. For the `status` field, `flip-task <taskId> <status>` is the ' +
      'CANONICAL verb (S299 F5) — `update-task <id> status <value>` is the ' +
      'equivalent generic-editor path and still works, but prefer flip-task.',
    flags:
      'value: positional <value> | --file <path> (- = stdin) for a large/' +
      'multi-line body (S299 F7); --whole-file --force --dry-run --pretty ' +
      '--no-regen-mirrors',
    kinds: ['task'],
  },
  'update-subtask': {
    synopsis:
      'update-subtask <taskId.subId> <field> <value | --file <path>> — edit a Subtask field',
    flags:
      'value: positional <value> | --file <path> (- = stdin) for a large/' +
      'multi-line body (S299 F7); --whole-file --force --dry-run --pretty ' +
      '--no-regen-mirrors',
    kinds: ['subtask'],
  },
  'update-roadmap': {
    synopsis:
      'update-roadmap <themeId> <field> <value | --file <path>> — edit a Theme field',
    flags:
      'value: positional <value> | --file <path> (- = stdin) for a large/' +
      'multi-line body (S299 F7); --whole-file --force --dry-run --pretty ' +
      '--no-regen-mirrors --append (notes field only — concatenate ' +
      'newline-joined)',
    kinds: ['theme'],
  },
  'update-backlog': {
    synopsis:
      'update-backlog <itemId> <field> <value | --file <path>> — edit a backlog field',
    flags:
      'value: positional <value> | --file <path> (- = stdin) for a large/' +
      'multi-line body (S299 F7); --whole-file --force --dry-run --pretty ' +
      '--no-regen-mirrors --append (notes field only — concatenate ' +
      'newline-joined)',
    kinds: ['item'],
  },
  'append-journal': {
    synopsis:
      'append-journal <taskId.subId> <text> — append a journal block ' +
      '(legacy <taskId> <subId> <text> still accepted)',
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
  'create-retro': {
    synopsis:
      'create-retro <retroJson | --file -> — insert a session retro record',
    flags:
      'input: positional JSON | --file <path> (- = stdin) | named flags; ' +
      'the record MUST carry a caller-supplied session id (`S<digits>`, e.g. ' +
      '"S264") — retros are NOT auto-allocated. ' +
      '--force --dry-run --pretty (no mirror — retros have none)',
    kinds: ['retro'],
  },
  'delete-backlog': {
    synopsis: 'delete-backlog <itemId> — remove a backlog item',
    flags: '--dry-run --pretty --no-regen-mirrors',
    kinds: ['item'],
  },
  'delete-subtask': {
    synopsis:
      'delete-subtask <taskId.subId> — remove a Subtask ' +
      '(legacy <taskId> <subId> still accepted)',
    flags: '--dry-run --pretty --no-regen-mirrors',
    kinds: ['subtask'],
  },
  promote: {
    synopsis:
      'promote <backlogId> <taskJson | --file …> — atomically promote a backlog item to a Task',
    flags:
      'input (task body): positional JSON | --file <path> (- = stdin) | named ' +
      'flags (--title --description --status --priority …); supply only the ' +
      'meaningful fields (id/title/description/status/priority/dependencies + ' +
      'optional effort_estimate) — the optional nullable/array fields auto-fill ' +
      '(owner/priority_note/status_note→null, cross_doc_links/session_refs/' +
      'commit_refs→[]) and updatedAt is auto-stamped (F1, parity with open-task). ' +
      'NO auto-id — task.id comes from the body. ' +
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
  show           <ledger> <id>                 (ledger: task|roadmap|backlog|retro)
                 [--full|--summary|--no-journals|--fields csv]  (default guaranteed ≤48KB: stub journals → degrade to summary; --full opts out)
  get            <ledger> <id> [field]         (single-field read; no field = show)
                 get task <taskId>.<subId> [field]              (subtask path)
  journal        <taskId>                       (per-subtask journal index — counts, not content)
  journal        <taskId.subId> [--last n]      (chronological journal thread; --last warns on supersession)
  schema         [ledger|recordKind]           (print field names + types + budgets)
  list           <ledger> [filters]            (read-only snapshot; default "list task" = non-cancelled {id,title,status,subtasks})
  flip-task      <taskId> <status>
  flip-subtask   <taskId.subId> <status>        (legacy <taskId> <subId> <status>)
  update-subtask <taskId.subId> <field> <value>
  update-task    <taskId> <field> <value>
  update-roadmap <themeId> <field> <value>
  append-journal <taskId.subId> <text>          (legacy <taskId> <subId> <text>)
  add-subtask    <taskId> <subtaskJson>
  add-subtasks   <taskId> --file <json|->        (bulk — JSON array of subtasks)
  update-backlog <itemId> <field> <value>
  open-task      <taskJson | --title … [--effort-estimate <str>]>
  create-backlog <itemJson>
  create-theme   <themeJson>
  create-retro   <retroJson | --file ->         (id is a caller-supplied S<digits>; no auto-id)
  delete-backlog <itemId>
  delete-subtask <taskId.subId>                 (legacy <taskId> <subId>)
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
  budget (every id + deps type is a digit-string / string[] post ID-102 — the
  labels derive from Schema.shape, never guess). \`<command> --help\` prints that
  command's flags + its target record's schema slice.
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
    // S299 F6 — ONE concise line. Across a ~30-op batch the per-call reminder
    // was ~3 visual lines × 30 = ~90 lines of identical noise; this collapses
    // it to a single terse line that still names the fix (run regen-mirrors.sh
    // before committing) and the flag that suppressed it.
    return 'ℹ mirror regen suppressed (--no-regen-mirrors) — run `bash scripts/regen-mirrors.sh` before committing.\n';
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
          expected: describeExpectedShape(err),
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

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function cliErr(subcommand: string, error: string, detail?: string): CliResult {
  return { ok: false, subcommand, error, detail };
}

/**
 * ID-65.8 — shared subtask id-arg parser. Resolves the S280 CLI inconsistency
 * where `update-subtask` took a dotted id (`35.1`) but `append-journal` took
 * space-separated args (`35 1`). Dotted `taskId.subId` is the canonical form
 * (richer, already-validated, matches the {N.M} notation used throughout the
 * workflow docs). Reuses update-subtask's original dot-split + bad-id guard.
 *
 * `subId` is returned as a STRING (mirroring update-subtask's `slice`). ID-102:
 * subtask ids are digit-strings end-to-end, so callers use the string directly
 * in fieldPaths, lookups (`s.id === subId`) and payloads — no `Number()` cast.
 *
 * @param subcommand the calling subcommand (for the bad-id error envelope).
 * @param arg the dotted `taskId.subId` positional.
 */
function parseDottedSubtaskId(
  subcommand: string,
  arg: string,
):
  | { ok: true; taskId: string; subId: string }
  | { ok: false; result: CliResult } {
  const dot = arg.indexOf('.');
  if (dot <= 0 || dot === arg.length - 1) {
    return {
      ok: false,
      result: cliErr(
        subcommand,
        'bad-id',
        `id must be dotted taskId.subId (e.g. 35.1); got "${arg}"`,
      ),
    };
  }
  return {
    ok: true,
    taskId: arg.slice(0, dot),
    subId: arg.slice(dot + 1),
  };
}

// ── ID-90.22 R1b: gate machinery moved server-side ───────────────────────────
//
// The record-set-preservation gate, the write-time budget pre-check, the
// discipline-warnings sweep and the mirror-regen shell-out were all DELETED in
// R1b — the server now owns validation, gating, serialisation and mirror regen
// (PRODUCT invariants 8, 58). The CLI keeps only the type alias still used by
// the create handlers' id derivation; the actual gates run server-side.

/** Subtask / record id value. Post ID-102 every id is a digit-STRING; the union
 * is retained for flag-day resilience (the create handlers cast the validated
 * new id to this type — it accepts the string, and tolerates a stray number id
 * read from a not-yet-migrated ledger before the flag-day flip). */
type IdValue = string | number;

/**
 * Options for a single-ledger {@link commitMutation}. ID-90.22 R1b: all write
 * machinery (serialisation, the record-set / budget / discipline gates, mirror
 * regen) moved server-side, so the descriptor / scoped-write / gate fields are
 * gone — every mutating call site supplies a {@link ServerIntent} and the
 * delegate routes through the transport.
 *
 * - `dryRun` / `regenMirrors` / `force`: the flag-derived write modifiers
 *   (threaded to the server as per-request body fields, T-3).
 * - `extraWarnings`: caller advisory warnings prepended to the success envelope.
 * - `serverIntent`: the mutation the server performs.
 */
interface CommitMutationOptions {
  subcommand: string;
  path: string;
  resultPayload: unknown;
  dryRun: boolean;
  regenMirrors: boolean;
  force?: boolean;
  /**
   * ID-65.6 / ID-90.22 R1b: extra warnings the CALLER computed and wants
   * surfaced on the success envelope. PREPENDED to the server's own
   * discipline/budget warnings (matching the pre-R1b LOCAL `warnings.unshift`).
   * Live producers: the bulk `add-subtasks` per-record budget warnings and the
   * `update-task <id> status` flip-task canonical-verb hint (F5). Threaded into
   * the transport via {@link serverCommitMutation}'s `transportOpts`.
   */
  extraWarnings?: string[];
  /**
   * ID-90.19 K4 / ID-90.22 R1b: server transport intent. Every mutating call
   * site now sets this; `commitMutation` delegates UNCONDITIONALLY to the
   * server transport (the in-process direct-write path was removed in R1b —
   * gates, budget, record-set and serialisation all run server-side).
   */
  serverIntent: ServerIntent;
}

/**
 * Commit a single-ledger mutation via the SERVER transport (ID-90.22 R1b). The
 * in-process direct-write path (serialise + atomicWriteFile + the record-set /
 * budget / discipline gates + mirror regen) was removed in R1b — the server now
 * owns validation, gating and serialisation (PRODUCT invariants 8, 58). Every
 * mutating call site supplies a {@link ServerIntent}; `commitMutation`
 * delegates unconditionally to {@link serverCommitMutation}. The CLI-side
 * validation oracle (`loadLedger`→`detectSchema`, `fieldPatchMutation`→
 * `applyPatches`, `insertRecord`/`removeRecord`) still runs AT THE CALL SITE
 * before this delegate, producing the schema-error / walk-error / duplicate-id
 * envelopes locally (esc-4 retained modules); the server re-validates and runs
 * the record-set + budget gates authoritatively before any byte lands.
 *
 * `dryRun` is honoured server-side (writes nothing); `serverCommitMutation`
 * shapes the dry-run `result` envelope to match the pre-R1b `{dryRun:true,...}`
 * form. `extraWarnings` are prepended to the success envelope's warnings.
 */
async function commitMutation(opts: CommitMutationOptions): Promise<CliResult> {
  return serverCommitMutation(opts);
}

// ── ID-90.19 server transport helpers ─────────────────────────────────────────

import { stat } from 'node:fs/promises';

/**
 * Build the HTTP request for a ServerIntent. Called on each attempt (initial +
 * retries) so the fresh baseMtime is derived from the file's current state
 * (inv 43 re-derive).
 */
async function buildTransportRequest(
  baseUrl: string,
  intent: ServerIntent,
  filePath: string,
): Promise<TransportRequest> {
  // inv 43: the server validates baseMtime via Date.parse (ISO 8601) and emits
  // mtimeIso — send ISO, not raw epoch-ms. String(mtimeMs) parses to NaN →
  // invalid-baseMtime (flag-ON-only defect surfaced re-running the AC-P1 gate,
  // ID-90.20; never caught because flag-ON was not exercised pre-cutover).
  const mtime = (await stat(filePath)).mtime.toISOString();
  const base = `${baseUrl}/api/ledger`;

  switch (intent.kind) {
    case 'field-patch':
      return {
        url: `${base}/${intent.slug}/record/${intent.recordId}`,
        method: 'PATCH',
        body: { baseMtime: mtime, patches: intent.patches },
      };
    case 'record-create':
      return {
        url: `${base}/${intent.slug}/record`,
        method: 'POST',
        body: { baseMtime: mtime, record: intent.record },
      };
    case 'subtask-create':
      return {
        url: `${base}/${intent.slug}/record/${intent.taskId}/subtask`,
        method: 'POST',
        body: { baseMtime: mtime, subtasks: intent.subtasks },
      };
    case 'subtask-delete':
      return {
        url: `${base}/${intent.slug}/record/${intent.taskId}/subtask/${intent.subId}`,
        method: 'DELETE',
        body: { baseMtime: mtime },
      };
    case 'record-delete':
      return {
        url: `${base}/${intent.slug}/record/${intent.recordId}`,
        method: 'DELETE',
        body: { baseMtime: mtime },
      };
    case 'umbrella-patch':
      return {
        url: `${base}/umbrellas/record/${intent.umbrellaId}`,
        method: 'PATCH',
        body: { baseMtime: mtime, patches: intent.patches },
      };
    case 'transaction': {
      // ID-90.22 R1b: cross-ledger promote. NOT slug-routed (the bare
      // /api/ledger/transaction form resolves siblings server-side). Each leg
      // carries its own baseMtime (inv 43 re-derive); `filePath` is the
      // task-list path, `intent.backlogPath` the backlog, and the optional
      // roadmap leg is stat'd only when a capability-theme binds.
      const backlogMtime = (await stat(intent.backlogPath)).mtime.toISOString();
      return {
        url: `${base}/transaction`,
        method: 'POST',
        body: {
          op: 'promote',
          sourceBacklogId: intent.sourceBacklogId,
          taskRecord: intent.taskRecord,
          taskListBaseMtime: mtime,
          backlogBaseMtime: backlogMtime,
          ...(intent.capabilityThemeId !== undefined &&
          intent.roadmapPath !== undefined
            ? {
                capabilityThemeId: intent.capabilityThemeId,
                roadmapBaseMtime: (
                  await stat(intent.roadmapPath)
                ).mtime.toISOString(),
              }
            : {}),
        },
      };
    }
  }
}

/**
 * Server transport path for commitMutation (ID-90.19 K4). Delegates to
 * transportCommit (K2) via ensureServer (K3). Since the R1b cutover this is
 * the ONLY write path — the in-process direct-write path it once sat beside
 * was removed (server owns serialisation, gates and mirror regen).
 */
async function serverCommitMutation(
  opts: CommitMutationOptions,
): Promise<CliResult> {
  const intent = opts.serverIntent!;
  const ledgerDir = resolve(opts.path, '..');

  const server = await ensureServer({ ledgerDir });
  const baseUrl = `http://127.0.0.1:${server.port}`;

  // T-3 flag mapping: CLI flags → per-request body fields.
  const transportOpts: TransportMutationOptions = {
    ...(opts.dryRun ? { dryRun: true } : {}),
    ...(opts.force ? { force: true } : {}),
    ...(process.env.KH_LEDGER_ALLOW_CLIENT_NAME === '1'
      ? { allowClientName: true }
      : {}),
    ...(!opts.regenMirrors ? { regenMirrors: false } : {}),
    // ID-90.22 R1b (Curator AC-H1): caller advisory warnings (e.g. the
    // flip-task canonical-verb hint, or bulk add-subtasks per-record budget
    // warnings) prepended to the success envelope by transportCommit. NOT a
    // wire field — purely client-side envelope shaping.
    ...(opts.extraWarnings?.length
      ? { extraWarnings: opts.extraWarnings }
      : {}),
  };

  // ID-90.25 GAP 1/GAP 4: thread the flag-OFF-matching success payload so the
  // flag-ON success envelope's `result` field is byte-identical to flag-OFF.
  // Flag-OFF emits `result: resultPayload` for a live write (commitMutation
  // :2132) and `result: { dryRun:true, ...resultPayload }` for a dry-run
  // (commitMutation :2047). The server already honours dryRun (writes nothing),
  // so dry-run parity reduces to matching this envelope shape.
  const resultPayload = opts.dryRun
    ? { dryRun: true, ...(opts.resultPayload as object) }
    : opts.resultPayload;

  return transportCommit({
    deriveRequest: () => buildTransportRequest(baseUrl, intent, opts.path),
    subcommand: opts.subcommand,
    resultPayload,
    options: transportOpts,
    ensureServer: async () => {
      await ensureServer({ ledgerDir });
    },
  });
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
          expected: describeExpectedShape(applied.zodError),
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

/**
 * ID-90.25 GAP 2b: inv-4-safe clock seam. Every wall-clock timestamp that gets
 * written INTO a ledger file routes through here so the differential-parity
 * harness can pin both arms to one instant (the harness runs flag-OFF and
 * flag-ON as two separate processes at different instants → an unpinned
 * `new Date()` differs by a few same-width millisecond bytes and fails the
 * byte-compare). Production leaves `KH_LEDGER_NOW` unset → `new Date()`, so the
 * flag-OFF path stays byte-identical to pre-change behaviour (inv 4).
 */
function ledgerNow(): string {
  return process.env.KH_LEDGER_NOW ?? new Date().toISOString();
}

function journalBlock(text: string): string {
  const ts = ledgerNow();
  return `<info added on ${ts}>\n${text}\n</info added on ${ts}>`;
}

// ── S447 read-path: journal-block parsing (show valve / journal command) ──────
//
// A subtask's `details` is prose followed by append-only journal blocks written
// by `journalBlock()` above: `<info added on {ts}>…</info added on {ts}>`. Two
// real-corpus quirks the parser must survive (verified against the live
// task-list): (1) the opening `{ts}` is not always an ISO instant — older
// hand-authored blocks carry a human label like `2026-06-15 (S355 …)`; (2) the
// CLOSING tag comes in two shapes — the canonical `</info added on {ts}>` and a
// bare legacy `</info>`, and some early bodies stored literal `\n` rather than
// real newlines. So blocks are delimited by the OPENING tag ALONE: a block runs
// from its `<info added on …>` up to the next opening tag (or end of string),
// with any closing tag retained inside. Document order == chronological order
// (append-only), which is what supersession reads depend on.

/** One parsed journal block: raw text (tags included) + the opening timestamp. */
interface ParsedJournal {
  raw: string;
  timestamp: string;
}

/** Matches a journal opening tag; group 1 is everything up to the first '>'. */
const JOURNAL_OPEN_RE = /<info added on ([^>]*)>/g;

/**
 * Split a subtask `details` string into leading non-journal prose (`preamble`)
 * and the appended journal blocks in document (== chronological) order. A
 * details string with no journal blocks returns the whole string as `preamble`.
 */
function splitDetailsJournals(details: string): {
  preamble: string;
  blocks: ParsedJournal[];
} {
  const opens: { index: number; ts: string }[] = [];
  JOURNAL_OPEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = JOURNAL_OPEN_RE.exec(details)) !== null) {
    opens.push({ index: m.index, ts: m[1] });
  }
  if (opens.length === 0) return { preamble: details, blocks: [] };
  const preamble = details.slice(0, opens[0].index);
  const blocks = opens.map((o, i) => ({
    raw: details.slice(
      o.index,
      i + 1 < opens.length ? opens[i + 1].index : details.length,
    ),
    timestamp: o.ts,
  }));
  return { preamble, blocks };
}

/**
 * Replace a subtask's journal blocks with a single stub, preserving the
 * non-journal preamble. Returns the details unchanged when it carries no blocks
 * (so a caller can cheaply detect "nothing stripped"). The stub names the char
 * footprint elided and the `journal` command that retrieves the full thread.
 */
function stubSubtaskJournals(
  details: string,
  taskId: string,
  subId: string,
): string {
  const { preamble, blocks } = splitDetailsJournals(details);
  if (blocks.length === 0) return details;
  const chars = blocks.reduce((n, b) => n + b.raw.length, 0);
  const stub = `[${blocks.length} journal block${blocks.length === 1 ? '' : 's'}, ${chars} chars — use: journal ${taskId}.${subId}]`;
  const pre = preamble.replace(/\s+$/, '');
  return pre ? `${pre}\n${stub}` : stub;
}

/** A parsed archive-pointer stub left in a subtask's details post-compaction. */
interface ArchivePointer {
  /** Basename of the archive markdown (e.g. `ID-6-journals.md`). */
  file: string;
  /** Section id within that file (e.g. `6.1`). */
  section: string;
  /** The `original N chars` figure recorded at compaction time. */
  originalChars: number;
  /** The archival date lifted from the stub (e.g. `2026-06-12`), or null. */
  archivedOn: string | null;
}

// Matches the compaction stub, e.g.:
//   "Journal archived 2026-06-12 (WS-B3 compaction) ->
//    ledgers/archive/ID-6-journals.md section 6.1 (original 1182 chars)."
// The path is captured loosely (any non-space run ending in an `ID-…​.md`) and
// reduced to its basename at resolve time, so the stub's relative prefix
// (`ledgers/archive/…`) does not couple the resolver to a fixed layout.
const ARCHIVE_PTR_RE =
  /Journal archived\s+(\S+)[^\n]*?->\s*(\S*ID-\S+?\.md)\s+section\s+([\w.]+)\s*\(original\s+(\d+)\s+chars\)/g;

/** Extract every archive-pointer stub from a subtask's details (document order). */
function parseArchivePointers(details: string): ArchivePointer[] {
  const out: ArchivePointer[] = [];
  ARCHIVE_PTR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ARCHIVE_PTR_RE.exec(details)) !== null) {
    out.push({
      archivedOn: m[1] ?? null,
      file: m[2].split('/').pop() as string,
      section: m[3],
      originalChars: Number(m[4]),
    });
  }
  return out;
}

/** Escape a string for literal use inside a RegExp (archive section headers). */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Pull one `## {section} — …` section body out of an archive markdown file. The
 * section id is matched exactly (a trailing word-boundary stops `6.1` matching
 * `6.10`); the body runs from the header line up to the next `## ` heading (or
 * EOF). Returns null when the section is absent.
 */
function extractArchiveSection(md: string, section: string): string | null {
  const lines = md.split('\n');
  const headRe = new RegExp(`^##\\s+${escapeRegExp(section)}(?:\\s|$)`);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (headRe.test(lines[i])) {
      start = i;
      break;
    }
  }
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join('\n').trim();
}

/** A resolved archive section, or a reason it could not be resolved. */
type ArchiveResolution =
  | { ok: true; content: string }
  | { ok: false; reason: string };

/**
 * Resolve one archive pointer to its section body. The archive files live under
 * `{ledgerDir}/archive/` (the compaction target — ID-6-journals.md et al.); the
 * pointer's basename + section id address a single `## {section}` block.
 */
async function resolveArchivePointer(
  ledgerDir: string,
  ptr: ArchivePointer,
): Promise<ArchiveResolution> {
  const path = resolve(ledgerDir, 'archive', ptr.file);
  let md: string;
  try {
    md = await readFile(path, 'utf8');
  } catch (err) {
    return { ok: false, reason: `archive file unreadable (${msg(err)})` };
  }
  const content = extractArchiveSection(md, ptr.section);
  if (content === null)
    return {
      ok: false,
      reason: `section ${ptr.section} not found in ${ptr.file}`,
    };
  return { ok: true, content };
}

/**
 * S447 `show` safety valve. The DEFAULT (no-shaping-flag) `show` output is
 * guaranteed to serialise at or under this size (INVARIANT — see the escalating
 * valve in `shapeShowRecord`); only `--full` (and the explicit `--no-journals` /
 * `--fields` shapes the caller opts into) may exceed it. 48KB sits well below
 * the ~64KB single-tool-result ceiling agents hit, so a `show` never floods the
 * context and forces a retry (ID-68 verbatim was ~188KB; task 131 ~169KB).
 */
const SHOW_SIZE_LIMIT = 48 * 1024;

/** Serialised byte length of a candidate `show` payload. */
function showBytes(v: unknown): number {
  return Buffer.byteLength(JSON.stringify(v), 'utf8');
}
function showFits(v: unknown): boolean {
  return showBytes(v) <= SHOW_SIZE_LIMIT;
}

/** Prepend a top-level `notice` explaining a valve stage (key ordered first). */
function withShowNotice(
  obj: Record<string, unknown>,
  notice: string,
): Record<string, unknown> {
  return { notice, ...obj };
}

/** The compact {id,title,status} subtask table used by --summary + the degrade. */
function subtaskTable(
  subtasks: Record<string, unknown>[],
): { id: unknown; title: unknown; status: unknown }[] {
  return subtasks.map((s) => ({ id: s.id, title: s.title, status: s.status }));
}

/** Per-ledger identity fields for the last-resort projection (all short, budgeted). */
const SHOW_IDENTITY_FIELDS: Record<LedgerName, string[]> = {
  task: ['id', 'title', 'status'],
  roadmap: ['id', 'title', 'status'],
  backlog: ['id', 'title', 'status'],
  retro: ['id', 'date', 'track'],
};

/**
 * Replace each subtask's journal blocks with a stub, keeping non-journal prose.
 * Returns the (possibly) rewritten record + whether anything was stripped.
 */
function stubRecordJournals(
  record: Record<string, unknown>,
  subtasks: Record<string, unknown>[],
  recordId: string,
): { result: Record<string, unknown>; stripped: boolean } {
  let stripped = false;
  const trimmed = subtasks.map((s) => {
    const details = typeof s.details === 'string' ? s.details : '';
    const next = stubSubtaskJournals(details, recordId, String(s.id));
    if (next === details) return s;
    stripped = true;
    return { ...s, details: next };
  });
  return { result: { ...record, subtasks: trimmed }, stripped };
}

const NOTICE_STUB =
  `record exceeded ${SHOW_SIZE_LIMIT >> 10}KB — subtask journal blocks were replaced with stubs. ` +
  'Pass --full for the verbatim record, or "journal <taskId.subId>" for a single thread.';
const NOTICE_SUMMARY_DEGRADE =
  `record still exceeded ${SHOW_SIZE_LIMIT >> 10}KB after stubbing journals — degraded to a summary ` +
  '(top-level fields + a {id,title,status} subtask table). Escape hatches: --full (verbatim), ' +
  '--no-journals (keep prose, drop journals), --fields <csv> (pick top-level fields), ' +
  '"get task <id>.<sub> details" (one subtask), "journal <id.sub>" (one thread).';
const NOTICE_MINIMAL_DEGRADE =
  `record still exceeded ${SHOW_SIZE_LIMIT >> 10}KB after summarising (oversized top-level prose) — ` +
  'degraded to identity fields only. Use --fields <csv> to pick fields, or "get <ledger> <id> <field>" ' +
  'for one field, or --full for the verbatim record.';

/**
 * Shape a `show` record for output per the read-path flags (S447). EXPLICIT
 * shaping flags win and are the caller's own choice of shape (they may exceed
 * SHOW_SIZE_LIMIT, like --full):
 *   --fields  → top-level projection.
 *   --summary → top-level fields + a compact {id,title,status} subtask table.
 *   --full    → verbatim (opt out of the valve).
 *   --no-journals → stub journals, keep prose (targeted transform, may exceed).
 *
 * Otherwise the DEFAULT path runs the escalating valve, whose INVARIANT is that
 * the returned payload always serialises ≤ SHOW_SIZE_LIMIT regardless of record
 * shape:
 *   verbatim if it already fits → else stub journals (if that fits) → else
 *   degrade to the --summary shape (if that fits) → else project to identity
 *   fields (guaranteed tiny). Each degraded stage carries a top-level `notice`
 *   naming what happened + the escape hatches. Non-task records carry no
 *   subtasks, so the stub/summary stages are inert for them and the identity
 *   projection is the only degrade they can hit (they never exceed 48KB today).
 */
function shapeShowRecord(
  record: Record<string, unknown>,
  ledger: LedgerName,
  recordId: string,
  flags: ParsedArgs['flags'],
): { result: unknown; warnings: string[] } {
  const warnings: string[] = [];

  const subtasks = Array.isArray(record.subtasks)
    ? (record.subtasks as Record<string, unknown>[])
    : null;

  // ── explicit shaping flags (caller-chosen shape; may exceed the valve) ──────

  // --fields: top-level projection (any ledger).
  if (flags.fields !== undefined) {
    const wanted = flags.fields
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const proj: Record<string, unknown> = {};
    for (const f of wanted) {
      if (f in record) proj[f] = record[f];
      else
        warnings.push(
          `--fields: "${f}" is not a field of ${ledger} ${recordId}`,
        );
    }
    return { result: proj, warnings };
  }

  // --summary: identity + a compact subtask table.
  if (flags.summary) {
    if (!subtasks) {
      warnings.push(
        `--summary: ${ledger} ${recordId} has no subtasks — returning the full record`,
      );
      return { result: record, warnings };
    }
    return {
      result: { ...record, subtasks: subtaskTable(subtasks) },
      warnings,
    };
  }

  // --full: verbatim, opt out of the valve.
  if (flags.full) return { result: record, warnings };

  // --no-journals: explicit strip (keep prose). A targeted transform, NOT a size
  // cap — it may still exceed the valve on a prose-heavy record (the default
  // path below is the size guarantee; this is the "keep everything but journals"
  // opt-in). Inert on subtask-less records.
  if (flags.noJournals) {
    if (!subtasks) return { result: record, warnings };
    const { result, stripped } = stubRecordJournals(record, subtasks, recordId);
    if (!stripped) return { result: record, warnings };
    return {
      result: withShowNotice(
        result,
        'subtask journal blocks stripped (--no-journals). Use `journal <taskId.subId>` for a full thread or `journal <taskId>` for the per-subtask index.',
      ),
      warnings,
    };
  }

  // ── DEFAULT path — the ≤48KB invariant lives here (escalating valve) ─────────

  // Stage 0: already fits → verbatim (pre-S447 behaviour for small records).
  if (showFits(record)) return { result: record, warnings };

  // Stage 1: stub subtask journals, keep prose.
  if (subtasks) {
    const { result: stubbed, stripped } = stubRecordJournals(
      record,
      subtasks,
      recordId,
    );
    if (stripped) {
      const cand = withShowNotice(stubbed, NOTICE_STUB);
      if (showFits(cand)) return { result: cand, warnings };
    }
  }

  // Stage 2: degrade to the --summary shape (drops subtask details entirely).
  const summary = subtasks
    ? { ...record, subtasks: subtaskTable(subtasks) }
    : { ...record };
  const summaryCand = withShowNotice(summary, NOTICE_SUMMARY_DEGRADE);
  if (showFits(summaryCand)) return { result: summaryCand, warnings };

  // Stage 3: last resort — project to identity fields (guaranteed tiny). Reached
  // only when oversized top-level prose (not journals) blows the summary too.
  const minimal: Record<string, unknown> = {};
  for (const f of SHOW_IDENTITY_FIELDS[ledger]) {
    if (f in record) minimal[f] = record[f];
  }
  if (subtasks) minimal.subtaskCount = subtasks.length;
  return {
    result: withShowNotice(minimal, NOTICE_MINIMAL_DEGRADE),
    warnings,
  };
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
  'subtask' | 'task' | 'theme' | 'item' | 'retro',
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
  // WS-C C2: retro record structural defaults — the six empty category arrays,
  // empty provenance arrays, and the four soft-delete fields. `id` (the
  // caller-supplied session id `S<n>`), `session_id`, `date`, and `track` are
  // required scalars with no inherent empty value and must come from the body.
  retro: {
    session_refs: [],
    commit_refs: [],
    cross_doc_links: [],
    bugs_discovered: [],
    failed_assumptions: [],
    architecture_decisions: [],
    rejected_approaches: [],
    workflow_improvements: [],
    unresolved_questions: [],
    deprecated: false,
    deprecation_reason: null,
    superseding_record_id: null,
    last_conflict_check: null,
  },
};

/**
 * Merge structural defaults UNDER the supplied record (supplied fields win).
 * Defaults only apply for absent keys, so a positional-JSON body that already
 * carries (e.g.) `status` keeps its value. `task.updatedAt` defaults to the
 * write timestamp when absent.
 */
function withCreateDefaults(
  recordKind: 'subtask' | 'task' | 'theme' | 'item' | 'retro',
  record: Record<string, unknown>,
): Record<string, unknown> {
  const defaults = { ...CREATE_DEFAULTS[recordKind] };
  if (recordKind === 'task' && record.updatedAt === undefined) {
    // ID-90.25 GAP 2b: route through the ledgerNow() clock seam — under flag-ON
    // the record (with this updatedAt) is built CLI-side then POSTed to the
    // server, so an unpinned wall-clock here would diverge from the flag-OFF
    // arm in the parity harness. Prod leaves KH_LEDGER_NOW unset (unchanged).
    defaults.updatedAt = ledgerNow();
  }
  return { ...defaults, ...record };
}

/**
 * ID-65.6: the per-record subtask coercion shared by single `add-subtask` and
 * bulk `add-subtasks`, factored out so both paths use byte-identical logic
 * (eliminates drift). Given a raw input object, applies:
 *   - {35.28} `--id`/body id validation (ID-102): a numeric string id ("27")
 *     is validated positive-integer and KEPT AS THE STRING "27" (no number
 *     restamp — subtask ids are digit-strings). A NUMBER-typed body id (JSON
 *     `{"id": 15}`) is stamped `String(15)` ("15"), mirroring the deps-branch
 *     convention below. A non-positive-integer / non-coercible value →
 *     `invalid-id` rejection. A missing id is left absent (the CALLER injects
 *     the auto-id — single uses `nextId`, bulk allocates a running counter so
 *     batch ids never collide).
 *   - {35.29} `dependencies` → string[] coercion (ID-102): each token validated
 *     to a positive integer; a number token is `String()`-wrapped, a valid
 *     digit-string token is pushed verbatim; non-positive-integer /
 *     non-coercible → `invalid-depends`. Type-identical to a Task's `string[]`.
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
    // ID-102: validate positive-integer but KEEP the digit-string id verbatim —
    // subtask ids are strings; no number restamp.
    const n = Number(record.id);
    if (!Number.isInteger(n) || n <= 0 || record.id.trim() === '') {
      return {
        ok: false,
        result: cliErr(
          subcommand,
          'invalid-id',
          `--id ${JSON.stringify(record.id)} is not a positive integer; subtask.id must be a string of digits (got non-coercible string)`,
        ),
      };
    }
    // No restamp — the validated digit-string id stays in place.
  } else if (typeof record.id === 'number') {
    // ID-102: a NUMBER-typed body id (JSON `{"id": 15}`) is stamped String(15)
    // ("15"), mirroring the deps-branch convention — the stored id is always a
    // digit-string. TECH §P2 is silent on this case; documented in the journal.
    if (!Number.isInteger(record.id) || record.id <= 0) {
      return {
        ok: false,
        result: cliErr(
          subcommand,
          'invalid-id',
          `--id ${JSON.stringify(record.id)} is not a positive integer; subtask.id must be a string of digits`,
        ),
      };
    }
    record = { ...record, id: String(record.id) };
  }
  if (Array.isArray(record.dependencies)) {
    const coerced: string[] = [];
    for (const dep of record.dependencies) {
      if (typeof dep === 'number') {
        if (!Number.isInteger(dep) || dep <= 0) {
          return {
            ok: false,
            result: cliErr(
              subcommand,
              'invalid-depends',
              `--depends entry ${JSON.stringify(dep)} is not a positive integer; subtask.dependencies must be string[] of digits`,
            ),
          };
        }
        coerced.push(String(dep));
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
              `--depends entry ${JSON.stringify(dep)} is not a positive integer; subtask.dependencies must be string[] of digits (got non-coercible string)`,
            ),
          };
        }
        coerced.push(dep);
        continue;
      }
      return {
        ok: false,
        result: cliErr(
          subcommand,
          'invalid-depends',
          `--depends entry ${JSON.stringify(dep)} is not a positive integer; subtask.dependencies must be string[] of digits`,
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
  // ID-68.35 — resolve the default ledger dir at the consumption chokepoint
  // (fail-closed). An explicit `--ledger-dir` / hand-built `flags.ledgerDir`
  // short-circuits; absent one, resolveDefaultLedgerDir() throws LOUD when
  // KH_PRIVATE_DOCS_DIR is unset. Uses the SAME resolver as the daemon default
  // so the `isDefault` persistent-vs-ephemeral gate in ensureServer holds.
  const dir = flags.ledgerDir || resolveDefaultLedgerDir();

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
          `ledger must be task|roadmap|backlog|retro`,
        );
      const loaded = await loadLedger(ledgerPath(dir, ledger as LedgerName));
      if (!loaded.ok) return loaded.result;
      const d = loaded.detected;
      const record =
        d.kind === 'task-list'
          ? d.data.tasks.find((t) => t.id === id)
          : d.kind === 'roadmap'
            ? d.data.themes.find((t) => t.id === id)
            : d.kind === 'retro'
              ? d.data.retros.find((r) => r.id === id)
              : d.data.items.find((it) => it.id === id);
      if (!record)
        return cliErr('show', 'record-not-found', `${ledger} id ${id}`);
      // S447 read-path: shape the record per --fields/--summary/--no-journals/
      // --full and the 48KB journal-stub safety valve. Verbatim for a small
      // record with no shaping flag (the pre-S447 behaviour).
      const shaped = shapeShowRecord(
        record as Record<string, unknown>,
        ledger as LedgerName,
        id,
        flags,
      );
      return {
        ok: true,
        subcommand: 'show',
        result: shaped.result,
        ...(shaped.warnings.length ? { warnings: shaped.warnings } : {}),
      };
    }

    // ── ID-35.22 single-field read (RESEARCH §5.1) ──────────────────────────
    // `get <ledger> <id> [field]` extends `show` with single-field reads:
    // `get backlog 100 status` prints just the status value; no field behaves
    // exactly like `show`. S447: a dotted task id reaches a SUBTASK —
    // `get task <taskId>.<subId> [field]` returns the subtask (or one of its
    // fields), the read-path complement to `update-subtask`. Read-only.
    case 'get': {
      const [ledger, id, field] = p;
      if (!ledger || !id)
        return cliErr('get', 'missing-args', 'get <ledger> <id> [field]');
      if (!(ledger in LEDGER_FILES))
        return cliErr(
          'get',
          'bad-ledger',
          `ledger must be task|roadmap|backlog|retro`,
        );
      const loaded = await loadLedger(ledgerPath(dir, ledger as LedgerName));
      if (!loaded.ok) return loaded.result;
      const d = loaded.detected;

      // S447 subtask path — `get task <taskId>.<subId> [field]`. Only the task
      // ledger has subtasks; a dot in any other ledger's id falls through to the
      // record lookup below (and reports record-not-found as before).
      if (ledger === 'task' && id.includes('.')) {
        if (d.kind !== 'task-list')
          return cliErr(
            'get',
            'bad-ledger',
            'subtask paths read the task ledger',
          );
        const parsed = parseDottedSubtaskId('get', id);
        if (!parsed.ok) return parsed.result;
        const { taskId, subId } = parsed;
        const task = d.data.tasks.find((t) => t.id === taskId);
        if (!task)
          return cliErr('get', 'record-not-found', `task id ${taskId}`);
        const sub = task.subtasks.find((s) => String(s.id) === subId);
        if (!sub)
          return cliErr(
            'get',
            'subtask-not-found',
            `task ${taskId} has no subtask ${subId}`,
          );
        if (field == null) return { ok: true, subcommand: 'get', result: sub };
        const subRec = sub as Record<string, unknown>;
        if (!(field in subRec))
          return cliErr(
            'get',
            'field-not-found',
            `subtask ${taskId}.${subId} has no field "${field}"`,
          );
        return { ok: true, subcommand: 'get', result: subRec[field] };
      }

      const record =
        d.kind === 'task-list'
          ? d.data.tasks.find((t) => t.id === id)
          : d.kind === 'roadmap'
            ? d.data.themes.find((t) => t.id === id)
            : d.kind === 'retro'
              ? d.data.retros.find((r) => r.id === id)
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

    // ── S447 journal reads (read-path upgrade) ──────────────────────────────
    // `journal <taskId.subId>` returns a subtask's journal thread in
    // chronological order (full thread by default — supersession makes partial
    // reads unsafe; `--last N` bounds it but prefixes a supersession warning).
    // `journal <taskId>` returns an INDEX (per-subtask block count / chars /
    // latest timestamp), not content. Archive-pointer stubs are resolved and
    // merged chronologically BEFORE the live blocks, marked with provenance.
    // Reads the task ledger only. Read-only — no write gate.
    case 'journal': {
      const arg = p[0];
      if (!arg)
        return cliErr(
          'journal',
          'missing-args',
          'journal <taskId> (index) | journal <taskId.subId> [--last n] (thread)',
        );
      const loaded = await loadLedger(ledgerPath(dir, 'task'));
      if (!loaded.ok) return loaded.result;
      if (loaded.detected.kind !== 'task-list')
        return cliErr('journal', 'bad-ledger', 'journal reads the task ledger');
      const tasks = loaded.detected.data.tasks;

      // ── single-subtask thread ──────────────────────────────────────────────
      if (arg.includes('.')) {
        const parsed = parseDottedSubtaskId('journal', arg);
        if (!parsed.ok) return parsed.result;
        const { taskId, subId } = parsed;
        const task = tasks.find((t) => t.id === taskId);
        if (!task)
          return cliErr('journal', 'record-not-found', `task id ${taskId}`);
        const sub = task.subtasks.find((s) => String(s.id) === subId);
        if (!sub)
          return cliErr(
            'journal',
            'subtask-not-found',
            `task ${taskId} has no subtask ${subId}`,
          );

        // --last n: coerce + range-check (non-negative integer; never a silent
        // slice — `--last abc` rejects).
        let last: number | undefined;
        if (flags.last !== undefined) {
          const n = Number(flags.last);
          if (!Number.isInteger(n) || n < 0)
            return cliErr(
              'journal',
              'bad-flag-value',
              `--last must be a non-negative integer (got "${flags.last}")`,
            );
          last = n;
        }

        const details =
          typeof (sub as { details?: unknown }).details === 'string'
            ? ((sub as { details: string }).details as string)
            : '';
        const { blocks } = splitDetailsJournals(details);
        const pointers = parseArchivePointers(details);

        const warnings: string[] = [];
        // Archive entries come FIRST (older than any live block). Each resolved
        // section is marked with provenance; an unresolved pointer degrades to a
        // warning + a placeholder entry (never a silent drop).
        const entries: {
          provenance: 'archived' | 'live';
          timestamp: string | null;
          source?: string;
          text: string;
        }[] = [];
        for (const ptr of pointers) {
          const resolved = await resolveArchivePointer(dir, ptr);
          const source = `${ptr.file} §${ptr.section}`;
          if (resolved.ok) {
            entries.push({
              provenance: 'archived',
              timestamp: ptr.archivedOn,
              source,
              text: resolved.content,
            });
          } else {
            warnings.push(
              `archive pointer ${source} unresolved: ${resolved.reason}`,
            );
            entries.push({
              provenance: 'archived',
              timestamp: ptr.archivedOn,
              source,
              text: `[archived ${ptr.originalChars} chars unresolved — ${resolved.reason}]`,
            });
          }
        }
        for (const b of blocks) {
          entries.push({
            provenance: 'live',
            timestamp: b.timestamp,
            text: b.raw,
          });
        }

        const totalEntries = entries.length;
        let shownEntries = entries;
        let truncated = false;
        if (last !== undefined && last < entries.length) {
          shownEntries = entries.slice(entries.length - last);
          truncated = true;
          warnings.unshift(
            `--last ${last}: showing the ${last} most-recent of ${totalEntries} entries. Journals are append-only with IN-PLACE supersession — an earlier entry may be corrected or superseded by a later one, so a partial thread can mislead; read the full thread when correctness matters.`,
          );
        }

        return {
          ok: true,
          subcommand: 'journal',
          result: {
            task: taskId,
            subtask: subId,
            total: totalEntries,
            shown: shownEntries.length,
            truncated,
            entries: shownEntries,
          },
          ...(warnings.length ? { warnings } : {}),
        };
      }

      // ── per-task index (counts, not content) ────────────────────────────────
      const task = tasks.find((t) => t.id === arg);
      if (!task) return cliErr('journal', 'record-not-found', `task id ${arg}`);
      const index = task.subtasks.map((s) => {
        const details =
          typeof (s as { details?: unknown }).details === 'string'
            ? ((s as { details: string }).details as string)
            : '';
        const { blocks } = splitDetailsJournals(details);
        const pointers = parseArchivePointers(details);
        const chars = blocks.reduce((n, b) => n + b.raw.length, 0);
        return {
          id: s.id,
          title: (s as { title?: unknown }).title,
          journalBlocks: blocks.length,
          chars,
          latest: blocks.length ? blocks[blocks.length - 1].timestamp : null,
          ...(pointers.length
            ? {
                archived: pointers.map(
                  (ptr) =>
                    `${ptr.file} §${ptr.section} (${ptr.originalChars} chars)`,
                ),
              }
            : {}),
        };
      });
      return {
        ok: true,
        subcommand: 'journal',
        result: { task: task.id, subtasks: index },
      };
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

    // ── read-only list / snapshot (owner's task-snapshot affordance) ─────────
    // `list <ledger> [filters]` projects records to a compact, filtered list.
    // The canonical use is `list task` → every NON-cancelled Task as
    // {id,title,status} for relatedness / dependency investigation. Read-only:
    // no write gate, no mirror regen. NEVER silently floods or truncates — the
    // `result` envelope always carries `total` (matched) vs `shown` (returned)
    // and a `truncated` flag, and a filter the record kind has no field for
    // surfaces a warning rather than being dropped in silence.
    case 'list': {
      const ledger = p[0];
      if (!ledger)
        return cliErr(
          'list',
          'missing-args',
          'list <ledger> [--status csv --since ISO --theme id --depends-on id --recent n --limit n --fields csv --ids-only] (ledger: task|roadmap|backlog|retro)',
        );
      if (!(ledger in LEDGER_FILES))
        return cliErr(
          'list',
          'bad-ledger',
          `ledger must be task|roadmap|backlog|retro`,
        );

      // Coerce the integer flags up-front — parseArgs stores them as raw string
      // tokens. A non-integer / negative value is a hard error (never a silent
      // slice): `--recent abc` must reject, not return everything.
      const coerceCount = (
        raw: string | undefined,
        flag: string,
      ): { ok: true; value?: number } | { ok: false; result: CliResult } => {
        if (raw === undefined) return { ok: true };
        const n = Number(raw);
        if (!Number.isInteger(n) || n < 0)
          return {
            ok: false,
            result: cliErr(
              'list',
              'bad-flag-value',
              `${flag} must be a non-negative integer (got "${raw}")`,
            ),
          };
        return { ok: true, value: n };
      };
      const recentC = coerceCount(flags.recent, '--recent');
      if (!recentC.ok) return recentC.result;
      const limitC = coerceCount(flags.limit, '--limit');
      if (!limitC.ok) return limitC.result;
      const recent = recentC.value;
      const limit = limitC.value;

      const loaded = await loadLedger(ledgerPath(dir, ledger as LedgerName));
      if (!loaded.ok) return loaded.result;
      const d = loaded.detected;

      // Per-ledger field map: which record field each filter/projection reads.
      // Keyed by ledger NAME (not d.kind) so the backlog 'else' is explicit.
      // Retros have NO status and NO title — identity is id (S<digits>) + date +
      // track; `--since` reads the ISO `date`; `deprecated` is honoured below.
      const META: Record<
        LedgerName,
        {
          dateField?: string;
          themeField?: string;
          dependsField?: string;
          hasStatus: boolean;
          defaultFields: string[];
        }
      > = {
        task: {
          dateField: 'updatedAt',
          themeField: 'capability_theme',
          dependsField: 'dependencies',
          hasStatus: true,
          // S447: `subtasks` is a DERIVED roll-up (done/total) rendered in the
          // projection below, not a raw field. Owner decision — the default
          // `list task` row now surfaces subtask progress at a glance.
          defaultFields: ['id', 'title', 'status', 'subtasks'],
        },
        roadmap: {
          themeField: 'id',
          hasStatus: true,
          defaultFields: ['id', 'title', 'status'],
        },
        backlog: {
          dependsField: 'dependencies',
          hasStatus: true,
          defaultFields: ['id', 'title', 'status'],
        },
        retro: {
          dateField: 'date',
          hasStatus: false,
          defaultFields: ['id', 'date', 'track'],
        },
      };
      const meta = META[ledger as LedgerName];

      const records = (d.kind === 'task-list'
        ? d.data.tasks
        : d.kind === 'roadmap'
          ? d.data.themes
          : d.kind === 'retro'
            ? d.data.retros
            : d.data.items) as unknown as Record<string, unknown>[];

      const warnings: string[] = [];
      const inert = (flag: string, why: string) =>
        warnings.push(`${flag} ignored: ${why}`);

      let matched = records;

      // --status (csv). An explicit --status OVERRIDES the snapshot default
      // (cancelled-exclusion) below — the caller asked for specific statuses.
      if (flags.status !== undefined) {
        if (meta.hasStatus) {
          const wanted = new Set(
            flags.status
              .split(',')
              .map((s) => s.trim())
              .filter((s) => s.length > 0),
          );
          matched = matched.filter((r) => wanted.has(String(r.status ?? '')));
        } else {
          inert('--status', `${ledger} records have no status field`);
        }
      } else if (ledger === 'task') {
        // Owner's snapshot default: `list task` with no --status returns every
        // Task EXCEPT cancelled.
        matched = matched.filter((r) => String(r.status ?? '') !== 'cancelled');
      }

      // --since (ISO date; lexical compare works for zero-padded ISO 8601).
      if (flags.since !== undefined) {
        if (meta.dateField) {
          const since = flags.since;
          const field = meta.dateField;
          matched = matched.filter((r) => {
            const v = r[field];
            return typeof v === 'string' && v >= since;
          });
        } else {
          inert('--since', `${ledger} records have no date field`);
        }
      }

      // --theme (task.capability_theme; for roadmap, the theme's own id).
      if (flags.theme !== undefined) {
        if (meta.themeField) {
          const theme = flags.theme;
          const field = meta.themeField;
          matched = matched.filter((r) => String(r[field] ?? '') === theme);
        } else {
          inert('--theme', `${ledger} records have no theme field`);
        }
      }

      // --depends-on (records whose dependency array contains the id).
      if (flags.dependsOn !== undefined) {
        if (meta.dependsField) {
          const dep = flags.dependsOn;
          const field = meta.dependsField;
          matched = matched.filter((r) => {
            const deps = r[field];
            return Array.isArray(deps) && deps.map(String).includes(dep);
          });
        } else {
          inert('--depends-on', `${ledger} records have no dependency field`);
        }
      }

      // Always drop deprecated records (only retro carries the field today).
      matched = matched.filter((r) => r.deprecated !== true);

      // `total` is the count matching ALL filters — recency ordering and the
      // output cap below are DISPLAY limits, reported transparently as `shown`
      // vs `total` so the list never silently truncates.
      const total = matched.length;

      // --recent n: most-recent-first, take n. Recency key per kind:
      //   retro          → session number parsed from the S<digits> id
      //   task           → updatedAt (ISO string)
      //   roadmap/backlog → document order (last record = most recent)
      let ordered = matched;
      if (recent !== undefined) {
        const byRecencyDesc = [...matched];
        if (ledger === 'retro') {
          byRecencyDesc.sort(
            (a, b) =>
              Number(String(b.id ?? '').replace(/^S/, '')) -
              Number(String(a.id ?? '').replace(/^S/, '')),
          );
        } else if (ledger === 'task') {
          byRecencyDesc.sort((a, b) =>
            String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')),
          );
        } else {
          byRecencyDesc.reverse();
        }
        ordered = byRecencyDesc.slice(0, recent);
      }

      // Output cap: explicit --limit wins; else --recent already bounded it;
      // else a default bound so an unfiltered list never floods.
      const DEFAULT_CAP = 200;
      const cap =
        limit !== undefined
          ? limit
          : recent !== undefined
            ? ordered.length
            : DEFAULT_CAP;
      const rows = ordered.slice(0, cap);

      // Projection. --ids-only (bare id[]) overrides --fields; else --fields csv;
      // else the kind's default identity fields.
      const projFields = flags.idsOnly
        ? ['id']
        : flags.fields !== undefined
          ? flags.fields
              .split(',')
              .map((s) => s.trim())
              .filter((s) => s.length > 0)
          : meta.defaultFields;

      // S447 derived roll-up: `subtasks` renders `done/total` where done =
      // subtasks with status `done` OR `cancelled` (owner decision — a cancelled
      // subtask is closed, not outstanding). A record with no subtasks reads
      // `0/0`. Any other field projects the raw value.
      const projectField = (r: Record<string, unknown>, f: string): unknown => {
        if (f !== 'subtasks') return r[f];
        const subs = Array.isArray(r.subtasks)
          ? (r.subtasks as Record<string, unknown>[])
          : [];
        const done = subs.filter(
          (s) => s.status === 'done' || s.status === 'cancelled',
        ).length;
        return `${done}/${subs.length}`;
      };

      const projected = flags.idsOnly
        ? rows.map((r) => r.id)
        : rows.map((r) => {
            const out: Record<string, unknown> = {};
            for (const f of projFields) out[f] = projectField(r, f);
            return out;
          });

      const truncated = rows.length < total;
      if (truncated)
        warnings.push(
          `showing ${rows.length} of ${total} matched ${ledger} record(s) — pass --limit to raise the cap or add filters to narrow`,
        );

      return {
        ok: true,
        subcommand: 'list',
        result: {
          ledger,
          total,
          shown: rows.length,
          truncated,
          records: projected,
        },
        ...(warnings.length ? { warnings } : {}),
      };
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
      const patch: FieldPatch = {
        fieldPath: ['tasks', taskId, 'status'],
        newValue: status,
      };
      // CLI-side validation oracle (esc-4 retained): applyPatches re-validates
      // the mutated document and surfaces the schema-error/walk-error envelope
      // locally before the server write. The record-set + budget gates now run
      // server-side (R1b).
      const m = fieldPatchMutation('flip-task', loaded.detected, patch);
      if (!m.ok) return m.result;
      return commitMutation({
        subcommand: 'flip-task',
        path: ledgerPath(dir, 'task'),
        resultPayload: { taskId, status },
        dryRun: flags.dryRun,
        regenMirrors: !flags.noRegenMirrors,
        serverIntent: {
          kind: 'field-patch',
          slug: ledgerSlug('task'),
          recordId: taskId,
          patches: [patch],
        },
      });
    }

    // ── ID-35.20 task field editor (RESEARCH §4) ────────────────────────────
    case 'update-task': {
      const [taskId, field] = p;
      if (!taskId || !field)
        return cliErr(
          'update-task',
          'missing-args',
          'update-task <taskId> <field> <value | --file <path>>',
        );
      // S299 F7 — reject a shell-mis-parsed invocation (extra positionals)
      // instead of silently using only `p[2]` and dropping the rest. A long
      // multi-word value MUST come via `--file` (or be a single quoted arg).
      const arity = checkFieldEditArity('update-task', p, flags.file);
      if (!arity.ok) return arity.result;
      // S299 F7 — the value comes from `--file <path>` (- = stdin) OR the
      // positional, mirroring the record-creating commands. A missing file
      // exits non-zero (input-read-failed), never a silent no-op.
      const valueRes = readFieldValue('update-task', flags.file, p[2]);
      if (!valueRes.ok) return valueRes.result;
      const value = valueRes.raw;
      const loaded = await loadLedger(ledgerPath(dir, 'task'));
      if (!loaded.ok) return loaded.result;
      const newValue = coerceFieldValue('task', field, value);
      const patch: FieldPatch = {
        fieldPath: ['tasks', taskId, field],
        newValue,
      };
      // CLI-side validation oracle (esc-4 retained): applyPatches surfaces the
      // local schema-error/walk-error envelope; the server runs the record-set
      // + budget gates authoritatively (R1b).
      const m = fieldPatchMutation('update-task', loaded.detected, patch);
      if (!m.ok) return m.result;
      // S299 F5 — `flip-task` is the dedicated, canonical verb for setting a
      // Task status; `update-task <id> status <value>` is the equivalent
      // generic-editor path (the write is byte-identical). Both are kept
      // (back-compat), but a non-fatal hint nudges the operator to the canonical
      // verb so the redundancy stops inviting the wrong guess. The hint is a
      // soft warning (stderr), never a rejection — the edit still succeeds.
      // ID-90.22 R1b (AC-H1): threaded via `extraWarnings` so it survives on the
      // server path (the deleted LOCAL path was the sole threader pre-R1b).
      const statusHint =
        field === 'status'
          ? [
              `hint: \`flip-task ${taskId} ${value}\` is the canonical verb for ` +
                `setting a Task status (update-task status is the equivalent ` +
                `generic-editor path).`,
            ]
          : undefined;
      return commitMutation({
        subcommand: 'update-task',
        path: ledgerPath(dir, 'task'),
        resultPayload: { taskId, field },
        dryRun: flags.dryRun,
        regenMirrors: !flags.noRegenMirrors,
        force: flags.force,
        // S299 F5 — surface the flip-task canonical-verb hint (status field only).
        extraWarnings: statusHint,
        serverIntent: {
          kind: 'field-patch',
          slug: ledgerSlug('task'),
          recordId: taskId,
          patches: [patch],
        },
      });
    }

    case 'flip-subtask': {
      // ID-65.8 — canonical dotted `flip-subtask <taskId.subId> <status>`;
      // legacy space-separated `<taskId> <subId> <status>` still accepted. A
      // bare-digit taskId never contains '.', so `p[0].includes('.')` is an
      // unambiguous discriminator.
      let taskId: string;
      let subId: string;
      let status: string;
      if (p[0]?.includes('.')) {
        const parsed = parseDottedSubtaskId('flip-subtask', p[0]);
        if (!parsed.ok) return parsed.result;
        taskId = parsed.taskId;
        subId = parsed.subId;
        status = p[1];
      } else {
        [taskId, subId, status] = p;
      }
      if (!taskId || !subId || !status)
        return cliErr(
          'flip-subtask',
          'missing-args',
          'flip-subtask <taskId.subId> <status> (legacy: <taskId> <subId> <status>)',
        );
      const loaded = await loadLedger(ledgerPath(dir, 'task'));
      if (!loaded.ok) return loaded.result;
      const patch: FieldPatch = {
        fieldPath: ['tasks', taskId, 'subtasks', subId, 'status'],
        newValue: status,
      };
      // CLI-side validation oracle (esc-4 retained); record-set gate server-side.
      const m = fieldPatchMutation('flip-subtask', loaded.detected, patch);
      if (!m.ok) return m.result;
      return commitMutation({
        subcommand: 'flip-subtask',
        path: ledgerPath(dir, 'task'),
        resultPayload: { taskId, subId, status },
        dryRun: flags.dryRun,
        regenMirrors: !flags.noRegenMirrors,
        serverIntent: {
          kind: 'field-patch',
          slug: ledgerSlug('task'),
          recordId: taskId,
          patches: [patch],
        },
      });
    }

    // ── ID-35.19 subtask field editor (RESEARCH §2.1) ───────────────────────
    case 'update-subtask': {
      const [dottedId, field] = p;
      if (!dottedId || !field)
        return cliErr(
          'update-subtask',
          'missing-args',
          'update-subtask <taskId.subId> <field> <value | --file <path>>',
        );
      // S299 F7 — reject a shell-mis-parsed invocation (extra positionals). The
      // dotted `taskId.subId` is a SINGLE positional, so the 2/3 arity matches
      // the other field editors.
      const arity = checkFieldEditArity('update-subtask', p, flags.file);
      if (!arity.ok) return arity.result;
      // ID-65.8 — dotted id parse + bad-id guard factored into the shared
      // helper (no behaviour change — update-subtask was already dotted).
      const parsed = parseDottedSubtaskId('update-subtask', dottedId);
      if (!parsed.ok) return parsed.result;
      const { taskId, subId } = parsed;
      // S299 F7 — resolve the value from --file/stdin or the positional, so a
      // large subtask description/testStrategy body need not be inlined.
      const valueRes = readFieldValue('update-subtask', flags.file, p[2]);
      if (!valueRes.ok) return valueRes.result;
      const value = valueRes.raw;
      const loaded = await loadLedger(ledgerPath(dir, 'task'));
      if (!loaded.ok) return loaded.result;
      // ID-35.21 field-type-aware coercion (drives parse by SubtaskSchema field
      // type — dependencies → string[] post ID-102, description stays a string).
      // `coerceFieldValue` is schema-driven and self-corrects at the flag-day
      // when SubtaskSchema.dependencies flips to string[].
      const newValue = coerceFieldValue('subtask', field, value);
      const patch: FieldPatch = {
        fieldPath: ['tasks', taskId, 'subtasks', String(subId), field],
        newValue,
      };
      // CLI-side validation oracle (esc-4 retained); the budget pre-check +
      // record-set gate now run server-side (R1b). `--force` still threads
      // through so the server downgrades budget-exceeded to a soft warning.
      const m = fieldPatchMutation('update-subtask', loaded.detected, patch);
      if (!m.ok) return m.result;
      return commitMutation({
        subcommand: 'update-subtask',
        path: ledgerPath(dir, 'task'),
        resultPayload: { taskId, subId, field },
        dryRun: flags.dryRun,
        regenMirrors: !flags.noRegenMirrors,
        force: flags.force,
        serverIntent: {
          kind: 'field-patch',
          slug: ledgerSlug('task'),
          recordId: taskId,
          patches: [patch],
        },
      });
    }

    case 'append-journal': {
      // ID-65.8 — canonical dotted `append-journal <taskId.subId> <text>`;
      // legacy space-separated `<taskId> <subId> <text>` still accepted. A
      // bare-digit taskId never contains '.', so `p[0].includes('.')` is an
      // unambiguous discriminator (dotted → text = p[1]; legacy → text = p[2]).
      let taskId: string;
      let subId: string;
      let text: string;
      if (p[0]?.includes('.')) {
        const parsed = parseDottedSubtaskId('append-journal', p[0]);
        if (!parsed.ok) return parsed.result;
        taskId = parsed.taskId;
        subId = parsed.subId;
        text = p[1];
      } else {
        [taskId, subId, text] = p;
      }
      if (!taskId || !subId || text == null)
        return cliErr(
          'append-journal',
          'missing-args',
          'append-journal <taskId.subId> <text> (legacy: <taskId> <subId> <text>)',
        );
      const loaded = await loadLedger(ledgerPath(dir, 'task'));
      if (!loaded.ok) return loaded.result;
      if (loaded.detected.kind !== 'task-list')
        return cliErr('append-journal', 'wrong-ledger', 'expected task-list');
      const task = loaded.detected.data.tasks.find((t) => t.id === taskId);
      // ID-102: subtask ids are digit-strings; compare string-vs-string (the
      // parsed/legacy subId is already a string, no Number() cast).
      const sub = task?.subtasks.find((s) => s.id === subId);
      if (!sub)
        return cliErr(
          'append-journal',
          'record-not-found',
          `subtask ${taskId}.${subId}`,
        );
      const existing = sub.details ?? '';
      const next = existing
        ? `${existing}\n\n${journalBlock(text)}`
        : journalBlock(text);
      const patch: FieldPatch = {
        fieldPath: ['tasks', taskId, 'subtasks', subId, 'details'],
        newValue: next,
      };
      // CLI-side validation oracle (esc-4 retained); record-set gate server-side.
      const m = fieldPatchMutation('append-journal', loaded.detected, patch);
      if (!m.ok) return m.result;
      return commitMutation({
        subcommand: 'append-journal',
        path: ledgerPath(dir, 'task'),
        resultPayload: { taskId, subId, appended: true },
        dryRun: flags.dryRun,
        regenMirrors: !flags.noRegenMirrors,
        serverIntent: {
          kind: 'field-patch',
          slug: ledgerSlug('task'),
          recordId: taskId,
          patches: [patch],
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
      // ID-35.21 auto-id: subtask ids are digit-STRINGS (ID-102), scoped to the
      // parent task. Inject max+1 unless the body carried an id (explicit) — the
      // coercion helper preserves any supplied id and leaves a missing one absent.
      if (record.id === undefined) {
        record = { ...record, id: nextId(loaded.detected, 'subtasks', taskId) };
      }
      const nextSubtasks = [...task.subtasks, record];
      // CLI-side validation oracle (esc-4 retained): Zod-validates the merged
      // subtasks[] and surfaces the local schema-error envelope. The record-set
      // (drop/duplicate) + budget gates run server-side (R1b).
      const m = fieldPatchMutation('add-subtask', loaded.detected, {
        fieldPath: ['tasks', taskId, 'subtasks'],
        newValue: nextSubtasks,
      });
      if (!m.ok) return m.result;
      // Derive the new subtask id from the VALIDATED post-mutation record (the
      // last subtask of the addressed task in the re-parsed document), not the
      // pre-validation `record.id`. `SubtaskSchema.id` is required, so a
      // missing/ill-typed id fails the mutation above and never reaches here.
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
        resultPayload: {
          taskId,
          subId: newSubId,
          subtaskCount: nextSubtasks.length,
        },
        dryRun: flags.dryRun,
        regenMirrors: !flags.noRegenMirrors,
        force: flags.force,
        serverIntent: {
          kind: 'subtask-create',
          slug: ledgerSlug('task'),
          taskId,
          subtasks: [record],
        },
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
      // it (after string coercion) and do NOT consume a counter slot.
      // ID-102: nextId now returns a digit-STRING, so coerce it back to a NUMBER
      // for the arithmetic counter (a string `counter += 1` would concatenate —
      // `'5' + 1 === '51'` — corrupting every bulk-allocated id, inv 8); the
      // stamp below re-`String()`s the counter so the STORED id is a digit-string.
      let counter = Number(nextId(loaded.detected, 'subtasks', taskId));
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
          // ID-102: stamp the digit-string id; keep the numeric increment.
          record = { ...record, id: String(counter) };
          counter += 1;
        }
        coercedRecords.push(record);
      }
      // ID-90.22 R1b: per-record budget enforcement moved server-side — the
      // server's subtask-create handler runs `checkBudgetForCreate` per record
      // atomically (rejects the whole batch on any over-budget record, honours
      // `--force`, surfaces forced/soft warnings; same `subtask <parent>.<id>`
      // label — patch-server.ts §handlePostSubtasks). The client-side
      // `checkBudget` loop is removed with the rest of the gate machinery.
      // Validate the FULL batch via the CLI-side schema oracle (esc-4 retained)
      // on the merged subtasks[] BEFORE the server write (mirrors add-subtask's
      // fieldPatchMutation), surfacing the local schema-error envelope.
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
      return commitMutation({
        subcommand: 'add-subtasks',
        path: ledgerPath(dir, 'task'),
        resultPayload: {
          taskId,
          subIds: newSubIds,
          added: coercedRecords.length,
          subtaskCount: nextSubtasks.length,
        },
        dryRun: flags.dryRun,
        regenMirrors: !flags.noRegenMirrors,
        force: flags.force,
        serverIntent: {
          kind: 'subtask-create',
          slug: ledgerSlug('task'),
          taskId,
          subtasks: coercedRecords,
        },
      });
    }

    // ── backlog field edit ───────────────────────────────────────────────────
    case 'update-backlog': {
      const [itemId, field] = p;
      if (!itemId || !field)
        return cliErr(
          'update-backlog',
          'missing-args',
          'update-backlog <itemId> <field> <value | --file <path>>',
        );
      // S299 F7 — reject a shell-mis-parsed invocation (extra positionals).
      const arity = checkFieldEditArity('update-backlog', p, flags.file);
      if (!arity.ok) return arity.result;
      // S299 F7 — resolve the value from --file/stdin or the positional, so a
      // large notes/description body need not be inlined.
      const valueRes = readFieldValue('update-backlog', flags.file, p[2]);
      if (!valueRes.ok) return valueRes.result;
      const value = valueRes.raw;
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
      // CLI-side validation oracle (esc-4 retained); budget + record-set gates
      // run server-side (R1b). `--force` still threads through for budget.
      const m = fieldPatchMutation('update-backlog', loaded.detected, patch);
      if (!m.ok) return m.result;
      return commitMutation({
        subcommand: 'update-backlog',
        path: ledgerPath(dir, 'backlog'),
        resultPayload: { itemId, field },
        dryRun: flags.dryRun,
        regenMirrors: !flags.noRegenMirrors,
        force: flags.force,
        serverIntent: {
          kind: 'field-patch',
          slug: ledgerSlug('backlog'),
          recordId: itemId,
          patches: [patch],
        },
      });
    }

    // ── ID-35.20 roadmap field editor (RESEARCH §4 — no editor existed) ──────
    case 'update-roadmap': {
      const [themeId, field] = p;
      if (!themeId || !field)
        return cliErr(
          'update-roadmap',
          'missing-args',
          'update-roadmap <themeId> <field> <value | --file <path>>',
        );
      // S299 F7 — reject a shell-mis-parsed invocation (extra positionals).
      const arity = checkFieldEditArity('update-roadmap', p, flags.file);
      if (!arity.ok) return arity.result;
      // S299 F7 — resolve the value from --file/stdin or the positional.
      const valueRes = readFieldValue('update-roadmap', flags.file, p[2]);
      if (!valueRes.ok) return valueRes.result;
      const value = valueRes.raw;
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
      // CLI-side validation oracle (esc-4 retained); budget + record-set gates
      // run server-side (R1b). `--force` still threads through for budget.
      const m = fieldPatchMutation('update-roadmap', loaded.detected, patch);
      if (!m.ok) return m.result;
      return commitMutation({
        subcommand: 'update-roadmap',
        path: ledgerPath(dir, 'roadmap'),
        resultPayload: { themeId, field },
        dryRun: flags.dryRun,
        regenMirrors: !flags.noRegenMirrors,
        force: flags.force,
        serverIntent: {
          kind: 'field-patch',
          slug: ledgerSlug('roadmap'),
          recordId: themeId,
          patches: [patch],
        },
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
            expected: describeExpectedShape(ins.zodError),
          };
        if (ins.kind === 'duplicate-id')
          return cliErr(subcommand, 'duplicate-id', ins.recordId);
        return cliErr(
          subcommand,
          ins.kind,
          'detail' in ins ? ins.detail : undefined,
        );
      }
      // insertRecord above is the CLI-side schema + duplicate-id oracle (esc-4
      // retained); the record-set + budget gates run server-side (R1b).
      return commitMutation({
        subcommand,
        path: ledgerPath(dir, ledger),
        resultPayload: { recordId: ins.recordId },
        dryRun: flags.dryRun,
        regenMirrors: !flags.noRegenMirrors,
        force: flags.force,
        serverIntent: {
          kind: 'record-create',
          slug: ledgerSlug(ledger),
          record,
        },
      });
    }

    // ── WS-C C2: retro record CREATE ─────────────────────────────────────────
    // Mirrors `create-backlog`/`open-task`/`create-theme` but for the session
    // retro ledger. KEY DIFFERENCE: retro ids are caller-supplied session ids
    // (`S<n>`, e.g. "S264") — there is NO auto-allocation / nextId / high-water
    // mark for retros. A create that omits `id` is a client error. Retros carry
    // NO .md mirror yet, so mirror regen is skipped.
    case 'create-retro': {
      const loaded = await loadLedger(ledgerPath(dir, 'retro'));
      if (!loaded.ok) return loaded.result;
      // {35.15} record-input resolution (positional JSON | --file | named flags)
      // + structural defaults. NO auto-id — the body MUST carry the session id.
      const input = readRecordInput(args);
      if (!input.ok) return input.result;
      const record = withCreateDefaults(
        'retro',
        input.value as Record<string, unknown>,
      );
      if (record.id === undefined) {
        return cliErr(
          'create-retro',
          'missing-id',
          'retro records require a caller-supplied session id of the form S<digits> (e.g. "S264") — retros are not auto-allocated. Supply it in the record body (`{"id":"S264",…}`) or via --id.',
        );
      }
      const ins = insertRecord(loaded.detected, record);
      if (!ins.ok) {
        if (ins.kind === 'schema-error')
          return {
            ok: false,
            subcommand,
            error: 'schema-error',
            issues: ins.zodError.issues,
            expected: describeExpectedShape(ins.zodError),
          };
        if (ins.kind === 'duplicate-id')
          return cliErr(subcommand, 'duplicate-id', ins.recordId);
        return cliErr(
          subcommand,
          ins.kind,
          'detail' in ins ? ins.detail : undefined,
        );
      }
      // insertRecord above is the CLI-side schema + duplicate-id oracle (esc-4
      // retained); the record-set + budget gates run server-side (R1b). Retros
      // have no mirror obligation → regenMirrors:false.
      return commitMutation({
        subcommand,
        path: ledgerPath(dir, 'retro'),
        resultPayload: { recordId: ins.recordId },
        dryRun: flags.dryRun,
        regenMirrors: false,
        force: flags.force,
        serverIntent: {
          kind: 'record-create',
          slug: ledgerSlug('retro'),
          record,
        },
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
      // removeRecord is the CLI-side schema + record-not-found oracle (esc-4
      // retained); the record-set drop-guard runs server-side (R1b).
      const rem = removeRecord(loaded.detected, itemId);
      if (!rem.ok) {
        if (rem.kind === 'schema-error')
          return {
            ok: false,
            subcommand: 'delete-backlog',
            error: 'schema-error',
            issues: rem.zodError.issues,
            expected: describeExpectedShape(rem.zodError),
          };
        if (rem.kind === 'record-not-found')
          return cliErr('delete-backlog', 'record-not-found', rem.recordId);
        return cliErr('delete-backlog', rem.kind);
      }
      return commitMutation({
        subcommand: 'delete-backlog',
        path: ledgerPath(dir, 'backlog'),
        resultPayload: { recordId: rem.recordId },
        dryRun: flags.dryRun,
        regenMirrors: !flags.noRegenMirrors,
        serverIntent: {
          kind: 'record-delete',
          slug: ledgerSlug('backlog'),
          recordId: itemId,
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
      // ID-65.8 — canonical dotted `delete-subtask <taskId.subId>`; legacy
      // space-separated `<taskId> <subId>` still accepted. A bare-digit taskId
      // never contains '.', so `p[0].includes('.')` is an unambiguous
      // discriminator. The dotted subId is a string, like the legacy positional;
      // ID-102 validates it positive-integer but addresses the record with the
      // STRING (subtask ids are digit-strings — no number cast carried forward).
      let taskId: string;
      let subIdRaw: string;
      if (p[0]?.includes('.')) {
        const parsed = parseDottedSubtaskId('delete-subtask', p[0]);
        if (!parsed.ok) return parsed.result;
        taskId = parsed.taskId;
        subIdRaw = parsed.subId;
      } else {
        [taskId, subIdRaw] = p;
      }
      if (!taskId || subIdRaw == null)
        return cliErr(
          'delete-subtask',
          'missing-args',
          'delete-subtask <taskId.subId> (legacy: <taskId> <subId>)',
        );
      const loaded = await loadLedger(ledgerPath(dir, 'task'));
      if (!loaded.ok) return loaded.result;
      if (loaded.detected.kind !== 'task-list')
        return cliErr('delete-subtask', 'wrong-ledger', 'expected task-list');
      const task = loaded.detected.data.tasks.find((t) => t.id === taskId);
      if (!task)
        return cliErr('delete-subtask', 'record-not-found', `task ${taskId}`);
      // ID-35.43 subId validation: positionals arrive as strings, and
      // `SubtaskSchema.id` is a digit-STRING (ID-102). Validate the positive
      // integer (`Number(subIdRaw) > 0`) but bind the validated STRING for all
      // downstream use — the stored id is a digit-string, so address it with the
      // string verbatim (no number cast). Anything else (or a non-positive
      // integer) is rejected with a structured `invalid-id` envelope rather than
      // a confusing record-not-found.
      const n = Number(subIdRaw);
      if (!Number.isInteger(n) || n <= 0 || subIdRaw.trim() === '') {
        return cliErr(
          'delete-subtask',
          'invalid-id',
          `subId ${JSON.stringify(subIdRaw)} is not a positive integer; subtask.id must be a string of digits`,
        );
      }
      const subId = subIdRaw;
      const subtask = task.subtasks.find((s) => s.id === subId);
      if (!subtask)
        return cliErr(
          'delete-subtask',
          'record-not-found',
          `subtask ${taskId}.${subId}`,
        );
      // Removing the last subtask leaves `subtasks: []` — TaskSchema.subtasks
      // is `z.array(SubtaskSchema)` with no `.min(1)`, so an empty array is a
      // legal atomic-Task state (see task-list-schema.ts inv 5).
      const nextSubtasks = task.subtasks.filter((s) => s.id !== subId);
      // CLI-side validation oracle (esc-4 retained); the record-set drop-guard
      // runs server-side (R1b).
      const m = fieldPatchMutation('delete-subtask', loaded.detected, {
        fieldPath: ['tasks', taskId, 'subtasks'],
        newValue: nextSubtasks,
      });
      if (!m.ok) return m.result;
      return commitMutation({
        subcommand: 'delete-subtask',
        path: ledgerPath(dir, 'task'),
        resultPayload: {
          taskId,
          subId,
          subtaskCount: nextSubtasks.length,
        },
        dryRun: flags.dryRun,
        regenMirrors: !flags.noRegenMirrors,
        serverIntent: {
          kind: 'subtask-delete',
          slug: ledgerSlug('task'),
          taskId,
          // ID-102: STRING subId — this is the server-intent contract {102.7}
          // consumes (task-view scoped-serialise record-splice filters
          // `rec.id !== op.recordId` string-vs-string post-flip).
          subId,
        },
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
): Promise<CliResult> {
  // ID-90.22 R1b: the `--whole-file` / `scoped` opt-out is gone — promote now
  // always routes through the server transaction (no client-side serialise
  // path remains to opt out of). The flag still parses (argv unchanged, inv 8)
  // but no longer changes the write path.
  const taskListP = ledgerPath(dir, 'task');
  const backlogP = ledgerPath(dir, 'backlog');
  const roadmapP = ledgerPath(dir, 'roadmap');

  // Phase 1: validate everything (no bytes touched). ID-65.7 — the body is
  // already resolved + JSON-parsed by the dispatch via `readRecordInput`; no
  // `parseJsonArg` call here anymore. `taskRecord` is the parsed value.

  // S299 friction F1 — promote AUTO-FILLS the optional Task fields the caller
  // would otherwise have to supply by hand, reaching parity with `open-task`
  // (which already runs `withCreateDefaults` via the create-record arm). When
  // the body is a JSON object we merge the structural defaults UNDER it
  // (nullable→null: owner/priority_note/status_note; array→[]: cross_doc_links/
  // session_refs/commit_refs; status/dependencies/subtasks/effort_estimate) AND
  // auto-stamp `updatedAt` (the ISO timestamp `withCreateDefaults` injects when
  // absent), so the caller supplies only the meaningful fields
  // (id/title/description/status/priority/dependencies + optional
  // effort_estimate). Supplied fields ALWAYS win (defaults fill absent keys
  // only), so a COMPLETE body round-trips byte-for-byte verbatim — the
  // promote-input parity test asserts this. Unlike `open-task`, promote does NOT
  // auto-id (its contract: `task.id` comes from the body); a missing id still
  // fails the insertRecord Zod gate. A non-object body (positional JSON that is
  // an array/scalar) is left untouched so insertRecord's parse surfaces the same
  // schema-error as before (back-compat).
  if (
    taskRecord !== null &&
    typeof taskRecord === 'object' &&
    !Array.isArray(taskRecord)
  ) {
    taskRecord = withCreateDefaults(
      'task',
      taskRecord as Record<string, unknown>,
    );
  }

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

  // ID-90.22 R1b: the record-set gates run server-side now (the
  // beforeCollectionIds capture + checkRecordSet calls were deleted). The
  // insertRecord/removeRecord oracle below stays as the CLI-side schema +
  // duplicate-id + record-not-found gate (esc-4 retained).
  const ins = insertRecord(tlLoad.detected, taskRecord);
  if (!ins.ok) {
    if (ins.kind === 'schema-error')
      return {
        ok: false,
        subcommand: 'promote',
        error: 'schema-error',
        issues: ins.zodError.issues,
        expected: describeExpectedShape(ins.zodError),
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
        expected: describeExpectedShape(rem.zodError),
      };
    if (rem.kind === 'record-not-found')
      return cliErr('promote', 'backlog-item-not-found', backlogId);
    return cliErr('promote', rem.kind);
  }

  // ID-90.22 R1b (invariant 49 / K4-deferred): the cross-ledger write now
  // routes through POST /api/ledger/transaction. The CLI-side validation
  // oracle ABOVE (withCreateDefaults, capability-theme patch, theme-exists
  // check, insertRecord/removeRecord — esc-4 retained modules) surfaces the
  // local schema-error / duplicate-id / backlog-item-not-found / unknown-theme
  // envelopes BEFORE any server call; the server's `promoteTransaction`
  // re-validates, runs the record-set + budget gates, applies the roadmap
  // linked_tasks[] back-link (idempotent), stages + commits every leg
  // atomically under the per-path mutation mutex, and regenerates mirrors. The
  // staged-write + scoped-serialise + gate machinery is gone (deleted in R1b).
  //
  // `resultPayload` mirrors the pre-R1b flip-OFF success shape
  // (`{newTaskId, removedBacklogId, [boundCapabilityTheme]}`) so the envelope
  // is byte-identical; `serverCommitMutation` tags it `{dryRun:true,...}` on a
  // dry-run (the server honours dryRun and writes nothing). Forced budget
  // warnings + discipline warnings are now emitted by the server's warnings[]
  // envelope (invariant 41). `--force` threads through as a per-request option.
  const resultPayload = {
    newTaskId: ins.recordId,
    removedBacklogId: rem.recordId,
    ...(capabilityTheme !== undefined
      ? { boundCapabilityTheme: capabilityTheme }
      : {}),
  };

  return commitMutation({
    subcommand: 'promote',
    path: taskListP,
    resultPayload,
    dryRun,
    regenMirrors,
    force,
    serverIntent: {
      kind: 'transaction',
      sourceBacklogId: backlogId,
      taskRecord,
      backlogPath: backlogP,
      ...(capabilityTheme !== undefined
        ? { capabilityThemeId: capabilityTheme, roadmapPath: roadmapP }
        : {}),
    },
  });
}

// ── ID-35.41 update-umbrella ──────────────────────────────────────────────────
//
// `docs/reference/umbrellas.json` membership edits (task_ids[]). ID-90.22 R1b:
// the CLI now validates the op-flags locally (the rejection envelopes below)
// and routes the membership change through the server as a field PATCH on
// ['umbrellas', umbrellaId, 'task_ids'] (PRODUCT inv 49-50 / K4-deferred). The
// self-contained read-mutate-write (`serialiseUmbrellas` + `atomicWriteFile`)
// and the in-process `checkUmbrellaRecordSet` gate were deleted in R1b — the
// server owns serialisation + the record-set gate. umbrellas.json carries no
// per-record mirror (PRODUCT inv 53), so no regen runs.

const UMBRELLAS_FILE = 'umbrellas.json';

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
      expected: describeExpectedShape(parsed.error),
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

  // Capture pre-write state. ID-90.22 R1b: the umbrella-id-set + task_ids
  // set-equality record-set gate runs server-side now; the CLI keeps only the
  // before-state needed for the reorder permutation check + the delta payload.
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

  const deltaPayload = {
    umbrellaId,
    added,
    removed,
    reordered: hasReorder,
    before: beforeTaskIds,
    after: nextTaskIds,
  };

  // ID-90.22 R1b (invariant 49 / K4-deferred): the umbrella membership edit is
  // a field PATCH on ['umbrellas', umbrellaId, 'task_ids'] routed through the
  // server (PRODUCT inv 49-50). The CLI-side op-flag validation ABOVE
  // (conflicting-ops / malformed-task-id / unknown-umbrella / missing-args /
  // reorder-not-permutation) produces the local rejection envelopes unchanged;
  // the server re-validates, runs the record-set gate (umbrella id-set
  // unchanged + edited task_ids set-equality), and writes atomically under the
  // mutation mutex. `serialiseUmbrellas` + the in-process read-mutate-write +
  // `checkUmbrellaRecordSet` are deleted in R1b.
  //
  // No-op discipline ({35.16}/{35.44}): a same-membership-and-order edit yields
  // an unchanged task_ids[] — detected CLI-side here (order-sensitive equality)
  // so the operator gets the `noop: true` envelope and NO redundant server
  // write, matching the pre-R1b byte-identical-content short-circuit.
  const isNoop =
    nextTaskIds.length === beforeTaskIds.length &&
    nextTaskIds.every((id, i) => id === beforeTaskIds[i]);
  if (isNoop && !dryRun) {
    return {
      ok: true,
      subcommand: SUB,
      result: { ...deltaPayload, noop: true },
    };
  }

  // `resultPayload` mirrors the pre-R1b flip-OFF success shape (`deltaPayload`)
  // so the envelope is byte-identical; `serverCommitMutation` tags it
  // `{dryRun:true,...}` on a dry-run (the server honours dryRun, writes nothing).
  return commitMutation({
    subcommand: SUB,
    path,
    resultPayload: deltaPayload,
    dryRun,
    // umbrellas carry no mirror obligation (PRODUCT inv 53) — pass true so no
    // `regenMirrors:false` body field is emitted (the server skips regen for
    // umbrellas regardless).
    regenMirrors: true,
    serverIntent: {
      kind: 'umbrella-patch',
      umbrellaId,
      patches: [
        {
          fieldPath: ['umbrellas', umbrellaId, 'task_ids'],
          newValue: nextTaskIds,
        },
      ],
    },
  });
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
  run,
  journalBlock,
  ledgerPath,
  LEDGER_FILES,
  renderSchema,
  subcommandHelp,
};
export type { CliResult, MirrorStaleReason, ParsedArgs };
