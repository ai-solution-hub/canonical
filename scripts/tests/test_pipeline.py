"""Tests for kb_pipeline/pipeline.py — orchestrator module.

No production code bugs or dead code paths found during test authoring.
"""

import os
import sys
import time
from dataclasses import dataclass
from unittest.mock import patch, MagicMock, call

import pytest

# Add scripts dir to path so we can import kb_pipeline
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from kb_pipeline.pipeline import process_url, process_urls, _log_quality_flags, PipelineResult
from kb_pipeline.extract import ExtractedContent
from kb_pipeline.classify import ClassificationResult


# ── Helpers ──────────────────────────────────────────────────────────────────


def _make_extracted(
    title="Test Article",
    content="x" * 200,
    source_url="https://example.com/article",
    source_domain="example.com",
    thumbnail_url="https://example.com/thumb.jpg",
    content_type="article",
    platform="web",
    author_name="Test Author",
    captured_date="2026-01-01T00:00:00Z",
    metadata=None,
):
    return ExtractedContent(
        title=title,
        content=content,
        source_url=source_url,
        source_domain=source_domain,
        thumbnail_url=thumbnail_url,
        content_type=content_type,
        platform=platform,
        author_name=author_name,
        captured_date=captured_date,
        metadata=metadata or {},
    )


def _make_cls(
    primary_domain="Technology & Digital",
    primary_subtopic="Cybersecurity & InfoSec",
    confidence=0.92,
    secondary_domain=None,
    secondary_subtopic=None,
    suggested_title="Suggested Title",
    summary="A summary of the content for testing purposes.",
    ai_keywords=None,
    reasoning="This is a reasoning string.",
    is_fragment=False,
    uncertain=False,
    requires_review=False,
    reason_if_flagged="",
    input_tokens=1000,
    output_tokens=200,
    cache_creation_tokens=0,
    cache_read_tokens=0,
):
    return ClassificationResult(
        primary_domain=primary_domain,
        primary_subtopic=primary_subtopic,
        confidence=confidence,
        secondary_domain=secondary_domain,
        secondary_subtopic=secondary_subtopic,
        suggested_title=suggested_title,
        summary=summary,
        ai_keywords=ai_keywords or ["testing", "pipeline"],
        reasoning=reasoning,
        is_fragment=is_fragment,
        uncertain=uncertain,
        requires_review=requires_review,
        reason_if_flagged=reason_if_flagged,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        cache_creation_tokens=cache_creation_tokens,
        cache_read_tokens=cache_read_tokens,
    )


# Common mock path prefix
_P = "kb_pipeline.pipeline"


# ── process_url — happy path ────────────────────────────────────────────────


class TestProcessUrlHappyPath:
    """process_url happy path — all steps succeed."""

    @patch(f"{_P}.log_quality_issue")
    @patch(f"{_P}.insert_content_item", return_value=(True, "item-uuid-123"))
    @patch(f"{_P}.generate_summary", return_value=None)
    @patch(f"{_P}.generate_embedding", return_value=([0.1] * 1024, 500))
    @patch(f"{_P}.build_embedding_text", return_value="embed text")
    @patch(f"{_P}.is_duplicate", return_value=(False, None, ""))
    @patch(f"{_P}.classify")
    @patch(f"{_P}.extract_url")
    def test_all_steps_succeed(self, mock_extract, mock_classify,
                                mock_dedup, mock_build_embed, mock_gen_embed,
                                mock_summary, mock_insert, mock_quality):
        """All pipeline steps succeed — PipelineResult with success=True and item_id set."""
        mock_extract.return_value = _make_extracted()
        mock_classify.return_value = _make_cls()

        result = process_url("https://example.com/article")

        assert result.success is True
        assert result.item_id == "item-uuid-123"
        assert result.title == "Test Article"
        assert result.primary_domain == "Technology & Digital"
        assert result.confidence == 0.92
        assert result.error == ""

    @patch(f"{_P}.log_quality_issue")
    @patch(f"{_P}.insert_content_item", return_value=(True, "item-uuid-456"))
    @patch(f"{_P}.generate_summary")
    @patch(f"{_P}.generate_embedding", return_value=([0.1] * 1024, 500))
    @patch(f"{_P}.build_embedding_text", return_value="embed text")
    @patch(f"{_P}.is_duplicate", return_value=(False, None, ""))
    @patch(f"{_P}.classify")
    @patch(f"{_P}.extract_url")
    def test_classification_embedding_summary_merged(self, mock_extract, mock_classify,
                                                      mock_dedup, mock_build_embed,
                                                      mock_gen_embed, mock_summary,
                                                      mock_insert, mock_quality):
        """Classification, embedding, and summary data correctly merged into stored record."""
        mock_extract.return_value = _make_extracted()
        mock_classify.return_value = _make_cls()
        mock_summary.return_value = {
            "executive": "Executive summary",
            "detailed": "Detailed summary",
            "takeaways": ["point 1", "point 2"],
            "generated_at": "2026-01-01T00:00:00Z",
            "model": "claude-sonnet-4-6",
            "tokens_used": 1500,
            "cost": 0.005,
        }

        result = process_url("https://example.com/article")

        assert result.success is True
        assert result.summary_cost == 0.005

        # Verify insert was called with merged record
        insert_call = mock_insert.call_args[0][0]
        assert insert_call["primary_domain"] == "Technology & Digital"
        assert insert_call["embedding"] == [0.1] * 1024
        assert insert_call["summary_data"]["executive"] == "Executive summary"
        assert insert_call["summary"] == "Executive summary"


