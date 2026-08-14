"""Entity resolution + declaration — Phases B and C of the ingest flow.

Phase B: per-entity-type resolution via upstream `resolve_entities` +
`LlmPairResolver`, seeded with prior canonicals + admin pins via
`is_existing_canonical` (DR-140/DR-147/DR-105 held by upstream API, not
ported machinery — id-434 TECH.md §2.3's seed-set shape).

Phase C: a single corpus-wide pass collapses candidates and declares
canonical-keyed `entity_mentions`/`entity_relationships` rows. `em:` ids
follow id-434 TECH.md §2.4 (ratified, landed — registry-keyed on the
RESOLVED canonical, superseding SEED-CONTRACT.md §4's old per-document
formula for this row class). `er:` ids stay on SEED-CONTRACT.md §4's
accepted rel_path-keyed F4 gap — the registry-keyed reshape is id-435,
still `backlog`. Neither is in `identity.py`'s frozen citable set
(DESIGN.md §4 scopes that module to ONLY sd:/chunk:/qa:/ri:):
`entity_mentions`/`entity_relationships` are engine-declared and
orphan-cleaned, not permanently-frozen citation targets.

This module has NO dependency on `ingest.main` — every cross-cutting
resource (`pool`, `embedder`, `resolve_pair`) is an explicit parameter
rather than an ambient `coco.use_context` read. That is not just import-
cycle hygiene: it is the fix for a Coordinator-caught DR-105 defect (see
`_resolve_type_group`'s docstring) — a value fetched from inside a
`memo=True` body is invisible to the memo key, so a seed change would not
invalidate a stale memoized resolution.
"""

from __future__ import annotations

import asyncio
import uuid
from dataclasses import dataclass, field

import asyncpg
import cocoindex as coco
from cocoindex.connectors import postgres
from cocoindex.ops.entity_resolution import (
    ExistingCanonicalPolicy,
    PairResolver,
    ResolvedEntities,
    resolve_entities,
)
from cocoindex.ops.entity_resolution.llm_resolver import LlmPairResolver
from cocoindex.resources.embedder import Embedder

from ingest import identity
from ingest.schemas import EntityMentionRow, EntityRelationshipRow


def _clamp01(value: float) -> float:
    return max(0.0, min(1.0, value))


# ---------------------------------------------------------------------------
# Internal transfer types (Phase A -> Phase B/C)
# ---------------------------------------------------------------------------


@dataclass
class MentionCandidate:
    """A DR-135-anchored raw mention, carried Phase A -> Phase C.

    Anchoring happens in Phase A (`extract.entity_context_or_none` against
    the FULL document text): an unanchored extraction never becomes a
    candidate, so every instance reaching Phase C is refuse-checked already.
    """

    source_document_id: uuid.UUID
    entity_type: str
    entity_name: str  # raw, as extracted — resolved to a canonical in Phase C
    confidence: float
    context_snippet: str


@dataclass
class RelationshipCandidate:
    """A raw relationship whose both endpoints are DR-135-anchored."""

    rel_path: str
    source_document_id: uuid.UUID
    source_entity_type: str
    source_entity_name: str
    relationship_type: str
    target_entity_type: str
    target_entity_name: str
    confidence: float


@dataclass
class FileExtraction:
    """Per-file Phase A output, carried forward to Phase B/C."""

    rel_path: str
    source_document_id: uuid.UUID
    mentions: list[MentionCandidate] = field(default_factory=list)
    relationships: list[RelationshipCandidate] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Phase B: per-entity-type resolution
# ---------------------------------------------------------------------------


async def _seed_canonicals(pool: asyncpg.Pool, entity_type: str) -> set[str]:
    """`is_existing_canonical` seed set for `entity_type` (DR-140/147/105) —
    prior runs' established canonicals plus admin-pinned canonicals at their
    EFFECTIVE type. id-434 TECH.md §2.3 (ratified, landed as the current
    entity-resolution shape this flow's Phase B mirrors).
    """
    rows = await pool.fetch(
        "SELECT DISTINCT canonical_name FROM public.entity_mentions WHERE entity_type = $1 "
        "UNION "
        "SELECT DISTINCT canonical_name FROM public.entity_mentions "
        "WHERE (metadata->>'curation_pinned') = 'true' "
        "AND COALESCE(entity_type_override, entity_type) = $1",
        entity_type,
    )
    return {row["canonical_name"] for row in rows}


