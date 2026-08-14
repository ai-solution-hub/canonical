from __future__ import annotations

from datetime import date, datetime, timezone

import pytest

from pipeline.produce import frontmatter
from pipeline.produce.document import (
    CitationError,
    ConceptDraft,
    QaEntry,
    QaPairForConcept,
    SourceCitation,
    SourceDocumentRef,
    build_canonical_uri,
    build_concept,
    build_q_a_pairs_scope_tag_uri,
    build_topic_concept,
)

_GENERATED_AT = datetime(2026, 8, 14, 12, 0, 0, tzinfo=timezone.utc)


def test_build_canonical_uri_source_documents():
    assert (
        build_canonical_uri("source_documents", "9c56fcc6-1111-4444-8888-aaaaaaaaaaaa")
        == "canonical://source_documents/9c56fcc6-1111-4444-8888-aaaaaaaaaaaa"
    )


def test_build_canonical_uri_reference_items():
    assert (
        build_canonical_uri("reference_items", "abc")
        == "canonical://reference_items/abc"
    )


def test_build_canonical_uri_rejects_q_a_pairs_per_row():
    # q_a_pairs stays DB-internal — no per-row canonical:// form (BI-8/BI-9).
    with pytest.raises(CitationError):
        build_canonical_uri("q_a_pairs", "some-uuid")


def test_build_canonical_uri_rejects_unknown_table():
    with pytest.raises(CitationError):
        build_canonical_uri("q_a_extractions", "some-uuid")


def test_build_q_a_pairs_scope_tag_uri():
    assert (
        build_q_a_pairs_scope_tag_uri("data-protection")
        == "canonical://q_a_pairs?scope_tag=data-protection"
    )


def test_build_concept_frontmatter_shape():
    draft = ConceptDraft(
        concept_id=("topics", "data-protection"),
        type="Topic",
        title="Data Protection",
        description="1 published Q&A pair tagged `data-protection`.",
        tags=["data-protection"],
        sources=[
            SourceCitation(
                id="qa-data-protection",
                resource="canonical://q_a_pairs?scope_tag=data-protection",
            )
        ],
        qa_entries=[QaEntry(question="Q1?", answer_standard="A1.")],
    )
    doc = build_concept(draft, generated_at=_GENERATED_AT, stale_after_days=90)

    assert doc.data["type"] == "Topic"
    assert doc.data["title"] == "Data Protection"
    assert doc.data["status"] == "draft"
    assert doc.data["generated"] == {
        "by": "process:pipeline-produce",
        "at": "2026-08-14T12:00:00Z",
    }
    assert doc.data["stale_after"] == date(2026, 11, 12).isoformat()
    assert doc.data["sources"][0]["id"] == "qa-data-protection"
    assert "# Q&A" in doc.body
    assert "Q1?" in doc.body
    assert "A1." in doc.body
    assert "# Trust and freshness" in doc.body


def test_build_concept_omits_optional_source_fields_when_unknown():
    draft = ConceptDraft(
        concept_id=("topics", "x"),
        type="Topic",
        title="X",
        description="desc",
        sources=[SourceCitation(id="s1", resource="canonical://source_documents/u1")],
        qa_entries=[QaEntry(question="Q?", answer_standard="A.")],
    )
    doc = build_concept(draft, generated_at=_GENERATED_AT, stale_after_days=90)
    entry = doc.data["sources"][0]
    assert "title" not in entry
    assert "author" not in entry
    assert "last_modified" not in entry


def test_build_concept_dedupes_sources_by_id_preserving_first_seen():
    draft = ConceptDraft(
        concept_id=("topics", "x"),
        type="Topic",
        title="X",
        description="desc",
        sources=[
            SourceCitation(id="dup", resource="canonical://source_documents/first"),
            SourceCitation(id="dup", resource="canonical://source_documents/second"),
        ],
        qa_entries=[],
    )
    doc = build_concept(draft, generated_at=_GENERATED_AT, stale_after_days=90)
    assert len(doc.data["sources"]) == 1
    assert doc.data["sources"][0]["resource"] == "canonical://source_documents/first"


