"""Tests for scripts/kb_pipeline/post_insert.py — shared post-insert helper.

Covers:
- Default flag behavior (all steps run)
- Per-step opt-out flags
- Classification == None behavior (entity/temporal steps silently skipped)
- Error capture (failures in underlying modules appended to result.errors)
- Logging callable pass-through
- PostInsertResult field defaults

Mocks the 8 underlying kb_pipeline modules via sys.modules injection so
tests run offline and deterministically.
"""

from __future__ import annotations

import os
import sys
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

# Ensure scripts/ is on sys.path so kb_pipeline imports resolve.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


# ──────────────────────────────────────────────────────────────────────
# Module-level fixtures
# ──────────────────────────────────────────────────────────────────────


@pytest.fixture
def mock_kb_pipeline_modules(monkeypatch):
    """Replace the 8 kb_pipeline sub-modules the helper lazily imports.

    Each mock returns deterministic values and records calls. The helper
    uses ``from .store import insert_content_history_entry`` style imports
    inside the function body, so patching the attribute on the module is
    enough — the helper will read the mocked attribute each call.
    """
    # store — insert_content_history_entry, merge_item_metadata, update_content_item
    store = sys.modules.get("kb_pipeline.store") or SimpleNamespace()
    store.insert_content_history_entry = MagicMock(return_value=True)
    store.merge_item_metadata = MagicMock(return_value=True)
    store.update_content_item = MagicMock(return_value=True)
    monkeypatch.setitem(sys.modules, "kb_pipeline.store", store)

    # chunk — store_chunks
    chunk = sys.modules.get("kb_pipeline.chunk") or SimpleNamespace()
    chunk.store_chunks = MagicMock(return_value=(3, []))
    monkeypatch.setitem(sys.modules, "kb_pipeline.chunk", chunk)

    # classify — load_entity_aliases, store_entities, store_relationships
    classify = sys.modules.get("kb_pipeline.classify") or SimpleNamespace()
    classify.load_entity_aliases = MagicMock(return_value=None)
    classify.store_entities = MagicMock(return_value=(5, 1))
    classify.store_relationships = MagicMock(return_value=(2, 0))
    monkeypatch.setitem(sys.modules, "kb_pipeline.classify", classify)

    # temporal_bridge — bridge_temporal_to_entities
    bridge = sys.modules.get("kb_pipeline.temporal_bridge") or SimpleNamespace()
    bridge.bridge_temporal_to_entities = MagicMock(return_value=4)
    monkeypatch.setitem(sys.modules, "kb_pipeline.temporal_bridge", bridge)

    # layer_inference — infer_layer
    layer = sys.modules.get("kb_pipeline.layer_inference") or SimpleNamespace()
    layer.infer_layer = MagicMock(
        return_value=SimpleNamespace(
            suggested_layer="content",
            confidence=0.85,
        )
    )
    monkeypatch.setitem(sys.modules, "kb_pipeline.layer_inference", layer)

    return SimpleNamespace(
        store=store,
        chunk=chunk,
        classify=classify,
        bridge=bridge,
        layer=layer,
    )


def make_classification(
    *,
    entities=None,
    relationships=None,
    temporal_references=None,
):
    """Build a SimpleNamespace shaped like a ClassificationResult."""
    return SimpleNamespace(
        entities=entities or [],
        relationships=relationships or [],
        temporal_references=temporal_references or [],
        suggested_title="Test Title",
    )


# ──────────────────────────────────────────────────────────────────────
# Defaults — all flags True
# ──────────────────────────────────────────────────────────────────────


