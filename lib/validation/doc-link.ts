/**
 * doc-link.ts — DocLinkSchema, relocated out of `roadmap-schema.ts` (ID-148.8,
 * TECH §3.4, INV-12(c)).
 *
 * DocLinkSchema is a structured cross-document reference shared by every
 * ledger record kind that carries `cross_doc_links[]` — it has no roadmap-
 * specific meaning, so it lives in its own neutral module rather than forcing
 * `backlog-schema.ts` / `task-list-schema.ts` / `retro-schema.ts` to import a
 * roadmap-named file for a field with nothing roadmap-specific about it. This
 * mirrors the same relocation upstream in task-view
 * (`packages/schemas/src/doc-link.ts`, TECH §3.1) so both repos agree on one
 * canonical home.
 *
 * `roadmap-schema.ts` re-points its own `cross_doc_links` field to import from
 * here too (its `DocLinkSchema` definition was REMOVED, not duplicated) —
 * `RoadmapSchema` itself stays a shell until {148.12} deletes it post
 * re-vendor (the not-yet-revendored `lib/ledger/*` oracle still imports
 * `RoadmapSchema`).
 */

import { z } from 'zod';

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
