"""Layered fn-shape per-MIME adapters for the cocoindex T8 flow.

Outer tier takes a FileLike file (cocoindex source binding); inner tier
takes content payload (bytes or str) so the memoisation key is content-
hash, NOT file-handle — metadata-only edits (mtime, owner) MUST NOT
re-trigger inner work (S9 §7.2 COCO.10 / Inv-4).

Topology:
    convert_binary_to_markdown(file: FileLike) -> str   # outer / file-tier memo
        ├── _docling_to_markdown(content_bytes: bytes) -> str   # inner
        ├── _pullmd_to_markdown(url: str) -> str                # inner
        └── _passthrough_markdown(content_text: str) -> str     # inner

MIME routing uses `file.file_path.path.suffix` since cocoindex 1.0.3's
`FileLike` exposes no `.mime_type` attribute.

HTML/pullmd AGPL boundary (O-Q3): HTML extraction calls pullmd over HTTP
rather than importing the AGPL package directly — the network-service clause
means the licence does not propagate. URL via `PULLMD_SERVICE_URL`,
mounted via Cloud Run Secret Manager (Subtask 28.6).

Reference: docs/specs/cocoindex-flow-scaffolding/TECH.md §P-3.
"""

from __future__ import annotations

import os

import cocoindex as coco
import httpx


# Extension → MIME group mapping (lower-case suffix comparison).
_DOCLING_EXTENSIONS = frozenset({".pdf", ".docx", ".xlsx"})
_HTML_EXTENSIONS = frozenset({".html", ".htm"})
_TEXT_EXTENSIONS = frozenset({".md", ".markdown", ".txt"})


# Outer tier — file-handle memo.


@coco.fn(memo=True)
async def convert_binary_to_markdown(file: "coco.resources.file.FileLike") -> str:  # type: ignore[name-defined]
    """Route a FileLike by extension to the inner-tier extractor.

    PDF/DOCX/XLSX → Docling; HTML → pullmd HTTP; markdown/txt → passthrough.
    Raises `ValueError` for unsupported extensions.
    """
    suffix = file.file_path.path.suffix.lower()

    if suffix in _DOCLING_EXTENSIONS:
        content_bytes = await file.read()
        return await _docling_to_markdown(content_bytes)

    if suffix in _HTML_EXTENSIONS:
        # Pullmd service resolves local paths and remote URLs transparently.
        url = str(file.file_path.path)
        return await _pullmd_to_markdown(url)

    if suffix in _TEXT_EXTENSIONS:
        content_text = await file.read_text()
        return await _passthrough_markdown(content_text)

    raise ValueError(
        f"Unsupported file extension {suffix!r} — supported: "
        f"{sorted(_DOCLING_EXTENSIONS | _HTML_EXTENSIONS | _TEXT_EXTENSIONS)}"
    )


# Inner tier — content-hash memo. Signatures MUST take bytes or str,
# NEVER FileLike (S9 §7.2 COCO.10); FileLike would make the memo key the
# file handle and defeat the idempotency guarantee.


@coco.fn(memo=True)
async def _docling_to_markdown(content_bytes: bytes) -> str:
    """Docling extractor — supports PDF, DOCX, XLSX. Memoised on content hash."""
    # Lazy import: docling is a ~1.8 GB optional dep, pre-warmed in the Cloud
    # Run image layer (28.6 P-1); test envs stub via unittest.mock.patch.
    from docling.document_converter import DocumentConverter  # noqa: PLC0415

    converter = DocumentConverter()
    result = converter.convert(content_bytes)
    return result.document.export_to_markdown()


@coco.fn(memo=True)
async def _pullmd_to_markdown(url: str) -> str:
    """Pullmd HTTP extractor (AGPL boundary per O-Q3). Memoised on url."""
    pullmd_url = os.environ.get("PULLMD_SERVICE_URL")
    if not pullmd_url:
        raise RuntimeError(
            "PULLMD_SERVICE_URL env var required — mount via Cloud Run Secret Manager "
            "per Subtask 28.6 (docs/specs/cocoindex-flow-scaffolding/TECH.md §P-3)"
        )
    response = httpx.post(
        f"{pullmd_url}/extract",
        json={"url": url},
        timeout=60.0,
    )
    response.raise_for_status()
    return response.json()["markdown"]


@coco.fn(memo=True)
async def _passthrough_markdown(content_text: str) -> str:
    """Identity transform for markdown/text. Memoised on content hash."""
    return content_text
