"""Tests for producer/web_pass.py — Pass-2 gated enrichment (ID-132 {132.9}
G-PASS2).

Per the {132.9} testStrategy:

  - egress-confinement: Pass-2 fetches ONLY host-allowlisted URLs — a
    non-allowlisted host is REFUSED, and the refusal is a soft-error
    `tool_result` (`is_error: true`) the model can self-correct from, never
    a killed run; depth-limit and path-filter are exercised the same way.
  - `references/<slug>.md` reference concepts are created with `# Citations`
    pointing at the NEW `reference_items` anchors this run's `fetch_url`
    minted.
  - every enrichment datum traces to a cited GATED reference (BI-17) — the
    PROVENANCE-LEDGER check (membership in `seen_gated_anchors`/
    `seen_record_anchors`/`catalogue_paths` this run actually populated),
    not a format-only check.
  - the augmentation guard: a Pass-2 result that would shrink the concept's
    record-grounded `# Citations` (relative to its Pass-1 state) is REFUSED
    via `producer/validator.py:detect_citation_shrink` — the single shared
    detection function, not reimplemented here.

De-identified throughout: every fixture host is an `example.test`-family
name (RFC 2606 reserved) — never a client-identifying URL.

Like `test_producer_enrich.py`, `web_pass.py` transitively requires
`cocoindex` at import time (it imports `producer/enrich.py`, which needs
`@coco.fn`) — the module-under-test import is scoped inside
`stubbed_sys_modules({"cocoindex": ...})` so the Rust/LMDB engine never
boots at collection time (ID-44.5).
"""

from __future__ import annotations

import asyncio
import json
import sys
import uuid
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
from anthropic.types import TextBlock, ToolUseBlock

# ── Path setup — mirrors test_producer_enrich.py / test_producer_agent_loop.py.

_REPO_ROOT = Path(__file__).resolve().parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from conftest import stubbed_sys_modules  # noqa: E402


def _make_coco_stub() -> MagicMock:
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
    from scripts.cocoindex_pipeline.producer import web_pass  # noqa: E402

from scripts.cocoindex_pipeline.producer.enrich import (  # noqa: E402
    ConceptDraft,
    _render_citations_section,
)
from scripts.cocoindex_pipeline.producer.frontmatter import (  # noqa: E402
    build_concept_frontmatter,
)
from scripts.cocoindex_pipeline.producer.resource_uri import (  # noqa: E402
    build_source_document_uri,
    reference_item_uri_from_source_url,
)
from scripts.cocoindex_pipeline.sources.l_records import (  # noqa: E402
    ConceptKey,
    ConceptRaw,
)

_SD_ID = "11111111-1111-4111-8111-111111111111"

# RFC 2606-reserved, de-identified fixture hosts — never client-identifying.
_ALLOWED_HOST = "docs.client.example.test"
_OFF_ALLOWLIST_HOST = "evil.example.test"


# ── Test doubles ─────────────────────────────────────────────────────────


class _MockMessage:
    def __init__(self, content: "list[Any]", stop_reason: str) -> None:
        self.content = content
        self.stop_reason = stop_reason


def _mock_client(side_effects: "list[Any]") -> MagicMock:
    client = MagicMock(name="AsyncAnthropic_instance")
    client.messages.create = AsyncMock(side_effect=side_effects)
    return client


class _FakeHttpResponse:
    def __init__(
        self,
        content: bytes,
        headers: "dict[str, str] | None" = None,
        *,
        status_code: int = 200,
    ) -> None:
        self.content = content
        self.headers = headers or {}
        self.status_code = status_code


class _FakeHttpClient:
    """Duck-typed `httpx.AsyncClient` stand-in — `.get(url)` replays a
    fixture response or raises `httpx.HTTPError` for an unmapped URL."""

    def __init__(self, responses: "dict[str, _FakeHttpResponse]") -> None:
        self._responses = responses
        self.requested_urls: "list[str]" = []

    async def get(self, url: str) -> _FakeHttpResponse:
        self.requested_urls.append(url)
        if url not in self._responses:
            raise httpx.HTTPError(f"no fixture response for {url}")
        return self._responses[url]


class _FakeSource:
    def __init__(
        self, catalogue: "list[ConceptKey]", raw_by_path: "dict[str, ConceptRaw]"
    ) -> None:
        self._catalogue = list(catalogue)
        self._raw_by_path = raw_by_path
        self.read_concept_calls: "list[ConceptKey]" = []

    async def list_concepts(self) -> "list[ConceptKey]":
        return list(self._catalogue)

    async def read_concept(self, key: ConceptKey) -> ConceptRaw:
        self.read_concept_calls.append(key)
        return self._raw_by_path[key.rel_path]

    async def sample_rows(self, key: ConceptKey, n: int) -> "list[dict]":  # pragma: no cover
        return []

    async def find(self, query: str) -> "list[ConceptKey]":  # pragma: no cover
        raise NotImplementedError


@pytest.fixture(autouse=True)
def _fake_api_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-dummy-key-for-mocked-tests")


def _product_key() -> ConceptKey:
    return ConceptKey(rel_path="products/lms.md", concept_type="product", entity_id="LMS")


def _gdpr_key() -> ConceptKey:
    return ConceptKey(rel_path="topics/gdpr.md", concept_type="topic", scope_tag="gdpr")


def _product_raw() -> ConceptRaw:
    return ConceptRaw(source_documents=[{"id": _SD_ID, "filename": "01-company-overview.docx"}])


