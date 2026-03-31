"""Tests for kb_pipeline/temporal_bridge.py — temporal-to-entity bridge."""

import os
import sys
from unittest.mock import patch, MagicMock

import pytest

# Add scripts dir to path so we can import kb_pipeline
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from kb_pipeline.temporal_bridge import (
    bridge_temporal_to_entities,
    _token_match,
    _tokenise,
    TEMPORAL_ENTITY_TYPES,
)


# ── Helpers ──────────────────────────────────────────────────────────────────


def _make_content_item_response(ai_temporal_references=None, extra_metadata=None):
    """Build a mock content_items GET response."""
    metadata = extra_metadata or {}
    if ai_temporal_references is not None:
        metadata["ai_temporal_references"] = ai_temporal_references
    return (200, [{"metadata": metadata}])


def _make_mentions_response(mentions):
    """Build a mock entity_mentions GET response."""
    return (200, mentions)


def _make_mention(
    mention_id="m-001",
    canonical_name="iso 27001",
    entity_type="certification",
    metadata=None,
):
    return {
        "id": mention_id,
        "canonical_name": canonical_name,
        "entity_type": entity_type,
        "metadata": metadata or {},
    }


ITEM_ID = "550e8400-e29b-41d4-a716-446655440000"


# ── Token matching unit tests ────────────────────────────────────────────────


class TestTokenise:
    def test_simple_words(self):
        assert _tokenise("ISO 27001") == ["iso", "27001"]

    def test_punctuation_split(self):
        assert _tokenise("ISO/IEC-27001:2022") == ["iso", "iec", "27001", "2022"]

    def test_empty_string(self):
        assert _tokenise("") == []

    def test_none_returns_empty(self):
        assert _tokenise(None) == []


class TestTokenMatch:
    def test_full_coverage_match(self):
        """All name tokens present in context -> match."""
        assert _token_match("ISO 27001 cert renewal due", "ISO 27001") is True

    def test_partial_coverage_above_70(self):
        """3 of 4 tokens (75%) -> match."""
        # "data", "protection", "act" match out of "data", "protection", "act", "2018" = 75%
        assert _token_match(
            "The data protection act compliance review",
            "Data Protection Act 2018",
        ) is True

    def test_partial_coverage_50_short_name(self):
        """50% coverage with 2-token name -> match."""
        assert _token_match(
            "27001 certification expires next month",
            "ISO 27001",
        ) is True

    def test_single_token_entity_match(self):
        """Single-token entity name in context -> match (coverage = 1.0)."""
        assert _token_match("The GDPR compliance assessment", "GDPR") is True

    def test_no_match_different_tokens(self):
        """No overlapping tokens -> no match."""
        assert _token_match("General data protection regulation", "GDPR") is False

    def test_case_insensitive(self):
        assert _token_match("iso 27001 renewal", "ISO 27001") is True

    def test_empty_context(self):
        assert _token_match("", "ISO 27001") is False

    def test_empty_name(self):
        assert _token_match("some context", "") is False


# ── Bridge function tests ────────────────────────────────────────────────────


