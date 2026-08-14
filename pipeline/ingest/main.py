"""Ingestion flow — App 1 of the DR-152 pipeline rebase.

Sources (localfs first, DESIGN.md §2) -> the source_documents provenance
register + staged content_chunks / q_a_extractions / entity_mentions /
entity_relationships / record_embeddings.

Three phases, mirroring the style baseline (`scripts/cocoindex_pipeline/
meeting_notes/main.py`):
  1. Per-file extraction registers the document (SQL-side SEED-CONTRACT
     mint), chunks it, and declares chunk/Q&A rows plus DR-135-anchored
     entity/relationship CANDIDATES (not yet declared — their canonical
     name is not known until phase 2).
  2. Per-entity-type resolution: upstream `resolve_entities` +
     `LlmPairResolver`, seeded with prior canonicals + admin pins via
     `is_existing_canonical` (DR-140/DR-147/DR-105 held by upstream API,
     not ported machinery).
  3. A single corpus-wide pass declares canonical-keyed entity_mentions /
     entity_relationships rows.

No mock LLM server, no writer fence, no fault injector, no op_id stamping
(DR-152) — all six postgres targets are mounted `managed_by=USER` (the
tables are migration-owned; CocoIndex manages only row content, never DDL).
"""

from __future__ import annotations

import asyncio
import logging
import os
import pathlib
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import cast

import asyncpg
import cocoindex as coco
import litellm
from cocoindex.connectorkits.target import ManagedBy
from cocoindex.connectors import localfs, postgres
from cocoindex.ops.entity_resolution import (
    ExistingCanonicalPolicy,
    ResolvedEntities,
    resolve_entities,
)
from cocoindex.ops.entity_resolution.llm_resolver import LlmPairResolver
from cocoindex.ops.litellm import LiteLLMEmbedder
from cocoindex.ops.text import RecursiveSplitter
from cocoindex.resources.file import PatternFilePathMatcher

from ingest import identity
from ingest.extract import ExtractedChunk, entity_context_or_none, extract_chunk
from ingest.schemas import (
    ContentChunkRow,
    EntityMentionRow,
    EntityRelationshipRow,
    QAExtractionRow,
    RecordEmbeddingRow,
    SourceDocumentRow,
)

litellm.drop_params = True
_logger = logging.getLogger(__name__)

# Ratified product constants (Liam-ratified {56.5} chunk budgets; the
# `text-embedding-3-large` / 1024-dim pairing matches `record_embeddings.
# embedding`'s live `vector(1024)` column) — carried forward as continuity
# of a product decision, not ported pipeline machinery.
CHUNK_SIZE_BYTES = 2000
CHUNK_OVERLAP_BYTES = 200
CHUNK_MIN_SIZE_BYTES = 1000
EMBEDDING_DIMENSIONS = 1024

_DEFAULT_EXTRACTION_MODEL = "anthropic/claude-haiku-4-5"
_DEFAULT_RESOLUTION_MODEL = "anthropic/claude-haiku-4-5"
_DEFAULT_EMBEDDING_MODEL = "text-embedding-3-large"


# ---------------------------------------------------------------------------
# Context keys
# ---------------------------------------------------------------------------

DB_CTX = coco.ContextKey[asyncpg.Pool]("db")
EXTRACTION_LLM_MODEL = coco.ContextKey[str]("extraction_llm_model", detect_change=True)
RESOLUTION_LLM_MODEL = coco.ContextKey[str]("resolution_llm_model", detect_change=True)
EMBEDDING_MODEL = coco.ContextKey[str]("embedding_model", detect_change=True)
EMBEDDER = coco.ContextKey[LiteLLMEmbedder]("embedder", detect_change=True)


# ---------------------------------------------------------------------------
# Lifespan
# ---------------------------------------------------------------------------


