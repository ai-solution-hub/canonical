"""Tests for producer/publish.py — the first-publish HARD gate + `producer
publish` command entry (ID-132 {132.13} G-PUBLISH-GATE, BI-20/21/23).

Per the {132.13} testStrategy: publish ABORTS on a red seed-contract status
(injected — the live GitHub Checks-API lookup is a documented follow-up,
not exercised here, see `publish.py`'s module docstring); publish PROCEEDS
on green and performs exactly one gated `git_sync.sync_bundle` commit; an
abort leaves NO partial commit.

Exercised against a REAL temporary git repo (`tmp_path` + `git init`),
mirroring `test_producer_git_sync.py` — `publish.py` has no `cocoindex`
import either, so no `stubbed_sys_modules` cocoindex stub is needed.

De-identified throughout: no client name appears anywhere below.
"""

from __future__ import annotations

import json
import logging
import subprocess
import sys
from pathlib import Path

import pytest

# ── Path setup — mirrors the sibling producer test files.

_REPO_ROOT = Path(__file__).resolve().parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from scripts.cocoindex_pipeline.producer.git_sync import LOG_FILENAME  # noqa: E402
from scripts.cocoindex_pipeline.producer.publish import (  # noqa: E402
    PublishAbortedError,
    PushResult,
    SeedContractCheckResult,
    ensure_seed_contract_green,
    publish_bundle,
    push_bundle_repo,
    read_status_file,
    run,
)


def _git(repo_path: Path, *args: str) -> str:
    result = subprocess.run(
        ["git", *args], cwd=repo_path, capture_output=True, text=True, check=True
    )
    return result.stdout


def _commit_count(repo_path: Path) -> int:
    result = subprocess.run(
        ["git", "log", "--oneline"], cwd=repo_path, capture_output=True, text=True
    )
    if result.returncode != 0:
        return 0
    return len(result.stdout.splitlines())


@pytest.fixture()
def repo(tmp_path: Path) -> Path:
    """A fresh, real client-owned bundle git repo — no commits yet."""
    repo_dir = tmp_path / "repo"
    repo_dir.mkdir()
    subprocess.run(["git", "init", "--quiet"], cwd=repo_dir, check=True)
    return repo_dir


def _green() -> SeedContractCheckResult:
    return SeedContractCheckResult(is_green=True, detail="all seed-contract checks passed")


def _red() -> SeedContractCheckResult:
    return SeedContractCheckResult(is_green=False, detail="seed-contract freeze test is failing")


# ── BI-21 HARD GATE: pure abort-on-red logic ────────────────────────────


class TestEnsureSeedContractGreen:
    def test_a_green_status_passes_through_without_raising(self) -> None:
        result = ensure_seed_contract_green(_green)

        assert result.is_green is True

    def test_a_red_status_raises_publish_aborted_error(self) -> None:
        with pytest.raises(PublishAbortedError, match="BI-21 HARD GATE"):
            ensure_seed_contract_green(_red)

    def test_the_abort_message_surfaces_the_injected_detail(self) -> None:
        with pytest.raises(PublishAbortedError, match="seed-contract freeze test is failing"):
            ensure_seed_contract_green(_red)

    def test_the_freeze_test_path_is_named_in_the_abort_message(self) -> None:
        with pytest.raises(
            PublishAbortedError, match=r"__tests__/pipeline/seed-contract\.test\.ts"
        ):
            ensure_seed_contract_green(_red)


# ── publish_bundle: gate THEN the ONE gated commit ──────────────────────


