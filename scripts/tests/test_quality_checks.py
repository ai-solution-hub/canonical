"""Tests for pipeline quality checks."""

import sys
import os
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "kb_pipeline"))

import pytest
from kb_pipeline.quality_checks import has_duplicate_sentences, detect_expired_dates


class TestDuplicateSentenceDetection:
    """Tests for has_duplicate_sentences()."""

    def test_no_duplicates(self):
        text = "This is a normal sentence. Here is another one. And a third unique sentence."
        result = has_duplicate_sentences(text)
        assert result["has_duplicates"] is False
        assert result["duplicate_count"] == 0

    def test_duplicate_sentence(self):
        text = "This is a repeated sentence that appears twice. Some other content here. This is a repeated sentence that appears twice."
        result = has_duplicate_sentences(text)
        assert result["has_duplicates"] is True
        assert result["duplicate_count"] == 1

    def test_empty_text(self):
        result = has_duplicate_sentences("")
        assert result["has_duplicates"] is False

    def test_none_text(self):
        result = has_duplicate_sentences(None)
        assert result["has_duplicates"] is False

    def test_short_sentences_ignored(self):
        text = "Yes. No. Yes. No."
        result = has_duplicate_sentences(text)
        assert result["has_duplicates"] is False  # Too short

    def test_case_insensitive(self):
        text = "The security policy is reviewed annually. Some other text. the security policy is reviewed annually."
        result = has_duplicate_sentences(text)
        assert result["has_duplicates"] is True

    def test_whitespace_normalisation(self):
        text = "The  policy  is  reviewed  each  year. Other content. The policy is reviewed each year."
        result = has_duplicate_sentences(text)
        assert result["has_duplicates"] is True

    def test_multiple_duplicates(self):
        text = (
            "First repeated sentence in the document. "
            "Second repeated sentence in the document. "
            "First repeated sentence in the document. "
            "Second repeated sentence in the document."
        )
        result = has_duplicate_sentences(text)
        assert result["has_duplicates"] is True
        assert result["duplicate_count"] == 2

    def test_duplicates_list_truncated(self):
        long_sentence = "A" * 100
        text = f"{long_sentence}. Some filler text here for spacing. {long_sentence}."
        result = has_duplicate_sentences(text)
        assert result["has_duplicates"] is True
        # The duplicated sentence in the list should be truncated to 80 chars
        assert len(result["duplicates"][0]) <= 80

    def test_custom_min_length(self):
        text = "Short dup. Other. Short dup."
        # Default min_sentence_length=20 should not flag this
        result = has_duplicate_sentences(text, min_sentence_length=5)
        assert result["has_duplicates"] is True

    def test_question_mark_splitting(self):
        text = "Is this policy reviewed annually? Some other content. Is this policy reviewed annually?"
        result = has_duplicate_sentences(text)
        assert result["has_duplicates"] is True

    def test_whitespace_only(self):
        result = has_duplicate_sentences("   ")
        assert result["has_duplicates"] is False


class TestDateExpiryDetection:
    """Tests for detect_expired_dates()."""

    def test_no_dates(self):
        text = "This text has no dates in it."
        result = detect_expired_dates(text)
        assert result["has_expired"] is False
        assert result["expired_count"] == 0

    def test_future_date(self):
        ref = datetime(2026, 1, 1, tzinfo=timezone.utc)
        text = "Our ISO certification expires on 28 August 2026."
        result = detect_expired_dates(text, reference_date=ref)
        assert result["has_expired"] is False
        assert len(result["future_dates"]) == 1

    def test_past_date(self):
        ref = datetime(2026, 6, 1, tzinfo=timezone.utc)
        text = "Our ICO registration was renewed on 28 August 2025."
        result = detect_expired_dates(text, reference_date=ref)
        assert result["has_expired"] is True
        assert result["expired_count"] == 1

    def test_mixed_dates(self):
        ref = datetime(2026, 3, 20, tzinfo=timezone.utc)
        text = "Registered 1 January 2024. Expires 28 August 2026."
        result = detect_expired_dates(text, reference_date=ref)
        assert result["has_expired"] is True
        assert result["expired_count"] == 1
        assert len(result["future_dates"]) == 1

    def test_uk_date_format(self):
        ref = datetime(2026, 3, 20, tzinfo=timezone.utc)
        text = "Certificate issued 15/01/2024."
        result = detect_expired_dates(text, reference_date=ref)
        assert result["has_expired"] is True

    def test_month_year_only(self):
        ref = datetime(2026, 6, 1, tzinfo=timezone.utc)
        text = "Last reviewed March 2025."
        result = detect_expired_dates(text, reference_date=ref)
        assert result["has_expired"] is True

    def test_empty_text(self):
        result = detect_expired_dates("")
        assert result["has_expired"] is False

    def test_none_text(self):
        result = detect_expired_dates(None)
        assert result["has_expired"] is False

    def test_invalid_day_falls_back_to_month_year(self):
        ref = datetime(2026, 3, 20, tzinfo=timezone.utc)
        text = "On 31 February 2025 something happened."
        result = detect_expired_dates(text, reference_date=ref)
        # "31 February 2025" is invalid as a full date, but "February 2025"
        # is still detected as a valid month-year pattern
        assert result["expired_count"] == 1
        assert result["expired_dates"][0]["text"] == "February 2025"

    def test_truly_invalid_date_ignored(self):
        ref = datetime(2026, 3, 20, tzinfo=timezone.utc)
        text = "On 15/13/2025 something happened."
        result = detect_expired_dates(text, reference_date=ref)
        # Month 13 is invalid — no fallback possible
        assert result["expired_count"] == 0

    def test_multiple_expired(self):
        ref = datetime(2026, 6, 1, tzinfo=timezone.utc)
        text = "Registered 1 January 2024. Renewed 15 March 2025. Expires 28 August 2026."
        result = detect_expired_dates(text, reference_date=ref)
        assert result["expired_count"] == 2
        assert len(result["future_dates"]) == 1

    def test_slash_date_future(self):
        ref = datetime(2026, 1, 1, tzinfo=timezone.utc)
        text = "Valid until 31/12/2027."
        result = detect_expired_dates(text, reference_date=ref)
        assert result["has_expired"] is False
        assert len(result["future_dates"]) == 1

    def test_month_year_not_double_counted(self):
        ref = datetime(2026, 3, 20, tzinfo=timezone.utc)
        text = "Issued 28 August 2025."
        result = detect_expired_dates(text, reference_date=ref)
        # "August 2025" should not be counted separately since "28 August 2025" was matched
        assert result["expired_count"] == 1

    def test_parsed_date_in_result(self):
        ref = datetime(2026, 3, 20, tzinfo=timezone.utc)
        text = "Expires 28 August 2026."
        result = detect_expired_dates(text, reference_date=ref)
        assert len(result["future_dates"]) == 1
        entry = result["future_dates"][0]
        assert entry["text"] == "28 August 2026"
        assert "parsed_date" in entry
