"""Tests for classify.py — untested functions only.

Functions already covered by test_normalise_keyword.py and test_validate_classification.py:
  normalise_keyword, _to_singular, build_taxonomy_section, _validate_classification

This file covers: build_user_prompt, classify, estimate_cost, set_valid_taxonomy.
"""

import json
import sys
import os
from unittest.mock import patch, MagicMock

import pytest

# Add scripts dir to path so we can import kb_pipeline
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from kb_pipeline.classify import (
    build_user_prompt,
    classify,
    estimate_cost,
    set_valid_taxonomy,
    ClassificationResult,
)
from kb_pipeline.config import (
    OPUS_INPUT_PRICE,
    OPUS_OUTPUT_PRICE,
    OPUS_CACHE_WRITE_PRICE,
    OPUS_CACHE_READ_PRICE,
)


# ──────────────────────────────────────────
# build_user_prompt
# ──────────────────────────────────────────

class TestBuildUserPrompt:
    """Tests for building the classification user prompt."""

    def test_all_fields_populated(self):
        """Prompt includes all provided fields in correct format."""
        result = build_user_prompt(
            title="Test Title",
            content="Some content here",
            content_type="article",
            platform="web",
            author_name="Jane Smith",
        )
        assert "Title: Test Title" in result
        assert "Content: Some content here" in result
        assert "Content Type: article" in result
        assert "Platform: web" in result
        assert "Author: Jane Smith" in result

    def test_missing_title_uses_placeholder(self):
        """Empty or None title defaults to '(no title)'."""
        result = build_user_prompt(title="", content="body", author_name="A")
        assert "Title: (no title)" in result

        result_none = build_user_prompt(title=None, content="body", author_name="A")
        assert "Title: (no title)" in result_none

    def test_missing_content_uses_placeholder(self):
        """Empty or None content defaults to '(no content)'."""
        result = build_user_prompt(title="T", content="", author_name="A")
        assert "Content: (no content)" in result

        result_none = build_user_prompt(title="T", content=None, author_name="A")
        assert "Content: (no content)" in result_none

    def test_missing_author_uses_placeholder(self):
        """Empty or None author defaults to '(unknown)'."""
        result = build_user_prompt(title="T", content="C", author_name="")
        assert "Author: (unknown)" in result

        result_none = build_user_prompt(title="T", content="C", author_name=None)
        assert "Author: (unknown)" in result_none

    def test_content_over_5000_chars_truncated(self):
        """Content longer than 5000 characters is truncated with ellipsis."""
        long_content = "x" * 6000
        result = build_user_prompt(title="T", content=long_content)
        # Should contain exactly 5000 x's followed by "..."
        assert ("x" * 5000 + "...") in result
        assert ("x" * 5001) not in result

    def test_content_exactly_5000_chars_not_truncated(self):
        """Content at exactly 5000 characters is not truncated."""
        exact_content = "y" * 5000
        result = build_user_prompt(title="T", content=exact_content)
        assert ("y" * 5000) in result
        assert "..." not in result

    def test_content_between_2000_and_5000_not_truncated(self):
        """Content between 2000 and 5000 characters is not truncated."""
        mid_content = "z" * 3000
        result = build_user_prompt(title="T", content=mid_content)
        assert ("z" * 3000) in result
        assert "..." not in result


# ──────────────────────────────────────────
# classify
# ──────────────────────────────────────────

def _make_api_response(parsed_json, input_tokens=100, output_tokens=50,
                       cache_creation=10, cache_read=5):
    """Build a mock Anthropic API response."""
    response = MagicMock()
    text_block = MagicMock()
    text_block.text = json.dumps(parsed_json)
    response.content = [text_block]

    usage = MagicMock()
    usage.input_tokens = input_tokens
    usage.output_tokens = output_tokens
    usage.cache_creation_input_tokens = cache_creation
    usage.cache_read_input_tokens = cache_read
    response.usage = usage

    return response


