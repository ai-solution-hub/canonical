#!/usr/bin/env python3
"""
Extract per-agent usage tokens from a Claude Code agent jsonl transcript.

Aggregates `usage` blocks across every assistant API call in a sub-agent's
jsonl into a single per-agent total.

Usage:
    python3 extract-agent-usage.py <agent_jsonl_path>
    python3 extract-agent-usage.py ~/.claude/projects/<slug>/<session>/subagents/agent-<id>.jsonl

Output: JSON with input_tokens, cache_creation_input_tokens, cache_read_input_tokens,
output_tokens, api_call_count.

Used by the WP-S11-2 token-metering pipeline (spec §5.1 priority-1 source).

Per-agent total derivation:
- input_tokens = uncached input across all assistant calls
- cache_creation_input_tokens = tokens written to cache
- cache_read_input_tokens = tokens read from cache (90% cheaper)
- output_tokens = all assistant output across all calls
- api_call_count = number of usage blocks (proxy for back-and-forth turns)

Cost calculation (caller's responsibility):
- effective_input = input_tokens + cache_creation_input_tokens
                  + (cache_read_input_tokens * 0.10)
- cost = effective_input * input_price + output_tokens * output_price
"""

import json
import sys
from pathlib import Path


def extract(jsonl_path: Path) -> dict:
    totals = {
        "input_tokens": 0,
        "cache_creation_input_tokens": 0,
        "cache_read_input_tokens": 0,
        "output_tokens": 0,
        "api_call_count": 0,
    }
    with jsonl_path.open() as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            usage = row.get("message", {}).get("usage")
            if not isinstance(usage, dict):
                continue
            totals["input_tokens"] += usage.get("input_tokens", 0) or 0
            totals["cache_creation_input_tokens"] += (
                usage.get("cache_creation_input_tokens", 0) or 0
            )
            totals["cache_read_input_tokens"] += (
                usage.get("cache_read_input_tokens", 0) or 0
            )
            totals["output_tokens"] += usage.get("output_tokens", 0) or 0
            totals["api_call_count"] += 1
    return totals


def main():
    if len(sys.argv) != 2:
        print("Usage: python3 extract-agent-usage.py <agent_jsonl_path>", file=sys.stderr)
        sys.exit(2)
    path = Path(sys.argv[1])
    if not path.exists():
        print(f"File not found: {path}", file=sys.stderr)
        sys.exit(1)
    totals = extract(path)
    print(json.dumps(totals, indent=2))


if __name__ == "__main__":
    main()
