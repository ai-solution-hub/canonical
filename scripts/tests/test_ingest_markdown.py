"""Tests for ingest_markdown.py — markdown ingestion helpers.

No production code bugs or dead code paths found during test authoring.
"""

import json
import os
import sys
import tempfile
from unittest.mock import patch, MagicMock, mock_open

import pytest

# Add scripts dir to path so we can import the module
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from ingest_markdown import (
    extract_title,
    clean_mdx_tags,
    discover_markdown_files,
    check_source_file_exists,
    get_folder_tag,
    process_markdown_file,
)


# ── extract_title ────────────────────────────────────────────────────────────


class TestExtractTitle:
    """Title extraction from markdown content."""

    def test_extracts_h1_heading(self):
        """Extracts title from standard # Heading line."""
        content = "# My Great Article\n\nSome body text here."
        assert extract_title(content, "file.md") == "My Great Article"

    def test_extracts_bold_title_from_article_n_pattern(self):
        """Extracts bold title following '# Article N' pattern."""
        content = "# Article 3\n\n**AI Implementation Strategies**\n\nBody text."
        assert extract_title(content, "file.md") == "AI Implementation Strategies"

    def test_fallback_to_filename(self):
        """Falls back to filename when no heading found."""
        content = "No heading here, just plain text.\nMore text."
        assert extract_title(content, "my-great-article.md") == "My Great Article"

    def test_strips_whitespace(self):
        """Strips leading/trailing whitespace from extracted title."""
        content = "#   Spaced Title   \n\nBody text."
        assert extract_title(content, "file.md") == "Spaced Title"


# ── clean_mdx_tags ──────────────────────────────────────────────────────────


class TestCleanMdxTags:
    """MDX component tag stripping."""

    def test_strips_self_closing_tags(self):
        """Strips uppercase MDX component tags like <Note />."""
        content = "Before\n<Note />\nAfter"
        result = clean_mdx_tags(content)
        assert "<Note" not in result
        assert "Before" in result
        assert "After" in result

    def test_strips_tags_with_attributes(self):
        """Strips <Component attr='val'>...</Component> tags."""
        content = 'Before\n<Card title="Example">Inner text</Card>\nAfter'
        result = clean_mdx_tags(content)
        assert "<Card" not in result
        assert "</Card>" not in result
        assert "Inner text" in result

    def test_preserves_regular_markdown(self):
        """Preserves regular markdown content (headings, lists, links)."""
        content = "# Heading\n\n- item 1\n- item 2\n\n[link](url)"
        result = clean_mdx_tags(content)
        assert "# Heading" in result
        assert "- item 1" in result
        assert "[link](url)" in result

    def test_handles_nested_tags(self):
        """Handles nested MDX component tags."""
        content = "<Steps>\n<Step>\nDo something\n</Step>\n</Steps>"
        result = clean_mdx_tags(content)
        assert "<Steps>" not in result
        assert "<Step>" not in result
        assert "Do something" in result


# ── discover_markdown_files ──────────────────────────────────────────────────


class TestDiscoverMarkdownFiles:
    """Markdown file discovery in directories."""

    def test_finds_md_files_recursively(self):
        """Finds .md files in nested directories."""
        with tempfile.TemporaryDirectory() as tmpdir:
            # Create nested structure
            os.makedirs(os.path.join(tmpdir, "sub"))
            open(os.path.join(tmpdir, "root.md"), "w").close()
            open(os.path.join(tmpdir, "sub", "nested.md"), "w").close()

            files = discover_markdown_files(tmpdir)

            assert len(files) == 2
            assert any("root.md" in f for f in files)
            assert any("nested.md" in f for f in files)

    def test_ignores_non_md_files(self):
        """Ignores non-.md files in the directory."""
        with tempfile.TemporaryDirectory() as tmpdir:
            open(os.path.join(tmpdir, "article.md"), "w").close()
            open(os.path.join(tmpdir, "readme.txt"), "w").close()
            open(os.path.join(tmpdir, "data.json"), "w").close()

            files = discover_markdown_files(tmpdir)

            assert len(files) == 1
            assert files[0].endswith("article.md")

    def test_returns_sorted_list(self):
        """Returns sorted list of absolute file paths."""
        with tempfile.TemporaryDirectory() as tmpdir:
            open(os.path.join(tmpdir, "zebra.md"), "w").close()
            open(os.path.join(tmpdir, "alpha.md"), "w").close()
            open(os.path.join(tmpdir, "middle.md"), "w").close()

            files = discover_markdown_files(tmpdir)

            basenames = [os.path.basename(f) for f in files]
            assert basenames == ["alpha.md", "middle.md", "zebra.md"]


