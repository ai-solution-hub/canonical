"""Tests for _validate_classification() in classify.py."""

import logging
import sys
import os

# Add scripts dir to path so we can import kb_pipeline
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from kb_pipeline.classify import _validate_classification, ClassificationResult


def _make_result(domain="AI & EMERGING TECH", subtopic="ai-models-llms"):
    """Create a minimal ClassificationResult for validation testing."""
    return ClassificationResult(
        primary_domain=domain,
        primary_subtopic=subtopic,
        confidence=0.90,
        secondary_domain=None,
        secondary_subtopic=None,
        suggested_title="Test Title",
        ai_summary="Test summary.",
        ai_keywords=["test"],
        reasoning="Test reasoning.",
        is_fragment=False,
        uncertain=False,
        requires_review=False,
        reason_if_flagged="",
    )


VALID_DOMAINS = [
    "AI & EMERGING TECH",
    "STRATEGY & BUSINESS",
    "PRODUCTS & INNOVATION",
    "INSIGHTS & ANALYSIS",
    "LEARNING & DEVELOPMENT",
    "META & PERSONAL",
]

VALID_SUBTOPICS = [
    "ai-models-llms",
    "ai-tools-frameworks",
    "ai-research",
    "ai-implementation-practice",
    "technical-implementation",
    "ai-safety-governance",
    "business-model-monetization",
    "market-analysis",
    "organizational-strategy",
    "growth-scaling",
]


class TestValidateClassification:
    """Tests for post-classification validation."""

    def test_valid_domain_and_subtopic_returns_no_warnings(self):
        """Known domain and subtopic produce no warnings."""
        result = _make_result("AI & EMERGING TECH", "ai-models-llms")
        warnings = _validate_classification(result, VALID_DOMAINS, VALID_SUBTOPICS)
        assert warnings == []

    def test_unknown_domain_produces_warning(self):
        """Unknown domain produces a warning but does not raise."""
        result = _make_result("NONEXISTENT DOMAIN", "ai-models-llms")
        warnings = _validate_classification(result, VALID_DOMAINS, VALID_SUBTOPICS)
        assert len(warnings) == 1
        assert "Unknown domain: NONEXISTENT DOMAIN" in warnings[0]

    def test_unknown_subtopic_produces_warning(self):
        """Unknown subtopic produces a warning but does not raise."""
        result = _make_result("AI & EMERGING TECH", "nonexistent-subtopic")
        warnings = _validate_classification(result, VALID_DOMAINS, VALID_SUBTOPICS)
        assert len(warnings) == 1
        assert "Unknown subtopic: nonexistent-subtopic" in warnings[0]

    def test_both_unknown_produces_two_warnings(self):
        """Both unknown domain and subtopic produce two warnings."""
        result = _make_result("BAD DOMAIN", "bad-subtopic")
        warnings = _validate_classification(result, VALID_DOMAINS, VALID_SUBTOPICS)
        assert len(warnings) == 2
        assert any("Unknown domain" in w for w in warnings)
        assert any("Unknown subtopic" in w for w in warnings)

    def test_warnings_are_logged(self, caplog):
        """Validation warnings are logged at WARNING level."""
        result = _make_result("BAD DOMAIN", "ai-models-llms")
        with caplog.at_level(logging.WARNING, logger="kb_pipeline.classify"):
            _validate_classification(result, VALID_DOMAINS, VALID_SUBTOPICS)
        assert any("Classification validation" in r.message for r in caplog.records)

    def test_valid_classification_logs_nothing(self, caplog):
        """Valid classification does not produce log warnings."""
        result = _make_result("AI & EMERGING TECH", "ai-models-llms")
        with caplog.at_level(logging.WARNING, logger="kb_pipeline.classify"):
            _validate_classification(result, VALID_DOMAINS, VALID_SUBTOPICS)
        validation_records = [
            r for r in caplog.records if "Classification validation" in r.message
        ]
        assert len(validation_records) == 0

    def test_case_sensitive_matching(self):
        """Domain matching is case-sensitive (as per taxonomy convention)."""
        result = _make_result("ai & emerging tech", "ai-models-llms")
        warnings = _validate_classification(result, VALID_DOMAINS, VALID_SUBTOPICS)
        assert len(warnings) == 1
        assert "Unknown domain" in warnings[0]
