"""Tests for _validate_classification() in classify.py.

Taxonomy data comes from the committed snapshot file
(scripts/tests/fixtures/taxonomy_snapshot.json) via pytest fixtures
defined in conftest.py. This ensures tests validate against current
taxonomy rather than hardcoded stale data.
"""

import logging
import sys
import os

# Add scripts dir to path so we can import kb_pipeline
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from kb_pipeline.classify import _validate_classification, ClassificationResult


def _make_result(domain="security", subtopic="data-protection"):
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


class TestValidateClassification:
    """Tests for post-classification validation."""

    def test_valid_domain_and_subtopic_returns_no_warnings(self, valid_domains, valid_subtopics):
        """Known domain and subtopic produce no warnings."""
        result = _make_result(valid_domains[0], valid_subtopics[0])
        warnings = _validate_classification(result, valid_domains, valid_subtopics)
        assert warnings == []

    def test_unknown_domain_produces_warning(self, valid_domains, valid_subtopics):
        """Unknown domain produces a warning but does not raise."""
        result = _make_result("NONEXISTENT DOMAIN", valid_subtopics[0])
        warnings = _validate_classification(result, valid_domains, valid_subtopics)
        assert len(warnings) == 1
        assert "Unknown domain: NONEXISTENT DOMAIN" in warnings[0]

    def test_unknown_subtopic_produces_warning(self, valid_domains, valid_subtopics):
        """Unknown subtopic produces a warning but does not raise."""
        result = _make_result(valid_domains[0], "nonexistent-subtopic")
        warnings = _validate_classification(result, valid_domains, valid_subtopics)
        assert len(warnings) == 1
        assert "Unknown subtopic: nonexistent-subtopic" in warnings[0]

    def test_both_unknown_produces_two_warnings(self, valid_domains, valid_subtopics):
        """Both unknown domain and subtopic produce two warnings."""
        result = _make_result("BAD DOMAIN", "bad-subtopic")
        warnings = _validate_classification(result, valid_domains, valid_subtopics)
        assert len(warnings) == 2
        assert any("Unknown domain" in w for w in warnings)
        assert any("Unknown subtopic" in w for w in warnings)

    def test_warnings_are_logged(self, valid_domains, valid_subtopics, caplog):
        """Validation warnings are logged at WARNING level."""
        result = _make_result("BAD DOMAIN", valid_subtopics[0])
        with caplog.at_level(logging.WARNING, logger="kb_pipeline.classify"):
            _validate_classification(result, valid_domains, valid_subtopics)
        assert any("Classification validation" in r.message for r in caplog.records)

    def test_valid_classification_logs_nothing(self, valid_domains, valid_subtopics, caplog):
        """Valid classification does not produce log warnings."""
        result = _make_result(valid_domains[0], valid_subtopics[0])
        with caplog.at_level(logging.WARNING, logger="kb_pipeline.classify"):
            _validate_classification(result, valid_domains, valid_subtopics)
        validation_records = [
            r for r in caplog.records if "Classification validation" in r.message
        ]
        assert len(validation_records) == 0

    def test_case_sensitive_matching(self, valid_domains, valid_subtopics):
        """Domain matching is case-sensitive (as per taxonomy convention)."""
        # Use an uppercase version of a known domain to test case sensitivity
        upper_domain = valid_domains[0].upper() if valid_domains[0] != valid_domains[0].upper() else valid_domains[0].lower()
        result = _make_result(upper_domain, valid_subtopics[0])
        warnings = _validate_classification(result, valid_domains, valid_subtopics)
        assert len(warnings) == 1
        assert "Unknown domain" in warnings[0]
