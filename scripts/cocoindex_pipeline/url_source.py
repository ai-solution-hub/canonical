"""URL snapshot source for the cocoindex flow — D-1/D-2 (ID-75.8).

Enumerates passed ledger articles (`feed_articles WHERE passed = true`) into
one item per normalised URL, for `mount_each` consumption by the `ingest_url`
component ({75.10}). Hand-rolled (D-1) because the enumeration needs both a
filtered predicate and the BI-8 cross-workspace URL-dedup grouping that
`PgTableSource`'s whole-table row enumeration cannot express. The structural
reference implementation is the localfs `DirWalker`
(`cocoindex/connectors/localfs/_source.py`, RESEARCH §4.1).

Contract (TECH §3 WP-C, the ID-75 URL-cocoindex spec):

- ONE SELECT over `feed_articles` — NO `feed_sources` read, NO scoring logic
  (BI-18; scoring stays the TS poller's concern).
- Rows are grouped Python-side by `normalise_url(external_url)` so N ledger
  rows (one per workspace) collapse to ONE item per URL (BI-8). The
  re-normalisation is defensive: `external_url` is stored already-normalised
  by the TS pipeline and `normalise_url` is idempotent (D-8).
- `items()` returns a `LiveMapView`-conforming snapshot iterator (D-2, as
  corrected by ID-75.16): `__aiter__` yields `(normalised_url, UrlItem)`;
  `watch(subscriber)` feeds the snapshot via `subscriber.update_all()` and
  THEN calls `subscriber.mark_ready()`. The ID-75.16 real-engine probe
  (`scripts/tests/test_url_source_engine_consumption.py`) proved the original
  D-2 claim ("the engine consumes the snapshot per walk via `__aiter__`")
  FALSE on cocoindex 1.0.3: `mount_each` wraps any watch-bearing source in a
  `_MountEachLiveComponent` consumed EXCLUSIVELY via `watch()` — `__aiter__`
  is reached only through `update_all()` → `update_full()` → `process()`.
  A mark_ready-only `watch()` therefore enumerated NOTHING (the S319
  staging `{url: 0}` tally). The fixed shape mirrors the localfs
  `_LiveDirItems` twin minus its watchfiles loop, preserving the bl-221
  one-shot `update_blocking(live=False)` posture: in catch-up mode
  `mark_ready()` terminates the watch — no live watching. Conformance is
  structural (`runtime_checkable` protocol) so this module never imports
  cocoindex — preserving the collection-safety property `_coco_api.py`
  documents.

`UrlItem` is the memo-keyed argument of the `ingest_url` component.
EXECUTOR-VERIFY-1 (TECH §WP-C + §8) verified empirically against the installed
`cocoindex==1.0.3` engine that `@coco.fn(memo=True)` memo-keys correctly over
a frozen-dataclass arg (`memo_fingerprint._canonicalize_dataclass` keys on
module, qualname and field VALUES — an equal-valued distinct instance
memo-hits; a bumped field re-executes). The grouping therefore keeps every
tuple field deterministically ordered: SQL row order must not perturb the
memo fingerprint.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import TYPE_CHECKING, Any, AsyncIterator, Mapping, Sequence

from scripts.cocoindex_pipeline.url_normalise import normalise_url

if TYPE_CHECKING:  # type-only: never imported at runtime (collection safety)
    from cocoindex._internal.live_component import LiveMapSubscriber

# v1 acquisition route (BI-9 / D-11): every enumerated URL arrives via the RSS
# ledger. `url_import` joins when a manual-URL route ships (post-v1).
INGESTION_SOURCE_RSS_FEED = "rss_feed"

# BI-18: the ONLY query this source issues. No feed_sources join, no scoring
# columns — passed=true is the poller's already-decided verdict.
_PASSED_URLS_SQL = (
    "SELECT external_url, title, ai_summary, published_at, ingested_at, "
    "workspace_id "
    "FROM feed_articles "
    "WHERE passed = true"
)


@dataclass(frozen=True)
class UrlItem:
    """One passed URL, collapsed across its N ledger rows (BI-8).

    Frozen: this is the memo-keyed component argument (EXECUTOR-VERIFY-1).

    `workspace_ids` is provenance/attribution ONLY — it is NEVER written to
    `reference_items` (BI-7); workspace provenance is recoverable via the
    `feed_articles` backlink join (BI-18).
    """

    url: str
    """Normalised URL — the enumeration key and uuid5 seed input."""

    title: str
    """Latest ledger row's title (feed-declared, NOT NULL — D-10)."""

    summary: str | None
    """Latest NON-NULL `ai_summary` across the URL's ledger rows (D-10)."""

    published_at: str | None
    """Latest ledger row's `published_at`, ISO 8601 string (nullable)."""

    ingestion_source: str
    """Acquisition route — `'rss_feed'` v1 (BI-9 / D-11)."""

    content_epoch: str
    """Max `ingested_at` across the URL's ledger rows, ISO 8601 string —
    the D-4 memo token. A bumped epoch forces a fresh fetch + extraction."""

    ledger_urls: tuple[str, ...]
    """RAW stored `external_url` values — the D-7 backlink predicate
    (`UPDATE feed_articles ... WHERE external_url = ANY($2)`)."""

    workspace_ids: tuple[str, ...]
    """Provenance/attribution ONLY — never written to `reference_items`
    (BI-7)."""


