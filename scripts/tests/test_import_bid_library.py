"""Tests for import_bid_library.py — keyword extraction, content record building, and TC handling.

Covers the extract_keywords() function and build_content_record() to ensure
meaningful keywords are generated from Q&A content rather than slugified
section names. Also covers Track Changes detection integration, --require-clean,
and --batch-tag CLI flags.
"""

import sys
import os

# Add scripts dir to path so we can import the module
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest

from import_bid_library import (
    extract_keywords,
    build_content_record,
    truncate_at_word_boundary,
    validate_content_quality,
)


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
