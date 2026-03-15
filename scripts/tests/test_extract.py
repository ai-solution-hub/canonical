"""Tests for extract.py — content extraction pipeline.

Tests cover all 9 public functions plus the ExtractedContent dataclass.
All external dependencies (trafilatura, extruct, requests, pdfplumber,
subprocess) are mocked to keep tests fast and deterministic.

No production code issues discovered during test writing.
"""

import sys
import os

# Add scripts dir to path so we can import kb_pipeline
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from unittest.mock import patch, MagicMock, Mock
import pytest

from kb_pipeline.extract import (
    ExtractedContent,
    detect_content_type,
    detect_platform,
    extract_fallback_thumbnail,
    extract_og_metadata,
    extract_pdf,
    extract_url,
    extract_with_jina,
    extract_with_trafilatura,
    is_pdf_url,
)


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# detect_content_type — pure function, ~9 tests
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


class TestDetectContentType:
    """Tests for auto-detecting content type from URL and metadata signals."""

    def test_pdf_url(self):
        """URL ending in .pdf returns 'pdf'."""
        assert detect_content_type("https://example.com/report.pdf", "", {}) == "pdf"

    def test_pdf_url_case_insensitive(self):
        """PDF extension detection is case-insensitive."""
        assert detect_content_type("https://example.com/REPORT.PDF", "", {}) == "pdf"

    def test_youtube_url(self):
        """YouTube URLs return 'other'."""
        assert detect_content_type("https://www.youtube.com/watch?v=abc123", "", {}) == "other"

    def test_youtu_be_short_url(self):
        """Short youtu.be URLs also return 'other'."""
        assert detect_content_type("https://youtu.be/abc123", "", {}) == "other"

    def test_substack_url(self):
        """Substack URLs return 'article'."""
        assert detect_content_type("https://example.substack.com/p/my-post", "content", {}) == "article"

    def test_blog_path(self):
        """URLs with /blog/ path return 'blog'."""
        assert detect_content_type("https://example.com/blog/my-post", "content", {}) == "blog"

    def test_root_domain_url(self):
        """Root domain URL (no path) returns 'product_description'."""
        assert detect_content_type("https://example.com/", "", {}) == "product_description"

    def test_pricing_path(self):
        """/pricing path returns 'product_description'."""
        assert detect_content_type("https://example.com/pricing", "content", {}) == "product_description"

    def test_og_type_product(self):
        """og_type 'product' in metadata returns 'product_description'."""
        assert detect_content_type(
            "https://example.com/item/123",
            "Short content",
            {"og_type": "product"},
        ) == "product_description"

    def test_long_content_defaults_to_article(self):
        """Content longer than 2000 chars defaults to 'article'."""
        long_content = "x" * 2001
        assert detect_content_type(
            "https://example.com/some-page",
            long_content,
            {},
        ) == "article"

    def test_short_content_defaults_to_article(self):
        """Short content also defaults to 'article'."""
        assert detect_content_type(
            "https://example.com/some-page",
            "Short text",
            {},
        ) == "article"

    def test_features_path(self):
        """/features path returns 'product_description'."""
        assert detect_content_type("https://example.com/features", "content", {}) == "product_description"

    def test_podcast_path(self):
        """/podcast path returns 'other'."""
        assert detect_content_type("https://example.com/podcast/ep1", "content", {}) == "other"

    def test_none_metadata_handled(self):
        """None metadata does not raise."""
        assert detect_content_type("https://example.com/page", "content", None) == "article"


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# is_pdf_url — network call mocked, ~4 tests
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