def _to_iso(value: Any) -> str | None:
    """Render a timestamp column value as an ISO 8601 string (None passes)."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)


def _group_rows(
    rows: Sequence[Mapping[str, Any]],
) -> list[tuple[str, UrlItem]]:
    """Collapse ledger rows to one `(normalised_url, UrlItem)` per URL (BI-8).

    Ordering inside each group is fully deterministic (ingested_at, then raw
    URL, then workspace id) so the tuple fields — and therefore the engine's
    memo fingerprint over the frozen `UrlItem` — never depend on SQL row
    order.
    """
    grouped: dict[str, list[Mapping[str, Any]]] = {}
    for row in rows:
        grouped.setdefault(normalise_url(row["external_url"]), []).append(row)

    pairs: list[tuple[str, UrlItem]] = []
    for url in sorted(grouped):
        ordered = sorted(
            grouped[url],
            key=lambda r: (
                _to_iso(r["ingested_at"]) or "",
                r["external_url"],
                str(r["workspace_id"]),
            ),
        )
        latest = ordered[-1]
        summary = next(
            (
                r["ai_summary"]
                for r in reversed(ordered)
                if r["ai_summary"] is not None
            ),
            None,
        )
        # dict.fromkeys = order-preserving dedup over the sorted rows.
        ledger_urls = tuple(dict.fromkeys(r["external_url"] for r in ordered))
        workspace_ids = tuple(
            dict.fromkeys(str(r["workspace_id"]) for r in ordered)
        )
        pairs.append(
            (
                url,
                UrlItem(
                    url=url,
                    title=latest["title"],
                    summary=summary,
                    published_at=_to_iso(latest["published_at"]),
                    ingestion_source=INGESTION_SOURCE_RSS_FEED,
                    content_epoch=_to_iso(latest["ingested_at"]) or "",
                    ledger_urls=ledger_urls,
                    workspace_ids=workspace_ids,
                ),
            )
        )
    return pairs


class _PassedUrlItems:
    """`LiveMapView`-conforming snapshot over the passed-URL ledger (D-2).

    Structural twin of the localfs `_LiveDirItems` (RESEARCH §4.1), minus the
    watchfiles loop: `__aiter__` scans the snapshot; `watch` feeds that
    snapshot to the engine via `subscriber.update_all()` then signals
    readiness. The engine NEVER consults `__aiter__` directly — `mount_each`
    consumes watch-bearing sources only through `watch()` (ID-75.16
    probe-proven; see the module docstring). Under the bl-221 one-shot
    `update_blocking(live=False)` posture, `mark_ready()` terminates the
    watch, so exactly one snapshot feed happens per walk.
    """

    def __init__(self, pool: Any) -> None:
        self._pool = pool

    def __aiter__(self) -> AsyncIterator[tuple[str, UrlItem]]:
        return self._aiter_impl()

    async def _aiter_impl(self) -> AsyncIterator[tuple[str, UrlItem]]:
        rows = await self._pool.fetch(_PASSED_URLS_SQL)
        for pair in _group_rows(rows):
            yield pair

    async def watch(self, subscriber: "LiveMapSubscriber[str, UrlItem]") -> None:
        """Feed the snapshot, then signal readiness (ID-75.16).

        `update_all()` triggers the engine's full re-iteration of `__aiter__`
        (`update_full()` → `_MountEachLiveComponent.process()`) — the ONLY
        path by which items reach `mount_each` from a watch-bearing source.
        `mark_ready()` then terminates the watch in catch-up mode (bl-221
        one-shot posture): no incremental updates, no live watching.
        """
        await subscriber.update_all()
        await subscriber.mark_ready()


class FeedUrlSource:
    """Snapshot URL source over `feed_articles` (D-1).

    Mirrors the `DirWalker` source shape: construct with the shared asyncpg
    pool (`coco.use_context(DB_CTX)` at the `app_main` call site, {75.10}),
    then pass `.items()` to `mount_each`.
    """

    def __init__(self, pool: Any) -> None:
        self._pool = pool

    def items(self) -> _PassedUrlItems:
        """Return the `LiveMapView`-conforming snapshot iterator (D-2)."""
        return _PassedUrlItems(self._pool)