def _product_draft(key: ConceptKey) -> ConceptDraft:
    """A Pass-1-shaped `ConceptDraft` — the "previous state" every Pass-2
    test enriches from."""
    frontmatter = build_concept_frontmatter(
        type=key.concept_type,
        title="Learning Management System",
        description="The client's in-house LMS offering.",
        timestamp="2026-01-01T00:00:00Z",
        tags=("product", "lms"),
        resource=build_source_document_uri(_SD_ID),
    )
    citation = build_source_document_uri(_SD_ID)
    body = (
        f"The LMS is the client's learning-management product.\n\n"
        f"{_render_citations_section([citation])}"
    )
    return ConceptDraft(key=key, frontmatter=frontmatter, body=body)


def _pass2_envelope_json(
    *,
    body: str = "The LMS is the client's learning-management product, now enriched with public documentation detail.",
    citations: "list[str]",
    reference_concepts: "list[dict] | None" = None,
) -> str:
    return json.dumps(
        {
            "title": "Learning Management System",
            "description": "The client's in-house LMS offering, now enriched.",
            "tags": ["product", "lms"],
            "body": body,
            "citations": citations,
            "reference_concepts": reference_concepts or [],
        }
    )


# ============================================================================
# BI-16 — the gated-corpus GATE (host-allowlist + depth-limit + path-filter)
# ============================================================================


class TestCheckGate:
    def _config(self, **source_kwargs: Any) -> "web_pass.GatedCorpusConfig":
        return web_pass.GatedCorpusConfig(
            sources=(web_pass.GatedSource(host=_ALLOWED_HOST, **source_kwargs),)
        )

    def test_allows_an_in_gate_url(self) -> None:
        config = self._config(max_depth=3)
        assert web_pass._check_gate(f"https://{_ALLOWED_HOST}/services/lms", config) is None

    def test_refuses_a_host_outside_the_allowlist(self) -> None:
        config = self._config()
        reason = web_pass._check_gate(f"https://{_OFF_ALLOWLIST_HOST}/anything", config)
        assert reason is not None
        assert "not in the Pass-2 gated-corpus host-allowlist" in reason

    def test_refuses_a_non_http_scheme(self) -> None:
        config = self._config()
        reason = web_pass._check_gate(f"ftp://{_ALLOWED_HOST}/file", config)
        assert reason is not None
        assert "not http/https" in reason

    def test_refuses_a_path_beyond_max_depth(self) -> None:
        config = self._config(max_depth=1)
        reason = web_pass._check_gate(f"https://{_ALLOWED_HOST}/a/b/c", config)
        assert reason is not None
        assert "exceeds" in reason and "max_depth" in reason

    def test_allows_a_path_at_exactly_max_depth(self) -> None:
        config = self._config(max_depth=2)
        assert web_pass._check_gate(f"https://{_ALLOWED_HOST}/a/b", config) is None

    def test_refuses_a_path_outside_allowed_path_prefixes(self) -> None:
        config = self._config(max_depth=3, allowed_path_prefixes=("/services/",))
        reason = web_pass._check_gate(f"https://{_ALLOWED_HOST}/careers/openings", config)
        assert reason is not None
        assert "allowed_path_prefixes" in reason

    def test_allows_a_path_matching_an_allowed_prefix(self) -> None:
        config = self._config(max_depth=3, allowed_path_prefixes=("/services/",))
        assert (
            web_pass._check_gate(f"https://{_ALLOWED_HOST}/services/lms", config) is None
        )


class TestGatedCorpusConfigFind:
    def test_find_matches_host_case_insensitively(self) -> None:
        config = web_pass.GatedCorpusConfig(
            sources=(web_pass.GatedSource(host=_ALLOWED_HOST),)
        )
        found = config.find(f"https://{_ALLOWED_HOST.upper()}/x")
        assert found is not None
        assert found.host == _ALLOWED_HOST

    def test_find_returns_none_for_an_unknown_host(self) -> None:
        config = web_pass.GatedCorpusConfig(sources=())
        assert config.find(f"https://{_ALLOWED_HOST}/x") is None


# ============================================================================
# The local gated-corpus reader (TECH.md E8 — MarkdownFileset port)
# ============================================================================


class TestLocalMarkdownFileset:
    def test_read_file_returns_file_contents(self, tmp_path: Path) -> None:
        (tmp_path / "services").mkdir()
        (tmp_path / "services" / "lms.md").write_text("The LMS is a cloud platform.")
        fileset = web_pass._LocalMarkdownFileset(tmp_path)
        assert fileset.read_file("services/lms.md") == "The LMS is a cloud platform."

    def test_list_contents_lists_directory_entries(self, tmp_path: Path) -> None:
        (tmp_path / "a.md").write_text("a")
        (tmp_path / "b.md").write_text("b")
        fileset = web_pass._LocalMarkdownFileset(tmp_path)
        listing = fileset.list_contents("")
        assert "a.md" in listing
        assert "b.md" in listing

    def test_read_file_on_missing_path_returns_a_not_found_string_not_raise(
        self, tmp_path: Path
    ) -> None:
        fileset = web_pass._LocalMarkdownFileset(tmp_path)
        result = fileset.read_file("does-not-exist.md")
        assert "not found" in result.lower()

    def test_safe_path_refuses_traversal_outside_root(self, tmp_path: Path) -> None:
        (tmp_path / "inner").mkdir()
        fileset = web_pass._LocalMarkdownFileset(tmp_path / "inner")
        with pytest.raises(ValueError, match="path traversal refused"):
            fileset.read_file("../../etc/passwd")

    def test_constructor_rejects_a_non_directory_root(self, tmp_path: Path) -> None:
        not_a_dir = tmp_path / "nope"
        with pytest.raises(ValueError, match="does not exist"):
            web_pass._LocalMarkdownFileset(not_a_dir)