class TestIsPdfUrl:
    """Tests for PDF URL detection via extension and HEAD request."""

    def test_pdf_extension_no_network_call(self):
        """URL ending in .pdf returns True without a HEAD request."""
        with patch("kb_pipeline.extract.requests.head") as mock_head:
            assert is_pdf_url("https://example.com/file.pdf") is True
            mock_head.assert_not_called()

    @patch("kb_pipeline.extract.requests.head")
    def test_non_pdf_url_with_pdf_content_type(self, mock_head):
        """Non-.pdf URL with application/pdf Content-Type returns True."""
        mock_resp = MagicMock()
        mock_resp.headers = {"Content-Type": "application/pdf"}
        mock_head.return_value = mock_resp
        assert is_pdf_url("https://example.com/document/12345") is True

    @patch("kb_pipeline.extract.requests.head")
    def test_non_pdf_url_with_html_content_type(self, mock_head):
        """Non-.pdf URL with text/html Content-Type returns False."""
        mock_resp = MagicMock()
        mock_resp.headers = {"Content-Type": "text/html; charset=utf-8"}
        mock_head.return_value = mock_resp
        assert is_pdf_url("https://example.com/page") is False

    @patch("kb_pipeline.extract.requests.head")
    def test_network_error_returns_false(self, mock_head):
        """Network error during HEAD request returns False gracefully."""
        import requests as req_lib
        mock_head.side_effect = req_lib.ConnectionError("timeout")
        assert is_pdf_url("https://example.com/maybe-pdf") is False


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# extract_og_metadata — extruct mocked, ~6 tests
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


class TestExtractOgMetadata:
    """Tests for Open Graph and structured data extraction."""

    @patch("kb_pipeline.extract.extruct.extract")
    def test_og_tags_extracted(self, mock_extruct):
        """HTML with OG tags extracts title, description, image, type."""
        mock_extruct.return_value = {
            "opengraph": [{
                "properties": [
                    ("og:title", "My Article"),
                    ("og:description", "An interesting article"),
                    ("og:image", "https://example.com/img.jpg"),
                    ("og:type", "article"),
                ],
            }],
            "json-ld": [],
            "microdata": [],
        }
        result = extract_og_metadata("<html>test</html>")
        assert result["og_title"] == "My Article"
        assert result["og_description"] == "An interesting article"
        assert result["og_image"] == "https://example.com/img.jpg"
        assert result["og_type"] == "article"

    @patch("kb_pipeline.extract.extruct.extract")
    def test_json_ld_author_extracted(self, mock_extruct):
        """HTML with JSON-LD extracts author name."""
        mock_extruct.return_value = {
            "opengraph": [],
            "json-ld": [{"author": {"name": "Jane Smith"}}],
            "microdata": [],
        }
        result = extract_og_metadata("<html>test</html>")
        assert result["og_author"] == "Jane Smith"

    @patch("kb_pipeline.extract.extruct.extract")
    def test_json_ld_date_published(self, mock_extruct):
        """HTML with datePublished in JSON-LD extracts date."""
        mock_extruct.return_value = {
            "opengraph": [],
            "json-ld": [{"datePublished": "2025-01-15"}],
            "microdata": [],
        }
        result = extract_og_metadata("<html>test</html>")
        assert result["og_date"] == "2025-01-15"

    def test_empty_html_returns_empty_dict(self):
        """Empty HTML returns dict with empty string values."""
        result = extract_og_metadata("")
        assert result["og_title"] == ""
        assert result["og_description"] == ""

    def test_none_html_returns_empty_dict(self):
        """None HTML returns dict with empty string values."""
        result = extract_og_metadata(None)
        assert result["og_title"] == ""

    @patch("kb_pipeline.extract.extruct.extract")
    def test_malformed_html_no_exception(self, mock_extruct):
        """Malformed HTML that causes extruct to raise returns empty dict."""
        mock_extruct.side_effect = ValueError("parse error")
        result = extract_og_metadata("<html><broken")
        assert result["og_title"] == ""
        assert result["og_author"] == ""

    @patch("kb_pipeline.extract.extruct.extract")
    def test_json_ld_author_as_string(self, mock_extruct):
        """JSON-LD author as plain string is extracted."""
        mock_extruct.return_value = {
            "opengraph": [],
            "json-ld": [{"author": "John Doe"}],
            "microdata": [],
        }
        result = extract_og_metadata("<html>test</html>")
        assert result["og_author"] == "John Doe"

    @patch("kb_pipeline.extract.extruct.extract")
    def test_json_ld_author_as_list(self, mock_extruct):
        """JSON-LD author as list extracts first author's name."""
        mock_extruct.return_value = {
            "opengraph": [],
            "json-ld": [{"author": [{"name": "First Author"}, {"name": "Second"}]}],
            "microdata": [],
        }
        result = extract_og_metadata("<html>test</html>")
        assert result["og_author"] == "First Author"


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# extract_fallback_thumbnail — pure function, ~6 tests
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


