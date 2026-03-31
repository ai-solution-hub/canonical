"""Comprehensive parity tests for layer_inference.py.

Tests all 12 return paths (7 rules, some with sub-paths), priority ordering,
edge cases, and boundary values. Ensures parity with lib/layer-inference.ts.
"""

import pytest
import sys
import os

# Add scripts directory to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from kb_pipeline.layer_inference import (
    infer_layer,
    LayerSuggestion,
    LAYER_SALES_BRIEF,
    LAYER_BID_DETAIL,
    LAYER_COMPANY_REFERENCE,
    LAYER_RESEARCH,
)


# ---------------------------------------------------------------------------
# Helper: default kwargs for clean test cases
# ---------------------------------------------------------------------------

def _defaults(**overrides):
    """Return default infer_layer kwargs with overrides applied."""
    base = {
        "content_type": "article",
        "content_length": 1000,
        "ingestion_source": "manual",
        "has_brief": False,
        "has_detail": False,
        "has_reference": False,
        "is_bid_discovered": False,
        "title": "Test Title",
    }
    base.update(overrides)
    return base


# ═══════════════════════════════════════════════════════════════════════════
# Rule 1: Bid-discovered content
# ═══════════════════════════════════════════════════════════════════════════


class TestRule1BidDiscovered:
    def test_bid_discovered_returns_bid_detail(self):
        result = infer_layer(**_defaults(is_bid_discovered=True))
        assert result.suggested_layer == LAYER_BID_DETAIL
        assert result.confidence == "high"

    def test_bid_discovered_overrides_content_type(self):
        """Rule 1 should take priority over Rule 4 content type mapping."""
        result = infer_layer(**_defaults(
            is_bid_discovered=True,
            content_type="research",
        ))
        assert result.suggested_layer == LAYER_BID_DETAIL

    def test_bid_discovered_overrides_progressive_depth(self):
        """Rule 1 should take priority over Rule 3."""
        result = infer_layer(**_defaults(
            is_bid_discovered=True,
            has_reference=True,
        ))
        assert result.suggested_layer == LAYER_BID_DETAIL


# ═══════════════════════════════════════════════════════════════════════════
# Rule 2: Bid library Q&A pairs
# ═══════════════════════════════════════════════════════════════════════════


class TestRule2BidLibrary:
    def test_bid_library_qa_returns_bid_detail(self):
        result = infer_layer(**_defaults(
            ingestion_source="bid_library",
            content_type="q_a_pair",
        ))
        assert result.suggested_layer == LAYER_BID_DETAIL
        assert result.confidence == "high"

    def test_bid_library_non_qa_does_not_match(self):
        """Rule 2 requires BOTH bid_library source AND q_a_pair type."""
        result = infer_layer(**_defaults(
            ingestion_source="bid_library",
            content_type="article",
        ))
        # Should fall through to later rules, not match Rule 2
        assert result.confidence != "high" or result.suggested_layer != LAYER_BID_DETAIL or \
            "Q&A" not in result.reason

    def test_non_bid_library_qa_does_not_match_rule2(self):
        """Manual Q&A pairs should not match Rule 2."""
        result = infer_layer(**_defaults(
            ingestion_source="manual",
            content_type="q_a_pair",
            content_length=200,
        ))
        # Should fall through to Rule 5 (short Q&A)
        assert result.suggested_layer == LAYER_SALES_BRIEF


# ═══════════════════════════════════════════════════════════════════════════
# Rule 3: Progressive depth field presence
# ═══════════════════════════════════════════════════════════════════════════


class TestRule3ProgressiveDepth:
    def test_rule3a_has_reference(self):
        result = infer_layer(**_defaults(has_reference=True))
        assert result.suggested_layer == LAYER_COMPANY_REFERENCE
        assert result.confidence == "high"

    def test_rule3b_has_detail_and_brief(self):
        result = infer_layer(**_defaults(has_detail=True, has_brief=True))
        assert result.suggested_layer == LAYER_BID_DETAIL
        assert result.confidence == "medium"

    def test_rule3c_has_brief_only(self):
        result = infer_layer(**_defaults(has_brief=True, has_detail=False))
        assert result.suggested_layer == LAYER_SALES_BRIEF
        assert result.confidence == "medium"

    def test_has_reference_overrides_brief_and_detail(self):
        """Rule 3a (reference) takes priority over 3b (detail+brief)."""
        result = infer_layer(**_defaults(
            has_reference=True,
            has_detail=True,
            has_brief=True,
        ))
        assert result.suggested_layer == LAYER_COMPANY_REFERENCE

    def test_has_detail_without_brief_falls_through(self):
        """Detail alone (without brief) should not match Rule 3b or 3c."""
        result = infer_layer(**_defaults(
            has_detail=True,
            has_brief=False,
        ))
        # Should fall through to later rules
        assert "brief" not in result.reason.lower() or "detail" not in result.reason.lower()


# ═══════════════════════════════════════════════════════════════════════════
# Rule 4: Content type mapping
# ═══════════════════════════════════════════════════════════════════════════


