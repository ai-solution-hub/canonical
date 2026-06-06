"""Deterministic URL write-path proof for the `ingest_url` component (ID-75.10).

Faithful-mount harness precedent: ``TestSourceDocumentProvenanceWritePath``
(test_cocoindex_flow_write_path.py) — flow.py is imported fresh under the
shared conftest cocoindex stubs; targets are ``_FakeTarget`` doubles; only the
network/LLM seams are stubbed. No external DB, no env vars, no Rust engine.

WHAT THIS PROVES (TECH §3 WP-C steps 1-8 + §4 BI-mapping):

  - Landing a URL declares EXACTLY the sd+ri pair with the BI-3/BI-4 field
    contract and ZERO ``ci_target`` interactions (BI-1 — structurally
    impossible: ``ingest_url`` has no ci/qa/em/cc target in its signature).
  - Landing twice declares the SAME deterministic uuid5 PKs — declare_row is
    a PK-keyed UPSERT, so the DB count stays 1 (BI-2).
  - A changed ``content_epoch`` re-fetches and updates the body UNDER THE
    SAME PK (BI-2 / D-4 update-in-place).
  - A PDF URL routes to Docling over fetched bytes — PullMD is never called
    (BI-20 / D-12).
  - An SSRF-rejected URL lands ZERO rows and writes one
    ``ingestion_quality_log`` row + a structured log (BI-21 / D-9).
  - The D-7 backlink UPDATE hits ALL ledger rows for a 2-workspace URL
    (BI-10 / BI-8).
  - An unknown PullMD X-Source degrades ``extraction_method`` to None with a
    structured warning — never an unmapped ``pullmd_<unknown>`` insert
    (CHECK-enum safety; re-implements the {75.9}-retired guard).
  - Module-source guard: flow.py NEVER seeds a ``"ci:"`` uuid5 from a URL
    (BI-1/BI-2 acceptance — the only ``"ci:"`` seeds are rel_path-derived).

Async tests follow the repo convention (no pytest-asyncio plugin): drive
coroutines via ``asyncio.run`` inside sync test functions.

Reference: docs/specs/ID-75-pullmd-cocoindex/TECH.md §3 WP-C + §4 (BI-1..BI-10,
BI-19..BI-21).
"""

from __future__ import annotations

import asyncio
import hashlib
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
    markdown: str = "# Fetched body\n\nMarkdown from PullMD.",
    x_source: str | None = "readability",
    share_id: str | None = "abcd1234",
) -> dict:
    """Stub the network/LLM seams; return the recording handles.

    Mirrors ``TestSourceDocumentProvenanceWritePath._stub_extractors``: only
    the seams (PullMD HTTP, Docling, classifier, embedder, PDF sniff, DB pool)
    are stubbed — the body under test is the REAL ``ingest_url``.
    """
    adapters = sys.modules[flow.extract_source_provenance.__module__]
    pullmd_calls: list[tuple[str, str]] = []

    async def _fake_pullmd_fetch(url: str, content_epoch: str):
        pullmd_calls.append((url, content_epoch))
        return adapters.PullmdResult(
            markdown=markdown,
            x_source=x_source,
            x_quality=0.9,
            share_id=share_id,
        )

    monkeypatch.setattr(flow, "_pullmd_fetch", _fake_pullmd_fetch)

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

    return {"pullmd_calls": pullmd_calls, "pool": pool}


def _ingest(
    flow: object,
    item: UrlItem,
    *,
    op_id: uuid.UUID | None = None,
    stage_counter: object | None = None,
) -> tuple[_FakeTarget, _FakeTarget]:
    """Drive ONE ``ingest_url`` invocation under bound flow meta."""
    from scripts.cocoindex_pipeline.flow_context import bind_flow_meta

    ri = _FakeTarget("reference_items")
    sd = _FakeTarget("source_documents")

    async def _exercise() -> None:
        async with bind_flow_meta(op_id=op_id or uuid.uuid4()):
            await flow.ingest_url(  # type: ignore[attr-defined]
                item, ri, sd, flow_stage_counter=stage_counter
            )

    asyncio.run(_exercise())
    return ri, sd


# ── Landing: the sd+ri evidence pair (BI-1/BI-3/BI-4) ───────────────────────


