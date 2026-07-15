"""Cross-workspace + cross-form Q&A dedup PROPOSER post-pass (ID-120).

Hosts the walk-time proposer phase that runs AFTER the per-item `mount_each`
fan-out has settled and AFTER the Stage-5 entity-resolution post-pass (TECH
P-2 / P-3, ID-120). It mirrors the Stage-5 substrate (`stage_5.py:204
_run_stage_5_resolution`): an asyncpg `db_pool`-driven post-pass BESIDE
cocoindex (NOT inside an `@coco.fn` — you cannot query across records inside a
per-file component, RESEARCH caveat (a)).

WHAT IT DOES (PRODUCT INV-1..INV-21):
- CANDIDATE READ (INV-2/6/7): a single service-role read of the WHOLE published,
  embedding-bearing, non-superseded `q_a_pairs` population — "embedding-bearing"
  is now a `record_embeddings` (owner_kind='q_a_pair') join, not an inline
  column (ID-127.32 / DR-036: `q_a_pairs.question_embedding` was DROPPED live by
  20260706120000_id131_drop_inline_vector_cols.sql). The read is deliberately
  NOT scoped by `source_form_instance_id` (ID-145 {145.26}: re-pointed off the
  dropped `source_workspace_id`, {145.6} W1c) — this is the 2nd named "confined
  widening" after Stage-5's ID-80.14 op_id exception. The deployment is one
  Supabase DB per client, so the DATABASE is the tenant boundary; reading
  across the client's workspaces AND forms is the INTRA-tenant dedup axis (the
  S391 framing correction — workspace != tenant). The same question surfacing in
  different forms of one application (PQQ vs ITT) is the primary driver.
- SIMILARITY (INV-3/21): the candidate pairs are produced by a SQL self-join
  `q_a_pairs a JOIN q_a_pairs b ON a.id < b.id`, each side additionally joined
  to `record_embeddings` (owner_kind='q_a_pair'), using
  `1.0 - (re_a.embedding <=> re_b.embedding)` — the SAME re-pointed pgvector
  cosine expression `q_a_search` uses
  (20260706170000_id131_qa_fns_record_embeddings_repoint.sql, which re-pointed
  `q_a_search`/`question_match_recompute`/
  `q_a_extractions_promotion_candidates` off the same dropped column) — NOT an
  in-Python recompute. The threshold filter lives in SQL too. The set is
  identical regardless of any vector index (INV-21): there is no HNSW/ivfflat
  index on `record_embeddings.embedding` at v1, so this is a brute-force scan
  like Stage-5, but the candidate SET is index-independent.
- THRESHOLD (INV-19/20): `QA_DEDUP_COSINE_THRESHOLD`, ONE definition, env-
  overridable, v1 default 0.92 (precision-first). Calibrate vs the live
  distribution as a pre-enable journal gate (NOT a code change).
- SURVIVOR NOMINATION (INV-12): `proposed_survivor_id` + a human `survivor_reason`
  by policy order (1) published > non-published, (2) confidence/quality column if
  one exists (q_a_pairs has none at v1, so this rung is inert), (3) recency (later
  `updated_at`).
- RE-PROPOSE (INV-5 / P-7): each pair carries `pair_a_fingerprint` /
  `pair_b_fingerprint` = `md5(question_text)`. A pair already resolved
  (approved/rejected) is SKIPPED unless the current fingerprint of either side
  differs from the stored fingerprint (the question text changed) — a stale
  proposal is then re-proposed. Archived/superseded pairs never re-surface (they
  are excluded by the candidate read).
- WRITE (INV-4): UPSERT to `public.q_a_pair_dedup_proposals` with
  `ON CONFLICT (pair_a_id, pair_b_id) DO NOTHING`, so a re-run produces no
  duplicate pending rows. The proposer NEVER touches
  `q_a_pairs.publication_status` / `q_a_pairs.superseded_by` — the merge WRITE
  fires only on curator approval (app-side, {120.7}).

The module is consumed by `scripts/cocoindex_pipeline/flow.py:app_main` (the P-3
attach), invoked AFTER the Stage-5 block (after `await handle.ready()` and the
`cocoindex.stage_5.resolved` log) and BEFORE the flow-end webhook. To avoid a
runtime import cycle (flow.py imports this module at top), the flow-side type
(`_FlowStageCounter`) is imported under `TYPE_CHECKING` only — the function
consumes it structurally at runtime (`flow_stage_counter.increment(...)`).
asyncpg is referenced only under `TYPE_CHECKING` (mirroring `stage_5.py`).

References:
- TECH.md (id-120) §P-2 (proposer body), §P-3 (attach point).
- PRODUCT.md (id-120) — INV-1..INV-23.
- `scripts/cocoindex_pipeline/stage_5.py` — the post-pass scaffold this mirrors.
- `supabase/migrations/20260706170000_id131_qa_fns_record_embeddings_repoint.sql`
  — the record_embeddings (owner_kind='q_a_pair') re-point idiom this module's
  candidate-read query mirrors (ID-127.32 / DR-036); q_a_search's cosine
  expression there is itself the re-point of the original
  `20260617130000_squash_baseline.sql:4282` expression this module used to
  re-use directly.
- `supabase/migrations/20260706120000_id131_drop_inline_vector_cols.sql` — DROPs
  `q_a_pairs.question_embedding` (live-applied; {127.30} op_id 641943d2 walk
  empirically hit the resulting UndefinedColumnError before this Subtask).
- `supabase/migrations/20260623124556_id120_qa_pair_dedup_proposals.sql` — the
  proposal-store table this writes ({120.5}).
- `supabase/migrations/20260712060000_id145_w1a_qa_pairs_lineage_migrate.sql` /
  `20260712062000_id145_w1c_rename_reshape.sql` — ID-145 {145.6} W1: renames
  `q_a_pairs.source_form_template_id` -> `source_form_instance_id` and DROPs
  `q_a_pairs.source_workspace_id` (lineage migrated onto the renamed column
  first); DROPs `q_a_pair_dedup_proposals.pair_a/b_source_workspace_id` with
  NO replacement column on that table (W1a: lineage stays recoverable via the
  existing `pair_a_id`/`pair_b_id` FKs -> `q_a_pairs`). Re-pointed here at
  {145.26}.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
from typing import TYPE_CHECKING
from uuid import UUID

if TYPE_CHECKING:  # pragma: no cover
    import asyncpg

    from scripts.cocoindex_pipeline.flow import _FlowStageCounter


_logger = logging.getLogger(__name__)


# ID-127.32 (DR-036): the record_embeddings model discriminator, duplicated
# (not imported) from flow.py's `EMBEDDING_MODEL` — the module docstring above
# explains the deliberate runtime import-cycle avoidance (flow.py imports this
# module at top, so this module cannot import flow.py symbols at runtime).
# Mirrors the same inlined-literal idiom
# `20260706170000_id131_qa_fns_record_embeddings_repoint.sql` uses for its
# `embedding_model CONSTANT text := 'text-embedding-3-large'` PL/pgSQL
# declarations. Keep in sync with flow.EMBEDDING_MODEL by hand.
_EMBEDDING_MODEL = "text-embedding-3-large"


# ── Threshold (INV-19/20) ─────────────────────────────────────────────────────
#
# ONE definition, env-overridable. v1 default 0.92 — precision-first (we would
# rather miss a true duplicate than surface a false one to a curator). Calibrate
# against the live cosine distribution as a PRE-ENABLE journal gate; that is a
# tuning step, NOT a code change. `<=>` is pgvector cosine DISTANCE; cosine
# SIMILARITY is `1.0 - distance`, so the threshold is a similarity floor.
_QA_DEDUP_COSINE_THRESHOLD_DEFAULT = 0.92


def _resolve_cosine_threshold() -> float:
    """Resolve the cosine-similarity threshold (INV-19).

    Reads `QA_DEDUP_COSINE_THRESHOLD` from the environment, falling back to the
    v1 precision-first default (0.92). A malformed env value is ignored (falls
    back to the default) rather than crashing the walk — the proposer is a
    contained post-pass and must never abort the pipeline on a config typo.
    """
    raw = os.environ.get("QA_DEDUP_COSINE_THRESHOLD")
    if raw is None or raw.strip() == "":
        return _QA_DEDUP_COSINE_THRESHOLD_DEFAULT
    try:
        return float(raw)
    except ValueError:
        _logger.warning(
            json.dumps(
                {
                    "event": "cocoindex.qa_dedup.threshold_parse_failed",
                    "raw": raw,
                    "fallback": _QA_DEDUP_COSINE_THRESHOLD_DEFAULT,
                }
            )
        )
        return _QA_DEDUP_COSINE_THRESHOLD_DEFAULT


def _fingerprint(question_text: str) -> str:
    """Re-propose watermark (P-7): md5 of the question text.

    A pair already resolved (approved/rejected) is re-proposed only when either
    side's CURRENT fingerprint differs from the stored fingerprint — i.e. the
    question text changed since the proposal was resolved. Stable across runs for
    unchanged text, so an unchanged resolved pair stays suppressed.
    """
    return hashlib.md5(question_text.encode("utf-8")).hexdigest()  # noqa: S324 — watermark, not security


async def _select_candidate_pairs(
    db_pool: asyncpg.Pool, threshold: float
) -> list[asyncpg.Record]:
    """SQL self-join candidate read (INV-2/3/6/7/21).

    Reads the WHOLE published, embedding-bearing, non-superseded `q_a_pairs`
    population (NO `source_form_instance_id` filter — the named confined
    widening, INV-6/8) and self-joins it on `a.id < b.id` to produce
    exactly-2-distinct-row candidate pairs (INV-7: never self, chains
    decompose into separate pairwise proposals). Similarity is the pgvector
    cosine expression `1.0 - (re_a.embedding <=> re_b.embedding)` computed in
    SQL, filtered to `>= threshold` — NOT an in-Python recompute, so the
    candidate set is identical regardless of any vector index (INV-21).

    ID-127.32 (DR-036): `q_a_pairs.question_embedding` was DROPPED live
    (20260706120000_id131_drop_inline_vector_cols.sql) — the vector now reads
    from `record_embeddings` (owner_kind='q_a_pair') via an INNER JOIN per
    side (`re_a`/`re_b`), mirroring the exact re-point idiom
    `20260706170000_id131_qa_fns_record_embeddings_repoint.sql` applied to
    `q_a_search`/`question_match_recompute`. The join doubles as the former
    `a.question_embedding IS NOT NULL` eligibility filter (a row only survives
    when a matching record_embeddings row exists); `re_a.embedding IS NOT NULL`
    /`re_b.embedding IS NOT NULL` in the WHERE clause is kept as a defensive
    belt-and-braces check, matching the precedent migration's own idiom.

    Each returned record carries both sides' survivor-decision inputs
    (publication_status, updated_at), a provenance snapshot column
    (source_form_response_id) and question_text (for the fingerprint).
    ID-145 {145.26} (post-{145.6} W1c): `source_workspace_id` is dropped —
    the write side no longer snapshots a form/workspace lineage id at all
    (`q_a_pair_dedup_proposals.pair_a/b_source_workspace_id` were dropped
    with no replacement column; lineage stays recoverable via the
    `pair_a_id`/`pair_b_id` FKs -> `q_a_pairs.source_form_instance_id`), so
    it is not selected here either. `a.id < b.id` matches the table's
    `CHECK (pair_a_id < pair_b_id)` canonical pair order, so
    `pair_a_id`/`pair_b_id` map straight through.
    """
    return await db_pool.fetch(
        """
        SELECT
            a.id                       AS pair_a_id,
            b.id                       AS pair_b_id,
            (1.0 - (re_a.embedding <=> re_b.embedding))::numeric(5,4)
                                       AS similarity_score,
            a.question_text            AS pair_a_question_text,
            b.question_text            AS pair_b_question_text,
            a.publication_status       AS pair_a_publication_status,
            b.publication_status       AS pair_b_publication_status,
            a.updated_at               AS pair_a_updated_at,
            b.updated_at               AS pair_b_updated_at,
            a.source_form_response_id  AS pair_a_source_form_response_id,
            b.source_form_response_id  AS pair_b_source_form_response_id
        FROM public.q_a_pairs a
        -- ID-127.32 (DR-036): eligibility filter (was
        -- `a.question_embedding IS NOT NULL`) — an INNER JOIN only produces a
        -- row when a matching record_embeddings row exists, mirroring
        -- q_a_search's re-pointed idiom
        -- (20260706170000_id131_qa_fns_record_embeddings_repoint.sql).
        JOIN public.record_embeddings re_a
          ON re_a.owner_kind = 'q_a_pair' AND re_a.owner_id = a.id AND re_a.model = $2
        JOIN public.q_a_pairs b
          ON a.id < b.id
        JOIN public.record_embeddings re_b
          ON re_b.owner_kind = 'q_a_pair' AND re_b.owner_id = b.id AND re_b.model = $2
        WHERE a.publication_status = 'published'
          AND b.publication_status = 'published'
          AND re_a.embedding IS NOT NULL
          AND re_b.embedding IS NOT NULL
          AND a.superseded_by IS NULL
          AND b.superseded_by IS NULL
          AND (1.0 - (re_a.embedding <=> re_b.embedding)) >= $1
        """,
        threshold,
        _EMBEDDING_MODEL,
    )


async def _select_resolved_fingerprints(
    db_pool: asyncpg.Pool,
) -> dict[tuple[UUID, UUID], tuple[str | None, str | None]]:
    """Read stored fingerprints of already-RESOLVED proposals (P-7 / INV-5).

    Returns a map `(pair_a_id, pair_b_id) -> (pair_a_fingerprint,
    pair_b_fingerprint)` for proposals whose status is NOT 'pending' (i.e.
    approved or rejected). A candidate pair already present here is SUPPRESSED
    unless either side's current fingerprint differs from the stored one (the
    question text changed) — see `_run_qa_dedup_proposer`. Pending proposals are
    NOT read: the ON CONFLICT DO NOTHING upsert already makes a re-run idempotent
    for them (INV-4), so no duplicate pending row is created.
    """
    rows = await db_pool.fetch(
        "SELECT pair_a_id, pair_b_id, pair_a_fingerprint, pair_b_fingerprint "
        "FROM public.q_a_pair_dedup_proposals "
        "WHERE status <> 'pending'"
    )
    return {
        (row["pair_a_id"], row["pair_b_id"]): (
            row["pair_a_fingerprint"],
            row["pair_b_fingerprint"],
        )
        for row in rows
    }


def _nominate_survivor(record: asyncpg.Record) -> tuple[UUID, str]:
    """Pick `proposed_survivor_id` + a human `survivor_reason` (INV-12).

    Policy order (TECH §P-2):
      (1) published > non-published — both candidate sides are 'published' by the
          candidate read, so this rung never separates them here; it is encoded
          for forward-compatibility if the read widens.
      (2) confidence/quality column if one exists — q_a_pairs has NO such column
          at v1, so this rung is inert (documented, not implemented).
      (3) recency — the side with the later `updated_at` wins.

    Ties (equal publication_status and equal updated_at) break deterministically
    on the smaller id == `pair_a_id` (canonical pair order), so the same pair
    always nominates the same survivor across runs.
    """
    a_id: UUID = record["pair_a_id"]
    b_id: UUID = record["pair_b_id"]
    a_pub: str = record["pair_a_publication_status"]
    b_pub: str = record["pair_b_publication_status"]
    a_updated = record["pair_a_updated_at"]
    b_updated = record["pair_b_updated_at"]

    # Rung (1): published outranks non-published.
    a_is_pub = a_pub == "published"
    b_is_pub = b_pub == "published"
    if a_is_pub != b_is_pub:
        if a_is_pub:
            return a_id, "survivor: published (the other side is not published)"
        return b_id, "survivor: published (the other side is not published)"

    # Rung (3): recency — later updated_at wins (rung (2) is inert at v1).
    if a_updated is not None and b_updated is not None and a_updated != b_updated:
        if a_updated > b_updated:
            return a_id, _recency_reason(a_updated)
        return b_id, _recency_reason(b_updated)

    # Deterministic tie-break: canonical pair order (pair_a_id is the smaller id).
    return a_id, "survivor: tie-break on canonical pair order (equal status and recency)"


def _recency_reason(updated_at: object) -> str:
    """Human survivor reason for the recency rung, DD/MM/YYYY (UK English)."""
    formatted = _format_date(updated_at)
    if formatted is None:
        return "survivor: more recent (later last-updated)"
    return f"survivor: more recent (updated {formatted})"


def _format_date(updated_at: object) -> str | None:
    """Format a timestamptz as DD/MM/YYYY, or None if not a datetime."""
    strftime = getattr(updated_at, "strftime", None)
    if strftime is None:
        return None
    try:
        return strftime("%d/%m/%Y")
    except (ValueError, TypeError):  # pragma: no cover — defensive
        return None


async def _run_qa_dedup_proposer(
    *,
    db_pool: asyncpg.Pool,
    flow_stage_counter: _FlowStageCounter,
) -> int:
    """Walk-time cross-workspace + cross-form Q&A dedup proposer (TECH §P-2).

    Reads the whole published embedding-bearing q_a_pairs corpus (cross-workspace
    / cross-form, INV-2/6/7), computes cosine candidate pairs via a SQL self-join
    (INV-3/21), nominates a survivor per pair (INV-12), and UPSERTs pending
    proposals to `q_a_pair_dedup_proposals` (INV-4) — skipping pairs already
    resolved unless their question text changed (P-7 / INV-5). NEVER writes
    `q_a_pairs` (publication_status / superseded_by) — the merge fires only on
    curator approval (app-side, {120.7}).

    Args:
      db_pool:             asyncpg pool (resolved env-scope via DB_CTX).
      flow_stage_counter:  Per-flow stage counter (bumped per proposal written).

    Returns:
      Count of NEW pending proposals written this run (ON CONFLICT DO NOTHING
      rows that landed). Suppressed / unchanged-resolved / conflicting candidates
      are not counted.
    """
    threshold = _resolve_cosine_threshold()

    # Step 1: candidate pairs (SQL self-join + cosine filter — INV-2/3/6/7/21).
    candidates = await _select_candidate_pairs(db_pool, threshold)
    if not candidates:
        return 0

    # Step 2: stored fingerprints of already-resolved proposals (P-7 / INV-5).
    resolved_fingerprints = await _select_resolved_fingerprints(db_pool)

    # Step 3: build the upsert rows (survivor + fingerprints + re-propose skip).
    upserts: list[tuple] = []
    for record in candidates:
        pair_a_id: UUID = record["pair_a_id"]
        pair_b_id: UUID = record["pair_b_id"]
        fingerprint_a = _fingerprint(record["pair_a_question_text"])
        fingerprint_b = _fingerprint(record["pair_b_question_text"])

        # Re-propose gate (P-7 / INV-5): a pair already RESOLVED is suppressed
        # UNLESS either side's question text changed (current fingerprint differs
        # from the stored one). An unchanged resolved pair never re-surfaces.
        stored = resolved_fingerprints.get((pair_a_id, pair_b_id))
        if stored is not None:
            stored_a, stored_b = stored
            if fingerprint_a == stored_a and fingerprint_b == stored_b:
                continue  # resolved + text unchanged → do not re-propose.

        survivor_id, survivor_reason = _nominate_survivor(record)
        upserts.append(
            (
                pair_a_id,
                pair_b_id,
                record["similarity_score"],
                survivor_id,
                survivor_reason,
                record["pair_a_source_form_response_id"],
                record["pair_b_source_form_response_id"],
                fingerprint_a,
                fingerprint_b,
            )
        )

    if not upserts:
        return 0

    # Step 4: UPSERT pending proposals. The table is UNIQUE(pair_a_id,
    # pair_b_id) — ONE row per pair (INV-4). The conflict action is a CONDITIONAL
    # upsert that reconciles the two cases the re-propose gate leaves:
    #   - NO existing row            → INSERT a fresh 'pending' proposal.
    #   - existing PENDING row       → the `WHERE status <> 'pending'` conflict
    #                                  guard makes this a NO-OP (idempotent: a
    #                                  re-run never duplicates a pending row, and
    #                                  never disturbs a curator-in-progress one).
    #   - existing RESOLVED row that the P-7 gate ADMITTED (fingerprint changed)
    #                                → RESET it to 'pending' with the current
    #                                  similarity / survivor / fingerprints, and
    #                                  CLEAR the prior resolution (re-propose).
    # A resolved row whose text is UNCHANGED never reaches here (skipped in
    # Step 3), so the `status <> 'pending'` guard only ever fires for a genuine
    # re-propose. Wrapped in a single transaction; exceptions propagate to the
    # flow's outer `except` (the P-3 attach re-wraps as
    # `_QaDedupProposerStageError`) — never swallowed. `created_at` defaults to
    # now() on INSERT and is left untouched on the re-propose UPDATE.
    written = 0
    async with db_pool.acquire() as conn:
        async with conn.transaction():
            for params in upserts:
                # `execute` returns the command tag: "INSERT 0 1" when a row was
                # inserted OR the conflict UPDATE landed (a re-propose), and
                # "INSERT 0 0" when the conflict WHERE excluded the update (an
                # existing pending row). Only count rows that actually landed.
                status = await conn.execute(
                    """
                    INSERT INTO public.q_a_pair_dedup_proposals (
                        pair_a_id, pair_b_id, similarity_score,
                        proposed_survivor_id, survivor_reason,
                        pair_a_source_form_response_id, pair_b_source_form_response_id,
                        pair_a_fingerprint, pair_b_fingerprint
                    )
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                    ON CONFLICT (pair_a_id, pair_b_id) DO UPDATE SET
                        status = 'pending',
                        similarity_score = EXCLUDED.similarity_score,
                        proposed_survivor_id = EXCLUDED.proposed_survivor_id,
                        survivor_reason = EXCLUDED.survivor_reason,
                        pair_a_source_form_response_id =
                            EXCLUDED.pair_a_source_form_response_id,
                        pair_b_source_form_response_id =
                            EXCLUDED.pair_b_source_form_response_id,
                        pair_a_fingerprint = EXCLUDED.pair_a_fingerprint,
                        pair_b_fingerprint = EXCLUDED.pair_b_fingerprint,
                        resolved_survivor_id = NULL,
                        resolved_by = NULL,
                        resolved_at = NULL
                    WHERE public.q_a_pair_dedup_proposals.status <> 'pending'
                    """,
                    *params,
                )
                if isinstance(status, str) and status.endswith(" 1"):
                    written += 1
                    flow_stage_counter.increment("qa_dedup_proposer")

    _logger.info(
        json.dumps(
            {
                "event": "cocoindex.qa_dedup.proposed",
                "candidate_pairs": len(candidates),
                "written": written,
                "threshold": threshold,
            }
        )
    )
    return written
