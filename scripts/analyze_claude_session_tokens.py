#!/usr/bin/env python3
"""Analyse Claude Code session-transcript token economics.

Reads Claude Code JSONL session transcripts (the ones written to
``~/.claude/projects/<project-hash>/*.jsonl``) and reports where the tokens
actually go: fresh (uncached) input, cache writes, cache reads, and output.

Why this exists
---------------
On a Max subscription the currency that draws down your usage limits is token
throughput, not dollars. In an append-only agentic loop the growing prefix is
re-read every turn, so cumulative cache-read tokens dwarf everything else. This
tool quantifies that split so you can reason about whether a context-compression
layer (e.g. Headroom) has any addressable surface — and what its best case is —
*before* installing anything.

It is read-only and dependency-free (stdlib only).

Usage
-----
    # one session
    python3 scripts/analyze_claude_session_tokens.py path/to/session.jsonl

    # a whole project's history (main sessions + subagent sidechains)
    python3 scripts/analyze_claude_session_tokens.py ~/.claude/projects/<hash>/

    # everything
    python3 scripts/analyze_claude_session_tokens.py ~/.claude/projects/

Notes
-----
* Token tallies come straight from each assistant turn's ``message.usage`` block
  (authoritative — these are what Anthropic counted).
* Tool-output token estimates use a chars/4 heuristic (flagged ``~``). For an
  exact figure, re-count the tool_result payloads with the count_tokens endpoint.
* "Cache-safe ceiling" is the *optimistic* upper bound for a compressor that
  rewrites tool outputs deterministically without ever breaking the cached
  prefix. Real proxies that recompress already-cached content non-deterministically
  invalidate the prefix and make the net negative — this tool cannot model that
  failure mode, it only bounds the upside.
"""

from __future__ import annotations

import json
import sys
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

# Anthropic prompt-cache billing multipliers (token-equivalent units).
# Used ONLY to model the "what if the Max limit meter mirrors cost" scenario.
W_FRESH = 1.0
W_CACHE_WRITE_5M = 1.25
W_CACHE_WRITE_1H = 2.0
W_CACHE_READ = 0.1
W_OUTPUT = 1.0

CHARS_PER_TOKEN_EST = 4  # rough; flagged with ~ wherever surfaced


@dataclass
class Totals:
    turns: int = 0
    fresh_input: int = 0
    cache_write_5m: int = 0
    cache_write_1h: int = 0
    cache_read: int = 0
    output: int = 0
    peak_context: int = 0  # max per-turn input-side (≈ context high-water mark)
    tool_result_chars: int = 0
    tool_result_count: int = 0
    subagent_spawns: Counter = field(default_factory=Counter)

    @property
    def cache_write(self) -> int:
        return self.cache_write_5m + self.cache_write_1h

    @property
    def input_side(self) -> int:
        return self.fresh_input + self.cache_write + self.cache_read

    @property
    def flat_total(self) -> int:
        return self.input_side + self.output

    @property
    def cost_weighted(self) -> float:
        return (
            self.fresh_input * W_FRESH
            + self.cache_write_5m * W_CACHE_WRITE_5M
            + self.cache_write_1h * W_CACHE_WRITE_1H
            + self.cache_read * W_CACHE_READ
            + self.output * W_OUTPUT
        )

    def add(self, other: "Totals") -> None:
        self.turns += other.turns
        self.fresh_input += other.fresh_input
        self.cache_write_5m += other.cache_write_5m
        self.cache_write_1h += other.cache_write_1h
        self.cache_read += other.cache_read
        self.output += other.output
        self.peak_context = max(self.peak_context, other.peak_context)
        self.tool_result_chars += other.tool_result_chars
        self.tool_result_count += other.tool_result_count
        self.subagent_spawns.update(other.subagent_spawns)


