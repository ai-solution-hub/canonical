"""Tests for entity extraction — keyword matching, alias resolution, storage, and merging."""

import json
import os
import sys
from unittest.mock import patch, MagicMock

import pytest

# Add scripts dir to path so we can import kb_pipeline
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from kb_pipeline.classify import (
    extract_entities_by_keyword,
    load_entity_aliases,
    resolve_entity_alias,
    reset_entity_aliases,
    store_entities,
    _merge_entities,
    VALID_ENTITY_TYPES,
    KNOWN_ENTITIES,
    ClassificationResult,
)


# ──────────────────────────────────────────
# Fixtures
# ──────────────────────────────────────────

@pytest.fixture(autouse=True)
def _reset_aliases():
    """Reset entity aliases cache before each test."""
    reset_entity_aliases()
    yield
    reset_entity_aliases()


# ──────────────────────────────────────────
# extract_entities_by_keyword
# ──────────────────────────────────────────

class TestExtractEntitiesByKeyword:
    """Tests for keyword-based entity extraction."""

    def test_empty_text_returns_empty(self):
        """Empty or whitespace text returns no entities."""
        assert extract_entities_by_keyword("") == []
        assert extract_entities_by_keyword("   ") == []
        assert extract_entities_by_keyword(None) == []

    def test_no_entities_found(self):
        """Text with no known entities returns empty list."""
        result = extract_entities_by_keyword("This is a simple sentence about nothing specific.")
        assert result == []

    def test_extracts_iso_27001(self):
        """ISO 27001 is extracted as a certification."""
        result = extract_entities_by_keyword("We hold ISO 27001 certification.")
        assert len(result) >= 1
        iso = next(e for e in result if e["canonical_name"] == "ISO 27001")
        assert iso["entity_type"] == "certification"
        assert iso["confidence"] == 0.9

    def test_extracts_iso_variants(self):
        """ISO variants (ISO/27001, ISO 27001) are normalised."""
        result = extract_entities_by_keyword("We are ISO/27001 certified.")
        iso = next(e for e in result if e["canonical_name"] == "ISO 27001")
        assert iso["entity_type"] == "certification"

    def test_extracts_gdpr(self):
        """GDPR is extracted as a regulation."""
        result = extract_entities_by_keyword("Our data handling complies with GDPR requirements.")
        gdpr = next(e for e in result if e["canonical_name"] == "GDPR")
        assert gdpr["entity_type"] == "regulation"

    def test_extracts_cyber_essentials(self):
        """Cyber Essentials is extracted separately from Cyber Essentials Plus."""
        result = extract_entities_by_keyword("We hold Cyber Essentials certification.")
        ce = next(e for e in result if e["canonical_name"] == "Cyber Essentials")
        assert ce["entity_type"] == "certification"

    def test_extracts_cyber_essentials_plus(self):
        """Cyber Essentials Plus is extracted as its own entity."""
        result = extract_entities_by_keyword("We achieved Cyber Essentials Plus in 2024.")
        ce_plus = next(e for e in result if e["canonical_name"] == "Cyber Essentials Plus")
        assert ce_plus["entity_type"] == "certification"

    def test_extracts_organisation(self):
        """Known organisations are extracted."""
        result = extract_entities_by_keyword("We are registered with the ICO and report to HMRC.")
        names = {e["canonical_name"] for e in result}
        assert "ICO" in names
        assert "HMRC" in names
        ico = next(e for e in result if e["canonical_name"] == "ICO")
        assert ico["entity_type"] == "organisation"

    def test_extracts_technology(self):
        """Technology entities are extracted."""
        result = extract_entities_by_keyword(
            "Our infrastructure runs on Azure with Active Directory authentication."
        )
        names = {e["canonical_name"] for e in result}
        assert "Microsoft Azure" in names
        assert "Active Directory" in names

    def test_extracts_framework(self):
        """Framework entities are extracted."""
        result = extract_entities_by_keyword("We follow ITIL best practices and PRINCE2 methodology.")
        names = {e["canonical_name"] for e in result}
        assert "ITIL" in names
        assert "PRINCE2" in names

    def test_extracts_sector(self):
        """Sector entities are extracted."""
        result = extract_entities_by_keyword(
            "We have extensive experience in the public sector and healthcare."
        )
        names = {e["canonical_name"] for e in result}
        assert "Public Sector" in names
        assert "Healthcare" in names

    def test_extracts_regulation(self):
        """Regulation entities including Data Protection Act are extracted."""
        result = extract_entities_by_keyword(
            "We comply with the Data Protection Act 2018 and PECR."
        )
        names = {e["canonical_name"] for e in result}
        assert "Data Protection Act 2018" in names
        assert "PECR" in names

    def test_no_duplicates_in_results(self):
        """Same entity mentioned multiple times only appears once."""
        result = extract_entities_by_keyword(
            "ISO 27001 is important. We have ISO 27001 certification. ISO 27001 is maintained."
        )
        iso_entries = [e for e in result if e["canonical_name"] == "ISO 27001"]
        assert len(iso_entries) == 1

    def test_multiple_entity_types(self):
        """Multiple entity types are extracted from a single text."""
        text = (
            "The ICO confirmed our ISO 27001 and Cyber Essentials Plus certifications. "
            "Our GDPR compliance is audited annually. We use Azure and Active Directory. "
            "We follow ITIL practices for our public sector clients."
        )
        result = extract_entities_by_keyword(text)
        types = {e["entity_type"] for e in result}
        assert "organisation" in types
        assert "certification" in types
        assert "regulation" in types
        assert "technology" in types
        assert "framework" in types
        assert "sector" in types

    def test_case_insensitive_matching(self):
        """Entity matching is case-insensitive."""
        result = extract_entities_by_keyword("We comply with gdpr requirements.")
        gdpr = next(e for e in result if e["canonical_name"] == "GDPR")
        assert gdpr is not None

    def test_information_commissioners_office_maps_to_ico(self):
        """Full name 'Information Commissioner's Office' maps to ICO canonical."""
        result = extract_entities_by_keyword(
            "Registered with the Information Commissioner's Office."
        )
        ico = next(e for e in result if e["canonical_name"] == "ICO")
        assert ico["entity_type"] == "organisation"

    def test_aws_extracted(self):
        """AWS and Amazon Web Services both map to AWS canonical."""
        result1 = extract_entities_by_keyword("We host on AWS.")
        result2 = extract_entities_by_keyword("We use Amazon Web Services.")
        assert any(e["canonical_name"] == "AWS" for e in result1)
        assert any(e["canonical_name"] == "AWS" for e in result2)

    def test_nist_extracted_as_framework(self):
        """NIST is extracted as a framework."""
        result = extract_entities_by_keyword("We align with NIST cybersecurity framework.")
        nist = next(e for e in result if e["canonical_name"] == "NIST")
        assert nist["entity_type"] == "framework"

    def test_companies_house_extracted(self):
        """Companies House is extracted as an organisation."""
        result = extract_entities_by_keyword("Registered at Companies House.")
        ch = next(e for e in result if e["canonical_name"] == "Companies House")
        assert ch["entity_type"] == "organisation"


