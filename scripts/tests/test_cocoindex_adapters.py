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
# `cocoindex` is the cross-contamination culprit: cocoindex 1.0.3 keeps a
# process-global ContextKey registry + `@coco.fn` stub, so a resident
# `cocoindex` MagicMock leaks into sibling files (notably
# test_cocoindex_flow_context.py, which silently downgrades its strict
# ContextKey assertion under a leaked stub). Scope the cocoindex stub to the
# import below via `stubbed_sys_modules()` and restore sys.modules afterwards;
# `adapters` captures the stub reference at import time, so its tests still run
# stub-backed (ID-44.5).
from conftest import stubbed_sys_modules  # noqa: E402

_coco_stub = _make_coco_stub()

# docling (a 1.8 GB Cloud-Run-only dep) is stubbed so adapters.py imports
# cleanly. Unlike cocoindex it is inert — it registers no process-global state
# and no sibling file consumes the real package — and `_docling_to_markdown`
# lazy-imports `docling.document_converter` at RUN time (patched per-test).
# It therefore stays resident in sys.modules rather than being import-scoped.
_docling_stub = MagicMock(name="docling")
_docling_dc_stub = MagicMock(name="docling.document_converter")
sys.modules.setdefault("docling", _docling_stub)
sys.modules.setdefault("docling.document_converter", _docling_dc_stub)