# ── process_url — extraction failure ────────────────────────────────────────


class TestProcessUrlExtractionFailure:
    """process_url when extraction fails."""

    @patch(f"{_P}.extract_url", return_value=None)
    def test_extract_returns_none(self, mock_extract):
        """extract_url returns None — error set, early return."""
        result = process_url("https://example.com/broken")

        assert result.success is False
        assert "Extraction failed" in result.error
        assert result.item_id == ""


# ── process_url — dedup ─────────────────────────────────────────────────────


class TestProcessUrlDedup:
    """process_url deduplication checks."""

    @patch(f"{_P}.is_duplicate", return_value=(True, "existing-id-1", "url"))
    @patch(f"{_P}.extract_url")
    def test_url_duplicate_skipped(self, mock_extract, mock_dedup):
        """URL duplicate detected — skipped=True, skip_reason mentions 'url'."""
        mock_extract.return_value = _make_extracted()

        result = process_url("https://example.com/article")

        assert result.skipped is True
        assert "url" in result.skip_reason.lower() or "Duplicate" in result.skip_reason

    @patch(f"{_P}.log_quality_issue")
    @patch(f"{_P}.insert_content_item", return_value=(True, "new-id"))
    @patch(f"{_P}.generate_summary", return_value=None)
    @patch(f"{_P}.generate_embedding", return_value=([0.1] * 1024, 500))
    @patch(f"{_P}.build_embedding_text", return_value="embed text")
    @patch(f"{_P}.is_duplicate")
    @patch(f"{_P}.classify")
    @patch(f"{_P}.extract_url")
    def test_post_embed_duplicate_skipped(self, mock_extract, mock_classify,
                                           mock_dedup, mock_build_embed,
                                           mock_gen_embed, mock_summary,
                                           mock_insert, mock_quality):
        """Post-embed duplicate detected — skipped=True, skip_reason mentions 'embedding'."""
        mock_extract.return_value = _make_extracted()
        mock_classify.return_value = _make_cls()
        # First call (URL dedup) passes, second call (embedding dedup) detects duplicate
        mock_dedup.side_effect = [
            (False, None, ""),
            (True, "existing-embed-id", "embedding"),
        ]

        result = process_url("https://example.com/article")

        assert result.skipped is True
        assert "embedding" in result.skip_reason.lower()


# ── process_url — failure modes ─────────────────────────────────────────────


