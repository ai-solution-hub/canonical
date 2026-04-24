"""Tests for import_bid_library.py — keyword extraction, content record building, and TC handling.

Covers the extract_keywords() function and build_content_record() to ensure
meaningful keywords are generated from Q&A content rather than slugified
section names. Also covers Track Changes detection integration, --require-clean,
and --batch-tag CLI flags.
"""

import sys
import os
from unittest.mock import patch, MagicMock

# Add scripts dir to path so we can import the module
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest

from import_bid_library import (
    extract_keywords,
    build_content_record,
    truncate_at_word_boundary,
    validate_content_quality,
)
from dedup import dedup_across_files_by_title


# ── extract_keywords ────────────────────────────────────────────────────


class TestExtractKeywords:
    """Tests for the keyword extraction function."""

    def test_includes_domain_first(self):
        """Primary domain should always be the first keyword."""
        keywords = extract_keywords(
            "What encryption do you use?",
            "We use AES-256 encryption for all data at rest.",
            "security-compliance",
            "data-protection",
        )
        assert keywords[0] == "security-compliance"

    def test_includes_subtopic(self):
        """Primary subtopic should be included when different from domain."""
        keywords = extract_keywords(
            "What encryption do you use?",
            "We use AES-256 encryption.",
            "security-compliance",
            "data-protection",
        )
        assert "data-protection" in keywords

    def test_extracts_meaningful_words(self):
        """Should extract meaningful words from the question/answer text."""
        keywords = extract_keywords(
            "What disaster recovery procedures do you have in place?",
            "We maintain a comprehensive disaster recovery plan with regular testing.",
            "operational-delivery",
            "business-continuity",
        )
        # Should contain domain-related terms
        assert "disaster" in keywords or "recovery" in keywords

    def test_returns_3_to_5_keywords(self):
        """Should return between 3 and 5 keywords."""
        keywords = extract_keywords(
            "Describe your approach to information security management.",
            "Our information security management system is certified to ISO 27001.",
            "security-compliance",
            "information-security",
        )
        assert 3 <= len(keywords) <= 5

    def test_no_stop_words(self):
        """Should not include common stop words as keywords."""
        keywords = extract_keywords(
            "What is your approach to data protection?",
            "We have a comprehensive data protection policy.",
            "security-compliance",
            "data-protection",
        )
        stop_words = {"what", "is", "your", "the", "have"}
        for kw in keywords:
            assert kw not in stop_words

    def test_no_duplicate_keywords(self):
        """Keywords should not contain duplicates."""
        keywords = extract_keywords(
            "Security security security encryption encryption",
            "Security measures include encryption of all data.",
            "security-compliance",
            "data-protection",
        )
        assert len(keywords) == len(set(keywords))

    def test_handles_empty_question(self):
        """Should handle empty question text gracefully."""
        keywords = extract_keywords(
            "",
            "We provide 24/7 support.",
            "operational-delivery",
            "support",
        )
        assert len(keywords) >= 1
        assert "operational-delivery" in keywords

    def test_handles_empty_answer(self):
        """Should handle empty answer text gracefully."""
        keywords = extract_keywords(
            "What support do you provide?",
            "",
            "operational-delivery",
            "support",
        )
        assert len(keywords) >= 1

    def test_handles_missing_domain(self):
        """Should work without a primary domain."""
        keywords = extract_keywords(
            "What encryption standards do you follow?",
            "We follow AES-256 and TLS 1.3 encryption standards.",
            "",
            "",
        )
        assert len(keywords) >= 1
        # Should still extract meaningful terms
        assert any(kw in keywords for kw in ["encryption", "standards", "follow", "tls"])

    def test_max_five_keywords(self):
        """Should never return more than 5 keywords."""
        keywords = extract_keywords(
            "What is your approach to cloud security, application security, data encryption, network security, and endpoint protection?",
            "We implement comprehensive security controls across all layers including cloud, application, data, network, and endpoint security with continuous monitoring and threat detection.",
            "security-compliance",
            "information-security",
        )
        assert len(keywords) <= 5

    def test_keywords_are_lowercase(self):
        """Extracted words should be lowercase."""
        keywords = extract_keywords(
            "What ISO certifications do you hold?",
            "We hold ISO 27001 and ISO 9001 certifications.",
            "security-compliance",
            "certifications",
        )
        for kw in keywords:
            # Domain/subtopic may have hyphens but should still be lowercase
            assert kw == kw.lower()