def _valid_classification_json(**overrides):
    """Return a valid classification JSON dict with optional overrides."""
    base = {
        "primary_domain": "Technology & Digital",
        "primary_subtopic": "Cloud Infrastructure",
        "confidence": 0.92,
        "secondary_domain": "Operations & Delivery",
        "secondary_subtopic": "Service Management",
        "suggested_title": "Cloud Migration Guide",
        "summary": "A guide to cloud migration.",
        "ai_keywords": ["Cloud", "Migration"],
        "reasoning": "Content discusses cloud infra.",
        "flags": {
            "is_fragment": False,
            "uncertain": False,
            "requires_review": False,
            "reason_if_flagged": "",
        },
    }
    base.update(overrides)
    return base


class TestClassify:
    """Tests for the classify function (Anthropic API mocked)."""

    @pytest.fixture(autouse=True)
    def _reset_client(self):
        """Reset the module-level client and taxonomy before each test."""
        import kb_pipeline.classify as mod
        mod._client = None
        mod._valid_domains = None
        mod._valid_subtopics = None
        yield
        mod._client = None
        mod._valid_domains = None
        mod._valid_subtopics = None

    @patch("kb_pipeline.classify._get_client")
    @patch("kb_pipeline.classify.get_system_prompt", return_value="system prompt")
    def test_successful_classification(self, _mock_prompt, mock_get_client):
        """Successful API call returns a populated ClassificationResult."""
        parsed = _valid_classification_json()
        mock_client = MagicMock()
        mock_client.messages.create.return_value = _make_api_response(parsed)
        mock_get_client.return_value = mock_client

        result = classify("Test", "Content about cloud")

        assert isinstance(result, ClassificationResult)
        assert result.primary_domain == "Technology & Digital"
        assert result.primary_subtopic == "Cloud Infrastructure"
        assert result.confidence == 0.92
        assert result.secondary_domain == "Operations & Delivery"
        assert result.suggested_title == "Cloud Migration Guide"

    @patch("kb_pipeline.classify._get_client")
    @patch("kb_pipeline.classify.get_system_prompt", return_value="system prompt")
    def test_all_uppercase_domain_normalised_to_lower(self, _mock_prompt, mock_get_client):
        """S187 regression: all-uppercase primary/secondary domains lowercase; mixed-case preserved."""
        parsed = _valid_classification_json(
            primary_domain="CORPORATE",
            secondary_domain="PRODUCT-FEATURE",
        )
        mock_client = MagicMock()
        mock_client.messages.create.return_value = _make_api_response(parsed)
        mock_get_client.return_value = mock_client
        result = classify("T", "Content")
        assert result.primary_domain == "corporate"
        assert result.secondary_domain == "product-feature"

    @patch("kb_pipeline.classify._get_client")
    @patch("kb_pipeline.classify.get_system_prompt", return_value="system prompt")
    def test_response_wrapped_in_triple_backticks(self, _mock_prompt, mock_get_client):
        """JSON wrapped in ``` backticks is parsed correctly."""
        parsed = _valid_classification_json()
        response = _make_api_response(parsed)
        response.content[0].text = "```" + json.dumps(parsed) + "```"
        mock_client = MagicMock()
        mock_client.messages.create.return_value = response
        mock_get_client.return_value = mock_client

        result = classify("Test", "Content")
        assert result.primary_domain == "Technology & Digital"

    @patch("kb_pipeline.classify._get_client")
    @patch("kb_pipeline.classify.get_system_prompt", return_value="system prompt")
    def test_response_with_json_language_tag(self, _mock_prompt, mock_get_client):
        """JSON wrapped in ```json ... ``` is parsed correctly."""
        parsed = _valid_classification_json()
        response = _make_api_response(parsed)
        response.content[0].text = "```json\n" + json.dumps(parsed) + "\n```"
        mock_client = MagicMock()
        mock_client.messages.create.return_value = response
        mock_get_client.return_value = mock_client

        result = classify("Test", "Content")
        assert result.primary_domain == "Technology & Digital"

    @patch("kb_pipeline.classify._get_client")
    @patch("kb_pipeline.classify.get_system_prompt", return_value="system prompt")
    def test_token_counts_extracted(self, _mock_prompt, mock_get_client):
        """Input and output token counts are extracted from usage."""
        parsed = _valid_classification_json()
        mock_client = MagicMock()
        mock_client.messages.create.return_value = _make_api_response(
            parsed, input_tokens=500, output_tokens=200
        )
        mock_get_client.return_value = mock_client

        result = classify("Test", "Content")
        assert result.input_tokens == 500
        assert result.output_tokens == 200

    @patch("kb_pipeline.classify._get_client")
    @patch("kb_pipeline.classify.get_system_prompt", return_value="system prompt")
    def test_cache_tokens_extracted(self, _mock_prompt, mock_get_client):
        """Cache creation and read tokens are extracted from usage."""
        parsed = _valid_classification_json()
        mock_client = MagicMock()
        mock_client.messages.create.return_value = _make_api_response(
            parsed, cache_creation=30, cache_read=20
        )
        mock_get_client.return_value = mock_client

        result = classify("Test", "Content")
        assert result.cache_creation_tokens == 30
        assert result.cache_read_tokens == 20

    @patch("kb_pipeline.classify._get_client")
    @patch("kb_pipeline.classify.get_system_prompt", return_value="system prompt")
    def test_keywords_normalised(self, _mock_prompt, mock_get_client):
        """AI keywords are normalised via normalise_keyword."""
        parsed = _valid_classification_json(ai_keywords=["ISO 27001", "Data Centres", "  GDPR  "])
        mock_client = MagicMock()
        mock_client.messages.create.return_value = _make_api_response(parsed)
        mock_get_client.return_value = mock_client

        result = classify("Test", "Content")
        assert result.ai_keywords == ["ISO 27001", "data centre", "GDPR"]

    @patch("kb_pipeline.classify._get_client")
    @patch("kb_pipeline.classify.get_system_prompt", return_value="system prompt")
    def test_flags_extracted(self, _mock_prompt, mock_get_client):
        """Flags (is_fragment, uncertain, requires_review, reason_if_flagged) are extracted."""
        parsed = _valid_classification_json(flags={
            "is_fragment": True,
            "uncertain": True,
            "requires_review": True,
            "reason_if_flagged": "Content too short",
        })
        mock_client = MagicMock()
        mock_client.messages.create.return_value = _make_api_response(parsed)
        mock_get_client.return_value = mock_client

        result = classify("Test", "Short")
        assert result.is_fragment is True
        assert result.uncertain is True
        assert result.requires_review is True
        assert result.reason_if_flagged == "Content too short"

    @patch("kb_pipeline.classify._get_client")
    @patch("kb_pipeline.classify.get_system_prompt", return_value="system prompt")
    def test_invalid_json_raises(self, _mock_prompt, mock_get_client):
        """Invalid JSON in response raises json.JSONDecodeError."""
        response = MagicMock()
        text_block = MagicMock()
        text_block.text = "not valid json {{"
        response.content = [text_block]
        response.usage = MagicMock(input_tokens=10, output_tokens=5)
        response.usage.cache_creation_input_tokens = 0
        response.usage.cache_read_input_tokens = 0

        mock_client = MagicMock()
        mock_client.messages.create.return_value = response
        mock_get_client.return_value = mock_client

        with pytest.raises(json.JSONDecodeError):
            classify("Test", "Content")

    @patch("kb_pipeline.classify._get_client")
    @patch("kb_pipeline.classify.get_system_prompt", return_value="system prompt")
    def test_api_error_propagates(self, _mock_prompt, mock_get_client):
        """API errors are propagated to the caller."""
        mock_client = MagicMock()
        mock_client.messages.create.side_effect = RuntimeError("API unavailable")
        mock_get_client.return_value = mock_client

        with pytest.raises(RuntimeError, match="API unavailable"):
            classify("Test", "Content")

    @patch("kb_pipeline.classify._validate_classification")
    @patch("kb_pipeline.classify._get_client")
    @patch("kb_pipeline.classify.get_system_prompt", return_value="system prompt")
    def test_validation_called_when_taxonomy_set(self, _mock_prompt, mock_get_client, mock_validate):
        """Post-classification validation is called when _valid_domains is set."""
        import kb_pipeline.classify as mod
        mod._valid_domains = ["Technology & Digital"]
        mod._valid_subtopics = ["Cloud Infrastructure"]

        parsed = _valid_classification_json()
        mock_client = MagicMock()
        mock_client.messages.create.return_value = _make_api_response(parsed)
        mock_get_client.return_value = mock_client

        result = classify("Test", "Content")

        mock_validate.assert_called_once_with(
            result,
            ["Technology & Digital"],
            ["Cloud Infrastructure"],
        )

    @patch("kb_pipeline.classify._validate_classification")
    @patch("kb_pipeline.classify._get_client")
    @patch("kb_pipeline.classify.get_system_prompt", return_value="system prompt")
    def test_validation_skipped_when_taxonomy_none(self, _mock_prompt, mock_get_client, mock_validate):
        """Post-classification validation is skipped when _valid_domains is None."""
        parsed = _valid_classification_json()
        mock_client = MagicMock()
        mock_client.messages.create.return_value = _make_api_response(parsed)
        mock_get_client.return_value = mock_client

        classify("Test", "Content")

        mock_validate.assert_not_called()