# ──────────────────────────────────────────
# resolve_entity_alias
# ──────────────────────────────────────────

class TestResolveEntityAlias:
    """Tests for entity alias resolution."""

    def test_no_alias_returns_original(self):
        """When no aliases are loaded, the original name is returned."""
        result = resolve_entity_alias("Unknown Entity")
        assert result == "Unknown Entity"

    def test_alias_resolved_from_cache(self):
        """Loaded aliases are used for resolution."""
        import kb_pipeline.classify as mod
        mod._entity_aliases = {"iso certification": "ISO 27001", "ce": "Cyber Essentials"}
        assert resolve_entity_alias("ISO Certification") == "ISO 27001"
        assert resolve_entity_alias("CE") == "Cyber Essentials"

    def test_alias_case_insensitive(self):
        """Alias lookup is case-insensitive."""
        import kb_pipeline.classify as mod
        mod._entity_aliases = {"gdpr compliance": "GDPR"}
        assert resolve_entity_alias("GDPR Compliance") == "GDPR"
        assert resolve_entity_alias("gdpr compliance") == "GDPR"

    def test_no_match_returns_original(self):
        """Unmatched name is returned as-is."""
        import kb_pipeline.classify as mod
        mod._entity_aliases = {"something": "Something Else"}
        assert resolve_entity_alias("Totally Different") == "Totally Different"