@patch("kb_pipeline.temporal_bridge._request")
class TestBridgeTemporalToEntities:

    def test_happy_path_expiry_date(self, mock_request):
        """Expiry temporal ref matched to entity -> writes expiry_date."""
        temporal_refs = [
            {"date": "2026-06-15", "context": "ISO 27001 cert renewal due", "context_type": "expiry"},
        ]
        mentions = [_make_mention(canonical_name="iso 27001", entity_type="certification")]

        mock_request.side_effect = [
            _make_content_item_response(temporal_refs),
            _make_mentions_response(mentions),
            (204, None),  # PATCH update
        ]

        result = bridge_temporal_to_entities(ITEM_ID)

        assert result == 1
        # Verify the PATCH call
        patch_call = mock_request.call_args_list[2]
        assert patch_call[0][0] == "PATCH"
        assert patch_call[0][2] == {"metadata": {"expiry_date": "2026-06-15"}}

    def test_happy_path_effective_date(self, mock_request):
        """Effective temporal ref -> writes date_obtained."""
        temporal_refs = [
            {"date": "2025-01-10", "context": "ISO 9001 certification obtained", "context_type": "effective"},
        ]
        mentions = [_make_mention(mention_id="m-002", canonical_name="iso 9001", entity_type="certification")]

        mock_request.side_effect = [
            _make_content_item_response(temporal_refs),
            _make_mentions_response(mentions),
            (204, None),
        ]

        result = bridge_temporal_to_entities(ITEM_ID)

        assert result == 1
        patch_call = mock_request.call_args_list[2]
        assert patch_call[0][2] == {"metadata": {"date_obtained": "2025-01-10"}}

    def test_no_temporal_refs_returns_zero(self, mock_request):
        """No ai_temporal_references in metadata -> 0 updates, no entity fetch."""
        mock_request.side_effect = [
            _make_content_item_response(ai_temporal_references=None),
        ]

        result = bridge_temporal_to_entities(ITEM_ID)

        assert result == 0
        assert mock_request.call_count == 1  # Only content item fetch

    def test_empty_temporal_refs_list(self, mock_request):
        """Empty temporal refs list -> 0 updates."""
        mock_request.side_effect = [
            _make_content_item_response(ai_temporal_references=[]),
        ]

        result = bridge_temporal_to_entities(ITEM_ID)

        assert result == 0
        assert mock_request.call_count == 1

    def test_no_entity_mentions_returns_zero(self, mock_request):
        """No entity mentions found -> 0 updates."""
        temporal_refs = [
            {"date": "2026-06-15", "context": "ISO 27001 expires", "context_type": "expiry"},
        ]

        mock_request.side_effect = [
            _make_content_item_response(temporal_refs),
            _make_mentions_response([]),  # No mentions
        ]

        result = bridge_temporal_to_entities(ITEM_ID)

        assert result == 0

    def test_no_matching_context(self, mock_request):
        """Temporal ref context doesn't match entity name -> 0 updates."""
        temporal_refs = [
            {"date": "2026-06-15", "context": "Annual review deadline", "context_type": "expiry"},
        ]
        mentions = [_make_mention(canonical_name="iso 27001")]

        mock_request.side_effect = [
            _make_content_item_response(temporal_refs),
            _make_mentions_response(mentions),
        ]

        result = bridge_temporal_to_entities(ITEM_ID)

        assert result == 0

    def test_multiple_refs_multiple_entities(self, mock_request):
        """Multiple temporal refs matching different entities."""
        temporal_refs = [
            {"date": "2026-06-15", "context": "ISO 27001 cert expires", "context_type": "expiry"},
            {"date": "2025-03-01", "context": "GDPR compliance review effective", "context_type": "effective"},
        ]
        mentions = [
            _make_mention(mention_id="m-001", canonical_name="iso 27001", entity_type="certification"),
            _make_mention(mention_id="m-002", canonical_name="gdpr", entity_type="regulation"),
        ]

        mock_request.side_effect = [
            _make_content_item_response(temporal_refs),
            _make_mentions_response(mentions),
            (204, None),  # PATCH for ISO 27001
            (204, None),  # PATCH for GDPR
        ]

        result = bridge_temporal_to_entities(ITEM_ID)

        assert result == 2

    def test_case_insensitive_matching(self, mock_request):
        """Token matching is case-insensitive."""
        temporal_refs = [
            {"date": "2026-12-31", "context": "iso 27001 renewal", "context_type": "expiry"},
        ]
        mentions = [_make_mention(canonical_name="ISO 27001")]

        mock_request.side_effect = [
            _make_content_item_response(temporal_refs),
            _make_mentions_response(mentions),
            (204, None),
        ]

        result = bridge_temporal_to_entities(ITEM_ID)

        assert result == 1

    def test_token_level_partial_name_match(self, mock_request):
        """'ISO 27001 cert renewal' matches entity 'ISO 27001' via token overlap."""
        temporal_refs = [
            {"date": "2026-06-15", "context": "ISO 27001 cert renewal deadline approaching", "context_type": "expiry"},
        ]
        mentions = [_make_mention(canonical_name="iso 27001")]

        mock_request.side_effect = [
            _make_content_item_response(temporal_refs),
            _make_mentions_response(mentions),
            (204, None),
        ]

        result = bridge_temporal_to_entities(ITEM_ID)

        assert result == 1

    def test_token_level_50_coverage_two_token_name(self, mock_request):
        """'27001 certification expires' matches 'ISO 27001' (50% coverage, 2-token name)."""
        temporal_refs = [
            {"date": "2026-06-15", "context": "27001 certification expires", "context_type": "expiry"},
        ]
        mentions = [_make_mention(canonical_name="iso 27001")]

        mock_request.side_effect = [
            _make_content_item_response(temporal_refs),
            _make_mentions_response(mentions),
            (204, None),
        ]

        result = bridge_temporal_to_entities(ITEM_ID)

        assert result == 1

    def test_single_token_entity_gdpr(self, mock_request):
        """Single-token entity 'GDPR' matches in context."""
        temporal_refs = [
            {"date": "2025-05-25", "context": "The GDPR compliance assessment due date", "context_type": "expiry"},
        ]
        mentions = [_make_mention(mention_id="m-003", canonical_name="gdpr", entity_type="regulation")]

        mock_request.side_effect = [
            _make_content_item_response(temporal_refs),
            _make_mentions_response(mentions),
            (204, None),
        ]

        result = bridge_temporal_to_entities(ITEM_ID)

        assert result == 1

    def test_non_matching_abbreviation_expansion(self, mock_request):
        """'General data protection' does NOT match single-token 'GDPR'."""
        temporal_refs = [
            {"date": "2025-05-25", "context": "General data protection regulation review", "context_type": "expiry"},
        ]
        mentions = [_make_mention(mention_id="m-003", canonical_name="gdpr", entity_type="regulation")]

        mock_request.side_effect = [
            _make_content_item_response(temporal_refs),
            _make_mentions_response(mentions),
        ]

        result = bridge_temporal_to_entities(ITEM_ID)

        assert result == 0

    def test_bridge_error_logged_not_raised(self, mock_request):
        """Bridge errors during content item fetch are handled gracefully."""
        mock_request.side_effect = [
            (500, "Internal server error"),
        ]

        # Should not raise
        result = bridge_temporal_to_entities(ITEM_ID)

        assert result == 0

    def test_metadata_merge_preserves_existing(self, mock_request):
        """Existing metadata keys are preserved when adding expiry_date."""
        temporal_refs = [
            {"date": "2026-06-15", "context": "ISO 27001 expires", "context_type": "expiry"},
        ]
        mentions = [_make_mention(
            canonical_name="iso 27001",
            metadata={"source": "manual_entry", "confidence": 0.95},
        )]

        mock_request.side_effect = [
            _make_content_item_response(temporal_refs),
            _make_mentions_response(mentions),
            (204, None),
        ]

        result = bridge_temporal_to_entities(ITEM_ID)

        assert result == 1
        patch_call = mock_request.call_args_list[2]
        patched_metadata = patch_call[0][2]["metadata"]
        assert patched_metadata["source"] == "manual_entry"
        assert patched_metadata["confidence"] == 0.95
        assert patched_metadata["expiry_date"] == "2026-06-15"

    def test_multiple_context_types_same_item(self, mock_request):
        """Both expiry and effective refs for the same entity."""
        temporal_refs = [
            {"date": "2025-01-15", "context": "ISO 27001 certification obtained", "context_type": "effective"},
            {"date": "2028-01-15", "context": "ISO 27001 expiry approaching", "context_type": "expiry"},
        ]
        mentions = [_make_mention(canonical_name="iso 27001")]

        mock_request.side_effect = [
            _make_content_item_response(temporal_refs),
            _make_mentions_response(mentions),
            (204, None),
        ]

        result = bridge_temporal_to_entities(ITEM_ID)

        assert result == 1
        patch_call = mock_request.call_args_list[2]
        patched_metadata = patch_call[0][2]["metadata"]
        assert patched_metadata["date_obtained"] == "2025-01-15"
        assert patched_metadata["expiry_date"] == "2028-01-15"

    def test_empty_context_string_skipped(self, mock_request):
        """Temporal ref with empty context is skipped."""
        temporal_refs = [
            {"date": "2026-06-15", "context": "", "context_type": "expiry"},
        ]
        mentions = [_make_mention(canonical_name="iso 27001")]

        mock_request.side_effect = [
            _make_content_item_response(temporal_refs),
            _make_mentions_response(mentions),
        ]

        result = bridge_temporal_to_entities(ITEM_ID)

        assert result == 0

    def test_content_item_not_found(self, mock_request):
        """Content item fetch returns empty -> 0 updates."""
        mock_request.side_effect = [
            (200, []),
        ]

        result = bridge_temporal_to_entities(ITEM_ID)

        assert result == 0

    def test_entity_mention_update_failure_logged(self, mock_request):
        """PATCH failure is logged but doesn't crash."""
        temporal_refs = [
            {"date": "2026-06-15", "context": "ISO 27001 expires", "context_type": "expiry"},
        ]
        mentions = [_make_mention(canonical_name="iso 27001")]

        mock_request.side_effect = [
            _make_content_item_response(temporal_refs),
            _make_mentions_response(mentions),
            (500, "Server error"),  # PATCH fails
        ]

        result = bridge_temporal_to_entities(ITEM_ID)

        assert result == 0  # Update failed, so not counted

    def test_unknown_context_type_ignored(self, mock_request):
        """Context types other than 'expiry' and 'effective' are ignored."""
        temporal_refs = [
            {"date": "2020-01-01", "context": "ISO 27001 historical reference", "context_type": "historical"},
        ]
        mentions = [_make_mention(canonical_name="iso 27001")]

        mock_request.side_effect = [
            _make_content_item_response(temporal_refs),
            _make_mentions_response(mentions),
        ]

        result = bridge_temporal_to_entities(ITEM_ID)

        assert result == 0

    def test_metadata_is_none_treated_as_empty(self, mock_request):
        """Content item with metadata=None -> 0 updates."""
        mock_request.side_effect = [
            (200, [{"metadata": None}]),
        ]

        result = bridge_temporal_to_entities(ITEM_ID)

        assert result == 0


# ── Constants tests ──────────────────────────────────────────────────────────


class TestTemporalEntityTypes:
    def test_includes_expected_types(self):
        assert "certification" in TEMPORAL_ENTITY_TYPES
        assert "framework" in TEMPORAL_ENTITY_TYPES
        assert "regulation" in TEMPORAL_ENTITY_TYPES

    def test_excludes_non_temporal_types(self):
        assert "organisation" not in TEMPORAL_ENTITY_TYPES
        assert "technology" not in TEMPORAL_ENTITY_TYPES
        assert "person" not in TEMPORAL_ENTITY_TYPES