# ──────────────────────────────────────────
# estimate_cost
# ──────────────────────────────────────────

class TestEstimateCost:
    """Tests for classification cost estimation."""

    def test_zero_tokens_zero_cost(self):
        """Zero tokens across all categories returns zero cost."""
        assert estimate_cost(0, 0, 0, 0) == 0.0

    def test_known_token_counts(self):
        """Known token counts produce expected USD values."""
        # 1000 input (uncached), 500 output, 0 cache
        cost = estimate_cost(1000, 500, 0, 0)
        expected = (1000 * OPUS_INPUT_PRICE) + (500 * OPUS_OUTPUT_PRICE)
        assert abs(cost - expected) < 1e-10

    def test_cache_tokens_factored_correctly(self):
        """Cache creation and read tokens are correctly factored into cost.

        The formula is: uncached_input = input - cache_creation - cache_read
        Total = uncached * input_price + output * output_price
                + cache_creation * write_price + cache_read * read_price
        """
        cost = estimate_cost(
            input_tokens=1000,
            output_tokens=200,
            cache_creation=300,
            cache_read=200,
        )
        uncached = 1000 - 300 - 200  # 500
        expected = (
            uncached * OPUS_INPUT_PRICE
            + 200 * OPUS_OUTPUT_PRICE
            + 300 * OPUS_CACHE_WRITE_PRICE
            + 200 * OPUS_CACHE_READ_PRICE
        )
        assert abs(cost - expected) < 1e-10