# ──────────────────────────────────────────
# load_entity_aliases
# ──────────────────────────────────────────

class TestLoadEntityAliases:
    """Tests for loading entity aliases from DB."""

    @patch("kb_pipeline.store._request")
    def test_loads_aliases_from_db(self, mock_request):
        """Aliases are loaded from the entity_aliases table."""
        mock_request.return_value = (200, [
            {"alias": "ISO Cert", "canonical": "ISO 27001"},
            {"alias": "CE Plus", "canonical": "Cyber Essentials Plus"},
        ])
        aliases = load_entity_aliases()
        assert aliases["iso cert"] == "ISO 27001"
        assert aliases["ce plus"] == "Cyber Essentials Plus"

    @patch("kb_pipeline.store._request")
    def test_caches_result(self, mock_request):
        """Second call uses cached result, not DB."""
        mock_request.return_value = (200, [
            {"alias": "Test", "canonical": "Test Canonical"},
        ])
        load_entity_aliases()
        load_entity_aliases()  # Should use cache
        mock_request.assert_called_once()

    @patch("kb_pipeline.store._request")
    def test_handles_db_error_gracefully(self, mock_request):
        """DB error returns empty aliases, doesn't crash."""
        mock_request.return_value = (500, "Internal Server Error")
        aliases = load_entity_aliases()
        assert aliases == {}

    @patch("kb_pipeline.store._request")
    def test_handles_exception_gracefully(self, mock_request):
        """Exception during fetch returns empty aliases."""
        mock_request.side_effect = RuntimeError("Connection failed")
        aliases = load_entity_aliases()
        assert aliases == {}


# ──────────────────────────────────────────
# _merge_entities
# ──────────────────────────────────────────

class TestMergeEntities:
    """Tests for merging AI-extracted and keyword-extracted entities."""

    def test_ai_entities_take_precedence(self):
        """AI entities override keyword entities for the same canonical+type."""
        ai = [{"entity_name": "ISO 27001", "entity_type": "certification",
               "canonical_name": "ISO 27001", "confidence": 0.95}]
        kw = [{"entity_name": "ISO 27001", "entity_type": "certification",
               "canonical_name": "ISO 27001", "confidence": 0.9}]
        merged = _merge_entities(ai, kw)
        assert len(merged) == 1
        assert merged[0]["confidence"] == 0.95  # AI confidence, not keyword

    def test_keyword_entities_fill_gaps(self):
        """Keyword entities are added when AI didn't find them."""
        ai = [{"entity_name": "GDPR", "entity_type": "regulation",
               "canonical_name": "GDPR", "confidence": 0.85}]
        kw = [{"entity_name": "ISO 27001", "entity_type": "certification",
               "canonical_name": "ISO 27001", "confidence": 0.9}]
        merged = _merge_entities(ai, kw)
        assert len(merged) == 2
        names = {e["canonical_name"] for e in merged}
        assert "GDPR" in names
        assert "ISO 27001" in names

    def test_empty_inputs(self):
        """Empty inputs produce empty output."""
        assert _merge_entities([], []) == []

    def test_case_insensitive_dedup(self):
        """Deduplication is case-insensitive on canonical_name."""
        ai = [{"entity_name": "gdpr", "entity_type": "regulation",
               "canonical_name": "gdpr", "confidence": 0.8}]
        kw = [{"entity_name": "GDPR", "entity_type": "regulation",
               "canonical_name": "GDPR", "confidence": 0.9}]
        merged = _merge_entities(ai, kw)
        assert len(merged) == 1

    def test_different_types_not_deduped(self):
        """Same canonical_name with different types are kept separate."""
        ai = [{"entity_name": "NIST", "entity_type": "framework",
               "canonical_name": "NIST", "confidence": 0.8}]
        kw = [{"entity_name": "NIST", "entity_type": "organisation",
               "canonical_name": "NIST", "confidence": 0.9}]
        merged = _merge_entities(ai, kw)
        assert len(merged) == 2


