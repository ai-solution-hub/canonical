"""Layered fn-shape per-MIME adapters for the cocoindex T8 flow.

Outer tier takes a FileLike file (cocoindex source binding); inner tier
takes content payload (bytes or str) so the memoisation key is content-
hash, NOT file-handle — metadata-only edits (mtime, owner) MUST NOT
re-trigger inner work (S9 §7.2 COCO.10 / Inv-4).

Topology:
    convert_binary_to_markdown(file: FileLike) -> str   # outer / file-tier memo
        ├── _docling_to_markdown(content_bytes: bytes, filename: str) -> str  # inner
        └── _passthrough_markdown(content_text: str) -> str     # inner

    _pullmd_fetch(url: str, content_epoch: str) -> PullmdResult  # URL-source epoch-keyed memo (D-4)
        └── _pullmd_http_get(url: str) -> PullmdResult           # plain HTTP body (non-memo)

MIME routing uses `file.file_path.path.suffix` since cocoindex 1.0.3's
`FileLike` exposes no `.mime_type` attribute.

Localfs HTML retirement (ID-75 WP-D): a `.html`/`.htm` file staged into the
file corpus raises `LocalfsHtmlRetiredError` LOUDLY per-file (contained at the
mount boundary, ID-80.9) — HTML content lands via the URL source
(`ingest_url` → `_pullmd_fetch`), the file corpus does not route HTML to
PullMD.

HTML/pullmd AGPL boundary (O-Q3): HTML extraction calls pullmd over HTTP
rather than importing the AGPL package directly — the network-service clause
means the licence does not propagate. URL via `PULLMD_SERVICE_URL`,
mounted via Cloud Run Secret Manager (Subtask 28.6).

Reference: docs/specs/id-28-cocoindex-flow-scaffolding/TECH.md §P-3 +
docs/specs/ID-75-pullmd-cocoindex/TECH.md §3 (D-4 / WP-D).
"""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass
from typing import TYPE_CHECKING

import cocoindex as coco  # public top-level surface — `@coco.fn` decorator
import httpx

if TYPE_CHECKING:  # pragma: no cover — static-analysis-only
    # FileLike resolves through the {67.4} insulation façade. The signature
    # annotations below are string literals (PEP 563 / `from __future__ import
    # annotations`), so this import is never evaluated at runtime — it only
    # lets type-checkers and IDEs resolve `"FileLike"`.
    from scripts.cocoindex_pipeline._coco_api import FileLike

_logger = logging.getLogger(__name__)


# Extension → MIME group mapping (lower-case suffix comparison).
# `_HTML_EXTENSIONS` stays for mime resolution (`_SOURCE_MIME_FALLBACK` in
# flow.py) — it only exits the CONVERSION routing (ID-75 WP-D).
_DOCLING_EXTENSIONS = frozenset({".pdf", ".docx", ".xlsx"})
_HTML_EXTENSIONS = frozenset({".html", ".htm"})
_TEXT_EXTENSIONS = frozenset({".md", ".markdown", ".txt"})