class TestRule4ContentType:
    @pytest.mark.parametrize("content_type", ["policy", "compliance", "certification"])
    def test_rule4a_company_reference_types(self, content_type):
        result = infer_layer(**_defaults(content_type=content_type))
        assert result.suggested_layer == LAYER_COMPANY_REFERENCE
        assert result.confidence == "medium"

    def test_rule4b_research(self):
        result = infer_layer(**_defaults(content_type="research"))
        assert result.suggested_layer == LAYER_RESEARCH
        assert result.confidence == "high"

    def test_rule4c_case_study(self):
        result = infer_layer(**_defaults(content_type="case_study"))
        assert result.suggested_layer == LAYER_BID_DETAIL
        assert result.confidence == "medium"

    @pytest.mark.parametrize("content_type", [
        "product_description", "capability", "methodology",
    ])
    def test_rule4d_bid_detail_types(self, content_type):
        result = infer_layer(**_defaults(content_type=content_type))
        assert result.suggested_layer == LAYER_BID_DETAIL
        assert result.confidence == "medium"


# ═══════════════════════════════════════════════════════════════════════════
# Rule 5: Content length heuristics
# ═══════════════════════════════════════════════════════════════════════════


class TestRule5LengthHeuristics:
    def test_rule5a_short_qa_under_500(self):
        result = infer_layer(**_defaults(
            content_type="q_a_pair",
            content_length=200,
        ))
        assert result.suggested_layer == LAYER_SALES_BRIEF
        assert result.confidence == "low"

    def test_rule5b_long_qa_500_or_more(self):
        result = infer_layer(**_defaults(
            content_type="q_a_pair",
            content_length=500,
        ))
        assert result.suggested_layer == LAYER_BID_DETAIL
        assert result.confidence == "low"

    def test_rule5c_very_short_content(self):
        result = infer_layer(**_defaults(
            content_type="article",
            content_length=100,
        ))
        assert result.suggested_layer == LAYER_SALES_BRIEF
        assert result.confidence == "low"

    def test_rule5d_long_content_over_3000(self):
        result = infer_layer(**_defaults(
            content_type="article",
            content_length=5000,
        ))
        assert result.suggested_layer == LAYER_COMPANY_REFERENCE
        assert result.confidence == "low"


# ═══════════════════════════════════════════════════════════════════════════
# Rule 6: Source-based fallback
# ═══════════════════════════════════════════════════════════════════════════


class TestRule6SourceFallback:
    def test_url_import_returns_research(self):
        result = infer_layer(**_defaults(
            ingestion_source="url_import",
            content_type="article",
            content_length=1000,
        ))
        assert result.suggested_layer == LAYER_RESEARCH
        assert result.confidence == "low"

    def test_url_import_overridden_by_content_type(self):
        """Rule 4 (content type) should beat Rule 6 (source)."""
        result = infer_layer(**_defaults(
            ingestion_source="url_import",
            content_type="policy",
        ))
        assert result.suggested_layer == LAYER_COMPANY_REFERENCE


# ═══════════════════════════════════════════════════════════════════════════
# Rule 7: Default
# ═══════════════════════════════════════════════════════════════════════════


class TestRule7Default:
    def test_default_returns_bid_detail(self):
        result = infer_layer(**_defaults(
            content_type="article",
            content_length=1000,
            ingestion_source="manual",
        ))
        assert result.suggested_layer == LAYER_BID_DETAIL
        assert result.confidence == "low"

    def test_default_with_upload_source(self):
        """Upload source with medium-length unknown type should default."""
        result = infer_layer(**_defaults(
            content_type="article",
            content_length=1000,
            ingestion_source="upload",
        ))
        assert result.suggested_layer == LAYER_BID_DETAIL
        assert result.confidence == "low"


# ═══════════════════════════════════════════════════════════════════════════
# Priority ordering tests
# ═══════════════════════════════════════════════════════════════════════════


class TestPriorityOrdering:
    def test_rule1_beats_rule2(self):
        """Bid-discovered should beat bid_library Q&A."""
        result = infer_layer(**_defaults(
            is_bid_discovered=True,
            ingestion_source="bid_library",
            content_type="q_a_pair",
        ))
        assert "bid workspace" in result.reason.lower() or "discovered" in result.reason.lower()

    def test_rule2_beats_rule3(self):
        """Bid library Q&A should beat progressive depth."""
        result = infer_layer(**_defaults(
            ingestion_source="bid_library",
            content_type="q_a_pair",
            has_reference=True,
        ))
        assert "Q&A" in result.reason

    def test_rule3_beats_rule4(self):
        """Progressive depth (reference) should beat content type (research)."""
        result = infer_layer(**_defaults(
            has_reference=True,
            content_type="research",
        ))
        assert result.suggested_layer == LAYER_COMPANY_REFERENCE

    def test_rule4_beats_rule5(self):
        """Content type mapping should beat length heuristics."""
        result = infer_layer(**_defaults(
            content_type="policy",
            content_length=100,  # Would be sales_brief by length
        ))
        assert result.suggested_layer == LAYER_COMPANY_REFERENCE

    def test_rule5_beats_rule6(self):
        """Length heuristic (short) should beat source fallback (url_import)."""
        result = infer_layer(**_defaults(
            content_type="article",
            content_length=100,
            ingestion_source="url_import",
        ))
        assert result.suggested_layer == LAYER_SALES_BRIEF

    def test_rule6_beats_rule7(self):
        """Source fallback should beat default."""
        result = infer_layer(**_defaults(
            content_type="article",
            content_length=1000,
            ingestion_source="url_import",
        ))
        assert result.suggested_layer == LAYER_RESEARCH


