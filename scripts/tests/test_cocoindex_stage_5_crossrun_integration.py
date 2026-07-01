"""GATED cross-run integration shells for Stage-5 existing-canonical seeding.

WHY GATED (read before un-gating)
---------------------------------
These tests prove the END-TO-END cross-run consequence of ID-81 seeding that the
real-body unit tests (`test_cocoindex_stage_5_resolution.py`) cannot: TWO real
pipeline runs against a live Postgres (distinct op_ids) converging on ONE
canonical, a PINNED override of a longer name by run 2, NULL-op_id chaining, and
`full_reprocess` byte-for-byte idempotency (TECH §5 Inv-2/Inv-3/Inv-6-NULLop/
Inv-14).

They require TWO real pipeline runs against a DB and MUST NOT run against the
parent's shared staging branch. Per TECH §5
"Integration-test guard", they are tagged for a CONTROLLED run (a local Supabase
stack or a dedicated ephemeral branch) the parent orchestrates — NEVER as part
of the default `python3 -m pytest scripts/tests/` sweep, and NEVER against
shared staging.

GATING MECHANISM
----------------
Every test is `@pytest.mark.skipif(not os.getenv("KH_RUN_STAGE5_INTEGRATION"))`,
so by default pytest COLLECTS them (they appear in the run as `s`/SKIPPED) but
NEVER executes them. The asyncpg connection is created INSIDE each test function
(never at import/collection time) so collection touches no DB and reads no
connection string. To run them in a controlled environment, set
`KH_RUN_STAGE5_INTEGRATION=1` AND point `KH_STAGE5_INTEGRATION_DSN` at a
DISPOSABLE database (local stack / ephemeral branch) — NOT shared staging.

These are authored shells: the structure, fixtures, and assertions encode the
acceptance criteria so the controlled-run operator can fill the run-harness
plumbing (two `app_main` invocations / two op_ids over the same corpus) without
re-deriving the proof obligations. Each body raises a clear NotImplementedError
guiding the operator, so an accidental un-gate fails loudly rather than silently
passing a hollow test.

References:
- `docs/specs/ID-81-canonical-stability/TECH.md` §5 (the per-invariant table;
  the integration rows are Inv-2/Inv-3/Inv-6-NULLop/Inv-14) + §5 guard note.
- `docs/specs/ID-81-canonical-stability/PRODUCT.md` Inv-2, Inv-3, Inv-6, Inv-14.
"""

from __future__ import annotations

import asyncio
import os
import uuid

import pytest

# ── Gate (collected-but-skipped by default) ───────────────────────────────────
#
# CONTROLLED-RUN ONLY. The reason string names the shared-staging prohibition so
# a future reader cannot miss why the gate exists.
_INTEGRATION_ENABLED = bool(os.getenv("KH_RUN_STAGE5_INTEGRATION"))
_SKIP_REASON = (
    "cross-run integration — controlled DB run only, not shared staging. "
    "Set KH_RUN_STAGE5_INTEGRATION=1 + "
    "KH_STAGE5_INTEGRATION_DSN=<disposable-db> to enable (ID-81 TECH §5)."
)

# Module-level guard: even when collected, the heavy run-harness import below is
# deferred into each test body so collection never touches a DB or asyncpg.
pytestmark = pytest.mark.skipif(not _INTEGRATION_ENABLED, reason=_SKIP_REASON)


def _require_disposable_dsn() -> str:
    """Return the disposable-DB DSN, refusing the shared staging branch.

    Called INSIDE a test body (never at import/collection). Fails loudly if the
    DSN is missing or points at shared staging — the safety interlock that makes
    an accidental un-gate against staging impossible.
    """
    dsn = os.getenv("KH_STAGE5_INTEGRATION_DSN")
    if not dsn:
        raise RuntimeError(
            "KH_STAGE5_INTEGRATION_DSN is unset — refusing to guess a DB. Point "
            "it at a DISPOSABLE local stack or ephemeral branch (NOT staging)."
        )
    shared_staging_ref = os.getenv("STAGING_PROJECT_REF")
    if shared_staging_ref and shared_staging_ref in dsn:
        raise RuntimeError(
            "KH_STAGE5_INTEGRATION_DSN points at the SHARED STAGING branch "
            "(STAGING_PROJECT_REF) — these cross-run integration tests MUST NOT "
            "run against shared staging (ID-81 TECH §5). Use a disposable DB."
        )
    return dsn


