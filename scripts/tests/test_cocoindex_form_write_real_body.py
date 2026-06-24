"""Real-body coverage for the Path-B form-write path (ID-80.4 — seam-patch debt).

ROOT PROBLEM (the SEAM-PATCH antipattern)
==========================================
Flow-level tests in ``test_cocoindex_flow_*.py`` uniformly ``monkeypatch.setattr``
internal helpers OUT (``extract_form_structure``, ``_trim_stale_form_fields``,
``_run_stage_5_resolution``), so their REAL bodies never ran in CI — which is
exactly why both bl-224 and bl-225 shipped broken with zero real-body coverage.
``docs/reference/test-philosophy.md`` §5.3: "Mock at the seam where the SUT meets
the outside world (HTTP, DB, Anthropic SDK), not at every internal helper.
Over-mocking creates tests that pass with broken implementations."

AUTHORITATIVE SEAM-PATCH SWEEP (deliverable A)
==============================================
Swept EVERY patched seam across ``scripts/tests/test_cocoindex_*.py`` plus the
form-extractor tests, using ALL patch mechanisms (``monkeypatch.setattr``,
``unittest.mock.patch``/``patch.object``, ``MagicMock``/``AsyncMock`` assignment,
module-level fixture fakes). Each patched symbol is classified:
  (1) outside-world seam, legitimately patched, own dedicated unit test → no-action.
  (2) internal helper uniformly patched but with a dedicated real-body test → no-action.
  (3) GENUINE zero-real-body gap → real-body exercise added below.

Disposition table (symbol → class → covering / new test):

  -- (1) OUTSIDE-WORLD SEAMS (LLM / network / DB / embedder) --
  convert_binary_to_markdown  (1)  test_cocoindex_adapters.py (Docling seam;
                                    flow-level patch is correct — it is the binary
                                    conversion boundary).
  extract_classification      (1)  test_cocoindex_extractors.py /
                                    test_cocoindex_extractor_retry.py (Anthropic seam).
  extract_qa_form             (1)  test_cocoindex_extractors.py /
                                    test_cocoindex_extractor_retry.py (Anthropic seam).
  extract_entity_mentions     (1)  test_cocoindex_extractors.py /
                                    test_cocoindex_extractor_retry.py (Anthropic seam).
  embed_content_text          (1)  test_cocoindex_flow_embedding.py +
                                    test_cocoindex_flow_embedding_stage_count.py
                                    (_get_embedder / OpenAI seam, real dimension proof).
  _get_embedder               (1)  test_cocoindex_flow_embedding.py (OpenAI client ctor).
  asyncpg.create_pool         (1)  test_cocoindex_flow_write_path.py::TestLifespanProvidesDbCtx
                                    (the lifespan body is exercised; only the asyncpg
                                    pool ctor — the DB seam — is faked).
  coco.use_context            (1)  faked where the cocoindex Rust engine is not
                                    running (DB env-scope read); the REAL
                                    _trim_stale_form_fields body that CALLS it is
                                    exercised by the bl-224 test (see class 2 below).
  stub.use_context (MagicMock)(1)  centralised cocoindex stub (conftest); the engine
                                    boundary, not a SUT helper.
  _build_dsn                  (1)  test_cocoindex_build_dsn.py (real DSN-assembly body).
  localfs.walk_dir            (1)  cocoindex source-walk engine boundary
                                    (test_cocoindex_flow_live_ingest.py harness only).
  coco.mount_each /
   coco.component_subpath /
   mount_table_target /
   _FlowStageCounter (live)   (1)  cocoindex engine wiring faked ONLY in the
                                    app_main live-ingest harness; the faithful
                                    mount_each arity contract is proved REAL-BODY by
                                    test_cocoindex_flow_write_path.py::TestMountEachArityContract.
  _emit_pipeline_run_webhook  (1)  test_cocoindex_flow_pipeline_run_webhook.py
                                    (real webhook-emit body; HTTP seam faked there).
  _emit_stage_error_log       (1)  spy used to OBSERVE stage-error emission; the real
                                    emitter is a structured-log writer (no SUT logic
                                    masked — the analysis_failed/resolution branches
                                    that CALL it run real, asserted via the spy).

  -- (2) INTERNAL HELPERS with a dedicated REAL-BODY test elsewhere --
  _trim_stale_form_fields     (2)  REAL body run by test_cocoindex_flow_write_path.py::
                                    test_trim_resolves_pool_via_use_context_and_issues_shrink_delete
                                    (bl-224; pins literal DELETE SQL + coco.use_context(DB_CTX)).
                                    Maintenance-hazard guard added below (deliverable C).
  _run_stage_5_resolution     (2)  REAL body run by test_cocoindex_stage_5_resolution.py
                                    (bl-225; models UNIQUE(canonical_name,entity_type,
                                    content_item_id) UniqueViolation, RED-before).
  _extract_pdf / _extract_xlsx /
   _extract_docx (orchestrator)(2) REAL reader bodies run by test_form_extractors.py
                                    (corpus-fixture walks) + test_docx_cell_to_markdown.py +
                                    test_xlsx_zero_archetype.py.
                                    The orchestrator's OWN dispatch body runs real in
                                    test_form_extractor_orchestrator.py (only the per-format
                                    readers are faked there — the seam below the dispatcher).
  stamp_extraction_base       (2)  REAL body via the delegating spy in
                                    test_cocoindex_flow_write_path.py::TestStampExtractionBaseWiredIntoIngest.
  resolve_workspace           (2)  REAL body (a real WorkspaceManifest is bound) in every
                                    TestFormWrite* class; faked only in the live-ingest harness.
  extract_source_provenance   (2)  REAL routing body in
                                    test_cocoindex_flow_write_path.py::TestSourceDocumentProvenanceWritePath.

  -- (3) GENUINE ZERO-REAL-BODY GAP → real-body test added here --
  extract_form_structure THROUGH ingest_file
                              (3)  Until now EVERY flow test faked extract_form_structure
                                    (legit parser seam at the unit level), and the
                                    orchestrator test runs it only in ISOLATION. No single
                                    test drove flow.ingest_file with the REAL
                                    extract_form_structure into the REAL form-write block.
                                    Closed by TestFormWriteRealExtractorEndToEnd below: a
                                    REAL committed fixture (corrupt.pdf) drives the unpatched
                                    orchestrator → real _extract_pdf → FormExtractionError →
                                    real analysis_failed write-block. DB targets faked via
                                    _FakeTarget; File via _FakeFormFile (read() returns the
                                    fixture bytes). RED-before: pre-fix, an unpatched
                                    extractor in this flow path was never exercised, so a
                                    regression in the orchestrator wiring or the
                                    analysis_failed branch would pass undetected.

SWEEP BOUND: this sweep covers the cocoindex form + stage-5 + form-extractor test
corpus (the Path-B form-write surface named in the ID-80.4 brief). It does NOT
re-audit the non-form Path-A stage tests beyond the seams they share with the
form path (those are dispositioned (1) above where they touch the form block).
No silent caps: every patched symbol observed in the swept files is dispositioned
above.

LIVE / INTEGRATION DB-PATH (deliverable D — DOCUMENTED ZERO-COVERAGE NOTE)
==========================================================================
Path-B end-to-end DB writes (real form_templates / form_template_fields rows
landing in Postgres) are NOT unit-covered here BY DESIGN. The no-staging-burn
constraint plus parent-owned staging verification cover the live path; an opt-in
real-DB integration test is DEFERRED. This module proves the write-block SHAPE +
the real-extractor wiring deterministically (no network, no DB, no staging write).

Async tests follow the repo convention (no pytest-asyncio plugin): drive
coroutines via ``asyncio.run`` inside sync test functions.

Reference: docs/reference/test-philosophy.md §1 (six criteria), §5.3 (mock the
boundary); docs/specs/id-52-form-extraction/PRODUCT.md Inv-17; TECH §2.5 / §2.8.
"""