# ── build_content_record ────────────────────────────────────────────────


class TestBuildContentRecord:
    """Tests for the content record builder."""

    def test_keywords_not_slugified_section_name(self):
        """Keywords should NOT be just a slugified section name."""
        pair = {
            "question_text": "What encryption standards do you use for data at rest?",
            "answer_standard": "We use AES-256 encryption for all data at rest and in transit.",
            "answer_advanced": "",
            "section_name": "Data Encryption",
            "source_file": "test.docx",
            "table_index": 0,
            "row_index": 1,
            "primary_domain": "security-compliance",
            "primary_subtopic": "data-protection",
            "classification_confidence": 0.7,
        }
        record = build_content_record(pair, "test-batch")
        # Should NOT contain "data-encryption" as a keyword (the old slugified section name)
        assert "data-encryption" not in record["ai_keywords"]
        # Should contain meaningful keywords
        assert len(record["ai_keywords"]) >= 2

    def test_keywords_contain_domain(self):
        """Keywords should include the primary domain."""
        pair = {
            "question_text": "How do you handle incident response?",
            "answer_standard": "We have a documented incident response plan.",
            "answer_advanced": "",
            "section_name": "General",
            "source_file": "test.docx",
            "table_index": 0,
            "row_index": 1,
            "primary_domain": "security-compliance",
            "primary_subtopic": "incident-management",
            "classification_confidence": 0.7,
        }
        record = build_content_record(pair, "test-batch")
        assert "security-compliance" in record["ai_keywords"]

    def test_empty_keywords_filtered(self):
        """Empty strings should be filtered from keywords."""
        pair = {
            "question_text": "Test question",
            "answer_standard": "Test answer",
            "answer_advanced": "",
            "section_name": "",
            "source_file": "test.docx",
            "table_index": 0,
            "row_index": 1,
            "primary_domain": "",
            "primary_subtopic": "",
            "classification_confidence": 0.0,
        }
        record = build_content_record(pair, "test-batch")
        assert "" not in record["ai_keywords"]


# ── truncate_at_word_boundary ───────────────────────────────────────────


class TestTruncateAtWordBoundary:
    """Tests for the word-boundary truncation helper."""

    def test_short_text_unchanged(self):
        assert truncate_at_word_boundary("hello", 10) == "hello"

    def test_truncates_at_space(self):
        result = truncate_at_word_boundary("hello world foo bar", 12)
        assert result.endswith("...")
        assert len(result) <= 15  # 12 + suffix

    def test_exact_length_unchanged(self):
        assert truncate_at_word_boundary("hello", 5) == "hello"


# ── Track Changes metadata in build_content_record ─────────────────────


