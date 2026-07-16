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
import inspect
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

from scripts.cocoindex_pipeline.producer import agent_loop  # noqa: E402
from scripts.cocoindex_pipeline.producer.agent_loop import (  # noqa: E402
    LIST_CONCEPTS_TOOL,
    READ_CONCEPT_RAW_TOOL,
    SAMPLE_ROWS_TOOL,
)
from scripts.cocoindex_pipeline.producer.prompts import (  # noqa: E402
    PASS1_INSTRUCTION_PROMPT,
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
_WS_ID = "33333333-3333-4333-8333-333333333333"


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


def _gdpr_key() -> ConceptKey:
    return ConceptKey(rel_path="topics/gdpr.md", concept_type="topic", scope_tag="gdpr")


def _catalogue_with_gdpr(key: ConceptKey) -> "list[ConceptKey]":
    """A catalogue containing `key` plus a cross-linkable sibling concept
    (`topics/gdpr.md`) — needed by any end-to-end test whose final envelope
    cites a BI-9 concept cross-link, since `_validate_citation` now checks
    catalogue membership (the Checker-fix provenance guard), not just
    format."""
    return [key, _gdpr_key()]


def _read_concept_raw_tool_turn(key: ConceptKey) -> "_MockMessage":
    """A `tool_use` turn where the model calls `read_concept_raw` for `key`
    — the realistic first step (per `PASS1_INSTRUCTION_PROMPT`/`_seed_user_
    message`) that populates `seen_anchors` BEFORE the model can validly
    cite a record anchor (the Checker-fix provenance guard)."""
    tool_use_block = ToolUseBlock(
        type="tool_use", id="toolu_1", name="read_concept_raw", input={"ref": key.rel_path}
    )
    return _MockMessage([tool_use_block], stop_reason="tool_use")


def _product_raw() -> ConceptRaw:
    return ConceptRaw(
        source_documents=[{"id": _SD_ID, "filename": "01-company-overview.docx"}],
        q_a_pairs=[{"id": "qa-1", "question_text": "What is the LMS?"}],
        reference_items=[{"id": _RI_ID, "title": "LMS reference"}],
    )


def _won_bid_case_study_key() -> ConceptKey:
    """{132.28}: the S443-amendment won-bid case_study locator — `workspace_id`
    set, `scope_tag`/`domain`/`subtopic` unset (routes `_qa_pairs_anchor` to
    `None`, per `_annotate_raw_with_anchors`'s existing case_study posture)."""
    return ConceptKey(
        rel_path="case-studies/acme-corp.md",
        concept_type="case_study",
        entity_id="Acme Corp",
        workspace_id=_WS_ID,
    )


def _won_bid_raw() -> ConceptRaw:
    """{132.28}: a won-bid case_study `ConceptRaw` — the `workspaces`/
    `form_templates` buckets `{132.21}` shipped (buyer identity +
    `outcome_notes`) plus a published `derived_from_form_response` q_a row
    carrying `source_workspace_id` provenance."""
    return ConceptRaw(
        workspaces=[
            {
                "id": _WS_ID,
                "name": "Acme Corp Workspace",
                "domain_metadata": {"sector": "logistics"},
            }
        ],
        form_templates=[
            {
                "id": "44444444-4444-4444-8444-444444444444",
                "workspace_id": _WS_ID,
                "outcome": "won",
                "outcome_notes": "Won on technical differentiation and price.",
                "issuing_organisation": "Acme Corp",
            }
        ],
        q_a_pairs=[
            {
                "id": "qa-won-1",
                "question_text": "What was our approach to data migration?",
                "origin_kind": "derived_from_form_response",
                "publication_status": "published",
                "source_workspace_id": _WS_ID,
            }
        ],
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
        source = _FakeSource(
            catalogue=_catalogue_with_gdpr(key), raw_by_path={key.rel_path: _product_raw()}
        )
        final = _MockMessage(
            [TextBlock(type="text", text=_envelope_json())],
            stop_reason="end_turn",
        )
        client = _mock_client([_read_concept_raw_tool_turn(key), final])

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


def _envelope_json(
    *,
    citations: "list[str] | None" = None,
    purpose: "str | None" = None,
    task: "str | None" = None,
    audience: "str | None" = None,
) -> str:
    payload: "dict[str, Any]" = {
        "title": "Learning Management System",
        "description": "The client's in-house LMS offering.",
        "tags": ["product", "lms"],
        "body": "The LMS is the client's learning-management product.",
        "citations": citations
        if citations is not None
        else [build_source_document_uri(_SD_ID), "topics/gdpr.md"],
    }
    # bl-456 routing hints — OPTIONAL terminal-JSON keys; only included in
    # the payload when the caller supplies one, mirroring a model that omits
    # them entirely rather than emitting an empty string.
    if purpose is not None:
        payload["purpose"] = purpose
    if task is not None:
        payload["task"] = task
    if audience is not None:
        payload["audience"] = audience
    return json.dumps(payload)


# ============================================================================
# BI-17 — every asserted datum is traceable to a resolvable record anchor
# ============================================================================


class TestCitationValidationProxy:
    def test_validate_citation_accepts_per_row_canonical_anchor_that_was_minted(
        self,
    ) -> None:
        uri = build_source_document_uri(_SD_ID)
        assert (
            enrich._validate_citation(uri, seen_anchors={uri}, catalogue_paths=set()) == uri
        )

    def test_validate_citation_rejects_well_formed_but_never_minted_canonical_anchor(
        self,
    ) -> None:
        """Checker finding: a well-formed `canonical://source_documents/
        <uuid>` that was NEVER minted into a `read_concept_raw` tool result
        this run (a fabricated uuid) is REJECTED — format validity alone is
        not proof of provenance."""
        fabricated = build_source_document_uri(str(uuid.uuid4()))
        with pytest.raises(enrich.Pass1DraftError, match="never minted"):
            enrich._validate_citation(fabricated, seen_anchors=set(), catalogue_paths=set())

    def test_validate_citation_accepts_qa_pairs_query_anchor_that_was_minted(self) -> None:
        uri = build_q_a_pairs_query_uri(scope_tag="gdpr")
        assert (
            enrich._validate_citation(uri, seen_anchors={uri}, catalogue_paths=set()) == uri
        )

    def test_validate_citation_rejects_qa_pairs_query_anchor_that_was_never_minted(
        self,
    ) -> None:
        uri = build_q_a_pairs_query_uri(scope_tag="never-issued")
        with pytest.raises(enrich.Pass1DraftError, match="never minted"):
            enrich._validate_citation(uri, seen_anchors=set(), catalogue_paths=set())

    def test_validate_citation_accepts_concept_cross_link_path_in_catalogue(self) -> None:
        assert (
            enrich._validate_citation(
                "topics/gdpr.md", seen_anchors=set(), catalogue_paths={"topics/gdpr.md"}
            )
            == "topics/gdpr.md"
        )

    def test_validate_citation_rejects_concept_cross_link_path_not_in_catalogue(
        self,
    ) -> None:
        """The BI-9 analogue of the record-anchor provenance check: a
        well-formed but non-existent (not in this run's `list_concepts`
        catalogue) concept cross-link path is rejected."""
        with pytest.raises(enrich.Pass1DraftError, match="catalogue"):
            enrich._validate_citation(
                "topics/does-not-exist.md",
                seen_anchors=set(),
                catalogue_paths={"topics/gdpr.md"},
            )

    def test_validate_citation_normalises_a_link_wrapped_anchor_to_its_target(
        self,
    ) -> None:
        """SPEC §5.1/§8 tolerance: a model returning the numbered/markdown-
        link citation form (or a `/`-leading bundle-absolute cross-link)
        validates against the SAME provenance ledgers as the bare form —
        the validated tuple carries the normalised bare TARGET."""
        uri = build_source_document_uri(_SD_ID)
        assert (
            enrich._validate_citation(
                f"[1] [{uri}]({uri})", seen_anchors={uri}, catalogue_paths=set()
            )
            == uri
        )
        assert (
            enrich._validate_citation(
                "[2] [GDPR](/topics/gdpr.md)",
                seen_anchors=set(),
                catalogue_paths={"topics/gdpr.md"},
            )
            == "topics/gdpr.md"
        )
        assert (
            enrich._validate_citation(
                "/topics/gdpr.md",
                seen_anchors=set(),
                catalogue_paths={"topics/gdpr.md"},
            )
            == "topics/gdpr.md"
        )

    def test_validate_citation_link_form_is_still_provenance_checked(self) -> None:
        """Link-wrapping is a FORMAT tolerance, never a provenance bypass —
        a link-wrapped, never-minted anchor still fails BI-17."""
        fabricated = build_source_document_uri(str(uuid.uuid4()))
        with pytest.raises(enrich.Pass1DraftError, match="never minted"):
            enrich._validate_citation(
                f"[1] [{fabricated}]({fabricated})",
                seen_anchors=set(),
                catalogue_paths=set(),
            )

    def test_validate_citation_rejects_bare_uuid(self) -> None:
        with pytest.raises(enrich.Pass1DraftError):
            enrich._validate_citation(
                str(uuid.uuid4()), seen_anchors=set(), catalogue_paths=set()
            )

    def test_validate_citation_rejects_malformed_canonical_uri(self) -> None:
        with pytest.raises(enrich.Pass1DraftError):
            enrich._validate_citation(
                "canonical://q_a_pairs/not-a-valid-form",
                seen_anchors=set(),
                catalogue_paths=set(),
            )

    def test_validate_citation_rejects_empty_string(self) -> None:
        with pytest.raises(enrich.Pass1DraftError):
            enrich._validate_citation("", seen_anchors=set(), catalogue_paths=set())

    def test_parse_response_rejects_empty_citations_array(self) -> None:
        message = _MockMessage(
            [TextBlock(type="text", text=_envelope_json(citations=[]))],
            stop_reason="end_turn",
        )
        with pytest.raises(enrich.Pass1DraftError, match="citations"):
            enrich._parse_pass1_response(message, seen_anchors=set(), catalogue_paths=set())

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
            enrich._parse_pass1_response(message, seen_anchors=set(), catalogue_paths=set())

    def test_parse_response_rejects_non_json_terminal_text(self) -> None:
        message = _MockMessage(
            [TextBlock(type="text", text="not json at all")], stop_reason="end_turn"
        )
        with pytest.raises(enrich.Pass1DraftError, match="valid JSON"):
            enrich._parse_pass1_response(message, seen_anchors=set(), catalogue_paths=set())

    def test_parse_response_accepts_citations_that_were_actually_minted(self) -> None:
        """Positive counterpart to the provenance-rejection tests above: a
        citation that DOES correspond to `seen_anchors`/`catalogue_paths`
        membership parses through cleanly (a tool-result-minted anchor still
        passes)."""
        uri = build_source_document_uri(_SD_ID)
        message = _MockMessage(
            [TextBlock(type="text", text=_envelope_json(citations=[uri, "topics/gdpr.md"]))],
            stop_reason="end_turn",
        )
        envelope = enrich._parse_pass1_response(
            message, seen_anchors={uri}, catalogue_paths={"topics/gdpr.md"}
        )
        assert envelope.citations == (uri, "topics/gdpr.md")

    def test_parse_response_tolerates_leading_prose_before_terminal_json(self) -> None:
        """{132.15} live-run defect (first live producer run, 2026-07-11):
        `claude-opus-4-6` terminal turns occasionally prefix the JSON
        payload with a short conversational preamble despite
        `PASS1_INSTRUCTION_PROMPT`'s "no commentary before or after it"
        contract — verbatim observed shape below. A bare `json.loads` on
        this text raised `Pass1DraftError` for 18/18 concepts; the parser
        must recover the JSON object that follows the preamble."""
        uri = build_source_document_uri(_SD_ID)
        preamble = (
            "I now have the backing records and the full concept "
            "catalogue. Let me draft the concept document.\n\n"
        )
        message = _MockMessage(
            [
                TextBlock(
                    type="text",
                    text=preamble + _envelope_json(citations=[uri, "topics/gdpr.md"]),
                )
            ],
            stop_reason="end_turn",
        )
        envelope = enrich._parse_pass1_response(
            message, seen_anchors={uri}, catalogue_paths={"topics/gdpr.md"}
        )
        assert envelope.citations == (uri, "topics/gdpr.md")

    def test_parse_response_tolerates_leading_prose_and_trailing_commentary(
        self,
    ) -> None:
        """Same recovery path, but the terminal turn ALSO appends
        commentary after the JSON object's closing brace — the recovered
        object must ignore everything past its own closing `}`."""
        uri = build_source_document_uri(_SD_ID)
        preamble = "Here is the concept document I've drafted.\n\n"
        trailing = "\n\nLet me know if you would like any adjustments."
        message = _MockMessage(
            [
                TextBlock(
                    type="text",
                    text=preamble
                    + _envelope_json(citations=[uri, "topics/gdpr.md"])
                    + trailing,
                )
            ],
            stop_reason="end_turn",
        )
        envelope = enrich._parse_pass1_response(
            message, seen_anchors={uri}, catalogue_paths={"topics/gdpr.md"}
        )
        assert envelope.citations == (uri, "topics/gdpr.md")

    def test_parse_response_still_raises_pass1_draft_error_for_pure_prose(
        self,
    ) -> None:
        """The recovery path only fires when a `{` is actually present —
        pure prose with no JSON object anywhere in it (the model failed to
        draft at all) must still surface the informative `Pass1DraftError`,
        never hang or silently swallow the failure."""
        message = _MockMessage(
            [
                TextBlock(
                    type="text",
                    text=(
                        "I reviewed the backing records but was unable to "
                        "draft a concept document from them at this time."
                    ),
                )
            ],
            stop_reason="end_turn",
        )
        with pytest.raises(enrich.Pass1DraftError, match="valid JSON"):
            enrich._parse_pass1_response(message, seen_anchors=set(), catalogue_paths=set())

    def test_parse_response_tolerates_json_wrapped_in_markdown_code_fence(self) -> None:
        """Terminal turns sometimes wrap the payload in a fenced ```json
        code block rather than (or in addition to) plain prose — the fence
        markers themselves are not JSON, so the same first-brace-recovery
        path must skip past the ```json marker and stop before the closing
        fence."""
        uri = build_source_document_uri(_SD_ID)
        message = _MockMessage(
            [
                TextBlock(
                    type="text",
                    text=(
                        "Here is the concept document:\n\n"
                        "```json\n"
                        + _envelope_json(citations=[uri, "topics/gdpr.md"])
                        + "\n```\n"
                    ),
                )
            ],
            stop_reason="end_turn",
        )
        envelope = enrich._parse_pass1_response(
            message, seen_anchors={uri}, catalogue_paths={"topics/gdpr.md"}
        )
        assert envelope.citations == (uri, "topics/gdpr.md")

    def test_parse_response_still_raises_pass1_draft_error_when_brace_present_but_unparseable(
        self,
    ) -> None:
        """A brace IS present (so the recovery path fires) but the text
        after it never closes into a valid JSON object — e.g. the model was
        cut off mid-draft. This must still surface `Pass1DraftError`
        loudly, proving the recovery path does not mask genuinely malformed
        JSON by swallowing the second `JSONDecodeError`."""
        message = _MockMessage(
            [
                TextBlock(
                    type="text",
                    text='Here is a draft: {"title": "Learning Management System", "descr',
                )
            ],
            stop_reason="end_turn",
        )
        with pytest.raises(enrich.Pass1DraftError, match="valid JSON"):
            enrich._parse_pass1_response(message, seen_anchors=set(), catalogue_paths=set())

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
        seen_anchors: "set[str]" = set()
        annotated = enrich._annotate_raw_with_anchors(key, raw, seen_anchors)

        assert annotated["source_documents"][0]["resource"] == build_source_document_uri(
            _SD_ID
        )
        assert annotated["reference_items"][0]["resource"] == build_reference_item_uri(
            _RI_ID
        )
        # product concepts carry no scope_tag/domain/subtopic locator -> no
        # BI-8 qa_resource is minted.
        assert "qa_resource" not in annotated
        # Checker-fix load-bearing property: every minted anchor is
        # recorded into seen_anchors for later provenance validation.
        assert seen_anchors == {
            build_source_document_uri(_SD_ID),
            build_reference_item_uri(_RI_ID),
        }

    def test_annotate_raw_with_anchors_sets_qa_resource_for_topic_scope_tag(
        self,
    ) -> None:
        key = ConceptKey(rel_path="topics/gdpr.md", concept_type="topic", scope_tag="gdpr")
        raw = ConceptRaw(q_a_pairs=[{"id": "qa-1"}])
        seen_anchors: "set[str]" = set()
        annotated = enrich._annotate_raw_with_anchors(key, raw, seen_anchors)

        assert annotated["qa_resource"] == build_q_a_pairs_query_uri(scope_tag="gdpr")
        assert build_q_a_pairs_query_uri(scope_tag="gdpr") in seen_anchors

    def test_annotate_raw_with_anchors_surfaces_won_bid_workspaces_and_form_templates(
        self,
    ) -> None:
        """{132.28} G-ENRICH-WONBID-WIRE: the won-bid case_study grain's
        `ConceptRaw.workspaces`/`form_templates` buckets ({132.21}) must reach
        the `read_concept_raw` payload verbatim — buyer identity
        (`workspaces`/`form_templates.issuing_organisation`) +
        `outcome_notes` + won-bid q_a provenance (`source_workspace_id`) all
        need to ground the Pass-1 draft (PRODUCT.md S443 amendment BI-28).
        Neither `workspaces` nor `form_templates` carries a BI-6/BI-8
        `canonical://` anchor (no `resource_uri.py` builder exists for
        either table; a case_study `ConceptKey` carries no
        scope_tag/domain/subtopic locator so no BI-8 `qa_resource` is minted
        either) — both buckets pass through unadorned, exactly like
        `q_a_pairs`/`record_lifecycle`/`entity_mentions`/
        `entity_relationships` already do."""
        key = _won_bid_case_study_key()
        raw = _won_bid_raw()
        seen_anchors: "set[str]" = set()
        annotated = enrich._annotate_raw_with_anchors(key, raw, seen_anchors)

        assert annotated["workspaces"] == raw.workspaces
        assert annotated["form_templates"] == raw.form_templates
        assert annotated["form_templates"][0]["outcome_notes"] == (
            "Won on technical differentiation and price."
        )
        assert annotated["q_a_pairs"] == raw.q_a_pairs
        assert annotated["q_a_pairs"][0]["source_workspace_id"] == _WS_ID
        # case_study carries no scope_tag/domain/subtopic locator -> no BI-8
        # qa_resource minted; won-bid q_a stays surfaced-but-uncitable,
        # matching the TECH.md citability grid (S443 amendment) — see the
        # {132.28} journal for the citability-decision rationale.
        assert "qa_resource" not in annotated
        # workspaces/form_templates mint no canonical:// anchor of their own.
        assert seen_anchors == set()

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
    def test_enrich_concept_is_declared_coco_fn_memo_true_and_excludes_source(
        self,
    ) -> None:
        """{132.38} G-MEMO-DELTA, DR-060 (S469 owner ratification): the
        decorator is EXACTLY
        `@coco.fn(memo=True, memo_key={'source': None}, version=1)` —
        `source` excluded (MD-2), NO `deps=` kwarg. OQ-MD-1 ratified AWAY
        from the `deps={...}` drafting-config auto-invalidation design
        MEMO-DELTA.md's body text proposed: a prompt/model/max_tokens change
        is a MANUAL `@coco.fn(..., version=N)` bump recorded in the bundle's
        OKF `log.md` (`bundle_writer.append_log_entry`), never an
        engine-level fingerprint input. `version=1` (S481) is that lever
        exercised for real, bumped ahead of the {132.35} GLM-5.2 Run-1
        re-proof because {132.41}/{132.42} changed both
        `PASS1_INSTRUCTION_PROMPT` (3 routing-hint keys) and the emitted
        frontmatter shape (`confidence` + hints) — see the module docstring's
        "S481, this bump" note. This exact-equality assertion is also the
        empirical proof there is no stray `deps=` kwarg."""
        assert enrich.enrich_concept.__coco_fn_kwargs__ == {
            "memo": True,
            "memo_key": {"source": None},
            "version": 1,
        }

    def test_concept_key_is_frozen_and_equal_by_value(self) -> None:
        """The memo-keyed arg (BI-2/BI-18) — the SAME frozen/value-equal
        property `test_l_records_source.py::TestConceptKeyShape` pins,
        reasserted here because it is what makes `enrich_concept`'s
        `@coco.fn(memo=True, memo_key={'source': None})` declaration
        meaningful: an equal-valued `ConceptKey` for an unchanged concept
        memo-hits."""
        a = ConceptKey(rel_path="products/lms.md", concept_type="product", entity_id="LMS")
        b = ConceptKey(rel_path="products/lms.md", concept_type="product", entity_id="LMS")
        assert a == b
        assert hash(a) == hash(b)


# ============================================================================
# MD-4 non-leak (ID-132 {132.38} G-MEMO-DELTA) — content_version must NOT
# leak into identity/routing/dedup/write-path/find.
# ============================================================================


class TestContentVersionNonLeak:
    """MD-4: `content_version` participates ONLY in the memo fingerprint.
    Two `ConceptKey`s differing ONLY in `content_version` must be
    indistinguishable to every other consumer: `bundle_write_path_for_key`,
    `read_concept`'s dispatch (proved via an identical issued-query
    sequence), and `find()`'s membership test."""

    @staticmethod
    def _keys() -> "tuple[ConceptKey, ConceptKey]":
        base = dict(rel_path="topics/gdpr.md", concept_type="topic", scope_tag="gdpr")
        return (
            ConceptKey(**base, content_version="v-a"),
            ConceptKey(**base, content_version="v-b"),
        )

    def test_bundle_write_path_for_key_is_identical(self) -> None:
        from scripts.cocoindex_pipeline.producer.bundle_writer import (
            bundle_write_path_for_key,
        )

        key_a, key_b = self._keys()
        assert bundle_write_path_for_key(key_a) == bundle_write_path_for_key(key_b)

    def test_read_concept_issues_the_identical_query_sequence(self) -> None:
        from scripts.cocoindex_pipeline.sources.l_records import LRecordsSource

        class _RecordingPool:
            def __init__(self) -> None:
                self.calls: "list[tuple[str, tuple]]" = []

            async def fetch(self, query: str, *args: object) -> list:
                self.calls.append((query, args))
                return []

        async def _exercise(key: ConceptKey) -> "list[tuple[str, tuple]]":
            pool = _RecordingPool()
            await LRecordsSource(pool).read_concept(key)
            return pool.calls

        key_a, key_b = self._keys()
        calls_a = asyncio.run(_exercise(key_a))
        calls_b = asyncio.run(_exercise(key_b))
        assert calls_a == calls_b

    def test_find_membership_is_identical(self) -> None:
        from scripts.cocoindex_pipeline.sources.l_records import LRecordsSource

        class _StubPool:
            async def fetch(self, *args: object, **kwargs: object) -> list:
                return []

        async def _exercise(key: ConceptKey) -> "list[str]":
            src = LRecordsSource(_StubPool())
            src.list_concepts = AsyncMock(return_value=[key])  # type: ignore[method-assign]
            hits = await src.find("gdpr")
            return [k.rel_path for k in hits]

        key_a, key_b = self._keys()
        assert asyncio.run(_exercise(key_a)) == asyncio.run(_exercise(key_b))


# ============================================================================
# MD-9 (ID-132 {132.38} G-MEMO-DELTA, DR-054/DR-027) — the effective ontology
# is excluded from the Pass-1 fingerprint; grep-assert guard.
# ============================================================================


class TestEffectiveOntologyExcludedFromPass1:
    """MD-9: the `EffectiveOntology` overlay governs the concept-WRITE gate
    ({132.34}/{132.35}), never the Pass-1 draft. A grep-assert guard so a
    future change threading the ontology into Pass-1 prompting is caught —
    per MD-9's forward guard, such a change MUST then join the manual
    `version=` invalidation lever, not silently drift the memo fingerprint."""

    def test_no_ontology_symbol_imported_into_pass1_modules(self) -> None:
        """AST-level (not a raw text/grep match): checks actual `import`/
        `from ... import ...` statements only, so this guard is immune to a
        docstring/comment merely NAMING `EffectiveOntology` in prose (as this
        module's own memoisation docstring now does, describing why it is
        OUT of scope) — it must fail only on a real import."""
        import ast
        import re

        pipeline_root = Path(__file__).resolve().parents[1] / "cocoindex_pipeline"
        needle = re.compile(r"effective_?ontology|overlay", re.IGNORECASE)
        for rel in ("producer/enrich.py", "producer/agent_loop.py", "producer/prompts.py"):
            tree = ast.parse((pipeline_root / rel).read_text())
            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    names = [alias.name for alias in node.names]
                elif isinstance(node, ast.ImportFrom):
                    names = [node.module or ""] + [alias.name for alias in node.names]
                else:
                    continue
                offenders = [n for n in names if needle.search(n)]
                assert not offenders, (
                    f"{rel} imports ontology symbol(s) {offenders} (MD-9) — "
                    "an overlay change must never re-draft a Pass-1 concept"
                )


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
        source = _FakeSource(
            catalogue=_catalogue_with_gdpr(key), raw_by_path={key.rel_path: _product_raw()}
        )
        envelope = _envelope_json()
        split_at = len(envelope) // 2
        final = _MockMessage(
            [
                TextBlock(type="text", text=envelope[:split_at]),
                TextBlock(type="text", text=envelope[split_at:]),
            ],
            stop_reason="end_turn",
        )
        client = _mock_client([_read_concept_raw_tool_turn(key), final])

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
# ID-132 FRONTMATTER-WAVE (bl-456/bl-477, {132.42}) — confidence + routing
# hints POPULATED at the Pass-1 `build_concept_frontmatter` call site.
# ============================================================================


class TestConfidencePopulation:
    """A19 (bl-477): `enrich_concept` derives `confidence` deterministically
    from `(resource, envelope.citations)` via `derive_concept_confidence` —
    never asked of the model. See `derive_concept_confidence`'s own unit
    tests (`test_producer_frontmatter.py`) for the rule's full truth table;
    this class proves it is actually WIRED at this call site."""

    def test_draft_with_two_record_anchor_citations_and_per_row_resource_emits_confidence_strong(
        self,
    ) -> None:
        key = _product_key()
        source = _FakeSource(
            catalogue=_catalogue_with_gdpr(key), raw_by_path={key.rel_path: _product_raw()}
        )
        # _product_raw() has BOTH source_documents (drives the per-row
        # `resource:`) and reference_items — two DISTINCT record anchors.
        two_record_anchors = [
            build_source_document_uri(_SD_ID),
            build_reference_item_uri(_RI_ID),
        ]
        final = _MockMessage(
            [TextBlock(type="text", text=_envelope_json(citations=two_record_anchors))],
            stop_reason="end_turn",
        )
        client = _mock_client([_read_concept_raw_tool_turn(key), final])

        async def _exercise():
            with patch(
                "scripts.cocoindex_pipeline.producer.enrich.anthropic.AsyncAnthropic",
                return_value=client,
            ):
                return await enrich.enrich_concept(key, source)

        draft = asyncio.run(_exercise())
        assert draft.frontmatter.resource == build_source_document_uri(_SD_ID)
        assert draft.frontmatter.confidence == "strong"

    def test_draft_with_a_single_record_anchor_citation_emits_confidence_partial(
        self,
    ) -> None:
        """The default envelope fixture cites ONE record anchor plus a
        concept cross-link (which does not corroborate) — the honest
        Path-1 default."""
        key = _product_key()
        source = _FakeSource(
            catalogue=_catalogue_with_gdpr(key), raw_by_path={key.rel_path: _product_raw()}
        )
        final = _MockMessage(
            [TextBlock(type="text", text=_envelope_json())], stop_reason="end_turn"
        )
        client = _mock_client([_read_concept_raw_tool_turn(key), final])

        async def _exercise():
            with patch(
                "scripts.cocoindex_pipeline.producer.enrich.anthropic.AsyncAnthropic",
                return_value=client,
            ):
                return await enrich.enrich_concept(key, source)

        draft = asyncio.run(_exercise())
        assert draft.frontmatter.confidence == "partial"


class TestRoutingHintPopulation:
    """bl-456: `purpose`/`task`/`audience` are OPTIONAL, model-authored
    terminal-JSON keys — read-if-present, absent-tolerant, never required
    (NOT in `_REQUIRED_ENVELOPE_KEYS`)."""

    def test_parse_pass1_response_reads_routing_hints_when_the_model_supplies_them(
        self,
    ) -> None:
        uri = build_source_document_uri(_SD_ID)
        message = _MockMessage(
            [
                TextBlock(
                    type="text",
                    text=_envelope_json(
                        citations=[uri, "topics/gdpr.md"],
                        purpose="Explain the LMS offering to a prospect",
                        task="Answering a procurement RFI question",
                        audience="Buyer-side evaluation committee",
                    ),
                )
            ],
            stop_reason="end_turn",
        )
        envelope = enrich._parse_pass1_response(
            message, seen_anchors={uri}, catalogue_paths={"topics/gdpr.md"}
        )
        assert envelope.purpose == "Explain the LMS offering to a prospect"
        assert envelope.task == "Answering a procurement RFI question"
        assert envelope.audience == "Buyer-side evaluation committee"

    def test_parse_pass1_response_tolerates_absent_routing_hints(self) -> None:
        """The default envelope fixture carries no purpose/task/audience
        keys at all — absence must never raise (they are NOT required
        envelope keys)."""
        uri = build_source_document_uri(_SD_ID)
        message = _MockMessage(
            [TextBlock(type="text", text=_envelope_json(citations=[uri, "topics/gdpr.md"]))],
            stop_reason="end_turn",
        )
        envelope = enrich._parse_pass1_response(
            message, seen_anchors={uri}, catalogue_paths={"topics/gdpr.md"}
        )
        assert envelope.purpose is None
        assert envelope.task is None
        assert envelope.audience is None

    def test_end_to_end_draft_threads_routing_hints_into_frontmatter_when_supplied(
        self,
    ) -> None:
        key = _product_key()
        source = _FakeSource(
            catalogue=_catalogue_with_gdpr(key), raw_by_path={key.rel_path: _product_raw()}
        )
        final = _MockMessage(
            [
                TextBlock(
                    type="text",
                    text=_envelope_json(
                        purpose="Explain the LMS offering to a prospect",
                        task="Answering a procurement RFI question",
                        audience="Buyer-side evaluation committee",
                    ),
                )
            ],
            stop_reason="end_turn",
        )
        client = _mock_client([_read_concept_raw_tool_turn(key), final])

        async def _exercise():
            with patch(
                "scripts.cocoindex_pipeline.producer.enrich.anthropic.AsyncAnthropic",
                return_value=client,
            ):
                return await enrich.enrich_concept(key, source)

        draft = asyncio.run(_exercise())
        assert draft.frontmatter.purpose == "Explain the LMS offering to a prospect"
        assert draft.frontmatter.task == "Answering a procurement RFI question"
        assert draft.frontmatter.audience == "Buyer-side evaluation committee"
        rendered = draft.rendered_markdown
        assert "purpose: Explain the LMS offering to a prospect" in rendered
        assert "task: Answering a procurement RFI question" in rendered
        assert "audience: Buyer-side evaluation committee" in rendered

    def test_end_to_end_draft_omits_routing_hint_lines_when_the_model_does_not_supply_them(
        self,
    ) -> None:
        key = _product_key()
        source = _FakeSource(
            catalogue=_catalogue_with_gdpr(key), raw_by_path={key.rel_path: _product_raw()}
        )
        final = _MockMessage(
            [TextBlock(type="text", text=_envelope_json())], stop_reason="end_turn"
        )
        client = _mock_client([_read_concept_raw_tool_turn(key), final])

        async def _exercise():
            with patch(
                "scripts.cocoindex_pipeline.producer.enrich.anthropic.AsyncAnthropic",
                return_value=client,
            ):
                return await enrich.enrich_concept(key, source)

        draft = asyncio.run(_exercise())
        assert draft.frontmatter.purpose is None
        assert draft.frontmatter.task is None
        assert draft.frontmatter.audience is None
        rendered = draft.rendered_markdown
        assert "purpose:" not in rendered
        assert "task:" not in rendered
        assert "audience:" not in rendered

    def test_pass1_instruction_prompt_documents_the_three_optional_routing_hint_keys(
        self,
    ) -> None:
        """Static guard: the terminal-JSON contract the model is instructed
        against must actually document the three OPTIONAL routing-hint keys
        (bl-456) as OPTIONAL — a silent prompt regression here would leave
        the population tests above exercising a contract the model is never
        told about. `confidence` is deliberately NOT asserted here — it is
        NEVER a model key (A19, bl-477)."""
        assert '"purpose"' in PASS1_INSTRUCTION_PROMPT
        assert '"task"' in PASS1_INSTRUCTION_PROMPT
        assert '"audience"' in PASS1_INSTRUCTION_PROMPT
        assert "OPTIONAL" in PASS1_INSTRUCTION_PROMPT
        assert '"confidence"' not in PASS1_INSTRUCTION_PROMPT

    @pytest.mark.parametrize(
        "malformed_purpose",
        [
            pytest.param(123, id="non_string_int"),
            pytest.param(["not", "a", "string"], id="non_string_list"),
            pytest.param("   ", id="blank_whitespace_only"),
            pytest.param(None, id="explicit_null"),
        ],
    )
    def test_parse_pass1_response_treats_a_malformed_present_routing_hint_as_absent(
        self, malformed_purpose: object
    ) -> None:
        """Checker finding ({132.42} fix): `_read_optional_hint` documents
        FOUR "treat as absent" branches — missing key, a non-string value,
        a blank/whitespace-only string, and an explicit `null` — but the
        prior tests in this class only exercised true key-absence and a
        well-formed present value. This proves each malformed-but-PRESENT
        branch actually falls through to `None` too, exactly as a real
        terminal JSON payload could carry them (a model emitting
        `"purpose": null`, `"purpose": "   "`, or a wrong-typed value)."""
        uri = build_source_document_uri(_SD_ID)
        payload = json.loads(_envelope_json(citations=[uri, "topics/gdpr.md"]))
        payload["purpose"] = malformed_purpose
        message = _MockMessage(
            [TextBlock(type="text", text=json.dumps(payload))], stop_reason="end_turn"
        )
        envelope = enrich._parse_pass1_response(
            message, seen_anchors={uri}, catalogue_paths={"topics/gdpr.md"}
        )
        assert envelope.purpose is None

    def test_end_to_end_draft_omits_frontmatter_lines_for_malformed_routing_hints_on_all_three_keys(
        self,
    ) -> None:
        """The malformed-value tolerance above is `_read_optional_hint`'s
        SHARED behaviour across all three routing-hint keys, not a
        `purpose`-only special case — proved end-to-end here with a
        DIFFERENT malformed shape on each of `purpose`/`task`/`audience`
        (non-string, blank string, explicit null respectively), confirming
        each resolves to `None` AND is omitted from the rendered
        frontmatter (never emitted as an empty/garbage line)."""
        key = _product_key()
        source = _FakeSource(
            catalogue=_catalogue_with_gdpr(key), raw_by_path={key.rel_path: _product_raw()}
        )
        uri = build_source_document_uri(_SD_ID)
        payload = json.loads(_envelope_json(citations=[uri, "topics/gdpr.md"]))
        payload["purpose"] = 42  # non-string
        payload["task"] = "   "  # blank/whitespace-only
        payload["audience"] = None  # explicit null
        final = _MockMessage(
            [TextBlock(type="text", text=json.dumps(payload))], stop_reason="end_turn"
        )
        client = _mock_client([_read_concept_raw_tool_turn(key), final])

        async def _exercise():
            with patch(
                "scripts.cocoindex_pipeline.producer.enrich.anthropic.AsyncAnthropic",
                return_value=client,
            ):
                return await enrich.enrich_concept(key, source)

        draft = asyncio.run(_exercise())
        assert draft.frontmatter.purpose is None
        assert draft.frontmatter.task is None
        assert draft.frontmatter.audience is None
        rendered = draft.rendered_markdown
        assert "purpose:" not in rendered
        assert "task:" not in rendered
        assert "audience:" not in rendered


# ============================================================================
# END-TO-END WIRING
# ============================================================================


class TestEnrichConceptEndToEnd:
    def test_happy_path_drafts_frontmatter_body_and_citations(self) -> None:
        key = _product_key()
        source = _FakeSource(
            catalogue=_catalogue_with_gdpr(key), raw_by_path={key.rel_path: _product_raw()}
        )
        final = _MockMessage(
            [TextBlock(type="text", text=_envelope_json())], stop_reason="end_turn"
        )
        client = _mock_client([_read_concept_raw_tool_turn(key), final])

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
        # SPEC §5.1/§8: numbered REAL markdown links — record anchors keep
        # the URI as label+target; cross-links are bundle-absolute
        # leading-`/` with the rel_path as draft-time label.
        sd_uri = build_source_document_uri(_SD_ID)
        assert f"[1] [{sd_uri}]({sd_uri})" in draft.body
        assert "[2] [topics/gdpr.md](/topics/gdpr.md)" in draft.body
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
        source = _FakeSource(
            catalogue=_catalogue_with_gdpr(key), raw_by_path={key.rel_path: _product_raw()}
        )
        tool_turn = _read_concept_raw_tool_turn(key)
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

    def test_read_concept_raw_payload_for_won_bid_case_study_includes_buyer_outcome_notes_and_won_qa_provenance(
        self,
    ) -> None:
        """{132.28} testStrategy, exercised through the actual `read_concept_
        raw` tool-dispatch path (`_build_tool_executors`'s `_read_concept_
        raw` closure, not just the `_annotate_raw_with_anchors` unit level):
        a won-bid case_study concept's `read_concept_raw` tool RESULT — the
        JSON text the model actually receives — carries buyer identity
        (`workspaces`), `outcome_notes` (`form_templates`), and won-bid q_a
        provenance (`source_workspace_id`/`origin_kind`) verbatim, so Pass-1
        can ground its draft in them."""
        key = _won_bid_case_study_key()
        raw = _won_bid_raw()
        source = _FakeSource(
            catalogue=_catalogue_with_gdpr(key), raw_by_path={key.rel_path: raw}
        )
        # No source_documents/reference_items/qa_resource are minted for
        # this won-bid raw (no BI-6/BI-8 anchor form exists), so the final
        # envelope's only valid citation is a BI-9 concept cross-link.
        final = _MockMessage(
            [TextBlock(type="text", text=_envelope_json(citations=["topics/gdpr.md"]))],
            stop_reason="end_turn",
        )
        client = _mock_client([_read_concept_raw_tool_turn(key), final])

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
        payload = json.loads(tool_result_content)
        assert payload["workspaces"][0]["id"] == _WS_ID
        assert payload["form_templates"][0]["outcome_notes"] == (
            "Won on technical differentiation and price."
        )
        assert payload["q_a_pairs"][0]["source_workspace_id"] == _WS_ID
        assert payload["q_a_pairs"][0]["origin_kind"] == "derived_from_form_response"

    def test_unknown_ref_in_tool_call_returns_soft_error_not_a_raise(self) -> None:
        """A model typo (unknown ref) surfaces as a soft-error tool_result
        the model can self-correct from — it must not kill the whole Pass-1
        run (unlike a genuine Source-adapter/DB failure, which propagates
        per `run_tool_use_loop`'s posture)."""
        key = _product_key()
        source = _FakeSource(
            catalogue=_catalogue_with_gdpr(key), raw_by_path={key.rel_path: _product_raw()}
        )
        bad_tool_use = ToolUseBlock(
            type="tool_use",
            id="toolu_1",
            name="read_concept_raw",
            input={"ref": "products/does-not-exist.md"},
        )
        tool_turn = _MockMessage([bad_tool_use], stop_reason="tool_use")
        # A pure BI-9 cross-link citation (no record anchor) — the bad ref
        # never minted anything into seen_anchors, so the final envelope
        # deliberately avoids needing one; "topics/gdpr.md" validates via
        # catalogue membership alone.
        final = _MockMessage(
            [TextBlock(type="text", text=_envelope_json(citations=["topics/gdpr.md"]))],
            stop_reason="end_turn",
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
        source = _FakeSource(
            catalogue=_catalogue_with_gdpr(key), raw_by_path={key.rel_path: _product_raw()}
        )
        list_call = ToolUseBlock(
            type="tool_use", id="toolu_1", name="list_concepts", input={}
        )
        tool_turn = _MockMessage([list_call], stop_reason="tool_use")
        # list_concepts mints no record anchors — cite a pure BI-9
        # cross-link (validates via catalogue membership alone).
        final = _MockMessage(
            [TextBlock(type="text", text=_envelope_json(citations=["topics/gdpr.md"]))],
            stop_reason="end_turn",
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

    def test_end_to_end_rejects_fabricated_never_issued_anchor(self) -> None:
        """Checker-fix regression guard, exercised end-to-end: even though
        the model successfully calls `read_concept_raw` and receives real
        anchors, if its final `citations` name a DIFFERENT, well-formed but
        never-minted `canonical://` uri, the whole draft is rejected — a
        fabricated record anchor is not laundered into a valid draft just
        because the run also did some real reading."""
        key = _product_key()
        source = _FakeSource(
            catalogue=_catalogue_with_gdpr(key), raw_by_path={key.rel_path: _product_raw()}
        )
        fabricated = build_source_document_uri(str(uuid.uuid4()))
        final = _MockMessage(
            [TextBlock(type="text", text=_envelope_json(citations=[fabricated]))],
            stop_reason="end_turn",
        )
        client = _mock_client([_read_concept_raw_tool_turn(key), final])

        async def _exercise():
            with patch(
                "scripts.cocoindex_pipeline.producer.enrich.anthropic.AsyncAnthropic",
                return_value=client,
            ):
                await enrich.enrich_concept(key, source)

        with pytest.raises(enrich.Pass1DraftError, match="never minted"):
            asyncio.run(_exercise())

    def test_end_to_end_accepts_anchor_actually_minted_from_read_concept_raw(
        self,
    ) -> None:
        """Positive counterpart: a citation that IS the exact anchor
        `read_concept_raw` minted for this concept's real backing row is
        accepted end-to-end (a tool-result-minted anchor still passes)."""
        key = _product_key()
        source = _FakeSource(catalogue=[key], raw_by_path={key.rel_path: _product_raw()})
        minted = build_source_document_uri(_SD_ID)
        final = _MockMessage(
            [TextBlock(type="text", text=_envelope_json(citations=[minted]))],
            stop_reason="end_turn",
        )
        client = _mock_client([_read_concept_raw_tool_turn(key), final])

        async def _exercise():
            with patch(
                "scripts.cocoindex_pipeline.producer.enrich.anthropic.AsyncAnthropic",
                return_value=client,
            ):
                return await enrich.enrich_concept(key, source)

        draft = asyncio.run(_exercise())
        assert f"[1] [{minted}]({minted})" in draft.body


# ============================================================================
# BI-17 — sample_rows results are legally citable for sd-backed grains
# ============================================================================


class TestSampleRowsAnchorMinting:
    """`sample_rows` for the source_documents-backed grains (`company`/
    `certification` — the adapter dispatch's fallthrough arm) must mint each
    sampled row's BI-6 `canonical://` anchor into `seen_anchors`, exactly as
    `_annotate_raw_with_anchors` does for `read_concept_raw`: a row the model
    actually read via `sample_rows` is real provenance, so a citation copied
    from it must validate. Unminted sampled rows leak REAL sd ids the BI-17
    gate then (correctly) refuses — the {132.15} v3 live-run failure shape.
    q_a_pairs-backed grains stay unadorned: q_a citation is DB-internal
    (owner-ratified), so no anchor form may enter the conversation for them.
    """

    @staticmethod
    def _executors(key: ConceptKey, sample: "list[dict]") -> "tuple[dict, set]":
        source = _FakeSource(
            catalogue=_catalogue_with_gdpr(key),
            raw_by_path={},
            sample_by_path={key.rel_path: sample},
        )
        seen_anchors: "set[str]" = set()
        executors = enrich._build_tool_executors(
            key, source, [key, _gdpr_key()], {}, seen_anchors
        )
        return executors, seen_anchors

    def test_certification_sample_rows_carry_minted_sd_anchors(self) -> None:
        key = ConceptKey(
            rel_path="certifications/iso-9001.md",
            concept_type="certification",
            entity_id="ISO 9001",
        )
        sd_id = str(uuid.uuid4())
        executors, seen_anchors = self._executors(
            key, [{"id": sd_id, "filename": "iso-9001-cert.pdf"}]
        )

        rows = asyncio.run(executors["sample_rows"]({"concept": key.rel_path, "n": 5}))

        expected = build_source_document_uri(sd_id)
        assert rows == [
            {"id": sd_id, "filename": "iso-9001-cert.pdf", "resource": expected}
        ]
        assert seen_anchors == {expected}

    def test_company_sample_rows_carry_minted_sd_anchors(self) -> None:
        key = ConceptKey(rel_path="company/overview.md", concept_type="company")
        sd_id = str(uuid.uuid4())
        executors, seen_anchors = self._executors(
            key, [{"id": sd_id, "filename": "team-structure.md"}]
        )

        rows = asyncio.run(executors["sample_rows"]({"concept": key.rel_path, "n": 3}))

        expected = build_source_document_uri(sd_id)
        assert rows[0]["resource"] == expected
        assert seen_anchors == {expected}

    def test_topic_qa_sample_rows_stay_unadorned(self) -> None:
        key = _gdpr_key()
        qa_rows = [{"id": "qa-7", "question_text": "What is GDPR?"}]
        executors, seen_anchors = self._executors(key, qa_rows)

        rows = asyncio.run(executors["sample_rows"]({"concept": key.rel_path, "n": 5}))

        assert rows == qa_rows
        assert "resource" not in rows[0]
        assert seen_anchors == set()

    def test_won_bid_case_study_qa_sample_rows_stay_unadorned(self) -> None:
        key = _won_bid_case_study_key()
        qa_rows = [{"id": "qa-9", "question_text": "Outcome?", "source_workspace_id": _WS_ID}]
        executors, seen_anchors = self._executors(key, qa_rows)

        rows = asyncio.run(executors["sample_rows"]({"concept": key.rel_path, "n": 2}))

        assert rows == qa_rows
        assert seen_anchors == set()


class TestEntityMentionSdAnchorMinting:
    """`entity_mentions` rows in a `read_concept_raw` payload each carry a
    `context_snippet` — genuinely-read content from their parent
    `source_documents` row — so that parent sd is real provenance the model
    may cite. Each mention row therefore gets `resource` =
    `build_source_document_uri(source_document_id)` minted into
    `seen_anchors` (the {132.15} v4 live-run failure: a certification cited
    a mention's REAL parent sd, which had no minted anchor form). Mention
    rows' OWN ids stay unadorned — `entity_mentions` is not a BI-6
    allowlisted citation table."""

    def test_mention_rows_carry_parent_sd_anchor(self) -> None:
        key = _product_key()
        sd_id = str(uuid.uuid4())
        raw = ConceptRaw(
            entity_mentions=[
                {
                    "id": "em-1",
                    "source_document_id": sd_id,
                    "entity_name": "LMS",
                    "context_snippet": "…the LMS product…",
                }
            ]
        )
        seen_anchors: "set[str]" = set()

        payload = enrich._annotate_raw_with_anchors(key, raw, seen_anchors)

        expected = build_source_document_uri(sd_id)
        assert payload["entity_mentions"][0]["resource"] == expected
        assert payload["entity_mentions"][0]["id"] == "em-1"
        assert expected in seen_anchors

    def test_mention_row_without_parent_sd_stays_unadorned(self) -> None:
        key = _product_key()
        raw = ConceptRaw(
            entity_mentions=[{"id": "em-2", "source_document_id": None, "entity_name": "X"}]
        )
        seen_anchors: "set[str]" = set()

        payload = enrich._annotate_raw_with_anchors(key, raw, seen_anchors)

        assert "resource" not in payload["entity_mentions"][0]
        assert seen_anchors == set()


# ============================================================================
# PRODUCER_MODEL — env override threading (ID-132 {132.35} slice B, S481
# GLM-5.2 ratification, DR-079). See `test_producer_agent_loop.py::
# TestProducerModelEnvOverride` for the env-set/unset RESOLUTION-logic proof
# (`agent_loop.PRODUCER_MODEL` itself) — this class proves the WIRING half:
# `enrich_concept`'s own `model` parameter is identical to `agent_loop.
# PRODUCER_MODEL` at import time, and genuinely reaches the Anthropic
# API-call layer.
# ============================================================================


class TestProducerModelWiring:
    def test_default_model_matches_agent_loop_producer_model_at_import_time(
        self,
    ) -> None:
        default = inspect.signature(enrich.enrich_concept).parameters["model"].default
        assert default == agent_loop.PRODUCER_MODEL

    def test_an_explicit_model_override_reaches_every_messages_create_call(
        self,
    ) -> None:
        """Proves `model` threads all the way to `client.messages.create`
        for Pass-1 — the load-bearing plumbing PRODUCER_MODEL relies on
        (the default parameter mechanism is proven separately in
        `test_producer_agent_loop.py`; this proves the CALL CHAIN carries
        whatever value `model` is, default or override, through to the real
        API-call layer, exactly what a deployed `PRODUCER_MODEL=glm-5.2-...`
        run needs)."""
        key = _product_key()
        source = _FakeSource(
            catalogue=_catalogue_with_gdpr(key), raw_by_path={key.rel_path: _product_raw()}
        )
        final = _MockMessage(
            [TextBlock(type="text", text=_envelope_json())], stop_reason="end_turn"
        )
        client = _mock_client([_read_concept_raw_tool_turn(key), final])

        async def _exercise():
            with patch(
                "scripts.cocoindex_pipeline.producer.enrich.anthropic.AsyncAnthropic",
                return_value=client,
            ):
                return await enrich.enrich_concept(
                    key, source, model="glm-5.2-test-override"
                )

        asyncio.run(_exercise())

        assert client.messages.create.call_args_list  # sanity: at least 1 call
        for call in client.messages.create.call_args_list:
            assert call.kwargs["model"] == "glm-5.2-test-override"