class TestExtractFallbackThumbnail:
    """Tests for fallback thumbnail extraction from HTML."""

    def test_apple_touch_icon(self):
        """HTML with apple-touch-icon extracts absolute URL."""
        html = '<link rel="apple-touch-icon" href="/icons/icon-180.png">'
        result = extract_fallback_thumbnail(html, "https://example.com/page")
        assert result == "https://example.com/icons/icon-180.png"

    def test_favicon_icon(self):
        """HTML with rel='icon' extracts favicon URL."""
        html = '<link rel="icon" href="/favicon.ico">'
        result = extract_fallback_thumbnail(html, "https://example.com/")
        assert result == "https://example.com/favicon.ico"

    def test_relative_url_resolved(self):
        """Relative icon URLs are resolved against base_url."""
        html = '<link rel="apple-touch-icon" href="icons/touch.png">'
        result = extract_fallback_thumbnail(html, "https://example.com/blog/")
        assert result == "https://example.com/blog/icons/touch.png"

    def test_absolute_url_preserved(self):
        """Absolute icon URLs are preserved as-is."""
        html = '<link rel="apple-touch-icon" href="https://cdn.example.com/icon.png">'
        result = extract_fallback_thumbnail(html, "https://example.com/")
        assert result == "https://cdn.example.com/icon.png"

    def test_no_icon_links_returns_empty(self):
        """HTML with no icon links returns empty string."""
        html = '<html><head><title>Test</title></head></html>'
        assert extract_fallback_thumbnail(html, "https://example.com") == ""

    def test_empty_html_returns_empty(self):
        """Empty HTML returns empty string."""
        assert extract_fallback_thumbnail("", "https://example.com") == ""

    def test_apple_touch_icon_preferred_over_favicon(self):
        """apple-touch-icon is returned even when favicon also present."""
        html = (
            '<link rel="apple-touch-icon" href="/apple.png">'
            '<link rel="icon" href="/favicon.ico">'
        )
        result = extract_fallback_thumbnail(html, "https://example.com")
        assert result == "https://example.com/apple.png"

    def test_shortcut_icon(self):
        """rel='shortcut icon' is also matched."""
        html = '<link rel="shortcut icon" href="/favicon.ico">'
        result = extract_fallback_thumbnail(html, "https://example.com/")
        assert result == "https://example.com/favicon.ico"


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# extract_with_trafilatura — trafilatura + subprocess mocked, ~6 tests
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


