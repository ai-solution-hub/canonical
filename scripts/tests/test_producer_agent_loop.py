"""Unit tests for the Anthropic tool-use agent loop — ID-132 {132.5} G-LOOP.

Ports the reference_agent's ADK+Gemini agent loop onto the Anthropic
tool-use surface `extraction.py` already runs
(`scripts/cocoindex_pipeline/producer/agent_loop.py`). Per the {132.5}
testStrategy:

  - a `stop_reason == 'tool_use'` response triggers tool execution (via an
    injected async executor) and appends a `tool_result` user turn;
  - a final (non-`tool_use`) response terminates the loop and is returned;
  - `_guard_not_truncated` and `_anthropic_retry` (both reused from
    `extraction.py`, NOT reimplemented) are exercised.

No live API calls anywhere in this file — `client.messages.create` is
mocked at the boundary (mirrors `test_cocoindex_extractor_retry.py`'s
`AsyncAnthropic` mocking pattern for the same two reuse anchors).

Test philosophy: docs/reference/test-philosophy.md — assertions are on the
resulting `Message`, the mutated `messages` conversation list, and the
`tool_result` shape (state), not on internal call sequences beyond the SDK
call-count needed to prove retry/loop iteration actually happened.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import anthropic
import pytest
from anthropic.types import TextBlock, ToolUseBlock

# ── Path setup — mirrors test_cocoindex_extractor_retry.py: the repo ROOT
# (not `scripts/`) must be on sys.path for the `scripts.` package prefix to
# resolve to the production-canonical namespace. ──────────────────────────

_REPO_ROOT = Path(__file__).resolve().parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from scripts.cocoindex_pipeline.extraction import (  # noqa: E402
    TruncatedExtractionError,
)
from scripts.cocoindex_pipeline.producer.agent_loop import (  # noqa: E402
    PASS1_TOOLS,
    READ_CONCEPT_RAW_TOOL,
    SAMPLE_ROWS_TOOL,
    AgentLoopError,
    run_tool_use_loop,
)


# ── Test stubs ──────────────────────────────────────────────────────────────


class _MockMessage:
    """Duck-typed stand-in for `anthropic.types.Message` — mirrors the
    `_MockMessageResponse` pattern in `test_cocoindex_extractor_retry.py`.
    Only `.content` / `.stop_reason` are read by the loop and by the reused
    `_guard_not_truncated` / `_anthropic_retry` extraction.py helpers, so a
    full `Message` (with `id`/`model`/`usage`/...) is unnecessary ceremony."""

    def __init__(self, content: list[Any], stop_reason: str) -> None:
        self.content = content
        self.stop_reason = stop_reason


def _mock_client(side_effects: list[Any]) -> MagicMock:
    """A MagicMock AsyncAnthropic client whose `messages.create(...)` replays
    one `side_effects` item per call — raising it if it's an exception,
    else returning it as the awaited response (standard AsyncMock
    `side_effect`-list semantics; `create` is a plain async call, unlike the
    `messages.stream()` context-manager the 3 extraction.py extractors use,
    so no stream-manager wrapper is needed here)."""
    client = MagicMock(name="AsyncAnthropic_instance")
    client.messages.create = AsyncMock(side_effect=side_effects)
    return client


def _make_anthropic_error(cls: type[anthropic.APIError]) -> anthropic.APIError:
    """Build an anthropic error instance bypassing the response-requiring
    constructor — sufficient for `isinstance()` checks inside tenacity.
    Duplicated from `test_cocoindex_extractor_retry.py` (DAMP over DRY —
    no shared test helper currently exists for this)."""
    err = cls.__new__(cls)
    err.message = f"Test {cls.__name__}"
    return err


# ── pytest fixtures ─────────────────────────────────────────────────────────


@pytest.fixture(autouse=True)
def _fake_api_key(monkeypatch: pytest.MonkeyPatch) -> None:
    """Set a dummy ANTHROPIC_API_KEY — belt-and-braces even though the SDK
    client is mocked, matching the sibling retry-test convention."""
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-dummy-key-for-mocked-tests")


@pytest.fixture(autouse=True)
def _fast_retry_wait(monkeypatch: pytest.MonkeyPatch) -> None:
    """Zero out the tenacity backoff so retry tests don't sleep the real
    1-2-4 s ladder — same module-level hook `test_cocoindex_extractor_retry.py`
    uses (`_anthropic_retry` reads these constants from `extraction.py` at
    call time, so patching the extraction module affects the loop's reuse
    of the same wrapper)."""
    monkeypatch.setattr(
        "scripts.cocoindex_pipeline.extraction._ANTHROPIC_RETRY_WAIT_SECONDS_MIN",
        0.0,
        raising=False,
    )
    monkeypatch.setattr(
        "scripts.cocoindex_pipeline.extraction._ANTHROPIC_RETRY_WAIT_SECONDS_MAX",
        0.0,
        raising=False,
    )


def _seed_messages(content: str = "draft this concept") -> list[dict[str, Any]]:
    return [{"role": "user", "content": content}]


# ============================================================================
# TOOL DEFINITIONS — Pass-1 ToolParam schemas
# ============================================================================


class TestToolDefinitions:
    def test_pass1_tools_is_read_concept_raw_and_sample_rows_only(self) -> None:
        """WEB_FETCH_TOOL is G-PASS2 ({132.9}) — NOT this Subtask's tool set."""
        assert PASS1_TOOLS == [READ_CONCEPT_RAW_TOOL, SAMPLE_ROWS_TOOL]

    def test_read_concept_raw_tool_schema_requires_ref(self) -> None:
        assert READ_CONCEPT_RAW_TOOL["name"] == "read_concept_raw"
        schema = READ_CONCEPT_RAW_TOOL["input_schema"]
        assert schema["type"] == "object"
        assert schema["required"] == ["ref"]
        assert "ref" in schema["properties"]

    def test_sample_rows_tool_schema_requires_concept_and_n(self) -> None:
        assert SAMPLE_ROWS_TOOL["name"] == "sample_rows"
        schema = SAMPLE_ROWS_TOOL["input_schema"]
        assert schema["type"] == "object"
        assert set(schema["required"]) == {"concept", "n"}