class TestUrlLandingDeclaresEvidencePair:
    def test_landing_declares_exactly_sd_and_ri_with_field_contract(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        flow = _flow_module()
        markdown = "# Fetched body\n\nMarkdown from PullMD."
        handles = _wire(flow, monkeypatch, markdown=markdown)
        item = _make_item()
        run_op_id = uuid.uuid4()
        counter = _FakeStageCounter()

        ri, sd = _ingest(flow, item, op_id=run_op_id, stage_counter=counter)

        # Exactly ONE row on each target — the evidence pair.
        assert len(sd.rows) == 1, "expected one source_documents row"
        assert len(ri.rows) == 1, "expected one reference_items row"

        encoded = markdown.encode()
        ns = flow._KH_PIPELINE_DOC_NS

        # BI-4: source_documents carries the URL identity + provenance.
        sd_row = sd.rows[0]
        assert sd_row["id"] == uuid.uuid5(ns, f"sd:{item.url}")
        assert sd_row["storage_path"] == item.url
        assert sd_row["source_url"] == item.url, (
            "storage_path = source_url = normalised URL (RESEARCH constraint 2)"
        )
        assert sd_row["filename"] == "insight", (
            "filename must be the last URL path segment (BI-4)"
        )
        assert sd_row["mime_type"] == "text/html"
        assert sd_row["file_size"] == len(encoded)
        assert sd_row["content_hash"] == hashlib.sha256(encoded).hexdigest()
        assert sd_row["extraction_method"] == "pullmd_readability"
        assert sd_row["pullmd_share_id"] == "abcd1234"
        assert sd_row["op_id"] == run_op_id

        # BI-3: the full reference_items contract.
        ri_row = ri.rows[0]
        assert ri_row["id"] == uuid.uuid5(ns, f"ri:{item.url}")
        assert ri_row["title"] == "Insight article"
        assert ri_row["body"] == markdown, "PullMD markdown is the canonical body"
        assert ri_row["summary"] == "A short AI summary."
        assert ri_row["source_url"] == item.url
        assert ri_row["published_at"] == datetime.fromisoformat(
            "2026-01-02T03:04:05+00:00"
        ), "published_at round-trips the ledger's original value (BI-3)"
        assert ri_row["primary_domain"] == "procurement"
        assert ri_row["primary_subtopic"] == "tender_evaluation"
        assert ri_row["layer"] == "research"
        assert len(ri_row["embedding"]) == 1024
        assert ri_row["source_document_id"] == sd_row["id"]
        assert ri_row["ingestion_source"] == "rss_feed"
        assert ri_row["op_id"] == run_op_id

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

        # D-4: the fetch is epoch-keyed.
        assert handles["pullmd_calls"] == [(item.url, item.content_epoch)]

        # Inv-17 stage counters (WP-C step 8).
        assert counter.counts == {
            "source_walk": 1,
            "binary_conversion": 1,
            "llm_extraction": 1,
            "embedding": 1,
            "postgres_upsert": 2,
        }

    def test_ingest_url_signature_has_no_content_targets(self) -> None:
        """BI-1 structural impossibility: no ci/qa/em/cc target params."""
        flow = _flow_module()
        for fn in (flow.ingest_url, flow._ingest_url_body):
            params = set(inspect.signature(fn).parameters)
            assert "ci_target" not in params
            assert "qa_target" not in params
            assert "em_target" not in params
            assert "cc_target" not in params
            assert {"ri_target", "sd_target"} <= params

    def test_title_falls_back_to_classifier_suggested_title_when_empty(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        flow = _flow_module()
        _wire(flow, monkeypatch)
        ri, _sd = _ingest(flow, _make_item(title=""))
        assert ri.rows[0]["title"] == "Classifier title", (
            "empty ledger title must fall back to the classifier's "
            "suggested_title (D-10)"
        )

    def test_filename_falls_back_to_hostname_for_root_urls(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        flow = _flow_module()
        _wire(flow, monkeypatch)
        _ri, sd = _ingest(flow, _make_item(url="https://example.com/"))
        assert sd.rows[0]["filename"] == "example.com", (
            "no path segment ⇒ filename falls back to the hostname (BI-4)"
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


# ── Idempotency + epoch-keyed update-in-place (BI-2 / D-4) ───────────────────


class TestUrlIdempotencyAndEpoch:
    def test_landing_twice_declares_same_pks(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Same item landed twice ⇒ identical PKs — declare_row UPSERTs, so
        the DB row count stays 1 (BI-2)."""
        flow = _flow_module()
        _wire(flow, monkeypatch)
        item = _make_item()

        ri1, sd1 = _ingest(flow, item)
        ri2, sd2 = _ingest(flow, item)

        assert sd1.rows[0]["id"] == sd2.rows[0]["id"]
        assert ri1.rows[0]["id"] == ri2.rows[0]["id"]

    def test_changed_epoch_updates_body_under_same_pk(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        flow = _flow_module()
        adapters = sys.modules[flow.extract_source_provenance.__module__]

        bodies = {"e1": "# Body v1", "e2": "# Body v2 (re-fetched)"}

        async def _epoch_pullmd(url: str, content_epoch: str):
            return adapters.PullmdResult(
                markdown=bodies[content_epoch],
                x_source="readability",
                x_quality=0.9,
                share_id="abcd1234",
            )

        _wire(flow, monkeypatch)  # base seams (classifier/embedder/pool/sniff)
        monkeypatch.setattr(flow, "_pullmd_fetch", _epoch_pullmd)

        ri1, sd1 = _ingest(flow, _make_item(content_epoch="e1"))
        ri2, sd2 = _ingest(flow, _make_item(content_epoch="e2"))

        # Same PKs — the UPSERT updates in place (D-4)…
        assert ri1.rows[0]["id"] == ri2.rows[0]["id"]
        assert sd1.rows[0]["id"] == sd2.rows[0]["id"]
        # …with the re-fetched body + recomputed hash riding the new declare.
        assert ri1.rows[0]["body"] == "# Body v1"
        assert ri2.rows[0]["body"] == "# Body v2 (re-fetched)"
        assert sd2.rows[0]["content_hash"] == hashlib.sha256(
            b"# Body v2 (re-fetched)"
        ).hexdigest()


# ── PDF route (BI-20 / D-12) ─────────────────────────────────────────────────


class TestUrlPdfRoute:
    def test_pdf_url_routes_to_docling_and_never_calls_pullmd(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        flow = _flow_module()
        from unittest.mock import AsyncMock

        real_sniff = flow._url_is_pdf  # the REAL D-12 sniff — suffix-first
        _wire(flow, monkeypatch)
        # Restore the real sniff: the .pdf suffix short-circuits BEFORE any
        # HTTP, so no network is touched (that is the behaviour under test).
        monkeypatch.setattr(flow, "_url_is_pdf", real_sniff)

        pullmd = AsyncMock(name="_pullmd_fetch")
        monkeypatch.setattr(flow, "_pullmd_fetch", pullmd)

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
        ri, sd = _ingest(flow, item)

        # The .pdf suffix short-circuits the sniff — no PullMD call (BI-20).
        assert pullmd.await_count == 0, "PDF must never route to PullMD"
        assert docling_calls == [(pdf_bytes, "annual.pdf")]

        sd_row = sd.rows[0]
        assert sd_row["extraction_method"] == "docling"
        assert sd_row["pullmd_share_id"] is None
        assert sd_row["mime_type"] == "application/pdf"
        assert sd_row["file_size"] == len(pdf_bytes)
        assert sd_row["content_hash"] == hashlib.sha256(pdf_bytes).hexdigest()
        assert ri.rows[0]["body"] == "# PDF markdown"

    def test_head_sniff_detects_pdf_content_type_and_failure_assumes_html(
        self,
    ) -> None:
        """D-12: extensionless URL ⇒ httpx HEAD content-type sniff; a HEAD
        failure assumes HTML and lets PullMD try."""
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
        flow.httpx.AsyncClient = _client_factory(
            response=_FakeResponse("application/pdf; charset=binary")
        )
        assert asyncio.run(flow._url_is_pdf(url)) is True

        # text/html ⇒ not PDF.
        flow.httpx.AsyncClient = _client_factory(
            response=_FakeResponse("text/html; charset=utf-8")
        )
        assert asyncio.run(flow._url_is_pdf(url)) is False

        # HEAD failure ⇒ assume HTML, let PullMD try (D-12).
        flow.httpx.AsyncClient = _client_factory(
            error=httpx.ConnectError("boom")
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

        pullmd = AsyncMock(name="_pullmd_fetch")
        monkeypatch.setattr(flow, "_pullmd_fetch", pullmd)

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
            ri, sd = _ingest(flow, item, op_id=run_op_id)

        # ZERO rows — the rejected item declares nothing (BI-21/BI-19).
        assert ri.rows == []
        assert sd.rows == []
        assert pullmd.await_count == 0, "rejected URL must never be fetched"

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

        ri, _sd = _ingest(flow, item)

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


# ── Unknown X-Source degrade guard ({75.9} re-implementation) ────────────────


class TestUnknownXSourceDegrade:
    def test_unknown_x_source_degrades_to_none_with_structured_warning(
        self,
        monkeypatch: pytest.MonkeyPatch,
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        flow = _flow_module()
        _wire(flow, monkeypatch, x_source="mystery_engine")

        with caplog.at_level(logging.WARNING, logger=flow.__name__):
            _ri, sd = _ingest(flow, _make_item())

        assert sd.rows[0]["extraction_method"] is None, (
            "an unknown X-Source must degrade extraction_method to None — "
            "pullmd_<unknown> would violate the CHECK enum on insert"
        )
        events = [
            json.loads(r.message)
            for r in caplog.records
            if r.message.startswith("{")
        ]
        warn_events = [
            e
            for e in events
            if e.get("event") == "cocoindex.pullmd_unknown_x_source"
        ]
        assert len(warn_events) == 1
        assert warn_events[0]["x_source"] == "mystery_engine"

    def test_known_x_sources_map_to_pullmd_methods(self) -> None:
        flow = _flow_module()
        assert flow._pullmd_extraction_method("readability") == (
            "pullmd_readability"
        )
        assert flow._pullmd_extraction_method("trafilatura") == (
            "pullmd_trafilatura"
        )
        assert flow._pullmd_extraction_method(None) is None

    def test_missing_x_source_header_degrades_silently_without_warning(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        """A MISSING X-Source header (None) degrades to None SILENTLY — the
        warning is reserved for a PRESENT-but-unknown value, matching the
        {75.9}-retired guard's `x_source in set` / else-warn shape."""
        flow = _flow_module()

        with caplog.at_level(logging.WARNING, logger=flow.__name__):
            assert flow._pullmd_extraction_method(None) is None

        events = [
            json.loads(r.message)
            for r in caplog.records
            if r.message.startswith("{")
        ]
        warn_events = [
            e
            for e in events
            if e.get("event") == "cocoindex.pullmd_unknown_x_source"
        ]
        assert warn_events == [], (
            "a missing X-Source header must degrade to None WITHOUT the "
            "unknown-X-Source warning"
        )


# ── Module-source guard: 'ci:' is never seeded from a URL (BI-2) ────────────


class TestCiSeedNeverUrlDerived:
    def test_flow_source_never_concatenates_ci_with_url_seed(self) -> None:
        """BI-1/BI-2 acceptance: every ``"ci:"`` uuid5 seed in flow.py is
        rel_path-derived (the file corpus); none is URL-derived."""
        flow_path = (
            Path(__file__).resolve().parents[1] / "cocoindex_pipeline" / "flow.py"
        )
        source = flow_path.read_text()
        ci_seed_lines = [
            line.strip()
            for line in source.splitlines()
            if re.search(r"f?[\"']ci:", line)
        ]
        assert ci_seed_lines, "census expects the file-corpus 'ci:' seeds"
        for line in ci_seed_lines:
            assert 'f"ci:{rel_path}"' in line, (
                f"'ci:' seed must be rel_path-derived, found: {line!r}"
            )
            assert "url" not in line.lower(), (
                f"'ci:' must NEVER be seeded from a URL (BI-2): {line!r}"
            )

    def test_ingest_url_body_source_contains_no_ci_seed(self) -> None:
        flow = _flow_module()
        body_source = inspect.getsource(flow._ingest_url_body)
        assert "ci:" not in body_source
        assert 'f"sd:{' in body_source and 'f"ri:{' in body_source