class TestBuildContentRecordTrackChanges:
    """Tests for TC metadata and batch_tag in build_content_record."""

    def _make_pair(self, **overrides):
        """Create a minimal Q&A pair dict for testing."""
        pair = {
            "question_text": "What security measures do you have?",
            "answer_standard": "We implement comprehensive security controls.",
            "answer_advanced": "",
            "section_name": "Security",
            "source_file": "test.docx",
            "table_index": 0,
            "row_index": 1,
            "primary_domain": "security",
            "primary_subtopic": "access-control",
            "classification_confidence": 0.7,
        }
        pair.update(overrides)
        return pair

    def test_tc_metadata_true(self):
        """TC metadata should be True when pair has has_tracked_changes=True."""
        pair = self._make_pair(has_tracked_changes=True)
        record = build_content_record(pair, "test-batch")
        assert record["metadata"]["has_tracked_changes"] is True

    def test_tc_metadata_false(self):
        """TC metadata should be False when pair has has_tracked_changes=False."""
        pair = self._make_pair(has_tracked_changes=False)
        record = build_content_record(pair, "test-batch")
        assert record["metadata"]["has_tracked_changes"] is False

    def test_tc_metadata_default_false(self):
        """TC metadata should default to False when not present on pair."""
        pair = self._make_pair()
        # Ensure has_tracked_changes is not in the pair
        pair.pop("has_tracked_changes", None)
        record = build_content_record(pair, "test-batch")
        assert record["metadata"]["has_tracked_changes"] is False

    def test_batch_tag_added_to_user_tags(self):
        """Batch tag should be added to user_tags when present."""
        pair = self._make_pair(_batch_tag="import-2026-03")
        record = build_content_record(pair, "test-batch")
        assert record["user_tags"] == ["import-2026-03"]

    def test_no_user_tags_without_batch_tag(self):
        """No user_tags key should be added when no batch tag is present."""
        pair = self._make_pair()
        record = build_content_record(pair, "test-batch")
        assert "user_tags" not in record

    def test_empty_batch_tag_not_added(self):
        """Empty batch tag string should not create user_tags."""
        pair = self._make_pair(_batch_tag="")
        record = build_content_record(pair, "test-batch")
        assert "user_tags" not in record


# ── classified_at timestamp ──────────────────────────────────────────────


class TestClassifiedAtTimestamp:
    """Tests for classified_at field in build_content_record."""

    def _make_pair(self, **overrides):
        """Create a minimal Q&A pair dict for testing."""
        pair = {
            "question_text": "What security measures do you have?",
            "answer_standard": "We implement comprehensive security controls.",
            "answer_advanced": "",
            "section_name": "Security",
            "source_file": "test.docx",
            "table_index": 0,
            "row_index": 1,
            "primary_domain": "security",
            "primary_subtopic": "access-control",
            "classification_confidence": 0.7,
        }
        pair.update(overrides)
        return pair

    def test_classified_at_present(self):
        """build_content_record includes classified_at timestamp."""
        pair = self._make_pair()
        record = build_content_record(pair, "test-batch")
        assert "classified_at" in record
        assert record["classified_at"] is not None

    def test_classified_at_is_iso_format(self):
        """classified_at is in ISO 8601 format."""
        pair = self._make_pair()
        record = build_content_record(pair, "test-batch")
        from datetime import datetime
        # Should parse without error
        parsed = datetime.fromisoformat(record["classified_at"])
        assert parsed is not None

    def test_classified_at_is_utc(self):
        """classified_at timestamp includes timezone info (UTC)."""
        pair = self._make_pair()
        record = build_content_record(pair, "test-batch")
        # UTC isoformat includes +00:00
        assert "+00:00" in record["classified_at"]


# ── chunk-on-ingest wiring (S177 re-ingestion prep) ─────────────────────


def _make_fake_pair():
    return {
        "question_text": "Do you encrypt data at rest?",
        "answer_standard": "Yes — AES-256 via Supabase default storage encryption.",
        "answer_advanced": "",
        "section_name": "Security",
        "source_file": "dummy.docx",
        "table_index": 0,
        "row_index": 1,
        "primary_domain": "security-compliance",
        "primary_subtopic": "data-protection",
        "classification_confidence": 0.9,
        "has_tracked_changes": False,
    }


