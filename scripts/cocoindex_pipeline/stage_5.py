"""Stage-5 entity-resolution post-pass for the canonical cocoindex pipeline.

Hosts the flow-scope cross-document canonicalisation phase that runs AFTER
the per-item `mount_each` fan-out has settled (Option B per PRODUCT Inv-1 /
TECH §P-1). The per-item phase (`ingest_file`, {53.11}) writes per-document
`canonical_name` values via `declare_row`; this post-pass reads the run's
`entity_mentions` rows, applies the legacy `entity_aliases` map (Inv-10),
invokes `cocoindex.ops.entity_resolution.resolve_entities` over the
per-document canonicals with the KH entity embedder (§P-7) + KH PairResolver
(§P-8), and issues op_id-scoped UPDATEs (Inv-5) for rows whose
`canonical_name` resolves to a different cross-document value.

bl-225: when two DISTINCT per-document canonicals in the SAME document resolve
to one cross-document value, the post-pass would have issued two UPDATEs to that
value and collided on UNIQUE(canonical_name, entity_type, source_document_id). The
resolution write-back therefore COLLAPSES each post-resolution collision group
to a single highest-confidence survivor (mirroring the DB function
`delete_duplicate_entity_mentions`) and DELETEs the losers (no FK dependents →
cascade-safe), DELETE-first so the survivor can UPDATE into a canonical a loser
currently holds without a transient collision.

ID-80.14 (S316 smoke D1) — Inv-5 boundary, stated honestly: the bl-225 collapse
above only ever sees the CURRENT op's rows, so a PRIOR-op (or NULL-op app-side)
row already holding a survivor's UPDATE-target key was structurally invisible
and the UPDATE collided walk-wide on any re-ingest with cross-op mention
history. Collision DETECTION is therefore widened to the exact planned target
keys regardless of op (`_select_prior_op_key_holders` — key-scoped read, never
the whole table), and the survivor rule (highest confidence, then smallest id)
extends across both ops. When the current-op survivor wins, the out-ranked
prior-op key-holder is removed via an explicit widened-predicate DELETE
(`op_id IS DISTINCT FROM $current`, id-pinned to the colliding row) — the ONE
deliberate exception to the otherwise op_id-scoped writes. Inv-5's intent (no
BLIND cross-run interference) is preserved: a foreign-op row is only ever read
or written here when it provably holds a key this run resolved into.

The module is consumed by `scripts/cocoindex_pipeline/flow.py:app_main`
(the §P-1 attach), invoked between `await handle.ready()` and the flow-end
`_emit_pipeline_run_webhook`. To avoid a runtime import cycle (flow.py imports
this module at top), the flow-side types (`FlowRunMeta`, `_FlowStageCounter`)
are imported under `TYPE_CHECKING` only — the function consumes them
structurally at runtime (`meta.op_id`, `flow_stage_counter.increment(...)`).
The cocoindex / embedder / resolver dependencies are lazy-imported inside
the function body, mirroring the lazy-import discipline in `pair_resolver.py`
and `entity_embedder.py` so pipeline unit tests can stub `cocoindex` at the
bare module level without dragging faiss / LiteLLM into module import.

References:
- `docs/specs/id-53-stage-5-entity-resolution/PRODUCT.md` — Inv-1, Inv-3,
  Inv-5, Inv-10, Inv-11, Inv-20.
- `docs/specs/id-53-stage-5-entity-resolution/TECH.md` §P-6 (function body),
  §P-1 (attach point).
- `scripts/cocoindex_pipeline/entity_embedder.py` — `KhEntityEmbedder` (§P-7).
- `scripts/cocoindex_pipeline/pair_resolver.py` — `KhPairResolver` (§P-8).
- `scripts/cocoindex_pipeline/flow.py:915` — the per-row embedding counter
  pattern this post-pass mirrors for `"entity_resolution"` (Inv-11).
"""

from __future__ import annotations

import json
import logging
from collections import defaultdict
from typing import TYPE_CHECKING
from uuid import UUID

