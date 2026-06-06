"""Tests for cocoindex_pipeline/adapters.py — layered fn-shape per-MIME adapters.

Tests the signature locks and per-MIME behaviour without importing cocoindex at
module level (which requires dangerouslyDisableSandbox: true and LMDB startup).
Each test mocks cocoindex at the import boundary so the test suite can run in a
standard Python environment.

Async adapter functions are exercised via asyncio.run() within synchronous test
functions — no pytest-asyncio plugin required.

Reference: docs/specs/id-28-cocoindex-flow-scaffolding/TECH.md §P-3 +
docs/specs/ID-75-pullmd-cocoindex/TECH.md §3 (D-4 / WP-D).
Test strategy: ID-28.7 — convert_binary_to_markdown signature matches FileLike->str;
inner-tier functions take bytes/str (verified via inspect.signature — never FileLike);
per-MIME dispatch smoke tests. ID-75.9 — a staged .html/.htm raises
LocalfsHtmlRetiredError with NO PullMD call (WP-D retirement); `_pullmd_fetch`
memo-keys on (url, content_epoch) and delegates to the plain `_pullmd_http_get`
HTTP body (D-4).
"""

from __future__ import annotations

import asyncio
import inspect
import os
import sys
import types
from io import BytesIO
from pathlib import Path, PurePath
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# ── Path setup ──────────────────────────────────────────────────────────────
# sys.path.insert(0, _SCRIPTS_DIR) was removed (ID-67.2): pyproject.toml
# pythonpath = ["scripts"] makes the bare path insert redundant.


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
    # The decorator kwargs are recorded on the wrapped function
    # (`__coco_fn_kwargs__`) so tests can pin declaration contracts such as
    # memo=True on `_pullmd_fetch` (D-4) without running the Rust engine.
    def _fn_decorator(**kwargs):
        def _wrap(func):
            func.__coco_fn_kwargs__ = dict(kwargs)
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


class _FakeDocumentStream:
    """Minimal stand-in for docling.datamodel.base_models.DocumentStream.

    The real DocumentStream is a pydantic model with `name: str` and
    `stream: BinaryIO` fields. We mirror just those two attributes so the
    regression test can assert on the wrapped value's TYPE, `.name`, and the
    round-tripped `.stream` bytes WITHOUT importing the 1.8 GB real package.
    """

    def __init__(self, *, name, stream):
        self.name = name
        self.stream = stream


# `docling.datamodel.base_models` hosts DocumentStream (the S299 FINDING-1 fix
# wraps content bytes in it). Register a REAL ModuleType (not a MagicMock) whose
# `DocumentStream` IS `_FakeDocumentStream`, so the lazy
# `from docling.datamodel.base_models import DocumentStream` inside
# `_docling_to_markdown` resolves deterministically to the fake — patching a
# MagicMock module attribute does NOT survive a `from ... import` (the auto-child
# mock wins), so a concrete module object is required. Works in envs WITHOUT the
# real 1.8 GB package; envs WITH it never trigger a real `import docling` here.
_docling_bm_stub = types.ModuleType("docling.datamodel.base_models")
_docling_bm_stub.DocumentStream = _FakeDocumentStream
sys.modules.setdefault("docling", _docling_stub)
sys.modules.setdefault("docling.document_converter", _docling_dc_stub)
sys.modules.setdefault("docling.datamodel.base_models", _docling_bm_stub)