# ── Real-asyncpg run harness ({81.9} live cross-run proof) ────────────────────
#
# The shells were authored for an operator wiring TWO full `app_main` invocations.
# {81.9} fills them with a LEANER but faithful harness: instead of running the
# full Stage 1-4 extraction (binary conversion, chunking, LLM classification,
# embedding of content) we seed `entity_mentions` rows DIRECTLY per op_id — the
# exact rows the per-item `ingest_file` phase would have written — then drive the
# REAL `_run_stage_5_resolution(meta, db_pool, flow_stage_counter)` once per run.
# That isolates the Stage-5 cross-run seeding behaviour (the only thing ID-81
# touches) while exercising the REAL resolver dependencies: OpenAI embeddings
# (`KhEntityEmbedder`) + the Anthropic pair-resolver (`KhPairResolver`) + live
# pg_trgm. `entity_mentions` carries NO foreign key to `content_items` (verified
# against the live schema), so seeded rows need no parent content_items row.
#
# Realistic near-match fixtures (NOT the spec's literal "eir 2004" example, whose
# embedding cosine ~0.49 is BELOW the 0.7 faiss threshold so it would never chain):
# case/punctuation variants of ONE entity that genuinely near-match under
# text-embedding-3-large (empirically: "ISO 27001"~"iso 27001" dist 0.06,
# ~"ISO-27001" dist 0.04; "Cyber Essentials"~"Cyber Essentials Plus" dist 0.12 —
# all well inside max_distance=0.3) and pass the pg_trgm prefilter (similarity
# >= 0.3). Each test uses a UNIQUE source_document_id + a scoped cleanup so reruns
# are idempotent.

class _StageCounter:
    """Structural `_FlowStageCounter` stand-in — the function only calls
    `increment(stage)` (mirrors the unit-suite `_StubStageCounter`)."""

    def __init__(self) -> None:
        self.counts: dict[str, int] = {}

    def increment(self, stage: str) -> None:
        self.counts[stage] = self.counts.get(stage, 0) + 1


async def _seed_mention(
    conn,  # type: ignore[no-untyped-def]
    *,
    canonical: str,
    entity_type: str,
    source_document_id: uuid.UUID,
    op_id: uuid.UUID | None,
    confidence: float = 0.9,
) -> uuid.UUID:
    """INSERT one `entity_mentions` row exactly as the per-item phase would.

    `entity_name` is set to the canonical (the per-doc phase writes the same
    string into both before any cross-doc resolution). Returns the row id.
    """
    row_id = uuid.uuid4()
    await conn.execute(
        "INSERT INTO public.entity_mentions "
        "(id, source_document_id, entity_type, entity_name, canonical_name, "
        " confidence, op_id) "
        "VALUES ($1, $2, $3, $4, $5, $6, $7)",
        row_id,
        source_document_id,
        entity_type,
        canonical,
        canonical,
        confidence,
        op_id,
    )
    return row_id


async def _run_stage5(pool, op_id: uuid.UUID) -> int:  # type: ignore[no-untyped-def]
    """Drive the REAL `_run_stage_5_resolution` for one op_id over the seeded rows.

    Imports inside the body (never at collection) so an un-gated collection never
    drags cocoindex / asyncpg / the resolver chain into import. Uses the REAL
    `FlowRunMeta` (the production type the function consumes) + a structural stage
    counter. The resolver dependencies (embedder + pair-resolver) are the REAL
    collaborators — OpenAI + Anthropic keys come from the loaded `.env.local`.
    """
    from scripts.cocoindex_pipeline.flow_context import FlowRunMeta
    from scripts.cocoindex_pipeline.stage_5 import _run_stage_5_resolution

    return await _run_stage_5_resolution(
        meta=FlowRunMeta(op_id=op_id),
        db_pool=pool,
        flow_stage_counter=_StageCounter(),
    )


