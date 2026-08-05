"""Deterministic URL write-path proof for the `ingest_url` component (ID-75.10).

Faithful-mount harness precedent: ``TestSourceDocumentProvenanceWritePath``
(test_cocoindex_flow_write_path.py) — flow.py is imported fresh under the
shared conftest cocoindex stubs; targets are ``_FakeTarget`` doubles; only the
network/LLM seams are stubbed. No external DB, no env vars, no Rust engine.

ID-112.7 re-point: the HTML branch fetches raw HTML via ``_fetch_url_bytes``
and cleans it IN-PROCESS via the shared Trafilatura cleaner (``clean_html`` +
``apply_quality_gate``), retiring the prior fetch+extract sidecar hop on this
datapath (PI-1). These tests assert the cleaned TEXT (not Markdown) is the
canonical body. (The former ``extraction_method`` provenance assertions died
with the synthetic sd row — DR-124 unwind.)

WHAT THIS PROVES (TECH §3 WP-C + §4 BI-mapping; DR-124 unwind shape):

  - Landing a URL declares EXACTLY the ri row with the BI-3 field contract,
    ZERO source_documents writes (DR-124 unwind — the synthetic sd mint is
    retired), and ZERO ``ci_target`` interactions (BI-1 — structurally
    impossible: ``ingest_url`` has no sd/ci/qa/em/cc target in its
    signature).
  - The HTML body is the boilerplate-stripped clean text from ``clean_html``
    (PI-1 / ID-112.7).
  - A too-short extraction is a structured per-item failure
    (``cocoindex.url_extraction_rejected``) that lands ZERO partial rows
    (PI-5 / BI-19).
  - Landing twice declares the SAME deterministic uuid5 PKs — declare_row is
    a PK-keyed UPSERT, so the DB count stays 1 (BI-2 / PI-8).
  - A PDF URL routes to Docling over fetched bytes (BI-20 / D-12).
  - An SSRF-rejected URL lands ZERO rows and writes one
    ``ingestion_quality_log`` row + a structured log (BI-21 / D-9).
  - The D-7 backlink UPDATE hits ALL ledger rows for a 2-workspace URL
    (BI-10 / BI-8).

Async tests follow the repo convention (no pytest-asyncio plugin): drive
coroutines via ``asyncio.run`` inside sync test functions.

Reference: the ID-75 URL-cocoindex spec, TECH.md §3 WP-C + §4 (BI-1..BI-10,
BI-19..BI-21).
"""

from __future__ import annotations

import asyncio
import inspect
import json
import logging
import re
import sys
import uuid
from datetime import datetime
from pathlib import Path

import pytest

from conftest import fresh_flow_module

from scripts.cocoindex_pipeline.url_source import UrlItem

# ID-112.7 — the realistically-sized HTML fixture shared with the {112.5}
# cleaner unit test. `clean_html` strips its nav/cookie boilerplate down to the
# article body (~2.9k chars ⇒ an OK gate verdict).
_FIXTURE_HTML = (
    Path(__file__).resolve().parent
    / "fixtures"
    / "extraction"
    / "procurement_guide.html"
).read_bytes()


def _flow_module():
    """Load a fresh stubbed ``scripts.cocoindex_pipeline.flow`` (ID-55.1)."""
    return fresh_flow_module()


# ── Fakes ────────────────────────────────────────────────────────────────────


class _FakeTarget:
    """Records ``declare_row`` calls without touching any DB (write-path twin)."""

    def __init__(self, table_name: str) -> None:
        self.table_name = table_name
        self.rows: list[dict] = []

    def declare_row(self, *, row: dict) -> None:
        self.rows.append(row)


class _FakeConn:
    """asyncpg connection double recording execute/fetch calls."""

    def __init__(self, fetch_rows: list[dict] | None = None) -> None:
        self.executed: list[tuple[str, tuple]] = []
        self.fetched: list[tuple[str, tuple]] = []
        self.fetch_rows = fetch_rows or []

    async def execute(self, sql: str, *args: object) -> str:
        self.executed.append((sql, args))
        return "UPDATE 0"

    async def fetch(self, sql: str, *args: object) -> list[dict]:
        self.fetched.append((sql, args))
        return self.fetch_rows


