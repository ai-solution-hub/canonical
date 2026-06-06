"""PDF form extractor for ID-52 Path B (PRODUCT Inv-2).

Implements ``extract(raw_bytes, filename) -> ExtractedForm`` for blank
PDF forms using ``pdfplumber==0.11.9`` (pinned in ``requirements.txt``).

Design notes
------------

The extractor walks every page returned by ``pdfplumber.open(...)`` —
this is the PRODUCT Inv-15 container-artefact bypass: the SQ PDF's
container header reports 8 pages but its true content is 57 pages, and
``pdfplumber`` correctly reads the 57-page extent (verified in
``RESEARCH §2.1`` and corroborated locally on the corpus fixture).

For each page, two production patterns coexist in the corpus PDFs:

* **2-column ``[M|O, question]`` table** — Annex B Part 1 (PPN 03/24
  page 17 onwards). Left cell carries an explicit mandatory/optional
  flag (Inv-10 substrate).
* **2- or 3-column ``[number, question(, response)]`` table** — Section
  4/5/6/7 within Annex B (PPN 03/24 pages 41+). Left cell carries the
  question number; the row inherits the section's optional/mandatory
  status only when the form expresses it explicitly. The Inv-10
  invariant forbids inference from omission, so these rows carry
  ``is_mandatory=None``.

Section names are tracked across pages via a streaming context: when a
table or page header reads ``Section N`` or ``Annex X``, subsequent
fields inherit it until a new header arrives. Annex B's spanning
section is preserved as the dominant context (e.g. "Annex B - Section 6").

Reference URLs are harvested per-page from ``page.hyperlinks`` (the
PDF link annotations) and folded into the closest field on that page.

Word limits use the inline-token regex ``\\[(\\d+)\\]\\s*words?`` (the
SQ ``[500] words`` shape) with a fallback to ``(\\d+)\\s*words?``.

References:
- ``docs/specs/form-extraction/PRODUCT.md`` Inv-2, Inv-7..Inv-15, Inv-17.
- ``docs/specs/form-extraction/TECH.md`` §2.2 (Pydantic shape), §2.5a
  (mandatory-flag column substrate), §2.6 (Migration M1 columns).
- ``docs/specs/form-extraction/PLAN.md`` §{52.9} (acceptance criteria).
"""

from __future__ import annotations

import io
import re
from typing import Any

import pdfplumber

from scripts.cocoindex_pipeline.form_extractors.shared import (
    ExtractedField,
    ExtractedForm,
    FormExtractionError,
    FormMetadata,
)

__all__ = ["extract"]


# ──────────────────────────────────────────────────────────────────────────
# Regex bank (Inv-10 mandatory flag, Inv-11 word limit, Inv-12 section,
# Inv-14 reference URLs)
# ──────────────────────────────────────────────────────────────────────────

# Inline word-limit tokens — SQ uses ``[500] words`` inline in the
# question prose. The fallback covers ``500 words`` / ``maximum 500
# words`` / ``no more than 500 words`` for forms that don't bracket the
# numeric token.
_WORD_LIMIT_BRACKETED = re.compile(r"\[(\d{1,5})\]\s*words?", re.IGNORECASE)
_WORD_LIMIT_PLAIN = re.compile(
    r"(?:max(?:imum)?\.?\s+|no more than\s+|up to\s+)?(\d{1,5})\s+words?",
    re.IGNORECASE,
)

# Section / Annex header detector — applied per-page to text outside
# tables and to the first cell of each parsed table. Captures both the
# label and a short descriptor when present (e.g. "Section 4 Grounds
# for Discretionary Exclusion" → ``Section 4 — Grounds for
# Discretionary Exclusion``).
_SECTION_HEADER = re.compile(
    r"^(Section\s+\d+|Annex\s+[A-Z]|Part\s+\d+)\b[\s\-–—:]*(.*)$",
    re.IGNORECASE,
)

# Mandatory/optional left-cell flag — exact single-char ``M`` or ``O``
# (case-insensitive). The Inv-10 invariant pins this on the *explicit*
# left-cell content of the 2-column Annex B Part 1 schema.
_MO_FLAG = re.compile(r"^\s*([MO])\s*$", re.IGNORECASE)

