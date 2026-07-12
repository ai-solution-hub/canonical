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
producer defect" framing), (b) every entry in that array must resolve
through the `producer/resource_uri.py` builders — either the BI-6/BI-8
record-anchor FORM (`producer.validator.is_valid_concept_resource_uri`) or
the BI-9 concept cross-link path FORM (`resource_uri.concept_citation_path`,
which itself rejects a bare uuid or a `canonical://` uri), and (c) — the
PROVENANCE check, not just the format check — a record-anchor citation must
be a member of `seen_anchors`, the set of anchors THIS RUN actually minted
into a `read_concept_raw` tool result (`_annotate_raw_with_anchors` adds
every anchor it mints), and a concept cross-link citation must be a member
of `catalogue_paths`, the concept catalogue `list_concepts` offers this run.
A well-formed but never-issued `canonical://source_documents/<random-uuid>`
therefore FAILS validation even though it satisfies the format check —
format alone is not proof of provenance. `read_concept_raw`'s tool result —
plus `sample_rows`' for the source_documents-backed grains — are the ONLY
places a record-anchor string enters the conversation (minted via the
resource_uri builders from the row ids the Source adapter actually returned,
and recorded into `seen_anchors` at mint time), so a validated citation is
provably traceable to a real row this run actually read.

**Memoisation (BI-18) — CORRECTED, ESCALATED (ID-132 {132.35} G-DEPLOY-PROOF
Defect A, superseding the claim this docstring carried through the {132.35}
S465 deploy proof).** `enrich_concept` is `@coco.fn(memo=True)`. The
PREVIOUS version of this note claimed `source` "is not part of the memo
fingerprint's data-varying surface" — that claim is FALSE against the
installed engine and was never actually exercised: `cocoindex==1.0.7`'s
`memo_fingerprint.fingerprint_call` → `_make_call_canonical` (`_internal/
memo_fingerprint.py:372-401`) canonicalizes **every** positional/keyword arg
of a memoised call, `source` included, with no "context arg" exemption
anywhere in the engine. RUN 1 of the {132.35} deploy proof — the first REAL
`cocoindex` App run this component had ever executed inside an ambient
`ComponentContext` — hit this directly: `source` (an `LRecordsSource`
wrapping a live `asyncpg.Pool`) has no `__coco_memo_key__` and is not
`pickle`-able (the Pool holds live locks/sockets), so `_canonicalize`'s
pickle-fallback raises and every one of 18/18 concepts failed drafting with
`TypeError: Unsupported type for memoization key: LRecordsSource`. The prior
claim went unchallenged only because the S463 standalone harness ran with NO
ambient `ComponentContext` — `AsyncFunction.__call__` (`_internal/
function.py`) takes the `parent_ctx is None` branch and executes unmemoised,
silently, so the rejection this docstring should have described never fired
in any prior test.

**The deeper gap this surfaced (Defect A, ESCALATED — NOT fixed as of this
note).** Making `source` memo-keyable (e.g. a stable `__coco_memo_key__`
constant) is not, by itself, a safe fix: `ConceptKey`'s own fields
(`rel_path`/`concept_type`/`scope_tag`/`domain`/`subtopic`/`entity_id`/
`workspace_id`, `sources/l_records.py`) are pure LOCATOR/identity fields —
none of them, nor anything else `list_concepts()` populates for any of the 5
ratified concept types, carries a content-hash/`updated_at`/version signal.
With `source` pinned to a constant, the ENTIRE memo fingerprint would be
identity-only, so a content edit to a q_a_pair/source_document that leaves
the concept's identity unchanged would ALSO leave the memo fingerprint
unchanged — a memo-HIT that silently serves a STALE draft, violating BI-18's
"a targeted record change re-drafts exactly that concept" direction (DR-047:
the memo-KEY rejection fix must not silently degrade correctness either).
Closing this requires a genuine content-versioning design (e.g. a per-concept
content fingerprint threaded onto `ConceptKey`, or a `__coco_memo_state__`
validator with DB access at cache-hit time) — a materially different,
non-minimal change this Subtask escalated rather than shipped ad hoc. See
`scripts/tests/test_l_records_source.py::TestMemoKeyProtocolEscalation` for
the executable trace (kept green intentionally, pinning the CURRENT
unfixed state so it forces a deliberate update when the real fix lands).

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


