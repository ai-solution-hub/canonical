"""DOCX form extractor for ID-52 Path B (PRODUCT Inv-2).

Implements ``extract(raw_bytes, filename) -> ExtractedForm`` for blank
DOCX forms by reusing the existing prior-art helpers in
``scripts/extract_tender_questions.py`` (header classification) and
``scripts/analyse_template.py`` (placeholder + merged-cell + section
detection). This module is a thin orchestration wrapper over those
helpers — see TECH §2.2 "Reuse of existing DOCX prior art" (line 246) and
PLAN §{52.11} (line 392).

Design notes
------------

The wrapper walks ``doc.element.body`` in document order to preserve
reading-order ``sequence`` numbers across both paragraph and table
content (PRODUCT Inv-12 + Inv-8 "paras AND tables"). Heading-styled
paragraphs (``w:pStyle val="Heading*"``) update the running section
context — the same Streaming-section approach as
``_extract_tender_questions_from_doc`` and
``_extract_section_headings``, but inlined here so a single body walk
records BOTH paragraph fields AND table fields with their correct
section name.

Two table shapes are supported:

* **Authored Q/A table** — header row contains a ``question`` /
  ``answer`` column pair (classified via the reused
  ``_classify_header``). Authored questions whose answer cell is empty
  or carries a placeholder pattern (``[Insert…]``, ``{{…}}``,
  ``<<…>>``, ``n/a``, dash/ellipsis sentinels) emit as
  ``field_type='empty_cell'`` / ``'placeholder'`` with
  ``question_text`` populated (Inv-9 authored-with-empty-response
  preservation).
* **Placeholder grid** — every cell in the first column is a placeholder
  pattern (e.g. the Charnwood "Insert question title" / "Insert %" grid
  on table 3). Each row emits as ``field_type='placeholder'``,
  ``placeholder_text`` = the placeholder cell text, ``question_text=None``
  (Inv-9 placeholder-vs-authored distinction).

Paragraph fields catch the prose-level placeholders the table walker
cannot reach (e.g. ``E-Mail: [Insert departmental email address]`` in
the document header). Each placeholder match in a paragraph emits one
``ExtractedField`` carrying the full paragraph as ``question_text`` and
the matched placeholder span as ``placeholder_text`` so the downstream
filler can hold both the surrounding prose and the slot to fill.

Track-changes resolution is delegated to ``open_document_safe`` from
``scripts/docx_utils.py`` (pandoc-backed when available, otherwise
warning + raw open). The Charnwood corpus DOCX has unaccepted
revisions, so this path is exercised on the acceptance fixture.

References:
- ``docs/specs/id-52-form-extraction/PRODUCT.md`` Inv-2, Inv-8, Inv-9,
  Inv-11, Inv-12, Inv-17.
- ``docs/specs/id-52-form-extraction/TECH.md`` §2.2 (Pydantic shape +
  reuse note line 246), §2.6 (Migration M1 columns).
- ``docs/specs/id-52-form-extraction/PLAN.md`` §{52.11} (acceptance
  criteria).
- Prior art (imports only — never edited):
  ``scripts/extract_tender_questions.py`` (``_classify_header``).
  Header classification reuses ``_classify_header``, which internally
  encapsulates the ``_QUESTION_HEADERS`` set — that set is NOT imported
  here directly; it is reached only transitively through
  ``_classify_header``.
  ``scripts/analyse_template.py``
  (``PLACEHOLDER_PATTERNS``, ``_detect_merged_cells``,
  ``_extract_word_limit``).
  ``scripts/docx_utils.py`` (``open_document_safe``).
"""

from __future__ import annotations

import os
import re
import tempfile

from docx import Document

# Prior-art helpers live at ``scripts/analyse_template.py`` and
# ``scripts/extract_tender_questions.py`` (module-level scripts) and
# ``scripts/docx_utils.py``. Post-{67.2} the pipeline runs under the canonical
# path with ``scripts`` as a PEP 420 namespace package, so we import them as
# ``scripts.*`` packages directly — no ``sys.path`` manipulation required.
from scripts.analyse_template import (
    PLACEHOLDER_PATTERNS,
    _detect_merged_cells,
    _extract_word_limit,
)
from scripts.docx_utils import open_document_safe
from scripts.extract_tender_questions import _classify_header

from scripts.cocoindex_pipeline.form_extractors.shared import (
    ExtractedField,
    ExtractedForm,
    FormExtractionError,
    FormMetadata,
)

__all__ = ["extract"]


# ──────────────────────────────────────────────────────────────────────────
# OOXML namespace constants — matched against ``element.tag`` on body
# children. ``element.tag`` is a Clark notation string like
# ``"{http://schemas.openxmlformats.org/wordprocessingml/2006/main}p"``,
# stripped to local-name on dispatch (same convention used by the prior
# art).
# ──────────────────────────────────────────────────────────────────────────
_W_NS = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