class TestPublishBundle:
    def test_publish_proceeds_on_green_and_makes_exactly_one_commit(self, repo: Path) -> None:
        result = publish_bundle(
            repo,
            {"topic-a.md": "draft one\n"},
            status_source=_green,
        )

        assert _commit_count(repo) == 1
        assert result.commit_sha == _git(repo, "rev-parse", "HEAD").strip()
        assert result.applied == ("topic-a.md",)

    def test_publish_aborts_on_red_and_leaves_no_partial_commit(self, repo: Path) -> None:
        with pytest.raises(PublishAbortedError):
            publish_bundle(
                repo,
                {"topic-a.md": "draft one\n"},
                status_source=_red,
            )

        assert _commit_count(repo) == 0
        assert not (repo / "topic-a.md").exists()

    def test_a_red_gate_never_touches_the_filesystem_at_all(self, repo: Path) -> None:
        """The abort happens BEFORE `sync_bundle` runs — no write, no git
        `add`, no commit attempt of any kind."""
        marker = repo / "topic-a.md"

        with pytest.raises(PublishAbortedError):
            publish_bundle(repo, {"topic-a.md": "should never land\n"}, status_source=_red)

        assert not marker.exists()
        # `git status` reports a clean, untouched working tree.
        status = _git(repo, "status", "--porcelain")
        assert status == ""

    def test_a_second_green_publish_with_identical_content_is_a_true_no_op(
        self, repo: Path
    ) -> None:
        """When the bundle content genuinely repeats (no log.md in the
        managed set — see TestLogMdNoOpTension below for the case where it
        IS present), the underlying `sync_bundle` BI-18 no-op guarantee
        still holds through the gate: no second commit."""
        first = publish_bundle(repo, {"topic-a.md": "draft one\n"}, status_source=_green)
        second = publish_bundle(repo, {"topic-a.md": "draft one\n"}, status_source=_green)

        assert _commit_count(repo) == 1
        assert second.commit_sha == first.commit_sha
        assert second.applied == ()
        assert second.unchanged == ("topic-a.md",)

    def test_publish_delegates_to_sync_bundle_for_removed_paths_too(self, repo: Path) -> None:
        publish_bundle(repo, {"topic-a.md": "draft one\n"}, status_source=_green)

        result = publish_bundle(
            repo,
            {},
            status_source=_green,
            removed_paths=("topic-a.md",),
        )

        assert result.removed == ("topic-a.md",)
        assert not (repo / "topic-a.md").exists()
        assert _commit_count(repo) == 2


# ── The {132.12} log.md tension — surfaced executably, not "fixed" here ─


class TestLogMdNoOpTension:
    def test_a_repeated_publish_with_an_ever_changing_log_md_still_commits_each_time(
        self, repo: Path
    ) -> None:
        """`bundle_writer.append_log_entry` appends a freshly-timestamped
        block to `log.md` on EVERY run (even a fully no-op run over the
        concept files themselves) — so when `log.md` is part of
        `new_output` (as it will be for a real bundle directory), its
        desired content differs from the last commit's `log.md` on every
        publish purely because of the new timestamp. This makes
        `sync_bundle`'s BI-18 "genuinely no-op" skip practically
        unreachable for a real publish call. This test demonstrates that
        interaction rather than silently ignoring it — the fix (if any) is
        `{132.12}`'s file-ownership, not this Subtask's.
        """
        first = publish_bundle(
            repo,
            {"topic-a.md": "draft one\n", LOG_FILENAME: "## 2026-01-01T00:00:00Z\n\nNo changes.\n"},
            status_source=_green,
        )
        second = publish_bundle(
            repo,
            # The concept content is BYTE-IDENTICAL to the first run — only
            # log.md's timestamped block differs, as bundle_writer always
            # produces.
            {"topic-a.md": "draft one\n", LOG_FILENAME: "## 2026-01-01T00:05:00Z\n\nNo changes.\n"},
            status_source=_green,
        )

        assert second.commit_sha != first.commit_sha
        assert _commit_count(repo) == 2
        # The concept file itself correctly resolved unchanged...
        assert "topic-a.md" in second.unchanged
        # ...but log.md's ever-changing timestamp forced an "apply", which
        # is what drove the second commit despite no real content change.
        assert LOG_FILENAME in second.applied


# ── read_status_file: the network-free default status source ───────────