class TestProcessUrlFailureModes:
    """process_url graceful degradation on step failures."""

    @patch(f"{_P}.log_quality_issue")
    @patch(f"{_P}.insert_content_item", return_value=(True, "item-id"))
    @patch(f"{_P}.generate_summary", return_value=None)
    @patch(f"{_P}.generate_embedding", return_value=([0.1] * 1024, 500))
    @patch(f"{_P}.build_embedding_text", return_value="embed text")
    @patch(f"{_P}.is_duplicate", return_value=(False, None, ""))
    @patch(f"{_P}.classify", side_effect=Exception("API timeout"))
    @patch(f"{_P}.extract_url")
    def test_classify_raises_continues(self, mock_extract, mock_classify,
                                        mock_dedup, mock_build_embed,
                                        mock_gen_embed, mock_summary,
                                        mock_insert, mock_quality):
        """classify raises exception — continues without classification."""
        mock_extract.return_value = _make_extracted()

        result = process_url("https://example.com/article")

        assert result.success is True
        assert result.primary_domain == ""
        assert "Classification failed" in result.error

    @patch(f"{_P}.log_quality_issue")
    @patch(f"{_P}.insert_content_item", return_value=(True, "item-id"))
    @patch(f"{_P}.generate_summary", return_value=None)
    @patch(f"{_P}.generate_embedding", side_effect=Exception("OpenAI error"))
    @patch(f"{_P}.build_embedding_text", return_value="embed text")
    @patch(f"{_P}.is_duplicate", return_value=(False, None, ""))
    @patch(f"{_P}.classify")
    @patch(f"{_P}.extract_url")
    def test_embedding_raises_continues(self, mock_extract, mock_classify,
                                         mock_dedup, mock_build_embed,
                                         mock_gen_embed, mock_summary,
                                         mock_insert, mock_quality):
        """generate_embedding raises — continues without embedding."""
        mock_extract.return_value = _make_extracted()
        mock_classify.return_value = _make_cls()

        result = process_url("https://example.com/article")

        assert result.success is True
        assert result.embed_tokens == 0

    @patch(f"{_P}.generate_summary", return_value=None)
    @patch(f"{_P}.generate_embedding", return_value=([0.1] * 1024, 500))
    @patch(f"{_P}.build_embedding_text", return_value="embed text")
    @patch(f"{_P}.is_duplicate", return_value=(False, None, ""))
    @patch(f"{_P}.classify")
    @patch(f"{_P}.extract_url")
    @patch(f"{_P}.insert_content_item", return_value=(False, "DB connection failed"))
    def test_insert_failure_sets_error(self, mock_insert, mock_extract,
                                        mock_classify, mock_dedup,
                                        mock_build_embed, mock_gen_embed,
                                        mock_summary):
        """insert_content_item returns (False, error) — result.error set."""
        mock_extract.return_value = _make_extracted()
        mock_classify.return_value = _make_cls()

        result = process_url("https://example.com/article")

        assert result.success is False
        assert "Insert failed" in result.error
        assert "DB connection failed" in result.error


# ── process_url — skip flags ────────────────────────────────────────────────


class TestProcessUrlSkipFlags:
    """process_url skip flags bypass pipeline steps."""

    @patch(f"{_P}.log_quality_issue")
    @patch(f"{_P}.insert_content_item", return_value=(True, "item-id"))
    @patch(f"{_P}.generate_summary", return_value=None)
    @patch(f"{_P}.generate_embedding", return_value=([0.1] * 1024, 500))
    @patch(f"{_P}.build_embedding_text", return_value="embed text")
    @patch(f"{_P}.is_duplicate")
    @patch(f"{_P}.classify")
    @patch(f"{_P}.extract_url")
    def test_skip_dedup_skips_both_checks(self, mock_extract, mock_classify,
                                           mock_dedup, mock_build_embed,
                                           mock_gen_embed, mock_summary,
                                           mock_insert, mock_quality):
        """skip_dedup=True skips both URL and embedding dedup checks."""
        mock_extract.return_value = _make_extracted()
        mock_classify.return_value = _make_cls()

        result = process_url("https://example.com/article", skip_dedup=True)

        assert result.success is True
        mock_dedup.assert_not_called()

    @patch(f"{_P}.log_quality_issue")
    @patch(f"{_P}.insert_content_item", return_value=(True, "item-id"))
    @patch(f"{_P}.generate_summary", return_value=None)
    @patch(f"{_P}.generate_embedding", return_value=([0.1] * 1024, 500))
    @patch(f"{_P}.build_embedding_text", return_value="embed text")
    @patch(f"{_P}.is_duplicate", return_value=(False, None, ""))
    @patch(f"{_P}.classify")
    @patch(f"{_P}.extract_url")
    def test_skip_classify_skips_classification(self, mock_extract, mock_classify,
                                                  mock_dedup, mock_build_embed,
                                                  mock_gen_embed, mock_summary,
                                                  mock_insert, mock_quality):
        """skip_classify=True skips classification."""
        mock_extract.return_value = _make_extracted()

        result = process_url("https://example.com/article", skip_classify=True)

        assert result.success is True
        mock_classify.assert_not_called()
        assert result.primary_domain == ""

    @patch(f"{_P}.log_quality_issue")
    @patch(f"{_P}.insert_content_item", return_value=(True, "item-id"))
    @patch(f"{_P}.generate_summary", return_value=None)
    @patch(f"{_P}.generate_embedding")
    @patch(f"{_P}.build_embedding_text")
    @patch(f"{_P}.is_duplicate", return_value=(False, None, ""))
    @patch(f"{_P}.classify")
    @patch(f"{_P}.extract_url")
    def test_skip_embed_skips_embedding(self, mock_extract, mock_classify,
                                         mock_dedup, mock_build_embed,
                                         mock_gen_embed, mock_summary,
                                         mock_insert, mock_quality):
        """skip_embed=True skips embedding generation."""
        mock_extract.return_value = _make_extracted()
        mock_classify.return_value = _make_cls()

        result = process_url("https://example.com/article", skip_embed=True)

        assert result.success is True
        mock_gen_embed.assert_not_called()
        assert result.embed_tokens == 0

    @patch(f"{_P}.generate_summary", return_value=None)
    @patch(f"{_P}.generate_embedding", return_value=([0.1] * 1024, 500))
    @patch(f"{_P}.build_embedding_text", return_value="embed text")
    @patch(f"{_P}.is_duplicate", return_value=(False, None, ""))
    @patch(f"{_P}.classify")
    @patch(f"{_P}.extract_url")
    @patch(f"{_P}.insert_content_item")
    def test_dry_run_skips_store(self, mock_insert, mock_extract, mock_classify,
                                  mock_dedup, mock_build_embed, mock_gen_embed,
                                  mock_summary):
        """dry_run=True skips store, returns success with skip_reason."""
        mock_extract.return_value = _make_extracted()
        mock_classify.return_value = _make_cls()

        result = process_url("https://example.com/article", dry_run=True)

        assert result.success is True
        assert result.skipped is True
        assert "Dry run" in result.skip_reason
        mock_insert.assert_not_called()


