"""Tests for producer/flow_def.py — ID-132 {132.23} G-FLOWDEF (the FULL
producer flow composed as ONE entry point) + {132.27} G-FLOW-STAGING-WIRE
(the STAGING + BI-28 provenance-map wiring).

Per the {132.23} testStrategy: a full producer run over a Source fixture
writes concept files (BI-11) and one record_embeddings row per concept
(BI-26) via the ONE composed flow_def — not the trigger.py Pass-1-only
stand-in. Idle mode (unset OKF_BUNDLE_DIR) still no-ops. Owner ruling (S456):
a log.md-only diff is a no-op — no repo mutation at all, not even staging.

Per the {132.27} testStrategy (S436 amendment, BI-27/DR-016): the final
publish step now calls `git_sync.sync_bundle(..., stage_only=True)`
DIRECTLY — every non-no-op run applies + `git add`s the client-owned repo's
working tree but makes NO commit; the ONE gated commit is deferred to the
separate, human-triggered `publish.publish_bundle`/`producer publish` action
(unchanged, exercised in `test_producer_publish.py`). Two more pieces wire in
at the same seam: an injected `overrides` seam folds approved
`git_sync.ProducerOverride`s onto the staged output via
`git_sync.reapply_overrides`; and a `concept_path -> form_instance_id` BI-28
provenance map, built here from every won-bid `case_study` ConceptKey this
run enumerated, stamps `source_form_instance_id` onto the emitted
`proposed_change_set`. `status_source`/BI-21 gating is no longer this
module's concern — it now lives solely in `producer/publish.py`.

`flow_def.py` deliberately imports NO `cocoindex` at module scope (collection
safety), but its lazily-imported composed pieces (`enrich`, `bundle_writer`,
`web_pass`, `embed` → `flow`) DO — so the full-flow tests run inside a
`stubbed_sys_modules` cocoindex stub (mirrors `test_producer_bundle_writer.py`
/ `test_producer_enrich.py`). `bundle_writer.localfs.declare_file` is patched
with a REAL filesystem side effect so `write_bundle` writes actual files the
git-sync stage can then read.

De-identified throughout: generic placeholder concept titles, never the real
first-client corpus.
"""

from __future__ import annotations

import asyncio
import importlib
import json
import subprocess
import sys
from contextlib import contextmanager
from pathlib import Path, PurePosixPath
from types import SimpleNamespace
from typing import Any

import pytest

_REPO_ROOT = Path(__file__).resolve().parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from conftest import make_cocoindex_stubs, stubbed_sys_modules  # noqa: E402
from scripts.cocoindex_pipeline.producer.flow_def import (  # noqa: E402
    _draft_concepts,
    _read_bundle_dir,
)

_SAMPLE_UUID = "11111111-1111-4111-8111-111111111111"
_EMBEDDING = [0.1] * 1024


async def _fully_covered_census() -> Any:
    """ID-427 {427.9}: the census a Source stand-in reports.

    `run_producer_flow` calls `Source.census()` unconditionally now, so
    every fake here answers it — that IS the protocol, and a fake that
    could opt out would let the real Source opt out too. Fully covered
    (`considered == routed`) so these fixtures keep asserting what they were
    written to assert: an unrouted count would make every run non-no-op and
    silently invert `TestNoOpLogOnlyRuling`. The census's own behaviour is
    tested where it is produced (`test_l_records_source.py`,
    `test_repo_docs_source.py`) and where it is rendered
    (`test_producer_bundle_writer.py`); what this module tests is that it
    reaches `log.md` through the composed flow."""
    from scripts.cocoindex_pipeline.sources.base import CorpusCensus  # noqa: PLC0415

    return CorpusCensus(
        considered=(("source_documents", 2), ("q_a_pairs", 5)),
        routed=(("source_documents", 2), ("q_a_pairs", 5)),
    )


def _won_bid_rel_path(basename: str) -> str:
    """The won-bid grain's own declared directory, read off the registry —
    never a literal (ID-427 {427.8}). Imported inside the function because
    this module deliberately imports `l_records` under the cocoindex stub
    context rather than at module scope."""
    from scripts.cocoindex_pipeline.sources import l_records  # noqa: PLC0415

    spec = next(
        s for s in l_records._BUILTIN_GRAINS if s.name == l_records.WON_BID_GRAIN
    )
    return f"{spec.directory}/{basename}"


# ── Test doubles ────────────────────────────────────────────────────────


def _declare_file_side_effect(path, content, *, create_parent_dirs: bool = False) -> None:
    """Mirrors the real `cocoindex.connectors.localfs.declare_file` filesystem
    side effect (`path.parent.mkdir(...)` then `path.write_bytes(...)`) — read
    off the installed `cocoindex==1.0.7` source during {132.10}'s probe."""
    target = Path(path)
    if create_parent_dirs:
        target.parent.mkdir(parents=True, exist_ok=True)
    data = content.encode() if isinstance(content, str) else content
    target.write_bytes(data)


class _SideEffectLocalfs:
    """A stand-in for `bundle_writer.localfs` whose `declare_file` actually
    writes to disk, so `write_bundle` produces real bundle files."""

    def declare_file(self, path, content, *, create_parent_dirs: bool = False) -> None:
        _declare_file_side_effect(path, content, create_parent_dirs=create_parent_dirs)


class _FakeRecordEmbeddingsTarget:
    """Dict-keyed fake mirroring cocoindex's `mount_table_target` UPSERT on the
    M1b `UNIQUE (owner_kind, owner_id, model)` natural key (same shape as
    `test_producer_embed.py`'s fake) — a same-key re-declare overwrites the
    SAME row rather than minting a duplicate."""

    def __init__(self) -> None:
        self.rows_by_key: "dict[tuple, dict]" = {}

    def declare_row(self, *, row: dict) -> None:
        self.rows_by_key[(row["owner_kind"], row["owner_id"], row["model"])] = row

    @property
    def rows(self) -> "list[dict]":
        return list(self.rows_by_key.values())


async def _fake_embedder(_text: str) -> "list[float]":
    """A deterministic 1024-d vector — never a real OpenAI call."""
    return list(_EMBEDDING)


# ── Fixtures ────────────────────────────────────────────────────────────


@pytest.fixture()
def env(monkeypatch: pytest.MonkeyPatch):
    """Enter the cocoindex stub for the whole test body (so `run_producer_flow`'s
    lazy imports resolve stub-backed) and hand back the composed modules plus a
    validator-passing draft builder. `bundle_writer.localfs` is patched with a
    real filesystem side effect so `write_bundle` writes actual files."""
    with stubbed_sys_modules(make_cocoindex_stubs()):
        flow_def = importlib.import_module("scripts.cocoindex_pipeline.producer.flow_def")
        bundle_writer = importlib.import_module(
            "scripts.cocoindex_pipeline.producer.bundle_writer"
        )
        enrich = importlib.import_module("scripts.cocoindex_pipeline.producer.enrich")
        web_pass = importlib.import_module("scripts.cocoindex_pipeline.producer.web_pass")
        l_records = importlib.import_module("scripts.cocoindex_pipeline.sources.l_records")
        # ID-163 PC-2 (G-SOURCE-SELECT): the RepoDocsSource sibling (163.4) —
        # imports no cocoindex itself, but pulled in here alongside l_records so
        # PC-2 tests can monkeypatch its constructor the SAME way `_wire_source`
        # already does for `LRecordsSource`.
        repo_docs = importlib.import_module("scripts.cocoindex_pipeline.sources.repo_docs")
        frontmatter = importlib.import_module(
            "scripts.cocoindex_pipeline.producer.frontmatter"
        )
        resource_uri = importlib.import_module(
            "scripts.cocoindex_pipeline.producer.resource_uri"
        )

        monkeypatch.setattr(bundle_writer, "localfs", _SideEffectLocalfs())

        def build_draft(
            rel_path: str,
            *,
            title: str = "Alpha",
            concept_type: str = "topic",
            entity_id: "str | None" = None,
            form_instance_id: "str | None" = None,
            grain: "str | None" = None,
        ) -> Any:
            # ID-427 {427.7}: `grain` is the dispatch key. Defaulted from the
            # label here purely so this fixture stays terse — the production
            # path reads it off the grain's own registry entry, never derives
            # it from a type.
            if grain is None:
                grain = (
                    "case_study_won_bid"
                    if form_instance_id is not None
                    else f"{concept_type}_grain"
                )
            key_kwargs: "dict[str, Any]" = {
                "rel_path": rel_path,
                "concept_type": concept_type,
                "grain": grain,
            }
            if concept_type == "topic":
                key_kwargs["scope_tag"] = rel_path
            else:
                key_kwargs["entity_id"] = entity_id or title
                if form_instance_id is not None:
                    key_kwargs["form_instance_id"] = form_instance_id
            key = l_records.ConceptKey(**key_kwargs)
            anchor = resource_uri.build_source_document_uri(_SAMPLE_UUID)
            sources = frontmatter.sources_from_citations([anchor])
            body = (
                f"A distilled synthesis about {title}.\n\n"
                f"{frontmatter.render_source_footnotes(sources)}"
            )
            frontmatter_obj = frontmatter.build_concept_frontmatter(
                type=concept_type,
                title=title,
                description="Desc",
                generated_by="kh-concept-producer/test-model-1",
                generated_at="2026-07-08T00:00:00Z",
                tags=("tag",),
                sources=sources,
            )
            return enrich.ConceptDraft(
                key=key,
                frontmatter=frontmatter_obj,
                body=body,
                primary_anchor=anchor,
            )

        yield SimpleNamespace(
            flow_def=flow_def,
            bundle_writer=bundle_writer,
            enrich=enrich,
            web_pass=web_pass,
            l_records=l_records,
            repo_docs=repo_docs,
            build_draft=build_draft,
            monkeypatch=monkeypatch,
        )


