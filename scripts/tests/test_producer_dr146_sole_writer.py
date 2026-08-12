"""DR-146 (id-448): `git_sync` is the sole writer of the bundle tree.

The contract these tests pin, from the decision record:

  - `write_bundle` is pure content computation — it registers NO bundle path
    as an engine target state and performs NO physical write of its own. Its
    complete output is `RunSummary.declared`.
  - `git_sync` owns every physical write. The deployed shape goes through
    `sync_bundle` (3-way reconcile); the non-git shape (tests, any caller
    with no `repo_path`) goes through the plain `write_tree` pass, which the
    deployed shape must never take — enforced structurally by `write_tree`
    refusing a git-repository target.
  - A stale per-directory `index.md` (its directory lost its last concept)
    must reach the removal channel explicitly (`RunSummary.removed_indexes`).
    Under the declaration model the engine's orphan-delete cleaned it up;
    with no declarations, an unreported stale index would linger forever.
  - A no-op run's BI-11 `log.md` stamp still lands in the working tree,
    unstaged (owner ruling S456), via `write_noop_log_stamp`.

De-identified throughout — placeholder names only.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path
from unittest.mock import MagicMock

import pytest

_REPO_ROOT = Path(__file__).resolve().parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from conftest import stubbed_sys_modules  # noqa: E402

from scripts.cocoindex_pipeline.producer import git_sync  # noqa: E402


def _make_coco_stub() -> MagicMock:
    stub = MagicMock(name="cocoindex")

    def _fn_decorator(**kwargs: object):
        def _wrap(func: object) -> object:
            func.__coco_fn_kwargs__ = dict(kwargs)  # type: ignore[attr-defined]
            return func

        return _wrap

    stub.fn = _fn_decorator
    return stub


with stubbed_sys_modules(
    {
        "cocoindex": _make_coco_stub(),
        "cocoindex.connectors.localfs": MagicMock(
            name="cocoindex.connectors.localfs"
        ),
    }
):
    from scripts.cocoindex_pipeline.producer import bundle_writer  # noqa: E402

from scripts.cocoindex_pipeline.producer.enrich import ConceptDraft  # noqa: E402
from scripts.cocoindex_pipeline.producer.frontmatter import (  # noqa: E402
    build_concept_frontmatter,
    render_source_footnotes,
    sources_from_citations,
)
from scripts.cocoindex_pipeline.producer.resource_uri import (  # noqa: E402
    build_source_document_uri,
)
from scripts.cocoindex_pipeline.sources.base import ConceptKey  # noqa: E402

_SAMPLE_UUID = "11111111-1111-4111-8111-111111111111"
_SD_URI = build_source_document_uri(_SAMPLE_UUID)


def _draft(rel_path: str, *, title: str = "Title") -> ConceptDraft:
    key = ConceptKey(
        rel_path=rel_path,
        concept_type="topic",
        grain="topic_scope_tag",
        scope_tag=rel_path,
    )
    sources = sources_from_citations([_SD_URI])
    body = (
        f"A distilled synthesis about {title}.\n\n"
        f"{render_source_footnotes(sources)}"
    )
    return ConceptDraft(
        key=key,
        frontmatter=build_concept_frontmatter(
            type="topic",
            title=title,
            description="Desc",
            generated_by="kh-concept-producer/test-model-1",
            generated_at="2026-07-08T00:00:00Z",
            tags=("tag",),
            sources=sources,
        ),
        body=body,
        primary_anchor=_SD_URI,
    )


def _tree(root: Path) -> "set[str]":
    return {
        p.relative_to(root).as_posix() for p in root.rglob("*") if p.is_file()
    }


# ─────────────────────────────────────────────────────────────────────────
# write_bundle is pure content computation
# ─────────────────────────────────────────────────────────────────────────


class TestWriteBundleIsPureComputation:
    def test_write_bundle_writes_no_files_and_declares_no_target_state(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """DR-146 AC-1 (unit half): a run performs no physical write and no
        engine declaration; everything it produced is in `.declared`."""

        forbidden = MagicMock(name="localfs")
        forbidden.declare_file = MagicMock(
            side_effect=AssertionError(
                "DR-146: write_bundle must not declare engine target state"
            )
        )
        # `raising=False`: once DR-146 lands, bundle_writer no longer has a
        # `localfs` attribute at all — the sentinel then guards nothing and
        # the disk assertion below carries the proof.
        monkeypatch.setattr(bundle_writer, "localfs", forbidden, raising=False)

        summary = bundle_writer.write_bundle(tmp_path, [_draft("topics/alpha.md")])

        assert _tree(tmp_path) == set()
        assert "topics/alpha.md" in summary.declared
        assert "topics/index.md" in summary.declared
        assert "index.md" in summary.declared
        assert "log.md" in summary.declared
        assert "ontology.json" in summary.declared
        assert "context.jsonld" in summary.declared

    def test_two_run_classification_still_reads_the_written_tree(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The added/changed/unchanged diff keeps working when the tree is
        landed by the git layer between runs (production ordering)."""
        monkeypatch.setattr(
            bundle_writer, "localfs", MagicMock(name="localfs"), raising=False
        )
        first = bundle_writer.write_bundle(tmp_path, [_draft("topics/alpha.md")])
        assert first.added == ("topics/alpha.md",)

        git_sync.write_tree(tmp_path, dict(first.declared))

        second = bundle_writer.write_bundle(tmp_path, [_draft("topics/alpha.md")])
        assert second.added == ()
        assert second.unchanged == ("topics/alpha.md",)


