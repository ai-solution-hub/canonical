/**
 * Knowledge Hub Roadmap — Zod schema (kh-prod-readiness-S38 W5 Phase 1).
 *
 * Single source of truth for the JSON shape of `docs/reference/product-roadmap.json`
 * (the JSON-authoritative artefact replacing the legacy MD-only `product-roadmap.md`
 * post-conversion). The MD file becomes a generated artefact rendered from
 * this schema's serialised form via `bun run roadmap:render` (S39+).
 *
 * Schema decisions ratified at
 * `.planning/.research/s37-housekeeping/roadmap-conversion-approach.md` §6.1
 * (kh-prod-readiness-S37 W6, 07/05/2026, Liam directive). Departures from
 * the §4 recommendations are explicitly called out in §6.1:
 *
 *   - **Item 9 (SHIPPED markers):** schema has NO `shipped_note` /
 *     `shipped_marker` fields. Forward-looking-only doctrine is strict.
 *     Conversion pipeline gains a "shipped-framing detector" pre-parse step
 *     that produces an actionable purge list (`scripts/detect-roadmap-shipped-framings.ts`).
 *   - **Item 10 (§5.4.4 special row):** schema does NOT synthesise placeholder
 *     items. Operator purges shipped narrative from MD pre-conversion.
 *
 * Backlog precedent:
 *   `docs/reference/product-backlog.json` is the prior Zod-validated JSON
 *   document in this repo. Status enum is intentionally extended here
 *   (Item 3 ratification — `pending`, `spec_needed`, `imp_deferred`,
 *   `deferred` join the backlog enum).
 */

import { z } from 'zod';
import { Priority } from '@/lib/validation/work-status';
import { BARE_ID_REGEX } from '@/lib/validation/schemas';

// ──────────────────────────────────────────
// Enums
// ──────────────────────────────────────────

/**
 * Item priority — re-export of the shared Priority master enum from
 * work-status.ts (ID-15.7 §B.3 — eliminates standalone z.enum that was
 * identical to Priority but not linked, reducing source-of-truth drift risk).
 * Accepted values: must | should | could | future | high | medium | low | trigger.
 * Downstream consumers (renderers, filters) can group these into MoSCoW vs
 * ranked vs trigger families.
 */
export const RoadmapPriority = Priority;
export type RoadmapPriority = z.infer<typeof RoadmapPriority>;

/**
 * Item status — extends the backlog enum (Item 3 ratification). Residual
 * freetext lives in `status_note`.
 */
export const RoadmapStatus = z.enum([
  'pending',
  'blocked',
  'spec_needed',
  'in_progress',
  'deferred',
  'imp_deferred',
]);
export type RoadmapStatus = z.infer<typeof RoadmapStatus>;

/**
 * Section table column flavour — drives the MD-render strategy in the
 * reverse-renderer (S39+). Source MD has at least 6 distinct column
 * shapes per `roadmap-conversion-approach.md` §1.
 */
export const ColumnSet = z.enum([
  'item_desc_owner_effort_status',
  'item_desc_effort_priority',
  'phase_desc_effort_priority',
  'item_desc_effort_severity',
  'item_desc_priority_status',
  'item_desc_effort_priority_status',
]);
export type ColumnSet = z.infer<typeof ColumnSet>;

// ──────────────────────────────────────────
// Sub-schemas
// ──────────────────────────────────────────

/**
 * DocLink — structured cross-document reference parsed from descriptions
 * and section narratives (`Spec:` / `Plan:` / `Source:` lines, inline
 * markdown links to docs/specs/, docs/audits/, .planning/*).
 */
export const DocLinkSchema = z
  .object({
    path: z
      .string()
      .min(1)
      .describe('Repo-relative path (e.g. docs/specs/foo-spec.md)'),
    anchor: z
      .string()
      .nullable()
      .describe('Optional in-doc anchor (e.g. §2.3 or #section-id)'),
    raw: z
      .string()
      .min(1)
      .describe('Original text matched by the regex sweep, for round-trip'),
  })
  .strict();
export type DocLink = z.infer<typeof DocLinkSchema>;

// ──────────────────────────────────────────
// Item
// ──────────────────────────────────────────