# ──────────────────────────────────────────
# set_valid_taxonomy
# ──────────────────────────────────────────

class TestSetValidTaxonomy:
    """Tests for setting module-level taxonomy globals."""

    @pytest.fixture(autouse=True)
    def _reset_taxonomy(self):
        """Reset taxonomy globals before and after each test."""
        import kb_pipeline.classify as mod
        mod._valid_domains = None
        mod._valid_subtopics = None
        yield
        mod._valid_domains = None
        mod._valid_subtopics = None

    def test_sets_globals_correctly(self):
        """set_valid_taxonomy sets module-level _valid_domains and _valid_subtopics."""
        import kb_pipeline.classify as mod
        domains = ["Technology & Digital", "People & Culture"]
        subtopics = ["Cloud Infrastructure", "Recruitment"]

        set_valid_taxonomy(domains, subtopics)

        assert mod._valid_domains == domains
        assert mod._valid_subtopics == subtopics

    def test_can_be_reset_to_none(self):
        """Taxonomy globals can be reset to None."""
        import kb_pipeline.classify as mod
        set_valid_taxonomy(["A"], ["B"])
        assert mod._valid_domains is not None

        set_valid_taxonomy(None, None)
        assert mod._valid_domains is None
        assert mod._valid_subtopics is None


# ──────────────────────────────────────────
# Fix 5: Confidence defaults
# ──────────────────────────────────────────

