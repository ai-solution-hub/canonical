"""Tests for producer/git_sync.py — the git knowledge-sync writer + 3-way
human-edit reconcile (ID-132 {132.12} G-GITSYNC).

Per the {132.12} testStrategy: one commit per producer run; the managed-
keyset boundary leaves a human `notes/` file untouched; the 3-way reconcile
flags a human-edited managed file in `log.md` + leaves it in place (BI-22);
the augmentation guard refuses a shrinking sync (BI-27).

Exercised against a REAL temporary git repo (`tmp_path` + `git init`) per the
{132.12} brief — never a mocked git, and never any remote. `git_sync.py` has
ZERO `cocoindex` import (a discrete post-flow stage, not a cocoindex target),
so — unlike `test_producer_bundle_writer.py` / `test_producer_web_pass.py` —
this file needs no `stubbed_sys_modules` cocoindex stub at all.

De-identified throughout: no client name appears anywhere below.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest

# ── Path setup — mirrors the sibling producer test files.

_REPO_ROOT = Path(__file__).resolve().parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from scripts.cocoindex_pipeline.producer.git_sync import (  # noqa: E402
    LOG_FILENAME,
    AugmentationGuardRefusal,
    HumanEditConflict,
    sync_bundle,
)


def _git(repo_path: Path, *args: str) -> str:
    result = subprocess.run(
        ["git", *args], cwd=repo_path, capture_output=True, text=True, check=True
    )
    return result.stdout


def _commit_count(repo_path: Path) -> int:
    return len(_git(repo_path, "log", "--oneline").splitlines())


@pytest.fixture()
def repo(tmp_path: Path) -> Path:
    """A fresh, real git repo — no commits, no identity configured (proves
    `sync_bundle`'s own `-c user.name=.../-c user.email=...` is
    self-sufficient)."""
    subprocess.run(["git", "init", "--quiet"], cwd=tmp_path, check=True)
    return tmp_path


def _citation_body(*entries: str) -> str:
    lines = ["A distilled synthesis.", "", "# Citations"]
    lines.extend(f"- {entry}" for entry in entries)
    return "\n".join(lines) + "\n"


# ── BI-19: one commit per producer run ──────────────────────────────────


class TestOneCommitPerRun:
    def test_first_run_produces_exactly_one_commit(self, repo: Path) -> None:
        result = sync_bundle(repo, {"topic-a.md": "draft one\n"})

        assert _commit_count(repo) == 1
        assert result.commit_sha == _git(repo, "rev-parse", "HEAD").strip()

    def test_a_second_run_with_genuinely_new_content_adds_a_second_commit(
        self, repo: Path
    ) -> None:
        first = sync_bundle(repo, {"topic-a.md": "draft one\n"})
        second = sync_bundle(repo, {"topic-a.md": "draft two\n"})

        assert _commit_count(repo) == 2
        assert second.commit_sha != first.commit_sha

    def test_a_fully_no_op_second_run_still_produces_a_new_commit(
        self, repo: Path
    ) -> None:
        """BI-19 is unconditional — even when nothing changed at all (same
        content, no findings), a run still commits (`--allow-empty`)."""
        first = sync_bundle(repo, {"topic-a.md": "draft one\n"})
        second = sync_bundle(repo, {"topic-a.md": "draft one\n"})

        assert _commit_count(repo) == 2
        assert second.commit_sha != first.commit_sha
        assert second.applied == ()
        assert second.unchanged == ("topic-a.md",)


# ── Managed-keyset boundary ──────────────────────────────────────────────


class TestManagedKeysetBoundary:
    def test_a_human_notes_file_outside_the_managed_keyset_is_left_untouched(
        self, repo: Path
    ) -> None:
        notes = repo / "notes" / "README.md"
        notes.parent.mkdir(parents=True)
        notes.write_text("human scratch notes, never producer-managed\n", encoding="utf-8")

        sync_bundle(repo, {"topic-a.md": "draft one\n"})

        assert notes.read_text(encoding="utf-8") == (
            "human scratch notes, never producer-managed\n"
        )
        # And git-sync never staged/tracked it — only the managed path.
        tracked = _git(repo, "ls-tree", "-r", "--name-only", "HEAD").splitlines()
        assert "notes/README.md" not in tracked
        assert "topic-a.md" in tracked

    def test_new_output_keys_outside_an_explicit_managed_keyset_are_ignored(
        self, repo: Path
    ) -> None:
        """An explicit `managed_keyset` is the authoritative manifest — a
        `new_output` entry for a path NOT in it is simply never applied."""
        result = sync_bundle(
            repo,
            {"topic-a.md": "draft one\n", "notes/scratch.md": "not managed\n"},
            managed_keyset=("topic-a.md",),
        )

        assert result.applied == ("topic-a.md",)
        assert not (repo / "notes" / "scratch.md").exists()


# ── BI-22: 3-way reconcile flags a human edit, leaves it in place ───────


class TestHumanEditReconcile:
    def test_a_managed_file_edited_directly_on_disk_is_flagged_and_kept(
        self, repo: Path
    ) -> None:
        sync_bundle(repo, {"topic-a.md": "producer draft one\n", LOG_FILENAME: ""})

        # Simulate a human editing the managed file directly, with no commit.
        (repo / "topic-a.md").write_text("HUMAN EDIT — do not clobber\n", encoding="utf-8")

        result = sync_bundle(
            repo, {"topic-a.md": "producer draft two\n", LOG_FILENAME: ""}
        )

        assert result.human_edit_conflicts == (HumanEditConflict("topic-a.md"),)
        assert "topic-a.md" not in result.applied
        # The human's edit survives on disk, untouched by the new draft.
        assert (repo / "topic-a.md").read_text(encoding="utf-8") == (
            "HUMAN EDIT — do not clobber\n"
        )

    def test_the_human_edit_conflict_is_flagged_in_log_md(self, repo: Path) -> None:
        sync_bundle(repo, {"topic-a.md": "producer draft one\n", LOG_FILENAME: ""})
        (repo / "topic-a.md").write_text("HUMAN EDIT\n", encoding="utf-8")

        sync_bundle(repo, {"topic-a.md": "producer draft two\n", LOG_FILENAME: ""})

        log_content = (repo / LOG_FILENAME).read_text(encoding="utf-8")
        assert "git-sync reconcile findings" in log_content
        assert "topic-a.md" in log_content
        assert "human edit" in log_content.lower()

    def test_a_concept_never_touched_by_a_human_updates_normally(self, repo: Path) -> None:
        """Control case — proves the conflict above is genuinely about the
        divergence, not merely about the content changing."""
        sync_bundle(repo, {"topic-a.md": "producer draft one\n"})

        result = sync_bundle(repo, {"topic-a.md": "producer draft two\n"})

        assert result.human_edit_conflicts == ()
        assert result.applied == ("topic-a.md",)
        assert (repo / "topic-a.md").read_text(encoding="utf-8") == "producer draft two\n"


# ── BI-27/DR-016: augmentation guard refuses a shrinking sync ───────────


class TestAugmentationGuard:
    def test_a_new_draft_that_drops_a_prior_citation_is_refused(self, repo: Path) -> None:
        original = _citation_body(
            "canonical://source_documents/11111111-1111-4111-8111-111111111111",
            "canonical://reference_items/22222222-2222-4222-8222-222222222222",
        )
        sync_bundle(repo, {"topic-a.md": original})

        shrinking = _citation_body(
            "canonical://source_documents/11111111-1111-4111-8111-111111111111",
        )
        result = sync_bundle(repo, {"topic-a.md": shrinking, LOG_FILENAME: ""})

        assert len(result.augmentation_guard_refusals) == 1
        refusal = result.augmentation_guard_refusals[0]
        assert refusal.rel_path == "topic-a.md"
        assert (
            "canonical://reference_items/22222222-2222-4222-8222-222222222222"
            in refusal.dropped_citations
        )
        # The prior, fuller committed content is kept — never the shrunk draft.
        assert (repo / "topic-a.md").read_text(encoding="utf-8") == original

    def test_the_augmentation_guard_refusal_is_flagged_in_log_md(self, repo: Path) -> None:
        original = _citation_body("canonical://source_documents/11111111-1111-4111-8111-111111111111")
        sync_bundle(repo, {"topic-a.md": original, LOG_FILENAME: ""})

        sync_bundle(repo, {"topic-a.md": _citation_body(), LOG_FILENAME: ""})

        log_content = (repo / LOG_FILENAME).read_text(encoding="utf-8")
        assert "git-sync reconcile findings" in log_content
        assert "augmentation guard" in log_content.lower()
        assert "topic-a.md" in log_content

    def test_a_superset_of_citations_is_not_a_shrink_and_applies_normally(
        self, repo: Path
    ) -> None:
        original = _citation_body("canonical://source_documents/11111111-1111-4111-8111-111111111111")
        sync_bundle(repo, {"topic-a.md": original})

        superset = _citation_body(
            "canonical://source_documents/11111111-1111-4111-8111-111111111111",
            "canonical://reference_items/22222222-2222-4222-8222-222222222222",
        )
        result = sync_bundle(repo, {"topic-a.md": superset})

        assert result.augmentation_guard_refusals == ()
        assert result.applied == ("topic-a.md",)
        assert (repo / "topic-a.md").read_text(encoding="utf-8") == superset

    def test_a_first_write_concept_has_no_prior_citations_to_shrink_from(
        self, repo: Path
    ) -> None:
        """A brand-new concept path is never a shrink — there is nothing
        prior to compare against (mirrors `detect_citation_shrink`'s own
        documented first-write behaviour)."""
        result = sync_bundle(repo, {"topic-a.md": _citation_body()})

        assert result.augmentation_guard_refusals == ()
        assert result.applied == ("topic-a.md",)


# ── Removal (BI-18 delta-only, caller-supplied per `removed_paths`) ─────


class TestRemoval:
    def test_a_removed_concept_with_no_human_edit_is_deleted_and_committed(
        self, repo: Path
    ) -> None:
        sync_bundle(repo, {"topic-a.md": "draft one\n"})

        result = sync_bundle(repo, {}, removed_paths=("topic-a.md",))

        assert result.removed == ("topic-a.md",)
        assert not (repo / "topic-a.md").exists()
        tracked = _git(repo, "ls-tree", "-r", "--name-only", "HEAD").splitlines()
        assert "topic-a.md" not in tracked

    def test_a_human_edited_file_is_never_removed_even_when_the_producer_wants_it_gone(
        self, repo: Path
    ) -> None:
        sync_bundle(repo, {"topic-a.md": "draft one\n"})
        (repo / "topic-a.md").write_text("HUMAN EDIT\n", encoding="utf-8")

        result = sync_bundle(repo, {}, removed_paths=("topic-a.md",))

        assert result.human_edit_conflicts == (HumanEditConflict("topic-a.md"),)
        assert result.removed == ()
        assert (repo / "topic-a.md").read_text(encoding="utf-8") == "HUMAN EDIT\n"
