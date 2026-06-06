"""EXECUTOR-VERIFY-1 probe (ID-75.8) — memo over a frozen dataclass arg.

TECH §3 WP-C + §8 (docs/specs/ID-75-pullmd-cocoindex/TECH.md) name a single
engine-behaviour uncertainty: does ``@coco.fn(memo=True)`` memo-key correctly
over a FROZEN DATACLASS argument under the installed ``cocoindex==1.0.3``?
The engine memo-keys on serialised args; ``FileLike`` has bespoke handling, so
a custom dataclass may not be supported. API *presence* is already verified
(TECH §9) — this probe checks *behaviour* against the real engine, not a stub.

Probe design (mirrors the production ``mount_each`` per-item pattern):

1. Define a frozen dataclass ``ProbeItem`` (same field shapes as ``UrlItem``:
   str scalars + tuple[str, ...]).
2. Define ``@coco.fn(memo=True)`` component that records each REAL execution.
3. Run a root app twice via ``update_blocking()``; the second run passes an
   EQUAL-VALUED but DISTINCT instance. A value-keyed memo must NOT re-execute.
3b. Within-run dedup is NOT probed — one component subpath per run, matching
   the production shape (one ``ingest_url`` mount per normalised URL).
4. Negative control: a third run bumps ``content_epoch`` — the memo MUST miss
   (a false PASS from a memo that never keys at all would be caught here).

Verdict semantics (TECH §WP-C EXECUTOR-VERIFY-1):
- SUPPORTED   → ``ingest_url(item: UrlItem, ...)`` may take the dataclass.
- UNSUPPORTED → adopt the documented FALLBACK: pass scalar fields positionally
  (url, content_epoch, ...) — fixes the {75.10} ``ingest_url`` signature.

Run: ``PYTHONUNBUFFERED=1 python3 scripts/spikes/id75-executor-verify-1-memo-probe.py``
"""

from __future__ import annotations

import os
import tempfile
from dataclasses import dataclass

# Point the engine's LMDB state store at a throwaway dir BEFORE the first
# environment is materialised (Settings.from_env reads COCOINDEX_DB lazily).
_STATE_DIR = tempfile.mkdtemp(prefix="id75-memo-probe-")
os.environ["COCOINDEX_DB"] = _STATE_DIR

import cocoindex as coco  # noqa: E402

EXECUTIONS: list[str] = []


@dataclass(frozen=True)
class ProbeItem:
    """Frozen dataclass with UrlItem's field shapes (str + tuple[str, ...])."""

    url: str
    content_epoch: str
    ledger_urls: tuple[str, ...]


@coco.fn(memo=True)
async def probe_component(item: ProbeItem) -> str:
    """Memoised component — appends to EXECUTIONS only on REAL execution."""
    EXECUTIONS.append(f"{item.url}@{item.content_epoch}")
    return f"{item.url}|{item.content_epoch}"


def _make_item(epoch: str) -> ProbeItem:
    # A FRESH instance every call — equal-valued, distinct identity. An
    # identity-keyed (or unsupported) memo would re-execute on run 2.
    return ProbeItem(
        url="https://example.com/article",
        content_epoch=epoch,
        ledger_urls=("https://example.com/article?utm_source=feed",),
    )


async def _root(epoch: str) -> None:
    await coco.mount(
        coco.component_subpath("probe"), probe_component, _make_item(epoch)
    )


def main() -> None:
    epoch_1 = "2026-06-01T00:00:00Z"
    epoch_2 = "2026-06-02T12:00:00Z"

    app = coco.App("id75_memo_probe", _root, epoch_1)

    # Run 1 — cold: the component MUST execute.
    app.update_blocking()
    assert EXECUTIONS == [f"https://example.com/article@{epoch_1}"], (
        f"run 1 expected exactly one execution, got {EXECUTIONS!r}"
    )

    # Run 2 — same value, distinct instance: a value-keyed memo MUST hit.
    app.update_blocking()
    supported = len(EXECUTIONS) == 1

    # Run 3 — negative control: bumped epoch MUST miss (proves the memo
    # actually keys on the dataclass VALUE rather than never re-running).
    app_2 = coco.App("id75_memo_probe_neg", _root, epoch_2)
    app_2.update_blocking()
    negative_ok = f"https://example.com/article@{epoch_2}" in EXECUTIONS

    print(f"executions: {EXECUTIONS!r}")
    print(f"run-2 memo hit over equal-valued frozen dataclass: {supported}")
    print(f"run-3 negative control (epoch bump re-executes): {negative_ok}")

    if supported and negative_ok:
        print("EXECUTOR-VERIFY-1 VERDICT: SUPPORTED — memo=True keys correctly "
              "over a frozen-dataclass arg (cocoindex 1.0.3)")
    else:
        print("EXECUTOR-VERIFY-1 VERDICT: UNSUPPORTED — adopt scalar-args "
              "fallback for ingest_url (url, content_epoch, ...)")
        raise SystemExit(1)


if __name__ == "__main__":
    main()