def _patch_main_env(argv_extra=None):
    """Return a list of patches that stub out every heavy dep of main()."""
    argv = ["import_bid_library.py", "/tmp/fake-dir"]
    if argv_extra:
        argv.extend(argv_extra)

    fake_pair = _make_fake_pair()

    return [
        patch("sys.argv", argv),
        patch("import_bid_library.find_docx_files", return_value=["/tmp/fake-dir/a.docx"]),
        patch("import_bid_library.has_tracked_changes", return_value=False),
        patch("import_bid_library.extract_qa_from_docx", return_value=[fake_pair]),
        patch("import_bid_library.exact_dedup", side_effect=lambda pairs: (pairs, [])),
        patch("import_bid_library.find_near_duplicates", return_value=[]),
        patch("import_bid_library.classify_pairs", side_effect=lambda pairs: pairs),
        patch("import_bid_library.classification_summary", return_value={}),
        patch("import_bid_library.check_question_exists", return_value=False),
        patch(
            "kb_pipeline.embed.build_embedding_text", return_value="embed text"
        ),
        patch(
            "kb_pipeline.embed.generate_embedding",
            return_value=([0.1] * 1024, 500),
        ),
        patch(
            "kb_pipeline.store.insert_content_item",
            return_value=(True, "qa-item-1"),
        ),
    ]


class TestDedupAcrossFilesByTitle:
    """Cross-file title dedup helper (S180 WP1)."""

    def test_overlapping_title_across_files_keeps_first(self):
        """Second file's row with duplicate title is skipped; first body wins."""
        a = [{
            "question_text": "Data retention policy?",
            "answer_standard": "ANSWER_A",
            "source_file": "/tmp/a.docx",
            "row_index": 1,
        }]
        b = [{
            "question_text": "Data retention policy?",
            "answer_standard": "DRAFT_ANSWER_B",
            "source_file": "/tmp/b-DRAFT.docx",
            "row_index": 3,
        }]
        kept, skipped = dedup_across_files_by_title([("/tmp/a.docx", a), ("/tmp/b-DRAFT.docx", b)])

        assert [p["answer_standard"] for p in kept] == ["ANSWER_A"]
        assert [p["answer_standard"] for p in skipped] == ["DRAFT_ANSWER_B"]
        assert skipped[0]["_skipped_because"] == {
            "first_seen_file": "a.docx",
            "first_seen_row": 1,
            "first_seen_question": "Data retention policy?",
        }

    def test_title_normalisation_matches_exact_dedup(self):
        """Punctuation + case differences still collide (same as exact_dedup)."""
        a = [{"question_text": "Data retention?", "source_file": "a.docx", "row_index": 1}]
        b = [{"question_text": "Data  retention???", "source_file": "b.docx", "row_index": 1}]
        kept, skipped = dedup_across_files_by_title([("a.docx", a), ("b.docx", b)])
        assert len(kept) == 1
        assert len(skipped) == 1

    def test_within_file_duplicate_also_skipped(self):
        """Two rows with same title inside a single file: first wins."""
        a = [
            {"question_text": "Backups?", "answer_standard": "X", "source_file": "a.docx", "row_index": 1},
            {"question_text": "Backups?", "answer_standard": "Y", "source_file": "a.docx", "row_index": 7},
        ]
        kept, skipped = dedup_across_files_by_title([("a.docx", a)])
        assert len(kept) == 1
        assert kept[0]["answer_standard"] == "X"
        assert skipped[0]["_skipped_because"]["first_seen_row"] == 1

    def test_distinct_titles_pass_through(self):
        """Non-overlapping titles across files all pass through."""
        a = [{"question_text": "Q1?", "source_file": "a.docx", "row_index": 1}]
        b = [{"question_text": "Q2?", "source_file": "b.docx", "row_index": 1}]
        kept, skipped = dedup_across_files_by_title([("a.docx", a), ("b.docx", b)])
        assert len(kept) == 2
        assert len(skipped) == 0

    def test_file_order_determines_winner(self):
        """Reversing file order reverses which body is kept."""
        a = [{"question_text": "Q?", "answer_standard": "A_BODY", "source_file": "a.docx", "row_index": 1}]
        b = [{"question_text": "Q?", "answer_standard": "B_BODY", "source_file": "b.docx", "row_index": 1}]
        kept_ab, _ = dedup_across_files_by_title([("a.docx", a.copy()), ("b.docx", b.copy())])
        kept_ba, _ = dedup_across_files_by_title([("b.docx", b.copy()), ("a.docx", a.copy())])
        assert kept_ab[0]["answer_standard"] == "A_BODY"
        assert kept_ba[0]["answer_standard"] == "B_BODY"


