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
    request's content_text — stable per request (memo-compatible), unique
    across distinct contents. Static names made every DOCUMENT share the
    same extracted names (the extractors call the LLM once per document
    with the full converted markdown — flow.py `_ingest_content_branch`),
    which collided the uniqueness constraints (entity_mentions
    canonical_name key, entity_relationships_unique_tuple NULLS NOT
    DISTINCT orphans) — run 30310909744's failure mode."""

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


class TestContentEcho:
    """id-389 follow-up — Stage-5 near-match testability.

    Certification-shaped surface forms found in content_text are echoed
    VERBATIM as entity mentions (exact surface string, spans at the real
    match offsets), so a fixture that inlines 'ISO 27001' and 'ISO27001'
    yields rows Stage-5 can actually near-match. The per-content-tag
    mention is retained (the never-near-matching row + uniqueness canary).
    """

    _CONTENT = (
        "Our ISMS holds ISO 27001 and ISO27001 certificates; we also "
        "maintain ISO 9001. ISO 27001 recurs later in this document."
    )

    def _mentions(self, content: str):
        status, body = _post_messages(
            {
                "model": "claude-test",
                "max_tokens": 64,
                "system": _system_block(prompts.ENTITY_MENTION_PROMPT),
                "messages": [{"role": "user", "content": content}],
            }
        )
        assert status == 200
        return extraction._entity_mentions_adapter.validate_json(
            body["content"][0]["text"]
        )

    def _triples(self, content: str):
        status, body = _post_messages(
            {
                "model": "claude-test",
                "max_tokens": 64,
                "system": _system_block(prompts.RELATIONSHIP_PROMPT),
                "messages": [{"role": "user", "content": content}],
            }
        )
        assert status == 200
        return extraction._relationships_adapter.validate_json(
            body["content"][0]["text"]
        )

    def test_surface_forms_in_content_are_echoed_verbatim(self) -> None:
        names = [m.entity_name for m in self._mentions(self._CONTENT)]
        assert "ISO 27001" in names
        assert "ISO27001" in names
        assert "ISO 9001" in names

    def test_echoed_spans_point_at_the_real_match_offsets(self) -> None:
        for mention in self._mentions(self._CONTENT)[1:]:
            assert (
                self._CONTENT[mention.source_span_start : mention.source_span_end]
                == mention.entity_name
            )

    def test_repeated_surface_form_is_echoed_once_first_occurrence_wins(
        self,
    ) -> None:
        mentions = self._mentions(self._CONTENT)
        iso_rows = [m for m in mentions if m.entity_name == "ISO 27001"]
        assert len(iso_rows) == 1
        assert iso_rows[0].source_span_start == self._CONTENT.index("ISO 27001")

    def test_echo_is_capped_and_first_occurrence_ordered(self) -> None:
        # A heading so the document HAS a canary — this test is about the echo
        # cap, and leaving the canary out of the count would quietly make it
        # about two things.
        content = "# Cap Fixture Ltd\n\nAA 111 BB 222 CC 333 DD 444 EE 555 FF 666 GG 777"
        mentions = self._mentions(content)
        # 1 canary + at most the cap of echoes.
        assert len(mentions) == 1 + 5
        echoed = [m.entity_name for m in mentions[1:]]
        assert echoed == ["AA 111", "BB 222", "CC 333", "DD 444", "EE 555"]

    def test_a_document_of_bare_tokens_gets_echoes_but_no_canary(self) -> None:
        """No line reads as a name, so there is nothing honest to anchor to.

        Emitting a canary here would mean inventing one, which is what the
        S543 ruling refuses.
        """
        mentions = self._mentions("AA 111 BB 222 CC 333")
        assert [m.entity_name for m in mentions] == ["AA 111", "BB 222", "CC 333"]

    def test_canary_mention_is_retained_anchored_and_content_unique(self) -> None:
        """The always-present canary is a real slice of its own document.

        It used to be `MOCK Org <sha12>` — a name occurring nowhere in the text,
        carrying the span (0, len(name)). Under the S543 ruling flow.py refuses
        a mention it cannot anchor, because a row with no context_snippet cannot
        evidence that its parent document was read. A synthesised canary would
        therefore produce no row at all, and Inv-17 could not pass on the mock
        tier under any fixture.

        The canary's JOB is unchanged and is what this asserts: still first,
        still a function of content_text so two documents cannot collide on a
        natural key. Anchoring is the added requirement, not a replacement.
        """
        first = self._mentions(self._CONTENT)[0]
        other = self._mentions("entirely different content")[0]

        # Anchored: the declared span holds exactly the name it claims.
        assert (
            self._CONTENT[first.source_span_start : first.source_span_end]
            == first.entity_name
        )
        assert first.entity_name in self._CONTENT

        # Still content-unique — the property the old hash provided.
        assert first.entity_name != other.entity_name

    def test_markup_only_lines_are_not_names(self) -> None:
        """`<!--` clears any length bar and is not an entity.

        Every fixture in the per-test-content tree opens with an HTML comment,
        so a length-only rule gave all of them the SAME canary — destroying the
        per-document uniqueness the canary exists to provide. Nightly run
        31283783895 is where that showed up.
        """
        doc = "<!--\nFIXTURE banner shared by every file in the tree.\n-->\n\n# Ravenscar Supply Chain Ltd\n\nBody.\n"
        first = self._mentions(doc)[0]
        assert first.entity_name == "Ravenscar Supply Chain Ltd"
        assert doc[first.source_span_start : first.source_span_end] == first.entity_name

    def test_the_heading_wins_over_an_earlier_prose_line(self) -> None:
        """A heading is the line most likely to DIFFER between two documents.

        Preferring it is what keeps two files sharing a boilerplate preamble
        from sharing a canary — which is the failure above, one layer up.
        """
        doc = "Shared preamble text present in every fixture.\n\n# Kilverstone Assurance Ltd\n\nBody.\n"
        assert self._mentions(doc)[0].entity_name == "Kilverstone Assurance Ltd"

    def test_two_documents_sharing_a_preamble_still_get_distinct_canaries(self) -> None:
        pre = "<!--\nIdentical banner.\n-->\n\n"
        a = self._mentions(pre + "# Alpha Holdings Ltd\n\nBody A.\n")[0]
        b = self._mentions(pre + "# Beta Industries Ltd\n\nBody B.\n")[0]
        assert a.entity_name != b.entity_name

    def test_a_document_with_no_usable_line_yields_no_canary(self) -> None:
        """No anchor is available, so no canary — and that is the correct answer.

        Emitting an unanchored row here would be reintroducing exactly what the
        S543 ruling refuses, one layer lower down.
        """
        assert self._mentions("") == []
        assert self._mentions("ab") == []
        assert self._mentions("<!--\n-->\n") == []

    def test_echoed_variants_keep_distinct_per_doc_canonicals(self) -> None:
        # The Stage-5 testability property: the two surface variants must
        # land as SEPARATE entity_mentions rows (distinct per-doc canonicals
        # — flow.py's _em_dedup collapses same-canonical mentions), leaving
        # cross-document resolution real work to do. This is why the echo
        # emits entity_type='standard': the 'certification' ISO normaliser
        # would pre-unify them ('iso27001' → 'iso 27001').
        from scripts.cocoindex_pipeline.canonicalisation import (
            canonicalise_entity_name,
        )

        mentions = self._mentions(self._CONTENT)
        row_a = next(m for m in mentions if m.entity_name == "ISO 27001")
        row_b = next(m for m in mentions if m.entity_name == "ISO27001")
        canon_a = canonicalise_entity_name(row_a.entity_name, row_a.entity_type)
        canon_b = canonicalise_entity_name(row_b.entity_name, row_b.entity_type)
        assert canon_a != canon_b
        # Inv-20 read-contract floor: per-doc canonical == lowercase + trim
        # of the surface form (unresolved-mention-retains-canonical asserts
        # exactly this equality on unique rows).
        assert canon_a == row_a.entity_name.lower().strip()
        assert canon_b == row_b.entity_name.lower().strip()

    def test_relationship_source_echoes_content_target_keeps_tag(self) -> None:
        triples = self._triples(self._CONTENT)
        assert len(triples) == 1
        # Source echoes the FIRST content surface form...
        assert triples[0].source == "ISO 27001"
        # ...while the target keeps the per-content disambiguator on a
        # constraint-keyed field (tuple-safety: two different documents can
        # never produce an identical canonicalised triple).
        assert triples[0].target.startswith("MOCK Cert ")
        other = self._triples("entirely different content")
        assert other[0].target != triples[0].target