export const RoadmapItemSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .describe('Dotted-decimal positional ID (e.g. 1.3, 3.1.8, 9.18.1)'),
    section_id: z
      .string()
      .min(1)
      .describe('Pointer to Section.id; redundant for query convenience'),
    title: z.string().min(1),
    /**
     * Item 5 ratification — `Phase` column source (§3.7, §4.1, §4.2, §6)
     * gets surfaced separately so the title remains the canonical heading.
     */
    phase_label: z.string().nullable(),
    /**
     * Markdown-preserved (multi-paragraph allowed). Round-trip rendering
     * must reproduce this verbatim minus pipe-padding.
     */
    description: z.string().min(1),
    /**
     * Item 7 ratification — freetext per backlog precedent. Examples:
     * `~15 min`, `1-2 sessions`, `Multiple sessions`, `XS`, `TBD`.
     */
    effort_estimate: z.string().nullable(),
    priority: RoadmapPriority.nullable(),
    /**
     * Phase 2 addition (kh-prod-readiness-S39 W1) — preserves the original
     * priority cell text verbatim when it carries editorial annotation
     * beyond the canonical enum (e.g. "Should (demoted from Must)",
     * "Medium (deferred)", "Low (H2)"). Renderer prefers `priority_note`
     * over the canonical capitalised enum so round-trip is lossless.
     * Null when the source cell was the unannotated canonical form.
     */
    priority_note: z.string().nullable(),
    /**
     * Item 8 ratification — §3.2 only (gap-analysis grading C2/H5/M4).
     * Null on every other section.
     */
    severity: z.string().nullable(),
    status: RoadmapStatus.nullable(),
    /**
     * Item 3 ratification — residual freetext when status doesn't fit
     * the enum (e.g. "Blocked on bid-to-template linkage", "EP8 build
     * remains.").
     */
    status_note: z.string().nullable(),
    /**
     * Per-item owner override (§1, §12.0 only). Falls back to
     * Section.owner when null.
     */
    owner: z.string().nullable(),
    /**
     * Item 6 ratification — hybrid parsing. High-confidence patterns
     * (`§N.M`, `D-NN`, `OPS-NN`) parsed into structured arrays; the rest
     * stays in description / status_note.
     *
     * Per ID-15.6 OQ-3 ratification — intentional divergence from Backlog +
     * Task list flat dependencies[]. Captures strategic decomposition (forward
     * dep / reverse dep / lateral coordination).
     */
    depends_on: z.array(z.string()),
    blocks: z.array(z.string()),
    coordinates_with: z.array(z.string()),
    cross_doc_links: z.array(DocLinkSchema),
    session_refs: z
      .array(z.string())
      .describe('e.g. ["S203 WP-C1", "kh-prod-readiness-S35"]'),
    commit_refs: z
      .array(z.string())
      .describe('Short or full SHA strings extracted from descriptions'),
  })
  .strict();
export type RoadmapItem = z.infer<typeof RoadmapItemSchema>;

// ──────────────────────────────────────────
// Section
// ──────────────────────────────────────────

export const RoadmapSectionSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .describe('Dotted-decimal stable ID (e.g. "1", "3.1", "9.15")'),
    parent_id: z
      .string()
      .nullable()
      .describe('Null for top-level numbered sections; parent ID otherwise'),
    /**
     * Human-facing label — same as `id` today; surfaced separately so
     * future renderers can substitute (e.g. "I" / "II" / "III" Roman).
     */
    number: z.string().min(1),
    title: z.string().min(1),
    /**
     * Item 1 ratification — markdown-preserved free-text prose between
     * the heading and the table. May be null when the section is pure
     * tabular content.
     */
    narrative: z.string().nullable(),
    /**
     * Item 1 ratification — structured `Spec:` / `Plan:` / `Source:` /
     * inline-link extraction in addition to keeping the source text in
     * `narrative`. Round-trip retains both.
     */
    spec_links: z.array(DocLinkSchema),
    /**
     * Section-level owner declaration (`**Owner:**` line at the top of
     * §9.7, §12.0 narrative). Items inherit when their per-item owner
     * is null.
     */
    owner: z.string().nullable(),
    table_columns: ColumnSet,
    items: z
      .array(RoadmapItemSchema)
      .describe('Empty allowed (e.g. §2 root, §9.17 narrative-only).'),
  })
  .strict();
export type RoadmapSection = z.infer<typeof RoadmapSectionSchema>;

// ──────────────────────────────────────────
// Theme (Subtask 30.6 / TECH §3.1)
//
// Phase-B Roadmap shape — Linear-style themes grouping related Tasks under
// time horizons (now / next / later). Authoritative back-link from Roadmap
// theme → Task via `linked_tasks[]`; Task carries a convenience
// `capability_theme` back-link that the curator skill maintains in sync.
//
// 10 fields, all required (arrays default to empty, notes nullable).
// Strict — no unknown fields permitted.
// ──────────────────────────────────────────

export const RoadmapThemeSchema = z
  .object({
    /** Bare-digit theme id (e.g. "1", "42"). Matches BARE_ID_REGEX. */
    id: z
      .string()
      .regex(BARE_ID_REGEX, 'Theme id must be a bare-digit string'),
    /** Short noun phrase title for the theme. */
    title: z.string().min(1),
    /** Markdown description of the theme's scope and intent. */
    description: z.string().min(1),
    /**
     * Linear-style time horizon — `now` (in flight), `next` (queued for
     * next cycle), `later` (parked for future cycles).
     */
    time_horizon: z.enum(['now', 'next', 'later']),
    /**
     * Theme-level status. 3 values per P-OQ-1 default: pending | in_progress
     * | done. Themes do not adopt the wider Task-level status vocabulary
     * (no blocked / deferred at theme level — those belong on Tasks).
     */
    status: z.enum(['pending', 'in_progress', 'done']),
    /**
     * Authoritative back-link to Tasks under this theme. Mirrored by each
     * Task's optional `capability_theme` convenience field.
     */
    linked_tasks: z.array(z.string()),
    /** Optional back-link to Backlog items related to the theme. */
    linked_backlog: z.array(z.string()),
    /** Session references for structured provenance. */
    session_refs: z.array(z.string()),
    /** Commit SHA references for structured provenance. */
    commit_refs: z.array(z.string()),
    /** Cross-document links for structured provenance. */
    cross_doc_links: z.array(DocLinkSchema),
    /** Optional prose notes, nullable. */
    notes: z.string().nullable(),
  })
  .strict();
