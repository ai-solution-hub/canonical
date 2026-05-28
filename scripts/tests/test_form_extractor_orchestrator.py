"""Tests for the ID-52 Path B ``extract_form_structure`` orchestrator (TECH §2.4).

The orchestrator is a deterministic ``@coco.fn(memo=True)`` dispatcher (NO LLM):
it routes a cocoindex ``FileLike`` to the per-format reader by suffix and returns
the reader's ``ExtractedForm`` — or ``None`` for non-form / out-of-scope inputs.

WHAT THIS PROVES:
  - ``.pdf`` / ``.xlsx`` / ``.docx`` route to the matching reader's ``extract``
    (called with ``await file.read()`` bytes + the file name).
  - ``.xls`` returns ``None`` and logs ``form_extractor.skip`` (Inv-3 — no raise).
  - Any other suffix (``.md``, ``.txt``) returns ``None`` (not a form).
  - The orchestrator is exported from the package ``__init__`` (the single
    public Path-B symbol) per the {52.12} brief.

Async tests follow the repo convention (no pytest-asyncio plugin): drive
coroutines via ``asyncio.run`` inside sync test functions.
"""

from __future__ import annotations

import asyncio
import json
import logging
import sys
from pathlib import Path

import pytest


_SCRIPTS_DIR = Path(__file__).resolve().parents[1]
if str(_SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS_DIR))

# Import via the SAME absolute (``scripts.``-prefixed) namespace the package
# `__init__` + orchestrator module use. `scripts/` is on sys.path under pytest,
# so a bare `cocoindex_pipeline.form_extractors.orchestrator` import would
# resolve a SECOND, distinct module object whose `_extract_*` seams the live
# `extract_form_structure` (closed over the `scripts.`-namespaced module dict)
# never reads — making any monkeypatch there silently ineffective. Patching the
# module the function actually closes over is the determinism-preserving choice.
from scripts.cocoindex_pipeline.form_extractors import (  # noqa: E402
    extract_form_structure,
)
from scripts.cocoindex_pipeline.form_extractors import (  # noqa: E402
    orchestrator as orch_module,
)
from scripts.cocoindex_pipeline.form_extractors.shared import (  # noqa: E402
    ExtractedField,
    ExtractedForm,
    FormMetadata,
)


# ── Fakes ────────────────────────────────────────────────────────────────────


class _FakeFile:
    """Minimal cocoindex FileLike stand-in: async ``read`` + ``file_path.path``."""

    class _FilePath:
        def __init__(self, path: Path) -> None:
            self.path = path

    def __init__(self, path: Path, raw: bytes = b"") -> None:
        self.file_path = _FakeFile._FilePath(path)
        self._raw = raw

    async def read(self) -> bytes:
        return self._raw


def _make_form(form_format: str) -> ExtractedForm:
    return ExtractedForm(
        form_metadata=FormMetadata(form_type="tender", form_format=form_format),
        fields=[
            ExtractedField(
                question_text="Q1?",
                field_type="empty_cell",
                fill_status="pending",
                sequence=0,
            )
        ],
    )


# ── Public-export contract ─────────────────────────────────────────────────


def test_extract_form_structure_exported_from_package() -> None:
    """The orchestrator is the single public Path-B symbol on the package init."""
    from scripts.cocoindex_pipeline import form_extractors

    assert hasattr(form_extractors, "extract_form_structure")
    assert callable(form_extractors.extract_form_structure)


# ── Suffix dispatch ─────────────────────────────────────────────────────────


class TestSuffixDispatch:
    def test_pdf_routes_to_pdf_extract(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        seen: dict[str, object] = {}

        async def _fake_pdf(raw_bytes: bytes, filename: str) -> ExtractedForm:
            seen["raw"] = raw_bytes
            seen["filename"] = filename
            return _make_form("pdf")

        monkeypatch.setattr(orch_module, "_extract_pdf", _fake_pdf)

        f = _FakeFile(tmp_path / "blank.pdf", raw=b"%PDF-1.7 bytes")
        result = asyncio.run(extract_form_structure(f))

        assert isinstance(result, ExtractedForm)
        assert result.form_metadata.form_format == "pdf"
        assert seen["raw"] == b"%PDF-1.7 bytes"
        assert seen["filename"] == "blank.pdf"

    def test_xlsx_routes_to_xlsx_extract(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        async def _fake_xlsx(raw_bytes: bytes, filename: str) -> ExtractedForm:
            return _make_form("xlsx")

        monkeypatch.setattr(orch_module, "_extract_xlsx", _fake_xlsx)

        f = _FakeFile(tmp_path / "sheet.xlsx", raw=b"PK\x03\x04")
        result = asyncio.run(extract_form_structure(f))
        assert isinstance(result, ExtractedForm)
        assert result.form_metadata.form_format == "xlsx"

    def test_docx_routes_to_docx_extract(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        async def _fake_docx(raw_bytes: bytes, filename: str) -> ExtractedForm:
            return _make_form("docx")

        monkeypatch.setattr(orch_module, "_extract_docx", _fake_docx)

        f = _FakeFile(tmp_path / "doc.docx", raw=b"PK\x03\x04")
        result = asyncio.run(extract_form_structure(f))
        assert isinstance(result, ExtractedForm)
        assert result.form_metadata.form_format == "docx"

    def test_xls_returns_none_and_logs_skip(
        self, tmp_path: Path, caplog: pytest.LogCaptureFixture
    ) -> None:
        """Inv-3: legacy ``.xls`` is out of scope — return None, log skip, no raise."""
        f = _FakeFile(tmp_path / "legacy.xls", raw=b"\xd0\xcf\x11\xe0")
        with caplog.at_level(logging.INFO):
            result = asyncio.run(extract_form_structure(f))
        assert result is None
        skip_logs = [
            json.loads(rec.message)
            for rec in caplog.records
            if rec.message.startswith("{") and "form_extractor.skip" in rec.message
        ]
        assert skip_logs, "an .xls input must emit a form_extractor.skip log line"
        assert skip_logs[0]["reason"] == "xls_out_of_scope"
        assert skip_logs[0]["rel_path"].endswith("legacy.xls")

    def test_markdown_returns_none(self, tmp_path: Path) -> None:
        """A non-form suffix (``.md``) is not form-relevant → None, no log."""
        f = _FakeFile(tmp_path / "notes.md", raw=b"# notes")
        result = asyncio.run(extract_form_structure(f))
        assert result is None

    def test_uppercase_suffix_normalised(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Suffix matching is case-insensitive (``.PDF`` routes like ``.pdf``)."""

        async def _fake_pdf(raw_bytes: bytes, filename: str) -> ExtractedForm:
            return _make_form("pdf")

        monkeypatch.setattr(orch_module, "_extract_pdf", _fake_pdf)
        f = _FakeFile(tmp_path / "BLANK.PDF", raw=b"%PDF")
        result = asyncio.run(extract_form_structure(f))
        assert isinstance(result, ExtractedForm)