# ============================================================================
# The fetch_url tool executor — egress-confinement (BI-16) + BI-17 minting
# ============================================================================


class TestWebFetchExecutor:
    def _local_config(self, root: Path, **source_kwargs: Any) -> "web_pass.GatedCorpusConfig":
        return web_pass.GatedCorpusConfig(
            sources=(
                web_pass.GatedSource(
                    host=_ALLOWED_HOST, max_depth=5, local_root=root, **source_kwargs
                ),
            )
        )

    def test_off_allowlist_host_is_refused_and_mints_no_anchor(self) -> None:
        config = web_pass.GatedCorpusConfig(sources=())
        seen: "set[str]" = set()
        executor = web_pass._build_web_fetch_executor(
            config, http_client=None, seen_gated_anchors=seen
        )

        async def _exercise() -> Any:
            return await executor({"url": f"https://{_OFF_ALLOWLIST_HOST}/page"})

        result = asyncio.run(_exercise())
        assert "error" in result
        assert "host-allowlist" in result["error"]
        assert seen == set()

    def test_local_route_fetch_reads_the_snapshot_and_mints_a_reference_items_anchor(
        self, tmp_path: Path
    ) -> None:
        (tmp_path / "services").mkdir()
        (tmp_path / "services" / "lms.md").write_text(
            "Our LMS platform supports SCORM and xAPI standards."
        )
        config = self._local_config(tmp_path)
        seen: "set[str]" = set()
        executor = web_pass._build_web_fetch_executor(
            config, http_client=None, seen_gated_anchors=seen
        )
        url = f"https://{_ALLOWED_HOST}/services/lms.md"

        async def _exercise() -> Any:
            return await executor({"url": url})

        result = asyncio.run(_exercise())
        assert "error" not in result
        assert "SCORM" in result["content"]
        expected_anchor = reference_item_uri_from_source_url(url)
        assert result["resource"] == expected_anchor
        assert seen == {expected_anchor}

    def test_local_route_falls_back_to_md_extension(self, tmp_path: Path) -> None:
        (tmp_path / "about.md").write_text("About the client.")
        config = self._local_config(tmp_path)
        seen: "set[str]" = set()
        executor = web_pass._build_web_fetch_executor(
            config, http_client=None, seen_gated_anchors=seen
        )

        async def _exercise() -> Any:
            return await executor({"url": f"https://{_ALLOWED_HOST}/about"})

        result = asyncio.run(_exercise())
        assert result["content"] == "About the client."

    def test_remote_route_fetches_via_injected_http_client_and_mints_anchor(self) -> None:
        url = f"https://{_ALLOWED_HOST}/services/lms"
        http_client = _FakeHttpClient(
            {url: _FakeHttpResponse(b"Plain-text service description.", headers={})}
        )
        config = web_pass.GatedCorpusConfig(
            sources=(web_pass.GatedSource(host=_ALLOWED_HOST, max_depth=5),)
        )
        seen: "set[str]" = set()
        executor = web_pass._build_web_fetch_executor(
            config, http_client=http_client, seen_gated_anchors=seen
        )

        async def _exercise() -> Any:
            return await executor({"url": url})

        result = asyncio.run(_exercise())
        assert result["content"] == "Plain-text service description."
        assert http_client.requested_urls == [url]
        assert seen == {reference_item_uri_from_source_url(url)}

    def test_redirect_to_a_non_allowlisted_host_is_refused_and_never_second_requested(
        self,
    ) -> None:
        """SECURITY (post-commit finding, HIGH) — an allowlisted URL that
        responds 3xx with a `Location` on a NON-allowlisted host must be
        REFUSED as a soft error, not silently chased there. `_FakeHttpClient`
        never auto-follows on its own (only `httpx`'s real
        `follow_redirects` flag would), so the load-bearing proof is that
        the executor itself never issues a SECOND request for the
        `Location` target — it stops at the 3xx and returns to the model."""
        url = f"https://{_ALLOWED_HOST}/services/lms"
        http_client = _FakeHttpClient(
            {
                url: _FakeHttpResponse(
                    b"",
                    headers={"Location": f"https://{_OFF_ALLOWLIST_HOST}/evil"},
                    status_code=302,
                )
            }
        )
        config = web_pass.GatedCorpusConfig(
            sources=(web_pass.GatedSource(host=_ALLOWED_HOST, max_depth=5),)
        )
        seen: "set[str]" = set()
        executor = web_pass._build_web_fetch_executor(
            config, http_client=http_client, seen_gated_anchors=seen
        )

        async def _exercise() -> Any:
            return await executor({"url": url})

        result = asyncio.run(_exercise())
        assert "error" in result
        assert "redirect" in result["error"]
        assert "BI-16" in result["error"]
        assert http_client.requested_urls == [url]  # exactly ONE request — never the Location
        assert seen == set()  # no anchor minted for a refused fetch

    def test_redirect_to_an_allowlisted_target_is_also_refused_not_auto_followed(
        self,
    ) -> None:
        """A 3xx whose `Location` happens to point at an ALLOWLISTED host
        is STILL not auto-followed — the loop must re-gate every fetch,
        including redirect targets that would themselves have passed the
        gate. The refusal reaches the model as an ordinary soft error; it
        may then issue a fresh fetch_url call for the Location target
        itself."""
        url = f"https://{_ALLOWED_HOST}/old-page"
        http_client = _FakeHttpClient(
            {
                url: _FakeHttpResponse(
                    b"",
                    headers={"Location": f"https://{_ALLOWED_HOST}/new-page"},
                    status_code=301,
                )
            }
        )
        config = web_pass.GatedCorpusConfig(
            sources=(web_pass.GatedSource(host=_ALLOWED_HOST, max_depth=5),)
        )
        seen: "set[str]" = set()
        executor = web_pass._build_web_fetch_executor(
            config, http_client=http_client, seen_gated_anchors=seen
        )

        async def _exercise() -> Any:
            return await executor({"url": url})

        result = asyncio.run(_exercise())
        assert "error" in result
        assert "redirect" in result["error"]
        assert http_client.requested_urls == [url]  # never auto-hopped to /new-page
        assert seen == set()

    def test_refused_url_is_never_actually_fetched(self) -> None:
        """Egress-confinement, dynamic proof: a refused URL never reaches
        the http client at all — the gate runs BEFORE any fetch."""
        http_client = _FakeHttpClient({})
        config = web_pass.GatedCorpusConfig(sources=())
        seen: "set[str]" = set()
        executor = web_pass._build_web_fetch_executor(
            config, http_client=http_client, seen_gated_anchors=seen
        )

        async def _exercise() -> Any:
            return await executor({"url": f"https://{_OFF_ALLOWLIST_HOST}/page"})

        result = asyncio.run(_exercise())
        assert "error" in result
        assert http_client.requested_urls == []

    def test_ssrf_blocked_host_is_refused_even_if_allowlisted(self) -> None:
        """Defense-in-depth: `validate_url` (the existing SSRF gate) still
        refuses a loopback host even when it is (mis)configured onto the
        BI-16 allowlist."""
        config = web_pass.GatedCorpusConfig(
            sources=(web_pass.GatedSource(host="localhost", max_depth=5),)
        )
        seen: "set[str]" = set()
        executor = web_pass._build_web_fetch_executor(
            config, http_client=_FakeHttpClient({}), seen_gated_anchors=seen
        )

        async def _exercise() -> Any:
            return await executor({"url": "http://localhost/admin"})

        result = asyncio.run(_exercise())
        assert "error" in result
        assert "SSRF" in result["error"]
        assert seen == set()

    def test_fetch_failure_is_a_soft_error_not_a_raise(self) -> None:
        http_client = _FakeHttpClient({})  # no fixture ⇒ raises httpx.HTTPError
        config = web_pass.GatedCorpusConfig(
            sources=(web_pass.GatedSource(host=_ALLOWED_HOST, max_depth=5),)
        )
        seen: "set[str]" = set()
        executor = web_pass._build_web_fetch_executor(
            config, http_client=http_client, seen_gated_anchors=seen
        )

        async def _exercise() -> Any:
            return await executor({"url": f"https://{_ALLOWED_HOST}/missing"})

        result = asyncio.run(_exercise())
        assert "error" in result
        assert seen == set()


