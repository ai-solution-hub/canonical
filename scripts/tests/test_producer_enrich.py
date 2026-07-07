"""Tests for producer/enrich.py — Pass-1 concept drafting (ID-132 {132.8}
G-PASS1).

Per the {132.8} testStrategy:

  - pass-isolation: Pass-1 makes ZERO web calls — proved both statically
    (no httpx/aiohttp import anywhere in the module; the wired tool set
    never includes a web-fetch tool) and dynamically (an end-to-end
    `enrich_concept()` run only ever offers the model the 3 Source-adapter
    tools).
  - the draft cites every asserted datum to a record anchor (BI-17) — the
    testable proxy this module enforces (documented in `enrich.py`'s module
    docstring): the terminal `citations` array must be non-empty, and every
    entry must resolve through a `producer/resource_uri.py` builder form.
    Verified here both at the parser unit level (`_parse_pass1_response`)
    and via a black-box round-trip through `producer.validator.
    detect_citation_shrink` on the RENDERED `# Citations` section (proving
    the renderer and the shared validator parser agree on the bullet shape,
    without importing either module's private members).
  - a no-op re-run over unchanged backing records is a memo-hit (BI-18) —
    the `url_source.py` memo-test precedent: prove the memo-keyed arg
    (`ConceptKey`) is frozen/value-equal (already the load-bearing property
    the real engine's `memo_fingerprint._canonicalize_dataclass` keys on,
    per EXECUTOR-VERIFY-1 — see `test_l_records_source.py`), and prove
    `enrich_concept` is actually declared `@coco.fn(memo=True)` (the
    `test_cocoindex_adapters.py` `__coco_fn_kwargs__` stub-pinning
    convention — a bare `MagicMock` stub cannot exercise the real cocoindex
    engine's memo cache, so this is the declaration-level proxy).
  - the terminal-TEXT + concatenate-all-TextBlocks contract (S451 rider
    fold-ins 1 + 3) is exercised with a stubbed multi-TextBlock terminal
    response.

Like `test_cocoindex_adapters.py`, `enrich.py` imports `cocoindex` at module
scope (it needs `@coco.fn`) — the module-under-test import is scoped inside
`stubbed_sys_modules({"cocoindex": ...})` so the Rust/LMDB engine never
boots at collection time, and the stub does not leak into sibling test
files (ID-44.5).
"""

from __future__ import annotations

import asyncio
import json
import sys
import uuid
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from anthropic.types import TextBlock, ToolUseBlock

# ── Path setup — mirrors test_producer_agent_loop.py. ───────────────────────

_REPO_ROOT = Path(__file__).resolve().parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from conftest import stubbed_sys_modules  # noqa: E402


def _make_coco_stub() -> MagicMock:
    """Minimal cocoindex stub — `@coco.fn(memo=True)` is a pass-through
    decorator that records its kwargs on the wrapped function
    (`__coco_fn_kwargs__`), mirroring `test_cocoindex_adapters.py`."""
    stub = MagicMock(name="cocoindex")

    def _fn_decorator(**kwargs: object):
        def _wrap(func: object) -> object:
            func.__coco_fn_kwargs__ = dict(kwargs)  # type: ignore[attr-defined]
            return func

        return _wrap

    stub.fn = _fn_decorator
    return stub


_coco_stub = _make_coco_stub()

with stubbed_sys_modules({"cocoindex": _coco_stub}):
    from scripts.cocoindex_pipeline.producer import enrich  # noqa: E402

from scripts.cocoindex_pipeline.producer.agent_loop import (  # noqa: E402
    LIST_CONCEPTS_TOOL,
    READ_CONCEPT_RAW_TOOL,
    SAMPLE_ROWS_TOOL,
)
from scripts.cocoindex_pipeline.producer.resource_uri import (  # noqa: E402
    build_q_a_pairs_query_uri,
    build_reference_item_uri,
    build_source_document_uri,
)
from scripts.cocoindex_pipeline.producer.validator import (  # noqa: E402
    detect_citation_shrink,
)
from scripts.cocoindex_pipeline.sources.l_records import (  # noqa: E402
    ConceptKey,
    ConceptRaw,
)

