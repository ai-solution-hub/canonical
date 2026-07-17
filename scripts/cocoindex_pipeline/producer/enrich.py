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
record-anchor FORM (`producer.frontmatter.is_valid_concept_resource_uri` —
relocated here by {132.41}; `producer.validator` still re-exports it
unchanged) or
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

**Memoisation (BI-18) — FIXED (ID-132 {132.38} G-MEMO-DELTA, MEMO-DELTA.md
MD-1..MD-11, owner-ratified DR-060, superseding the {132.35} G-DEPLOY-PROOF
Defect A escalation this docstring previously carried unfixed).**
`enrich_concept` is `@coco.fn(memo=True, memo_key={'source': None})`.

**`source` is EXCLUDED via `memo_key` (MD-2), not merely "not part of the
fingerprint's data-varying surface".** The engine fingerprints **every**
positional/keyword arg of a memoised call by default (`cocoindex==1.0.7`'s
`memo_fingerprint.fingerprint_call` → `_make_call_canonical`, `_internal/
memo_fingerprint.py:372-401`) — this is what made RUN 1 of the {132.35}
deploy proof fail 18/18 with `TypeError: Unsupported type for memoization
key: LRecordsSource` (`source` wraps a live, unpickleable `asyncpg.Pool`).
The fix is `memo_key={'source': None}`: a parameter mapped to `None` is
dropped from the fingerprint input BEFORE canonicalization
(`_internal/function.py:418-448`, empirically verified), so the unpickleable
adapter never reaches `_canonicalize`. `sources/l_records.py` stays
cocoindex-free — no memo protocol is added to `LRecordsSource` itself.

