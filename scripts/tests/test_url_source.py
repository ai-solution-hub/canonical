"""Tests for the URL snapshot source (D-1/D-2, ID-75.8).

Verifies the BI-18 enumeration contract (`feed_articles WHERE passed = true`,
no `feed_sources` read, no scoring logic), the BI-8 cross-workspace URL-dedup
grouping (N ledger rows collapse to one item per normalised URL), and the D-2
`LiveMapView` conformance of the snapshot iterator (``__aiter__`` +
benign-no-op ``watch``).

The pool seam is faked (this is a unit test of the source's enumeration
contract, not of asyncpg); ``LiveMapView`` conformance is asserted against the
REAL installed cocoindex protocol — `url_source.py` itself never imports
cocoindex, so no conftest stubbing is needed here.
"""

import asyncio
import dataclasses
from datetime import datetime, timezone
from unittest.mock import AsyncMock

import pytest

from scripts.cocoindex_pipeline.url_source import (
    INGESTION_SOURCE_RSS_FEED,
    FeedUrlSource,
    UrlItem,
)


class FakePool:
    """Minimal asyncpg-pool stand-in capturing every issued query."""

    def __init__(self, rows):
        self._rows = rows
        self.queries: list[str] = []

    async def fetch(self, query, *args):
        self.queries.append(query)
        return self._rows


def _row(
    *,
    external_url,
    workspace_id,
    ingested_at,
    title="Example article",
    ai_summary="A summary.",
    published_at=None,
):
    # Mirrors the asyncpg Record key-access shape with plain dicts.
    return {
        "external_url": external_url,
        "title": title,
        "ai_summary": ai_summary,
        "published_at": published_at,
        "ingested_at": ingested_at,
        "workspace_id": workspace_id,
    }


def _collect(source: FeedUrlSource):
    async def run():
        return [pair async for pair in source.items()]

    return asyncio.run(run())


class TestEnumerationPredicate:
    """BI-18: one SELECT over feed_articles WHERE passed = true; nothing else."""

    def test_single_query_selects_only_passed_true_from_feed_articles(self):
        pool = FakePool([])
        _collect(FeedUrlSource(pool))

        assert len(pool.queries) == 1, "snapshot enumeration must issue ONE query"
        query = pool.queries[0]
        assert "FROM feed_articles" in query
        assert "WHERE passed = true" in query, (
            "the enumeration predicate must select only passed=true ledger rows"
        )

    def test_no_feed_sources_query_issued(self):
        pool = FakePool([])
        _collect(FeedUrlSource(pool))

        # Guard BOTH shapes: a JOIN embedded in the primary SELECT string
        # itself, and any separate feed_sources query.
        assert "feed_sources" not in pool.queries[0], (
            "BI-18: the primary SELECT must not join or reference feed_sources"
        )
        assert not any("feed_sources" in q for q in pool.queries), (
            "BI-18: the URL source must not read feed_sources (no scoring logic)"
        )

    def test_no_scoring_columns_selected(self):
        pool = FakePool([])
        _collect(FeedUrlSource(pool))

        query = pool.queries[0]
        for column in ("score", "relevance"):
            assert column not in query, (
                f"BI-18: scoring column {column!r} must not be enumerated"
            )


