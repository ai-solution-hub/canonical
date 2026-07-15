"""PDF Plane-2 (mechanical) field detector for ID-145.11 (DR-057, BI-20).

Real UK procurement PDFs are FLAT — zero AcroForm fields (verified 5/5,
TECH.md §1.3) — so ``pypdf.PdfReader.get_fields()`` is a dead end and
ML-based widget detection is mandatory. This module wraps
``commonforms.prepare_form`` (licence ratified Apache-2.0, DR-057 —
adopted DIRECTLY, no in-repo FFDetr-wrapper fallback per the dropped
ARCH-REVIEW §4.3 R-B design) to render→detect→write AcroForm widgets
onto a fillable copy of the input PDF, then reads the detected widgets
back (page, rect, field type) and pairs each one with nearby label text
extracted via ``pdfplumber`` word positions on the ORIGINAL page (left
of the widget on the same row, else the nearest line(s) above — TECH.md
§3.2's "mandatory label-pairing": detection yields coordinates only, no
label text, and PDF auto-map ({145.14}) matches lexically on
``field.question_text`` — an unpaired box is a structural no-op there).

Output is BOTH the paired field rows (``PdfDetectedField``, Plane-2 —
``form_instance_fields`` candidate rows) AND the fillable-PDF artefact
bytes commonforms wrote (consumed by the fill step, {145.15}).

Local Pydantic shapes (not ``form_extractors.shared``)
-------------------------------------------------------

``shared.py`` (the cross-format ``ExtractedField``/``ExtractedForm``/
``FormExtractionError`` shapes) is recovered by the sibling, disjoint
OOXML subtask ({145.10}) — outside this subtask's file ownership
(``scripts/`` PDF extractor module + ``requirements.txt`` + PDF test
fixtures only) and not present on this branch. This module therefore
defines its own minimal local shapes so its tests are green in
isolation; ``field_type='empty_cell'`` follows the PRECEDENT the
original (pre-id-136-retirement) ``pdf.py``/``shared.py`` set for
PDF-sourced fields ("PDF reader leaves it empty_cell" — flat PDFs carry
no placeholder/highlight distinction the way OOXML cells do).
**Reconciliation with ``shared.py`` — and with the ``form_instance_fields``
DB write itself (no bbox/widget-type columns exist; TECH.md §2 M3 keeps
the coords/mapping_status/fill_status slot model "unchanged") — is
explicitly left to the writer/wiring subtask that lands after both
{145.10} and {145.11}; this module is a pure extraction function, it
does not write to the database.**

References:
- TECH.md §1.3 (empirical verification — commonforms 0.2.1, pypdf
  6.14.2, pdfplumber 0.11.9 pins), §3.1 (Plane 2 producer contract),
  §3.2 (PDF mechanism + mandatory label-pairing).
- ARCH-REVIEW.md §4.1 (measured baseline: 198 fields / 57pp / 35.9s CPU
  on the Standard SQ PDF, 141 /Tx + 57 /Btn), §4.3 R-B (dropped wrapper
  design).
- FORM-EXTRACTION-SPIKE.md §2.2 (corroborating Croydon SQ run: 120
  fields / 23pp / 3.8s CPU).
"""

from __future__ import annotations

import io
import logging
import os
import tempfile
from typing import Literal

from pydantic import BaseModel, ConfigDict
from pypdf import PdfReader
import commonforms
import pdfplumber
from commonforms.exceptions import EncryptedPdfError

logger = logging.getLogger(__name__)

__all__ = [
    "PdfDetectedField",
    "PdfFieldDetectionResult",
    "PdfFieldDetectionError",
    "acroform_field_count",
    "detect_pdf_fields",
]

# ──────────────────────────────────────────────────────────────────────────
# Shapes
# ──────────────────────────────────────────────────────────────────────────


class PdfFieldDetectionError(Exception):
    """Raised when a PDF cannot be rendered/detected (malformed or
    encrypted input — commonforms surfaces both as ``EncryptedPdfError``
    upstream since both trip the same pdfium parse failure; this wraps
    that with a clearer message and the offending filename)."""


class PdfDetectedField(BaseModel):
    """One commonforms-detected + pdfplumber-label-paired PDF field.

    Not a 1:1 ``form_instance_fields`` row shape (see module docstring —
    that mapping, including the field_type CHECK-constraint fit for
    /Tx vs /Btn widgets and whether bbox/page geometry needs a schema
    change, is left to the writer/wiring subtask).
    """

    model_config = ConfigDict(strict=True, extra="forbid")

    field_name: str
    """commonforms-assigned AcroForm field name, e.g. ``textbox_5_0``."""

    widget_kind: Literal["TextBox", "ChoiceButton"]
    """commonforms' detected widget class (``Signature`` collapses into
    ``TextBox`` — ``prepare_form`` is called with
    ``use_signature_fields=False``, its default)."""

    acroform_type: Literal["/Tx", "/Btn"]
    """Raw PDF field type read back from the fillable artefact."""

    page_number: int
    """0-indexed page (matches commonforms' internal + field-name
    indexing)."""

    bbox: tuple[float, float, float, float]
    """PDF-point-space ``(x0, y0, x1, y1)``, origin bottom-left —
    the widget's ``/Rect`` as written by commonforms."""

    question_text: str
    """Nearby label text paired via pdfplumber word positions on the
    ORIGINAL page (mandatory per TECH.md §3.2 — never empty on a real
    form; see ``_pair_label``)."""

    sequence: int
    """Reading-order index across the whole document (page-major, then
    commonforms' own within-page reading-order sort)."""

    field_type: Literal["empty_cell"] = "empty_cell"
    """Constant — precedent from the retired ``shared.py``: PDF-sourced
    fields carry no placeholder/highlight distinction."""

    fill_status: Literal["pending"] = "pending"