from __future__ import annotations

import asyncio
import inspect
import uuid
from pathlib import Path

import pytest

from conftest import fresh_flow_module  # noqa: E402

# ID-101 §{101.7}: neutralise the relationship-extraction Path-A seam so
# ingest_file tests make no live Anthropic call (mirrors the
# extract_entity_mentions stubs alongside).
async def _fake_relationships_empty(content_text: str) -> list:
    return []



# The committed, deterministic fixture: a 79-byte malformed PDF. The REAL
# pdfplumber-backed reader raises FormExtractionError(reason="corrupt_pdf") on
# it (no network, no DB). The corpus symlinks (evaluation-matrix / SQ-pdf) are
# intentionally NOT used here — corrupt.pdf is committed so this runs anywhere.
_FIXTURE_DIR = Path(__file__).parent / "fixtures" / "form-extraction"
_CORRUPT_PDF = _FIXTURE_DIR / "corrupt.pdf"


def _flow_module():
    """Load a fresh stubbed ``cocoindex_pipeline.flow`` (ID-55.1 primitive)."""
    return fresh_flow_module()


class _FakeTarget:
    """Records ``declare_row`` calls without touching any DB (mirrors the
    write-path suite's double — keyword-only ``declare_row(*, row)``)."""

    def __init__(self, table_name: str) -> None:
        self.table_name = table_name
        self.rows: list[dict] = []

    def declare_row(self, *, row: dict) -> None:
        self.rows.append(row)