@coco.lifespan
async def coco_lifespan(builder: coco.EnvironmentBuilder) -> AsyncIterator[None]:
    # No silent fallback (KH no-silent-failure ethos): an unset DSN raises
    # rather than reconstructing a host, mirroring the `COCOINDEX_DB_DSN`
    # contract the deploy surface already mounts (Cloud Run / Coolify secret).
    dsn = os.environ.get("COCOINDEX_DB_DSN", "")
    if not dsn:
        raise RuntimeError(
            "COCOINDEX_DB_DSN env var is required — a fully-formed Postgres/"
            "pooler connection string (postgresql://user:pass@host:port/db)."
        )
    embedding_model = os.environ.get("EMBEDDING_MODEL", _DEFAULT_EMBEDDING_MODEL)
    async with await asyncpg.create_pool(dsn) as pool:
        builder.provide(DB_CTX, pool)
        builder.provide(
            EXTRACTION_LLM_MODEL,
            os.environ.get("EXTRACTION_LLM_MODEL", _DEFAULT_EXTRACTION_MODEL),
        )
        builder.provide(
            RESOLUTION_LLM_MODEL,
            os.environ.get("RESOLUTION_LLM_MODEL", _DEFAULT_RESOLUTION_MODEL),
        )
        builder.provide(EMBEDDING_MODEL, embedding_model)
        builder.provide(
            EMBEDDER, LiteLLMEmbedder(embedding_model, dimensions=EMBEDDING_DIMENSIONS)
        )
        yield


# ---------------------------------------------------------------------------
# Filename -> mime_type (source_documents.mime_type is NOT NULL)
# ---------------------------------------------------------------------------

_MIME_BY_SUFFIX: dict[str, str] = {
    ".md": "text/markdown",
    ".markdown": "text/markdown",
}
_DEFAULT_MIME = "text/markdown"


# ---------------------------------------------------------------------------
# Internal transfer types (Phase 1 -> Phase 2/3)
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
# SEED-CONTRACT admission mint (SQL-side; DESIGN.md §4)
# ---------------------------------------------------------------------------


async def _resolve_source_identity(
    pool: asyncpg.Pool,
    *,
    content_hash: str,
    rel_path: str,
    filename: str,
    mime_type: str,
    file_size: int,
) -> uuid.UUID:
    """Content-hash-first identity resolution via `resolve_or_mint_source_
    identity` — same bytes at a new `rel_path` resolve to the STORED id; a
    genuinely new hash mints `id = uuid5(NAMESPACE, "sd:"+rel_path)` ONCE.
    Python never re-derives or re-mints post-admission identity.
    """
    row = await pool.fetchrow(
        "SELECT source_document_id, was_minted "
        "FROM public.resolve_or_mint_source_identity($1, $2, $3, $4, $5, $6, $7, $8)",
        content_hash,
        rel_path,
        filename,
        mime_type,
        file_size,
        "localfs",  # p_origin_type
        None,  # p_retention_class — deferred to the two-gate/retention-class wave
        None,  # p_op_id — DR-152 retires op_id stamping
    )
    assert row is not None
    return cast(uuid.UUID, row["source_document_id"])


def _clamp01(value: float) -> float:
    return max(0.0, min(1.0, value))


# ---------------------------------------------------------------------------
# Phase A: per-file extraction
# ---------------------------------------------------------------------------


