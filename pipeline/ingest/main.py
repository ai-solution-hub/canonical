"""Ingestion flow — App 1 of the DR-152 pipeline rebase.

Sources (localfs first, DESIGN.md §2) -> the source_documents provenance
register + staged content_chunks / q_a_extractions / entity_mentions /
entity_relationships / record_embeddings.

Three phases, mirroring the style baseline (`scripts/cocoindex_pipeline/
meeting_notes/main.py`):
  1. Per-file extraction (this module) registers the document (SQL-side
     SEED-CONTRACT mint), chunks it, and declares chunk/Q&A rows plus
     DR-135-anchored entity/relationship CANDIDATES (not yet declared —
     their canonical name is not known until phase 2).
  2. Per-entity-type resolution (`ingest.resolve`): upstream
     `resolve_entities` + `LlmPairResolver`, seeded with prior canonicals +
     admin pins via `is_existing_canonical` (DR-140/DR-147/DR-105 held by
     upstream API, not ported machinery).
  3. A single corpus-wide pass (`ingest.resolve`) declares canonical-keyed
     entity_mentions / entity_relationships rows.

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
from typing import cast

import asyncpg
import cocoindex as coco
import litellm
from cocoindex.connectorkits.target import ManagedBy
from cocoindex.connectors import localfs, postgres
from cocoindex.ops.entity_resolution import ResolvedEntities
from cocoindex.ops.litellm import LiteLLMEmbedder
from cocoindex.ops.text import RecursiveSplitter
from cocoindex.resources.file import PatternFilePathMatcher

from ingest import identity, resolve
from ingest.extract import ExtractedChunk, entity_context_or_none, extract_chunk
from ingest.resolve import FileExtraction, MentionCandidate, RelationshipCandidate
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
RETENTION_CLASS = coco.ContextKey[str]("retention_class", detect_change=True)

# The binding gate's retention-class vocabulary (corpus reframe R1/R2, DR-025;
# spellings are the DB CHECK constraint's — verified against platform staging).
VALID_RETENTION_CLASSES = frozenset(
    {"keep_and_watch", "ingest_once", "live_connected", "external_referenced"}
)


def validate_retention_class(value: str) -> str:
    """Binding-gate refusal (DR-025): an unknown class is a config error,
    never silently coerced — the class governs survival semantics."""
    if value not in VALID_RETENTION_CLASSES:
        raise RuntimeError(
            f"INGEST_RETENTION_CLASS {value!r} is not one of "
            f"{sorted(VALID_RETENTION_CLASSES)}"
        )
    return value


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
    retention_class = validate_retention_class(
        os.environ.get("INGEST_RETENTION_CLASS", "keep_and_watch")
    )
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
        builder.provide(RETENTION_CLASS, retention_class)
        yield


# ---------------------------------------------------------------------------
# Filename -> mime_type (source_documents.mime_type is NOT NULL)
# ---------------------------------------------------------------------------

_MIME_BY_SUFFIX: dict[str, str] = {
    ".md": "text/markdown",
    ".markdown": "text/markdown",
    ".txt": "text/plain",
}
_DEFAULT_MIME = "text/markdown"

# `FileExtraction`/`MentionCandidate`/`RelationshipCandidate` — the Phase A
# -> Phase B/C transfer types this module's `process_file` constructs — are
# defined in `ingest.resolve` (the Phase B/C consumer) so that module has NO
# dependency on this one, keeping the import graph one-directional
# (`main` -> `resolve`, never the reverse). Re-exported names above so
# `process_file`'s body reads unchanged.


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
    retention_class: str,
) -> tuple[uuid.UUID, str]:
    """Content-hash-first identity resolution via `resolve_or_mint_source_
    identity` — same bytes at a new `rel_path` resolve to the STORED id; a
    genuinely new hash mints `id = uuid5(NAMESPACE, "sd:"+rel_path)` ONCE.
    Python never re-derives or re-mints post-admission identity.

    Returns (source_document_id, STORED storage_path) — the stored path is
    admission-time provenance (SEED-CONTRACT.md §1) and is what the declared
    row must re-declare verbatim; under a rename it deliberately differs
    from the current walk's `rel_path`.
    """
    row = await pool.fetchrow(
        "SELECT r.source_document_id, r.was_minted, sd.storage_path "
        "FROM public.resolve_or_mint_source_identity($1, $2, $3, $4, $5, $6, $7, $8) r "
        "JOIN public.source_documents sd ON sd.id = r.source_document_id",
        content_hash,
        rel_path,
        filename,
        mime_type,
        file_size,
        "localfs",  # p_origin_type
        retention_class,  # binding-gate assignment (reframe R2, DR-025)
        None,  # p_op_id — DR-152 retires op_id stamping
    )
    assert row is not None
    return cast(uuid.UUID, row["source_document_id"]), cast(str, row["storage_path"])


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
    source_document_id, stored_storage_path = await _resolve_source_identity(
        pool,
        content_hash=content_hash,
        rel_path=rel_path,
        filename=filename,
        mime_type=mime_type,
        file_size=file_size,
        retention_class=coco.use_context(RETENTION_CLASS),
    )

    sd_target.declare_row(
        row=SourceDocumentRow(
            id=source_document_id,
            filename=filename,
            storage_path=stored_storage_path,
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
        path_matcher=PatternFilePathMatcher(included_patterns=["**/*.md", "**/*.txt"]),
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

    # --- Phase B: per-entity-type resolution (ingest.resolve) ---
    resolved_by_type: dict[str, ResolvedEntities] = await resolve.resolve_entities_by_type(
        coco.use_context(DB_CTX),
        coco.use_context(EMBEDDER),
        coco.use_context(RESOLUTION_LLM_MODEL),
        file_extractions,
    )

    # --- Phase C: declare canonical-keyed mentions + relationships (ingest.resolve) ---
    await coco.mount(
        coco.component_subpath("declare_resolved"),
        resolve.declare_resolved,
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
