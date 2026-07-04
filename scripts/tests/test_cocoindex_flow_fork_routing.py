"""ID-80.8 — fork routing: one file routes down exactly ONE branch (80.2 §B.1/§B.3).

RATIFIED OQ-80.2-A (Liam, S314, 05/06/2026): forms land ZERO content rows — no
content_items / source_documents / content_chunks / q_a_extractions /
entity_mentions. The minimal-provenance-row fallback is DROPPED. RATIFIED
OQ-80.2-B: the manifest per-prefix ``route`` tag is THE fork point, computed
once in ``_ingest_file_body`` immediately after ``rel_path``, BEFORE either
write path runs.

ID-136 (forms-route retirement, DR-014): ``RouteKind`` narrowed to
``Literal["content", "qa_sidecar"]`` — a manifest tagging a prefix
``route:"forms"`` now fails LOUDLY at load (``ManifestLoadError``), so the
forms branch and its ``extract_form_structure`` seam are gone from this
module entirely. The forms-specific branch coverage this file used to carry
(``route:"forms"`` .docx → ft/ftf-only; the suffix-guard mis-wire) retired
alongside it — see git history / ID-136 TECH.md §4.3 for the
pre-retirement contract. What survives here is the content / qa_sidecar /
unmapped / ambiguous coverage below.

Branch contract under test:
  - unmapped .md (manifest active, no prefix match) → bl-219 soft-warn + the
    CONTENT branch (content rows only).
  - mapped ``route:"content"`` .md → content rows only.
  - mapped ``route:"qa_sidecar"`` file → sidecar rows only (zero content
    rows).
  - AmbiguousResolution at the fork → loud stage error + ZERO rows on EVERY
    target (the fork fails the file before any branch runs).

Async tests follow the repo convention (no pytest-asyncio plugin): drive
coroutines via ``asyncio.run`` inside sync test functions.

Reference: docs/specs/ID-80-forms-path-b/80.2-forms-content-separation.md
§B.1/§B.3/§B.6; docs/reference/test-philosophy.md §1/§5.3; ID-136 TECH.md §4.3.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import uuid
from pathlib import Path

import pytest

from conftest import fresh_flow_module  # noqa: E402

# ID-101 §{101.7}: neutralise the relationship-extraction Path-A seam so
# ingest_file tests make no live Anthropic call (mirrors the
# extract_entity_mentions stubs alongside).
async def _fake_relationships_empty(content_text: str) -> list:
    return []


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
    with RECORDING observers returning benign values, so a test can assert
    exactly which passes ran (e.g. zero calls on the qa_sidecar route, which
    never runs classification/embedding)."""
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
    monkeypatch.setattr(flow, "extract_relationships", _fake_relationships_empty)
    monkeypatch.setattr(flow, "embed_content_text", _fake_embed)
    return calls


class _SdPool:
    """Minimal raw-pool double capturing every ``execute`` call.

    S438 (id-131 follow-on): the content branch writes the sd PARENT via the
    raw-pool `_upsert_source_document` autocommit UPSERT (S437's fix extended
    to localfs), resolved via `coco.use_context(DB_CTX)`.
    """

    def __init__(self) -> None:
        self.executed: list[tuple[str, tuple]] = []

    def acquire(self) -> object:
        pool = self

        class _Conn:
            async def fetchrow(self, sql: str, *args: object) -> dict:
                # ID-138 {138.10}: the M2 identity resolver — both the content and
                # qa_sidecar branches now resolve the source_document_id off the
                # raw pool BEFORE writing. Mirror the resolver's MINT formula so a
                # re-walk of the SAME path returns the SAME id.
                return {
                    "source_document_id": uuid.uuid5(
                        uuid.UUID("fbfaf1ff-1ee4-583c-9757-1674465b2ec1"),
                        f"sd:{args[1]}",
                    ),
                    "was_minted": True,
                }

            async def execute(self, sql: str, *args: object) -> str:
                pool.executed.append((sql, args))
                return "INSERT 0 1"

        class _Acquire:
            async def __aenter__(self) -> "_Conn":
                return _Conn()

            async def __aexit__(self, *exc: object) -> None:
                return None

        return _Acquire()


