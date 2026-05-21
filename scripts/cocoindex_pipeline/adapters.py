"""Layered fn-shape per-MIME adapters for cocoindex T8 flow.

Outer tier takes the FileLike file argument (cocoindex source binding);
inner tier takes content payload (bytes or str) so memoisation key is
content-hash, not file-handle. Metadata-only edits (mtime, owner) MUST NOT
re-trigger inner work.

Layered shape (mirrors scripts/ontology-sync/parse-flow.py):
    convert_binary_to_markdown(file: FileLike) -> str  # outer / file-tier memo
        ├── _docling_to_markdown(content_bytes: bytes) -> str  # inner / content-tier
        ├── _pullmd_to_markdown(url: str) -> str               # inner / content-tier
        └── _passthrough_markdown(content_text: str) -> str    # inner / content-tier

Inner-tier extractors MUST consume bytes or str — NEVER FileLike — so their
memoisation key is the file contents, not the file handle. This preserves
cocoindex's per-tier idempotency: edits to host-file metadata (mtime, owner)
do not re-trigger inner extraction work (S9 §7.2 COCO.10).

MIME routing: derived from file.file_path.path.suffix (the file extension)
because cocoindex.resources.file.FileLike does not expose a .mime_type
attribute in version 1.0.3 (verified against .claude/skills/cocoindex/
references/api_reference.md FileLike section).

HTML/pullmd AGPL boundary (O-Q3): HTML extraction calls pullmd over HTTP
rather than importing the AGPL package directly — the network-service clause
means the AGPL licence does not propagate to KH platform code. The pullmd
service URL is supplied via the PULLMD_SERVICE_URL env var, mounted via
Cloud Run Secret Manager per Subtask 28.6.

Reference: docs/specs/cocoindex-flow-scaffolding/TECH.md §P-3
Covers: PRODUCT Inv-4 (idempotency via content-hash memoisation).
"""

from __future__ import annotations

import os

import cocoindex as coco
import httpx


# ── Extension → MIME group mapping ──────────────────────────────────────────
# cocoindex.resources.file.FileLike in v1.0.3 does not expose .mime_type;
# we infer type from file extension. Lower-case suffix comparison.

_DOCLING_EXTENSIONS = frozenset({".pdf", ".docx", ".xlsx"})
_HTML_EXTENSIONS = frozenset({".html", ".htm"})
_TEXT_EXTENSIONS = frozenset({".md", ".markdown", ".txt"})


# ── Outer tier — file-handle memo ───────────────────────────────────────────


@coco.fn(memo=True)
async def convert_binary_to_markdown(file: "coco.resources.file.FileLike") -> str:  # type: ignore[name-defined]
    """Outer-tier source-binding adapter. Routes by file extension to inner-tier extractor.

    PDF/DOCX/XLSX → Docling (bytes path).
    HTML           → pullmd HTTP service (AGPL boundary per O-Q3).
    markdown/txt   → passthrough (identity, no extraction cost).

    Memoisation at this tier is on the file handle (re-triggers when file
    bytes change). Inner-tier memoisation is on content payload (metadata
    edits do not re-trigger inner work).

    Args:
        file: cocoindex FileLike object yielded by localfs.walk_dir().
              Provides await file.read() -> bytes, await file.read_text() -> str,
              and file.file_path.path (PurePath with .suffix for extension lookup).

    Returns:
        Markdown string extracted from the source file.

    Raises:
        ValueError: If the file extension is not supported.
    """
    suffix = file.file_path.path.suffix.lower()

    if suffix in _DOCLING_EXTENSIONS:
        content_bytes = await file.read()
        return await _docling_to_markdown(content_bytes)

    if suffix in _HTML_EXTENSIONS:
        # Pass file path as str URL reference; pullmd service resolves local paths
        # and remote URLs transparently via its extract endpoint.
        url = str(file.file_path.path)
        return await _pullmd_to_markdown(url)

    if suffix in _TEXT_EXTENSIONS:
        content_text = await file.read_text()
        return await _passthrough_markdown(content_text)

    raise ValueError(
        f"Unsupported file extension {suffix!r} — supported: "
        f"{sorted(_DOCLING_EXTENSIONS | _HTML_EXTENSIONS | _TEXT_EXTENSIONS)}"
    )


# ── Inner tier — content-hash memo ──────────────────────────────────────────
# Signatures MUST take bytes or str, NEVER FileLike, per S9 §7.2 (COCO.10).
# Breaking this invariant would make the memoisation key the file handle
# rather than the content, defeating the idempotency guarantee.


@coco.fn(memo=True)
async def _docling_to_markdown(content_bytes: bytes) -> str:
    """Inner-tier Docling extractor. Memoised on content_bytes hash.

    Calls the Docling DocumentConverter (pre-warmed in image layer per 28.6
    P-1) with the raw binary payload. Supports PDF, DOCX, and XLSX.

    Args:
        content_bytes: Raw file bytes. Content-hash is the memoisation key —
            metadata-only file edits do NOT re-trigger this function.

    Returns:
        Markdown representation of the document.
    """
    # Lazy import: docling is a large optional dep (~1.8 GB model weights).
    # The Cloud Run image installs it (pre-warmed per 28.6 P-1); local dev
    # and test environments may stub this import via unittest.mock.patch.
    from docling.document_converter import DocumentConverter  # noqa: PLC0415

    converter = DocumentConverter()
    result = converter.convert(content_bytes)
    return result.document.export_to_markdown()


@coco.fn(memo=True)
async def _pullmd_to_markdown(url: str) -> str:
    """Inner-tier pullmd HTTP extractor. Memoised on url string.

    Calls the pullmd service via HTTP rather than importing the AGPL package
    directly (O-Q3 AGPL network-service boundary — the network-service clause
    means AGPL does not propagate to KH platform code).

    Args:
        url: File path string or remote URL passed to the pullmd /extract
             endpoint. Memoised on the url value — unchanged URL = memo-hit.

    Returns:
        Markdown string extracted by the pullmd service.

    Raises:
        RuntimeError: If PULLMD_SERVICE_URL env var is not set.
        httpx.HTTPStatusError: If the pullmd service returns a non-2xx response.
    """
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
    """Inner-tier markdown passthrough. Memoised on content_text hash.

    Identity transform — returns the input string unchanged. Memoisation
    buys idempotency on content-hash match: if the file contents are
    identical on a re-ingest, this function is a memo-hit with zero cost.

    Args:
        content_text: Raw markdown or plain text string. Content-hash is
            the memoisation key.

    Returns:
        The input string, unchanged.
    """
    return content_text
