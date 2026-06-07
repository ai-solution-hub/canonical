"""Tests for holder metadata derivation in store_entities (§1.18 WP3).

Verifies that store_entities enriches certification entity mentions with
metadata.holder when relationships containing 'holds' are provided, mirroring
the TS deriveHolderMetadata helper in lib/ai/classify.ts.
"""

import os
import sys
from unittest.mock import patch

import pytest

# Add scripts dir to path so we can import kb_pipeline
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from kb_pipeline.classify import (
    derive_holder_metadata,
    store_entities,
    _CLIENT_ORG_LOWER,
)


# ──────────────────────────────────────────
# derive_holder_metadata unit tests
# ──────────────────────────────────────────


class TestDeriveHolderMetadata:
    """Tests for the derive_holder_metadata helper function."""

    def test_self_held_certification(self):
        """Client org as source yields metadata.holder = 'self'."""
        entities = [
            {
                "entity_name": "ISO 27001",
                "entity_type": "certification",
                "canonical_name": "iso 27001",
                "confidence": 0.95,
            },
        ]
        relationships = [
            {
                "source": "Example Client Limited",
                "relationship_type": "holds",
                "target": "ISO 27001",
            },
        ]
        result = derive_holder_metadata(entities, relationships)
        assert "iso 27001" in result
        assert result["iso 27001"] == {"holder": "self"}

    def test_supplier_held_certification(self):
        """Third-party source yields metadata.holder = 'supplier' with supplier_name."""
        entities = [
            {
                "entity_name": "ISO 27001",
                "entity_type": "certification",
                "canonical_name": "iso 27001",
                "confidence": 0.95,
            },
        ]
        relationships = [
            {
                "source": "Example Datacentre",
                "relationship_type": "holds",
                "target": "ISO 27001",
            },
        ]
        result = derive_holder_metadata(entities, relationships)
        assert "iso 27001" in result
        assert result["iso 27001"]["holder"] == "supplier"
        assert result["iso 27001"]["supplier_name"] == "example datacentre"

    def test_no_holds_relationship(self):
        """No holds relationship yields empty metadata map."""
        entities = [
            {
                "entity_name": "ISO 27001",
                "entity_type": "certification",
                "canonical_name": "iso 27001",
                "confidence": 0.95,
            },
        ]
        relationships = [
            {
                "source": "Example Client Limited",
                "relationship_type": "operates_in",
                "target": "Data Centre Services",
            },
        ]
        result = derive_holder_metadata(entities, relationships)
        assert result == {}

    def test_non_certification_entity_ignored(self):
        """Non-certification entities are excluded from holder derivation."""
        entities = [
            {
                "entity_name": "GDPR",
                "entity_type": "regulation",
                "canonical_name": "gdpr",
                "confidence": 0.9,
            },
        ]
        relationships = [
            {
                "source": "Example Client Limited",
                "relationship_type": "holds",
                "target": "GDPR",
            },
        ]
        result = derive_holder_metadata(entities, relationships)
        assert result == {}

    def test_mixed_self_and_supplier(self):
        """Multiple certifications with different holders are handled correctly."""
        entities = [
            {
                "entity_name": "Cyber Essentials Plus",
                "entity_type": "certification",
                "canonical_name": "cyber essentials plus",
                "confidence": 0.95,
            },
            {
                "entity_name": "ISO 27001",
                "entity_type": "certification",
                "canonical_name": "iso 27001",
                "confidence": 0.95,
            },
        ]
        relationships = [
            {
                "source": "Example Client Limited",
                "relationship_type": "holds",
                "target": "Cyber Essentials Plus",
            },
            {
                "source": "Example Datacentre",
                "relationship_type": "holds",
                "target": "ISO 27001",
            },
        ]
        result = derive_holder_metadata(entities, relationships)
        assert result["cyber essentials plus"] == {"holder": "self"}
        assert result["iso 27001"]["holder"] == "supplier"
        assert result["iso 27001"]["supplier_name"] == "example datacentre"

    def test_empty_relationships(self):
        """Empty relationships list yields empty metadata map."""
        entities = [
            {
                "entity_name": "ISO 27001",
                "entity_type": "certification",
                "canonical_name": "iso 27001",
                "confidence": 0.95,
            },
        ]
        result = derive_holder_metadata(entities, [])
        assert result == {}

    def test_empty_entities(self):
        """Empty entities list yields empty metadata map."""
        relationships = [
            {
                "source": "Example Client Limited",
                "relationship_type": "holds",
                "target": "ISO 27001",
            },
        ]
        result = derive_holder_metadata([], relationships)
        assert result == {}

    def test_case_insensitive_client_org_match(self):
        """Client org comparison is case-insensitive."""
        entities = [
            {
                "entity_name": "ISO 27001",
                "entity_type": "certification",
                "canonical_name": "iso 27001",
                "confidence": 0.95,
            },
        ]
        relationships = [
            {
                "source": "EXAMPLE CLIENT LIMITED",
                "relationship_type": "holds",
                "target": "ISO 27001",
            },
        ]
        result = derive_holder_metadata(entities, relationships)
        assert result["iso 27001"] == {"holder": "self"}

    def test_custom_client_org(self):
        """Custom client_org_lower parameter is respected."""
        entities = [
            {
                "entity_name": "ISO 27001",
                "entity_type": "certification",
                "canonical_name": "iso 27001",
                "confidence": 0.95,
            },
        ]
        relationships = [
            {
                "source": "Acme Corp",
                "relationship_type": "holds",
                "target": "ISO 27001",
            },
        ]
        result = derive_holder_metadata(
            entities, relationships, client_org_lower="acme corp",
        )
        assert result["iso 27001"] == {"holder": "self"}