# ── process_url — overrides ─────────────────────────────────────────────────


class TestProcessUrlOverrides:
    """process_url applies field overrides to extracted content."""

    @patch(f"{_P}.log_quality_issue")
    @patch(f"{_P}.insert_content_item", return_value=(True, "item-id"))
    @patch(f"{_P}.generate_summary", return_value=None)
    @patch(f"{_P}.generate_embedding", return_value=([0.1] * 1024, 500))
    @patch(f"{_P}.build_embedding_text", return_value="embed text")
    @patch(f"{_P}.is_duplicate", return_value=(False, None, ""))
    @patch(f"{_P}.classify")
    @patch(f"{_P}.extract_url")
    def test_override_title(self, mock_extract, mock_classify, mock_dedup,
                             mock_build_embed, mock_gen_embed, mock_summary,
                             mock_insert, mock_quality):
        """override_title applied to extracted content."""
        mock_extract.return_value = _make_extracted(title="Original Title")
        mock_classify.return_value = _make_cls()

        result = process_url("https://example.com", override_title="Custom Title")

        assert result.title == "Custom Title"
        insert_record = mock_insert.call_args[0][0]
        assert insert_record["title"] == "Custom Title"

    @patch(f"{_P}.log_quality_issue")
    @patch(f"{_P}.insert_content_item", return_value=(True, "item-id"))
    @patch(f"{_P}.generate_summary", return_value=None)
    @patch(f"{_P}.generate_embedding", return_value=([0.1] * 1024, 500))
    @patch(f"{_P}.build_embedding_text", return_value="embed text")
    @patch(f"{_P}.is_duplicate", return_value=(False, None, ""))
    @patch(f"{_P}.classify")
    @patch(f"{_P}.extract_url")
    def test_override_content_type(self, mock_extract, mock_classify, mock_dedup,
                                     mock_build_embed, mock_gen_embed, mock_summary,
                                     mock_insert, mock_quality):
        """override_content_type applied to extracted content."""
        mock_extract.return_value = _make_extracted(content_type="article")
        mock_classify.return_value = _make_cls()

        result = process_url("https://example.com", override_content_type="blog")

        insert_record = mock_insert.call_args[0][0]
        assert insert_record["content_type"] == "blog"

    @patch(f"{_P}.log_quality_issue")
    @patch(f"{_P}.insert_content_item", return_value=(True, "item-id"))
    @patch(f"{_P}.generate_summary", return_value=None)
    @patch(f"{_P}.generate_embedding", return_value=([0.1] * 1024, 500))
    @patch(f"{_P}.build_embedding_text", return_value="embed text")
    @patch(f"{_P}.is_duplicate", return_value=(False, None, ""))
    @patch(f"{_P}.classify")
    @patch(f"{_P}.extract_url")
    def test_override_platform(self, mock_extract, mock_classify, mock_dedup,
                                 mock_build_embed, mock_gen_embed, mock_summary,
                                 mock_insert, mock_quality):
        """override_platform applied to extracted content."""
        mock_extract.return_value = _make_extracted(platform="web")
        mock_classify.return_value = _make_cls()

        result = process_url("https://example.com", override_platform="manual")

        insert_record = mock_insert.call_args[0][0]
        assert insert_record["platform"] == "manual"

    @patch(f"{_P}.log_quality_issue")
    @patch(f"{_P}.insert_content_item", return_value=(True, "item-id"))
    @patch(f"{_P}.generate_summary", return_value=None)
    @patch(f"{_P}.generate_embedding", return_value=([0.1] * 1024, 500))
    @patch(f"{_P}.build_embedding_text", return_value="embed text")
    @patch(f"{_P}.is_duplicate", return_value=(False, None, ""))
    @patch(f"{_P}.classify")
    @patch(f"{_P}.extract_url")
    def test_override_author(self, mock_extract, mock_classify, mock_dedup,
                               mock_build_embed, mock_gen_embed, mock_summary,
                               mock_insert, mock_quality):
        """override_author applied to extracted content."""
        mock_extract.return_value = _make_extracted(author_name="Original")
        mock_classify.return_value = _make_cls()

        result = process_url("https://example.com", override_author="Custom Author")

        insert_record = mock_insert.call_args[0][0]
        assert insert_record["author_name"] == "Custom Author"

    @patch(f"{_P}.log_quality_issue")
    @patch(f"{_P}.insert_content_item", return_value=(True, "item-id"))
    @patch(f"{_P}.generate_summary", return_value=None)
    @patch(f"{_P}.generate_embedding", return_value=([0.1] * 1024, 500))
    @patch(f"{_P}.build_embedding_text", return_value="embed text")
    @patch(f"{_P}.is_duplicate", return_value=(False, None, ""))
    @patch(f"{_P}.classify")
    @patch(f"{_P}.extract_url")
    def test_extra_metadata_merged(self, mock_extract, mock_classify, mock_dedup,
                                     mock_build_embed, mock_gen_embed, mock_summary,
                                     mock_insert, mock_quality):
        """extra_metadata merged into extracted metadata."""
        mock_extract.return_value = _make_extracted(metadata={"existing": "value"})
        mock_classify.return_value = _make_cls()

        result = process_url("https://example.com",
                             extra_metadata={"batch": "test-batch", "custom": 42})

        insert_record = mock_insert.call_args[0][0]
        assert insert_record["metadata"]["existing"] == "value"
        assert insert_record["metadata"]["batch"] == "test-batch"
        assert insert_record["metadata"]["custom"] == 42