class TestConfidenceDefaults:
    """Tests for AI and keyword entity confidence defaults."""

    @pytest.fixture(autouse=True)
    def _reset_client(self):
        """Reset the module-level client and taxonomy before each test."""
        import kb_pipeline.classify as mod
        mod._client = None
        mod._valid_domains = None
        mod._valid_subtopics = None
        yield
        mod._client = None
        mod._valid_domains = None
        mod._valid_subtopics = None

    @patch("kb_pipeline.classify._get_client")
    @patch("kb_pipeline.classify.get_system_prompt", return_value="system prompt")
    def test_ai_entities_default_confidence_is_1_0(self, _mock_prompt, mock_get_client):
        """AI-extracted entities without explicit confidence get default 1.0."""
        parsed = _valid_classification_json(entities=[
            {"name": "GDPR", "type": "regulation", "canonical_name": "GDPR"},
        ])
        mock_client = MagicMock()
        mock_client.messages.create.return_value = _make_api_response(parsed)
        mock_get_client.return_value = mock_client

        result = classify("Test", "Content about GDPR compliance")

        ai_entity = next(e for e in result.entities if e["entity_name"] == "GDPR" and e["confidence"] == 1.0)
        assert ai_entity["confidence"] == 1.0

    @patch("kb_pipeline.classify._get_client")
    @patch("kb_pipeline.classify.get_system_prompt", return_value="system prompt")
    def test_ai_entities_explicit_confidence_preserved(self, _mock_prompt, mock_get_client):
        """AI-extracted entities with explicit confidence preserve that value."""
        parsed = _valid_classification_json(entities=[
            {"name": "GDPR", "type": "regulation", "canonical_name": "GDPR", "confidence": 0.85},
        ])
        mock_client = MagicMock()
        mock_client.messages.create.return_value = _make_api_response(parsed)
        mock_get_client.return_value = mock_client

        result = classify("Test", "Content about GDPR compliance")

        ai_entity = next(e for e in result.entities if e["entity_name"] == "GDPR" and e["confidence"] == 0.85)
        assert ai_entity["confidence"] == 0.85

    def test_keyword_entities_get_0_9_confidence(self):
        """Keyword-extracted entities get 0.9 confidence."""
        from kb_pipeline.classify import extract_entities_by_keyword
        entities = extract_entities_by_keyword("We comply with GDPR requirements")
        gdpr = next(e for e in entities if e["canonical_name"] == "GDPR")
        assert gdpr["confidence"] == 0.9


# ──────────────────────────────────────────
# Fix 3: Relationship parsing
# ──────────────────────────────────────────