# Inline placeholder spans inside paragraph prose. The full-cell
# ``PLACEHOLDER_PATTERNS`` set imported from ``analyse_template.py`` is
# anchored (``fullmatch``-style) — for paragraph prose we need partial
# spans, so a lighter ``search``-mode regex set captures the common
# brackets, braces, and angle markers without re-deriving the rules.
_INLINE_PLACEHOLDER = re.compile(
    r"(?:"
    r"\[\s*(?:insert|enter|provide|please|your|type|response)\b[^\]]*\]"  # bracketed
    r"|\{\{[^}]+\}\}"                                                       # mustache
    r"|<<[A-Z_ ]+>>"                                                        # angle
    r"|\{[A-Z_]+\}"                                                         # brace
    r")",
    re.IGNORECASE,
)

# Bare-instruction placeholder (no brackets). Used ONLY by the
# placeholder-grid heuristic (``_is_placeholder_grid``) — the
# Charnwood corpus table 3 uses bare ``Insert question title`` /
# ``Insert %`` cells rather than the bracketed ``[Insert …]`` shape
# the prior-art ``PLACEHOLDER_PATTERNS`` was tuned for. Restricting
# this match to the grid-detection pathway keeps the bracketed-cell
# semantics of the prior art unchanged for authored Q/A tables.
_BARE_INSTRUCTION_PLACEHOLDER = re.compile(
    r"^\s*(?:insert|enter|provide|please|type|your)\b[^\n]*$",
    re.IGNORECASE,
)


def _local_tag(element: object) -> str:
    """Return the local-name of an OOXML element's tag.

    ``element.tag`` is a Clark-notation string; the prior art at
    ``analyse_template.py:_extract_section_headings`` and
    ``extract_tender_questions.py:_extract_tender_questions_from_doc``
    both rely on the trailing ``}local-name`` split.
    """
    tag = getattr(element, "tag", "")
    if isinstance(tag, str) and "}" in tag:
        return tag.split("}", 1)[1]
    return tag if isinstance(tag, str) else ""


def _heading_text(element: object) -> str | None:
    """Return the heading-text if the paragraph element is heading-styled.

    Matches the prior-art approach (``_extract_section_headings``): only
    treat the paragraph as a section header when its ``w:pStyle`` value
    begins with ``Heading``. Uses ``w:t`` text nodes only (rather than
    ``itertext()``) so nested run / text nodes do not duplicate the
    heading text.
    """
    if not hasattr(element, "find") or not hasattr(element, "findall"):
        return None
    style = element.find(f".//{_W_NS}pStyle")
    if style is None:
        return None
    style_val = style.get(f"{_W_NS}val", "")
    if not style_val.startswith("Heading"):
        return None
    text_nodes = element.findall(f".//{_W_NS}t")
    text = "".join(t.text for t in text_nodes if t.text).strip()
    return text or None


def _paragraph_text(element: object) -> str:
    """Return the plain text content of a paragraph element (``w:p``)."""
    if not hasattr(element, "findall"):
        return ""
    text_nodes = element.findall(f".//{_W_NS}t")
    return "".join(t.text for t in text_nodes if t.text).strip()


def _cell_text(cell: object) -> str:
    """Read a table cell as plain text via ``w:t`` text nodes.

    Production-behaviour note (escalated in subtask journal):
    pandoc's track-changes resolver wraps hyperlinked cell text in
    nested ``<w:hyperlink>`` elements; python-docx's
    ``Paragraph.text`` only traverses direct ``w:r`` children, so the
    prior-art ``_cell_text`` (in both
    ``extract_tender_questions.py`` and ``analyse_template.py``)
    returns an empty string for the Charnwood "Insert question title"
    grid on table 3 (verified against the pandoc-cleaned tree).

    To honour PLAN §{52.11}'s "NO changes to
    extract_tender_questions.py or analyse_template.py" constraint
    while still surfacing the placeholder grid, this wrapper-internal
    cell reader walks ``cell._tc`` for all ``w:t`` text nodes — the
    same approach the prior-art ``_extract_section_headings`` uses
    on heading paragraphs. The original ``p.text`` join is kept as
    the fallback so cells whose text IS in direct runs (the common
    shape pre-pandoc) read identically.
    """
    paragraphs = [
        p.text.strip() for p in getattr(cell, "paragraphs", []) if p.text.strip()
    ]
    via_paragraphs = "\n".join(paragraphs)
    if via_paragraphs:
        return via_paragraphs
    tc = getattr(cell, "_tc", None)
    if tc is None or not hasattr(tc, "findall"):
        return ""
    text_nodes = tc.findall(f".//{_W_NS}t")
    text = "".join(t.text for t in text_nodes if t.text).strip()
    return text