def _wire_source(env, drafts_by_key: "dict[Any, Any]") -> None:
    """Patch `LRecordsSource` with a fake whose `list_concepts` returns the
    fixture keys, and `enrich_concept` with a fake returning each key's
    pre-built draft (no real Anthropic call)."""
    keys = list(drafts_by_key)

    class _FakeSource:
        def __init__(self, pool: Any, *, concept_feeder_config: Any = None) -> None:
            self.pool = pool
            # {132.36} G-CONCEPT-FEEDER: accepted (mirrors the real
            # `LRecordsSource.__init__` signature `run_producer_flow` now
            # always calls with this kwarg) but unused — these fixtures
            # pre-build their own `keys`/drafts and don't exercise the
            # feeder enumeration path (see `TestConceptFeederWiring` below
            # for that coverage).
            self.concept_feeder_config = concept_feeder_config

        async def list_concepts(self):
            return keys

        async def census(self):
            return await _fully_covered_census()
    async def _fake_enrich(key: Any, _source: Any) -> Any:
        return drafts_by_key[key]

    env.monkeypatch.setattr(env.l_records, "LRecordsSource", _FakeSource)
    env.monkeypatch.setattr(env.enrich, "enrich_concept", _fake_enrich)


def _git(repo: Path, *args: str) -> str:
    return subprocess.run(
        ["git", *args], cwd=repo, capture_output=True, text=True, check=True
    ).stdout


def _commit_count(repo: Path) -> int:
    out = subprocess.run(
        ["git", "log", "--oneline"], cwd=repo, capture_output=True, text=True
    )
    return len(out.stdout.splitlines()) if out.returncode == 0 else 0


@pytest.fixture()
def repo(tmp_path: Path) -> Path:
    repo_path = tmp_path / "bundle-repo"
    repo_path.mkdir()
    subprocess.run(["git", "init", "--quiet"], cwd=repo_path, check=True)
    return repo_path


@pytest.fixture()
def bundle_dir(tmp_path: Path) -> Path:
    d = tmp_path / "bundle-work"
    d.mkdir()
    return d


# ── The G-FLOWDEF testStrategy: full run writes files + embeds ───────────
# ── The {132.27} testStrategy: the same run lands STAGING, no commit ─────


class TestFullRun:
    def test_writes_files_embeds_and_stages_without_committing(
        self, env, bundle_dir: Path, repo: Path
    ) -> None:
        # Build three concepts keyed by their ConceptKey.
        drafts_by_key = {}
        for rel_path, title in (
            ("topics/alpha.md", "Alpha"),
            ("topics/beta.md", "Beta"),
            ("topics/gamma.md", "Gamma"),
        ):
            draft = env.build_draft(rel_path, title=title)
            drafts_by_key[draft.key] = draft
        _wire_source(env, drafts_by_key)

        re_target = _FakeRecordEmbeddingsTarget()
        report = asyncio.run(
            env.flow_def.run_producer_flow(
                pool=object(),
                bundle_dir=bundle_dir,
                re_target=re_target,
                repo_path=repo,
                embedder=_fake_embedder,
            )
        )

        # BI-11: concept files + bundle artefacts written to disk.
        assert (bundle_dir / "topics/alpha.md").is_file()
        assert (bundle_dir / "topics/beta.md").is_file()
        assert (bundle_dir / "topics/gamma.md").is_file()
        assert (bundle_dir / "index.md").is_file()
        assert (bundle_dir / "log.md").is_file()
        assert (bundle_dir / "ontology.json").is_file()

        # BI-26: exactly one record_embeddings(owner_kind='concept') row per concept.
        assert len(re_target.rows) == 3
        assert {r["owner_kind"] for r in re_target.rows} == {"concept"}
        assert sorted(report.embedded) == [
            "topics/alpha.md",
            "topics/beta.md",
            "topics/gamma.md",
        ]

        # {132.27}: STAGING, not a per-run commit — the ONE gated commit is
        # deferred to the separate publish.py/producer-publish action.
        assert _commit_count(repo) == 0
        assert report.committed is False
        assert report.sync_result.staged is True
        # The concept files landed in the client-owned repo's working tree...
        assert (repo / "topics/alpha.md").is_file()
        # ...and are staged in the index, ready for the later gated commit.
        staged_paths = _git(repo, "diff", "--cached", "--name-only").splitlines()
        assert "topics/alpha.md" in staged_paths

        # The machine-readable proposed_change_set (DR-016 shape) is emitted.
        assert report.proposed_change_set is not None
        assert report.proposed_change_set["staged"] is True
        changed_paths = {c["concept_path"] for c in report.proposed_change_set["changes"]}
        assert "topics/alpha.md" in changed_paths


# ── Idle-mode safety (preserved from {132.16}) ──────────────────────────


