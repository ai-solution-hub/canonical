"""ID-127.10 — BI-7 deployed-entrypoint contract: the Platform ingestion
``app_main`` manifest gate + fork routing that the {127.4} Platform corpus
depends on.

WHY THIS FILE EXISTS
────────────────────
ID-127 (Platform ingestion pipeline standup) authors NO pipeline logic — the
cocoindex flow already exists and is exercised at the ``ingest_file`` level by
the {80.8} fork-routing suite, the {80.4} form-write real-body suite, and the
{59.32} sidecar round-trip suite. What ID-127 NEEDS is a behaviour contract on
the DEPLOYED entrypoint (``app_main`` / ``resolve_route`` /
``load_workspace_manifest``), so that the Platform corpus the operator stages
under ``COCOINDEX_SOURCE_PATH`` ingests with the BI-7 semantics the standup
relies on — and so a regression in the manifest gate fails THIS suite loudly
rather than silently mis-ingesting the live Platform corpus.

This is a TEST OF UNCHANGED BEHAVIOUR (test-philosophy §1 — behaviour, not
implementation). It drives the REAL ``flow.app_main`` over a temp dir (the
deployed entrypoint), reproducing cocoindex 1.0.3's DAEMON-THREAD dispatch
boundary via ``_thread_dispatch_mount_each`` (mirrors
``test_cocoindex_flow_live_ingest.py``), with only the outside-world seams
(Docling / Anthropic / OpenAI / Postgres / the URL ledger) stubbed. The
manifests are built IN-TEST (``_write_manifest``) so this suite does NOT depend
on the {127.4} Platform corpus existing on disk.

THE BI-7 CONTRACT CODIFIED HERE (TECH.md §BI-7 + Testing table)
───────────────────────────────────────────────────────────────
  (a) A content-only corpus WITH a root ``.kh-workspace-map.json`` ingests with
      NO ``manifest_missing`` abort — ``app_main`` loads the manifest
      UNCONDITIONALLY at flow start (flow.py app_main manifest block).
  (b) A content file under a NON-forms prefix routes to ``'content'`` and lands
      WORKSPACE-AGNOSTIC: ``content_items`` carries NO ``workspace_id`` (BI-7 —
      "workspace_ids NEVER written"; ID-69 BI-1).
  (c) A forms file under ``forms/procurement/`` routes to ``'forms'`` and
      CONSUMES the resolved ``workspace_id`` → it lands on
      ``form_templates.workspace_id`` ("Only this Path-B form-write consumes a
      workspace_id").
  (d) Re-running the SAME corpus mints IDENTICAL ``uuid5(rel_path)`` row
      identities (no duplication — deterministic PKs UPSERT).
  (e) CRITICAL REGRESSION GUARD: a corpus with NO root manifest ABORTS
      ``app_main`` with a ``manifest_missing`` stage error + a
      ``status="failed"`` terminal webhook — regression-guarding the {127.4}
      mandatory-manifest operator obligation (the form path must not run
      without a workspace map).

Async tests follow the repo convention (no pytest-asyncio plugin): drive
coroutines via ``asyncio.run`` inside sync test functions.

Reference: TECH.md §BI-7 + Testing table (ID-127); docs/reference/
test-philosophy.md §1 (behaviour-not-implementation), §5.3 (mock the boundary).
Pattern siblings: scripts/tests/test_cocoindex_flow_live_ingest.py (the
``_thread_dispatch_mount_each`` daemon-thread harness this file adapts);
scripts/tests/test_cocoindex_flow_fork_routing.py (``_drive_ingest`` /
``_make_manifest``); scripts/tests/test_cocoindex_form_write_real_body.py
(real-body form extraction); scripts/tests/test_qa_sidecar_roundtrip.py.
"""

from __future__ import annotations

import asyncio
import json
import uuid
from pathlib import Path

import pytest

from cocoindex import ComponentSubpath, component_subpath

from conftest import fresh_flow_module  # noqa: E402

# The committed, deterministic real form fixture: a genuine blank-instrument
# DOCX the REAL docx reader extracts fields from (the same corpus fixture the
# {80.8} fork-routing suite and the form-extractor real-body suite walk). Used
# UNPATCHED so assertion (c) proves the real forms route consumes a workspace_id.
_FIXTURE_DIR = Path(__file__).parent / "fixtures" / "form-extraction"
_CHARNWOOD_DOCX = _FIXTURE_DIR / "itt-services-charnwood.docx"


