#!/usr/bin/env python3
"""
Audit a Claude Code session jsonl (top-level or sub-agent) for cross-arm file
access.

Scans EVERY tool_use block for input strings matching the cross-arm filename
pattern. Detects cross-arm reads via Read, Bash (cat/head/tail/grep/awk/sed/
less/more/find/xargs), Glob, Grep, and Edit tools.

Under v4/v5 the audit ran against sub-agent JSONLs (parent-dispatched
worktree-isolation children at `~/.claude/projects/<slug>/<session>/subagents/agent-<id>.jsonl`).
Under v6 (kh-s199b top-level worktree per arm) the audit runs against
top-level session JSONLs at `~/.claude/projects/<arm-worktree-slug>/<session-uuid>.jsonl`.
Both have the same `tool_use` block structure — script logic unchanged.

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


# Per-tool fields that represent actual file/path/command access. Only these
# are scanned for cross-arm patterns. Excluded by design (kh-s199b 2026-04-26
# fix-pass-2 patch): Bash `description` (agent's stated intent, not access);
# Edit/Write `old_string` / `new_string` (content not access — may mention
# arm-* legitimately when the file under edit references both arms by name);
# anything else not in this allowlist.
TOOL_ACCESS_FIELDS = {
    "Read":         {"file_path"},
    "Edit":         {"file_path"},
    "Write":        {"file_path"},
    "NotebookEdit": {"notebook_path"},
    "Glob":         {"pattern", "path"},
    "Grep":         {"pattern", "path", "include"},
    "Bash":         {"command"},
    "WebFetch":     {"url"},
}
# Tools not in the allowlist fall back to this generic access-field set
# (still excludes description / content fields).
GENERIC_ACCESS_FIELDS = {"file_path", "path", "pattern", "command", "notebook_path", "url"}


def stringify(obj) -> str:
    """Recursively flatten a value (used for nested patterns/paths) into a string for matching."""
    if isinstance(obj, dict):
        return " ".join(stringify(v) for v in obj.values())
    if isinstance(obj, list):
        return " ".join(stringify(v) for v in obj)
    return str(obj) if obj is not None else ""


def extract_access_string(tool_name: str, tool_input: dict) -> str:
    """Extract only fields that represent actual file/path/command access.

    Replaces the previous behaviour of flattening every input field, which
    produced false positives when the cross-arm substring appeared in
    non-access fields (e.g. Bash `description` containing the agent's stated
    intent like 'check no arm-a path leaked').
    """
    if not isinstance(tool_input, dict):
        return stringify(tool_input)
    fields = TOOL_ACCESS_FIELDS.get(tool_name, GENERIC_ACCESS_FIELDS)
    parts = []
    for field in fields:
        if field not in tool_input:
            continue
        parts.append(stringify(tool_input[field]))
    return " ".join(parts)


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
                input_str = extract_access_string(tool_name, tool_input)
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