if TYPE_CHECKING:  # pragma: no cover
    import asyncpg

    from scripts.cocoindex_pipeline._coco_api import ResolvedEntities
    from scripts.cocoindex_pipeline.flow import _FlowStageCounter
    from scripts.cocoindex_pipeline.flow_context import FlowRunMeta


# Module logger (mirrors flow.py's logger pattern). bl-225: a destructive DELETE
# in the Stage-5 collapse MUST be observable — see the structured log emitted
# after the transaction when loser rows are collapsed into a survivor.
_logger = logging.getLogger(__name__)


async def _preload_entity_aliases(db_pool: asyncpg.Pool) -> dict[str, str]:
    """Load the active legacy `entity_aliases` map (Inv-10).

    Returns a dict mapping `alias` -> `canonical` for every active row. The
    map is loaded once per Stage-5 pass (no module-level cache — each run gets
    a fresh snapshot, so an alias edited between runs takes effect on the next
    run). Applied to the per-document canonicals BEFORE `resolve_entities`
    runs so cross-document outputs stay consistent with what app-side callers
    see through `resolveAlias` (`lib/entities/entity-aliases.ts`).
    """
    rows = await db_pool.fetch(
        "SELECT alias, canonical FROM public.entity_aliases WHERE is_active = true"
    )
    return {row["alias"]: row["canonical"] for row in rows}


async def _select_run_entity_mentions(
    db_pool: asyncpg.Pool, op_id: UUID
) -> list[asyncpg.Record]:
    """Read this run's `entity_mentions` rows, op_id-scoped (Inv-5).

    Returns the rows the per-item phase wrote in this run (`id`,
    `canonical_name`, `entity_type`, `source_document_id`, `confidence`). Only
    op_id-matching rows are selected — NULL-op_id rows (app-side writes) and
    prior-run rows are NOT read here, so the post-pass never UPDATEs rows
    outside the in-flight run. (ID-80.14: cross-op COLLISION detection happens
    separately and key-scoped via `_select_prior_op_key_holders` — see the
    module header for the documented Inv-5 boundary.)

    bl-225: `source_document_id` is now SELECTed so the post-resolution collapse
    can group by the natural unique key (canonical_name, entity_type,
    source_document_id) — the constraint that crashed when two distinct per-doc
    canonicals in the SAME document resolved to one value. `confidence` is
    SELECTed so the survivor of a collision group is the highest-confidence row
    (mirroring `delete_duplicate_entity_mentions`).
    """
    return await db_pool.fetch(
        "SELECT id, canonical_name, entity_type, source_document_id, confidence "
        "FROM public.entity_mentions "
        "WHERE op_id = $1",
        op_id,
    )


async def _select_existing_canonical_roster(
    db_pool: asyncpg.Pool, entity_type: str, run_names: set[str]
) -> set[str]:
    """Op-agnostic existing-canonical roster for one entity_type, candidate-prefiltered.

    Reads DISTINCT canonical_name across ALL op_ids (prior-run rows + NULL-op_id
    app-side rows) for `entity_type` (ID-81 Inv-6), bounded to canonicals
    lexically plausible against this run's names (pg_trgm similarity OR
    exact case-fold), per ID-81 Inv-1/§4 PERF. Returns a SET for O(1)
    set-membership (the `is_existing_canonical` predicate, Inv-7 self-membership
    caveat: a name that is both 'existing' and 'in this run' is simply
    is_existing=True — pinned, never demoted). NOT a UNION with entity_aliases
    (Inv-12). Workspace-agnostic at v1 (Inv-9 — no workspace_id at Stage-5).

    `run_names` is the per-type set from `names_by_type[entity_type]`
    (`stage_5.py:180`, typed `dict[str, set[str]]`) — a set, NOT a list.
    """
    if not run_names:
        return set()
    probe = list(run_names)  # asyncpg ANY() binds a list; order irrelevant (set membership)
    rows = await db_pool.fetch(
        "SELECT DISTINCT canonical_name "
        "FROM public.entity_mentions "
        "WHERE entity_type = $1 "
        # SCHEMA-QUALIFIED operator: the asyncpg pool session search_path is the
        # default ("$user", public) — it does NOT include `extensions` (where
        # pg_trgm lives, §4), so a bare `%` is UNRESOLVABLE at runtime. Qualify
        # via OPERATOR(extensions.%) so the trigram operator resolves regardless
        # of search_path. (§6 HIGH-risk row — this is the safe form to copy.)
        "  AND ( canonical_name OPERATOR(extensions.%) ANY($2::text[]) "  # pg_trgm near-match
        "        OR lower(canonical_name) = ANY($3::text[]) )",            # exact case-fold
        entity_type,
        probe,
        [n.lower() for n in probe],
    )
    return {row["canonical_name"] for row in rows}