class TestMainIntegrationCrossFileDedup:
    """main() skips duplicate-title rows from later files and logs provenance."""

    def test_second_file_duplicate_title_not_stored(self, capsys):
        """Given two files with overlapping title, only first file's body is stored."""
        pair_a = {
            "question_text": "Do you encrypt data at rest?",
            "answer_standard": "Yes — AES-256 FIRST FILE BODY.",
            "answer_advanced": "",
            "section_name": "Security",
            "source_file": "/tmp/fake/a-final.docx",
            "table_index": 0,
            "row_index": 1,
            "primary_domain": "security-compliance",
            "primary_subtopic": "data-protection",
            "classification_confidence": 0.9,
            "has_tracked_changes": False,
        }
        pair_b_dup = {
            **pair_a,
            "answer_standard": "DRAFT SECOND FILE BODY — should be dropped.",
            "source_file": "/tmp/fake/b-DRAFT.docx",
            "row_index": 7,
        }
        pair_b_unique = {
            **pair_a,
            "question_text": "Do you rotate credentials?",
            "answer_standard": "Yes — 90 day rotation.",
            "source_file": "/tmp/fake/b-DRAFT.docx",
            "row_index": 8,
        }

        def fake_extract(filepath, emit_markdown=False):
            if filepath.endswith("a-final.docx"):
                return [pair_a]
            return [pair_b_dup, pair_b_unique]

        argv = ["import_bid_library.py", "/tmp/fake-dir"]
        insert_calls = []

        def fake_insert(record):
            insert_calls.append(record)
            return (True, f"qa-item-{len(insert_calls)}")

        patches = [
            patch("sys.argv", argv),
            patch(
                "import_bid_library.find_docx_files",
                return_value=["/tmp/fake/a-final.docx", "/tmp/fake/b-DRAFT.docx"],
            ),
            patch("import_bid_library.has_tracked_changes", return_value=False),
            patch("import_bid_library.extract_qa_from_docx", side_effect=fake_extract),
            patch("import_bid_library.find_near_duplicates", return_value=[]),
            patch("import_bid_library.classify_pairs", side_effect=lambda pairs: pairs),
            patch("import_bid_library.classification_summary", return_value={}),
            patch("import_bid_library.check_question_exists", return_value=False),
            patch("kb_pipeline.embed.build_embedding_text", return_value="embed text"),
            patch(
                "kb_pipeline.embed.generate_embedding",
                return_value=([0.1] * 1024, 500),
            ),
            patch("kb_pipeline.store.insert_content_item", side_effect=fake_insert),
            patch("kb_pipeline.chunk.store_chunks", return_value=(1, [])),
        ]
        for p in patches:
            p.start()
        try:
            from import_bid_library import main
            main()
        finally:
            for p in patches:
                p.stop()

        # Exactly two records inserted: A's encryption body + B's unique credential body.
        assert len(insert_calls) == 2
        stored_contents = [r["content"] for r in insert_calls]
        assert any("FIRST FILE BODY" in c for c in stored_contents)
        assert any("90 day rotation" in c for c in stored_contents)
        assert not any("DRAFT SECOND FILE BODY" in c for c in stored_contents)

        # Log line names the skipped row's filename, row index, and question.
        out = capsys.readouterr().out
        assert "Cross-file title skips: 1" in out
        assert "b-DRAFT.docx" in out
        assert "row 7" in out
        assert "Do you encrypt data at rest?" in out
        assert "first seen in a-final.docx" in out