def _flow_module():
    """Load a fresh stubbed ``cocoindex_pipeline.flow`` (ID-55.1 primitive)."""
    return fresh_flow_module()


# ── Fakes (mirror the live-ingest harness) ─────────────────────────────────────


class _FakeTarget:
    """Records ``declare_row`` calls without touching any DB.

    ``declare_row`` is invoked from the worker thread (the engine runs the
    component there), so the append must be thread-safe enough for this
    single-writer harness — CPython ``list.append`` is atomic under the GIL,
    which is all a one-worker-thread dispatch needs."""

    def __init__(self, table_name: str) -> None:
        self.table_name = table_name
        self.rows: list[dict] = []

    def declare_row(self, *, row: dict) -> None:
        self.rows.append(row)

    def declare_vector_index(self, **kwargs: object) -> None:  # pragma: no cover
        pass


class _FakeFile:
    """``localfs.File`` stand-in with a RELATIVE ``file_path.path`` (the
    production shape: localfs paths are relative to ``COCOINDEX_SOURCE_PATH`` so
    the manifest path-prefix match works). Reads bytes from a real on-disk
    file."""

    class _FilePath:
        def __init__(self, rel_path: Path) -> None:
            self.path = rel_path

    def __init__(self, rel_path: str, disk_path: Path) -> None:
        self.file_path = _FakeFile._FilePath(Path(rel_path))
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


class _KeyedItemsFeed:
    """Async iterable of ``(relative_path: str, File)`` pairs — mirrors
    ``localfs.walk_dir(...).items()`` (yields ``(rel_posix, File)``)."""

    def __init__(self, pairs: list[tuple[str, object]]) -> None:
        self._pairs = pairs

    async def __aiter__(self):  # type: ignore[no-untyped-def]
        for pair in self._pairs:
            yield pair


async def _fake_relationships_empty(content_text: str) -> list:
    return []


async def _thread_dispatch_mount_each(*pos_args):
    """Faithful stand-in for ``coco.mount_each`` (1.0.3) reproducing the
    engine's DAEMON-THREAD dispatch boundary.

    The installed engine runs each per-item ``fn(value, *extra_args)`` on its
    own ``_LoopRunner`` daemon thread (a SEPARATE event loop), NOT inline on the
    binder's asyncio task. ``contextvars`` are per-(thread, task), so a
    ``ContextVar`` set on the binder task is NOT visible inside ``fn``. Running
    ``fn`` via ``asyncio.run`` on a fresh worker thread reproduces exactly that
    isolation — so this harness exercises the production thread-boundary the
    inline harnesses hide.

    Mirrors ``test_cocoindex_flow_live_ingest.py``: enforces the engine's
    positional-arg + subpath-derivation contract (an optional
    ``ComponentSubpath`` may lead; the callable must carry ``__qualname__``)."""
    args = list(pos_args)
    if args and isinstance(args[0], ComponentSubpath):
        args.pop(0)
    elif getattr(args[0], "__name__", None) is None:
        raise TypeError(
            "mount_each() requires a ComponentSubpath when the function has no "
            "__name__. Provide an explicit subpath as the first argument."
        )
    fn = args[0]
    items = args[1]
    extra_args = tuple(args[2:])

    if not hasattr(fn, "__qualname__"):
        raise AttributeError(
            f"'{type(fn).__name__}' object has no attribute '__qualname__'"
        )

    errors: list[BaseException] = []
    loop = asyncio.get_running_loop()

    def _run_on_worker_thread(item) -> None:
        # Fresh event loop on a fresh OS thread → the binder task's ContextVar
        # snapshot is NOT inherited (the production _LoopRunner reality).
        try:
            asyncio.run(fn(item, *extra_args))
        except BaseException as exc:  # noqa: BLE001 — surfaced on the binder
            errors.append(exc)

    async for key, value in items:
        assert isinstance(key, str), "mount_each keys are relative-path strings"
        await loop.run_in_executor(None, _run_on_worker_thread, value)

    if errors:
        raise errors[0]

    class _Handle:
        async def ready(self) -> None:
            return None

    return _Handle()


