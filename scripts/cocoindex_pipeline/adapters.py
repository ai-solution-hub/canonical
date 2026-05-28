"""Layered fn-shape per-MIME adapters for the cocoindex T8 flow.

Outer tier takes a FileLike file (cocoindex source binding); inner tier
takes content payload (bytes or str) so the memoisation key is content-
hash, NOT file-handle — metadata-only edits (mtime, owner) MUST NOT
re-trigger inner work (S9 §7.2 COCO.10 / Inv-4).

Topology:
    convert_binary_to_markdown(file: FileLike) -> str   # outer / file-tier memo
        ├── _docling_to_markdown(content_bytes: bytes) -> str   # inner
        ├── _pullmd_to_markdown(url: str) -> PullmdResult       # inner
        └── _passthrough_markdown(content_text: str) -> str     # inner

MIME routing uses `file.file_path.path.suffix` since cocoindex 1.0.3's
`FileLike` exposes no `.mime_type` attribute.

HTML/pullmd AGPL boundary (O-Q3): HTML extraction calls pullmd over HTTP
rather than importing the AGPL package directly — the network-service clause
means the licence does not propagate. URL via `PULLMD_SERVICE_URL`,
mounted via Cloud Run Secret Manager (Subtask 28.6).

Reference: docs/specs/id-28-cocoindex-flow-scaffolding/TECH.md §P-3.
"""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass

import cocoindex as coco
import httpx

_logger = logging.getLogger(__name__)


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
        result = await _pullmd_to_markdown(url)
        # Keep the outer fn's contract as `str` for the downstream content_text
        # flow; the X-Source / X-Quality / X-Share-Id provenance on the
        # PullmdResult is surfaced to the Stage-6 write site in a later subtask
        # (42.9, TECH §WP-E), not here.
        return result.markdown

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


@dataclass(frozen=True)
class PullmdResult:
    """Structured pullmd extraction result.

    `markdown` is the raw `text/markdown` body; the remaining fields carry the
    pullmd v2.x provenance headers (RESEARCH §2.1) for the Stage-6 write site
    (`source_documents.extraction_method` / `pullmd_share_id`, TECH §WP-E):
      - `x_source`  — `X-Source` ∈ {reddit, cloudflare, readability, trafilatura, playwright}.
      - `x_quality` — `X-Quality` (0.0-1.0 extraction-confidence signal).
      - `share_id`  — `X-Share-Id` (8-hex permalink; `GET /s/:id` round-trips).
    """

    markdown: str
    x_source: str | None
    x_quality: float | None
    share_id: str | None


@coco.fn(memo=True)
async def _pullmd_to_markdown(url: str) -> PullmdResult:
    """Pullmd HTTP extractor (AGPL boundary per O-Q3). Memoised on url.

    Calls the pullmd v2.x contract (TECH §WP-A / RESEARCH §2.1):
      GET {PULLMD_SERVICE_URL}/api?url=<encoded> with `Authorization: Bearer`,
    returning a raw `text/markdown` body plus `X-Source`/`X-Quality`/`X-Share-Id`
    provenance headers. Uses `httpx.AsyncClient` (NOT a synchronous `httpx.post`,
    which would block the event loop inside this `@coco.fn` async function).
    """
    pullmd_url = os.environ.get("PULLMD_SERVICE_URL")
    if not pullmd_url:
        raise RuntimeError(
            "PULLMD_SERVICE_URL env var required — mount via Cloud Run Secret Manager "
            "per Subtask 28.6 (docs/specs/id-28-cocoindex-flow-scaffolding/TECH.md §P-3)"
        )
    api_token = os.environ.get("PULLMD_API_TOKEN")
    if not api_token:
        raise RuntimeError(
            "PULLMD_API_TOKEN env var required — single-admin Bearer token mounted via "
            "Cloud Run Secret Manager per ID-42 (docs/specs/id-42-pullmd-deploy/TECH.md §WP-A)"
        )

    headers = {"Authorization": f"Bearer {api_token}"}
    try:
        # `url` is passed as a query param so httpx URL-encodes it correctly.
        async with httpx.AsyncClient(timeout=httpx.Timeout(60.0)) as client:
            resp = await client.get(
                f"{pullmd_url}/api",
                params={"url": url},
                headers=headers,
            )
        resp.raise_for_status()
    except httpx.HTTPError:
        # No silent failure: log structured context, then re-raise so the flow's
        # Stage-error rollup (flow.py::_classify_stage_exception) can classify it.
        _logger.error(
            json.dumps(
                {
                    "event": "cocoindex.pullmd_extract_failed",
                    "url": url,
                    "pullmd_url": pullmd_url,
                }
            )
        )
        raise

    # Body is raw text/markdown (NOT JSON). httpx.Headers is case-insensitive.
    # X-Quality is a 0.0-1.0 confidence signal; degrade a malformed value to None
    # rather than letting a raw ValueError bypass the structured-failure path —
    # the markdown body is still usable, so a bad quality header must not fail the
    # extraction.
    x_quality_raw = resp.headers.get("X-Quality")
    x_quality: float | None = None
    if x_quality_raw is not None:
        try:
            x_quality = float(x_quality_raw)
        except (ValueError, TypeError):
            _logger.warning(
                json.dumps(
                    {
                        "event": "cocoindex.pullmd_bad_x_quality",
                        "url": url,
                        "x_quality_raw": x_quality_raw,
                    }
                )
            )
            x_quality = None

    return PullmdResult(
        markdown=resp.text,
        x_source=resp.headers.get("X-Source"),
        x_quality=x_quality,
        share_id=resp.headers.get("X-Share-Id"),
    )


