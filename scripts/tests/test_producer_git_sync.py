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

import json
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
    ProducerOverride,
    ProposedChange,
    capture_overrides,
    proposed_change_set,
    reapply_overrides,
    sync_bundle,
)


def _git(repo_path: Path, *args: str) -> str:
    result = subprocess.run(
        ["git", *args], cwd=repo_path, capture_output=True, text=True, check=True
    )
    return result.stdout


def _commit_count(repo_path: Path) -> int:
    # A repo with no commits yet makes `git log` exit non-zero — that is zero
    # commits, not an error (a STAGING run legitimately leaves HEAD unborn).
    result = subprocess.run(
        ["git", "log", "--oneline"], cwd=repo_path, capture_output=True, text=True
    )
    if result.returncode != 0:
        return 0
    return len(result.stdout.splitlines())


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

    def test_a_fully_no_op_second_run_creates_no_new_commit(
        self, repo: Path
    ) -> None:
        """BI-18: a genuinely no-op run — same content, no findings — makes
        NO new commit. BI-19's "one commit per run" bounds a CHANGING run
        to exactly one commit; it does not mandate a commit when nothing
        changed at all."""
        first = sync_bundle(repo, {"topic-a.md": "draft one\n"})
        second = sync_bundle(repo, {"topic-a.md": "draft one\n"})

        assert _commit_count(repo) == 1
        assert second.commit_sha == first.commit_sha
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


# ── S436 amendment (BI-27/DR-016) — human edits are producer OVERRIDES ───
#
# The S436 amendment upgrades the 3-way reconcile from "flag divergence,
# leave file in place" to "flag → capture-as-override → re-apply", adds a
# STAGING landing (the one gated commit happens at the publish gate, not
# per-run), and emits a machine-readable per-run proposed-change set (DR-013
# shape) the follow-on accept/edit/reject review UI binds to.


def _okf_doc(
    *,
    title: str,
    description: str,
    body: str,
    citations: "tuple[str, ...]",
) -> str:
    """A realistic OKF concept doc — YAML frontmatter (BI-12 required keys) +
    a distilled-synthesis body preamble + a `# Citations` section — so the
    field-level override machinery is exercised against representative
    producer output, not toy strings."""
    lines = [
        "---",
        "type: topic",
        f"title: {title}",
        f"description: {description}",
        "timestamp: 2026-07-09T00:00:00Z",
        "resource: canonical://source_documents/11111111-1111-4111-8111-111111111111",
        "tags: [pipeline, ingest]",
        "---",
        body,
        "",
        "# Citations",
    ]
    lines.extend(f"- {c}" for c in citations)
    return "\n".join(lines) + "\n"


class TestOverrideCapture:
    def test_capture_keys_a_changed_frontmatter_field_by_concept_path_and_field(
        self,
    ) -> None:
        baseline = _okf_doc(
            title="Ingest",
            description="Producer description",
            body="Producer synthesis.",
            citations=("canonical://source_documents/aaa",),
        )
        edited = _okf_doc(
            title="Ingest",
            description="Human-refined description",
            body="Producer synthesis.",
            citations=("canonical://source_documents/aaa",),
        )

        overrides = capture_overrides("topic-a.md", baseline=baseline, edited=edited)

        assert (
            ProducerOverride("topic-a.md", "frontmatter:description", "Human-refined description")
            in overrides
        )
        # An unchanged field is NEVER captured — capture is a field-level delta.
        assert all(o.field != "frontmatter:title" for o in overrides)

    def test_capture_keys_a_rewritten_body_section(self) -> None:
        baseline = _okf_doc(
            title="Ingest",
            description="D",
            body="Producer synthesis.",
            citations=("canonical://source_documents/aaa",),
        )
        edited = _okf_doc(
            title="Ingest",
            description="D",
            body="Human-rewritten synthesis with more nuance.",
            citations=("canonical://source_documents/aaa",),
        )

        overrides = capture_overrides("topic-a.md", baseline=baseline, edited=edited)

        assert {o.field for o in overrides} == {"body"}

    def test_sync_bundle_captures_a_human_edit_conflict_as_a_producer_override(
        self, repo: Path
    ) -> None:
        baseline = _okf_doc(
            title="Ingest",
            description="Producer description",
            body="Producer synthesis.",
            citations=("canonical://source_documents/aaa",),
        )
        sync_bundle(repo, {"topic-a.md": baseline, LOG_FILENAME: ""})

        human = _okf_doc(
            title="Ingest",
            description="Human-approved description",
            body="Producer synthesis.",
            citations=("canonical://source_documents/aaa",),
        )
        (repo / "topic-a.md").write_text(human, encoding="utf-8")

        result = sync_bundle(
            repo,
            {
                "topic-a.md": _okf_doc(
                    title="Ingest",
                    description="Producer description v2",
                    body="Producer synthesis, expanded.",
                    citations=("canonical://source_documents/aaa",),
                ),
                LOG_FILENAME: "",
            },
        )

        captured = {(o.concept_path, o.field): o.value for o in result.captured_overrides}
        assert ("topic-a.md", "frontmatter:description") in captured
        assert captured[("topic-a.md", "frontmatter:description")] == "Human-approved description"