_ENRICH_SOURCE_PATH = (
    Path(__file__).resolve().parents[1]
    / "cocoindex_pipeline"
    / "producer"
    / "enrich.py"
)

_SD_ID = "11111111-1111-4111-8111-111111111111"
_RI_ID = "22222222-2222-4222-8222-222222222222"


# ── Test doubles ─────────────────────────────────────────────────────────


class _MockMessage:
    """Duck-typed `anthropic.types.Message` stand-in (mirrors
    `test_producer_agent_loop.py`'s `_MockMessage`)."""

    def __init__(self, content: "list[Any]", stop_reason: str) -> None:
        self.content = content
        self.stop_reason = stop_reason


class _FakeSource:
    """A `Source`-protocol-shaped test double — decoupled from the real
    L-records SQL (that is `test_l_records_source.py`'s concern); this file
    tests `enrich_concept`'s wiring/parsing contract only."""

    def __init__(
        self,
        catalogue: "list[ConceptKey]",
        raw_by_path: "dict[str, ConceptRaw]",
        sample_by_path: "dict[str, list[dict]] | None" = None,
    ) -> None:
        self._catalogue = list(catalogue)
        self._raw_by_path = raw_by_path
        self._sample_by_path = sample_by_path or {}
        self.read_concept_calls: "list[ConceptKey]" = []
        self.sample_rows_calls: "list[tuple[ConceptKey, int]]" = []

    async def list_concepts(self) -> "list[ConceptKey]":
        return list(self._catalogue)

    async def read_concept(self, key: ConceptKey) -> ConceptRaw:
        self.read_concept_calls.append(key)
        return self._raw_by_path[key.rel_path]

    async def sample_rows(self, key: ConceptKey, n: int) -> "list[dict]":
        self.sample_rows_calls.append((key, n))
        return self._sample_by_path.get(key.rel_path, [])[:n]

    async def find(self, query: str) -> "list[ConceptKey]":  # pragma: no cover
        raise NotImplementedError("Pass-1 never calls find()")


def _mock_client(side_effects: "list[Any]") -> MagicMock:
    client = MagicMock(name="AsyncAnthropic_instance")
    client.messages.create = AsyncMock(side_effect=side_effects)
    return client


@pytest.fixture(autouse=True)
def _fake_api_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-dummy-key-for-mocked-tests")


def _product_key() -> ConceptKey:
    return ConceptKey(rel_path="products/lms.md", concept_type="product", entity_id="LMS")


def _product_raw() -> ConceptRaw:
    return ConceptRaw(
        source_documents=[{"id": _SD_ID, "filename": "01-company-overview.docx"}],
        q_a_pairs=[{"id": "qa-1", "question_text": "What is the LMS?"}],
        reference_items=[{"id": _RI_ID, "title": "LMS reference"}],
    )


# ============================================================================
# PASS-ISOLATION — Pass-1 makes ZERO web calls
# ============================================================================