# Question-number prefix (e.g. ``6.2``, ``7.2(a)``, ``4.1``). Stays
# distinct from M/O detection so the dispatcher never confuses a
# numbered row with an M/O row.
_QUESTION_NUMBER = re.compile(
    r"^\s*(\d+(?:\.\d+)*(?:\s*\([a-z]\))?)\s*$"
)

# URL pattern — for fallback URL discovery in raw text where
# ``page.hyperlinks`` annotations are not present.
_URL_PATTERN = re.compile(
    r"https?://[^\s\)\]\}]+", re.IGNORECASE
)

# Placeholder shapes recognised in response cells (Inv-9): ``[insert…]``,
# ``[enter…]``, ``[type…]``, ``[provide…]``, ``{{…}}``, ``<<…>>``,
# ``{ANSWER}``, lone ``n/a`` or dashes/ellipsis.
_PLACEHOLDER_PATTERNS = [
    re.compile(r"^\[\s*insert\b.*?\]$", re.IGNORECASE),
    re.compile(r"^\[\s*enter\b.*?\]$", re.IGNORECASE),
    re.compile(r"^\[\s*type\b.*?\]$", re.IGNORECASE),
    re.compile(r"^\[\s*provide\b.*?\]$", re.IGNORECASE),
    re.compile(r"^\{\{[^}]+\}\}$"),
    re.compile(r"^<<[A-Z_ ]+>>$"),
    re.compile(r"^\{[A-Z_]+\}$"),
    re.compile(r"^n/?a$", re.IGNORECASE),
    re.compile(r"^-+$"),
    re.compile(r"^\.{3,}$"),
]


# ──────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────


def _clean_cell(value: str | None) -> str:
    """Normalise cell text: collapse internal whitespace, strip ends."""
    if value is None:
        return ""
    # pdfplumber returns multi-line cell text joined by ``\n``. Preserve
    # them as single spaces so substring matches (e.g. ``"[500] words"``)
    # survive across the line wrap; collapse runs of whitespace.
    flat = re.sub(r"\s+", " ", value).strip()
    return flat


def _extract_word_limit(text: str) -> int | None:
    """Extract the first word-limit numeric from inline tokens (Inv-11).

    Prefers bracketed ``[NNN] words`` (the SQ form), then falls back to
    plain ``NNN words`` with the common modifiers ("max", "no more than"
    etc.). Returns None when no token appears.
    """
    bracket_match = _WORD_LIMIT_BRACKETED.search(text)
    if bracket_match:
        return int(bracket_match.group(1))
    plain_match = _WORD_LIMIT_PLAIN.search(text)
    if plain_match:
        return int(plain_match.group(1))
    return None


def _classify_section_header(text: str) -> str | None:
    """Return the section label if ``text`` is a section/annex header.

    Picks up the first line if ``text`` is multi-line. Returns the
    canonical form ``<Label> - <Descriptor>`` when a descriptor follows;
    otherwise just ``<Label>``.
    """
    first_line = text.split("\n", 1)[0].strip()
    match = _SECTION_HEADER.match(first_line)
    if not match:
        return None
    label = match.group(1).strip()
    descriptor = (match.group(2) or "").strip()
    if descriptor:
        return f"{label} - {descriptor}"
    return label


def _apply_header(state: dict[str, str | None], header: str) -> None:
    """Update the hierarchical section state from a header label.

    ``Annex X …`` replaces the dominant container AND resets the inner
    section (each Annex starts a fresh sub-section walk). ``Section N
    …`` / ``Part N …`` only updates the inner level so a question in
    ``Annex B → Section 6`` retains both labels in the recorded
    ``section_name``.
    """
    label_first = header.split(" ", 1)[0].lower()
    if label_first == "annex":
        state["annex"] = header
        state["inner"] = None
    else:
        state["inner"] = header


def _compose_section(state: dict[str, str | None]) -> str | None:
    """Compose the hierarchical section path from the state dict."""
    parts = [p for p in (state.get("annex"), state.get("inner")) if p]
    return " / ".join(parts) if parts else None