class TestExtractWithTrafilatura:
    """Tests for primary extraction via trafilatura."""

    @patch("kb_pipeline.extract.subprocess.run")
    @patch("kb_pipeline.extract.extract_og_metadata")
    @patch("kb_pipeline.extract.trafilatura")
    def test_successful_extraction(self, mock_traf, mock_og, mock_subproc):
        """Successful extraction returns populated ExtractedContent."""
        mock_traf.fetch_url.return_value = "<html><body>Full article text</body></html>"
        mock_traf.extract.return_value = "Extracted article content that is long enough"

        # Mock trafilatura.metadata.extract_metadata via import inside function
        mock_meta = MagicMock()
        mock_meta.title = "Test Title"
        mock_meta.author = "Test Author"
        mock_meta.date = "2025-06-01"
        with patch("kb_pipeline.extract.extract_metadata", mock_meta, create=True):
            # The function imports extract_metadata inside itself
            with patch("trafilatura.metadata.extract_metadata", return_value=mock_meta):
                mock_og.return_value = {
                    "og_title": "", "og_description": "", "og_image": "https://img.com/thumb.jpg",
                    "og_author": "", "og_date": "", "og_type": "",
                }
                mock_subproc.return_value = MagicMock(returncode=1, stdout=b"")

                result = extract_with_trafilatura("https://example.com/article")

        assert result is not None
        assert result.extraction_method == "trafilatura"
        assert result.source_url == "https://example.com/article"
        assert result.source_domain == "example.com"

    @patch("kb_pipeline.extract.trafilatura")
    def test_fetch_url_returns_none(self, mock_traf):
        """fetch_url returning None results in None."""
        mock_traf.fetch_url.return_value = None
        assert extract_with_trafilatura("https://example.com/broken") is None

    @patch("kb_pipeline.extract.trafilatura")
    def test_extract_returns_none(self, mock_traf):
        """trafilatura.extract returning None results in None."""
        mock_traf.fetch_url.return_value = "<html>content</html>"
        mock_traf.extract.return_value = None
        assert extract_with_trafilatura("https://example.com/empty") is None

    @patch("kb_pipeline.extract.subprocess.run")
    @patch("kb_pipeline.extract.extract_og_metadata")
    @patch("kb_pipeline.extract.trafilatura")
    def test_og_metadata_merged(self, mock_traf, mock_og, mock_subproc):
        """OG metadata is merged into the result."""
        mock_traf.fetch_url.return_value = "<html>body</html>"
        mock_traf.extract.return_value = "Sufficient content here"
        with patch("trafilatura.metadata.extract_metadata", return_value=None):
            mock_og.return_value = {
                "og_title": "OG Title", "og_description": "OG Desc",
                "og_image": "https://img.com/og.jpg", "og_author": "OG Author",
                "og_date": "2025-03-01", "og_type": "article",
            }
            mock_subproc.return_value = MagicMock(returncode=1, stdout=b"")

            result = extract_with_trafilatura("https://example.com/og-test")

        assert result is not None
        assert result.title == "OG Title"
        assert result.author_name == "OG Author"
        assert result.thumbnail_url == "https://img.com/og.jpg"

    @patch("kb_pipeline.extract.subprocess.run")
    @patch("kb_pipeline.extract.extract_og_metadata")
    @patch("kb_pipeline.extract.trafilatura")
    def test_reader_html_failure_non_fatal(self, mock_traf, mock_og, mock_subproc):
        """Reader HTML subprocess failure does not prevent extraction."""
        mock_traf.fetch_url.return_value = "<html>body</html>"
        mock_traf.extract.return_value = "Sufficient content for extraction"
        with patch("trafilatura.metadata.extract_metadata", return_value=None):
            mock_og.return_value = {
                "og_title": "", "og_description": "", "og_image": "",
                "og_author": "", "og_date": "", "og_type": "",
            }
            mock_subproc.side_effect = OSError("bun not found")

            result = extract_with_trafilatura("https://example.com/no-reader")

        assert result is not None
        assert "reader_html" not in result.metadata

    @patch("kb_pipeline.extract.trafilatura")
    def test_exception_returns_none(self, mock_traf):
        """Unexpected exception returns None gracefully."""
        mock_traf.fetch_url.side_effect = OSError("network down")
        assert extract_with_trafilatura("https://example.com/error") is None


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# extract_with_jina — requests.get mocked, ~5 tests
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