class TestZeroWebEgress:
    def test_module_never_imports_a_web_fetch_library(self) -> None:
        """Static proof: no httpx/aiohttp IMPORT anywhere in enrich.py — the
        module has no way to reach the network even if a tool executor were
        miswired. (Substring-matches an actual `import` statement rather
        than the bare library name, which this module's own docstring
        names in prose when explaining what it deliberately does NOT do.)"""
        source_text = _ENRICH_SOURCE_PATH.read_text()
        assert "import httpx" not in source_text
        assert "import aiohttp" not in source_text

    def test_pass1_toolset_is_exactly_the_three_source_adapter_tools(self) -> None:
        names = {tool["name"] for tool in enrich._PASS1_TOOLS_WITH_CATALOGUE}
        assert names == {"read_concept_raw", "sample_rows", "list_concepts"}
        assert READ_CONCEPT_RAW_TOOL in enrich._PASS1_TOOLS_WITH_CATALOGUE
        assert SAMPLE_ROWS_TOOL in enrich._PASS1_TOOLS_WITH_CATALOGUE
        assert LIST_CONCEPTS_TOOL in enrich._PASS1_TOOLS_WITH_CATALOGUE

    def test_end_to_end_run_only_ever_offers_the_three_tools(self) -> None:
        """Dynamic proof: every `messages.create` call across the whole
        Pass-1 loop is offered exactly the 3-tool set — never a web tool."""
        key = _product_key()
        source = _FakeSource(catalogue=[key], raw_by_path={key.rel_path: _product_raw()})
        final = _MockMessage(
            [TextBlock(type="text", text=_envelope_json())],
            stop_reason="end_turn",
        )
        client = _mock_client([final])

        async def _exercise():
            with patch(
                "scripts.cocoindex_pipeline.producer.enrich.anthropic.AsyncAnthropic",
                return_value=client,
            ):
                return await enrich.enrich_concept(key, source)

        asyncio.run(_exercise())

        for call in client.messages.create.call_args_list:
            tool_names = {t["name"] for t in call.kwargs["tools"]}
            assert tool_names == {"read_concept_raw", "sample_rows", "list_concepts"}


def _envelope_json(*, citations: "list[str] | None" = None) -> str:
    return json.dumps(
        {
            "title": "Learning Management System",
            "description": "The client's in-house LMS offering.",
            "tags": ["product", "lms"],
            "body": "The LMS is the client's learning-management product.",
            "citations": citations
            if citations is not None
            else [build_source_document_uri(_SD_ID), "topics/gdpr.md"],
        }
    )


# ============================================================================
# BI-17 — every asserted datum is traceable to a resolvable record anchor
# ============================================================================