async def _cleanup(conn, entity_type: str, names: list[str]) -> None:  # type: ignore[no-untyped-def]
    """Scoped delete so reruns are idempotent — removes the test's own
    entity_mentions rows AND its entity_pair_resolutions cache rows.

    The pair-cache MUST be cleared too: a leftover cache row would let a rerun
    replay a prior decision instead of re-invoking the LLM, which is correct for
    Inv-14 (idempotency) but would mask a fresh-decision regression in the OTHER
    tests. Clearing both keeps each test hermetic.
    """
    await conn.execute(
        "DELETE FROM public.entity_mentions "
        "WHERE entity_type = $1 AND canonical_name = ANY($2::text[])",
        entity_type,
        names,
    )
    await conn.execute(
        "DELETE FROM public.entity_pair_resolutions "
        "WHERE entity_type = $1 "
        "AND (name_a = ANY($2::text[]) OR name_b = ANY($2::text[]))",
        entity_type,
        names,
    )


# ── Inv-2: same entity across two runs → one canonical ────────────────────────


def test_crossrun_same_entity_converges_to_one_canonical() -> None:
    """Inv-2: the same entity + entity_type ingested in run 1 and run 2 (distinct
    op_ids) carries ONE canonical_name after both runs complete — the value run 1
    first materialised.

    Operator harness (controlled run): ingest a corpus producing a canonical of
    one entity_type in run 1 (op_id A); ingest a corpus whose per-doc canonical is
    a near-match of run 1's canonical in run 2 (op_id B); after both
    `pipeline_runs.status='completed'`, assert `SELECT DISTINCT canonical_name
    FROM entity_mentions WHERE entity_type = $1 AND canonical_name IN (run1, run2)`
    returns exactly ONE value (run 1's pinned canonical).
    """
    dsn = _require_disposable_dsn()

    async def _body() -> None:
        import asyncpg

        entity_type = "standard"
        # ONE entity, two runs. Run 1 materialises "ISO 27001"; run 2's per-doc
        # canonical is the case-fold near-match "iso 27001" (dist 0.06 < 0.3).
        run1_canonical = "ISO 27001"
        run2_perdoc = "iso 27001"
        op1 = uuid.uuid4()
        op2 = uuid.uuid4()
        cid1 = uuid.uuid4()
        cid2 = uuid.uuid4()
        all_names = [run1_canonical, run2_perdoc]

        pool = await asyncpg.create_pool(dsn, min_size=1, max_size=4)
        try:
            async with pool.acquire() as conn:
                await _cleanup(conn, entity_type, all_names)
                await _seed_mention(
                    conn,
                    canonical=run1_canonical,
                    entity_type=entity_type,
                    source_document_id=cid1,
                    op_id=op1,
                )

            # Run 1: resolves its own single row (unique → resolves to itself,
            # materialising "ISO 27001" as the prior-run canonical).
            await _run_stage5(pool, op1)

            # Run 2: seed the near-match, then resolve op2. The op-agnostic roster
            # surfaces run 1's "ISO 27001"; PINNED chains run 2's near-match under
            # it. (Pre-fix this would self-pin and NOT chain — the inert defect.)
            async with pool.acquire() as conn:
                await _seed_mention(
                    conn,
                    canonical=run2_perdoc,
                    entity_type=entity_type,
                    source_document_id=cid2,
                    op_id=op2,
                )
            changed = await _run_stage5(pool, op2)

            async with pool.acquire() as conn:
                distinct = await conn.fetch(
                    "SELECT DISTINCT canonical_name FROM public.entity_mentions "
                    "WHERE entity_type = $1 AND canonical_name = ANY($2::text[])",
                    entity_type,
                    all_names,
                )
                # The run-2 row's post-resolution canonical.
                run2_canonical = await conn.fetchval(
                    "SELECT canonical_name FROM public.entity_mentions "
                    "WHERE op_id = $1",
                    op2,
                )

            values = {r["canonical_name"] for r in distinct}
            assert values == {run1_canonical}, (
                "the same entity across two runs must carry ONE canonical (run 1's "
                f"'{run1_canonical}'); got {values}. Two values means run 2 "
                "self-pinned instead of chaining (the inert-seeding defect)."
            )
            assert run2_canonical == run1_canonical, (
                "run 2's row chained UNDER run 1's canonical"
            )
            assert changed == 1, "exactly one canonical UPDATE landed in run 2"
        finally:
            async with pool.acquire() as conn:
                await _cleanup(conn, entity_type, all_names)
            await pool.close()

    asyncio.run(_body())


# ── Inv-3: PINNED override of a longer name (prior-run canonical never demoted) ─