def _classify_mo_flag(cell: str) -> bool | None:
    """Classify a 2-column left-cell as an M/O flag.

    Returns ``True`` for ``M``, ``False`` for ``O``, ``None`` when the
    cell is neither (e.g. a question number, free prose, blank).
    """
    match = _MO_FLAG.match(cell)
    if not match:
        return None
    flag = match.group(1).upper()
    return flag == "M"


def _is_question_number(cell: str) -> bool:
    """True when the cell is a bare question-number token (``6.2``,
    ``7.2(a)`` etc.)."""
    return bool(_QUESTION_NUMBER.match(cell))


def _is_placeholder(text: str) -> tuple[bool, str | None]:
    """Detect placeholder scaffolding in a response cell (Inv-9).

    Returns ``(True, text)`` if the cell carries placeholder text;
    ``(False, None)`` otherwise. Shapes covered: ``_PLACEHOLDER_PATTERNS``.
    """
    stripped = text.strip()
    if not stripped:
        return False, None
    for pattern in _PLACEHOLDER_PATTERNS:
        if pattern.fullmatch(stripped):
            return True, stripped
    return False, None


def _collect_page_hyperlinks(page: Any) -> list[str]:
    """Harvest URL targets from a pdfplumber page's link annotations.

    Falls back gracefully when ``page.hyperlinks`` is absent or the URI
    extraction shape differs across pdfplumber minor versions.
    """
    urls: list[str] = []
    raw = getattr(page, "hyperlinks", None) or []
    for link in raw:
        if isinstance(link, dict):
            uri = link.get("uri") or link.get("URI")
            if isinstance(uri, str) and uri.startswith(("http://", "https://")):
                urls.append(uri)
    return urls


def _detect_form_title(pdf: pdfplumber.PDF) -> str | None:
    """Read the form's human-readable title from page 1's largest text.

    Uses the PDF document info ``/Title`` field when present; otherwise
    falls back to the first non-empty line of page 1.
    """
    info = getattr(pdf, "metadata", None) or {}
    title = info.get("Title") or info.get("title")
    if isinstance(title, str) and title.strip():
        return title.strip()
    if pdf.pages:
        text = pdf.pages[0].extract_text() or ""
        for line in text.split("\n"):
            stripped = line.strip()
            if stripped:
                return stripped
    return None


# ──────────────────────────────────────────────────────────────────────────
# Table-row → ExtractedField mapping
# ──────────────────────────────────────────────────────────────────────────