class TestExtractWithJina:
    """Tests for Jina Reader fallback extraction."""

    @patch("kb_pipeline.extract.requests.get")
    def test_successful_extraction(self, mock_get):
        """Successful Jina response returns ExtractedContent with 'jina_reader' method."""
        mock_resp = MagicMock()
        mock_resp.text = "# Great Article\n\nThis is the article content that is long enough to pass the minimum threshold check."
        mock_resp.raise_for_status = MagicMock()
        mock_get.return_value = mock_resp

        result = extract_with_jina("https://example.com/js-heavy-page")

        assert result is not None
        assert result.extraction_method == "jina_reader"
        assert result.source_domain == "example.com"

    @patch("kb_pipeline.extract.requests.get")
    def test_title_from_heading(self, mock_get):
        """Title is extracted from first # heading line."""
        mock_resp = MagicMock()
        mock_resp.text = "# My Page Title\n\nBody content here that is definitely long enough to pass."
        mock_resp.raise_for_status = MagicMock()
        mock_get.return_value = mock_resp

        result = extract_with_jina("https://example.com/page")
        assert result.title == "My Page Title"

    @patch("kb_pipeline.extract.requests.get")
    def test_short_response_returns_none(self, mock_get):
        """Response shorter than 50 chars returns None."""
        mock_resp = MagicMock()
        mock_resp.text = "Too short"
        mock_resp.raise_for_status = MagicMock()
        mock_get.return_value = mock_resp

        assert extract_with_jina("https://example.com/empty") is None

    @patch("kb_pipeline.extract.requests.get")
    def test_network_error_returns_none(self, mock_get):
        """Network error returns None gracefully."""
        import requests as req_lib
        mock_get.side_effect = req_lib.ConnectionError("timeout")

        assert extract_with_jina("https://example.com/down") is None

    @patch("kb_pipeline.extract.requests.get")
    def test_title_from_title_header(self, mock_get):
        """Title extracted from 'Title:' line when no # heading present."""
        mock_resp = MagicMock()
        mock_resp.text = "Title: Fallback Title\n\nBody content here that is definitely long enough."
        mock_resp.raise_for_status = MagicMock()
        mock_get.return_value = mock_resp

        result = extract_with_jina("https://example.com/page")
        assert result.title == "Fallback Title"


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# extract_pdf — pdfplumber mocked, ~4 tests
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


class TestExtractPdf:
    """Tests for PDF content extraction via pdfplumber."""

    @patch("pdfplumber.open")
    def test_multi_page_concatenation(self, mock_open):
        """Multi-page PDF concatenates text from all pages."""
        page1 = MagicMock()
        page1.extract_text.return_value = "Page one content"
        page1.extract_tables.return_value = []

        page2 = MagicMock()
        page2.extract_text.return_value = "Page two content"
        page2.extract_tables.return_value = []

        mock_pdf = MagicMock()
        mock_pdf.pages = [page1, page2]
        mock_open.return_value.__enter__ = MagicMock(return_value=mock_pdf)
        mock_open.return_value.__exit__ = MagicMock(return_value=False)

        result = extract_pdf("/tmp/test.pdf")

        assert result is not None
        assert "Page one content" in result.content
        assert "Page two content" in result.content
        assert result.metadata["page_count"] == 2

    @patch("pdfplumber.open")
    def test_tables_extracted(self, mock_open):
        """Tables are extracted with headers and rows."""
        page = MagicMock()
        page.extract_text.return_value = "Page with table"
        page.extract_tables.return_value = [
            [["Header A", "Header B"], ["val1", "val2"], ["val3", "val4"]],
        ]

        mock_pdf = MagicMock()
        mock_pdf.pages = [page]
        mock_open.return_value.__enter__ = MagicMock(return_value=mock_pdf)
        mock_open.return_value.__exit__ = MagicMock(return_value=False)

        result = extract_pdf("/tmp/table.pdf")

        assert result is not None
        assert result.metadata["table_count"] == 1
        table = result.metadata["tables"][0]
        assert table["headers"] == ["Header A", "Header B"]
        assert table["rows"] == [["val1", "val2"], ["val3", "val4"]]
        assert table["row_count"] == 2

    @patch("pdfplumber.open")
    def test_empty_pdf_returns_none(self, mock_open):
        """PDF with no extractable text returns None."""
        page = MagicMock()
        page.extract_text.return_value = None
        page.extract_tables.return_value = []

        mock_pdf = MagicMock()
        mock_pdf.pages = [page]
        mock_open.return_value.__enter__ = MagicMock(return_value=mock_pdf)
        mock_open.return_value.__exit__ = MagicMock(return_value=False)

        assert extract_pdf("/tmp/empty.pdf") is None

    @patch("pdfplumber.open")
    def test_error_returns_none(self, mock_open):
        """pdfplumber error returns None gracefully."""
        mock_open.side_effect = OSError("corrupt file")
        assert extract_pdf("/tmp/corrupt.pdf") is None


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# extract_url — integration-style, ~4 tests
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


