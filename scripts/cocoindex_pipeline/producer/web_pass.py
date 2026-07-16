"""Pass-2 gated enrichment — ID-132 {132.9} G-PASS2.

`run_web_pass()` wires a NET-NEW gated-fetch tool (`WEB_FETCH_TOOL`,
`producer/agent_loop.py`) onto the {132.5} Anthropic tool-use agent loop and
the {132.8} per-concept enrich structure (TECH.md §"The two-pass loop"):

    Pass-2 — enrich from the GATED corpus ONLY (BI-16). `run_web_pass()`
    enriches each concept from the client's own authoritative sources (the
    `10-site-structure-and-key-urls` set), with the host-allowlist +
    depth-limit + path-filter knobs wired to those sources ONLY — never the
    open web. Pass-2 adds enrichment prose, creates `references/<slug>.md`
    reference concepts, and appends # Citations (the new reference_items it
    cites). Pass-2 is also gated by the validator before each write.

**`run_web_pass` does NOT write files** — mirrors `enrich_concept` ({132.8}):
its `WebPassResult` (an updated `ConceptDraft` + zero-or-more
`ReferenceConceptDraft`s) is handed onward to `{132.10}`'s bundle-writer,
which validator-gates (BI-13) every write. This module owns two OTHER gates
that must pass before that handoff:

  - **BI-17 provenance** (extends {132.8}'s `seen_anchors` ledger pattern to
    Pass-2): a NEW citation this pass adds must be provably traceable to a
    tool result THIS RUN actually produced — `seen_record_anchors` (minted by
    `read_concept_raw`/`sample_rows`, reused verbatim from `producer/
    enrich.py:_build_tool_executors`) or `seen_gated_anchors` (minted by
    `fetch_url` — this module's own ledger). A citation already present in
    the concept's PRIOR (Pass-1) `# Citations` is trusted without
    re-proving provenance — it already passed this gate once.
  - **The augmentation guard, ENFORCEMENT half** (S451 rider fold-in 2,
    BI-17/BI-22/DR-016; reference precedent `bundle_tools.py:110-155`,
    "augment, not replace"). `producer/validator.py:detect_citation_shrink`
    is the SINGLE shared DETECTION function ({132.7}) — `run_web_pass`
    calls it (never reimplements the comparison) and REFUSES (raises
    `Pass2EnrichError`) a result whose merged `# Citations` would drop any
    entry the concept's prior state carried. `{132.12}` (git-sync 3-way
    reconcile) is the other enforcement call site.

**Fetch-substrate choice (TECH.md §"The two-pass loop" E8 blockquote —
DOCUMENTED, per the {132.9} brief).** TECH flags that the gated corpus
(`10-site-structure-and-key-urls`) largely resolves to LOCAL markdown files
and suggests lifting `GoogleCloudPlatform/knowledge-catalog`'s
`toolbox/enrichment/src/tools/md/fileset.ts` `MarkdownFileset` (class/
algorithm only, never the ADK+MCP harness) rather than bending `httpx` to
local paths. This module does BOTH, gated by the SAME host-allowlist/
depth-limit/path-filter check either way (`_check_gate`) — a `GatedSource`
with `local_root` set routes its fetches through `_LocalMarkdownFileset`
(a Python port of `MarkdownFileset`'s `safePath`-confined `list_contents`/
`read_file`; `search_contents` is NOT ported — `WEB_FETCH_TOOL` exposes a
single fetch-by-URL contract, not a search tool, so lifting it would be
unused scope); a `GatedSource` with no `local_root` fetches over the real
network via `httpx.AsyncClient` (already a flow dependency, `flow.py:62`)
+ `charset_normalizer` (already imported, `flow.py:60`) to decode bytes,
reusing `extract.clean_html` for the HTML-content case and
`url_validation.validate_url` as a defense-in-depth SSRF check — the SAME
two `flow.py:_ingest_url_component` (§3765-3812) reuses, layered UNDER the
net-new BI-16 gate rather than reimplemented.

**No redirect auto-follow (SECURITY — post-commit finding, closed).** The
remote-route `httpx.AsyncClient` is constructed with `follow_redirects=
False` — an allowlisted host issuing a 3xx could otherwise redirect to a
non-allowlisted host or an internal address, and `httpx`'s default
`follow_redirects=True` would silently chase it there, fetching a URL
`_check_gate`/`validate_url` never actually cleared (a total BI-16
bypass). `_fetch_content`'s `_reject_redirect_response` instead turns ANY
3xx response into a soft-error `tool_result` (`_WebFetchRedirectRefused`,
`is_error: true`) — the model may fetch the `Location` target itself as an
ordinary NEW `fetch_url` call, which is then re-gated exactly like any
other URL, allowlisted or not. `run_web_pass`'s `http_client` injection
seam is ALSO guarded (`_reject_redirect_following_client`, checked
eagerly, before any work) — a caller-supplied client with
`follow_redirects` enabled would auto-follow INSIDE `httpx` itself, so
`_reject_redirect_response` would only ever observe the final hop and the
gate would never re-examine the URL actually landed on; `run_web_pass`
refuses loudly (`Pass2EnrichError`) rather than silently accepting such a
client. Dormant today (no production caller injects `http_client` yet —
`{132.10}` will wire one), closed pre-emptively.

**Reference-concept `type:` (a documented judgement call, mirrors
`producer/validator.py`'s own flagged spec-tension findings).** BI-4's
ratified concept-type set is the closed `{topic, product, company,
certification, case_study}` — there is no dedicated "reference" type, and
`metric`/`playbook` already establish the "distinct concern, carried as a
`tags:` entry, not a type" precedent (BI-4). `references/<slug>.md`
concepts are therefore typed `"topic"` with a `"reference"` tag appended,
never a sixth type.

**Collection safety.** Like `producer/enrich.py`, this module transitively
requires `cocoindex` at import time — NOT because it uses `@coco.fn` itself
(`run_web_pass` is a plain async function; the memo/`mount_each`/target
wiring is `{132.10}`'s job, same deferral `enrich.py` already makes to that
Subtask for its own write-target concerns) but because it imports
`producer/enrich.py`'s `_build_tool_executors`/`_extract_terminal_text`/
`_render_citations_section`/`ConceptDraft` — the EXTENDS relationship the
{132.9} brief calls for ("EXTENDS ... the per-concept enrich structure").
Its test file therefore stubs `cocoindex` via `conftest.stubbed_sys_modules`
before importing this module, exactly mirroring `test_producer_enrich.py`.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping
from urllib.parse import urlsplit

import anthropic
import charset_normalizer
import httpx
from anthropic.types import MessageParam

from scripts.cocoindex_pipeline.extract import clean_html
from scripts.cocoindex_pipeline.extraction import _strip_code_fence
from scripts.cocoindex_pipeline.producer.agent_loop import (
    LIST_CONCEPTS_TOOL,
    PRODUCER_MODEL,
    READ_CONCEPT_RAW_TOOL,
    SAMPLE_ROWS_TOOL,
    WEB_FETCH_TOOL,
    ToolExecutor,
    producer_async_client,
    run_tool_use_loop,
)
from scripts.cocoindex_pipeline.producer.enrich import (
    ConceptDraft,
    _build_tool_executors,
    _extract_terminal_text,
    _recover_terminal_json_object,
    _render_citations_section,
)
from scripts.cocoindex_pipeline.producer.frontmatter import (
    ConceptFrontmatter,
    build_concept_frontmatter,
    derive_concept_confidence,
    render_concept_frontmatter,
)
from scripts.cocoindex_pipeline.producer.prompts import PASS2_INSTRUCTION_PROMPT
from scripts.cocoindex_pipeline.producer.resource_uri import (
    citation_target,
    concept_citation_path,
    is_canonical_resource_uri,
    reference_item_uri_from_source_url,
)
from scripts.cocoindex_pipeline.producer.validator import (
    _citation_entries,
    detect_citation_shrink,
    is_valid_concept_resource_uri,
)
from scripts.cocoindex_pipeline.sources.l_records import ConceptKey, ConceptRaw, Source
from scripts.cocoindex_pipeline.url_validation import validate_url

_MAX_TOKENS_PASS2 = 8192

_PASS2_ENVELOPE_KEYS = ("title", "description", "tags", "body", "citations")

# BI-4: reference concepts use the general "topic" type + this tag — see the
# module docstring's "Reference-concept type:" note.
_REFERENCE_CONCEPT_TAG = "reference"

_SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


class Pass2EnrichError(RuntimeError):
    """Raised when the terminal Pass-2 response cannot be parsed into a
    valid enrichment — a malformed JSON envelope, a missing required field,
    a citation that does not resolve through `resource_uri`/BI-17
    provenance, a malformed reference-concept entry, OR (BI-17/BI-22/
    DR-016, the augmentation guard's ENFORCEMENT half) a merged body that
    would DROP a citation the concept's prior (Pass-1) state carried.
    Fails loudly — mirrors `Pass1DraftError`'s escalate-don't-paper-over
    posture; a Pass-2 result that fails this gate is never handed to the
    bundle-writer."""


@dataclass(frozen=True)
class ReferenceConceptDraft:
    """A NET-NEW `references/<slug>.md` concept Pass-2 mints from the gated
    corpus — handed to `{132.10}`'s bundle-writer alongside the enriched
    `ConceptDraft`. Not itself memo-keyed (a plain dataclass, not a
    `@coco.fn` component) — `{132.10}` owns the write-target/memo wiring,
    mirroring `ConceptDraft`'s own deferral."""

    rel_path: str
    """Bundle identity — always `references/<slug>.md` (BI-2)."""

    frontmatter: ConceptFrontmatter
    body: str
    """The distilled markdown body, ALREADY including the terminal
    `# Citations` section (`_render_citations_section`)."""

    @property
    def rendered_markdown(self) -> str:
        """Convenience for `{132.10}`: the full `.md` file content (BI-12
        frontmatter block + body). Does NOT itself validate — the BI-13
        gate is the caller's responsibility before any write."""
        return render_concept_frontmatter(self.frontmatter) + self.body


@dataclass(frozen=True)
class WebPassResult:
    """`run_web_pass`'s return: the Pass-2-enriched concept draft plus any
    NET-NEW reference concepts it minted this run (possibly empty)."""

    concept: ConceptDraft
    reference_concepts: "tuple[ReferenceConceptDraft, ...]" = ()


@dataclass(frozen=True)
class _Pass2Envelope:
    """The parsed, validated terminal-JSON contract `PASS2_INSTRUCTION_
    PROMPT` asks the model for."""

    title: str
    description: str
    tags: "tuple[str, ...]"
    body: str
    citations: "tuple[str, ...]"
    reference_concepts: "tuple[Mapping[str, Any], ...]"


# ── BI-16: the gated corpus — host-allowlist + depth-limit + path-filter ──


@dataclass(frozen=True)
class GatedSource:
    """One entry in the Pass-2 host-allowlist (BI-16) — the client's own
    `10-site-structure-and-key-urls` set. `max_depth` bounds the number of
    non-empty URL path segments; `allowed_path_prefixes`, when non-empty,
    additionally restricts fetches to paths starting with one of them.
    `local_root`, when set, routes fetches for this host to a local
    gated-corpus snapshot (TECH.md E8) via `_LocalMarkdownFileset` instead
    of a real network call."""

    host: str
    max_depth: int = 3
    allowed_path_prefixes: "tuple[str, ...]" = ()
    local_root: "Path | None" = None


@dataclass(frozen=True)
class GatedCorpusConfig:
    """The Pass-2 gated corpus — the client's own authoritative sources,
    ONLY, never the open web (BI-16). Constructed by the caller (a future
    wiring Subtask populates it from the real `10-site-structure-and-
    key-urls` structure document); tests construct fixture configs with
    `example.test`-family hosts."""

    sources: "tuple[GatedSource, ...]"

    def find(self, url: str) -> "GatedSource | None":
        host = (urlsplit(url).hostname or "").lower()
        for source in self.sources:
            if source.host.lower() == host:
                return source
        return None


def _check_gate(url: str, config: GatedCorpusConfig) -> "str | None":
    """BI-16 — host-allowlist, then depth-limit, then path-filter, in that
    order. Returns a human-readable refusal reason (the soft-error
    `fetch_url` returns) or `None` when `url` is in-gate. Never performs
    the SSRF-range check itself — `validate_url` (the existing `flow.py`
    SSRF gate, D-9/BI-21) is layered on top by the executor for
    defense-in-depth, not reimplemented here."""
    parsed = urlsplit(url)
    if parsed.scheme not in ("http", "https"):
        return (
            f"fetch_url refused: scheme {parsed.scheme!r} is not http/https "
            "(BI-16) — Pass-2 may only fetch from the client's gated corpus"
        )
    if not parsed.hostname:
        return "fetch_url refused: URL has no host (BI-16)"
    source = config.find(url)
    if source is None:
        return (
            f"fetch_url refused: host {parsed.hostname!r} is not in the "
            "Pass-2 gated-corpus host-allowlist (BI-16) — Pass-2 may fetch "
            "only the client's own authoritative sources, never the open "
            "web. Try a URL from the client's own site-structure corpus."
        )
    segments = [s for s in parsed.path.split("/") if s]
    if len(segments) > source.max_depth:
        return (
            f"fetch_url refused: path depth {len(segments)} exceeds "
            f"max_depth={source.max_depth} configured for host "
            f"{source.host!r} (BI-16)"
        )
    if source.allowed_path_prefixes and not any(
        parsed.path.startswith(prefix) for prefix in source.allowed_path_prefixes
    ):
        return (
            f"fetch_url refused: path {parsed.path!r} does not match any "
            f"allowed_path_prefixes configured for host {source.host!r} "
            "(BI-16)"
        )
    return None


# ── Local gated-corpus reader — MarkdownFileset port (TECH.md E8) ─────────


class _LocalMarkdownFileset:
    """Path-traversal-safe list/read over a local markdown directory —
    ported (class/algorithm only, never the ADK+MCP harness) from
    `GoogleCloudPlatform/knowledge-catalog`
    `toolbox/enrichment/src/tools/md/fileset.ts`'s `MarkdownFileset`
    (TECH.md E8 blockquote). Covers the `list_contents`/`read_file` surface
    `fetch_url`'s local route needs; `searchContents` is deliberately NOT
    ported — see the module docstring."""

    def __init__(self, root: Path) -> None:
        self._root = root.resolve()
        if not self._root.is_dir():
            raise ValueError(
                f"gated-corpus local_root {root} does not exist or is not "
                "a directory"
            )

    def _safe_path(self, relative_path: str) -> Path:
        """Mirrors `fileset.ts`'s `safePath`: resolve `relative_path`
        against `root` and refuse anything that escapes it (`../` traversal
        or an absolute-path override)."""
        candidate = (self._root / relative_path.lstrip("/")).resolve()
        if candidate != self._root and self._root not in candidate.parents:
            raise ValueError(
                f"path traversal refused: {relative_path!r} escapes the "
                "gated-corpus local root"
            )
        return candidate

    def is_dir(self, relative_path: str) -> bool:
        return self._safe_path(relative_path).is_dir()

    def is_file(self, relative_path: str) -> bool:
        return self._safe_path(relative_path).is_file()

    def list_contents(self, relative_path: str = "") -> str:
        target = self._safe_path(relative_path)
        if not target.is_dir():
            return f"Path not found or is not a directory: {relative_path}"
        lines = []
        for entry in sorted(target.iterdir()):
            item_type = "directory" if entry.is_dir() else "file"
            lines.append(
                f"{entry.name} | {entry.relative_to(self._root)} | {item_type}"
            )
        return "\n".join(lines)

    def read_file(self, relative_path: str) -> str:
        target = self._safe_path(relative_path)
        if not target.is_file():
            return f"Path not found or is not a file: {relative_path}"
        return target.read_text(encoding="utf-8")


def _read_local(url: str, root: Path) -> str:
    parsed = urlsplit(url)
    relative = parsed.path.strip("/")
    fileset = _LocalMarkdownFileset(root)
    if not relative:
        return fileset.list_contents("")
    if fileset.is_dir(relative):
        return fileset.list_contents(relative)
    if fileset.is_file(relative):
        return fileset.read_file(relative)
    if fileset.is_file(f"{relative}.md"):
        return fileset.read_file(f"{relative}.md")
    raise FileNotFoundError(f"{url!r} not found under the gated-corpus local root")


class _WebFetchRedirectRefused(RuntimeError):
    """Raised when a gated fetch receives a 3xx response — Pass-2 never
    auto-follows redirects (BI-16 SECURITY finding: an allowlisted host
    could otherwise 3xx-redirect to a non-allowlisted host or an internal
    address, and `httpx`'s default `follow_redirects=True` would silently
    chase it there, bypassing `_check_gate`/`validate_url` entirely for
    the REAL fetched URL). Caught by `_build_web_fetch_executor` and
    converted into the SAME soft-error `tool_result` shape as any other
    `fetch_url` refusal — the model may fetch the `Location` target
    itself, which then passes through `_check_gate`/`validate_url` like
    any other `fetch_url` call (never auto-followed, always re-gated)."""


def _reject_redirect_response(response: Any) -> None:
    status_code = getattr(response, "status_code", None)
    if isinstance(status_code, int) and 300 <= status_code < 400:
        raise _WebFetchRedirectRefused(
            "fetch_url refused: server issued a redirect; Pass-2 does not "
            "follow redirects (BI-16)"
        )


async def _fetch_content(url: str, source: GatedSource, *, http_client: Any) -> str:
    """The two fetch substrates (TECH.md E8 — see module docstring):
    `source.local_root` set → the `_LocalMarkdownFileset` port; otherwise →
    `httpx` + `charset_normalizer` decode, cleaned via `extract.clean_html`
    when the content looks like HTML (mirrors `flow.py`'s
    `_ingest_url_component` HTML branch, §3794-3812).

    The remote branch NEVER auto-follows a redirect (the injected/owned
    `http_client` is constructed with `follow_redirects=False` — see
    `run_web_pass`) — `_reject_redirect_response` turns a 3xx response
    into `_WebFetchRedirectRefused` BEFORE any decode, so a redirect never
    silently substitutes an unexamined URL for the one `_check_gate`/
    `validate_url` actually cleared."""
    if source.local_root is not None:
        return _read_local(url, source.local_root)
    response = await http_client.get(url)
    _reject_redirect_response(response)
    raw_bytes = response.content
    best = charset_normalizer.from_bytes(raw_bytes).best()
    text = str(best) if best is not None else raw_bytes.decode("utf-8", errors="replace")
    content_type = ""
    headers = getattr(response, "headers", None)
    if headers is not None:
        content_type = headers.get("Content-Type", "") or ""
    looks_html = "html" in content_type.lower() or text.lstrip().startswith("<")
    if looks_html:
        return clean_html(text, url=url)
    return text


def _mint_gated_anchor(url: str, seen_gated_anchors: "set[str]") -> str:
    """Mint `url`'s BI-6/BI-7 `canonical://reference_items/<uuid>` anchor
    (the SAME deterministic `uuid5` derivation the ingest pipeline would use
    for a `reference_items` row with this `source_url` — DR-025's
    "citations degrade to the register, never orphan") and record it into
    `seen_gated_anchors`, the Pass-2 provenance ledger `_validate_pass2_
    citation`/`_validate_reference_concept_citations` check membership
    against (BI-17 — mirrors `producer/enrich.py`'s `_mint`/`seen_anchors`
    pattern, extended to Pass-2's gated-fetch anchors)."""
    anchor = reference_item_uri_from_source_url(url)
    seen_gated_anchors.add(anchor)
    return anchor


def _build_web_fetch_executor(
    config: GatedCorpusConfig,
    *,
    http_client: Any,
    seen_gated_anchors: "set[str]",
) -> ToolExecutor:
    """The `fetch_url` tool executor — BI-16 gate, then (defense-in-depth,
    reused not reimplemented) the existing SSRF gate, then the fetch
    itself. A refusal or a fetch failure returns a soft-error dict (the
    `{"error": ...}` convention `agent_loop.py`'s `_tool_result_is_error`
    detects to set `is_error: true` — S451 rider) so the model can
    self-correct with a different URL rather than killing the whole Pass-2
    run."""

    async def _fetch_url(tool_input: "Mapping[str, Any]") -> Any:
        url = tool_input.get("url")
        if not isinstance(url, str) or not url.strip():
            return {"error": "fetch_url requires a non-empty 'url' string input"}
        refusal = _check_gate(url, config)
        if refusal is not None:
            return {"error": refusal}
        ssrf_ok, ssrf_reason = validate_url(url)
        if not ssrf_ok:
            return {"error": f"fetch_url refused (SSRF gate): {ssrf_reason}"}
        source = config.find(url)
        if source is None:  # pragma: no cover — _check_gate already proved membership
            return {"error": f"fetch_url refused: host for {url!r} is not gated"}
        try:
            content = await _fetch_content(url, source, http_client=http_client)
        except _WebFetchRedirectRefused as exc:
            return {"error": str(exc)}
        except (httpx.HTTPError, OSError, ValueError, FileNotFoundError) as exc:
            return {"error": f"fetch_url failed for {url!r}: {exc}"}
        anchor = _mint_gated_anchor(url, seen_gated_anchors)
        return {"url": url, "resource": anchor, "content": content}

    return _fetch_url


# ── BI-17 citation provenance (extends {132.8}'s pattern to Pass-2) ──────


def _validate_pass2_citation(
    entry: object, *, seen_anchors: "set[str]", catalogue_paths: "set[str]"
) -> str:
    """A NEW (not previously-cited) entry must resolve through a
    `producer/resource_uri.py` builder FORM, AND be provably traceable to
    a tool result THIS RUN actually produced (BI-17) — mirrors
    `producer/enrich.py:_validate_citation`'s two-form contract, extended
    with the Pass-2 `seen_anchors` union (record anchors + gated-fetch
    anchors)."""
    if not isinstance(entry, str) or not entry.strip():
        raise Pass2EnrichError(
            f"run_web_pass: citation entries must be non-empty strings, got {entry!r}"
        )
    # SPEC §5.1/§8 tolerance — normalise a numbered/markdown-link or
    # `/`-leading entry to its bare TARGET first (mirrors Pass-1's
    # `_validate_citation`).
    entry = citation_target(entry)
    if not entry:
        raise Pass2EnrichError(
            "run_web_pass: citation entry resolves to an empty target"
        )
    if is_canonical_resource_uri(entry):
        if not is_valid_concept_resource_uri(entry):
            raise Pass2EnrichError(
                f"run_web_pass: citation {entry!r} is not a valid "
                "canonical:// anchor form (BI-6/BI-8)"
            )
        if entry not in seen_anchors:
            raise Pass2EnrichError(
                f"run_web_pass: citation {entry!r} was never minted into a "
                "read_concept_raw/sample_rows/fetch_url tool result this "
                "run — a NEW record or gated-reference anchor must be "
                "copied from an actual tool result, not invented (BI-17 "
                "provenance)"
            )
        return entry
    try:
        path = concept_citation_path(entry)
    except ValueError as exc:
        raise Pass2EnrichError(f"run_web_pass: invalid citation {entry!r}: {exc}") from exc
    if path not in catalogue_paths:
        raise Pass2EnrichError(
            f"run_web_pass: citation {path!r} is not in the concept "
            "catalogue offered via list_concepts this run (BI-9 provenance)"
        )
    return path


def _validate_pass2_citations(
    raw_citations: object,
    *,
    previous_entries: "set[str]",
    seen_anchors: "set[str]",
    catalogue_paths: "set[str]",
) -> "tuple[str, ...]":
    """The FULL citations array the model returned. Every entry already
    present in `previous_entries` (the concept's PRIOR # Citations state)
    is trusted as-is — it already passed this provenance gate once, at
    Pass-1 time; only NEW entries are re-checked against this run's
    `seen_anchors`/`catalogue_paths`."""
    if not isinstance(raw_citations, list) or not raw_citations:
        raise Pass2EnrichError(
            "run_web_pass: 'citations' must be a non-empty list — it must "
            "carry forward every Pass-1 citation plus any new ones"
        )
    validated: "list[str]" = []
    for entry in raw_citations:
        # Normalise BEFORE the prior-entry membership check — a carried-
        # forward Pass-1 citation may arrive link-wrapped (`[n] [label](…)`)
        # while `previous_entries` holds bare targets (both trailer forms
        # normalise to targets via `validator._citation_entries`).
        if isinstance(entry, str) and citation_target(entry) in previous_entries:
            validated.append(citation_target(entry))
            continue
        validated.append(
            _validate_pass2_citation(
                entry, seen_anchors=seen_anchors, catalogue_paths=catalogue_paths
            )
        )
    return tuple(validated)


def _validate_reference_concept_citations(
    raw_citations: object, *, seen_gated_anchors: "set[str]"
) -> "tuple[str, ...]":
    """DR-025 — a reference concept's `# Citations` entries anchor ONLY
    `reference_items` rows this run's `fetch_url` actually minted (the
    PROVENANCE REGISTER); no concept cross-link, no `source_documents`
    anchor — a reference concept exists specifically to carry gated-fetch
    provenance."""
    if not isinstance(raw_citations, list) or not raw_citations:
        raise Pass2EnrichError(
            "run_web_pass: reference_concepts[].citations must be a "
            "non-empty list (DR-025/BI-17)"
        )
    validated: "list[str]" = []
    for entry in raw_citations:
        if isinstance(entry, str):
            # SPEC §8 tolerance — accept a link-wrapped anchor, normalised
            # to its bare target (mirrors `_validate_pass2_citation`).
            entry = citation_target(entry)
        if not isinstance(entry, str) or not is_valid_concept_resource_uri(entry):
            raise Pass2EnrichError(
                f"run_web_pass: reference concept citation {entry!r} is not "
                "a valid canonical://reference_items/<uuid> anchor (DR-025)"
            )
        if not entry.startswith("canonical://reference_items/"):
            raise Pass2EnrichError(
                f"run_web_pass: reference concept citation {entry!r} must "
                "anchor a reference_items row (DR-025) — got a different "
                "table"
            )
        if entry not in seen_gated_anchors:
            raise Pass2EnrichError(
                f"run_web_pass: reference concept citation {entry!r} was "
                "never minted from a gated fetch_url call this run (BI-17 "
                "provenance)"
            )
        validated.append(entry)
    return tuple(validated)


def _parse_reference_concept(
    raw: object, *, seen_gated_anchors: "set[str]"
) -> ReferenceConceptDraft:
    if not isinstance(raw, Mapping):
        raise Pass2EnrichError(
            f"run_web_pass: reference_concepts entries must be objects, got "
            f"{type(raw).__name__}"
        )
    missing = [k for k in ("slug", "title", "description", "body", "citations") if k not in raw]
    if missing:
        raise Pass2EnrichError(
            f"run_web_pass: reference_concepts entry missing required key(s) {missing}"
        )
    slug = raw["slug"]
    if not isinstance(slug, str) or not _SLUG_RE.match(slug):
        raise Pass2EnrichError(
            "run_web_pass: reference_concepts[].slug must be a lower-case "
            f"hyphenated slug (e.g. 'iso-27001'), got {slug!r}"
        )
    title, description, body = raw["title"], raw["description"], raw["body"]
    for label, value in (("title", title), ("description", description), ("body", body)):
        if not isinstance(value, str) or not value.strip():
            raise Pass2EnrichError(
                f"run_web_pass: reference_concepts[].{label} must be a "
                "non-empty string"
            )
    tags_raw = raw.get("tags", [])
    if not isinstance(tags_raw, list) or not all(isinstance(t, str) for t in tags_raw):
        raise Pass2EnrichError(
            "run_web_pass: reference_concepts[].tags must be a list of strings"
        )
    citations = _validate_reference_concept_citations(
        raw["citations"], seen_gated_anchors=seen_gated_anchors
    )
    frontmatter = build_concept_frontmatter(
        type="topic",
        title=title,
        description=description,
        timestamp=datetime.now(timezone.utc),
        tags=(*tags_raw, _REFERENCE_CONCEPT_TAG),
        resource=citations[0],
        # A19 (bl-477) — `citations[0]` is a gated web anchor, never a
        # per-row anchor, so this always resolves `partial` (FRONTMATTER-
        # WAVE.md §"Applied at all three call sites").
        confidence=derive_concept_confidence(resource=citations[0], citations=citations),
    )
    full_body = f"{body.rstrip()}\n\n{_render_citations_section(citations)}"
    return ReferenceConceptDraft(
        rel_path=f"references/{slug}.md", frontmatter=frontmatter, body=full_body
    )


# ── Terminal-response parsing ─────────────────────────────────────────────


def _parse_pass2_response(
    message: "anthropic.types.Message",
    *,
    previous_body: str,
    seen_record_anchors: "set[str]",
    seen_gated_anchors: "set[str]",
    catalogue_paths: "set[str]",
) -> _Pass2Envelope:
    text = _strip_code_fence(_extract_terminal_text(message))
    try:
        payload = json.loads(text)
    except json.JSONDecodeError as exc:
        payload = _recover_terminal_json_object(
            text, error_cls=Pass2EnrichError, error_prefix="run_web_pass", cause=exc
        )
    if not isinstance(payload, dict):
        raise Pass2EnrichError(
            "run_web_pass: terminal JSON must be an object, got "
            f"{type(payload).__name__}"
        )

    missing = [k for k in _PASS2_ENVELOPE_KEYS if k not in payload]
    if missing:
        raise Pass2EnrichError(
            f"run_web_pass: terminal JSON missing required key(s) {missing}"
        )

    title, description, body = payload["title"], payload["description"], payload["body"]
    for label, value in (("title", title), ("description", description), ("body", body)):
        if not isinstance(value, str) or not value.strip():
            raise Pass2EnrichError(f"run_web_pass: {label!r} must be a non-empty string")

    tags = payload["tags"]
    if not isinstance(tags, list) or not all(isinstance(t, str) for t in tags):
        raise Pass2EnrichError("run_web_pass: 'tags' must be a list of strings")

    previous_entries = _citation_entries(previous_body)
    seen_anchors = seen_record_anchors | seen_gated_anchors
    citations = _validate_pass2_citations(
        payload["citations"],
        previous_entries=previous_entries,
        seen_anchors=seen_anchors,
        catalogue_paths=catalogue_paths,
    )

    raw_reference_concepts = payload.get("reference_concepts", [])
    if not isinstance(raw_reference_concepts, list):
        raise Pass2EnrichError("run_web_pass: 'reference_concepts' must be a list")

    return _Pass2Envelope(
        title=title,
        description=description,
        tags=tuple(tags),
        body=body,
        citations=citations,
        reference_concepts=tuple(raw_reference_concepts),
    )


def _cached_system() -> "list[dict[str, object]]":
    return [
        {
            "type": "text",
            "text": PASS2_INSTRUCTION_PROMPT,
            "cache_control": {"type": "ephemeral"},
        }
    ]


def _seed_user_message(key: ConceptKey, draft: ConceptDraft) -> str:
    return (
        f"Enrich the concept at bundle path {key.rel_path!r} "
        f"(concept_type={key.concept_type!r}) using ONLY the client's own "
        "gated authoritative sources (never the open web) via fetch_url. "
        "Its current drafted body (Pass-1, from records only) is:\n\n"
        f"{draft.body}\n\n"
        "Call fetch_url on URLs from the client's own site-structure "
        "corpus to ground new enrichment prose; call read_concept_raw / "
        "sample_rows again if you need to revisit the backing records, "
        "and list_concepts for cross-linking."
    )


def _reject_redirect_following_client(http_client: Any) -> None:
    """SECURITY (Checker finding, post-commit) — `run_web_pass`'s `http_
    client` injection seam must not reopen the redirect-bypass class
    `_reject_redirect_response` closes: a caller-supplied client with
    redirect-following enabled would auto-follow a 3xx INSIDE `httpx`
    itself, so `_fetch_content` would only ever see the final hop's
    status — `_check_gate`/`validate_url` never re-examine the URL httpx
    actually landed on.

    `getattr(http_client, "follow_redirects", False)` is deliberately the
    WHOLE check — no `isinstance(http_client, httpx.AsyncClient)` branch.
    A real `httpx.AsyncClient` ALWAYS exposes `follow_redirects` (`True`
    or `False`, never absent), so this fails closed for every real client
    with redirect-following enabled, regardless of subclassing. A test
    fake that doesn't model the attribute at all (the common case in this
    module's own test suite) has nothing to fail closed ON — `getattr`'s
    default makes it pass, which is the pragmatic, intended outcome (a
    fake has no actual httpx transport to auto-follow with).
    """
    if http_client is not None and getattr(http_client, "follow_redirects", False):
        raise Pass2EnrichError(
            "run_web_pass: injected http_client must set "
            "follow_redirects=False (BI-16 egress gate) — a client that "
            "auto-follows redirects lets an allowlisted host silently "
            "redirect to a non-allowlisted host or an internal address, "
            "bypassing _check_gate/validate_url for the real fetched URL"
        )


# ── run_web_pass ───────────────────────────────────────────────────────────


async def run_web_pass(
    draft: ConceptDraft,
    key: ConceptKey,
    source: Source,
    gated_corpus: GatedCorpusConfig,
    *,
    http_client: Any = None,
    model: str = PRODUCER_MODEL,
    max_tokens: int = _MAX_TOKENS_PASS2,
) -> WebPassResult:
    """Pass-2 (BI-16): enrich `draft` from the GATED corpus ONLY.

    Runs the {132.5} Anthropic tool-use agent loop with the {132.8}
    Source-adapter tools PLUS the net-new `fetch_url` gated-web tool. The
    terminal response is parsed into a FULL replacement envelope (title/
    description/tags/body/citations — mirrors Pass-1's contract) plus
    zero-or-more `reference_concepts`. Every NEW citation is BI-17
    provenance-checked; the merged result is then augmentation-guard
    checked (`validator.detect_citation_shrink`) — a result that would
    drop a Pass-1 citation is REFUSED (`Pass2EnrichError`), never handed
    onward. Does NOT write files and does NOT itself run the BI-13
    validator gate — both are `{132.10}`'s bundle-writer's job, exactly
    mirroring `enrich_concept`'s own deferral.

    `http_client`, when `None`, is a fresh `httpx.AsyncClient` this call
    owns and closes; pass an injected fake in tests to avoid real network
    calls (mirrors `enrich_concept`'s `anthropic.AsyncAnthropic` injection
    pattern via `patch`). **A caller-supplied `http_client` MUST NOT have
    redirect-following enabled** (BI-16 — see `_reject_redirect_following_
    client`): an injected `httpx.AsyncClient(follow_redirects=True)` would
    silently chase a 3xx to a non-allowlisted host or an internal address
    INSIDE `httpx` itself, so `_fetch_content`'s `_reject_redirect_
    response` would only ever observe the FINAL hop's status — the gate
    never re-checks the followed URL. Checked eagerly, before any work.
    """
    _reject_redirect_following_client(http_client)
    catalogue = await source.list_concepts()
    raw_cache: "dict[str, ConceptRaw]" = {}
    seen_record_anchors: "set[str]" = set()
    seen_gated_anchors: "set[str]" = set()
    catalogue_paths = {ck.rel_path for ck in catalogue}
    catalogue_paths.add(key.rel_path)

    owns_client = http_client is None
    # follow_redirects=False (SECURITY, post-commit finding) — an
    # allowlisted host issuing a 3xx to a non-allowlisted host or an
    # internal address must NOT be silently chased; `_fetch_content`'s
    # `_reject_redirect_response` re-gates every redirect as an ordinary
    # fetch_url call instead (see `_WebFetchRedirectRefused`).
    client: Any = http_client or httpx.AsyncClient(
        timeout=httpx.Timeout(30.0), follow_redirects=False
    )
    try:
        tool_executors = _build_tool_executors(
            key, source, catalogue, raw_cache, seen_record_anchors
        )
        tool_executors["fetch_url"] = _build_web_fetch_executor(
            gated_corpus, http_client=client, seen_gated_anchors=seen_gated_anchors
        )

        messages: "list[MessageParam]" = [
            {"role": "user", "content": _seed_user_message(key, draft)}
        ]

        anthropic_client = producer_async_client()
        response = await run_tool_use_loop(
            client=anthropic_client,
            messages=messages,
            tools=[READ_CONCEPT_RAW_TOOL, SAMPLE_ROWS_TOOL, LIST_CONCEPTS_TOOL, WEB_FETCH_TOOL],
            tool_executors=tool_executors,
            system=_cached_system(),
            extractor_name="run_web_pass",
            max_tokens=max_tokens,
            model=model,
        )

        envelope = _parse_pass2_response(
            response,
            previous_body=draft.body,
            seen_record_anchors=seen_record_anchors,
            seen_gated_anchors=seen_gated_anchors,
            catalogue_paths=catalogue_paths,
        )
    finally:
        if owns_client:
            await client.aclose()

    new_body = f"{envelope.body.rstrip()}\n\n{_render_citations_section(envelope.citations)}"
    shrink = detect_citation_shrink(previous_body=draft.body, new_body=new_body)
    if shrink:
        raise Pass2EnrichError(
            "run_web_pass: the enriched draft would DROP previously-cited, "
            f"record-grounded entries {shrink!r} from # Citations — refused "
            "(augmentation guard, BI-17/BI-22/DR-016; "
            "validator.detect_citation_shrink)"
        )

    frontmatter = build_concept_frontmatter(
        type=key.concept_type,
        title=envelope.title,
        description=envelope.description,
        timestamp=datetime.now(timezone.utc),
        tags=envelope.tags,
        resource=draft.frontmatter.resource,
        # A19 (bl-477) — recomputed from the FINAL enriched (resource,
        # citations), not carried over from `draft.frontmatter.confidence`:
        # a Pass-1 `partial` concept that gains a per-row anchor + a second
        # record citation during Pass-2 enrichment legitimately becomes
        # `strong` — monotonic in grounding, never a silent downgrade
        # (FRONTMATTER-WAVE.md §"Applied at all three call sites").
        confidence=derive_concept_confidence(
            resource=draft.frontmatter.resource, citations=envelope.citations
        ),
    )
    enriched = ConceptDraft(key=key, frontmatter=frontmatter, body=new_body)
    reference_concepts = tuple(
        _parse_reference_concept(rc, seen_gated_anchors=seen_gated_anchors)
        for rc in envelope.reference_concepts
    )
    return WebPassResult(concept=enriched, reference_concepts=reference_concepts)