# ──────────────────────────────────────────
# store_entities
# ──────────────────────────────────────────

class TestStoreEntities:
    """Tests for storing entities in the entity_mentions table."""

    @patch("kb_pipeline.store._request")
    def test_stores_valid_entities(self, mock_request):
        """Valid entities are stored via POST request."""
        mock_request.return_value = (201, [{"id": "abc"}])
        entities = [
            {"entity_name": "GDPR", "entity_type": "regulation",
             "canonical_name": "GDPR", "confidence": 0.9},
            {"entity_name": "ISO 27001", "entity_type": "certification",
             "canonical_name": "ISO 27001", "confidence": 0.95},
        ]
        stored, skipped = store_entities("item-123", entities)
        assert stored == 2
        assert skipped == 0
        assert mock_request.call_count == 2

    @patch("kb_pipeline.store._request")
    def test_handles_duplicate_gracefully(self, mock_request):
        """409 (duplicate) is handled as a skip, not an error."""
        mock_request.return_value = (409, "duplicate")
        entities = [
            {"entity_name": "GDPR", "entity_type": "regulation",
             "canonical_name": "GDPR", "confidence": 0.9},
        ]
        stored, skipped = store_entities("item-123", entities)
        assert stored == 0
        assert skipped == 1

    @patch("kb_pipeline.store._request")
    def test_skips_invalid_entity_type(self, mock_request):
        """Entities with invalid type are skipped."""
        entities = [
            {"entity_name": "Something", "entity_type": "invalid_type",
             "canonical_name": "Something", "confidence": 0.9},
        ]
        stored, skipped = store_entities("item-123", entities)
        assert stored == 0
        assert skipped == 1
        mock_request.assert_not_called()

    def test_empty_entities_returns_zeros(self):
        """Empty entity list returns (0, 0) without any requests."""
        stored, skipped = store_entities("item-123", [])
        assert stored == 0
        assert skipped == 0

    @patch("kb_pipeline.store._request")
    def test_handles_server_error(self, mock_request):
        """Server errors (500) are counted as skipped."""
        mock_request.return_value = (500, "Internal Server Error")
        entities = [
            {"entity_name": "GDPR", "entity_type": "regulation",
             "canonical_name": "GDPR", "confidence": 0.9},
        ]
        stored, skipped = store_entities("item-123", entities)
        assert stored == 0
        assert skipped == 1

    @patch("kb_pipeline.store._request")
    def test_applies_alias_resolution(self, mock_request):
        """Entity canonical names are resolved through aliases before storage."""
        import kb_pipeline.classify as mod
        mod._entity_aliases = {"iso cert": "ISO 27001"}
        mock_request.return_value = (201, [{"id": "abc"}])

        entities = [
            {"entity_name": "ISO Cert", "entity_type": "certification",
             "canonical_name": "ISO Cert", "confidence": 0.9},
        ]
        stored, skipped = store_entities("item-123", entities)
        assert stored == 1
        # Verify the canonical_name was resolved via alias
        call_args = mock_request.call_args_list[0]
        posted_data = call_args[0][2]  # Third positional arg is `data`
        assert posted_data["canonical_name"] == "ISO 27001"

    @patch("kb_pipeline.store._request")
    def test_skips_entity_without_canonical_name(self, mock_request):
        """Entities with empty canonical_name are skipped."""
        entities = [
            {"entity_name": "", "entity_type": "regulation",
             "canonical_name": "", "confidence": 0.9},
        ]
        stored, skipped = store_entities("item-123", entities)
        assert stored == 0
        assert skipped == 1
        mock_request.assert_not_called()


