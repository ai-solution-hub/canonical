// app/api/q-a-pairs/[id]/route.ts
//
// ID-59 {59.11} — UC6 user-direct Q&A write route (PC-A4 / PC-4).
// ID-59 {59.30} — sidecar emit + first-edit materialisation (TECH R2; PRODUCT
// INV-12 / INV-13 / INV-7). This slice replaces the prior v1.1 deferral that
// wrote ONLY to Postgres: an in-scope revision now also reaches a file.
//
// AUTHENTICATED route. It is NOT in proxy.ts `publicRoutes` — it must sit
// behind auth (any non-API public endpoint would otherwise need allowlisting;
// this one deliberately does not, so unauthenticated callers are rejected by
// the middleware before reaching the handler, and the in-handler role guard
// rejects anyone below editor).
//
// SIDECAR EMIT (INV-12 / INV-13): for an INV-7-scope pair (`curated_explicit`)
// this revision is a DUAL-WRITE — the carried-set bytes go to the pair's
// `__qa__/` sidecar `.md` file AND the q_a_pairs row is UPDATEd, presented as
// ONE atomic save via the shared file-first + compensating-restore primitive
// (`writeFileFirstWithRestore`, the same ordering the content-item route uses).
//   - `source_document_id IS NOT NULL` → write-back to the existing sidecar.
//   - `source_document_id IS NULL` → MATERIALISE a sidecar on this first edit
//     (mint the file + set `source_document_id = sdUuid5(relPath)`); the
//     cocoindex re-walk mints the matching `source_documents` row next ingest,
//     re-keying the SAME uuid5, so the linkage round-trips (FK-LESS — no FK to
//     violate by writing the id before that row exists).
//   - `COCOINDEX_SOURCE_PATH` unset (idle), or write-back storage_path resolves
//     null → DB-only fall-through; the save still lands and self-heals next walk.
// Pairs OUTSIDE the INV-7 set (`derived_from_form_response`, `imported_legacy`,
// and — for this user-direct route — anything not `curated_explicit`) keep the
// KH-DB-only behaviour: no file is minted.
//
// History snapshots: the existing `q_a_pairs_history_trigger()` (AFTER UPDATE
// on q_a_pairs, updated in {59.5} to also copy OLD.edit_intent) writes the
// q_a_pair_history row. This route performs NO app-side history insert.
import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthorisedClient } from '@/lib/auth/client';
import {
  arbitrateMany,
  coerceIntent,
  type EditIntent,
} from '@/lib/edit-intent/arbitrate';
import { writeFileFirstWithRestore } from '@/lib/edit-intent/write-back';
import { safeErrorMessage } from '@/lib/error';
import {
  qaSidecarRelPath,
  sdUuid5,
  serialiseCarriedSet,
  type CarriedSet,
} from '@/lib/q-a-pairs/sidecar-path';
import { isOk, tryQuery, type PostgrestLike } from '@/lib/supabase/safe';
import { parseBody } from '@/lib/validation';
import type { Database } from '@/supabase/types/database.types';
import { NextRequest, NextResponse } from 'next/server';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * The `origin_kind` values whose pairs get a sidecar via the USER-DIRECT route
 * (PRODUCT INV-7). Only `curated_explicit` materialises here: those are the
 * pairs a human edits in-platform, so the canonical-file promise only holds if
 * their edit reaches a file. `extracted_from_corpus` pairs are file-seeded by
 * the corpus-promotion leg ({59.29}); `derived_from_form_response` /
 * `imported_legacy` are explicitly NOT v1 for the sidecar — a sidecar would
 * invent a file identity for a KH-DB-native pair (the source-layout-freeze
 * hazard UC1's source-less guard already refuses). They keep their KH-DB-only
 * resting state.
 */
const USER_DIRECT_SIDECAR_ORIGIN_KINDS: ReadonlySet<string> = new Set([
  'curated_explicit',
]);

/**
 * Per-actor edit intent contributed by one side of a concurrent (CRDT) merge.
 * Surface is identical to `{59.8}`'s `arbitration_inputs` element shape
 * (`lib/validation/schemas.ts` `ItemUpdateBodySchema`): `actor` is a free
 * string (max 200, NOT a UUID) and `intent` is a free string (max 50). The
 * untrusted `intent` is the trust gate's input — `coerceIntent` maps any
 * out-of-CV value to the unit element 'cosmetic', never rejecting it.
 */
const ArbitrationInputSchema = z.object({
  actor: z.string().max(200),
  intent: z.string().max(50),
});

/**
 * Editable fields on the UC6 user-direct Q&A revision surface. All optional —
 * a PATCH may touch any subset. `edit_intent`/`arbitration_inputs` are
 * resolution inputs, not directly-trusted column values (the stamped value is
 * server-resolved). The per-actor CRDT field is named `arbitration_inputs` to
 * match `{59.8}`'s items route — both routes share one CRDT input surface.
 */
const QAPairUpdateSchema = z
  .object({
    question_text: z.string().min(1).optional(),
    alternate_question_phrasings: z.array(z.string()).optional(),
    answer_standard: z.string().min(1).optional(),
    answer_advanced: z.string().nullable().optional(),
    scope_tag: z.array(z.string()).optional(),
    anti_scope_tag: z.array(z.string()).optional(),
    // Single-actor intent input (coerced, then folded as a singleton).
    edit_intent: z.unknown().optional(),
    // CRDT merge inputs: per-actor intents arbitrated to one stamped value.
    // Named `arbitration_inputs` to match `{59.8}`'s items route surface.
    arbitration_inputs: z.array(ArbitrationInputSchema).optional(),
  })
  .strict();

/** The q_a_pairs columns this route is allowed to write (excludes intent inputs). */
const EDITABLE_COLUMNS = [
  'question_text',
  'alternate_question_phrasings',
  'answer_standard',
  'answer_advanced',
  'scope_tag',
  'anti_scope_tag',
] as const;

/**
 * The pair fields read BEFORE the UPDATE: the INV-7 gate inputs
 * (`origin_kind`, `source_document_id`) plus the carried set the file leg
 * serialises. The carried fields are read so a partial PATCH can be merged
 * onto the stored values to produce the full post-edit carried set the
 * sidecar must contain (the file is the WHOLE carried set, never a delta).
 */
interface PairReadRow extends CarriedSet {
  origin_kind: string;
  source_document_id: string | null;
}

const PAIR_READ_COLUMNS =
  'origin_kind, source_document_id, question_text, answer_standard, ' +
  'answer_advanced, alternate_question_phrasings, scope_tag, anti_scope_tag';

/** The generated `q_a_pairs` row + update shapes (the codebase typed-update pattern). */
type QAPairsRow = Database['public']['Tables']['q_a_pairs']['Row'];
type QAPairsUpdate = Database['public']['Tables']['q_a_pairs']['Update'];

/**
 * Resolve the post-arbitration {@link EditIntent} to stamp on this UPDATE.
 *
 * - CRDT merge path (`arbitration_inputs` present): coerce each per-actor
 *   intent through the trust gate, then `arbitrateMany` to a single intent. An
 *   empty array folds to 'cosmetic' (the unit element).
 * - Single-actor path: coerce the lone `edit_intent` and fold it as a
 *   singleton (`arbitrateMany([x])`), so both paths share one resolution rule.
 */
function resolveEditIntent(
  parsed: z.infer<typeof QAPairUpdateSchema>,
  ctx: { userId: string; contentItemId: string },
): EditIntent {
  if (parsed.arbitration_inputs !== undefined) {
    const coerced = parsed.arbitration_inputs.map((input) =>
      coerceIntent(input.intent, {
        userId: ctx.userId,
        contentItemId: ctx.contentItemId,
        opId: input.actor,
      }),
    );
    return arbitrateMany(coerced);
  }

  const single = coerceIntent(parsed.edit_intent, {
    userId: ctx.userId,
    contentItemId: ctx.contentItemId,
    opId: ctx.userId,
  });
  return arbitrateMany([single]);
}

/**
 * Build the FULL post-edit carried set the sidecar must contain: the stored
 * carried fields with the partial PATCH's editable fields merged over them.
 * The file always holds the whole carried set (INV-2), never a delta — so a
 * PATCH that only touches `answer_standard` still produces a complete sidecar
 * carrying the unchanged `question_text` etc.
 */
function buildCarriedSet(
  stored: PairReadRow,
  directFields: Record<string, unknown>,
): CarriedSet {
  const merged: PairReadRow = { ...stored, ...directFields } as PairReadRow;
  return {
    question_text: merged.question_text,
    answer_standard: merged.answer_standard,
    answer_advanced: merged.answer_advanced ?? null,
    // text[] NOT NULL DEFAULT '{}' — coalesce a null read to the empty array.
    alternate_question_phrasings: merged.alternate_question_phrasings ?? [],
    scope_tag: merged.scope_tag ?? null,
    anti_scope_tag: merged.anti_scope_tag ?? null,
  };
}

export const PATCH = defineRoute(
  z.unknown(),
  async (request: NextRequest, context: RouteContext) => {
    try {
      const { id } = await context.params;

      const auth = await getAuthorisedClient(['admin', 'editor']);
      if (!auth.success) return authFailureResponse(auth);
      const { supabase, user } = auth;

      // Malformed/empty JSON body → null, which parseBody rejects as a 400.
      // The parse failure IS the surfaced signal, so the swallow is intentional.
      const raw = await request.json().catch((_err) => null);
      const parsedResult = parseBody(QAPairUpdateSchema, raw);
      if (!parsedResult.success) return parsedResult.response;
      const parsed = parsedResult.data;

      // Project just the writable content fields from the parsed body.
      // Typed as a `q_a_pairs` Update partial so it spreads into the UPDATE
      // payload without a cast (the editable columns are a strict subset of the
      // generated Update shape). The per-column assignment widens to the Update
      // value via a single localised cast — the EDITABLE_COLUMNS allowlist plus
      // the zod schema already constrain the keys + value shapes.
      const directFields: QAPairsUpdate = {};
      for (const col of EDITABLE_COLUMNS) {
        if (parsed[col] !== undefined) {
          (directFields as Record<string, unknown>)[col] = parsed[col];
        }
      }

      if (Object.keys(directFields).length === 0) {
        return NextResponse.json(
          { error: 'No editable fields to update' },
          { status: 400 },
        );
      }

      // Resolve + stamp the post-arbitration edit intent on the UC6 CRDT path.
      const editIntent = resolveEditIntent(parsed, {
        userId: user.id,
        contentItemId: id,
      });

      // ── Pre-read the pair: INV-7 gate inputs + the carried set ───────────────
      // The sidecar decision needs the pair's `origin_kind` (the INV-7 gate) and
      // `source_document_id` (write-back vs materialise vs DB-only) BEFORE the
      // UPDATE — the file leg is file-first, so the file write must precede the
      // DB leg. The carried fields are read so a partial PATCH merges onto the
      // stored values to form the WHOLE post-edit carried set the file holds.
      const pairResult = await tryQuery<PairReadRow | null>(
        supabase
          .from('q_a_pairs')
          .select(PAIR_READ_COLUMNS)
          .eq('id', id)
          .maybeSingle() as unknown as PostgrestLike<PairReadRow | null>,
        'q_a_pairs.userDirectRevision.preRead',
      );
      if (!isOk(pairResult)) {
        return NextResponse.json(
          { error: 'Failed to update Q&A pair' },
          { status: 500 },
        );
      }
      if (pairResult.data === null) {
        return NextResponse.json(
          { error: 'Q&A pair not found' },
          { status: 404 },
        );
      }
      const storedPair = pairResult.data;

      // The carried set the sidecar must contain (full set; partial PATCH merged).
      const carried = buildCarriedSet(storedPair, directFields);

      // The id to set on the materialise path. NULL on every other path so the
      // DB leg never clobbers an existing/absent linkage with a stale value.
      let mintedSourceDocumentId: string | null = null;

      // ── The DB leg, shared by all branches (file-first injects it) ───────────
      // Captures the updated row + an explicit affected-row assertion so a 0-row
      // PATCH is a surfaced failure, never a silent no-op (REST PATCH gotcha).
      // On the materialise branch it ALSO sets `source_document_id` so the pair
      // becomes file-canonical from this edit forward (INV-13).
      let updatedRow: QAPairsRow | null = null;
      const applyDbLeg = async (): Promise<void> => {
        const updatePayload: QAPairsUpdate = {
          ...directFields,
          edit_intent: editIntent,
          updated_at: new Date().toISOString(),
        };
        if (mintedSourceDocumentId !== null) {
          updatePayload.source_document_id = mintedSourceDocumentId;
        }
        const updateResult = await tryQuery<QAPairsRow>(
          supabase
            .from('q_a_pairs')
            .update(updatePayload)
            .eq('id', id)
            .select('*')
            .single() as unknown as PostgrestLike<QAPairsRow>,
          'q_a_pairs.userDirectRevision',
        );
        if (!isOk(updateResult)) {
          throw updateResult.error;
        }
        // Affected-row assertion: `.single()` already errors PGRST116 on 0 rows,
        // but a null data with no error is a silent failure we must not swallow.
        if (updateResult.data === null) {
          throw new Error('Q&A pair UPDATE affected 0 rows');
        }
        updatedRow = updateResult.data;
      };

      // ── Branch on the INV-7 gate + sidecar state ─────────────────────────────
      const inSidecarScope = USER_DIRECT_SIDECAR_ORIGIN_KINDS.has(
        storedPair.origin_kind,
      );
      const sourceRoot = process.env.COCOINDEX_SOURCE_PATH;

      if (!inSidecarScope || !sourceRoot) {
        // Outside the INV-7 set, OR idle mode (no source-binding folder): the
        // save is KH-DB-only. The DB write is the single source of the outcome;
        // it self-heals into a file on the next bound walk for in-scope pairs.
        await applyDbLeg();
      } else if (storedPair.source_document_id !== null) {
        // WRITE-BACK (INV-12): the pair already has a sidecar. Resolve its
        // storage_path FK-LESSLY (two plain reads, NEVER a PostgREST embed —
        // the embed PGRST200s post-FK-drop, BUG-E) and rewrite the file as one
        // atomic save with the DB UPDATE.
        const docResult = await tryQuery<{
          storage_path: string | null;
        } | null>(
          supabase
            .from('source_documents')
            .select('storage_path')
            .eq('id', storedPair.source_document_id)
            .maybeSingle() as unknown as PostgrestLike<{
            storage_path: string | null;
          } | null>,
          'q_a_pairs.userDirectRevision.resolveStoragePath',
        );
        if (!isOk(docResult)) {
          return NextResponse.json(
            { error: 'Failed to update Q&A pair' },
            { status: 500 },
          );
        }
        const storagePath = docResult.data?.storage_path ?? null;
        if (storagePath === null) {
          // No source_documents row yet (or no storage_path) — the sidecar has
          // not materialised on disk. Fall through to DB-only for this one edit,
          // exactly like writeBackFileFirst's idle/dangling fall-through; the
          // next walk reconciles. (Covers the FK-less write-before-row window.)
          await applyDbLeg();
        } else {
          await writeFileFirstWithRestore({
            absPath: join(sourceRoot, storagePath),
            newContent: serialiseCarriedSet(carried),
            applyDbLeg,
          });
        }
      } else {
        // MATERIALISE-ON-FIRST-EDIT (INV-13, OQ-25-4 RATIFIED): a source-less
        // `curated_explicit` pair mints its sidecar on this edit. Key the path on
        // the pair PK (CONSISTENCY with {59.29}'s corpus emit, which also keys on
        // the pair PK — a pair has ONE canonical sidecar path). The DB leg sets
        // `source_document_id = sdUuid5(relPath)`; the cocoindex re-walk mints the
        // matching source_documents row next ingest, re-keying the SAME uuid5.
        // FK-LESS: writing the id before that row exists violates no FK (INV-8).
        const relPath = qaSidecarRelPath(id);
        mintedSourceDocumentId = sdUuid5(relPath);
        const absPath = join(sourceRoot, relPath);
        // Mint the new file first, then the DB leg (with the linkage). There is
        // no prior file to snapshot/restore, so this is a plain file-first mint
        // rather than the read-then-restore primitive (which assumes a prior
        // file); a DB-leg failure leaves an orphan .md the next walk reconciles.
        await writeFile(absPath, serialiseCarriedSet(carried), 'utf8');
        await applyDbLeg();
      }

      return NextResponse.json({
        q_a_pair: updatedRow,
        edit_intent: editIntent,
      });
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to update Q&A pair') },
        { status: 500 },
      );
    }
  },
);