@coco.fn(memo=True)
async def process_file(
    file: localfs.File,
    sd_target: postgres.TableTarget[SourceDocumentRow],
    cc_target: postgres.TableTarget[ContentChunkRow],
    qa_target: postgres.TableTarget[QAExtractionRow],
    re_target: postgres.TableTarget[RecordEmbeddingRow],
) -> FileExtraction:
    rel_path = file.file_path.path.as_posix()
    text = await file.read_text()
    content_hash = (await file.content_fingerprint()).hex()
    filename = file.file_path.path.name
    mime_type = _MIME_BY_SUFFIX.get(file.file_path.path.suffix.lower(), _DEFAULT_MIME)
    file_size = await file.size()  # FileLike caches metadata — cheap either way

    pool = coco.use_context(DB_CTX)
    source_document_id = await _resolve_source_identity(
        pool,
        content_hash=content_hash,
        rel_path=rel_path,
        filename=filename,
        mime_type=mime_type,
        file_size=file_size,
    )

    sd_target.declare_row(
        row=SourceDocumentRow(
            id=source_document_id,
            filename=filename,
            mime_type=mime_type,
            file_size=file_size,
            content_hash=content_hash,
            content_type="markdown",
            extracted_text=text,
        )
    )

    splitter = RecursiveSplitter()
    chunks = splitter.split(
        text,
        CHUNK_SIZE_BYTES,
        chunk_overlap=CHUNK_OVERLAP_BYTES,
        min_chunk_size=CHUNK_MIN_SIZE_BYTES,
    )

    extraction_model = coco.use_context(EXTRACTION_LLM_MODEL)
    embedder = coco.use_context(EMBEDDER)
    embedding_model = coco.use_context(EMBEDDING_MODEL)

    mentions: list[MentionCandidate] = []
    relationships: list[RelationshipCandidate] = []
    qa_idx = 0

    for position, chunk in enumerate(chunks):
        chunk_id = identity.chunk_id(source_document_id, position)
        cc_target.declare_row(
            row=ContentChunkRow(
                id=chunk_id,
                source_document_id=source_document_id,
                content=chunk.text,
                position=position,
                char_count=len(chunk.text),
                word_count=len(chunk.text.split()),
            )
        )

        chunk_embedding = await embedder.embed(chunk.text)
        re_target.declare_row(
            row=RecordEmbeddingRow(
                owner_kind="content_chunk",
                owner_id=chunk_id,
                model=embedding_model,
                embedding=chunk_embedding,
            )
        )

        extracted: ExtractedChunk = await extract_chunk(chunk.text, extraction_model)

        for pair in extracted.qa_pairs:
            idx = qa_idx
            qa_idx += 1
            # id-370 (S511 board D6, DR-014): declare ONLY answered pairs — a
            # blank answer is a sanctioned extraction result, but `idx` is
            # preserved positionally (skip, not pre-filter) so a re-walk
            # upserts the same rows rather than re-keying them.
            if not pair.answer or not pair.answer.strip():
                continue
            qa_target.declare_row(
                row=QAExtractionRow(
                    id=identity.qa_id(source_document_id, idx),
                    source_document_id=source_document_id,
                    extractor_kind="llm_extraction",
                    extracted_question_text=pair.question,
                    extracted_answer_text=pair.answer,
                )
            )

        for entity in extracted.entities:
            snippet = entity_context_or_none(text, entity.name)
            if snippet is None:
                # DR-135 refusal — logged per mention, never silent, never an
                # item failure (the document ingested correctly; one claim
                # about it was refused).
                _logger.warning(
                    "cocoindex.ingest.mention_refused_unanchored rel_path=%r entity_name=%r",
                    rel_path,
                    entity.name,
                )
                continue
            mentions.append(
                MentionCandidate(
                    source_document_id=source_document_id,
                    entity_type=entity.entity_type,
                    entity_name=entity.name,
                    confidence=1.0,
                    context_snippet=snippet,
                )
            )

        for rel in extracted.relationships:
            # Both endpoints must themselves be anchored — a relationship
            # cannot cite an entity the document's text does not support.
            if entity_context_or_none(text, rel.source.name) is None:
                continue
            if entity_context_or_none(text, rel.target.name) is None:
                continue
            relationships.append(
                RelationshipCandidate(
                    rel_path=rel_path,
                    source_document_id=source_document_id,
                    source_entity_type=rel.source.entity_type,
                    source_entity_name=rel.source.name,
                    relationship_type=rel.relationship_type,
                    target_entity_type=rel.target.entity_type,
                    target_entity_name=rel.target.name,
                    confidence=1.0,
                )
            )

    return FileExtraction(
        rel_path=rel_path,
        source_document_id=source_document_id,
        mentions=mentions,
        relationships=relationships,
    )


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
async def _resolve_type_group(entity_type: str, names: set[str]) -> ResolvedEntities:
    pool = coco.use_context(DB_CTX)
    seed = await _seed_canonicals(pool, entity_type)
    return await resolve_entities(
        entities=names,
        embedder=coco.use_context(EMBEDDER),
        resolve_pair=LlmPairResolver(
            model=coco.use_context(RESOLUTION_LLM_MODEL), entity_type=entity_type
        ),
        is_existing_canonical=lambda name: name in seed,
        existing_policy=ExistingCanonicalPolicy.PINNED,
    )


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
                # id-434 TECH.md §2.4 (ratified, landed): registry-keyed on
                # the RESOLVED canonical — supersedes SEED-CONTRACT.md §4's
                # per-document `em:` formula for this row class. NOT part of
                # identity.py's frozen citable set (DESIGN.md §4):
                # entity_mentions is engine-declared/orphan-cleaned, not a
                # permanently-frozen citation target.
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
                    # SEED-CONTRACT.md §4's accepted F4 gap: `er:` stays
                    # rel_path-keyed (per-document) — id-435 (backlog) owns
                    # the registry-keyed reshape id-434 TECH.md §2.4
                    # explicitly deferred to it. Self-healing: engine-
                    # declared and orphan-cleaned on re-walk.
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


