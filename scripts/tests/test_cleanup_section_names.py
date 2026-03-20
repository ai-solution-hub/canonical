"""Tests for cleanup_section_names.py — section name deduplication."""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from cleanup_section_names import deduplicate_repeated_text


class TestDeduplicateRepeatedText:
    def test_tripled(self):
        assert deduplicate_repeated_text("Product SupportProduct SupportProduct Support") == "Product Support"

    def test_doubled(self):
        assert deduplicate_repeated_text("Data EncryptionData Encryption") == "Data Encryption"

    def test_normal(self):
        assert deduplicate_repeated_text("Physical Security") == "Physical Security"

    def test_empty(self):
        assert deduplicate_repeated_text("") == ""

    def test_single_word_tripled(self):
        assert deduplicate_repeated_text("SecuritySecuritySecurity") == "Security"

    def test_single_word_doubled(self):
        assert deduplicate_repeated_text("ComplianceCompliance") == "Compliance"

    def test_long_heading_tripled(self):
        assert deduplicate_repeated_text(
            "Information Security PolicyInformation Security PolicyInformation Security Policy"
        ) == "Information Security Policy"

    def test_whitespace_preserved(self):
        # Input with spaces between repetitions
        assert deduplicate_repeated_text("Support Support Support") == "Support"

    def test_short_text_not_mangled(self):
        # Very short text should not be treated as repeated
        assert deduplicate_repeated_text("OK") == "OK"
        assert deduplicate_repeated_text("AB") == "AB"

    def test_no_false_positive_on_similar_words(self):
        # Should not falsely detect repetition in normal text
        assert deduplicate_repeated_text("Data Protection Policy") == "Data Protection Policy"

    def test_strips_whitespace(self):
        assert deduplicate_repeated_text("  Product Support  ") == "Product Support"