class TestDefaults:
    """All flags default to True. All 8 steps should run given a full payload."""

    def test_full_payload_runs_every_step(self, mock_kb_pipeline_modules):
        from kb_pipeline.post_insert import run_post_insert

        cls = make_classification(
            entities=[{"canonical_name": "foo"}],
            relationships=[{"type": "uses"}],
            temporal_references=[{"date": "2026-04-21"}],
        )
        logs: list[str] = []
        result = run_post_insert(
            item_id="item-1",
            title="Hello",
            content="Some content body.",
            content_type="article",
            ingestion_source="test",
            classification=cls,
            history_change_summary="test history",
            logger=logs.append,
        )

        # Step 1 is a deliberate no-op (OPS-20): DB trigger handles v1.
        # history_ok is still True because the trigger guarantees v1 exists.
        assert result.history_ok is True
        assert result.chunks_stored == 3
        assert result.entities_stored == 5
        assert result.entities_skipped == 1
        assert result.relationships_stored == 2
        assert result.relationships_skipped == 0
        assert result.temporal_refs_stored == 1
        assert result.bridged == 4
        assert result.layer_set == "content"
        assert result.errors == []

        # Step 1 no longer calls insert_content_history_entry (OPS-20)
        mock_kb_pipeline_modules.store.insert_content_history_entry.assert_not_called()
        mock_kb_pipeline_modules.chunk.store_chunks.assert_called_once_with(
            "item-1", "Some content body."
        )
        mock_kb_pipeline_modules.classify.load_entity_aliases.assert_called_once()
        mock_kb_pipeline_modules.classify.store_entities.assert_called_once()
        mock_kb_pipeline_modules.classify.store_relationships.assert_called_once()
        mock_kb_pipeline_modules.store.merge_item_metadata.assert_called_once()
        mock_kb_pipeline_modules.bridge.bridge_temporal_to_entities.assert_called_once()
        mock_kb_pipeline_modules.layer.infer_layer.assert_called_once()
        mock_kb_pipeline_modules.store.update_content_item.assert_called_once_with(
            "item-1", {"layer": "content"}
        )

    def test_result_default_shape(self):
        from kb_pipeline.post_insert import PostInsertResult

        r = PostInsertResult()
        assert r.history_ok is False
        assert r.chunks_stored == 0
        assert r.chunk_errors == []
        assert r.entities_stored == 0
        assert r.entities_skipped == 0
        assert r.relationships_stored == 0
        assert r.relationships_skipped == 0
        assert r.temporal_refs_stored == 0
        assert r.bridged == 0
        assert r.layer_set is None
        assert r.errors == []


# ──────────────────────────────────────────────────────────────────────
# Per-step flag gating
# ──────────────────────────────────────────────────────────────────────


class TestFlagGating:
    """Each boolean flag should skip its corresponding step without touching
    any of the others."""

    def test_write_history_false_skips_history(self, mock_kb_pipeline_modules):
        from kb_pipeline.post_insert import run_post_insert

        result = run_post_insert(
            item_id="x",
            title="t",
            content="c",
            content_type="article",
            ingestion_source="test",
            write_history=False,
        )
        # Step 1 is a no-op (OPS-20) but write_history=False still means
        # history_ok stays at its default False value.
        assert result.history_ok is False
        mock_kb_pipeline_modules.store.insert_content_history_entry.assert_not_called()
        # Chunks still ran
        mock_kb_pipeline_modules.chunk.store_chunks.assert_called_once()

    def test_write_chunks_false_skips_chunks(self, mock_kb_pipeline_modules):
        from kb_pipeline.post_insert import run_post_insert

        run_post_insert(
            item_id="x",
            title="t",
            content="c",
            content_type="article",
            ingestion_source="test",
            write_chunks=False,
        )
        mock_kb_pipeline_modules.chunk.store_chunks.assert_not_called()
        # Step 1 is a no-op (OPS-20) — no call to insert_content_history_entry
        mock_kb_pipeline_modules.store.insert_content_history_entry.assert_not_called()

    def test_store_entities_flag_false_skips_entity_work(
        self, mock_kb_pipeline_modules
    ):
        from kb_pipeline.post_insert import run_post_insert

        cls = make_classification(
            entities=[{"canonical_name": "foo"}],
            relationships=[{"type": "uses"}],
        )
        run_post_insert(
            item_id="x",
            title="t",
            content="c",
            content_type="article",
            ingestion_source="test",
            classification=cls,
            store_entities_flag=False,
        )
        mock_kb_pipeline_modules.classify.load_entity_aliases.assert_not_called()
        mock_kb_pipeline_modules.classify.store_entities.assert_not_called()
        mock_kb_pipeline_modules.classify.store_relationships.assert_not_called()

    def test_write_temporal_false_skips_temporal(
        self, mock_kb_pipeline_modules
    ):
        from kb_pipeline.post_insert import run_post_insert

        cls = make_classification(temporal_references=[{"date": "2026-04"}])
        run_post_insert(
            item_id="x",
            title="t",
            content="c",
            content_type="article",
            ingestion_source="test",
            classification=cls,
            write_temporal=False,
        )
        mock_kb_pipeline_modules.store.merge_item_metadata.assert_not_called()

    def test_bridge_temporal_false_skips_bridge(
        self, mock_kb_pipeline_modules
    ):
        from kb_pipeline.post_insert import run_post_insert

        run_post_insert(
            item_id="x",
            title="t",
            content="c",
            content_type="article",
            ingestion_source="test",
            bridge_temporal=False,
        )
        mock_kb_pipeline_modules.bridge.bridge_temporal_to_entities.assert_not_called()

    def test_infer_layer_false_skips_layer(self, mock_kb_pipeline_modules):
        from kb_pipeline.post_insert import run_post_insert

        run_post_insert(
            item_id="x",
            title="t",
            content="c",
            content_type="article",
            ingestion_source="test",
            infer_layer_flag=False,
        )
        mock_kb_pipeline_modules.layer.infer_layer.assert_not_called()
        # update_content_item wouldn't be called for layer either
        mock_kb_pipeline_modules.store.update_content_item.assert_not_called()