# ──────────────────────────────────────────
# ClassificationResult entities field
# ──────────────────────────────────────────

class TestClassificationResultEntities:
    """Tests for the entities field on ClassificationResult."""

    def test_default_empty_entities(self):
        """ClassificationResult defaults to empty entities list."""
        result = ClassificationResult(
            primary_domain="SECURITY",
            primary_subtopic="data-protection",
            confidence=0.9,
            secondary_domain=None,
            secondary_subtopic=None,
            suggested_title="Test",
            ai_summary="Test summary",
            ai_keywords=["test"],
            reasoning="Test reasoning",
            is_fragment=False,
            uncertain=False,
            requires_review=False,
            reason_if_flagged="",
        )
        assert result.entities == []

    def test_entities_populated(self):
        """ClassificationResult can hold entity data."""
        entities = [
            {"entity_name": "GDPR", "entity_type": "regulation",
             "canonical_name": "GDPR", "confidence": 0.9},
        ]
        result = ClassificationResult(
            primary_domain="SECURITY",
            primary_subtopic="data-protection",
            confidence=0.9,
            secondary_domain=None,
            secondary_subtopic=None,
            suggested_title="Test",
            ai_summary="Test summary",
            ai_keywords=["test"],
            reasoning="Test reasoning",
            is_fragment=False,
            uncertain=False,
            requires_review=False,
            reason_if_flagged="",
            entities=entities,
        )
        assert len(result.entities) == 1
        assert result.entities[0]["canonical_name"] == "GDPR"


# ──────────────────────────────────────────
# Entity extraction via classify()
# ──────────────────────────────────────────

class TestClassifyEntityExtraction:
    """Tests for entity extraction integrated into classify()."""

    @pytest.fixture(autouse=True)
    def _reset_client(self):
        """Reset module-level state before each test."""
        import kb_pipeline.classify as mod
        mod._client = None
        mod._valid_domains = None
        mod._valid_subtopics = None
        yield
        mod._client = None
        mod._valid_domains = None
        mod._valid_subtopics = None

    def _make_api_response(self, parsed_json, input_tokens=100, output_tokens=50):
        """Build a mock Anthropic API response."""
        response = MagicMock()
        text_block = MagicMock()
        text_block.text = json.dumps(parsed_json)
        response.content = [text_block]
        usage = MagicMock()
        usage.input_tokens = input_tokens
        usage.output_tokens = output_tokens
        usage.cache_creation_input_tokens = 0
        usage.cache_read_input_tokens = 0
        response.usage = usage
        return response

    @patch("kb_pipeline.classify._get_client")
    @patch("kb_pipeline.classify.get_system_prompt", return_value="system prompt")
    def test_keyword_entities_extracted_from_content(self, _mock_prompt, mock_get_client):
        """Keyword entities are extracted from content even without AI entities."""
        from kb_pipeline.classify import classify

        parsed = {
            "primary_domain": "SECURITY",
            "primary_subtopic": "data-protection",
            "confidence": 0.92,
            "suggested_title": "GDPR Compliance",
            "ai_summary": "About GDPR.",
            "ai_keywords": ["GDPR"],
            "reasoning": "Security content.",
            "flags": {"is_fragment": False, "uncertain": False,
                      "requires_review": False, "reason_if_flagged": ""},
        }
        mock_client = MagicMock()
        mock_client.messages.create.return_value = self._make_api_response(parsed)
        mock_get_client.return_value = mock_client

        result = classify("Data Protection", "Our GDPR compliance includes ISO 27001 controls.")
        assert len(result.entities) >= 2
        canonical_names = {e["canonical_name"] for e in result.entities}
        assert "GDPR" in canonical_names
        assert "ISO 27001" in canonical_names

    @patch("kb_pipeline.classify._get_client")
    @patch("kb_pipeline.classify.get_system_prompt", return_value="system prompt")
    def test_ai_entities_merged_with_keyword(self, _mock_prompt, mock_get_client):
        """AI-returned entities are merged with keyword-extracted entities."""
        from kb_pipeline.classify import classify

        parsed = {
            "primary_domain": "SECURITY",
            "primary_subtopic": "data-protection",
            "confidence": 0.92,
            "suggested_title": "Security Policy",
            "ai_summary": "Security policy.",
            "ai_keywords": ["security"],
            "reasoning": "Security content.",
            "flags": {"is_fragment": False, "uncertain": False,
                      "requires_review": False, "reason_if_flagged": ""},
            "entities": [
                {"name": "Custom Org", "type": "organisation", "canonical_name": "Custom Organisation"},
            ],
        }
        mock_client = MagicMock()
        mock_client.messages.create.return_value = self._make_api_response(parsed)
        mock_get_client.return_value = mock_client

        result = classify("Security", "Our ISO 27001 certified security policy.")
        canonical_names = {e["canonical_name"] for e in result.entities}
        # AI entity
        assert "Custom Organisation" in canonical_names
        # Keyword entity
        assert "ISO 27001" in canonical_names


