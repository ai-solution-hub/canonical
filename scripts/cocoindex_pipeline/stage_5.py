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

from collections import defaultdict
from typing import TYPE_CHECKING
from uuid import UUID

if TYPE_CHECKING:  # pragma: no cover
    import asyncpg

    from scripts.cocoindex_pipeline._coco_api import ResolvedEntities
    from scripts.cocoindex_pipeline.flow import _FlowStageCounter
    from scripts.cocoindex_pipeline.flow_context import FlowRunMeta


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
    `canonical_name`, `entity_type`). Only op_id-matching rows are selected —
    NULL-op_id rows (app-side writes) and prior-run rows are NOT read here, so
    the post-pass never UPDATEs rows outside the in-flight run.
    """
    return await db_pool.fetch(
        "SELECT id, canonical_name, entity_type "
        "FROM public.entity_mentions "
        "WHERE op_id = $1",
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
    name_pairs: list[tuple[UUID, str, str]] = [
        (
            row["id"],
            alias_map.get(row["canonical_name"], row["canonical_name"]),
            row["entity_type"],
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
    for _row_id, alias_applied_canonical, entity_type in name_pairs:
        names_by_type[entity_type].add(alias_applied_canonical)

    # resolved_by_type maps entity_type -> ResolvedEntities for that batch.
    resolved_by_type: dict[str, ResolvedEntities] = {}
    for entity_type, names in names_by_type.items():
        resolved_by_type[entity_type] = await resolve_entities(
            sorted(names),
            embedder=KhEntityEmbedder(),
            resolve_pair=KhPairResolver(
                db_pool=db_pool,
                op_id=meta.op_id,
                entity_type=entity_type,
            ),
        )

    # Step 5: walk ResolvedEntities.canonical_of() — find UPDATE-eligible rows.
    # NOTE (cocoindex 1.0.3 API fidelity): `canonical_of` returns `str` (the
    # name itself when already canonical) and raises KeyError for an unknown
    # name — it does NOT return None. Every name queried here was a member of
    # the `names_by_type` batch fed to `resolve_entities`, so it is guaranteed
    # present in the dedup map (no KeyError). Inv-20 ("unresolved retains the
    # per-document canonical") is therefore realised by the `==` branch below:
    # an unresolved name resolves to itself, so no UPDATE fires. The `is None`
    # guard is retained for spec (§P-6) fidelity + forward-compatibility and is
    # harmless (canonical_of never returns None under 1.0.3).
    updates: list[tuple[UUID, str]] = []  # (row_id, new_canonical)
    for row_id, alias_applied_canonical, entity_type in name_pairs:
        resolved = resolved_by_type[entity_type]
        new_canonical = resolved.canonical_of(alias_applied_canonical)
        if new_canonical is None:
            continue  # Inv-20: unresolved retains per-doc canonical.
        if new_canonical == alias_applied_canonical:
            continue  # already-resolved-correct; no UPDATE needed.
        updates.append((row_id, new_canonical))

    # Step 6: op_id-scoped UPDATE batch (Inv-5).
    # Wrapped in a single transaction; exceptions propagate to the flow's outer
    # `except` (the §P-10 failure routing) — never swallowed (CLAUDE.md "no
    # silent failures").
    if updates:
        async with db_pool.acquire() as conn:
            async with conn.transaction():
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

    return len(updates)
