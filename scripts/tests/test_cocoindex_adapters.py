"""Tests for cocoindex_pipeline/adapters.py — layered fn-shape per-MIME adapters.

Tests the signature locks and per-MIME behaviour without importing cocoindex at
module level (which requires dangerouslyDisableSandbox: true and LMDB startup).
Each test mocks cocoindex at the import boundary so the test suite can run in a
standard Python environment.

Async adapter functions are exercised via asyncio.run() within synchronous test
functions — no pytest-asyncio plugin required.

Reference: docs/specs/cocoindex-flow-scaffolding/TECH.md §P-3
Test strategy: ID-28.7 — convert_binary_to_markdown signature matches FileLike->str;
inner-tier functions take bytes/str (verified via inspect.signature — never FileLike);
per-MIME dispatch smoke tests; PULLMD_SERVICE_URL env var required for HTML path.
"""

from __future__ import annotations

import asyncio
import inspect
import os
import sys
from pathlib import Path, PurePath
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# ── Path setup ──────────────────────────────────────────────────────────────

# Add the scripts directory to sys.path so we can import cocoindex_pipeline.
_SCRIPTS_DIR = Path(__file__).resolve().parents[1]
if str(_SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS_DIR))


# ── cocoindex stub ──────────────────────────────────────────────────────────
# Stub the cocoindex module so tests do not trigger the Rust LMDB engine.
# Injected into sys.modules BEFORE importing adapters.

def _make_coco_stub():
    """Return a minimal cocoindex module stub with a no-op @coco.fn decorator."""
    stub = MagicMock(name="cocoindex")

    # @coco.fn(memo=True) must be a callable that returns a decorator.
    # When used as @coco.fn(memo=True) def f(...): ... the call chain is:
    #   1. coco.fn(memo=True) -> decorator
    #   2. decorator(f) -> f  (pass-through so the function is testable)
    def _fn_decorator(**kwargs):
        def _wrap(func):
            return func
        return _wrap

    stub.fn = _fn_decorator
    return stub


def _make_filelike(suffix: str, content_bytes: bytes | None = None, content_text: str | None = None):
    """Create a minimal FileLike-compatible mock for testing.

    Mirrors the cocoindex.resources.file.FileLike async API:
      await file.read()        -> bytes
      await file.read_text()   -> str
      file.file_path.path      -> PurePath with .suffix
    """
    mock_file = MagicMock()
    mock_file.read = AsyncMock(return_value=content_bytes or b"")
    mock_file.read_text = AsyncMock(return_value=content_text or "")
    # file.file_path.path is a PurePath-like object with .suffix
    mock_file.file_path = SimpleNamespace(path=PurePath(f"test{suffix}"))
    return mock_file


# ── Module-level cocoindex injection ────────────────────────────────────────
# Inject stub before any import of adapters (module-level import is cached).
_coco_stub = _make_coco_stub()
sys.modules.setdefault("cocoindex", _coco_stub)

# Stub docling at module boundary so the import in adapters.py does not fail
# when docling is not installed (1.8 GB dep, Cloud Run only in dev).
_docling_stub = MagicMock(name="docling")
_docling_dc_stub = MagicMock(name="docling.document_converter")
sys.modules.setdefault("docling", _docling_stub)
sys.modules.setdefault("docling.document_converter", _docling_dc_stub)


# ── Import the module under test ─────────────────────────────────────────────
from cocoindex_pipeline import adapters  # noqa: E402  (must come after stub injection)


# ============================================================================
# SIGNATURE LOCK TESTS
# Verify the layered fn-shape (TECH.md §P-3) — inner tiers NEVER accept FileLike.
# These tests are the load-bearing 28.8 handoff constraint.
# ============================================================================


