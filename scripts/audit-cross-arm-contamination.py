#!/usr/bin/env python3
"""
Audit a Claude Code sub-agent jsonl for cross-arm file access.

Scans EVERY tool_use block for input strings matching the cross-arm filename
pattern. Detects cross-arm reads via Read, Bash (cat/head/tail/grep/awk/sed/
less/more/find/xargs), Glob, Grep, and Edit tools.

Used by the WP-S11-2 cross-arm contamination check (spec §11 #14, §10 risk #6).

Usage:
    python3 audit-cross-arm-contamination.py <agent_jsonl> <own_arm_letter>
    python3 audit-cross-arm-contamination.py agent-X.jsonl a

Where own_arm_letter is the agent's OWN arm (a or b). The script checks for
references to the OTHER arm's filenames.

Filename patterns checked:
    sales-proposals-reuse-audit-arm-{other}.md   (Stage 1 deliverable)
    sales-proposals-workspace-spec-arm-{other}.md (Stage 2 deliverable)
    sales-proposals-workspace-plan-arm-{other}.md (Stage 3 deliverable)

Plus loose substring `arm-{other}` in any tool input — defensive against
the agent reading via partial path or globbed pattern.

Exit code:
    0 — no contamination detected
    1 — contamination detected; report printed to stdout
    2 — usage error
"""

import json
import re
import sys
from pathlib import Path


CROSS_ARM_PATTERNS = [
    "sales-proposals-reuse-audit-arm-{other}.md",
    "sales-proposals-workspace-spec-arm-{other}.md",
    "sales-proposals-workspace-plan-arm-{other}.md",
    "arm-{other}",  # loose substring fallback
]

# Wildcard / glob / brace-expansion patterns that would access cross-arm files
# without matching the literal `arm-{other}` substring. Detected as regex
# (raw strings — these are NOT formatted with .format()).
# Examples caught:
#   Bash(cat docs/research/sales-proposals-reuse-audit-arm-?.md)
#   Bash(cat docs/research/*-arm-*.md)
#   Bash(cat docs/research/sales-proposals-reuse-audit-arm-{a,b}.md)
#   Glob(**/*-arm-?.md)
WILDCARD_PATTERNS = [
    r"sales-proposals-(reuse-audit|workspace-spec|workspace-plan)-arm-[?*\[{]",
    r"sales-proposals-[a-z-]+-arm-\{[ab],[ab]\}",
    r"\*-arm-[?*ab]",
    r"-arm-\?",
]


def stringify(obj) -> str:
    """Recursively flatten a tool_use input dict/list/scalar into a string for matching."""
    if isinstance(obj, dict):
        return " ".join(stringify(v) for v in obj.values())
    if isinstance(obj, list):
        return " ".join(stringify(v) for v in obj)
    return str(obj) if obj is not None else ""


def audit(jsonl_path: Path, own_arm: str) -> list[dict]:
    other_arm = "b" if own_arm == "a" else "a"
    literal_patterns = [p.format(other=other_arm) for p in CROSS_ARM_PATTERNS]
    literal_re_str = "|".join(re.escape(p) for p in literal_patterns)
    wildcard_re_str = "|".join(WILDCARD_PATTERNS)
    pattern_re = re.compile(f"({literal_re_str})|({wildcard_re_str})")

    findings = []
    line_num = 0
    with jsonl_path.open() as f:
        for line in f:
            line_num += 1
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            if row.get("type") != "assistant":
                continue
            content = row.get("message", {}).get("content", [])
            if not isinstance(content, list):
                continue
            for block in content:
                if not isinstance(block, dict):
                    continue
                if block.get("type") != "tool_use":
                    continue
                tool_name = block.get("name", "")
                tool_input = block.get("input", {})
                input_str = stringify(tool_input)
                if pattern_re.search(input_str):
                    findings.append({
                        "line": line_num,
                        "tool": tool_name,
                        "match_in_input": (input_str[:200] + "…") if len(input_str) > 200 else input_str,
                    })
    return findings


def main():
    if len(sys.argv) != 3 or sys.argv[2] not in ("a", "b"):
        print("Usage: python3 audit-cross-arm-contamination.py <agent_jsonl> <own_arm_letter:a|b>", file=sys.stderr)
        sys.exit(2)
    path = Path(sys.argv[1])
    own_arm = sys.argv[2]
    if not path.exists():
        print(f"File not found: {path}", file=sys.stderr)
        sys.exit(2)

    findings = audit(path, own_arm)
    other = "b" if own_arm == "a" else "a"
    if not findings:
        print(json.dumps({
            "verdict": "PASS",
            "own_arm": own_arm,
            "other_arm": other,
            "findings_count": 0,
            "agent_jsonl": str(path),
        }, indent=2))
        sys.exit(0)
    print(json.dumps({
        "verdict": "FAIL",
        "own_arm": own_arm,
        "other_arm": other,
        "findings_count": len(findings),
        "findings": findings,
        "agent_jsonl": str(path),
    }, indent=2))
    sys.exit(1)


if __name__ == "__main__":
    main()