class PdfFieldDetectionResult(BaseModel):
    """The Plane-2 producer's output: paired field rows + the fillable
    artefact for the fill step ({145.15})."""

    model_config = ConfigDict(strict=True, extra="forbid")

    fields: list[PdfDetectedField]
    fillable_pdf_bytes: bytes


# ──────────────────────────────────────────────────────────────────────────
# AcroForm dead-end check (TECH.md §1.3 — 0 fields on 5/5 real UK PDFs)
# ──────────────────────────────────────────────────────────────────────────


def acroform_field_count(raw_bytes: bytes) -> int:
    """Count native AcroForm fields via ``pypdf.PdfReader.get_fields()``.

    Real UK procurement PDFs are FLAT — this is expected to return 0,
    which is why detection (``detect_pdf_fields``) is mandatory rather
    than optional.
    """

    fields = PdfReader(io.BytesIO(raw_bytes)).get_fields()
    return len(fields) if fields else 0


# ──────────────────────────────────────────────────────────────────────────
# Label pairing (TECH.md §3.2 — "pdfplumber words left/above the box")
# ──────────────────────────────────────────────────────────────────────────

_ROW_TOLERANCE_PT = 3.0
"""Vertical-overlap tolerance (points) for "same row" word matching."""

_LINE_CLUSTER_PT = 3.0
"""Words within this many points of each other's ``top`` are the same
visual line (mirrors commonforms' own ``sort_widgets`` line-clustering
threshold, scaled from normalised to point space)."""

_ABOVE_WINDOW_PT = 90.0
"""How far above the widget to search for label lines (~4 lines at a
typical 11-13pt line height)."""

_MIN_LABEL_CHARS = 15
"""Below this length, widen the "above" search by pulling additional
lines (capped — see ``_MAX_WIDEN_LINES``) rather than accepting a
single short/low-signal line (e.g. a lone "M"/"O" mandatory-flag cell)."""

_MAX_WIDEN_LINES = 2
"""Cap on extra lines pulled when widening a short "above" label —
prevents run-on concatenation across dense single-token table columns."""


def _cluster_lines(words: list[dict]) -> list[list[dict]]:
    """Group pdfplumber words (any order) into visual lines, sorted by
    ``top`` then ``x0`` within each line."""

    lines: list[list[dict]] = []
    for word in sorted(words, key=lambda w: (w["top"], w["x0"])):
        if lines and abs(word["top"] - lines[-1][0]["top"]) <= _LINE_CLUSTER_PT:
            lines[-1].append(word)
        else:
            lines.append([word])
    return lines


def _pair_label(
    fx0: float, ftop: float, fx1: float, fbottom: float, page_words: list[dict]
) -> str:
    """Pair a detected field's pdfplumber-space bbox with nearby label
    text: same-row-left first, then the nearest line(s) above, then
    same-row-right, then the nearest line below (last resort — every
    real field on the measured corpus resolves via the first two)."""

    same_row_left = [
        w
        for w in page_words
        if w["x1"] <= fx0 + 1
        and not (w["bottom"] < ftop - _ROW_TOLERANCE_PT or w["top"] > fbottom + _ROW_TOLERANCE_PT)
    ]
    if same_row_left:
        same_row_left.sort(key=lambda w: w["x0"])
        return " ".join(w["text"] for w in same_row_left)

    above = [w for w in page_words if w["bottom"] <= ftop + _ROW_TOLERANCE_PT]
    if above:
        lines = _cluster_lines(above)
        lines.sort(key=lambda line: line[0]["top"])  # ascending; last = nearest above
        label_words = list(lines[-1])
        idx = len(lines) - 1
        pulled = 0
        while (
            len(" ".join(w["text"] for w in label_words)) < _MIN_LABEL_CHARS
            and idx > 0
            and pulled < _MAX_WIDEN_LINES
        ):
            idx -= 1
            if ftop - lines[idx][0]["top"] > _ABOVE_WINDOW_PT:
                break
            label_words = lines[idx] + label_words
            pulled += 1
        return " ".join(w["text"] for w in label_words)

    same_row_right = [
        w
        for w in page_words
        if w["x0"] >= fx1 - 1
        and not (w["bottom"] < ftop - _ROW_TOLERANCE_PT or w["top"] > fbottom + _ROW_TOLERANCE_PT)
    ]
    if same_row_right:
        same_row_right.sort(key=lambda w: w["x0"])
        return " ".join(w["text"] for w in same_row_right)

    below = [w for w in page_words if w["top"] >= fbottom - _ROW_TOLERANCE_PT]
    if below:
        lines = _cluster_lines(below)
        lines.sort(key=lambda line: line[0]["top"])
        return " ".join(w["text"] for w in lines[0])

    return ""


