"""Behaviour tests for the id-389 tier-1 mock LLM server (`mock_llm.py`).

The mock's ONE job: let a corpus walk run the real extraction path with no
live Anthropic key and $0 spend. Each test asserts a property that job
depends on (test-philosophy.md: behaviour, not implementation):

  1. DISCRIMINATION — each of the four extractor system prompts gets a
     payload that validates through `extraction.py`'s OWN TypeAdapter (the
     exact validation the walk runs). Four extractors, four different
     shapes, one endpoint.
  2. LOUD REFUSAL — an unrecognised system prompt is a 400 naming the
     mock, never a silent wrong-shape 200 (id-379 "loudly" doctrine).
  3. PREFLIGHT PING — a system-less request succeeds (the id-389
     credential-preflight curl sends none).
  4. SDK ROUND-TRIP — the pinned anthropic SDK, pointed at the mock over a
     real socket, drives `extraction._anthropic_message` (the bl-222
     STREAMING path) end-to-end: the accumulated Message carries the
     canned JSON and `stop_reason != "max_tokens"` so
     `_guard_not_truncated` passes.

Tests 1-3 use in-process `aiohttp.test_utils.TestClient` (the repo's
standard harness). Test 4 deliberately binds a REAL localhost socket
(`TestServer`) because the SDK speaks httpx over TCP — that is the point
of the test.
"""

from __future__ import annotations

import asyncio

from aiohttp.test_utils import TestClient, TestServer

from scripts.cocoindex_pipeline import extraction, mock_llm, prompts


def _client() -> TestClient:
    return TestClient(TestServer(mock_llm.build_app()))


def _post_messages(payload: dict) -> tuple[int, dict]:
    async def _exercise() -> tuple[int, dict]:
        client = _client()
        await client.start_server()
        try:
            resp = await client.post("/v1/messages", json=payload)
            return resp.status, await resp.json()
        finally:
            await client.close()

    return asyncio.run(_exercise())


def _system_block(prompt: str) -> list[dict]:
    # The same wire shape `_cached_system_block` sends.
    return [
        {
            "type": "text",
            "text": prompt,
            "cache_control": {"type": "ephemeral"},
        }
    ]


class TestDiscrimination:
    """Property 1 — four prompts, four shapes, each valid to its adapter."""

    def _text_for(self, prompt: str) -> str:
        status, body = _post_messages(
            {
                "model": "claude-test",
                "max_tokens": 64,
                "system": _system_block(prompt),
                "messages": [{"role": "user", "content": "doc text"}],
            }
        )
        assert status == 200
        assert body["stop_reason"] == "end_turn"
        return body["content"][0]["text"]

    def test_classification_prompt_yields_valid_classification(self) -> None:
        text = self._text_for(prompts.CLASSIFICATION_PROMPT)
        result = extraction._classification_adapter.validate_json(text)
        assert result.extraction_kind == "classification"

    def test_qa_form_prompt_yields_valid_qa_form_with_answered_pair(
        self,
    ) -> None:
        text = self._text_for(prompts.Q_A_FORM_PROMPT)
        result = extraction._qa_form_adapter.validate_json(text)
        # An ANSWERED pair — promotion-funnel wiring needs an eligible row
        # (unanswered = Class A, permanently unpromotable, id-370).
        assert result.qa_pairs and result.qa_pairs[0].answer_text

    def test_entity_prompt_yields_valid_mention_list(self) -> None:
        text = self._text_for(prompts.ENTITY_MENTION_PROMPT)
        result = extraction._entity_mentions_adapter.validate_json(text)
        assert len(result) == 1

    def test_relationship_prompt_yields_valid_triple_list(self) -> None:
        text = self._text_for(prompts.RELATIONSHIP_PROMPT)
        result = extraction._relationships_adapter.validate_json(text)
        assert len(result) == 1


class TestPerChunkUniqueness:
    """Entity/relationship payloads are a deterministic function of the
    request's content_text — stable per chunk (memo-compatible), unique
    across chunks. Static names collide the per-document uniqueness
    constraints (entity_mentions canonical_name key,
    entity_relationships_unique_tuple) the moment two chunks of one
    document extract — run 30310909744's failure mode."""

    def _entity_name(self, content: str) -> str:
        status, body = _post_messages(
            {
                "model": "claude-test",
                "max_tokens": 64,
                "system": _system_block(prompts.ENTITY_MENTION_PROMPT),
                "messages": [{"role": "user", "content": content}],
            }
        )
        assert status == 200
        mentions = extraction._entity_mentions_adapter.validate_json(
            body["content"][0]["text"]
        )
        return mentions[0].entity_name

    def test_distinct_chunks_get_distinct_entity_names(self) -> None:
        assert self._entity_name("chunk one") != self._entity_name("chunk two")

    def test_same_chunk_gets_identical_name_on_repeat(self) -> None:
        # Determinism is what keeps the mock memo-compatible.
        assert self._entity_name("chunk one") == self._entity_name("chunk one")

    def test_relationship_endpoints_track_the_same_chunk_tag(self) -> None:
        status, body = _post_messages(
            {
                "model": "claude-test",
                "max_tokens": 64,
                "system": _system_block(prompts.RELATIONSHIP_PROMPT),
                "messages": [{"role": "user", "content": "chunk one"}],
            }
        )
        assert status == 200
        triples = extraction._relationships_adapter.validate_json(
            body["content"][0]["text"]
        )
        assert triples[0].source == self._entity_name("chunk one")


class TestRefusalAndPreflight:
    def test_unknown_system_prompt_is_a_loud_400(self) -> None:
        status, body = _post_messages(
            {
                "model": "claude-test",
                "system": _system_block("an impostor prompt"),
                "messages": [{"role": "user", "content": "doc"}],
            }
        )
        assert status == 400
        assert "mock_llm" in body["error"]["message"]

    def test_systemless_request_is_the_preflight_pong(self) -> None:
        status, body = _post_messages(
            {
                "model": "claude-test",
                "messages": [{"role": "user", "content": "ping"}],
            }
        )
        assert status == 200
        assert "pong" in body["content"][0]["text"]


class TestSdkStreamingRoundTrip:
    """Property 4 — the real pinned SDK, the real bl-222 streaming path."""

    def test_anthropic_message_accumulates_canned_classification(
        self,
    ) -> None:
        import anthropic

        async def _exercise() -> None:
            server = TestServer(mock_llm.build_app())
            await server.start_server()
            try:
                client = anthropic.AsyncAnthropic(
                    base_url=str(server.make_url("")),
                    api_key="mock-key-never-validated",
                )
                message = await extraction._anthropic_message(
                    client,
                    model="claude-test",
                    max_tokens=64,
                    system=extraction._cached_system_block(
                        prompts.CLASSIFICATION_PROMPT
                    ),
                    messages=[{"role": "user", "content": "doc text"}],
                )
                # The two properties every extractor relies on post-call:
                extraction._guard_not_truncated(message, "mock-test", 64)
                block = message.content[0]
                assert isinstance(block, anthropic.types.TextBlock)
                parsed = extraction._classification_adapter.validate_json(
                    block.text
                )
                assert parsed.extraction_kind == "classification"
            finally:
                await server.close()

        asyncio.run(_exercise())