class _SdTarget:
    """Duck-types ``_FakeTarget`` (``.table_name`` / ``.rows``) for the
    ``source_documents`` slot, but sources ``.rows`` from WHICHEVER write path
    actually fired:

      - the qa_sidecar branch (``_ingest_qa_sidecar_branch``) still calls
        ``sd_target.declare_row`` directly — captured in ``self._declared``;
      - the content branch (``_ingest_content_branch``) now writes the sd
        PARENT via the S438 raw-pool ``_upsert_source_document`` UPSERT —
        reconstructed from the ``_SdPool`` capture.

    A single ``ingest_file`` call only ever exercises ONE branch, so ``.rows``
    can safely prefer the declared rows and fall back to the pool capture —
    every existing ``out["sd"].rows`` assertion in this file keeps working
    unchanged regardless of which branch a given test drives.
    """

    table_name = "source_documents"

    def __init__(self, pool: _SdPool) -> None:
        self._pool = pool
        self._declared: list[dict] = []

    def declare_row(self, *, row: dict) -> None:
        self._declared.append(row)

    @property
    def rows(self) -> list[dict]:
        if self._declared:
            return self._declared
        rows: list[dict] = []
        for sql, args in self._pool.executed:
            if "INSERT INTO public.source_documents" not in sql:
                continue
            cols = [c.strip() for c in sql.split("(", 1)[1].split(")", 1)[0].split(",")]
            rows.append(dict(zip(cols, args)))
        return rows


