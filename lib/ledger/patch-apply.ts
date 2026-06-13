/**
 * VENDORED from task-view @ v0.5.0-task-view (packages/server/patch-apply.ts).
 * Body byte-faithful (for the retained validation-oracle subset); only schema
 * import specifiers rewired `@task-view/schemas/*` → `@/lib/validation/*`.
 * Re-vendor per lib/ledger/README.md. Guarded by task-view-vendor-drift.yml
 * (ID-35.10). ID-102.8: the subtask-id lookup is now a digit-string compare
 * (no Number()-parse) — re-vendored from the v0.5.0 string-id server seam.
 *
 * ROLE (ID-90.22 R1b/R2): CLI-side validation oracle. `scripts/ledger-cli.ts`'s
 * `fieldPatchMutation` calls `applyPatches` to re-validate a field edit (the
 * `FieldPatch` schema oracle), surfacing the local schema-error/walk-error
 * envelope before the server-routed PATCH; the `FieldPatch` type is also the
 * `ServerIntent.patches` shape. RETAINED (esc-4) when R2 deleted the write-side
 * primitives; DISPOSITION rides {68.30}.
 *
 * ── original header ──────────────────────────────────────────────────────────
 * patch-apply.ts — patch application algorithm. Walks a FieldPath through the
 * canonical structure, replaces the leaf value, re-parses via the matching Zod
 * schema, and returns the typed result or a structured error. All-or-nothing:
 * all patches apply to one in-memory snapshot, then ONE Zod parse runs.
 *
 * FieldPath shape:
 *   - Task-list: ['tasks', taskId, field] | ['tasks', taskId, 'subtasks', subId, field]
 *   - Roadmap:   ['themes', themeId, field]
 *   - Backlog:   ['items', itemId, field]
 * taskId/themeId/itemId are STRING ids; subId is a DIGIT-STRING id. The stored
 * subtask id is itself a digit-string (ID-102), so we compare string-to-string
 * on subtask lookup (no Number()-parse).
 */

import {
  TaskListSchema,
  type TaskList,
} from '@/lib/validation/task-list-schema';
import { TaskSchema, SubtaskSchema } from '@/lib/validation/task-list-schema';
import { RoadmapSchema, type Roadmap } from '@/lib/validation/roadmap-schema';
import { RoadmapThemeSchema } from '@/lib/validation/roadmap-schema';
import {
  BacklogSchema,
  BacklogItemSchema,
  type BacklogDocument,
} from '@/lib/validation/backlog-schema';
import {
  RetrosSchema,
  RetroRecordSchema,
  type RetrosDocument,
} from '@/lib/validation/retro-schema';
import { ZodError } from 'zod';
import type { DetectSchemaResult } from './detect-schema';

// ── Schema-keyset sets ────────────────────────────────────────────────────────
//
// A field is permitted iff it is declared in the record type's Zod schema
// shape (not the instance's own properties — optional fields absent on a live
// record must still be SET-able). Unknown / typo'd fields are absent from the
// shape and rejected as walk-errors. CRITICAL for backlog: BacklogItemSchema
// does NOT use .strict(), so a typo'd field would otherwise be silently
// stripped by Zod and the patch would no-op with ok=true.

const TASK_KNOWN_FIELDS = new Set(Object.keys(TaskSchema.shape));
const SUBTASK_KNOWN_FIELDS = new Set(Object.keys(SubtaskSchema.shape));
const ROADMAP_THEME_KNOWN_FIELDS = new Set(
  Object.keys(RoadmapThemeSchema.shape),
);
const BACKLOG_ITEM_KNOWN_FIELDS = new Set(Object.keys(BacklogItemSchema.shape));
// WS-C C2: retro record field keyset (RetroRecordSchema IS `.strict()`, but
// the keyset guard keeps the walk-error-vs-schema-error boundary identical).
const RETRO_KNOWN_FIELDS = new Set(Object.keys(RetroRecordSchema.shape));

// ── Public types ──────────────────────────────────────────────────────────────

/** A single patch: walk fieldPath into the canonical structure, replace leaf with newValue. */
export interface FieldPatch {
  fieldPath: string[];
  newValue: unknown;
}

/**
 * Result of applying a batch of patches.
 */