# ──────────────────────────────────────────────────────────────────────
# Classification == None → entity steps silently skipped
# ──────────────────────────────────────────────────────────────────────


class TestNoClassification:
    """When classification is None, entity/relationship/temporal steps
    must be silently skipped (no error, no calls)."""

    def test_none_classification_skips_entity_ops(
        self, mock_kb_pipeline_modules
    ):
        from kb_pipeline.post_insert import run_post_insert

        result = run_post_insert(
            item_id="x",
            title="t",
            content="c",
            content_type="article",
            ingestion_source="test",
            classification=None,
        )
        mock_kb_pipeline_modules.classify.load_entity_aliases.assert_not_called()
        mock_kb_pipeline_modules.classify.store_entities.assert_not_called()
        mock_kb_pipeline_modules.classify.store_relationships.assert_not_called()
        mock_kb_pipeline_modules.store.merge_item_metadata.assert_not_called()
        # History Step 1 is a no-op (OPS-20), but chunks + bridge + layer still run
        mock_kb_pipeline_modules.store.insert_content_history_entry.assert_not_called()
        mock_kb_pipeline_modules.chunk.store_chunks.assert_called_once()
        mock_kb_pipeline_modules.bridge.bridge_temporal_to_entities.assert_called_once()
        mock_kb_pipeline_modules.layer.infer_layer.assert_called_once()
        # No errors logged
        assert result.errors == []

    def test_classification_with_empty_entities_does_not_call_store(
        self, mock_kb_pipeline_modules
    ):
        from kb_pipeline.post_insert import run_post_insert

        cls = make_classification(entities=[], relationships=[])
        run_post_insert(
            item_id="x",
            title="t",
            content="c",
            content_type="article",
            ingestion_source="test",
            classification=cls,
        )
        # No entity payload → aliases skipped
        mock_kb_pipeline_modules.classify.load_entity_aliases.assert_not_called()
        mock_kb_pipeline_modules.classify.store_entities.assert_not_called()


# ──────────────────────────────────────────────────────────────────────
# Error capture
# ──────────────────────────────────────────────────────────────────────


