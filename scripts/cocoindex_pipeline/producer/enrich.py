"""Pass-1 concept drafting — ID-132 {132.8} G-PASS1.

`enrich_concept()` wires the {132.4} L-records Source adapter, the {132.5}
Anthropic tool-use agent loop, and the {132.6} resource_uri/frontmatter
builders into the producer's first pass (TECH.md §"The two-pass loop"):

    Pass-1 — draft from L-records ONLY (BI-15). For each ConceptKey,
    enrich_concept() runs the agent loop with the Source-adapter tools only
    (read_concept_raw, sample_rows, list_concepts) — no web access. It emits
    the concept body (a distilled synthesis, never a copy — BI-1/BI-17),
    the initial # Citations section (record anchors via the resource_uri
    builders), and the BI-12 frontmatter (via the frontmatter emitter).

**enrich_concept does NOT write files.** Its `ConceptDraft` return value is
handed onward to `{132.10}`'s bundle-writer, which validator-gates (BI-13,
`producer/validator.py`) the draft before `localfs.declare_file`.

**Zero web egress (BI-15).** The only tools wired here are the three
Source-adapter tools — no `httpx`/`aiohttp` import anywhere in this module,
and no tool executor touches the network. Pass-2 web access (`{132.9}`
G-PASS2, `WEB_FETCH_TOOL`) is a SEPARATE component this module does not
call.

**BI-17 traceability proxy (documented per the {132.8} testStrategy).** This
module cannot re-derive "every English sentence in the body is backed by a
specific record" — that is a semantic judgement made by the model, not a
mechanically checkable property. The testable proxy it enforces instead:
(a) the terminal JSON's `citations` array must be non-empty for every draft
(an empty array is a hard `Pass1DraftError` — a concept with zero citations
is treated as a producer defect, matching BI-17's "an uncited assertion is a
producer defect" framing), and (b) every entry in that array must resolve
through the `producer/resource_uri.py` builders — either the BI-6/BI-8
record-anchor form (`producer.validator.is_valid_concept_resource_uri`) or
the BI-9 concept cross-link path form (`resource_uri.concept_citation_path`,
which itself rejects a bare uuid or a `canonical://` uri). Anchors are never
accepted from the model on trust: `read_concept_raw`'s tool result is the
ONLY place an anchor string enters the conversation (minted here via the
resource_uri builders from the row ids the Source adapter actually
returned), so a validated citation is provably traceable to a real row this
run actually read.

**Memoisation (BI-18).** `enrich_concept` is `@coco.fn(memo=True)`, keyed on
`key: ConceptKey` — the SAME frozen-dataclass memo-key shape
`url_source.py`'s `UrlItem` established (EXECUTOR-VERIFY-1: `cocoindex==
1.0.7`'s `memo_fingerprint._canonicalize_dataclass` keys on field VALUES —
an equal-valued distinct `ConceptKey` memo-hits; a bumped field re-executes,
so a concept whose backing records are unchanged is not re-drafted). `source`
is a second positional arg carrying no data of its own (mirrors `flow.py`'s
`ingest_file(file, ci_target, qa_target, ...)` shape — one memo-keyed item
arg followed by extra context/target args) — it is the injected Source
adapter instance, not part of the memo fingerprint's data-varying surface.

**Collection safety.** Unlike `url_source.py`/`sources/l_records.py`/
`producer/resource_uri.py` (deliberately cocoindex-free), this module DOES
need `@coco.fn` and therefore imports `cocoindex` at module scope — the same
posture `adapters.py`/`extraction.py`/`flow.py` already take. Its test file
stubs `cocoindex` via `conftest.stubbed_sys_modules` before importing this
module (mirrors `test_cocoindex_adapters.py`), so the Rust/LMDB engine never
boots at test-collection time.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Mapping, Sequence

import anthropic
import cocoindex as coco  # public top-level surface — `@coco.fn` decorator
from anthropic.types import MessageParam

from scripts.cocoindex_pipeline.extraction import ANTHROPIC_MODEL, _strip_code_fence
from scripts.cocoindex_pipeline.producer.agent_loop import (
    LIST_CONCEPTS_TOOL,
    PASS1_TOOLS,
    run_tool_use_loop,
)
from scripts.cocoindex_pipeline.producer.frontmatter import (
    ConceptFrontmatter,
    build_concept_frontmatter,
    render_concept_frontmatter,
)
from scripts.cocoindex_pipeline.producer.prompts import PASS1_INSTRUCTION_PROMPT
from scripts.cocoindex_pipeline.producer.resource_uri import (
    build_q_a_pairs_query_uri,
    build_reference_item_uri,
    build_source_document_uri,
    concept_citation_path,
    is_canonical_resource_uri,
)
from scripts.cocoindex_pipeline.producer.validator import is_valid_concept_resource_uri
from scripts.cocoindex_pipeline.sources.l_records import ConceptKey, ConceptRaw, Source

# The full Pass-1 toolset — PASS1_TOOLS (read_concept_raw, sample_rows) plus
# the S451-rider-added list_concepts (BI-9 cross-linking). Composed HERE
# rather than appended to PASS1_TOOLS itself, which a sibling agent_loop.py
# test pins exactly to the two Source-adapter tools.
_PASS1_TOOLS_WITH_CATALOGUE: list[Any] = [*PASS1_TOOLS, LIST_CONCEPTS_TOOL]

_MAX_TOKENS_PASS1 = 8192

_REQUIRED_ENVELOPE_KEYS = ("title", "description", "tags", "body", "citations")


class Pass1DraftError(RuntimeError):
    """Raised when the terminal Pass-1 response cannot be parsed into a
    valid concept draft — a missing/malformed JSON envelope, a missing
    required field, an empty `citations` array, or a citation entry that
    does not resolve through the `producer/resource_uri.py` builders
    (BI-17). Fails loudly rather than silently emitting an under-cited or
    malformed concept — mirrors `AgentLoopError`'s "escalate, don't paper
    over" posture (`producer/agent_loop.py`).
    """


@dataclass(frozen=True)
class ConceptDraft:
    """Pass-1's in-memory output. Handed to `{132.10}`'s bundle-writer,
    which validator-gates (BI-13) + `localfs.declare_file`-writes it —
    `enrich_concept` does NOT write files itself."""

    key: ConceptKey
    frontmatter: ConceptFrontmatter
    body: str
    """The distilled markdown body, ALREADY including the terminal
    `# Citations` section (`_render_citations_section`)."""

    @property
    def rendered_markdown(self) -> str:
        """Convenience for `{132.10}`: the full `.md` file content (BI-12
        frontmatter block + body). Does NOT itself validate — the BI-13 gate
        is the caller's responsibility before any write."""
        return render_concept_frontmatter(self.frontmatter) + self.body