class TestCitationValidationProxy:
    def test_validate_citation_accepts_per_row_canonical_anchor(self) -> None:
        uri = build_source_document_uri(_SD_ID)
        assert enrich._validate_citation(uri) == uri

    def test_validate_citation_accepts_qa_pairs_query_anchor(self) -> None:
        uri = build_q_a_pairs_query_uri(scope_tag="gdpr")
        assert enrich._validate_citation(uri) == uri

    def test_validate_citation_accepts_concept_cross_link_path(self) -> None:
        assert enrich._validate_citation("topics/gdpr.md") == "topics/gdpr.md"

    def test_validate_citation_rejects_bare_uuid(self) -> None:
        with pytest.raises(enrich.Pass1DraftError):
            enrich._validate_citation(str(uuid.uuid4()))

    def test_validate_citation_rejects_malformed_canonical_uri(self) -> None:
        with pytest.raises(enrich.Pass1DraftError):
            enrich._validate_citation("canonical://q_a_pairs/not-a-valid-form")

    def test_validate_citation_rejects_empty_string(self) -> None:
        with pytest.raises(enrich.Pass1DraftError):
            enrich._validate_citation("")

    def test_parse_response_rejects_empty_citations_array(self) -> None:
        message = _MockMessage(
            [TextBlock(type="text", text=_envelope_json(citations=[]))],
            stop_reason="end_turn",
        )
        with pytest.raises(enrich.Pass1DraftError, match="citations"):
            enrich._parse_pass1_response(message)

    def test_parse_response_rejects_missing_citations_key(self) -> None:
        payload = {
            "title": "t",
            "description": "d",
            "tags": [],
            "body": "b",
        }
        message = _MockMessage(
            [TextBlock(type="text", text=json.dumps(payload))], stop_reason="end_turn"
        )
        with pytest.raises(enrich.Pass1DraftError, match="missing required key"):
            enrich._parse_pass1_response(message)

    def test_parse_response_rejects_non_json_terminal_text(self) -> None:
        message = _MockMessage(
            [TextBlock(type="text", text="not json at all")], stop_reason="end_turn"
        )
        with pytest.raises(enrich.Pass1DraftError, match="valid JSON"):
            enrich._parse_pass1_response(message)

    def test_rendered_citations_section_round_trips_through_shared_validator(
        self,
    ) -> None:
        """Black-box proof (no private-symbol import): the `# Citations`
        section `_render_citations_section` emits is parsed correctly by
        `producer.validator`'s SHARED `detect_citation_shrink` — the same
        parser `{132.9}`/`{132.12}` will call over Pass-1's output."""
        citations = [build_source_document_uri(_SD_ID), "topics/gdpr.md"]
        section = enrich._render_citations_section(citations)

        # Every entry present in `section` (as "previous") but absent from
        # an empty "new" body is reported as a full shrink — proving every
        # citation round-trips through the shared bullet-line parser.
        shrunk = detect_citation_shrink(previous_body=section, new_body="")
        assert shrunk == sorted(citations)

    def test_annotate_raw_with_anchors_mints_valid_per_row_uris(self) -> None:
        key = _product_key()
        raw = _product_raw()
        annotated = enrich._annotate_raw_with_anchors(key, raw)

        assert annotated["source_documents"][0]["resource"] == build_source_document_uri(
            _SD_ID
        )
        assert annotated["reference_items"][0]["resource"] == build_reference_item_uri(
            _RI_ID
        )
        # product concepts carry no scope_tag/domain/subtopic locator -> no
        # BI-8 qa_resource is minted.
        assert "qa_resource" not in annotated

    def test_annotate_raw_with_anchors_sets_qa_resource_for_topic_scope_tag(
        self,
    ) -> None:
        key = ConceptKey(rel_path="topics/gdpr.md", concept_type="topic", scope_tag="gdpr")
        raw = ConceptRaw(q_a_pairs=[{"id": "qa-1"}])
        annotated = enrich._annotate_raw_with_anchors(key, raw)

        assert annotated["qa_resource"] == build_q_a_pairs_query_uri(scope_tag="gdpr")

    def test_resource_from_raw_prefers_source_documents_over_reference_items(
        self,
    ) -> None:
        key = _product_key()
        raw = _product_raw()
        assert enrich._resource_from_raw(key, raw) == build_source_document_uri(_SD_ID)

    def test_resource_from_raw_falls_back_to_qa_anchor_for_topic(self) -> None:
        key = ConceptKey(rel_path="topics/gdpr.md", concept_type="topic", scope_tag="gdpr")
        raw = ConceptRaw(q_a_pairs=[{"id": "qa-1"}])
        assert enrich._resource_from_raw(key, raw) == build_q_a_pairs_query_uri(
            scope_tag="gdpr"
        )

    def test_resource_from_raw_is_none_when_nothing_anchorable(self) -> None:
        key = ConceptKey(
            rel_path="products/unknown.md", concept_type="product", entity_id="Unknown"
        )
        assert enrich._resource_from_raw(key, ConceptRaw()) is None


# ============================================================================
# BI-18 — memo-hit proxy (url_source.py precedent)
# ============================================================================


class TestMemoisationProxy:
    def test_enrich_concept_is_declared_coco_fn_memo_true(self) -> None:
        assert enrich.enrich_concept.__coco_fn_kwargs__ == {"memo": True}

    def test_concept_key_is_frozen_and_equal_by_value(self) -> None:
        """The memo-keyed arg (BI-2/BI-18) — the SAME frozen/value-equal
        property `test_l_records_source.py::TestConceptKeyShape` pins,
        reasserted here because it is what makes `enrich_concept`'s
        `@coco.fn(memo=True)` declaration meaningful: an equal-valued
        `ConceptKey` for an unchanged concept memo-hits."""
        a = ConceptKey(rel_path="products/lms.md", concept_type="product", entity_id="LMS")
        b = ConceptKey(rel_path="products/lms.md", concept_type="product", entity_id="LMS")
        assert a == b
        assert hash(a) == hash(b)