def test_crossrun_pinned_override_of_longer_name() -> None:
    """Inv-3: run 1 pins the short canonical "eir 2004"; run 2's longer per-doc
    canonical "environmental information regulations 2004" chains UNDER it; the
    prior-run row is byte-for-byte unchanged (PINNED never demotes the existing).

    Operator harness: run 1 ingests a doc yielding canonical "eir 2004" (op_id A);
    snapshot that row's columns. Run 2 ingests a doc whose per-doc canonical is the
    longer form (op_id B). After run 2 completes, assert run 2's row carries
    "eir 2004" (chained under the shorter PINNED existing, NOT the reverse) and the
    run-1 row is unchanged (Inv-3 + Inv-7 write-scope).
    """
    dsn = _require_disposable_dsn()

    async def _body() -> None:
        import asyncpg

        entity_type = "standard"
        # Run 1 pins the SHORTER canonical; run 2's per-doc canonical is the
        # LONGER near-match. KhPairResolver's own canonical preference is "longer
        # name wins" (max(key=len)) — but PINNED OVERRIDES it: the existing
        # (shorter) wins, so run 2 chains UNDER the short name. This is the
        # load-bearing Inv-3 proof — the longer run-2 name does NOT demote/rename
        # the prior-run canonical.
        #
        # Fixture choice (deliberate): "ISO 27001" -> "ISO 27001 standard" is a
        # genuine SAME-entity longer variant (LLM pair-resolver returns "same",
        # empirically), embedding dist 0.12 (< 0.3 faiss gate), AND pg_trgm
        # similarity 0.53 (>= 0.3) so the op-agnostic roster reader actually
        # recalls the short canonical. (A pair like "Cyber Essentials" ->
        # "Cyber Essentials Plus" is REJECTED here — the LLM correctly resolves it
        # "different" because Cyber Essentials Plus is a distinct higher tier; and
        # "NIST CSF" -> "NIST Cybersecurity Framework" is rejected too — trigram
        # similarity 0.19 < 0.3 means the prefilter would MISS it, the documented
        # TECH §4 recall envelope. The chosen pair clears all three gates.)
        short_canonical = "ISO 27001"
        long_perdoc = "ISO 27001 standard"
        op1 = uuid.uuid4()
        op2 = uuid.uuid4()
        cid1 = uuid.uuid4()
        cid2 = uuid.uuid4()
        all_names = [short_canonical, long_perdoc]

        pool = await asyncpg.create_pool(dsn, min_size=1, max_size=4)
        try:
            async with pool.acquire() as conn:
                await _cleanup(conn, entity_type, all_names)
                run1_id = await _seed_mention(
                    conn,
                    canonical=short_canonical,
                    entity_type=entity_type,
                    source_document_id=cid1,
                    op_id=op1,
                    confidence=0.95,
                )
            await _run_stage5(pool, op1)

            # Snapshot ALL columns of the run-1 row AFTER run 1 (its settled state)
            # to assert byte-for-byte invariance across run 2 (Inv-3 + Inv-7).
            async with pool.acquire() as conn:
                before = await conn.fetchrow(
                    "SELECT id, source_document_id, entity_type, entity_name, "
                    "canonical_name, confidence, op_id, normalisation_version, "
                    "metadata FROM public.entity_mentions WHERE id = $1",
                    run1_id,
                )
                await _seed_mention(
                    conn,
                    canonical=long_perdoc,
                    entity_type=entity_type,
                    source_document_id=cid2,
                    op_id=op2,
                    confidence=0.9,
                )
            changed = await _run_stage5(pool, op2)

            async with pool.acquire() as conn:
                after = await conn.fetchrow(
                    "SELECT id, source_document_id, entity_type, entity_name, "
                    "canonical_name, confidence, op_id, normalisation_version, "
                    "metadata FROM public.entity_mentions WHERE id = $1",
                    run1_id,
                )
                run2_canonical = await conn.fetchval(
                    "SELECT canonical_name FROM public.entity_mentions "
                    "WHERE op_id = $1",
                    op2,
                )

            assert run2_canonical == short_canonical, (
                f"run 2's LONGER per-doc canonical '{long_perdoc}' must chain UNDER "
                f"run 1's SHORTER pinned canonical '{short_canonical}' (PINNED "
                "overrides KhPairResolver's longer-name-wins preference); got "
                f"'{run2_canonical}'"
            )
            assert dict(after) == dict(before), (
                "the prior-run (run 1) row must be byte-for-byte unchanged — PINNED "
                "never demotes/renames the existing, and the write-back is "
                f"op_id-scoped (Inv-3 + Inv-7). before={dict(before)} "
                f"after={dict(after)}"
            )
            assert changed == 1, "exactly one canonical UPDATE landed (run 2's row)"
        finally:
            async with pool.acquire() as conn:
                await _cleanup(conn, entity_type, all_names)
            await pool.close()

    asyncio.run(_body())