@dataclass(frozen=True)
class _Pass1Envelope:
    """The parsed, validated terminal-JSON contract `PASS1_INSTRUCTION_
    PROMPT` asks the model for."""

    title: str
    description: str
    tags: "tuple[str, ...]"
    body: str
    citations: "tuple[str, ...]"


# ── BI-8 q_a_pairs anchor (topic locator only) ──────────────────────────


def _qa_pairs_anchor(key: ConceptKey) -> "str | None":
    """The BI-8 `q_a_pairs` table/query anchor for `key`'s topic locator.

    `None` for `product`/`company`/`certification`/`case_study` concepts —
    `ConceptKey` carries no `scope_tag`/`domain`/`subtopic` for those types
    (they locate via `entity_id`), so there is no unambiguous BI-8 form to
    build; their q_a_pairs rows (where present, per the join grid) are
    cited via their parent `source_documents`/`reference_items` anchors
    instead.
    """
    if key.scope_tag is not None:
        return build_q_a_pairs_query_uri(scope_tag=key.scope_tag)
    if key.domain is not None and key.subtopic is not None:
        return build_q_a_pairs_query_uri(domain=key.domain, subtopic=key.subtopic)
    return None


def _resource_from_raw(key: ConceptKey, raw: ConceptRaw) -> "str | None":
    """The BI-12 `resource:` field — "the concept's primary record anchor
    where one exists" — derived deterministically from `key`'s own backing
    records, NEVER asked of the model (BI-6/BI-10: only `resource_uri.py`
    builder output may become a Canonical uuid pointer)."""
    if raw.source_documents:
        return build_source_document_uri(raw.source_documents[0]["id"])
    if raw.reference_items:
        return build_reference_item_uri(raw.reference_items[0]["id"])
    return _qa_pairs_anchor(key)