class TestReadStatusFile:
    def test_a_green_status_file_reports_green(self, tmp_path: Path) -> None:
        status_path = tmp_path / "status.json"
        status_path.write_text(json.dumps({"green": True, "detail": "CI run #42"}), encoding="utf-8")

        result = read_status_file(status_path)

        assert result.is_green is True
        assert result.detail == "CI run #42"

    def test_a_red_status_file_reports_red(self, tmp_path: Path) -> None:
        status_path = tmp_path / "status.json"
        status_path.write_text(json.dumps({"green": False}), encoding="utf-8")

        result = read_status_file(status_path)

        assert result.is_green is False

    def test_a_missing_status_file_fails_closed_to_red(self, tmp_path: Path) -> None:
        result = read_status_file(tmp_path / "does-not-exist.json")

        assert result.is_green is False

    def test_malformed_json_fails_closed_to_red(self, tmp_path: Path) -> None:
        status_path = tmp_path / "status.json"
        status_path.write_text("not json at all", encoding="utf-8")

        result = read_status_file(status_path)

        assert result.is_green is False

    def test_a_status_file_missing_the_green_key_fails_closed_to_red(
        self, tmp_path: Path
    ) -> None:
        status_path = tmp_path / "status.json"
        status_path.write_text(json.dumps({"detail": "no green key at all"}), encoding="utf-8")

        result = read_status_file(status_path)

        assert result.is_green is False


# ── The `producer publish` CLI entry ────────────────────────────────────


@pytest.fixture()
def bundle_dir(tmp_path: Path) -> Path:
    bundle = tmp_path / "bundle"
    bundle.mkdir()
    (bundle / "topic-a.md").write_text("---\ntitle: Topic A\n---\ndraft\n", encoding="utf-8")
    (bundle / "index.md").write_text("# Index\n\n- [Topic A](topic-a.md)\n", encoding="utf-8")
    return bundle


class TestPublishCli:
    def test_run_publishes_the_bundle_dir_on_green_and_returns_zero(
        self, repo: Path, bundle_dir: Path
    ) -> None:
        exit_code = run(
            ["--bundle-dir", str(bundle_dir), "--repo-path", str(repo)],
            status_source=_green,
        )

        assert exit_code == 0
        assert _commit_count(repo) == 1
        assert (repo / "topic-a.md").read_text(encoding="utf-8") == (
            "---\ntitle: Topic A\n---\ndraft\n"
        )
        assert (repo / "index.md").exists()

    def test_run_aborts_on_red_returns_one_and_makes_no_commit(
        self, repo: Path, bundle_dir: Path
    ) -> None:
        exit_code = run(
            ["--bundle-dir", str(bundle_dir), "--repo-path", str(repo)],
            status_source=_red,
        )

        assert exit_code == 1
        assert _commit_count(repo) == 0
        assert not (repo / "topic-a.md").exists()

    def test_run_default_status_source_reads_the_status_file_flag(
        self, repo: Path, bundle_dir: Path, tmp_path: Path
    ) -> None:
        status_path = tmp_path / "status.json"
        status_path.write_text(json.dumps({"green": True}), encoding="utf-8")

        exit_code = run(
            [
                "--bundle-dir",
                str(bundle_dir),
                "--repo-path",
                str(repo),
                "--status-file",
                str(status_path),
            ]
        )

        assert exit_code == 0
        assert _commit_count(repo) == 1

    def test_run_without_a_status_file_flag_fails_closed_and_aborts(
        self, repo: Path, bundle_dir: Path
    ) -> None:
        """No `--status-file` means `read_status_file` is handed `None` —
        this should fail closed (red), never silently green."""
        exit_code = run(["--bundle-dir", str(bundle_dir), "--repo-path", str(repo)])

        assert exit_code == 1
        assert _commit_count(repo) == 0


# ── push_bundle_repo: the DR-055 post-publish push lane ({132.35}) ─────


@pytest.fixture()
def bare_remote(tmp_path: Path) -> Path:
    """A real bare git repo standing in for the DR-055 client-owned remote —
    a plain local filesystem path is sufficient to exercise `git push`
    end-to-end without any real SSH infrastructure (GIT_SSH_COMMAND is only
    consulted for an ssh:// / scp-like remote, so it is harmlessly unused
    here)."""
    bare_dir = tmp_path / "bare-remote.git"
    subprocess.run(["git", "init", "--quiet", "--bare", str(bare_dir)], check=True)
    return bare_dir


def _current_branch(repo_path: Path) -> str:
    return _git(repo_path, "rev-parse", "--abbrev-ref", "HEAD").strip()