class TestRelationshipParsing:
    """Tests for relationship extraction from Claude response."""

    @pytest.fixture(autouse=True)
    def _reset_client(self):
        import kb_pipeline.classify as mod
        mod._client = None
        mod._valid_domains = None
        mod._valid_subtopics = None
        yield
        mod._client = None
        mod._valid_domains = None
        mod._valid_subtopics = None

    @patch("kb_pipeline.classify._get_client")
    @patch("kb_pipeline.classify.get_system_prompt", return_value="system prompt")
    def test_valid_relationships_parsed(self, _mock_prompt, mock_get_client):
        """Valid relationship types are parsed and canonicalised."""
        parsed = _valid_classification_json(relationships=[
            {"source": "Acme Ltd", "relationship": "holds", "target": "ISO 27001"},
            {"source": "Acme Ltd", "relationship": "complies_with", "target": "gdpr"},
        ])
        mock_client = MagicMock()
        mock_client.messages.create.return_value = _make_api_response(parsed)
        mock_get_client.return_value = mock_client

        result = classify("Test", "Content")

        assert len(result.relationships) == 2
        assert result.relationships[0]["relationship_type"] == "holds"
        assert result.relationships[0]["source"] == "Acme Limited"  # canonicalised Ltd -> Limited
        assert result.relationships[0]["target"] == "ISO 27001"
        assert result.relationships[1]["relationship_type"] == "complies_with"
        assert result.relationships[1]["target"] == "GDPR"  # canonicalised

    @patch("kb_pipeline.classify._get_client")
    @patch("kb_pipeline.classify.get_system_prompt", return_value="system prompt")
    def test_invalid_relationship_types_filtered(self, _mock_prompt, mock_get_client):
        """Invalid relationship types are filtered out."""
        parsed = _valid_classification_json(relationships=[
            {"source": "Acme Ltd", "relationship": "owns", "target": "ISO 27001"},
            {"source": "Acme Ltd", "relationship": "holds", "target": "ISO 27001"},
            {"source": "Acme Ltd", "relationship": "likes", "target": "GDPR"},
        ])
        mock_client = MagicMock()
        mock_client.messages.create.return_value = _make_api_response(parsed)
        mock_get_client.return_value = mock_client

        result = classify("Test", "Content")

        assert len(result.relationships) == 1
        assert result.relationships[0]["relationship_type"] == "holds"

    @patch("kb_pipeline.classify._get_client")
    @patch("kb_pipeline.classify.get_system_prompt", return_value="system prompt")
    def test_relationships_missing_fields_filtered(self, _mock_prompt, mock_get_client):
        """Relationships with missing source or target are filtered out."""
        parsed = _valid_classification_json(relationships=[
            {"source": "", "relationship": "holds", "target": "ISO 27001"},
            {"source": "Acme Ltd", "relationship": "holds", "target": ""},
            {"source": "Acme Ltd", "relationship": "holds", "target": "ISO 27001"},
        ])
        mock_client = MagicMock()
        mock_client.messages.create.return_value = _make_api_response(parsed)
        mock_get_client.return_value = mock_client

        result = classify("Test", "Content")

        assert len(result.relationships) == 1

    @patch("kb_pipeline.classify._get_client")
    @patch("kb_pipeline.classify.get_system_prompt", return_value="system prompt")
    def test_no_relationships_in_response(self, _mock_prompt, mock_get_client):
        """Missing relationships array defaults to empty list."""
        parsed = _valid_classification_json()  # no relationships key
        mock_client = MagicMock()
        mock_client.messages.create.return_value = _make_api_response(parsed)
        mock_get_client.return_value = mock_client

        result = classify("Test", "Content")

        assert result.relationships == []


# ──────────────────────────────────────────
# Fix 4: Temporal reference parsing
# ──────────────────────────────────────────