# ---------------------------------------------------------------------------
# App main
# ---------------------------------------------------------------------------


@coco.fn
async def app_main(sourcedir: pathlib.Path) -> None:
    # --- Mount postgres targets (managed_by=USER: migration-owned tables;
    # CocoIndex manages row content only, never DDL — see schemas.py) ---
    sd_target = await postgres.mount_table_target(
        DB_CTX,
        "source_documents",
        await postgres.TableSchema.from_class(SourceDocumentRow, primary_key=["id"]),
        managed_by=ManagedBy.USER,
    )
    cc_target = await postgres.mount_table_target(
        DB_CTX,
        "content_chunks",
        await postgres.TableSchema.from_class(ContentChunkRow, primary_key=["id"]),
        managed_by=ManagedBy.USER,
    )
    qa_target = await postgres.mount_table_target(
        DB_CTX,
        "q_a_extractions",
        await postgres.TableSchema.from_class(QAExtractionRow, primary_key=["id"]),
        managed_by=ManagedBy.USER,
    )
    em_target = await postgres.mount_table_target(
        DB_CTX,
        "entity_mentions",
        await postgres.TableSchema.from_class(EntityMentionRow, primary_key=["id"]),
        managed_by=ManagedBy.USER,
    )
    er_target = await postgres.mount_table_target(
        DB_CTX,
        "entity_relationships",
        await postgres.TableSchema.from_class(EntityRelationshipRow, primary_key=["id"]),
        managed_by=ManagedBy.USER,
    )
    re_target = await postgres.mount_table_target(
        DB_CTX,
        "record_embeddings",
        await postgres.TableSchema.from_class(
            RecordEmbeddingRow, primary_key=["owner_kind", "owner_id", "model"]
        ),
        managed_by=ManagedBy.USER,
    )

    # --- Phase A: per-file extraction ---
    # localfs first (client 1's WordPress/HubSpot/other stores are not yet
    # accessible — S565 owner ruling; connector breadth is the known
    # follow-on, not phase-1 scope). Markdown-only glob: the phase-1 corpus
    # (meeting transcripts + the client-1 slice) is markdown.
    walker = localfs.walk_dir(
        sourcedir,
        recursive=True,
        path_matcher=PatternFilePathMatcher(included_patterns=["**/*.md"]),
    )
    file_coros = []
    # S563 pin lesson: `DirWalker.items()` is async-iterable ONLY at 1.0.18.
    async for rel_path, file in walker.items():
        file_coros.append(
            coco.use_mount(
                coco.component_subpath("file", rel_path),
                process_file,
                file,
                sd_target,
                cc_target,
                qa_target,
                re_target,
            )
        )
    file_extractions: list[FileExtraction] = list(await asyncio.gather(*file_coros))

    # --- Phase B: per-entity-type resolution ---
    names_by_type: dict[str, set[str]] = {}
    for fx in file_extractions:
        for m in fx.mentions:
            names_by_type.setdefault(m.entity_type, set()).add(m.entity_name)
        for r in fx.relationships:
            names_by_type.setdefault(r.source_entity_type, set()).add(r.source_entity_name)
            names_by_type.setdefault(r.target_entity_type, set()).add(r.target_entity_name)

    resolved_values = await asyncio.gather(
        *(
            coco.use_mount(
                coco.component_subpath("resolve_entities", entity_type),
                _resolve_type_group,
                entity_type,
                names,
            )
            for entity_type, names in names_by_type.items()
        )
    )
    resolved_by_type: dict[str, ResolvedEntities] = dict(
        zip(names_by_type.keys(), resolved_values)
    )

    # --- Phase C: declare canonical-keyed mentions + relationships ---
    await coco.mount(
        coco.component_subpath("declare_resolved"),
        declare_resolved,
        file_extractions,
        resolved_by_type,
        em_target,
        er_target,
    )


app = coco.App(
    coco.AppConfig(name="IngestFlow"),
    app_main,
    sourcedir=pathlib.Path(os.environ.get("INGEST_SOURCE_DIR", "./data")),
)
