"""Dataclass row schemas for the ingest flow's postgres targets.

Every target here is mounted `managed_by=ManagedBy.USER` (DESIGN.md §2
"Targets"): these tables are migration-owned (`supabase/migrations/`), not
engine-owned, so CocoIndex must never issue DDL against them — only manage
row content. `postgres._target.resolve_system_transition` (verified against
the installed 1.0.18 package) short-circuits DDL entirely whenever the
desired state is user-managed, which is the whole point: a schema-shape
diff against a migration-managed table with SYSTEM-managed defaults would
attempt `ALTER`/`DROP TABLE`.

Each dataclass carries ONLY the columns this flow has an honest value for.
`postgres.TableSchema.from_class` builds the INSERT's column list straight
from the dataclass fields, so an omitted column (e.g. `content_chunks.
heading_text`, `entity_mentions.metadata`) takes its DB DEFAULT/NULL on
insert and is left alone on every subsequent upsert.

Column shapes verified against the live `public` schema (`mcp__supabase__
list_tables`, platform staging `rbwqewalexrzgxtvcqrh`) — not reconstructed
from migration diffs, which would risk missing a later ALTER.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Annotated, Any

from cocoindex.connectors.postgres import PgType


def _encode_pgvector(value: Any) -> str:
    """Numpy array / float sequence -> pgvector text literal `[1.0,2.0,...]`.

    A small, self-contained re-implementation of the same two-line format
    upstream's own (private) `postgres._target._vector_encoder` uses — kept
    local rather than imported so this schema module has no dependency on a
    connector-internal name, and typed via `PgType(..., encoder=...)` rather
    than the `Annotated[NDArray, EMBEDDER_CONTEXT_KEY]` dimension-inference
    idiom: `record_embeddings.embedding` is a fixed, migration-owned
    `vector(1024)` column (USER-managed — no DDL ever runs against it), so a
    static PgType is simpler than wiring a live embedder instance through
    for schema construction alone.
    """
    return "[" + ",".join(str(float(x)) for x in value) + "]"


# ---------------------------------------------------------------------------
# source_documents — the provenance register
# ---------------------------------------------------------------------------


@dataclass
class SourceDocumentRow:
    """Fields this flow can honestly set after identity resolution.

    `id` is whatever `public.resolve_or_mint_source_identity` returned —
    Python never mints it (DESIGN.md §4). Columns the SQL mint function
    already owns on INSERT (storage_path, logical_path, origin_type,
    retention_class) are deliberately absent here: re-declaring them on
    every walk would fight the mint fn's rename-tolerance semantics
    (SEED-CONTRACT.md §3 note on `logical_path`).
    """

    id: uuid.UUID
    filename: str
    mime_type: str
    file_size: int
    content_hash: str
    content_type: str
    extracted_text: str


# ---------------------------------------------------------------------------
# content_chunks
# ---------------------------------------------------------------------------


@dataclass
class ContentChunkRow:
    id: uuid.UUID
    source_document_id: uuid.UUID
    content: str
    position: int
    char_count: int
    word_count: int


# ---------------------------------------------------------------------------
# q_a_extractions — staged, pre-promotion
# ---------------------------------------------------------------------------


@dataclass
class QAExtractionRow:
    id: uuid.UUID
    source_document_id: uuid.UUID
    extractor_kind: str  # always "llm_extraction" from this flow
    extracted_question_text: str
    extracted_answer_text: str | None


# ---------------------------------------------------------------------------
# entity_mentions / entity_relationships — canonical-keyed, Phase C only
# ---------------------------------------------------------------------------


@dataclass
class EntityMentionRow:
    id: uuid.UUID
    source_document_id: uuid.UUID
    entity_type: str
    entity_name: str
    canonical_name: str
    confidence: float
    context_snippet: str


@dataclass
class EntityRelationshipRow:
    id: uuid.UUID
    source_entity: str
    relationship_type: str
    target_entity: str
    source_document_id: uuid.UUID
    confidence: float


# ---------------------------------------------------------------------------
# record_embeddings — the single embeddings home (DR-036)
# ---------------------------------------------------------------------------


@dataclass
class RecordEmbeddingRow:
    owner_kind: str
    owner_id: uuid.UUID
    model: str
    embedding: Annotated[Any, PgType("vector(1024)", encoder=_encode_pgvector)]