class TestErrorCapture:
    """Any underlying call can raise. The helper must catch, log, and append
    to result.errors — never propagate."""

    def test_history_step_is_noop_so_no_error_possible(
        self, mock_kb_pipeline_modules
    ):
        """OPS-20: Step 1 is a deliberate no-op. Even if
        insert_content_history_entry were to raise, it is never called,
        so history_ok is always True when write_history=True."""
        from kb_pipeline.post_insert import run_post_insert

        mock_kb_pipeline_modules.store.insert_content_history_entry.side_effect = (
            RuntimeError("should never fire")
        )
        result = run_post_insert(
            item_id="x",
            title="t",
            content="c",
            content_type="article",
            ingestion_source="test",
        )
        assert result.history_ok is True
        assert not any("history" in e for e in result.errors)
        mock_kb_pipeline_modules.store.insert_content_history_entry.assert_not_called()
        # Downstream steps still ran
        mock_kb_pipeline_modules.chunk.store_chunks.assert_called_once()

    def test_chunks_error_captured(self, mock_kb_pipeline_modules):
        from kb_pipeline.post_insert import run_post_insert

        mock_kb_pipeline_modules.chunk.store_chunks.side_effect = RuntimeError(
            "chunk boom"
        )
        result = run_post_insert(
            item_id="x",
            title="t",
            content="c",
            content_type="article",
            ingestion_source="test",
        )
        assert result.chunks_stored == 0
        assert any("chunks" in e for e in result.errors)

    def test_entity_storage_error_captured(self, mock_kb_pipeline_modules):
        from kb_pipeline.post_insert import run_post_insert

        mock_kb_pipeline_modules.classify.store_entities.side_effect = (
            RuntimeError("entities boom")
        )
        cls = make_classification(entities=[{"canonical_name": "foo"}])
        result = run_post_insert(
            item_id="x",
            title="t",
            content="c",
            content_type="article",
            ingestion_source="test",
            classification=cls,
        )
        assert result.entities_stored == 0
        assert any("entities" in e for e in result.errors)

    def test_multiple_errors_accumulate(self, mock_kb_pipeline_modules):
        from kb_pipeline.post_insert import run_post_insert

        # Step 1 is a no-op (OPS-20) so only chunks + layer errors fire.
        mock_kb_pipeline_modules.chunk.store_chunks.side_effect = RuntimeError(
            "chunk boom"
        )
        mock_kb_pipeline_modules.layer.infer_layer.side_effect = RuntimeError(
            "layer boom"
        )
        result = run_post_insert(
            item_id="x",
            title="t",
            content="c",
            content_type="article",
            ingestion_source="test",
        )
        assert len(result.errors) >= 2
        assert any("chunks" in e for e in result.errors)
        assert any("layer" in e for e in result.errors)


# ──────────────────────────────────────────────────────────────────────
# Logger + log_prefix
# ──────────────────────────────────────────────────────────────────────


class TestLogging:
    def test_default_logger_is_print(self, mock_kb_pipeline_modules, capsys):
        from kb_pipeline.post_insert import run_post_insert

        run_post_insert(
            item_id="x",
            title="t",
            content="c",
            content_type="article",
            ingestion_source="test",
        )
        captured = capsys.readouterr()
        assert "[Chunks]" in captured.out or "[Chunks]" in captured.err

    def test_custom_logger_used(self, mock_kb_pipeline_modules):
        from kb_pipeline.post_insert import run_post_insert

        logs: list[str] = []
        run_post_insert(
            item_id="x",
            title="t",
            content="c",
            content_type="article",
            ingestion_source="test",
            logger=logs.append,
        )
        assert any("[Chunks]" in log for log in logs)
        assert any("[Layer]" in log for log in logs)

    def test_log_prefix_applied(self, mock_kb_pipeline_modules):
        from kb_pipeline.post_insert import run_post_insert

        logs: list[str] = []
        run_post_insert(
            item_id="x",
            title="t",
            content="c",
            content_type="article",
            ingestion_source="test",
            log_prefix=">>> ",
            logger=logs.append,
        )
        assert any(log.startswith(">>>") for log in logs)


# ──────────────────────────────────────────────────────────────────────
# history_change_summary override
# ──────────────────────────────────────────────────────────────────────


class TestHistoryChangeSummary:
    """OPS-20: Step 1 is a deliberate no-op — the DB trigger writes v1.
    history_change_summary is still accepted as a parameter (API compat)
    but is not passed anywhere because insert_content_history_entry is
    no longer called. These tests verify the no-op behaviour."""

    def test_history_change_summary_accepted_but_not_used(
        self, mock_kb_pipeline_modules
    ):
        from kb_pipeline.post_insert import run_post_insert

        result = run_post_insert(
            item_id="x",
            title="t",
            content="c",
            content_type="article",
            ingestion_source="markdown_import",
            history_change_summary="Custom reason here",
        )
        # insert_content_history_entry is never called (OPS-20)
        mock_kb_pipeline_modules.store.insert_content_history_entry.assert_not_called()
        # history_ok is True because the DB trigger guarantees v1
        assert result.history_ok is True