def _with_resource(row: "Mapping[str, Any]", resource: "str | None") -> "dict[str, Any]":
    out = dict(row)
    if resource is not None:
        out["resource"] = resource
    return out


def _annotate_raw_with_anchors(key: ConceptKey, raw: ConceptRaw) -> "dict[str, Any]":
    """The `read_concept_raw` tool result — `raw`'s rows, with every
    `source_documents`/`reference_items` row carrying its BI-6 per-row
    `canonical://` anchor and a top-level `qa_resource` (BI-8) when `key`
    carries a topic locator. This is the ONLY place a `canonical://` anchor
    or a q_a_pairs query anchor enters the conversation — the model copies
    these verbatim into its `citations` array rather than inventing them
    (BI-17 traceability)."""
    payload: "dict[str, Any]" = {
        "source_documents": [
            _with_resource(row, build_source_document_uri(row["id"]))
            for row in raw.source_documents
        ],
        "reference_items": [
            _with_resource(row, build_reference_item_uri(row["id"]))
            for row in raw.reference_items
        ],
        "q_a_pairs": list(raw.q_a_pairs),
        "record_lifecycle": list(raw.record_lifecycle),
        "entity_mentions": list(raw.entity_mentions),
        "entity_relationships": list(raw.entity_relationships),
    }
    qa_resource = _qa_pairs_anchor(key)
    if qa_resource is not None:
        payload["qa_resource"] = qa_resource
    return payload


# ── Tool executors ───────────────────────────────────────────────────────


def _build_tool_executors(
    key: ConceptKey,
    source: Source,
    catalogue: "Sequence[ConceptKey]",
    raw_cache: "dict[str, ConceptRaw]",
) -> "dict[str, Any]":
    """The Pass-1 tool-executor map (`producer/agent_loop.py:ToolExecutor`
    shape) — `read_concept_raw`/`sample_rows` wrap the Source adapter (the
    {132.8} wiring TECH §"The Source adapter" reserves for this Subtask);
    `list_concepts` returns the pre-fetched `catalogue` (no extra Source
    round-trip per call)."""
    catalogue_by_path: "dict[str, ConceptKey]" = {ck.rel_path: ck for ck in catalogue}
    catalogue_by_path.setdefault(key.rel_path, key)

    async def _read_concept_raw(tool_input: "Mapping[str, Any]") -> Any:
        ref = tool_input.get("ref")
        target = catalogue_by_path.get(ref) if isinstance(ref, str) else None
        if target is None:
            return {
                "error": (
                    f"unknown concept ref {ref!r} — call list_concepts to "
                    "see the catalogue of valid bundle rel_paths"
                )
            }
        raw = raw_cache.get(target.rel_path)
        if raw is None:
            raw = await source.read_concept(target)
            raw_cache[target.rel_path] = raw
        return _annotate_raw_with_anchors(target, raw)

    async def _sample_rows(tool_input: "Mapping[str, Any]") -> Any:
        ref = tool_input.get("concept")
        n = tool_input.get("n", 10)
        target = catalogue_by_path.get(ref) if isinstance(ref, str) else None
        if target is None:
            return {
                "error": (
                    f"unknown concept ref {ref!r} — call list_concepts to "
                    "see the catalogue of valid bundle rel_paths"
                )
            }
        try:
            n_int = int(n)
        except (TypeError, ValueError):
            return {"error": f"n must be an integer, got {n!r}"}
        rows = await source.sample_rows(target, n_int)
        return list(rows)

    async def _list_concepts(_tool_input: "Mapping[str, Any]") -> Any:
        return [{"path": ck.rel_path, "type": ck.concept_type} for ck in catalogue]

    return {
        "read_concept_raw": _read_concept_raw,
        "sample_rows": _sample_rows,
        "list_concepts": _list_concepts,
    }