# ── Inv-6 (NULL-op_id case): app-side canonical is an eligible chaining target ──


def test_crossrun_null_op_id_canonical_chains() -> None:
    """Inv-6 (NULL-op_id arm): a canonical written app-side with NULL op_id
    (`classifyContent` / Admin curation) is an eligible chaining target — a
    later run's near-match chains under it (op-AGNOSTIC roster read).

    Operator harness: INSERT an entity_mentions row with NULL op_id and a known
    canonical (the app-side write shape). Then run a pipeline pass (op_id A) whose
    per-doc canonical near-matches the NULL-op row. After completion, assert the
    run's row carries the NULL-op canonical (chained under it) and the NULL-op row
    is byte-for-byte unchanged (READ op-agnostic, WRITE op_id-scoped — Inv-7/11).
    """
    dsn = _require_disposable_dsn()

    async def _body() -> None:
        import asyncpg

        entity_type = "standard"
        # The app-side write: a canonical with NULL op_id (classifyContent / Admin
        # curation shape). The op-agnostic roster reader must surface it as an
        # eligible chaining target despite carrying no op_id.
        null_op_canonical = "ISO 27001"
        run_perdoc = "ISO-27001"  # punctuation variant, dist 0.04 < 0.3
        op_a = uuid.uuid4()
        cid_null = uuid.uuid4()
        cid_run = uuid.uuid4()
        all_names = [null_op_canonical, run_perdoc]

        pool = await asyncpg.create_pool(dsn, min_size=1, max_size=4)
        try:
            async with pool.acquire() as conn:
                await _cleanup(conn, entity_type, all_names)
                null_op_id = await _seed_mention(
                    conn,
                    canonical=null_op_canonical,
                    entity_type=entity_type,
                    source_document_id=cid_null,
                    op_id=None,  # NULL op_id — the app-side write shape
                    confidence=0.99,
                )
                before = await conn.fetchrow(
                    "SELECT id, source_document_id, entity_type, entity_name, "
                    "canonical_name, confidence, op_id, normalisation_version, "
                    "metadata FROM public.entity_mentions WHERE id = $1",
                    null_op_id,
                )
                run_id = await _seed_mention(
                    conn,
                    canonical=run_perdoc,
                    entity_type=entity_type,
                    source_document_id=cid_run,
                    op_id=op_a,
                    confidence=0.8,
                )

            changed = await _run_stage5(pool, op_a)

            async with pool.acquire() as conn:
                after = await conn.fetchrow(
                    "SELECT id, source_document_id, entity_type, entity_name, "
                    "canonical_name, confidence, op_id, normalisation_version, "
                    "metadata FROM public.entity_mentions WHERE id = $1",
                    null_op_id,
                )
                run_canonical = await conn.fetchval(
                    "SELECT canonical_name FROM public.entity_mentions WHERE id = $1",
                    run_id,
                )

            assert run_canonical == null_op_canonical, (
                f"the run's near-match '{run_perdoc}' must chain UNDER the NULL-op_id "
                f"app-side canonical '{null_op_canonical}' (op-AGNOSTIC roster read "
                f"— Inv-6 NULL-op arm); got '{run_canonical}'"
            )
            assert dict(after) == dict(before), (
                "the NULL-op_id row must be byte-for-byte unchanged: READ "
                "op-agnostic, WRITE op_id-scoped — the write-back's `AND op_id = "
                "$current` predicate never matches a NULL op_id (Inv-7/Inv-11). "
                f"before={dict(before)} after={dict(after)}"
            )
            assert changed == 1
        finally:
            async with pool.acquire() as conn:
                await _cleanup(conn, entity_type, all_names)
            await pool.close()

    asyncio.run(_body())


# ── Inv-14: full_reprocess byte-for-byte idempotency ──────────────────────────