def _is_cell_placeholder(cell: object) -> tuple[bool, str | None]:
    """Placeholder-or-empty detector that survives pandoc hyperlink wraps.

    PLAN §{52.11} folds the prior-art ``PLACEHOLDER_PATTERNS`` set in
    as-is. The prior-art ``_is_empty_or_placeholder`` couples the
    placeholder regex sweep to the ``p.text``-based cell reader, which
    misses hyperlink-wrapped runs — so this wrapper-internal copy
    reads the cell via the robust ``_cell_text`` above and then
    applies the imported ``PLACEHOLDER_PATTERNS`` set unchanged.
    """
    text = _cell_text(cell).strip()
    if not text:
        return True, None
    for pattern in PLACEHOLDER_PATTERNS:
        if pattern.fullmatch(text):
            return True, text
    return False, None


def _grid_cell_placeholder(cell: object) -> tuple[bool, str | None]:
    """Placeholder detection for the placeholder-grid heuristic.

    Combines the bracketed-cell PLACEHOLDER_PATTERNS (folded in
    as-is per PLAN §{52.11}) with the bare-instruction sentinel —
    used ONLY by ``_is_placeholder_grid`` and the placeholder-grid
    emit path so authored Q/A tables keep the prior-art bracketed
    semantics.
    """
    is_ph, ph_text = _is_cell_placeholder(cell)
    if is_ph:
        return True, ph_text
    text = _cell_text(cell).strip()
    if text and _BARE_INSTRUCTION_PLACEHOLDER.fullmatch(text):
        return True, text
    return False, None


def _is_placeholder_grid(rows: list[object]) -> bool:
    """True when the table's first column is uniformly placeholder text.

    Catches the Charnwood "Insert question title" / "Insert %" grid
    (table 3 of the acceptance fixture): every data row's first cell
    matches a placeholder pattern, so there is no authored question to
    extract — the rows themselves ARE the placeholders.
    """
    if not rows:
        return False
    # Examine all rows (no header skip — placeholder grids do not carry
    # a labelled header row in the Charnwood corpus).
    placeholder_count = 0
    data_count = 0
    for row in rows:
        cells = list(getattr(row, "cells", []) or [])
        if not cells:
            continue
        first = cells[0]
        text = _cell_text(first).strip()
        if not text:
            continue
        data_count += 1
        is_ph, _ = _grid_cell_placeholder(first)
        if is_ph:
            placeholder_count += 1
    return data_count >= 2 and placeholder_count == data_count


# ──────────────────────────────────────────────────────────────────────────
# Generic (DR-058) detection primitives — the shape-3 fallback below layers
# these UNDER shapes 1/2 (TECH §3.2 / FORM-EXTRACTION-SPIKE §5): "any table
# row where a labelled/prose cell is followed by an empty-or-placeholder
# cell -> a field (drop _classify_header as the ONLY path)". Kept separate
# from the narrower archetype patterns above (PLACEHOLDER_PATTERNS,
# _BARE_INSTRUCTION_PLACEHOLDER) so shapes 1/2's behaviour on the
# in-corpus fixtures is provably unchanged — shape 3 never runs on a table
# shapes 1/2 already claimed.
# ──────────────────────────────────────────────────────────────────────────

# A whole-cell bracketed label — e.g. ``[Name]``, ``[Tel]``, ``[Job title]``.
# Broader than the archetype ``PLACEHOLDER_PATTERNS`` (which requires an
# ``insert/enter/provide/...`` instruction verb inside the brackets): any
# short bracket-wrapped token is itself a fill-in-the-blank slot (measured
# on the Charnwood buyer-contact block, table[0] — TestCharnwoodPerTable's
# prior "legit-zero" ruling for that shape is what this generalises past).
_GENERIC_BRACKET_LABEL = re.compile(r"^\[[^\[\]\n]{1,80}\]$")

# Short non-prose "answer slot" markers that are not empty text but are not
# authored content either — checkbox glyphs, a bare currency symbol. Treated
# as answer-shaped alongside true emptiness and the archetype placeholder
# patterns.
_GENERIC_ANSWER_MARKER = re.compile(r"^[□☐○❑❒£$€o]{1,2}$")

# Minimum character length for a cell to count as a "labelled/prose" side of
# a generic pair — guards against a bare short token (a stray "-", a lone
# digit, or a 2-letter column header like "ID" next to a spacer column)
# masquerading as a question label.
_GENERIC_LABEL_MIN_LEN = 3

# A cell's LAST paragraph reading as a response-prompt label — e.g.
# "Supplier Response:", "Your Answer", "Bidder's Reply:". Used by
# ``_cell_internal_trailing_blank`` for the PANDOC-CLEANED shape (below):
# ``open_document_safe``'s pandoc track-changes resolution strips genuinely
# blank paragraphs, so a cell that originally held prose + several blank
# paragraphs after a "Supplier Response:" label survives cleaning as prose
# paragraphs ending in that label, with NO blank paragraph left to detect.
_TRAILING_RESPONSE_LABEL = re.compile(
    r"^(?:your |supplier'?s? |bidder'?s? |tenderer'?s? |contractor'?s? )?"
    r"(?:response|answer|reply)s?\s*:?\s*$",
    re.IGNORECASE,
)


