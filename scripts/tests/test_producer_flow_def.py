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
`git_sync.reapply_overrides`; and a `concept_path -> workspace_id` BI-28
provenance map, built here from every won-bid `case_study` ConceptKey this
run enumerated, stamps `source_workspace_id` onto the emitted
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
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

_REPO_ROOT = Path(__file__).resolve().parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from conftest import make_cocoindex_stubs, stubbed_sys_modules  # noqa: E402
from scripts.cocoindex_pipeline.producer.flow_def import _read_bundle_dir  # noqa: E402

_SAMPLE_UUID = "11111111-1111-4111-8111-111111111111"
_EMBEDDING = [0.1] * 1024


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
            workspace_id: "str | None" = None,
        ) -> Any:
            key_kwargs: "dict[str, Any]" = {
                "rel_path": rel_path,
                "concept_type": concept_type,
            }
            if concept_type == "topic":
                key_kwargs["scope_tag"] = rel_path
            else:
                key_kwargs["entity_id"] = entity_id or title
                if workspace_id is not None:
                    key_kwargs["workspace_id"] = workspace_id
            key = l_records.ConceptKey(**key_kwargs)
            resource = resource_uri.build_source_document_uri(_SAMPLE_UUID)
            body = (
                f"A distilled synthesis about {title}.\n\n"
                "# Citations\n"
                f"- {resource}\n"
            )
            frontmatter_obj = frontmatter.build_concept_frontmatter(
                type=concept_type,
                title=title,
                description="Desc",
                timestamp="2026-07-08T00:00:00Z",
                tags=("tag",),
                resource=resource,
            )
            return enrich.ConceptDraft(key=key, frontmatter=frontmatter_obj, body=body)

        yield SimpleNamespace(
            flow_def=flow_def,
            bundle_writer=bundle_writer,
            enrich=enrich,
            web_pass=web_pass,
            l_records=l_records,
            build_draft=build_draft,
            monkeypatch=monkeypatch,
        )


def _wire_source(env, drafts_by_key: "dict[Any, Any]") -> None:
    """Patch `LRecordsSource` with a fake whose `list_concepts` returns the
    fixture keys, and `enrich_concept` with a fake returning each key's
    pre-built draft (no real Anthropic call)."""
    keys = list(drafts_by_key)

    class _FakeSource:
        def __init__(self, pool: Any) -> None:
            self.pool = pool

        async def list_concepts(self):
            return keys

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

        # The machine-readable proposed_change_set (DR-013 shape) is emitted.
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
        self, env, bundle_dir: Path
    ) -> None:
        """OV-4 (ID-132 {132.34} G-OVERLAY-CV): a REAL `run_producer_flow`
        run — not only a direct `write_bundle` unit call — exercises the
        overlay READ end-to-end. The sole production caller
        (`flow_def.py:379-385`) never explicitly supplies
        `client_ontology_overlay`; composing an overlay for a real run
        depends entirely on `write_bundle`'s own bundle_dir read."""
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
        assert ontology["base"]["concept_types"]  # OV-6a: three-dimension base

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
        aborted)."""
        monkeypatch.delenv("OKF_CLIENT_ID", raising=False)
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
        client-authored overlay term mints under the client namespace."""
        monkeypatch.setenv("OKF_CLIENT_ID", "acme")
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
            rel_path="topics/bad.md", concept_type="topic", scope_tag="bad"
        )

        class _FakeSource:
            def __init__(self, pool: Any) -> None:
                self.pool = pool

            async def list_concepts(self):
                return [bad_key, good.key]

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
# source_workspace_id."


class TestBI28StagingProvenance:
    def test_a_won_bid_run_lands_staging_and_stamps_source_workspace_id(
        self, env, bundle_dir: Path, repo: Path
    ) -> None:
        won_bid_draft = env.build_draft(
            "case-studies/acme-corp.md",
            title="Acme Corp",
            concept_type="case_study",
            workspace_id="22222222-2222-4222-8222-222222222222",
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
        # {132.29}: a won-bid case_study draft's PHYSICAL write path is
        # redirected into a `won-bid/` sibling directory, distinct from its
        # identity rel_path — this is what actually lands in the client-owned
        # repo (bundle_writer.bundle_write_path's redirect rule).
        assert (repo / "case-studies/won-bid/acme-corp.md").is_file()
        assert not (repo / "case-studies/acme-corp.md").exists()

        # BI-25/26 ({132.29} checker-FAIL regression): the won-bid concept
        # still gets its embedding row — an identity-rel_path-keyed lookup
        # would silently miss it, since write_bundle's RunSummary reports the
        # PHYSICAL (redirected) path, not the identity rel_path.
        assert len(re_target.rows) == 2
        assert sorted(report.embedded) == [
            "case-studies/won-bid/acme-corp.md",
            "topics/alpha.md",
        ]

        # The proposed_change_set's won-bid entry carries source_workspace_id
        # (BI-28), keyed by the PHYSICAL (redirected) path — an identity-keyed
        # provenance map would never match a redirected won-bid entry here.
        assert report.proposed_change_set is not None
        changes = {
            c["concept_path"]: c for c in report.proposed_change_set["changes"]
        }
        assert changes["case-studies/won-bid/acme-corp.md"]["source_workspace_id"] == (
            "22222222-2222-4222-8222-222222222222"
        )
        assert changes["topics/alpha.md"]["source_workspace_id"] is None

    def test_same_slug_collision_embeds_the_correct_bodies_and_provenance(
        self, env, bundle_dir: Path, repo: Path
    ) -> None:
        """{132.29} regression: a named-client and a won-bid `case_study`
        concept sharing the IDENTICAL identity `rel_path` (the cross-grain
        slug collision bundle_writer's `won-bid/` redirect exists to solve)
        must each get their OWN embedding row with the CORRECT body — an
        identity-rel_path-keyed embed lookup would collide both concepts onto
        the SAME `record_embeddings` natural key (BI-26's `concept_owner_id`
        is a pure hash of whatever string it is given) and could let the
        second `declare_row` silently clobber the first with the wrong body.
        Only the won-bid entry's `proposed_change_set` row may carry
        `source_workspace_id` (BI-28)."""
        named_client_draft = env.build_draft(
            "case-studies/acme-corp.md",
            title="Acme Corp (named client)",
            concept_type="case_study",
        )
        won_bid_draft = env.build_draft(
            "case-studies/acme-corp.md",
            title="Acme Corp (won-bid outcome)",
            concept_type="case_study",
            workspace_id="33333333-3333-4333-8333-333333333333",
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

        # Both grains land at DISTINCT physical paths (bundle_writer's own
        # {132.29} redirect) despite sharing one identity rel_path — no
        # ValueError collision, and no on-disk clobber.
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
        # source_workspace_id; the named-client entry keeps the None default.
        assert report.proposed_change_set is not None
        changes = {
            c["concept_path"]: c for c in report.proposed_change_set["changes"]
        }
        assert changes["case-studies/acme-corp.md"]["source_workspace_id"] is None
        assert changes["case-studies/won-bid/acme-corp.md"]["source_workspace_id"] == (
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