# ============================================================================
# BI-17 citation provenance — trusted carry-over vs newly-minted-this-run
# ============================================================================


class TestValidatePass2Citations:
    def test_a_previously_cited_entry_is_trusted_without_reproving_provenance(self) -> None:
        prior = build_source_document_uri(_SD_ID)
        validated = web_pass._validate_pass2_citations(
            [prior],
            previous_entries={prior},
            seen_anchors=set(),  # empty — proves NO re-check happens
            catalogue_paths=set(),
        )
        assert validated == (prior,)

    def test_a_previously_cited_entry_returned_link_wrapped_still_matches(self) -> None:
        """SPEC §5.1/§8 tolerance: `previous_entries` holds bare TARGETS
        (both trailer forms normalise there) — a model carrying a Pass-1
        citation forward in the numbered-link form must still match it,
        and the validated tuple carries the normalised bare target."""
        prior = build_source_document_uri(_SD_ID)
        validated = web_pass._validate_pass2_citations(
            [f"[1] [{prior}]({prior})"],
            previous_entries={prior},
            seen_anchors=set(),  # empty — proves NO re-check happens
            catalogue_paths=set(),
        )
        assert validated == (prior,)

    def test_a_new_record_anchor_not_in_seen_anchors_is_rejected(self) -> None:
        fabricated = build_source_document_uri(str(uuid.uuid4()))
        with pytest.raises(web_pass.Pass2EnrichError, match="never minted"):
            web_pass._validate_pass2_citations(
                [fabricated],
                previous_entries=set(),
                seen_anchors=set(),
                catalogue_paths=set(),
            )

    def test_a_new_gated_anchor_in_seen_anchors_is_accepted(self) -> None:
        anchor = reference_item_uri_from_source_url(f"https://{_ALLOWED_HOST}/services/lms")
        validated = web_pass._validate_pass2_citations(
            [anchor],
            previous_entries=set(),
            seen_anchors={anchor},
            catalogue_paths=set(),
        )
        assert validated == (anchor,)

    def test_a_new_concept_cross_link_must_be_in_the_catalogue(self) -> None:
        with pytest.raises(web_pass.Pass2EnrichError, match="BI-9"):
            web_pass._validate_pass2_citations(
                ["topics/never-listed.md"],
                previous_entries=set(),
                seen_anchors=set(),
                catalogue_paths=set(),
            )

    def test_a_new_concept_cross_link_in_the_catalogue_is_accepted(self) -> None:
        validated = web_pass._validate_pass2_citations(
            ["topics/gdpr.md"],
            previous_entries=set(),
            seen_anchors=set(),
            catalogue_paths={"topics/gdpr.md"},
        )
        assert validated == ("topics/gdpr.md",)

    def test_empty_citations_list_is_rejected(self) -> None:
        with pytest.raises(web_pass.Pass2EnrichError, match="non-empty"):
            web_pass._validate_pass2_citations(
                [], previous_entries=set(), seen_anchors=set(), catalogue_paths=set()
            )