def _is_generic_answer_shaped(cell: object) -> bool:
    """True when a cell reads as an unfilled answer slot for shape 3.

    Broader than ``_is_cell_placeholder``: empty text, the archetype
    placeholder patterns/bare-instruction sentinel, OR a short non-prose
    marker glyph (checkbox / currency symbol).
    """
    text = _cell_text(cell).strip()
    if not text:
        return True
    is_ph, _ = _grid_cell_placeholder(cell)
    if is_ph:
        return True
    return bool(_GENERIC_ANSWER_MARKER.fullmatch(text))


def _cell_internal_trailing_blank(
    cell: object,
) -> tuple[str, int | None] | None:
    """Detect a single cell whose prose is followed by an in-cell answer
    slot — the answer lives INSIDE the cell, not a sibling cell.

    Matches the British Council ``annex_2`` supplier-response shape: one
    cell holds the requirement prose + a "Supplier Response:" label,
    followed by the space the bidder types into. Two sub-shapes, tried in
    order:

    1. Trailing BLANK paragraphs (the raw, un-cleaned document shape).
    2. A trailing RESPONSE-LABEL paragraph with nothing after it — the
       shape that SURVIVES pandoc's track-changes cleaning, which strips
       genuinely empty paragraphs (``open_document_safe`` — measured:
       annex_2 has tracked changes, so every real read of it goes through
       this path, not sub-shape 1).

    Returns ``(question_text, word_limit)`` when either shape is present,
    else ``None``.
    """
    paragraphs = [p.text for p in getattr(cell, "paragraphs", []) or []]
    if len(paragraphs) < 2:
        return None

    trailing_blank = 0
    for text in reversed(paragraphs):
        if text.strip():
            break
        trailing_blank += 1

    if trailing_blank > 0:
        body = paragraphs[: len(paragraphs) - trailing_blank]
    else:
        last = paragraphs[-1].strip()
        if not _TRAILING_RESPONSE_LABEL.fullmatch(last):
            return None
        body = paragraphs[:-1]

    non_blank = [p.strip() for p in body if p.strip()]
    if not non_blank:
        return None
    joined = "\n".join(non_blank)
    if len(joined) < 15:
        # Too short to be genuine question prose (guards against a single
        # short label cell with an incidental blank continuation).
        return None
    return joined, _extract_word_limit(joined)