class TestStaleIndexRemoval:
    def test_directory_losing_its_last_concept_reports_its_index_removed(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """id-448: with no engine orphan-delete, the stale nested `index.md`
        must reach the removal channel explicitly."""
        monkeypatch.setattr(
            bundle_writer, "localfs", MagicMock(name="localfs"), raising=False
        )
        first = bundle_writer.write_bundle(
            tmp_path, [_draft("topics/alpha.md"), _draft("guides/beta.md")]
        )
        git_sync.write_tree(tmp_path, dict(first.declared))

        second = bundle_writer.write_bundle(tmp_path, [_draft("guides/beta.md")])

        assert second.removed == ("topics/alpha.md",)
        assert second.removed_indexes == ("topics/index.md",)
        # And a removal-only run is not a no-op — sync must run to delete.
        assert second.is_no_op is False

    def test_a_directory_kept_alive_by_a_reaffirmed_concept_keeps_its_index(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A validator-rejected (or transiently failed) concept's file is
        reaffirmed — kept alive at its last-good bytes — so the directory
        still holds a producer concept, and its index must NOT be routed to
        removal. Diffing against `written` alone deleted the index while the
        reaffirmation channel saved the concept (found by the W4 migration's
        two-run probe)."""
        monkeypatch.setattr(
            bundle_writer, "localfs", MagicMock(name="localfs"), raising=False
        )
        first = bundle_writer.write_bundle(
            tmp_path, [_draft("topics/alpha.md"), _draft("guides/only.md")]
        )
        git_sync.write_tree(tmp_path, dict(first.declared))

        # Run 2: guides/only.md drafts but fails the BI-13 gate — a
        # shape-invalid `type` label (hyphens are not snake_case, DR-141).
        good_shape = _draft("guides/only.md")
        bad = type(good_shape)(
            key=good_shape.key,
            frontmatter=build_concept_frontmatter(
                type="not-a-valid-label",
                title="Only",
                description="Desc",
                generated_by="kh-concept-producer/test-model-1",
                generated_at="2026-07-08T00:00:00Z",
                tags=("tag",),
                sources=sources_from_citations([_SD_URI]),
            ),
            body=good_shape.body,
            primary_anchor=good_shape.primary_anchor,
        )
        second = bundle_writer.write_bundle(tmp_path, [_draft("topics/alpha.md"), bad])

        assert second.validator_failures  # the rejection really happened
        assert "guides/only.md" in second.declared  # reaffirmed last-good
        assert second.removed == ()
        assert second.removed_indexes == ()

    def test_untouched_foreign_directory_index_is_not_removed(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A hand-authored index in a directory the producer never populated
        (§8 permits one anywhere) is not the producer's to remove."""
        monkeypatch.setattr(
            bundle_writer, "localfs", MagicMock(name="localfs"), raising=False
        )
        (tmp_path / "notes").mkdir()
        (tmp_path / "notes/index.md").write_text("# Human notes\n", encoding="utf-8")

        summary = bundle_writer.write_bundle(tmp_path, [_draft("topics/alpha.md")])

        assert summary.removed_indexes == ()


# ─────────────────────────────────────────────────────────────────────────
# The non-git write pass (write_tree) — and its structural guard
# ─────────────────────────────────────────────────────────────────────────


class TestWriteTree:
    def test_writes_content_and_deletes_removed_paths(self, tmp_path: Path) -> None:
        (tmp_path / "stale.md").write_text("old\n", encoding="utf-8")

        git_sync.write_tree(
            tmp_path,
            {"topics/alpha.md": "alpha\n", "index.md": "# Bundle\n"},
            removed_paths=("stale.md",),
        )

        assert (tmp_path / "topics/alpha.md").read_text(encoding="utf-8") == "alpha\n"
        assert (tmp_path / "index.md").read_text(encoding="utf-8") == "# Bundle\n"
        assert not (tmp_path / "stale.md").exists()

    def test_refuses_a_git_repository_target(self, tmp_path: Path) -> None:
        """The deployed shape (`bundle_dir == repo_path`, a git clone) must
        never take the plain write pass — its writes bypass the 3-way
        human-edit reconcile. Structural, not conventional."""
        subprocess.run(["git", "init", "--quiet"], cwd=tmp_path, check=True)

        with pytest.raises(git_sync.GitSyncError):
            git_sync.write_tree(tmp_path, {"topics/alpha.md": "alpha\n"})

        assert not (tmp_path / "topics/alpha.md").exists()


class TestNoopLogStamp:
    def test_lands_the_log_content_in_the_tree(self, tmp_path: Path) -> None:
        """Owner ruling S456: a no-op run's BI-11 stamp lands in the working
        tree (unstaged) so it rides into the next real run's commit."""
        subprocess.run(["git", "init", "--quiet"], cwd=tmp_path, check=True)

        git_sync.write_noop_log_stamp(tmp_path, "## 2026-08-12\n\n* **Run …**\n")

        assert (tmp_path / "log.md").read_text(encoding="utf-8").startswith(
            "## 2026-08-12"
        )