# ============================================================================
# LOOP TERMINATION — a final (non-tool_use) response ends the loop
# ============================================================================


class TestLoopTerminatesOnFinalResponse:
    def test_non_tool_use_stop_reason_returns_final_message_without_mutating_messages(
        self,
    ) -> None:
        final = _MockMessage(
            [TextBlock(type="text", text="the concept body")],
            stop_reason="end_turn",
        )
        client = _mock_client([final])
        messages = _seed_messages()

        async def _exercise() -> Any:
            return await run_tool_use_loop(
                client=client,
                messages=messages,
                tools=PASS1_TOOLS,
                tool_executors={},
                system=[{"type": "text", "text": "system prompt"}],
                extractor_name="enrich_concept",
                max_tokens=4096,
            )

        result = asyncio.run(_exercise())

        assert result is final
        assert result.content[0].text == "the concept body"
        # No tool_use turn happened ⇒ the seed message list is untouched.
        assert messages == _seed_messages()
        assert client.messages.create.call_count == 1


# ============================================================================
# TOOL EXECUTION — a tool_use response triggers the executor + a tool_result
# turn, then the loop continues until a final response terminates it
# ============================================================================


class TestLoopExecutesToolUseAndAppendsToolResultTurn:
    def test_tool_use_response_triggers_executor_and_appends_tool_result_then_returns_final(
        self,
    ) -> None:
        tool_use_block = ToolUseBlock(
            type="tool_use",
            id="toolu_1",
            name="read_concept_raw",
            input={"ref": "products/lms.md"},
        )
        tool_turn = _MockMessage([tool_use_block], stop_reason="tool_use")
        final = _MockMessage(
            [TextBlock(type="text", text="body grounded in the raw record")],
            stop_reason="end_turn",
        )
        client = _mock_client([tool_turn, final])
        messages = _seed_messages("draft products/lms.md")

        calls: list[Any] = []

        async def _read_concept_raw(tool_input: Any) -> dict[str, Any]:
            calls.append(tool_input)
            return {"rel_path": tool_input["ref"], "rows": ["doc-1", "doc-2"]}

        async def _exercise() -> Any:
            return await run_tool_use_loop(
                client=client,
                messages=messages,
                tools=PASS1_TOOLS,
                tool_executors={"read_concept_raw": _read_concept_raw},
                system=[{"type": "text", "text": "system prompt"}],
                extractor_name="enrich_concept",
                max_tokens=4096,
            )

        result = asyncio.run(_exercise())

        assert result is final
        assert calls == [{"ref": "products/lms.md"}]
        assert client.messages.create.call_count == 2

        # Turn 1: the assistant tool_use turn is appended verbatim...
        assert messages[1] == {"role": "assistant", "content": [tool_use_block]}
        # ...followed by a user turn carrying exactly one tool_result block.
        assert messages[2]["role"] == "user"
        tool_result = messages[2]["content"][0]
        assert tool_result["type"] == "tool_result"
        assert tool_result["tool_use_id"] == "toolu_1"
        assert "products/lms.md" in tool_result["content"]
        assert "doc-1" in tool_result["content"]
        # The terminal (final) turn is NOT appended — the loop returns
        # before appending on a non-tool_use stop_reason.
        assert len(messages) == 3

    def test_tool_use_for_unregistered_tool_raises_agent_loop_error(self) -> None:
        """An executor map that doesn't cover a requested tool name fails
        loudly (AgentLoopError) rather than silently skipping the tool_use
        block or sending a malformed empty tool_result."""
        tool_use_block = ToolUseBlock(
            type="tool_use",
            id="toolu_9",
            name="sample_rows",
            input={"concept": "products/lms.md", "n": 5},
        )
        tool_turn = _MockMessage([tool_use_block], stop_reason="tool_use")
        client = _mock_client([tool_turn])
        messages = _seed_messages()

        async def _exercise() -> Any:
            await run_tool_use_loop(
                client=client,
                messages=messages,
                tools=PASS1_TOOLS,
                tool_executors={},  # no sample_rows executor registered
                system=[{"type": "text", "text": "system prompt"}],
                extractor_name="enrich_concept",
                max_tokens=4096,
            )

        with pytest.raises(AgentLoopError, match="sample_rows"):
            asyncio.run(_exercise())