export type ApplyPatchesResult<TData> =
  | { ok: true; parsed: TData }
  | {
      ok: false;
      kind: 'walk-error';
      fieldPath: string[];
      detail: string;
    }
  | { ok: false; kind: 'schema-error'; zodError: ZodError }
  | { ok: false; kind: 'empty-patches' }
  | { ok: false; kind: 'kind-mismatch'; expected: string; actual: string };

// ── Internal: id-aware walk helpers ──────────────────────────────────────────

function applyTaskListPatch(
  snapshot: TaskList,
  patch: FieldPatch,
): null | { fieldPath: string[]; detail: string } {
  const [head, ...rest] = patch.fieldPath;
  if (head !== 'tasks') {
    return {
      fieldPath: patch.fieldPath,
      detail: `Task-list patches must start with 'tasks'; got "${head ?? '<empty>'}".`,
    };
  }
  const [taskId, ...afterTask] = rest;
  if (taskId == null || taskId === '') {
    return {
      fieldPath: patch.fieldPath,
      detail: `Missing task id at fieldPath[1].`,
    };
  }
  const taskIdx = snapshot.tasks.findIndex((t) => t.id === taskId);
  if (taskIdx === -1) {
    return {
      fieldPath: patch.fieldPath,
      detail: `Task id "${taskId}" not found in canonical tasks[].`,
    };
  }
  const task = snapshot.tasks[taskIdx];

  if (afterTask.length === 0) {
    return {
      fieldPath: patch.fieldPath,
      detail: `FieldPath must address a field within the Task, not the Task object itself.`,
    };
  }

  // Direct task-field patch: ['tasks', taskId, fieldName]
  if (afterTask.length === 1) {
    const field = afterTask[0];
    if (!TASK_KNOWN_FIELDS.has(field)) {
      return {
        fieldPath: patch.fieldPath,
        detail: `Field "${field}" is not a known field on Task records. Known fields: ${[...TASK_KNOWN_FIELDS].join(', ')}.`,
      };
    }
    (task as Record<string, unknown>)[field] = patch.newValue;
    return null;
  }

  // Subtask patch: ['tasks', taskId, 'subtasks', subtaskId, fieldName]
  if (afterTask[0] !== 'subtasks') {
    return {
      fieldPath: patch.fieldPath,
      detail: `Unsupported nested path segment "${afterTask[0]}" after taskId; only 'subtasks' is supported.`,
    };
  }
  const subtaskIdRaw = afterTask[1];
  if (subtaskIdRaw == null) {
    return {
      fieldPath: patch.fieldPath,
      detail: `Missing subtask id at fieldPath[3].`,
    };
  }
  if (!/^\d+$/.test(subtaskIdRaw)) {
    return {
      fieldPath: patch.fieldPath,
      detail: `Subtask id "${subtaskIdRaw}" is not a digit-string id.`,
    };
  }
  const subtaskIdx = task.subtasks.findIndex((s) => s.id === subtaskIdRaw);
  if (subtaskIdx === -1) {
    return {
      fieldPath: patch.fieldPath,
      detail: `Subtask id ${subtaskIdRaw} not found within Task ${taskId}.`,
    };
  }
  const subtask = task.subtasks[subtaskIdx];

  const subtaskFieldPathRest = afterTask.slice(2);
  if (subtaskFieldPathRest.length !== 1) {
    return {
      fieldPath: patch.fieldPath,
      detail: `Subtask fieldPath must address a single field after the subtaskId; got ${subtaskFieldPathRest.length} additional segment(s).`,
    };
  }
  const subField = subtaskFieldPathRest[0];
  if (!SUBTASK_KNOWN_FIELDS.has(subField)) {
    return {
      fieldPath: patch.fieldPath,
      detail: `Field "${subField}" is not a known field on Subtask records. Known fields: ${[...SUBTASK_KNOWN_FIELDS].join(', ')}.`,
    };
  }
  (subtask as Record<string, unknown>)[subField] = patch.newValue;
  return null;
}

