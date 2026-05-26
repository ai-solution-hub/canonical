/**
 * VENDORED from task-view @ v0.2.0-task-view (packages/server/detect-schema.ts).
 * Body byte-faithful; only the three schema import specifiers are rewired from
 * `@task-view/schemas/*` → KH's vendored `@/lib/validation/*`. Re-vendor per
 * lib/ledger/README.md. Guarded by task-view-vendor-drift.yml (ID-35.10).
 *
 * ── original header ──────────────────────────────────────────────────────────
 * detect-schema.ts — three-way schema discriminator. Routes a parsed-JSON
 * value to one of the three ledger kinds by matching the canonical
 * `document_name` value, then runs the matching Zod schema `.parse(...)`.
 *
 * | document_name literal     | kind        |
 * |---------------------------|-------------|
 * | "Knowledge Hub Task List" | 'task-list' |
 * | "Knowledge Hub Roadmap"   | 'roadmap'   |
 * | "Product Backlog"         | 'backlog'   |
 * | anything else             | 'unknown'   |
 *
 * On match, `schema.parse(parsed)` runs — this throws `ZodError` if the body
 * fails validation. This module does not swallow.
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

export type DetectSchemaResult =
  | { kind: 'task-list'; data: TaskList }
  | { kind: 'roadmap'; data: Roadmap }
  | { kind: 'backlog'; data: BacklogDocument }
  | { kind: 'unknown'; documentName: string | null };

/** Canonical literal values. Source of truth for both routing and CLI error messages. */
export const KNOWN_DOCUMENT_NAMES = [
  'Knowledge Hub Task List',
  'Knowledge Hub Roadmap',
  'Product Backlog',
] as const;

export type KnownDocumentName = (typeof KNOWN_DOCUMENT_NAMES)[number];

/**
 * Discriminate a parsed-JSON value by its `document_name` field and run the
 * matching schema parse. Throws `ZodError` if a body fails validation.
 */
export function detectSchema(parsed: unknown): DetectSchemaResult {
  if (!parsed || typeof parsed !== 'object') {
    return { kind: 'unknown', documentName: null };
  }

  const documentName = (parsed as { document_name?: unknown }).document_name;

  if (documentName === 'Knowledge Hub Task List') {
    return { kind: 'task-list', data: TaskListSchema.parse(parsed) };
  }
  if (documentName === 'Knowledge Hub Roadmap') {
    return { kind: 'roadmap', data: RoadmapSchema.parse(parsed) };
  }
  if (documentName === 'Product Backlog') {
    return { kind: 'backlog', data: BacklogSchema.parse(parsed) };
  }

  return {
    kind: 'unknown',
    documentName: typeof documentName === 'string' ? documentName : null,
  };
}
