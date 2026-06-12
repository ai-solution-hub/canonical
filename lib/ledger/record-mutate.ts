/**
 * VENDORED from task-view @ v0.5.0-task-view (packages/server/record-mutate.ts).
 * Body byte-faithful; only schema import specifiers rewired
 * `@task-view/schemas/*` → `@/lib/validation/*`. Re-vendor per
 * lib/ledger/README.md. Guarded by task-view-vendor-drift.yml (ID-35.10).
 * ID-102.8: the v0.5.0 string-id delta touches the subtask-level allocators
 * (nextId / insertSubtasks / removeSubtask) which are NOT part of the retained
 * KH oracle subset — insertRecord / removeRecord operate on top-level record
 * ids (already strings), so this module needs no body change (pin bump only).
 *
 * ROLE (ID-90.22 R1b/R2): CLI-side validation oracle. `scripts/ledger-cli.ts`'s
 * create / delete / promote handlers call `insertRecord` / `removeRecord` as
 * the duplicate-id + record-not-found + schema oracle, surfacing those local
 * envelopes before the server-routed write. RETAINED (esc-4) when R2 deleted
 * the write-side primitives; DISPOSITION rides {68.30}.
 *
 * ── original header ──────────────────────────────────────────────────────────
 * record-mutate.ts — ID-20.15 record-level CREATE / DELETE primitives.
 *
 * Sibling to `patch-apply.ts` (FIELD-level edits). This module handles
 * WHOLE-record mutations:
 *   - `insertRecord` — append a new record (Task / roadmap theme / backlog
 *     item) to the matching collection, then re-parse the whole ledger via
 *     the Zod schema. Duplicate id is rejected.
 *   - `removeRecord` — drop a record by id, then re-parse. Absent id is a
 *     not-found result.
 *
 * Both follow the same all-or-nothing discipline as `applyPatches`: mutate a
 * single in-memory snapshot, run ONE Zod parse, surface a discriminated-union
 * result. The caller owns serialise + atomic-write + mirror regen.
 *
 * Per-kind collection key:
 *   - task-list → `tasks[]`,  id is a bare-digit STRING (e.g. "42")
 *   - roadmap   → `themes[]`, id is a bare-digit STRING
 *   - backlog   → `items[]`,  id is a bare-digit STRING
 */

import {
  TaskListSchema,
  type TaskList,
} from '@/lib/validation/task-list-schema';
import { RoadmapSchema, type Roadmap } from '@/lib/validation/roadmap-schema';
import {
  BacklogSchema,
  type BacklogDocument,
} from '@/lib/validation/backlog-schema';
import {
  RetrosSchema,
  type RetrosDocument,
} from '@/lib/validation/retro-schema';
import { ZodError } from 'zod';

import type { DetectSchemaResult } from './detect-schema';

type KnownDetected = Exclude<DetectSchemaResult, { kind: 'unknown' }>;

/**
 * Result of a record-level mutation.
 */
export type RecordMutateResult =
  | { ok: true; detected: KnownDetected; recordId: string }
  | { ok: false; kind: 'duplicate-id'; recordId: string }
  | { ok: false; kind: 'record-not-found'; recordId: string }
  | { ok: false; kind: 'schema-error'; zodError: ZodError }
  | { ok: false; kind: 'invalid-body'; detail: string };

// ── id extraction ─────────────────────────────────────────────────────────────

/**
 * Pull the `id` field off an arbitrary record body. Used to detect
 * duplicates BEFORE the schema parse. Returns null when the body is not an
 * object or has no string/number id.
 */
function extractId(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const id = (body as { id?: unknown }).id;
  if (typeof id === 'string') return id;
  if (typeof id === 'number' && Number.isFinite(id)) return String(id);
  return null;
}

/** Top-level record-collection key for a detected ledger kind. WS-C C2 adds
 * the `retro` arm (`retros`). */
function collectionKeyFor(kind: KnownDetected['kind']): string {
  if (kind === 'task-list') return 'tasks';
  if (kind === 'roadmap') return 'themes';
  if (kind === 'retro') return 'retros';
  return 'items';
}

