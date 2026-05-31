"""Tests for --auto-supersede filename heuristic (S186 WP-B.6).

Covers:
  * `should_auto_supersede` truth-table (pure function, deterministic)
  * Mutually exclusive CLI flags on all three ingest scripts
  * Dry-run log prefix distinct from live log prefix
"""

from __future__ import annotations

import os
import subprocess
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from kb_pipeline.dedup import should_auto_supersede  # noqa: E402


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SCRIPTS = [
    "scripts/ingest_markdown.py",
    "scripts/ingest_stage2_markdown.py",
    "scripts/import_bid_library.py",
]


def _run_help(script: str, extra: list[str]) -> subprocess.CompletedProcess:
    """Run `python3 <script> <extra>` and capture stdout/stderr + returncode.

    We rely on --help / invalid-arg exit codes rather than actually executing
    the pipeline, so no DB or env is needed.
    """
    return subprocess.run(
        [sys.executable, os.path.join(REPO_ROOT, script), *extra],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        timeout=20,
    )


# ---------------------------------------------------------------------------
# Heuristic tests
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "incoming, existing, expected, reason",
    [
        # Positive cases — spec §5.2
        (
            "Acme_Security_Final.docx",
            "DRAFT_Acme_Security_v1.docx",
            True,
            "final incoming + DRAFT existing",
        ),
        (
            "acme_security_final.docx",
            "draft_acme_security_v1.docx",
            True,
            "case-insensitive match",
        ),
        (
            "Acme_Security_v2.docx",
            "DRAFT_Acme_Security_v1.docx",
            True,
            "incoming without DRAFT + DRAFT existing",
        ),
        # Negative cases — condition 3 fails
        (
            "Acme_Security_Final.docx",
            "Acme_Security_v1.docx",
            False,
            "existing not DRAFT",
        ),
        (
            "Final.docx",
            "Final.docx",
            False,
            "both final — no DRAFT target",
        ),
        # Negative cases — condition 2 fails
        (
            "DRAFT_Acme_Security_v2.docx",
            "DRAFT_Acme_Security_v1.docx",
            False,
            "both DRAFT — incoming isn't a final replacement",
        ),
        # Defensive — missing inputs fail closed
        ("", "DRAFT_any.docx", False, "empty incoming"),
        ("Final.docx", "", False, "empty existing"),
        ("Final.docx", None, False, "None existing"),
        (None, "DRAFT_any.docx", False, "None incoming"),  # type: ignore[arg-type]
        # Known-behaviour false positive (verifier L3) — documented
        # limitation of the substring heuristic. The content-hash dedup
        # gate + `--auto-supersede` flag + `--auto-supersede-dry-run`
        # preview together bound the blast radius; revisit if audit
        # evidence shows real regressions post-launch.
        (
            "My-Final-Notes_DRAFT_v2.docx",
            "DRAFT-My-Final-Notes_v1.docx",
            True,
            "L3: filename containing BOTH tokens — substring heuristic "
            "fires, documented as known behaviour",
        ),
    ],
)
def test_should_auto_supersede_truth_table(incoming, existing, expected, reason):
    assert should_auto_supersede(incoming, existing) is expected, reason


# ---------------------------------------------------------------------------
# CLI — mutually exclusive flags
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("script", SCRIPTS)
def test_help_lists_auto_supersede_flags(script):
    proc = _run_help(script, ["--help"])
    assert proc.returncode == 0, proc.stderr
    assert "--auto-supersede" in proc.stdout
    assert "--auto-supersede-dry-run" in proc.stdout


@pytest.mark.parametrize("script", SCRIPTS)
def test_mutually_exclusive_flags_rejected(script):
    """argparse exits with code 2 when both flags are set."""
    # Use a placeholder positional arg (directory/path/...) that will also
    # be rejected, but argparse processes mutually-exclusive groups first
    # and exits with code 2 before the positional is inspected.
    proc = _run_help(
        script,
        ["--auto-supersede", "--auto-supersede-dry-run", "/tmp/nonexistent"],
    )
    assert proc.returncode == 2, (
        f"Expected argparse exit 2, got {proc.returncode}. "
        f"stdout={proc.stdout!r}, stderr={proc.stderr!r}"
    )
    assert "not allowed with argument" in proc.stderr or (
        "argument" in proc.stderr and "--auto-supersede" in proc.stderr
    )


# ---------------------------------------------------------------------------
# Log prefix parity
# ---------------------------------------------------------------------------


def test_dry_run_and_live_prefixes_are_distinct():
    """Operators grep log files for [Supersede] vs [Supersede-dry-run]."""
    # Read each ingest script's source and confirm both prefix literals
    # appear, so a refactor can't accidentally collapse them.
    for script in SCRIPTS:
        with open(os.path.join(REPO_ROOT, script)) as f:
            src = f.read()
        assert "[Supersede-dry-run]" in src, f"{script}: dry-run prefix missing"
        assert "[Supersede]" in src, f"{script}: live prefix missing"