class TestPushBundleRepo:
    def test_unconfigured_is_a_clean_no_op(self, repo: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("OKF_BUNDLE_DEPLOY_KEY_PATH", raising=False)
        publish_bundle(repo, {"topic-a.md": "draft one\n"}, status_source=_green)

        result = push_bundle_repo(repo)

        assert result == PushResult(attempted=False, pushed=False)

    def test_configured_push_reaches_the_bundle_repo_path(
        self, repo: Path, bare_remote: Path
    ) -> None:
        publish_bundle(repo, {"topic-a.md": "draft one\n"}, status_source=_green)
        _git(repo, "remote", "add", "origin", str(bare_remote))
        _git(repo, "push", "--quiet", "-u", "origin", _current_branch(repo))
        # A SECOND commit, not yet pushed to the bare remote — this is what
        # push_bundle_repo must land.
        publish_bundle(repo, {"topic-a.md": "draft two\n"}, status_source=_green)
        local_head = _git(repo, "rev-parse", "HEAD").strip()

        result = push_bundle_repo(repo, deploy_key_path="/fake/deploy-key")

        assert result == PushResult(attempted=True, pushed=True)
        remote_head = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=bare_remote,
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip()
        assert remote_head == local_head

    def test_configured_push_reads_the_env_var_when_no_explicit_path(
        self, repo: Path, bare_remote: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        publish_bundle(repo, {"topic-a.md": "draft one\n"}, status_source=_green)
        _git(repo, "remote", "add", "origin", str(bare_remote))
        _git(repo, "push", "--quiet", "-u", "origin", _current_branch(repo))
        monkeypatch.setenv("OKF_BUNDLE_DEPLOY_KEY_PATH", "/fake/deploy-key")

        result = push_bundle_repo(repo)

        assert result == PushResult(attempted=True, pushed=True)

    def test_push_failure_is_logged_loud_and_does_not_raise(
        self, repo: Path, caplog: pytest.LogCaptureFixture
    ) -> None:
        """No `origin` remote configured at all — `git push` fails with a
        named git error. push_bundle_repo must return a failed PushResult
        (never raise) and log it at ERROR."""
        publish_bundle(repo, {"topic-a.md": "draft one\n"}, status_source=_green)

        with caplog.at_level(
            logging.ERROR, logger="scripts.cocoindex_pipeline.producer.publish"
        ):
            result = push_bundle_repo(repo, deploy_key_path="/fake/deploy-key")

        assert result.attempted is True
        assert result.pushed is False
        assert result.error
        error_records = [r for r in caplog.records if r.levelno == logging.ERROR]
        assert any("DR-055 push FAILED" in r.message for r in error_records)

    def test_the_producer_publish_cli_pushes_after_a_successful_commit(
        self, repo: Path, bundle_dir: Path, bare_remote: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The `producer publish` CLI (`run()`) invokes the push lane AFTER
        its gated commit, when configured — end-to-end through `run()`,
        never calling `push_bundle_repo` directly. Mirrors the DR-055
        persistent-volume clone's real state (origin + upstream tracking
        already configured, per `push_bundle_repo`'s own docstring
        assumption) by publishing once to establish that tracking, THEN
        exercising the run this test actually asserts on."""
        monkeypatch.setenv("OKF_BUNDLE_DEPLOY_KEY_PATH", "/fake/deploy-key")
        run(["--bundle-dir", str(bundle_dir), "--repo-path", str(repo)], status_source=_green)
        _git(repo, "remote", "add", "origin", str(bare_remote))
        _git(repo, "push", "--quiet", "-u", "origin", _current_branch(repo))

        (bundle_dir / "topic-a.md").write_text("draft two\n", encoding="utf-8")
        exit_code = run(
            ["--bundle-dir", str(bundle_dir), "--repo-path", str(repo)],
            status_source=_green,
        )

        assert exit_code == 0
        local_head = _git(repo, "rev-parse", "HEAD").strip()
        remote_head = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=bare_remote,
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip()
        assert remote_head == local_head

    def test_the_producer_publish_cli_does_not_fail_when_push_is_unconfigured(
        self, repo: Path, bundle_dir: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.delenv("OKF_BUNDLE_DEPLOY_KEY_PATH", raising=False)

        exit_code = run(
            ["--bundle-dir", str(bundle_dir), "--repo-path", str(repo)],
            status_source=_green,
        )

        assert exit_code == 0
        assert _commit_count(repo) == 1
