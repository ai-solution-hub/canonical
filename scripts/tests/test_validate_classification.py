"""Tests for _validate_classification() in classify.py.

Uses the taxonomy snapshot fixture (scripts/tests/fixtures/taxonomy_snapshot.json)
as the single source of truth for valid domain and subtopic names.
"""

import json
import logging
import os
import sys

# Add scripts dir to path so we can import kb_pipeline
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from kb_pipeline.classify import _validate_classification, ClassificationResult


FIXTURE_PATH = os.path.join(
    os.path.dirname(__file__), "fixtures", "taxonomy_snapshot.json"
)


def _load_snapshot():
    """Load the taxonomy snapshot fixture."""
    with open(FIXTURE_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def _valid_domains_from_snapshot(snapshot):
    """Extract domain names from snapshot (all active, any provenance)."""
    return [d["name"] for d in snapshot["domains"]]


def _valid_subtopics_from_snapshot(snapshot):
    """Extract subtopic names from snapshot (all active, any provenance)."""
    return [s["name"] for s in snapshot["subtopics"]]


# Load once at module level for all tests
_snapshot = _load_snapshot()
VALID_DOMAINS = _valid_domains_from_snapshot(_snapshot)
VALID_SUBTOPICS = _valid_subtopics_from_snapshot(_snapshot)


def _make_result(domain="security", subtopic="data-protection"):
    """Create a minimal ClassificationResult for validation testing."""
    return ClassificationResult(
        primary_domain=domain,
        primary_subtopic=subtopic,
        confidence=0.90,
        secondary_domain=None,
        secondary_subtopic=None,
        suggested_title="Test Title",
        summary="Test summary.",
        ai_keywords=["test"],
        reasoning="Test reasoning.",
        is_fragment=False,
        uncertain=False,
        requires_review=False,
        reason_if_flagged="",
    )


class TestValidateClassification:
    """Tests for post-classification validation."""

    def test_valid_domain_and_subtopic_returns_no_warnings(self):
        """Known domain and subtopic produce no warnings."""
        result = _make_result("security", "data-protection")
        warnings = _validate_classification(result, VALID_DOMAINS, VALID_SUBTOPICS)
        assert warnings == []

    def test_unknown_domain_produces_warning(self):
        """Unknown domain produces a warning but does not raise."""
        result = _make_result("NONEXISTENT DOMAIN", "data-protection")
        warnings = _validate_classification(result, VALID_DOMAINS, VALID_SUBTOPICS)
        assert len(warnings) == 1
        assert "Unknown domain: NONEXISTENT DOMAIN" in warnings[0]

    def test_unknown_subtopic_produces_warning(self):
        """Unknown subtopic produces a warning but does not raise."""
        result = _make_result("security", "nonexistent-subtopic")
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
        result = _make_result("BAD DOMAIN", "data-protection")
        with caplog.at_level(logging.WARNING, logger="kb_pipeline.classify"):
            _validate_classification(result, VALID_DOMAINS, VALID_SUBTOPICS)
        assert any("Classification validation" in r.message for r in caplog.records)

    def test_valid_classification_logs_nothing(self, caplog):
        """Valid classification does not produce log warnings."""
        result = _make_result("security", "data-protection")
        with caplog.at_level(logging.WARNING, logger="kb_pipeline.classify"):
            _validate_classification(result, VALID_DOMAINS, VALID_SUBTOPICS)
        validation_records = [
            r for r in caplog.records if "Classification validation" in r.message
        ]
        assert len(validation_records) == 0

    def test_case_sensitive_matching(self):
        """Domain matching is case-sensitive (as per taxonomy convention)."""
        result = _make_result("SECURITY", "data-protection")
        warnings = _validate_classification(result, VALID_DOMAINS, VALID_SUBTOPICS)
        assert len(warnings) == 1
        assert "Unknown domain" in warnings[0]

    def test_all_baseline_domains_from_snapshot_are_valid(self):
        """Every baseline domain from the snapshot should pass validation."""
        baseline = [d["name"] for d in _snapshot["domains"] if d["provenance"] == "baseline"]
        for domain_name in baseline:
            result = _make_result(domain_name, "data-protection")
            warnings = _validate_classification(result, VALID_DOMAINS, VALID_SUBTOPICS)
            domain_warnings = [w for w in warnings if "Unknown domain" in w]
            assert domain_warnings == [], f"Baseline domain '{domain_name}' was flagged as unknown"

    def test_all_subtopics_from_snapshot_are_valid(self):
        """Every subtopic from the snapshot should pass validation."""
        for subtopic_name in VALID_SUBTOPICS:
            result = _make_result("security", subtopic_name)
            warnings = _validate_classification(result, VALID_DOMAINS, VALID_SUBTOPICS)
            subtopic_warnings = [w for w in warnings if "Unknown subtopic" in w]
            assert subtopic_warnings == [], f"Subtopic '{subtopic_name}' was flagged as unknown"

    def test_snapshot_has_baseline_domains(self):
        """Snapshot should contain expected baseline domains."""
        baseline_names = sorted(
            d["name"] for d in _snapshot["domains"] if d["provenance"] == "baseline"
        )
        assert baseline_names == [
            "compliance", "corporate", "implementation",
            "methodology", "product-feature", "security", "support",
        ]
