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
import importlib
import inspect
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
from scripts.cocoindex_pipeline.producer import agent_loop as _agent_loop_module  # noqa: E402
from scripts.cocoindex_pipeline.producer.agent_loop import (  # noqa: E402
    PASS1_TOOLS,
    READ_CONCEPT_RAW_TOOL,
    SAMPLE_ROWS_TOOL,
    WEB_FETCH_TOOL,
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

    def test_web_fetch_tool_schema_requires_url(self) -> None:
        """{132.9} G-PASS2 — the net-new gated-fetch tool. Kept OUT of
        `PASS1_TOOLS` (Pass-1 makes zero web calls, BI-15) — `{132.9}`
        `producer/web_pass.py` composes its own Pass-2 tool list."""
        assert WEB_FETCH_TOOL["name"] == "fetch_url"
        schema = WEB_FETCH_TOOL["input_schema"]
        assert schema["type"] == "object"
        assert schema["required"] == ["url"]
        assert "url" in schema["properties"]

    def test_web_fetch_tool_is_not_in_pass1_tools(self) -> None:
        assert WEB_FETCH_TOOL not in PASS1_TOOLS


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
# SOFT-ERROR is_error PROPAGATION (S451 rider, {132.9}) — a `{"error": ...}`
# dict an executor returns (the soft-error convention `producer/enrich.py`'s
# `_read_concept_raw`/`_sample_rows` and `producer/web_pass.py`'s
# `fetch_url` already use for a model-recoverable failure) sets Anthropic's
# `is_error: true` on the constructed `tool_result` block, so the model
# treats it as retryable (TECH-ADDENDUM-reference-agents.md `{132.5}`
# retro-check, agent_loop.py:188-229 — the shipped loop surfaced the dict as
# ordinary JSON text but never set `is_error`).
# ============================================================================


class TestSoftErrorSetsIsErrorOnToolResult:
    def test_error_dict_result_sets_is_error_true_on_tool_result_block(
        self,
    ) -> None:
        tool_use_block = ToolUseBlock(
            type="tool_use",
            id="toolu_1",
            name="read_concept_raw",
            input={"ref": "products/does-not-exist.md"},
        )
        tool_turn = _MockMessage([tool_use_block], stop_reason="tool_use")
        final = _MockMessage(
            [TextBlock(type="text", text="recovered")], stop_reason="end_turn"
        )
        client = _mock_client([tool_turn, final])
        messages = _seed_messages()

        async def _soft_error_executor(_tool_input: Any) -> dict[str, Any]:
            return {"error": "unknown concept ref"}

        async def _exercise() -> Any:
            return await run_tool_use_loop(
                client=client,
                messages=messages,
                tools=PASS1_TOOLS,
                tool_executors={"read_concept_raw": _soft_error_executor},
                system=[{"type": "text", "text": "system prompt"}],
                extractor_name="enrich_concept",
                max_tokens=4096,
            )

        asyncio.run(_exercise())

        tool_result = messages[2]["content"][0]
        assert tool_result["is_error"] is True
        assert "unknown concept ref" in tool_result["content"]

    def test_success_dict_result_does_not_set_is_error(self) -> None:
        tool_use_block = ToolUseBlock(
            type="tool_use",
            id="toolu_1",
            name="read_concept_raw",
            input={"ref": "products/lms.md"},
        )
        tool_turn = _MockMessage([tool_use_block], stop_reason="tool_use")
        final = _MockMessage(
            [TextBlock(type="text", text="grounded body")], stop_reason="end_turn"
        )
        client = _mock_client([tool_turn, final])
        messages = _seed_messages()

        async def _ok_executor(_tool_input: Any) -> dict[str, Any]:
            return {"rows": ["doc-1"]}

        async def _exercise() -> Any:
            return await run_tool_use_loop(
                client=client,
                messages=messages,
                tools=PASS1_TOOLS,
                tool_executors={"read_concept_raw": _ok_executor},
                system=[{"type": "text", "text": "system prompt"}],
                extractor_name="enrich_concept",
                max_tokens=4096,
            )

        asyncio.run(_exercise())

        tool_result = messages[2]["content"][0]
        assert "is_error" not in tool_result

    def test_string_result_never_sets_is_error(self) -> None:
        """A plain-string executor return (not a soft-error dict) is
        unaffected — `is_error` detection only fires for a `Mapping`
        carrying an `'error'` key, never a bare string content."""
        tool_use_block = ToolUseBlock(
            type="tool_use", id="toolu_1", name="sample_rows", input={"n": 3}
        )
        tool_turn = _MockMessage([tool_use_block], stop_reason="tool_use")
        final = _MockMessage(
            [TextBlock(type="text", text="done")], stop_reason="end_turn"
        )
        client = _mock_client([tool_turn, final])
        messages = _seed_messages()

        async def _string_executor(_tool_input: Any) -> str:
            return "error: something went wrong"  # substring 'error' — NOT a dict

        async def _exercise() -> Any:
            return await run_tool_use_loop(
                client=client,
                messages=messages,
                tools=PASS1_TOOLS,
                tool_executors={"sample_rows": _string_executor},
                system=[{"type": "text", "text": "system prompt"}],
                extractor_name="enrich_concept",
                max_tokens=4096,
            )

        asyncio.run(_exercise())

        tool_result = messages[2]["content"][0]
        assert "is_error" not in tool_result


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


# ============================================================================
# PRODUCER_MODEL — env override (ID-132 {132.35} slice B, S481 GLM-5.2
# ratification, DR-079: non-client bundles run GLM-5.2).
# ============================================================================


class TestProducerModelEnvOverride:
    """`agent_loop.PRODUCER_MODEL` is a producer-scoped env override of
    `ANTHROPIC_MODEL`, read ONCE at import time
    (`os.environ.get("PRODUCER_MODEL") or ANTHROPIC_MODEL`) — mirrors
    `ANTHROPIC_MODEL`'s own plain-constant posture (the deploy env is a
    Coolify secret set before the process boots; no live-reconfiguration
    need). `extraction.py`'s lane is untouched — a NEW var, not an env-read
    `ANTHROPIC_MODEL`.

    Reload-based (`importlib.reload`, this suite's existing precedent —
    `test_cocoindex_ingest_once.py`/`test_cocoindex_server.py`): safe to
    confine to THIS module because `agent_loop.py` imports no `cocoindex`
    (confirmed at the module docstring/imports — it's a plain stdlib+
    anthropic-only module), so a reload here cannot leak a stubbed engine
    state into sibling test files the way reloading `enrich.py`/`web_pass.py`
    would. Each test restores the pre-test (env-unset) state in a `finally`
    so no reload side effect survives past the test — other test files'
    already-collected `from agent_loop import run_tool_use_loop` bindings
    are also untouched by any of this (a name import copies the function
    object once at collection time; it does not track later reloads of the
    module it came from)."""

    def test_env_unset_falls_back_to_anthropic_model(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.delenv("PRODUCER_MODEL", raising=False)
        try:
            importlib.reload(_agent_loop_module)
            assert _agent_loop_module.PRODUCER_MODEL == _agent_loop_module.ANTHROPIC_MODEL
            default = inspect.signature(
                _agent_loop_module.run_tool_use_loop
            ).parameters["model"].default
            assert default == _agent_loop_module.ANTHROPIC_MODEL
        finally:
            importlib.reload(_agent_loop_module)

    def test_env_empty_string_also_falls_back(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """An explicitly-empty `PRODUCER_MODEL` (e.g. an unset Coolify secret
        rendered as `""`) must fall back exactly like an absent var — the
        brief's `or ANTHROPIC_MODEL` posture, not `is None`."""
        monkeypatch.setenv("PRODUCER_MODEL", "")
        try:
            importlib.reload(_agent_loop_module)
            assert _agent_loop_module.PRODUCER_MODEL == _agent_loop_module.ANTHROPIC_MODEL
        finally:
            monkeypatch.delenv("PRODUCER_MODEL", raising=False)
            importlib.reload(_agent_loop_module)

    def test_env_set_overrides_the_default_for_run_tool_use_loop(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("PRODUCER_MODEL", "glm-5.2-test-override")
        try:
            importlib.reload(_agent_loop_module)
            assert _agent_loop_module.PRODUCER_MODEL == "glm-5.2-test-override"
            default = inspect.signature(
                _agent_loop_module.run_tool_use_loop
            ).parameters["model"].default
            assert default == "glm-5.2-test-override"
        finally:
            monkeypatch.delenv("PRODUCER_MODEL", raising=False)
            importlib.reload(_agent_loop_module)

    def test_extraction_lane_is_untouched_by_the_producer_override(self) -> None:
        """DO-NOT (brief): extraction.py's OWN `ANTHROPIC_MODEL` constant and
        its 4 extractor call sites stay env-free — `PRODUCER_MODEL` is
        producer-package-scoped only, never threaded into `extraction.py`.
        Grep-level static guard: this isolation boundary has no runtime
        behaviour of its own to exercise (test-philosophy.md: behaviour-
        first, but a pure "this module must not import/mention that name"
        boundary is exactly what a static assertion proxies for — same
        posture as `test_producer_enrich.py::TestZeroWebEgress`'s "no
        `import httpx`" guard)."""
        extraction_source = (
            _REPO_ROOT / "scripts" / "cocoindex_pipeline" / "extraction.py"
        ).read_text()
        assert "PRODUCER_MODEL" not in extraction_source


# ============================================================================
# PRODUCER_BASE_URL/PRODUCER_AUTH_TOKEN + producer_async_client() — env
# override + client factory (ID-132 {132.35} slice C, S481 deploy-rider 3 —
# the endpoint/auth sibling of TestProducerModelEnvOverride above).
# ============================================================================


class TestProducerAsyncClientFactory:
    """`agent_loop.producer_async_client()` constructs the shared Anthropic
    client both producer passes use. Same reload-based posture/rationale as
    `TestProducerModelEnvOverride` (this module imports no `cocoindex`, so a
    reload here is confined and safe — see that class's docstring for the
    full argument).

    Asserts on the CONSTRUCTED CLIENT's `base_url`/`auth_token` attributes
    (real `anthropic.AsyncAnthropic` instances — construction is a cheap,
    network-free `__init__`, empirically confirmed) rather than mock-call
    shape, per the brief."""

    def test_both_unset_returns_a_bare_client_byte_for_byte(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """DO-NOT (brief): no new REQUIRED config — both unset must produce
        the exact same client a bare `AsyncAnthropic()` would (still itself
        reading process-wide `ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN` if
        THOSE happen to be set, exactly like `extraction.py`'s 4 sites)."""
        monkeypatch.delenv("PRODUCER_BASE_URL", raising=False)
        monkeypatch.delenv("PRODUCER_AUTH_TOKEN", raising=False)
        try:
            importlib.reload(_agent_loop_module)
            assert _agent_loop_module.PRODUCER_BASE_URL == ""
            assert _agent_loop_module.PRODUCER_AUTH_TOKEN == ""
            client = _agent_loop_module.producer_async_client()
            bare = anthropic.AsyncAnthropic()
            assert str(client.base_url) == str(bare.base_url)
            assert client.auth_token == bare.auth_token
        finally:
            importlib.reload(_agent_loop_module)

    def test_env_empty_string_also_falls_back(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """An explicitly-empty var (e.g. an unset Coolify secret rendered as
        `""`) must fall back exactly like an absent one — the `or ""`
        posture mirrors `PRODUCER_MODEL`'s `or ANTHROPIC_MODEL`."""
        monkeypatch.setenv("PRODUCER_BASE_URL", "")
        monkeypatch.setenv("PRODUCER_AUTH_TOKEN", "")
        try:
            importlib.reload(_agent_loop_module)
            assert _agent_loop_module.PRODUCER_BASE_URL == ""
            assert _agent_loop_module.PRODUCER_AUTH_TOKEN == ""
        finally:
            monkeypatch.delenv("PRODUCER_BASE_URL", raising=False)
            monkeypatch.delenv("PRODUCER_AUTH_TOKEN", raising=False)
            importlib.reload(_agent_loop_module)

    def test_both_set_passes_both_through_explicitly(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The real deploy shape (S481): PRODUCER_BASE_URL + PRODUCER_AUTH_
        TOKEN set together (mirrors the OpenRouter "Anthropic Skin"
        precedent) — the constructed client's own attributes carry both
        values through."""
        monkeypatch.setenv("PRODUCER_BASE_URL", "https://openrouter.ai/api")
        monkeypatch.setenv("PRODUCER_AUTH_TOKEN", "test-producer-auth-token")
        try:
            importlib.reload(_agent_loop_module)
            client = _agent_loop_module.producer_async_client()
            assert str(client.base_url) == "https://openrouter.ai/api/"
            assert client.auth_token == "test-producer-auth-token"
        finally:
            monkeypatch.delenv("PRODUCER_BASE_URL", raising=False)
            monkeypatch.delenv("PRODUCER_AUTH_TOKEN", raising=False)
            importlib.reload(_agent_loop_module)

    def test_process_wide_anthropic_base_url_cannot_surprise_the_producer(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The isolation proof itself: with a (hypothetical) process-wide
        `ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN` ALSO set — exactly the
        DR-079 leak scenario the brief describes — `PRODUCER_BASE_URL`/
        `PRODUCER_AUTH_TOKEN` still win for the producer's own client,
        because they're passed as explicit non-`None` constructor kwargs
        (empirically, an explicit `None` would NOT suppress the SDK's own
        env fallback, but a real value does)."""
        monkeypatch.setenv("ANTHROPIC_BASE_URL", "https://leaked-global.example.com")
        monkeypatch.setenv("ANTHROPIC_AUTH_TOKEN", "leaked-global-token")
        monkeypatch.setenv("PRODUCER_BASE_URL", "https://openrouter.ai/api")
        monkeypatch.setenv("PRODUCER_AUTH_TOKEN", "test-producer-auth-token")
        try:
            importlib.reload(_agent_loop_module)
            client = _agent_loop_module.producer_async_client()
            assert str(client.base_url) == "https://openrouter.ai/api/"
            assert client.auth_token == "test-producer-auth-token"
        finally:
            monkeypatch.delenv("ANTHROPIC_BASE_URL", raising=False)
            monkeypatch.delenv("ANTHROPIC_AUTH_TOKEN", raising=False)
            monkeypatch.delenv("PRODUCER_BASE_URL", raising=False)
            monkeypatch.delenv("PRODUCER_AUTH_TOKEN", raising=False)
            importlib.reload(_agent_loop_module)

    def test_extraction_lane_is_untouched_by_the_producer_client_override(
        self,
    ) -> None:
        """DO-NOT (brief): extraction.py's 4 bare `AsyncAnthropic()` call
        sites stay free of the new producer-scoped vars/factory — mirrors
        `TestProducerModelEnvOverride`'s equivalent grep-guard."""
        extraction_source = (
            _REPO_ROOT / "scripts" / "cocoindex_pipeline" / "extraction.py"
        ).read_text()
        assert "PRODUCER_BASE_URL" not in extraction_source
        assert "PRODUCER_AUTH_TOKEN" not in extraction_source
        assert "producer_async_client" not in extraction_source