def test_build_concept_is_idempotent_byte_for_byte():
    draft = ConceptDraft(
        concept_id=("topics", "x"),
        type="Topic",
        title="X",
        description="desc",
        sources=[SourceCitation(id="s1", resource="canonical://source_documents/u1")],
        qa_entries=[QaEntry(question="Q?", answer_standard="A.")],
    )
    doc1 = build_concept(draft, generated_at=_GENERATED_AT, stale_after_days=90)
    doc2 = build_concept(draft, generated_at=_GENERATED_AT, stale_after_days=90)
    assert frontmatter.serialize(doc1) == frontmatter.serialize(doc2)


# ---------------------------------------------------------------------------
# build_topic_concept — the phase-1 `topic` grain convenience wrapper.
# ---------------------------------------------------------------------------


def test_build_topic_concept_cites_query_form_and_known_published_source():
    pairs = [
        QaPairForConcept(
            question="What personal data does Ridgeway process?",
            answer_standard="Buyer and staff data under UK-GDPR-aligned agreements.",
            source_document_id="sd-known",
        ),
        QaPairForConcept(
            question="Who owns breach handling?",
            answer_standard="The Compliance and Quality department.",
            source_document_id=None,
        ),
    ]
    source_documents = {
        "sd-known": SourceDocumentRef(
            id="sd-known", title="GDPR Policy", last_modified="2026-06-15"
        )
    }
    doc = build_topic_concept(
        tag="data-protection",
        concept_id=("topics", "data-protection"),
        pairs=pairs,
        source_documents=source_documents,
        generated_at=_GENERATED_AT,
        stale_after_days=90,
    )

    sources = doc.data["sources"]
    resources = {s["resource"] for s in sources}
    assert "canonical://q_a_pairs?scope_tag=data-protection" in resources
    assert "canonical://source_documents/sd-known" in resources
    # Exactly one per-row citation: the second pair's source is unknown/None
    # and contributes no per-row entry, only the shared query-form one.
    assert len(sources) == 2

    known_entry = next(s for s in sources if s["resource"].startswith("canonical://source_documents/"))
    assert known_entry["title"] == "GDPR Policy"
    assert known_entry["last_modified"] == "2026-06-15"
    assert "author" not in known_entry  # DR-151: structurally unavailable

    assert "What personal data does Ridgeway process?" in doc.body
    assert "Who owns breach handling?" in doc.body


def test_build_topic_concept_degrades_to_query_form_when_source_unpublished_or_unknown():
    # Simulates DR-143: the caller (main.py) has already excluded an
    # unpublished/unknown source_documents id from the `source_documents`
    # mapping it hands to this function. That id must never appear as a
    # per-row citation, even though the pair still names it.
    pairs = [
        QaPairForConcept(
            question="Q?",
            answer_standard="A.",
            source_document_id="sd-not-published",
        )
    ]
    doc = build_topic_concept(
        tag="topic-x",
        concept_id=("topics", "topic-x"),
        pairs=pairs,
        source_documents={},  # empty: sd-not-published is not in it
        generated_at=_GENERATED_AT,
        stale_after_days=90,
    )
    resources = [s["resource"] for s in doc.data["sources"]]
    assert resources == ["canonical://q_a_pairs?scope_tag=topic-x"]
    assert "canonical://source_documents/sd-not-published" not in resources


def test_build_topic_concept_title_is_humanized_from_tag():
    doc = build_topic_concept(
        tag="data-protection",
        concept_id=("topics", "data-protection"),
        pairs=[QaPairForConcept(question="Q?", answer_standard="A.")],
        source_documents={},
        generated_at=_GENERATED_AT,
        stale_after_days=90,
    )
    assert doc.data["title"] == "Data Protection"