def analyse_file(path: Path) -> Totals:
    t = Totals()
    for raw in path.read_text(errors="replace").splitlines():
        raw = raw.strip()
        if not raw:
            continue
        try:
            d = json.loads(raw)
        except json.JSONDecodeError:
            continue

        msg = d.get("message")
        if isinstance(msg, dict) and isinstance(msg.get("usage"), dict):
            u = msg["usage"]
            t.turns += 1
            t.fresh_input += u.get("input_tokens", 0) or 0
            t.cache_read += u.get("cache_read_input_tokens", 0) or 0
            t.output += u.get("output_tokens", 0) or 0
            cc = u.get("cache_creation") or {}
            t.cache_write_5m += cc.get("ephemeral_5m_input_tokens", 0) or 0
            t.cache_write_1h += cc.get("ephemeral_1h_input_tokens", 0) or 0
            # fall back to the flat field if the split isn't present
            if not cc:
                t.cache_write_5m += u.get("cache_creation_input_tokens", 0) or 0
            side = (
                (u.get("input_tokens", 0) or 0)
                + (u.get("cache_creation_input_tokens", 0) or 0)
                + (u.get("cache_read_input_tokens", 0) or 0)
            )
            t.peak_context = max(t.peak_context, side)

        # Tool-output payloads = the only surface a compressor can touch.
        tr = d.get("toolUseResult")
        if tr is not None:
            t.tool_result_chars += len(tr) if isinstance(tr, str) else len(json.dumps(tr))
            t.tool_result_count += 1

        # Subagent (Task) spawns from this thread.
        if isinstance(msg, dict) and isinstance(msg.get("content"), list):
            for b in msg["content"]:
                if isinstance(b, dict) and b.get("type") == "tool_use" and b.get("name") == "Task":
                    t.subagent_spawns[b.get("input", {}).get("subagent_type", "?")] += 1
    return t


def _pct(n: float, d: float) -> str:
    return f"{(n / d * 100) if d else 0:5.1f}%"


def report(label: str, t: Totals) -> None:
    print(f"\n{'=' * 64}\n{label}\n{'=' * 64}")
    print(f"assistant turns (API requests): {t.turns:,}")
    print("\nRAW TOKEN TOTALS (what flowed through the model)")
    print(f"  fresh input (uncached) : {t.fresh_input:>14,}  {_pct(t.fresh_input, t.input_side)} of input-side")
    print(f"  cache WRITE            : {t.cache_write:>14,}  {_pct(t.cache_write, t.input_side)}   (5m {t.cache_write_5m:,} | 1h {t.cache_write_1h:,})")
    print(f"  cache READ             : {t.cache_read:>14,}  {_pct(t.cache_read, t.input_side)}")
    print(f"  output                 : {t.output:>14,}")
    print(f"  {'-' * 50}")
    print(f"  FLAT total             : {t.flat_total:>14,}")
    print(f"\n  peak per-turn context (≈ window high-water mark): {t.peak_context:,} tokens")

    print("\nLIMIT-CONSUMPTION SCENARIOS (the Max-meter weighting is the open question)")
    flat = t.flat_total
    cw = t.cost_weighted
    print(f"  A) flat token meter          : {flat:>14,} units")
    print(f"  B) cost-weighted meter       : {cw:>14,.0f} units  (cache read @0.1x)")
    if flat:
        print(f"     B/A                       : {cw / flat:.3f}  <- caching saves this IF the meter is cost-weighted")

    # Compressible surface + optimistic ceiling.
    tr_tok = t.tool_result_chars / CHARS_PER_TOKEN_EST
    print("\nCOMPRESSION-LAYER ADDRESSABLE SURFACE (tool outputs only)")
    print(f"  tool_result payloads   : {t.tool_result_count:,} results, ~{tr_tok:,.0f} tokens (est @{CHARS_PER_TOKEN_EST}ch/tok)")
    if t.peak_context:
        frac = tr_tok / t.peak_context
        print(f"  tool-output share of peak context: ~{frac * 100:.1f}%")
        for r in (0.70, 0.90):
            print(
                f"  cache-SAFE ceiling @ {int(r * 100)}% compression: "
                f"~{r * frac * 100:.1f}% off cache_read (best case; assumes NO prefix breakage)"
            )
    if t.subagent_spawns:
        print(f"\n  subagent spawns from this thread: {dict(t.subagent_spawns)}")
        print("  (subagents run in separate windows with separate caches — analyse their")
        print("   transcripts too; this tally only counts spawns from the main thread)")


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(__doc__)
        return 2
    target = Path(argv[1]).expanduser()
    files = sorted(target.rglob("*.jsonl")) if target.is_dir() else [target]
    files = [f for f in files if f.is_file()]
    if not files:
        print(f"no .jsonl transcripts found under {target}")
        return 1

    grand = Totals()
    for f in files:
        t = analyse_file(f)
        if t.turns == 0:  # not a usage-bearing transcript (e.g. a meta file)
            continue
        if len(files) > 1:
            report(f.name, t)
        grand.add(t)

    report(f"AGGREGATE ({len([f for f in files])} file(s))" if len(files) > 1 else files[0].name, grand)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
