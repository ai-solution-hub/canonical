"""ID-80.8 — fork routing: one file routes down exactly ONE branch (80.2 §B.1/§B.3).

RATIFIED OQ-80.2-A (Liam, S314, 05/06/2026): forms land ZERO content rows — no
content_items / source_documents / content_chunks / q_a_extractions /
entity_mentions. The minimal-provenance-row fallback is DROPPED. RATIFIED
OQ-80.2-B: the manifest per-prefix ``route`` tag is THE fork point, computed
once in ``_ingest_file_body`` immediately after ``rel_path``, BEFORE either
write path runs.

REAL-BODY discipline (test-philosophy §5.3, mirrors ID-80.4): the fork body and
``extract_form_structure`` (with its real per-format readers) run UNPATCHED.
Only the outside-world seams are touched — and on the forms route they are
touched as RECORDING OBSERVERS asserting ZERO calls (Docling conversion +
the three Anthropic extraction passes never run for a form), which is the
testStrategy's "zero content-target calls, zero Anthropic extraction calls".
``_trim_stale_form_fields`` is the asyncpg-pool seam (bl-224 covers its real
body) and is faked here.

Branch contract under test:
  - ``route:"forms"`` .docx → ft/ftf declares ONLY; ci/qa/sd/em/cc all empty;
    zero ``convert_binary_to_markdown`` and zero Anthropic extraction calls.
  - unmapped .md (manifest active, no prefix match) → bl-219 soft-warn + the
    CONTENT branch (content rows only, zero ft/ftf).
  - mapped ``route:"content"`` .md → content rows only; the form branch (and
    ``extract_form_structure``) never runs.
  - .md under a ``route:"forms"`` prefix → manifest mis-wire: loud
    ``cocoindex.stage_error`` (``extraction_validation_failed``) + ZERO rows
    on EVERY target (spec B.3 secondary suffix guard).
  - AmbiguousResolution at the fork → loud stage error + ZERO rows on EVERY
    target (the content rows that previously landed before the form-block
    error no longer land — the fork fails the file before either branch).

Async tests follow the repo convention (no pytest-asyncio plugin): drive
coroutines via ``asyncio.run`` inside sync test functions.

Reference: docs/specs/ID-80-forms-path-b/80.2-forms-content-separation.md
§B.1/§B.3/§B.6; docs/reference/test-philosophy.md §1/§5.3.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import uuid
from pathlib import Path

import pytest

from conftest import fresh_flow_module  # noqa: E402

# Real committed corpus fixture (symlinked into the fixture dir) — a genuine
# blank-instrument DOCX the real docx reader extracts fields from. The same
# fixture test_form_extractors.py's real-body suite walks.
_FIXTURE_DIR = Path(__file__).parent / "fixtures" / "form-extraction"
_CHARNWOOD_DOCX = _FIXTURE_DIR / "itt-services-charnwood.docx"


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


class _FakeFile:
    """File stand-in with a RELATIVE ``file_path.path`` (production shape post
    ``_to_source_relative``) whose ``read()`` returns on-disk bytes when a disk
    path is supplied, else the given literal bytes."""

    class _FilePath:
        def __init__(self, rel_path: Path) -> None:
            self.path = rel_path

    def __init__(
        self, rel_path: str, *, disk_path: Path | None = None, data: bytes = b""
    ) -> None:
        self.file_path = _FakeFile._FilePath(Path(rel_path))
        self._disk = disk_path
        self._data = data

    def _bytes(self) -> bytes:
        return self._disk.read_bytes() if self._disk is not None else self._data

    async def size(self) -> int:
        return len(self._bytes())

    async def read(self) -> bytes:
        return self._bytes()

    async def read_text(self) -> str:
        return self._bytes().decode("utf-8")

    async def content_fingerprint(self) -> bytes:
        return hashlib.sha256(self._bytes()).digest()


def _make_manifest(prefix: str, workspace_id: uuid.UUID, *, route: str = "content"):
    """Build a real WorkspaceManifest mapping ``prefix`` → ``workspace_id``
    with the {80.6} per-prefix ``route`` tag (the fork discriminator)."""
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


def _observe_path_a_seams(flow: object, monkeypatch: pytest.MonkeyPatch) -> dict:
    """Replace the outside-world Path-A seams (Docling / Anthropic / OpenAI)
    with RECORDING observers. On the content route they return benign values;
    on the forms route the test asserts their counts stay ZERO — the
    structural mutual-exclusion proof the testStrategy demands."""
    calls = {
        "convert": 0,
        "classification": 0,
        "qa": 0,
        "entities": 0,
        "embed": 0,
    }

    async def _fake_convert(file: object) -> str:
        calls["convert"] += 1
        return "# Doc\n\nbody"

    async def _fake_classification(content_text: str):
        calls["classification"] += 1
        return {"content_type": "case_study"}

    async def _fake_qa(content_text: str):
        calls["qa"] += 1
        return {"qa_pairs": []}

    async def _fake_entities(content_text: str):
        calls["entities"] += 1
        return []

    async def _fake_embed(content_text: str) -> list[float]:
        calls["embed"] += 1
        return [0.0] * 1024

    monkeypatch.setattr(flow, "convert_binary_to_markdown", _fake_convert)
    monkeypatch.setattr(flow, "extract_classification", _fake_classification)
    monkeypatch.setattr(flow, "extract_qa_form", _fake_qa)
    monkeypatch.setattr(flow, "extract_entity_mentions", _fake_entities)
    monkeypatch.setattr(flow, "embed_content_text", _fake_embed)
    return calls


def _spy_trim(flow: object, monkeypatch: pytest.MonkeyPatch) -> list[tuple]:
    """Fake the asyncpg-pool trim seam (real body covered by bl-224)."""
    trims: list[tuple] = []

    async def _fake_trim(template_id, new_max_sequence) -> None:
        trims.append((template_id, new_max_sequence))

    monkeypatch.setattr(flow, "_trim_stale_form_fields", _fake_trim)
    return trims


def _drive_ingest(flow: object, fake_file: object, *, manifest: object) -> dict:
    """Drive one real ``ingest_file`` under bind_flow_meta +
    bind_workspace_manifest, with ALL SEVEN targets recording (including
    content_chunks — the forks's zero-content proof covers cc too)."""
    from scripts.cocoindex_pipeline.flow_context import (
        bind_flow_meta,
        bind_workspace_manifest,
    )

    targets = {
        "ci": _FakeTarget("content_items"),
        "qa": _FakeTarget("q_a_extractions"),
        "sd": _FakeTarget("source_documents"),
        "em": _FakeTarget("entity_mentions"),
        "ft": _FakeTarget("form_templates"),
        "ftf": _FakeTarget("form_template_fields"),
        "cc": _FakeTarget("content_chunks"),
    }
    run_op_id = uuid.uuid4()

    async def _exercise() -> None:
        async with bind_flow_meta(op_id=run_op_id):
            async with bind_workspace_manifest(manifest):
                await flow.ingest_file(
                    fake_file,
                    targets["ci"],
                    targets["qa"],
                    targets["sd"],
                    targets["em"],
                    targets["ft"],
                    targets["ftf"],
                    targets["cc"],
                )

    asyncio.run(_exercise())
    targets["op_id"] = run_op_id  # type: ignore[assignment]
    return targets


def _content_targets(targets: dict) -> dict:
    return {k: targets[k] for k in ("ci", "qa", "sd", "em", "cc")}


class TestFormsRouteWritesFormTargetsOnly:
    """route:'forms' .docx → ft/ftf declares ONLY — zero content-target calls,
    zero Anthropic extraction calls, zero conversion (testStrategy line 1)."""

    def test_real_docx_on_forms_route_lands_ft_ftf_and_nothing_else(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        assert _CHARNWOOD_DOCX.exists(), (
            f"corpus fixture missing — {_CHARNWOOD_DOCX} should symlink to "
            "docs/testing/test-data/templates/itt-services-charnwood/"
            "ITT Services.docx"
        )

        flow = _flow_module()
        calls = _observe_path_a_seams(flow, monkeypatch)
        _spy_trim(flow, monkeypatch)
        # NB: extract_form_structure is NOT patched — the real orchestrator and
        # the real docx reader run against the committed corpus fixture.

        ws = uuid.uuid4()
        manifest = _make_manifest("_held_forms/", ws, route="forms")
        rel_path = "_held_forms/charnwood/itt-services.docx"
        fake_file = _FakeFile(rel_path, disk_path=_CHARNWOOD_DOCX)

        out = _drive_ingest(flow, fake_file, manifest=manifest)

        # Form targets: one analysed template + its real extracted fields.
        assert len(out["ft"].rows) == 1, "exactly one form_templates row"
        ft_row = out["ft"].rows[0]
        assert ft_row["status"] == "analysed"
        assert ft_row["workspace_id"] == ws
        assert ft_row["storage_path"] == rel_path
        assert ft_row["id"] == uuid.uuid5(flow._KH_PIPELINE_DOC_NS, f"ft:{rel_path}")
        assert len(out["ftf"].rows) >= 1, (
            "the real docx reader must extract at least one field from the "
            "Charnwood blank instrument"
        )
        assert ft_row["field_count"] == len(out["ftf"].rows)

        # RATIFIED OQ-80.2-A: ZERO content rows for a forms-routed file — no
        # content_items / source_documents / content_chunks / q_a_extractions /
        # entity_mentions (the minimal-provenance-row fallback is dropped).
        for name, target in _content_targets(out).items():
            assert target.rows == [], (
                f"forms route must declare ZERO {target.table_name} rows "
                f"(OQ-80.2-A ratified zero-content-rows) — got {len(target.rows)}"
            )

        # Structural mutual exclusion: the forms route performs NO Stage-2
        # conversion and NO Anthropic extraction passes (Path-A waste the fork
        # eliminates — 80.2 §B.3).
        assert calls["convert"] == 0, (
            "convert_binary_to_markdown must NOT run for a forms-routed file"
        )
        assert calls["classification"] == 0
        assert calls["qa"] == 0
        assert calls["entities"] == 0
        assert calls["embed"] == 0


class TestContentRouteWritesContentTargetsOnly:
    """Unmapped / route:'content' .md → content rows only, zero ft/ftf
    (testStrategy line 2)."""

    def test_unmapped_md_soft_warns_and_takes_content_branch(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """bl-219 preserved AT THE FORK: an unmapped path is benign — soft-warn
        (WARNING, not stage_error) and the file routes down the content branch."""
        flow = _flow_module()
        _observe_path_a_seams(flow, monkeypatch)

        form_extract_called = {"value": False}

        async def _form_extract_guard(file: object):
            form_extract_called["value"] = True
            return None

        monkeypatch.setattr(flow, "extract_form_structure", _form_extract_guard)

        emitted: list[dict] = []
        monkeypatch.setattr(
            flow, "_emit_stage_error_log", lambda **kw: emitted.append(kw)
        )
        warns: list[dict] = []
        monkeypatch.setattr(
            flow, "_emit_workspace_unmapped_warn", lambda **kw: warns.append(kw)
        )

        ws = uuid.uuid4()
        # The manifest maps a DIFFERENT prefix — the staged file is unmapped.
        manifest = _make_manifest("other-client/", ws, route="forms")
        fake_file = _FakeFile("unmapped/doc.md", data=b"# H\n\nbody")

        out = _drive_ingest(flow, fake_file, manifest=manifest)

        # Content rows landed (bl-219: unmapped is benign for file content).
        assert len(out["ci"].rows) == 1
        assert len(out["sd"].rows) == 1
        # Zero form rows; the form branch (and its extractor) never ran.
        assert out["ft"].rows == []
        assert out["ftf"].rows == []
        assert form_extract_called["value"] is False
        # Exactly one benign soft-warn; NO workspace_resolution stage error.
        assert len(warns) == 1
        assert [e for e in emitted if e.get("stage") == "workspace_resolution"] == []

    def test_mapped_content_md_lands_content_rows_and_never_runs_form_branch(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A mapped ``route:"content"`` prefix (the backward-compatible default)
        routes the content branch ONLY — ``extract_form_structure`` is never
        invoked (pre-fork it ran for every manifest-active file)."""
        flow = _flow_module()
        calls = _observe_path_a_seams(flow, monkeypatch)

        async def _must_not_run(file: object):
            raise AssertionError(
                "extract_form_structure must NEVER run on the content route "
                "(structural mutual exclusion — 80.2 §B.3)"
            )

        monkeypatch.setattr(flow, "extract_form_structure", _must_not_run)

        ws = uuid.uuid4()
        manifest = _make_manifest("acme/", ws)  # route defaults to "content"
        fake_file = _FakeFile("acme/notes.md", data=b"# H\n\nbody")

        out = _drive_ingest(flow, fake_file, manifest=manifest)

        assert len(out["ci"].rows) == 1
        assert len(out["sd"].rows) == 1
        assert out["ft"].rows == []
        assert out["ftf"].rows == []
        # The content branch performed its Stage-2 conversion + LLM passes.
        assert calls["convert"] == 1
        assert calls["classification"] == 1


class TestFormsRouteSuffixGuard:
    """.md under route:'forms' → loud stage_error, zero rows (testStrategy
    line 3; spec B.3 secondary suffix guard — candidate 5)."""

    @pytest.mark.parametrize("filename", ["notes.md", "notes.txt", "notes.html"])
    def test_non_form_suffix_under_forms_route_is_loud_zero_rows(
        self, monkeypatch: pytest.MonkeyPatch, filename: str
    ) -> None:
        flow = _flow_module()
        calls = _observe_path_a_seams(flow, monkeypatch)

        async def _must_not_run(file: object):
            raise AssertionError(
                "extract_form_structure must not run on a suffix-guard mis-wire"
            )

        monkeypatch.setattr(flow, "extract_form_structure", _must_not_run)

        emitted: list[dict] = []
        monkeypatch.setattr(
            flow, "_emit_stage_error_log", lambda **kw: emitted.append(kw)
        )
        warns: list[dict] = []
        monkeypatch.setattr(
            flow, "_emit_workspace_unmapped_warn", lambda **kw: warns.append(kw)
        )

        ws = uuid.uuid4()
        manifest = _make_manifest("_held_forms/", ws, route="forms")
        fake_file = _FakeFile(f"_held_forms/{filename}", data=b"not a form")

        out = _drive_ingest(flow, fake_file, manifest=manifest)

        # ZERO rows on EVERY target — the mis-wire is surfaced, not absorbed.
        for key in ("ci", "qa", "sd", "em", "cc", "ft", "ftf"):
            assert out[key].rows == [], (
                f"a {filename} under a route:'forms' prefix is a manifest "
                f"mis-wire — zero {out[key].table_name} rows (spec B.3)"
            )
        # The mis-wire is LOUD: one extraction_validation_failed stage error.
        guard_errors = [
            e
            for e in emitted
            if e.get("error_class") == "extraction_validation_failed"
        ]
        assert guard_errors, (
            "the suffix guard must emit a loud cocoindex.stage_error with "
            "error_class extraction_validation_failed (spec B.3)"
        )
        assert warns == [], "a suffix-guard mis-wire is not a benign soft-warn"
        # And no Path-A work was wasted on the failed file.
        assert calls["convert"] == 0
        assert calls["classification"] == 0


class TestAmbiguousResolutionAtForkIsLoudZeroRows:
    """AmbiguousResolution now fails the file AT THE FORK: loud stage error and
    ZERO rows on every target (pre-fork, content rows landed before the form
    block surfaced the error — the fork moves the failure ahead of BOTH
    branches per the {80.8} brief)."""

    def test_ambiguous_manifest_zero_rows_all_targets(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        flow = _flow_module()
        calls = _observe_path_a_seams(flow, monkeypatch)

        from scripts.cocoindex_pipeline.workspace_resolver import (
            WorkspaceManifest,
            WorkspaceMapping,
        )

        # Two equal-length prefixes that BOTH match → ambiguous tie.
        # `model_construct` bypasses the duplicate-prefix load validator to
        # exercise the resolver's defensive tie-detection branch.
        manifest = WorkspaceManifest.model_construct(
            schema_version=1,
            mappings=[
                WorkspaceMapping.model_construct(
                    path_prefix="acme/", workspace_id=uuid.uuid4()
                ),
                WorkspaceMapping.model_construct(
                    path_prefix="acme/", workspace_id=uuid.uuid4()
                ),
            ],
        )
        fake_file = _FakeFile("acme/doc.md", data=b"# H\n\nbody")

        emitted: list[dict] = []
        monkeypatch.setattr(
            flow, "_emit_stage_error_log", lambda **kw: emitted.append(kw)
        )

        out = _drive_ingest(flow, fake_file, manifest=manifest)

        for key in ("ci", "qa", "sd", "em", "cc", "ft", "ftf"):
            assert out[key].rows == [], (
                f"an ambiguous resolution must produce ZERO "
                f"{out[key].table_name} rows — the fork fails the file before "
                "either branch runs"
            )
        ws_errors = [e for e in emitted if e.get("stage") == "workspace_resolution"]
        assert ws_errors, "ambiguous resolution stays a loud stage error"
        assert ws_errors[0]["error_class"] == "extraction_validation_failed"
        # Neither branch did any work.
        assert calls["convert"] == 0


class TestIdempotencyAcrossBothBranches:
    """80.2 §Testing row 7 (ID-80.10): re-ingesting the SAME bytes twice down
    EACH branch of the {80.8} fork mints IDENTICAL deterministic uuid5 PKs —
    so ``declare_row`` UPSERTs the same rows on the second run instead of
    inserting duplicates. The op_id ROW FIELD differs per run (it identifies
    the RUN; ratified OQ-A re-stamps the same row's op_id).

    The pre-fork idempotency guards
    (``TestStablePrimaryKeysAcrossRuns`` — content, no manifest;
    ``TestFormWriteIdempotency`` — forms, faked extractor) predate the fork:
    neither re-ingests through an ACTIVE manifest ``route`` resolution on the
    content side, and the forms side never ran the REAL extractor twice. These
    two tests close that gap through the real fork body."""

    def test_content_branch_reingest_same_bytes_mints_identical_pks(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """route:'content' mapped .md ingested twice → identical sd/ci/qa/cc
        uuid5 PKs across runs (UPSERT, not duplicates) + per-run op_id."""
        flow = _flow_module()
        _observe_path_a_seams(flow, monkeypatch)

        # One qa pair so the qa: uuid5 PK is exercised (the shared observer's
        # qa stub returns zero pairs).
        async def _one_pair_qa(content_text: str):
            return {"qa_pairs": [{"question_text": "Q?", "answer_text": "A."}]}

        monkeypatch.setattr(flow, "extract_qa_form", _one_pair_qa)

        ws = uuid.uuid4()
        manifest = _make_manifest("acme/", ws, route="content")
        rel_path = "acme/stable-doc.md"
        same_bytes = b"# Stable\n\nSame bytes every run."

        out_a = _drive_ingest(
            flow, _FakeFile(rel_path, data=same_bytes), manifest=manifest
        )
        out_b = _drive_ingest(
            flow, _FakeFile(rel_path, data=same_bytes), manifest=manifest
        )
        # Two genuinely distinct runs.
        assert out_a["op_id"] != out_b["op_id"]

        # Identical deterministic PKs across runs, matching the uuid5 formulae
        # (so the second run's declare_row UPSERTs the SAME rows).
        ns = flow._KH_PIPELINE_DOC_NS
        for key, seed in (("sd", f"sd:{rel_path}"), ("ci", f"ci:{rel_path}")):
            assert len(out_a[key].rows) == 1 and len(out_b[key].rows) == 1
            id_a = out_a[key].rows[0]["id"]
            id_b = out_b[key].rows[0]["id"]
            assert id_a == id_b == uuid.uuid5(ns, seed), (
                f"{out_a[key].table_name} PK must be the stable uuid5({seed!r}) "
                "across re-ingest (80.2 §Testing row 7 idempotency)"
            )
        assert len(out_a["qa"].rows) == 1 and len(out_b["qa"].rows) == 1
        assert (
            out_a["qa"].rows[0]["id"]
            == out_b["qa"].rows[0]["id"]
            == uuid.uuid5(ns, f"qa:{rel_path}:0")
        )
        # Chunk rows: same count, identical per-position uuid5 PKs.
        chunk_ids_a = [r["id"] for r in out_a["cc"].rows]
        chunk_ids_b = [r["id"] for r in out_b["cc"].rows]
        assert chunk_ids_a and chunk_ids_a == chunk_ids_b
        assert chunk_ids_a == [
            uuid.uuid5(ns, f"chunk:{rel_path}:{pos}")
            for pos in range(len(chunk_ids_a))
        ]
        # No duplicate PKs WITHIN a run either (one declare per logical row).
        assert len(set(chunk_ids_a)) == len(chunk_ids_a)

        # op_id is the per-RUN stamp, re-stamped on the same row (UPSERT
        # semantics — ratified OQ-A), never part of the PK seed.
        assert out_a["sd"].rows[0]["op_id"] == out_a["op_id"]
        assert out_b["sd"].rows[0]["op_id"] == out_b["op_id"]
        # Zero form rows on the content branch, both runs.
        assert out_a["ft"].rows == [] and out_b["ft"].rows == []
        assert out_a["ftf"].rows == [] and out_b["ftf"].rows == []

    def test_form_branch_reingest_same_bytes_mints_identical_pks(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """route:'forms' real .docx ingested twice through the REAL extractor
        → identical ft:/ftf: uuid5 PKs + identical field payloads (UPSERT,
        not duplicates)."""
        assert _CHARNWOOD_DOCX.exists(), (
            f"corpus fixture missing — {_CHARNWOOD_DOCX}"
        )

        flow = _flow_module()
        _observe_path_a_seams(flow, monkeypatch)
        _spy_trim(flow, monkeypatch)
        # extract_form_structure NOT patched — the real docx reader runs on
        # the same committed bytes both times (deterministic extraction).

        ws = uuid.uuid4()
        manifest = _make_manifest("_held_forms/", ws, route="forms")
        rel_path = "_held_forms/charnwood/itt-services.docx"

        out_a = _drive_ingest(
            flow, _FakeFile(rel_path, disk_path=_CHARNWOOD_DOCX), manifest=manifest
        )
        out_b = _drive_ingest(
            flow, _FakeFile(rel_path, disk_path=_CHARNWOOD_DOCX), manifest=manifest
        )
        assert out_a["op_id"] != out_b["op_id"]

        ns = flow._KH_PIPELINE_DOC_NS
        # form_templates: ONE row per run, the SAME deterministic ft: PK.
        assert len(out_a["ft"].rows) == 1 and len(out_b["ft"].rows) == 1
        assert (
            out_a["ft"].rows[0]["id"]
            == out_b["ft"].rows[0]["id"]
            == uuid.uuid5(ns, f"ft:{rel_path}")
        ), "form_templates PK must be stable across re-ingest (row 7)"

        # form_template_fields: identical ordered uuid5 PK lists — the second
        # run UPSERTs every field row rather than duplicating it.
        ftf_ids_a = [r["id"] for r in out_a["ftf"].rows]
        ftf_ids_b = [r["id"] for r in out_b["ftf"].rows]
        assert ftf_ids_a, "the real docx reader must extract at least one field"
        assert ftf_ids_a == ftf_ids_b
        assert ftf_ids_a == [
            uuid.uuid5(ns, f"ftf:{rel_path}:{r['sequence']}")
            for r in out_a["ftf"].rows
        ]
        assert len(set(ftf_ids_a)) == len(ftf_ids_a), (
            "no duplicate field PKs within a run"
        )
        # The real extractor is deterministic on identical bytes: the full
        # field payloads (not just the PKs) match run-for-run.
        assert out_a["ftf"].rows == out_b["ftf"].rows


class TestRouteLessManifestBackwardCompat:
    """80.2 §Testing row 8 (ID-80.10): a manifest WITHOUT any ``route`` key —
    the EXACT id-52-era fixture shape (schema_version 1; mappings carrying
    ONLY path_prefix + workspace_id) — parses unchanged through the REAL
    ``load_workspace_manifest`` and every mapped file resolves
    ``route="content"`` at the fork, taking the content branch end-to-end.
    The resolver-level default is {80.6}'s
    ``test_manifest_without_route_resolves_route_content``; this test proves
    it THROUGH the real ``ingest_file`` fork body (flow level)."""

    def test_route_less_manifest_parses_and_drives_content_branch(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from scripts.cocoindex_pipeline.workspace_resolver import (
            load_workspace_manifest,
            resolve_route,
        )

        # The id-52 manifest shape, verbatim — NO route key anywhere.
        manifest_path = tmp_path / ".kh-workspace-map.json"
        manifest_path.write_text(
            json.dumps(
                {
                    "schema_version": 1,
                    "mappings": [
                        {
                            "path_prefix": "example-procurement/",
                            "workspace_id": (
                                "11111111-1111-4111-8111-111111111111"
                            ),
                        },
                        {
                            "path_prefix": "acme-bids/",
                            "workspace_id": (
                                "22222222-2222-4222-8222-222222222222"
                            ),
                        },
                    ],
                }
            )
        )
        # REAL parse — the pre-{80.6} fixture loads unchanged (no migration,
        # schema_version stays 1).
        manifest = load_workspace_manifest(manifest_path)
        assert manifest.schema_version == 1
        # Every prefix resolves the content default at the fork's resolver.
        for rel in ("example-procurement/SQ.pdf", "acme-bids/notes.md"):
            assert resolve_route(manifest, rel).route == "content"

        flow = _flow_module()
        calls = _observe_path_a_seams(flow, monkeypatch)

        async def _must_not_run(file: object):
            raise AssertionError(
                "extract_form_structure must NEVER run under a route-less "
                "manifest — every prefix defaults route='content' (row 8)"
            )

        monkeypatch.setattr(flow, "extract_form_structure", _must_not_run)

        fake_file = _FakeFile("acme-bids/notes.md", data=b"# H\n\nbody")
        out = _drive_ingest(flow, fake_file, manifest=manifest)

        # The content branch ran end-to-end: content rows landed, zero form
        # rows, and the Stage-2 conversion + LLM passes executed.
        assert len(out["ci"].rows) == 1
        assert len(out["sd"].rows) == 1
        assert out["ft"].rows == []
        assert out["ftf"].rows == []
        assert calls["convert"] == 1
        assert calls["classification"] == 1