# ── check_source_file_exists ────────────────────────────────────────────────


class TestCheckSourceFileExists:
    """Check if source file already exists in Supabase."""

    @patch("ingest_markdown.get_supabase_secret_key", return_value="test-key")
    @patch("ingest_markdown.get_supabase_url", return_value="https://test.supabase.co")
    @patch("ingest_markdown.urllib.request.urlopen")
    def test_file_found_returns_true(self, mock_urlopen, mock_url, mock_key):
        """File found in DB returns True."""
        mock_resp = MagicMock()
        mock_resp.read.return_value = json.dumps([{"id": "abc-123"}]).encode("utf-8")
        mock_resp.__enter__ = MagicMock(return_value=mock_resp)
        mock_resp.__exit__ = MagicMock(return_value=False)
        mock_urlopen.return_value = mock_resp

        assert check_source_file_exists("sub/article.md") is True

    @patch("ingest_markdown.get_supabase_secret_key", return_value="test-key")
    @patch("ingest_markdown.get_supabase_url", return_value="https://test.supabase.co")
    @patch("ingest_markdown.urllib.request.urlopen")
    def test_file_not_found_returns_false(self, mock_urlopen, mock_url, mock_key):
        """File not in DB returns False."""
        mock_resp = MagicMock()
        mock_resp.read.return_value = json.dumps([]).encode("utf-8")
        mock_resp.__enter__ = MagicMock(return_value=mock_resp)
        mock_resp.__exit__ = MagicMock(return_value=False)
        mock_urlopen.return_value = mock_resp

        assert check_source_file_exists("sub/missing.md") is False

    @patch("ingest_markdown.get_supabase_secret_key", return_value="test-key")
    @patch("ingest_markdown.get_supabase_url", return_value="https://test.supabase.co")
    @patch("ingest_markdown.urllib.request.urlopen", side_effect=Exception("Network error"))
    def test_network_error_returns_false(self, mock_urlopen, mock_url, mock_key):
        """Network error returns False (graceful degradation)."""
        assert check_source_file_exists("sub/article.md") is False


# ── get_folder_tag ──────────────────────────────────────────────────────────


class TestGetFolderTag:
    """Derive keyword tag from folder name."""

    def test_known_folder_returns_mapped_tag(self):
        """Known folder name returns mapped tag value."""
        result = get_folder_tag(os.path.join("practical-ai-implementation-articles", "article.md"))
        assert result == "ai-implementation"

    def test_root_file_returns_none(self):
        """Single-level path (root file) returns None."""
        assert get_folder_tag("article.md") is None


# ── process_markdown_file ────────────────────────────────────────────────────