class LocalfsHtmlRetiredError(ValueError):
    """A `.html`/`.htm` file was staged into the localfs corpus (ID-75 WP-D).

    The localfs HTML→PullMD branch is RETIRED: HTML content lands via the URL
    source (`ingest_url` → `_pullmd_fetch`, TECH §WP-C) — the file corpus does
    not route HTML to PullMD (a local file path is unreachable for the service
    anyway). Raised LOUDLY per-file and contained at the mount boundary
    (ID-80.9): one bad `.html` never aborts the batch.
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
        # ID-75 WP-D: the localfs HTML→PullMD branch is RETIRED. Fail LOUDLY
        # per-file (contained at the mount boundary, ID-80.9) instead of
        # silently handing PullMD an unreachable local path.
        raise LocalfsHtmlRetiredError(
            f"HTML file {file.file_path.path.name!r} staged into the localfs "
            "corpus — the localfs HTML→PullMD branch is retired (ID-75 WP-D); "
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

    from docling.datamodel.base_models import DocumentStream  # noqa: PLC0415
    from docling.document_converter import DocumentConverter  # noqa: PLC0415

    converter = DocumentConverter()
    source = DocumentStream(name=filename, stream=BytesIO(content_bytes))
    result = converter.convert(source)
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


async def _pullmd_http_get(url: str) -> PullmdResult:
    """Pullmd HTTP extractor body (AGPL boundary per O-Q3). Plain NON-memo.

    Memoisation lives on the `_pullmd_fetch(url, content_epoch)` wrapper —
    the D-4 epoch-keyed memo. Calls the pullmd v2.x contract (TECH §WP-A /
    RESEARCH §2.1):
      GET {PULLMD_SERVICE_URL}/api?url=<encoded> with `Authorization: Bearer`,
    returning a raw `text/markdown` body plus `X-Source`/`X-Quality`/`X-Share-Id`
    provenance headers. Uses `httpx.AsyncClient` (NOT a synchronous `httpx.post`,
    which would block the event loop inside the calling `@coco.fn` async
    function). Structured log-then-raise on HTTP failure — no silent failures.
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
async def _pullmd_fetch(url: str, content_epoch: str) -> PullmdResult:
    """Epoch-keyed PullMD fetch (D-4 — BI-2 update-in-place).

    Memoised on `(url, content_epoch)`, NOT on the URL alone: a URL-only memo
    would return stale markdown forever, silently breaking BI-2's
    changed-content re-fetch. v1 epoch = the ledger rows' max `ingested_at`
    ISO string (`UrlItem.content_epoch`) — one fetch per article in steady
    state; the recorded changed-content re-fetch route is
    `POST /walk {"full_reprocess": true}` (cache-invalidating, server.py).

    `content_epoch` participates ONLY in the memo key — the HTTP request is a
    pure function of `url`, so the epoch is deliberately unused in the body.
    """
    return await _pullmd_http_get(url)


@coco.fn(memo=True)
async def _passthrough_markdown(content_text: str) -> str:
    """Identity transform for markdown/text. Memoised on content hash."""
    return content_text


# ── Stage-6 provenance fan-out (ID-42.9, TECH §WP-E) ─────────────────────────
# The Stage-6 `source_documents` write needs the extraction provenance
# (`extraction_method`, `pullmd_share_id`) WITHOUT disturbing the `-> str`
# content_text contract of `convert_binary_to_markdown` (Stages 3-6 consume the
# markdown body as a plain str; its memo key must stay content-hash-stable). So
# the provenance is fanned out via this SEPARATE helper, which mirrors
# `convert_binary_to_markdown`'s suffix routing. For the FILE corpus this
# resolves docling/passthrough provenance only — the localfs HTML branch is
# retired (ID-75 WP-D); HTML/pullmd provenance lands via the URL source.

# Only the five known pullmd X-Source values map onto the
# `source_documents.extraction_method` CHECK enum
# (`20260526074944_id42_pullmd_provenance.sql`). Any other / missing X-Source
# maps to None (the column is nullable) so we NEVER emit `pullmd_<unknown>`,
# which would violate the CHECK on insert. Consumed by the URL-source write
# site (`ingest_url`, TECH §WP-C step 2) when mapping `_pullmd_fetch`
# provenance onto `extraction_method` (RESEARCH constraint 8).
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
    file: "FileLike",
) -> SourceProvenance:
    """Resolve the Stage-6 provenance for a FileLike (ID-42.9, TECH §WP-E).

    Suffix routing mirrors `convert_binary_to_markdown`:
      - PDF/DOCX/XLSX → `("docling", None)`.
      - HTML → raises `LocalfsHtmlRetiredError` (ID-75 WP-D — HTML lands via
        the URL source; the file corpus does not route HTML to PullMD).
      - markdown/txt → `(None, None)` (passthrough has no extraction provenance).
      - unsupported → `(None, None)` (convert_binary_to_markdown raises first; a
        defensive None keeps this helper total).
    """
    suffix = file.file_path.path.suffix.lower()

    if suffix in _DOCLING_EXTENSIONS:
        return SourceProvenance(extraction_method="docling", pullmd_share_id=None)

    if suffix in _HTML_EXTENSIONS:
        # ID-75 WP-D: mirrors the retired conversion branch — fail LOUDLY
        # per-file; HTML/pullmd provenance lands via the URL source instead.
        raise LocalfsHtmlRetiredError(
            f"HTML file {file.file_path.path.name!r} staged into the localfs "
            "corpus — the localfs HTML→PullMD branch is retired (ID-75 WP-D); "
            "HTML content lands via the URL source (`ingest_url`)."
        )

    # markdown/txt passthrough (and any other suffix) — no extraction provenance.
    return SourceProvenance(extraction_method=None, pullmd_share_id=None)