async def _select_prior_op_key_holders(
    db_pool: asyncpg.Pool,
    op_id: UUID,
    keys: list[tuple[str, str, UUID]],
) -> list[asyncpg.Record]:
    """Cross-op collision probe (ID-80.14): rows OUTSIDE the in-flight op that
    already hold a natural key a current-op survivor is about to UPDATE into.

    `keys` is the exact list of post-resolution `(canonical_name, entity_type,
    source_document_id)` targets the Step-5 collapse planned UPDATEs for. The read
    is op-AGNOSTIC by design — `op_id IS DISTINCT FROM $4` matches prior-op
    rows AND NULL-op_id app-side rows (both can hold the key and both made the
    S316 D1 collision invisible to the op-scoped `collision_groups`) — but it
    is scoped to EXACTLY those keys via the unnest join, never the whole table
    (preserving Inv-5's no-blind-cross-run-interference intent: a foreign-op
    row is only readable here when it provably holds a key this run is about
    to write).

    At most ONE row can hold each key (the UNIQUE constraint), so the result
    has at most `len(keys)` rows. Returns `id`, the key columns, and
    `confidence` so the caller can extend the deterministic survivor rule
    (highest confidence, then smallest id) across ops.
    """
    if not keys:
        return []
    return await db_pool.fetch(
        "SELECT em.id, em.canonical_name, em.entity_type, em.source_document_id, "
        "       em.confidence "
        "FROM public.entity_mentions em "
        "JOIN unnest($1::text[], $2::text[], $3::uuid[]) "
        "  AS k(canonical_name, entity_type, source_document_id) "
        "  ON em.canonical_name = k.canonical_name "
        " AND em.entity_type = k.entity_type "
        " AND em.source_document_id = k.source_document_id "
        "WHERE em.op_id IS DISTINCT FROM $4",
        [k[0] for k in keys],
        [k[1] for k in keys],
        [k[2] for k in keys],
        op_id,
    )