# ──────────────────────────────────────────────────────────────────────────
# Detection entry point
# ──────────────────────────────────────────────────────────────────────────

_WIDGET_KIND_TO_ACROFORM_TYPE: dict[str, str] = {
    "TextBox": "/Tx",
    "ChoiceButton": "/Btn",
}


def detect_pdf_fields(
    raw_bytes: bytes,
    filename: str,
    *,
    model_or_path: str = "FFDetr",
    device: str = "cpu",
    fast: bool = True,
) -> PdfFieldDetectionResult:
    """Detect fillable fields on a flat PDF and pair each with nearby
    label text.

    ``fast=True`` is passed for parity with TECH.md §1.3's pinned
    citation, but — verified at impl time reading
    ``commonforms/inference.py`` — has NO EFFECT for the default
    ``model_or_path='FFDetr'`` path: ``prepare_form`` only threads
    ``fast`` into ``FFDNetDetector`` (the FFDNet-S/L ONNX-vs-.pt
    weight choice); the ``else`` branch used for ``'FFDetr'`` calls
    ``FFDetrDetector(model_or_path)`` with no ``fast``/``device``
    passthrough at all (its constructor's ``device`` param defaults to
    ``'cpu'`` regardless). Kept because it is harmless, spec-cited, and
    forward-compatible if a future commonforms release wires it through.

    Raises:
        PdfFieldDetectionError: input is malformed or encrypted (both
            surface as ``commonforms.exceptions.EncryptedPdfError``
            upstream — a single pdfium parse-failure path covers both
            causes, so the wrapped message does not claim encryption
            specifically).
    """

    try:
        with pdfplumber.open(io.BytesIO(raw_bytes)) as pdf:
            page_words = [page.extract_words() for page in pdf.pages]
            page_heights = [page.height for page in pdf.pages]
    except Exception as exc:
        raise PdfFieldDetectionError(
            f"{filename}: could not be parsed (malformed or encrypted PDF)"
        ) from exc

    tmp_in = tempfile.NamedTemporaryFile(suffix=".pdf", delete=False)
    tmp_out_path = tmp_in.name + ".out.pdf"
    try:
        tmp_in.write(raw_bytes)
        tmp_in.flush()
        tmp_in.close()

        try:
            commonforms.prepare_form(
                tmp_in.name,
                tmp_out_path,
                model_or_path=model_or_path,
                device=device,
                fast=fast,
            )
        except EncryptedPdfError as exc:
            raise PdfFieldDetectionError(
                f"{filename}: could not be rendered for field detection "
                "(malformed or encrypted PDF)"
            ) from exc

        with open(tmp_out_path, "rb") as fillable_file:
            fillable_pdf_bytes = fillable_file.read()

        reader = PdfReader(io.BytesIO(fillable_pdf_bytes))
        fields: list[PdfDetectedField] = []
        sequence = 0
        for page_number, page in enumerate(reader.pages):
            annotations = page.get("/Annots") or []
            page_height = page_heights[page_number] if page_number < len(page_heights) else float(
                page.mediabox.height
            )
            words = page_words[page_number] if page_number < len(page_words) else []

            for annotation in annotations:
                obj = annotation.get_object()
                if obj.get("/Subtype") != "/Widget":
                    continue

                acroform_type = obj.get("/FT")
                if acroform_type not in ("/Tx", "/Btn"):
                    logger.warning(
                        "%s: skipping widget %r with unexpected /FT %r",
                        filename,
                        obj.get("/T"),
                        acroform_type,
                    )
                    continue

                x0, y0, x1, y1 = (float(v) for v in obj["/Rect"])
                ftop = page_height - y1
                fbottom = page_height - y0
                question_text = _pair_label(x0, ftop, x1, fbottom, words)

                widget_kind = "TextBox" if acroform_type == "/Tx" else "ChoiceButton"
                fields.append(
                    PdfDetectedField(
                        field_name=str(obj.get("/T")),
                        widget_kind=widget_kind,
                        acroform_type=acroform_type,
                        page_number=page_number,
                        bbox=(x0, y0, x1, y1),
                        question_text=question_text,
                        sequence=sequence,
                    )
                )
                sequence += 1

        return PdfFieldDetectionResult(fields=fields, fillable_pdf_bytes=fillable_pdf_bytes)
    finally:
        for path in (tmp_in.name, tmp_out_path):
            try:
                os.unlink(path)
            except OSError:
                pass