class TestSignatureLocks:
    """Signature lock assertions — prevent silent drift from the spec contract."""

    def test_outer_tier_first_param_is_named_file(self):
        """convert_binary_to_markdown first param must be named 'file' (FileLike)."""
        sig = inspect.signature(adapters.convert_binary_to_markdown)
        params = list(sig.parameters.values())
        assert len(params) >= 1, "convert_binary_to_markdown must accept at least one parameter"
        first_param = params[0]
        assert first_param.name == "file", (
            f"First param must be named 'file', got '{first_param.name}'"
        )

    def test_outer_tier_return_annotation_is_str(self):
        """convert_binary_to_markdown return annotation must be str."""
        sig = inspect.signature(adapters.convert_binary_to_markdown)
        ret = sig.return_annotation
        # Accept str or the string literal "str" (both are valid annotations)
        if ret is not inspect.Parameter.empty:
            assert ret is str or ret == "str", (
                f"Return annotation must be str, got {ret!r}"
            )

    def test_docling_inner_tier_first_param_is_content_bytes(self):
        """_docling_to_markdown first param must be named 'content_bytes'."""
        sig = inspect.signature(adapters._docling_to_markdown)
        params = list(sig.parameters.values())
        assert len(params) >= 1, "_docling_to_markdown must accept at least one parameter"
        first_param = params[0]
        assert first_param.name == "content_bytes", (
            f"First param must be 'content_bytes', got '{first_param.name}'"
        )

    def test_docling_inner_tier_annotation_is_bytes(self):
        """_docling_to_markdown first param annotation must be bytes."""
        sig = inspect.signature(adapters._docling_to_markdown)
        params = list(sig.parameters.values())
        ann = params[0].annotation
        if ann is not inspect.Parameter.empty:
            assert ann is bytes or ann == "bytes", (
                f"_docling_to_markdown first param must be bytes, got {ann!r}"
            )

    def test_pullmd_inner_tier_first_param_is_url(self):
        """_pullmd_to_markdown first param must be named 'url'."""
        sig = inspect.signature(adapters._pullmd_to_markdown)
        params = list(sig.parameters.values())
        assert len(params) >= 1, "_pullmd_to_markdown must accept at least one parameter"
        first_param = params[0]
        assert first_param.name == "url", (
            f"First param must be 'url', got '{first_param.name}'"
        )

    def test_pullmd_inner_tier_annotation_is_str(self):
        """_pullmd_to_markdown first param annotation must be str."""
        sig = inspect.signature(adapters._pullmd_to_markdown)
        params = list(sig.parameters.values())
        ann = params[0].annotation
        if ann is not inspect.Parameter.empty:
            assert ann is str or ann == "str", (
                f"_pullmd_to_markdown first param must be str, got {ann!r}"
            )

    def test_passthrough_inner_tier_first_param_is_content_text(self):
        """_passthrough_markdown first param must be named 'content_text'."""
        sig = inspect.signature(adapters._passthrough_markdown)
        params = list(sig.parameters.values())
        assert len(params) >= 1, "_passthrough_markdown must accept at least one parameter"
        first_param = params[0]
        assert first_param.name == "content_text", (
            f"First param must be 'content_text', got '{first_param.name}'"
        )

    def test_passthrough_inner_tier_annotation_is_str(self):
        """_passthrough_markdown first param annotation must be str."""
        sig = inspect.signature(adapters._passthrough_markdown)
        params = list(sig.parameters.values())
        ann = params[0].annotation
        if ann is not inspect.Parameter.empty:
            assert ann is str or ann == "str", (
                f"_passthrough_markdown first param must be str, got {ann!r}"
            )

    def test_no_inner_tier_first_param_named_like_file(self):
        """Inner-tier first params must not be named 'file' or 'filelike'.

        This is the load-bearing COCO.10 invariant: inner-tier memoisation key must
        be content-hash (bytes or str), not a file handle.
        """
        inner_fns = [
            adapters._docling_to_markdown,
            adapters._pullmd_to_markdown,
            adapters._passthrough_markdown,
        ]
        for fn in inner_fns:
            sig = inspect.signature(fn)
            params = list(sig.parameters.values())
            first_name = params[0].name if params else ""
            assert first_name.lower() not in {"file", "filelike", "file_like"}, (
                f"{fn.__name__}: first param '{first_name}' looks like a file handle — "
                "inner-tier extractors must take bytes or str, NEVER FileLike (COCO.10)"
            )

    def test_all_adapter_functions_are_async(self):
        """All @coco.fn adapter functions must be coroutine functions (async def)."""
        fns = [
            adapters.convert_binary_to_markdown,
            adapters._docling_to_markdown,
            adapters._pullmd_to_markdown,
            adapters._passthrough_markdown,
        ]
        for fn in fns:
            assert inspect.iscoroutinefunction(fn), (
                f"{fn.__name__} must be async def — cocoindex @coco.fn requires coroutines"
            )


# ============================================================================
# PER-MIME DISPATCH TESTS
# Smoke tests for the outer-tier MIME routing (mocked inner tiers).
# asyncio.run() drives the coroutines; no pytest-asyncio plugin required.
# ============================================================================