def _write_manifest(
    source_dir: Path, mappings: list[dict[str, object]]
) -> None:
    """Write a real ``.kh-workspace-map.json`` at the source root with the
    given ``mappings`` (each ``{path_prefix, workspace_id[, route]}``). Built
    in-test so this suite never depends on the {127.4} corpus existing."""
    (source_dir / ".kh-workspace-map.json").write_text(
        json.dumps({"schema_version": 1, "mappings": mappings})
    )


def _sd_rows_from_pool(pool: object) -> list[dict]:
    """Reconstruct source_documents rows from the S438 raw-pool UPSERT capture.

    S437/S438 (id-131): the sd PARENT no longer flows through the engine
    `sd_target`; it is written by `_upsert_source_document` as a raw-pool
    autocommit `INSERT ... ON CONFLICT (id)` on the run's `_EmptyLedgerPool`
    (`pool.executed`, stashed at `targets["_sd_pool"]`). Each captured
    `source_documents` INSERT's positional args are mapped back onto its
    column names so callers read the landed row as they did off
    `targets["source_documents"].rows`.
    """
    rows: list[dict] = []
    for sql, args in pool.executed:  # type: ignore[attr-defined]
        if "INSERT INTO public.source_documents" not in sql:
            continue
        cols = [c.strip() for c in sql.split("(", 1)[1].split(")", 1)[0].split(",")]
        rows.append(dict(zip(cols, args)))
    return rows


def _target_set() -> dict[str, _FakeTarget]:
    """The full mount-target set ``app_main`` requests (all ten tables)."""
    return {
        name: _FakeTarget(name)
        for name in (
            "content_items",
            "q_a_extractions",
            "source_documents",
            "entity_mentions",
            "entity_relationships",
            "form_templates",
            "form_template_fields",
            "content_chunks",
            "reference_items",
            # ID-131 {131.11}: the polymorphic embedding store app_main now mounts.
            "record_embeddings",
        )
    }


