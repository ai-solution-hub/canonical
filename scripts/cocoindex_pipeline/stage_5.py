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
value and collided on UNIQUE(canonical_name, entity_type, content_item_id). The
resolution write-back therefore COLLAPSES each post-resolution collision group
to a single highest-confidence survivor (mirroring the DB function
`delete_duplicate_entity_mentions`) and DELETEs the losers (no FK dependents →
cascade-safe), DELETE-first so the survivor can UPDATE into a canonical a loser
currently holds without a transient collision.

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
    `canonical_name`, `entity_type`, `content_item_id`, `confidence`). Only
    op_id-matching rows are selected — NULL-op_id rows (app-side writes) and
    prior-run rows are NOT read here, so the post-pass never UPDATEs rows
    outside the in-flight run.

    bl-225: `content_item_id` is now SELECTed so the post-resolution collapse
    can group by the natural unique key (canonical_name, entity_type,
    content_item_id) — the constraint that crashed when two distinct per-doc
    canonicals in the SAME document resolved to one value. `confidence` is
    SELECTed so the survivor of a collision group is the highest-confidence row
    (mirroring `delete_duplicate_entity_mentions`).
    """
    return await db_pool.fetch(
        "SELECT id, canonical_name, entity_type, content_item_id, confidence "
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
    # bl-225: each tuple now also carries content_item_id + confidence so Step 5
    # can group by the post-resolution natural key and pick a deterministic
    # highest-confidence survivor per collision group.
    name_pairs: list[tuple[UUID, str, str, UUID, float | None]] = [
        (
            row["id"],
            alias_map.get(row["canonical_name"], row["canonical_name"]),
            row["entity_type"],
            row["content_item_id"],
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
    roster_by_type: dict[str, set[str]] = {}
    for entity_type in names_by_type:
        roster_by_type[entity_type] = await _select_existing_canonical_roster(
            db_pool, entity_type, names_by_type[entity_type]
        )
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
    # POST-resolution natural unique key (content_item_id, entity_type,
    # resolved). This is the bl-225 fix: `resolve_entities` resolves over a NAME
    # SET, agnostic of content_item_id, so two DISTINCT per-doc canonicals in
    # the SAME document (e.g. "eir 2004" + "environmental information
    # regulations 2004") can resolve to ONE value. The old row-by-row logic
    # then issued two UPDATEs to that value — the second collided with the first
    # on UNIQUE(canonical_name, entity_type, content_item_id) and crashed. We
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
    # group key (content_item_id, entity_type, resolved)
    #   -> [(row_id, alias_applied_canonical, confidence)]
    collision_groups: dict[
        tuple[UUID, str, str], list[tuple[UUID, str, float | None]]
    ] = defaultdict(list)
    for (
        row_id,
        alias_applied_canonical,
        entity_type,
        content_item_id,
        confidence,
    ) in name_pairs:
        resolved = resolved_by_type[entity_type].canonical_of(
            alias_applied_canonical
        )
        if resolved is None:
            resolved = alias_applied_canonical  # Inv-20: unresolved retains canonical.
        collision_groups[(content_item_id, entity_type, resolved)].append(
            (row_id, alias_applied_canonical, confidence)
        )

    updates: list[tuple[UUID, str]] = []  # (row_id, new_canonical) survivors that CHANGED
    deletes: list[UUID] = []  # loser row ids collapsed into the survivor
    for (content_item_id, entity_type, resolved), members in collision_groups.items():
        # survivor: highest confidence, then smallest id (deterministic; mirrors
        # delete_duplicate_entity_mentions ORDER BY confidence DESC NULLS LAST,
        # created_at ASC — id is the deterministic proxy for created_at here
        # since the post-pass does not SELECT created_at).
        # Note: `(conf if conf is not None else -1.0)` — explicit None check,
        # NOT `conf or`, so a legitimate 0.0 confidence is not treated as missing.
        survivor_id, survivor_alias_applied, _sc = min(
            members, key=lambda m: (-(m[2] if m[2] is not None else -1.0), m[0])
        )
        if survivor_alias_applied != resolved:  # PRESERVE original skip-condition
            updates.append((survivor_id, resolved))
        for member_id, _aa, _conf in members:
            if member_id != survivor_id:
                deletes.append(member_id)

    # Step 6: op_id-scoped DELETE-then-UPDATE batch (Inv-5).
    # DELETE-FIRST IS LOAD-BEARING: a survivor may UPDATE INTO a canonical
    # currently held by a loser; deleting losers first prevents that transient
    # collision on UNIQUE(canonical_name, entity_type, content_item_id).
    # Wrapped in a single transaction; exceptions propagate to the flow's outer
    # `except` (the §P-10 failure routing) — never swallowed (CLAUDE.md "no
    # silent failures").
    if updates or deletes:
        async with db_pool.acquire() as conn:
            async with conn.transaction():
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

    # Return survivors whose canonical_name CHANGED (matches the Inv-11
    # counter's documented "canonical_name UPDATEs that landed"). Collapsed
    # losers are reported via the structured log above, not this count.
    return len(updates)