class TestReapplyOverrides:
    def test_a_frontmatter_override_is_folded_onto_the_fresh_draft(self) -> None:
        override = ProducerOverride(
            "topic-a.md", "frontmatter:description", "Human-approved description"
        )
        fresh = _okf_doc(
            title="Ingest",
            description="Producer regenerated description",
            body="Fresh producer synthesis.",
            citations=("canonical://source_documents/aaa",),
        )

        folded = reapply_overrides({"topic-a.md": fresh}, [override])

        # The human's field survives on the fresh draft...
        assert "description: Human-approved description" in folded["topic-a.md"]
        assert "Producer regenerated description" not in folded["topic-a.md"]
        # ...while the producer's own fresh body is kept.
        assert "Fresh producer synthesis." in folded["topic-a.md"]

    def test_a_human_section_the_fresh_draft_no_longer_emits_is_reapplied_not_dropped(
        self,
    ) -> None:
        override = ProducerOverride(
            "topic-a.md", "## Operator note", "Bespoke human operator guidance.\n"
        )
        fresh = _okf_doc(
            title="Ingest",
            description="D",
            body="Fresh.",
            citations=("canonical://source_documents/aaa",),
        )
        assert "Operator note" not in fresh  # the producer draft never regenerates it

        folded = reapply_overrides({"topic-a.md": fresh}, [override])

        assert "## Operator note" in folded["topic-a.md"]
        assert "Bespoke human operator guidance." in folded["topic-a.md"]

    def test_reapply_leaves_unrelated_concepts_untouched(self) -> None:
        override = ProducerOverride("topic-a.md", "frontmatter:title", "Renamed by a human")
        drafts = {
            "topic-a.md": _okf_doc(
                title="Original",
                description="D",
                body="B",
                citations=("canonical://source_documents/aaa",),
            ),
            "topic-b.md": "an unrelated concept\n",
        }

        folded = reapply_overrides(drafts, [override])

        assert folded["topic-b.md"] == "an unrelated concept\n"
        assert "title: Renamed by a human" in folded["topic-a.md"]


class TestFullOverrideCycle:
    def test_an_approved_human_edit_is_captured_then_reapplied_on_the_next_draft(
        self, repo: Path
    ) -> None:
        """The headline BI-27 loop: an approved human edit is captured as a
        producer override (keyed by concept_path + field), then RE-APPLIED on
        the next fresh draft — never dropped."""
        v1 = _okf_doc(
            title="Ingest",
            description="Producer description",
            body="Producer synthesis.",
            citations=("canonical://source_documents/aaa",),
        )
        sync_bundle(repo, {"topic-a.md": v1, LOG_FILENAME: ""})

        # A human refines the description directly on disk.
        human = _okf_doc(
            title="Ingest",
            description="Human-approved description",
            body="Producer synthesis.",
            citations=("canonical://source_documents/aaa",),
        )
        (repo / "topic-a.md").write_text(human, encoding="utf-8")

        # A fresh producer run flags + captures the human's field-level override.
        v2_fresh = _okf_doc(
            title="Ingest",
            description="Producer description regenerated",
            body="Producer synthesis, expanded.",
            citations=("canonical://source_documents/aaa",),
        )
        run2 = sync_bundle(repo, {"topic-a.md": v2_fresh, LOG_FILENAME: ""})
        approved = [o for o in run2.captured_overrides if o.concept_path == "topic-a.md"]
        assert any(
            o.field == "frontmatter:description" and o.value == "Human-approved description"
            for o in approved
        )

        # The reviewer approves; the NEXT producer run folds the override onto
        # its brand-new draft.
        v3_fresh = _okf_doc(
            title="Ingest",
            description="Producer description regenerated again",
            body="Producer synthesis, expanded again.",
            citations=("canonical://source_documents/aaa",),
        )
        folded = reapply_overrides({"topic-a.md": v3_fresh}, approved)

        # The human's approved edit is RE-APPLIED, never dropped...
        assert "description: Human-approved description" in folded["topic-a.md"]
        # ...and the producer's fresh body still lands.
        assert "Producer synthesis, expanded again." in folded["topic-a.md"]