def _drive_ingest(flow: object, fake_file: object, *, manifest: object) -> dict:
    """Drive one real ``ingest_file`` under bind_flow_meta +
    bind_workspace_manifest, with the five targets recording (including
    content_chunks — the fork's zero-content proof covers cc too).

    ID-136 (forms-route retirement, T8): ``ft_target``/``ftf_target`` were
    dropped from ``ingest_file``'s positional signature — ``cc_target`` is
    now the 6th positional (``er_target``/``re_target`` stay defaulted None,
    the documented "5-/6-arg legacy caller" shape)."""
    from scripts.cocoindex_pipeline.flow_context import (
        bind_flow_meta,
        bind_workspace_manifest,
    )

    # S438: `coco.use_context(DB_CTX)` now also backs the content branch's
    # raw-pool sd write — `flow.coco` is a FRESH MagicMock per `_flow_module()`
    # call, so direct assignment (no monkeypatch) is safe and self-contained.
    pool = _SdPool()
    flow.coco.use_context = lambda key: pool  # type: ignore[attr-defined]

    targets = {
        "ci": _FakeTarget("content_items"),
        "qa": _FakeTarget("q_a_extractions"),
        "sd": _SdTarget(pool),
        "em": _FakeTarget("entity_mentions"),
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
                    targets["cc"],
                )

    asyncio.run(_exercise())
    targets["op_id"] = run_op_id  # type: ignore[assignment]
    return targets


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

        emitted: list[dict] = []
        monkeypatch.setattr(
            flow, "_emit_stage_error_log", lambda **kw: emitted.append(kw)
        )
        warns: list[dict] = []
        monkeypatch.setattr(
            flow, "_emit_workspace_unmapped_warn", lambda **kw: warns.append(kw)
        )

        ws = uuid.uuid4()
        # The manifest maps a DIFFERENT prefix (tagged qa_sidecar — an
        # arbitrary non-content route to prove the staged file's unmapped
        # status, not that OTHER prefix's route, drives the outcome) — the
        # staged file is unmapped.
        manifest = _make_manifest("other-client/", ws, route="qa_sidecar")
        fake_file = _FakeFile("unmapped/doc.md", data=b"# H\n\nbody")

        out = _drive_ingest(flow, fake_file, manifest=manifest)

        # Content rows landed (bl-219: unmapped is benign for file content).
        assert len(out["ci"].rows) == 1
        assert len(out["sd"].rows) == 1
        # Exactly one benign soft-warn; NO workspace_resolution stage error.
        assert len(warns) == 1
        assert [e for e in emitted if e.get("stage") == "workspace_resolution"] == []

    def test_mapped_content_md_lands_content_rows_only(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A mapped ``route:"content"`` prefix (the backward-compatible default)
        routes the content branch ONLY, landing content rows (ID-136: the
        forms branch this test used to also guard against no longer exists)."""
        flow = _flow_module()
        calls = _observe_path_a_seams(flow, monkeypatch)

        ws = uuid.uuid4()
        manifest = _make_manifest("acme/", ws)  # route defaults to "content"
        fake_file = _FakeFile("acme/notes.md", data=b"# H\n\nbody")

        out = _drive_ingest(flow, fake_file, manifest=manifest)

        assert len(out["ci"].rows) == 1
        assert len(out["sd"].rows) == 1
        # The content branch performed its Stage-2 conversion + LLM passes.
        assert calls["convert"] == 1
        assert calls["classification"] == 1


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

        for key in ("ci", "qa", "sd", "em", "cc"):
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
    the content branch of the {80.8} fork mints IDENTICAL deterministic
    uuid5 PKs — so ``declare_row`` UPSERTs the same rows on the second run
    instead of inserting duplicates. The op_id ROW FIELD differs per run (it
    identifies the RUN; ratified OQ-A re-stamps the same row's op_id).

    The pre-fork idempotency guard (``TestStablePrimaryKeysAcrossRuns`` —
    content, no manifest) predates the fork: it does not re-ingest through
    an ACTIVE manifest ``route`` resolution. This test closes that gap
    through the real fork body. ID-136 (forms-route retirement): this
    class's sibling forms-branch idempotency case
    (``test_form_branch_reingest_same_bytes_mints_identical_pks``) is
    retired — the forms branch no longer exists, so there is no second
    branch left to exercise here; ``TestQaSidecarRouteWritesSidecarTargetsOnly``
    covers the qa_sidecar route's own PK stability."""

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

        # Identical deterministic PKs across runs. Hard-coded uuid5 oracles over
        # _KH_PIPELINE_DOC_NS ("fbfaf1ff-1ee4-583c-9757-1674465b2ec1") for the
        # pinned rel_path "acme/stable-doc.md" — frozen literals (not re-derived
        # from flow) so a namespace/seed drift fails loudly while the cross-run
        # idempotency (id_a == id_b) is still proven.
        # ID-138 {138.10} P3: sd keeps the sd:{rel} mint formula; ci/qa/chunk
        # re-key onto the STORED source_document_id (`ci:{sd_id}` etc.), NOT
        # rel_path — recomputed literals below (sd_id = f63d0349…).
        expected_pk = {
            "sd": uuid.UUID("f63d0349-1b7a-5d56-869d-e1c403155c2e"),  # sd:{rel}
            "ci": uuid.UUID("1ff6a413-dede-5f4b-a00e-9889745b7e88"),  # ci:{sd_id}
        }
        for key in ("sd", "ci"):
            assert len(out_a[key].rows) == 1 and len(out_b[key].rows) == 1
            id_a = out_a[key].rows[0]["id"]
            id_b = out_b[key].rows[0]["id"]
            assert id_a == id_b == expected_pk[key], (
                f"{out_a[key].table_name} PK must be the stable uuid5 "
                "across re-ingest (80.2 §Testing row 7 idempotency)"
            )
        assert len(out_a["qa"].rows) == 1 and len(out_b["qa"].rows) == 1
        assert (
            out_a["qa"].rows[0]["id"]
            == out_b["qa"].rows[0]["id"]
            == uuid.UUID("0503b1c3-8ea0-57b5-a949-09b13a821208")  # qa:{sd_id}:0
        )
        # Chunk rows: same count, identical per-position uuid5 PKs. The short
        # `same_bytes` body chunks to exactly one row; its PK is pinned to a
        # frozen chunk:{sd_id}:0 literal ({138.10} P3 re-key; oracle, not a
        # recompute).
        chunk_ids_a = [r["id"] for r in out_a["cc"].rows]
        chunk_ids_b = [r["id"] for r in out_b["cc"].rows]
        assert chunk_ids_a and chunk_ids_a == chunk_ids_b
        assert chunk_ids_a == [
            uuid.UUID("f120636a-d0ff-57d4-9411-a1de1166a707")  # chunk:{sd_id}:0
        ]
        # No duplicate PKs WITHIN a run either (one declare per logical row).
        assert len(set(chunk_ids_a)) == len(chunk_ids_a)

        # op_id is the per-RUN stamp, re-stamped on the same row (UPSERT
        # semantics — ratified OQ-A), never part of the PK seed.
        assert out_a["sd"].rows[0]["op_id"] == out_a["op_id"]
        assert out_b["sd"].rows[0]["op_id"] == out_b["op_id"]


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

        fake_file = _FakeFile("acme-bids/notes.md", data=b"# H\n\nbody")
        out = _drive_ingest(flow, fake_file, manifest=manifest)

        # The content branch ran end-to-end: content rows landed, and the
        # Stage-2 conversion + LLM passes executed (row 8).
        assert len(out["ci"].rows) == 1
        assert len(out["sd"].rows) == 1
        assert calls["convert"] == 1
        assert calls["classification"] == 1


class TestQaSidecarRouteWritesSidecarTargetsOnly:
    """ID-59 {59.26} (TECH-qa-sidecar P1): a `__qa__/` file on the
    ``route:"qa_sidecar"`` prefix mints ONE source_documents row (the INV-8
    linkage anchor) + N q_a_extractions rows (``source_document_id IS
    NULL``) — and ZERO content_items / content_chunks / entity_mentions
    (PRODUCT INV-5). A sibling ``content``-route file on the SAME walk still
    mints content_items (the branches are mutually exclusive)."""

    def test_qa_sidecar_mints_sd_and_qa_only_zero_content_rows(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        flow = _flow_module()
        calls = _observe_path_a_seams(flow, monkeypatch)

        # Two Q&A pairs so the qa: uuid5 PK + the source_document_id=None
        # INV-5 marker are exercised on more than one row.
        async def _two_pair_qa(content_text: str):
            return {
                "qa_pairs": [
                    {"question_text": "Q1?", "answer_text": "A1."},
                    {"question_text": "Q2?", "answer_text": "A2."},
                ]
            }

        monkeypatch.setattr(flow, "extract_qa_form", _two_pair_qa)

        ws = uuid.uuid4()
        manifest = _make_manifest("__qa__/", ws, route="qa_sidecar")
        rel_path = "__qa__/foo.md"
        fake_file = _FakeFile(rel_path, data=b"# Q&A\n\nbody")

        out = _drive_ingest(flow, fake_file, manifest=manifest)

        # ── INV-8: exactly ONE source_documents row, the `sd:`-seeded anchor. ─
        assert len(out["sd"].rows) == 1, "qa_sidecar mints ONE source_documents row"
        sd_row = out["sd"].rows[0]
        # Hard-coded uuid5 oracles over _KH_PIPELINE_DOC_NS
        # ("fbfaf1ff-1ee4-583c-9757-1674465b2ec1") for the pinned rel_path
        # "__qa__/foo.md" — frozen literals (not re-derived from flow) so a
        # namespace/seed drift fails loudly instead of being masked.
        assert sd_row["id"] == uuid.UUID(
            "42c08615-f8d1-5acd-9da7-a046e414837e"  # sd:{rel}
        ), "source_documents PK is the stable sd:-seeded uuid5 (INV-8/INV-20)"
        assert sd_row["storage_path"] == rel_path
        assert sd_row["mime_type"] == "text/markdown"

        # ── INV-5: ZERO content_items / content_chunks / entity_mentions. ─────
        assert out["ci"].rows == [], "qa_sidecar mints ZERO content_items (INV-5)"
        assert out["cc"].rows == [], "qa_sidecar mints ZERO content_chunks (INV-5)"
        assert out["em"].rows == [], "qa_sidecar mints ZERO entity_mentions (INV-5)"

        # ── N q_a_extractions, each with source_document_id IS NULL. ──────
        assert len(out["qa"].rows) == 2, "one q_a_extractions row per Q&A pair"
        # ID-138 {138.10} P3: the sidecar qa PK re-keys onto the STORED
        # source_document_id (`qa:{sd_id}:{idx}`), NOT `qa:{rel}:{idx}` — a rename
        # no longer re-mints the derived row. Frozen literals recomputed on the
        # new formula (sd_id = 42c08615… above).
        expected_qa_ids = [
            uuid.UUID("2cfcd692-a092-5dad-8091-510677d47974"),  # qa:{sd_id}:0
            uuid.UUID("26542bf7-e00b-5c41-8648-266dc8775c39"),  # qa:{sd_id}:1
        ]
        for idx, qa_row in enumerate(out["qa"].rows):
            assert qa_row["source_document_id"] is None, (
                "a sidecar mints NO content_item — source_document_id must "
                "be NULL (the INV-5 structural marker)"
            )
            assert qa_row["id"] == expected_qa_ids[idx], (
                "q_a_extractions PK is the stable qa:-seeded uuid5 (idempotent)"
            )

        # ── Two-tier extraction shape preserved (INV-6 / COCO.10): the outer
        # tier is convert_binary_to_markdown(file); the inner tier routes
        # through the memoised extract_qa_form extractor — NOT a direct
        # Anthropic call. The other Path-A LLM passes never run for a sidecar. ─
        assert calls["convert"] == 1, (
            "outer file-tier memo boundary is convert_binary_to_markdown (INV-6)"
        )
        assert calls["classification"] == 0, "no classification pass for a sidecar"
        assert calls["entities"] == 0, "no entity-mention pass for a sidecar"
        assert calls["embed"] == 0, "no content embedding for a sidecar (INV-5)"

    def test_walk_with_qa_sidecar_and_content_sibling_routes_each_branch(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A walk over `__qa__/foo.md` + `bar.md`: `bar.md` mints content_items
        (existing content path), `__qa__/foo.md` mints ZERO content_items but
        ONE source_documents + N q_a_extractions. Proves the third branch does
        not regress the content branch on the same manifest."""
        flow = _flow_module()

        async def _one_pair_qa(content_text: str):
            return {"qa_pairs": [{"question_text": "Q?", "answer_text": "A."}]}

        # Build a manifest mapping BOTH a content prefix and the qa_sidecar
        # prefix — the two files on the same walk fork to different branches.
        from scripts.cocoindex_pipeline.workspace_resolver import (
            WorkspaceManifest,
            WorkspaceMapping,
        )

        content_ws = uuid.uuid4()
        qa_ws = uuid.uuid4()
        manifest = WorkspaceManifest(
            schema_version=1,
            mappings=[
                WorkspaceMapping(
                    path_prefix="docs/", workspace_id=content_ws, route="content"
                ),
                WorkspaceMapping(
                    path_prefix="__qa__/", workspace_id=qa_ws, route="qa_sidecar"
                ),
            ],
        )

        # ── Content sibling: docs/bar.md → content branch mints content_items. ─
        calls_content = _observe_path_a_seams(flow, monkeypatch)
        monkeypatch.setattr(flow, "extract_qa_form", _one_pair_qa)
        out_content = _drive_ingest(
            flow, _FakeFile("docs/bar.md", data=b"# Bar\n\nbody"), manifest=manifest
        )
        assert len(out_content["ci"].rows) == 1, "docs/bar.md mints content_items"
        assert len(out_content["sd"].rows) == 1
        assert calls_content["classification"] == 1, "content branch ran for bar.md"

        # ── Sidecar: __qa__/foo.md → ZERO content_items, ONE sd + N qa. ───────
        calls_qa = _observe_path_a_seams(flow, monkeypatch)
        monkeypatch.setattr(flow, "extract_qa_form", _one_pair_qa)
        out_qa = _drive_ingest(
            flow, _FakeFile("__qa__/foo.md", data=b"# QA\n\nbody"), manifest=manifest
        )
        assert out_qa["ci"].rows == [], "__qa__/foo.md mints ZERO content_items"
        assert out_qa["cc"].rows == []
        assert out_qa["em"].rows == []
        assert len(out_qa["sd"].rows) == 1, "__qa__/foo.md mints ONE source_documents"
        assert len(out_qa["qa"].rows) == 1
        assert out_qa["qa"].rows[0]["source_document_id"] is None
        assert calls_qa["classification"] == 0, "no content classification for sidecar"

    def test_qa_sidecar_route_typo_rejected_at_manifest_load(
        self, tmp_path: Path
    ) -> None:
        """A `RouteKind` typo (`"qa_sidcar"`) on a `__qa__/` mapping is a
        load-time `ManifestLoadError` (Literal + extra="forbid") — never a
        silent default to content."""
        from scripts.cocoindex_pipeline.workspace_resolver import (
            ManifestLoadError,
            load_workspace_manifest,
        )

        manifest_path = tmp_path / ".kh-workspace-map.json"
        manifest_path.write_text(
            json.dumps(
                {
                    "schema_version": 1,
                    "mappings": [
                        {
                            "path_prefix": "__qa__/",
                            "workspace_id": "11111111-1111-4111-8111-111111111111",
                            "route": "qa_sidcar",  # typo
                        }
                    ],
                }
            )
        )
        with pytest.raises(ManifestLoadError):
            load_workspace_manifest(manifest_path)

    def test_qa_sidecar_missing_mapping_warns_then_content_branch(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Defensive belt (P1.5 / S297 BUG-B): a `__qa__/`-prefixed path that
        resolves to ``content`` (operator forgot the qa_sidecar mapping) is a
        junk-content hazard. The fork WARNS loudly and routes the content
        branch (the manifest stays the source of truth — no silent reroute)."""
        flow = _flow_module()
        calls = _observe_path_a_seams(flow, monkeypatch)

        warnings: list[str] = []
        monkeypatch.setattr(flow._logger, "warning", lambda msg: warnings.append(msg))

        ws = uuid.uuid4()
        # Maps `__qa__/` to CONTENT (the mis-wire) — the operator forgot
        # route:"qa_sidecar".
        manifest = _make_manifest("__qa__/", ws, route="content")
        out = _drive_ingest(
            flow, _FakeFile("__qa__/foo.md", data=b"# QA\n\nbody"), manifest=manifest
        )

        # It fell through to the content branch (junk-content hazard realised),
        # but LOUDLY: a qa_sidecar_route_missing warning was emitted.
        assert len(out["ci"].rows) == 1, "the mis-wired sidecar lands as content"
        belt = [w for w in warnings if "qa_sidecar_route_missing" in w]
        assert belt, (
            "a __qa__/ path resolving to content must emit a loud "
            "qa_sidecar_route_missing warning (S297 BUG-B defensive belt)"
        )
