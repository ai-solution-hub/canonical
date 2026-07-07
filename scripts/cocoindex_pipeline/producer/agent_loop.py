"""Anthropic tool-use agent loop + Pass-1 tool definitions for the OKF
concept producer — ID-132 {132.5} G-LOOP.

Ports the reference_agent's ADK+Gemini agent loop onto the Anthropic
tool-use surface `extraction.py` already runs, per
`docs/specs/id-132-okf-concept-producer/TECH.md` §'The agent-loop port —
ADK+Gemini → Anthropic'. This is NET-NEW external API usage in the
pipeline: the existing 4 extractors in `extraction.py` call plain
`messages.create` / `messages.stream` with NO `tools=` — the tool-use
surface (`tools=`, `tool_choice=`, `ToolUseBlock`/`ToolResultBlockParam`
turns) was empirically import-and-call verified against the pinned
`anthropic==0.79.0` before this port (TECH §Empirical verification).

Reuses 3 `extraction.py` anchors verified at head rather than
reimplementing them:

  - `ANTHROPIC_MODEL` (extraction.py:71) — default `model`.
  - `_anthropic_retry` (extraction.py:916) — the tenacity 503/rate-limit/
    connection retry wrapper around each `messages.create` call.
  - `_guard_not_truncated` (extraction.py:862) — raises
    `TruncatedExtractionError` (also extraction.py) when a turn hits the
    `max_tokens` ceiling, so a truncated tool-use turn or final body
    surfaces loudly instead of as a downstream parse error.

Scope (per the {132.5} brief): the GENERIC loop + the Pass-1 tool SCHEMAS
only (`READ_CONCEPT_RAW_TOOL`, `SAMPLE_ROWS_TOOL` — the Source-adapter
tools). Tool executors are taken as INJECTABLE callables (`ToolExecutor`) —
wiring this loop's tool names to the real L-records Source-adapter methods
(`read_concept_raw` → `LRecordsSource.read_concept`, `sample_rows` →
`LRecordsSource.sample_rows`) happens in `enrich_concept` ({132.8}), not
in this module.

**`WEB_FETCH_TOOL` ({132.9} G-PASS2).** The net-new Pass-2 gated-fetch tool
SCHEMA lives here (alongside the Pass-1 schemas, same `ToolParam`
empirical-verification posture) — kept OUT of `PASS1_TOOLS` (BI-15: Pass-1
makes zero web calls) exactly as `LIST_CONCEPTS_TOOL` is; `producer/
web_pass.py` composes its own Pass-2 tool list `[READ_CONCEPT_RAW_TOOL,
SAMPLE_ROWS_TOOL, LIST_CONCEPTS_TOOL, WEB_FETCH_TOOL]` at its `run_web_pass`
call site, mirroring `{132.8}`'s `_PASS1_TOOLS_WITH_CATALOGUE` composition
pattern. The host-allowlist/depth-limit/path-filter GATE itself is
`web_pass.py`'s concern, not this module's — this schema only describes the
tool's shape to the model.

**Soft-error `is_error` propagation (S451 rider, {132.9}).** A tool
executor's soft-error convention (a `Mapping` result carrying an `'error'`
key — `producer/enrich.py`'s `_read_concept_raw`/`_sample_rows` unknown-ref
recovery, and `web_pass.py`'s `fetch_url` host/depth/path-filter refusal)
now sets Anthropic's `is_error: true` on the constructed `tool_result`
block, so the model treats it as retryable rather than as an ordinary
result (TECH-ADDENDUM-reference-agents.md `{132.5}` retro-check,
agent_loop.py:188-229 — the loop already surfaced the dict as JSON text via
`_stringify_tool_result` but never set `is_error`, the one gap that finding
named). A genuine executor EXCEPTION still propagates unchanged (kills the
loop, per this module's "escalate, don't paper over" posture below) — only
a `Mapping`-with-`'error'`-key RETURN VALUE is treated as a soft, model-
recoverable failure.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Awaitable, Callable, Mapping
from typing import Any

import anthropic
from anthropic.types import MessageParam, ToolParam, ToolResultBlockParam

from scripts.cocoindex_pipeline.extraction import (
    ANTHROPIC_MODEL,
    _anthropic_retry,
    _guard_not_truncated,
)

_logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Pass-1 tool definitions — the Source-adapter tools only (BI-15: Pass-1
# drafts from L-records ONLY, no web access). Anthropic `ToolParam` shape
# empirically verified against anthropic==0.79.0 (TECH §Empirical
# verification).
# ---------------------------------------------------------------------------

READ_CONCEPT_RAW_TOOL: ToolParam = {
    "name": "read_concept_raw",
    "description": (
        "Read the raw backing L-record data for a single concept — the "
        "joined source_documents / q_a_pairs / reference_items / "
        "entity_mentions rows the Source adapter's read_concept(ref) "
        "resolves for this concept. Use this to ground the drafted concept "
        "body in the concept's actual backing records before synthesising "
        "prose — never copy the raw text verbatim into the concept body."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "ref": {
                "type": "string",
                "description": (
                    "The concept identity — its bundle rel_path (e.g. "
                    "'products/lms.md') — identifying which concept's raw "
                    "record data to read."
                ),
            },
        },
        "required": ["ref"],
    },
}

SAMPLE_ROWS_TOOL: ToolParam = {
    "name": "sample_rows",
    "description": (
        "Return a bounded sample of a concept's backing rows, for grounding "
        "the Pass-1 prompt context window without pulling the full record "
        "set (which can blow max_tokens for a large answer-cluster)."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "concept": {
                "type": "string",
                "description": (
                    "The concept identity (bundle rel_path) to sample "
                    "backing rows for."
                ),
            },
            "n": {
                "type": "integer",
                "description": "Maximum number of backing rows to return.",
                "minimum": 1,
            },
        },
        "required": ["concept", "n"],
    },
}

# Pass-1 tool set (TECH: `tools: list[ToolParam] = [READ_CONCEPT_RAW_TOOL,
# SAMPLE_ROWS_TOOL, ...]   # Pass-2 adds WEB_FETCH_TOOL`).
PASS1_TOOLS: list[ToolParam] = [READ_CONCEPT_RAW_TOOL, SAMPLE_ROWS_TOOL]

# S451 rider fold-in 2 (TECH-ADDENDUM-reference-agents.md, `{132.5}` retro-
# check finding at agent_loop.py:116) — the reference's `build_bq_agent`
# registers a THIRD tool, `list_concepts`, used for cross-linking
# (`reference_instruction.md` workflow step 4, "weave cross-links" = BI-9
# concept→concept citation by path). Kept OUT of `PASS1_TOOLS` itself
# (a load-bearing constant a sibling test pins exactly to the two
# Source-adapter tools) — `{132.8}` `producer/enrich.py` composes its own
# tool list `[*PASS1_TOOLS, LIST_CONCEPTS_TOOL]` at the `enrich_concept`
# call site instead.
LIST_CONCEPTS_TOOL: ToolParam = {
    "name": "list_concepts",
    "description": (
        "List every concept in the bundle's catalogue — its bundle rel_path "
        "and concept type. Use this to find concepts to cross-link: where "
        "this concept is clearly related to another one in the catalogue, "
        "cite the target concept's bundle rel_path (e.g. 'products/lms.md') "
        "as a BI-9 concept-to-concept citation — never a canonical:// uri "
        "and never a bare database id for a concept cross-link."
    ),
    "input_schema": {
        "type": "object",
        "properties": {},
        "required": [],
    },
}

# {132.9} G-PASS2 — the net-new gated-fetch tool (BI-16). Kept OUT of
# `PASS1_TOOLS` for the same reason as `LIST_CONCEPTS_TOOL`: Pass-1 makes
# ZERO web calls (BI-15). `producer/web_pass.py`'s `_check_gate` (host-
# allowlist + depth-limit + path-filter) refuses any URL outside the
# client's own gated corpus BEFORE any fetch — the description below tells
# the model that refusal is a normal, retryable outcome (an `is_error`
# `tool_result` per the module docstring's soft-error section), not a
# reason to give up on Pass-2 entirely.
WEB_FETCH_TOOL: ToolParam = {
    "name": "fetch_url",
    "description": (
        "Fetch a page from the client's OWN gated authoritative-source "
        "corpus — Pass-2 ONLY, never the open web. The URL's host must be "
        "on the Pass-2 host-allowlist and its path within the configured "
        "depth-limit and path-filter; a URL outside the gate is REFUSED "
        "(retry with a different, in-corpus URL rather than guessing). A "
        "successful fetch returns the page's distilled text content plus a "
        "'resource' canonical://reference_items/<uuid> anchor — copy it "
        "verbatim into your 'citations' array for any fact you draw from "
        "it; never invent this anchor yourself."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "url": {
                "type": "string",
                "description": (
                    "The absolute http(s) URL to fetch, drawn from the "
                    "client's own authoritative site-structure corpus."
                ),
            },
        },
        "required": ["url"],
    },
}


# ---------------------------------------------------------------------------
# Injectable tool-executor contract
# ---------------------------------------------------------------------------

# One async callable per tool name, taking the `ToolUseBlock.input` mapping
# and returning a JSON-serialisable (or already-string) result. Wiring the
# real Source-adapter methods to these names is {132.8}'s job.
ToolExecutor = Callable[[Mapping[str, Any]], Awaitable[Any]]


class AgentLoopError(RuntimeError):
    """Raised when the agent loop cannot execute a `tool_use` block — no
    executor is registered for the requested tool name. Fails loudly
    (mirrors `TruncatedExtractionError`'s posture in extraction.py) rather
    than silently dropping the tool call or sending a malformed empty
    `tool_result`."""


def _stringify_tool_result(result: Any) -> str:
    """Coerce a tool executor's return value into the string content
    `ToolResultBlockParam.content` expects.

    Executors may return an already-formatted string, or a JSON-serialisable
    structure (dict/list — the shape `sample_rows`/`read_concept_raw`'s real
    adapter methods return, per TECH §Source adapter). The latter is
    rendered via `json.dumps` so the model receives valid JSON text rather
    than a Python `repr()`.
    """
    if isinstance(result, str):
        return result
    return json.dumps(result, default=str)


def _tool_result_is_error(result: Any) -> bool:
    """S451 rider — True iff `result` is the soft-error shape a tool
    executor returns for a MODEL-RECOVERABLE failure: a `Mapping` carrying
    an `'error'` key. `producer/enrich.py`'s `_read_concept_raw`/
    `_sample_rows` (unknown ref) and `producer/web_pass.py`'s `fetch_url`
    (host/depth/path-filter refusal) both already return this shape.
    Detected on the RAW pre-`_stringify_tool_result` value (a `Mapping`
    check), not the stringified content — a plain string result (even one
    that happens to contain the substring "error") never sets `is_error`."""
    return isinstance(result, Mapping) and "error" in result


async def run_tool_use_loop(
    *,
    client: anthropic.AsyncAnthropic,
    messages: list[MessageParam],
    tools: list[ToolParam],
    tool_executors: Mapping[str, ToolExecutor],
    system: list[Mapping[str, Any]],
    extractor_name: str,
    max_tokens: int,
    model: str = ANTHROPIC_MODEL,
) -> anthropic.types.Message:
    """The Anthropic tool-use agent loop (TECH §'The agent-loop port').

    Grows `messages` IN PLACE, turn by turn — an assistant `tool_use` turn
    followed by a user `tool_result` turn — until the model responds with a
    non-`tool_use` `stop_reason` (the final concept body), then returns
    that terminal `Message`. The seed `messages` list (the initial user
    prompt) is supplied by the caller and is the SAME list mutated across
    iterations, matching the TECH pseudocode's `messages: list[
    MessageParam] = [...]` declared once, outside the loop.

    Each iteration:
      1. `_anthropic_retry(lambda: client.messages.create(...))` — reuses
         extraction.py's tenacity retry wrapper (503 / rate-limit /
         connection errors retry; auth/bad-request propagate immediately).
      2. `_guard_not_truncated(resp, extractor_name, max_tokens)` — reuses
         extraction.py's `max_tokens`-ceiling guard.
      3. If `resp.stop_reason != "tool_use"`, RETURN `resp` immediately —
         the final turn is NOT appended to `messages` (the loop's job is
         producing this terminal response, not managing conversation
         history beyond it).
      4. Otherwise append the assistant `tool_use` turn, execute every
         `tool_use` content block via its registered `tool_executors`
         callable, and append a user turn carrying one `tool_result` block
         per executed tool call (`is_error: true` set when the executor
         returned a soft-error `Mapping` — see `_tool_result_is_error`) —
         then repeat.

    Raises `AgentLoopError` if a `tool_use` block names a tool with no
    registered executor. Tool-executor EXCEPTIONS still propagate (matches
    the KH "escalate, don't paper over" posture; a raised exception here
    means the caller's Source adapter / gated fetch genuinely failed in an
    unrecoverable way and should not retry as if it were a normal
    tool_result) — only a `Mapping`-with-`'error'`-key RETURN VALUE is
    treated as a soft, model-recoverable failure and gets `is_error: true`
    on its `tool_result` block (S451 rider).
    """
    while True:
        resp = await _anthropic_retry(
            lambda: client.messages.create(
                model=model,
                max_tokens=max_tokens,
                system=system,
                messages=messages,
                tools=tools,
                tool_choice={"type": "auto"},
            )
        )
        _guard_not_truncated(resp, extractor_name, max_tokens)
        if resp.stop_reason != "tool_use":
            return resp  # final concept body — loop terminates

        messages.append({"role": "assistant", "content": resp.content})

        tool_results: list[ToolResultBlockParam] = []
        for block in resp.content:
            if getattr(block, "type", None) != "tool_use":
                continue
            executor = tool_executors.get(block.name)
            if executor is None:
                raise AgentLoopError(
                    f"{extractor_name}: no tool executor registered for "
                    f"tool_use block name={block.name!r} (id={block.id})"
                )
            result = await executor(block.input)
            tool_result: ToolResultBlockParam = {
                "type": "tool_result",
                "tool_use_id": block.id,
                "content": _stringify_tool_result(result),
            }
            if _tool_result_is_error(result):
                tool_result["is_error"] = True
            tool_results.append(tool_result)

        messages.append({"role": "user", "content": tool_results})