# ── Terminal-response parsing (S451 rider fold-ins 1 + 3) ───────────────


def _extract_terminal_text(message: "anthropic.types.Message") -> str:
    """S451 rider fold-in 3 — with `tool_choice={"type": "auto"}` a terminal
    turn may carry MULTIPLE `TextBlock`s; concatenate ALL of them, not just
    the first. Joined with `""` (not a separator) — `PASS1_INSTRUCTION_
    PROMPT` asks for a single JSON object with "no commentary before or
    after it", so a multi-block split is expected to be a plain fragment
    split of that one JSON document; inserting a separator would risk
    corrupting a split mid-token."""
    parts = [
        block.text for block in message.content if getattr(block, "type", None) == "text"
    ]
    if not parts:
        raise Pass1DraftError(
            "enrich_concept: terminal response carried no TextBlock — the "
            "Pass-1 contract requires the final frontmatter+body as "
            f"terminal text (stop_reason={getattr(message, 'stop_reason', None)!r})"
        )
    return "".join(parts)


def _validate_citation(entry: object) -> str:
    """BI-17 proxy: `entry` must resolve through a `producer/resource_uri.py`
    builder form — either the BI-6/BI-8 record-anchor form or the BI-9
    concept-path cross-link form. Raises `Pass1DraftError` otherwise."""
    if not isinstance(entry, str) or not entry.strip():
        raise Pass1DraftError(
            f"enrich_concept: citation entries must be non-empty strings, got {entry!r}"
        )
    if is_canonical_resource_uri(entry):
        if not is_valid_concept_resource_uri(entry):
            raise Pass1DraftError(
                f"enrich_concept: citation {entry!r} is not a valid "
                "canonical:// anchor form (BI-6/BI-8)"
            )
        return entry
    try:
        return concept_citation_path(entry)
    except ValueError as exc:
        raise Pass1DraftError(f"enrich_concept: invalid citation {entry!r}: {exc}") from exc


def _parse_pass1_response(message: "anthropic.types.Message") -> _Pass1Envelope:
    text = _strip_code_fence(_extract_terminal_text(message))
    try:
        payload = json.loads(text)
    except json.JSONDecodeError as exc:
        raise Pass1DraftError(
            f"enrich_concept: terminal text was not valid JSON: {exc}"
        ) from exc
    if not isinstance(payload, dict):
        raise Pass1DraftError(
            "enrich_concept: terminal JSON must be an object, got "
            f"{type(payload).__name__}"
        )

    missing = [k for k in _REQUIRED_ENVELOPE_KEYS if k not in payload]
    if missing:
        raise Pass1DraftError(
            f"enrich_concept: terminal JSON missing required key(s) {missing}"
        )

    title, description, body = payload["title"], payload["description"], payload["body"]
    for label, value in (("title", title), ("description", description), ("body", body)):
        if not isinstance(value, str) or not value.strip():
            raise Pass1DraftError(f"enrich_concept: {label!r} must be a non-empty string")

    tags = payload["tags"]
    if not isinstance(tags, list) or not all(isinstance(t, str) for t in tags):
        raise Pass1DraftError("enrich_concept: 'tags' must be a list of strings")

    citations = payload["citations"]
    if not isinstance(citations, list) or not citations:
        raise Pass1DraftError(
            "enrich_concept: 'citations' must be a non-empty list (BI-17 — "
            "an uncited assertion is a producer defect)"
        )
    validated_citations = tuple(_validate_citation(c) for c in citations)

    return _Pass1Envelope(
        title=title,
        description=description,
        tags=tuple(tags),
        body=body,
        citations=validated_citations,
    )