# ── process_url — summary ───────────────────────────────────────────────────


class TestProcessUrlSummary:
    """process_url summary generation conditions."""

    @patch(f"{_P}.log_quality_issue")
    @patch(f"{_P}.insert_content_item", return_value=(True, "item-id"))
    @patch(f"{_P}.generate_summary")
    @patch(f"{_P}.generate_embedding", return_value=([0.1] * 1024, 500))
    @patch(f"{_P}.build_embedding_text", return_value="embed text")
    @patch(f"{_P}.is_duplicate", return_value=(False, None, ""))
    @patch(f"{_P}.classify")
    @patch(f"{_P}.extract_url")
    def test_summary_generated_with_cls_and_embedding(self, mock_extract, mock_classify,
                                                       mock_dedup, mock_build_embed,
                                                       mock_gen_embed, mock_summary,
                                                       mock_insert, mock_quality):
        """Summary generated when classification and embedding are present."""
        mock_extract.return_value = _make_extracted()
        mock_classify.return_value = _make_cls()
        mock_summary.return_value = {
            "executive": "Exec", "detailed": "Detail",
            "takeaways": ["a"], "generated_at": "2026-01-01",
            "model": "claude-sonnet-4-6", "tokens_used": 100, "cost": 0.001,
        }

        process_url("https://example.com")

        mock_summary.assert_called_once()

    @patch(f"{_P}.log_quality_issue")
    @patch(f"{_P}.insert_content_item", return_value=(True, "item-id"))
    @patch(f"{_P}.generate_summary")
    @patch(f"{_P}.generate_embedding", return_value=([0.1] * 1024, 500))
    @patch(f"{_P}.build_embedding_text", return_value="embed text")
    @patch(f"{_P}.is_duplicate", return_value=(False, None, ""))
    @patch(f"{_P}.classify", side_effect=Exception("classify boom"))
    @patch(f"{_P}.extract_url")
    def test_summary_skipped_when_no_cls(self, mock_extract, mock_classify,
                                          mock_dedup, mock_build_embed,
                                          mock_gen_embed, mock_summary,
                                          mock_insert, mock_quality):
        """Summary skipped when no classification available."""
        mock_extract.return_value = _make_extracted()

        process_url("https://example.com")

        mock_summary.assert_not_called()

    @patch(f"{_P}.log_quality_issue")
    @patch(f"{_P}.insert_content_item", return_value=(True, "item-id"))
    @patch(f"{_P}.generate_summary")
    @patch(f"{_P}.generate_embedding", return_value=([0.1] * 1024, 500))
    @patch(f"{_P}.build_embedding_text", return_value="embed text")
    @patch(f"{_P}.is_duplicate", return_value=(False, None, ""))
    @patch(f"{_P}.classify")
    @patch(f"{_P}.extract_url")
    def test_summary_flag_false_skips(self, mock_extract, mock_classify,
                                       mock_dedup, mock_build_embed,
                                       mock_gen_embed, mock_summary,
                                       mock_insert, mock_quality):
        """generate_summary_flag=False skips summary generation."""
        mock_extract.return_value = _make_extracted()
        mock_classify.return_value = _make_cls()

        process_url("https://example.com", generate_summary_flag=False)

        mock_summary.assert_not_called()