# ============================================================================
# _guard_not_truncated REUSE — a max_tokens cutoff raises loudly
# ============================================================================


class TestGuardNotTruncatedIsExercised:
    def test_max_tokens_stop_reason_raises_truncated_extraction_error(self) -> None:
        truncated = _MockMessage(
            [TextBlock(type="text", text="cut off mid")],
            stop_reason="max_tokens",
        )
        client = _mock_client([truncated])
        messages = _seed_messages()

        async def _exercise() -> Any:
            await run_tool_use_loop(
                client=client,
                messages=messages,
                tools=PASS1_TOOLS,
                tool_executors={},
                system=[{"type": "text", "text": "system prompt"}],
                extractor_name="enrich_concept",
                max_tokens=128,
            )

        with pytest.raises(TruncatedExtractionError, match="enrich_concept"):
            asyncio.run(_exercise())


# ============================================================================
# _anthropic_retry REUSE — transient errors retry, exhaustion propagates
# ============================================================================


class TestAnthropicRetryIsExercised:
    def test_one_transient_error_then_success_retries_via_anthropic_retry(
        self,
    ) -> None:
        final = _MockMessage(
            [TextBlock(type="text", text="the concept body")],
            stop_reason="end_turn",
        )
        side_effects = [_make_anthropic_error(anthropic.InternalServerError), final]
        client = _mock_client(side_effects)
        messages = _seed_messages()

        async def _exercise() -> Any:
            return await run_tool_use_loop(
                client=client,
                messages=messages,
                tools=PASS1_TOOLS,
                tool_executors={},
                system=[{"type": "text", "text": "system prompt"}],
                extractor_name="enrich_concept",
                max_tokens=4096,
            )

        result = asyncio.run(_exercise())

        assert result is final
        # 1 failed attempt + 1 successful retry attempt.
        assert client.messages.create.call_count == 2

    def test_four_transient_errors_exhausts_retries_and_raises(self) -> None:
        """3 retries means 4 total attempts (matches extraction.py's
        `_ANTHROPIC_RETRY_TOTAL_ATTEMPTS`); the 4th failure propagates."""
        side_effects = [
            _make_anthropic_error(anthropic.InternalServerError) for _ in range(4)
        ]
        client = _mock_client(side_effects)
        messages = _seed_messages()

        async def _exercise() -> None:
            await run_tool_use_loop(
                client=client,
                messages=messages,
                tools=PASS1_TOOLS,
                tool_executors={},
                system=[{"type": "text", "text": "system prompt"}],
                extractor_name="enrich_concept",
                max_tokens=4096,
            )

        with pytest.raises(anthropic.InternalServerError):
            asyncio.run(_exercise())
        assert client.messages.create.call_count == 4