class _FakeAcquire:
    def __init__(self, conn: _FakeConn) -> None:
        self._conn = conn

    async def __aenter__(self) -> _FakeConn:
        return self._conn

    async def __aexit__(self, *exc: object) -> None:
        return None


class _FakePool:
    """asyncpg pool double — ``acquire()`` yields the shared ``_FakeConn``."""

    def __init__(self, conn: _FakeConn | None = None) -> None:
        self.conn = conn or _FakeConn()

    def acquire(self) -> _FakeAcquire:
        return _FakeAcquire(self.conn)


class _FakeStageCounter:
    """Minimal stage-counter double recording ``increment`` calls."""

    def __init__(self) -> None:
        self.counts: dict[str, int] = {}

    def increment(self, stage: str) -> None:
        self.counts[stage] = self.counts.get(stage, 0) + 1


def _make_item(**overrides: object) -> UrlItem:
    """A 2-workspace passed URL collapsed to one item (BI-8 shape)."""
    fields: dict = {
        "url": "https://example.com/articles/insight",
        "title": "Insight article",
        "summary": "A short AI summary.",
        "published_at": "2026-01-02T03:04:05+00:00",
        "ingestion_source": "rss_feed",
        "content_epoch": "2026-06-01T00:00:00+00:00",
        "ledger_urls": (
            "https://example.com/articles/insight?utm_source=rss",
            "https://example.com/articles/insight",
        ),
        "workspace_ids": (
            "11111111-1111-4111-8111-111111111111",
            "22222222-2222-4222-8222-222222222222",
        ),
    }
    fields.update(overrides)
    return UrlItem(**fields)


def _wire(
    flow: object,
    monkeypatch: pytest.MonkeyPatch,
    *,
    html_bytes: bytes = _FIXTURE_HTML,
) -> dict:
    """Stub the network/LLM seams; return the recording handles.

    Mirrors ``TestSourceDocumentProvenanceWritePath._stub_extractors``: only
    the seams (raw-HTML fetch, classifier, embedder, PDF sniff, DB pool) are
    stubbed — the body under test is the REAL ``ingest_url`` (incl. the REAL
    in-process ``clean_html`` + ``apply_quality_gate`` from {112.5}).

    ID-112.7: the HTML route now fetches raw HTML via ``_fetch_url_bytes`` and
    cleans it in-process — there is no separate fetch+extract hop.
    """
    fetch_calls: list[str] = []

    async def _fake_fetch_url_bytes(url: str) -> bytes:
        fetch_calls.append(url)
        return html_bytes

    monkeypatch.setattr(flow, "_fetch_url_bytes", _fake_fetch_url_bytes)

    async def _fake_classification(content_text: str):
        return {
            "content_type": "news",  # DISCARDED on the URL route (D-10)
            "primary_domain": "procurement",
            "primary_subtopic": "tender_evaluation",
            "suggested_title": "Classifier title",
        }

    async def _fake_embed(content_text: str) -> list[float]:
        return [0.0] * 1024

    monkeypatch.setattr(flow, "extract_classification", _fake_classification)
    monkeypatch.setattr(flow, "embed_content_text", _fake_embed)

    # Non-.pdf URLs would otherwise HEAD-sniff over real HTTP (D-12).
    async def _fake_is_pdf(url: str) -> bool:
        return False

    monkeypatch.setattr(flow, "_url_is_pdf", _fake_is_pdf)

    pool = _FakePool()
    monkeypatch.setattr(flow.coco, "use_context", lambda key: pool)

    return {
        "fetch_calls": fetch_calls,
        "pool": pool,
    }