class TestProcessMarkdownFile:
    """Process a single markdown file through the pipeline."""

    @patch("ingest_markdown.log_quality_issue")
    @patch("ingest_markdown.insert_content_item", return_value=(True, "new-item-id"))
    @patch("ingest_markdown.is_duplicate", return_value=(False, None, ""))
    @patch("ingest_markdown.generate_embedding", return_value=([0.1] * 1024, 500))
    @patch("ingest_markdown.build_embedding_text", return_value="embed text")
    @patch("ingest_markdown.classify")
    @patch("ingest_markdown.generate_summary", return_value=None)
    def test_successful_processing(self, mock_summary, mock_classify,
                                     mock_build_embed, mock_gen_embed,
                                     mock_dedup, mock_insert, mock_quality):
        """Successful processing returns result dict with status 'ok'."""
        mock_classify.return_value = MagicMock(
            primary_domain="Technology & Digital",
            primary_subtopic="Cybersecurity & InfoSec",
            confidence=0.9,
            secondary_domain=None,
            secondary_subtopic=None,
            suggested_title="Suggested",
            summary="A summary text",
            ai_keywords=["testing"],
            reasoning="Some reasoning",
            requires_review=False,
            reason_if_flagged="",
            input_tokens=100,
            output_tokens=50,
            cache_creation_tokens=0,
            cache_read_tokens=0,
        )
        mock_classify_cost = MagicMock(return_value=0.01)

        with tempfile.NamedTemporaryFile(mode="w", suffix=".md", delete=False) as f:
            f.write("# Test Article\n\nSome content that is long enough to not be empty.")
            f.flush()
            tmp_path = f.name

        try:
            with patch("ingest_markdown.classify_cost", return_value=0.01):
                result = process_markdown_file(
                    file_path=tmp_path,
                    base_dir=os.path.dirname(tmp_path),
                    generate_summary_flag=False,
                )

            assert result["status"] == "ok"
            assert result["item_id"] == "new-item-id"
            assert result["title"] == "Test Article"
        finally:
            os.unlink(tmp_path)

    @patch("ingest_markdown.classify")
    @patch("ingest_markdown.generate_summary", return_value=None)
    def test_classification_and_embedding_called(self, mock_summary, mock_classify):
        """Classification and embedding are called during processing."""
        mock_classify.return_value = MagicMock(
            primary_domain="Tech",
            primary_subtopic="Cyber",
            confidence=0.9,
            secondary_domain=None,
            secondary_subtopic=None,
            suggested_title="Suggested",
            summary="Summary",
            ai_keywords=["test"],
            reasoning="reason",
            requires_review=False,
            reason_if_flagged="",
            input_tokens=100,
            output_tokens=50,
            cache_creation_tokens=0,
            cache_read_tokens=0,
        )

        with tempfile.NamedTemporaryFile(mode="w", suffix=".md", delete=False) as f:
            f.write("# Test\n\nContent for classification and embedding.")
            f.flush()
            tmp_path = f.name

        try:
            with patch("ingest_markdown.classify_cost", return_value=0.01), \
                 patch("ingest_markdown.build_embedding_text", return_value="text") as mock_build, \
                 patch("ingest_markdown.generate_embedding", return_value=([0.1] * 1024, 500)) as mock_embed, \
                 patch("ingest_markdown.is_duplicate", return_value=(False, None, "")) as mock_dedup, \
                 patch("ingest_markdown.insert_content_item", return_value=(True, "id-1")), \
                 patch("ingest_markdown.log_quality_issue"):

                process_markdown_file(
                    file_path=tmp_path,
                    base_dir=os.path.dirname(tmp_path),
                    generate_summary_flag=False,
                )

                mock_classify.assert_called_once()
                mock_embed.assert_called_once()
        finally:
            os.unlink(tmp_path)

    @patch("kb_pipeline.chunk.store_chunks", return_value=(3, []))
    @patch("ingest_markdown.log_quality_issue")
    @patch("ingest_markdown.insert_content_item", return_value=(True, "new-item-id"))
    @patch("ingest_markdown.is_duplicate", return_value=(False, None, ""))
    @patch("ingest_markdown.generate_embedding", return_value=([0.1] * 1024, 500))
    @patch("ingest_markdown.build_embedding_text", return_value="embed text")
    @patch("ingest_markdown.classify")
    @patch("ingest_markdown.generate_summary", return_value=None)
    def test_chunks_stored_on_insert_success(
        self, mock_summary, mock_classify, mock_build_embed, mock_gen_embed,
        mock_dedup, mock_insert, mock_quality, mock_store_chunks,
    ):
        """After successful insert, store_chunks is called with (item_id, cleaned_content)."""
        mock_classify.return_value = MagicMock(
            primary_domain="Tech", primary_subtopic="Cyber", confidence=0.9,
            secondary_domain=None, secondary_subtopic=None,
            suggested_title="Suggested", summary="Summary", ai_keywords=["test"],
            reasoning="reason", requires_review=False, reason_if_flagged="",
            input_tokens=100, output_tokens=50,
            cache_creation_tokens=0, cache_read_tokens=0,
        )
        body = "# Test Article\n\nSome content that is long enough to not be empty."
        with tempfile.NamedTemporaryFile(mode="w", suffix=".md", delete=False) as f:
            f.write(body)
            f.flush()
            tmp_path = f.name

        try:
            with patch("ingest_markdown.classify_cost", return_value=0.01):
                result = process_markdown_file(
                    file_path=tmp_path,
                    base_dir=os.path.dirname(tmp_path),
                    generate_summary_flag=False,
                )
            assert result["status"] == "ok"
            mock_store_chunks.assert_called_once()
            call_args = mock_store_chunks.call_args
            assert call_args[0][0] == "new-item-id"
            assert "Test Article" in call_args[0][1]
        finally:
            os.unlink(tmp_path)

    @patch("kb_pipeline.chunk.store_chunks", side_effect=RuntimeError("embed offline"))
    @patch("ingest_markdown.log_quality_issue")
    @patch("ingest_markdown.insert_content_item", return_value=(True, "new-item-id"))
    @patch("ingest_markdown.is_duplicate", return_value=(False, None, ""))
    @patch("ingest_markdown.generate_embedding", return_value=([0.1] * 1024, 500))
    @patch("ingest_markdown.build_embedding_text", return_value="embed text")
    @patch("ingest_markdown.classify")
    @patch("ingest_markdown.generate_summary", return_value=None)
    def test_chunk_error_is_non_blocking(
        self, mock_summary, mock_classify, mock_build_embed, mock_gen_embed,
        mock_dedup, mock_insert, mock_quality, mock_store_chunks,
    ):
        """store_chunks raising does not fail the ingest — result stays 'ok'."""
        mock_classify.return_value = MagicMock(
            primary_domain="Tech", primary_subtopic="Cyber", confidence=0.9,
            secondary_domain=None, secondary_subtopic=None,
            suggested_title="Suggested", summary="Summary", ai_keywords=["test"],
            reasoning="reason", requires_review=False, reason_if_flagged="",
            input_tokens=100, output_tokens=50,
            cache_creation_tokens=0, cache_read_tokens=0,
        )
        with tempfile.NamedTemporaryFile(mode="w", suffix=".md", delete=False) as f:
            f.write("# T\n\nContent long enough for ingest.")
            f.flush()
            tmp_path = f.name
        try:
            with patch("ingest_markdown.classify_cost", return_value=0.01):
                result = process_markdown_file(
                    file_path=tmp_path,
                    base_dir=os.path.dirname(tmp_path),
                    generate_summary_flag=False,
                )
            assert result["status"] == "ok"
            mock_store_chunks.assert_called_once()
        finally:
            os.unlink(tmp_path)

    @patch("kb_pipeline.chunk.store_chunks")
    @patch("ingest_markdown.classify")
    def test_dry_run_skips_chunking(self, mock_classify, mock_store_chunks):
        """--dry-run path returns before insert, so store_chunks is never called."""
        mock_classify.return_value = MagicMock(
            primary_domain="Tech", primary_subtopic="Cyber", confidence=0.9,
            secondary_domain=None, secondary_subtopic=None,
            suggested_title="Suggested", summary="Summary", ai_keywords=["test"],
            reasoning="reason", requires_review=False, reason_if_flagged="",
            input_tokens=100, output_tokens=50,
            cache_creation_tokens=0, cache_read_tokens=0,
        )
        with tempfile.NamedTemporaryFile(mode="w", suffix=".md", delete=False) as f:
            f.write("# T\n\nDry run body.")
            f.flush()
            tmp_path = f.name
        try:
            with patch("ingest_markdown.classify_cost", return_value=0.01), \
                 patch("ingest_markdown.build_embedding_text", return_value="text"), \
                 patch("ingest_markdown.generate_embedding", return_value=([0.1] * 1024, 500)), \
                 patch("ingest_markdown.is_duplicate", return_value=(False, None, "")):
                result = process_markdown_file(
                    file_path=tmp_path,
                    base_dir=os.path.dirname(tmp_path),
                    dry_run=True,
                )
            assert result["status"] == "dry_run"
            mock_store_chunks.assert_not_called()
        finally:
            os.unlink(tmp_path)

    @patch("ingest_markdown.get_supabase_secret_key", return_value="test-key")
    @patch("ingest_markdown.get_supabase_url", return_value="https://test.supabase.co")
    @patch("ingest_markdown.urllib.request.urlopen")
    def test_skip_existing_when_found(self, mock_urlopen, mock_url, mock_key):
        """skip_existing=True and file already in DB returns skipped status."""
        mock_resp = MagicMock()
        mock_resp.read.return_value = json.dumps([{"id": "existing"}]).encode("utf-8")
        mock_resp.__enter__ = MagicMock(return_value=mock_resp)
        mock_resp.__exit__ = MagicMock(return_value=False)
        mock_urlopen.return_value = mock_resp

        with tempfile.NamedTemporaryFile(mode="w", suffix=".md", delete=False) as f:
            f.write("# Existing Article\n\nAlready in DB.")
            f.flush()
            tmp_path = f.name

        try:
            result = process_markdown_file(
                file_path=tmp_path,
                base_dir=os.path.dirname(tmp_path),
                skip_existing=True,
            )

            assert result["status"] == "skipped"
            assert "Already exists" in result["error"]
        finally:
            os.unlink(tmp_path)