class TestChunkOnIngest:
    """Verify store_chunks is wired into the EP8 store loop (spec R2/R3)."""

    def test_store_chunks_called_on_insert_success(self):
        """store_chunks called once per stored pair with (item_id, content)."""
        patches = _patch_main_env()
        mocks = [p.start() for p in patches]
        try:
            with patch("kb_pipeline.chunk.store_chunks", return_value=(2, [])) as mock_chunks:
                from import_bid_library import main
                main()
                assert mock_chunks.call_count == 1
                args, _ = mock_chunks.call_args
                assert args[0] == "qa-item-1"
                assert "AES-256" in args[1]
        finally:
            for p in patches:
                p.stop()

    def test_skip_embed_skips_chunks(self):
        """--skip-embed flag prevents store_chunks from being called."""
        patches = _patch_main_env(argv_extra=["--skip-embed"])
        for p in patches:
            p.start()
        try:
            with patch("kb_pipeline.chunk.store_chunks") as mock_chunks:
                from import_bid_library import main
                main()
                mock_chunks.assert_not_called()
        finally:
            for p in patches:
                p.stop()

    def test_chunk_error_is_non_blocking(self):
        """store_chunks raising does not abort the import loop."""
        patches = _patch_main_env()
        for p in patches:
            p.start()
        try:
            with patch(
                "kb_pipeline.chunk.store_chunks",
                side_effect=RuntimeError("embed offline"),
            ) as mock_chunks:
                from import_bid_library import main
                main()
                mock_chunks.assert_called_once()
        finally:
            for p in patches:
                p.stop()


# ── Phase 3 content shape: \n\n between answers ──────────────────────────


class TestContentShapeDoubleNewline:
    """Phase 3: canonical content shape uses \\n\\n between answers.

    Spec: p0-bm-phase3 ss4.1 + ss6.1.
    """

    def _make_pair(self, **overrides):
        pair = {
            "question_text": "What is your data protection policy?",
            "answer_standard": "We follow GDPR best practices.",
            "answer_advanced": "Our advanced data protection includes encryption at rest.",
            "section_name": "Security",
            "source_file": "test.docx",
            "table_index": 0,
            "row_index": 1,
            "primary_domain": "security",
            "primary_subtopic": "data-protection",
            "classification_confidence": 0.7,
        }
        pair.update(overrides)
        return pair

    def test_both_answers_double_newline_separator(self):
        """When both answers present, content uses \\n\\n between them."""
        pair = self._make_pair()
        record = build_content_record(pair, "test-batch")
        content = record["content"]
        # Shape: "Q: {q}\n\n{a_s}\n\n{a_a}"
        assert content.startswith("Q: What is your data protection policy?")
        assert "We follow GDPR best practices.\n\nOur advanced" in content

    def test_standard_only_no_trailing_newlines(self):
        """When only standard answer, no trailing blank lines."""
        pair = self._make_pair(answer_advanced="")
        record = build_content_record(pair, "test-batch")
        content = record["content"]
        assert content == "Q: What is your data protection policy?\n\nWe follow GDPR best practices."

    def test_advanced_only(self):
        """When only advanced answer, it follows question directly."""
        pair = self._make_pair(answer_standard="")
        record = build_content_record(pair, "test-batch")
        content = record["content"]
        assert content == "Q: What is your data protection policy?\n\nOur advanced data protection includes encryption at rest."

    def test_neither_answer(self):
        """When both answers empty, content is question + blank separator."""
        pair = self._make_pair(answer_standard="", answer_advanced="")
        record = build_content_record(pair, "test-batch")
        content = record["content"]
        # The blank line separator ("") is always added after question,
        # producing "Q: ...\n" (join of ["Q: ...", ""])
        assert content.startswith("Q: What is your data protection policy?")