class _FakeFormFile:
    """Form-flow File stand-in with a RELATIVE ``file_path.path`` (production
    shape) whose ``read()`` returns the on-disk fixture bytes. Mirrors the
    ``_FakeFormFile`` in test_cocoindex_flow_write_path.py: the orchestrator
    reads ``file.file_path.path.suffix`` (dispatch) and ``await file.read()``
    (the raw bytes handed to the real per-format reader)."""

    class _FilePath:
        def __init__(self, rel_path: Path) -> None:
            self.path = rel_path

    def __init__(self, rel_path: str, disk_path: Path) -> None:
        self.file_path = _FakeFormFile._FilePath(Path(rel_path))
        self._disk = disk_path

    async def size(self) -> int:
        return self._disk.stat().st_size

    async def read(self) -> bytes:
        return self._disk.read_bytes()

    async def read_text(self) -> str:
        return self._disk.read_text()

    async def content_fingerprint(self) -> bytes:
        import hashlib

        return hashlib.sha256(self._disk.read_bytes()).digest()


def _make_manifest(
    flow: object, prefix: str, workspace_id: uuid.UUID, *, route: str = "content"
):
    from scripts.cocoindex_pipeline.workspace_resolver import (
        WorkspaceManifest,
        WorkspaceMapping,
    )

    return WorkspaceManifest(
        schema_version=1,
        mappings=[
            WorkspaceMapping(
                path_prefix=prefix, workspace_id=workspace_id, route=route
            )
        ],
    )


def _stub_path_a(flow: object, monkeypatch: pytest.MonkeyPatch) -> None:
    """Stub ONLY the outside-world Path-A seams (Docling / Anthropic / OpenAI)
    so the Path-B form block is exercised in isolation — class-(1) seams in the
    sweep above. ``extract_form_structure`` is deliberately LEFT UNPATCHED so
    its real body (and the real per-format reader it dispatches to) runs."""

    async def _fake_convert(file: object) -> str:
        return "# Form\n\nbody"

    async def _fake_classification(content_text: str):
        return {"content_type": "case_study"}

    async def _fake_qa(content_text: str):
        return {"qa_pairs": []}

    async def _fake_entities(content_text: str):
        return []

    async def _fake_embed(content_text: str) -> list[float]:
        return [0.0] * 1024

    monkeypatch.setattr(flow, "convert_binary_to_markdown", _fake_convert)
    monkeypatch.setattr(flow, "extract_classification", _fake_classification)
    monkeypatch.setattr(flow, "extract_qa_form", _fake_qa)
    monkeypatch.setattr(flow, "extract_entity_mentions", _fake_entities)
    monkeypatch.setattr(flow, "extract_relationships", _fake_relationships_empty)
    monkeypatch.setattr(flow, "embed_content_text", _fake_embed)


# ── Deliverable B — end-to-end REAL extractor through the form-write block ────