class TestOuterTierMimeDispatch:
    """Outer-tier convert_binary_to_markdown routes by file extension."""

    def test_pdf_routes_to_docling(self):
        """PDF extension triggers _docling_to_markdown with file bytes."""
        pdf_bytes = b"%PDF-1.4 fake pdf content"
        mock_file = _make_filelike(".pdf", content_bytes=pdf_bytes)

        async def run():
            with patch.object(
                adapters, "_docling_to_markdown", new=AsyncMock(return_value="# Docling PDF")
            ) as mock_docling:
                result = await adapters.convert_binary_to_markdown(mock_file)
            mock_docling.assert_awaited_once_with(pdf_bytes)
            return result

        result = asyncio.run(run())
        assert result == "# Docling PDF"

    def test_docx_routes_to_docling(self):
        """DOCX extension triggers _docling_to_markdown with file bytes."""
        docx_bytes = b"PK\x03\x04 fake docx content"
        mock_file = _make_filelike(".docx", content_bytes=docx_bytes)

        async def run():
            with patch.object(
                adapters, "_docling_to_markdown", new=AsyncMock(return_value="# Docling DOCX")
            ) as mock_docling:
                result = await adapters.convert_binary_to_markdown(mock_file)
            mock_docling.assert_awaited_once_with(docx_bytes)
            return result

        result = asyncio.run(run())
        assert result == "# Docling DOCX"

    def test_xlsx_routes_to_docling(self):
        """XLSX extension triggers _docling_to_markdown with file bytes."""
        xlsx_bytes = b"PK\x03\x04 fake xlsx content"
        mock_file = _make_filelike(".xlsx", content_bytes=xlsx_bytes)

        async def run():
            with patch.object(
                adapters, "_docling_to_markdown", new=AsyncMock(return_value="# Docling XLSX")
            ) as mock_docling:
                result = await adapters.convert_binary_to_markdown(mock_file)
            mock_docling.assert_awaited_once_with(xlsx_bytes)
            return result

        result = asyncio.run(run())
        assert result == "# Docling XLSX"

    def test_html_routes_to_pullmd_with_str_arg(self):
        """HTML extension triggers _pullmd_to_markdown with a str argument (not FileLike)."""
        mock_file = _make_filelike(".html")

        async def run():
            with patch.object(
                adapters, "_pullmd_to_markdown", new=AsyncMock(return_value="# PullMD HTML")
            ) as mock_pullmd:
                result = await adapters.convert_binary_to_markdown(mock_file)
            # Inner tier must be called with a str (url or path string), not a FileLike
            call_args = mock_pullmd.call_args
            assert call_args is not None, "_pullmd_to_markdown was not called"
            url_arg = call_args.args[0] if call_args.args else None
            assert isinstance(url_arg, str), (
                f"_pullmd_to_markdown must receive a str, got {type(url_arg).__name__}"
            )
            return result

        result = asyncio.run(run())
        assert result == "# PullMD HTML"

    def test_markdown_routes_to_passthrough(self):
        """Markdown extension triggers _passthrough_markdown with file text content."""
        md_content = "# My Document\n\nSome content here."
        mock_file = _make_filelike(".md", content_text=md_content)

        async def run():
            with patch.object(
                adapters, "_passthrough_markdown", new=AsyncMock(return_value=md_content)
            ) as mock_passthrough:
                result = await adapters.convert_binary_to_markdown(mock_file)
            mock_passthrough.assert_awaited_once_with(md_content)
            return result

        result = asyncio.run(run())
        assert result == md_content

    def test_txt_routes_to_passthrough(self):
        """.txt extension routes to passthrough (plain text treated as markdown-compatible)."""
        txt_content = "Plain text content."
        mock_file = _make_filelike(".txt", content_text=txt_content)

        async def run():
            with patch.object(
                adapters, "_passthrough_markdown", new=AsyncMock(return_value=txt_content)
            ) as mock_passthrough:
                result = await adapters.convert_binary_to_markdown(mock_file)
            mock_passthrough.assert_awaited_once_with(txt_content)
            return result

        result = asyncio.run(run())
        assert result == txt_content

    def test_unsupported_extension_raises_value_error(self):
        """Unknown file extensions raise ValueError with a meaningful message."""
        mock_file = _make_filelike(".xyz")

        async def run():
            with pytest.raises(ValueError, match=r"\.xyz|Unsupported|unsupported"):
                await adapters.convert_binary_to_markdown(mock_file)

        asyncio.run(run())


# ============================================================================
# INNER TIER SMOKE TESTS
# ============================================================================