def _emit_generic_table_fields(
    *,
    rows: list[object],
    merged_cells: set[tuple[int, int]],
    table_index: int,
    sequence: int,
    section_name: str | None,
) -> tuple[list[ExtractedField], int]:
    """Shape 3 — generic label -> empty/placeholder-cell fallback (DR-058).

    Runs three sub-rules per table, in order, over cells not already
    claimed by an earlier rule (a ``consumed`` set guards against the same
    cell emitting twice):

    1. Standalone bracket-label cells (``[Name]``) — each is its own field.
    2. Adjacent same-row cell pairs where exactly one side is
       labelled/prose and the other is empty/placeholder/marker-shaped
       (bidirectional — the empty slot may sit to either side of the
       label, e.g. Charnwood table[6]'s ``| Name:`` declaration block).
    3. A single cell whose prose is followed by trailing blank paragraphs
       (the answer lives inside the cell — the ``annex_2`` shape).
    """
    emitted: list[ExtractedField] = []
    consumed: set[tuple[int, int]] = set()

    # ── Rule 1: standalone bracket-label cells ──
    for row_index, row in enumerate(rows):
        cells = list(getattr(row, "cells", []) or [])
        for col_index, cell in enumerate(cells):
            if (row_index, col_index) in merged_cells:
                continue
            text = _cell_text(cell).strip()
            if not text or not _GENERIC_BRACKET_LABEL.fullmatch(text):
                continue
            emitted.append(
                ExtractedField(
                    question_text=None,
                    placeholder_text=text,
                    field_type="placeholder",
                    fill_status="pending",
                    row_index=row_index,
                    col_index=col_index,
                    table_index=table_index,
                    section_name=section_name,
                    sequence=sequence,
                    word_limit=None,
                )
            )
            sequence += 1
            consumed.add((row_index, col_index))

    # ── Rule 2: adjacent label + empty/placeholder-shaped cell pair ──
    for row_index, row in enumerate(rows):
        cells = list(getattr(row, "cells", []) or [])
        for col_index in range(len(cells) - 1):
            left_pos = (row_index, col_index)
            right_pos = (row_index, col_index + 1)
            if left_pos in merged_cells or right_pos in merged_cells:
                continue
            if left_pos in consumed or right_pos in consumed:
                continue
            left_cell, right_cell = cells[col_index], cells[col_index + 1]
            left_answer = _is_generic_answer_shaped(left_cell)
            right_answer = _is_generic_answer_shaped(right_cell)
            if left_answer == right_answer:
                # Both sides blank (nothing to label with) or both sides
                # authored prose (a real Q/A pair belongs to shape 1, or
                # this is a header/reference row like Charnwood table[4]'s
                # scoring rubric — neither cell is an unfilled slot).
                continue
            label_cell, label_pos = (
                (right_cell, right_pos) if left_answer else (left_cell, left_pos)
            )
            answer_cell, answer_pos = (
                (left_cell, left_pos) if left_answer else (right_cell, right_pos)
            )
            label_text = _cell_text(label_cell).strip()
            if len(label_text) < _GENERIC_LABEL_MIN_LEN:
                continue
            is_ph, ph_text = _grid_cell_placeholder(answer_cell)
            field_type = "placeholder" if is_ph and ph_text else "empty_cell"
            emitted.append(
                ExtractedField(
                    question_text=label_text,
                    placeholder_text=ph_text if field_type == "placeholder" else None,
                    field_type=field_type,  # type: ignore[arg-type]
                    fill_status="pending",
                    row_index=row_index,
                    col_index=answer_pos[1],
                    table_index=table_index,
                    section_name=section_name,
                    sequence=sequence,
                    word_limit=_extract_word_limit(label_text),
                )
            )
            sequence += 1
            consumed.add(label_pos)
            consumed.add(answer_pos)

    # ── Rule 3: cell-internal trailing-blank-paragraphs (annex_2 shape) ──
    for row_index, row in enumerate(rows):
        cells = list(getattr(row, "cells", []) or [])
        for col_index, cell in enumerate(cells):
            pos = (row_index, col_index)
            if pos in merged_cells or pos in consumed:
                continue
            hit = _cell_internal_trailing_blank(cell)
            if hit is None:
                continue
            question_text, word_limit = hit
            emitted.append(
                ExtractedField(
                    question_text=question_text,
                    placeholder_text=None,
                    field_type="empty_cell",
                    fill_status="pending",
                    row_index=row_index,
                    col_index=col_index,
                    table_index=table_index,
                    section_name=section_name,
                    sequence=sequence,
                    word_limit=word_limit,
                )
            )
            sequence += 1
            consumed.add(pos)

    return emitted, sequence


# ──────────────────────────────────────────────────────────────────────────
# Field emitters
# ──────────────────────────────────────────────────────────────────────────


def _emit_paragraph_fields(
    *,
    text: str,
    sequence: int,
    section_name: str | None,
) -> tuple[list[ExtractedField], int]:
    """Yield placeholder fields detected inside paragraph prose.

    The Charnwood corpus header carries lines such as
    ``E-Mail: [Insert departmental email address]`` and prose like
    ``Tenders should be received […] [insert departmental name]`` —
    these are placeholder slots in authored prose, not table cells.
    Each inline match emits one ``ExtractedField`` so the downstream
    filler can hold both the surrounding prose (``question_text``) and
    the slot to fill (``placeholder_text``).
    """
    emitted: list[ExtractedField] = []
    if not text.strip():
        return emitted, sequence
    for match in _INLINE_PLACEHOLDER.finditer(text):
        placeholder_span = match.group(0).strip()
        if not placeholder_span:
            continue
        # PRODUCT Inv-9 nuance: an inline placeholder inside authored
        # prose is BOTH a placeholder AND part of an authored question.
        # We record the surrounding paragraph as ``question_text`` (so
        # the filler has context) and the placeholder span as
        # ``placeholder_text`` (so the slot is targetable). The
        # ``field_type`` is ``placeholder`` because the cell-equivalent
        # the filler renders against is the placeholder span.
        emitted.append(
            ExtractedField(
                question_text=text,
                placeholder_text=placeholder_span,
                field_type="placeholder",
                fill_status="pending",
                section_name=section_name,
                sequence=sequence,
                word_limit=_extract_word_limit(text),
            )
        )
        sequence += 1
    return emitted, sequence