class TestFormWriteRealExtractorEndToEnd:
    """The REAL ``extract_form_structure`` drives the form-write block.

    GENUINE GAP (class 3): every other flow test fakes ``extract_form_structure``;
    the orchestrator test runs it in isolation. This is the FIRST test that drives
    ``flow.ingest_file`` with the extractor UNPATCHED into the real form-write
    block. The committed ``corrupt.pdf`` (a malformed PDF) makes the REAL
    orchestrator dispatch to the REAL ``pdf.extract``, which raises a REAL
    ``FormExtractionError`` (``pdfplumber.open`` fails on the bytes) — so the REAL
    Inv-17 analysis_failed write-block runs end-to-end.

    RED-before rationale: prior to ID-80.4 no test exercised the
    extractor→write-block seam unpatched, so a regression in the orchestrator
    dispatch, the per-file ``except FormExtractionError`` catch, or the
    analysis_failed declare_row payload would have passed CI undetected (the
    seam-patch antipattern bl-224/bl-225 shipped on).
    """

    def test_corrupt_pdf_drives_real_extractor_to_analysis_failed_row(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        assert _CORRUPT_PDF.exists(), (
            f"committed fixture missing — {_CORRUPT_PDF} must be a real malformed "
            "PDF so the real reader raises FormExtractionError deterministically"
        )

        flow = _flow_module()
        _stub_path_a(flow, monkeypatch)
        # NB: extract_form_structure is NOT patched — the real orchestrator +
        # real pdf.extract run. _trim_stale_form_fields is NOT reached on the
        # analysis_failed branch (it returns before the trim), so no DB pool is
        # needed.

        from scripts.cocoindex_pipeline.flow_context import (
            bind_flow_meta,
            bind_workspace_manifest,
        )

        ws = uuid.uuid4()
        # ID-80.8: route="forms" so the fork takes the form branch (the
        # pre-fork dispatcher ran the form block for every manifest-active
        # file; the ratified fork requires the explicit route tag).
        manifest = _make_manifest(flow, "acme/", ws, route="forms")
        rel_path = "acme/corrupt.pdf"
        fake_file = _FakeFormFile(rel_path, _CORRUPT_PDF)

        # Observe the structured stage-error emission (the emitter is a log
        # writer; the analysis_failed BRANCH that calls it runs real).
        emitted: list[dict] = []
        monkeypatch.setattr(
            flow, "_emit_stage_error_log", lambda **kw: emitted.append(kw)
        )

        ci = _FakeTarget("content_items")
        qa = _FakeTarget("q_a_extractions")
        sd = _FakeTarget("source_documents")
        em = _FakeTarget("entity_mentions")
        ft = _FakeTarget("form_templates")
        ftf = _FakeTarget("form_template_fields")

        async def _exercise() -> None:
            async with bind_flow_meta(op_id=uuid.uuid4()):
                async with bind_workspace_manifest(manifest):
                    # Must NOT raise — Inv-17 scopes the FormExtractionError
                    # per-file so the batch is not halted.
                    await flow.ingest_file(fake_file, ci, qa, sd, em, ft, ftf)

        asyncio.run(_exercise())

        # The REAL extractor raised FormExtractionError → exactly one
        # form_templates row, status analysis_failed, ZERO field rows (Inv-17).
        assert len(ft.rows) == 1, (
            "the real reader's FormExtractionError must produce exactly one "
            "analysis_failed form_templates row"
        )
        ft_row = ft.rows[0]
        assert ft_row["status"] == "analysis_failed"
        assert ft_row["field_count"] == 0
        assert ft_row["mapped_count"] == 0
        assert ftf.rows == [], "an analysis_failed form declares no field rows"
        # NOT-NULL columns populated from the File (no form_metadata on this path).
        assert ft_row["workspace_id"] == ws
        assert ft_row["created_by"] == flow.SERVICE_ACCOUNT_UUID
        assert ft_row["mime_type"] == "application/pdf"
        assert ft_row["filename"] == "corrupt.pdf"
        assert ft_row["name"] == "corrupt"  # stem
        assert ft_row["storage_path"] == rel_path
        assert ft_row["file_size"] == _CORRUPT_PDF.stat().st_size
        assert ft_row["ingest_source"] == "pipeline"
        # Deterministic ft: UUID5 so a later successful re-ingest UPSERTs this
        # row. Pinned to a frozen uuid5 literal over _KH_PIPELINE_DOC_NS
        # ("fbfaf1ff-1ee4-583c-9757-1674465b2ec1") for rel_path
        # "acme/corrupt.pdf" — not re-derived from flow, so a namespace/seed
        # drift fails loudly.
        assert ft_row["id"] == uuid.UUID("1aa32286-a133-5063-97e7-91a08a8bbd5b")
        # A form_extraction stage error was surfaced by the real failure branch.
        assert any(e.get("stage") == "form_extraction" for e in emitted), (
            "the real FormExtractionError must surface a form_extraction stage error"
        )

    def test_corrupt_pdf_failure_is_scoped_and_lands_zero_content_rows(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Inv-17 batch-safety through the REAL extractor: the form-extraction
        failure does not halt the per-item flow (the call returns, it does not
        raise) and the analysis_failed row records the failure.

        ID-80.8 expectation change — RATIFIED OQ-80.2-A (Liam, S314,
        05/06/2026): a forms-routed file lands ZERO content rows (no
        content_items / source_documents / content_chunks / q_a_extractions /
        entity_mentions); the minimal-provenance-row fallback is DROPPED.
        Pre-fork, this test asserted the canonical Path-A rows landed for the
        same file — that was the shared-path behaviour the {80.8} fork
        eliminates (one file → one branch → one write-target set)."""
        flow = _flow_module()
        _stub_path_a(flow, monkeypatch)

        from scripts.cocoindex_pipeline.flow_context import (
            bind_flow_meta,
            bind_workspace_manifest,
        )

        ws = uuid.uuid4()
        manifest = _make_manifest(flow, "acme/", ws, route="forms")
        fake_file = _FakeFormFile("acme/corrupt.pdf", _CORRUPT_PDF)

        monkeypatch.setattr(flow, "_emit_stage_error_log", lambda **kw: None)

        ci = _FakeTarget("content_items")
        qa = _FakeTarget("q_a_extractions")
        sd = _FakeTarget("source_documents")
        em = _FakeTarget("entity_mentions")
        ft = _FakeTarget("form_templates")
        ftf = _FakeTarget("form_template_fields")

        async def _exercise() -> None:
            async with bind_flow_meta(op_id=uuid.uuid4()):
                async with bind_workspace_manifest(manifest):
                    # Must NOT raise — Inv-17 scopes the FormExtractionError
                    # per-file so the batch is not halted.
                    await flow.ingest_file(fake_file, ci, qa, sd, em, ft, ftf)

        asyncio.run(_exercise())

        # ZERO content rows for the forms-routed file (OQ-80.2-A ratified).
        assert sd.rows == [], (
            "a forms-routed file must land ZERO source_documents rows "
            "(OQ-80.2-A zero-content-rows, ratified 05/06/2026)"
        )
        assert ci.rows == [], (
            "a forms-routed file must land ZERO content_items rows "
            "(OQ-80.2-A zero-content-rows, ratified 05/06/2026)"
        )
        assert qa.rows == [] and em.rows == []
        # The form path recorded the analysis_failed row (real extractor) —
        # the failure is visible AND scoped (the batch continues).
        assert len(ft.rows) == 1 and ft.rows[0]["status"] == "analysis_failed"
        assert ftf.rows == []


# ── Deliverable C — maintenance-hazard guard for the raw DELETE ───────────────


class TestTrimDeleteColumnsMatchDeclaredSchema:
    """The raw shrink DELETE references only columns present in the
    ``form_template_fields`` declare_row payload.

    ``_trim_stale_form_fields`` issues a RAW
    ``DELETE FROM public.form_template_fields WHERE template_id=$1 AND
    sequence>$2`` OUTSIDE the declare_row/target model (bl-224). A column rename
    on ``form_template_fields`` would NOT be caught by the declare path — the
    bl-224 test pins the literal SQL but does not tie it to the declared schema.
    This guard asserts the DELETE's referenced columns (``template_id``,
    ``sequence``) are present in the ``form_template_fields`` declare_row payload
    schema in ``flow.py`` — so a rename breaks the guard alongside the declare.
    """

    def test_delete_columns_present_in_declared_field_schema(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        flow = _flow_module()
        # Capture the REAL trim body source BEFORE the monkeypatch replaces the
        # module attribute (the guard reads the raw SQL from the unpatched body).
        trim_src = inspect.getsource(flow._trim_stale_form_fields)
        _stub_path_a(flow, monkeypatch)

        from scripts.cocoindex_pipeline.flow_context import (
            bind_flow_meta,
            bind_workspace_manifest,
        )
        from scripts.cocoindex_pipeline.form_extractors.shared import (
            ExtractedField,
            ExtractedForm,
            FormMetadata,
        )

        async def _fake_extract(file: object):
            return ExtractedForm(
                form_metadata=FormMetadata(form_type="tender", form_format="pdf"),
                fields=[
                    ExtractedField(
                        question_text="Q0",
                        field_type="empty_cell",
                        fill_status="pending",
                        sequence=0,
                    )
                ],
            )

        async def _fake_trim(template_id, new_max_sequence) -> None:
            # Faked: this guard targets the DECLARE-vs-DELETE schema relationship,
            # not the DELETE pool (the real DELETE body is covered by bl-224).
            return None

        monkeypatch.setattr(flow, "extract_form_structure", _fake_extract)
        monkeypatch.setattr(flow, "_trim_stale_form_fields", _fake_trim)

        ws = uuid.uuid4()
        # ID-80.8: route="forms" so the fork reaches the form branch.
        manifest = _make_manifest(flow, "acme/", ws, route="forms")
        # rel_path suffix .pdf so the (faked) extractor branch is the analysed
        # path; the on-disk bytes are never read because the extractor is faked.
        fake_file = _FakeFormFile("acme/has-fields.pdf", _CORRUPT_PDF)

        captured: dict[str, set[str]] = {}

        class _CapturingTarget(_FakeTarget):
            def declare_row(self, *, row: dict) -> None:
                captured["keys"] = set(row.keys())
                super().declare_row(row=row)

        ci = _FakeTarget("content_items")
        qa = _FakeTarget("q_a_extractions")
        sd = _FakeTarget("source_documents")
        em = _FakeTarget("entity_mentions")
        ft = _FakeTarget("form_templates")
        ftf = _CapturingTarget("form_template_fields")

        async def _exercise() -> None:
            async with bind_flow_meta(op_id=uuid.uuid4()):
                async with bind_workspace_manifest(manifest):
                    await flow.ingest_file(fake_file, ci, qa, sd, em, ft, ftf)

        asyncio.run(_exercise())

        declared_keys = captured.get("keys")
        assert declared_keys, "expected a form_template_fields declare_row payload"

        # The raw shrink DELETE columns (read from the REAL _trim body source,
        # captured above before the monkeypatch).
        assert "DELETE FROM public.form_template_fields" in trim_src, (
            "the shrink DELETE target table must be form_template_fields"
        )
        # The two columns the DELETE keys on MUST exist in the declared schema —
        # a rename on either side breaks this guard, tying the raw SQL to the
        # declare_row model the cocoindex target validates. The DELETE keys
        # ``template_id`` via equality and ``sequence`` via a range comparison
        # (``WHERE template_id = $1 AND sequence > $2``), so match each column
        # name followed by any SQL comparison operator.
        import re

        # Narrow to the SQL literal so a column name in the docstring/identifier
        # list never satisfies the column-presence check by accident.
        sql_literal = trim_src[trim_src.index("DELETE FROM public.form_template_fields") :]
        for column in ("template_id", "sequence"):
            assert re.search(rf"\b{re.escape(column)}\s*(=|>|<|>=|<=)\s*\$", sql_literal), (
                f"the shrink DELETE must reference {column!r} in a WHERE comparison"
            )
            assert column in declared_keys, (
                f"DELETE references column {column!r} which is absent from the "
                "form_template_fields declare_row payload — a rename would slip "
                "past the declare path (bl-224 maintenance hazard)"
            )