# ──────────────────────────────────────────
# store_entities with relationships (integration)
# ──────────────────────────────────────────


class TestStoreEntitiesWithRelationships:
    """Tests that store_entities passes holder metadata to the Supabase upsert."""

    @patch("kb_pipeline.store._request")
    def test_self_held_metadata_written(self, mock_request):
        """Self-held certification gets metadata = {"holder": "self"}."""
        mock_request.return_value = (201, [{"id": "abc"}])
        entities = [
            {
                "entity_name": "ISO 27001",
                "entity_type": "certification",
                "canonical_name": "ISO 27001",
                "confidence": 0.95,
            },
        ]
        relationships = [
            {
                "source": "Example Client Limited",
                "relationship_type": "holds",
                "target": "ISO 27001",
            },
        ]
        stored, skipped = store_entities(
            "item-123", entities, relationships=relationships,
        )
        assert stored == 1
        assert skipped == 0

        # Verify the metadata was included in the POST payload.
        call_args = mock_request.call_args_list[0]
        posted_data = call_args[0][2]  # Third positional arg is `data`
        assert posted_data["metadata"] == {"holder": "self"}

    @patch("kb_pipeline.store._request")
    def test_supplier_held_metadata_written(self, mock_request):
        """Supplier-held certification gets metadata with supplier_name."""
        mock_request.return_value = (201, [{"id": "abc"}])
        entities = [
            {
                "entity_name": "ISO 27001",
                "entity_type": "certification",
                "canonical_name": "ISO 27001",
                "confidence": 0.95,
            },
        ]
        relationships = [
            {
                "source": "Example Datacentre",
                "relationship_type": "holds",
                "target": "ISO 27001",
            },
        ]
        stored, skipped = store_entities(
            "item-123", entities, relationships=relationships,
        )
        assert stored == 1

        call_args = mock_request.call_args_list[0]
        posted_data = call_args[0][2]
        assert posted_data["metadata"] == {
            "holder": "supplier",
            "supplier_name": "example datacentre",
        }

    @patch("kb_pipeline.store._request")
    def test_no_holds_relationship_no_metadata(self, mock_request):
        """Without a holds relationship, metadata key is absent from payload."""
        mock_request.return_value = (201, [{"id": "abc"}])
        entities = [
            {
                "entity_name": "ISO 27001",
                "entity_type": "certification",
                "canonical_name": "ISO 27001",
                "confidence": 0.95,
            },
        ]
        relationships = [
            {
                "source": "Example Client Limited",
                "relationship_type": "operates_in",
                "target": "Data Centre Services",
            },
        ]
        stored, skipped = store_entities(
            "item-123", entities, relationships=relationships,
        )
        assert stored == 1

        call_args = mock_request.call_args_list[0]
        posted_data = call_args[0][2]
        assert "metadata" not in posted_data

    @patch("kb_pipeline.store._request")
    def test_no_relationships_param_no_metadata(self, mock_request):
        """When relationships is None (default), metadata is not set."""
        mock_request.return_value = (201, [{"id": "abc"}])
        entities = [
            {
                "entity_name": "ISO 27001",
                "entity_type": "certification",
                "canonical_name": "ISO 27001",
                "confidence": 0.95,
            },
        ]
        stored, skipped = store_entities("item-123", entities)
        assert stored == 1

        call_args = mock_request.call_args_list[0]
        posted_data = call_args[0][2]
        assert "metadata" not in posted_data

    @patch("kb_pipeline.store._request")
    def test_non_certification_entity_unaffected(self, mock_request):
        """Non-certification entities do not receive holder metadata."""
        mock_request.return_value = (201, [{"id": "abc"}])
        entities = [
            {
                "entity_name": "GDPR",
                "entity_type": "regulation",
                "canonical_name": "GDPR",
                "confidence": 0.9,
            },
        ]
        relationships = [
            {
                "source": "Example Client Limited",
                "relationship_type": "holds",
                "target": "GDPR",
            },
        ]
        stored, skipped = store_entities(
            "item-123", entities, relationships=relationships,
        )
        assert stored == 1

        call_args = mock_request.call_args_list[0]
        posted_data = call_args[0][2]
        assert "metadata" not in posted_data

    @patch("kb_pipeline.store._request")
    def test_metadata_is_dict_not_json_string(self, mock_request):
        """Metadata must be passed as dict, not json.dumps'd string.

        Per CLAUDE.md gotcha: 'Metadata double-serialisation — Pass metadata
        as dict not json.dumps()'.
        """
        mock_request.return_value = (201, [{"id": "abc"}])
        entities = [
            {
                "entity_name": "ISO 27001",
                "entity_type": "certification",
                "canonical_name": "ISO 27001",
                "confidence": 0.95,
            },
        ]
        relationships = [
            {
                "source": "Example Client Limited",
                "relationship_type": "holds",
                "target": "ISO 27001",
            },
        ]
        store_entities("item-123", entities, relationships=relationships)

        call_args = mock_request.call_args_list[0]
        posted_data = call_args[0][2]
        # Must be a dict, not a string
        assert isinstance(posted_data["metadata"], dict)