async def _run_stage_5_resolution(
    *,
    meta: FlowRunMeta,
    db_pool: asyncpg.Pool,
    flow_stage_counter: _FlowStageCounter,
) -> int:
    """Stage-5 post-pass: cross-document canonical resolution.

    PRODUCT.md §2 Area B + Area C + Area D: applies cocoindex
    `resolve_entities` over the run's `entity_mentions`, preloading the
    legacy `entity_aliases` map (Inv-10), and issuing op_id-scoped UPDATEs
    (Inv-5) for rows whose `canonical_name` resolves to a different
    cross-document value.

    Args:
      meta:                FlowRunMeta carrying the run's op_id (Inv-5 scope).
      db_pool:             asyncpg pool (resolved env-scope via DB_CTX).
      flow_stage_counter:  Per-flow stage counter (bumped per UPDATE per Inv-11).

    Returns:
      Count of entity_mentions rows whose canonical_name Stage-5 changed.
    """
    # Step 1: preload the legacy entity_aliases map (Inv-10).
    alias_map: dict[str, str] = await _preload_entity_aliases(db_pool)

    # Step 2: read the run's entity_mentions rows (op_id-scoped — Inv-5).
    rows = await _select_run_entity_mentions(db_pool, meta.op_id)
    if not rows:
        return 0

    # Step 3: apply alias map to the per-doc canonicals BEFORE resolve_entities.
    # Inv-10: outputs are consistent with legacy entity_aliases reads.
    # The row id is carried as its native uuid.UUID (NOT str()) so the Step-6
    # UPDATE bind satisfies asyncpg's strict uuid typing — see DEVIATION note.
    # bl-225: each tuple now also carries source_document_id + confidence so Step 5
    # can group by the post-resolution natural key and pick a deterministic
    # highest-confidence survivor per collision group.
    name_pairs: list[tuple[UUID, str, str, UUID, float | None]] = [
        (
            row["id"],
            alias_map.get(row["canonical_name"], row["canonical_name"]),
            row["entity_type"],
            row["source_document_id"],
            row["confidence"],
        )
        for row in rows
    ]

    # Step 4: invoke cocoindex resolve_entities — ONE CALL PER entity_type
    # group. resolve_entities is collection-level (faiss IP over Iterable[str]),
    # and the KhPairResolver cache key is (name_a, name_b, entity_type) per
    # P-OQ3 — so each entity_type batch gets a fresh resolver instance carrying
    # its entity_type. This keeps 'Cisco' as organisation independent of
    # 'Cisco' as technology in the cache (the explicit Inv-14 / P-OQ3 rationale).
    # Inv-3: cross-doc canonicalisation; Inv-21 v1 single-workspace scope is
    # naturally honoured because the run's rows come from one workspace.
    #
    # Lazy imports (mirrors pair_resolver.py / entity_embedder.py): keeps the
    # faiss + LiteLLM dependency chain out of module import so pipeline unit
    # tests can stub `cocoindex` at the bare-module level.
    from scripts.cocoindex_pipeline._coco_api import (  # noqa: PLC0415
        ExistingCanonicalPolicy,
        resolve_entities,
    )

    from scripts.cocoindex_pipeline.entity_embedder import (  # noqa: PLC0415
        KhEntityEmbedder,
    )
    from scripts.cocoindex_pipeline.pair_resolver import (  # noqa: PLC0415
        KhPairResolver,
    )

    # Group (alias_applied_canonical) by entity_type for per-type batches.
    names_by_type: dict[str, set[str]] = defaultdict(set)
    for _row_id, alias_applied_canonical, entity_type, _cid, _conf in name_pairs:
        names_by_type[entity_type].add(alias_applied_canonical)

    # ID-81 PC-1/PC-6/PC-7/PC-14 — existing-canonical seeding.
    #
    # For each entity_type, read the op-AGNOSTIC existing-canonical roster
    # (prior-run + NULL-op_id app-side canonicals lexically plausible against
    # this run's names — PC-6, Inv-6) and MERGE it into the resolver INPUT set
    # `names_by_type[entity_type]`. The seed strings become MEMBERS of the
    # `entities` iterable passed to resolve_entities (PC-14, Inv-14 determinism:
    # cocoindex's internal sorted(set(entities)) normalises pass_1 order across
    # runs). Under existing_policy=PINNED + the `is_existing_canonical`
    # set-membership predicate, a new in-flight mention near a seeded existing
    # chains UNDER it (PC-1, Inv-1), and the seeded existing is never demoted
    # (Inv-3/Inv-4).
    #
    # CRITICAL by-construction Inv-5 guarantee (PC-7/PC-11): the roster merges
    # into `names_by_type` ONLY — NEVER into `name_pairs` (the op_id-scoped
    # write-back domain). A seeded foreign-op canonical is READ (a string) but
    # its ROW is physically unreachable by the Step-6 DELETE/UPDATE (both retain
    # `AND op_id = $current`). Do NOT extend `name_pairs` with seed members.
    #
    # ID-81.9 INERT-SEEDING FIX: the roster reader (`_select_existing_canonical_
    # roster`) reads OP-AGNOSTICALLY from `entity_mentions`, and by Stage-5 time
    # the in-flight run's OWN rows are ALREADY in the table — so the roster
    # contains this run's own canonical names, each matching ITSELF. Left in the
    # roster, those self-memberships make the `is_existing_canonical` predicate
    # flag EVERY in-flight name `True`, pinning them in pass_1 so they NEVER enter
    # pass_2 (faiss-search-and-chain) — a run-2 near-match could then never chain
    # under a run-1 canonical (seeding inert cross-run). Subtract the run's own
    # names so the roster holds only FOREIGN (other-op + NULL-op) canonicals
    # BEFORE the `|=` merge: the merge still adds foreign canonicals as resolver-
    # input chain targets (PC-14), but in-flight names are no longer flagged
    # `is_existing`, so they re-enter pass_2 and chain. The write-back domain
    # (`name_pairs`) is untouched — Inv-5/Inv-7 by-construction guarantee holds.
    roster_by_type: dict[str, set[str]] = {}
    for entity_type in names_by_type:
        roster_by_type[entity_type] = (
            await _select_existing_canonical_roster(
                db_pool, entity_type, names_by_type[entity_type]
            )
        ) - names_by_type[entity_type]
        names_by_type[entity_type] |= roster_by_type[entity_type]

    # resolved_by_type maps entity_type -> ResolvedEntities for that batch.
    resolved_by_type: dict[str, ResolvedEntities] = {}
    for entity_type, names in names_by_type.items():
        resolved_by_type[entity_type] = await resolve_entities(
            # Seeds are MEMBERS of the `entities` iterable (PC-14) — passed
            # sorted for Inv-14 cross-run determinism; NEVER out-of-band.
            sorted(names),
            embedder=KhEntityEmbedder(),
            resolve_pair=KhPairResolver(
                db_pool=db_pool,
                op_id=meta.op_id,
                entity_type=entity_type,
            ),
            # PC-1 set-membership predicate. `_roster=...` DEFAULT-ARG binding
            # avoids the late-binding closure trap in this per-type loop (each
            # lambda captures ITS type's roster, not the loop's final value).
            is_existing_canonical=lambda name, _roster=roster_by_type[
                entity_type
            ]: name in _roster,
            existing_policy=ExistingCanonicalPolicy.PINNED,
        )

    # Step 5: walk ResolvedEntities.canonical_of() and GROUP by the
    # POST-resolution natural unique key (source_document_id, entity_type,
    # resolved). This is the bl-225 fix: `resolve_entities` resolves over a NAME
    # SET, agnostic of source_document_id, so two DISTINCT per-doc canonicals in
    # the SAME document (e.g. "eir 2004" + "environmental information
    # regulations 2004") can resolve to ONE value. The old row-by-row logic
    # then issued two UPDATEs to that value — the second collided with the first
    # on UNIQUE(canonical_name, entity_type, source_document_id) and crashed. We
    # instead collapse each collision group to a single survivor and DELETE the
    # losers (NO FK dependents reference entity_mentions → cascade-safe).
    #
    # NOTE (cocoindex 1.0.3 API fidelity): `canonical_of` returns `str` (the
    # name itself when already canonical) and raises KeyError for an unknown
    # name — it does NOT return None. Every name queried here was a member of
    # the `names_by_type` batch fed to `resolve_entities`, so it is guaranteed
    # present in the dedup map (no KeyError). The `is None` guard below realises
    # Inv-20 ("unresolved retains the per-document canonical") and is harmless
    # under 1.0.3 (canonical_of never returns None).
    #
    # group key (source_document_id, entity_type, resolved)
    #   -> [(row_id, alias_applied_canonical, confidence)]
    collision_groups: dict[
        tuple[UUID, str, str], list[tuple[UUID, str, float | None]]
    ] = defaultdict(list)
    for (
        row_id,
        alias_applied_canonical,
        entity_type,
        source_document_id,
        confidence,
    ) in name_pairs:
        resolved = resolved_by_type[entity_type].canonical_of(
            alias_applied_canonical
        )
        if resolved is None:
            resolved = alias_applied_canonical  # Inv-20: unresolved retains canonical.
        collision_groups[(source_document_id, entity_type, resolved)].append(
            (row_id, alias_applied_canonical, confidence)
        )

    # planned_updates carries the survivor's UPDATE target key components +
    # confidence so Step 5b (ID-80.14) can probe for cross-op key-holders and
    # extend the survivor rule across ops. Narrowed to (row_id, new_canonical)
    # for the Step-6 execution below.
    planned_updates: list[tuple[UUID, str, str, UUID, float | None]] = []
    deletes: list[UUID] = []  # current-op loser row ids collapsed into a survivor
    for (source_document_id, entity_type, resolved), members in collision_groups.items():
        # survivor: highest confidence, then smallest id (deterministic; mirrors
        # delete_duplicate_entity_mentions ORDER BY confidence DESC NULLS LAST,
        # created_at ASC — id is the deterministic proxy for created_at here
        # since the post-pass does not SELECT created_at).
        # Note: `(conf if conf is not None else -1.0)` — explicit None check,
        # NOT `conf or`, so a legitimate 0.0 confidence is not treated as missing.
        survivor_id, survivor_alias_applied, survivor_conf = min(
            members, key=lambda m: (-(m[2] if m[2] is not None else -1.0), m[0])
        )
        if survivor_alias_applied != resolved:  # PRESERVE original skip-condition
            planned_updates.append(
                (survivor_id, resolved, entity_type, source_document_id, survivor_conf)
            )
        for member_id, _aa, _conf in members:
            if member_id != survivor_id:
                deletes.append(member_id)

    # Step 5b (ID-80.14, S316 smoke D1): cross-op canonical-merge collision.
    # `collision_groups` only ever contains the CURRENT op's rows (Step 2 is
    # op_id-scoped), so a PRIOR-op (or NULL-op app-side) row already holding a
    # survivor's UPDATE-target key (canonical_name, entity_type,
    # source_document_id) is structurally invisible above — the survivor's UPDATE
    # would collide with it (UniqueViolationError, walk-wide failure on any
    # re-ingest with cross-op mention history). Widen collision DETECTION to
    # the exact planned target keys regardless of op (a key-scoped read — see
    # `_select_prior_op_key_holders`), and MERGE deterministically by
    # extending the established survivor rule (highest confidence, then
    # smallest id) across both ops:
    #   - prior-op key-holder wins → skip the UPDATE (the prior row already
    #     carries the target canonical) and collapse the current-op survivor
    #     into it via the op-SCOPED delete below;
    #   - current-op survivor wins → delete the prior-op key-holder via the
    #     explicit widened-predicate DELETE (`op_id IS DISTINCT FROM`,
    #     id-pinned to the colliding row) so the UPDATE lands collision-free.
    # Ranks can never tie: ids are unique. At most one holder exists per key
    # (the UNIQUE constraint); a survivor whose canonical is NOT changing
    # cannot cross-op-collide (it already holds its key).
    updates: list[tuple[UUID, str]] = []  # (row_id, new_canonical) that will land
    cross_op_deletes: list[UUID] = []  # prior-op/NULL-op key-holder ids out-ranked
    if planned_updates:
        prior_holders = await _select_prior_op_key_holders(
            db_pool,
            meta.op_id,
            [(u[1], u[2], u[3]) for u in planned_updates],
        )
        holders_by_key: dict[tuple[str, str, UUID], asyncpg.Record] = {
            (r["canonical_name"], r["entity_type"], r["source_document_id"]): r
            for r in prior_holders
        }
        for row_id, resolved, entity_type, source_document_id, conf in planned_updates:
            prior = holders_by_key.get((resolved, entity_type, source_document_id))
            if prior is None:
                updates.append((row_id, resolved))
                continue
            prior_conf = prior["confidence"]
            current_rank = (-(conf if conf is not None else -1.0), row_id)
            prior_rank = (
                -(prior_conf if prior_conf is not None else -1.0),
                prior["id"],
            )
            if prior_rank < current_rank:
                # Prior-op key-holder wins: skip the UPDATE; collapse the
                # current-op survivor into it (op-scoped DELETE — the row
                # belongs to this run, so Inv-5's write scope is untouched).
                deletes.append(row_id)
            else:
                # Current-op survivor wins: the prior-op key-holder is the
                # loser. Deleted via the widened-predicate DELETE below.
                cross_op_deletes.append(prior["id"])
                updates.append((row_id, resolved))

    # Step 6: DELETE-then-UPDATE batch in one transaction.
    # DELETE-FIRST IS LOAD-BEARING: a survivor may UPDATE INTO a canonical
    # currently held by a loser (in-op OR prior-op); deleting losers first
    # prevents that transient collision on UNIQUE(canonical_name, entity_type,
    # source_document_id).
    # Wrapped in a single transaction; exceptions propagate to the flow's outer
    # `except` (the §P-10 failure routing) — never swallowed (CLAUDE.md "no
    # silent failures").
    if updates or deletes or cross_op_deletes:
        async with db_pool.acquire() as conn:
            async with conn.transaction():
                if cross_op_deletes:
                    # ID-80.14 widened-predicate DELETE — the ONE deliberate
                    # exception to the op_id-scoped write rule (Inv-5). Each id
                    # here was selected by `_select_prior_op_key_holders` as
                    # the unique holder of an exact key this run's survivor is
                    # about to UPDATE into, and it LOST the deterministic
                    # cross-op survivor comparison. `op_id IS DISTINCT FROM`
                    # asserts the foreign-op/NULL-op provenance at the DB (a
                    # current-op id can never match), keeping the predicate
                    # honest about what it touches.
                    await conn.execute(
                        "DELETE FROM public.entity_mentions "
                        "WHERE id = ANY($1::uuid[]) "
                        "AND op_id IS DISTINCT FROM $2",
                        cross_op_deletes,
                        meta.op_id,
                    )
                if deletes:
                    # WHERE op_id = $2 — op_id scope is the forcing function
                    # (Inv-5); ids are native uuid.UUID (asyncpg-strict typing).
                    await conn.execute(
                        "DELETE FROM public.entity_mentions "
                        "WHERE id = ANY($1::uuid[]) AND op_id = $2",
                        deletes,
                        meta.op_id,
                    )
                for row_id, new_canonical in updates:
                    # WHERE id = $2 AND op_id = $3 — op_id scope is the forcing
                    # function (Inv-5); the row id is naturally scoped to this
                    # run because Step 2 selected by op_id. Both binds are
                    # native uuid.UUID objects (asyncpg-strict uuid typing).
                    await conn.execute(
                        "UPDATE public.entity_mentions "
                        "SET canonical_name = $1 "
                        "WHERE id = $2 AND op_id = $3",
                        new_canonical,
                        row_id,
                        meta.op_id,
                    )
                    # Step 7: per-row counter bump (Inv-11 PRODUCT elevation —
                    # mirrors the per-row embedding counter at flow.py:915).
                    flow_stage_counter.increment("entity_resolution")

    # Observability: a destructive DELETE must be visible. Emit a concise
    # structured log when any loser was collapsed (bl-225).
    if deletes:
        _logger.info(
            json.dumps(
                {
                    "event": "cocoindex.stage_5.collapsed",
                    "op_id": str(meta.op_id),
                    "collapsed_count": len(deletes),
                }
            )
        )
    # ID-80.14: the cross-op widened-predicate DELETE is MORE destructive than
    # the in-op collapse (it removes a row a PRIOR run wrote) — it must be
    # independently observable.
    if cross_op_deletes:
        _logger.info(
            json.dumps(
                {
                    "event": "cocoindex.stage_5.cross_op_collapsed",
                    "op_id": str(meta.op_id),
                    "cross_op_collapsed_count": len(cross_op_deletes),
                }
            )
        )

    # Return survivors whose canonical_name CHANGED (matches the Inv-11
    # counter's documented "canonical_name UPDATEs that landed"). Collapsed
    # losers are reported via the structured log above, not this count.
    return len(updates)