# ============================================================================
# TERMINAL-TEXT CONTRACT (S451 rider fold-ins 1 + 3)
# ============================================================================


class TestTerminalTextContract:
    def test_extract_terminal_text_concatenates_all_text_blocks(self) -> None:
        envelope = _envelope_json()
        split_at = len(envelope) // 2
        message = _MockMessage(
            [
                TextBlock(type="text", text=envelope[:split_at]),
                TextBlock(type="text", text=envelope[split_at:]),
            ],
            stop_reason="end_turn",
        )
        assert enrich._extract_terminal_text(message) == envelope

    def test_extract_terminal_text_raises_when_no_text_block_present(self) -> None:
        tool_use_block = ToolUseBlock(
            type="tool_use", id="toolu_1", name="read_concept_raw", input={"ref": "x"}
        )
        message = _MockMessage([tool_use_block], stop_reason="tool_use")
        with pytest.raises(enrich.Pass1DraftError, match="no TextBlock"):
            enrich._extract_terminal_text(message)

    def test_multi_text_block_terminal_turn_parses_into_a_valid_draft(self) -> None:
        """End-to-end: the model's terminal turn splits its JSON envelope
        across two TextBlocks — enrich_concept must still parse it (fold-in
        3), not merely take the first block."""
        key = _product_key()
        source = _FakeSource(catalogue=[key], raw_by_path={key.rel_path: _product_raw()})
        envelope = _envelope_json()
        split_at = len(envelope) // 2
        final = _MockMessage(
            [
                TextBlock(type="text", text=envelope[:split_at]),
                TextBlock(type="text", text=envelope[split_at:]),
            ],
            stop_reason="end_turn",
        )
        client = _mock_client([final])

        async def _exercise():
            with patch(
                "scripts.cocoindex_pipeline.producer.enrich.anthropic.AsyncAnthropic",
                return_value=client,
            ):
                return await enrich.enrich_concept(key, source)

        draft = asyncio.run(_exercise())
        assert draft.frontmatter.title == "Learning Management System"
        assert "# Citations" in draft.body


# ============================================================================
# END-TO-END WIRING
# ============================================================================