@coco.fn(memo=True)
async def _passthrough_markdown(content_text: str) -> str:
    """Identity transform for markdown/text. Memoised on content hash."""
    return content_text


# ── Stage-6 provenance fan-out (ID-42.9, TECH §WP-E) ─────────────────────────
# The Stage-6 `source_documents` write needs the pullmd provenance
# (`extraction_method`, `pullmd_share_id`) WITHOUT disturbing the `-> str`
# content_text contract of `convert_binary_to_markdown` (Stages 3-6 consume the
# markdown body as a plain str; its memo key must stay content-hash-stable). So
# the provenance is fanned out via this SEPARATE helper, which mirrors
# `convert_binary_to_markdown`'s suffix routing. For HTML it awaits
# `_pullmd_to_markdown(url)` — memoised on `url`, so this issues NO second HTTP
# call when the same URL was already converted in the same run.

# Only the five known pullmd X-Source values map onto the
# `source_documents.extraction_method` CHECK enum
# (`20260526074944_id42_pullmd_provenance.sql`). Any other / missing X-Source
# maps to None (the column is nullable) so we NEVER emit `pullmd_<unknown>`,
# which would violate the CHECK on insert.
_PULLMD_X_SOURCE_METHODS = frozenset(
    {"readability", "playwright", "cloudflare", "reddit", "trafilatura"}
)


@dataclass(frozen=True)
class SourceProvenance:
    """Stage-6 provenance for the `source_documents` write site (ID-42.9).

    Mirrors the two pullmd-provenance columns added by
    `20260526074944_id42_pullmd_provenance.sql`:
      - `extraction_method` — `pullmd_<x_source>` for the five known X-Source
        values, `"docling"` for the Docling path, else None (nullable).
      - `pullmd_share_id`   — the `X-Share-Id` permalink for the HTML/pullmd
        path, else None.
    """

    extraction_method: str | None
    pullmd_share_id: str | None


async def extract_source_provenance(
    file: "coco.resources.file.FileLike",  # type: ignore[name-defined]
) -> SourceProvenance:
    """Resolve the Stage-6 provenance for a FileLike (ID-42.9, TECH §WP-E).

    Suffix routing mirrors `convert_binary_to_markdown`:
      - HTML → await `_pullmd_to_markdown(url)` (memo-cached on `url` — no second
        HTTP call) and map X-Source → `extraction_method`, X-Share-Id →
        `pullmd_share_id`.
      - PDF/DOCX/XLSX → `("docling", None)`.
      - markdown/txt → `(None, None)` (passthrough has no extraction provenance).
      - unsupported → `(None, None)` (convert_binary_to_markdown raises first; a
        defensive None keeps this helper total).
    """
    suffix = file.file_path.path.suffix.lower()

    if suffix in _DOCLING_EXTENSIONS:
        return SourceProvenance(extraction_method="docling", pullmd_share_id=None)

    if suffix in _HTML_EXTENSIONS:
        url = str(file.file_path.path)
        result = await _pullmd_to_markdown(url)  # memo-cached on url; no 2nd HTTP call
        x_source = result.x_source
        if x_source in _PULLMD_X_SOURCE_METHODS:
            extraction_method: str | None = f"pullmd_{x_source}"
        else:
            # No silent failure: an unrecognised / missing X-Source would violate
            # the CHECK enum if mapped to `pullmd_<unknown>`, so degrade to None
            # and log structured context (the markdown body is still usable).
            extraction_method = None
            _logger.warning(
                json.dumps(
                    {
                        "event": "cocoindex.pullmd_unknown_x_source",
                        "url": url,
                        "x_source": x_source,
                    }
                )
            )
        return SourceProvenance(
            extraction_method=extraction_method,
            pullmd_share_id=result.share_id,
        )

    # markdown/txt passthrough (and any other suffix) — no extraction provenance.
    return SourceProvenance(extraction_method=None, pullmd_share_id=None)