def test_crossrun_full_reprocess_idempotent_mapping() -> None:
    """Inv-14: re-running Stage-5 over the same corpus via `full_reprocess`
    produces the SAME canonical mapping — the set of (per-document-name →
    resolved-canonical) pairs in run 2 matches run 1 byte-for-byte.

    Operator harness: run 1 ingests a corpus that triggers seeding-based chaining
    (op_id A); capture the (per-doc-name → resolved-canonical) pair set. Trigger a
    `full_reprocess` (op_id B) over the SAME corpus; capture its pair set. Assert
    the two pair sets are equal (no cross-run flip — PINNED + the KhPairResolver
    determinism cache + seed-set order normalisation via sorted(entities)).
    """
    dsn = _require_disposable_dsn()

    async def _body() -> None:
        import asyncpg

        entity_type = "standard"
        # A corpus whose per-doc canonicals trigger chaining WITHIN the run: two
        # near-match variants of one entity (each in its OWN content item so the
        # collapse does not fire — we want chaining, not same-doc collapse). The
        # resolver chains them to one canonical; full_reprocess must reproduce the
        # SAME (per-doc-name → resolved-canonical) mapping byte-for-byte.
        perdoc_names = ["ISO 27001", "iso 27001", "ISO-27001"]
        all_names = list(perdoc_names)

        async def _seed_run(conn, op_id: uuid.UUID):  # type: ignore[no-untyped-def]
            """Seed one row per per-doc name (distinct content items) for a run."""
            ids: dict[str, uuid.UUID] = {}
            for i, name in enumerate(perdoc_names):
                ids[name] = await _seed_mention(
                    conn,
                    canonical=name,
                    entity_type=entity_type,
                    source_document_id=uuid.uuid4(),
                    op_id=op_id,
                    # Distinct confidences so any collapse tie-break is deterministic
                    # (none expected here — distinct content items).
                    confidence=0.9 - i * 0.01,
                )
            return ids

        async def _capture_mapping(conn, seed_ids):  # type: ignore[no-untyped-def]
            """Build {original per-doc name -> post-resolution canonical} for a run."""
            mapping: dict[str, str] = {}
            for name, row_id in seed_ids.items():
                resolved = await conn.fetchval(
                    "SELECT canonical_name FROM public.entity_mentions WHERE id = $1",
                    row_id,
                )
                # A collapse could DELETE a loser row (resolved is None then). None
                # of these names share a content item, so no collapse — but guard.
                mapping[name] = resolved
            return mapping

        pool = await asyncpg.create_pool(dsn, min_size=1, max_size=4)
        try:
            async with pool.acquire() as conn:
                await _cleanup(conn, entity_type, all_names)

            # ── Run 1 (op_id A) ──
            op1 = uuid.uuid4()
            async with pool.acquire() as conn:
                ids1 = await _seed_run(conn, op1)
            await _run_stage5(pool, op1)
            async with pool.acquire() as conn:
                mapping1 = await _capture_mapping(conn, ids1)

            # ── full_reprocess (op_id B): same corpus, fresh op. Delete run-1's
            # entity_mentions (what full_reprocess does — re-extract replaces the
            # rows) but KEEP the entity_pair_resolutions cache (the cross-run
            # determinism mechanism — Inv-14). Re-seed the IDENTICAL per-doc names.
            async with pool.acquire() as conn:
                await conn.execute(
                    "DELETE FROM public.entity_mentions "
                    "WHERE entity_type = $1 AND canonical_name = ANY($2::text[])",
                    entity_type,
                    all_names,
                )
                op2 = uuid.uuid4()
                ids2 = await _seed_run(conn, op2)
            await _run_stage5(pool, op2)
            async with pool.acquire() as conn:
                mapping2 = await _capture_mapping(conn, ids2)

            assert mapping1 == mapping2, (
                "full_reprocess must reproduce the SAME (per-doc-name -> resolved-"
                "canonical) mapping byte-for-byte (Inv-14): PINNED + the persistent "
                "KhPairResolver determinism cache + cocoindex's sorted(set(entities)) "
                f"order normalisation. run1={mapping1} run2={mapping2}"
            )
            # And the mapping is non-trivial: at least one name chained to another
            # (otherwise idempotency would be vacuous).
            assert len(set(mapping1.values())) < len(perdoc_names), (
                "the corpus must actually chain (a non-trivial mapping) for the "
                f"idempotency proof to be meaningful; got {mapping1}"
            )
        finally:
            async with pool.acquire() as conn:
                await _cleanup(conn, entity_type, all_names)
            await pool.close()

    asyncio.run(_body())