class TestIdleMode:
    def test_idle_when_bundle_dir_unset(
        self, env, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.delenv("OKF_BUNDLE_DIR", raising=False)
        result = asyncio.run(env.flow_def.run_producer_flow(pool=object()))
        assert result is None

    def test_idle_when_bundle_dir_missing_folder(
        self, env, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        monkeypatch.setenv("OKF_BUNDLE_DIR", str(tmp_path / "does-not-exist"))
        result = asyncio.run(env.flow_def.run_producer_flow(pool=object()))
        assert result is None

    def test_idle_when_no_pool(self, env, bundle_dir: Path) -> None:
        result = asyncio.run(
            env.flow_def.run_producer_flow(bundle_dir=bundle_dir, pool=None)
        )
        assert result is None


# ── id-429 {429.3} (D3): the theme machinery is retired at the CALLERS ────


def test_run_producer_flow_no_longer_accepts_theme_config(env, bundle_dir: Path) -> None:
    """The run entry's `theme_config` seam is gone. Proving it here — at the
    caller, by a call that must FAIL — is what stops a future operator quietly
    re-supplying a theme map through `trigger.run_producer_now(**kwargs)` and
    getting it silently ignored. The axis is now the directory the index sits
    in (D1), derived from `written`, so the renderer's input has a supplier by
    construction; the theme axis never did."""
    with pytest.raises(TypeError, match="theme_config"):
        env.flow_def.run_producer_flow(
            pool=object(),
            bundle_dir=bundle_dir,
            **{"theme_config": [("Company Overview", ("topics/a.md",))]},
        )


# ── {132.44} bl-457 IRI-6/IRI-10: OKF_CLIENT_ID resolution ────────────────


class TestClientIdResolution:
    """`_resolve_client_id` mirrors `_resolve_bundle_dir`'s `OKF_BUNDLE_DIR`
    read (unset/empty -> `None`, IRI-6's non-gating fallback)."""

    def test_resolve_client_id_reads_okf_client_id_env_var(
        self, env, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("OKF_CLIENT_ID", "acme")
        assert env.flow_def._resolve_client_id() == "acme"

    def test_resolve_client_id_unset_resolves_to_none(
        self, env, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.delenv("OKF_CLIENT_ID", raising=False)
        assert env.flow_def._resolve_client_id() is None

    def test_resolve_client_id_empty_string_resolves_to_none(
        self, env, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("OKF_CLIENT_ID", "")
        assert env.flow_def._resolve_client_id() is None


# ── {132.37} G-OVERLAY-PLATFORM-REJECT, DR-054/DR-079: OKF_BUNDLE_CLASS ───


class TestBundleClassResolution:
    """`_resolve_bundle_class` mirrors `_resolve_client_id`'s `OKF_CLIENT_ID`
    read (unset/empty -> `None`) — but, unlike `client_id`, `None` here is
    NOT a safe/non-gating default: `bundle_writer.write_bundle`'s OV-10
    gate treats an unresolved `bundle_class` the same as a confirmed
    non-client-business class when an overlay is discovered (reject)."""

    def test_resolve_bundle_class_reads_okf_bundle_class_env_var(
        self, env, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("OKF_BUNDLE_CLASS", "client_business")
        assert env.flow_def._resolve_bundle_class() == "client_business"

    def test_resolve_bundle_class_unset_resolves_to_none(
        self, env, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.delenv("OKF_BUNDLE_CLASS", raising=False)
        assert env.flow_def._resolve_bundle_class() is None

    def test_resolve_bundle_class_empty_string_resolves_to_none(
        self, env, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("OKF_BUNDLE_CLASS", "")
        assert env.flow_def._resolve_bundle_class() is None


class TestBundleClassGate:
    """OV-10 end-to-end, through the REAL `run_producer_flow` composed
    entry point — not only the `write_bundle` unit call
    (`TestDegradation`'s overlay tests above already cover the
    `client_business`-permitted composition path end-to-end)."""

    def test_non_client_business_run_with_stray_overlay_aborts(
        self, env, bundle_dir: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A stray `ontology-overlay.json` in a non-client-business bundle
        checkout (e.g. the showcase bundle) ABORTS the run with a clear
        error — the testStrategy's hard-reject clause, exercised through
        the full composed flow, not only a direct `write_bundle` call."""
        monkeypatch.setenv("OKF_BUNDLE_CLASS", "showcase")
        (bundle_dir / "ontology-overlay.json").write_text(
            json.dumps({"entity_types": ["widget"]}), encoding="utf-8"
        )
        draft = env.build_draft("topics/alpha.md", title="Alpha")
        _wire_source(env, {draft.key: draft})

        with pytest.raises(env.bundle_writer.OntologyOverlayClassError):
            asyncio.run(
                env.flow_def.run_producer_flow(pool=object(), bundle_dir=bundle_dir)
            )

        assert not (bundle_dir / "topics/alpha.md").exists()
        assert not (bundle_dir / "ontology.json").exists()

    def test_non_client_business_run_without_overlay_file_stays_base_only(
        self, env, bundle_dir: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The testStrategy's third clause: a non-client-business run with
        NO overlay file present is unaffected by the gate — it stays
        base-only (`overlay: null`) and publishes successfully, exactly as
        before this Subtask's gate existed."""
        monkeypatch.setenv("OKF_BUNDLE_CLASS", "showcase")
        draft = env.build_draft("topics/alpha.md", title="Alpha")
        _wire_source(env, {draft.key: draft})

        asyncio.run(
            env.flow_def.run_producer_flow(pool=object(), bundle_dir=bundle_dir)
        )

        ontology = json.loads((bundle_dir / "ontology.json").read_text(encoding="utf-8"))
        assert ontology["overlay"] is None


# ── ID-163 PC-2 (G-SOURCE-SELECT): class-gated Source selection ──────────


@contextmanager
def _source_repo_path_env(env, monkeypatch: "pytest.MonkeyPatch", value: "str | None"):
    """`flow_def.OKF_SOURCE_REPO_PATH` is read ONCE at import time (ID-163
    PC-2) — mirrors `agent_loop.PRODUCER_MODEL`'s posture, not this module's
    OWN per-call `_resolve_bundle_dir`/`_resolve_client_id`/
    `_resolve_bundle_class` helpers. A plain `monkeypatch.setenv` has no
    effect on the already-bound module constant, so exercising a specific
    value needs a scoped `importlib.reload` — this suite's existing
    precedent for import-time env constants is
    `test_producer_agent_loop.py::TestProducerModelEnvOverride`. Always
    restores (delenv + reload) in `finally` so no reload side effect
    survives past the test; safe to confine to this module because
    `flow_def.py` itself imports no `cocoindex` at module scope (the
    module's own "Collection safety" docstring note) — a reload here
    cannot leak stub state into sibling test files."""
    if value is None:
        monkeypatch.delenv("OKF_SOURCE_REPO_PATH", raising=False)
    else:
        monkeypatch.setenv("OKF_SOURCE_REPO_PATH", value)
    try:
        importlib.reload(env.flow_def)
        yield env.flow_def
    finally:
        monkeypatch.delenv("OKF_SOURCE_REPO_PATH", raising=False)
        importlib.reload(env.flow_def)


class _ExplodingSource:
    """A Source stand-in that fails the test loudly if it is ever
    constructed — proves the OTHER branch (or the fail-loud guard) never
    reaches this one's constructor."""

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        raise AssertionError(
            f"{type(self).__qualname__} must not be constructed for this run "
            "(ID-163 PC-2 class-gated Source selection)"
        )


class TestSourceSelection:
    """`run_producer_flow` (`flow_def.py:478` pre-163.5) gates Source
    construction on the already-resolved bundle class (`_resolve_bundle_class`,
    OV-10). DR-079's two Path-2 direct-producer classes — `system_baseline`
    and `internal_dev` — construct `RepoDocsSource(OKF_SOURCE_REPO_PATH)`
    (163.4) over the platform repo/docs checkout; every OTHER class (`None`,
    `client_business`, `showcase`) stays on `LRecordsSource(pool, ...)`,
    byte-identical to pre-163.5 behaviour — the additive, class-gated
    isolation discipline the `PRODUCER_*` slices already established."""

    @pytest.mark.parametrize("bundle_class", ["system_baseline", "internal_dev"])
    def test_repo_docs_bundle_class_selects_repo_docs_source(
        self,
        env,
        bundle_dir: Path,
        monkeypatch: "pytest.MonkeyPatch",
        tmp_path: Path,
        bundle_class: str,
    ) -> None:
        """Source selection is this test's subject and is unchanged: both
        Path-2 classes construct `RepoDocsSource` over `source_repo`.

        ID-427 {427.5}: the `internal_dev` special case is REMOVED. It
        existed only because {163.17}/bl-478 made the run fail loud inside
        `write_bundle`'s effective-ontology gate for want of a ratified
        BI-4 type set — that fail-loud deletes with the register (DR-141),
        so `internal_dev` now completes exactly like `system_baseline` and
        both parametrisations take one path again."""
        monkeypatch.setenv("OKF_BUNDLE_CLASS", bundle_class)
        source_repo = tmp_path / "platform-repo"
        source_repo.mkdir()

        with _source_repo_path_env(env, monkeypatch, str(source_repo)) as flow_def:
            captured: "list[Any]" = []

            class _CapturingRepoDocsSource:
                def __init__(self, root: Any, **kwargs: Any) -> None:
                    captured.append(root)

                async def list_concepts(self):
                    return []

                async def census(self):
                    return await _fully_covered_census()
            env.monkeypatch.setattr(
                env.repo_docs, "RepoDocsSource", _CapturingRepoDocsSource
            )
            env.monkeypatch.setattr(env.l_records, "LRecordsSource", _ExplodingSource)

            result = asyncio.run(
                flow_def.run_producer_flow(pool=object(), bundle_dir=bundle_dir)
            )

        assert captured == [str(source_repo)]
        assert result is not None

    @pytest.mark.parametrize("bundle_class", ["system_baseline", "internal_dev"])
    def test_repo_docs_bundle_class_without_source_repo_path_fails_loud(
        self,
        env,
        bundle_dir: Path,
        monkeypatch: "pytest.MonkeyPatch",
        bundle_class: str,
    ) -> None:
        """No silent fallback to `LRecordsSource` (the KH quality bar the
        brief names explicitly) — an unset `OKF_SOURCE_REPO_PATH` for a
        Path-2 class run raises loudly, BEFORE either Source is constructed
        or any bundle file is written."""
        monkeypatch.setenv("OKF_BUNDLE_CLASS", bundle_class)

        with _source_repo_path_env(env, monkeypatch, None) as flow_def:
            env.monkeypatch.setattr(env.repo_docs, "RepoDocsSource", _ExplodingSource)
            env.monkeypatch.setattr(env.l_records, "LRecordsSource", _ExplodingSource)

            with pytest.raises(RuntimeError, match="OKF_SOURCE_REPO_PATH"):
                asyncio.run(
                    flow_def.run_producer_flow(pool=object(), bundle_dir=bundle_dir)
                )

        assert not (bundle_dir / "ontology.json").exists()
        assert not (bundle_dir / "index.md").exists()

    @pytest.mark.parametrize("bundle_class", ["client_business", "showcase", None])
    def test_non_repo_docs_bundle_class_selects_l_records_source_unchanged(
        self,
        env,
        bundle_dir: Path,
        monkeypatch: "pytest.MonkeyPatch",
        bundle_class: "str | None",
    ) -> None:
        """`client_business`, `showcase`, and an unresolved (`None`) bundle
        class are all OUTSIDE the PC-2 gate — none of them may construct
        `RepoDocsSource` (the brief's explicit "do not widen" instruction
        for `showcase`), and the run's observable output is unchanged from
        pre-163.5 (`OKF_SOURCE_REPO_PATH` is never even consulted)."""
        if bundle_class is None:
            monkeypatch.delenv("OKF_BUNDLE_CLASS", raising=False)
        else:
            monkeypatch.setenv("OKF_BUNDLE_CLASS", bundle_class)
        monkeypatch.delenv("OKF_SOURCE_REPO_PATH", raising=False)

        env.monkeypatch.setattr(env.repo_docs, "RepoDocsSource", _ExplodingSource)
        draft = env.build_draft("topics/alpha.md", title="Alpha")
        _wire_source(env, {draft.key: draft})

        asyncio.run(
            env.flow_def.run_producer_flow(pool=object(), bundle_dir=bundle_dir)
        )

        assert (bundle_dir / "topics/alpha.md").is_file()
        assert (bundle_dir / "index.md").is_file()


# ── ID-132 {132.36} G-CONCEPT-FEEDER end-to-end wiring ───────────────────


class TestConceptFeederWiring:
    """`concept-feeder.json` is read from `bundle_dir` and threaded into
    `LRecordsSource`'s constructor, gated by the SAME OV-10 bundle-class
    discriminator `TestBundleClassGate` exercises for the overlay."""

    def test_feeder_config_is_read_and_threaded_into_the_source(
        self, env, bundle_dir: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("OKF_BUNDLE_CLASS", "client_business")
        (bundle_dir / "concept-feeder.json").write_text(
            json.dumps(
                {
                    "concept_types": {
                        "partner": {"grain": "entity_mention", "entity_type": "partner"},
                    }
                }
            ),
            encoding="utf-8",
        )
        draft = env.build_draft("topics/alpha.md", title="Alpha")
        captured: "list[Any]" = []

        class _CapturingSource:
            def __init__(self, pool: Any, *, concept_feeder_config: Any = None) -> None:
                captured.append(concept_feeder_config)

            async def list_concepts(self):
                return [draft.key]

            async def census(self):
                return await _fully_covered_census()
        async def _fake_enrich(key: Any, _source: Any) -> Any:
            return draft

        env.monkeypatch.setattr(env.l_records, "LRecordsSource", _CapturingSource)
        env.monkeypatch.setattr(env.enrich, "enrich_concept", _fake_enrich)

        asyncio.run(env.flow_def.run_producer_flow(pool=object(), bundle_dir=bundle_dir))

        # ID-427 {427.7} (TECH §2.7): validation now resolves the grain's
        # `directory`, defaulting to the declared type name — the same string
        # the pre-{427.7} `{concept_type}/` layout used, so no directory
        # moves and there is no config to migrate.
        assert captured == [
            {
                "partner": {
                    "grain": "entity_mention",
                    "entity_type": "partner",
                    "directory": "partner",
                }
            }
        ]

    def test_absent_feeder_config_threads_none_into_the_source(
        self, env, bundle_dir: Path
    ) -> None:
        """No `concept-feeder.json` -> `LRecordsSource` receives `None` for
        `concept_feeder_config` (mirrors every other pre-{132.36} test in
        this file, none of which write the file)."""
        draft = env.build_draft("topics/alpha.md", title="Alpha")
        captured: "list[Any]" = []

        class _CapturingSource:
            def __init__(self, pool: Any, *, concept_feeder_config: Any = None) -> None:
                captured.append(concept_feeder_config)

            async def list_concepts(self):
                return [draft.key]

            async def census(self):
                return await _fully_covered_census()
        async def _fake_enrich(key: Any, _source: Any) -> Any:
            return draft

        env.monkeypatch.setattr(env.l_records, "LRecordsSource", _CapturingSource)
        env.monkeypatch.setattr(env.enrich, "enrich_concept", _fake_enrich)

        asyncio.run(env.flow_def.run_producer_flow(pool=object(), bundle_dir=bundle_dir))

        assert captured == [None]

    def test_feeder_config_in_a_non_client_business_bundle_aborts(
        self, env, bundle_dir: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A `concept-feeder.json` present in a non-client-business bundle
        checkout hard-rejects — the SAME OV-10 discriminator {132.37}
        established for the overlay, extended to the feeder config. Checked
        BEFORE `LRecordsSource` is even constructed, so nothing is drafted
        or written this run (mirrors OV-5's all-or-nothing posture)."""
        monkeypatch.setenv("OKF_BUNDLE_CLASS", "showcase")
        (bundle_dir / "concept-feeder.json").write_text(
            json.dumps(
                {
                    "concept_types": {
                        "partner": {"grain": "entity_mention", "entity_type": "partner"},
                    }
                }
            ),
            encoding="utf-8",
        )
        draft = env.build_draft("topics/alpha.md", title="Alpha")
        _wire_source(env, {draft.key: draft})

        with pytest.raises(env.bundle_writer.OntologyOverlayClassError):
            asyncio.run(
                env.flow_def.run_producer_flow(pool=object(), bundle_dir=bundle_dir)
            )

        assert not (bundle_dir / "topics/alpha.md").exists()
        assert not (bundle_dir / "ontology.json").exists()

    def test_malformed_feeder_config_aborts_before_any_write(
        self, env, bundle_dir: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("OKF_BUNDLE_CLASS", "client_business")
        (bundle_dir / "concept-feeder.json").write_text("{not valid json", encoding="utf-8")
        draft = env.build_draft("topics/alpha.md", title="Alpha")
        _wire_source(env, {draft.key: draft})

        with pytest.raises(env.bundle_writer.ConceptFeederConfigError):
            asyncio.run(
                env.flow_def.run_producer_flow(pool=object(), bundle_dir=bundle_dir)
            )

        assert not (bundle_dir / "topics/alpha.md").exists()


# ── Owner ruling S456: a log.md-only diff is a no-op — no commit ─────────


class TestNoOpLogOnlyRuling:
    def test_second_identical_run_skips_staging_too(
        self, env, bundle_dir: Path, repo: Path
    ) -> None:
        drafts_by_key = {}
        for rel_path, title in (("topics/alpha.md", "Alpha"), ("topics/beta.md", "Beta")):
            draft = env.build_draft(rel_path, title=title)
            drafts_by_key[draft.key] = draft
        _wire_source(env, drafts_by_key)

        def run() -> Any:
            return asyncio.run(
                env.flow_def.run_producer_flow(
                    pool=object(),
                    bundle_dir=bundle_dir,
                    re_target=_FakeRecordEmbeddingsTarget(),
                    repo_path=repo,
                    embedder=_fake_embedder,
                    timestamp="2026-07-08T00:00:00Z",
                )
            )

        first = run()
        assert first.committed is False
        assert first.sync_result.staged is True
        assert _commit_count(repo) == 0

        second = run()
        # Every concept byte-identical → RunSummary.is_no_op → the ONLY diff
        # would be log.md's new stamp → the flow skips even staging (S456).
        assert second.summary.is_no_op is True
        assert second.committed is False
        assert second.sync_result is None
        assert second.proposed_change_set is None
        assert _commit_count(repo) == 0


# ── ID-427 {427.9} — the census through the COMPOSED flow ───────────────
#
# The unit tests for the census live where it is produced
# (`test_l_records_source.py`, `test_repo_docs_source.py`) and where it is
# rendered (`test_producer_bundle_writer.py`). What this module owns is the
# seam between them: `run_producer_flow` asking the Source for a census and
# threading it into `write_bundle`. That seam is where a census could be
# silently dropped and every other test would still pass.


class TestTheCensusReachesTheBundleThroughTheFlow:
    def test_a_run_writes_its_considered_line_into_the_bundle_log(
        self, env, bundle_dir: Path
    ) -> None:
        draft = env.build_draft("topics/alpha.md", title="Alpha")
        _wire_source(env, {draft.key: draft})

        asyncio.run(
            env.flow_def.run_producer_flow(
                pool=object(),
                bundle_dir=bundle_dir,
                timestamp="2026-08-10T09:00:00Z",
            )
        )

        log_text = (bundle_dir / "log.md").read_text(encoding="utf-8")
        assert (
            "* **Run 2026-08-10T09:00:00Z — Considered (2):** "
            "source_documents 2 (routed 2), q_a_pairs 5 (routed 5)"
        ) in log_text

    def test_a_source_that_cannot_report_a_census_fails_the_run_loudly(
        self, env, bundle_dir: Path
    ) -> None:
        """`Source.census()` is called on the protocol, never probed for
        with `getattr`. A tolerant call site would let a Source opt out of
        saying what it left behind — which is the producer DR-141 diagnoses
        — and the run would look completely healthy while doing it."""
        draft = env.build_draft("topics/alpha.md", title="Alpha")

        class _CensuslessSource:
            def __init__(self, pool: Any, *, concept_feeder_config: Any = None) -> None:
                pass

            async def list_concepts(self):
                return [draft.key]

        env.monkeypatch.setattr(env.l_records, "LRecordsSource", _CensuslessSource)

        with pytest.raises(AttributeError, match="census"):
            asyncio.run(
                env.flow_def.run_producer_flow(pool=object(), bundle_dir=bundle_dir)
            )

    def test_an_unrouted_rerun_still_stages_though_nothing_on_disk_changed(
        self, env, bundle_dir: Path, repo: Path
    ) -> None:
        """**The concrete consequence of `is_no_op` gaining the census
        term.** A re-run over an unchanged corpus is byte-identical, so
        S456's log.md-only rule would skip staging entirely — leaving the
        one line that reports the hole uncommitted, run after run. This is
        the same shape `failed` already has, applied to unrouted knowledge.
        """
        draft = env.build_draft("topics/alpha.md", title="Alpha")
        _wire_source(env, {draft.key: draft})
        census_holder: "dict[str, Any]" = {}

        async def _reported_census() -> Any:
            return census_holder["value"]

        source_cls = env.l_records.LRecordsSource
        source_cls.census = lambda self: _reported_census()  # type: ignore[assignment]

        from scripts.cocoindex_pipeline.sources.base import CorpusCensus

        census_holder["value"] = CorpusCensus(
            considered=(("source_documents", 4),), routed=(("source_documents", 4),)
        )
        first = asyncio.run(
            env.flow_def.run_producer_flow(
                pool=object(),
                bundle_dir=bundle_dir,
                repo_path=repo,
                timestamp="2026-08-10T09:00:00Z",
            )
        )
        assert first.sync_result.staged is True

        # Identical corpus, identical drafts — but a grain now covers less.
        census_holder["value"] = CorpusCensus(
            considered=(("source_documents", 4),), routed=(("source_documents", 1),)
        )
        second = asyncio.run(
            env.flow_def.run_producer_flow(
                pool=object(),
                bundle_dir=bundle_dir,
                repo_path=repo,
                timestamp="2026-08-10T10:00:00Z",
            )
        )

        assert second.summary.added == ()
        assert second.summary.changed == ()
        assert second.summary.is_no_op is False
        assert second.sync_result is not None  # NOT skipped by the S456 rule
        log_text = (bundle_dir / "log.md").read_text(encoding="utf-8")
        assert (
            "* **Run 2026-08-10T10:00:00Z — Unrouted (3):** source_documents 3"
        ) in log_text


# ── Per-stage degradation through injection seams ───────────────────────


class TestDegradation:
    def test_no_repo_path_writes_and_embeds_but_never_commits(
        self, env, bundle_dir: Path
    ) -> None:
        draft = env.build_draft("topics/alpha.md", title="Alpha")
        _wire_source(env, {draft.key: draft})

        re_target = _FakeRecordEmbeddingsTarget()
        report = asyncio.run(
            env.flow_def.run_producer_flow(
                pool=object(),
                bundle_dir=bundle_dir,
                re_target=re_target,
                embedder=_fake_embedder,
            )
        )

        assert (bundle_dir / "topics/alpha.md").is_file()
        assert len(re_target.rows) == 1
        assert report.committed is False
        assert report.sync_result is None

    def test_no_re_target_writes_but_skips_embedding(
        self, env, bundle_dir: Path
    ) -> None:
        draft = env.build_draft("topics/alpha.md", title="Alpha")
        _wire_source(env, {draft.key: draft})

        report = asyncio.run(
            env.flow_def.run_producer_flow(
                pool=object(),
                bundle_dir=bundle_dir,
            )
        )
        assert (bundle_dir / "topics/alpha.md").is_file()
        assert report.embedded == ()

    def test_composes_a_client_overlay_from_the_bundle_dir_end_to_end(
        self, env, bundle_dir: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """OV-4 (ID-132 {132.34} G-OVERLAY-CV): a REAL `run_producer_flow`
        run — not only a direct `write_bundle` unit call — exercises the
        overlay READ end-to-end. The sole production caller
        (`flow_def.py:379-385`) never explicitly supplies
        `client_ontology_overlay`; composing an overlay for a real run
        depends entirely on `write_bundle`'s own bundle_dir read.
        `OKF_BUNDLE_CLASS=client_business` (ID-132 {132.37} OV-10) is set so
        the class gate permits composition — see `TestBundleClassGate`
        below for the gate's own end-to-end tests."""
        monkeypatch.setenv("OKF_BUNDLE_CLASS", "client_business")
        (bundle_dir / "ontology-overlay.json").write_text(
            json.dumps({"entity_types": ["widget"]}), encoding="utf-8"
        )
        draft = env.build_draft("topics/alpha.md", title="Alpha")
        _wire_source(env, {draft.key: draft})

        asyncio.run(
            env.flow_def.run_producer_flow(pool=object(), bundle_dir=bundle_dir)
        )

        ontology = json.loads((bundle_dir / "ontology.json").read_text(encoding="utf-8"))
        assert ontology["overlay"]["entity_types"] == ["widget"]
        assert ontology["overlay"]["source"] == "ontology-overlay.json"
        # The three `ontology["base"][...]` assertions that stood here are
        # INVERTED, not dropped: ID-427 {427.11} retires the `base` key
        # itself (DR-027 as amended S546), so a real end-to-end run must
        # now prove the artefact is the overlay carrier and nothing else.
        assert "base" not in ontology
        assert set(ontology) == {"overlay"}

    def test_is_base_only_when_no_overlay_file_present_in_the_bundle_dir(
        self, env, bundle_dir: Path
    ) -> None:
        """OV-4/OV-10: a real producer run over a bundle_dir with no
        `ontology-overlay.json` (the platform bundle's permanent state)
        composes `overlay: null`."""
        draft = env.build_draft("topics/alpha.md", title="Alpha")
        _wire_source(env, {draft.key: draft})

        asyncio.run(
            env.flow_def.run_producer_flow(pool=object(), bundle_dir=bundle_dir)
        )

        ontology = json.loads((bundle_dir / "ontology.json").read_text(encoding="utf-8"))
        assert ontology["overlay"] is None

    def test_context_jsonld_is_base_only_when_okf_client_id_unset(
        self, env, bundle_dir: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """{132.44} bl-457 IRI-6: a real producer run with `OKF_CLIENT_ID`
        unset resolves `client_id=None` at the `write_bundle` call site —
        `context.jsonld` ships base-only, even with a client-authored
        overlay present (advisory un-projected diagnostic, run not
        aborted). `OKF_BUNDLE_CLASS=client_business` (ID-132 {132.37}
        OV-10) is set so the class gate permits the overlay to compose at
        all — orthogonal to this test's IRI-6 assertion."""
        monkeypatch.delenv("OKF_CLIENT_ID", raising=False)
        monkeypatch.setenv("OKF_BUNDLE_CLASS", "client_business")
        (bundle_dir / "ontology-overlay.json").write_text(
            json.dumps({"entity_types": ["widget"]}), encoding="utf-8"
        )
        draft = env.build_draft("topics/alpha.md", title="Alpha")
        _wire_source(env, {draft.key: draft})

        asyncio.run(
            env.flow_def.run_producer_flow(pool=object(), bundle_dir=bundle_dir)
        )

        context = json.loads(
            (bundle_dir / "context.jsonld").read_text(encoding="utf-8")
        )["@context"]
        assert "client" not in context
        assert "widget" not in context

    def test_context_jsonld_projects_overlay_under_client_ns_when_okf_client_id_set(
        self, env, bundle_dir: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """{132.44} bl-457 IRI-2/5/6: a real producer run with `OKF_CLIENT_ID`
        set resolves `client_id` at the `write_bundle` call site — the
        SAME composed `EffectiveOntology` `write_bundle` already lints
        concepts against is what `context.jsonld` projects, so the
        client-authored overlay term mints under the client namespace.
        `OKF_BUNDLE_CLASS=client_business` (ID-132 {132.37} OV-10) is set
        so the class gate permits the overlay to compose at all."""
        monkeypatch.setenv("OKF_CLIENT_ID", "acme")
        monkeypatch.setenv("OKF_BUNDLE_CLASS", "client_business")
        (bundle_dir / "ontology-overlay.json").write_text(
            json.dumps({"entity_types": ["widget"]}), encoding="utf-8"
        )
        draft = env.build_draft("topics/alpha.md", title="Alpha")
        _wire_source(env, {draft.key: draft})

        asyncio.run(
            env.flow_def.run_producer_flow(pool=object(), bundle_dir=bundle_dir)
        )

        from scripts.cocoindex_pipeline.producer import iri_projection

        context = json.loads(
            (bundle_dir / "context.jsonld").read_text(encoding="utf-8")
        )["@context"]
        assert context["client"] == f"{iri_projection._client_namespace('acme')}#"
        assert context["widget"] == iri_projection.mint_iri("widget", scope="acme")

    def test_stages_regardless_of_seed_contract_status(
        self, env, bundle_dir: Path, repo: Path
    ) -> None:
        """{132.27}: BI-21 gating is no longer this module's concern — it
        moved entirely to `publish.py`'s own `publish_bundle`/`producer
        publish` action (see `test_producer_publish.py`). A run always lands
        STAGING here, whatever the ID-131 seed-contract freeze test's CI
        status is; the flow no longer accepts (or needs) a `status_source`."""
        draft = env.build_draft("topics/alpha.md", title="Alpha")
        _wire_source(env, {draft.key: draft})

        report = asyncio.run(
            env.flow_def.run_producer_flow(
                pool=object(),
                bundle_dir=bundle_dir,
                repo_path=repo,
                embedder=_fake_embedder,
            )
        )

        assert report.sync_result.staged is True
        assert _commit_count(repo) == 0
        assert (repo / "topics/alpha.md").is_file()


# ── One bad concept is contained (mirrors {132.16}'s stand-in posture) ───


class TestContainment:
    def test_one_bad_concept_does_not_abort_the_run(
        self, env, bundle_dir: Path, repo: Path
    ) -> None:
        good = env.build_draft("topics/good.md", title="Good")
        bad_key = env.l_records.ConceptKey(
            rel_path="topics/bad.md",
            concept_type="topic",
            grain="topic_scope_tag",
            scope_tag="bad",
        )

        class _FakeSource:
            def __init__(self, pool: Any, *, concept_feeder_config: Any = None) -> None:
                self.pool = pool

            async def list_concepts(self):
                return [bad_key, good.key]

            async def census(self):
                return await _fully_covered_census()
        async def _fake_enrich(key: Any, _source: Any) -> Any:
            if key is bad_key:
                raise RuntimeError("boom")
            return good

        env.monkeypatch.setattr(env.l_records, "LRecordsSource", _FakeSource)
        env.monkeypatch.setattr(env.enrich, "enrich_concept", _fake_enrich)

        re_target = _FakeRecordEmbeddingsTarget()
        report = asyncio.run(
            env.flow_def.run_producer_flow(
                pool=object(),
                bundle_dir=bundle_dir,
                re_target=re_target,
                repo_path=repo,
                embedder=_fake_embedder,
            )
        )

        assert (bundle_dir / "topics/good.md").is_file()
        assert not (bundle_dir / "topics/bad.md").exists()
        assert report.committed is False
        assert report.sync_result.staged is True
        assert (repo / "topics/good.md").is_file()
        assert _commit_count(repo) == 0


# ── G-PARSE-HARDEN Leg 2 ({132.45}, {132.35} Defect B): `_draft_concepts`'s
# failed_keys threading + the write_bundle reconcile it feeds ─────────────


class TestDraftConceptsFailedKeys:
    def test_returns_five_tuple_with_the_raw_failed_key_alongside_the_string_failure(
        self,
    ) -> None:
        good_key = SimpleNamespace(rel_path="topics/good.md")
        bad_key = SimpleNamespace(rel_path="topics/bad.md")

        async def _fake_enrich(key: Any, _source: Any) -> Any:
            if key is bad_key:
                raise RuntimeError("boom")
            return SimpleNamespace(key=key)

        async def _exercise():
            return await _draft_concepts(
                [good_key, bad_key],
                source=object(),
                enrich_concept=_fake_enrich,
                gated_corpus=None,
                run_web_pass=None,
                http_client=None,
            )

        drafts, reference_drafts, failures, pass2_ran, failed_keys = asyncio.run(
            _exercise()
        )

        assert len(drafts) == 1
        assert reference_drafts == []
        assert pass2_ran is False
        assert failures == [("topics/bad.md", "boom")]
        assert failed_keys == [bad_key]


class TestTransientDraftFailureRetainsLastGoodVersion:
    """{132.45} G-PARSE-HARDEN Leg 2 ({132.35} Defect B): a concept whose
    draft transiently fails THIS run must keep its last-good bundle
    version — never look like a confirmed source deletion, and a publish
    after such a run must never drop it."""

    def test_flaky_concept_survives_a_run_where_its_draft_fails(
        self, env, bundle_dir: Path
    ) -> None:
        good = env.build_draft("topics/good.md", title="Good")
        flaky = env.build_draft("topics/flaky.md", title="Flaky")
        flaky_key = flaky.key

        _wire_source(env, {good.key: good, flaky_key: flaky})

        # Run 1 — both draft cleanly.
        asyncio.run(
            env.flow_def.run_producer_flow(pool=object(), bundle_dir=bundle_dir)
        )
        assert (bundle_dir / "topics/flaky.md").is_file()
        flaky_content_run1 = (bundle_dir / "topics/flaky.md").read_text(
            encoding="utf-8"
        )

        # Run 2 — flaky's draft raises (e.g. enrich.py's own bounded retry
        # was exhausted); good still drafts fine.
        async def _flaky_enrich(key: Any, _source: Any) -> Any:
            if key is flaky_key:
                raise RuntimeError(
                    "enrich_concept: terminal text was not valid JSON"
                )
            return good

        env.monkeypatch.setattr(env.enrich, "enrich_concept", _flaky_enrich)

        report2 = asyncio.run(
            env.flow_def.run_producer_flow(pool=object(), bundle_dir=bundle_dir)
        )

        # Defect B: NOT removed, NOT silently dropped — the last-good file
        # survives byte-identical.
        assert "topics/flaky.md" not in report2.summary.removed
        assert (bundle_dir / "topics/flaky.md").read_text(
            encoding="utf-8"
        ) == flaky_content_run1
        # And visibly recorded as a failure — silent success is forbidden.
        assert "topics/flaky.md" in report2.summary.failed
        assert (bundle_dir / "topics/good.md").is_file()


# ── Optional Pass-2 web enrichment composes {132.9} run_web_pass ─────────


class TestPass2Optional:
    def test_pass2_runs_and_writes_reference_concepts_when_gated_corpus_supplied(
        self, env, bundle_dir: Path
    ) -> None:
        draft = env.build_draft("topics/alpha.md", title="Alpha")
        _wire_source(env, {draft.key: draft})

        ref_draft = env.web_pass.ReferenceConceptDraft(
            rel_path="references/iso-27001.md",
            frontmatter=draft.frontmatter,
            body=draft.body,
        )
        enriched = SimpleNamespace(concept=draft, reference_concepts=(ref_draft,))

        async def _fake_web_pass(_draft, _key, _source, _corpus, **_kwargs):
            return enriched

        env.monkeypatch.setattr(env.web_pass, "run_web_pass", _fake_web_pass)

        report = asyncio.run(
            env.flow_def.run_producer_flow(
                pool=object(),
                bundle_dir=bundle_dir,
                gated_corpus=object(),
            )
        )

        assert report.pass2_ran is True
        assert report.reference_paths == ("references/iso-27001.md",)
        assert (bundle_dir / "references/iso-27001.md").is_file()


# ── {132.27} G-FLOW-STAGING-WIRE: the headline testStrategy ──────────────
# "a full run over a won-bid Source fixture lands STAGING (no per-run
# commit) and emits a proposed_change_set whose won-bid entries carry
# source_form_instance_id."


class TestBI28StagingProvenance:
    def test_a_won_bid_run_lands_staging_and_stamps_source_form_instance_id(
        self, env, bundle_dir: Path, repo: Path
    ) -> None:
        # ID-427 {427.8}: the won-bid grain declares `case-studies/won-bid`,
        # so its concepts arrive with that identity. This was
        # `case-studies/acme-corp.md` plus a write-time redirect producing
        # the same file — the paths asserted below are unchanged.
        won_bid_draft = env.build_draft(
            _won_bid_rel_path("acme-corp.md"),
            title="Acme Corp",
            concept_type="case_study",
            form_instance_id="22222222-2222-4222-8222-222222222222",
        )
        ordinary_draft = env.build_draft("topics/alpha.md", title="Alpha")
        _wire_source(
            env,
            {won_bid_draft.key: won_bid_draft, ordinary_draft.key: ordinary_draft},
        )

        re_target = _FakeRecordEmbeddingsTarget()
        report = asyncio.run(
            env.flow_def.run_producer_flow(
                pool=object(),
                bundle_dir=bundle_dir,
                re_target=re_target,
                repo_path=repo,
                embedder=_fake_embedder,
            )
        )

        # STAGING, no per-run commit (testStrategy).
        assert _commit_count(repo) == 0
        assert report.committed is False
        assert report.sync_result.staged is True
        # UNCHANGED PHYSICAL PATH across {427.8} (TECH §2.5): a won-bid
        # case_study lands in the `won-bid/` sibling directory in the
        # client-owned repo, exactly as it did when `bundle_writer.
        # bundle_write_path` redirected it there. What changed is that the
        # path is now the concept's identity, declared by its grain.
        assert (repo / "case-studies/won-bid/acme-corp.md").is_file()
        assert not (repo / "case-studies/acme-corp.md").exists()

        # BI-25/26 ({132.29} checker-FAIL regression): the won-bid concept
        # still gets its embedding row. The regression this guards was a
        # lookup keyed on identity against a summary reported by physical
        # path; the two are now one key, so the assertion pins the OUTCOME
        # (the row exists, under the path the client can open) rather than
        # the reconciliation that used to be needed to reach it.
        assert len(re_target.rows) == 2
        assert sorted(report.embedded) == [
            "case-studies/won-bid/acme-corp.md",
            "topics/alpha.md",
        ]

        # The proposed_change_set's won-bid entry carries
        # source_form_instance_id (BI-28), keyed by the path the concept was
        # written to — which since {427.8} is `key.rel_path`. THIS is the
        # assertion that guards the re-key: `flow_def` builds the map from
        # `key.rel_path` now, and if that ever stopped matching what
        # `sync_bundle` sees on disk, the stamp would silently go missing
        # for exactly the grain BI-28 exists for.
        assert report.proposed_change_set is not None
        changes = {
            c["concept_path"]: c for c in report.proposed_change_set["changes"]
        }
        assert changes["case-studies/won-bid/acme-corp.md"]["source_form_instance_id"] == (
            "22222222-2222-4222-8222-222222222222"
        )
        assert changes["topics/alpha.md"]["source_form_instance_id"] is None

    def test_same_slug_collision_embeds_the_correct_bodies_and_provenance(
        self, env, bundle_dir: Path, repo: Path
    ) -> None:
        """{132.29} regression, carried across ID-427 {427.8}: a named-client
        and a won-bid `case_study` concept for the SAME buyer slug must each
        get their OWN embedding row with the CORRECT body. BI-26's
        `concept_owner_id` is a pure hash of whatever string it is given, so
        two concepts reaching this step under one key collide onto one
        `record_embeddings` row and the second `declare_row` silently
        clobbers the first with the wrong body. Only the won-bid entry's
        `proposed_change_set` row may carry `source_form_instance_id`
        (BI-28).

        **What changed is the premise, not the claim.** The two drafts no
        longer share an identity `rel_path` — the won-bid grain declares
        `case-studies/won-bid`, so they arrive distinct instead of being
        separated by `bundle_writer`'s write-time redirect. The same buyer
        slug in two grains is still the scenario; the test now proves the
        outcome holds when the producer is asked to emit both, which is what
        the client actually gets."""
        named_client_draft = env.build_draft(
            "case-studies/acme-corp.md",
            title="Acme Corp (named client)",
            concept_type="case_study",
        )
        won_bid_draft = env.build_draft(
            _won_bid_rel_path("acme-corp.md"),
            title="Acme Corp (won-bid outcome)",
            concept_type="case_study",
            form_instance_id="33333333-3333-4333-8333-333333333333",
        )
        # Same basename, different directory — the {132.29} shape, resolved
        # at the grain registry rather than at write time.
        assert named_client_draft.key.rel_path != won_bid_draft.key.rel_path
        assert (
            PurePosixPath(named_client_draft.key.rel_path).name
            == PurePosixPath(won_bid_draft.key.rel_path).name
        )
        _wire_source(
            env,
            {
                named_client_draft.key: named_client_draft,
                won_bid_draft.key: won_bid_draft,
            },
        )

        re_target = _FakeRecordEmbeddingsTarget()
        report = asyncio.run(
            env.flow_def.run_producer_flow(
                pool=object(),
                bundle_dir=bundle_dir,
                re_target=re_target,
                repo_path=repo,
                embedder=_fake_embedder,
            )
        )

        # Both grains land at DISTINCT paths — no ValueError collision, and
        # no on-disk clobber. Byte-identical to the pre-{427.8} outcome.
        assert (repo / "case-studies/acme-corp.md").is_file()
        assert (repo / "case-studies/won-bid/acme-corp.md").is_file()
        assert "named client" in (repo / "case-studies/acme-corp.md").read_text(
            encoding="utf-8"
        )
        assert "won-bid outcome" in (
            repo / "case-studies/won-bid/acme-corp.md"
        ).read_text(encoding="utf-8")

        # BI-25/26: TWO distinct embedding rows — not one clobbering the
        # other via a shared identity-rel_path owner_id.
        assert len(re_target.rows) == 2
        assert sorted(report.embedded) == [
            "case-studies/acme-corp.md",
            "case-studies/won-bid/acme-corp.md",
        ]

        # BI-28: only the won-bid entry's proposed_change_set row carries
        # source_form_instance_id; the named-client entry keeps the None default.
        assert report.proposed_change_set is not None
        changes = {
            c["concept_path"]: c for c in report.proposed_change_set["changes"]
        }
        assert changes["case-studies/acme-corp.md"]["source_form_instance_id"] is None
        assert changes["case-studies/won-bid/acme-corp.md"]["source_form_instance_id"] == (
            "33333333-3333-4333-8333-333333333333"
        )


# ── {132.27}: the reapply_overrides seam ──────────────────────────────────


class TestOverrideReapply:
    def test_an_injected_override_is_folded_onto_the_staged_output(
        self, env, bundle_dir: Path, repo: Path
    ) -> None:
        from scripts.cocoindex_pipeline.producer.git_sync import ProducerOverride

        draft = env.build_draft("topics/alpha.md", title="Alpha")
        _wire_source(env, {draft.key: draft})

        override = ProducerOverride(
            concept_path="topics/alpha.md",
            field="frontmatter:description",
            value="Human-approved description",
        )

        report = asyncio.run(
            env.flow_def.run_producer_flow(
                pool=object(),
                bundle_dir=bundle_dir,
                repo_path=repo,
                embedder=_fake_embedder,
                overrides=[override],
            )
        )

        assert report.sync_result.staged is True
        staged_content = (repo / "topics/alpha.md").read_text(encoding="utf-8")
        assert "description: Human-approved description" in staged_content
        # The producer's own fresh draft in bundle_dir is untouched by the
        # override — reapply_overrides folds it onto the STAGED repo output
        # only, never the local bundle_dir working copy.
        bundle_content = (bundle_dir / "topics/alpha.md").read_text(encoding="utf-8")
        assert "description: Desc" in bundle_content


# ── _read_bundle_dir: .git-safe reads (ID-132 {132.35} G-DEPLOY-PROOF Defect B) ──
#
# RUN 1 of the {132.35} deploy-proof crashed here: `UnicodeDecodeError: 'utf-8'
# codec can't decode byte 0xe2` reading `.git/**` of the deployed bundle clone.
# A bundle working tree is ALWAYS a git clone (DR-016) — this module's own
# `.git`-less `tmp_path` fixtures (this file's `repo`/`bundle_dir` fixtures
# before this Subtask) never exercised that, the same fixture-blind-spot
# lesson the {132.32} explorer hit (`gitnexus`-cited precedent, commit
# 6c54f26a). Reproduced/fixed against a REAL `git init` + commit repo below —
# the only kind of bundle dir that exists in deployment.


def _commit_all(repo_path: Path, message: str) -> None:
    subprocess.run(["git", "add", "-A"], cwd=repo_path, check=True)
    subprocess.run(
        [
            "git",
            "-c",
            "user.name=test",
            "-c",
            "user.email=test@example.com",
            "commit",
            "--quiet",
            "-m",
            message,
        ],
        cwd=repo_path,
        check=True,
    )


class TestReadBundleDir:
    def test_excludes_git_plumbing_from_a_real_git_backed_bundle(self, repo: Path) -> None:
        (repo / "topic-a.md").write_text("draft body\n", encoding="utf-8")
        _commit_all(repo, "seed")

        output = _read_bundle_dir(repo)

        # Before the fix this line never returns — `.git/objects/**` /
        # `.git/index` are real zlib-compressed binary blobs once a commit
        # exists, and `rglob("*")` + unconditional `read_text(utf-8)` raised
        # UnicodeDecodeError on the first one encountered.
        assert output == {"topic-a.md": "draft body\n"}
        assert not any(
            rel == ".git" or rel.startswith(".git/") for rel in output
        )

    def test_skips_a_hidden_dotfile_alongside_git(self, repo: Path) -> None:
        (repo / "topic-a.md").write_text("draft body\n", encoding="utf-8")
        (repo / ".hidden.md").write_text("hidden\n", encoding="utf-8")
        _commit_all(repo, "seed")

        output = _read_bundle_dir(repo)

        assert output == {"topic-a.md": "draft body\n"}

    def test_skips_a_non_utf8_file_gracefully_rather_than_raising(self, repo: Path) -> None:
        (repo / "topic-a.md").write_text("draft body\n", encoding="utf-8")
        (repo / "binary.bin").write_bytes(b"\xff\xfe\x00binary")

        output = _read_bundle_dir(repo)

        assert output == {"topic-a.md": "draft body\n"}
        assert "binary.bin" not in output


# ─────────────────────────────────────────────────────────────────────────
# ID-427 {427.10} — THE ACCEPTANCE TEST (AC 1)
#
# Written as a corpus fixture, not a unit test, because the claim is about a
# BUNDLE: a corpus deliberately containing both measured holes is run
# end-to-end and both records are present in the emitted bundle, each citing
# its own record, with the run census reporting zero unrouted.
#
# The Source here is the REAL `LRecordsSource` over a fixture pool — not the
# `_FakeSource` the rest of this module uses — because the thing under test
# is the cascade the adapter performs, and a fake that returned pre-built
# keys would be asserting the fixture. Only the Pass-1 model call is stood
# in for, and the stand-in drafts from the rows the Source actually returned,
# which is what Pass-1 does minus the model. The undistilled document's page
# is produced by REAL production code end to end: nothing about
# `render_undistilled_draft` is stubbed, which is only possible because the
# template dispatch lives at the drafting call site rather than inside
# `enrich_concept`.
# ─────────────────────────────────────────────────────────────────────────

_SD_UNDISTILLED = "aaaaaaaa-1111-4111-8111-111111111111"
_SD_ORPHAN_PARENT = "bbbbbbbb-2222-4222-8222-222222222222"
_QA_EMPTY_SCOPE = "cccccccc-3333-4333-8333-333333333333"

_UNDISTILLED_PATH = "documents/07-supplier-code-of-conduct-aaaaaaaa.md"
_ORPHAN_PARENT_PATH = "documents/12-data-retention-bbbbbbbb.md"

_HOLE_2_DOCUMENT = {
    "id": _SD_UNDISTILLED,
    "filename": "07-supplier-code-of-conduct.pdf",
    "logical_path": "structure/07-supplier-code-of-conduct.pdf",
    "content_type": "policy",
    "publication_status": "published",
    "extraction_method": "pdf_text",
    "extracted_text": None,
    "created_at": "2026-02-01T09:00:00Z",
    "updated_at": "2026-02-01T09:00:00Z",
}
_HOLE_1_PARENT_DOCUMENT = {
    "id": _SD_ORPHAN_PARENT,
    "filename": "12-data-retention.docx",
    "logical_path": "structure/12-data-retention.docx",
    "content_type": "policy",
    "publication_status": "published",
    "extraction_method": "docx",
    "extracted_text": None,
    "created_at": "2026-02-02T09:00:00Z",
    "updated_at": "2026-02-03T11:00:00Z",
}
_HOLE_1_PAIR = {
    "id": _QA_EMPTY_SCOPE,
    "question_text": "How long are supplier records retained?",
    "answer_standard": "Seven years from the end of the contract.",
    "scope_tag": [],  # the hole: an EMPTY array, excluded twice by the topic SQL
    "source_document_id": _SD_ORPHAN_PARENT,
    "publication_status": "published",
    "updated_at": "2026-02-03T11:00:00Z",
}


class _BothHolesPool:
    """A corpus carrying both of RESEARCH's measured holes and nothing else.

    Dispatch is by first-matching marker substring, mirroring
    `test_l_records_source.FakePool` — declared here rather than imported so
    this module's acceptance fixture is readable on its own terms. An
    unmatched query raises: that assertion is what would catch the cascade
    quietly asking for something this corpus never described."""

    def __init__(self) -> None:
        self.calls: "list[tuple[str, tuple]]" = []
        self._rules: "list[tuple[str, Any]]" = [
            # ── the six preferred grains find nothing at all: no scope_tag
            # carries a published pair, no entity is mentioned, no
            # company/compliance/named-clients document matches a pattern,
            # no bid was won. Everything below is therefore residue.
            ("AS scope_tag FROM q_a_pairs", []),
            ("t.tag AS tag, count(DISTINCT qa.id)", []),
            ("entity_type = $1 ORDER BY 1", []),
            ("p.canonical_name AS canonical_name", []),
            ("LIMIT 1", []),
            ("em_max FROM source_documents sd", []),
            ("sd_max FROM source_documents sd", []),
            ("count(*) AS em_count, max(updated_at) AS em_max FROM entity_mentions", []),
            ("JOIN source_documents sd ON sd.id = em.source_document_id", []),
            ("c.canonical_name AS canonical_name", []),
            ("COALESCE(issuing_organisation, name) AS buyer", []),
            ("w.form_instance_id AS form_instance_id", []),
            ("SELECT id FROM source_documents WHERE (filename ILIKE", []),
            ("OR scope_tag && $2::text[]", []),
            ("AS q_a_pair_id", []),
            ("source_form_instance_id = ANY($1::uuid[])", []),
            # ── the two TECH §2.1 anti-joins: the whole corpus is residue.
            (
                "FROM source_documents WHERE publication_status = 'published' "
                "AND id <> ALL",
                [_HOLE_2_DOCUMENT, _HOLE_1_PARENT_DOCUMENT],
            ),
            (
                "FROM q_a_pairs WHERE publication_status = 'published' AND id <> ALL",
                [
                    {
                        "id": _QA_EMPTY_SCOPE,
                        "source_document_id": _SD_ORPHAN_PARENT,
                        "source_form_instance_id": None,
                        "updated_at": "2026-02-03T11:00:00Z",
                    }
                ],
            ),
            # ── the pass1/template split, and the document coverage.
            (
                "SELECT id, source_document_id FROM q_a_pairs",
                [{"id": _QA_EMPTY_SCOPE, "source_document_id": _SD_ORPHAN_PARENT}],
            ),
            (
                "AS d(id)",
                [
                    {
                        "source_document_id": _SD_UNDISTILLED,
                        "sd_count": 1,
                        "sd_max": "2026-02-01T09:00:00Z",
                        "qa_count": 0,
                        "qa_max": None,
                        "rl_count": 0,
                        "rl_max": None,
                        "em_count": 0,
                        "em_max": None,
                        "er_count": 0,
                        "er_max": None,
                    },
                    {
                        "source_document_id": _SD_ORPHAN_PARENT,
                        "sd_count": 1,
                        "sd_max": "2026-02-03T11:00:00Z",
                        "qa_count": 1,
                        "qa_max": "2026-02-03T11:00:00Z",
                        "rl_count": 0,
                        "rl_max": None,
                        "em_count": 0,
                        "em_max": None,
                        "er_count": 0,
                        "er_max": None,
                    },
                ],
            ),
            # ── the corpus totals the census compares coverage against.
            (
                "count(*) FROM source_documents WHERE publication_status",
                [{"source_documents": 2, "q_a_pairs": 1}],
            ),
            # ── the residual document read grid (TECH §2.3).
            # ID-427 {427.15} / DR-143: the by-ids read gained
            # `AND publication_status = 'published'`, so the old marker
            # (`... ANY($1::uuid[]) ORDER BY id`) stopped matching — the two
            # clauses are no longer adjacent. The marker now carries the
            # predicate, which also makes it match
            # `_SQL_PUBLISHED_SOURCE_DOCUMENTS_BY_IDS` (the residual
            # cascade's step-2 join): the two queries now differ only in
            # their SELECT list, and `_by_document_id` returns whole rows, so
            # one rule serves both correctly.
            (
                "FROM source_documents WHERE id = ANY($1::uuid[]) "
                "AND publication_status = 'published' ORDER BY id",
                _by_document_id,
            ),
            (
                "FROM q_a_pairs WHERE source_document_id = ANY($1::uuid[]) "
                "AND publication_status",
                _published_pairs_for,
            ),
            ("FROM record_lifecycle", []),
            ("FROM entity_mentions WHERE source_document_id = ANY", []),
            ("FROM entity_relationships WHERE source_document_id = ANY", []),
        ]

    async def fetch(self, query: str, *args: object) -> "list[dict]":
        self.calls.append((query, args))
        for marker, rows in self._rules:
            if marker in query:
                return rows(args) if callable(rows) else rows
        raise AssertionError(f"_BothHolesPool: no rule for {query!r} args={args!r}")


def _by_document_id(args) -> "list[dict]":
    wanted = {str(i) for i in args[0]}
    return [
        row
        for row in (_HOLE_2_DOCUMENT, _HOLE_1_PARENT_DOCUMENT)
        if str(row["id"]) in wanted
    ]


def _published_pairs_for(args) -> "list[dict]":
    wanted = {str(i) for i in args[0]}
    return [_HOLE_1_PAIR] if str(_SD_ORPHAN_PARENT) in wanted else []


def _wire_real_source_with_stubbed_pass1(env) -> None:
    """The REAL `LRecordsSource` over `_BothHolesPool`, with only the model
    call stood in for.

    The stand-in reads the concept's own rows through the Source and drafts
    from THEM — citing the document anchor the tool result would have carried
    and quoting the question it was actually shown. That is Pass-1 minus the
    model, so "the pair is present in the emitted bundle" is a claim about
    the bundle rather than about a hand-built fixture draft."""

    async def _fake_enrich(key: Any, source: Any) -> Any:
        raw = await source.read_concept(key)
        anchor = env.enrich.build_source_document_uri(
            raw.source_documents[0]["id"]
        )
        sources = env.enrich.sources_from_citations([anchor])
        questions = " ".join(row["question_text"] for row in raw.q_a_pairs)
        body = (
            f"Published answers distilled from this document. {questions}\n\n"
            f"{env.enrich.render_source_footnotes(sources)}"
        )
        return env.enrich.ConceptDraft(
            key=key,
            frontmatter=env.enrich.build_concept_frontmatter(
                type=key.concept_type,
                title="Data retention",
                description="What the retention policy says.",
                generated_by="kh-concept-producer/test-model-1",
                generated_at="2026-02-03T11:00:00Z",
                sources=sources,
            ),
            body=body,
            primary_anchor=anchor,
        )

    env.monkeypatch.setattr(env.enrich, "enrich_concept", _fake_enrich)


class TestBothMeasuredHolesLandInTheBundle:
    """**AC 1 — the headline of the whole id-427 programme.**

    Before this, a published `source_document` from which nothing was
    distilled, and a published `q_a_pair` with an empty `scope_tag`, were
    each reachable in NO concept — and nothing in the producer could say so.
    A reader who did not find an answer could not tell "the corpus does not
    hold this" from "the producer did not route it"."""

    @pytest.fixture()
    def run(self, env, bundle_dir: Path):
        # Deliberately NOT patching `LRecordsSource` — the real adapter is
        # the thing under test.
        _wire_real_source_with_stubbed_pass1(env)
        return asyncio.run(
            env.flow_def.run_producer_flow(
                pool=_BothHolesPool(),
                bundle_dir=bundle_dir,
                timestamp="2026-08-10T12:00:00Z",
            )
        )

    def test_both_records_are_present_in_the_emitted_bundle(
        self, run, bundle_dir: Path
    ) -> None:
        undistilled = bundle_dir / _UNDISTILLED_PATH
        distilled = bundle_dir / _ORPHAN_PARENT_PATH

        # Hole 2 — the published document nothing was distilled from.
        assert undistilled.is_file()
        # Hole 1 — the published pair with an empty scope_tag, reachable
        # through its parent document's concept. Its own words are on the
        # page, which is what "present in the bundle" has to mean.
        assert distilled.is_file()
        assert "How long are supplier records retained?" in distilled.read_text()

    def test_each_concept_cites_its_own_record(self, run, bundle_dir: Path) -> None:
        undistilled = (bundle_dir / _UNDISTILLED_PATH).read_text()
        distilled = (bundle_dir / _ORPHAN_PARENT_PATH).read_text()

        assert f"canonical://source_documents/{_SD_UNDISTILLED}" in undistilled
        assert f"canonical://source_documents/{_SD_ORPHAN_PARENT}" in distilled
        # …and no concept cites the other's record.
        assert _SD_ORPHAN_PARENT not in undistilled
        assert _SD_UNDISTILLED not in distilled

    def test_the_run_census_reports_zero_unrouted(self, run, bundle_dir: Path) -> None:
        """The number the run itself prints. `unrouted_total == 0` over a
        corpus made ENTIRELY of the two holes is the whole acceptance: the
        residual grain did not merely add pages, it drove the measured gap
        between corpus and bundle to nothing."""
        assert run.summary.census.considered == (
            ("source_documents", 2),
            ("q_a_pairs", 1),
        )
        assert run.summary.census.routed == (("source_documents", 2), ("q_a_pairs", 1))
        assert run.summary.census.unrouted == ()
        assert run.summary.census.unrouted_total == 0

        log = (bundle_dir / "log.md").read_text()
        assert (
            "Considered (2):** source_documents 2 (routed 2), q_a_pairs 1 (routed 1)"
            in log
        )
        assert "Unrouted" not in log

    def test_the_undistilled_page_is_the_template_render_byte_for_byte(
        self, run, bundle_dir: Path, env
    ) -> None:
        """*"assert the emitted body equals the template render, proving the
        agent loop was not entered"* — and it proves more than that: the
        emitted FILE equals the render, so nothing between the renderer and
        the disk altered a word either. Pass-2 is skipped for this grain on
        the same ground Pass-1 is."""
        source = env.l_records.LRecordsSource(_BothHolesPool())
        keys = asyncio.run(source.list_concepts())
        key = next(k for k in keys if k.rel_path == _UNDISTILLED_PATH)
        raw = asyncio.run(source.read_concept(key))

        expected = env.enrich.render_undistilled_draft(key, raw)

        assert (bundle_dir / _UNDISTILLED_PATH).read_text() == expected.rendered_markdown

    def test_the_undistilled_page_escalates_rather_than_inventing(
        self, run, bundle_dir: Path
    ) -> None:
        page = (bundle_dir / _UNDISTILLED_PATH).read_text()

        assert "Escalate to a subject-matter expert." in page
        assert "confidence: no-content" in page
        assert "type: document" in page

    def test_both_holes_appear_in_the_run_summary_as_added(self, run) -> None:
        """Not silently written: the run log names them. `write_bundle`
        classifies both as `added`, which is what carries them into the
        `log.md` diff a reader actually sees."""
        assert set(run.summary.added) == {_UNDISTILLED_PATH, _ORPHAN_PARENT_PATH}
        assert run.summary.validator_failures == ()
        assert run.summary.failed == ()

    def test_the_new_directory_is_navigable(self, run, bundle_dir: Path) -> None:
        """id-429 IA-1/IA-5, exercised: `documents/` is a directory the
        bundle has never had, so the index machinery meets a residual-grain
        directory here for the first time. TECH §2.4 argued that id-429 Q2 is
        *answered, not carried*, because the residual directory names are
        readable words — this runs D6's sentence-casing over one and checks
        the answer.

        The BUNDLE-ROOT index is deliberately not asserted to carry a
        `Directories` entry: `build_directory_indexes` documents the root as
        still listing every concept until {429.6} lands (a root of directory
        entries renders an empty nav rail, because `parseBundleNav` drops any
        bullet whose target is not `.md`). Both concepts are reachable from
        the root today, which is what this asserts instead."""
        index = bundle_dir / "documents" / "index.md"
        assert index.is_file()
        assert index.read_text().startswith("# Documents\n")
        # …and the concept links inside it are directory-relative (D5).
        assert "](07-supplier-code-of-conduct-aaaaaaaa.md)" in index.read_text()

        root = (bundle_dir / "index.md").read_text()
        assert f"]({_UNDISTILLED_PATH})" in root
        assert f"]({_ORPHAN_PARENT_PATH})" in root

    def test_the_run_is_not_a_no_op(self, run) -> None:
        assert run.summary.is_no_op is False


class TestTheResidualQuestionnaireCarriesBI28Provenance:
    """**PQ-3 / TQ-3, RULED S546** — *"yes: carry `form_instance_id`
    provenance on residual `questionnaire_response` concepts. The attribution
    key IS the form instance (cascade step 2), so the value is already in
    hand; two grains attributing by the same key carry the same provenance
    shape."*

    The ruling lands by CONSTRUCTION rather than by a new code path:
    `flow_def` builds its BI-28 map from every enumerated key whose
    `form_instance_id` is set, and the residual questionnaire grain sets that
    same locator. This test is what makes that free ride load-bearing — the
    only thing standing between the ruling and a silent regression is that
    the residual grain keeps using the field rather than inventing its own."""

    def test_a_residual_questionnaire_concept_is_stamped_with_its_form_instance(
        self, env, bundle_dir: Path, repo: Path
    ) -> None:
        form_instance = "55555555-5555-4555-8555-555555555555"
        residual = env.build_draft(
            "questionnaire-responses/pqq-2026-55555555.md",
            title="PQQ 2026",
            concept_type="questionnaire_response",
            form_instance_id=form_instance,
            grain="residual_questionnaire_response",
        )
        ordinary = env.build_draft("topics/alpha.md", title="Alpha")
        _wire_source(env, {residual.key: residual, ordinary.key: ordinary})

        report = asyncio.run(
            env.flow_def.run_producer_flow(
                pool=object(), bundle_dir=bundle_dir, repo_path=repo
            )
        )

        changes = {c["concept_path"]: c for c in report.proposed_change_set["changes"]}
        assert changes["questionnaire-responses/pqq-2026-55555555.md"][
            "source_form_instance_id"
        ] == form_instance
        assert changes["topics/alpha.md"]["source_form_instance_id"] is None


class TestATemplateGrainEntersNeitherPass:
    """TECH §2.3's *"bypassing the agent loop entirely"*, and its
    consequence for Pass-2.

    Pass-1 is skipped because there is no published answer to distil. Pass-2
    is skipped on the same ground, and that is not an extension of the
    ruling but its precondition: a gated-web research pass over a document
    nobody has read produces exactly the plausible prose PI-4 rejects, and it
    would do it to the one page whose whole value is that every sentence is
    derivable from the record."""

    def test_neither_pass_runs_for_a_template_grain(self, env) -> None:
        from scripts.cocoindex_pipeline.sources.base import (  # noqa: PLC0415
            ConceptKey,
            ConceptRaw,
            GrainSpec,
        )

        sd_id = "66666666-6666-4666-8666-666666666666"
        key = ConceptKey(
            rel_path="documents/unread-66666666.md",
            concept_type="document",
            grain="residual_document_undistilled",
            source_document_id=sd_id,
        )
        raw = ConceptRaw(
            source_documents=[
                {
                    "id": sd_id,
                    "filename": "unread.pdf",
                    "logical_path": None,
                    "content_type": "policy",
                    "extraction_method": "pdf_text",
                    "created_at": "2026-04-01T00:00:00Z",
                    "updated_at": "2026-04-01T00:00:00Z",
                }
            ]
        )

        async def _unused(*_args: Any, **_kwargs: Any) -> Any:
            raise AssertionError(
                "a template grain must reach neither Pass-1 nor Pass-2"
            )

        class _TemplateSource:
            def grain_for(self, _key: Any) -> Any:
                return GrainSpec(
                    name="residual_document_undistilled",
                    directory="documents",
                    type_label="document",
                    list=_unused,
                    read=_unused,
                    sample=_unused,
                    drafts_via="template",
                    runs_last=True,
                )

            async def read_concept(self, _key: Any) -> Any:
                return raw

        drafts, _refs, failures, pass2_ran, failed = asyncio.run(
            _draft_concepts(
                [key],
                _TemplateSource(),
                enrich_concept=_unused,
                # A gated corpus IS configured — the ordinary trigger for
                # Pass-2 — so the skip is a decision, not an absence.
                gated_corpus=object(),
                run_web_pass=_unused,
                http_client=None,
            )
        )

        assert failures == [] and failed == []
        assert pass2_ran is False
        assert len(drafts) == 1
        assert drafts[0].body == env.enrich.render_undistilled_draft(key, raw).body

    def test_a_pass1_grain_still_reaches_the_agent_loop(self, env) -> None:
        """The negative control: the same dispatcher, one field different,
        and the loop IS entered. Without this the test above would pass just
        as well against a `_draft_concepts` that had stopped drafting
        anything."""
        from scripts.cocoindex_pipeline.sources.base import (  # noqa: PLC0415
            ConceptKey,
            GrainSpec,
        )

        key = ConceptKey(
            rel_path="topics/alpha.md",
            concept_type="topic",
            grain="topic_scope_tag",
            scope_tag="alpha",
        )
        entered: "list[Any]" = []

        async def _unused(*_args: Any, **_kwargs: Any) -> Any:  # pragma: no cover
            raise AssertionError("unreachable")

        class _Pass1Source:
            def grain_for(self, _key: Any) -> Any:
                return GrainSpec(
                    name="topic_scope_tag",
                    directory="topics",
                    type_label="topic",
                    list=_unused,
                    read=_unused,
                    sample=_unused,
                )

        async def _enrich(k: Any, _source: Any) -> Any:
            entered.append(k)
            return env.build_draft("topics/alpha.md", title="Alpha")

        drafts, _refs, failures, _pass2, _failed = asyncio.run(
            _draft_concepts(
                [key],
                _Pass1Source(),
                enrich_concept=_enrich,
                gated_corpus=None,
                run_web_pass=_unused,
                http_client=None,
            )
        )

        assert entered == [key]
        assert failures == [] and len(drafts) == 1

    def test_a_source_with_no_grain_registry_is_unaffected(self, env) -> None:
        """`RepoDocsSource` has no `grain_for`, and the dispatch must leave
        it exactly where it was — the duck-typed posture
        `enrich._samples_source_documents` already takes toward the two
        concept models."""
        assert (
            env.flow_def._drafts_via_template(object(), object()) is False
        )
