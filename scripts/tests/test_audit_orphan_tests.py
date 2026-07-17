"""Behavioural pins for scripts/audit_orphan_tests.py's TS import scanner.

Added alongside the py/redos fix (S482, CodeQL alert on the template-literal
blanking regex): the pattern was rewritten with disjoint alternatives
(``\\.`` vs ``[^`\\]``) to make the scan linear. These tests pin that the
observable blanking behaviour is unchanged — template-literal contents never
produce findings, escaped backticks do not terminate the literal, real
missing imports are still reported — and that the adversarial input class
that previously triggered catastrophic backtracking now completes instantly.
"""

from __future__ import annotations

import time
from pathlib import Path
from typing import Any

from scripts.audit_orphan_tests import audit_ts_test


def _run_audit(root: Path, test_relative: str, source: str) -> list[dict[str, Any]]:
    test_path = root / test_relative
    test_path.parent.mkdir(parents=True, exist_ok=True)
    test_path.write_text(source, encoding="utf-8")
    findings: list[dict[str, Any]] = []
    audit_ts_test(test_path, root, findings)
    return findings


def test_reports_missing_relative_import(tmp_path: Path) -> None:
    findings = _run_audit(
        tmp_path,
        "__tests__/example.test.ts",
        "import { helper } from './does-not-exist';\n",
    )
    assert [f["kind"] for f in findings] == ["missing-local-import"]
    assert findings[0]["import"] == "./does-not-exist"


def test_template_literal_contents_are_ignored(tmp_path: Path) -> None:
    source = (
        "const snippet = `\n"
        "  import phantom from './phantom-module';\n"
        "`;\n"
        "import real from './really-missing';\n"
    )
    findings = _run_audit(tmp_path, "__tests__/template.test.ts", source)
    assert [f["import"] for f in findings] == ["./really-missing"]


def test_escaped_backtick_does_not_terminate_template_literal(
    tmp_path: Path,
) -> None:
    # The \` escape keeps the literal open: the phantom import line is still
    # inside it and must not be reported; the import after the real closing
    # backtick must be. If escape handling regressed (treating \` as the
    # terminator), the phantom line would become visible and be reported.
    source = (
        "const s = `before \\`\n"
        "import phantom from './phantom-after-escape';\n"
        "`;\n"
        "import real from './really-missing';\n"
    )
    findings = _run_audit(tmp_path, "__tests__/escape.test.ts", source)
    assert [f["import"] for f in findings] == ["./really-missing"]


def test_unterminated_backslash_run_completes_fast(tmp_path: Path) -> None:
    # py/redos regression pin: an opening backtick followed by a long run of
    # backslashes with NO closing backtick made the old overlapping pattern
    # backtrack exponentially (hang). The disjoint pattern fails the match in
    # linear time; the generous bound only guards against a reintroduced
    # exponential blow-up, not normal timing jitter.
    source = "const s = `" + "\\" * 10_000 + "\nimport x from './really-missing';\n"
    started = time.monotonic()
    findings = _run_audit(tmp_path, "__tests__/redos.test.ts", source)
    elapsed = time.monotonic() - started
    assert elapsed < 5.0
    # The literal never closes, so nothing after it is blanked — the import
    # is still visible to the scanner (same as the old pattern's behaviour
    # once it finished failing to match).
    assert [f["import"] for f in findings] == ["./really-missing"]