class TestTemporalReferenceParsing:
    """Tests for temporal reference extraction from Claude response."""

    @pytest.fixture(autouse=True)
    def _reset_client(self):
        import kb_pipeline.classify as mod
        mod._client = None
        mod._valid_domains = None
        mod._valid_subtopics = None
        yield
        mod._client = None
        mod._valid_domains = None
        mod._valid_subtopics = None

    @patch("kb_pipeline.classify._get_client")
    @patch("kb_pipeline.classify.get_system_prompt", return_value="system prompt")
    def test_valid_temporal_references_parsed(self, _mock_prompt, mock_get_client):
        """Valid temporal references are parsed correctly."""
        parsed = _valid_classification_json(temporal_references=[
            {"date": "2025-09-15", "context": "ISO 27001 surveillance audit", "context_type": "historical"},
            {"date": "2026-09-15", "context": "ISO 27001 recertification due", "context_type": "expiry"},
        ])
        mock_client = MagicMock()
        mock_client.messages.create.return_value = _make_api_response(parsed)
        mock_get_client.return_value = mock_client

        result = classify("Test", "Content")

        assert len(result.temporal_references) == 2
        assert result.temporal_references[0]["date"] == "2025-09-15"
        assert result.temporal_references[0]["context_type"] == "historical"
        assert result.temporal_references[1]["context_type"] == "expiry"

    @patch("kb_pipeline.classify._get_client")
    @patch("kb_pipeline.classify.get_system_prompt", return_value="system prompt")
    def test_invalid_context_type_defaults_to_unknown(self, _mock_prompt, mock_get_client):
        """Invalid context_type defaults to 'unknown'."""
        parsed = _valid_classification_json(temporal_references=[
            {"date": "2025-01-01", "context": "Some date", "context_type": "invalid_type"},
        ])
        mock_client = MagicMock()
        mock_client.messages.create.return_value = _make_api_response(parsed)
        mock_get_client.return_value = mock_client

        result = classify("Test", "Content")

        assert len(result.temporal_references) == 1
        assert result.temporal_references[0]["context_type"] == "unknown"

    @patch("kb_pipeline.classify._get_client")
    @patch("kb_pipeline.classify.get_system_prompt", return_value="system prompt")
    def test_missing_context_type_defaults_to_unknown(self, _mock_prompt, mock_get_client):
        """Missing context_type defaults to 'unknown'."""
        parsed = _valid_classification_json(temporal_references=[
            {"date": "2025-01-01", "context": "Some date"},
        ])
        mock_client = MagicMock()
        mock_client.messages.create.return_value = _make_api_response(parsed)
        mock_get_client.return_value = mock_client

        result = classify("Test", "Content")

        assert len(result.temporal_references) == 1
        assert result.temporal_references[0]["context_type"] == "unknown"

    @patch("kb_pipeline.classify._get_client")
    @patch("kb_pipeline.classify.get_system_prompt", return_value="system prompt")
    def test_temporal_refs_missing_date_or_context_filtered(self, _mock_prompt, mock_get_client):
        """Temporal references with missing date or context are filtered out."""
        parsed = _valid_classification_json(temporal_references=[
            {"date": "", "context": "Some date", "context_type": "expiry"},
            {"date": "2025-01-01", "context": "", "context_type": "expiry"},
            {"date": "2025-06-01", "context": "Valid entry", "context_type": "effective"},
        ])
        mock_client = MagicMock()
        mock_client.messages.create.return_value = _make_api_response(parsed)
        mock_get_client.return_value = mock_client

        result = classify("Test", "Content")

        assert len(result.temporal_references) == 1
        assert result.temporal_references[0]["date"] == "2025-06-01"

    @patch("kb_pipeline.classify._get_client")
    @patch("kb_pipeline.classify.get_system_prompt", return_value="system prompt")
    def test_no_temporal_references_in_response(self, _mock_prompt, mock_get_client):
        """Missing temporal_references array defaults to empty list."""
        parsed = _valid_classification_json()
        mock_client = MagicMock()
        mock_client.messages.create.return_value = _make_api_response(parsed)
        mock_get_client.return_value = mock_client

        result = classify("Test", "Content")

        assert result.temporal_references == []


# ──────────────────────────────────────────
# Fix 3: store_relationships
# ──────────────────────────────────────────

