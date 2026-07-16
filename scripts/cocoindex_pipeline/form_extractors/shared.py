"""Shared Pydantic shapes + typed errors for ID-52 form extractors.

Hosts:
  - ``ExtractedField`` — one row destined for ``form_template_fields``
    (PRODUCT Inv-8 coordinates, Inv-9 placeholder-vs-authored, Inv-10
    mandatory flag, Inv-11 word limit, Inv-12 section + sequence, Inv-14
    reference URLs).
  - ``ExtractedForm`` — wrapper carrying ``FormMetadata`` (form-level
    Inv-7) + the per-field rows.
  - ``FormExtractionError`` — typed exception for unrecoverable read
    failures (Inv-17 — never silently return an empty ``ExtractedForm``).

Reuses ``FormMetadata`` from ``extraction.py``: the form-type CV
validator + ``model_config(strict=True, extra="forbid")`` discipline
declared there is the single source of truth for form-level metadata.

References:
- ``docs/specs/form-extraction/TECH.md`` §2.2 (Pydantic shape) +
  §2.5a + §2.6 (M1 schema-mapping: ``is_mandatory`` + ``reference_urls``
  columns).
- ``docs/specs/form-extraction/PRODUCT.md`` Inv-8, Inv-9, Inv-10, Inv-11,
  Inv-12, Inv-14, Inv-17.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from scripts.cocoindex_pipeline.extraction import FormMetadata

__all__ = [
    "ExtractedField",
    "ExtractedForm",
    "FormExtractionError",
    "FormMetadata",
]


class ExtractedField(BaseModel):
    """One field row destined for ``form_template_fields``.

    Maps 1:1 to ``form_template_fields`` columns added by Migration M1
    (TECH §2.6) — ``is_mandatory`` (Inv-10) and ``reference_urls`` (Inv-14)
    are the freshly-added substrate; the rest predate Path B.
    """

    model_config = ConfigDict(strict=True, extra="forbid")

    # Inv-9 — placeholder-vs-authored distinction.
    # - Authored question: ``question_text`` carries verbatim prose,
    #   ``placeholder_text`` is None.
    # - Unfilled placeholder cell: ``placeholder_text`` carries the
    #   placeholder string, ``question_text`` is None.
    question_text: str | None = None
    placeholder_text: str | None = None

    # ``field_type`` distinguishes how the field surfaced in the source:
    # - ``empty_cell`` — an answer slot with no content (default for
    #   authored questions whose response cell is blank).
    # - ``placeholder`` — the cell carries placeholder scaffolding
    #   (``[Insert…]``, ``{{…}}`` etc.) rather than authored prose.
    # - ``highlighted`` — colour/highlight marker on the cell (DOCX has
    #   richer detection here; PDF reader leaves it ``empty_cell``).
    field_type: Literal["empty_cell", "placeholder", "highlighted"]

    # ``fill_status`` always starts at ``pending`` for blank forms — the
    # downstream Catalogue / Mode-1 flows transition it through filled /
    # skipped / failed. Kept here so the shape matches the persisted row.
    fill_status: Literal["pending", "filled", "skipped", "failed"]

    # Inv-8 — coordinates: leave empty for regions where coordinates do
    # not meaningfully apply (PDF prose, free-text outside tables).
    row_index: int | None = None
    col_index: int | None = None
    table_index: int | None = None

    # Inv-12 — section hierarchy + reading-order sequence within the form.
    section_name: str | None = None
    sequence: int

    # Inv-11 — word limit captured whether inline (``[500] words``) or
    # column-cell (``Page Limit``); None when the form expresses none.
    word_limit: int | None = None

    # Inv-10 — mandatory/optional flag captured ONLY when the form
    # expresses it explicitly. None = the form expressed no such status
    # (never inferred from section context, never defaulted).
    is_mandatory: bool | None = None

    # Inv-14 — external reference URLs preserved per question / section.
    reference_urls: list[str] = Field(default_factory=list)

    # ID-147 {147.9} (TECH §3, DR-064 Option A; PRODUCT §C1/§C4) —
    # DISPLAYED (post-rotation) top-left page-fraction geometry, carried
    # through unchanged from PdfDetectedField.geometry for PDF-sourced
    # fields (see pdf.py's _normalise_geometry). None for DOCX/XLSX
    # fields (no spatial geometry there) and for any PDF field whose
    # page rotation could not be normalised — §C4 degrade: the UI lists
    # the slot without a spatial overlay, never draws a misaligned box.
    geometry: dict[str, float | int] | None = None


class ExtractedForm(BaseModel):
    """Wrapper carrying form-level metadata + per-field rows.

    ``form_metadata`` reuses the existing ``FormMetadata`` declared in
    ``extraction.py`` (Inv-7); the per-format readers populate
    ``form_format``, ``form_type``, ``form_title``, ``issuing_organisation``,
    and ``deadline`` where the source form expresses them.
    """

    model_config = ConfigDict(strict=True, extra="forbid")

    form_metadata: FormMetadata
    fields: list[ExtractedField] = Field(default_factory=list)


class FormExtractionError(Exception):
    """Typed extraction failure (PRODUCT Inv-17).

    Raised by per-format readers when the form cannot be parsed at all
    (corrupt bytes, unreadable structure, format mismatch). Carries the
    relative path of the offending file plus a machine-readable reason
    so the caller can surface the failure as a stage error and record
    zero ``form_template_fields`` rows — rather than silently returning
    an empty ``ExtractedForm`` and writing an instance row with no fields.

    Args:
        reason: Short machine-readable token (``corrupt_pdf``,
            ``unreadable_xlsx``, ``wrong_format`` etc.) used by the
            stage-error log mapping in ``flow.py``.
        rel_path: The form file's repo-/ingest-relative path so the
            stage-error row can be correlated with the source file.
        details: Optional free-form context (the underlying exception
            message, the affected page index, etc.).
    """

    def __init__(
        self,
        reason: str,
        rel_path: str,
        details: str | None = None,
    ) -> None:
        self.reason = reason
        self.rel_path = rel_path
        self.details = details
        message = f"{reason} (file={rel_path})"
        if details:
            message = f"{message}: {details}"
        super().__init__(message)