class TestEnrichConceptEndToEnd:
    def test_happy_path_drafts_frontmatter_body_and_citations(self) -> None:
        key = _product_key()
        source = _FakeSource(catalogue=[key], raw_by_path={key.rel_path: _product_raw()})
        final = _MockMessage(
            [TextBlock(type="text", text=_envelope_json())], stop_reason="end_turn"
        )
        client = _mock_client([final])

        async def _exercise():
            with patch(
                "scripts.cocoindex_pipeline.producer.enrich.anthropic.AsyncAnthropic",
                return_value=client,
            ):
                return await enrich.enrich_concept(key, source)

        draft = asyncio.run(_exercise())

        assert draft.key == key
        assert draft.frontmatter.type == "product"
        assert draft.frontmatter.title == "Learning Management System"
        assert draft.frontmatter.resource == build_source_document_uri(_SD_ID)
        assert "# Citations" in draft.body
        assert f"- {build_source_document_uri(_SD_ID)}" in draft.body
        assert "- topics/gdpr.md" in draft.body
        rendered = draft.rendered_markdown
        assert rendered.startswith("---\n")
        assert "title: Learning Management System" in rendered

    def test_read_concept_raw_tool_call_reuses_the_prefetched_raw_no_duplicate_db_read(
        self,
    ) -> None:
        """`enrich_concept` pre-fetches its OWN concept's raw data (needed to
        derive `resource`); when the model's `read_concept_raw` tool call
        targets that SAME concept, the cached raw is reused rather than a
        second `source.read_concept` round-trip."""
        key = _product_key()
        source = _FakeSource(catalogue=[key], raw_by_path={key.rel_path: _product_raw()})
        tool_use_block = ToolUseBlock(
            type="tool_use",
            id="toolu_1",
            name="read_concept_raw",
            input={"ref": key.rel_path},
        )
        tool_turn = _MockMessage([tool_use_block], stop_reason="tool_use")
        final = _MockMessage(
            [TextBlock(type="text", text=_envelope_json())], stop_reason="end_turn"
        )
        client = _mock_client([tool_turn, final])

        async def _exercise():
            with patch(
                "scripts.cocoindex_pipeline.producer.enrich.anthropic.AsyncAnthropic",
                return_value=client,
            ):
                return await enrich.enrich_concept(key, source)

        asyncio.run(_exercise())

        assert source.read_concept_calls == [key]  # exactly ONE DB read

    def test_unknown_ref_in_tool_call_returns_soft_error_not_a_raise(self) -> None:
        """A model typo (unknown ref) surfaces as a soft-error tool_result
        the model can self-correct from — it must not kill the whole Pass-1
        run (unlike a genuine Source-adapter/DB failure, which propagates
        per `run_tool_use_loop`'s posture)."""
        key = _product_key()
        source = _FakeSource(catalogue=[key], raw_by_path={key.rel_path: _product_raw()})
        bad_tool_use = ToolUseBlock(
            type="tool_use",
            id="toolu_1",
            name="read_concept_raw",
            input={"ref": "products/does-not-exist.md"},
        )
        tool_turn = _MockMessage([bad_tool_use], stop_reason="tool_use")
        final = _MockMessage(
            [TextBlock(type="text", text=_envelope_json())], stop_reason="end_turn"
        )
        client = _mock_client([tool_turn, final])

        async def _exercise():
            with patch(
                "scripts.cocoindex_pipeline.producer.enrich.anthropic.AsyncAnthropic",
                return_value=client,
            ):
                return await enrich.enrich_concept(key, source)

        draft = asyncio.run(_exercise())
        assert draft.frontmatter.title == "Learning Management System"
        # The tool_result for the bad ref carried the soft-error dict.
        tool_result_content = client.messages.create.call_args_list[1].kwargs[
            "messages"
        ][-1]["content"][0]["content"]
        assert "unknown concept ref" in tool_result_content

    def test_list_concepts_executor_returns_the_prefetched_catalogue(self) -> None:
        key = _product_key()
        other = ConceptKey(rel_path="topics/gdpr.md", concept_type="topic", scope_tag="gdpr")
        source = _FakeSource(
            catalogue=[key, other], raw_by_path={key.rel_path: _product_raw()}
        )
        list_call = ToolUseBlock(
            type="tool_use", id="toolu_1", name="list_concepts", input={}
        )
        tool_turn = _MockMessage([list_call], stop_reason="tool_use")
        final = _MockMessage(
            [TextBlock(type="text", text=_envelope_json())], stop_reason="end_turn"
        )
        client = _mock_client([tool_turn, final])

        async def _exercise():
            with patch(
                "scripts.cocoindex_pipeline.producer.enrich.anthropic.AsyncAnthropic",
                return_value=client,
            ):
                return await enrich.enrich_concept(key, source)

        asyncio.run(_exercise())

        tool_result_content = client.messages.create.call_args_list[1].kwargs[
            "messages"
        ][-1]["content"][0]["content"]
        assert "products/lms.md" in tool_result_content
        assert "topics/gdpr.md" in tool_result_content

    def test_malformed_terminal_envelope_raises_pass1_draft_error(self) -> None:
        key = _product_key()
        source = _FakeSource(catalogue=[key], raw_by_path={key.rel_path: _product_raw()})
        final = _MockMessage(
            [TextBlock(type="text", text=_envelope_json(citations=[]))],
            stop_reason="end_turn",
        )
        client = _mock_client([final])

        async def _exercise():
            with patch(
                "scripts.cocoindex_pipeline.producer.enrich.anthropic.AsyncAnthropic",
                return_value=client,
            ):
                await enrich.enrich_concept(key, source)

        with pytest.raises(enrich.Pass1DraftError):
            asyncio.run(_exercise())