class TestExtractUrl:
    """Tests for the main extraction entry point."""

    @patch("kb_pipeline.extract.extract_pdf")
    @patch("kb_pipeline.extract.requests.get")
    @patch("kb_pipeline.extract.is_pdf_url")
    def test_pdf_url_routes_to_pdf_extraction(self, mock_is_pdf, mock_get, mock_extract_pdf):
        """PDF URL routes to the PDF extraction path."""
        mock_is_pdf.return_value = True
        mock_resp = MagicMock()
        mock_resp.content = b"PDF bytes"
        mock_resp.raise_for_status = MagicMock()
        mock_get.return_value = mock_resp

        mock_extract_pdf.return_value = ExtractedContent(
            title="PDF Title",
            content="PDF content",
            content_type="pdf",
            extraction_method="pdfplumber",
        )

        with patch("os.unlink"):
            result = extract_url("https://example.com/doc.pdf")

        assert result is not None
        assert result.source_url == "https://example.com/doc.pdf"
        mock_extract_pdf.assert_called_once()

    @patch("kb_pipeline.extract.extract_with_jina")
    @patch("kb_pipeline.extract.extract_with_trafilatura")
    @patch("kb_pipeline.extract.is_pdf_url")
    def test_non_pdf_tries_trafilatura_first(self, mock_is_pdf, mock_traf, mock_jina):
        """Non-PDF URL tries trafilatura first."""
        mock_is_pdf.return_value = False
        mock_traf.return_value = ExtractedContent(
            content="A" * 100,
            extraction_method="trafilatura",
        )

        result = extract_url("https://example.com/article")

        mock_traf.assert_called_once_with("https://example.com/article")
        mock_jina.assert_not_called()

    @patch("kb_pipeline.extract.extract_with_jina")
    @patch("kb_pipeline.extract.extract_with_trafilatura")
    @patch("kb_pipeline.extract.is_pdf_url")
    def test_trafilatura_short_content_falls_back_to_jina(self, mock_is_pdf, mock_traf, mock_jina):
        """When trafilatura returns short content, falls back to Jina."""
        mock_is_pdf.return_value = False
        mock_traf.return_value = ExtractedContent(
            content="Short",
            extraction_method="trafilatura",
        )
        mock_jina.return_value = ExtractedContent(
            content="Jina extracted much longer content from the page",
            extraction_method="jina_reader",
        )

        result = extract_url("https://example.com/js-page")

        mock_jina.assert_called_once_with("https://example.com/js-page")

    @patch("kb_pipeline.extract.extract_with_jina")
    @patch("kb_pipeline.extract.extract_with_trafilatura")
    @patch("kb_pipeline.extract.is_pdf_url")
    def test_trafilatura_sufficient_no_jina_call(self, mock_is_pdf, mock_traf, mock_jina):
        """When trafilatura returns sufficient content, Jina is not called."""
        mock_is_pdf.return_value = False
        mock_traf.return_value = ExtractedContent(
            content="A" * 200,
            extraction_method="trafilatura",
        )

        extract_url("https://example.com/good-page")
        mock_jina.assert_not_called()


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# detect_platform — stub function, 1 test
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


class TestDetectPlatform:
    """Tests for platform detection (currently a stub)."""

    def test_always_returns_web(self):
        """detect_platform always returns 'web' (stub implementation)."""
        assert detect_platform("https://example.com") == "web"
        assert detect_platform("https://youtube.com/video") == "web"


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# ExtractedContent dataclass — 1 test
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


class TestExtractedContent:
    """Tests for the ExtractedContent dataclass."""

    def test_default_values(self):
        """Dataclass has sensible defaults."""
        ec = ExtractedContent()
        assert ec.title == ""
        assert ec.content == ""
        assert ec.content_type == "article"
        assert ec.platform == "web"
        assert ec.metadata == {}
        assert ec.captured_date is None