# ── _log_quality_flags ──────────────────────────────────────────────────────


class TestLogQualityFlags:
    """_log_quality_flags detects and logs quality issues."""

    @patch(f"{_P}.log_quality_issue")
    def test_missing_thumbnail_logged(self, mock_log):
        """Missing thumbnail flagged."""
        extracted = _make_extracted(thumbnail_url="")
        result = PipelineResult()

        _log_quality_flags("item-1", extracted, _make_cls(), "batch", result)

        assert "missing_thumbnail" in result.quality_flags
        mock_log.assert_any_call(
            "item-1", "missing_thumbnail", "warning",
            {"url": extracted.source_url}, extracted.source_url, "batch"
        )

    @patch(f"{_P}.log_quality_issue")
    def test_short_content_logged(self, mock_log):
        """Short content flagged when below threshold."""
        extracted = _make_extracted(content="short")
        result = PipelineResult()

        _log_quality_flags("item-2", extracted, _make_cls(), "batch", result)

        assert "short_content" in result.quality_flags

    @patch(f"{_P}.log_quality_issue")
    def test_low_confidence_logged(self, mock_log):
        """Low classification confidence flagged."""
        extracted = _make_extracted()
        cls = _make_cls(confidence=0.3)
        result = PipelineResult()

        _log_quality_flags("item-3", extracted, cls, "batch", result)

        assert "classification_low" in result.quality_flags


# ── process_urls ─────────────────────────────────────────────────────────────


class TestProcessUrls:
    """process_urls batch processing."""

    @patch(f"{_P}.time.sleep")
    @patch(f"{_P}.classify_cost", return_value=0.01)
    @patch(f"{_P}.embed_cost", return_value=0.001)
    @patch(f"{_P}.process_url")
    def test_returns_list_matching_input_length(self, mock_process, mock_embed_cost,
                                                  mock_cls_cost, mock_sleep):
        """Processes all URLs, returns list matching input length."""
        mock_process.return_value = PipelineResult(
            success=True, classify_input_tokens=100, embed_tokens=50,
        )

        urls = ["https://a.com", "https://b.com", "https://c.com"]
        results = process_urls(urls, batch_name="test-batch")

        assert len(results) == 3
        assert mock_process.call_count == 3

    @patch(f"{_P}.classify_cost", return_value=0.0)
    @patch(f"{_P}.embed_cost", return_value=0.0)
    @patch(f"{_P}.process_url")
    @patch(f"{_P}.time.sleep")
    def test_rate_limiting_between_items(self, mock_sleep, mock_process,
                                          mock_embed_cost, mock_cls_cost):
        """Rate limiting via time.sleep called between items (not after last)."""
        mock_process.return_value = PipelineResult(success=True)

        urls = ["https://a.com", "https://b.com", "https://c.com"]
        process_urls(urls, batch_name="test", rate_limit=2.0)

        # sleep called between items, not after last — so 2 calls for 3 items
        assert mock_sleep.call_count == 2
        mock_sleep.assert_called_with(2.0)