class TestPairResolutionRoute:
    """Stage-5's KhPairResolver sends its prompt with NO system block —
    the mock adjudicates it deterministically instead of answering the
    preflight pong (which the resolver's parser fail-safes to
    'different', making near-match merges impossible in mock tier)."""

    def _adjudicate(self, name_a: str, name_b: str) -> str:
        from scripts.cocoindex_pipeline import pair_resolver

        prompt = pair_resolver._PAIR_RESOLUTION_PROMPT_TEMPLATE.format(
            name_a=name_a, name_b=name_b
        )
        status, body = _post_messages(
            {
                "model": "claude-test",
                "max_tokens": 4,
                "messages": [{"role": "user", "content": prompt}],
            }
        )
        assert status == 200
        return body["content"][0]["text"]

    def test_space_and_case_variants_adjudicate_same(self) -> None:
        # The exact near-match class the Stage-5 integration contracts
        # exercise ('ISO 27001' vs 'ISO27001' per-doc canonicals).
        assert self._adjudicate("iso 27001", "iso27001") == "same"

    def test_distinct_entities_adjudicate_different(self) -> None:
        assert self._adjudicate("iso 27001", "iso 9001") == "different"

    def test_tag_disambiguated_names_never_match(self) -> None:
        # The retained MOCK-tag rows must stay unresolvable (Inv-20).
        assert (
            self._adjudicate("mock org 123abc456def", "mock org fed654cba321")
            == "different"
        )

    def test_head_matched_but_malformed_pair_prompt_is_a_loud_400(self) -> None:
        from scripts.cocoindex_pipeline import pair_resolver

        head = pair_resolver._PAIR_RESOLUTION_PROMPT_TEMPLATE.split(
            "{name_a}", 1
        )[0]
        status, body = _post_messages(
            {
                "model": "claude-test",
                "messages": [{"role": "user", "content": head + "garbled"}],
            }
        )
        assert status == 400
        assert "mock_llm" in body["error"]["message"]


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