def _row_to_field(
    row: list[str | None],
    *,
    row_index: int,
    table_index: int,
    section_name: str | None,
    sequence: int,
    page_urls: list[str],
) -> ExtractedField | None:
    """Convert a parsed table row into one ``ExtractedField``.

    Returns None when the row is structurally empty (no usable cells).
    Schemas recognised:

    * ``[M|O, question]`` — Annex B Part 1 style → ``is_mandatory``
      filled from the left cell (Inv-10).
    * ``[number, question]`` or ``[number, question, response]`` —
      Section 4/5/6/7 style → ``question_text`` = right cell;
      ``is_mandatory`` is None (no flag column in the row); the
      response cell determines ``field_type`` / ``placeholder_text``.
    * Single-cell or blank-first-cell rows are skipped (they are
      continuations of the previous logical row, already captured).
    """
    cells = [_clean_cell(c) for c in row]
    if not any(cells):
        return None

    # Find the first non-empty cell — pdfplumber sometimes pads tables
    # with leading blank cells when rows wrap across page boundaries.
    first_idx = next((i for i, c in enumerate(cells) if c), None)
    if first_idx is None:
        return None
    first_cell = cells[first_idx]

    # ── Schema 1: ``[M|O, question]`` ──
    mo_flag = _classify_mo_flag(first_cell)
    if mo_flag is not None and first_idx + 1 < len(cells) and cells[first_idx + 1]:
        question = cells[first_idx + 1]
        return ExtractedField(
            question_text=question,
            field_type="empty_cell",
            fill_status="pending",
            row_index=row_index,
            col_index=first_idx + 1,
            table_index=table_index,
            section_name=section_name,
            sequence=sequence,
            word_limit=_extract_word_limit(question),
            is_mandatory=mo_flag,
            reference_urls=list(page_urls),
        )

    # ── Schema 2: ``[number, question(, response)]`` ──
    if _is_question_number(first_cell) and first_idx + 1 < len(cells):
        question = cells[first_idx + 1]
        if not question:
            return None
        response_cell = (
            cells[first_idx + 2] if first_idx + 2 < len(cells) else ""
        )
        is_placeholder_cell, placeholder_text = _is_placeholder(response_cell)
        if is_placeholder_cell:
            field_type = "placeholder"
        else:
            field_type = "empty_cell"
        # Inv-9 — keep authored question even when answer cell is blank.
        # Inv-10 — no M/O flag column on this schema; ``is_mandatory``
        # stays None (never inferred from omission).
        return ExtractedField(
            question_text=question,
            placeholder_text=placeholder_text if is_placeholder_cell else None,
            field_type=field_type,
            fill_status="pending",
            row_index=row_index,
            col_index=first_idx + 1,
            table_index=table_index,
            section_name=section_name,
            sequence=sequence,
            word_limit=_extract_word_limit(question),
            is_mandatory=None,
            reference_urls=list(page_urls),
        )

    # ── Anything else (single cell, free-text wrap, header label) ──
    # Skipped here — header labels are handled by ``_classify_section_header``
    # on the table's first cell before we iterate rows; wraps are
    # already folded into the prior row by pdfplumber's table extractor.
    return None


# ──────────────────────────────────────────────────────────────────────────
# Public entry point
# ──────────────────────────────────────────────────────────────────────────