class TestStoreRelationships:
    """Tests for the store_relationships function."""

    @pytest.fixture(autouse=True)
    def _reset_aliases(self):
        """Reset entity alias cache before each test."""
        import kb_pipeline.classify as mod
        mod._entity_aliases = {}
        yield
        mod._entity_aliases = None

    @patch("kb_pipeline.store._request")
    def test_stores_valid_relationships(self, mock_request):
        """Valid relationships are stored via POST requests."""
        from kb_pipeline.classify import store_relationships
        mock_request.return_value = (201, [{}])

        stored, skipped = store_relationships("item-123", [
            {"source": "Acme Limited", "relationship_type": "holds", "target": "ISO 27001"},
        ])

        assert stored == 1
        assert skipped == 0
        mock_request.assert_called_once()
        call_args = mock_request.call_args
        assert call_args[0][0] == "POST"
        assert call_args[0][1] == "entity_relationships"
        record = call_args[0][2]
        assert record["relationship_type"] == "holds"
        assert record["source_item_id"] == "item-123"
        assert record["confidence"] == 1.0

    @patch("kb_pipeline.store._request")
    def test_handles_409_duplicates(self, mock_request):
        """409 duplicates are skipped gracefully."""
        from kb_pipeline.classify import store_relationships
        mock_request.return_value = (409, "duplicate")

        stored, skipped = store_relationships("item-123", [
            {"source": "Acme Limited", "relationship_type": "holds", "target": "ISO 27001"},
        ])

        assert stored == 0
        assert skipped == 1

    @patch("kb_pipeline.store._request")
    def test_skips_incomplete_relationships(self, mock_request):
        """Relationships with missing fields are skipped without making API calls."""
        from kb_pipeline.classify import store_relationships

        stored, skipped = store_relationships("item-123", [
            {"source": "", "relationship_type": "holds", "target": "ISO 27001"},
            {"source": "Acme", "relationship_type": "", "target": "ISO 27001"},
        ])

        assert stored == 0
        assert skipped == 2
        mock_request.assert_not_called()

    def test_empty_relationships_returns_zero(self):
        """Empty relationship list returns (0, 0) without errors."""
        from kb_pipeline.classify import store_relationships
        stored, skipped = store_relationships("item-123", [])
        assert stored == 0
        assert skipped == 0

    @patch("kb_pipeline.store._request")
    def test_applies_alias_resolution_and_lowercase(self, mock_request):
        """Source and target have alias resolution and lowercasing applied.

        Canonicalisation is done during parsing in classify(), not in
        store_relationships(). This test verifies only alias resolution
        and lowercasing are applied at storage time.
        """
        from kb_pipeline.classify import store_relationships
        mock_request.return_value = (201, [{}])

        # Values arrive pre-canonicalised from classify() parsing stage
        store_relationships("item-123", [
            {"source": "Acme Limited", "relationship_type": "holds", "target": "ISO 27001"},
        ])

        record = mock_request.call_args[0][2]
        # Already canonicalised by classify() -> alias resolution (no-op) -> lowercase
        assert record["source_entity"] == "acme limited"
        assert record["target_entity"] == "iso 27001"


# ──────────────────────────────────────────
# _is_internal_document — statutory allowlist
# ──────────────────────────────────────────


def test_is_internal_document_statutory_allowlist():
    """Statutory documents in the allowlist are NOT treated as internal documents.

    Parity with lib/ai/classify.ts isInternalDocument() — see pipeline parity
    guard in __tests__/validation/pipeline-parity.test.ts.
    """
    from kb_pipeline.classify import _is_internal_document, _STATUTORY_ALLOWLIST

    allowlist_entries = [
        'wales safeguarding procedure',
        'working together to safeguard children',
        'keeping children safe in education',
        'government security classification policy',
        'modern slavery statement',
    ]

    # Sanity check: constant matches expected contents
    assert _STATUTORY_ALLOWLIST == frozenset(allowlist_entries)

    # All 5 allowlist entries must be exempted
    for entry in allowlist_entries:
        assert _is_internal_document(entry) is False, (
            f"Expected allowlist entry '{entry}' to be exempted from internal-document filter"
        )

    # Case-insensitive: title-case variant of a ...policy entry still exempted
    assert _is_internal_document('Government Security Classification Policy') is False
    # Case-insensitive: title-case variant of a ...procedure entry
    assert _is_internal_document('Keeping Children Safe In Education') is False

    # Whitespace trimming: leading/trailing whitespace still exempted
    assert _is_internal_document('  keeping children safe in education  ') is False

    # Control: a non-allowlisted "... policy" is still filtered as internal
    assert _is_internal_document('acme acceptable use policy') is True
