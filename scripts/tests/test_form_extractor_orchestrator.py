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


# ── ID-80.13 — memo-HIT serde round-trip (D2 regression) ────────────────────
#
# S316 live-smoke evidence (B1 staging host): a memo HIT on
# ``extract_form_structure`` returned a plain **dict**, not an
# ``ExtractedForm`` — ``flow.py``'s ``extracted.form_metadata`` access raised
# AttributeError, the ft/ftf rows were never declared, and cocoindex's
# declared-target reconciliation garbage-collected walk-1's rows (ft=0/ftf=0).
#
# MECHANISM (verified against installed cocoindex 1.0.3):
#   1. ``AsyncFunction._resolved_return_deserializer`` resolves the memoised
#      fn's return hint via ``typing.get_type_hints(fn)`` and falls back to
#      ``Any`` on ANY exception (``_internal/function.py``).
#   2. ``orchestrator.extract_form_structure`` annotates ``file: "FileLike"``
#      with a TYPE_CHECKING-only import, so ``get_type_hints`` raises
#      ``NameError`` → hint ``Any``.
#   3. ``_internal/serde.py`` deserialises a pydantic payload (routing byte
#      0x02) with ``if type_hint is Any: return raw`` — the msgpack-decoded
#      ``model_dump(mode="json")`` dict comes back UNVALIDATED.
#
# NB: "fixing" the annotation alone is NOT safe — a resolved hint makes
# cocoindex strict-python-validate the dict, and strict mode rejects the ISO
# string form of ``FormMetadata.deadline`` (bl-220-class DeserializationError).
# The fix is ``coerce_extracted_form`` at the flow consumption boundary:
# JSON-mode revalidation, which accepts JSON-stable string forms under strict
# config. These tests use the REAL cocoindex serde (NOT a hand-rolled mock of
# it) — exactly the fidelity {80.10}'s idempotency sweep lacked.
# ────────────────────────────────────────────────────────────────────────────


def _worst_case_form() -> ExtractedForm:
    """An ExtractedForm exercising every JSON-unstable shape that crosses the
    memo boundary: a ``deadline`` datetime + a fully-populated field row."""
    from datetime import datetime, timezone

    return ExtractedForm(
        form_metadata=FormMetadata(
            form_type="tender",
            form_format="docx",
            form_title="ITT Services",
            issuing_organisation="Acme Council",
            deadline=datetime(2026, 7, 1, 12, 0, 0, tzinfo=timezone.utc),
            evaluation_methodology="MEAT 60/40",
        ),
        fields=[
            ExtractedField(
                question_text="Describe your approach",
                field_type="empty_cell",
                fill_status="pending",
                row_index=2,
                col_index=1,
                table_index=0,
                section_name="A",
                sequence=0,
                word_limit=500,
                is_mandatory=True,
                reference_urls=["https://example.org/guide"],
            ),
            ExtractedField(
                placeholder_text="[Insert]",
                field_type="placeholder",
                fill_status="pending",
                sequence=1,
            ),
        ],
    )


class TestMemoHitSerdeRoundTrip:
    """ID-80.13: the memo-HIT payload is a plain dict (real cocoindex serde),
    and ``coerce_extracted_form`` reconstructs the typed structure from it."""

    @staticmethod
    def _underlying_fn() -> object:
        """Unwrap the cocoindex AsyncFunction to the original user fn (the
        object whose annotations the memo machinery resolves). Falls back to
        the symbol itself when a conftest passthrough stub decorated it."""
        fn = orch_module.extract_form_structure
        try:
            return object.__getattribute__(fn, "_orig_async_fn")
        except AttributeError:
            return fn

    def test_return_hint_resolution_raises_so_memo_hint_falls_back_to_any(
        self,
    ) -> None:
        """Mechanism witness: ``typing.get_type_hints`` raises NameError on the
        orchestrator fn (``"FileLike"`` is TYPE_CHECKING-only), which is WHY
        cocoindex's memo deserialiser falls back to ``Any`` and hands the flow
        a plain dict on a memo HIT. If this ever starts resolving, re-verify
        the memo-HIT path: a resolved hint strict-python-validates and REJECTS
        ISO datetime strings (bl-220) unless the shapes are serde-safe."""
        import typing

        with pytest.raises(NameError):
            typing.get_type_hints(self._underlying_fn())

    def test_memo_hit_payload_is_plain_dict_under_real_serde(self) -> None:
        """FAIL-before witness: the REAL cocoindex serde round-trip with the
        ``Any`` fallback hint yields a dict — the exact value whose
        ``.form_metadata`` access crashed walk-2 on the B1 staging host."""
        from typing import Any

        from cocoindex._internal import serde

        form = _worst_case_form()
        hit = serde.deserialize(serde.serialize(form), Any)
        assert isinstance(hit, dict), (
            "expected the memo-HIT payload to round-trip as a plain dict under "
            f"hint=Any; got {type(hit).__name__}"
        )
        assert not hasattr(hit, "form_metadata")  # the D2 AttributeError shape

    def test_coercion_rebuilds_typed_form_from_real_memo_hit_payload(
        self,
    ) -> None:
        """``coerce_extracted_form`` over the REAL serde round-trip output must
        reconstruct an ``ExtractedForm`` equal to the original — including the
        ``deadline`` datetime (strict python-mode would reject its ISO string
        form; JSON-mode revalidation must accept it)."""
        from typing import Any

        from cocoindex._internal import serde

        form = _worst_case_form()
        hit = serde.deserialize(serde.serialize(form), Any)

        rebuilt = orch_module.coerce_extracted_form(hit)

        assert isinstance(rebuilt, ExtractedForm)
        assert rebuilt == form, (
            "the coerced memo-HIT payload must be field-for-field identical to "
            "the original extraction (same declared row set downstream)"
        )

    def test_coercion_passes_through_typed_and_none(self) -> None:
        """Memo MISSes return the live typed object (or None for non-form
        files) — the coercion must pass both through untouched."""
        form = _worst_case_form()
        assert orch_module.coerce_extracted_form(form) is form
        assert orch_module.coerce_extracted_form(None) is None

    def test_coercion_rejects_unexpected_shapes_loudly(self) -> None:
        """Anything other than ExtractedForm / dict / None is a serde-contract
        breach — surface loudly rather than letting it reach the row writes."""
        with pytest.raises(TypeError):
            orch_module.coerce_extracted_form(["not", "a", "form"])