with stubbed_sys_modules({"cocoindex": _coco_stub}):
    # ── Import the module under test ──────────────────────────────────────────
    from cocoindex_pipeline import adapters  # noqa: E402  (stub-scoped import)


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
        """HTML routes to _pullmd_to_markdown(str); outer fn returns the markdown str.

        The inner tier returns a structured PullmdResult (carrying provenance
        headers), but the OUTER convert_binary_to_markdown keeps its `str`
        contract for the downstream content_text flow — it extracts `.markdown`.
        """
        mock_file = _make_filelike(".html")
        inner_result = adapters.PullmdResult(
            markdown="# PullMD HTML",
            x_source="readability",
            x_quality=0.88,
            share_id="deadbeef",
        )

        async def run():
            with patch.object(
                adapters, "_pullmd_to_markdown", new=AsyncMock(return_value=inner_result)
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
        # Outer contract is unchanged: a bare markdown str (the .markdown field).
        assert result == "# PullMD HTML"
        assert isinstance(result, str)

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
    """_pullmd_to_markdown unit tests against the pullmd v2.x contract.

    Contract (docs/specs/id-42-pullmd-deploy/TECH.md §WP-A + RESEARCH §2.1):
      - GET {PULLMD_SERVICE_URL}/api with params={"url": <target>} (httpx URL-encodes).
      - Authorization: Bearer <PULLMD_API_TOKEN> header.
      - Body is raw text/markdown (resp.text), NOT JSON.
      - Provenance headers X-Source / X-Quality / X-Share-Id captured onto the result.
      - Fail-fast RuntimeError when PULLMD_SERVICE_URL OR PULLMD_API_TOKEN is unset.
      - HTTP errors propagate via raise_for_status().

    Transport is mocked at httpx.AsyncClient (NOT httpx.post — the contract is async
    GET). The non-mocked end-to-end proof against the deployed Service is a later
    subtask (WP-F / 42.10), per docs/reference/test-philosophy.md these unit tests
    assert observable BEHAVIOUR, not implementation shape.
    """

    @staticmethod
    def _install_async_client(mock_httpx, mock_response):
        """Wire mock_httpx so `async with httpx.AsyncClient(...) as client` yields a
        client whose awaitable `.get(...)` returns `mock_response`.

        Returns the AsyncMock standing in for the client so callers can assert on
        `.get` call args.
        """
        mock_client = MagicMock(name="async_client")
        mock_client.get = AsyncMock(return_value=mock_response)

        # `async with httpx.AsyncClient(...) as client` -> the context manager's
        # __aenter__ must yield the client; __aexit__ must be awaitable.
        async_cm = MagicMock(name="async_client_cm")
        async_cm.__aenter__ = AsyncMock(return_value=mock_client)
        async_cm.__aexit__ = AsyncMock(return_value=False)

        mock_httpx.AsyncClient = MagicMock(return_value=async_cm)
        return mock_client

    @staticmethod
    def _make_markdown_response(markdown, headers=None):
        """Build a mock httpx.Response returning raw markdown text + headers."""
        import httpx as _real_httpx

        mock_response = MagicMock(name="response")
        mock_response.text = markdown
        mock_response.raise_for_status = MagicMock()
        # Real httpx.Headers is case-insensitive — use it so the test proves the
        # adapter reads the headers via case-insensitive lookup, not by luck.
        mock_response.headers = _real_httpx.Headers(headers or {})
        return mock_response

    def test_gets_api_endpoint_with_url_param_and_bearer_auth(self):
        """GETs {url}/api with params={'url': target} + Authorization: Bearer header."""
        test_url = "https://example.com/article?q=1&x=2"
        expected_markdown = "# Article Title\n\nBody text."
        pullmd_service_url = "http://pullmd-service:8080"
        api_token = "pmd_testtoken0123456789abcdefghij"

        mock_response = self._make_markdown_response(expected_markdown)

        async def run():
            with patch.dict(
                os.environ,
                {"PULLMD_SERVICE_URL": pullmd_service_url, "PULLMD_API_TOKEN": api_token},
            ):
                with patch("cocoindex_pipeline.adapters.httpx") as mock_httpx:
                    mock_httpx.Timeout = MagicMock(return_value="timeout-sentinel")
                    mock_client = self._install_async_client(mock_httpx, mock_response)
                    result = await adapters._pullmd_to_markdown(test_url)

                    # GET /api (NOT POST /extract).
                    assert mock_client.get.await_count == 1
                    call = mock_client.get.await_args
                    assert call.args[0] == f"{pullmd_service_url}/api"
                    # url passed as a query param so httpx URL-encodes it.
                    assert call.kwargs["params"] == {"url": test_url}
                    # Bearer auth header present.
                    assert (
                        call.kwargs["headers"]["Authorization"]
                        == f"Bearer {api_token}"
                    )
                    return result

        result = asyncio.run(run())
        # Body is raw text/markdown (resp.text), surfaced as .markdown on the result.
        assert result.markdown == expected_markdown

    def test_captures_provenance_headers_onto_result(self):
        """X-Source / X-Quality / X-Share-Id from the response are captured (case-insensitive)."""
        pullmd_service_url = "http://pullmd-service:8080"
        api_token = "pmd_testtoken0123456789abcdefghij"

        # Mixed-case header keys prove the lookup is case-insensitive.
        mock_response = self._make_markdown_response(
            "# Body",
            headers={
                "x-source": "playwright",
                "X-Quality": "0.92",
                "X-SHARE-ID": "a1b2c3d4",
            },
        )

        async def run():
            with patch.dict(
                os.environ,
                {"PULLMD_SERVICE_URL": pullmd_service_url, "PULLMD_API_TOKEN": api_token},
            ):
                with patch("cocoindex_pipeline.adapters.httpx") as mock_httpx:
                    mock_httpx.Timeout = MagicMock(return_value="timeout-sentinel")
                    self._install_async_client(mock_httpx, mock_response)
                    return await adapters._pullmd_to_markdown("https://example.com/p")

        result = asyncio.run(run())
        assert result.markdown == "# Body"
        assert result.x_source == "playwright"
        assert result.x_quality == 0.92
        assert result.share_id == "a1b2c3d4"

    def test_non_numeric_x_quality_header_yields_none(self):
        """A malformed X-Quality header (e.g. 'high') yields x_quality=None, not a crash.

        A raw ValueError from float() would bypass the structured failure log +
        flow.py _classify_stage_exception path; the adapter must degrade the bad
        quality signal to None (consistent with the missing-header→None behaviour).
        """
        pullmd_service_url = "http://pullmd-service:8080"
        api_token = "pmd_testtoken0123456789abcdefghij"
        mock_response = self._make_markdown_response(
            "# Body",
            headers={"X-Source": "readability", "X-Quality": "high", "X-Share-Id": "abcd1234"},
        )

        async def run():
            with patch.dict(
                os.environ,
                {"PULLMD_SERVICE_URL": pullmd_service_url, "PULLMD_API_TOKEN": api_token},
            ):
                with patch("cocoindex_pipeline.adapters.httpx") as mock_httpx:
                    mock_httpx.Timeout = MagicMock(return_value="timeout-sentinel")
                    self._install_async_client(mock_httpx, mock_response)
                    return await adapters._pullmd_to_markdown("https://example.com/p")

        result = asyncio.run(run())
        # Markdown + other provenance still captured; only the bad quality degrades.
        assert result.markdown == "# Body"
        assert result.x_source == "readability"
        assert result.share_id == "abcd1234"
        assert result.x_quality is None

    def test_missing_headers_yield_none_on_result(self):
        """Absent provenance headers leave the result fields as None (no crash)."""
        pullmd_service_url = "http://pullmd-service:8080"
        api_token = "pmd_testtoken0123456789abcdefghij"
        mock_response = self._make_markdown_response("# Body", headers={})

        async def run():
            with patch.dict(
                os.environ,
                {"PULLMD_SERVICE_URL": pullmd_service_url, "PULLMD_API_TOKEN": api_token},
            ):
                with patch("cocoindex_pipeline.adapters.httpx") as mock_httpx:
                    mock_httpx.Timeout = MagicMock(return_value="timeout-sentinel")
                    self._install_async_client(mock_httpx, mock_response)
                    return await adapters._pullmd_to_markdown("https://example.com/p")

        result = asyncio.run(run())
        assert result.x_source is None
        assert result.x_quality is None
        assert result.share_id is None

    def test_raises_when_pullmd_service_url_missing(self):
        """Raises RuntimeError when PULLMD_SERVICE_URL env var is not set."""
        env_without = {
            k: v
            for k, v in os.environ.items()
            if k != "PULLMD_SERVICE_URL"
        }
        env_without["PULLMD_API_TOKEN"] = "pmd_token"

        async def run():
            with patch.dict(os.environ, env_without, clear=True):
                with pytest.raises(RuntimeError, match="PULLMD_SERVICE_URL"):
                    await adapters._pullmd_to_markdown("https://example.com/page")

        asyncio.run(run())

    def test_raises_when_pullmd_api_token_missing(self):
        """Raises RuntimeError when PULLMD_API_TOKEN env var is not set (fail-fast auth)."""
        env_without = {
            k: v
            for k, v in os.environ.items()
            if k != "PULLMD_API_TOKEN"
        }
        env_without["PULLMD_SERVICE_URL"] = "http://pullmd-service:8080"

        async def run():
            with patch.dict(os.environ, env_without, clear=True):
                with pytest.raises(RuntimeError, match="PULLMD_API_TOKEN"):
                    await adapters._pullmd_to_markdown("https://example.com/page")

        asyncio.run(run())

    def test_raises_on_http_error(self):
        """raise_for_status() is called — HTTP errors propagate to the caller."""
        pullmd_service_url = "http://pullmd-service:8080"
        api_token = "pmd_testtoken0123456789abcdefghij"

        import httpx as _real_httpx

        mock_response = MagicMock(name="response")
        mock_response.text = ""
        mock_response.headers = _real_httpx.Headers({})
        mock_response.raise_for_status.side_effect = _real_httpx.HTTPStatusError(
            "500 Server Error",
            request=MagicMock(),
            response=MagicMock(),
        )

        async def run():
            with patch.dict(
                os.environ,
                {"PULLMD_SERVICE_URL": pullmd_service_url, "PULLMD_API_TOKEN": api_token},
            ):
                with patch("cocoindex_pipeline.adapters.httpx") as mock_httpx:
                    mock_httpx.Timeout = MagicMock(return_value="timeout-sentinel")
                    # Real exception classes so the adapter's `except httpx.HTTPError`
                    # is a genuine class, not a MagicMock attribute.
                    mock_httpx.HTTPError = _real_httpx.HTTPError
                    mock_httpx.HTTPStatusError = _real_httpx.HTTPStatusError
                    self._install_async_client(mock_httpx, mock_response)
                    with pytest.raises(_real_httpx.HTTPStatusError):
                        await adapters._pullmd_to_markdown("https://example.com/fail")

        asyncio.run(run())

    def test_request_error_propagates(self):
        """httpx.RequestError (connect/timeout) propagates to flow exception classification."""
        pullmd_service_url = "http://pullmd-service:8080"
        api_token = "pmd_testtoken0123456789abcdefghij"

        import httpx as _real_httpx

        async def run():
            with patch.dict(
                os.environ,
                {"PULLMD_SERVICE_URL": pullmd_service_url, "PULLMD_API_TOKEN": api_token},
            ):
                with patch("cocoindex_pipeline.adapters.httpx") as mock_httpx:
                    mock_httpx.Timeout = MagicMock(return_value="timeout-sentinel")
                    # Real exception classes so the adapter's `except httpx.HTTPError`
                    # is a genuine class, not a MagicMock attribute.
                    mock_httpx.HTTPError = _real_httpx.HTTPError
                    mock_httpx.RequestError = _real_httpx.RequestError
                    mock_client = MagicMock(name="async_client")
                    mock_client.get = AsyncMock(
                        side_effect=_real_httpx.ConnectError("connection refused")
                    )
                    async_cm = MagicMock(name="async_client_cm")
                    async_cm.__aenter__ = AsyncMock(return_value=mock_client)
                    async_cm.__aexit__ = AsyncMock(return_value=False)
                    mock_httpx.AsyncClient = MagicMock(return_value=async_cm)
                    with pytest.raises(_real_httpx.RequestError):
                        await adapters._pullmd_to_markdown("https://example.com/down")

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