def _run_app_main_over_dir(
    flow,
    source_dir: Path,
    targets: dict[str, _FakeTarget],
    monkeypatch: pytest.MonkeyPatch,
    *,
    walked_files: list[tuple[str, Path]],
) -> tuple[uuid.UUID, list[dict]]:
    """Drive the REAL ``flow.app_main`` over ``source_dir`` in live mode, with
    the engine's daemon-thread dispatch reproduced via
    ``_thread_dispatch_mount_each`` and all external services stubbed.

    ``walked_files`` is the explicit ``(rel_path, disk_path)`` feed Stage-1
    yields — so a test stages content ``.md`` and forms ``.docx`` deterministically
    (rather than relying on ``os.iterdir`` ordering). The REAL form extractor and
    the REAL ``resolve_route`` / fork body run UNPATCHED; ONLY the outside-world
    Path-A seams (Docling / Anthropic / OpenAI), the DB mount/pool, the URL
    ledger, and the webhook HTTP emit are faked.

    Returns ``(op_id, webhook_emissions)`` — the run's op_id (captured at flow
    start) and the list of ``_emit_pipeline_run_webhook`` kwargs (so the caller
    can assert the terminal status)."""
    captured_op_id: dict[str, uuid.UUID] = {}
    webhook_emissions: list[dict] = []

    # ── Stub the outside-world Path-A seams (no Docling / Anthropic / OpenAI).
    async def _fake_convert(file: object) -> str:
        return "# Heading\n\nPlatform corpus body text."

    async def _fake_classification(content_text: str):
        return {
            "content_type": "case_study",
            "primary_domain": "procurement",
            "primary_subtopic": "tender_evaluation",
        }

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
    # NB: extract_form_structure is deliberately LEFT UNPATCHED — the REAL docx
    # reader runs against the committed Charnwood fixture so the forms route
    # genuinely mints an analysed form_templates row consuming the workspace_id.

    # Fake the asyncpg-pool form-trim seam (the shrink DELETE reached after the
    # form-template field write — its REAL body is covered real-body by bl-224 in
    # test_cocoindex_flow_write_path.py). Without this, the form branch hits the
    # stubbed DB pool's missing `acquire` (the trim is an outside-world DB seam,
    # not the BI-7 routing behaviour under test).
    async def _fake_trim(template_id, new_max_sequence) -> None:
        return None

    monkeypatch.setattr(flow, "_trim_stale_form_fields", _fake_trim)

    # Spy resolve_route so a test can prove the deployed entrypoint resolved
    # each rel_path against the loaded manifest on the worker thread.
    resolve_calls: list[str] = []
    real_resolve = flow.resolve_route

    def _spy_resolve(manifest, rel_path):
        resolve_calls.append(rel_path)
        return real_resolve(manifest, rel_path)

    monkeypatch.setattr(flow, "resolve_route", _spy_resolve)
    targets["_resolve_calls"] = resolve_calls  # type: ignore[assignment]

    # ── Capture the run op_id minted at flow start.
    real_uuid4 = uuid.uuid4

    def _capture_uuid4() -> uuid.UUID:
        value = real_uuid4()
        captured_op_id.setdefault("op_id", value)
        return value

    monkeypatch.setattr(flow.uuid, "uuid4", _capture_uuid4)

    # ── Engine-dispatch stand-in: run ingest_file on a separate thread+loop.
    monkeypatch.setattr(flow.coco, "mount_each", _thread_dispatch_mount_each)
    monkeypatch.setattr(flow.coco, "component_subpath", component_subpath)

    # ── mount_table_target returns our recording fakes (no real Postgres).
    async def _fake_mount_table_target(db_ctx, table_name, schema, *, managed_by):
        return targets[table_name]

    monkeypatch.setattr(flow, "mount_table_target", _fake_mount_table_target)

    # ── Stage 1 source walk: yield exactly the staged files as a keyed feed
    # (the manifest .kh-workspace-map.json is NOT a walked item).
    class _FakeWalk:
        def items(self):
            return _KeyedItemsFeed(
                [(rel, _FakeFile(rel, disk)) for rel, disk in walked_files]
            )

    def _fake_walk_dir(path, *, live, recursive):
        return _FakeWalk()

    monkeypatch.setattr(flow.localfs, "walk_dir", _fake_walk_dir)

    # ── Stage-5 cross-document resolution needs a real DB pool; stub it out.
    async def _fake_stage_5(*args, **kwargs):
        return 0

    monkeypatch.setattr(flow, "_run_stage_5_resolution", _fake_stage_5)

    # ── The URL source branch ({75.11}) builds a pool via coco.use_context and
    # iterates its snapshot — return an EMPTY ledger so this stays a pure
    # localfs-branch harness.
    #
    # S438 (id-131 follow-on): the localfs content branch now ALSO resolves
    # this SAME pool via `coco.use_context(DB_CTX)` for the raw-pool
    # `_upsert_source_document` sd write (S437's fix extended to localfs) — an
    # `acquire()` seam is required so the content file's sd write does not
    # crash on a missing attribute. A SINGLE pool instance is returned on
    # every `use_context` call (not one-per-call) so its `executed` capture
    # accumulates every sd UPSERT across the whole run — callers that need the
    # landed sd row read it back via `targets["_sd_pool"]` +
    # `_sd_rows_from_pool` (the sd row no longer flows through the
    # `source_documents` `_FakeTarget`).
    class _EmptyLedgerPool:
        def __init__(self) -> None:
            self.executed: list[tuple[str, tuple]] = []

        async def fetch(self, sql):
            return []

        def acquire(self):
            pool = self

            class _Conn:
                async def execute(self, sql: str, *args: object) -> str:
                    pool.executed.append((sql, args))
                    return "INSERT 0 1"

            class _Acquire:
                async def __aenter__(self) -> "_Conn":
                    return _Conn()

                async def __aexit__(self, *exc: object) -> None:
                    return None

            return _Acquire()

    _sd_pool = _EmptyLedgerPool()
    targets["_sd_pool"] = _sd_pool  # type: ignore[assignment]
    monkeypatch.setattr(flow.coco, "use_context", lambda key: _sd_pool)

    # ── Capture the flow-start / flow-end webhook emissions (no live HTTP).
    async def _fake_webhook(**kwargs):
        webhook_emissions.append(kwargs)

    monkeypatch.setattr(flow, "_emit_pipeline_run_webhook", _fake_webhook)

    # ── Live mode: point COCOINDEX_SOURCE_PATH at the temp dir.
    monkeypatch.setenv("COCOINDEX_SOURCE_PATH", str(source_dir))

    asyncio.run(flow.app_main())

    return captured_op_id["op_id"], webhook_emissions


