"""Unit tests for ingest/extract.py — DR-135 anchoring + extraction schemas.

Pure functions and local Pydantic validation only: no LLM call, no engine,
no DB (HARD LIMITS). Synthetic fixtures authored fresh — no docs-site
meeting-transcript content.
"""

from __future__ import annotations

import pydantic
import pytest
from ingest.extract import (
    ExtractedChunk,
    ExtractedEntity,
    ExtractedQAPair,
    ExtractedRelationship,
    entity_context_or_none,
)

# ---------------------------------------------------------------------------
# DR-135 anchoring — entity_context_or_none
# ---------------------------------------------------------------------------

_DOC = (
    "Acme Widgets Ltd holds ISO 9001 certification and has delivered "
    "procurement services to the NHS since 2019."
)


def test_anchored_entity_returns_snippet() -> None:
    snippet = entity_context_or_none(_DOC, "Acme Widgets Ltd")
    assert snippet is not None
    assert "acme widgets ltd" in snippet.lower()


def test_anchoring_is_case_insensitive() -> None:
    snippet = entity_context_or_none(_DOC, "acme widgets ltd")
    assert snippet is not None


def test_unanchored_entity_refused_not_written_empty() -> None:
    # DR-135: an entity whose surface form the document never says is
    # refused — None, never an empty-string placeholder row.
    assert entity_context_or_none(_DOC, "Globex Corporation") is None


def test_empty_document_text_refuses() -> None:
    assert entity_context_or_none("", "Acme Widgets Ltd") is None


def test_empty_entity_name_refuses() -> None:
    assert entity_context_or_none(_DOC, "") is None


def test_snippet_carries_ellipsis_when_truncated_on_both_sides() -> None:
    long_doc = ("padding " * 40) + "Acme Widgets Ltd" + (" padding" * 40)
    snippet = entity_context_or_none(long_doc, "Acme Widgets Ltd")
    assert snippet is not None
    assert snippet.startswith("...")
    assert snippet.endswith("...")


def test_snippet_no_leading_ellipsis_when_match_at_document_start() -> None:
    doc = "Acme Widgets Ltd " + ("padding " * 40)
    snippet = entity_context_or_none(doc, "Acme Widgets Ltd")
    assert snippet is not None
    assert not snippet.startswith("...")


# ---------------------------------------------------------------------------
# Extraction schema validation
# ---------------------------------------------------------------------------


def test_extracted_entity_accepts_valid_type() -> None:
    entity = ExtractedEntity(name="Acme Widgets Ltd", entity_type="organisation")
    assert entity.entity_type == "organisation"


def test_extracted_entity_rejects_out_of_taxonomy_type() -> None:
    # Mirrors the entity_mentions.entity_type CHECK — an out-of-taxonomy
    # value must fail client-side (instructor retries) rather than reach a
    # DB CHECK violation mid-run.
    with pytest.raises(pydantic.ValidationError):
        ExtractedEntity(name="Acme Widgets Ltd", entity_type="widget")  # type: ignore[arg-type]


def test_extracted_relationship_accepts_valid_predicate() -> None:
    rel = ExtractedRelationship(
        source=ExtractedEntity(name="Acme Widgets Ltd", entity_type="organisation"),
        relationship_type="complies_with",
        target=ExtractedEntity(name="ISO 9001", entity_type="standard"),
    )
    assert rel.relationship_type == "complies_with"


def test_extracted_relationship_rejects_out_of_taxonomy_predicate() -> None:
    with pytest.raises(pydantic.ValidationError):
        ExtractedRelationship(
            source=ExtractedEntity(name="Acme Widgets Ltd", entity_type="organisation"),
            relationship_type="likes",  # type: ignore[arg-type]
            target=ExtractedEntity(name="ISO 9001", entity_type="standard"),
        )


def test_qa_pair_answer_defaults_to_none() -> None:
    pair = ExtractedQAPair(question="What certification does Acme hold?")
    assert pair.answer is None


def test_extracted_chunk_defaults_to_empty_lists() -> None:
    chunk = ExtractedChunk()
    assert chunk.qa_pairs == []
    assert chunk.entities == []
    assert chunk.relationships == []


def test_extracted_chunk_round_trips_through_model_validate() -> None:
    # Mirrors extract_chunk()'s re-validate-for-pickling step.
    chunk = ExtractedChunk(
        qa_pairs=[ExtractedQAPair(question="Q?", answer="A.")],
        entities=[ExtractedEntity(name="Acme Widgets Ltd", entity_type="organisation")],
        relationships=[],
    )
    round_tripped = ExtractedChunk.model_validate(chunk.model_dump())
    assert round_tripped == chunk