export type RoadmapTheme = z.infer<typeof RoadmapThemeSchema>;

// ──────────────────────────────────────────
// Roadmap (root) — union root via .superRefine() (Subtask 30.6 / TECH §3.1)
//
// Exactly one of sections[] OR themes[] must be present at the root. Per
// T-OQ-4 ratification: stay with .superRefine() (not z.discriminatedUnion)
// to avoid discriminator-field content churn during the Phase-A → Phase-B
// migration. Both fields are optional at schema level; superRefine
// enforces the exactly-one-of constraint.
// ──────────────────────────────────────────

export const RoadmapSchema = z
  .object({
    document_name: z.literal('Knowledge Hub Roadmap'),
    document_purpose: z.string().min(1),
    /**
     * ISO 8601 (YYYY-MM-DD). Derived from MD line 3 at conversion time;
     * subsequent edits update this independently of MD regeneration.
     */
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be ISO 8601 YYYY-MM-DD'),
    status: z.literal('Active'),
    /**
     * Item 9 + Item 10 ratification — strict forward-looking-only
     * doctrine. The shipped-framing detector enforces this at conversion
     * time; the schema literal locks it in for downstream consumers.
     */
    forward_looking_only: z.literal(true),
    related_documents: z.array(z.string()).describe('Repo-relative paths'),
    /**
     * Mirrors the backlog `last_updated` field convention — freetext
     * one-liner of the form "kh-prod-readiness-SNN <wave> close-out".
     */
    last_updated: z.string().min(1),
    /**
     * Phase-A sections shape. OPTIONAL — back-compat with the legacy
     * sections-based JSON. Per Subtask 30.6 union root, exactly one of
     * sections[] OR themes[] must be present (enforced by .superRefine()).
     */
    sections: z.array(RoadmapSectionSchema).optional(),
    /**
     * Phase-B themes shape. OPTIONAL — Linear-style theme grouping. Per
     * Subtask 30.6 union root, exactly one of sections[] OR themes[] must
     * be present (enforced by .superRefine()).
     */
    themes: z.array(RoadmapThemeSchema).optional(),
  })
  .strict()
  .superRefine((doc, ctx) => {
    const hasSections = doc.sections !== undefined;
    const hasThemes = doc.themes !== undefined;
    if (hasSections === hasThemes) {
      ctx.addIssue({
        code: 'custom',
        path: ['sections', 'themes'],
        message: 'Exactly one of sections or themes must be present.',
      });
    }
  });
export type Roadmap = z.infer<typeof RoadmapSchema>;

// ──────────────────────────────────────────
// parseRoadmapWithWarnings — PRODUCT inv 8 (12-theme soft ceiling)
// ──────────────────────────────────────────

/**
 * A warning raised by `parseRoadmapWithWarnings` when a document exceeds the
 * 12-theme soft ceiling defined in PRODUCT inv 8.
 */
export interface RoadmapWarning {
  themeCount?: number;
  message: string;
}

/**
 * Parse a Roadmap and surface warnings for any document that exceeds the
 * 12-theme soft ceiling (PRODUCT inv 8).
 *
 * The soft ceiling is NOT enforced as a schema rejection — `RoadmapSchema.parse()`
 * continues to accept documents with >12 themes because the invariant is a
 * planning signal, not a hard constraint. Consumers that want to surface the
 * warning (e.g. a Planner agent) call this helper; consumers that don't care
 * continue using `RoadmapSchema.parse()` directly.
 *
 * Throws `ZodError` on hard validation failure (same behaviour as
 * `RoadmapSchema.parse()`). On success, returns the parsed `Roadmap` plus a
 * `warnings` array — empty when the document is within the ceiling or when
 * `themes` is absent (sections-only Phase-A document).
 *
 * One warning entry per offending document (not per excess theme). Mirrors the
 * `parseTaskListWithWarnings` shape from task-list-schema.ts.
 */
export function parseRoadmapWithWarnings(input: unknown): {
  value: Roadmap;
  warnings: RoadmapWarning[];
} {
  const value = RoadmapSchema.parse(input);
  const warnings: RoadmapWarning[] = [];
  if (value.themes && value.themes.length > 12) {
    warnings.push({
      themeCount: value.themes.length,
      message:
        `Roadmap has ${value.themes.length} themes (>12). ` +
        `Per PRODUCT inv 8, consider merging.`,
    });
  }
  return { value, warnings };
}