class TestManifestPresentContentCorpusIngests:
    """BI-7 (a) + (b): a content-only corpus WITH a root manifest ingests with
    NO manifest_missing abort, and the content file lands WORKSPACE-AGNOSTIC."""

    def test_content_corpus_with_manifest_ingests_workspace_agnostic(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        flow = _flow_module()

        source_dir = tmp_path
        (source_dir / "doc-one.md").write_text("# Heading\n\nPlatform body.")
        workspace_id = uuid.uuid4()
        # A NON-forms prefix mapping (empty prefix matches every rel_path).
        # No `route` key → resolve_route defaults to "content" (BI-7 backward
        # compat). The .md file therefore takes the content branch.
        _write_manifest(source_dir, [
            {"path_prefix": "", "workspace_id": str(workspace_id)},
        ])

        targets = _target_set()
        run_op_id, webhooks = _run_app_main_over_dir(
            flow,
            source_dir,
            targets,
            monkeypatch,
            walked_files=[("doc-one.md", source_dir / "doc-one.md")],
        )

        ci = targets["content_items"]
        # S438: the sd row lands via the raw-pool UPSERT, not the
        # `source_documents` _FakeTarget — reconstruct it from the pool capture.
        sd_rows = _sd_rows_from_pool(targets["_sd_pool"])  # type: ignore[arg-type]
        resolve_calls = targets["_resolve_calls"]  # type: ignore[index]

        # (a) NO manifest_missing abort: the run completed and a content_items
        # row landed (app_main loaded the manifest unconditionally and proceeded).
        terminal = webhooks[-1]
        assert terminal["status"] == "completed", (
            "a content corpus WITH a root manifest must ingest to completion — "
            "no manifest_missing abort (app_main loads the manifest "
            "unconditionally at flow start)"
        )
        assert len(ci.rows) == 1, "the content .md must land exactly one content_items row"
        assert len(sd_rows) == 1

        # The deployed entrypoint resolved the rel_path against the loaded
        # manifest (the fork ran on the worker thread).
        assert "doc-one.md" in resolve_calls

        # (b) BI-7 workspace-agnostic content layer: content_items carries NO
        # workspace_id (ID-69 BI-1 — "workspace_ids NEVER written").
        assert "workspace_id" not in ci.rows[0], (
            "content_items must NOT carry a workspace_id — the content record "
            "layer is workspace-AGNOSTIC (BI-7 / ID-69 BI-1)"
        )
        # And the op_id is correctly stamped (the row landed through the real
        # deployed flow, not a None-op_id worker-thread failure).
        assert ci.rows[0]["op_id"] == run_op_id

    def test_unmapped_content_prefix_still_routes_content_and_workspace_agnostic(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A content file under a prefix the manifest does NOT map is an
        UnmappedPath soft-warn (bl-219 benign) — it STILL routes to the content
        branch and lands workspace-agnostic. Proves BI-7 (b) holds even when the
        operator's manifest does not enumerate every content prefix."""
        flow = _flow_module()

        source_dir = tmp_path
        nested = source_dir / "unmapped"
        nested.mkdir()
        (nested / "doc.md").write_text("# H\n\nbody")
        # The manifest maps a DIFFERENT prefix — the staged file is unmapped.
        _write_manifest(source_dir, [
            {"path_prefix": "other-client/", "workspace_id": str(uuid.uuid4())},
        ])

        targets = _target_set()
        _run_op_id, webhooks = _run_app_main_over_dir(
            flow,
            source_dir,
            targets,
            monkeypatch,
            walked_files=[("unmapped/doc.md", nested / "doc.md")],
        )

        ci = targets["content_items"]
        # Unmapped is benign for file content (bl-219): the row lands on the
        # content branch with NO workspace_id, and the run completes.
        assert webhooks[-1]["status"] == "completed"
        assert len(ci.rows) == 1, "an unmapped content path still lands content rows"
        assert "workspace_id" not in ci.rows[0], (
            "an unmapped content file lands workspace-agnostic (BI-7 (b))"
        )
        assert targets["form_templates"].rows == [], "no form row for a content .md"


class TestFormsPrefixConsumesWorkspaceId:
    """BI-7 (c): a forms file under ``forms/procurement/`` routes to 'forms' and
    consumes the resolved workspace_id → it lands on form_templates.workspace_id
    (the ONLY Path-B write that consumes a workspace_id)."""

    def test_forms_procurement_docx_routes_forms_and_writes_workspace_id(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        assert _CHARNWOOD_DOCX.exists(), (
            f"corpus fixture missing — {_CHARNWOOD_DOCX} should symlink to the "
            "committed Charnwood blank instrument DOCX"
        )

        flow = _flow_module()

        source_dir = tmp_path
        forms_dir = source_dir / "forms" / "procurement"
        forms_dir.mkdir(parents=True)
        # A real on-disk copy is not needed — the _FakeFile reads the committed
        # fixture bytes via disk_path; only the rel_path drives the manifest match.
        workspace_id = uuid.uuid4()
        _write_manifest(source_dir, [
            {
                "path_prefix": "forms/procurement/",
                "workspace_id": str(workspace_id),
                "route": "forms",
            },
        ])

        targets = _target_set()
        rel_path = "forms/procurement/itt-services.docx"
        _run_op_id, webhooks = _run_app_main_over_dir(
            flow,
            source_dir,
            targets,
            monkeypatch,
            walked_files=[(rel_path, _CHARNWOOD_DOCX)],
        )

        ft = targets["form_templates"]
        ftf = targets["form_template_fields"]
        resolve_calls = targets["_resolve_calls"]  # type: ignore[index]

        # The run completed and the fork resolved the forms rel_path.
        assert webhooks[-1]["status"] == "completed"
        assert rel_path in resolve_calls

        # (c) The forms route minted exactly one analysed form_templates row that
        # CONSUMED the resolved workspace_id — the only Path-B write keyed on a
        # workspace.
        assert len(ft.rows) == 1, "the forms .docx must land exactly one form_templates row"
        ft_row = ft.rows[0]
        assert ft_row["status"] == "analysed"
        assert ft_row["workspace_id"] == workspace_id, (
            "form_templates.workspace_id must carry the manifest-resolved "
            "workspace — the ONLY Path-B write that consumes a workspace_id (BI-7)"
        )
        assert ft_row["storage_path"] == rel_path
        # The real docx reader extracted at least one field from the blank
        # instrument (proves the REAL extractor ran, not a stub).
        assert len(ftf.rows) >= 1, (
            "the real docx reader must extract at least one field from the "
            "Charnwood blank instrument"
        )

        # The forms route lands ZERO content rows (OQ-80.2-A ratified) — the
        # content layer stays untouched for a forms-routed file.
        for name in ("content_items", "source_documents", "content_chunks",
                     "q_a_extractions", "entity_mentions"):
            assert targets[name].rows == [], (
                f"a forms-routed file must land ZERO {name} rows (OQ-80.2-A)"
            )


class TestReingestMintsIdenticalIdentities:
    """BI-7 (d): re-running the SAME corpus mints IDENTICAL uuid5(rel_path) row
    identities — deterministic PKs UPSERT, never duplicate."""

    def test_content_reingest_same_corpus_mints_identical_uuid5_pks(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        flow = _flow_module()

        source_dir = tmp_path
        (source_dir / "stable.md").write_text("# Stable\n\nSame bytes every run.")
        _write_manifest(source_dir, [
            {"path_prefix": "", "workspace_id": str(uuid.uuid4())},
        ])
        walked = [("stable.md", source_dir / "stable.md")]

        targets_a = _target_set()
        op_id_a, _ = _run_app_main_over_dir(
            flow, source_dir, targets_a, monkeypatch, walked_files=walked
        )
        targets_b = _target_set()
        op_id_b, _ = _run_app_main_over_dir(
            flow, source_dir, targets_b, monkeypatch, walked_files=walked
        )

        # Two genuinely distinct runs (distinct op_id).
        assert op_id_a != op_id_b, "each app_main run mints a fresh op_id"

        # The content_items + source_documents PKs are the stable uuid5(rel_path)
        # across runs — a re-walk UPSERTs the SAME row rather than inserting a
        # duplicate. The expected PK is the deployed flow's own seed
        # (uuid5 over _KH_PIPELINE_DOC_NS), recomputed here as the oracle.
        ns = flow._KH_PIPELINE_DOC_NS
        # S438: source_documents no longer lands on its `_FakeTarget` — read it
        # back from the raw-pool UPSERT capture instead (mirrors the URL route,
        # S437).
        rows_by_table = {
            "content_items": (targets_a["content_items"].rows, targets_b["content_items"].rows),
            "source_documents": (
                _sd_rows_from_pool(targets_a["_sd_pool"]),  # type: ignore[arg-type]
                _sd_rows_from_pool(targets_b["_sd_pool"]),  # type: ignore[arg-type]
            ),
        }
        for table, seed in (("content_items", "ci:stable.md"),
                            ("source_documents", "sd:stable.md")):
            rows_a, rows_b = rows_by_table[table]
            assert len(rows_a) == 1 and len(rows_b) == 1
            expected_pk = uuid.uuid5(ns, seed)
            assert rows_a[0]["id"] == rows_b[0]["id"] == expected_pk, (
                f"{table} PK must be the stable uuid5({seed!r}) across re-ingest "
                "(BI-7 (d) — deterministic identity, no duplication)"
            )

        # The op_id row field is the per-RUN stamp (differs per run); the PK
        # identity does NOT (it is path-derived, not run-derived).
        assert targets_a["content_items"].rows[0]["op_id"] == op_id_a
        assert targets_b["content_items"].rows[0]["op_id"] == op_id_b


class TestAbsentManifestAbortsManifestMissing:
    """BI-7 (e) — CRITICAL REGRESSION GUARD: a corpus with NO root manifest
    ABORTS app_main with a manifest_missing stage error + a status='failed'
    terminal webhook. Regression-guards the {127.4} mandatory-manifest operator
    obligation (the form path must not run without a workspace map)."""

    def test_corpus_without_manifest_raises_manifest_missing(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from scripts.cocoindex_pipeline.workspace_resolver import ManifestLoadError

        flow = _flow_module()

        source_dir = tmp_path
        # A content file is staged but NO .kh-workspace-map.json is written —
        # the operator forgot the mandatory manifest.
        (source_dir / "doc.md").write_text("# H\n\nbody")

        # Capture the structured stage-error emission + the terminal webhook.
        stage_errors: list[dict] = []
        monkeypatch.setattr(
            flow, "_emit_stage_error_log", lambda **kw: stage_errors.append(kw)
        )
        webhook_emissions: list[dict] = []

        async def _fake_webhook(**kwargs):
            webhook_emissions.append(kwargs)

        monkeypatch.setattr(flow, "_emit_pipeline_run_webhook", _fake_webhook)
        monkeypatch.setenv("COCOINDEX_SOURCE_PATH", str(source_dir))

        # app_main ABORTS by re-raising ManifestLoadError after emitting the
        # structured manifest_missing error + the failed terminal webhook — the
        # form path must never run without a workspace map.
        with pytest.raises(ManifestLoadError):
            asyncio.run(flow.app_main())

        # The abort surfaced a manifest_missing stage error (NOT manifest_invalid
        # — the file is absent, not malformed).
        missing = [e for e in stage_errors if e.get("stage") == "manifest_missing"]
        assert missing, (
            "an absent root manifest must emit a manifest_missing stage error "
            "(the {127.4} mandatory-manifest gate) — got stages "
            f"{[e.get('stage') for e in stage_errors]}"
        )
        assert missing[0]["error_class"] == "extraction_validation_failed"

        # The terminal webhook recorded status='failed' (the run aborted before
        # any item ingested).
        failed = [w for w in webhook_emissions if w.get("status") == "failed"]
        assert failed, (
            "an absent-manifest abort must emit a status='failed' terminal "
            "webhook (the run did not complete)"
        )
        assert failed[0]["items_processed"] == 0

    def test_manifest_present_does_not_emit_manifest_missing(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Complement to the abort guard: the SAME corpus WITH a manifest emits
        NO manifest_missing error — pins that the gate fires on absence ALONE,
        not as a spurious always-on error (so the abort assertion above is
        load-bearing, not vacuous)."""
        flow = _flow_module()

        source_dir = tmp_path
        (source_dir / "doc.md").write_text("# H\n\nbody")
        _write_manifest(source_dir, [
            {"path_prefix": "", "workspace_id": str(uuid.uuid4())},
        ])

        stage_errors: list[dict] = []
        monkeypatch.setattr(
            flow, "_emit_stage_error_log", lambda **kw: stage_errors.append(kw)
        )

        targets = _target_set()
        _op_id, webhooks = _run_app_main_over_dir(
            flow,
            source_dir,
            targets,
            monkeypatch,
            walked_files=[("doc.md", source_dir / "doc.md")],
        )

        assert [e for e in stage_errors if e.get("stage") == "manifest_missing"] == [], (
            "a corpus WITH a root manifest must NOT emit a manifest_missing "
            "error — the gate fires on absence alone"
        )
        assert webhooks[-1]["status"] == "completed"