def _render_citations_section(citations: "Sequence[str]") -> str:
    """Renders in the exact `- <entry>` bullet shape
    `producer/validator.py:_citation_entries` parses back out — so
    `{132.9}`/`{132.12}`'s `detect_citation_shrink` augmentation guard reads
    this section correctly."""
    lines = ["# Citations"]
    lines.extend(f"- {citation}" for citation in citations)
    return "\n".join(lines) + "\n"


def _cached_system() -> "list[dict[str, object]]":
    """Cached system block for `PASS1_INSTRUCTION_PROMPT` — the producer's
    own `prompts.py:3-15`-convention home (`producer/prompts.py`)."""
    return [
        {
            "type": "text",
            "text": PASS1_INSTRUCTION_PROMPT,
            "cache_control": {"type": "ephemeral"},
        }
    ]


def _seed_user_message(key: ConceptKey) -> str:
    return (
        f"Draft the concept at bundle path {key.rel_path!r} "
        f"(concept_type={key.concept_type!r}). Start by calling "
        f"read_concept_raw with ref={key.rel_path!r} to ground your draft "
        "in this concept's actual backing L-records."
    )


# ── enrich_concept ───────────────────────────────────────────────────────


@coco.fn(memo=True)
async def enrich_concept(
    key: ConceptKey,
    source: Source,
    *,
    model: str = ANTHROPIC_MODEL,
    max_tokens: int = _MAX_TOKENS_PASS1,
) -> ConceptDraft:
    """Pass-1 (BI-15): draft `key`'s concept body + BI-12 frontmatter from
    L-records ONLY.

    Runs the {132.5} Anthropic tool-use agent loop with the Source-adapter
    tools (`read_concept_raw`, `sample_rows`) plus `list_concepts` (S451
    rider fold-in 2, BI-9 cross-linking) — no web tool is ever wired, so
    Pass-1 makes zero web calls (BI-15). The terminal response is parsed per
    the S451 rider's terminal-TEXT contract (fold-in 1: a JSON envelope in
    the final text turn, never a tool call; fold-in 3: all terminal
    TextBlocks concatenated). `@coco.fn(memo=True)` on the frozen `key`
    (BI-18) — see the module docstring for why `source` does not perturb
    the memo fingerprint.
    """
    catalogue = await source.list_concepts()
    own_raw = await source.read_concept(key)
    raw_cache: "dict[str, ConceptRaw]" = {key.rel_path: own_raw}

    tool_executors = _build_tool_executors(key, source, catalogue, raw_cache)

    messages: "list[MessageParam]" = [
        {"role": "user", "content": _seed_user_message(key)}
    ]

    client = anthropic.AsyncAnthropic()
    response = await run_tool_use_loop(
        client=client,
        messages=messages,
        tools=_PASS1_TOOLS_WITH_CATALOGUE,
        tool_executors=tool_executors,
        system=_cached_system(),
        extractor_name="enrich_concept",
        max_tokens=max_tokens,
        model=model,
    )

    envelope = _parse_pass1_response(response)
    resource = _resource_from_raw(key, raw_cache[key.rel_path])
    frontmatter = build_concept_frontmatter(
        type=key.concept_type,
        title=envelope.title,
        description=envelope.description,
        timestamp=datetime.now(timezone.utc),
        tags=envelope.tags,
        resource=resource,
    )
    body = f"{envelope.body.rstrip()}\n\n{_render_citations_section(envelope.citations)}"
    return ConceptDraft(key=key, frontmatter=frontmatter, body=body)