function applyRoadmapPatch(
  snapshot: Roadmap,
  patch: FieldPatch,
): null | { fieldPath: string[]; detail: string } {
  const [head, themeId, ...rest] = patch.fieldPath;
  if (head !== 'themes') {
    return {
      fieldPath: patch.fieldPath,
      detail: `Roadmap patches must start with 'themes'; got "${head ?? '<empty>'}".`,
    };
  }
  if (themeId == null || themeId === '') {
    return {
      fieldPath: patch.fieldPath,
      detail: `Missing theme id at fieldPath[1].`,
    };
  }
  const themeIdx = snapshot.themes.findIndex((t) => t.id === themeId);
  if (themeIdx === -1) {
    return {
      fieldPath: patch.fieldPath,
      detail: `Theme id "${themeId}" not found in canonical themes[].`,
    };
  }
  const theme = snapshot.themes[themeIdx];

  if (rest.length === 0) {
    return {
      fieldPath: patch.fieldPath,
      detail: `FieldPath must address a field within the Theme, not the Theme object itself.`,
    };
  }

  if (rest.length !== 1) {
    return {
      fieldPath: patch.fieldPath,
      detail: `Theme fieldPath must address a single field after the themeId; got ${rest.length} additional segment(s).`,
    };
  }
  const field = rest[0];
  if (!ROADMAP_THEME_KNOWN_FIELDS.has(field)) {
    return {
      fieldPath: patch.fieldPath,
      detail: `Field "${field}" is not a known field on RoadmapTheme records. Known fields: ${[...ROADMAP_THEME_KNOWN_FIELDS].join(', ')}.`,
    };
  }
  (theme as Record<string, unknown>)[field] = patch.newValue;
  return null;
}

function applyBacklogPatch(
  snapshot: BacklogDocument,
  patch: FieldPatch,
): null | { fieldPath: string[]; detail: string } {
  const [head, itemId, ...rest] = patch.fieldPath;
  if (head !== 'items') {
    return {
      fieldPath: patch.fieldPath,
      detail: `Backlog patches must start with 'items'; got "${head ?? '<empty>'}".`,
    };
  }
  if (itemId == null || itemId === '') {
    return {
      fieldPath: patch.fieldPath,
      detail: `Missing item id at fieldPath[1].`,
    };
  }
  const itemIdx = snapshot.items.findIndex((it) => it.id === itemId);
  if (itemIdx === -1) {
    return {
      fieldPath: patch.fieldPath,
      detail: `Item id "${itemId}" not found in canonical items[].`,
    };
  }
  const item = snapshot.items[itemIdx];

  if (rest.length !== 1) {
    return {
      fieldPath: patch.fieldPath,
      detail: `Item fieldPath must address a single field after the itemId; got ${rest.length} additional segment(s).`,
    };
  }
  const field = rest[0];
  if (!BACKLOG_ITEM_KNOWN_FIELDS.has(field)) {
    return {
      fieldPath: patch.fieldPath,
      detail: `Field "${field}" is not a known field on BacklogItem records. Known fields: ${[...BACKLOG_ITEM_KNOWN_FIELDS].join(', ')}.`,
    };
  }
  (item as Record<string, unknown>)[field] = patch.newValue;
  return null;
}

/**
 * Walk a fieldPath into a Retros snapshot and apply a single patch (WS-C C2).
 * Records are addressed by session id under `retros[]` — `['retros', id, field]`.
 */