def _ingest(
    flow: object,
    item: UrlItem,
    *,
    op_id: uuid.UUID | None = None,
    stage_counter: object | None = None,
    re_target: object | None = None,
) -> _FakeTarget:
    """Drive ONE ``ingest_url`` invocation under bound flow meta.

    DR-124 unwind: ``ingest_url`` takes (item, ri_target, re_target) — the
    synthetic sd mint (and ``sd_target``) are retired. ``re_target`` (the
    polymorphic ``record_embeddings`` write target, ID-131 {131.11}) stays a
    DEFAULTED positional; when None the reference-item embedding dual-write
    is skipped (guard).
    """
    from scripts.cocoindex_pipeline.flow_context import (
        bind_flow_meta,
        bind_stage_counter,
    )

    ri = _FakeTarget("reference_items")

    async def _exercise() -> None:
        # id-400 (D-397-A Option C): the flow_* kwargs are retired from the
        # memoised component signature — the run context arrives via the
        # ContextVar fallbacks (bind_flow_meta / bind_stage_counter) for
        # in-task callers like this helper.
        async with bind_flow_meta(op_id=op_id or uuid.uuid4()):
            if stage_counter is not None:
                async with bind_stage_counter(stage_counter):  # type: ignore[arg-type]
                    await flow.ingest_url(  # type: ignore[attr-defined]
                        item, ri, re_target
                    )
            else:
                await flow.ingest_url(  # type: ignore[attr-defined]
                    item, ri, re_target
                )

    asyncio.run(_exercise())
    return ri


def _assert_no_sd_writes(pool: _FakePool) -> None:
    """DR-124 unwind pin: the URL path must issue ZERO source_documents
    INSERTs on the raw pool (the S437 `_upsert_source_document` call is
    retired along with the synthetic `sd:{url}` mint)."""
    sd_inserts = [
        sql
        for sql, _args in pool.conn.executed
        if "INSERT INTO public.source_documents" in sql
    ]
    assert sd_inserts == [], (
        "the URL path must not write source_documents (DR-124 unwind)"
    )


# ── Landing: the ri evidence row (BI-1/BI-3; DR-124 shape) ──────────────────