class TestCrossWorkspaceCollapse:
    """BI-8: N ledger rows for one URL collapse to ONE item per normalised URL."""

    EPOCH_OLD = datetime(2026, 6, 1, 8, 0, 0, tzinfo=timezone.utc)
    EPOCH_NEW = datetime(2026, 6, 3, 12, 30, 0, tzinfo=timezone.utc)

    def _two_workspace_rows(self):
        # Same article URL seeded in TWO workspaces; the raw stored values
        # differ (one carries a tracking param) but normalise identically —
        # the defensive re-normalisation (D-8) must group them.
        return [
            _row(
                external_url="https://example.com/article?utm_source=feed",
                workspace_id="11111111-1111-4111-8111-111111111111",
                ingested_at=self.EPOCH_OLD,
                title="Older title",
                ai_summary=None,
            ),
            _row(
                external_url="https://example.com/article",
                workspace_id="22222222-2222-4222-8222-222222222222",
                ingested_at=self.EPOCH_NEW,
                title="Newer title",
                ai_summary="Latest summary.",
            ),
        ]

    def test_two_workspace_rows_yield_one_item(self):
        pool = FakePool(self._two_workspace_rows())
        pairs = _collect(FeedUrlSource(pool))

        assert len(pairs) == 1, "two ledger rows for one URL must yield ONE item"
        key, item = pairs[0]
        assert key == "https://example.com/article"
        assert item.url == "https://example.com/article"

    def test_item_carries_both_raw_ledger_urls(self):
        pool = FakePool(self._two_workspace_rows())
        [(_, item)] = _collect(FeedUrlSource(pool))

        # D-7 backlink predicate: the RAW stored external_url values, so the
        # UPDATE ... WHERE external_url = ANY($2) hits every ledger row even
        # if normalisation rules ever drift from stored values.
        assert set(item.ledger_urls) == {
            "https://example.com/article?utm_source=feed",
            "https://example.com/article",
        }

    def test_item_carries_both_workspace_ids(self):
        pool = FakePool(self._two_workspace_rows())
        [(_, item)] = _collect(FeedUrlSource(pool))

        assert set(item.workspace_ids) == {
            "11111111-1111-4111-8111-111111111111",
            "22222222-2222-4222-8222-222222222222",
        }

    def test_content_epoch_is_max_ingested_at_iso(self):
        pool = FakePool(self._two_workspace_rows())
        [(_, item)] = _collect(FeedUrlSource(pool))

        # D-4 memo token: max ingested_at across the URL's ledger rows.
        assert item.content_epoch == self.EPOCH_NEW.isoformat()

    def test_summary_is_latest_non_null_ai_summary(self):
        # Latest row's summary is NULL — the source must fall back to the
        # most recent NON-NULL ai_summary, not surface None.
        rows = self._two_workspace_rows()
        rows[0]["ai_summary"] = "Older summary."
        rows[1]["ai_summary"] = None
        pool = FakePool(rows)
        [(_, item)] = _collect(FeedUrlSource(pool))

        assert item.summary == "Older summary."

    def test_all_null_summaries_yield_none(self):
        # D-10: summary is 'latest NON-NULL ai_summary' and NULLABLE — when
        # EVERY ledger row's ai_summary is None, the item's summary is None
        # (a spec-valid output, not an error).
        rows = self._two_workspace_rows()
        for row in rows:
            row["ai_summary"] = None
        pool = FakePool(rows)
        [(_, item)] = _collect(FeedUrlSource(pool))

        assert item.summary is None

    def test_title_and_ingestion_source_from_ledger(self):
        pool = FakePool(self._two_workspace_rows())
        [(_, item)] = _collect(FeedUrlSource(pool))

        assert item.title == "Newer title"  # latest ledger row's title
        assert item.ingestion_source == INGESTION_SOURCE_RSS_FEED

    def test_distinct_urls_yield_distinct_items(self):
        rows = self._two_workspace_rows() + [
            _row(
                external_url="https://other.example.org/post",
                workspace_id="11111111-1111-4111-8111-111111111111",
                ingested_at=self.EPOCH_OLD,
            )
        ]
        pool = FakePool(rows)
        pairs = _collect(FeedUrlSource(pool))

        assert sorted(key for key, _ in pairs) == [
            "https://example.com/article",
            "https://other.example.org/post",
        ]

    def test_enumeration_order_is_deterministic(self):
        # The memo key is the whole UrlItem (EXECUTOR-VERIFY-1: SUPPORTED),
        # so tuple field ordering must not depend on SQL row order.
        rows = self._two_workspace_rows()
        forward = _collect(FeedUrlSource(FakePool(rows)))
        reverse = _collect(FeedUrlSource(FakePool(list(reversed(rows)))))

        assert forward == reverse


class TestLiveMapViewConformance:
    """D-2: items() returns a LiveMapView-conforming snapshot iterator."""

    def test_items_view_is_a_livemapview(self):
        # Asserted against the REAL installed engine protocol (TECH §9 —
        # runtime_checkable), not a stub.
        from cocoindex._internal.live_component import LiveMapFeed, LiveMapView

        src = FeedUrlSource(FakePool([])).items()
        assert isinstance(src, LiveMapView)
        assert isinstance(src, LiveMapFeed)

    def test_watch_marks_ready_without_feeding(self):
        # bl-221 one-shot posture: watch() signals readiness and returns —
        # it must never push updates or deletes into the subscriber.
        subscriber = AsyncMock()
        src = FeedUrlSource(FakePool([])).items()

        asyncio.run(src.watch(subscriber))

        subscriber.mark_ready.assert_awaited_once()
        subscriber.update.assert_not_awaited()
        subscriber.update_all.assert_not_awaited()
        subscriber.delete.assert_not_awaited()


class TestUrlItemShape:
    """UrlItem is the memo-keyed arg (EXECUTOR-VERIFY-1) — frozen, value-equal."""

    def _item(self):
        return UrlItem(
            url="https://example.com/article",
            title="Example",
            summary=None,
            published_at=None,
            ingestion_source=INGESTION_SOURCE_RSS_FEED,
            content_epoch="2026-06-03T12:30:00+00:00",
            ledger_urls=("https://example.com/article",),
            workspace_ids=("11111111-1111-4111-8111-111111111111",),
        )

    def test_urlitem_is_frozen(self):
        item = self._item()
        with pytest.raises(dataclasses.FrozenInstanceError):
            item.url = "https://tampered.example.com"

    def test_urlitem_equal_by_value(self):
        # Equal-valued distinct instances must compare equal — the property
        # the engine's dataclass memo canonicalisation keys on.
        assert self._item() == self._item()
        assert hash(self._item()) == hash(self._item())