# ============================================================================
# references/<slug>.md reference-concept parsing (DR-025)
# ============================================================================


class TestParseReferenceConcept:
    def _raw(self, **overrides: Any) -> "dict[str, Any]":
        anchor = reference_item_uri_from_source_url(f"https://{_ALLOWED_HOST}/services/lms")
        base = {
            "slug": "lms-public-docs",
            "title": "LMS public documentation",
            "description": "Publicly documented LMS capabilities.",
            "tags": ["docs"],
            "body": "The public docs describe SCORM/xAPI support.",
            "citations": [anchor],
        }
        base.update(overrides)
        return base

    def test_valid_entry_produces_a_references_slug_md_draft(self) -> None:
        anchor = reference_item_uri_from_source_url(f"https://{_ALLOWED_HOST}/services/lms")
        draft = web_pass._parse_reference_concept(self._raw(), seen_gated_anchors={anchor})
        assert draft.rel_path == "references/lms-public-docs.md"
        assert draft.frontmatter.type == "topic"
        assert "reference" in draft.frontmatter.tags
        assert draft.frontmatter.resource == anchor
        assert f"[1] [{anchor}]({anchor})" in draft.body

    def test_invalid_slug_is_rejected(self) -> None:
        anchor = reference_item_uri_from_source_url(f"https://{_ALLOWED_HOST}/services/lms")
        with pytest.raises(web_pass.Pass2EnrichError, match="slug"):
            web_pass._parse_reference_concept(
                self._raw(slug="Not A Slug!"), seen_gated_anchors={anchor}
            )

    def test_a_source_documents_anchor_is_rejected_dr025(self) -> None:
        """DR-025 — a reference concept's citations anchor ONLY
        `reference_items` (the gated-fetch provenance register), never a
        `source_documents` row anchor."""
        sd_anchor = build_source_document_uri(_SD_ID)
        with pytest.raises(web_pass.Pass2EnrichError, match="reference_items"):
            web_pass._parse_reference_concept(
                self._raw(citations=[sd_anchor]), seen_gated_anchors={sd_anchor}
            )

    def test_a_citation_never_minted_this_run_is_rejected(self) -> None:
        """BI-17 provenance-ledger membership, not format-only — a
        well-formed reference_items anchor that fetch_url never actually
        minted this run still fails."""
        never_minted = reference_item_uri_from_source_url(
            f"https://{_ALLOWED_HOST}/never/fetched"
        )
        with pytest.raises(web_pass.Pass2EnrichError, match="never minted"):
            web_pass._parse_reference_concept(
                self._raw(citations=[never_minted]), seen_gated_anchors=set()
            )

    def test_missing_required_key_is_rejected(self) -> None:
        raw = self._raw()
        del raw["body"]
        with pytest.raises(web_pass.Pass2EnrichError, match="missing required"):
            web_pass._parse_reference_concept(raw, seen_gated_anchors=set())


# ============================================================================
# SECURITY — the http_client injection seam must not reopen the
# redirect-bypass class (Checker finding, post-commit; dormant today, no
# production caller injects http_client yet — {132.10} will wire one).
# ============================================================================


class _ExplodingSource:
    """A `Source` double whose every method raises — proves a caller-
    supplied redirect-following `http_client` is rejected BEFORE any
    other work happens (not merely rejected eventually)."""

    async def list_concepts(self) -> "list[ConceptKey]":
        raise AssertionError(
            "list_concepts must never be called — the redirect-following "
            "http_client check must run first"
        )

    async def read_concept(self, key: ConceptKey) -> ConceptRaw:  # pragma: no cover
        raise AssertionError("read_concept must never be called")

    async def sample_rows(self, key: ConceptKey, n: int) -> "list[dict]":  # pragma: no cover
        raise AssertionError("sample_rows must never be called")

    async def find(self, query: str) -> "list[ConceptKey]":  # pragma: no cover
        raise AssertionError("find must never be called")