# ──────────────────────────────────────────
# VALID_ENTITY_TYPES constant
# ──────────────────────────────────────────

class TestValidEntityTypes:
    """Tests for the VALID_ENTITY_TYPES constant."""

    def test_all_expected_types_present(self):
        """All entity types from the schema are included."""
        expected = {
            "organisation", "certification", "regulation", "framework",
            "capability", "person", "technology", "project", "sector",
        }
        assert VALID_ENTITY_TYPES == expected

    def test_known_entities_use_valid_types(self):
        """All KNOWN_ENTITIES have valid entity types."""
        for _, _, etype, _ in KNOWN_ENTITIES:
            assert etype in VALID_ENTITY_TYPES, f"Invalid entity type in KNOWN_ENTITIES: {etype}"


# ──────────────────────────────────────────
# Backfill script entity scanning
# ──────────────────────────────────────────

class TestBackfillEntityScanning:
    """Tests for the entity scanning logic used by the backfill script."""

    def test_typical_bid_qa_content(self):
        """Typical bid Q&A content produces expected entities."""
        text = (
            "Q: Are you ISO 27001 certified?\n"
            "A: Yes, we have held ISO 27001 certification since 2019. "
            "We are also Cyber Essentials Plus certified and registered with the ICO."
        )
        result = extract_entities_by_keyword(text)
        names = {e["canonical_name"] for e in result}
        assert "ISO 27001" in names
        assert "Cyber Essentials Plus" in names
        assert "ICO" in names

    def test_security_policy_content(self):
        """Security policy content produces expected entities."""
        text = (
            "Our data protection policy ensures compliance with GDPR and the "
            "Data Protection Act 2018. We use Active Directory for access control "
            "and our systems are hosted on Azure."
        )
        result = extract_entities_by_keyword(text)
        names = {e["canonical_name"] for e in result}
        assert "GDPR" in names
        assert "Data Protection Act 2018" in names
        assert "Active Directory" in names
        assert "Microsoft Azure" in names

    def test_minimal_content_still_works(self):
        """Short content with an entity still extracts it."""
        result = extract_entities_by_keyword("Yes, ISO 27001 certified.")
        assert any(e["canonical_name"] == "ISO 27001" for e in result)

    def test_content_with_no_known_entities(self):
        """Generic content without known entities returns empty."""
        result = extract_entities_by_keyword(
            "We provide excellent customer service and have a dedicated support team."
        )
        assert result == []