def _emit_table_fields(
    *,
    table: object,
    table_index: int,
    sequence: int,
    section_name: str | None,
) -> tuple[list[ExtractedField], int]:
    """Walk one table; emit fields per the two recognised shapes.

    Header detection: the first row is parsed with ``_classify_header``
    on each cell. If a ``question`` column is identified we treat the
    table as an authored Q/A table; otherwise we test for a placeholder
    grid (every first-column cell is a placeholder pattern) and emit
    placeholder rows.
    """
    emitted: list[ExtractedField] = []
    rows = list(getattr(table, "rows", []) or [])
    if not rows:
        return emitted, sequence

    merged_cells = _detect_merged_cells(table)

    header_cells = [_cell_text(c) for c in rows[0].cells]
    header_types = [_classify_header(h) for h in header_cells]

    # ── Shape 1: authored Q/A table ──
    if "question" in header_types:
        q_idx = header_types.index("question")
        a_idx = (
            header_types.index("answer") if "answer" in header_types else None
        )
        word_limit_idx = (
            header_types.index("word_limit")
            if "word_limit" in header_types
            else None
        )
        col_count = len(header_cells)

        for row_index, row in enumerate(rows[1:], start=1):
            cells = list(row.cells)
            if q_idx >= len(cells):
                continue

            question_text = _cell_text(cells[q_idx]).strip()
            if not question_text:
                continue

            # Pick a cell whose emptiness determines the answer shape.
            # When no explicit ``answer`` column is classified we still
            # want to honour blank-cell-following-question — fall back
            # to the next cell after ``q_idx`` so the shape stays useful
            # for 2-column tables whose headers do not classify.
            answer_idx = a_idx if a_idx is not None else q_idx + 1
            placeholder_text: str | None = None
            field_type: str = "empty_cell"
            if answer_idx < len(cells):
                if (row_index, answer_idx) in merged_cells:
                    # The answer cell is a merge continuation — there is
                    # no authored answer to inspect; treat as empty.
                    pass
                else:
                    is_ph, ph_text = _is_cell_placeholder(cells[answer_idx])
                    if is_ph and ph_text:
                        placeholder_text = ph_text
                        field_type = "placeholder"

            # Inv-11 — prefer a dedicated word_limit column, then the
            # question prose, then any other cell on the row (mirrors
            # ``_extract_questions_from_table``).
            word_limit: int | None = None
            if word_limit_idx is not None and word_limit_idx < len(cells):
                wl_text = _cell_text(cells[word_limit_idx])
                word_limit = _extract_word_limit(wl_text)
                if word_limit is None and wl_text.strip().isdigit():
                    word_limit = int(wl_text.strip())
            if word_limit is None:
                word_limit = _extract_word_limit(question_text)
            if word_limit is None:
                for idx in range(col_count):
                    if idx in (q_idx, answer_idx):
                        continue
                    if idx >= len(cells):
                        continue
                    wl = _extract_word_limit(_cell_text(cells[idx]))
                    if wl is not None:
                        word_limit = wl
                        break

            emitted.append(
                ExtractedField(
                    question_text=question_text,
                    placeholder_text=placeholder_text,
                    field_type=field_type,  # type: ignore[arg-type]
                    fill_status="pending",
                    row_index=row_index,
                    col_index=answer_idx if answer_idx < len(cells) else None,
                    table_index=table_index,
                    section_name=section_name,
                    sequence=sequence,
                    word_limit=word_limit,
                )
            )
            sequence += 1
        return emitted, sequence

    # ── Shape 2: placeholder grid (first column uniformly placeholder) ──
    if _is_placeholder_grid(rows):
        for row_index, row in enumerate(rows):
            cells = list(row.cells)
            if not cells:
                continue
            first = cells[0]
            text = _cell_text(first).strip()
            if not text:
                continue
            is_ph, ph_text = _grid_cell_placeholder(first)
            if not is_ph:
                continue
            emitted.append(
                ExtractedField(
                    question_text=None,
                    placeholder_text=ph_text or text,
                    field_type="placeholder",
                    fill_status="pending",
                    row_index=row_index,
                    col_index=0,
                    table_index=table_index,
                    section_name=section_name,
                    sequence=sequence,
                    word_limit=None,
                )
            )
            sequence += 1
        return emitted, sequence

    # ── Shape 3 (DR-058 generalisation): generic label -> empty/placeholder
    # cell detector, layered UNDER shapes 1/2 as a fast-path (only runs when
    # neither the authored Q/A header nor the placeholder grid matched this
    # table). See _emit_generic_table_fields for the three sub-rules.
    return _emit_generic_table_fields(
        rows=rows,
        merged_cells=merged_cells,
        table_index=table_index,
        sequence=sequence,
        section_name=section_name,
    )


# ──────────────────────────────────────────────────────────────────────────
# Generic (DR-058) detection: w:sdt content controls + highlighted runs
# (TECH §3.2 — "ALSO emit w:sdt content-controls + highlighted runs").
# Document-wide, independent of the table/paragraph body walk above (a
# content control or a highlighted answer span may sit inside a table cell
# OR body-level prose; a single XML sweep over `doc.element.body` catches
# both without re-deriving the body-walk's section-tracking state).
# ──────────────────────────────────────────────────────────────────────────