@coco.fn(memo=True)
async def _resolve_type_group(
    entity_type: str,
    names: set[str],
    seed: set[str],
    *,
    embedder: Embedder,
    resolve_pair: PairResolver,
) -> ResolvedEntities:
    """Resolve one entity type's raw names to canonicals.

    Coordinator-caught DR-105 defect (fixed here): `seed` used to be fetched
    from the DB INSIDE this `memo=True` body, invisible to the memo key — an
    unchanged `names` set plus a freshly-added admin pin would serve a stale
    memoized resolution, so the new pin went unhonoured until the raw name
    set itself changed. `seed`, `embedder`, and `resolve_pair` are now all
    explicit parameters (the caller — `resolve_entities_by_type` — fetches
    the seed and constructs the resolver BEFORE mounting this component), so
    a seed change (or a model change, since `LlmPairResolver`/`Embedder`
    implementations carry `__coco_memo_key__`) correctly invalidates the memo.
    """
    return await resolve_entities(
        entities=names,
        embedder=embedder,
        resolve_pair=resolve_pair,
        is_existing_canonical=lambda name: name in seed,
        existing_policy=ExistingCanonicalPolicy.PINNED,
    )


async def resolve_entities_by_type(
    pool: asyncpg.Pool,
    embedder: Embedder,
    resolution_model: str,
    file_extractions: list[FileExtraction],
) -> dict[str, ResolvedEntities]:
    """Orchestrate Phase B: one mounted child per entity_type present in the
    corpus (id-434 TECH.md §2.3's per-type mounting — failure attribution,
    parallel resolution), each seeded and resolved BEFORE mounting so the
    seed participates in that child's memo key.
    """
    names_by_type: dict[str, set[str]] = {}
    for fx in file_extractions:
        for m in fx.mentions:
            names_by_type.setdefault(m.entity_type, set()).add(m.entity_name)
        for r in fx.relationships:
            names_by_type.setdefault(r.source_entity_type, set()).add(r.source_entity_name)
            names_by_type.setdefault(r.target_entity_type, set()).add(r.target_entity_name)

    async def _resolve_one(entity_type: str, names: set[str]) -> ResolvedEntities:
        seed = await _seed_canonicals(pool, entity_type)
        return await coco.use_mount(
            coco.component_subpath("resolve_entities", entity_type),
            _resolve_type_group,
            entity_type,
            names,
            seed,
            embedder=embedder,
            resolve_pair=LlmPairResolver(model=resolution_model, entity_type=entity_type),
        )

    resolved_values = await asyncio.gather(
        *(_resolve_one(entity_type, names) for entity_type, names in names_by_type.items())
    )
    return dict(zip(names_by_type.keys(), resolved_values))


# ---------------------------------------------------------------------------
# Phase C: declare canonical-keyed mentions/relationships
# ---------------------------------------------------------------------------


@coco.fn
async def declare_resolved(
    file_extractions: list[FileExtraction],
    resolved_by_type: dict[str, ResolvedEntities],
    em_target: postgres.TableTarget[EntityMentionRow],
    er_target: postgres.TableTarget[EntityRelationshipRow],
) -> None:
    def _canonical_of(entity_type: str, raw_name: str) -> str:
        resolved = resolved_by_type.get(entity_type)
        return resolved.canonical_of(raw_name) if resolved is not None else raw_name

    # Collapse candidates per (source_document_id, canonical, entity_type) to
    # one survivor — max(confidence, entity_name), a deterministic pick —
    # mirroring the corpus-wide collapse-not-collision rule id-434 TECH.md
    # §2.4 lands for this exact row shape.
    collapsed: dict[tuple[uuid.UUID, str, str], tuple[MentionCandidate, str]] = {}
    for fx in file_extractions:
        for m in fx.mentions:
            canonical = _canonical_of(m.entity_type, m.entity_name)
            key = (m.source_document_id, canonical, m.entity_type)
            survivor = collapsed.get(key)
            if survivor is None or (m.confidence, m.entity_name) > (
                survivor[0].confidence,
                survivor[0].entity_name,
            ):
                collapsed[key] = (m, canonical)

    for (source_document_id, canonical, entity_type), (mention, _) in collapsed.items():
        em_target.declare_row(
            row=EntityMentionRow(
                id=uuid.uuid5(
                    identity.NAMESPACE, f"em:{source_document_id}:{canonical}:{entity_type}"
                ),
                source_document_id=source_document_id,
                entity_type=entity_type,
                entity_name=mention.entity_name,
                canonical_name=canonical,
                confidence=_clamp01(mention.confidence),
                context_snippet=mention.context_snippet,
            )
        )

    for fx in file_extractions:
        for r in fx.relationships:
            source_canonical = _canonical_of(r.source_entity_type, r.source_entity_name)
            target_canonical = _canonical_of(r.target_entity_type, r.target_entity_name)
            er_target.declare_row(
                row=EntityRelationshipRow(
                    id=uuid.uuid5(
                        identity.NAMESPACE,
                        f"er:{fx.rel_path}:{source_canonical}:{r.relationship_type}:{target_canonical}",
                    ),
                    source_entity=source_canonical,
                    relationship_type=r.relationship_type,
                    target_entity=target_canonical,
                    source_document_id=r.source_document_id,
                    confidence=_clamp01(r.confidence),
                )
            )