class TestRejectRedirectFollowingHttpClient:
    def test_injected_httpx_client_with_follow_redirects_true_raises_before_any_fetch(
        self,
    ) -> None:
        key = _product_key()
        draft = _product_draft(key)
        gated_corpus = web_pass.GatedCorpusConfig(sources=())
        redirect_following_client = httpx.AsyncClient(follow_redirects=True)

        async def _exercise() -> Any:
            return await web_pass.run_web_pass(
                draft,
                key,
                _ExplodingSource(),
                gated_corpus,
                http_client=redirect_following_client,
            )

        try:
            with pytest.raises(web_pass.Pass2EnrichError, match="follow_redirects=False"):
                asyncio.run(_exercise())
        finally:
            asyncio.run(redirect_following_client.aclose())

    def test_injected_client_with_follow_redirects_false_is_accepted(self) -> None:
        """The rejection is specific to redirect-following, not to real
        `httpx.AsyncClient` instances in general."""
        key = _product_key()
        source = _FakeSource(catalogue=[key], raw_by_path={key.rel_path: _product_raw()})
        draft = _product_draft(key)
        gated_corpus = web_pass.GatedCorpusConfig(sources=())
        safe_client = httpx.AsyncClient(follow_redirects=False)

        final = _MockMessage(
            [
                TextBlock(
                    type="text",
                    text=_pass2_envelope_json(citations=[build_source_document_uri(_SD_ID)]),
                )
            ],
            stop_reason="end_turn",
        )
        anthropic_client = _mock_client([final])

        async def _exercise() -> Any:
            with patch(
                "scripts.cocoindex_pipeline.producer.web_pass.anthropic.AsyncAnthropic",
                return_value=anthropic_client,
            ):
                return await web_pass.run_web_pass(
                    draft, key, source, gated_corpus, http_client=safe_client
                )

        try:
            result = asyncio.run(_exercise())
        finally:
            asyncio.run(safe_client.aclose())

        assert result.concept.key == key

    def test_a_fake_client_without_follow_redirects_attribute_is_accepted(self) -> None:
        """`_FakeHttpClient` (this file's own test double) never models
        `follow_redirects` at all — `getattr`'s default makes it pass, the
        pragmatic outcome for test fakes with no real transport."""
        key = _product_key()
        source = _FakeSource(catalogue=[key], raw_by_path={key.rel_path: _product_raw()})
        draft = _product_draft(key)
        gated_corpus = web_pass.GatedCorpusConfig(sources=())
        fake_client = _FakeHttpClient({})

        final = _MockMessage(
            [
                TextBlock(
                    type="text",
                    text=_pass2_envelope_json(citations=[build_source_document_uri(_SD_ID)]),
                )
            ],
            stop_reason="end_turn",
        )
        anthropic_client = _mock_client([final])

        async def _exercise() -> Any:
            with patch(
                "scripts.cocoindex_pipeline.producer.web_pass.anthropic.AsyncAnthropic",
                return_value=anthropic_client,
            ):
                return await web_pass.run_web_pass(
                    draft, key, source, gated_corpus, http_client=fake_client
                )

        result = asyncio.run(_exercise())
        assert result.concept.key == key


# ============================================================================
# _parse_pass2_response — terminal-text JSON tolerance ({132.15})
# ============================================================================