with stubbed_sys_modules({"cocoindex": _coco_stub}):
    # ── Import the module under test ──────────────────────────────────────────
    from scripts.cocoindex_pipeline import adapters  # noqa: E402  (stub-scoped import)


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

    def test_pullmd_http_get_first_param_is_url(self):
        """_pullmd_http_get first param must be named 'url' (plain HTTP body)."""
        sig = inspect.signature(adapters._pullmd_http_get)
        params = list(sig.parameters.values())
        assert len(params) >= 1, "_pullmd_http_get must accept at least one parameter"
        first_param = params[0]
        assert first_param.name == "url", (
            f"First param must be 'url', got '{first_param.name}'"
        )

    def test_pullmd_http_get_annotation_is_str(self):
        """_pullmd_http_get first param annotation must be str."""
        sig = inspect.signature(adapters._pullmd_http_get)
        params = list(sig.parameters.values())
        ann = params[0].annotation
        if ann is not inspect.Parameter.empty:
            assert ann is str or ann == "str", (
                f"_pullmd_http_get first param must be str, got {ann!r}"
            )

    def test_pullmd_fetch_params_are_url_and_content_epoch(self):
        """_pullmd_fetch memo key is (url, content_epoch) — D-4, NOT url alone.

        A URL-only memo would return stale markdown forever, silently breaking
        BI-2's changed-content re-fetch. The epoch param is the memo-key salt.
        """
        sig = inspect.signature(adapters._pullmd_fetch)
        param_names = list(sig.parameters)
        assert param_names == ["url", "content_epoch"], (
            f"_pullmd_fetch params must be exactly ['url', 'content_epoch'], "
            f"got {param_names!r}"
        )
        for name in param_names:
            ann = sig.parameters[name].annotation
            if ann is not inspect.Parameter.empty:
                assert ann is str or ann == "str", (
                    f"_pullmd_fetch param '{name}' must be str, got {ann!r}"
                )

    def test_pullmd_fetch_is_declared_memo_true(self):
        """_pullmd_fetch must be declared @coco.fn(memo=True) (D-4 epoch-keyed memo)."""
        kwargs = getattr(adapters._pullmd_fetch, "__coco_fn_kwargs__", None)
        assert kwargs is not None, (
            "_pullmd_fetch must be wrapped by @coco.fn — no decorator kwargs recorded"
        )
        assert kwargs.get("memo") is True, (
            f"_pullmd_fetch must be declared memo=True, got {kwargs!r}"
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
            adapters._pullmd_fetch,
            adapters._pullmd_http_get,
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
        """All adapter functions must be coroutine functions (async def)."""
        fns = [
            adapters.convert_binary_to_markdown,
            adapters._docling_to_markdown,
            adapters._pullmd_fetch,
            adapters._pullmd_http_get,
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
            # Inner tier now receives (bytes, filename) — the filename threads
            # through so Docling picks the right backend (S299 FINDING-1 fix).
            mock_docling.assert_awaited_once_with(pdf_bytes, "test.pdf")
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
            mock_docling.assert_awaited_once_with(docx_bytes, "test.docx")
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
            mock_docling.assert_awaited_once_with(xlsx_bytes, "test.xlsx")
            return result

        result = asyncio.run(run())
        assert result == "# Docling XLSX"

    @pytest.mark.parametrize("suffix", [".html", ".htm"])
    def test_html_raises_loud_retired_error_with_no_pullmd_call(self, suffix):
        """A staged .html/.htm raises LocalfsHtmlRetiredError; PullMD is never called.

        WP-D (ID-75): the localfs HTML→PullMD branch is RETIRED — HTML content
        lands via the URL source. A .html file staged into the file corpus fails
        LOUDLY per-file (contained at the mount boundary, ID-80.9) instead of
        silently handing PullMD an unreachable local path.
        """
        mock_file = _make_filelike(suffix)

        async def run():
            with patch.object(
                adapters, "_pullmd_http_get", new=AsyncMock()
            ) as mock_http:
                with pytest.raises(adapters.LocalfsHtmlRetiredError):
                    await adapters.convert_binary_to_markdown(mock_file)
            # The retired branch must NOT reach the PullMD HTTP boundary.
            assert mock_http.await_count == 0, (
                "PullMD was called for a localfs HTML file — the retired branch leaked"
            )

        asyncio.run(run())

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
# STAGE-6 PROVENANCE FAN-OUT (ID-42.9 §WP-E, HTML retired per ID-75 WP-D)
# `extract_source_provenance` mirrors convert_binary_to_markdown's suffix
# routing for the FILE corpus: docling/passthrough provenance only. The
# localfs HTML branch raises LocalfsHtmlRetiredError — HTML provenance now
# lands via the URL source (`ingest_url` → `_pullmd_fetch`, TECH §WP-C).
# ============================================================================


class TestExtractSourceProvenance:
    """`extract_source_provenance` maps each MIME route onto SourceProvenance."""

    @pytest.mark.parametrize("suffix", [".html", ".htm"])
    def test_html_raises_loud_retired_error_with_no_pullmd_call(self, suffix):
        """HTML provenance via the file corpus is retired (ID-75 WP-D) — raises LOUDLY."""
        mock_file = _make_filelike(suffix)

        async def run():
            with patch.object(
                adapters, "_pullmd_http_get", new=AsyncMock()
            ) as mock_http:
                with pytest.raises(adapters.LocalfsHtmlRetiredError):
                    await adapters.extract_source_provenance(mock_file)
            assert mock_http.await_count == 0, (
                "PullMD was called for a localfs HTML file — the retired branch leaked"
            )

        asyncio.run(run())

    def test_pullmd_x_source_methods_mapping_unchanged(self):
        """The five CHECK-enum X-Source values stay intact (RESEARCH constraint 8).

        The mapping's consumer moves to the URL-source write site (`ingest_url`,
        TECH §WP-C step 2) — the frozenset itself must not drift, or
        `extraction_method='pullmd_<x_source>'` inserts would violate the CHECK
        enum in `20260526074944_id42_pullmd_provenance.sql`.
        """
        assert adapters._PULLMD_X_SOURCE_METHODS == frozenset(
            {"readability", "playwright", "cloudflare", "reddit", "trafilatura"}
        )

    @pytest.mark.parametrize("suffix", [".pdf", ".docx", ".xlsx"])
    def test_docling_route_yields_docling_method_no_share_id(self, suffix):
        """PDF/DOCX/XLSX → extraction_method == 'docling', pullmd_share_id None."""
        mock_file = _make_filelike(suffix)

        prov = asyncio.run(adapters.extract_source_provenance(mock_file))
        assert prov.extraction_method == "docling"
        assert prov.pullmd_share_id is None

    @pytest.mark.parametrize("suffix", [".md", ".markdown", ".txt"])
    def test_passthrough_route_yields_both_none(self, suffix):
        """markdown/txt passthrough has no extraction provenance → both None."""
        mock_file = _make_filelike(suffix, content_text="hello")

        prov = asyncio.run(adapters.extract_source_provenance(mock_file))
        assert prov.extraction_method is None
        assert prov.pullmd_share_id is None


# ============================================================================
# INNER TIER SMOKE TESTS
# ============================================================================


class TestDoclingInnerTier:
    """_docling_to_markdown smoke tests (mocked Docling converter).

    `DocumentConverter` is lazily imported inside `_docling_to_markdown` and is
    patched per-test. `DocumentStream` resolves from the module-level stub (a
    real ModuleType whose `DocumentStream` IS `_FakeDocumentStream`) so no
    per-test DocumentStream patch is needed and the suite never touches the real
    1.8 GB docling package.
    """

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
            with patch("docling.document_converter.DocumentConverter", mock_converter_cls):
                return await adapters._docling_to_markdown(fake_bytes, "test.pdf")

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
                await adapters._docling_to_markdown(b"some bytes", "test.docx")

        asyncio.run(run())
        mock_doc.export_to_markdown.assert_called_once()

    def test_convert_receives_documentstream_not_raw_bytes(self):
        """REGRESSION (S299 FINDING-1): convert() must get a DocumentStream, not bytes.

        The shipped bug passed raw bytes to `DocumentConverter.convert()`, which
        this Docling version rejects with a pydantic ValidationError — the
        charnwood.docx produced 0 content + 0 form rows. The old mocked test
        missed it because it only asserted `convert` was called, never the
        argument TYPE. This test pins the load-bearing contract:

          1. convert() receives a DocumentStream (NOT raw bytes).
          2. its `.name` carries the original filename (so Docling picks the
             right backend by extension).
          3. its `.stream` round-trips the exact content bytes.
        """
        docx_bytes = b"PK\x03\x04 charnwood docx zip magic + payload"
        filename = "charnwood.docx"

        mock_doc = MagicMock()
        mock_doc.export_to_markdown.return_value = "# Charnwood"
        mock_result = MagicMock()
        mock_result.document = mock_doc

        mock_converter_cls = MagicMock(return_value=MagicMock())
        mock_converter_cls.return_value.convert.return_value = mock_result

        async def run():
            with patch("docling.document_converter.DocumentConverter", mock_converter_cls):
                return await adapters._docling_to_markdown(docx_bytes, filename)

        result = asyncio.run(run())
        assert result == "# Charnwood"

        # The single positional argument convert() received.
        convert_call = mock_converter_cls.return_value.convert.call_args
        assert convert_call is not None, "convert() was never called"
        source_arg = convert_call.args[0] if convert_call.args else None

        # (1) It is a DocumentStream — NOT raw bytes. This is the exact bug.
        assert not isinstance(source_arg, (bytes, bytearray)), (
            "convert() received raw bytes — this is the S299 FINDING-1 regression"
        )
        assert isinstance(source_arg, _FakeDocumentStream), (
            f"convert() must receive a DocumentStream, got {type(source_arg).__name__}"
        )

        # (2) .name carries the original filename + extension.
        assert source_arg.name == filename, (
            f"DocumentStream.name must be {filename!r}, got {source_arg.name!r}"
        )

        # (3) .stream round-trips the exact content bytes.
        assert source_arg.stream.read() == docx_bytes, (
            "DocumentStream.stream must round-trip the original content bytes"
        )

    def test_documentstream_import_path_is_resolvable(self):
        """The DocumentStream import path the fix relies on must resolve.

        `_docling_to_markdown` does
        `from docling.datamodel.base_models import DocumentStream`. This guards
        against a future docling upgrade silently moving the symbol (which would
        reintroduce the S299 FINDING-1 failure mode at run time). The assertion
        holds against both the test-suite stub and the real package.
        """
        from docling.datamodel.base_models import DocumentStream  # noqa: PLC0415

        # Duck-type: constructible with keyword name + stream, exposing both.
        ds = DocumentStream(name="probe.docx", stream=BytesIO(b"payload"))
        assert ds.name == "probe.docx"
        assert ds.stream.read() == b"payload"


class TestPullmdHttpGet:
    """_pullmd_http_get unit tests against the pullmd v2.x contract.

    `_pullmd_http_get` is the plain NON-memo HTTP body extracted from the
    retired url-only-memo extractor (ID-75 WP-D / D-4) — the contract is
    UNCHANGED (docs/specs/id-42-pullmd-deploy/TECH.md §WP-A + RESEARCH §2.1):
      - GET {PULLMD_SERVICE_URL}/api with params={"url": <target>} (httpx URL-encodes).
      - Authorization: Bearer <PULLMD_API_TOKEN> header.
      - Body is raw text/markdown (resp.text), NOT JSON.
      - Provenance headers X-Source / X-Quality / X-Share-Id captured onto the result.
      - Fail-fast RuntimeError when PULLMD_SERVICE_URL OR PULLMD_API_TOKEN is unset.
      - HTTP errors propagate via raise_for_status() (log-then-raise, no silent failure).

    Memoisation lives on the `_pullmd_fetch(url, content_epoch)` wrapper (D-4)
    — see TestPullmdFetch. Transport is mocked at httpx.AsyncClient (NOT
    httpx.post — the contract is async GET). The non-mocked end-to-end proof
    against the deployed Service is a later subtask (WP-F / 42.10), per
    docs/reference/test-philosophy.md these unit tests assert observable
    BEHAVIOUR, not implementation shape.
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
                with patch("scripts.cocoindex_pipeline.adapters.httpx") as mock_httpx:
                    mock_httpx.Timeout = MagicMock(return_value="timeout-sentinel")
                    mock_client = self._install_async_client(mock_httpx, mock_response)
                    result = await adapters._pullmd_http_get(test_url)

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
                with patch("scripts.cocoindex_pipeline.adapters.httpx") as mock_httpx:
                    mock_httpx.Timeout = MagicMock(return_value="timeout-sentinel")
                    self._install_async_client(mock_httpx, mock_response)
                    return await adapters._pullmd_http_get("https://example.com/p")

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
                with patch("scripts.cocoindex_pipeline.adapters.httpx") as mock_httpx:
                    mock_httpx.Timeout = MagicMock(return_value="timeout-sentinel")
                    self._install_async_client(mock_httpx, mock_response)
                    return await adapters._pullmd_http_get("https://example.com/p")

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
                with patch("scripts.cocoindex_pipeline.adapters.httpx") as mock_httpx:
                    mock_httpx.Timeout = MagicMock(return_value="timeout-sentinel")
                    self._install_async_client(mock_httpx, mock_response)
                    return await adapters._pullmd_http_get("https://example.com/p")

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
                    await adapters._pullmd_http_get("https://example.com/page")

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
                    await adapters._pullmd_http_get("https://example.com/page")

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
                with patch("scripts.cocoindex_pipeline.adapters.httpx") as mock_httpx:
                    mock_httpx.Timeout = MagicMock(return_value="timeout-sentinel")
                    # Real exception classes so the adapter's `except httpx.HTTPError`
                    # is a genuine class, not a MagicMock attribute.
                    mock_httpx.HTTPError = _real_httpx.HTTPError
                    mock_httpx.HTTPStatusError = _real_httpx.HTTPStatusError
                    self._install_async_client(mock_httpx, mock_response)
                    with pytest.raises(_real_httpx.HTTPStatusError):
                        await adapters._pullmd_http_get("https://example.com/fail")

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
                with patch("scripts.cocoindex_pipeline.adapters.httpx") as mock_httpx:
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
                        await adapters._pullmd_http_get("https://example.com/down")

        asyncio.run(run())


class TestPullmdFetch:
    """_pullmd_fetch — the epoch-keyed memo wrapper around _pullmd_http_get (D-4).

    The engine memo-keys a @coco.fn(memo=True) component on its serialised
    args, so the load-bearing contract here is that BOTH `url` AND
    `content_epoch` are positional args: same url + same epoch = memo hit (no
    second HTTP call); same url + DIFFERENT epoch = a fresh fetch (BI-2
    changed-content re-fetch). The cocoindex stub's @coco.fn is pass-through,
    so the memo-key test applies an args-keyed memoiser mirroring the engine
    contract — proving the key INCLUDES the epoch, not testing the engine.
    """

    @staticmethod
    def _result(markdown="# Body"):
        return adapters.PullmdResult(
            markdown=markdown, x_source="readability", x_quality=0.9, share_id="abcd1234"
        )

    def test_delegates_to_http_get_with_url_only(self):
        """_pullmd_fetch awaits _pullmd_http_get(url) and returns its PullmdResult.

        `content_epoch` is memo-key salt ONLY — the HTTP request is a pure
        function of `url`, so the epoch must NOT reach the HTTP boundary.
        """
        stub_result = self._result()

        async def run():
            with patch.object(
                adapters, "_pullmd_http_get", new=AsyncMock(return_value=stub_result)
            ) as mock_http:
                result = await adapters._pullmd_fetch(
                    "https://example.com/article", "2026-06-01T00:00:00Z"
                )
            mock_http.assert_awaited_once_with("https://example.com/article")
            return result

        result = asyncio.run(run())
        assert result is stub_result

    def test_memo_key_is_url_and_content_epoch(self):
        """Same url + same epoch = memo hit; same url + DIFFERENT epoch = re-fetch.

        BI-2 (D-4): a URL-only memo returns stale markdown forever. Under an
        args-keyed memoiser (the engine contract for @coco.fn(memo=True)),
        bumping the epoch MUST force a second HTTP fetch, while an unchanged
        epoch must NOT.
        """

        def _memoise_on_args(fn):
            # Mirrors the engine contract: memo key = the serialised positional
            # args of the @coco.fn component.
            cache = {}

            async def wrapper(*args):
                if args not in cache:
                    cache[args] = await fn(*args)
                return cache[args]

            return wrapper

        url = "https://example.com/article"

        async def run():
            with patch.object(
                adapters, "_pullmd_http_get", new=AsyncMock(return_value=self._result())
            ) as mock_http:
                memoed_fetch = _memoise_on_args(adapters._pullmd_fetch)

                await memoed_fetch(url, "2026-06-01T00:00:00Z")
                assert mock_http.await_count == 1

                # Same url + same epoch — memo hit, NO second HTTP call.
                await memoed_fetch(url, "2026-06-01T00:00:00Z")
                assert mock_http.await_count == 1, (
                    "unchanged (url, content_epoch) must memo-hit, not re-fetch"
                )

                # Same url + DIFFERENT epoch — changed content, MUST re-fetch.
                await memoed_fetch(url, "2026-06-02T12:00:00Z")
                assert mock_http.await_count == 2, (
                    "a bumped content_epoch must force a fresh PullMD fetch (BI-2) — "
                    "a URL-only memo key would silently serve stale markdown forever"
                )

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