function existingIds(detected: KnownDetected): Set<string> {
  if (detected.kind === 'task-list') {
    return new Set(detected.data.tasks.map((t) => t.id));
  }
  if (detected.kind === 'roadmap') {
    return new Set(detected.data.themes.map((t) => t.id));
  }
  // WS-C C2: retros — session-id (`S<n>`) record ids.
  if (detected.kind === 'retro') {
    return new Set(detected.data.retros.map((r) => r.id));
  }
  return new Set(detected.data.items.map((it) => it.id));
}

// ── re-parse helper ─────────────────────────────────────────────────────────

function reparse(
  kind: KnownDetected['kind'],
  raw: unknown,
):
  | { ok: true; data: TaskList | Roadmap | BacklogDocument | RetrosDocument }
  | { ok: false; zodError: ZodError } {
  try {
    if (kind === 'task-list')
      return { ok: true, data: TaskListSchema.parse(raw) };
    if (kind === 'roadmap') return { ok: true, data: RoadmapSchema.parse(raw) };
    // WS-C C2: retros — session retro ledger.
    if (kind === 'retro') return { ok: true, data: RetrosSchema.parse(raw) };
    return { ok: true, data: BacklogSchema.parse(raw) };
  } catch (err) {
    if (err instanceof ZodError) return { ok: false, zodError: err };
    throw err;
  }
}

function rebuildDetected(
  kind: KnownDetected['kind'],
  data: TaskList | Roadmap | BacklogDocument | RetrosDocument,
): KnownDetected {
  if (kind === 'task-list')
    return { kind: 'task-list', data: data as TaskList };
  if (kind === 'roadmap') return { kind: 'roadmap', data: data as Roadmap };
  // WS-C C2: retros — session retro ledger.
  if (kind === 'retro') return { kind: 'retro', data: data as RetrosDocument };
  return { kind: 'backlog', data: data as BacklogDocument };
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Insert a new record into the detected ledger. Clones the raw data, appends
 * the record, then re-parses the WHOLE document so document-level invariants
 * (unique-id / sibling-dep superRefines) run. Duplicate id is rejected before
 * the parse.
 */
export function insertRecord(
  detected: KnownDetected,
  record: unknown,
): RecordMutateResult {
  const newId = extractId(record);
  if (newId === null) {
    return {
      ok: false,
      kind: 'invalid-body',
      detail:
        'Record body must be an object carrying a string or numeric `id` field.',
    };
  }
  if (existingIds(detected).has(newId)) {
    return { ok: false, kind: 'duplicate-id', recordId: newId };
  }

  const rawClone = structuredClone(detected.data) as Record<string, unknown>;
  const collectionKey = collectionKeyFor(detected.kind);
  const collection = rawClone[collectionKey];
  if (!Array.isArray(collection)) {
    return {
      ok: false,
      kind: 'invalid-body',
      detail: `Ledger is missing its "${collectionKey}" collection.`,
    };
  }
  collection.push(record);

  const parsed = reparse(detected.kind, rawClone);
  if (!parsed.ok)
    return { ok: false, kind: 'schema-error', zodError: parsed.zodError };
  return {
    ok: true,
    detected: rebuildDetected(detected.kind, parsed.data),
    recordId: newId,
  };
}

/**
 * Remove a record by id from the detected ledger. Returns `record-not-found`
 * when no record carries the id. On success the mutated document is re-parsed.
 */
export function removeRecord(
  detected: KnownDetected,
  recordId: string,
): RecordMutateResult {
  if (!existingIds(detected).has(recordId)) {
    return { ok: false, kind: 'record-not-found', recordId };
  }
  const rawClone = structuredClone(detected.data) as Record<string, unknown>;
  const collectionKey = collectionKeyFor(detected.kind);
  const collection = rawClone[collectionKey];
  if (!Array.isArray(collection)) {
    return { ok: false, kind: 'record-not-found', recordId };
  }
  rawClone[collectionKey] = collection.filter(
    (rec) => extractId(rec) !== recordId,
  );

  const parsed = reparse(detected.kind, rawClone);
  if (!parsed.ok)
    return { ok: false, kind: 'schema-error', zodError: parsed.zodError };
  return {
    ok: true,
    detected: rebuildDetected(detected.kind, parsed.data),
    recordId,
  };
}