# ═══════════════════════════════════════════════════════════════════════════
# Edge cases
# ═══════════════════════════════════════════════════════════════════════════


class TestEdgeCases:
    def test_empty_content_type(self):
        result = infer_layer(**_defaults(content_type="", content_length=1000))
        assert result.suggested_layer == LAYER_BID_DETAIL  # Default

    def test_zero_length(self):
        result = infer_layer(**_defaults(content_length=0))
        assert result.suggested_layer == LAYER_SALES_BRIEF  # < 300

    def test_unknown_content_type(self):
        result = infer_layer(**_defaults(
            content_type="unknown_type_xyz",
            content_length=1000,
        ))
        assert result.suggested_layer == LAYER_BID_DETAIL  # Default

    def test_empty_title(self):
        result = infer_layer(**_defaults(title=""))
        # Title doesn't affect current logic, should still work
        assert isinstance(result, LayerSuggestion)

    def test_all_defaults(self):
        """Calling with no arguments should return the default."""
        result = infer_layer()
        assert result.suggested_layer == LAYER_SALES_BRIEF  # 0 length < 300

    def test_negative_length(self):
        """Negative length should be treated like very short content."""
        result = infer_layer(content_length=-1)
        assert result.suggested_layer == LAYER_SALES_BRIEF  # < 300

    def test_return_type_is_dataclass(self):
        result = infer_layer(**_defaults())
        assert isinstance(result, LayerSuggestion)
        assert isinstance(result.suggested_layer, str)
        assert isinstance(result.reason, str)
        assert result.confidence in ("high", "medium", "low")


# ═══════════════════════════════════════════════════════════════════════════
# Boundary values
# ═══════════════════════════════════════════════════════════════════════════


class TestBoundaryValues:
    def test_exactly_300_chars_not_short(self):
        """Exactly 300 chars should NOT trigger the <300 rule."""
        result = infer_layer(**_defaults(
            content_type="article",
            content_length=300,
            ingestion_source="manual",
        ))
        # 300 is not < 300, so should fall through to default
        assert result.suggested_layer == LAYER_BID_DETAIL

    def test_299_chars_is_short(self):
        result = infer_layer(**_defaults(
            content_type="article",
            content_length=299,
        ))
        assert result.suggested_layer == LAYER_SALES_BRIEF

    def test_exactly_500_qa_is_bid_detail(self):
        """Q&A at exactly 500 chars should be bid_detail (>= 500)."""
        result = infer_layer(**_defaults(
            content_type="q_a_pair",
            content_length=500,
        ))
        assert result.suggested_layer == LAYER_BID_DETAIL

    def test_499_qa_is_sales_brief(self):
        result = infer_layer(**_defaults(
            content_type="q_a_pair",
            content_length=499,
        ))
        assert result.suggested_layer == LAYER_SALES_BRIEF

    def test_exactly_3000_chars_not_long(self):
        """Exactly 3000 chars should NOT trigger the >3000 rule."""
        result = infer_layer(**_defaults(
            content_type="article",
            content_length=3000,
            ingestion_source="manual",
        ))
        # 3000 is not > 3000, so should fall through to default
        assert result.suggested_layer == LAYER_BID_DETAIL

    def test_3001_chars_is_long(self):
        result = infer_layer(**_defaults(
            content_type="article",
            content_length=3001,
        ))
        assert result.suggested_layer == LAYER_COMPANY_REFERENCE


# ═══════════════════════════════════════════════════════════════════════════
# Layer constant validity
# ═══════════════════════════════════════════════════════════════════════════


class TestLayerConstants:
    def test_all_layers_are_strings(self):
        assert isinstance(LAYER_SALES_BRIEF, str)
        assert isinstance(LAYER_BID_DETAIL, str)
        assert isinstance(LAYER_COMPANY_REFERENCE, str)
        assert isinstance(LAYER_RESEARCH, str)

    def test_layer_values_match_typescript(self):
        """Ensure Python constants match the TypeScript values."""
        assert LAYER_SALES_BRIEF == "sales_brief"
        assert LAYER_BID_DETAIL == "bid_detail"
        assert LAYER_COMPANY_REFERENCE == "company_reference"
        assert LAYER_RESEARCH == "research"