class TestParsePass2ResponseTerminalTextTolerance:
    """`_parse_pass2_response` shares `_parse_pass1_response`'s bare-
    `json.loads` boundary on the terminal text (same
    `enrich._recover_terminal_json_object` fallback), so it is exposed to
    the identical {132.15} live-run defect: `claude-opus-4-6` terminal
    turns occasionally prefix (and/or trail) the JSON payload with
    conversational prose despite the instruction prompt's "no commentary"
    contract."""

    def test_parse_response_tolerates_leading_prose_before_terminal_json(self) -> None:
        citation = build_source_document_uri(_SD_ID)
        previous_body = (
            "The LMS is the client's learning-management product.\n\n"
            f"{_render_citations_section([citation])}"
        )
        preamble = (
            "I have reviewed the gated documentation and drafted the "
            "enriched concept.\n\n"
        )
        message = _MockMessage(
            [
                TextBlock(
                    type="text",
                    text=preamble + _pass2_envelope_json(citations=[citation]),
                )
            ],
            stop_reason="end_turn",
        )
        envelope = web_pass._parse_pass2_response(
            message,
            previous_body=previous_body,
            seen_record_anchors=set(),
            seen_gated_anchors=set(),
            catalogue_paths=set(),
        )
        assert envelope.citations == (citation,)

    def test_parse_response_tolerates_leading_prose_and_trailing_commentary(
        self,
    ) -> None:
        citation = build_source_document_uri(_SD_ID)
        previous_body = (
            "The LMS is the client's learning-management product.\n\n"
            f"{_render_citations_section([citation])}"
        )
        preamble = "Here is the enriched concept document.\n\n"
        trailing = "\n\nLet me know if further detail would help."
        message = _MockMessage(
            [
                TextBlock(
                    type="text",
                    text=preamble + _pass2_envelope_json(citations=[citation]) + trailing,
                )
            ],
            stop_reason="end_turn",
        )
        envelope = web_pass._parse_pass2_response(
            message,
            previous_body=previous_body,
            seen_record_anchors=set(),
            seen_gated_anchors=set(),
            catalogue_paths=set(),
        )
        assert envelope.citations == (citation,)

    def test_parse_response_still_raises_pass2_enrich_error_for_pure_prose(
        self,
    ) -> None:
        """No `{` anywhere in the text — the recovery path has nothing to
        locate, so this must still surface the informative
        `Pass2EnrichError`, never hang or silently swallow the failure."""
        message = _MockMessage(
            [
                TextBlock(
                    type="text",
                    text=(
                        "I reviewed the gated sources but was unable to "
                        "draft an enriched concept at this time."
                    ),
                )
            ],
            stop_reason="end_turn",
        )
        with pytest.raises(web_pass.Pass2EnrichError, match="valid JSON"):
            web_pass._parse_pass2_response(
                message,
                previous_body="",
                seen_record_anchors=set(),
                seen_gated_anchors=set(),
                catalogue_paths=set(),
            )

    def test_parse_response_tolerates_json_wrapped_in_markdown_code_fence(
        self,
    ) -> None:
        """Terminal turns sometimes wrap the payload in a fenced ```json
        code block rather than (or in addition to) plain prose — the fence
        markers themselves are not JSON, so the same first-brace-recovery
        path must skip past the ```json marker and stop before the closing
        fence."""
        citation = build_source_document_uri(_SD_ID)
        previous_body = (
            "The LMS is the client's learning-management product.\n\n"
            f"{_render_citations_section([citation])}"
        )
        message = _MockMessage(
            [
                TextBlock(
                    type="text",
                    text=(
                        "Here is the enriched concept document:\n\n"
                        "```json\n"
                        + _pass2_envelope_json(citations=[citation])
                        + "\n```\n"
                    ),
                )
            ],
            stop_reason="end_turn",
        )
        envelope = web_pass._parse_pass2_response(
            message,
            previous_body=previous_body,
            seen_record_anchors=set(),
            seen_gated_anchors=set(),
            catalogue_paths=set(),
        )
        assert envelope.citations == (citation,)

    def test_parse_response_still_raises_pass2_enrich_error_when_brace_present_but_unparseable(
        self,
    ) -> None:
        """A brace IS present (so the recovery path fires) but the text
        after it never closes into a valid JSON object — e.g. the model was
        cut off mid-draft. This must still surface `Pass2EnrichError`
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
        with pytest.raises(web_pass.Pass2EnrichError, match="valid JSON"):
            web_pass._parse_pass2_response(
                message,
                previous_body="",
                seen_record_anchors=set(),
                seen_gated_anchors=set(),
                catalogue_paths=set(),
            )


# ============================================================================
# run_web_pass — end to end
# ============================================================================


class TestRunWebPassEndToEnd:
    def test_egress_confinement_and_provenance_traced_reference_concept(self) -> None:
        """Full-loop happy path: the model tries an off-allowlist host first
        (refused, is_error, self-corrects) then a local-route in-corpus URL
        (succeeds), then finalises citing the new gated anchor and minting a
        references/<slug>.md concept from it — mirrors the {132.9}
        testStrategy's egress-confinement + provenance-traceability +
        reference-concept lines in one exercise."""

        def _run(tmp_path: Path) -> "web_pass.WebPassResult":
            (tmp_path / "services").mkdir()
            (tmp_path / "services" / "lms.md").write_text(
                "Our LMS supports SCORM and xAPI, hosted on ISO 27001-certified infrastructure."
            )
            key = _product_key()
            source = _FakeSource(
                catalogue=[key, _gdpr_key()], raw_by_path={key.rel_path: _product_raw()}
            )
            draft = _product_draft(key)
            gated_url = f"https://{_ALLOWED_HOST}/services/lms.md"
            gated_anchor = reference_item_uri_from_source_url(gated_url)

            off_allowlist_call = ToolUseBlock(
                type="tool_use",
                id="toolu_1",
                name="fetch_url",
                input={"url": f"https://{_OFF_ALLOWLIST_HOST}/page"},
            )
            refused_turn = _MockMessage([off_allowlist_call], stop_reason="tool_use")

            good_call = ToolUseBlock(
                type="tool_use", id="toolu_2", name="fetch_url", input={"url": gated_url}
            )
            fetch_turn = _MockMessage([good_call], stop_reason="tool_use")

            prior_citation = build_source_document_uri(_SD_ID)
            final = _MockMessage(
                [
                    TextBlock(
                        type="text",
                        text=_pass2_envelope_json(
                            citations=[prior_citation, gated_anchor],
                            reference_concepts=[
                                {
                                    "slug": "lms-public-docs",
                                    "title": "LMS public documentation",
                                    "description": "Publicly documented LMS capabilities.",
                                    "tags": ["docs"],
                                    "body": "SCORM/xAPI support, ISO 27001-hosted.",
                                    "citations": [gated_anchor],
                                }
                            ],
                        ),
                    )
                ],
                stop_reason="end_turn",
            )
            anthropic_client = _mock_client([refused_turn, fetch_turn, final])

            gated_corpus = web_pass.GatedCorpusConfig(
                sources=(
                    web_pass.GatedSource(host=_ALLOWED_HOST, max_depth=5, local_root=tmp_path),
                )
            )

            async def _exercise() -> "web_pass.WebPassResult":
                with patch(
                    "scripts.cocoindex_pipeline.producer.web_pass.anthropic.AsyncAnthropic",
                    return_value=anthropic_client,
                ):
                    return await web_pass.run_web_pass(
                        draft,
                        key,
                        source,
                        gated_corpus,
                        http_client=_FakeHttpClient({}),
                    )

            result = asyncio.run(_exercise())

            # ── egress-confinement: the refused call's tool_result carried
            # is_error=True; the model self-corrected onto the allowlisted
            # host. `messages` is ONE list mutated in place across the whole
            # loop (`run_tool_use_loop`'s documented contract), so every
            # `call_args_list[i].kwargs["messages"]` is the SAME object by
            # the time the loop finishes — index by POSITION (turn 2 = the
            # refused tool_result: [0]=seed, [1]=assistant tool_use,
            # [2]=user tool_result), not by `[-1]`. ─────────────────────
            full_messages = anthropic_client.messages.create.call_args_list[-1].kwargs[
                "messages"
            ]
            refused_tool_result = full_messages[2]["content"][0]
            assert refused_tool_result["is_error"] is True
            assert "host-allowlist" in refused_tool_result["content"]

            # ── BI-17 provenance: the enriched concept + the reference
            # concept both cite the anchor fetch_url actually minted. ─────
            assert gated_anchor in result.concept.body
            assert prior_citation in result.concept.body  # augmentation guard: nothing dropped

            assert len(result.reference_concepts) == 1
            reference = result.reference_concepts[0]
            assert reference.rel_path == "references/lms-public-docs.md"
            assert f"[1] [{gated_anchor}]({gated_anchor})" in reference.body

            return result

        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            _run(Path(tmp))

    def test_augmentation_guard_refuses_a_result_that_drops_a_prior_citation(self) -> None:
        """S451 rider fold-in 2 enforcement — a terminal envelope whose
        citations array OMITS a citation the concept's Pass-1 state already
        carried is refused via `validator.detect_citation_shrink`, never
        handed to the bundle-writer."""
        key = _product_key()
        source = _FakeSource(
            catalogue=[key, _gdpr_key()], raw_by_path={key.rel_path: _product_raw()}
        )
        draft = _product_draft(key)  # carries build_source_document_uri(_SD_ID)

        # The model's final answer cites ONLY a cross-link — dropping the
        # Pass-1 source_documents anchor entirely.
        final = _MockMessage(
            [
                TextBlock(
                    type="text",
                    text=_pass2_envelope_json(citations=["topics/gdpr.md"]),
                )
            ],
            stop_reason="end_turn",
        )
        anthropic_client = _mock_client([final])
        gated_corpus = web_pass.GatedCorpusConfig(sources=())

        async def _exercise() -> Any:
            with patch(
                "scripts.cocoindex_pipeline.producer.web_pass.anthropic.AsyncAnthropic",
                return_value=anthropic_client,
            ):
                return await web_pass.run_web_pass(
                    draft, key, source, gated_corpus, http_client=_FakeHttpClient({})
                )

        with pytest.raises(web_pass.Pass2EnrichError, match="DROP"):
            asyncio.run(_exercise())

    def test_a_fabricated_gated_anchor_the_model_invents_is_rejected(self) -> None:
        """BI-17 — a well-formed `canonical://reference_items/<uuid>` that
        `fetch_url` never actually minted this run (the model invented it
        rather than copying a real tool result) fails provenance, even
        though it satisfies the format check."""
        key = _product_key()
        source = _FakeSource(
            catalogue=[key, _gdpr_key()], raw_by_path={key.rel_path: _product_raw()}
        )
        draft = _product_draft(key)
        prior_citation = build_source_document_uri(_SD_ID)
        fabricated = reference_item_uri_from_source_url(
            f"https://{_ALLOWED_HOST}/never/actually/fetched"
        )

        final = _MockMessage(
            [
                TextBlock(
                    type="text",
                    text=_pass2_envelope_json(citations=[prior_citation, fabricated]),
                )
            ],
            stop_reason="end_turn",
        )
        anthropic_client = _mock_client([final])
        gated_corpus = web_pass.GatedCorpusConfig(sources=())

        async def _exercise() -> Any:
            with patch(
                "scripts.cocoindex_pipeline.producer.web_pass.anthropic.AsyncAnthropic",
                return_value=anthropic_client,
            ):
                return await web_pass.run_web_pass(
                    draft, key, source, gated_corpus, http_client=_FakeHttpClient({})
                )

        with pytest.raises(web_pass.Pass2EnrichError, match="never minted"):
            asyncio.run(_exercise())

    def test_pass2_tools_offered_are_exactly_the_four(self) -> None:
        """Dynamic proof of the Pass-2 tool set (TECH pseudocode:
        `[READ_CONCEPT_RAW_TOOL, SAMPLE_ROWS_TOOL, ...] # Pass-2 adds
        WEB_FETCH_TOOL`) — read/sample/list_concepts (reused from Pass-1)
        plus fetch_url, never more."""
        key = _product_key()
        source = _FakeSource(
            catalogue=[key, _gdpr_key()], raw_by_path={key.rel_path: _product_raw()}
        )
        draft = _product_draft(key)
        final = _MockMessage(
            [
                TextBlock(
                    type="text",
                    text=_pass2_envelope_json(citations=[build_source_document_uri(_SD_ID)]),
                )
            ],
            stop_reason="end_turn",
        )
        anthropic_client = _mock_client([final])
        gated_corpus = web_pass.GatedCorpusConfig(sources=())

        async def _exercise() -> Any:
            with patch(
                "scripts.cocoindex_pipeline.producer.web_pass.anthropic.AsyncAnthropic",
                return_value=anthropic_client,
            ):
                return await web_pass.run_web_pass(
                    draft, key, source, gated_corpus, http_client=_FakeHttpClient({})
                )

        asyncio.run(_exercise())

        for call in anthropic_client.messages.create.call_args_list:
            tool_names = {t["name"] for t in call.kwargs["tools"]}
            assert tool_names == {"read_concept_raw", "sample_rows", "list_concepts", "fetch_url"}
