"""Unit tests for ingest/schemas.py — postgres row-schema shapes.

`TableSchema.from_class` is a pure/local type-introspection call (no DB
I/O) — these tests pin the exact columns each dataclass declares against
the live `public` schema shapes verified via `mcp__supabase__list_tables`
(platform staging `rbwqewalexrzgxtvcqrh`) at authoring time, so a drift
between the dataclass and the migration-owned table is caught here rather
than at a live `declare_row` call.
"""

from __future__ import annotations

import asyncio

from cocoindex.connectors.postgres import TableSchema
from ingest.schemas import (
    ContentChunkRow,
    EntityMentionRow,
    EntityRelationshipRow,
    QAExtractionRow,
    RecordEmbeddingRow,
    SourceDocumentRow,
)


def _build_schema(record_type: type, primary_key: list[str]) -> TableSchema:
    return asyncio.run(TableSchema.from_class(record_type, primary_key=primary_key))


def test_source_document_row_columns() -> None:
    schema = _build_schema(SourceDocumentRow, ["id"])
    assert set(schema.columns) == {
        "id",
        "filename",
        "mime_type",
        "file_size",
        "content_hash",
        "content_type",
        "extracted_text",
    }
    assert schema.primary_key == ["id"]
    assert schema.columns["id"].type == "uuid"


def test_content_chunk_row_columns() -> None:
    schema = _build_schema(ContentChunkRow, ["id"])
    assert set(schema.columns) == {
        "id",
        "source_document_id",
        "content",
        "position",
        "char_count",
        "word_count",
    }
    assert schema.primary_key == ["id"]


def test_qa_extraction_row_columns() -> None:
    schema = _build_schema(QAExtractionRow, ["id"])
    assert set(schema.columns) == {
        "id",
        "source_document_id",
        "extractor_kind",
        "extracted_question_text",
        "extracted_answer_text",
    }
    # extracted_answer_text is `str | None` — nullable.
    assert schema.columns["extracted_answer_text"].nullable is True
    assert schema.columns["extracted_question_text"].nullable is False


def test_entity_mention_row_columns() -> None:
    schema = _build_schema(EntityMentionRow, ["id"])
    assert set(schema.columns) == {
        "id",
        "source_document_id",
        "entity_type",
        "entity_name",
        "canonical_name",
        "confidence",
        "context_snippet",
    }


def test_entity_relationship_row_columns() -> None:
    schema = _build_schema(EntityRelationshipRow, ["id"])
    assert set(schema.columns) == {
        "id",
        "source_entity",
        "relationship_type",
        "target_entity",
        "source_document_id",
        "confidence",
    }


def test_record_embedding_row_columns_and_vector_type() -> None:
    schema = _build_schema(
        RecordEmbeddingRow, ["owner_kind", "owner_id", "model"]
    )
    assert set(schema.columns) == {"owner_kind", "owner_id", "model", "embedding"}
    assert schema.primary_key == ["owner_kind", "owner_id", "model"]
    # Static PgType override (schemas.py) — matches the live vector(1024)
    # column exactly; no DDL is ever issued against it (managed_by=USER),
    # but the encoder must still be wired for row-value encoding.
    embedding_col = schema.columns["embedding"]
    assert embedding_col.type == "vector(1024)"
    assert embedding_col.encoder is not None


def test_record_embedding_encoder_formats_pgvector_literal() -> None:
    schema = _build_schema(
        RecordEmbeddingRow, ["owner_kind", "owner_id", "model"]
    )
    encoder = schema.columns["embedding"].encoder
    assert encoder is not None
    assert encoder([1.0, 2.5, -3.0]) == "[1.0,2.5,-3.0]"