# Word's stock placeholder text for an unfilled content control (the
# built-in "Rich text"/"Plain text" content-control default prompt).
_SDT_DEFAULT_PLACEHOLDER_TEXT = re.compile(
    r"^(click (or tap )?here to enter text\.?|choose an item\.?|choose a date\.?|type here\.?)$",
    re.IGNORECASE,
)

# Highlight colours OOXML admits on `w:highlight/@w:val` (a small subset is
# used in practice for "fill this in" marking — yellow is the convention the
# CSP corpus instructions name explicitly: "fields highlighted in yellow").
_HIGHLIGHT_COLOURS = frozenset(
    {"yellow", "green", "cyan", "magenta", "red", "lightGray", "darkYellow"}
)


def _sdt_field(sdt_element: object, sequence: int) -> ExtractedField | None:
    """Extract one field from a ``w:sdt`` (content control) element, or
    ``None`` when the control is already filled / has no usable label.

    ``w:sdtPr/w:alias`` carries the control's human-set title (used as
    ``question_text`` when present); ``w:sdtContent`` carries the current
    content — Word's stock unfilled-prompt text ("Click here to enter
    text.") maps to ``placeholder_text``. A control already carrying
    authored (non-stock) content is treated as FILLED, not a fillable slot.
    """
    if not hasattr(sdt_element, "find"):
        return None
    alias = sdt_element.find(f"{_W_NS}sdtPr/{_W_NS}alias")
    alias_val = alias.get(f"{_W_NS}val") if alias is not None else None
    question_text = alias_val.strip() if alias_val and alias_val.strip() else None

    content = sdt_element.find(f"{_W_NS}sdtContent")
    content_text = ""
    if content is not None and hasattr(content, "findall"):
        text_nodes = content.findall(f".//{_W_NS}t")
        content_text = "".join(t.text for t in text_nodes if t.text).strip()

    is_default_placeholder = bool(
        content_text and _SDT_DEFAULT_PLACEHOLDER_TEXT.fullmatch(content_text)
    )
    if content_text and not is_default_placeholder:
        # Carries authored (non-stock) content — already filled, not an
        # unfilled slot to surface.
        return None

    placeholder_text = content_text if is_default_placeholder else None
    if question_text is None and placeholder_text is None:
        # A truly empty, unnamed content control — no label and no visible
        # placeholder prompt to anchor a field on.
        return None

    return ExtractedField(
        question_text=question_text,
        placeholder_text=placeholder_text,
        field_type="placeholder" if placeholder_text else "empty_cell",
        fill_status="pending",
        sequence=sequence,
        word_limit=_extract_word_limit(question_text) if question_text else None,
    )


def _is_highlighted_run(run: object) -> bool:
    highlight = run.find(f"{_W_NS}rPr/{_W_NS}highlight") if hasattr(run, "find") else None
    if highlight is None:
        return False
    return highlight.get(f"{_W_NS}val") in _HIGHLIGHT_COLOURS


def _highlighted_run_fields(
    body: object,
    sequence: int,
    *,
    exclude_run_ids: set[int],
) -> tuple[list[ExtractedField], int]:
    """Emit one field per genuinely BLANK highlighted span
    (``field_type='highlighted'`` — the literal already reserved for this
    shape in ``shared.py``).

    Grouped per-paragraph (Word frequently splits one logical highlighted
    span across several ``w:r`` fragments for spellcheck/formatting
    boundaries — evaluating each run in isolation over-counts and can even
    surface a lone punctuation fragment as its own field). Real-corpus
    measurement (Charnwood) showed highlighting used broadly for
    buyer-customisation EMPHASIS (contact details, place names) rather
    than a bidder fill-in marker — 188 highlighted runs, only 14 carrying
    no text. Requiring the paragraph's COMBINED highlighted text to be
    empty is the conservative reading: a highlighted blank IS a plausible
    "type here" slot; highlighted PROSE is ambiguous emphasis, not
    reliably a fillable field, and is left alone rather than guessed at
    (no ML classifier — DR-058).

    ``exclude_run_ids`` skips runs already accounted for as part of a
    ``w:sdt`` content control (avoids double-counting a highlighted run
    that also sits inside a content control's ``w:sdtContent``).
    """
    emitted: list[ExtractedField] = []
    if not hasattr(body, "findall"):
        return emitted, sequence
    for para in body.findall(f".//{_W_NS}p"):
        highlighted_runs = [
            r
            for r in para.findall(f"./{_W_NS}r")
            if id(r) not in exclude_run_ids and _is_highlighted_run(r)
        ]
        if not highlighted_runs:
            continue
        combined_text = "".join(
            "".join(t.text for t in r.findall(f".//{_W_NS}t") if t.text)
            for r in highlighted_runs
        ).strip()
        if combined_text:
            continue
        emitted.append(
            ExtractedField(
                question_text=None,
                placeholder_text=None,
                field_type="highlighted",
                fill_status="pending",
                sequence=sequence,
                word_limit=None,
            )
        )
        sequence += 1
    return emitted, sequence