function applyRetroPatch(
  snapshot: RetrosDocument,
  patch: FieldPatch,
): null | { fieldPath: string[]; detail: string } {
  const [head, retroId, ...rest] = patch.fieldPath;
  if (head !== 'retros') {
    return {
      fieldPath: patch.fieldPath,
      detail: `Retro patches must start with 'retros'; got "${head ?? '<empty>'}".`,
    };
  }
  if (retroId == null || retroId === '') {
    return {
      fieldPath: patch.fieldPath,
      detail: `Missing retro id at fieldPath[1].`,
    };
  }
  const retroIdx = snapshot.retros.findIndex((r) => r.id === retroId);
  if (retroIdx === -1) {
    return {
      fieldPath: patch.fieldPath,
      detail: `Retro id "${retroId}" not found in canonical retros[].`,
    };
  }
  const retro = snapshot.retros[retroIdx];

  if (rest.length !== 1) {
    return {
      fieldPath: patch.fieldPath,
      detail: `Retro fieldPath must address a single field after the retroId; got ${rest.length} additional segment(s).`,
    };
  }
  const field = rest[0];
  if (!RETRO_KNOWN_FIELDS.has(field)) {
    return {
      fieldPath: patch.fieldPath,
      detail: `Field "${field}" is not a known field on Retro records. Known fields: ${[...RETRO_KNOWN_FIELDS].join(', ')}.`,
    };
  }
  (retro as Record<string, unknown>)[field] = patch.newValue;
  return null;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Apply a batch of FieldPatch entries to a TaskList canonical snapshot
 * and re-parse via TaskListSchema. Single-validation-pass.
 *
 * Caller MUST pass a fresh structuredClone of the canonical data — this
 * function mutates the input snapshot.
 */
export function applyTaskListPatches(
  snapshot: TaskList,
  patches: readonly FieldPatch[],
): ApplyPatchesResult<TaskList> {
  if (patches.length === 0) return { ok: false, kind: 'empty-patches' };
  for (const patch of patches) {
    const err = applyTaskListPatch(snapshot, patch);
    if (err) {
      return {
        ok: false,
        kind: 'walk-error',
        fieldPath: err.fieldPath,
        detail: err.detail,
      };
    }
  }
  try {
    const parsed = TaskListSchema.parse(snapshot);
    return { ok: true, parsed };
  } catch (err) {
    if (err instanceof ZodError) {
      return { ok: false, kind: 'schema-error', zodError: err };
    }
    throw err;
  }
}

export function applyRoadmapPatches(
  snapshot: Roadmap,
  patches: readonly FieldPatch[],
): ApplyPatchesResult<Roadmap> {
  if (patches.length === 0) return { ok: false, kind: 'empty-patches' };
  for (const patch of patches) {
    const err = applyRoadmapPatch(snapshot, patch);
    if (err) {
      return {
        ok: false,
        kind: 'walk-error',
        fieldPath: err.fieldPath,
        detail: err.detail,
      };
    }
  }
  try {
    const parsed = RoadmapSchema.parse(snapshot);
    return { ok: true, parsed };
  } catch (err) {
    if (err instanceof ZodError) {
      return { ok: false, kind: 'schema-error', zodError: err };
    }
    throw err;
  }
}

export function applyBacklogPatches(
  snapshot: BacklogDocument,
  patches: readonly FieldPatch[],
): ApplyPatchesResult<BacklogDocument> {
  if (patches.length === 0) return { ok: false, kind: 'empty-patches' };
  for (const patch of patches) {
    const err = applyBacklogPatch(snapshot, patch);
    if (err) {
      return {
        ok: false,
        kind: 'walk-error',
        fieldPath: err.fieldPath,
        detail: err.detail,
      };
    }
  }
  try {
    const parsed = BacklogSchema.parse(snapshot);
    return { ok: true, parsed };
  } catch (err) {
    if (err instanceof ZodError) {
      return { ok: false, kind: 'schema-error', zodError: err };
    }
    throw err;
  }
}

/**
 * Apply a batch of FieldPatch entries to a Retros canonical snapshot and
 * re-parse via RetrosSchema (WS-C C2). Same single-validation-pass +
 * clone-on-entry contract as the other appliers.
 */
function applyRetroPatches(
  snapshot: RetrosDocument,
  patches: readonly FieldPatch[],
): ApplyPatchesResult<RetrosDocument> {
  if (patches.length === 0) return { ok: false, kind: 'empty-patches' };
  for (const patch of patches) {
    const err = applyRetroPatch(snapshot, patch);
    if (err) {
      return {
        ok: false,
        kind: 'walk-error',
        fieldPath: err.fieldPath,
        detail: err.detail,
      };
    }
  }
  try {
    const parsed = RetrosSchema.parse(snapshot);
    return { ok: true, parsed };
  } catch (err) {
    if (err instanceof ZodError) {
      return { ok: false, kind: 'schema-error', zodError: err };
    }
    throw err;
  }
}

/**
 * Dispatch a patch batch to the per-kind applier. Throws if the detected
 * kind is 'unknown' (callers reject unknown ledgers at load time).
 */
export function applyPatches(
  detected: DetectSchemaResult,
  patches: readonly FieldPatch[],
): ApplyPatchesResult<TaskList | Roadmap | BacklogDocument | RetrosDocument> {
  if (detected.kind === 'unknown') {
    throw new Error(
      `Cannot apply patches to unknown ledger kind (document_name: ${detected.documentName ?? 'null'}).`,
    );
  }
  if (detected.kind === 'task-list') {
    return applyTaskListPatches(detected.data, patches);
  }
  if (detected.kind === 'roadmap') {
    return applyRoadmapPatches(detected.data, patches);
  }
  // WS-C C2: retros — session retro ledger.
  if (detected.kind === 'retro') {
    return applyRetroPatches(detected.data, patches);
  }
  return applyBacklogPatches(detected.data, patches);
}