**The content-varying signal (Defect A's real fix): `ConceptKey.content_
version` (MD-3).** Excluding `source` alone is identity-only and would
silently serve stale drafts (DR-047 forbids this) — `ConceptKey` now carries
a `content_version: str = ""` field (`sources/l_records.py`, LAST field,
excluded from identity/routing/dedup/write-path per MD-4), populated by
`list_concepts()`'s six enumeration methods from a deterministic per-table
`count(*) + max(updated_at)` aggregate over each concept type's own backing
read grid (MD-5/6/7). `ConceptKey` is frozen, so `_canonicalize_dataclass`
(`memo_fingerprint.py:131-151`) fingerprints `content_version` like every
other field: an unchanged `content_version` memo-HITs (skip drafting, BI-18
no-op proof, MD-10); a changed one memo-MISSes (re-draft exactly that
concept, MD-6's over-invalidation-biased sensitivity contract).

**Config-surface invalidation is a MANUAL `version=` bump, NOT `deps=`
(DR-060, S469 owner ratification of OQ-MD-1 — the MD-8 `deps={...}`
auto-invalidation design in MEMO-DELTA.md's body text was NOT taken).** A
change to `PASS1_INSTRUCTION_PROMPT`/`ANTHROPIC_MODEL`/`_MAX_TOKENS_PASS1`
does **not** fold into the logic fingerprint and does **not** auto-invalidate
the corpus — OKF treats concepts as durable, curated, git-versioned
artefacts ("indefinite curation, not regeneration"), so a config-driven
re-draft is a **deliberate operator decision**: bump the `@coco.fn(...,
version=N)` kwarg by hand and record the reason in the bundle's OKF §7
`log.md` (`bundle_writer.append_log_entry`). The decorator therefore carries
NO `deps=` kwarg — data-change staleness stays fully covered by
`content_version` (MD-3/6/7) regardless.

**`PRODUCER_MODEL` (ID-132 {132.35} slice B, `producer/agent_loop.py`) falls
under this SAME contract.** `PRODUCER_MODEL` is a producer-scoped env
override of `ANTHROPIC_MODEL` (S481, DR-079: non-client bundles run
GLM-5.2) and is this function's own `model` default below — a deploy-time
`PRODUCER_MODEL` value change is drafting-config exactly like a literal
`ANTHROPIC_MODEL` edit, so it too requires the SAME manual `@coco.fn(...,
version=N)` bump + bundle `log.md` note before the next producer run, never
an auto `deps=` invalidation. No second `version=` bump lands in THIS
commit — `version=1` (below) has not yet been consumed by any deployed run.

**`PRODUCER_BASE_URL`/`PRODUCER_AUTH_TOKEN` (ID-132 {132.35} slice C,
`producer/agent_loop.py:producer_async_client`) fall under the SAME
contract too.** A deploy-time value change to either — e.g. rerouting the
producer to an Anthropic-compatible endpoint — is drafting-config
identically to a `PRODUCER_MODEL`/`ANTHROPIC_MODEL` edit: the SAME manual
`version=` bump + bundle `log.md` note applies, never an auto `deps=`
invalidation. No `version=` bump lands in THIS commit either.

**`PRODUCER_PROVIDER_ORDER` (ID-132 {132.35} slice D, `producer/agent_loop.
py:run_tool_use_loop`, DR-079) falls under the SAME contract too.** A
deploy-time value change — which OpenRouter provider slugs serve the
producer's requests — is drafting-config identically to `PRODUCER_MODEL`/
`PRODUCER_BASE_URL`/`PRODUCER_AUTH_TOKEN`: the SAME manual `version=` bump
+ bundle `log.md` note applies, never an auto `deps=` invalidation. No
`version=` bump lands in THIS commit either.

**`version=1` (S481, this bump — the lever exercised for the first time).**
`{132.41}`/`{132.42}` (bl-456/bl-477) both added 3 optional routing-hint keys
(`purpose`/`task`/`audience`) to `PASS1_INSTRUCTION_PROMPT` (a drafting-config
change) AND grew the emitted frontmatter to carry `confidence` (+hints when
supplied — an output-shape change). Per the manual-bump contract above, this
is bumped BEFORE the next deployed producer run (the `{132.35}` GLM-5.2
Run-1 BI-18 re-proof) so the corpus is treated as invalidated ahead of that
run, with the reason recorded in the bundle's `log.md` at that run.

**The effective ontology is excluded from the Pass-1 fingerprint (MD-9,
DR-054/DR-027).** `EffectiveOntology` governs the concept-**write** gate
({132.34}/{132.35}), not this draft — zero ontology imports exist in this
module, `agent_loop.py`, or `prompts.py`. An overlay change must never
re-draft a concept; if a future change threads the ontology into Pass-1
prompting, it MUST then join the manual `version=` lever above (forward
guard, MD-9).

See `scripts/tests/test_l_records_source.py::TestMemoKeyProtocolEscalation`
(evolved MD-11) and `scripts/tests/test_producer_enrich.py::
TestMemoisationProxy` for the executable trace.

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

from scripts.cocoindex_pipeline.extraction import _strip_code_fence
from scripts.cocoindex_pipeline.producer.agent_loop import (
    LIST_CONCEPTS_TOOL,
    PASS1_TOOLS,
    PRODUCER_MODEL,
    producer_async_client,
    run_tool_use_loop,
)
from scripts.cocoindex_pipeline.producer.frontmatter import (
    ConceptFrontmatter,
    build_concept_frontmatter,
    derive_concept_confidence,
    render_concept_frontmatter,
)
from scripts.cocoindex_pipeline.producer.prompts import PASS1_INSTRUCTION_PROMPT
from scripts.cocoindex_pipeline.producer.resource_uri import (
    build_q_a_pairs_query_uri,
    build_reference_item_uri,
    build_source_document_uri,
    citation_target,
    concept_citation_path,
    is_canonical_resource_uri,
)
from scripts.cocoindex_pipeline.producer.validator import (
    is_valid_concept_resource_uri,
    render_citations_trailer,
)
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
    PROMPT` asks the model for.

    `purpose`/`task`/`audience` (bl-456 routing hints, ID-132
    FRONTMATTER-WAVE) are OPTIONAL, model-authored terminal-JSON keys — read
    if present, `None` when the model omits them (they are deliberately NOT
    in `_REQUIRED_ENVELOPE_KEYS`)."""

    title: str
    description: str
    tags: "tuple[str, ...]"
    body: str
    citations: "tuple[str, ...]"
    purpose: "str | None" = None
    task: "str | None" = None
    audience: "str | None" = None


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

    `{132.28}` G-ENRICH-WONBID-WIRE: `workspaces`/`form_templates` were
    populated ONLY by the won-bid case_study grain ({132.21}, S443
    amendment) — buyer identity (`workspaces`) + `outcome_notes`
    (`form_templates`) reached the model verbatim, unadorned like
    `q_a_pairs`/`record_lifecycle`/`entity_mentions`/`entity_relationships`
    above: no `resource_uri.py` builder exists for either table (TECH.md's
    case_study "Anchors emitted" column names only
    `source_documents`/`reference_items`), so no anchor is minted for them
    here. **{145.24}** (post-{145.6} W1e workspace-stratum drop):
    `raw.workspaces` is now ALWAYS `[]` (the `l_records.py` won-bid read no
    longer fetches a `workspaces` row — there is none left to fetch); buyer
    identity now reaches the model via `raw.form_templates`
    (`issuing_organisation`/`name`) instead, kept under its pre-rename
    `ConceptRaw` field name (the underlying table is `form_instances`) — see
    `sources/l_records.py`'s module docstring for the full re-point
    rationale."""
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
    # SPEC §5.1/§8 tolerance: an entry may arrive as a numbered/markdown
    # link (`[n] [label](target)`) or a `/`-leading bundle-absolute path —
    # normalise to the bare TARGET first, then validate exactly as before.
    entry = citation_target(entry)
    if not entry:
        raise Pass1DraftError(
            "enrich_concept: citation entry resolves to an empty target"
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


def _read_optional_hint(payload: "Mapping[str, Any]", key: str) -> "str | None":
    """bl-456 routing hints (`purpose`/`task`/`audience`) — OPTIONAL,
    model-authored terminal-JSON keys. Per FRONTMATTER-WAVE.md's field
    table these get "no positive shape check" (unlike the required `title`/
    `description`/`body`): a missing key, an explicit `null`, a non-string
    value, or a blank string are all treated as "the model did not supply
    this hint" and the field is OMITTED from the emitted frontmatter
    entirely (`build_concept_frontmatter`'s BI-10 stray-pointer guard still
    runs on whatever string value IS returned here)."""
    value = payload.get(key)
    if not isinstance(value, str) or not value.strip():
        return None
    return value


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
        purpose=_read_optional_hint(payload, "purpose"),
        task=_read_optional_hint(payload, "task"),
        audience=_read_optional_hint(payload, "audience"),
    )


def _render_citations_section(citations: "Sequence[str]") -> str:
    """Renders the SPEC §5.1/§8 numbered-link `# Citations` trailer via the
    SINGLE shared renderer `producer/validator.py:render_citations_trailer`
    (which `_citation_entries` parses back out, so `{132.9}`/`{132.12}`'s
    `detect_citation_shrink` augmentation guard reads this section
    correctly). Cross-link labels are the bare rel_path here — target
    concept titles are not resolvable at draft time; `{132.10}`'s
    bundle-writer re-normalises with a run-wide titles map at write time."""
    return render_citations_trailer(citations)


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


@coco.fn(memo=True, memo_key={"source": None}, version=1)
async def enrich_concept(
    key: ConceptKey,
    source: Source,
    *,
    model: str = PRODUCER_MODEL,
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
    TextBlocks concatenated). `@coco.fn(memo=True, memo_key={'source': None},
    version=1)` on the frozen `key` (BI-18, {132.38} G-MEMO-DELTA, DR-060):
    `source` is excluded via `memo_key` (MD-2) so the unpickleable
    `LRecordsSource` never reaches the fingerprint; `key.content_version`
    (MD-3) is the BI-18 delta signal — see the module docstring for the full
    mechanism, and note a drafting-config change (prompt/model/max_tokens —
    a `PRODUCER_MODEL` env override counts identically to a literal
    `ANTHROPIC_MODEL` edit, {132.35} slice B) is a MANUAL `version=` bump
    recorded in the bundle's `log.md`, never an auto `deps=` invalidation.
    `version=1` (S481, this bump) is DR-060's contract
    exercised for real: {132.41}/{132.42} added 3 optional routing-hint keys
    to `PASS1_INSTRUCTION_PROMPT` and grew the emitted frontmatter to carry
    `confidence` (+hints when supplied) — both a drafting-config change and
    an output-shape change, so the corpus must be treated as invalidated
    ahead of the {132.35} GLM-5.2 Run-1 re-proof (a bundle `log.md` entry is
    recorded at that producer run per the DR-060 contract).
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

    client = producer_async_client()
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
        purpose=envelope.purpose,
        task=envelope.task,
        audience=envelope.audience,
        # A19 (bl-477) — deterministic, NEVER model-authored (FRONTMATTER-
        # WAVE.md); derived from the SAME `(resource, citations)` this call
        # already resolved, not asked of the model.
        confidence=derive_concept_confidence(resource=resource, citations=envelope.citations),
    )
    body = f"{envelope.body.rstrip()}\n\n{_render_citations_section(envelope.citations)}"
    return ConceptDraft(key=key, frontmatter=frontmatter, body=body)