class TestStagingLanding:
    def test_a_staged_run_applies_to_the_working_tree_but_makes_no_commit(
        self, repo: Path
    ) -> None:
        result = sync_bundle(repo, {"topic-a.md": "draft one\n"}, stage_only=True)

        assert result.staged is True
        assert _commit_count(repo) == 0  # the ONE gated commit is deferred to publish
        # The content landed in the working tree...
        assert (repo / "topic-a.md").read_text(encoding="utf-8") == "draft one\n"
        # ...and is staged in the index, ready for the later gated commit.
        staged_paths = _git(repo, "diff", "--cached", "--name-only").splitlines()
        assert "topic-a.md" in staged_paths

    def test_a_default_run_still_commits_per_run(self, repo: Path) -> None:
        """Backward-compat guard: the publish path (default stage_only=False)
        is unchanged — one commit per changing run."""
        result = sync_bundle(repo, {"topic-a.md": "draft one\n"})

        assert result.staged is False
        assert _commit_count(repo) == 1

    def test_a_staged_run_still_emits_its_proposed_change_set(self, repo: Path) -> None:
        result = sync_bundle(repo, {"topic-a.md": "draft one\n"}, stage_only=True)

        assert any(c.concept_path == "topic-a.md" for c in result.proposed_changes)


class TestProposedChangeSet:
    def test_every_run_emits_a_json_serialisable_proposed_change_set(
        self, repo: Path
    ) -> None:
        result = sync_bundle(repo, {"topic-a.md": "draft one\n"}, stage_only=True)

        payload = proposed_change_set(result)
        encoded = json.dumps(payload)  # the review UI (DR-013 shape) binds to it

        assert "topic-a.md" in encoded
        assert any(c["concept_path"] == "topic-a.md" for c in payload["changes"])

    def test_a_first_write_is_reported_as_an_add(self, repo: Path) -> None:
        result = sync_bundle(repo, {"topic-a.md": "draft one\n"}, stage_only=True)

        change = next(c for c in result.proposed_changes if c.concept_path == "topic-a.md")
        assert change.change_kind == "add"

    def test_a_content_change_is_reported_as_a_modify_with_field_changes(
        self, repo: Path
    ) -> None:
        v1 = _okf_doc(
            title="Ingest",
            description="Old description",
            body="Body one.",
            citations=("canonical://source_documents/aaa",),
        )
        sync_bundle(repo, {"topic-a.md": v1})
        v2 = _okf_doc(
            title="Ingest",
            description="New description",
            body="Body one.",
            citations=("canonical://source_documents/aaa",),
        )

        result = sync_bundle(repo, {"topic-a.md": v2})

        change = next(c for c in result.proposed_changes if c.concept_path == "topic-a.md")
        assert change.change_kind == "modify"
        assert "frontmatter:description" in {fc.field for fc in change.field_changes}

    def test_each_entry_reserves_a_per_entry_provenance_slot_defaulting_to_none(
        self, repo: Path
    ) -> None:
        """{132.22} G-BIDOUTCOME-PROPOSAL stamps `source_workspace_id` onto
        won-bid DRAFT proposals; this substrate reserves the per-entry slot so
        that extension is a value-set, not a schema change."""
        result = sync_bundle(repo, {"topic-a.md": "draft one\n"}, stage_only=True)

        change = next(c for c in result.proposed_changes if c.concept_path == "topic-a.md")
        assert change.source_workspace_id is None
        assert "source_workspace_id" in proposed_change_set(result)["changes"][0]

    def test_a_human_edit_conflict_is_reported_as_such_in_the_change_set(
        self, repo: Path
    ) -> None:
        sync_bundle(repo, {"topic-a.md": "producer one\n", LOG_FILENAME: ""})
        (repo / "topic-a.md").write_text("human edit\n", encoding="utf-8")

        result = sync_bundle(repo, {"topic-a.md": "producer two\n", LOG_FILENAME: ""})

        change = next(c for c in result.proposed_changes if c.concept_path == "topic-a.md")
        assert change.change_kind == "human_edit_conflict"

    def test_an_augmentation_refusal_is_reported_as_such_in_the_change_set(
        self, repo: Path
    ) -> None:
        original = _citation_body(
            "canonical://source_documents/11111111-1111-4111-8111-111111111111",
            "canonical://reference_items/22222222-2222-4222-8222-222222222222",
        )
        sync_bundle(repo, {"topic-a.md": original})
        shrinking = _citation_body(
            "canonical://source_documents/11111111-1111-4111-8111-111111111111",
        )

        result = sync_bundle(repo, {"topic-a.md": shrinking})

        change = next(c for c in result.proposed_changes if c.concept_path == "topic-a.md")
        assert change.change_kind == "augmentation_refused"
