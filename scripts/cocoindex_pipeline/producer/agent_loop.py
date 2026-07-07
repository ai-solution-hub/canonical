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
tools). `WEB_FETCH_TOOL` belongs to Pass-2 ({132.9} G-PASS2), not here.
Tool executors are taken as INJECTABLE callables (`ToolExecutor`) — wiring
this loop's tool names to the real L-records Source-adapter methods
(`read_concept_raw` → `LRecordsSource.read_concept`, `sample_rows` →
`LRecordsSource.sample_rows`) happens in `enrich_concept` ({132.8}), not
in this module.
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
         per executed tool call — then repeat.

    Raises `AgentLoopError` if a `tool_use` block names a tool with no
    registered executor. Tool-executor exceptions propagate (no silent
    is_error swallowing — matches the KH "escalate, don't paper over"
    posture; a raised exception here means the {132.8} caller's Source
    adapter genuinely failed and should not retry as if it were a normal
    tool_result).
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
            tool_results.append(
                {
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "content": _stringify_tool_result(result),
                }
            )

        messages.append({"role": "user", "content": tool_results})