async def extract(raw_bytes: bytes, filename: str) -> ExtractedForm:
    """Extract structured fields from a blank PDF form.

    Args:
        raw_bytes: The PDF file's bytes (read by the caller from the
            ingest source).
        filename: The file's name/path relative to the ingest source.
            Passed through into ``FormExtractionError.rel_path`` and
            into ``FormMetadata.form_title`` as a fallback when the PDF
            carries no document-info title.

    Returns:
        An ``ExtractedForm`` carrying the form-level metadata + per-field
        rows in reading order.

    Raises:
        FormExtractionError: When the PDF cannot be opened or contains
            zero pages of readable content (Inv-17 — never silently
            returns an empty ``ExtractedForm``).
    """
    if not raw_bytes:
        raise FormExtractionError(
            reason="empty_pdf",
            rel_path=filename,
            details="received zero bytes",
        )

    try:
        pdf_handle = pdfplumber.open(io.BytesIO(raw_bytes))
    except Exception as exc:  # noqa: BLE001 — pdfplumber raises generic types
        raise FormExtractionError(
            reason="corrupt_pdf",
            rel_path=filename,
            details=str(exc),
        ) from exc

    fields: list[ExtractedField] = []
    sequence = 0
    # Section context is hierarchical: track the dominant container
    # (``Annex X`` — pages-spanning) separately from the active inner
    # section (``Section N`` / ``Part N``) so a question in
    # ``Annex B → Section 6`` records its full section path rather than
    # losing the Annex context the moment a Section header lands. Per
    # PRODUCT Inv-12, the recorded ``section_name`` should be the
    # composite "the section it belongs to" (e.g. ``Annex B / Section 6
    # - Technical and Professional Ability``), not just the innermost
    # label.
    section_state: dict[str, str | None] = {"annex": None, "inner": None}

    with pdf_handle as pdf:
        if not pdf.pages:
            raise FormExtractionError(
                reason="empty_pdf",
                rel_path=filename,
                details="pdfplumber reported zero pages",
            )

        form_title = _detect_form_title(pdf)

        for page_index, page in enumerate(pdf.pages):
            page_text = page.extract_text() or ""
            page_urls = _collect_page_hyperlinks(page)

            # Fallback: harvest plain-text URLs when no hyperlink
            # annotations were attached (some PDFs render the URL as
            # text without an annotation).
            for url_match in _URL_PATTERN.finditer(page_text):
                url = url_match.group(0).rstrip(".,;:")
                if url not in page_urls:
                    page_urls.append(url)

            # Update section context from the page's first heading line
            # — handles cover pages and pages whose tables don't carry
            # the section label in the first row.
            for line in page_text.split("\n")[:6]:
                header = _classify_section_header(line)
                if header:
                    _apply_header(section_state, header)
                    break

            try:
                tables = page.extract_tables() or []
            except Exception:  # noqa: BLE001
                # A single page failing to parse must NOT corrupt the
                # whole form (Inv-17 batch safety) — skip the page and
                # continue. The page's free-text fallback still applies.
                tables = []

            page_emitted = 0
            for table_index, table in enumerate(tables):
                if not table:
                    continue

                # Header-row detection: if the first row reads
                # ``Section N …`` / ``Annex X …`` / ``Part N …``, update
                # the section context but do not emit it as a field.
                first_row = [_clean_cell(c) for c in table[0]]
                if first_row:
                    composite = " ".join(c for c in first_row if c)
                    header = _classify_section_header(composite)
                    if header:
                        _apply_header(section_state, header)
                        start_row = 1
                    else:
                        start_row = 0
                else:
                    start_row = 0

                for row_index, row in enumerate(table[start_row:], start=start_row):
                    field = _row_to_field(
                        row,
                        row_index=row_index,
                        table_index=table_index,
                        section_name=_compose_section(section_state),
                        sequence=sequence,
                        page_urls=page_urls,
                    )
                    if field is not None:
                        fields.append(field)
                        sequence += 1
                        page_emitted += 1

            # Inv-9 — fall back to free-prose extraction for pages whose
            # table parser found nothing. Annex B Part 1's M/O rows are
            # often parsed as table rows, but the SQ PDF page 17 mixes
            # table rows with prose pre-amble: catch loose ``M`` /
            # ``O`` flag rows in the raw text when the table extractor
            # missed them.
            if page_emitted == 0 and page_text.strip():
                fields_emitted, sequence = _emit_freeprose_fields(
                    page_text=page_text,
                    sequence=sequence,
                    section_name=_compose_section(section_state),
                    page_urls=page_urls,
                )
                fields.extend(fields_emitted)

    metadata = FormMetadata(
        form_type="questionnaire",
        form_format="pdf",
        form_title=form_title or filename,
    )
    return ExtractedForm(form_metadata=metadata, fields=fields)


def _emit_freeprose_fields(
    *,
    page_text: str,
    sequence: int,
    section_name: str | None,
    page_urls: list[str],
) -> tuple[list[ExtractedField], int]:
    """Catch M/O-flagged prose rows the table extractor missed.

    The SQ PDF page 17 (Annex B Part 1 preamble) renders some M-flagged
    rows as text where pdfplumber's table extractor returns a single
    cell. We re-scan for lines that start with a lone ``M`` or ``O``
    and the next non-empty line as the question prose.
    """
    emitted: list[ExtractedField] = []
    lines = [ln.strip() for ln in page_text.split("\n")]
    i = 0
    while i < len(lines):
        line = lines[i]
        mo = _classify_mo_flag(line)
        if mo is not None:
            # Look ahead for question prose: aggregate subsequent
            # non-empty lines until the next M/O flag or blank gap.
            j = i + 1
            buffer: list[str] = []
            while j < len(lines):
                nxt = lines[j]
                if not nxt:
                    if buffer:
                        break
                    j += 1
                    continue
                if _classify_mo_flag(nxt) is not None:
                    break
                buffer.append(nxt)
                j += 1
            question = " ".join(buffer).strip()
            if question:
                emitted.append(
                    ExtractedField(
                        question_text=question,
                        field_type="empty_cell",
                        fill_status="pending",
                        section_name=section_name,
                        sequence=sequence,
                        word_limit=_extract_word_limit(question),
                        is_mandatory=mo,
                        reference_urls=list(page_urls),
                    )
                )
                sequence += 1
            i = j
        else:
            i += 1
    return emitted, sequence