def _emit_sdt_and_highlight_fields(
    body: object, sequence: int
) -> tuple[list[ExtractedField], int]:
    """Document-wide sweep for content controls + highlighted runs."""
    emitted: list[ExtractedField] = []
    if not hasattr(body, "findall"):
        return emitted, sequence

    sdt_elements = body.findall(f".//{_W_NS}sdt")
    sdt_run_ids: set[int] = set()
    for sdt in sdt_elements:
        content = sdt.find(f"{_W_NS}sdtContent") if hasattr(sdt, "find") else None
        if content is not None and hasattr(content, "findall"):
            for run in content.findall(f".//{_W_NS}r"):
                sdt_run_ids.add(id(run))

    for sdt in sdt_elements:
        field = _sdt_field(sdt, sequence)
        if field is not None:
            emitted.append(field)
            sequence += 1

    highlight_fields, sequence = _highlighted_run_fields(
        body, sequence, exclude_run_ids=sdt_run_ids
    )
    emitted.extend(highlight_fields)
    return emitted, sequence


# ──────────────────────────────────────────────────────────────────────────
# Public entry point
# ──────────────────────────────────────────────────────────────────────────


async def extract(raw_bytes: bytes, filename: str) -> ExtractedForm:
    """Extract structured fields from a blank DOCX form.

    Args:
        raw_bytes: The DOCX file's bytes (read by the caller from the
            ingest source).
        filename: The file's name/path relative to the ingest source.
            Passed through into ``FormExtractionError.rel_path`` and
            into ``FormMetadata.form_title`` as a fallback when the
            document carries no title-styled paragraph.

    Returns:
        An ``ExtractedForm`` carrying the form-level metadata + per-field
        rows in reading order (paragraphs + table cells interleaved).

    Raises:
        FormExtractionError: When the DOCX cannot be opened or contains
            zero readable elements (Inv-17 — never silently returns an
            empty ``ExtractedForm``).
    """
    if not raw_bytes:
        raise FormExtractionError(
            reason="empty_docx",
            rel_path=filename,
            details="received zero bytes",
        )

    # python-docx + open_document_safe both want a path. Write the
    # bytes to a temp file (suffix ``.docx`` so pandoc recognises the
    # format) and clean up after extraction.
    with tempfile.NamedTemporaryFile(
        suffix=".docx", delete=False
    ) as tmp:
        tmp.write(raw_bytes)
        tmp_input_path = tmp.name

    fields: list[ExtractedField] = []
    sequence = 0
    current_section: str | None = None
    table_index = 0  # ``doc.tables`` index, in body order

    try:
        try:
            doc, pandoc_path = open_document_safe(tmp_input_path)
        except Exception as exc:  # noqa: BLE001 — python-docx + zipfile errors
            raise FormExtractionError(
                reason="corrupt_docx",
                rel_path=filename,
                details=str(exc),
            ) from exc

        try:
            tables = list(doc.tables)
            paragraphs_seen = 0

            for element in doc.element.body:
                tag = _local_tag(element)

                if tag == "p":
                    paragraphs_seen += 1
                    heading = _heading_text(element)
                    if heading:
                        current_section = heading
                        continue
                    text = _paragraph_text(element)
                    if text:
                        para_fields, sequence = _emit_paragraph_fields(
                            text=text,
                            sequence=sequence,
                            section_name=current_section,
                        )
                        fields.extend(para_fields)

                elif tag == "tbl":
                    if table_index < len(tables):
                        table = tables[table_index]
                        table_fields, sequence = _emit_table_fields(
                            table=table,
                            table_index=table_index,
                            sequence=sequence,
                            section_name=current_section,
                        )
                        fields.extend(table_fields)
                        table_index += 1

            if paragraphs_seen == 0 and table_index == 0:
                raise FormExtractionError(
                    reason="empty_docx",
                    rel_path=filename,
                    details="document carried zero paragraph or table elements",
                )

            # DR-058 generalisation (TECH §3.2): a document-wide sweep for
            # w:sdt content controls + highlighted runs, independent of the
            # paragraph/table body walk above.
            sdt_highlight_fields, sequence = _emit_sdt_and_highlight_fields(
                doc.element.body, sequence
            )
            fields.extend(sdt_highlight_fields)
        finally:
            if pandoc_path:
                # ``open_document_safe`` returned a pandoc-cleaned temp
                # file; remove it now that extraction is complete.
                try:
                    os.unlink(pandoc_path)
                except OSError:
                    pass
    finally:
        try:
            os.unlink(tmp_input_path)
        except OSError:
            pass

    metadata = FormMetadata(
        form_type="questionnaire",
        form_format="docx",
        form_title=filename,
    )
    return ExtractedForm(form_metadata=metadata, fields=fields)