def _annotate_raw_with_anchors(
    key: ConceptKey, raw: ConceptRaw, seen_anchors: "set[str]"
) -> "dict[str, Any]":
    """The `read_concept_raw` tool result — `raw`'s rows, with every
    `source_documents`/`reference_items` row carrying its BI-6 per-row
    `canonical://` anchor and a top-level `qa_resource` (BI-8) when `key`
    carries a topic locator. Together with `_sample_rows`' sd-backed-grain
    minting, this is where every `canonical://` anchor or q_a_pairs query
    anchor enters the conversation — the model copies these verbatim into
    its `citations` array rather than inventing them.

    Every anchor minted here is also recorded into `seen_anchors` — the
    per-run provenance ledger `_validate_citation` checks membership
    against, so a citation the model COPIES from this tool result validates,
    but a well-formed, never-issued anchor the model INVENTS does not
    (BI-17 — format alone is not proof of provenance).

    `{132.28}` G-ENRICH-WONBID-WIRE: `workspaces`/`form_templates` are
    populated ONLY by the won-bid case_study grain ({132.21}, S443
    amendment) — buyer identity (`workspaces`) + `outcome_notes`
    (`form_templates`) reach the model verbatim, unadorned like `q_a_pairs`/
    `record_lifecycle`/`entity_mentions`/`entity_relationships` above: no
    `resource_uri.py` builder exists for either table (TECH.md's case_study
    "Anchors emitted" column names only `source_documents`/`reference_items`),
    so no anchor is minted for them here."""
    payload: "dict[str, Any]" = {
        "source_documents": [
            _with_resource(row, _mint(build_source_document_uri(row["id"]), seen_anchors))
            for row in raw.source_documents
        ],
        "reference_items": [
            _with_resource(row, _mint(build_reference_item_uri(row["id"]), seen_anchors))
            for row in raw.reference_items
        ],
        "q_a_pairs": list(raw.q_a_pairs),
        "record_lifecycle": list(raw.record_lifecycle),
        # A mention's `context_snippet` is genuinely-read content from its
        # parent source_documents row, so that parent sd is citable
        # provenance and gets its anchor minted; the mention row's OWN id
        # stays unadorned (`entity_mentions` is not a BI-6 citation table).
        "entity_mentions": [
            _with_resource(
                row, _mint(build_source_document_uri(row["source_document_id"]), seen_anchors)
            )
            if row.get("source_document_id")
            else dict(row)
            for row in raw.entity_mentions
        ],
        "entity_relationships": list(raw.entity_relationships),
        "workspaces": list(raw.workspaces),
        "form_templates": list(raw.form_templates),
    }
    qa_resource = _qa_pairs_anchor(key)
    if qa_resource is not None:
        payload["qa_resource"] = _mint(qa_resource, seen_anchors)
    return payload


def _mint(anchor: str, seen_anchors: "set[str]") -> str:
    """Record `anchor` into the per-run `seen_anchors` provenance ledger and
    return it unchanged — every `_annotate_raw_with_anchors` mint site routes
    through this so no anchor can enter a tool result without also being
    recorded as "actually minted this run" (BI-17)."""
    seen_anchors.add(anchor)
    return anchor


# ── Tool executors ───────────────────────────────────────────────────────


def _build_tool_executors(
    key: ConceptKey,
    source: Source,
    catalogue: "Sequence[ConceptKey]",
    raw_cache: "dict[str, ConceptRaw]",
    seen_anchors: "set[str]",
) -> "dict[str, Any]":
    """The Pass-1 tool-executor map (`producer/agent_loop.py:ToolExecutor`
    shape) — `read_concept_raw`/`sample_rows` wrap the Source adapter (the
    {132.8} wiring TECH §"The Source adapter" reserves for this Subtask);
    `list_concepts` returns the pre-fetched `catalogue` (no extra Source
    round-trip per call). `seen_anchors` is the shared per-run provenance
    ledger `_annotate_raw_with_anchors` mints into — passed through so every
    `read_concept_raw` call records what it actually returned (BI-17)."""
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
        return _annotate_raw_with_anchors(target, raw, seen_anchors)

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
        if target.concept_type in ("company", "certification"):
            # These grains sample source_documents rows (the adapter
            # dispatch's fallthrough arm — `l_records.sample_rows`), so each
            # row gets its BI-6 anchor minted into `seen_anchors` exactly as
            # `_annotate_raw_with_anchors` does: a sampled row is real
            # provenance, and an unminted one leaks a REAL sd id the BI-17
            # gate must then refuse. q_a_pairs-backed grains stay unadorned
            # (q_a citation is DB-internal, owner-ratified).
            return [
                _with_resource(
                    row, _mint(build_source_document_uri(row["id"]), seen_anchors)
                )
                for row in rows
            ]
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


