"""Unit tests for `pipeline/produce/main.py`'s pure grouping/emission core.

No live DB, no live LLM (HARD LIMITS): every test here builds a bundle from
in-memory `QaPairRow`/`SourceDocumentRow` fixtures via `build_bundle_files`,
which has no cocoindex dependency. The one engine-dependent test
(`test_app_main_wiring_exists`) only introspects module-level objects and
never invokes `app.update()`.
"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest
from produce import main as produce_main
from produce.main import (
    QaPairRow,
    SourceDocumentRow,
    build_bundle_files,
    filter_published,
    filter_published_source_documents,
    group_by_topic,
    resolve_source_document_ref,
    slugify_tag,
)

_GENERATED_AT = datetime(2026, 8, 14, 12, 0, 0, tzinfo=timezone.utc)


def _qa(
    id: str,
    question_text: str,
    scope_tag: list[str],
    *,
    answer_standard: str = "An answer.",
    answer_advanced: str | None = None,
    publication_status: str = "published",
    source_document_id: str | None = None,
) -> QaPairRow:
    return QaPairRow(
        id=id,
        question_text=question_text,
        answer_standard=answer_standard,
        answer_advanced=answer_advanced,
        scope_tag=scope_tag,
        publication_status=publication_status,
        source_document_id=source_document_id,
    )


def _sd(
    id: str,
    *,
    publication_status: str = "published",
    suggested_title: str | None = None,
    logical_path: str | None = None,
    filename: str = "doc.md",
    updated_at: datetime | None = None,
    captured_date: datetime | None = None,
) -> SourceDocumentRow:
    return SourceDocumentRow(
        id=id,
        publication_status=publication_status,
        suggested_title=suggested_title,
        logical_path=logical_path,
        filename=filename,
        updated_at=updated_at,
        captured_date=captured_date,
    )


# ---------------------------------------------------------------------------
# Small pure helpers
# ---------------------------------------------------------------------------


def test_filter_published_excludes_non_published_qa_pairs():
    rows = [
        _qa("p1", "Q1?", ["t"], publication_status="published"),
        _qa("p2", "Q2?", ["t"], publication_status="draft"),
        _qa("p3", "Q3?", ["t"], publication_status="archived"),
    ]
    assert [r.id for r in filter_published(rows)] == ["p1"]


def test_filter_published_source_documents():
    rows = [
        _sd("s1", publication_status="published"),
        _sd("s2", publication_status="in_review"),
    ]
    result = filter_published_source_documents(rows)
    assert set(result) == {"s1"}


def test_group_by_topic_multi_tag_coverage_not_partition():
    # DR-141 rider: a pair with two tags contributes to two concepts.
    pairs = [_qa("p1", "Q1?", ["product", "certification"])]
    groups = group_by_topic(pairs)
    assert set(groups) == {"product", "certification"}
    assert groups["product"][0].id == "p1"
    assert groups["certification"][0].id == "p1"


def test_group_by_topic_empty_scope_tag_yields_no_group_membership():
    pairs = [_qa("p1", "Q1?", [])]
    groups = group_by_topic(pairs)
    assert groups == {}


def test_slugify_tag():
    assert slugify_tag("Data Protection") == "data-protection"
    assert slugify_tag("  already-kebab  ") == "already-kebab"


def test_slugify_tag_rejects_all_invalid_characters():
    with pytest.raises(ValueError):
        slugify_tag("###")


def test_resolve_source_document_ref_prefers_suggested_title():
    row = _sd("s1", suggested_title="GDPR Policy", filename="gdpr-policy-v2.md")
    ref = resolve_source_document_ref(row)
    assert ref.title == "GDPR Policy"


def test_resolve_source_document_ref_falls_back_to_humanized_filename():
    row = _sd("s1", suggested_title=None, logical_path=None, filename="gdpr-policy-v2.md")
    ref = resolve_source_document_ref(row)
    assert ref.title == "Gdpr Policy V2"


def test_resolve_source_document_ref_prefers_captured_date_over_updated_at():
    row = _sd(
        "s1",
        captured_date=datetime(2026, 5, 1, tzinfo=timezone.utc),
        updated_at=datetime(2026, 7, 1, tzinfo=timezone.utc),
    )
    ref = resolve_source_document_ref(row)
    assert ref.last_modified == "2026-05-01"


def test_resolve_source_document_ref_omits_last_modified_when_neither_known():
    row = _sd("s1", captured_date=None, updated_at=None)
    ref = resolve_source_document_ref(row)
    assert ref.last_modified is None
    assert ref.author is None  # DR-151: structurally unavailable


# ---------------------------------------------------------------------------
# build_bundle_files — the pure end-to-end core
# ---------------------------------------------------------------------------


def test_build_bundle_files_produces_expected_tree():
    qa_pairs = [
        _qa(
            "p1",
            "What personal data does the company process?",
            ["data-protection"],
            source_document_id="s1",
        ),
        _qa("p2", "How is quality assured?", ["quality-management"]),
    ]
    source_documents = [_sd("s1", suggested_title="GDPR Policy")]

    files = build_bundle_files(
        qa_pairs=qa_pairs,
        source_documents=source_documents,
        generated_at=_GENERATED_AT,
    )

    assert set(files) == {
        "index.md",
        "topics/index.md",
        "topics/data-protection.md",
        "topics/quality-management.md",
        "log.md",
    }
    assert files["index.md"].decode().startswith("# Subdirectories\n")
    assert files["topics/index.md"].decode().startswith("# Topic\n")
    assert b"What personal data does the company process?" in files["topics/data-protection.md"]
    assert b"canonical://source_documents/s1" in files["topics/data-protection.md"]


def test_build_bundle_files_no_published_content_still_seeds_root_index_and_log():
    files = build_bundle_files(qa_pairs=[], source_documents=[], generated_at=_GENERATED_AT)
    assert set(files) == {"index.md", "log.md"}
    assert files["index.md"].startswith(b"# Subdirectories\n")
    assert b"*" not in files["index.md"]


def test_build_bundle_files_is_idempotent_byte_for_byte():
    qa_pairs = [_qa("p1", "Q1?", ["t"])]
    kwargs = {"qa_pairs": qa_pairs, "source_documents": [], "generated_at": _GENERATED_AT}
    first = build_bundle_files(**kwargs)
    second = build_bundle_files(**kwargs)
    assert first == second


def test_log_md_seeded_once_then_passed_through_unchanged_across_runs():
    first_run = build_bundle_files(qa_pairs=[], source_documents=[], generated_at=_GENERATED_AT)
    seeded_log = first_run["log.md"]

    second_run = build_bundle_files(
        qa_pairs=[],
        source_documents=[],
        generated_at=_GENERATED_AT,
        existing_log_bytes=seeded_log,
    )
    assert second_run["log.md"] == seeded_log


# ---------------------------------------------------------------------------
# DR-141 — coverage guarantee via the topic grain alone
# ---------------------------------------------------------------------------


def test_topic_grain_covers_every_published_pair_dr141():
    """DR-141's coverage guarantee (every published unit of knowledge reachable
    in >=1 concept) holds with the `topic` grain alone, because DR-125 makes
    `scope_tag` mandatory (non-empty) at promotion — a genuinely promoted pair
    always has at least one tag to route on. This is the Coordinator-requested
    proof of that claim, not an assertion about corpora that violate DR-125.
    """
    qa_pairs = [
        _qa("p1", "Question about data protection?", ["data-protection"]),
        _qa("p2", "Question about quality?", ["quality-management"]),
        _qa("p3", "Question spanning two topics?", ["data-protection", "quality-management"]),
        _qa("p4", "A fourth, single-tag question?", ["company"]),
    ]
    files = build_bundle_files(qa_pairs=qa_pairs, source_documents=[], generated_at=_GENERATED_AT)
    concept_bodies = b"\n".join(
        content for path, content in files.items() if path.startswith("topics/") and path != "topics/index.md"
    )

    for pair in qa_pairs:
        assert pair.question_text.encode() in concept_bodies, (
            f"published pair {pair.id!r} is not reachable from any topic "
            "concept — DR-141 coverage would be violated"
        )


def test_topic_grain_does_not_cover_a_pair_with_no_scope_tag():
    """The converse of the above, documented rather than silently assumed:
    DR-153 sanctions a published pair with no scope_tag getting no concept at
    all (no residual grain). This is only reachable if a pair violates
    DR-125's mandatory-scope_tag promotion gate.
    """
    qa_pairs = [_qa("p1", "An ungated pair somehow missing its tag?", [])]
    files = build_bundle_files(qa_pairs=qa_pairs, source_documents=[], generated_at=_GENERATED_AT)
    assert "topics/index.md" not in files
    assert not any(path.startswith("topics/") for path in files)


# ---------------------------------------------------------------------------
# DR-143 — unpublished-never-cited / never-reaches-a-concept
# ---------------------------------------------------------------------------


def test_dr143_unpublished_qa_pair_never_reaches_a_concept():
    qa_pairs = [
        _qa("p1", "A published question.", ["t"], publication_status="published"),
        _qa("p2", "An UNPUBLISHED question that must not appear anywhere.", ["t"], publication_status="draft"),
    ]
    files = build_bundle_files(qa_pairs=qa_pairs, source_documents=[], generated_at=_GENERATED_AT)
    all_bytes = b"\n".join(files.values())
    assert b"A published question." in all_bytes
    assert b"An UNPUBLISHED question" not in all_bytes


def test_dr143_unpublished_source_document_never_cited():
    qa_pairs = [
        _qa("p1", "Q?", ["t"], source_document_id="s-unpublished"),
    ]
    source_documents = [_sd("s-unpublished", publication_status="draft")]
    files = build_bundle_files(
        qa_pairs=qa_pairs, source_documents=source_documents, generated_at=_GENERATED_AT
    )
    concept = files["topics/t.md"]
    assert b"canonical://source_documents/s-unpublished" not in concept
    # The pair's question is still covered (DR-141) via the query-form
    # citation; only the specific per-row citation degrades (DR-143).
    assert b"Q?" in concept
    assert b"canonical://q_a_pairs?scope_tag=t" in concept


def test_dr143_source_document_absent_entirely_also_never_cited():
    # Not merely unpublished -- not present in the read at all (e.g. deleted,
    # or never admitted). Same degrade-to-query-form behaviour.
    qa_pairs = [_qa("p1", "Q?", ["t"], source_document_id="s-does-not-exist")]
    files = build_bundle_files(qa_pairs=qa_pairs, source_documents=[], generated_at=_GENERATED_AT)
    concept = files["topics/t.md"]
    assert b"canonical://source_documents/s-does-not-exist" not in concept


# ---------------------------------------------------------------------------
# Engine wiring — introspection only, no DB, no LLM.
# ---------------------------------------------------------------------------


def test_app_main_wiring_exists():
    assert produce_main.coco is not None
    assert produce_main.app is not None
    assert callable(produce_main.app_main)


@pytest.mark.integration
@pytest.mark.skip(
    reason=(
        "requires a live Postgres with q_a_pairs/source_documents populated; "
        "run manually against a disposable DB (Wave 4 acceptance), never in "
        "the default unit-test run (HARD LIMITS: no live DB in tests)."
    )
)
def test_app_main_against_live_db():
    # Placeholder for the Wave-4 real-tier smoke: `await app.update()`
    # against a disposable Postgres, then assert on the written bundle tree.
    raise NotImplementedError