class TestUrlLandingDeclaresEvidencePair:
    def test_landing_declares_exactly_the_ri_row_with_field_contract(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        flow = _flow_module()
        handles = _wire(flow, monkeypatch)
        item = _make_item()
        run_op_id = uuid.uuid4()
        counter = _FakeStageCounter()

        # The expected body is the REAL in-process clean of the fixture — the
        # cleaner is under test, so derive the expectation from it (not a
        # hand-copied string) to keep this behaviour-first.
        expected_body = flow.clean_html(
            _FIXTURE_HTML.decode("utf-8"), url=item.url
        )

        ri = _ingest(flow, item, op_id=run_op_id, stage_counter=counter)

        # DR-124 unwind: EXACTLY one ri row; ZERO source_documents writes —
        # the synthetic `sd:{url}` mint + its raw-pool UPSERT are retired.
        assert len(ri.rows) == 1, "expected one reference_items row"
        _assert_no_sd_writes(handles["pool"])

        # Hard-coded uuid5 oracle over _KH_PIPELINE_DOC_NS
        # ("fbfaf1ff-1ee4-583c-9757-1674465b2ec1") for the pinned item.url
        # "https://example.com/articles/insight" — a frozen literal (not
        # re-derived from flow) so a namespace/seed drift fails loudly.

        # BI-3: the reference_items contract (DR-124 shape).
        ri_row = ri.rows[0]
        assert ri_row["id"] == uuid.UUID(
            "d315a098-4fbc-554b-982f-396b2ecec8fe"  # ri:{url}
        )
        assert ri_row["title"] == "Insight article"
        # PI-1: the body is the boilerplate-stripped clean TEXT from clean_html.
        assert ri_row["body"] == expected_body, (
            "the cleaned Trafilatura text is the canonical body (PI-1)"
        )
        assert "Accept all cookies" not in ri_row["body"], (
            "nav/cookie boilerplate must be stripped from the body"
        )
        assert "Procurement Act 2023" in ri_row["body"], (
            "the article substance must survive the clean"
        )
        assert ri_row["summary"] == "A short AI summary."
        assert ri_row["source_url"] == item.url
        assert ri_row["published_at"] == datetime.fromisoformat(
            "2026-01-02T03:04:05+00:00"
        ), "published_at round-trips the ledger's original value (BI-3)"
        assert ri_row["layer"] == "research"
        assert ri_row["ingestion_source"] == "rss_feed"
        assert ri_row["op_id"] == run_op_id

        # DR-130/DR-124: the dropped columns are never declared.
        assert "primary_domain" not in ri_row, (
            "reference_items.primary_domain is dropped (DR-130)"
        )
        assert "primary_subtopic" not in ri_row
        assert "source_document_id" not in ri_row, (
            "reference_items.source_document_id is dropped — references are "
            "standalone (DR-124 unwind)"
        )

        # ID-127.24 (DR-036): reference_items.embedding was DROPPED from the
        # live schema (20260706120000_id131_drop_inline_vector_cols.sql) —
        # record_embeddings is the sole source of truth for this vector now
        # (see test_reference_item_embedding_is_dual_written_to_record_embeddings).
        assert "embedding" not in ri_row, (
            "reference_items.embedding was dropped (DR-036) — the pipeline "
            "must not declare it any more"
        )

        # D-10: content_type is DISCARDED — references carry no content_type.
        assert "content_type" not in ri_row, (
            "references carry no content_type (D-10 — closed enum preserved)"
        )
        # BI-7: workspace_ids are NEVER written to the reference row.
        assert "workspace_ids" not in ri_row
        assert "workspace_id" not in ri_row
        # PG-default convention: created_at / updated_at omitted.
        assert "created_at" not in ri_row
        assert "updated_at" not in ri_row

        # ID-112.7: the HTML route fetches raw bytes and cleans them in-process.
        assert handles["fetch_calls"] == [item.url]

        # Inv-17 stage counters — ONE postgres upsert now (the ri row; the
        # sd upsert left with the DR-124 unwind).
        assert counter.counts == {
            "source_walk": 1,
            "binary_conversion": 1,
            "llm_extraction": 1,
            "embedding": 1,
            "postgres_upsert": 1,
        }

    def test_reference_item_embedding_is_dual_written_to_record_embeddings(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """ID-131 {131.11}: the reference_items embedding is ALSO declared on
        the polymorphic `record_embeddings` store (owner_kind='reference_item'),
        keyed on the reference item's OWN uuid5 PK so a re-land UPSERTs."""
        from scripts.cocoindex_pipeline.flow_context import bind_flow_meta

        flow = _flow_module()
        _wire(flow, monkeypatch)
        item = _make_item()
        run_op_id = uuid.uuid4()

        ri = _FakeTarget("reference_items")
        re = _FakeTarget("record_embeddings")

        async def _exercise() -> None:
            async with bind_flow_meta(op_id=run_op_id):
                await flow.ingest_url(item, ri, re)

        asyncio.run(_exercise())

        # Exactly one reference_items row → exactly one record_embeddings row.
        assert len(ri.rows) == 1
        assert len(re.rows) == 1
        ri_row = ri.rows[0]
        re_row = re.rows[0]
        assert re_row["owner_kind"] == "reference_item"
        # owner_id is the reference item's OWN PK (the ri:{url} uuid5) — the
        # same id the inline reference_items row carries (re-land idempotency).
        assert re_row["owner_id"] == ri_row["id"]
        assert re_row["model"] == flow.EMBEDDING_MODEL
        # ID-127.24 (DR-036): reference_items.embedding is DROPPED — ri_row no
        # longer carries an "embedding" key to compare against.
        # record_embeddings is the SOLE source of truth for this vector.
        assert len(re_row["embedding"]) == 1024
        # No synthetic id / no per-run op_id in the record_embeddings payload.
        assert set(re_row) == {"owner_kind", "owner_id", "model", "embedding"}

    def test_no_re_target_skips_reference_item_record_embeddings(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """re_target defaults to None — the ri row still lands, no re row."""
        flow = _flow_module()
        _wire(flow, monkeypatch)
        # _ingest omits re_target (defaults None) → guard skips the re write.
        ri = _ingest(flow, _make_item())
        assert len(ri.rows) == 1

    def test_ingest_url_signature_has_no_content_targets(self) -> None:
        """BI-1 structural impossibility: no ci/qa/em/cc target params.

        ID-131 {131.11}: `re_target` is a permitted (non-content) write target —
        it is the polymorphic record_embeddings store, not a typed content grain.
        """
        flow = _flow_module()
        for fn in (flow.ingest_url, flow._ingest_url_body):
            params = set(inspect.signature(fn).parameters)
            assert "ci_target" not in params
            assert "qa_target" not in params
            assert "em_target" not in params
            assert "cc_target" not in params
            # DR-124 unwind: sd_target is retired from the URL lane too —
            # a source_documents write is now structurally impossible here.
            assert "sd_target" not in params
            assert {"ri_target", "re_target"} <= params

    def test_title_falls_back_to_classifier_suggested_title_when_empty(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        flow = _flow_module()
        _wire(flow, monkeypatch)
        ri = _ingest(flow, _make_item(title=""))
        assert ri.rows[0]["title"] == "Classifier title", (
            "empty ledger title must fall back to the classifier's "
            "suggested_title (D-10)"
        )

    def test_filename_falls_back_to_hostname_for_root_urls(self) -> None:
        # DR-124 unwind: no sd row carries this any more — `_url_filename`
        # survives as the Docling filename hint; pin its fallback directly.
        flow = _flow_module()
        assert flow._url_filename("https://example.com/") == "example.com", (
            "no path segment ⇒ filename hint falls back to the hostname"
        )

    def test_malformed_published_at_fails_the_item_loudly(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """BI-19 loud containment: a malformed ledger `published_at` raises
        out of the component (no try/except swallows the
        `datetime.fromisoformat` ValueError) — the per-item mount boundary
        contains it; one bad item never silently lands a corrupt timestamp."""
        flow = _flow_module()
        _wire(flow, monkeypatch)

        with pytest.raises(ValueError):
            _ingest(flow, _make_item(published_at="not-a-date"))


# ── Idempotency + update-in-place (BI-2 / D-4 / PI-8) ────────────────────────


class TestUrlIdempotencyAndUpdate:
    def test_landing_twice_declares_same_pks(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Same item landed twice ⇒ identical uuid5 PKs — declare_row UPSERTs,
        so the DB row count stays 1 (BI-2 / PI-8). The PKs are URL-seeded and
        UNCHANGED by the ID-112.7 datapath re-point."""
        flow = _flow_module()
        handles = _wire(flow, monkeypatch)
        item = _make_item()

        ri1 = _ingest(flow, item)
        ri2 = _ingest(flow, item)

        assert ri1.rows[0]["id"] == ri2.rows[0]["id"]
        # PI-8: the uuid5 seed is URL-derived, unaffected by the cutover.
        # Pinned to a frozen literal over _KH_PIPELINE_DOC_NS for the item.url
        # "https://example.com/articles/insight" (not re-derived from flow).
        assert ri1.rows[0]["id"] == uuid.UUID("d315a098-4fbc-554b-982f-396b2ecec8fe")
        # DR-124 unwind: neither landing wrote source_documents.
        _assert_no_sd_writes(handles["pool"])

    def test_changed_page_content_updates_body_under_same_pk(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A re-fetch that returns CHANGED HTML re-cleans the body and
        recomputes the hash UNDER THE SAME PK (BI-2 / D-4 update-in-place).
        The body now tracks the fetched HTML content (ID-112.7), keyed by the
        item-level (url, epoch) memo."""
        flow = _flow_module()

        pages = {
            "v1": b"<html><body><main><article><h1>Alpha guide</h1>"
            + b"<p>" + b"First version body content. " * 40 + b"</p>"
            + b"</article></main></body></html>",
            "v2": b"<html><body><main><article><h1>Beta guide</h1>"
            + b"<p>" + b"Second version, fully re-fetched body. " * 40 + b"</p>"
            + b"</article></main></body></html>",
        }
        which = {"page": "v1"}

        async def _fetch_changing(url: str) -> bytes:
            return pages[which["page"]]

        handles = _wire(flow, monkeypatch)  # base seams (classifier/embedder/pool/sniff)
        monkeypatch.setattr(flow, "_fetch_url_bytes", _fetch_changing)

        item = _make_item()
        which["page"] = "v1"
        ri1 = _ingest(flow, item)
        which["page"] = "v2"
        ri2 = _ingest(flow, item)

        # Same PK — the UPSERT updates in place (D-4 / PI-8)…
        assert ri1.rows[0]["id"] == ri2.rows[0]["id"]
        # …with the re-cleaned body riding the new declare. (The content_hash
        # assertion left with the sd row — DR-124 unwind: the hash fed only
        # the retired synthetic sd row and is no longer persisted.)
        assert "First version body content." in ri1.rows[0]["body"]
        assert "Second version" in ri2.rows[0]["body"]
        assert ri1.rows[0]["body"] != ri2.rows[0]["body"]


# ── PDF route (BI-20 / D-12) ─────────────────────────────────────────────────


class TestUrlPdfRoute:
    def test_pdf_url_routes_to_docling(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        flow = _flow_module()

        real_sniff = flow._url_is_pdf  # the REAL D-12 sniff — suffix-first
        handles = _wire(flow, monkeypatch)
        # Restore the real sniff: the .pdf suffix short-circuits BEFORE any
        # HTTP, so no network is touched (that is the behaviour under test).
        monkeypatch.setattr(flow, "_url_is_pdf", real_sniff)

        pdf_bytes = b"%PDF-1.4 stub bytes"

        async def _fake_fetch_bytes(url: str) -> bytes:
            return pdf_bytes

        monkeypatch.setattr(flow, "_fetch_url_bytes", _fake_fetch_bytes)

        docling_calls: list[tuple[bytes, str]] = []

        async def _fake_docling(content_bytes: bytes, filename: str) -> str:
            docling_calls.append((content_bytes, filename))
            return "# PDF markdown"

        monkeypatch.setattr(flow, "_docling_to_markdown", _fake_docling)

        item = _make_item(url="https://example.com/reports/annual.pdf")
        ri = _ingest(flow, item)

        # The .pdf suffix short-circuits the sniff straight to Docling (BI-20).
        assert docling_calls == [(pdf_bytes, "annual.pdf")]

        # DR-124 unwind: the Docling markdown lands as the ri body; the
        # mime/size/hash provenance died with the retired synthetic sd row.
        assert ri.rows[0]["body"] == "# PDF markdown"
        _assert_no_sd_writes(handles["pool"])

    def test_head_sniff_detects_pdf_content_type_and_failure_assumes_html(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """D-12: extensionless URL ⇒ httpx HEAD content-type sniff; a HEAD
        failure assumes HTML and lets the in-process extractor try."""
        flow = _flow_module()

        class _FakeResponse:
            def __init__(self, content_type: str) -> None:
                self.headers = {"Content-Type": content_type}

        class _FakeClient:
            def __init__(self, *, response=None, error=None) -> None:
                self._response = response
                self._error = error

            async def __aenter__(self):
                return self

            async def __aexit__(self, *exc: object) -> None:
                return None

            async def head(self, url: str):
                if self._error is not None:
                    raise self._error
                return self._response

        import httpx

        def _client_factory(response=None, error=None):
            def _make(*args: object, **kwargs: object) -> _FakeClient:
                return _FakeClient(response=response, error=error)

            return _make

        url = "https://example.com/download?id=42"

        # application/pdf (with charset noise) ⇒ PDF route.
        monkeypatch.setattr(
            flow.httpx,
            "AsyncClient",
            _client_factory(response=_FakeResponse("application/pdf; charset=binary")),
        )
        assert asyncio.run(flow._url_is_pdf(url)) is True

        # text/html ⇒ not PDF.
        monkeypatch.setattr(
            flow.httpx,
            "AsyncClient",
            _client_factory(response=_FakeResponse("text/html; charset=utf-8")),
        )
        assert asyncio.run(flow._url_is_pdf(url)) is False

        # HEAD failure ⇒ assume HTML, let the in-process extractor try (D-12).
        monkeypatch.setattr(
            flow.httpx, "AsyncClient", _client_factory(error=httpx.ConnectError("boom"))
        )
        assert asyncio.run(flow._url_is_pdf(url)) is False


# ── SSRF gate (BI-21 / D-9) ──────────────────────────────────────────────────


class TestUrlSsrfRejection:
    def test_ssrf_item_lands_zero_rows_and_writes_quality_log_row(
        self,
        monkeypatch: pytest.MonkeyPatch,
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        flow = _flow_module()
        from unittest.mock import AsyncMock

        fetch = AsyncMock(name="_fetch_url_bytes")
        monkeypatch.setattr(flow, "_fetch_url_bytes", fetch)

        ledger_ids = [
            {"id": "33333333-3333-4333-8333-333333333333"},
            {"id": "44444444-4444-4444-8444-444444444444"},
        ]
        pool = _FakePool(_FakeConn(fetch_rows=ledger_ids))
        monkeypatch.setattr(flow.coco, "use_context", lambda key: pool)

        item = _make_item(
            url="http://localhost/admin",
            ledger_urls=("http://localhost/admin",),
        )
        run_op_id = uuid.uuid4()

        with caplog.at_level(logging.ERROR, logger=flow.__name__):
            ri = _ingest(flow, item, op_id=run_op_id)

        # ZERO rows — the rejected item declares nothing (BI-21/BI-19).
        assert ri.rows == []
        assert fetch.await_count == 0, "rejected URL must never be fetched"

        # ONE ingestion_quality_log row via the raw pool (D-9).
        inserts = [
            (sql, args)
            for sql, args in pool.conn.executed
            if "ingestion_quality_log" in sql
        ]
        assert len(inserts) == 1, "expected one quality-log INSERT"
        sql, args = inserts[0]
        assert "flag_type" in sql and "severity" in sql and "details" in sql
        assert "ssrf_rejected" in args
        assert "error" in args
        details = next(
            json.loads(a)
            for a in args
            if isinstance(a, str) and a.startswith("{")
        )
        assert details["source_url"] == "http://localhost/admin"
        assert "localhost" in details["reason"]
        assert details["op_id"] == str(run_op_id)
        assert details["feed_article_ids"] == [
            "33333333-3333-4333-8333-333333333333",
            "44444444-4444-4444-8444-444444444444",
        ]

        # Structured log event (BI-21).
        events = [
            json.loads(r.message)
            for r in caplog.records
            if r.message.startswith("{")
        ]
        ssrf_events = [
            e for e in events if e.get("event") == "cocoindex.url_ssrf_rejected"
        ]
        assert len(ssrf_events) == 1
        assert ssrf_events[0]["source_url"] == "http://localhost/admin"
        assert ssrf_events[0]["op_id"] == str(run_op_id)


# ── Backlink (BI-10 / BI-8 / D-7) ────────────────────────────────────────────


class TestUrlBacklink:
    def test_backlink_update_hits_all_ledger_rows_for_two_workspace_url(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        flow = _flow_module()
        handles = _wire(flow, monkeypatch)
        item = _make_item()  # 2 workspaces, 2 raw ledger URLs

        ri = _ingest(flow, item)

        pool: _FakePool = handles["pool"]
        updates = [
            (sql, args)
            for sql, args in pool.conn.executed
            if "feed_articles" in sql and "reference_item_id" in sql
        ]
        assert len(updates) == 1, "expected one backlink UPDATE"
        sql, args = updates[0]
        # D-7 predicate shape: raw stored values, passed rows only.
        assert "external_url = ANY($2" in sql
        assert "passed" in sql
        assert args[0] == ri.rows[0]["id"]
        assert sorted(args[1]) == sorted(item.ledger_urls), (
            "the UPDATE must target ALL raw ledger URLs (BI-10/BI-8)"
        )


# ── Quality gate on the HTML route (PI-5 / BI-19 — ID-112.7) ─────────────────


class TestHtmlQualityGate:
    """The in-process content-length gate ({112.5} `apply_quality_gate`) on the
    re-pointed HTML datapath: a REJECT lands ZERO rows with a structured
    per-item failure (BI-19 parity with the SSRF gate); a WARN proceeds."""

    # A page whose extractable body cleans to < 100 chars ⇒ REJECT.
    _SHORT_HTML = (
        b"<html><head><title>Stub</title></head><body>"
        b"<main><article><p>Too short.</p></article></main>"
        b"</body></html>"
    )

    def test_too_short_extraction_is_structured_failure_with_zero_rows(
        self,
        monkeypatch: pytest.MonkeyPatch,
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        flow = _flow_module()
        handles = _wire(flow, monkeypatch, html_bytes=self._SHORT_HTML)
        item = _make_item()
        run_op_id = uuid.uuid4()

        # Sanity: the fixture really does trip the REJECT threshold via the
        # REAL cleaner — this is a behaviour gate, not a mocked verdict.
        cleaned = flow.clean_html(self._SHORT_HTML.decode("utf-8"), url=item.url)
        assert flow.apply_quality_gate(cleaned).verdict is flow.GateVerdict.REJECT

        with caplog.at_level(logging.ERROR, logger=flow.__name__):
            ri = _ingest(flow, item, op_id=run_op_id)

        # BI-19: ZERO partial rows — the rejected item declares nothing, so the
        # next walk re-runs it (memo miss on a failure-aborted run).
        assert ri.rows == [], "a REJECT verdict must land no reference_items row"
        _assert_no_sd_writes(handles["pool"])
        # The HTML WAS fetched (the gate runs post-fetch).
        assert handles["fetch_calls"] == [item.url]

        # Structured per-item failure — same shape as the SSRF rejection log.
        events = [
            json.loads(r.message)
            for r in caplog.records
            if r.message.startswith("{")
        ]
        reject_events = [
            e
            for e in events
            if e.get("event") == "cocoindex.url_extraction_rejected"
        ]
        assert len(reject_events) == 1, (
            "expected one structured url_extraction_rejected event"
        )
        assert reject_events[0]["source_url"] == item.url
        assert reject_events[0]["op_id"] == str(run_op_id)

    def test_limited_content_warns_but_still_lands_the_row(
        self,
        monkeypatch: pytest.MonkeyPatch,
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        # A body that cleans to 100 <= len < 500 ⇒ WARN (lands, with a log).
        warn_html = (
            b"<html><body><main><article><p>"
            + b"Limited but present procurement guidance. " * 4
            + b"</p></article></main></body></html>"
        )
        flow = _flow_module()
        handles = _wire(flow, monkeypatch, html_bytes=warn_html)
        item = _make_item()

        cleaned = flow.clean_html(warn_html.decode("utf-8"), url=item.url)
        assert flow.apply_quality_gate(cleaned).verdict is flow.GateVerdict.WARN, (
            "fixture must trip the WARN band for this test to be meaningful"
        )

        with caplog.at_level(logging.WARNING, logger=flow.__name__):
            ri = _ingest(flow, item)

        # WARN proceeds: the ri row still lands (the trafilatura provenance
        # column died with the retired synthetic sd row — DR-124 unwind).
        assert len(ri.rows) == 1
        _assert_no_sd_writes(handles["pool"])
        assert handles["fetch_calls"] == [item.url]

        events = [
            json.loads(r.message)
            for r in caplog.records
            if r.message.startswith("{")
        ]
        warn_events = [
            e
            for e in events
            if e.get("event") == "cocoindex.url_extraction_warning"
        ]
        assert len(warn_events) == 1
        assert warn_events[0]["source_url"] == item.url