def _validate_citation(
    entry: object, *, seen_anchors: "set[str]", catalogue_paths: "set[str]"
) -> str:
    """BI-17 proxy: `entry` must resolve through a `producer/resource_uri.py`
    builder FORM, AND be provably traceable to something this run actually
    surfaced to the model — not merely well-formed. Raises `Pass1DraftError`
    otherwise.

    Two forms, two provenance checks:
      - a BI-6/BI-8 record-anchor `canonical://` uri must ALSO be a member
        of `seen_anchors` — the anchors `_annotate_raw_with_anchors` actually
        minted into a `read_concept_raw` tool result this run. A well-formed
        but never-issued `canonical://source_documents/<random-uuid>` FAILS
        here even though it passes the format check.
      - a BI-9 concept cross-link path must ALSO be a member of
        `catalogue_paths` — the concept catalogue `list_concepts` offers
        this run. A well-formed but non-existent concept path FAILS here.
    """
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
        if entry not in seen_anchors:
            raise Pass1DraftError(
                f"enrich_concept: citation {entry!r} was never minted into a "
                "read_concept_raw tool result this run — a record anchor "
                "must be copied from an actual tool result, not invented "
                "(BI-17 provenance)"
            )
        return entry
    try:
        path = concept_citation_path(entry)
    except ValueError as exc:
        raise Pass1DraftError(f"enrich_concept: invalid citation {entry!r}: {exc}") from exc
    if path not in catalogue_paths:
        raise Pass1DraftError(
            f"enrich_concept: citation {path!r} is not in the concept "
            "catalogue offered via list_concepts this run — a cross-link "
            "must name a real concept, not an invented one (BI-9 provenance)"
        )
    return path


def _recover_terminal_json_object(
    text: str,
    *,
    error_cls: "type[Exception]",
    error_prefix: str,
    cause: "json.JSONDecodeError",
) -> Any:
    """Fallback for `_parse_pass1_response`/`_parse_pass2_response` — a bare
    `json.loads(text)` just failed. Live terminal turns intermittently
    prefix the JSON payload with a short conversational preamble despite the
    instruction prompt's "no commentary before or after it" contract
    (observed live, {132.15} 2026-07-11 `claude-opus-4-6` run: 'I now have
    the backing records and the full concept catalogue. Let me draft the
    concept document.\\n\\n{"title":...}' — 18/18 concepts failed drafting
    on the bare `json.loads`). Locates the first `{` and parses the first
    complete JSON object AT that position via
    `json.JSONDecoder().raw_decode` — any trailing commentary after the
    object's closing brace is ignored, never validated. Raises `error_cls`
    if no `{` exists anywhere in `text`, or if the object at that position
    still doesn't parse; the message includes a short repr of the text's
    head (not a full-payload dump) so future terminal-text drift stays
    diagnosable from logs."""
    start = text.find("{")
    if start == -1:
        raise error_cls(
            f"{error_prefix}: terminal text was not valid JSON and contains "
            f"no '{{' to recover a payload from: {cause} (head: {text[:120]!r})"
        ) from cause
    try:
        payload, _end = json.JSONDecoder().raw_decode(text, start)
    except json.JSONDecodeError as exc:
        raise error_cls(
            f"{error_prefix}: terminal text was not valid JSON, and the "
            f"first '{{' at index {start} did not start a parseable object: "
            f"{exc} (head: {text[:120]!r})"
        ) from exc
    return payload


def _parse_pass1_response(
    message: "anthropic.types.Message",
    *,
    seen_anchors: "set[str]",
    catalogue_paths: "set[str]",
) -> _Pass1Envelope:
    text = _strip_code_fence(_extract_terminal_text(message))
    try:
        payload = json.loads(text)
    except json.JSONDecodeError as exc:
        payload = _recover_terminal_json_object(
            text, error_cls=Pass1DraftError, error_prefix="enrich_concept", cause=exc
        )
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
    validated_citations = tuple(
        _validate_citation(c, seen_anchors=seen_anchors, catalogue_paths=catalogue_paths)
        for c in citations
    )

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

    # BI-17/BI-9 provenance ledgers (Checker finding — format alone is not
    # proof of provenance): `seen_anchors` accumulates every canonical://
    # anchor actually minted into a read_concept_raw tool result this run;
    # `catalogue_paths` is the concept catalogue list_concepts offers this
    # run. `_validate_citation` requires membership in the relevant set, not
    # just a well-formed string.
    seen_anchors: "set[str]" = set()
    catalogue_paths: "set[str]" = {ck.rel_path for ck in catalogue}
    catalogue_paths.add(key.rel_path)

    tool_executors = _build_tool_executors(key, source, catalogue, raw_cache, seen_anchors)

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

    envelope = _parse_pass1_response(
        response, seen_anchors=seen_anchors, catalogue_paths=catalogue_paths
    )
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
