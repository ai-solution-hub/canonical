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
 * (flip-task | flip-subtask | append-journal). Instead of re-emitting the whole
 * Zod-reparsed document (which normalises key order AND emits raw UTF-8, turning a
 * one-field edit into a ~1600-line diff that collides with sibling cmux writers),
 * scoped mode mutates the JSON.parse of the ORIGINAL on-disk text in place and
 * escape-serialises it (lib/ledger/scoped-serialise.ts) — every untouched record
 * stays byte-for-byte identical, on-disk \\uXXXX escaping preserved. Zod still
 * validates the mutated document before any byte is written. The non-scoped path
 * keeps the existing whole-file serialise() unchanged.
 */

import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { renameSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { ZodError } from 'zod';

import {
  detectSchema,
  type DetectSchemaResult,
} from '@/lib/ledger/detect-schema';
import { applyPatches, type FieldPatch } from '@/lib/ledger/patch-apply';
import { scopedSerialise } from '@/lib/ledger/scoped-serialise';
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
    ledgerDir: string;
  };
}

function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags = {
    dryRun: false,
    pretty: false,
    regenMirrors: false,
    scoped: false,
    ledgerDir: 'docs/reference',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') flags.dryRun = true;
    else if (a === '--pretty') flags.pretty = true;
    else if (a === '--regen-mirrors') flags.regenMirrors = true;
    else if (a === '--scoped') flags.scoped = true;
    else if (a === '--ledger-dir') {
      flags.ledgerDir = argv[++i] ?? flags.ledgerDir;
    } else if (a.startsWith('--')) {
      // unknown flag — ignored (positional parsing is strict instead)
    } else positionals.push(a);
  }
  return { subcommand: positionals.shift(), positionals, flags };
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
             flip-task | flip-subtask | append-journal).`;

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
 * Whole-file serialiser. NON-CONFORMING on two axes vs the on-disk ledger
 * convention (ID-35.11 finding):
 *   1. Key order — `detected.data` is the Zod-reparsed document, so its records
 *      come back in schema-declared key order, normalising EVERY record.
 *   2. Escaping — plain `JSON.stringify` emits raw UTF-8, whereas the on-disk
 *      ledgers escape all non-ASCII to `\uXXXX`.
 * Either defect alone turns a one-field edit into a ~1600-line diff. The
 * field-edit subcommands therefore prefer the `--scoped` path
 * (lib/ledger/scoped-serialise.ts) during the parallel-cmux phase. A one-time
 * whole-file key-order + escaping normalisation pass that makes THIS function
 * conforming is DEFERRED to the CLI-becomes-sole-writer transition
 * (docs/specs/ledger-cli/PLAN.md {35.11}); running it now would collide with the
 * concurrent sibling writers of the shared task-list.json.
 */
function serialise(detected: KnownDetected): string {
  return `${JSON.stringify(detected.data, null, 2)}\n`;
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function cliErr(subcommand: string, error: string, detail?: string): CliResult {
  return { ok: false, subcommand, error, detail };
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
  const args = parseArgs(process.argv.slice(2));
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

export { parseArgs, run, journalBlock, ledgerPath, LEDGER_FILES };
export type { CliResult, ParsedArgs };