class TestDoclingInnerTier:
    """_docling_to_markdown smoke tests (mocked Docling converter)."""

    def test_returns_markdown_string_from_docling(self):
        """Mocked Docling converter: returns expected markdown string."""
        fake_bytes = b"%PDF-1.4 fake content"
        expected_markdown = "# Extracted heading\n\nExtracted paragraph."

        mock_doc = MagicMock()
        mock_doc.export_to_markdown.return_value = expected_markdown
        mock_result = MagicMock()
        mock_result.document = mock_doc

        mock_converter_cls = MagicMock(return_value=MagicMock())
        mock_converter_cls.return_value.convert.return_value = mock_result

        async def run():
            # DocumentConverter is lazily imported inside _docling_to_markdown;
            # patch the module it comes from (docling.document_converter).
            with patch("docling.document_converter.DocumentConverter", mock_converter_cls):
                return await adapters._docling_to_markdown(fake_bytes)

        result = asyncio.run(run())
        assert result == expected_markdown
        mock_converter_cls.return_value.convert.assert_called_once()

    def test_calls_export_to_markdown_on_result_document(self):
        """_docling_to_markdown calls result.document.export_to_markdown()."""
        mock_doc = MagicMock()
        mock_doc.export_to_markdown.return_value = "# Markdown"
        mock_result = MagicMock()
        mock_result.document = mock_doc

        mock_converter_cls = MagicMock(return_value=MagicMock())
        mock_converter_cls.return_value.convert.return_value = mock_result

        async def run():
            with patch("docling.document_converter.DocumentConverter", mock_converter_cls):
                await adapters._docling_to_markdown(b"some bytes")

        asyncio.run(run())
        mock_doc.export_to_markdown.assert_called_once()


class TestPullmdInnerTier:
    """_pullmd_to_markdown smoke tests (mocked httpx)."""

    def test_posts_to_correct_endpoint_and_returns_markdown(self):
        """POSTs to PULLMD_SERVICE_URL/extract and returns markdown from response JSON."""
        test_url = "https://example.com/article"
        expected_markdown = "# Article Title\n\nBody text."
        pullmd_service_url = "http://pullmd-service:8080"

        mock_response = MagicMock()
        mock_response.raise_for_status = MagicMock()
        mock_response.json.return_value = {"markdown": expected_markdown}

        async def run():
            with patch.dict(os.environ, {"PULLMD_SERVICE_URL": pullmd_service_url}):
                with patch("cocoindex_pipeline.adapters.httpx") as mock_httpx:
                    mock_httpx.post = MagicMock(return_value=mock_response)
                    result = await adapters._pullmd_to_markdown(test_url)
                    mock_httpx.post.assert_called_once_with(
                        f"{pullmd_service_url}/extract",
                        json={"url": test_url},
                        timeout=60.0,
                    )
                    return result

        result = asyncio.run(run())
        assert result == expected_markdown

    def test_raises_when_pullmd_service_url_missing(self):
        """Raises RuntimeError when PULLMD_SERVICE_URL env var is not set."""
        env_without_pullmd = {k: v for k, v in os.environ.items() if k != "PULLMD_SERVICE_URL"}

        async def run():
            with patch.dict(os.environ, env_without_pullmd, clear=True):
                with pytest.raises(RuntimeError, match="PULLMD_SERVICE_URL"):
                    await adapters._pullmd_to_markdown("https://example.com/page")

        asyncio.run(run())

    def test_raises_on_http_error(self):
        """raise_for_status() is called — HTTP errors propagate."""
        pullmd_service_url = "http://pullmd-service:8080"

        import httpx as _real_httpx

        mock_response = MagicMock()
        mock_response.raise_for_status.side_effect = _real_httpx.HTTPStatusError(
            "500 Server Error",
            request=MagicMock(),
            response=MagicMock(),
        )

        async def run():
            with patch.dict(os.environ, {"PULLMD_SERVICE_URL": pullmd_service_url}):
                with patch("cocoindex_pipeline.adapters.httpx") as mock_httpx:
                    mock_httpx.post = MagicMock(return_value=mock_response)
                    mock_httpx.HTTPStatusError = _real_httpx.HTTPStatusError
                    with pytest.raises(_real_httpx.HTTPStatusError):
                        await adapters._pullmd_to_markdown("https://example.com/fail")

        asyncio.run(run())


class TestPassthroughInnerTier:
    """_passthrough_markdown smoke tests — identity transform."""

    def test_returns_content_unchanged(self):
        """Passthrough returns the exact input string (identity transform)."""
        markdown_content = "# Heading\n\nParagraph with **bold** and _italic_."
        result = asyncio.run(adapters._passthrough_markdown(markdown_content))
        assert result == markdown_content

    def test_empty_string_returns_empty_string(self):
        """Passthrough handles empty string correctly."""
        result = asyncio.run(adapters._passthrough_markdown(""))
        assert result == ""

    def test_returns_str_type(self):
        """Passthrough return type is always str."""
        result = asyncio.run(adapters._passthrough_markdown("some content"))
        assert isinstance(result, str)

    def test_multiline_content_preserved_exactly(self):
        """Passthrough preserves newlines, whitespace, and special chars exactly."""
        content = "# Title\n\n- item 1\n- item 2\n\n> blockquote\n\n```python\ncode\n```\n"
        result = asyncio.run(adapters._passthrough_markdown(content))
        assert result == content
