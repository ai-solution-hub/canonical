"""Tests for producer/flow_def.py — ID-132 {132.23} G-FLOWDEF: the FULL
producer flow composed as ONE entry point.

Per the {132.23} testStrategy: a full producer run over a Source fixture
writes concept files (BI-11), one record_embeddings row per concept
(BI-26), and exactly ONE gated git commit (BI-21 green) via the ONE composed
flow_def — not the trigger.py Pass-1-only stand-in. Idle mode (unset
OKF_BUNDLE_DIR) still no-ops. Owner ruling (S456): a log.md-only diff is a
no-op — no commit.

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


def _green_status() -> Any:
    from scripts.cocoindex_pipeline.producer.publish import SeedContractCheckResult

    return SeedContractCheckResult(is_green=True, detail="test-green")


def _red_status() -> Any:
    from scripts.cocoindex_pipeline.producer.publish import SeedContractCheckResult

    return SeedContractCheckResult(is_green=False, detail="test-red")


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

        def build_draft(rel_path: str, *, title: str = "Alpha") -> Any:
            key = l_records.ConceptKey(
                rel_path=rel_path, concept_type="topic", scope_tag=rel_path
            )
            resource = resource_uri.build_source_document_uri(_SAMPLE_UUID)
            body = (
                f"A distilled synthesis about {title}.\n\n"
                "# Citations\n"
                f"- {resource}\n"
            )
            frontmatter_obj = frontmatter.build_concept_frontmatter(
                type="topic",
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


# ── The G-FLOWDEF testStrategy: full run writes files, embeds, one commit ──


class TestFullRun:
    def test_writes_files_embeds_one_row_per_concept_and_one_commit(
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
                [{"id": "sd-1"}],
                pool=object(),
                bundle_dir=bundle_dir,
                re_target=re_target,
                repo_path=repo,
                status_source=_green_status,
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

        # BI-21 green: exactly ONE gated git commit.
        assert _commit_count(repo) == 1
        assert report.committed is True
        assert report.sync_result.commit_sha == _git(repo, "rev-parse", "HEAD").strip()
        # The concept files landed in the client-owned repo, not just the work dir.
        assert (repo / "topics/alpha.md").is_file()


# ── Idle-mode safety (preserved from {132.16}) ──────────────────────────


class TestIdleMode:
    def test_idle_when_bundle_dir_unset(
        self, env, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.delenv("OKF_BUNDLE_DIR", raising=False)
        result = asyncio.run(env.flow_def.run_producer_flow([{"id": "sd-1"}], pool=object()))
        assert result is None

    def test_idle_when_bundle_dir_missing_folder(
        self, env, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        monkeypatch.setenv("OKF_BUNDLE_DIR", str(tmp_path / "does-not-exist"))
        result = asyncio.run(env.flow_def.run_producer_flow([{"id": "sd-1"}], pool=object()))
        assert result is None

    def test_idle_when_no_pool(self, env, bundle_dir: Path) -> None:
        result = asyncio.run(
            env.flow_def.run_producer_flow([{"id": "sd-1"}], bundle_dir=bundle_dir, pool=None)
        )
        assert result is None


# ── Owner ruling S456: a log.md-only diff is a no-op — no commit ─────────


class TestNoOpLogOnlyRuling:
    def test_second_identical_run_makes_no_new_commit(
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
                    [{"id": "sd-1"}],
                    pool=object(),
                    bundle_dir=bundle_dir,
                    re_target=_FakeRecordEmbeddingsTarget(),
                    repo_path=repo,
                    status_source=_green_status,
                    embedder=_fake_embedder,
                    timestamp="2026-07-08T00:00:00Z",
                )
            )

        first = run()
        assert first.committed is True
        assert _commit_count(repo) == 1

        second = run()
        # Every concept byte-identical → RunSummary.is_no_op → the ONLY diff
        # would be log.md's new stamp → no commit (S456).
        assert second.summary.is_no_op is True
        assert second.committed is False
        assert second.sync_result is None
        assert _commit_count(repo) == 1


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
                [{"id": "sd-1"}],
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
                [{"id": "sd-1"}],
                pool=object(),
                bundle_dir=bundle_dir,
            )
        )
        assert (bundle_dir / "topics/alpha.md").is_file()
        assert report.embedded == ()

    def test_red_status_aborts_publish_with_no_commit(
        self, env, bundle_dir: Path, repo: Path
    ) -> None:
        from scripts.cocoindex_pipeline.producer.publish import PublishAbortedError

        draft = env.build_draft("topics/alpha.md", title="Alpha")
        _wire_source(env, {draft.key: draft})

        with pytest.raises(PublishAbortedError):
            asyncio.run(
                env.flow_def.run_producer_flow(
                    [{"id": "sd-1"}],
                    pool=object(),
                    bundle_dir=bundle_dir,
                    repo_path=repo,
                    status_source=_red_status,
                    embedder=_fake_embedder,
                )
            )
        # BI-21 hard gate: a red gate leaves the client-owned repo untouched.
        assert _commit_count(repo) == 0


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
                [{"id": "sd-1"}],
                pool=object(),
                bundle_dir=bundle_dir,
                re_target=re_target,
                repo_path=repo,
                status_source=_green_status,
                embedder=_fake_embedder,
            )
        )

        assert (bundle_dir / "topics/good.md").is_file()
        assert not (bundle_dir / "topics/bad.md").exists()
        assert report.committed is True
        assert _commit_count(repo) == 1


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
                [{"id": "sd-1"}],
                pool=object(),
                bundle_dir=bundle_dir,
                gated_corpus=object(),
            )
        )

        assert report.pass2_ran is True
        assert report.reference_paths == ("references/iso-27001.md",)
        assert (bundle_dir / "references/iso-27001.md").is_file()
