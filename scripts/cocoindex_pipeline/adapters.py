"""Layered fn-shape per-MIME adapters for the cocoindex T8 flow.

Outer tier takes a FileLike file (cocoindex source binding); inner tier
takes content payload (bytes or str) so the memoisation key is content-
hash, NOT file-handle — metadata-only edits (mtime, owner) MUST NOT
re-trigger inner work (S9 §7.2 COCO.10 / Inv-4).

Topology:
    convert_binary_to_markdown(file: FileLike) -> str   # outer / file-tier memo
        ├── _docling_to_markdown(content_bytes: bytes, filename: str) -> str  # inner
        └── _passthrough_markdown(content_text: str) -> str     # inner

MIME routing uses `file.file_path.path.suffix` since cocoindex 1.0.3's
`FileLike` exposes no `.mime_type` attribute.

Localfs HTML retirement (ID-75 WP-D): a `.html`/`.htm` file staged into the
file corpus raises `LocalfsHtmlRetiredError` LOUDLY per-file (contained at the
mount boundary, ID-80.9) — HTML content lands via the URL source
(`ingest_url`), the file corpus does not route HTML to the URL extractor.

Reference: docs/specs/id-28-cocoindex-flow-scaffolding/TECH.md §P-3.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

import cocoindex as coco  # public top-level surface — `@coco.fn` decorator

if TYPE_CHECKING:  # pragma: no cover — static-analysis-only
    # FileLike resolves through the {67.4} insulation façade. The signature
    # annotations below are string literals (PEP 563 / `from __future__ import
    # annotations`), so this import is never evaluated at runtime — it only
    # lets type-checkers and IDEs resolve `"FileLike"`.
    from scripts.cocoindex_pipeline._coco_api import FileLike


# Extension → MIME group mapping (lower-case suffix comparison).
# `_HTML_EXTENSIONS` stays for routing `.html`/`.htm` to
# `LocalfsHtmlRetiredError` in the two retired branches below — it is not
# referenced by flow.py, which has its own mime-fallback dict.
_DOCLING_EXTENSIONS = frozenset({".pdf", ".docx", ".xlsx"})
_HTML_EXTENSIONS = frozenset({".html", ".htm"})
_TEXT_EXTENSIONS = frozenset({".md", ".markdown", ".txt"})


class LocalfsHtmlRetiredError(ValueError):
    """A `.html`/`.htm` file was staged into the localfs corpus (ID-75 WP-D).

    The localfs HTML branch is RETIRED: HTML content lands via the URL source
    (`ingest_url`, TECH §WP-C) — the file corpus does not route HTML to the URL
    extractor (a local file path is unreachable for it anyway). Raised LOUDLY
    per-file and contained at the mount boundary (ID-80.9): one bad `.html`
    never aborts the batch.
    """


# Outer tier — file-handle memo.


@coco.fn(memo=True)
async def convert_binary_to_markdown(file: "FileLike") -> str:
    """Route a FileLike by extension to the inner-tier extractor.

    PDF/DOCX/XLSX → Docling; markdown/txt → passthrough. HTML raises
    `LocalfsHtmlRetiredError` (ID-75 WP-D — HTML lands via the URL source).
    Raises `ValueError` for unsupported extensions.
    """
    suffix = file.file_path.path.suffix.lower()

    if suffix in _DOCLING_EXTENSIONS:
        content_bytes = await file.read()
        # Thread the filename through so Docling can pick the right backend by
        # extension (PDF/DOCX/XLSX). The inner tier wraps the bytes in a
        # DocumentStream(name=filename); a bare-bytes `convert()` call raises a
        # pydantic ValidationError (S299 FINDING-1 — the charnwood.docx 0-row
        # bug). `file_path.path.name` is the deterministic original filename, so
        # the inner-tier memo key stays content-stable (COCO.10 / S9 §7.2).
        return await _docling_to_markdown(content_bytes, file.file_path.path.name)

    if suffix in _HTML_EXTENSIONS:
        # ID-75 WP-D: the localfs HTML branch is RETIRED. Fail LOUDLY per-file
        # (contained at the mount boundary, ID-80.9) instead of silently
        # handing the URL extractor an unreachable local path.
        raise LocalfsHtmlRetiredError(
            f"HTML file {file.file_path.path.name!r} staged into the localfs "
            "corpus — the localfs HTML branch is retired (ID-75 WP-D); "
            "HTML content lands via the URL source (`ingest_url`)."
        )

    if suffix in _TEXT_EXTENSIONS:
        content_text = await file.read_text()
        return await _passthrough_markdown(content_text)

    raise ValueError(
        f"Unsupported file extension {suffix!r} — supported: "
        f"{sorted(_DOCLING_EXTENSIONS | _TEXT_EXTENSIONS)}"
    )


# Inner tier — content-hash memo. Signatures MUST take bytes or str,
# NEVER FileLike (S9 §7.2 COCO.10); FileLike would make the memo key the
# file handle and defeat the idempotency guarantee.


@coco.fn(memo=True)
async def _docling_to_markdown(content_bytes: bytes, filename: str) -> str:
    """Docling extractor — supports PDF, DOCX, XLSX. Memoised on content hash.

    `DocumentConverter.convert()` requires a `Path` or a `DocumentStream`, NOT
    raw bytes — passing bytes raises a pydantic ValidationError (S299 FINDING-1).
    We wrap the bytes in a `DocumentStream` whose `name` carries the original
    filename (with its extension) so Docling selects the correct backend
    (PDF/DOCX/XLSX).

    `filename` is a deterministic str scalar (NOT a FileLike), so the memo key
    stays content-stable per content path (COCO.10 / S9 §7.2): the same bytes +
    same filename always memoise to the same result.
    """
    # Lazy import: docling is a ~1.8 GB optional dep, pre-warmed in the on-prem
    # image layer (28.6 P-1); test envs stub via unittest.mock.patch.
    from io import BytesIO  # noqa: PLC0415

    from docling.datamodel.base_models import (  # noqa: PLC0415
        DocumentStream,
        InputFormat,
    )
    from docling.datamodel.pipeline_options import PdfPipelineOptions  # noqa: PLC0415
    from docling.document_converter import (  # noqa: PLC0415
        DocumentConverter,
        PdfFormatOption,
    )

    # Text-only extraction posture: disable Docling's default PDF OCR
    # (`do_ocr=True`). With OCR on, Docling initialises the rapidocr engine,
    # which imports cv2 (opencv) → `libxcb.so.1: cannot open shared object
    # file` at runtime in the buildpacks image (no X11 libs). DOCX/XLSX have no
    # OCR stage, so their extraction behaviour is unchanged.
    converter = DocumentConverter(
        format_options={
            InputFormat.PDF: PdfFormatOption(
                pipeline_options=PdfPipelineOptions(do_ocr=False)
            )
        }
    )
    source = DocumentStream(name=filename, stream=BytesIO(content_bytes))
    result = converter.convert(source)
    return result.document.export_to_markdown()


@coco.fn(memo=True)
async def _passthrough_markdown(content_text: str) -> str:
    """Identity transform for markdown/text. Memoised on content hash."""
    return content_text


# ── Stage-6 provenance fan-out (ID-42.9, TECH §WP-E) ─────────────────────────
# The Stage-6 `source_documents` write needs the extraction provenance
# (`extraction_method`) WITHOUT disturbing the `-> str` content_text contract of
# `convert_binary_to_markdown` (Stages 3-6 consume the markdown body as a plain
# str; its memo key must stay content-hash-stable). So the provenance is fanned
# out via this SEPARATE helper, which mirrors `convert_binary_to_markdown`'s
# suffix routing. For the FILE corpus this resolves docling/passthrough
# provenance only — the localfs HTML branch is retired (ID-75 WP-D); HTML
# provenance lands via the URL source.


@dataclass(frozen=True)
class SourceProvenance:
    """Stage-6 provenance for the `source_documents` write site (ID-42.9).

    Mirrors the `extraction_method` provenance column (ID-42 migration
    `20260526074944_id42_provenance`):
      - `extraction_method` — `"docling"` for the Docling path, else None
        (nullable; passthrough has no extraction provenance).
    """

    extraction_method: str | None


async def extract_source_provenance(
    file: "FileLike",
) -> SourceProvenance:
    """Resolve the Stage-6 provenance for a FileLike (ID-42.9, TECH §WP-E).

    Suffix routing mirrors `convert_binary_to_markdown`:
      - PDF/DOCX/XLSX → `("docling",)`.
      - HTML → raises `LocalfsHtmlRetiredError` (ID-75 WP-D — HTML lands via
        the URL source; the file corpus does not route HTML to the URL
        extractor).
      - markdown/txt → `(None,)` (passthrough has no extraction provenance).
      - unsupported → `(None,)` (convert_binary_to_markdown raises first; a
        defensive None keeps this helper total).
    """
    suffix = file.file_path.path.suffix.lower()

    if suffix in _DOCLING_EXTENSIONS:
        return SourceProvenance(extraction_method="docling")

    if suffix in _HTML_EXTENSIONS:
        # ID-75 WP-D: mirrors the retired conversion branch — fail LOUDLY
        # per-file; HTML provenance lands via the URL source instead.
        raise LocalfsHtmlRetiredError(
            f"HTML file {file.file_path.path.name!r} staged into the localfs "
            "corpus — the localfs HTML branch is retired (ID-75 WP-D); "
            "HTML content lands via the URL source (`ingest_url`)."
        )

    # markdown/txt passthrough (and any other suffix) — no extraction provenance.
    return SourceProvenance(extraction_method=None)
